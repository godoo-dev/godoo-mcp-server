"""Product journeys through MCP against disposable Odoo 18 + PostgreSQL."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
from typing import Any
from unittest.mock import AsyncMock

import httpx
import obstore
import pytest
from obstore.store import MemoryStore

from godoo_mcp_server.artifacts import ArtifactStorage

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="session")]


async def _call(
    client: httpx.AsyncClient,
    name: str,
    /,
    *,
    release_on_ping: asyncio.Event | None = None,
    **arguments: Any,
) -> dict[str, Any]:
    async with client.stream(
        "POST",
        "/mcp",
        json={
            "jsonrpc": "2.0",
            "method": "tools/call",
            "params": {"name": name, "arguments": arguments},
            "id": 1,
        },
    ) as response:
        assert response.status_code == 200, await response.aread()
        assert "mcp-session-id" not in response.headers
        lines = []
        async for line in response.aiter_lines():
            lines.append(line)
            if line.startswith(": ping") and release_on_ping is not None:
                release_on_ping.set()
    text = "\n".join(lines)
    payload = next((line[5:].strip() for line in lines if line.startswith("data:")), text)
    return json.loads(payload)["result"]


def _value(result: dict[str, Any]) -> Any:
    assert result.get("isError") is not True, result
    return json.loads(result["content"][0]["text"])


def _events(log: str, **matching: str) -> list[dict[str, Any]]:
    events = [json.loads(line) for line in log.splitlines() if line.startswith("{")]
    return [event for event in events if all(event.get(k) == v for k, v in matching.items())]


async def _assert_user_isolation(clients: Any, credentials: tuple[str, str], **kwargs: Any) -> None:
    async with (
        clients(**kwargs) as admin,
        clients(username=credentials[0], password=credentials[1], **kwargs) as portal,
    ):
        identities = await asyncio.gather(
            _call(admin, "users_whoami"), _call(portal, "users_whoami")
        )
        assert _value(identities[0])["uid"] != _value(identities[1])["uid"]
        assert _value(identities[1])["username"] == credentials[0]
        allowed, denied = await asyncio.gather(
            _call(admin, "record_search", model="res.users", max_return_bytes=None),
            _call(portal, "record_search", model="res.users", max_return_bytes=None),
        )
        assert allowed.get("isError") is not True
        assert denied.get("isError") is True


async def _assert_single_write(reply: Any, harness: Any) -> None:
    assert reply.writes == 1
    assert len(reply.ids) == 1
    rows = await harness.client.search_read(
        "res.partner.category", [["name", "=", reply.marker]], fields=["id", "name"]
    )
    assert rows == [{"id": reply.ids[0], "name": reply.marker}]


async def test_tools_list(odoo_mcp: httpx.AsyncClient) -> None:
    response = await odoo_mcp.post(
        "/mcp", json={"jsonrpc": "2.0", "method": "tools/list", "params": {}, "id": 1}
    )
    assert response.status_code == 200
    assert "users_whoami" in response.text


async def test_identity(odoo_mcp: httpx.AsyncClient) -> None:
    identity = _value(await _call(odoo_mcp, "users_whoami"))
    assert identity["uid"] > 0
    assert identity["database"] == "test_odoo"
    assert identity["username"] == "admin"
    assert identity["url"] == odoo_mcp.headers["x-odoo-url"].rstrip("/")


async def test_record_crud(odoo_mcp: httpx.AsyncClient) -> None:
    model = "res.partner.category"
    created = _value(await _call(odoo_mcp, "record_create", model=model, values={"name": "CRUD"}))
    record_id = created["id"]
    assert record_id > 0
    url = f"{odoo_mcp.headers['x-odoo-url'].rstrip('/')}/web#model={model}&id={record_id}"
    assert created["web_url"] == url
    found = _value(
        await _call(
            odoo_mcp,
            "record_search",
            model=model,
            domain=[["id", "=", record_id]],
            max_return_bytes=None,
        )
    )
    assert [row["id"] for row in found["records"]] == [record_id]
    assert found["web_urls"] == {str(record_id): url}
    read = _value(
        await _call(odoo_mcp, "record_read", model=model, ids=[record_id], max_return_bytes=None)
    )
    assert read["records"][0]["name"] == "CRUD"
    assert read["web_urls"] == {str(record_id): url}
    updated = _value(
        await _call(
            odoo_mcp, "record_update", model=model, ids=[record_id], values={"name": "Updated"}
        )
    )
    assert updated["success"] is True
    assert updated["web_urls"] == {str(record_id): url}
    read = _value(
        await _call(odoo_mcp, "record_read", model=model, ids=[record_id], max_return_bytes=None)
    )
    assert read["records"][0]["name"] == "Updated"
    assert _value(await _call(odoo_mcp, "record_delete", model=model, ids=[record_id]))["success"]
    remaining = _value(
        await _call(
            odoo_mcp,
            "record_search",
            model=model,
            domain=[["id", "=", record_id]],
            max_return_bytes=None,
        )
    )
    assert remaining["records"] == []


async def test_invalid_domain(odoo_mcp: httpx.AsyncClient) -> None:
    result = await _call(
        odoo_mcp,
        "record_search",
        model="res.partner",
        domain=[["nonexistent_field_xyz", "=", "value"]],
    )
    assert result["isError"] is True
    error = result["content"][0]["text"]
    assert error and "Traceback" not in error
    assert "nonexistent_field_xyz" not in error


async def test_mail(odoo_mcp: httpx.AsyncClient) -> None:
    result = _value(
        await _call(
            odoo_mcp, "mail_post_message", model="res.partner", res_id=1, body="MCP integration"
        )
    )
    assert result["message_id"] > 0


async def test_activity_schedule_result_and_completion(
    odoo_mcp: httpx.AsyncClient, odoo_harness: Any
) -> None:
    """A real schedule creates exactly one activity and returns its ID."""
    partner_id = _value(
        await _call(
            odoo_mcp,
            "record_create",
            model="res.partner",
            values={"name": "Activity result regression"},
        )
    )["id"]
    activity_type = await odoo_harness.client.search_read(
        "ir.model.data",
        [["module", "=", "mail"], ["name", "=", "mail_activity_data_todo"]],
        fields=["res_id"],
    )
    assert len(activity_type) == 1
    # Never replay scheduling if the reply is lost or cannot be parsed.
    result = await _call(
        odoo_mcp,
        "mail_schedule_activity",
        model="res.partner",
        res_id=partner_id,
        activity_type_id=activity_type[0]["res_id"],
        date_deadline="2026-12-31",
        note="Disposable regression activity",
    )
    domain = [["res_model", "=", "res.partner"], ["res_id", "=", partner_id]]
    activities = await odoo_harness.client.search_read("mail.activity", domain, fields=["id"])
    assert len(activities) == 1
    activity_id = _value(result)["activity_id"]
    assert activity_id == activities[0]["id"]
    listed = _value(
        await _call(odoo_mcp, "mail_list_activities", model="res.partner", res_id=partner_id)
    )
    assert [row["id"] for row in listed["activities"]] == [activity_id]
    completed = _value(await _call(odoo_mcp, "mail_mark_activity_done", activity_id=activity_id))
    assert completed["success"] is True
    assert await odoo_harness.client.search_read("mail.activity", domain, fields=["id"]) == []
    assert (
        _value(await _call(odoo_mcp, "record_delete", model="res.partner", ids=[partner_id]))[
            "success"
        ]
        is True
    )


async def test_attachments(
    odoo_mcp: httpx.AsyncClient,
    odoo_clients: Any,
    odoo_harness: Any,
    second_user_credentials: tuple[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    storage = ArtifactStorage(MemoryStore())
    monkeypatch.setattr(ArtifactStorage, "from_env", lambda: storage)
    monkeypatch.setattr(obstore, "sign_async", AsyncMock(return_value="https://download.test/file"))
    record_id = await odoo_harness.client.create(
        "res.partner.category", {"name": "Private attachment"}
    )
    payload = base64.b64encode(b"MCP attachment roundtrip").decode()
    uploaded = _value(
        await _call(
            odoo_mcp,
            "attachments_upload",
            name="integration.txt",
            content_base64=payload,
            res_model="res.partner.category",
            res_id=record_id,
            mimetype="text/plain",
        )
    )
    downloaded = _value(await _call(odoo_mcp, "attachments_download", attachment_id=uploaded["id"]))
    content = base64.b64decode(payload)
    assert "content_base64" not in downloaded
    assert downloaded["size_bytes"] == len(content)
    assert downloaded["sha256"] == hashlib.sha256(content).hexdigest()
    key = f"exports/v1/5400/{downloaded['artifact_id']}.bin"
    assert await (await obstore.get_async(storage.store, key)).bytes_async() == content
    async with odoo_clients(
        username=second_user_credentials[0], password=second_user_credentials[1]
    ) as portal:
        denied = await _call(portal, "attachments_download", attachment_id=uploaded["id"])
    assert denied["isError"] is True
    assert [item["path"] async for page in obstore.list(storage.store) for item in page] == [key]


async def test_identity_acl_and_safe_telemetry(
    odoo_clients: Any, second_user_credentials: tuple[str, str], caplog: pytest.LogCaptureFixture
) -> None:
    await _assert_user_isolation(odoo_clients, second_user_credentials)
    async with odoo_clients(
        username=second_user_credentials[0], password=second_user_credentials[1]
    ) as portal:
        denied = await _call(
            portal, "record_create", model="res.partner.category", values={"name": "must be denied"}
        )
    assert denied["isError"] is True
    events = _events(
        "\n".join(r.getMessage() for r in caplog.records if r.name == "godoo_mcp_server.telemetry"),
        event="tool_call_finished",
    )
    assert {e["category"] for e in events} >= {"success", "access_denied"}
    assert second_user_credentials[1] not in caplog.text
    assert "must be denied" not in caplog.text


async def test_process_credentials_and_correlation(
    mcp_process: Any, odoo_clients: Any, second_user_credentials: tuple[str, str]
) -> None:
    url, log = mcp_process
    request_id = "0084a94f-b12b-4019-b5e6-62f6fe71ef10"
    await _assert_user_isolation(odoo_clients, second_user_credentials, server_url=url)
    async with odoo_clients(server_url=url) as client:
        client.headers["x-request-id"] = request_id
        await _call(client, "users_whoami")
    assert _events(log.read_text(), event="tool_call_finished", request_id=request_id)
    assert second_user_credentials[1] not in log.read_text()
    assert "res.users" not in log.read_text()


@pytest.mark.parametrize("interruption", ["drop", "disconnect", "kill", "keepalive"])
async def test_committed_write_is_not_replayed(
    interruption: str,
    mcp_process_factory: Any,
    odoo_clients: Any,
    odoo_reply: Any,
    odoo_harness: Any,
    second_user_credentials: tuple[str, str],
) -> None:
    """Interrupt only the reply from real Odoo; independently read back the committed row."""
    reply = odoo_reply
    reply.drop = interruption == "drop"
    request_id = "0084a94f-b12b-4019-b5e6-62f6fe71ef10"
    async with (
        mcp_process_factory() as (url, log, process),
        odoo_clients(server_url=url, url=reply.url, timeout=35) as client,
    ):
        client.headers["x-request-id"] = request_id
        call = asyncio.create_task(
            _call(
                client,
                "record_create",
                release_on_ping=reply.release if interruption == "keepalive" else None,
                model="res.partner.category",
                values={"name": reply.marker},
            )
        )
        try:
            await asyncio.wait_for(reply.committed.wait(), timeout=20)
            await _assert_single_write(reply, odoo_harness)
            if interruption == "drop":
                result = await asyncio.wait_for(call, timeout=10)
                assert result["isError"] is True
                assert "unknown" in result["content"][0]["text"].lower()
            elif interruption == "keepalive":
                assert not call.done()
                result = await asyncio.wait_for(call, timeout=25)
                assert reply.release.is_set(), "no SSE keepalive arrived"
                assert _value(result)["id"] == reply.ids[0]
            elif interruption == "disconnect":
                call.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await call
            else:
                process.kill()
                await process.wait()
                with pytest.raises(httpx.TransportError):
                    await call
            await asyncio.wait_for(reply.closed.wait(), timeout=10)
            if interruption == "kill":
                async with mcp_process_factory("restarted") as (new_url, _, _):
                    await _assert_user_isolation(
                        odoo_clients, second_user_credentials, server_url=new_url
                    )
            else:
                await _assert_user_isolation(odoo_clients, second_user_credentials, server_url=url)
            await _assert_single_write(reply, odoo_harness)
            finished = _events(log.read_text(), event="tool_call_finished", request_id=request_id)
            if interruption == "kill":
                assert not finished, "a killed process cannot emit final telemetry"
            else:
                assert len(finished) == 1
                assert finished[0]["category"] == (
                    "success" if interruption == "keepalive" else "unknown_write"
                )
            assert _events(log.read_text(), event="tool_call_started", request_id=request_id)
            assert reply.marker not in log.read_text()
        finally:
            reply.release.set()
            call.cancel()
            await asyncio.gather(call, return_exceptions=True)
