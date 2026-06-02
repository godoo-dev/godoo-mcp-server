"""Unit tests for record operation tools (REC-01..05, ERR-01).

Covers:
  REC-01: record_search with fake creds -> isError=True (OdooAuthError -> ToolError)
  REC-02: record_read with fake creds -> isError=True
  REC-03: record_create with fake creds -> isError=True
  REC-04: record_update with fake creds -> isError=True
  REC-05: record_delete with fake creds -> isError=True
  ERR-01: OdooError -> ToolError -> isError=True MCP response for all record tools;
          error text does not contain traceback (D-08 no-traceback leak)
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from httpx import AsyncClient


def _parse_sse_json(text: str) -> dict[str, object]:
    """Parse the JSON payload from an MCP SSE response body.

    MCP Streamable HTTP response format:
      event: message\r\ndata: {JSON}\r\n\r\n
    """
    for line in text.splitlines():
        if line.startswith("data:"):
            return json.loads(line[len("data:") :].strip())  # type: ignore[return-value]
    # Fallback: try parsing directly as JSON (for json_response=True mode)
    return json.loads(text)  # type: ignore[return-value]


def _tool_call_body(name: str, arguments: dict[str, object]) -> dict[str, object]:
    return {
        "jsonrpc": "2.0",
        "method": "tools/call",
        "params": {"name": name, "arguments": arguments},
        "id": 1,
    }


async def test_search_odoo_error(mcp_client: AsyncClient) -> None:
    """REC-01 + ERR-01: record_search with bad creds -> OdooAuthError -> isError=True."""
    body = _tool_call_body("record_search", {"model": "res.partner"})
    resp = await mcp_client.post("/mcp", json=body)
    assert resp.status_code == 200
    result = _parse_sse_json(resp.text).get("result", {})
    assert isinstance(result, dict)
    assert result.get("isError") is True, f"Expected isError=True, got: {result}"


async def test_read_odoo_error(mcp_client: AsyncClient) -> None:
    """REC-02 + ERR-01: record_read with bad creds -> OdooAuthError -> isError=True."""
    body = _tool_call_body("record_read", {"model": "res.partner", "ids": [1]})
    resp = await mcp_client.post("/mcp", json=body)
    assert resp.status_code == 200
    result = _parse_sse_json(resp.text).get("result", {})
    assert isinstance(result, dict)
    assert result.get("isError") is True, f"Expected isError=True, got: {result}"


async def test_create_odoo_error(mcp_client: AsyncClient) -> None:
    """REC-03 + ERR-01: record_create with bad creds -> OdooAuthError -> isError=True."""
    body = _tool_call_body("record_create", {"model": "res.partner", "values": {"name": "X"}})
    resp = await mcp_client.post("/mcp", json=body)
    assert resp.status_code == 200
    result = _parse_sse_json(resp.text).get("result", {})
    assert isinstance(result, dict)
    assert result.get("isError") is True, f"Expected isError=True, got: {result}"


async def test_update_odoo_error(mcp_client: AsyncClient) -> None:
    """REC-04 + ERR-01: record_update with bad creds -> OdooAuthError -> isError=True."""
    body = _tool_call_body(
        "record_update", {"model": "res.partner", "ids": [1], "values": {"name": "Y"}}
    )
    resp = await mcp_client.post("/mcp", json=body)
    assert resp.status_code == 200
    result = _parse_sse_json(resp.text).get("result", {})
    assert isinstance(result, dict)
    assert result.get("isError") is True, f"Expected isError=True, got: {result}"


async def test_delete_odoo_error(mcp_client: AsyncClient) -> None:
    """REC-05 + ERR-01: record_delete with bad creds -> OdooAuthError -> isError=True."""
    body = _tool_call_body("record_delete", {"model": "res.partner", "ids": [1]})
    resp = await mcp_client.post("/mcp", json=body)
    assert resp.status_code == 200
    result = _parse_sse_json(resp.text).get("result", {})
    assert isinstance(result, dict)
    assert result.get("isError") is True, f"Expected isError=True, got: {result}"


async def test_search_no_traceback(mcp_client: AsyncClient) -> None:
    """ERR-01 D-08: error text from record_search must not contain 'Traceback' string."""
    body = _tool_call_body("record_search", {"model": "res.partner"})
    resp = await mcp_client.post("/mcp", json=body)
    assert resp.status_code == 200
    result = _parse_sse_json(resp.text).get("result", {})
    assert isinstance(result, dict)
    content = result.get("content", [])
    assert len(content) > 0, "Expected error content in response"
    text = content[0].get("text", "") if isinstance(content[0], dict) else ""
    assert isinstance(text, str)
    assert "Traceback" not in text, f"Error text contains 'Traceback': {text}"
