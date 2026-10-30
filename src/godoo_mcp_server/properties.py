"""Request-local friendly names over the client's definition-aware properties API.

All operations use en_US labels. ``prepare_update`` only returns a payload: the
caller owns the single write, its safety context and uncertain-outcome handling.
"""

from __future__ import annotations

import re
import unicodedata
from contextlib import contextmanager
from copy import deepcopy
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from godoo.client.errors import OdooError, OdooValidationError
from godoo.client.services.properties import properties_to_write_format
from godoo.client.services.properties.codec import patch_values

from godoo_mcp_server.odoo_runtime import ClassifiedToolError, safe_tool_error

if TYPE_CHECKING:
    from collections.abc import Iterator

    from godoo.client.client import OdooClient
    from godoo.client.services.properties import PropertyDefinition, PropertyDefinitions


def _invalid(message: str) -> ClassifiedToolError:
    return ClassifiedToolError(message, category="invalid_properties")


@contextmanager
def _errors() -> Iterator[None]:
    try:
        yield
    except OdooValidationError:
        raise _invalid(
            "Property definitions or values are invalid or changed; rediscover properties, "
            "check all current values and the definition parent, then try again."
        ) from None
    except OdooError as error:
        raise safe_tool_error(error) from None


def _positive_id(value: Any) -> bool:
    return type(value) is int and value > 0


def _name(label: str) -> str:
    return re.sub(r"[\W_]+", "_", unicodedata.normalize("NFC", label).casefold()).strip("_")


@dataclass
class _Names:
    definitions: dict[str, PropertyDefinition]
    choices: dict[str, dict[str, str]]

    @classmethod
    def build(cls, definitions: PropertyDefinitions) -> _Names:
        names: dict[str, PropertyDefinition] = {}
        choices: dict[str, dict[str, str]] = {}
        for definition in definitions.values():
            if definition.type == "separator":
                continue
            name = _name(definition.label)
            if not name or name in names:
                raise _invalid(
                    "Property labels produce empty or duplicate friendly names; "
                    "rename the labels in Odoo and rediscover properties."
                )
            names[name] = definition
            options: dict[str, str] = {}
            for option in definition.options.values():
                alias = _name(option.label)
                if not alias or alias in options:
                    raise _invalid(
                        "Option labels produce empty or duplicate friendly names; "
                        "rename the choices in Odoo and rediscover properties."
                    )
                options[alias] = option.id
            choices[name] = options
        return cls(names, choices)

    def definition(self, name: str) -> PropertyDefinition:
        if name not in self.definitions:
            raise _invalid("Unknown property name; rediscover properties after label changes.")
        return self.definitions[name]

    def describe(self) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        for name, definition in self.definitions.items():
            item: dict[str, Any] = {
                "name": name,
                "label": definition.label,
                "type": definition.type,
            }
            if definition.comodel is not None:
                item["comodel"] = definition.comodel
            if definition.type in ("selection", "tags"):
                item["values"] = [
                    {"name": alias, "label": definition.options[oid].label}
                    for alias, oid in self.choices[name].items()
                ]
            result.append(item)
        return result

    def decode(self, name: str, value: Any) -> Any:
        definition = self.definition(name)
        if value is None or definition.type not in ("selection", "tags"):
            return value
        reverse = {oid: alias for alias, oid in self.choices[name].items()}
        return [reverse[item] for item in value] if definition.type == "tags" else reverse[value]

    def encode(self, name: str, value: Any) -> Any:
        definition = self.definition(name)
        if value is False and definition.type != "boolean":
            raise _invalid("False is only valid for boolean properties; use null to clear.")
        if value is None or definition.type not in ("selection", "tags"):
            return value
        aliases = value if definition.type == "tags" else [value]
        options = self.choices[name]
        if not isinstance(aliases, list) or any(
            not isinstance(alias, str) or alias not in options for alias in aliases
        ):
            raise _invalid("Unknown or malformed property choice; use discovered friendly values.")
        return (
            [options[alias] for alias in aliases] if definition.type == "tags" else options[value]
        )


def _container(metadata: dict[str, Any], field: str) -> dict[str, Any]:
    info = metadata.get(field)
    if not isinstance(info, dict) or info.get("type") != "properties":
        raise _invalid("Unknown or inaccessible properties container; discover model fields first.")
    return info


def _path(path: str, *, leaf: bool = False) -> tuple[str, str | None]:
    parts = path.split(".")
    if len(parts) not in ((3,) if leaf else (2, 3)) or parts[0] != "properties" or not all(parts):
        raise _invalid("Use properties.<container>.<name>, or properties.<container> for reads.")
    return parts[1], parts[2] if len(parts) == 3 else None


async def discover(
    client: OdooClient,
    model: str,
    record_id: int | None = None,
    property_field: str | None = None,
    parent_id: int | None = None,
) -> dict[str, object]:
    """Describe all record containers, or one container under an explicit parent."""
    record_scope = record_id is not None and property_field is None and parent_id is None
    parent_scope = record_id is None and property_field is not None and parent_id is not None
    if not (record_scope or parent_scope) or not _positive_id(
        record_id if record_scope else parent_id
    ):
        raise _invalid("Supply a positive record_id OR property_field and a positive parent_id.")
    with _errors(), client.with_context(lang="en_US"):
        metadata = await client.fields_get(model)
        if parent_scope:
            assert property_field is not None and parent_id is not None
            _container(metadata, property_field)
            definitions = await client.properties.definitions(
                model, field=property_field, parent_id=parent_id, context={"lang": "en_US"}
            )
            return {property_field: _Names.build(definitions).describe()}
        assert record_id is not None
        result: dict[str, object] = {}
        for field, info in metadata.items():
            if isinstance(info, dict) and info.get("type") == "properties":
                record = await client.properties.read(
                    model, record_id, field=field, fields=[], context={"lang": "en_US"}
                )
                result[field] = _Names.build(record.property_definitions).describe()
        if not result:
            await client.read(model, [record_id], ["id"])
        return result


async def read(
    client: OdooClient, model: str, ids: list[int], fields: list[str]
) -> list[dict[str, Any]]:
    """Read complete validated values, projecting only explicitly requested paths."""
    requested: dict[str, list[str | None]] = {}
    ordinary: list[str] = []
    for field in fields:
        if field.startswith("properties."):
            container, name = _path(field)
            requested.setdefault(container, []).append(name)
        else:
            ordinary.append(field)
    if not requested:
        return await client.read(model, ids, fields)
    with _errors(), client.with_context(lang="en_US"):
        metadata = await client.fields_get(model)
        if any(metadata.get(field, {}).get("type") == "properties" for field in ordinary):
            raise _invalid("Use friendly properties paths for containers in a friendly read.")
        result: dict[int, dict[str, Any]] = {}
        for container, selected in requested.items():
            _container(metadata, container)
            records = await client.properties.read(
                model, ids, field=container, fields=ordinary, context={"lang": "en_US"}
            )
            for record in records:
                names = _Names.build(record.property_definitions)
                for name in selected:
                    if name is not None:
                        names.definition(name)
                projected = {
                    name: names.decode(name, record.properties[definition.id])
                    for name, definition in names.definitions.items()
                    if None in selected or name in selected
                }
                row = result.setdefault(
                    record.id,
                    {key: deepcopy(record.record[key]) for key in ["id", *ordinary]},
                )
                row.setdefault("properties", {})[container] = projected
        return [result[rid] for rid in ids]


def _entry(definition: PropertyDefinition, value: Any) -> dict[str, Any]:
    entry = {
        "name": definition.id,
        "string": definition.label,
        "type": definition.type,
        "comodel": definition.comodel,
        "value": value,
    }
    if definition.type in ("selection", "tags"):
        entry[definition.type] = [
            [option.id, option.label, option.color]
            if definition.type == "tags"
            else [option.id, option.label]
            for option in definition.options.values()
        ]
    return entry


async def prepare_update(
    client: OdooClient,
    model: str,
    record_id: int,
    properties: dict[str, dict[str, Any]],
    values: dict[str, Any],
) -> dict[str, Any]:
    """Validate sparse changes and return complete raw containers plus ordinary values.

    Visible values are read before merging. Concurrent changes, parent moves and
    hidden stored keys remain outside this non-atomic preflight's guarantees.
    """
    properties, values = deepcopy(properties), deepcopy(values)
    if (
        not _positive_id(record_id)
        or not isinstance(properties, dict)
        or not properties
        or not isinstance(values, dict)
        or any(
            not isinstance(container, str)
            or not isinstance(patch, dict)
            or not patch
            or any(not isinstance(name, str) for name in patch)
            for container, patch in properties.items()
        )
    ):
        raise _invalid(
            "Property updates require one positive record ID and nonempty property patches."
        )
    with _errors(), client.with_context(lang="en_US"):
        metadata = await client.fields_get(model)
        for container in properties:
            info = _container(metadata, container)
            if info.get("definition_record") in values:
                raise _invalid(
                    "Change the definition parent separately, then rediscover properties."
                )
        if any(metadata.get(field, {}).get("type") == "properties" for field in values):
            raise _invalid("Do not mix raw properties containers with friendly property changes.")
        result = dict(values)
        for container, patch in properties.items():
            record = await client.properties.read(
                model, record_id, field=container, fields=[], context={"lang": "en_US"}
            )
            names = _Names.build(record.property_definitions)
            current = dict(record.properties)
            current.update(
                patch_values(
                    (
                        (names.definition(name).id, names.encode(name, value))
                        for name, value in patch.items()
                    ),
                    record.property_definitions,
                )
            )
            result[container] = properties_to_write_format(
                [
                    _entry(definition, current[definition.id])
                    for definition in names.definitions.values()
                ]
            )
        return result


_EQUALITY = {"=", "!="}
_COMPARISON = _EQUALITY | {">", ">=", "<", "<="}
_OPERATORS = {
    "boolean": _EQUALITY,
    "integer": _COMPARISON,
    "float": _COMPARISON,
    "date": _COMPARISON,
    "datetime": _COMPARISON,
    "char": _EQUALITY | {"ilike", "not ilike"},
    "selection": _EQUALITY | {"in", "not in"},
    "many2one": _EQUALITY | {"in", "not in"},
}


def _predicate(names: _Names, name: str, operator: str, value: Any) -> Any:
    definition = names.definition(name)
    allowed = _OPERATORS.get(definition.type, set())
    if not isinstance(operator, str) or operator not in allowed:
        raise _invalid(
            f"Unsupported operator for {definition.type} properties; allowed operators: "
            + (", ".join(sorted(allowed)) or "none (array property search is not supported yet)")
            + "."
        )
    if operator in ("in", "not in"):
        if not isinstance(value, list) or not value or any(item is None for item in value):
            raise _invalid("Property membership requires a nonempty list of friendly values.")
        return [_predicate(names, name, "=", item) for item in value]
    if value is None and operator not in _EQUALITY:
        raise _invalid("Null is only supported with = or != for properties.")
    encoded = names.encode(name, value)
    validated = patch_values([(definition.id, encoded)], {definition.id: definition})
    return properties_to_write_format([_entry(definition, validated[definition.id])])[definition.id]


async def compile_domain(client: OdooClient, model: str, domain: list[Any]) -> list[Any]:
    """Compile a pure conjunction with one positive parent equality per container.

    Raw domains are returned unchanged. Array predicates are deliberately refused:
    Odoo18 expression.py and Odoo19 fields_properties.py compile membership and
    equality differently, so ordinary ``in`` would promise misleading semantics.
    """

    def friendly(item: Any) -> bool:
        return (
            isinstance(item, (list, tuple))
            and len(item) > 0
            and isinstance(item[0], str)
            and item[0].startswith("properties.")
        )

    def nested_friendly(item: Any) -> bool:
        return (
            isinstance(item, (list, tuple))
            and len(item) == 3
            and isinstance(item[1], str)
            and item[1] in ("any", "not any", "any!", "not any!")
            and contains_friendly(item[2])
        )

    def contains_friendly(items: Any) -> bool:
        return isinstance(items, (list, tuple)) and any(
            friendly(item) or nested_friendly(item) for item in items
        )

    if not contains_friendly(domain):
        return domain
    domain = deepcopy(domain)
    if any(
        not isinstance(item, (list, tuple)) or len(item) != 3 or nested_friendly(item)
        for item in domain
    ):
        raise _invalid(
            "Friendly property domains require a conjunction of leaves; OR/NOT is unsupported."
        )
    with _errors(), client.with_context(lang="en_US"):
        metadata = await client.fields_get(model)
        scopes: dict[str, _Names] = {}
        result: list[Any] = []
        for item in domain:
            if not friendly(item):
                result.append(item)
                continue
            path, operator, value = item
            container, name = _path(path, leaf=True)
            assert name is not None
            if container not in scopes:
                info = _container(metadata, container)
                parent_field = info.get("definition_record")
                parent_leaves = [leaf for leaf in domain if leaf[0] == parent_field]
                if (
                    not isinstance(parent_field, str)
                    or not parent_leaves
                    or any(leaf[1] != "=" or not _positive_id(leaf[2]) for leaf in parent_leaves)
                    or len({leaf[2] for leaf in parent_leaves}) != 1
                ):
                    raise _invalid(
                        "Friendly property predicates require one positive definition-parent "
                        "equality under AND for each container."
                    )
                definitions = await client.properties.definitions(
                    model,
                    field=container,
                    parent_id=parent_leaves[0][2],
                    context={"lang": "en_US"},
                )
                scopes[container] = _Names.build(definitions)
            names = scopes[container]
            native_value = _predicate(names, name, operator, value)
            result.append([f"{container}.{names.definition(name).id}", operator, native_value])
        return result
