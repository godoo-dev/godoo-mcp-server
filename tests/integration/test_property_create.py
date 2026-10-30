"""Friendly record creation over real Streamable HTTP and disposable Odoo."""

from __future__ import annotations

import asyncio
import json
import uuid

import pytest
import pytest_asyncio
from fastmcp import Client
from fastmcp.client.transports import StreamableHttpTransport

from tests.integration.test_vertical import _call

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="session")]


@pytest_asyncio.fixture(loop_scope="session")
async def property_project(odoo_harness):
    client = odoo_harness.client
    keys = {
        name: uuid.uuid4().hex[:16]
        for name in (
            "priority",
            "high",
            "normal",
            "effort",
            "count",
            "notes",
            "approved",
            "day",
            "when",
            "owner",
            "reviewers",
            "channels",
            "email",
        )
    }
    definitions = [
        {
            "name": keys["priority"],
            "string": "Priority",
            "type": "selection",
            "selection": [[keys["high"], "High"], [keys["normal"], "Normal"]],
            "default": keys["high"],
        },
        {"name": keys["effort"], "string": "Estimated effort", "type": "float", "default": 8.5},
        {"name": keys["count"], "string": "Count", "type": "integer"},
        {"name": keys["notes"], "string": "Notes", "type": "char", "default": "Default note"},
        {"name": keys["approved"], "string": "Approved", "type": "boolean", "default": True},
        {"name": keys["day"], "string": "Day", "type": "date"},
        {"name": keys["when"], "string": "When", "type": "datetime"},
        {"name": keys["owner"], "string": "Owner", "type": "many2one", "comodel": "res.partner"},
        {
            "name": keys["reviewers"],
            "string": "Reviewers",
            "type": "many2many",
            "comodel": "res.partner",
        },
        {
            "name": keys["channels"],
            "string": "Channels",
            "type": "tags",
            "tags": [[keys["email"], "Email", 1]],
        },
    ]
    project_id = partner_id = None
    try:
        project_id = await client.create(
            "project.project",
            {
                "name": f"Friendly create {uuid.uuid4().hex}",
                "task_properties_definition": definitions,
            },
        )
        partner_id = await client.create("res.partner", {"name": "Friendly create relation"})
        yield {"project_id": project_id, "partner_id": partner_id, "keys": keys}
    finally:
        if project_id:
            tasks = await client.search_read(
                "project.task", [["project_id", "=", project_id]], fields=["id"]
            )
            if tasks:
                await client.unlink("project.task", [row["id"] for row in tasks])
            await client.unlink("project.project", project_id)
        if partner_id:
            await client.unlink("res.partner", partner_id)


async def test_sdk_friendly_create_and_independent_readback(
    property_project,
    odoo_harness,
    mcp_process,
    odoo_clients,
    second_user_credentials,
):
    client = odoo_harness.client
    project = property_project
    project_id = project["project_id"]
    keys = project["keys"]
    url, log = mcp_process
    async with odoo_clients(server_url=url) as connection:
        headers = dict(connection.headers)
    async with Client(
        StreamableHttpTransport(f"{url}/mcp", headers=headers), mode="2026-07-28", timeout=30
    ) as sdk:
        tools = {tool.name: tool for tool in await sdk.list_tools()}
        assert "properties" in tools["record_create"].input_schema["properties"]
        assert tools["record_create"].input_schema["required"] == ["model", "values"]
        discovered = (
            await sdk.call_tool(
                "discovery_get_fields",
                {
                    "model": "project.task",
                    "property_field": "task_properties",
                    "parent_id": project_id,
                },
            )
        ).structured_content
        assert not any(key in json.dumps(discovered["properties"]) for key in keys.values())
        expected = {
            "priority": "normal",
            "estimated_effort": 0,
            "count": 0,
            "notes": "",
            "approved": False,
            "day": "2026-10-30",
            "when": "2026-10-30 12:30:00",
            "owner": project["partner_id"],
            "reviewers": [project["partner_id"]],
            "channels": ["email"],
        }
        marker = f"Friendly created {uuid.uuid4().hex}"
        created = (
            await sdk.call_tool(
                "record_create",
                {
                    "model": "project.task",
                    "values": {"name": marker, "project_id": project_id},
                    "properties": {"task_properties": expected},
                },
            )
        ).structured_content
        assert created["web_url"].endswith(f"#model=project.task&id={created['id']}")
        raw = (
            await client.read(
                "project.task", created["id"], ["name", "project_id", "task_properties"]
            )
        )[0]
        assert raw["name"] == marker and raw["project_id"][0] == project_id
        stored = {entry["name"]: entry["value"] for entry in raw["task_properties"]}
        assert stored[keys["priority"]] == keys["normal"]
        assert stored[keys["channels"]] == [keys["email"]]
        assert stored[keys["effort"]] == 0 and stored[keys["approved"]] is False
        read = (
            await sdk.call_tool(
                "record_read",
                {
                    "model": "project.task",
                    "ids": [created["id"]],
                    "fields": ["properties.task_properties"],
                    "max_return_bytes": None,
                },
            )
        ).structured_content
        # Odoo normalizes an empty char to False; friendly reads expose that as null.
        assert stored[keys["notes"]] is False
        assert read["records"][0]["properties"]["task_properties"] == {**expected, "notes": None}

        # Sparse input leaves defaults to the server; explicit null suppresses them.
        for changes, expected_defaults in (
            (
                {"count": 0},
                {
                    "priority": "high",
                    "estimated_effort": 8.5,
                    "notes": "Default note",
                    "approved": True,
                },
            ),
            (
                {
                    "priority": None,
                    "estimated_effort": None,
                    "notes": None,
                    "approved": False,
                    "channels": [],
                    "reviewers": [],
                },
                {
                    "priority": None,
                    "estimated_effort": None,
                    "notes": None,
                    "approved": False,
                    "channels": [],
                    "reviewers": [],
                },
            ),
        ):
            result = (
                await sdk.call_tool(
                    "record_create",
                    {
                        "model": "project.task",
                        "values": {"name": "Sparse", "project_id": project_id},
                        "properties": {"task_properties": changes},
                    },
                )
            ).structured_content
            # Independently verify sparse create effects. Odoo19 can omit value
            # for untouched properties; the supplier's friendly-read limitation
            # is tracked separately in #32. Full friendly readback is above.
            raw = (await client.read("project.task", result["id"], ["task_properties"]))[0]
            public_raw = (
                await sdk.call_tool(
                    "record_read",
                    {
                        "model": "project.task",
                        "ids": [result["id"]],
                        "fields": ["task_properties"],
                        "max_return_bytes": None,
                    },
                )
            ).structured_content["records"][0]
            assert public_raw == raw
            stored = {entry["name"]: entry.get("value") for entry in raw["task_properties"]}
            for name, expected_value in expected_defaults.items():
                field_key = "effort" if name == "estimated_effort" else name
                actual = stored[keys[field_key]]
                if isinstance(expected_value, list):
                    assert (actual if actual is not False else []) == expected_value
                elif expected_value is None:
                    assert actual is False or actual is None
                elif name == "priority":
                    assert actual == keys[expected_value]
                else:
                    assert actual == expected_value

        rejected_marker = f"Rejected create {uuid.uuid4().hex}"
        for ordinary, changes in (
            ({}, {"priority": "high"}),
            ({"project_id": True}, {"priority": "high"}),
            ({"project_id": project_id}, {"priority": "missing"}),
            ({"project_id": project_id}, {"owner": [project["partner_id"], "Display"]}),
            ({"project_id": project_id}, {keys["priority"]: "high"}),
            ({"project_id": project_id, "task_properties": {}}, {"priority": "high"}),
        ):
            rejected = await sdk.call_tool(
                "record_create",
                {
                    "model": "project.task",
                    "values": {"name": rejected_marker, **ordinary},
                    "properties": {"task_properties": changes},
                },
                raise_on_error=False,
            )
            assert rejected.is_error
            assert not any(key in rejected.content[0].text for key in keys.values())
        assert (
            await client.search_read(
                "project.task", [["name", "=", rejected_marker]], fields=["id"]
            )
            == []
        )

    async with odoo_clients(
        server_url=url, username=second_user_credentials[0], password=second_user_credentials[1]
    ) as portal:
        denied = await _call(
            portal,
            "record_create",
            model="project.task",
            values={"name": rejected_marker, "project_id": project_id},
            properties={"task_properties": {"priority": "high"}},
        )
        assert denied["isError"]
        assert denied["content"][0]["text"] in (
            "Odoo access denied",
            "Unknown or inaccessible properties container; discover model fields first.",
        )
    assert not await client.search_read(
        "project.task", [["name", "=", rejected_marker]], fields=["id"]
    )
    assert marker not in log.read_text() and rejected_marker not in log.read_text()


async def test_friendly_create_dropped_reply_is_not_replayed(
    property_project,
    odoo_harness,
    mcp_process,
    odoo_clients,
    odoo_reply,
):
    reply = odoo_reply
    reply.model = "project.task"
    reply.drop = True
    url, _log = mcp_process
    async with odoo_clients(server_url=url, url=reply.url) as connection:
        result = await _call(
            connection,
            "record_create",
            model="project.task",
            values={"name": reply.marker, "project_id": property_project["project_id"]},
            properties={"task_properties": {"priority": "normal"}},
        )
    await asyncio.wait_for(reply.committed.wait(), timeout=10)
    await asyncio.wait_for(reply.closed.wait(), timeout=10)
    assert result["isError"]
    text = result["content"][0]["text"]
    assert "unknown" in text and "do not retry" in text
    assert reply.writes == 1 and len(reply.ids) == 1
    rows = await odoo_harness.client.search_read(
        "project.task", [["name", "=", reply.marker]], fields=["id", "task_properties"]
    )
    assert len(rows) == 1 and rows[0]["id"] == reply.ids[0]
    assert (
        next(
            entry["value"]
            for entry in rows[0]["task_properties"]
            if entry["name"] == property_project["keys"]["priority"]
        )
        == property_project["keys"]["normal"]
    )
