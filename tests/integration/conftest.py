"""Session-scoped fixtures for integration tests (require Docker + real Odoo)."""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

import pytest
import pytest_asyncio
from godoo.testcontainers import TestHarness
from httpx import ASGITransport, AsyncClient

from godoo_mcp_server.server import create_app

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator, Callable

    from godoo.testcontainers import StartedOdooContainer

# Standard MCP headers required for every MCP request.
# Redefined here to avoid conftest import-chain issues — same values as tests/conftest.py.
STANDARD_MCP_HEADERS: dict[str, str] = {
    "content-type": "application/json",
    "accept": "application/json, text/event-stream",
    "mcp-protocol-version": "2024-11-05",
}


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def odoo_harness() -> AsyncGenerator[StartedOdooContainer]:
    """Session-scoped real Odoo container — starts once, shared across all integration tests."""
    async with TestHarness(
        modules=["base"],
        snapshot=True,
        database="test_odoo",
        admin_password="admin",
    ) as h:
        yield h


async def _run_app_lifespan(
    stop_event: asyncio.Event,
    ready_event: asyncio.Event,
) -> None:
    """Start the app lifespan in a background task, yield the app via event, then teardown."""
    app = create_app()
    async with app.router.lifespan_context(app):
        ready_event._app = app  # type: ignore[attr-defined]
        ready_event.set()
        await stop_event.wait()


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def mcp_app_with_lifespan() -> AsyncGenerator[object]:
    """Session-scoped ASGI app with lifespan started.

    Uses background-task + asyncio.Event pair to ensure lifespan enters and exits
    within the same asyncio task (required by anyio cancel scopes — Deviation 2 in 02-01).
    """
    stop_event: asyncio.Event = asyncio.Event()
    ready_event: asyncio.Event = asyncio.Event()
    task = asyncio.ensure_future(_run_app_lifespan(stop_event, ready_event))
    await ready_event.wait()
    try:
        yield ready_event._app  # type: ignore[attr-defined]
    finally:
        stop_event.set()
        await task


_SECOND_USER_LOGIN = "integration_test_user2"
_SECOND_USER_PASSWORD = "TestPass123!"


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def second_user_credentials(odoo_harness: StartedOdooContainer) -> tuple[str, str]:
    """Create a second Odoo user once per session; return (login, password).

    AUTH-04: needed so test_concurrent_isolation can send two requests with distinct UIDs.
    """
    user_id = await odoo_harness.client.create(
        "res.users",
        {
            "name": "Integration Test User 2",
            "login": _SECOND_USER_LOGIN,
            "password": _SECOND_USER_PASSWORD,
            "groups_id": [(6, 0, [])],
        },
    )
    assert isinstance(user_id, int) and user_id > 0
    return _SECOND_USER_LOGIN, _SECOND_USER_PASSWORD


@pytest.fixture
def mcp_client_factory(mcp_app_with_lifespan: object) -> Callable[..., AsyncClient]:
    """Function-scoped factory: creates an AsyncClient per call with per-user X-Odoo-* headers.

    Returns un-entered AsyncClient instances — callers enter them with ``async with client:``.
    """

    def _make(
        *,
        url: str,
        database: str,
        username: str,
        password: str,
    ) -> AsyncClient:
        return AsyncClient(
            transport=ASGITransport(app=mcp_app_with_lifespan),  # type: ignore[arg-type]
            base_url="http://test",
            headers={
                **STANDARD_MCP_HEADERS,
                "x-odoo-url": url,
                "x-odoo-database": database,
                "x-odoo-username": username,
                "x-odoo-password": password,
            },
        )

    return _make
