# Odoo MCP Server — Skills Index

This guide explains how to work with any Odoo instance through the godoo MCP server.
The server exposes a small set of raw Odoo primitives. Use this guide to understand
which tools exist and how to combine them effectively.

## What You Can Do

The server provides six tool groups:

**Record primitives** — search, read, create, update, and delete records on any Odoo model.
Use these for the bulk of your data access and manipulation work.

**Mail and chatter** — post messages, log internal notes, and read the message thread
on any record that supports chatter. Also schedule, list, and complete scheduled activities.
See `skill://odoo/mail/chatter.md` and `skill://odoo/mail/activities.md` for details.

**Actions** — list server actions and window actions available in the instance, and
execute server actions against a target record. Use this to trigger Odoo workflows and
automations.

**Attachments** — list files attached to a record, upload new attachments, and download
existing ones. Attachments are linked to model + record pairs.

**Users** — confirm your authenticated identity and search for other users by name or
login. Use `users_whoami` first to verify credentials are working before doing other work.

**Discovery** — explore the Odoo instance schema without knowing it in advance. List
all installed models, inspect a model's fields and their types, and browse the menu
hierarchy to understand how the instance is structured.
See `skill://odoo/base/properties.md` for the discovery workflow.

## How to Start

**Confirm authentication first.** Call `users_whoami` before anything else. It tells
you the authenticated username, user identifier, and database. If it returns an error,
the credentials are wrong — stop and fix them before proceeding.

**Explore the schema.** Call `discovery_list_models` to see all models installed in the
instance. Each model has a technical name (the identifier used in all tool calls) and a
display name. Pass the technical name to `discovery_get_fields` to inspect the model's
fields, their types, whether they are required, and what related models they point to.

**Find records.** Call `record_search` with a model name and an optional domain filter.
The domain is a list of `[field, operator, value]` triples following Odoo domain syntax
(described below). The default limit is 80. This returns record identifiers.

**Read record data.** Pass the identifiers from `record_search` to `record_read` along
with the fields you want. Requesting fewer fields is faster — only request what you need.

## Domain Syntax

Odoo domains are lists of conditions. Each condition is a three-element list:
`[field_path, operator, value]`. Example: `[["name", "=", "ACME Corp"]]`.

Multiple conditions are joined with `&` (AND) by default. Use `|` before two conditions
for OR. Use `!` before one condition for NOT. Operators include `=`, `!=`, `<`, `>`,
`<=`, `>=`, `like`, `ilike` (case-insensitive), `in`, `not in`.

An empty domain `[]` matches all records.

## Skill Files

Detailed procedural guides for specific topic areas:

- `skill://odoo/SKILL.md` — this file (index)
- `skill://odoo/mail/chatter.md` — posting messages, logging notes, reading message history
- `skill://odoo/mail/activities.md` — scheduling, listing, and completing activities
- `skill://odoo/base/properties.md` — model discovery, field inspection, access patterns

## Important Patterns

**Default limit.** `record_search` defaults to limit=80. Pass `limit` explicitly if you
need more or fewer records.

**Error handling.** All tools return an error response (`isError: true`) when Odoo
raises an exception (authentication failure, access denied, invalid field, etc.). Read
the error text — it describes what went wrong. Do not retry identical calls; diagnose
the error first.

**Cold catalog.** The MCP resource `odoo://model/{name}` reads from an in-process cache
warmed by prior `discovery_get_fields` calls. If the cache is cold (first request, or
server restarted), the resource returns a not-found descriptor. Call
`discovery_get_fields` to warm the cache, then read the resource again.

**Action resources.** The resource `odoo://action/{id}` is a placeholder. To list and
run actions, use `action_list_actions` and `action_execute_action` tools directly —
they operate with your live credentials and return current data.

**Record operations require identifiers.** `record_read`, `record_update`, and
`record_delete` all take a list of numeric record identifiers. Always search first to
get identifiers, then act on them.

**Chatter and activities.** Not every model supports chatter. Models that inherit from
the mail mixin support `mail_post_message`, `mail_list_messages`, and activity tools.
Models that do not inherit the mail mixin will return an error — check the model's
fields with `discovery_get_fields` if unsure.

## Workflow Example

1. Call `users_whoami` — confirm identity and database.
2. Call `discovery_list_models` — find the technical name of the model you need.
3. Call `discovery_get_fields` on that model — learn its fields and their types.
4. Call `record_search` with a domain to find relevant records.
5. Call `record_read` with the returned identifiers to get field values.
6. Call `record_create`, `record_update`, or `record_delete` to make changes.
7. Call `mail_post_message` to notify stakeholders via the record's chatter.
