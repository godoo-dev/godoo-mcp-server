"""Unit tests for users_whoami tool (USER-01, ERR-01).

Covers:
  USER-01: users_whoami returns uid + username + database from a fake-creds MCP call
  ERR-01 (whoami path): OdooAuthError on bad credentials → isError=True response
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

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
            return json.loads(line[len("data:") :].strip())  # type: ignore[return-value]
    return json.loads(text)  # type: ignore[return-value]


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
    assert isinstance(content[0].get("text"), str)  # type: ignore[union-attr]


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
    text = content[0].get("text", "")  # type: ignore[union-attr]
    assert isinstance(text, str)
    assert "Traceback" not in text, f"Traceback found in error text: {text}"


async def test_users_whoami_in_tool_list(mcp_client: AsyncClient) -> None:
    """USER-01: users_whoami must appear in the tools/list response."""
    resp = await mcp_client.post("/mcp", json=_TOOLS_LIST_BODY)
    assert resp.status_code == 200
    body = _parse_sse_json(resp.text)
    result = body.get("result", {})
    tools = result.get("tools", []) if isinstance(result, dict) else []  # type: ignore[union-attr]
    assert isinstance(tools, list)
    tool_names = [t["name"] for t in tools if isinstance(t, dict)]
    assert "users_whoami" in tool_names, (
        f"users_whoami not found in tools list. Available: {tool_names}"
    )
