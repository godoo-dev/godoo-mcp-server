"""Friendly adapters exercised through the installed client's real properties service."""

from __future__ import annotations

import json
from copy import deepcopy
from typing import Any

import pytest
from godoo.client.client import OdooClient, OdooClientConfig
from godoo.client.errors import OdooAccessError, OdooSafetyError
from godoo.client.rpc import OdooSessionInfo
from godoo.client.safety import SafetyContext

from godoo_mcp_server.odoo_runtime import ClassifiedToolError
from godoo_mcp_server.properties import compile_domain, discover, prepare_update, read

MODEL = "test.child"
CONTAINER = "task_properties"
OPAQUE = ["a001f00d", "b002f00d", "c003f00d", "d004f00d", "e005f00d"]


def definition(name: str, label: str, kind: str, **extra: Any) -> dict[str, Any]:
    return {"name": name, "string": label, "type": kind, **extra}


class MemoryTransport:
    """Read-only RPC double; unexpected calls, including writes, fail every test."""

    def __init__(self) -> None:
        self.session = OdooSessionInfo(uid=2, session_id="test-session", db="test")
        self.calls: list[tuple[str, str, list[Any], dict[str, Any]]] = []
        self.denied: set[str] = set()
        self.definitions = {
            7: [
                definition(
                    OPAQUE[0],
                    "Priority",
                    "selection",
                    selection=[["f001f00d", "High"], ["f002f00d", "Normal"]],
                ),
                definition(OPAQUE[1], "Estimated Effort", "float"),
                definition(
                    OPAQUE[2],
                    "Channels",
                    "tags",
                    tags=[["f003f00d", "E-mail", 1], ["f004f00d", "Phone", 2]],
                ),
                definition(OPAQUE[3], "Enabled", "boolean"),
                definition(OPAQUE[4], "Notes", "char"),
                definition("f005f00d", "---", "separator"),
            ],
            8: [definition("f006f00d", "Other Name", "integer")],
        }
        self.secondary = [definition("f007f00d", "Owner", "many2one", comodel="res.partner")]
        self.metadata = {
            "id": {"type": "integer"},
            "name": {"type": "char"},
            "project_id": {"type": "many2one", "relation": "test.parent"},
            "other_parent_id": {"type": "many2one", "relation": "test.parent"},
            CONTAINER: {
                "type": "properties",
                "definition_record": "project_id",
                "definition_record_field": "property_definitions",
            },
            "other_properties": {
                "type": "properties",
                "definition_record": "other_parent_id",
                "definition_record_field": "other_definitions",
            },
        }
        self.rows = {
            42: {
                "id": 42,
                "name": "First",
                "project_id": [7, "First parent"],
                "other_parent_id": [9, "Other parent"],
                CONTAINER: self.entries(7, ["f001f00d", 0, ["f003f00d"], False, ""]),
                "other_properties": [{**self.secondary[0], "value": [11, "Owner"]}],
            },
            43: {
                "id": 43,
                "name": "Second",
                "project_id": [8, "Second parent"],
                "other_parent_id": [9, "Other parent"],
                CONTAINER: self.entries(8, [2]),
                "other_properties": [{**self.secondary[0], "value": False}],
            },
        }

    def entries(self, parent_id: int, values: list[Any]) -> list[dict[str, Any]]:
        writable = [item for item in self.definitions[parent_id] if item["type"] != "separator"]
        return [
            {**deepcopy(item), "value": value} for item, value in zip(writable, values, strict=True)
        ]

    async def authenticate(self, username: str, password: str) -> OdooSessionInfo:
        return self.session

    async def call(self, model: str, method: str, args: list[Any], kwargs: dict[str, Any]) -> Any:
        self.calls.append((model, method, deepcopy(args), deepcopy(kwargs)))
        if model in self.denied:
            raise OdooAccessError("private message with opaque a001f00d")
        if method == "fields_get":
            if model == MODEL:
                return deepcopy(self.metadata)
            return {
                "property_definitions": {"type": "properties_definition"},
                "other_definitions": {"type": "properties_definition"},
            }
        if method == "read":
            fields = kwargs.get("fields")
            if model == MODEL:
                return [
                    deepcopy(
                        {
                            key: value
                            for key, value in self.rows[rid].items()
                            if fields is None or key in ["id", *fields]
                        }
                    )
                    for rid in args[0]
                    if rid in self.rows
                ]
            return [
                {
                    "id": rid,
                    **{
                        field: deepcopy(
                            self.secondary
                            if field == "other_definitions"
                            else self.definitions[rid]
                        )
                        for field in fields
                    },
                }
                for rid in args[0]
            ]
        raise AssertionError(f"Unexpected RPC: {method}")

    def logout(self) -> None:
        pass

    async def aclose(self) -> None:
        pass


@pytest.fixture
def transport() -> MemoryTransport:
    return MemoryTransport()


@pytest.fixture
def client(transport: MemoryTransport) -> OdooClient:
    return OdooClient(
        OdooClientConfig(
            url="https://example.invalid",
            database="test",
            username="test",
            password="test",
            transport_factory=lambda _: transport,
        )
    )


def no_opaque(value: Any) -> None:
    assert not any(token in json.dumps(value, ensure_ascii=False) for token in OPAQUE)
    assert "f001f00d" not in json.dumps(value)


async def test_discovery_definitions_and_fixed_context(client, transport):
    with client.with_context(lang="es_ES", allowed_company_ids=[4]):
        result = await discover(client, MODEL, record_id=42)
    assert list(result) == [CONTAINER, "other_properties"]
    assert result[CONTAINER][0] == {
        "name": "priority",
        "label": "Priority",
        "type": "selection",
        "values": [{"name": "high", "label": "High"}, {"name": "normal", "label": "Normal"}],
    }
    assert len(result[CONTAINER]) == 5
    assert result["other_properties"] == [
        {"name": "owner", "label": "Owner", "type": "many2one", "comodel": "res.partner"}
    ]
    assert all(
        call[3]["context"] == {"lang": "en_US", "allowed_company_ids": [4]}
        for call in transport.calls
    )
    no_opaque(result)


async def test_explicit_parent_discovery_needs_no_child(client, transport):
    result = await discover(client, MODEL, property_field=CONTAINER, parent_id=8)
    assert result == {CONTAINER: [{"name": "other_name", "label": "Other Name", "type": "integer"}]}
    assert not any(call[0] == MODEL and call[1] == "read" for call in transport.calls)


@pytest.mark.parametrize(
    "kwargs",
    [
        {},
        {"record_id": 42, "property_field": CONTAINER, "parent_id": 7},
        {"property_field": CONTAINER},
        {"parent_id": 7},
        {"record_id": True},
        {"record_id": 0},
    ],
)
async def test_discovery_requires_exact_scope(client, transport, kwargs):
    with pytest.raises(ClassifiedToolError, match="record_id OR"):
        await discover(client, MODEL, **kwargs)
    assert transport.calls == []


@pytest.mark.parametrize("labels", [("CAFÉ", "cafe\u0301"), ("A-B", "A B"), ("---", "Other")])
async def test_ambiguous_or_empty_property_names(client, transport, labels):
    transport.definitions[7] = [
        definition("opaque-one", labels[0], "char"),
        definition("opaque-two", labels[1], "char"),
    ]
    with pytest.raises(ClassifiedToolError, match="rename the labels") as error:
        await discover(client, MODEL, property_field=CONTAINER, parent_id=7)
    assert "opaque" not in str(error.value)


@pytest.mark.parametrize("kind", ["selection", "tags"])
async def test_choice_collisions_are_rejected(client, transport, kind):
    options = [["internal-one", "High!"], ["internal-two", "HIGH"]]
    if kind == "tags":
        options = [item + [0] for item in options]
    transport.definitions[7] = [definition("internal-property", "Choice", kind, **{kind: options})]
    with pytest.raises(ClassifiedToolError, match="rename the choices") as error:
        await discover(client, MODEL, property_field=CONTAINER, parent_id=7)
    assert "internal" not in str(error.value)


async def test_unicode_names_and_request_local_rename(client, transport):
    transport.definitions[8][0]["string"] = "  Straße / 中文 / cafe\u0301  "
    first = await discover(client, MODEL, property_field=CONTAINER, parent_id=8)
    assert first[CONTAINER][0]["name"] == "strasse_中文_café"
    transport.definitions[8][0]["string"] = "Changed"
    second = await discover(client, MODEL, property_field=CONTAINER, parent_id=8)
    assert second[CONTAINER][0]["name"] == "changed"


async def test_read_multiple_parents_and_containers_without_internal_fields(client, transport):
    result = await read(
        client,
        MODEL,
        [43, 42],
        ["name", f"properties.{CONTAINER}", "properties.other_properties.owner"],
    )
    assert result == [
        {
            "id": 43,
            "name": "Second",
            "properties": {CONTAINER: {"other_name": 2}, "other_properties": {"owner": None}},
        },
        {
            "id": 42,
            "name": "First",
            "properties": {
                CONTAINER: {
                    "priority": "high",
                    "estimated_effort": 0,
                    "channels": ["e_mail"],
                    "enabled": False,
                    "notes": "",
                },
                "other_properties": {"owner": 11},
            },
        },
    ]
    no_opaque(result)


async def test_selective_projection(client):
    assert await read(client, MODEL, [42], [f"properties.{CONTAINER}.priority"]) == [
        {"id": 42, "properties": {CONTAINER: {"priority": "high"}}}
    ]


async def test_raw_read_unchanged(client, transport):
    result = await read(client, MODEL, [42], [CONTAINER])
    assert result[0][CONTAINER] == transport.rows[42][CONTAINER]
    assert len(transport.calls) == 1
    assert "context" not in transport.calls[0][3]


@pytest.mark.parametrize(
    "path",
    [
        "properties.task_properties.",
        "properties..priority",
        "properties.task_properties.priority.extra",
    ],
)
async def test_invalid_paths_fail_before_rpc(client, transport, path):
    with pytest.raises(ClassifiedToolError, match="Use properties"):
        await read(client, MODEL, [42], [path])
    assert transport.calls == []


async def test_unknown_read_name_does_not_echo_opaque_input(client):
    with pytest.raises(ClassifiedToolError, match="Unknown property name") as error:
        await read(client, MODEL, [42], [f"properties.{CONTAINER}.f001f00d"])
    assert "f001f00d" not in str(error.value)


async def test_sparse_update_complete_wire_payload_and_no_write(client, transport):
    properties = {
        CONTAINER: {"priority": "normal", "estimated_effort": None, "channels": []},
        "other_properties": {"owner": 12},
    }
    values = {"name": "Changed"}
    expected_input = deepcopy(properties)
    result = await prepare_update(client, MODEL, 42, properties, values)
    assert result == {
        "name": "Changed",
        CONTAINER: {
            OPAQUE[0]: "f002f00d",
            OPAQUE[1]: False,
            OPAQUE[2]: [],
            OPAQUE[3]: False,
            OPAQUE[4]: "",
        },
        "other_properties": {"f007f00d": 12},
    }
    assert properties == expected_input and values == {"name": "Changed"}


async def test_valid_false_zero_empty_and_clears(client, transport):
    transport.rows[42][CONTAINER] = transport.entries(
        7, ["f001f00d", 3.5, ["f003f00d"], True, "Before"]
    )
    patch = {"enabled": False, "estimated_effort": 0, "notes": "", "channels": ["phone"]}
    result = await prepare_update(client, MODEL, 42, {CONTAINER: patch}, {})
    assert result[CONTAINER] == dict(
        zip(OPAQUE, ["f001f00d", 0, ["f004f00d"], False, ""], strict=True)
    )
    clears = {"channels": None, "priority": None, "enabled": None}
    result = await prepare_update(client, MODEL, 42, {CONTAINER: clears}, {})
    assert result[CONTAINER] == dict(zip(OPAQUE, [False, 3.5, [], False, "Before"], strict=True))


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("estimated_effort", False),
        ("estimated_effort", float("nan")),
        ("estimated_effort", float("inf")),
        ("estimated_effort", True),
        ("notes", False),
        ("priority", "f001f00d"),
        ("channels", "phone"),
        ("channels", ["f003f00d"]),
        ("channels", ["E-mail"]),
        ("channels", ["EMAIL"]),
        ("enabled", 0),
        ("priority", []),
        ("f001f00d", "high"),
    ],
)
async def test_bad_patches_fail_without_write_or_opaque_error(client, transport, name, value):
    with pytest.raises(ClassifiedToolError) as error:
        await prepare_update(client, MODEL, 42, {CONTAINER: {name: value}}, {})
    no_opaque(str(error.value))


@pytest.mark.parametrize("properties", [{}, {CONTAINER: {}}, {CONTAINER: []}])
async def test_empty_or_malformed_patch_fails_before_rpc(client, transport, properties):
    with pytest.raises(ClassifiedToolError, match="nonempty"):
        await prepare_update(client, MODEL, 42, properties, {})
    assert transport.calls == []


@pytest.mark.parametrize(
    "values", [{"project_id": 8}, {CONTAINER: {"internal": 1}}, {"other_properties": []}]
)
async def test_parent_change_and_raw_mixed_changes_rejected(client, transport, values):
    with pytest.raises(ClassifiedToolError):
        await prepare_update(client, MODEL, 42, {CONTAINER: {"priority": "normal"}}, values)
    assert all(call[1] != "read" for call in transport.calls)


@pytest.mark.parametrize("corruption", ["bad_float", "missing", "duplicate", "kind", "option"])
async def test_malformed_untouched_values_rejected(client, transport, corruption):
    entries = transport.rows[42][CONTAINER]
    if corruption == "bad_float":
        entries[1]["value"] = "bad"
    elif corruption == "missing":
        entries.pop(1)
    elif corruption == "duplicate":
        entries.append(deepcopy(entries[1]))
    elif corruption == "kind":
        entries[1]["type"] = "integer"
    else:
        entries[0]["value"] = "unexpected-opaque-option"
    with pytest.raises(ClassifiedToolError, match="all current values") as error:
        await prepare_update(client, MODEL, 42, {CONTAINER: {"notes": "Changed"}}, {})
    no_opaque(str(error.value))
    assert "unexpected-opaque-option" not in str(error.value)


@pytest.mark.parametrize(
    ("operation", "arguments"),
    [
        (discover, {"property_field": CONTAINER, "parent_id": 7}),
        (read, {"ids": [42], "fields": [f"properties.{CONTAINER}"]}),
        (
            prepare_update,
            {"record_id": 42, "properties": {CONTAINER: {"notes": "X"}}, "values": {}},
        ),
        (
            compile_domain,
            {"domain": [["project_id", "=", 7], [f"properties.{CONTAINER}.priority", "=", "high"]]},
        ),
    ],
    ids=["discover", "read", "update", "search"],
)
@pytest.mark.parametrize("failure", ["access", "metadata"])
async def test_definition_failures_are_sanitized(client, transport, operation, arguments, failure):
    if failure == "access":
        transport.denied.add("test.parent")
        message, category = "Odoo access denied", "access_denied"
    else:
        del transport.metadata[CONTAINER]["definition_record_field"]
        message, category = "rediscover", "invalid_properties"
    with pytest.raises(ClassifiedToolError, match=message) as error:
        await operation(client, MODEL, **arguments)
    assert error.value.category == category
    no_opaque(str(error.value))


async def test_compile_native_domains_and_choices_before_pagination(client, transport):
    domain = [
        ["project_id", "=", 7],
        ["other_parent_id", "=", 9],
        [f"properties.{CONTAINER}.priority", "in", ["high", "normal"]],
        [f"properties.{CONTAINER}.estimated_effort", ">=", 0],
        ["properties.other_properties.owner", "=", 11],
    ]
    before = deepcopy(domain)
    assert await compile_domain(client, MODEL, domain) == [
        ["project_id", "=", 7],
        ["other_parent_id", "=", 9],
        [f"{CONTAINER}.{OPAQUE[0]}", "in", ["f001f00d", "f002f00d"]],
        [f"{CONTAINER}.{OPAQUE[1]}", ">=", 0],
        ["other_properties.f007f00d", "=", 11],
    ]
    assert domain == before
    assert all(call[0] != MODEL or call[1] != "read" for call in transport.calls)


@pytest.mark.parametrize(
    "scope",
    [
        [],
        [["project_id", "in", [7]]],
        [["project_id", "=", True]],
        [["project_id", "=", 0]],
        [["project_id", "=", 7], ["project_id", "=", 8]],
        [["project_id", "!=", 7]],
    ],
)
async def test_missing_or_ambiguous_scope(client, transport, scope):
    with pytest.raises(ClassifiedToolError, match="positive definition-parent"):
        await compile_domain(
            client, MODEL, [*scope, [f"properties.{CONTAINER}.priority", "=", "high"]]
        )


@pytest.mark.parametrize("prefix", ["|", "!", "&"])
async def test_complex_domains_rejected_without_naive_scope_extraction(client, transport, prefix):
    with pytest.raises(ClassifiedToolError, match="conjunction of leaves"):
        await compile_domain(
            client,
            MODEL,
            [prefix, ["project_id", "=", 7], [f"properties.{CONTAINER}.priority", "=", "high"]],
        )
    assert transport.calls == []


async def test_raw_domains_unchanged_including_or(client, transport):
    domain = ["|", ["project_id", "=", 7], ["name", "ilike", "Hello"]]
    assert await compile_domain(client, MODEL, domain) is domain
    assert transport.calls == []


async def test_raw_domain_values_resembling_paths_are_not_namespace_leaves(client, transport):
    domain = [["name", "in", ["properties.example", "=", "literal"]]]
    assert await compile_domain(client, MODEL, domain) is domain
    assert transport.calls == []


@pytest.mark.parametrize(
    ("name", "operator", "value", "message"),
    [
        ("channels", "in", "e_mail", "allowed operators: none"),
        ("channels", "in", ["e_mail"], "allowed operators: none"),
        ("channels", "=", ["e_mail"], "allowed operators: none"),
        ("priority", "ilike", "high", "allowed operators"),
        ("priority", [], "high", "allowed operators"),
        ("priority", "in", "high", "nonempty list"),
        ("priority", "in", [], "nonempty list"),
        ("priority", "=", "f001f00d", "friendly values"),
        ("estimated_effort", ">", None, "Null is only supported"),
        ("estimated_effort", "=", float("inf"), "rediscover"),
    ],
)
async def test_unsupported_or_invalid_predicates_are_friendly(
    client, transport, name, operator, value, message
):
    with pytest.raises(ClassifiedToolError, match=message) as error:
        await compile_domain(
            client,
            MODEL,
            [["project_id", "=", 7], [f"properties.{CONTAINER}.{name}", operator, value]],
        )
    no_opaque(str(error.value))


async def test_typed_values_and_normalized_relation_ids(client, transport):
    transport.definitions[8] = [
        definition("count", "Count", "integer"),
        definition("due", "Due", "date"),
        definition("started", "Started", "datetime"),
        definition("owner", "Owner", "many2one", comodel="res.partner"),
        definition("watchers", "Watchers", "many2many", comodel="res.partner"),
        definition("empty_watchers", "Empty watchers", "many2many", comodel="res.partner"),
    ]
    transport.rows[43][CONTAINER] = transport.entries(
        8,
        [
            0,
            "2026-10-30",
            "2026-10-30 12:00:00",
            [11, "Display"],
            [[11, "Display"], [12, "Other"]],
            False,
        ],
    )
    result = await read(client, MODEL, [43], [f"properties.{CONTAINER}"])
    assert result[0]["properties"][CONTAINER] == {
        "count": 0,
        "due": "2026-10-30",
        "started": "2026-10-30 12:00:00",
        "owner": 11,
        "watchers": [11, 12],
        "empty_watchers": [],
    }
    patch = {
        "count": 1,
        "due": "2026-11-01",
        "started": None,
        "owner": 12,
        "watchers": [13],
        "empty_watchers": [],
    }
    payload = await prepare_update(client, MODEL, 43, {CONTAINER: patch}, {})
    assert payload == {CONTAINER: {**patch, "started": False}}


@pytest.mark.parametrize(
    ("kind", "patch"),
    [
        ("integer", True),
        ("integer", 1.5),
        ("date", "yesterday"),
        ("datetime", "invalid"),
        ("many2one", [11, "Display"]),
        ("many2one", True),
        ("many2one", 0),
        ("many2many", [[11, "Display"]]),
        ("many2many", [True]),
        ("many2many", [0]),
        ("many2many", ["11"]),
    ],
)
async def test_patch_validator_rejects_display_pairs_and_wrong_kinds(
    client, transport, kind, patch
):
    extra = {"comodel": "res.partner"} if kind.startswith("many2") else {}
    transport.definitions[8] = [definition("f006f00d", "Other Name", kind, **extra)]
    transport.rows[43][CONTAINER] = transport.entries(8, [False])
    with pytest.raises(ClassifiedToolError):
        await prepare_update(client, MODEL, 43, {CONTAINER: {"other_name": patch}}, {})


async def test_unsupported_untouched_kind_fails(client, transport):
    transport.definitions[7].append(definition("internal-unsupported", "Unsupported", "json"))
    transport.rows[42][CONTAINER].append({**transport.definitions[7][-1], "value": None})
    with pytest.raises(ClassifiedToolError) as error:
        await prepare_update(client, MODEL, 42, {CONTAINER: {"notes": "Changed"}}, {})
    assert "internal-unsupported" not in str(error.value)


@pytest.mark.parametrize(
    "domain",
    [
        [["project_id", "=", 7], [f"properties.{CONTAINER}.priority", "="]],
        [
            [
                "children",
                "any",
                [["project_id", "=", 7], [f"properties.{CONTAINER}.priority", "=", "high"]],
            ]
        ],
    ],
)
async def test_nested_or_malformed_friendly_domains_rejected(client, transport, domain):
    with pytest.raises(ClassifiedToolError, match="conjunction of leaves"):
        await compile_domain(client, MODEL, domain)
    assert transport.calls == []


async def test_preflight_preserves_client_write_safety_guard(client, transport):
    guarded = []

    async def refuse(operation):
        guarded.append(operation)
        return False

    client.set_safety_context(SafetyContext(confirm=refuse))
    payload = await prepare_update(client, MODEL, 42, {CONTAINER: {"notes": "Changed"}}, {})
    # The installed client exempts READs from confirmation; the caller's write
    # must still encounter exactly the original guard after preparing the payload.
    assert guarded == []
    with pytest.raises(OdooSafetyError):
        await client.write(MODEL, [42], payload)
    assert len(guarded) == 1 and guarded[0].level == "WRITE"


async def test_mixed_raw_container_and_friendly_read_is_rejected(client, transport):
    with pytest.raises(ClassifiedToolError, match="friendly properties paths"):
        await read(client, MODEL, [42], ["other_properties", f"properties.{CONTAINER}"])


@pytest.mark.parametrize("kind", ["char", "json"])
async def test_container_type_comes_from_metadata(client, transport, kind):
    transport.metadata[CONTAINER]["type"] = kind
    with pytest.raises(ClassifiedToolError, match="container"):
        await prepare_update(client, MODEL, 42, {CONTAINER: {"notes": "Changed"}}, {})


async def test_unknown_container_is_friendly(client):
    with pytest.raises(ClassifiedToolError, match="container") as error:
        await read(client, MODEL, [42], ["properties.f001f00d"])
    no_opaque(str(error.value))


async def test_missing_definition_parent_fails_safely(client, transport):
    transport.rows[42]["project_id"] = False
    with pytest.raises(ClassifiedToolError, match="definition parent"):
        await read(client, MODEL, [42], [f"properties.{CONTAINER}"])


async def test_empty_id_read(client, transport):
    assert await read(client, MODEL, [], [f"properties.{CONTAINER}"]) == []
