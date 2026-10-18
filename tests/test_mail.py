"""Unit tests for mail/chatter tool handlers (MAIL-01, ERR-01 D-08).

Covers:
  MAIL-01a: mail_post_message with fake creds -> OdooError -> isError=True
  MAIL-01b: mail_log_note with fake creds -> OdooError -> isError=True
  MAIL-01c: mail_list_messages with fake creds -> OdooError -> isError=True
  MAIL-01d: mail_schedule_activity with fake creds -> OdooError -> isError=True
  MAIL-01e: mail_list_activities with fake creds -> OdooError -> isError=True
  MAIL-01f: mail_mark_activity_done with fake creds -> OdooError -> isError=True
  ERR-01 D-08: error text from mail_post_message must not contain 'Traceback'
  MAIL-01g: all 6 mail tool names appear in tools/list response
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
      event: message\r\ndata: {JSON}\r\n\r\n
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


async def test_post_message_odoo_error(mcp_client: AsyncClient) -> None:
    """MAIL-01a + ERR-01: mail_post_message with fake creds -> OdooError -> isError=True."""
    body = _tool_call_body(
        "mail_post_message",
        {"model": "res.partner", "res_id": 1, "body": "Hi"},
    )
    resp = await mcp_client.post("/mcp", json=body)
    assert resp.status_code == 200
    result = _parse_sse_json(resp.text).get("result", {})
    assert isinstance(result, dict)
    assert result.get("isError") is True, f"Expected isError=True, got: {result}"


async def test_log_note_odoo_error(mcp_client: AsyncClient) -> None:
    """MAIL-01b + ERR-01: mail_log_note with fake creds -> OdooError -> isError=True."""
    body = _tool_call_body(
        "mail_log_note",
        {"model": "res.partner", "res_id": 1, "body": "Internal note"},
    )
    resp = await mcp_client.post("/mcp", json=body)
    assert resp.status_code == 200
    result = _parse_sse_json(resp.text).get("result", {})
    assert isinstance(result, dict)
    assert result.get("isError") is True, f"Expected isError=True, got: {result}"


async def test_list_messages_odoo_error(mcp_client: AsyncClient) -> None:
    """MAIL-01c + ERR-01: mail_list_messages with fake creds -> OdooError -> isError=True."""
    body = _tool_call_body(
        "mail_list_messages",
        {"model": "res.partner", "res_id": 1},
    )
    resp = await mcp_client.post("/mcp", json=body)
    assert resp.status_code == 200
    result = _parse_sse_json(resp.text).get("result", {})
    assert isinstance(result, dict)
    assert result.get("isError") is True, f"Expected isError=True, got: {result}"


async def test_schedule_activity_odoo_error(mcp_client: AsyncClient) -> None:
    """MAIL-01d + ERR-01: mail_schedule_activity with fake creds -> OdooError -> isError=True."""
    body = _tool_call_body(
        "mail_schedule_activity",
        {
            "model": "res.partner",
            "res_id": 1,
            "activity_type_id": 1,
            "date_deadline": "2026-12-31",
        },
    )
    resp = await mcp_client.post("/mcp", json=body)
    assert resp.status_code == 200
    result = _parse_sse_json(resp.text).get("result", {})
    assert isinstance(result, dict)
    assert result.get("isError") is True, f"Expected isError=True, got: {result}"


async def test_list_activities_odoo_error(mcp_client: AsyncClient) -> None:
    """MAIL-01e + ERR-01: mail_list_activities with fake creds -> OdooError -> isError=True."""
    body = _tool_call_body(
        "mail_list_activities",
        {"model": "res.partner", "res_id": 1},
    )
    resp = await mcp_client.post("/mcp", json=body)
    assert resp.status_code == 200
    result = _parse_sse_json(resp.text).get("result", {})
    assert isinstance(result, dict)
    assert result.get("isError") is True, f"Expected isError=True, got: {result}"


async def test_mark_activity_done_odoo_error(mcp_client: AsyncClient) -> None:
    """MAIL-01f + ERR-01: mail_mark_activity_done with fake creds -> OdooError -> isError=True."""
    body = _tool_call_body(
        "mail_mark_activity_done",
        {"activity_id": 1},
    )
    resp = await mcp_client.post("/mcp", json=body)
    assert resp.status_code == 200
    result = _parse_sse_json(resp.text).get("result", {})
    assert isinstance(result, dict)
    assert result.get("isError") is True, f"Expected isError=True, got: {result}"


async def test_post_message_no_traceback(mcp_client: AsyncClient) -> None:
    """ERR-01 D-08: error text from mail_post_message must not contain 'Traceback' string."""
    body = _tool_call_body(
        "mail_post_message",
        {"model": "res.partner", "res_id": 1, "body": "Hi"},
    )
    resp = await mcp_client.post("/mcp", json=body)
    assert resp.status_code == 200
    result = _parse_sse_json(resp.text).get("result", {})
    assert isinstance(result, dict)
    content = result.get("content", [])
    assert len(content) > 0, "Expected error content in response"
    text = content[0].get("text", "") if isinstance(content[0], dict) else ""
    assert isinstance(text, str)
    assert "Traceback" not in text, f"Error text contains 'Traceback': {text}"


async def test_mail_tools_in_tools_list(mcp_client: AsyncClient) -> None:
    """MAIL-01g: all 6 mail tool names appear in the tools/list response."""
    resp = await mcp_client.post("/mcp", json=_TOOLS_LIST_BODY)
    assert resp.status_code == 200
    payload = _parse_sse_json(resp.text)
    result = payload.get("result", {})
    assert isinstance(result, dict)
    tools = result.get("tools", [])
    tool_names = {t["name"] for t in tools if isinstance(t, dict)}
    expected = {
        "mail_post_message",
        "mail_log_note",
        "mail_list_messages",
        "mail_schedule_activity",
        "mail_list_activities",
        "mail_mark_activity_done",
    }
    missing = expected - tool_names
    assert not missing, f"Missing mail tools in tools/list: {missing}"
