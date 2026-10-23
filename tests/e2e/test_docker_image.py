"""Exercise an exact prebuilt candidate image against observed disposable Odoo18.

The caller owns the candidate image. This fixture never rebuilds or deletes it.
Missing Docker or a candidate fails; billable Claude is not involved.
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import time
from typing import TYPE_CHECKING, Any
from urllib.parse import urlparse

import httpx
import pytest

if TYPE_CHECKING:
    from collections.abc import Generator

    from godoo.testcontainers import TestHarness

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

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
    "mcp-protocol-version": "2026-07-28",
    "mcp-method": "tools/call",
    "mcp-name": "record_search",
}


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
            return dict(json.loads(line[len("data:") :].strip()))
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
def docker_image() -> str:
    """Require a prebuilt image, retaining all caller-owned images after the test."""
    if shutil.which("docker") is None:
        pytest.fail("docker CLI is required")
    subprocess.run(["docker", "info"], check=True, capture_output=True, timeout=30)
    image = os.environ.get("MCP_CANDIDATE_IMAGE")
    if not image:
        pytest.fail("MCP_CANDIDATE_IMAGE must identify the prebuilt candidate")
    identity = subprocess.check_output(
        ["docker", "image", "inspect", "--format", "{{.Id}}", image], text=True
    ).strip()
    # Resolve tags before starting any process; the container consumes this exact ID.
    return identity


@pytest.fixture(scope="session")
def mcp_container(
    docker_image: str,
    odoo_harness: TestHarness,
) -> Generator[str]:
    """Run the MCP server Docker image against the Odoo testcontainer. Yields base_url.

    Networking: --add-host host.docker.internal:host-gateway ensures the name resolves
    even on bare Linux Docker hosts (Docker Desktop injects it automatically, but the
    flag is harmless there). ODOO_URL uses the host.docker.internal alias plus the
    host-mapped Odoo port so the MCP container can reach the Odoo testcontainer.

    Port mapping: -p <free_host_port>:8000 — we pick a free ephemeral port rather than
    using -p 0:8000 + docker port because subprocess + port inspection adds a race;
    the port is selected per invocation. Docker bind failures fail the test.

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
                f"127.0.0.1:{host_port}:{_CONTAINER_PORT}",
                # Ensure host.docker.internal resolves on Linux Docker hosts too.
                "--add-host",
                "host.docker.internal:host-gateway",
                # Credentials via env vars (no headers at container-start time).
                # The test sends X-Odoo-* headers per-request (D-07 header path).
                # ODOO_URL is NOT injected here — credentials come via request headers.
                # (We do NOT want fallback env creds overriding per-request headers.)
                docker_image,
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
        identity = subprocess.check_output(
            ["docker", "inspect", "--format", "{{.Image}}", container_id], text=True
        ).strip()
        assert identity == docker_image
        runtime_user = subprocess.check_output(
            ["docker", "exec", container_id, "id", "-u"], text=True
        ).strip()
        assert runtime_user != "0"
        expected = os.environ["MCP_EXPECTED_VERSION"]
        installed = subprocess.check_output(
            ["docker", "exec", container_id, "godoo-mcp-server", "--version"], text=True
        ).strip()
        assert installed == f"godoo-mcp-server {expected}"
        print(
            "TESTED_IMAGE",
            json.dumps(
                {
                    "id": identity,
                    "container_id": container_id,
                    "user": runtime_user,
                    "version": expected,
                }
            ),
        )
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
            except httpx.TransportError as exc:
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
    odoo_harness: TestHarness,
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
            "_meta": {
                "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                "io.modelcontextprotocol/clientCapabilities": {},
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
    assert result.get("isError") is not True, f"record_search returned isError=True: {result}"

    content = result.get("content", [])
    assert len(content) > 0, f"Empty content in record_search response: {result}"

    search_result = json.loads(content[0]["text"])
    assert "records" in search_result, (
        f"'records' key missing from record_search response: {search_result}"
    )
    assert isinstance(search_result["records"], list), (
        f"'records' must be a list, got: {search_result['records']!r}"
    )
    assert len(search_result["records"]) == 1, "base module must provide a real partner"
