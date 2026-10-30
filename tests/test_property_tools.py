"""MCP boundary checks for composed writes and preflight/dispatch uncertainty."""

from unittest.mock import AsyncMock, Mock

import pytest
from godoo.client.errors import OdooNetworkError

from godoo_mcp_server.tools import discovery, records
from tests.test_records import _parse_sse_json, _tool_call_body


@pytest.mark.parametrize("failure", ["none", "preflight", "dispatch"])
async def test_property_write_boundary(mcp_client, monkeypatch, failure):
    backend = AsyncMock()
    backend.__aenter__.return_value = backend
    backend.write.return_value = True
    prepare = AsyncMock(return_value={"name": "Changed", "task_properties": {"internal": False}})
    if failure == "preflight":
        prepare.side_effect = OdooNetworkError("private target details")
    elif failure == "dispatch":
        backend.write.side_effect = OdooNetworkError("private target details")
    monkeypatch.setattr(records, "OdooClient", Mock(return_value=backend))
    monkeypatch.setattr(records, "prepare_update", prepare)
    response = await mcp_client.post(
        "/mcp",
        json=_tool_call_body(
            "record_update",
            {
                "model": "project.task",
                "ids": [42],
                "values": {"name": "Changed"},
                "properties": {"task_properties": {"priority": None}},
            },
        ),
    )
    result = _parse_sse_json(response.text)["result"]
    text = result["content"][0]["text"]
    assert "private target details" not in text and "internal" not in text
    if failure == "preflight":
        backend.write.assert_not_called()
        assert result["isError"] is True and "connection failed" in text
        assert "unknown" not in text
    elif failure == "dispatch":
        backend.write.assert_awaited_once()
        assert result["isError"] is True and "unknown" in text and "do not retry" in text
    else:
        backend.write.assert_awaited_once_with("project.task", [42], prepare.return_value)
        assert result.get("isError") is not True


async def test_property_batch_rejected_without_write(mcp_client, monkeypatch):
    backend = AsyncMock()
    backend.__aenter__.return_value = backend
    monkeypatch.setattr(records, "OdooClient", Mock(return_value=backend))
    response = await mcp_client.post(
        "/mcp",
        json=_tool_call_body(
            "record_update",
            {
                "model": "project.task",
                "ids": [42, 43],
                "properties": {"task_properties": {"priority": "high"}},
            },
        ),
    )
    result = _parse_sse_json(response.text)["result"]
    assert result["isError"] is True
    backend.write.assert_not_called()


@pytest.mark.parametrize("record_id", [True, False, 1.0, "1"])
async def test_property_write_ids_are_not_coerced(mcp_client, monkeypatch, record_id):
    constructor = Mock()
    monkeypatch.setattr(records, "OdooClient", constructor)
    response = await mcp_client.post(
        "/mcp",
        json=_tool_call_body(
            "record_update",
            {
                "model": "project.task",
                "ids": [record_id],
                "properties": {"task_properties": {"priority": "high"}},
            },
        ),
    )
    result = _parse_sse_json(response.text)["result"]
    assert result["isError"] is True
    constructor.assert_not_called()


@pytest.mark.parametrize(
    "scope", [{"record_id": True}, {"property_field": "task_properties", "parent_id": True}]
)
async def test_property_discovery_ids_are_not_coerced(mcp_client, monkeypatch, scope):
    constructor = Mock()
    monkeypatch.setattr(discovery, "OdooClient", constructor)
    response = await mcp_client.post(
        "/mcp",
        json=_tool_call_body("discovery_get_fields", {"model": "project.task", **scope}),
    )
    result = _parse_sse_json(response.text)["result"]
    assert result["isError"] is True
    constructor.assert_not_called()
