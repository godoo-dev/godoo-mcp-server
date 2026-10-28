"""Public MCP contracts for guidance discovery, identity and navigation context."""

from __future__ import annotations

import json
import re
from types import SimpleNamespace
from typing import TYPE_CHECKING
from unittest.mock import AsyncMock, Mock

import pytest

from godoo_mcp_server import resources
from godoo_mcp_server.links import public_odoo_url, record_web_urls
from godoo_mcp_server.tools import records, users

if TYPE_CHECKING:
    from httpx import AsyncClient, Response


def payload(response: Response) -> dict:
    text = response.text
    return json.loads(next((s[5:] for s in text.splitlines() if s.startswith("data:")), text))


async def call(client: AsyncClient, name: str, arguments: dict | None = None) -> dict:
    response = await client.post(
        "/mcp",
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": name, "arguments": arguments or {}},
        },
    )
    assert response.status_code == 200
    return payload(response)["result"]


@pytest.mark.parametrize("path", resources._SKILL_PATHS)
async def test_tool_only_client_gets_same_bundled_guidance(mcp_client, path):
    result = await call(mcp_client, "guidance_get", {"path": path})
    assert not result.get("isError")
    assert result["content"][0]["text"] == resources._SKILL_FILES[path]
    response = await mcp_client.post(
        "/mcp",
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "resources/read",
            "params": {"uri": f"skill://odoo/{path}"},
        },
    )
    assert payload(response)["result"]["contents"][0]["text"] == result["content"][0]["text"]


@pytest.mark.parametrize(
    "path", ["../../credentials.py", "/etc/passwd", "unknown.md", "PROVENANCE.md"]
)
async def test_guidance_rejects_unbundled_paths(mcp_client, path):
    result = await call(mcp_client, "guidance_get", {"path": path})
    assert result["isError"]


async def test_guidance_discovery_routes_to_every_bundled_topic(mcp_client):
    response = await mcp_client.post(
        "/mcp",
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "resources/read",
            "params": {"uri": "skill://index.json"},
        },
    )
    index = json.loads(payload(response)["result"]["contents"][0]["text"])
    topics = index["topics"]
    assert {topic["path"] for topic in topics} == set(resources._SKILL_PATHS)
    assert all(topic["title"] and topic["description"] for topic in topics)
    for topic in topics:
        assert topic["url"] == f"skill://odoo/{topic['path']}"
    root = (await call(mcp_client, "guidance_get"))["content"][0]["text"]
    # Check the routes a reader actually sees, not merely the internal manifest.
    links = re.findall(r"\]\(([^)]+)\)", root)
    assert set(links) == set(resources._SKILL_PATHS) - {"SKILL.md"}


async def test_tool_annotations_preserve_mutation_classification(mcp_client):
    response = await mcp_client.post(
        "/mcp",
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/list",
            "params": {},
        },
    )
    tools = {t["name"]: t for t in payload(response)["result"]["tools"]}
    writes = {
        "record_create",
        "record_update",
        "record_delete",
        "mail_post_message",
        "mail_log_note",
        "mail_schedule_activity",
        "mail_mark_activity_done",
        "attachments_upload",
        "record_search",
        "record_read",
        "action_execute_action",
    }
    for name, tool in tools.items():
        assert tool["annotations"]["readOnlyHint"] is (name not in writes)
    assert tools["guidance_get"]["annotations"]["openWorldHint"] is False
    assert set(tools["guidance_get"]["inputSchema"]["properties"]["path"]["enum"]) == set(
        resources._SKILL_PATHS
    )


async def test_identity_and_record_links_are_scoped_to_each_request(mcp_client, monkeypatch):
    client = AsyncMock()
    client.get_session = Mock(return_value=SimpleNamespace(uid=11, db="prod"))
    row = {"id": 7, "web_url": "an actual Odoo field value"}
    client.search_read.return_value = [row]
    client.read.return_value = [row]
    client.create.return_value = 7
    client.write.return_value = True
    client.unlink.return_value = True
    factory = Mock(return_value=client)
    monkeypatch.setattr(records, "OdooClient", factory)
    monkeypatch.setattr(users, "OdooClient", factory)
    for base in ("https://first.test", "https://second.test/odoo"):
        mcp_client.headers["x-odoo-url"] = base
        identity = (await call(mcp_client, "users_whoami"))["structuredContent"]
        assert identity["url"] == base
        assert identity["database"] == "prod"
        assert "environment" not in identity
        expected = {"7": base + "/web#model=project.task&id=7"}
        domain = [["stage_id.fold", "=", False]]
        found = (
            await call(
                mcp_client,
                "record_search",
                {
                    "model": "project.task",
                    "domain": domain,
                    "fields": ["web_url"],
                },
            )
        )["structuredContent"]
        assert found == {"records": [row], "count": 1, "web_urls": expected}
        assert client.search_read.call_args.args == ("project.task", domain)
        read = (
            await call(
                mcp_client,
                "record_read",
                {
                    "model": "project.task",
                    "ids": [7],
                },
            )
        )["structuredContent"]
        assert read == {"records": [row], "web_urls": expected}
        created = (
            await call(
                mcp_client,
                "record_create",
                {
                    "model": "project.task",
                    "values": {"name": "local mock only"},
                },
            )
        )["structuredContent"]
        assert created == {"id": 7, "web_url": expected["7"]}
        updated = (
            await call(
                mcp_client,
                "record_update",
                {
                    "model": "project.task",
                    "ids": [7],
                    "values": {"priority": "1"},
                },
            )
        )["structuredContent"]
        assert updated == {"success": True, "web_urls": expected}
        deleted = (
            await call(
                mcp_client,
                "record_delete",
                {
                    "model": "project.task",
                    "ids": [7],
                },
            )
        )["structuredContent"]
        assert deleted == {"success": True}
    assert client.aclose.await_count == 12


def test_navigation_strips_secrets_and_encodes_fragment():
    base = "https://user:secret@example.test/odoo/?token=secret#secret"
    assert public_odoo_url(base) == "https://example.test/odoo"
    assert record_web_urls(base, "model&action=delete", [7]) == {
        "7": "https://example.test/odoo/web#model=model%26action%3Ddelete&id=7",
    }
    assert public_odoo_url("javascript:alert(1)") is None
    assert record_web_urls("https://[invalid", "res.partner", [1]) == {}
