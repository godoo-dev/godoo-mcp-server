"""Unit tests for attachment tool handlers (ATT-01, ERR-01 D-08).

Covers:
  ATT-01a: attachments_list with fake creds -> OdooError -> isError=True
  ATT-01b: attachments_upload with fake creds -> OdooError -> isError=True
  ATT-01c: attachments_download with fake creds -> OdooError -> isError=True
  ATT-01d: all 3 attachment tool names appear in tools/list response
  ERR-01 D-08: error text from attachments_download must not contain 'Traceback'
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


async def test_attachments_list_odoo_error(mcp_client: AsyncClient) -> None:
    """ATT-01a + ERR-01: attachments_list with fake creds -> OdooError -> isError=True."""
    body = _tool_call_body("attachments_list", {})
    resp = await mcp_client.post("/mcp", json=body)
    assert resp.status_code == 200
    result = _parse_sse_json(resp.text).get("result", {})
    assert isinstance(result, dict)
    assert result.get("isError") is True, f"Expected isError=True, got: {result}"


async def test_attachments_upload_odoo_error(mcp_client: AsyncClient) -> None:
    """ATT-01b + ERR-01: attachments_upload with fake creds -> OdooError -> isError=True."""
    body = _tool_call_body(
        "attachments_upload",
        {
            "name": "test.txt",
            "content_base64": "dGVzdA==",
            "res_model": "res.partner",
            "res_id": 1,
        },
    )
    resp = await mcp_client.post("/mcp", json=body)
    assert resp.status_code == 200
    result = _parse_sse_json(resp.text).get("result", {})
    assert isinstance(result, dict)
    assert result.get("isError") is True, f"Expected isError=True, got: {result}"


async def test_attachments_download_odoo_error(mcp_client: AsyncClient) -> None:
    """ATT-01c + ERR-01: attachments_download with fake creds -> OdooError -> isError=True."""
    body = _tool_call_body("attachments_download", {"attachment_id": 1})
    resp = await mcp_client.post("/mcp", json=body)
    assert resp.status_code == 200
    result = _parse_sse_json(resp.text).get("result", {})
    assert isinstance(result, dict)
    assert result.get("isError") is True, f"Expected isError=True, got: {result}"


async def test_attachment_tools_in_tools_list(mcp_client: AsyncClient) -> None:
    """ATT-01d: all 3 attachment tool names appear in the tools/list response."""
    resp = await mcp_client.post("/mcp", json=_TOOLS_LIST_BODY)
    assert resp.status_code == 200
    payload = _parse_sse_json(resp.text)
    result = payload.get("result", {})
    assert isinstance(result, dict)
    tools = result.get("tools", [])
    tool_names = {t["name"] for t in tools if isinstance(t, dict)}
    expected = {"attachments_list", "attachments_upload", "attachments_download"}
    missing = expected - tool_names
    assert not missing, f"Missing attachment tools in tools/list: {missing}"


async def test_no_traceback_attachments_download(mcp_client: AsyncClient) -> None:
    """ERR-01 D-08: error text from attachments_download must not contain 'Traceback'."""
    body = _tool_call_body("attachments_download", {"attachment_id": 1})
    resp = await mcp_client.post("/mcp", json=body)
    assert resp.status_code == 200
    result = _parse_sse_json(resp.text).get("result", {})
    assert isinstance(result, dict)
    content = result.get("content", [])
    assert len(content) > 0, "Expected error content in response"
    text = content[0].get("text", "") if isinstance(content[0], dict) else ""
    assert isinstance(text, str)
    assert "Traceback" not in text, f"Error text contains 'Traceback': {text}"
