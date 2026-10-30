"""Creation through MCP with the installed supplier's real property binding."""

from copy import deepcopy
from unittest.mock import Mock

import pytest
from godoo.client.client import OdooClient, OdooClientConfig
from godoo.client.errors import OdooNetworkError
from godoo.client.safety import SafetyContext

from godoo_mcp_server.tools import records
from tests.test_properties import CONTAINER, MODEL, OPAQUE, MemoryTransport, definition
from tests.test_records import _parse_sse_json, _tool_call_body


class CreateTransport(MemoryTransport):
    def __init__(self):
        super().__init__()
        self.failure = None

    async def call(self, model, method, args, kwargs):
        if method == "create":
            self.calls.append((model, method, deepcopy(args), deepcopy(kwargs)))
            if self.failure == "dispatch":
                raise OdooNetworkError("private target details")
            return 44
        if self.failure == "preflight":
            raise OdooNetworkError("private target details")
        return await super().call(model, method, args, kwargs)


@pytest.fixture
def backend(monkeypatch):
    transport = CreateTransport()
    client = OdooClient(
        OdooClientConfig(
            url="https://example.invalid",
            database="test",
            username="test",
            password="test",
            transport_factory=lambda _: transport,
        )
    )
    monkeypatch.setattr(records, "OdooClient", Mock(return_value=client))
    return transport, client


async def create(mcp_client, properties, values=None):
    arguments = {"model": MODEL, "values": values if values is not None else {"project_id": 7}}
    if properties is not None:
        arguments["properties"] = properties
    response = await mcp_client.post("/mcp", json=_tool_call_body("record_create", arguments))
    return _parse_sse_json(response.text)["result"]


@pytest.mark.parametrize("reverse", [False, True])
async def test_friendly_create_sparse_multiple_containers(mcp_client, backend, reverse):
    transport, client = backend
    properties = {
        CONTAINER: {"priority": "high", "estimated_effort": 0, "enabled": False, "notes": ""},
        "other_properties": {"owner": None},
    }
    if reverse:
        properties = dict(reversed(properties.items()))
    original = deepcopy(properties)
    values = {"name": "New", "project_id": 7, "other_parent_id": 9}
    with client.with_context(lang="es_ES", allowed_company_ids=[4]):
        result = await create(mcp_client, properties, values)
    assert not result.get("isError")
    assert result["structuredContent"]["id"] == 44
    assert result["structuredContent"]["web_url"] == "http://odoo.test/web#model=test.child&id=44"
    creates = [call for call in transport.calls if call[1] == "create"]
    assert len(creates) == 1
    assert creates[0][2] == [
        {
            **values,
            CONTAINER: {OPAQUE[0]: "f001f00d", OPAQUE[1]: 0, OPAQUE[3]: False, OPAQUE[4]: ""},
            "other_properties": {"f007f00d": False},
        }
    ]
    assert all(
        call[3]["context"] == {"lang": "en_US", "allowed_company_ids": [4]}
        for call in transport.calls
    )
    assert properties == original and "task_properties" not in values


@pytest.mark.parametrize(
    ("properties", "values"),
    [
        ({}, {"project_id": 7}),
        ({CONTAINER: {}}, {"project_id": 7}),
        ({CONTAINER: {"priority": "high"}}, {}),
        *[
            ({CONTAINER: {"priority": "high"}}, {"project_id": parent})
            for parent in (True, False, 0, -1, 7.0, "7", [7, "Parent"])
        ],
        ({CONTAINER: {"priority": "missing"}}, {"project_id": 7}),
        ({CONTAINER: {"estimated_effort": False}}, {"project_id": 7}),
        ({CONTAINER: {"priority": "high"}}, {"project_id": 7, CONTAINER: {}}),
        ({CONTAINER: {"priority": "high"}}, {"project_id": 7, "other_properties": {}}),
        ({CONTAINER: {OPAQUE[0]: "high"}}, {"project_id": 7}),
        ({"other_properties": {"owner": [11, "Owner"]}}, {"other_parent_id": 9}),
        (
            {CONTAINER: {"priority": "high"}, "other_properties": {"owner": 0}},
            {"project_id": 7, "other_parent_id": 9},
        ),
    ],
)
async def test_friendly_create_invalid_inputs_never_dispatch(
    mcp_client, backend, properties, values
):
    transport, _ = backend
    result = await create(mcp_client, properties, values)
    assert result["isError"]
    text = result["content"][0]["text"]
    assert not any(key in text for key in OPAQUE)
    assert not any(call[1] == "create" for call in transport.calls)


@pytest.mark.parametrize("kind", ["collision", "denied", "preflight", "dispatch", "guard"])
async def test_friendly_create_failure_boundaries(mcp_client, backend, kind):
    transport, client = backend
    guards = []

    async def refuse(operation):
        guards.append(operation)
        return False

    if kind == "collision":
        transport.definitions[7].append(definition("abcdef", "Priority", "char"))
    elif kind == "denied":
        transport.denied.add("test.parent")
    elif kind == "guard":
        client.set_safety_context(SafetyContext(confirm=refuse))
    else:
        transport.failure = kind
    result = await create(mcp_client, {CONTAINER: {"priority": "high"}})
    assert result["isError"]
    text = result["content"][0]["text"]
    assert "private" not in text and not any(key in text for key in OPAQUE)
    assert ("unknown" in text) == (kind == "dispatch")
    assert len([call for call in transport.calls if call[1] == "create"]) == (kind == "dispatch")
    if kind == "guard":
        assert len(guards) == 1 and guards[0].level == "WRITE"


async def test_friendly_create_uses_mcp_names_without_python_alias_restrictions(
    mcp_client, backend
):
    transport, _ = backend
    transport.definitions[7] = [
        definition("aa", "1 Priority", "selection", selection=[["bb", "class"]]),
        definition("cc", "État", "char"),
    ]
    result = await create(mcp_client, {CONTAINER: {"1_priority": "class", "état": "ok"}})
    assert not result.get("isError")
    assert transport.calls[-1][2] == [{"project_id": 7, CONTAINER: {"aa": "bb", "cc": "ok"}}]


async def test_ordinary_create_has_no_property_preflight(mcp_client, backend):
    transport, _ = backend
    values = {"name": "Raw", CONTAINER: {"raw": False}}
    result = await create(mcp_client, None, values)
    assert not result.get("isError")
    assert [(call[1], call[2]) for call in transport.calls] == [("create", [values])]
