"""Unit tests for Streamable HTTP transport and MCP protocol (TRANS-01/02).

Covers:
  TRANS-01: stateless_http=True suppresses Mcp-Session-Id header entirely
  TRANS-02: POST /mcp/ with tools/list returns HTTP 200 with valid MCP response
            and the users_whoami tool appears in the tools list

Note on response format: MCP Streamable HTTP always returns text/event-stream (SSE) format
when the client accepts both application/json and text/event-stream (as required by the protocol).
The response body is: "event: message\r\ndata: {JSON}\r\n\r\n"
"""

from __future__ import annotations

import json
import logging
from types import SimpleNamespace

import pytest
from fastmcp.exceptions import ToolError
from httpx import AsyncClient

from godoo_mcp_server.odoo_runtime import ClassifiedToolError
from godoo_mcp_server.server import ToolTelemetryMiddleware

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
    """TRANS-02: tools/list response body includes the users_whoami tool."""
    resp = await mcp_client.post("/mcp", json=_TOOLS_LIST_BODY)
    assert resp.status_code == 200

    # MCP Streamable HTTP returns SSE format: "event: message\r\ndata: {JSON}\r\n\r\n"
    body = _parse_sse_json(resp.text)
    # MCP JSON-RPC response shape: {"jsonrpc": "2.0", "id": 1, "result": {"tools": [...]}}
    result = body.get("result", {})
    tools = result.get("tools", []) if isinstance(result, dict) else []
    tool_names = [t["name"] for t in tools if isinstance(t, dict)]
    assert "users_whoami" in tool_names, (
        f"users_whoami not found in tools list. Available: {tool_names}"
    )


async def test_server_discover_reports_fixed_capabilities(mcp_client: AsyncClient) -> None:
    response = await AsyncClient.post(
        mcp_client,
        "/mcp",
        json={
            "jsonrpc": "2.0",
            "method": "server/discover",
            "params": {
                "_meta": {
                    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                    "io.modelcontextprotocol/clientCapabilities": {},
                }
            },
            "id": 2,
        },
        headers={"mcp-method": "server/discover"},
    )
    assert response.status_code == 200, response.text
    result = _parse_sse_json(response.text)["result"]
    assert isinstance(result, dict)
    assert result["supportedVersions"] == ["2026-07-28"]
    assert result["capabilities"]["resources"] == {"subscribe": False, "listChanged": False}
    assert result["capabilities"]["tools"]["listChanged"] is False


async def test_stateless_no_session_id_repeated(mcp_client: AsyncClient) -> None:
    """TRANS-01: Two consecutive POSTs — neither response contains mcp-session-id."""
    resp1 = await mcp_client.post("/mcp", json=_TOOLS_LIST_BODY)
    resp2 = await mcp_client.post(
        "/mcp",
        json={"jsonrpc": "2.0", "method": "tools/list", "params": {}, "id": 2},
    )
    assert "mcp-session-id" not in resp1.headers, "First response has mcp-session-id"
    assert "mcp-session-id" not in resp2.headers, "Second response has mcp-session-id"


async def test_request_correlation_header_is_returned(mcp_client: AsyncClient) -> None:
    request_id = "0084a94f-b12b-4019-b5e6-62f6fe71ef10"
    resp = await mcp_client.post(
        "/mcp", json=_TOOLS_LIST_BODY, headers={"x-request-id": request_id}
    )
    assert resp.headers["x-request-id"] == request_id


async def test_method_header_mismatch_is_rejected_before_tool_dispatch(
    mcp_client: AsyncClient,
) -> None:
    body = {
        "jsonrpc": "2.0",
        "method": "tools/call",
        "params": {
            "name": "record_create",
            "arguments": {"model": "res.partner", "values": {}},
            "_meta": {
                "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                "io.modelcontextprotocol/clientCapabilities": {},
            },
        },
        "id": 77,
    }
    # Bypass the fixture's modern-header helper to deliberately send a mismatch.
    response = await AsyncClient.post(
        mcp_client,
        "/mcp",
        json=body,
        headers={"mcp-method": "tools/list", "mcp-name": "record_create"},
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == -32020


async def test_modern_metadata_is_required(mcp_client: AsyncClient) -> None:
    body = {**_TOOLS_LIST_BODY, "params": {}}
    response = await AsyncClient.post(
        mcp_client,
        "/mcp",
        json=body,
        headers={"mcp-method": "tools/list"},
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == -32602


async def test_malformed_json_returns_jsonrpc_parse_error(mcp_client: AsyncClient) -> None:
    response = await AsyncClient.post(
        mcp_client,
        "/mcp",
        content=b"{",
        headers={"content-type": "application/json"},
    )
    assert response.status_code == 400
    assert response.json() == {
        "jsonrpc": "2.0",
        "id": None,
        "error": {"code": -32700, "message": "Parse error"},
    }


async def test_unsupported_protocol_versions_are_rejected(mcp_client: AsyncClient) -> None:
    for metadata_version, header_version in (
        ("2024-11-05", "2026-07-28"),
        ("2026-07-28", "2027-01-01"),
    ):
        response = await AsyncClient.post(
            mcp_client,
            "/mcp",
            json={
                "jsonrpc": "2.0",
                "method": "tools/list",
                "params": {
                    "_meta": {
                        "io.modelcontextprotocol/protocolVersion": metadata_version,
                        "io.modelcontextprotocol/clientCapabilities": {},
                    }
                },
                "id": 92,
            },
            headers={
                "mcp-method": "tools/list",
                "mcp-protocol-version": header_version,
            },
        )
        assert response.status_code == 400
        assert response.json()["id"] == 92


async def test_modern_ping_and_standalone_get_are_unavailable(
    mcp_client: AsyncClient,
) -> None:
    response = await mcp_client.post(
        "/mcp",
        json={"jsonrpc": "2.0", "method": "ping", "params": {}, "id": 91},
    )
    assert response.status_code == 404
    assert "method not found" in response.text.lower()
    get_response = await mcp_client.get("/mcp")
    assert get_response.status_code == 405


@pytest.mark.parametrize(
    ("tool_name", "expected_category", "expected_outcome", "expected_diagnostic"),
    [
        ("record_search", "internal_error", "error", "Tool operation failed"),
        (
            "record_create",
            "unknown_write",
            "uncertain",
            "Tool write outcome is unknown; do not retry automatically",
        ),
    ],
)
async def test_unexpected_tool_errors_are_safe_and_correlated(
    caplog: pytest.LogCaptureFixture,
    tool_name: str,
    expected_category: str,
    expected_outcome: str,
    expected_diagnostic: str,
) -> None:
    middleware = ToolTelemetryMiddleware()
    context = SimpleNamespace(message=SimpleNamespace(name=tool_name))

    async def fail(_context: object) -> None:
        raise RuntimeError("raw request body, password, and JWT sentinel")

    with pytest.raises(ClassifiedToolError, match=expected_diagnostic):
        await middleware.on_call_tool(context, fail)  # type: ignore[arg-type]

    assert "raw request body" not in caplog.text
    event = next(
        json.loads(record.getMessage())
        for record in caplog.records
        if '"event":"tool_call_finished"' in record.getMessage()
    )
    assert event["category"] == expected_category
    assert event["outcome"] == expected_outcome


async def test_framework_wrapped_tool_error_is_sanitized(caplog: pytest.LogCaptureFixture) -> None:
    middleware = ToolTelemetryMiddleware()
    context = SimpleNamespace(message=SimpleNamespace(name="record_search"))

    async def fail(_context: object) -> None:
        raise ToolError("framework wrapped raw password and body sentinels")

    with pytest.raises(ClassifiedToolError, match="Tool operation failed") as caught:
        await middleware.on_call_tool(context, fail)  # type: ignore[arg-type]

    assert "raw password" not in str(caught.value)
    assert "sentinels" not in caplog.text


def test_fastmcp_default_exception_logs_are_redacted(capsys: pytest.CaptureFixture[str]) -> None:
    framework_logger = logging.getLogger("fastmcp.server.server")
    try:
        raise RuntimeError("password=PASSWORD_SENTINEL body=BODY_SENTINEL")
    except RuntimeError:
        framework_logger.exception("request had JWT_SENTINEL and COOKIE_SENTINEL")
    output = capsys.readouterr().err

    assert "FastMCP request failed" in output
    for sentinel in (
        "PASSWORD_SENTINEL",
        "BODY_SENTINEL",
        "JWT_SENTINEL",
        "COOKIE_SENTINEL",
    ):
        assert sentinel not in output
