"""MCP resource registration: odoo:// catalog resources + skill:// file resources.

IMPORTANT: Resource resolvers cannot use get_http_request() — no per-request
credentials are available in the resources/read dispatch path. Resolvers read
from the catalog cache (warmed by prior tool calls) or from bundled skill files.
"""

from __future__ import annotations

import importlib.resources
from typing import Any

from godoo_mcp_server.catalog import get_model_entry_from_cache
from godoo_mcp_server.server import mcp

# ---------------------------------------------------------------------------
# Skill file loading (runs at import time — SKILL-02 startup assertion)
# ---------------------------------------------------------------------------

_SKILL_PATHS = [
    "SKILL.md",
    "mail/chatter.md",
    "mail/activities.md",
    "base/properties.md",
]
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


@mcp.resource(
    "odoo://model/{name}",
    name="Odoo Model",
    description=(
        "Model metadata and fields for a named Odoo model. "
        "Cache-served: call discovery_get_fields first to warm."
    ),
    mime_type="application/json",
)
async def read_model_resource(name: str) -> dict[str, Any]:
    """Return cached model metadata for the given model name.

    Returns an error dict (not an exception) when the cache is cold.
    Callers should invoke discovery_get_fields to warm the catalog first.
    """
    entry = get_model_entry_from_cache(name)
    if entry is None:
        return {
            "error": "model_not_found",
            "model": name,
            "hint": "call discovery_get_fields to warm the catalog",
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
        "hint": "call action_list_actions tool to list actions, then use action_execute_action to run them",
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
