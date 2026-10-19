"""MCP resource registration: odoo:// catalog resources + skill:// file resources.

Model resources are scoped to the authenticated Odoo UID and target. A resource
request without an authenticated UID receives a cold-cache result; skill resources
remain available to every request.
"""

from __future__ import annotations

import importlib.resources
from typing import Annotated, Any, NamedTuple, TypedDict

from fastmcp.exceptions import ToolError
from fastmcp.server.dependencies import get_http_request
from godoo.client.client import OdooClient, OdooClientConfig
from godoo.client.errors import OdooError
from pydantic import Field

from godoo_mcp_server.catalog import CatalogModelRow, get_model_entry_from_cache
from godoo_mcp_server.odoo_runtime import managed_odoo_client, safe_tool_error
from godoo_mcp_server.server import mcp

# ---------------------------------------------------------------------------
# Skill file loading (runs at import time — SKILL-02 startup assertion)
# ---------------------------------------------------------------------------


class GuidanceTopic(NamedTuple):
    title: str
    description: str


# One manifest drives packaged loading, discovery metadata and tool path schema.
_SKILL_TOPICS = {
    "SKILL.md": GuidanceTopic("Odoo", "Start here: select a workflow for the current Odoo target."),
    "base/properties.md": GuidanceTopic("Schema discovery", "Inspect models and field metadata."),
    "base/field-types.md": GuidanceTopic(
        "Field formats", "Relations, selections and date formats."
    ),
    "base/queries.md": GuidanceTopic("Queries", "Bounded searches, domains and stage semantics."),
    "base/record-changes.md": GuidanceTopic(
        "Record changes", "CRUD, relation commands and readback."
    ),
    "base/dynamic-properties.md": GuidanceTopic(
        "Dynamic properties", "Replacement semantics and concurrency limits for property values."
    ),
    "mail/chatter.md": GuidanceTopic(
        "Chatter", "Messages, internal notes, recipients and mentions."
    ),
    "mail/activities.md": GuidanceTopic("Activities", "Type discovery, scheduling and completion."),
}
_SKILL_PATHS = list(_SKILL_TOPICS)
_SKILL_FILES: dict[str, str] = {}  # populated at import; never mutated after


def _load_skills() -> None:
    """Load all declared skill .md files from bundled package data.

    Uses importlib.resources to read files from the installed package — this
    works correctly whether the package is installed as a wheel or from source.

    Raises AssertionError if any declared skill file is missing (SKILL-02).
    """
    pkg = importlib.resources.files("godoo_mcp_server") / "skills"
    for p in _SKILL_PATHS:
        node = pkg
        for part in p.split("/"):
            node = node / part
        _SKILL_FILES[p] = node.read_text(encoding="utf-8")
    # SKILL-02 startup assertion: every declared path must be loadable
    assert set(_SKILL_FILES.keys()) == set(_SKILL_PATHS), (
        f"Skill file mismatch: loaded={set(_SKILL_FILES.keys())} expected={set(_SKILL_PATHS)}"
    )


_load_skills()  # runs at side-effect import time (server.py imports this module)


# ---------------------------------------------------------------------------
# odoo:// catalog resources
# ---------------------------------------------------------------------------


class ModelResourceNotFound(TypedDict):
    error: str
    model: str
    hint: str


@mcp.resource(
    "odoo://model/{name}",
    name="Odoo Model",
    description=(
        "Model metadata and fields for a named Odoo model. "
        "Cache-served; use discovery_get_fields for current field metadata."
    ),
    mime_type="application/json",
)
async def read_model_resource(name: str) -> CatalogModelRow | ModelResourceNotFound:
    """Return cached model metadata for the given model name.

    Returns an error dict (not an exception) when the cache is cold.
    Callers can invoke discovery_get_fields for current field metadata directly.
    """
    request = get_http_request()
    creds = request.state.odoo_creds
    config = OdooClientConfig(
        url=creds.url,
        database=creds.database,
        username=creds.username,
        password=creds.password,
    )
    try:
        async with managed_odoo_client(OdooClient(config)) as client:
            session = client.get_session()
            uid = session.uid if session is not None else None
    except OdooError as error:
        raise safe_tool_error(error) from None
    entry = (
        get_model_entry_from_cache(name, url=creds.url, database=creds.database, uid=uid)
        if isinstance(uid, int) and uid > 0
        else None
    )
    if entry is None:
        return {
            "error": "model_not_found",
            "model": name,
            "hint": "call discovery_get_fields for current field metadata",
        }
    return entry


@mcp.resource(
    "odoo://action/{id}",
    name="Odoo Action",
    description=(
        "Action metadata. Cache-backed placeholder (Option B, D-13): "
        "use action_list_actions tool to enumerate actions."
    ),
    mime_type="application/json",
)
async def read_action_resource(id: str) -> dict[str, Any]:
    """Return a cache-backed placeholder for action resources (Option B, D-13).

    There is no get_action_entry_from_cache() — catalog.py only introspects
    ir.model, not ir.actions.*. This resource always returns an error dict
    directing agents to the action_list_actions tool.
    """
    return {
        "error": "action_not_found",
        "id": id,
        "hint": (
            "call action_list_actions to list actions, then use action_execute_action to run them"
        ),
    }


@mcp.resource(
    "odoo://menu/{id}",
    name="Odoo Menu",
    description=(
        "Menu metadata. Cache-backed placeholder (Option B, D-13): "
        "use discovery_list_menus tool to enumerate menus."
    ),
    mime_type="application/json",
)
async def read_menu_resource(id: str) -> dict[str, Any]:
    """Return a cache-backed placeholder for menu resources (Option B, D-13).

    There is no get_menu_entry_from_cache() — catalog.py only introspects
    ir.model, not ir.ui.menu.*. This resource always returns an error dict
    directing agents to the discovery_list_menus tool.
    """
    return {
        "error": "menu_not_found",
        "id": id,
        "hint": "call discovery_list_menus tool to list menus",
    }


# ---------------------------------------------------------------------------
# skill:// file resources
# ---------------------------------------------------------------------------


@mcp.resource(
    "skill://index.json",
    name="Skill Discovery Index",
    mime_type="application/json",
)
def read_skill_index() -> dict[str, Any]:
    """Return the skill discovery index for MCP clients that support skill discovery."""
    return {
        "$schema": "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
        "skills": [
            {
                "type": "skill-md",
                "name": "odoo",
                "description": "Odoo ERP integration over MCP.",
                "url": "skill://odoo/SKILL.md",
            }
        ],
        "topics": [
            {
                "path": path,
                "title": topic.title,
                "description": topic.description,
                "url": f"skill://odoo/{path}",
            }
            for path, topic in _SKILL_TOPICS.items()
        ],
    }


@mcp.resource(
    "skill://odoo/{path*}",
    name="Odoo Skill File",
    mime_type="text/markdown",
)
def read_skill_file(path: str) -> str:
    """Return the content of a bundled skill .md file.

    Uses a pre-populated dict lookup — no filesystem traversal (T-04-05-05).
    Any path not in _SKILL_FILES returns a not-found markdown string.
    """
    content = _SKILL_FILES.get(path)
    if content is None:
        return f"# Not Found\n\nSkill file '{path}' not found."
    return content


@mcp.tool(
    name="guidance_get",
    description=(
        "Read bundled Odoo guidance before using Odoo tools. Defaults to the skills index; "
        "select a listed path for detailed guidance. Also available via skill://odoo/{path} "
        "resources. Guidance does not grant write approval or override client policy."
    ),
    annotations={"readOnlyHint": True, "openWorldHint": False},
)
def guidance_get(
    path: Annotated[str, Field(json_schema_extra={"enum": _SKILL_PATHS})] = "SKILL.md",
) -> str:
    """Expose the same bundled guidance to clients that only expose MCP tools."""
    if path not in _SKILL_FILES:
        raise ToolError("Unknown guidance path; use a path listed in the guidance index")
    return _SKILL_FILES[path]
