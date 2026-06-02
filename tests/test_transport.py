"""Unit tests for Streamable HTTP transport and MCP protocol (TRANS-01/02).

Covers:
  TRANS-01: stateless_http=True suppresses Mcp-Session-Id header entirely
  TRANS-02: POST /mcp/ with tools/list returns HTTP 200 with valid MCP response
            and the odoo_whoami tool appears in the tools list

Note on response format: MCP Streamable HTTP always returns text/event-stream (SSE) format
when the client accepts both application/json and text/event-stream (as required by the protocol).
The response body is: "event: message\r\ndata: {JSON}\r\n\r\n"
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from httpx import AsyncClient

_TOOLS_LIST_BODY = {"jsonrpc": "2.0", "method": "tools/list", "params": {}, "id": 1}


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


async def test_no_session_id(mcp_client: AsyncClient) -> None:
    """TRANS-01: stateless_http=True — response must not contain Mcp-Session-Id header."""
    resp = await mcp_client.post("/mcp", json=_TOOLS_LIST_BODY)
    assert "mcp-session-id" not in resp.headers, (
        f"Unexpected mcp-session-id header found: {resp.headers.get('mcp-session-id')}"
    )


async def test_tools_list_200(mcp_client: AsyncClient) -> None:
    """TRANS-02: POST /mcp with tools/list returns HTTP 200."""
    resp = await mcp_client.post("/mcp", json=_TOOLS_LIST_BODY)
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"


async def test_tools_list_contains_whoami(mcp_client: AsyncClient) -> None:
    """TRANS-02: tools/list response body includes the odoo_whoami tool."""
    resp = await mcp_client.post("/mcp", json=_TOOLS_LIST_BODY)
    assert resp.status_code == 200

    # MCP Streamable HTTP returns SSE format: "event: message\r\ndata: {JSON}\r\n\r\n"
    body = _parse_sse_json(resp.text)
    # MCP JSON-RPC response shape: {"jsonrpc": "2.0", "id": 1, "result": {"tools": [...]}}
    result = body.get("result", {})
    tools = result.get("tools", []) if isinstance(result, dict) else []
    tool_names = [t["name"] for t in tools if isinstance(t, dict)]
    assert "odoo_whoami" in tool_names, (
        f"odoo_whoami not found in tools list. Available: {tool_names}"
    )


async def test_stateless_no_session_id_repeated(mcp_client: AsyncClient) -> None:
    """TRANS-01: Two consecutive POSTs — neither response contains mcp-session-id."""
    resp1 = await mcp_client.post("/mcp", json=_TOOLS_LIST_BODY)
    resp2 = await mcp_client.post(
        "/mcp",
        json={"jsonrpc": "2.0", "method": "tools/list", "params": {}, "id": 2},
    )
    assert "mcp-session-id" not in resp1.headers, "First response has mcp-session-id"
    assert "mcp-session-id" not in resp2.headers, "Second response has mcp-session-id"
