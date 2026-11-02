"""General-call MCP boundaries through the pinned client and an RPC double."""

import asyncio
import json
from dataclasses import replace
from unittest.mock import AsyncMock, Mock

import pytest
from godoo.client.client import OdooClient
from godoo.client.errors import OdooAccessError, OdooAuthError, OdooNetworkError
from godoo.client.rpc import OdooSessionInfo
from godoo.client.safety import SafetyContext

from godoo_mcp_server.tools import models
from tests.test_guidance_feedback import payload
from tests.test_records import _tool_call_body


@pytest.fixture
def rpc(monkeypatch):
    transport = AsyncMock()
    transport.session = OdooSessionInfo(uid=2, session_id="call-test", db="testdb")
    transport.authenticate.return_value = transport.session
    factory = Mock(
        side_effect=lambda config: OdooClient(
            replace(config, transport_factory=lambda _: transport)
        )
    )
    monkeypatch.setattr(models, "OdooClient", factory)
    return transport, factory


async def invoke(client, *, headers=None, **arguments):
    arguments = {"model": "custom.model", "method": "custom_method", **arguments}
    response = await client.post(
        "/mcp", headers=headers, json=_tool_call_body("model_call", arguments)
    )
    assert response.status_code == 200
    return payload(response)["result"]


@pytest.mark.parametrize("value", [False, None, {"nested": [True, 0, 1.25, "á", [], [False]]}])
async def test_native_arguments_and_results(mcp_client, rpc, value):
    transport, _ = rpc
    transport.call.return_value = value
    args = [[42], {"nested": [False, 0, None, "á"]}]
    kwargs = {"context": {"lang": "es_ES", "allowed_company_ids": [1, 2]}, "option": 7}
    result = await invoke(mcp_client, args=args, kwargs=kwargs)
    assert (
        result["structuredContent"] == json.loads(result["content"][0]["text"]) == {"result": value}
    )
    transport.call.assert_awaited_once_with("custom.model", "custom_method", args, kwargs)
    transport.aclose.assert_awaited_once()


async def test_concurrent_callers_and_defaults_are_isolated(mcp_client, rpc):
    transport, factory = rpc
    transport.call.return_value = False
    headers = {
        "x-odoo-url": "https://other.invalid",
        "x-odoo-database": "otherdb",
        "x-odoo-username": "other",
        "x-odoo-password": "other-key",
    }
    await asyncio.gather(
        invoke(mcp_client, model="another.model", kwargs={"context": {"lang": "es_ES"}}),
        invoke(mcp_client, headers=headers, args=None, kwargs=None),
    )
    transport.call.assert_any_await(
        "another.model", "custom_method", [], {"context": {"lang": "es_ES"}}
    )
    transport.call.assert_any_await("custom.model", "custom_method", [], {})
    assert {c.args for c in transport.authenticate.await_args_list} == {
        ("admin", "admin"),
        ("other", "other-key"),
    }
    assert {
        (c.args[0].url, c.args[0].database, c.args[0].username, c.args[0].password)
        for c in factory.call_args_list
    } == {
        ("http://odoo.test", "testdb", "admin", "admin"),
        ("https://other.invalid", "otherdb", "other", "other-key"),
    }


@pytest.mark.parametrize(
    "invalid",
    [
        {"model": ""},
        {"method": ""},
        {"model": 7},
        {"method": True},
        {"args": {}},
        {"kwargs": []},
        {"kwargs": {"context": None}},
    ],
)
async def test_invalid_arguments_do_not_open_odoo(mcp_client, rpc, invalid):
    _, factory = rpc
    assert (await invoke(mcp_client, **invalid))["isError"]
    factory.assert_not_called()


@pytest.mark.parametrize(
    ("error", "category"),
    [
        (OdooAccessError, "access_denied"),
        (OdooNetworkError, "unknown_write"),
        (ValueError, "unknown_write"),
    ],
)
async def test_failed_call_is_private_and_not_retried(mcp_client, rpc, caplog, error, category):
    transport, _ = rpc
    transport.call.side_effect = error("private-response")
    result = await invoke(
        mcp_client, model="private.model", method="private_method", args=["private-argument"]
    )
    assert result["isError"]
    secrets = ("private-response", "private.model", "private_method", "private-argument")
    assert not any(secret in str(result) + caplog.text for secret in secrets)
    event = json.loads([r.message for r in caplog.records if r.name.endswith("telemetry")][-1])
    assert (event["tool"], event["category"]) == ("model_call", category)
    assert event["outcome"] == ("uncertain" if category == "unknown_write" else "error")
    if category == "unknown_write":
        assert "do not retry automatically" in result["content"][0]["text"]
    transport.call.assert_awaited_once()
    transport.aclose.assert_awaited_once()


@pytest.mark.parametrize("error", [OdooAuthError, OdooNetworkError])
async def test_failed_authentication_never_dispatches(mcp_client, rpc, error):
    transport, _ = rpc
    transport.authenticate.side_effect = error("private-credential")
    result = await invoke(mcp_client)
    assert result["isError"] and "authentication" in result["content"][0]["text"]
    assert "unknown" not in str(result) and "private-credential" not in str(result)
    transport.call.assert_not_called()
    transport.aclose.assert_awaited_once()


async def test_client_guard_can_refuse_before_dispatch(mcp_client, rpc):
    transport, factory = rpc
    refuse = AsyncMock(return_value=False)
    factory.side_effect = lambda config: OdooClient(
        replace(
            config,
            safety=SafetyContext(confirm=refuse),
            transport_factory=lambda _: transport,
        )
    )
    assert (await invoke(mcp_client))["isError"]
    refuse.assert_awaited_once()
    transport.call.assert_not_called()
    transport.aclose.assert_awaited_once()


async def test_cancellation_is_uncertain_and_closes_transport(mcp_client, rpc, caplog):
    transport, _ = rpc
    entered = asyncio.Event()

    async def wait_for_cancellation(*args, **kwargs):
        entered.set()
        await asyncio.Event().wait()

    transport.call.side_effect = wait_for_cancellation
    task = asyncio.create_task(invoke(mcp_client))
    await asyncio.wait_for(entered.wait(), timeout=5)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    transport.call.assert_awaited_once()
    transport.aclose.assert_awaited_once()
    event = json.loads([r.message for r in caplog.records if r.name.endswith("telemetry")][-1])
    assert (event["category"], event["outcome"]) == ("unknown_write", "uncertain")


async def test_discovered_call_schema_and_effects(mcp_client):
    request = {"jsonrpc": "2.0", "id": 4, "method": "tools/list", "params": {}}
    response = await mcp_client.post("/mcp", json=request)
    tool = next(t for t in payload(response)["result"]["tools"] if t["name"] == "model_call")
    assert tool["annotations"] == {
        "readOnlyHint": False,
        "destructiveHint": True,
        "idempotentHint": False,
        "openWorldHint": True,
    }
    assert set(tool["inputSchema"]["properties"]) == {"model", "method", "args", "kwargs"}
    assert set(tool["inputSchema"]["required"]) == {"model", "method"}
