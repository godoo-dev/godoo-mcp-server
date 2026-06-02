"""Shared pytest fixtures for godoo-mcp-server unit tests."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest_asyncio
from godoo_mcp_server.server import create_app
from httpx import ASGITransport, AsyncClient

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


@pytest_asyncio.fixture
async def mcp_client() -> AsyncGenerator[AsyncClient]:
    """In-process MCP client with lifespan managed and default credential headers.

    IMPORTANT: lifespan_context must be entered before any requests.
    Without it: RuntimeError: Task group is not initialized.
    """
    app = create_app()
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(
            transport=transport,
            base_url="http://test",
            headers={**STANDARD_MCP_HEADERS, **FAKE_CRED_HEADERS},
        ) as client:
            yield client


@pytest_asyncio.fixture
async def mcp_client_no_creds(monkeypatch: pytest.MonkeyPatch) -> AsyncGenerator[AsyncClient]:
    """In-process MCP client with no X-Odoo-* headers and env vars cleared."""
    monkeypatch.delenv("ODOO_URL", raising=False)
    monkeypatch.delenv("ODOO_DATABASE", raising=False)
    monkeypatch.delenv("ODOO_DB", raising=False)
    monkeypatch.delenv("ODOO_USERNAME", raising=False)
    monkeypatch.delenv("ODOO_USER", raising=False)
    monkeypatch.delenv("ODOO_PASSWORD", raising=False)

    app = create_app()
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(
            transport=transport,
            base_url="http://test",
            headers=STANDARD_MCP_HEADERS,
        ) as client:
            yield client
