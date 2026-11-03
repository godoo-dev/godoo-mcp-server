"""Native guest SDK and host effects over real HTTP and disposable Odoo."""

from __future__ import annotations

import asyncio
import json
import uuid
from typing import Any

import pytest

from .test_vertical import _call, _value

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="session")]


def policy(url: str, database: str, uids: list[int], declarations: list[dict]) -> dict:
    return {
        "schemaVersion": 1,
        "targets": [{
            "url": url,
            "database": database,
            "uids": uids,
            "effective": {"schemaVersion": 1, "source": "owned-disposable-installed-addons", "declarations": declarations},
            "grants": declarations,
        }],
    }


async def test_native_client_introspection_acl_and_final_artifact(
    mcp_process_factory: Any, odoo_clients: Any, odoo_harness: Any,
    second_user_credentials: Any, artifact_store: Any,
) -> None:
    admin = await odoo_harness.client.search_read("res.users", [["login", "=", "admin"]], fields=["id"])
    portal = await odoo_harness.client.search_read("res.users", [["login", "=", second_user_credentials[0]]], fields=["id"])
    declarations = [
        {"model": model, "method": method, "effects": ["read"]}
        for model, method in [("res.partner", "search_read"), ("res.partner", "name_search"), ("res.users", "search_read"), ("ir.model", "search_read"), ("ir.model.fields", "search_read"), ("res.partner", "fields_get")]
    ]
    configured = policy(odoo_harness.url, odoo_harness._database, [admin[0]["id"], portal[0]["id"]], declarations)
    async with mcp_process_factory(code_policy=configured) as (url, log, _process):
        async with odoo_clients(server_url=url) as client:
            reference = _value(await _call(client, "code_reference", section="type/BoundClientConfig"))
            assert "rpc: ModelRpc" in reference["declaration"]
            result = _value(await _call(client, "code_execute", max_return_bytes=None, code="""
const a=await introspect.getModelMetadata('res.partner');
const b=await introspect.getModelMetadata('res.partner');
const attrs=await introspect.getFieldAttributes('res.partner');
const rows=await client.searchRead('res.partner', [], {fields:['id','name'],limit:2});
const names=await client.call('res.partner','name_search',[],{name:'',limit:2,context:{lang:'en_US'}});
return {cached:a===b,map:attrs instanceof Map,fields:attrs.size,rows,names,uid:client.getSession().uid,network:typeof fetch};
"""))
            assert result["status"] == "success", result
            assert result["result"]["cached"] and result["result"]["map"]
            assert result["result"]["fields"] > 5
            assert len(result["result"]["rows"]) == 2
            assert len(result["result"]["names"]) == 2
            assert result["result"]["uid"] == admin[0]["id"]
            assert result["result"]["network"] == "undefined"
            assert all(row["outcome"] == "acknowledged" for row in result["ledger"])
            denied = _value(await _call(client, "code_execute", code="try{await client.call('res.partner','unlink',[[1]],{}, {safetyLevel:'READ'});}catch{} return true;"))
            assert denied["status"] == "failed"
            assert denied["ledger"][0]["outcome"] == "policy_refused"
            exported = _value(await _call(client, "code_execute", max_return_bytes=0, code="return await client.searchRead('res.partner', [], {fields:['id','name'],limit:2});"))
            assert exported["status"] == "success", exported
            content = json.loads(await artifact_store.download(exported["result"]["download_url"]))
            assert len(content) == 2 and isinstance(content[0]["id"], int)
        async with odoo_clients(server_url=url, username=second_user_credentials[0], password=second_user_credentials[1]) as client:
            result = _value(await _call(client, "code_execute", max_return_bytes=None, code="try{await client.searchRead('res.users',[],{limit:1});}catch{} return client.getSession().uid;"))
            assert result["status"] == "failed", result
            assert result["result"] == portal[0]["id"]
            assert result["ledger"][0]["outcome"] == "rejected"
            assert result["ledger"][0]["category"] == "access_denied"
        assert "owned-disposable-installed-addons" not in log.read_text()


@pytest.mark.parametrize("interruption", ["drop", "disconnect"])
async def test_native_committed_write_keeps_acknowledged_and_unknown_outcomes(
    interruption: str, mcp_process_factory: Any, odoo_clients: Any,
    odoo_reply: Any, odoo_harness: Any,
) -> None:
    admin = await odoo_harness.client.search_read("res.users", [["login", "=", "admin"]], fields=["id"])
    reply = odoo_reply
    reply.drop = interruption == "drop"
    declarations = [{"model": reply.model, "method": "create", "effects": ["mutate"]}]
    configured = policy(reply.url, odoo_harness._database, [admin[0]["id"]], declarations)
    marker_a = f"code-a-{uuid.uuid4()}"
    marker_c = f"code-c-{uuid.uuid4()}"
    code = f"""
await client.create({json.dumps(reply.model)},{{name:{json.dumps(marker_a)}}});
try{{await client.create({json.dumps(reply.model)},{{name:{json.dumps(reply.marker)}}});}}catch{{}}
try{{await client.create({json.dumps(reply.model)},{{name:{json.dumps(marker_c)}}});}}catch{{}}
return 'claimed-success';
"""
    async with mcp_process_factory(code_policy=configured) as (url, log, _process):
        async with odoo_clients(server_url=url, url=reply.url) as client:
            call = asyncio.create_task(_call(client, "code_execute", code=code, effects=["mutate"], max_return_bytes=None))
            try:
                await asyncio.wait_for(reply.committed.wait(), timeout=20)
                if interruption == "drop":
                    result = _value(await asyncio.wait_for(call, timeout=10))
                    assert result["status"] == "uncertain", result
                    assert [row["outcome"] for row in result["ledger"]] == ["acknowledged", "unknown"]
                    assert result["ledger"][1]["category"] == "unknown_write"
                else:
                    call.cancel()
                    with pytest.raises(asyncio.CancelledError):
                        await call
                await asyncio.wait_for(reply.closed.wait(), timeout=15)
                rows = await odoo_harness.client.search_read(reply.model, [["name", "in", [marker_a, reply.marker, marker_c]]], fields=["id", "name"])
                assert {row["name"] for row in rows} == {marker_a, reply.marker}
                assert reply.writes == 1 and len(reply.ids) == 1
                assert marker_a not in log.read_text() and marker_c not in log.read_text()
            finally:
                reply.release.set()
                call.cancel()
                await asyncio.gather(call, return_exceptions=True)
