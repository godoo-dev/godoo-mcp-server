"""Unit tests for Streamable HTTP transport and MCP protocol (TRANS-01/02).

Covers:
  TRANS-01: stateless_http=True suppresses Mcp-Session-Id header entirely
  TRANS-02: POST /mcp/ with tools/list returns HTTP 200 with valid MCP response
            and the odoo_whoami tool appears in the tools list
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from httpx import AsyncClient

_TOOLS_LIST_BODY = {"jsonrpc": "2.0", "method": "tools/list", "params": {}, "id": 1}


async def test_no_session_id(mcp_client: AsyncClient) -> None:
    """TRANS-01: stateless_http=True — response must not contain Mcp-Session-Id header."""
    resp = await mcp_client.post("/mcp/", json=_TOOLS_LIST_BODY)
    assert "mcp-session-id" not in resp.headers, (
        f"Unexpected mcp-session-id header found: {resp.headers.get('mcp-session-id')}"
    )


async def test_tools_list_200(mcp_client: AsyncClient) -> None:
    """TRANS-02: POST /mcp/ with tools/list returns HTTP 200."""
    resp = await mcp_client.post("/mcp/", json=_TOOLS_LIST_BODY)
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"


async def test_tools_list_contains_whoami(mcp_client: AsyncClient) -> None:
    """TRANS-02: tools/list response body includes the odoo_whoami tool."""
    resp = await mcp_client.post("/mcp/", json=_TOOLS_LIST_BODY)
    assert resp.status_code == 200

    body = resp.json()
    # MCP response shape: {"result": {"tools": [{"name": "...", ...}, ...]}, ...}
    result = body.get("result", body)
    tools = result.get("tools", [])
    tool_names = [t["name"] for t in tools]
    assert "odoo_whoami" in tool_names, (
        f"odoo_whoami not found in tools list. Available: {tool_names}"
    )


async def test_stateless_no_session_id_repeated(mcp_client: AsyncClient) -> None:
    """TRANS-01: Two consecutive POSTs — neither response contains mcp-session-id."""
    resp1 = await mcp_client.post("/mcp/", json=_TOOLS_LIST_BODY)
    resp2 = await mcp_client.post(
        "/mcp/",
        json={"jsonrpc": "2.0", "method": "tools/list", "params": {}, "id": 2},
    )
    assert "mcp-session-id" not in resp1.headers, "First response has mcp-session-id"
    assert "mcp-session-id" not in resp2.headers, "Second response has mcp-session-id"
