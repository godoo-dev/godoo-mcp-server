# Model Properties and Discovery

Odoo instances vary — different versions, different modules installed, custom fields
added by partners or in-house developers. Never assume you know the schema. Use the
discovery tools to inspect the actual structure of any Odoo instance before operating
on it.

## List Models

Use `discovery_list_models` to list up to 500 accessible models. A missing entry
does not prove a model or module is absent; use a focused `record_search` on
`ir.model` or request the known model's fields when permitted.

**When to use:** At the start of a task when you do not know the technical model name
yet, or when exploring an unfamiliar Odoo instance.

**What it returns:** A list of models. Each entry has a technical name (used in all
tool calls) and a human-readable label. The list reflects only models from installed
modules — modules that are not installed are not included.

**Pattern:**
1. Call `discovery_list_models`.
2. Scan the list for the model that matches your intent (by display name or technical
   name pattern).
3. Note the technical name — you will use it in all subsequent tool calls.

## Inspect a Model's Fields

Use `discovery_get_fields` to see the fields on a specific model.

**When to use:** Before reading records (to know what fields to request), before
creating records (to know what fields are required), or when you need to understand
how models are related to each other.

**Required information:** The technical model name obtained from `discovery_list_models`.

**What it returns:** A `fields` mapping keyed by field name. Each descriptor includes:
- The field identifier (the name used in domains and field lists)
- The field type (text, number, date, boolean, relationship, etc.)
- Whether the field is required
- For relationship fields: the technical name of the related model

**Pattern:**
1. Call `discovery_get_fields` with the model technical name.
2. Identify the fields relevant to your task.
3. Use those field identifiers in `record_search` domain conditions and `record_read`
   field lists.

For selection choices, explicitly request `attributes` including `selection` as
well as any other metadata you need; the default attributes omit it.
Use the returned metadata directly. This tool does not warm the model catalog cache.

For runtime-defined properties, pass `record_id` to obtain the existing record's
friendly property names and choices. Before a child exists, pass `property_field`
and `parent_id` instead. The extra `properties` result is parent-specific; use
the [dynamic properties guide](dynamic-properties.md) for read, update and search.

## Browse the Menu Hierarchy

Use `discovery_list_menus` to browse the application menu structure.

**When to use:** When you need to understand how the Odoo UI is organized — which
applications are installed, what sections exist under each application, or to map
menu entries to the models they display.

**What it returns:** A flat list of menu entries with parent references. Each entry has a display
name, an identifier, and optionally a parent entry. Top-level entries correspond to
main applications (Sales, Purchase, Accounting, etc.).

## Discover Before Operating

**The recommended pattern for working with an unfamiliar instance:**

1. Call `discovery_list_models` to find the model you need.
2. Call `discovery_get_fields` on that model to understand its structure.
3. Call `record_search` with a domain based on the fields you just discovered.
4. Call `record_read` with the field names you identified.

This pattern works on any Odoo version with any set of installed modules. Never
hardcode assumptions about field names or model structure — always discover first.

## Notes

Field identifiers and model technical names are stable within an Odoo version and
module set but can differ across versions or when modules are installed or uninstalled.
Always re-discover after a suspected schema change.

The catalog cache is in-process and lost on server restart; do not rely on a prior
request having warmed it. `discovery_get_fields` makes a direct authenticated call.
