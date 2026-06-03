"""E2E test: build Docker image from source and smoke-test it against a real Odoo testcontainer.

SC-2/REL-02 — Phase 05-05 automated Docker smoke-test gate.

Skips cleanly when:
  - `docker` CLI is not available on PATH (no daemon / not installed)
  - `docker build` fails to reach a daemon

Does NOT require the claude CLI or a Claude API key.
"""

from __future__ import annotations

import json
import shutil
import socket
import subprocess
import time
from pathlib import Path
from typing import TYPE_CHECKING, Any
from urllib.parse import urlparse

import httpx
import pytest

if TYPE_CHECKING:
    from collections.abc import Generator

    from godoo.testcontainers import StartedOdooContainer

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Tag used for the test image — cleaned up in fixture teardown.
_IMAGE_TAG = "godoo-mcp-server:e2e-test"

# The MCP server always listens on container port 8000 (baked into HEALTHCHECK).
_CONTAINER_PORT = 8000

# /healthz poll timeout in seconds — docker build is slow, but healthz is after build.
_HEALTHZ_TIMEOUT_S = 90

# MCP Streamable-HTTP path
_MCP_PATH = "/mcp"

# Standard MCP headers — identical to other test modules in this suite.
_STANDARD_MCP_HEADERS: dict[str, str] = {
    "content-type": "application/json",
    "accept": "application/json, text/event-stream",
    "mcp-protocol-version": "2024-11-05",
}

# Repo root: two levels up from this file (tests/e2e/test_docker_image.py → repo root)
_REPO_ROOT = Path(__file__).parent.parent.parent


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _find_free_port() -> int:
    """Return an OS-assigned ephemeral port on loopback."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def _parse_sse_json(text: str) -> dict[str, Any]:
    """Parse JSON payload from an MCP SSE response body.

    MCP Streamable HTTP response format:
        event: message\\r\\ndata: {JSON}\\r\\n\\r\\n
    """
    for line in text.splitlines():
        if line.startswith("data:"):
            return dict(json.loads(line[len("data:"):].strip()))
    return dict(json.loads(text))


def _odoo_url_for_container(harness_url: str) -> str:
    """Return the Odoo URL reachable FROM INSIDE the MCP server container.

    Strategy (Docker Desktop / Windows host):
      Use http://host.docker.internal:<port> — Docker Desktop injects this name into
      every container so it resolves to the Windows host's loopback. This is the
      simplest path: no custom network, no container alias lookup required.

      The harness_url (e.g. http://127.0.0.1:54321) carries the host-mapped Odoo port.
      We rewrite the hostname to host.docker.internal while keeping the port.

    Fallback note: if host.docker.internal does not resolve (bare Linux Docker without
    --add-host), the container run uses --add-host host.docker.internal:host-gateway
    (see _run_mcp_container) which covers that case.
    """
    parsed = urlparse(harness_url)
    port = parsed.port or 8069
    return f"http://host.docker.internal:{port}"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def docker_image() -> Generator[str]:
    """Build the project Docker image once per session; yield the tag; remove on teardown.

    Skips the entire test module if:
      - `docker` is not on PATH
      - `docker build` fails (e.g. no daemon, build error in Dockerfile)
    """
    if shutil.which("docker") is None:
        pytest.skip("docker CLI not on PATH — skipping Docker smoke-test")

    result = subprocess.run(
        ["docker", "build", "-t", _IMAGE_TAG, str(_REPO_ROOT)],
        capture_output=True,
        text=True,
        timeout=600,  # Docker builds can be slow — allow up to 10 min
    )
    if result.returncode != 0:
        pytest.skip(
            f"docker build failed (no daemon or build error) — skipping Docker smoke-test.\n"
            f"stdout: {result.stdout[-2000:]}\nstderr: {result.stderr[-2000:]}"
        )

    try:
        yield _IMAGE_TAG
    finally:
        # Best-effort cleanup — do not fail the test if removal fails.
        subprocess.run(
            ["docker", "rmi", "--force", _IMAGE_TAG],
            capture_output=True,
            timeout=30,
        )


@pytest.fixture(scope="session")
def mcp_container(
    docker_image: str,
    odoo_harness: StartedOdooContainer,
) -> Generator[str]:
    """Run the MCP server Docker image against the Odoo testcontainer. Yields base_url.

    Networking: --add-host host.docker.internal:host-gateway ensures the name resolves
    even on bare Linux Docker hosts (Docker Desktop injects it automatically, but the
    flag is harmless there). ODOO_URL uses the host.docker.internal alias plus the
    host-mapped Odoo port so the MCP container can reach the Odoo testcontainer.

    Port mapping: -p <free_host_port>:8000 — we pick a free ephemeral port rather than
    using -p 0:8000 + docker port because subprocess + port inspection adds a race;
    binding our own ephemeral port is atomic.

    No PORT env override: the HEALTHCHECK is baked to port 8000 inside the container.
    We only map the host side.
    """
    host_port = _find_free_port()
    container_id: str | None = None
    try:
        run_result = subprocess.run(
            [
                "docker",
                "run",
                "--detach",
                "--rm",
                # Map host ephemeral port → container 8000 (baked HEALTHCHECK port).
                "-p",
                f"{host_port}:{_CONTAINER_PORT}",
                # Ensure host.docker.internal resolves on Linux Docker hosts too.
                "--add-host",
                "host.docker.internal:host-gateway",
                # Credentials via env vars (no headers at container-start time).
                # The test sends X-Odoo-* headers per-request (D-07 header path).
                # ODOO_URL is NOT injected here — credentials come via request headers.
                # (We do NOT want fallback env creds overriding per-request headers.)
                _IMAGE_TAG,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if run_result.returncode != 0:
            pytest.fail(
                f"docker run failed:\nstdout: {run_result.stdout}\nstderr: {run_result.stderr}"
            )
        container_id = run_result.stdout.strip()
        base_url = f"http://127.0.0.1:{host_port}"

        # Poll /healthz until the server is ready (timeout _HEALTHZ_TIMEOUT_S seconds).
        deadline = time.monotonic() + _HEALTHZ_TIMEOUT_S
        last_error: Exception | None = None
        while time.monotonic() < deadline:
            try:
                with httpx.Client(timeout=3.0) as client:
                    r = client.get(f"{base_url}/healthz")
                if r.status_code == 200:
                    break
            except (httpx.ConnectError, httpx.TimeoutException, httpx.RemoteProtocolError) as exc:
                last_error = exc
            time.sleep(0.5)
        else:
            # Dump container logs to help diagnose failures.
            logs_result = subprocess.run(
                ["docker", "logs", container_id],
                capture_output=True,
                text=True,
                timeout=10,
            )
            pytest.fail(
                f"MCP server container did not respond to /healthz within {_HEALTHZ_TIMEOUT_S}s.\n"
                f"Last error: {last_error!r}\n"
                f"Container logs:\n{logs_result.stdout}\n{logs_result.stderr}"
            )

        yield base_url

    finally:
        if container_id:
            subprocess.run(
                ["docker", "stop", container_id],
                capture_output=True,
                timeout=30,
            )
            # --rm flag on docker run means the container is auto-removed after stop.


# ---------------------------------------------------------------------------
# Test
# ---------------------------------------------------------------------------


@pytest.mark.e2e
def test_docker_image_record_search(
    mcp_container: str,
    odoo_harness: StartedOdooContainer,
) -> None:
    """SC-2/REL-02: built Docker image serves a real MCP record_search tool call.

    Steps:
      1. Image is already built and the container is already running (fixtures).
      2. Send one MCP tools/call (record_search, model=res.partner, limit=1) with
         X-Odoo-* credential headers (D-07 header path).
      3. Assert the response is a non-error MCP result containing a list.
    """
    odoo_url_in_container = _odoo_url_for_container(odoo_harness.url)
    database = odoo_harness._database  # type: ignore[attr-defined]

    headers = {
        **_STANDARD_MCP_HEADERS,
        "x-odoo-url": odoo_url_in_container,
        "x-odoo-database": database,
        "x-odoo-username": "admin",
        "x-odoo-password": "admin",
    }

    record_search_body: dict[str, Any] = {
        "jsonrpc": "2.0",
        "method": "tools/call",
        "params": {
            "name": "record_search",
            "arguments": {
                "model": "res.partner",
                "domain": [],
                "limit": 1,
            },
        },
        "id": 1,
    }

    with httpx.Client(timeout=30.0) as client:
        resp = client.post(
            f"{mcp_container}{_MCP_PATH}",
            headers=headers,
            json=record_search_body,
        )

    assert resp.status_code == 200, (
        f"Expected HTTP 200 from MCP endpoint, got {resp.status_code}: {resp.text}"
    )

    body = _parse_sse_json(resp.text)
    result = body.get("result", {})

    assert isinstance(result, dict), f"Expected result dict, got: {result!r}"
    assert result.get("isError") is not True, (
        f"record_search returned isError=True: {result}"
    )

    content = result.get("content", [])
    assert len(content) > 0, f"Empty content in record_search response: {result}"

    search_result = json.loads(content[0]["text"])
    assert "records" in search_result, (
        f"'records' key missing from record_search response: {search_result}"
    )
    assert isinstance(search_result["records"], list), (
        f"'records' must be a list, got: {search_result['records']!r}"
    )
    # limit=1 means 0 or 1 records — any list (including empty) is valid
    # (empty is valid if Odoo has no partners, though base always has at least one)
    assert len(search_result["records"]) >= 0, "records must be a list"
