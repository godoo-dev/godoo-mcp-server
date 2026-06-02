"""Unit tests for discovery tools (DISC-01, DISC-02, ERR-01).

Covers:
  DISC-01: discovery_list_models with fake creds -> isError=True (auth failure -> ToolError)
  DISC-02: discovery_get_fields with fake creds -> isError=True (auth failure -> ToolError)
  ERR-01: no traceback in error text; discovery_list_models and discovery_get_fields in tool list
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from httpx import AsyncClient


def _parse_sse_json(text: str) -> dict[str, object]:
    """Parse the JSON payload from an MCP SSE response body.

    MCP Streamable HTTP response format:
      event: message\\r\\ndata: {JSON}\\r\\n\\r\\n
    """
    for line in text.splitlines():
        if line.startswith("data:"):
            return json.loads(line[len("data:"):].strip())  # type: ignore[return-value]
    # Fallback: try parsing directly as JSON (for json_response=True mode)
    return json.loads(text)  # type: ignore[return-value]


async def test_list_models_odoo_error(mcp_client: AsyncClient) -> None:
    """DISC-01 + ERR-01: bad creds -> isError=True for discovery_list_models."""
    body = {
        "jsonrpc": "2.0",
        "method": "tools/call",
        "params": {"name": "discovery_list_models", "arguments": {}},
        "id": 1,
    }
    resp = await mcp_client.post("/mcp", json=body)
    assert resp.status_code == 200
    result = _parse_sse_json(resp.text).get("result", {})
    assert isinstance(result, dict)
    assert result.get("isError") is True


async def test_get_fields_odoo_error(mcp_client: AsyncClient) -> None:
    """DISC-02 + ERR-01: bad creds -> isError=True for discovery_get_fields."""
    body = {
        "jsonrpc": "2.0",
        "method": "tools/call",
        "params": {"name": "discovery_get_fields", "arguments": {"model": "res.partner"}},
        "id": 1,
    }
    resp = await mcp_client.post("/mcp", json=body)
    assert resp.status_code == 200
    result = _parse_sse_json(resp.text).get("result", {})
    assert isinstance(result, dict)
    assert result.get("isError") is True


async def test_list_models_no_traceback(mcp_client: AsyncClient) -> None:
    """ERR-01: discovery_list_models error text must not contain 'Traceback'."""
    body = {
        "jsonrpc": "2.0",
        "method": "tools/call",
        "params": {"name": "discovery_list_models", "arguments": {}},
        "id": 1,
    }
    resp = await mcp_client.post("/mcp", json=body)
    assert resp.status_code == 200
    result = _parse_sse_json(resp.text).get("result", {})
    assert isinstance(result, dict)
    content = result.get("content", [])
    assert isinstance(content, list)
    if content:
        text = content[0].get("text", "") if isinstance(content[0], dict) else ""
        assert "Traceback" not in text, f"Error text must not leak traceback: {text}"


async def test_discovery_tools_in_tool_list(mcp_client: AsyncClient) -> None:
    """DISC-01 + DISC-02: both discovery tools appear in tools/list response."""
    body = {"jsonrpc": "2.0", "method": "tools/list", "params": {}, "id": 1}
    resp = await mcp_client.post("/mcp", json=body)
    assert resp.status_code == 200
    parsed = _parse_sse_json(resp.text)
    result = parsed.get("result", {})
    tools = result.get("tools", []) if isinstance(result, dict) else []
    tool_names = [t["name"] for t in tools if isinstance(t, dict)]
    assert "discovery_list_models" in tool_names, (
        f"discovery_list_models not found in tools list. Available: {tool_names}"
    )
    assert "discovery_get_fields" in tool_names, (
        f"discovery_get_fields not found in tools list. Available: {tool_names}"
    )
