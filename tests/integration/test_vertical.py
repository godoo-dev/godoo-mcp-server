"""Integration tests for the full vertical slice against a real Odoo container.

Covers:
  TRANS-02 (integration): tools/list + odoo_whoami against live Odoo
  AUTH-04: Two concurrent requests with different credentials see different UIDs

All tests are marked @pytest.mark.integration and are excluded from the default pytest run
(addopts = "-m 'not integration'" in pyproject.toml). Run explicitly with:
    uv run pytest -m integration --tb=short
"""

from __future__ import annotations

import asyncio
import json
from typing import TYPE_CHECKING, Any

import pytest

if TYPE_CHECKING:
    from collections.abc import Callable

    from godoo.testcontainers import StartedOdooContainer

_MCP_PATH = "/mcp"

_TOOLS_LIST_BODY: dict[str, Any] = {
    "jsonrpc": "2.0",
    "method": "tools/list",
    "params": {},
    "id": 1,
}

_WHOAMI_CALL_BODY: dict[str, Any] = {
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {"name": "odoo_whoami", "arguments": {}},
    "id": 2,
}


def _parse_sse_json(text: str) -> dict[str, Any]:
    """Parse JSON payload from an MCP SSE response body.

    MCP Streamable HTTP response format:
      event: message\\r\\ndata: {JSON}\\r\\n\\r\\n
    """
    for line in text.splitlines():
        if line.startswith("data:"):
            return json.loads(line[len("data:"):].strip())  # type: ignore[return-value]
    return json.loads(text)  # type: ignore[return-value]


@pytest.mark.integration
class TestVerticalSlice:
    """Full vertical slice + concurrency isolation tests against real Odoo."""

    async def test_tools_list(
        self,
        mcp_client_factory: Callable[..., Any],
        odoo_harness: StartedOdooContainer,
    ) -> None:
        """TRANS-02: tools/list returns HTTP 200 with valid MCP response against real Odoo."""
        client = mcp_client_factory(
            url=odoo_harness.url,
            database=odoo_harness._database,
            username="admin",
            password="admin",
        )
        async with client:
            resp = await client.post(_MCP_PATH, json=_TOOLS_LIST_BODY)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        body = _parse_sse_json(resp.text)
        result = body.get("result", {})
        tools = result.get("tools", []) if isinstance(result, dict) else []
        tool_names = [t["name"] for t in tools if isinstance(t, dict)]
        assert "odoo_whoami" in tool_names, (
            f"odoo_whoami not in tools list. Available: {tool_names}"
        )

    async def test_full_vertical(
        self,
        mcp_client_factory: Callable[..., Any],
        odoo_harness: StartedOdooContainer,
    ) -> None:
        """TRANS-02: full connect -> tools/list -> tools/call -> real Odoo RPC path."""
        client = mcp_client_factory(
            url=odoo_harness.url,
            database=odoo_harness._database,
            username="admin",
            password="admin",
        )
        async with client:
            resp = await client.post(_MCP_PATH, json=_WHOAMI_CALL_BODY)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        body = _parse_sse_json(resp.text)
        result_text = body["result"]["content"][0]["text"]
        result = json.loads(result_text)
        assert "uid" in result, f"'uid' missing from odoo_whoami response: {result}"
        assert isinstance(result["uid"], int), f"uid is not int: {result['uid']!r}"
        assert result["uid"] > 0, f"uid must be positive, got: {result['uid']}"
        assert "db" in result, f"'db' missing from odoo_whoami response: {result}"

    async def test_concurrent_isolation(
        self,
        mcp_client_factory: Callable[..., Any],
        odoo_harness: StartedOdooContainer,
        second_user_credentials: tuple[str, str],
    ) -> None:
        """AUTH-04: Two concurrent requests with different creds return different UIDs."""
        user2_login, user2_password = second_user_credentials

        async def _call_whoami(username: str, password: str) -> dict[str, Any]:
            client = mcp_client_factory(
                url=odoo_harness.url,
                database=odoo_harness._database,
                username=username,
                password=password,
            )
            async with client:
                resp = await client.post(_MCP_PATH, json=_WHOAMI_CALL_BODY)
            assert resp.status_code == 200, (
                f"whoami failed for {username!r}: {resp.status_code}: {resp.text}"
            )
            body = _parse_sse_json(resp.text)
            result_text = body["result"]["content"][0]["text"]
            return json.loads(result_text)  # type: ignore[return-value]

        results = await asyncio.gather(
            _call_whoami("admin", "admin"),
            _call_whoami(user2_login, user2_password),
        )
        assert results[0]["uid"] != results[1]["uid"], (
            f"Cross-user bleed: both requests returned uid={results[0]['uid']}"
        )
