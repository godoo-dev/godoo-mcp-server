"""Odoo credential resolution and per-request ASGI middleware.

Resolves X-Odoo-* request headers with ODOO_* env var fallback.
Returns HTTP 401 with enumerated missing fields when any credential is absent.
Injects resolved credentials into scope["state"]["odoo_creds"] for downstream tool handlers.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import TYPE_CHECKING

from starlette.responses import JSONResponse

if TYPE_CHECKING:
    from starlette.types import ASGIApp, Receive, Scope, Send


@dataclass(repr=False)
class OdooCredentials:
    """Per-request resolved Odoo credentials.

    repr=False prevents accidental password leakage in logs and tracebacks.
    """

    url: str
    database: str
    username: str
    password: str

    def __repr__(self) -> str:
        return (
            f"OdooCredentials(url={self.url!r}, database={self.database!r}, "
            f"username={self.username!r}, password=***)"
        )


class CredentialMiddleware:
    """Pure ASGI middleware: resolves Odoo credentials per-request.

    Precedence: X-Odoo-* headers > ODOO_* env vars.
    Returns HTTP 401 with enumerated missing fields if any credential is absent.
    Stores OdooCredentials in scope["state"]["odoo_creds"] for tool handlers.

    Uses pure ASGI (implements __call__ directly) to avoid contextvar propagation issues
    that affect the MCP SDK's internal request context management.
    """

    def __init__(self, app: ASGIApp) -> None:
        self._app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            # Pass lifespan and WebSocket events through unchanged
            await self._app(scope, receive, send)
            return

        # /healthz is unauthenticated — bypass credential check.
        # Also used as Docker HEALTHCHECK in Phase 5.
        if scope.get("path") == "/healthz":
            await self._app(scope, receive, send)
            return

        raw_headers: dict[bytes, bytes] = {
            name.lower(): value for name, value in scope.get("headers", [])
        }

        def _header(name: str) -> str | None:
            val = raw_headers.get(name.encode("latin-1"), b"").decode("latin-1")
            return val or None

        def _env(*names: str) -> str | None:
            for name in names:
                val = os.environ.get(name, "")
                if val:
                    return val
            return None

        url = _header("x-odoo-url") or _env("ODOO_URL")
        database = _header("x-odoo-database") or _env("ODOO_DATABASE", "ODOO_DB")
        username = _header("x-odoo-username") or _env("ODOO_USERNAME", "ODOO_USER")
        password = _header("x-odoo-password") or _env("ODOO_PASSWORD")

        missing: list[str] = []
        if not url:
            missing.append("X-Odoo-Url (or ODOO_URL)")
        if not database:
            missing.append("X-Odoo-Database (or ODOO_DATABASE / ODOO_DB)")
        if not username:
            missing.append("X-Odoo-Username (or ODOO_USERNAME / ODOO_USER)")
        if not password:
            missing.append("X-Odoo-Password (or ODOO_PASSWORD)")

        if missing:
            # SECURITY: enumerate missing field NAMES only — never echo supplied credential values
            response = JSONResponse(
                {"error": "missing_credentials", "missing": missing},
                status_code=401,
            )
            await response(scope, receive, send)
            return

        # All four fields resolved — inject into scope["state"] (backs Request.state)
        scope.setdefault("state", {})
        # mypy: all values are non-None after the missing check above
        assert url and database and username and password
        scope["state"]["odoo_creds"] = OdooCredentials(
            url=url,
            database=database,
            username=username,
            password=password,
        )
        try:
            await self._app(scope, receive, send)
        finally:
            # The request scope can be retained by ASGI tooling after dispatch;
            # release credential references on every exit, including cancellation.
            scope["state"].pop("odoo_creds", None)
