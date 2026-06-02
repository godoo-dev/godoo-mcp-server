"""Unit tests for users_whoami tool (USER-01, ERR-01).

Covers:
  USER-01: users_whoami returns uid + username + database from a fake-creds MCP call
  ERR-01 (whoami path): OdooAuthError on bad credentials → isError=True response
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, cast

if TYPE_CHECKING:
    from httpx import AsyncClient

_WHOAMI_CALL_BODY: dict[str, object] = {
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {"name": "users_whoami", "arguments": {}},
    "id": 1,
}

_TOOLS_LIST_BODY: dict[str, object] = {
    "jsonrpc": "2.0",
    "method": "tools/list",
    "params": {},
    "id": 1,
}


def _parse_sse_json(text: str) -> dict[str, object]:
    """Parse the JSON payload from an MCP SSE response body.

    MCP Streamable HTTP response format:
      event: message\\r\\ndata: {JSON}\\r\\n\\r\\n
    """
    for line in text.splitlines():
        if line.startswith("data:"):
            return cast(dict[str, object], json.loads(line[len("data:") :].strip()))
    return cast(dict[str, object], json.loads(text))


async def test_whoami_error_on_bad_creds(mcp_client: AsyncClient) -> None:
    """USER-01 + ERR-01: fake credentials → OdooAuthError → isError=True MCP response."""
    resp = await mcp_client.post("/mcp", json=_WHOAMI_CALL_BODY)
    assert resp.status_code == 200  # MCP transport always 200
    body = _parse_sse_json(resp.text)
    result = body.get("result", {})
    assert isinstance(result, dict)
    assert result.get("isError") is True, f"Expected isError=True, got: {result}"
    content = result.get("content", [])
    assert isinstance(content, list)
    assert len(content) > 0
    first = content[0]
    assert isinstance(first, dict)
    assert isinstance(first.get("text"), str)


async def test_whoami_no_traceback_in_error(mcp_client: AsyncClient) -> None:
    """ERR-01: error text must not contain a Python traceback (D-08 sanitization)."""
    resp = await mcp_client.post("/mcp", json=_WHOAMI_CALL_BODY)
    assert resp.status_code == 200
    body = _parse_sse_json(resp.text)
    result = body.get("result", {})
    assert isinstance(result, dict)
    content = result.get("content", [])
    assert isinstance(content, list)
    assert len(content) > 0
    first = content[0]
    assert isinstance(first, dict)
    text = first.get("text", "")
    assert isinstance(text, str)
    assert "Traceback" not in text, f"Traceback found in error text: {text}"


async def test_users_whoami_in_tool_list(mcp_client: AsyncClient) -> None:
    """USER-01: users_whoami must appear in the tools/list response."""
    resp = await mcp_client.post("/mcp", json=_TOOLS_LIST_BODY)
    assert resp.status_code == 200
    body = _parse_sse_json(resp.text)
    result = body.get("result", {})
    tools = result.get("tools", []) if isinstance(result, dict) else []
    assert isinstance(tools, list)
    tool_names = [t["name"] for t in tools if isinstance(t, dict)]
    assert "users_whoami" in tool_names, (
        f"users_whoami not found in tools list. Available: {tool_names}"
    )


async def test_search_users_odoo_error(mcp_client: AsyncClient) -> None:
    """USER-02 + ERR-01: fake credentials -> OdooAuthError -> isError=True for users_search_users."""
    body = {
        "jsonrpc": "2.0",
        "method": "tools/call",
        "params": {"name": "users_search_users", "arguments": {}},
        "id": 1,
    }
    resp = await mcp_client.post("/mcp", json=body)
    assert resp.status_code == 200
    result = _parse_sse_json(resp.text).get("result", {})
    assert isinstance(result, dict)
    assert result.get("isError") is True, f"Expected isError=True, got: {result}"
    content = result.get("content", [])
    assert isinstance(content, list)
    if content:
        first = content[0]
        text = first.get("text", "") if isinstance(first, dict) else ""
        assert isinstance(text, str)
        assert "Traceback" not in text, f"Error text must not leak traceback: {text}"


async def test_search_users_in_tools_list(mcp_client: AsyncClient) -> None:
    """USER-02: users_search_users must appear in tools/list response."""
    resp = await mcp_client.post("/mcp", json=_TOOLS_LIST_BODY)
    assert resp.status_code == 200
    body = _parse_sse_json(resp.text)
    result = body.get("result", {})
    tools = result.get("tools", []) if isinstance(result, dict) else []
    assert isinstance(tools, list)
    tool_names = [t["name"] for t in tools if isinstance(t, dict)]
    assert "users_search_users" in tool_names, (
        f"users_search_users not found in tools list. Available: {tool_names}"
    )
