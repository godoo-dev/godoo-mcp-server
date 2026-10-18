"""Session-scoped fixtures for e2e tests (require Docker + claude CLI + real Odoo)."""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import socket
import subprocess
import sys
from typing import TYPE_CHECKING, cast

import httpx
import pytest
import pytest_asyncio

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator
    from pathlib import Path

    from godoo.testcontainers import StartedOdooContainer


def _find_free_port() -> int:
    """Bind to port 0 on loopback to get an OS-assigned ephemeral port."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return cast("int", sock.getsockname()[1])


def _is_claude_available() -> bool:
    """Check claude CLI exists and is runnable — no billable call (D-08)."""
    if shutil.which("claude") is None:
        return False
    try:
        result = subprocess.run(["claude", "--version"], capture_output=True, timeout=5)
        return result.returncode == 0
    except subprocess.TimeoutExpired, OSError:
        return False


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def server_process(odoo_harness: StartedOdooContainer) -> AsyncGenerator[str]:
    """Launch godoo-mcp-server subprocess on an ephemeral loopback port. Yields base_url.

    Credentials are NOT injected into the server env (D-07: credentials come via
    X-Odoo-* headers in the MCP config, not env vars).
    """
    if not _is_claude_available():
        pytest.skip("claude CLI not available — skipping e2e tests (D-08)")
    port = _find_free_port()
    # sys.executable is the venv Python when running under uv run pytest — see RESEARCH.md A5
    proc = await asyncio.create_subprocess_exec(
        sys.executable,
        "-m",
        "godoo_mcp_server",
        env={**os.environ, "HOST": "127.0.0.1", "PORT": str(port)},
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    base_url = f"http://127.0.0.1:{port}"
    # Poll /healthz — unauthenticated; works only after D-06 middleware short-circuit
    async with httpx.AsyncClient() as client:
        deadline = asyncio.get_event_loop().time() + 30.0
        while True:
            try:
                r = await client.get(f"{base_url}/healthz", timeout=2.0)
                if r.status_code == 200:
                    break
            except httpx.ConnectError, httpx.TimeoutException:
                pass
            if asyncio.get_event_loop().time() > deadline:
                proc.terminate()
                raise RuntimeError(f"Server did not start within 30s on port {port}")
            await asyncio.sleep(0.2)
    try:
        yield base_url
    finally:
        proc.terminate()
        try:
            await asyncio.wait_for(proc.wait(), timeout=10.0)
        except TimeoutError:
            proc.kill()


@pytest.fixture
def mcp_config_file(
    tmp_path: Path,
    server_process: str,
    odoo_harness: StartedOdooContainer,
) -> Path:
    """Write temp MCP config JSON file with X-Odoo-* headers (D-07 header path).

    Security note: the password "admin" is the throwaway testcontainers credential —
    not a real secret; tmp_path is auto-cleaned by pytest at session end.
    """
    # Schema verified from ~/.claude.json after 'claude mcp add --transport http'
    # — key is "type" not "transport" (RESEARCH.md Pitfall 1)
    config = {
        "mcpServers": {
            "godoo": {
                "type": "http",
                "url": f"{server_process}/mcp",
                "headers": {
                    "X-Odoo-Url": odoo_harness.url,
                    "X-Odoo-Database": odoo_harness._database,  # type: ignore[attr-defined]
                    "X-Odoo-Username": "admin",
                    "X-Odoo-Password": "admin",
                },
            }
        }
    }
    path = tmp_path / "mcp_config.json"
    path.write_text(json.dumps(config))
    return path
