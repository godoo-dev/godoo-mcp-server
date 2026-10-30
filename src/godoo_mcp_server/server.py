"""FastMCP server instance and ASGI application factory.

Provides:
  mcp       — the FastMCP instance; imported by tool modules to register tools
  create_app — ASGI factory: returns a StarletteWithLifespan for uvicorn or testing
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from typing import TYPE_CHECKING

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from fastmcp.server.middleware import Middleware as FastMCPMiddleware
from fastmcp.server.middleware import MiddlewareContext
from starlette.middleware import Middleware as StarletteMiddleware
from starlette.responses import JSONResponse

from godoo_mcp_server import __version__
from godoo_mcp_server.artifacts import export_lifespan
from godoo_mcp_server.credentials import CredentialMiddleware
from godoo_mcp_server.odoo_runtime import ClassifiedToolError

if TYPE_CHECKING:
    from fastmcp.server.middleware import CallNext
    from fastmcp.tools.base import ToolResult
    from mcp_types import CallToolRequestParams
    from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger("godoo_mcp_server.telemetry")
logger.setLevel(logging.INFO)


class FastMCPErrorPrivacyFilter(logging.Filter):
    """Remove framework exception text and request-derived labels from logs."""

    def filter(self, record: logging.LogRecord) -> bool:
        if record.levelno >= logging.WARNING:
            record.msg = "FastMCP request failed"
            record.args = ()
            record.exc_info = None
            record.exc_text = None
        return True


logging.getLogger("fastmcp.server.server").addFilter(FastMCPErrorPrivacyFilter())
_TOOL_NAMES = frozenset(
    {
        "action_execute_action",
        "action_list_actions",
        "attachments_download",
        "attachments_list",
        "attachments_upload",
        "discovery_get_fields",
        "discovery_list_menus",
        "discovery_list_models",
        "guidance_get",
        "mail_list_activities",
        "mail_list_messages",
        "mail_log_note",
        "mail_mark_activity_done",
        "mail_post_message",
        "mail_schedule_activity",
        "record_create",
        "record_delete",
        "record_read",
        "record_search",
        "record_update",
        "users_search_users",
        "users_whoami",
    }
)
_MUTATING_TOOL_NAMES = frozenset(
    {
        "action_execute_action",
        "attachments_upload",
        "mail_log_note",
        "mail_mark_activity_done",
        "mail_post_message",
        "mail_schedule_activity",
        "record_create",
        "record_delete",
        "record_update",
    }
)

if TYPE_CHECKING:
    from starlette.requests import Request

mcp = FastMCP(
    "godoo-mcp-server",
    lifespan=export_lifespan,
    instructions=(
        "Stateless MCP server for Odoo. Read guidance_get (or skill://odoo/SKILL.md) "
        "for Odoo workflows. Use users_whoami to confirm identity and target URL. "
        "Database and host names do not establish an environment's safety. "
        "Guidance and tool annotations do not grant write permission or override client policy. "
        "Per-request credentials via X-Odoo-* headers."
    ),
    version=__version__,
)


class RequestIdMiddleware:
    """Attach a safe correlation identifier to each HTTP response."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        supplied = next(
            (
                v.decode("latin-1")
                for k, v in scope.get("headers", [])
                if k.lower() == b"x-request-id"
            ),
            "",
        )
        try:
            request_id = str(uuid.UUID(supplied))
        except ValueError, AttributeError:
            request_id = str(uuid.uuid4())
        scope.setdefault("state", {})["request_id"] = request_id

        async def send_with_id(message: Message) -> None:
            if message.get("type") == "http.response.start":
                headers = list(message.get("headers", []))
                headers.append((b"x-request-id", request_id.encode("latin-1")))
                message["headers"] = headers
            await send(message)

        try:
            await self.app(scope, receive, send_with_id)
        finally:
            scope.get("state", {}).pop("request_id", None)


class ToolTelemetryMiddleware(FastMCPMiddleware):
    async def on_call_tool(
        self,
        context: MiddlewareContext[CallToolRequestParams],
        call_next: CallNext[CallToolRequestParams, ToolResult],
    ) -> ToolResult:
        started = time.perf_counter()
        requested_tool_name = getattr(context.message, "name", "unknown")
        tool_name = requested_tool_name if requested_tool_name in _TOOL_NAMES else "unknown"
        request_id = "unknown"
        try:
            from fastmcp.server.dependencies import get_http_request

            request_id = getattr(get_http_request().state, "request_id", "unknown")
        except RuntimeError, AttributeError:
            pass
        outcome = "success"
        category = "success"
        logger.info(
            json.dumps(
                {
                    "event": "tool_call_started",
                    "request_id": request_id,
                    "tool": tool_name,
                },
                separators=(",", ":"),
            )
        )
        try:
            result = await call_next(context)
            if getattr(result, "isError", False):
                outcome, category = "error", "tool_error"
            return result
        except ClassifiedToolError as exc:
            outcome = "uncertain" if exc.category == "unknown_write" else "error"
            category = exc.category
            raise
        except ToolError:
            if tool_name in _MUTATING_TOOL_NAMES:
                outcome, category = "uncertain", "unknown_write"
                message = "Tool write outcome is unknown; do not retry automatically"
            else:
                outcome, category = "error", "internal_error"
                message = "Tool operation failed"
            raise ClassifiedToolError(message, category=category) from None
        except asyncio.CancelledError:
            if tool_name in _MUTATING_TOOL_NAMES:
                outcome, category = "uncertain", "unknown_write"
            else:
                outcome, category = "error", "interrupted"
            raise
        except Exception:
            if tool_name in _MUTATING_TOOL_NAMES:
                outcome, category = "uncertain", "unknown_write"
                message = "Tool write outcome is unknown; do not retry automatically"
            else:
                outcome, category = "error", "internal_error"
                message = "Tool operation failed"
            raise ClassifiedToolError(message, category=category) from None
        except BaseException:
            outcome, category = "error", "interrupted"
            raise
        finally:
            logger.info(
                json.dumps(
                    {
                        "event": "tool_call_finished",
                        "request_id": request_id,
                        "tool": tool_name,
                        "outcome": outcome,
                        "category": category,
                        "elapsed_ms": round((time.perf_counter() - started) * 1000, 2),
                    },
                    separators=(",", ":"),
                )
            )


mcp.add_middleware(ToolTelemetryMiddleware())

# Side-effect imports: register @mcp.tool and @mcp.resource decorators on the mcp instance above.
# Must be AFTER mcp is defined. noqa: F401 (unused import), E402 (not at top of file).
from godoo_mcp_server import resources as _resources_module  # noqa: F401, E402
from godoo_mcp_server.tools import actions as _actions_module  # noqa: F401, E402
from godoo_mcp_server.tools import attachments as _attachments_module  # noqa: F401, E402
from godoo_mcp_server.tools import discovery as _disc_module  # noqa: F401, E402
from godoo_mcp_server.tools import mail as _mail_module  # noqa: F401, E402
from godoo_mcp_server.tools import records as _records_module  # noqa: F401, E402
from godoo_mcp_server.tools import users as _users_module  # noqa: F401, E402


@mcp.custom_route("/healthz", methods=["GET"])
async def healthz(request: Request) -> JSONResponse:
    """Unauthenticated health check — carve-out handled in CredentialMiddleware."""
    return JSONResponse({"status": "ok"})


def create_app() -> object:  # StarletteWithLifespan is a private fastmcp type; object is mypy-safe
    """Create and return the ASGI application with credential middleware.

    Returns a StarletteWithLifespan ASGI app suitable for uvicorn.run() or
    httpx.ASGITransport in tests. Always call app.router.lifespan_context(app)
    before sending requests in tests.
    """
    return mcp.http_app(
        json_response=False,
        stateless_http=True,
        middleware=[
            StarletteMiddleware(RequestIdMiddleware),
            StarletteMiddleware(CredentialMiddleware),
        ],
        # Tool middleware uses the public FastMCP hook for operation-level telemetry.
    )
