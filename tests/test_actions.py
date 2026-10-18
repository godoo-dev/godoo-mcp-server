"""Unit tests for action tool handlers (ACT-01, ERR-01 D-08).

Covers:
  ACT-01a: action_list_actions with fake creds -> OdooError -> isError=True
  ACT-01b: action_execute_action with fake creds -> OdooError -> isError=True
  ACT-01c: both action tool names appear in tools/list response
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, cast

if TYPE_CHECKING:
    from httpx import AsyncClient

_TOOLS_LIST_BODY: dict[str, object] = {
    "jsonrpc": "2.0",
    "method": "tools/list",
    "params": {},
    "id": 99,
}


def _parse_sse_json(text: str) -> dict[str, object]:
    """Parse the JSON payload from an MCP SSE response body.

    MCP Streamable HTTP response format:
      event: message\\r\\ndata: {JSON}\\r\\n\\r\\n
    """
    for line in text.splitlines():
        if line.startswith("data:"):
            return cast("dict[str, object]", json.loads(line[len("data:") :].strip()))
    # Fallback: try parsing directly as JSON (for json_response=True mode)
    return cast("dict[str, object]", json.loads(text))


def _tool_call_body(name: str, arguments: dict[str, object]) -> dict[str, object]:
    return {
        "jsonrpc": "2.0",
        "method": "tools/call",
        "params": {"name": name, "arguments": arguments},
        "id": 1,
    }


async def test_list_actions_odoo_error(mcp_client: AsyncClient) -> None:
    """ACT-01a + ERR-01: action_list_actions with fake creds -> OdooError -> isError=True."""
    body = _tool_call_body("action_list_actions", {})
    resp = await mcp_client.post("/mcp", json=body)
    assert resp.status_code == 200
    result = _parse_sse_json(resp.text).get("result", {})
    assert isinstance(result, dict)
    assert result.get("isError") is True, f"Expected isError=True, got: {result}"


async def test_execute_action_odoo_error(mcp_client: AsyncClient) -> None:
    """ACT-01b + ERR-01: action_execute_action with fake creds -> OdooError -> isError=True."""
    body = _tool_call_body("action_execute_action", {"action_id": 1})
    resp = await mcp_client.post("/mcp", json=body)
    assert resp.status_code == 200
    result = _parse_sse_json(resp.text).get("result", {})
    assert isinstance(result, dict)
    assert result.get("isError") is True, f"Expected isError=True, got: {result}"


async def test_action_tools_in_tools_list(mcp_client: AsyncClient) -> None:
    """ACT-01c: both action tool names appear in the tools/list response."""
    resp = await mcp_client.post("/mcp", json=_TOOLS_LIST_BODY)
    assert resp.status_code == 200
    payload = _parse_sse_json(resp.text)
    result = payload.get("result", {})
    assert isinstance(result, dict)
    tools = result.get("tools", [])
    tool_names = {t["name"] for t in tools if isinstance(t, dict)}
    expected = {"action_list_actions", "action_execute_action"}
    missing = expected - tool_names
    assert not missing, f"Missing action tools in tools/list: {missing}"
