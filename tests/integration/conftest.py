"""Session-scoped fixtures for integration tests (require Docker + real Odoo)."""

from __future__ import annotations

import asyncio
import os
import socket
import sys
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from functools import partial
from typing import TYPE_CHECKING, Any

import httpx
import pytest
import pytest_asyncio
import uvicorn
from godoo.testcontainers import TestHarness
from httpx import ASGITransport, AsyncClient
from starlette.requests import Request
from starlette.responses import StreamingResponse

from godoo_mcp_server.server import create_app
from tests.odoo_proof import observe, requested_major

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator, Callable
    from pathlib import Path


# Standard MCP headers required for every MCP request.
# Redefined here to avoid conftest import-chain issues — same values as tests/conftest.py.
STANDARD_MCP_HEADERS: dict[str, str] = {
    "content-type": "application/json",
    "accept": "application/json, text/event-stream",
    "mcp-protocol-version": "2026-07-28",
}


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


@pytest.fixture
def mcp_process_factory(tmp_path: Path) -> Callable[..., Any]:
    """Start independent servers, including restarts, with bounded cleanup."""

    @asynccontextmanager
    async def start(
        name: str = "mcp-process",
    ) -> AsyncGenerator[tuple[str, Path, asyncio.subprocess.Process]]:
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = int(listener.getsockname()[1])
        log_path = tmp_path / f"{name}.log"
        with log_path.open("wb") as log_file:
            process = await asyncio.create_subprocess_exec(
                sys.executable,
                "-m",
                "godoo_mcp_server",
                stdout=log_file,
                stderr=log_file,
                env={**os.environ, "HOST": "127.0.0.1", "PORT": str(port)},
            )
            url = f"http://127.0.0.1:{port}"
            try:
                async with AsyncClient(timeout=1) as client:
                    deadline = asyncio.get_running_loop().time() + 30
                    while asyncio.get_running_loop().time() < deadline:
                        if process.returncode is not None:
                            raise AssertionError(log_path.read_text())
                        try:
                            if (await client.get(f"{url}/healthz")).status_code == 200:
                                break
                        except httpx.HTTPError:
                            pass
                        await asyncio.sleep(0.1)
                    else:
                        raise AssertionError(f"MCP health check timed out: {log_path.read_text()}")
                yield url, log_path, process
            finally:
                if process.returncode is None:
                    process.terminate()
                    try:
                        await asyncio.wait_for(process.wait(), timeout=5)
                    except TimeoutError:
                        process.kill()
                        await process.wait()

    return start


@pytest_asyncio.fixture
async def mcp_process(mcp_process_factory: Callable[..., Any]) -> AsyncGenerator[tuple[str, Path]]:
    async with mcp_process_factory() as (url, log_path, _process):
        yield url, log_path


_SECOND_USER_LOGIN = "integration_test_user2"
_SECOND_USER_PASSWORD = "TestPass123!"


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def odoo_harness() -> AsyncGenerator[TestHarness]:
    """Use the selected disposable Odoo major, regardless of library defaults."""
    major = requested_major()
    async with TestHarness(
        modules=["base", "mail", "project"],
        snapshot=False,
        database="test_odoo",
        admin_password="admin",
    ) as harness:
        await observe(harness, major)
        yield harness


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def second_user_credentials(odoo_harness: TestHarness) -> tuple[str, str]:
    """A portal user has deliberately different model ACLs from the administrator."""
    groups = await odoo_harness.client.search_read(
        "ir.model.data",
        [["module", "=", "base"], ["name", "=", "group_portal"]],
        fields=["res_id"],
    )
    # Odoo19 renamed the explicitly assigned group relation; keep the portal ACL
    # fixture equivalent across both observed majors rather than omitting groups.
    group_field = "group_ids" if requested_major() >= 19 else "groups_id"
    user_id = await odoo_harness.client.create(
        "res.users",
        {
            "name": "Integration Portal User",
            "login": _SECOND_USER_LOGIN,
            "password": _SECOND_USER_PASSWORD,
            group_field: [(6, 0, [groups[0]["res_id"]])],
        },
    )
    assert isinstance(user_id, int) and user_id > 0
    return _SECOND_USER_LOGIN, _SECOND_USER_PASSWORD


@pytest.fixture
def mcp_client_factory(mcp_app_with_lifespan: object) -> Callable[..., AsyncClient]:
    """Function-scoped factory: creates an AsyncClient per call with per-user X-Odoo-* headers.

    Returns un-entered AsyncClient instances — callers enter them with ``async with client:``.
    """

    class MCPClient(AsyncClient):
        def build_request(self, method: str, url: Any, **kwargs: Any) -> httpx.Request:
            body = kwargs.get("json")
            if isinstance(body, dict):
                params = body.setdefault("params", {})
                if isinstance(params, dict):
                    params.setdefault(
                        "_meta",
                        {
                            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                            "io.modelcontextprotocol/clientCapabilities": {},
                        },
                    )
                headers = dict(kwargs.pop("headers", {}) or {})
                headers["mcp-method"] = body["method"]
                if body["method"] == "tools/call":
                    headers["mcp-name"] = body["params"]["name"]
                elif body["method"] == "resources/read":
                    headers["mcp-name"] = body["params"]["uri"]
                kwargs["headers"] = headers
            return super().build_request(method, url, **kwargs)

    def _make(
        *,
        url: str,
        database: str,
        username: str,
        password: str,
        server_url: str | None = None,
        timeout: float = 30,
    ) -> AsyncClient:
        return MCPClient(
            transport=None if server_url else ASGITransport(app=mcp_app_with_lifespan),  # type: ignore[arg-type]
            base_url=server_url or "http://test",
            timeout=timeout,
            headers={
                **STANDARD_MCP_HEADERS,
                "x-odoo-url": url,
                "x-odoo-database": database,
                "x-odoo-username": username,
                "x-odoo-password": password,
            },
        )

    return _make


@pytest.fixture
def odoo_clients(mcp_client_factory: Callable[..., AsyncClient], odoo_harness: TestHarness) -> Any:
    return partial(
        mcp_client_factory,
        url=odoo_harness.url,
        database=odoo_harness._database,
        username="admin",
        password="admin",
    )


@pytest_asyncio.fixture(loop_scope="session")
async def odoo_mcp(odoo_clients: Any) -> AsyncGenerator[AsyncClient]:
    async with odoo_clients() as client:
        yield client


@dataclass
class OdooReply:
    """Fault controls for a real committed Odoo write, never a simulated database."""

    url: str = ""
    model: str = "res.partner.category"
    marker: str = field(default_factory=lambda: f"reply-{uuid.uuid4()}")
    drop: bool = False
    writes: int = 0
    ids: list[int] = field(default_factory=list)
    committed: asyncio.Event = field(default_factory=asyncio.Event)
    release: asyncio.Event = field(default_factory=asyncio.Event)
    closed: asyncio.Event = field(default_factory=asyncio.Event)


@pytest_asyncio.fixture(loop_scope="session")
async def odoo_reply(odoo_harness: TestHarness) -> AsyncGenerator[OdooReply]:
    """Let Starlette/uvicorn handle HTTP; delay or truncate just the marked Odoo reply."""
    reply = OdooReply()
    async with AsyncClient(timeout=30) as upstream:

        async def proxy(scope: Any, receive: Any, send: Any) -> None:
            request = await Request(scope, receive).json()
            args = request.get("params", {}).get("args", [])
            marked = args[3:5] == [reply.model, "create"] and args[5][0].get("name") == reply.marker
            if marked:
                reply.writes += 1
            response = await upstream.post(f"{odoo_harness.url}/jsonrpc", json=request)

            async def body() -> AsyncGenerator[bytes]:
                try:
                    if marked:
                        record_id = response.json()["result"]
                        assert isinstance(record_id, int), response.text
                        reply.ids.append(record_id)
                        reply.committed.set()
                        if reply.drop:
                            raise ConnectionResetError("drop committed Odoo reply")
                        await reply.release.wait()
                    yield response.content
                finally:
                    if marked:
                        reply.closed.set()

            await StreamingResponse(
                body(), status_code=response.status_code, media_type="application/json"
            )(scope, receive, send)

        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            reply.url = f"http://127.0.0.1:{listener.getsockname()[1]}"
            server = uvicorn.Server(uvicorn.Config(proxy, lifespan="off", log_level="critical"))
            task = asyncio.create_task(server.serve(sockets=[listener]))
            try:
                async with asyncio.timeout(5):
                    while not server.started:
                        if task.done():
                            await task
                            raise AssertionError("Odoo reply proxy exited before startup")
                        await asyncio.sleep(0.01)
                yield reply
            finally:
                reply.release.set()
                server.should_exit = True
                await asyncio.wait_for(task, timeout=5)
