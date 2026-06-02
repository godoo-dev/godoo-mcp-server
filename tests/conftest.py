"""Shared pytest fixtures for godoo-mcp-server unit tests."""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from godoo_mcp_server.server import create_app

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator

    import pytest

STANDARD_MCP_HEADERS: dict[str, str] = {
    "content-type": "application/json",
    "accept": "application/json, text/event-stream",
    "mcp-protocol-version": "2024-11-05",
}

FAKE_CRED_HEADERS: dict[str, str] = {
    "x-odoo-url": "http://odoo.test",
    "x-odoo-database": "testdb",
    "x-odoo-username": "admin",
    "x-odoo-password": "admin",
}


async def _make_client(
    headers: dict[str, str],
    stop_event: asyncio.Event,
    ready_event: asyncio.Event,
) -> None:
    """Internal coroutine: starts app lifespan, signals ready, waits for stop."""
    app = create_app()
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(
            transport=transport,
            base_url="http://test",
            headers=headers,
        ) as client:
            # Signal that the client is ready and pass it to the fixture via future
            ready_event._client = client  # type: ignore[attr-defined]
            ready_event.set()
            await stop_event.wait()


@pytest_asyncio.fixture
async def mcp_client() -> AsyncGenerator[AsyncClient]:
    """In-process MCP client with lifespan managed and default credential headers.

    IMPORTANT: lifespan_context must be entered before any requests.
    Without it: RuntimeError: Task group is not initialized.

    Uses background task + event pair to ensure lifespan enters and exits within
    the same asyncio task (required by anyio cancel scopes).
    """
    stop_event: asyncio.Event = asyncio.Event()
    ready_event: asyncio.Event = asyncio.Event()

    headers = {**STANDARD_MCP_HEADERS, **FAKE_CRED_HEADERS}
    task = asyncio.ensure_future(_make_client(headers, stop_event, ready_event))
    await ready_event.wait()
    try:
        yield ready_event._client  # type: ignore[attr-defined]
    finally:
        stop_event.set()
        await task


@pytest_asyncio.fixture
async def mcp_client_no_creds(monkeypatch: pytest.MonkeyPatch) -> AsyncGenerator[AsyncClient]:
    """In-process MCP client with no X-Odoo-* headers and env vars cleared."""
    monkeypatch.delenv("ODOO_URL", raising=False)
    monkeypatch.delenv("ODOO_DATABASE", raising=False)
    monkeypatch.delenv("ODOO_DB", raising=False)
    monkeypatch.delenv("ODOO_USERNAME", raising=False)
    monkeypatch.delenv("ODOO_USER", raising=False)
    monkeypatch.delenv("ODOO_PASSWORD", raising=False)

    stop_event: asyncio.Event = asyncio.Event()
    ready_event: asyncio.Event = asyncio.Event()

    task = asyncio.ensure_future(_make_client(STANDARD_MCP_HEADERS, stop_event, ready_event))
    await ready_event.wait()
    try:
        yield ready_event._client  # type: ignore[attr-defined]
    finally:
        stop_event.set()
        await task
