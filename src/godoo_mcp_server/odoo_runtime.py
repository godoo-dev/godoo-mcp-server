"""Safe Odoo client lifecycle and public error mapping for tool handlers."""

from __future__ import annotations

import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING

from fastmcp.exceptions import ToolError
from godoo.client.errors import (
    OdooAccessError,
    OdooAuthError,
    OdooError,
    OdooNetworkError,
    OdooTimeoutError,
    OdooValidationError,
)

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from godoo.client.client import OdooClient

logger = logging.getLogger("godoo_mcp_server.odoo")
_CLEANUP_TIMEOUT_SECONDS = 5


class ClassifiedToolError(ToolError):
    """A safe public diagnostic with a stable telemetry category."""

    def __init__(self, message: str, *, category: str) -> None:
        super().__init__(message)
        self.category = category


class AuthenticationConnectionError(OdooError):
    """Authentication transport failed before any tool operation was dispatched."""


@asynccontextmanager
async def managed_odoo_client(client: OdooClient) -> AsyncIterator[OdooClient]:
    """Close transport even when authentication in ``__aenter__`` fails.

    The SDK context manager only invokes ``__aexit__`` after successful entry.
    Cleanup is shielded from caller cancellation and bounded so disconnects do not
    leave client transports open indefinitely.
    """
    try:
        try:
            await client.__aenter__()
        except OdooNetworkError as error:
            raise AuthenticationConnectionError() from error
        yield client
    finally:
        task = asyncio.create_task(client.aclose())
        try:
            await asyncio.wait_for(asyncio.shield(task), timeout=_CLEANUP_TIMEOUT_SECONDS)
        except asyncio.CancelledError:
            # A cancelled request still gets a bounded chance to close its transport.
            try:
                await asyncio.wait_for(asyncio.shield(task), timeout=_CLEANUP_TIMEOUT_SECONDS)
            except TimeoutError:
                task.cancel()
                with contextlib.suppress(BaseException):
                    await asyncio.wait_for(asyncio.shield(task), timeout=0.1)
                logger.warning("odoo_transport_cleanup_timed_out")
            except Exception:
                logger.warning("odoo_transport_cleanup_failed")
            raise
        except TimeoutError:
            task.cancel()
            with contextlib.suppress(BaseException):
                await asyncio.wait_for(asyncio.shield(task), timeout=0.1)
            logger.warning("odoo_transport_cleanup_timed_out")
        except Exception:
            # Never log SDK exception text: it can contain request data or credentials.
            logger.warning("odoo_transport_cleanup_failed")


def safe_tool_error(error: OdooError, *, write_may_have_dispatched: bool = False) -> ToolError:
    """Map Odoo failures to stable, non-sensitive public diagnostics."""
    if isinstance(error, AuthenticationConnectionError):
        return ClassifiedToolError(
            "Odoo authentication connection failed", category="auth_connection_failed"
        )
    if isinstance(error, OdooAuthError):
        return ClassifiedToolError("Odoo authentication failed", category="auth_failed")
    if isinstance(error, OdooAccessError):
        return ClassifiedToolError("Odoo access denied", category="access_denied")
    if isinstance(error, (OdooNetworkError, OdooTimeoutError)):
        if write_may_have_dispatched:
            return ClassifiedToolError(
                "Odoo write outcome is unknown; do not retry automatically",
                category="unknown_write",
            )
        return ClassifiedToolError("Odoo connection failed", category="connection_failed")
    if isinstance(error, OdooValidationError):
        return ClassifiedToolError("Odoo rejected the request", category="odoo_rejected")
    return ClassifiedToolError("Odoo request failed", category="odoo_error")
