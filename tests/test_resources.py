"""Unit tests for MCP resource registration and skill file serving (RES-01, SKILL-01, SKILL-02).

Covers:
  RES-01: odoo:// catalog resources registered and reachable
  SKILL-01: skill:// resources registered and skill files served as MCP Resources
  SKILL-02: _load_skills() startup assertion — all declared skill files must load
  D-13: odoo://action/{id} registered as Option B warm-from-cache placeholder
  D-14: skill .md files bundled in package and loadable via importlib.resources
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, cast

if TYPE_CHECKING:
    from httpx import AsyncClient

# ---------------------------------------------------------------------------
# Helpers (copied from test_records.py / test_users.py)
# ---------------------------------------------------------------------------


def _parse_sse_json(text: str) -> dict[str, object]:
    """Parse the JSON payload from an MCP SSE response body.

    MCP Streamable HTTP response format:
      event: message\\r\\ndata: {JSON}\\r\\n\\r\\n
    """
    for line in text.splitlines():
        if line.startswith("data:"):
            return cast(dict[str, object], json.loads(line[len("data:"):].strip()))
    return cast(dict[str, object], json.loads(text))


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_RESOURCES_LIST_BODY: dict[str, object] = {
    "jsonrpc": "2.0",
    "method": "resources/list",
    "params": {},
    "id": 1,
}

_TOOLS_LIST_BODY: dict[str, object] = {
    "jsonrpc": "2.0",
    "method": "tools/list",
    "params": {},
    "id": 1,
}


def _resource_read_body(uri: str) -> dict[str, object]:
    """Build an MCP resources/read JSON-RPC request."""
    return {
        "jsonrpc": "2.0",
        "method": "resources/read",
        "params": {"uri": uri},
        "id": 1,
    }


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


async def test_skill_resources_in_list(mcp_client: AsyncClient) -> None:
    """SKILL-01/RES-01: skill://index.json must appear in resources/list."""
    resp = await mcp_client.post("/mcp", json=_RESOURCES_LIST_BODY)
    assert resp.status_code == 200
    body = _parse_sse_json(resp.text)
    result = body.get("result", {})
    resources = result.get("resources", []) if isinstance(result, dict) else []
    assert isinstance(resources, list)
    uris = [r.get("uri") for r in resources if isinstance(r, dict)]
    assert "skill://index.json" in uris, f"skill://index.json not in resources: {uris}"


async def test_skill_index_read(mcp_client: AsyncClient) -> None:
    """SKILL-01: resources/read on skill://index.json returns valid JSON with 'skills' key."""
    resp = await mcp_client.post("/mcp", json=_resource_read_body("skill://index.json"))
    assert resp.status_code == 200
    body = _parse_sse_json(resp.text)
    result = body.get("result", {})
    assert isinstance(result, dict)
    # Must not be an error response
    assert result.get("isError") is not True, f"Unexpected isError: {result}"
    # Expect contents list with at least one item
    contents = result.get("contents", [])
    assert isinstance(contents, list)
    assert len(contents) > 0, f"Expected contents in result, got: {result}"
    first = contents[0]
    assert isinstance(first, dict)
    text = first.get("text", "")
    assert isinstance(text, str)
    assert len(text) > 0, "Expected non-empty text content"
    # Parse as JSON and verify 'skills' key
    index = json.loads(text)
    assert "skills" in index, f"'skills' key not in index: {index}"


async def test_skill_file_chatter(mcp_client: AsyncClient) -> None:
    """SKILL-01: resources/read on skill://odoo/mail/chatter.md returns non-empty markdown."""
    resp = await mcp_client.post("/mcp", json=_resource_read_body("skill://odoo/mail/chatter.md"))
    assert resp.status_code == 200
    body = _parse_sse_json(resp.text)
    result = body.get("result", {})
    assert isinstance(result, dict)
    assert result.get("isError") is not True, f"Unexpected isError: {result}"
    contents = result.get("contents", [])
    assert isinstance(contents, list)
    assert len(contents) > 0
    first = contents[0]
    assert isinstance(first, dict)
    text = first.get("text", "")
    assert isinstance(text, str)
    assert len(text) > 0, "Expected non-empty markdown content for chatter.md"
    assert "Not Found" not in text, f"Skill file not found: {text}"


async def test_skill_file_root(mcp_client: AsyncClient) -> None:
    """SKILL-01/D-14: resources/read on skill://odoo/SKILL.md returns non-empty markdown."""
    resp = await mcp_client.post("/mcp", json=_resource_read_body("skill://odoo/SKILL.md"))
    assert resp.status_code == 200
    body = _parse_sse_json(resp.text)
    result = body.get("result", {})
    assert isinstance(result, dict)
    assert result.get("isError") is not True, f"Unexpected isError: {result}"
    contents = result.get("contents", [])
    assert isinstance(contents, list)
    assert len(contents) > 0
    first = contents[0]
    assert isinstance(first, dict)
    text = first.get("text", "")
    assert isinstance(text, str)
    assert len(text) > 0, "Expected non-empty markdown content for SKILL.md"
    assert "Not Found" not in text, f"Skill file not found: {text}"


async def test_model_resource_cold_cache(mcp_client: AsyncClient) -> None:
    """RES-01: odoo://model/res.partner with cold cache returns error dict (not exception)."""
    resp = await mcp_client.post("/mcp", json=_resource_read_body("odoo://model/res.partner"))
    assert resp.status_code == 200
    body = _parse_sse_json(resp.text)
    result = body.get("result", {})
    assert isinstance(result, dict)
    # Should be a valid MCP response, not a server error (isError is for tool errors)
    # For resource read, content is in 'contents'
    contents = result.get("contents", [])
    assert isinstance(contents, list)
    assert len(contents) > 0, f"Expected contents in resource response, got: {result}"
    first = contents[0]
    assert isinstance(first, dict)
    text = first.get("text", "")
    assert isinstance(text, str)
    assert "model_not_found" in text, f"Expected model_not_found error dict, got: {text}"


async def test_action_resource_cold_cache(mcp_client: AsyncClient) -> None:
    """D-13: odoo://action/1 Option B placeholder — returns action_not_found error dict.

    The odoo://action/{id} resource is a warm-from-cache placeholder per D-13.
    It always returns an error dict pointing agents to action_list_actions tool.
    It must NOT raise a server exception.
    """
    resp = await mcp_client.post("/mcp", json=_resource_read_body("odoo://action/1"))
    assert resp.status_code == 200
    body = _parse_sse_json(resp.text)
    result = body.get("result", {})
    assert isinstance(result, dict)
    contents = result.get("contents", [])
    assert isinstance(contents, list)
    assert len(contents) > 0, f"Expected contents in resource response, got: {result}"
    first = contents[0]
    assert isinstance(first, dict)
    text = first.get("text", "")
    assert isinstance(text, str)
    assert "action_not_found" in text, f"Expected action_not_found in response, got: {text}"
    assert "action_list_actions" in text, (
        f"Expected hint pointing to action_list_actions, got: {text}"
    )


async def test_menu_resource_cold_cache(mcp_client: AsyncClient) -> None:
    """D-13/RES-01: odoo://menu/1 Option B placeholder — returns menu_not_found error dict.

    The odoo://menu/{id} resource is a warm-from-cache placeholder per D-13.
    It always returns an error dict pointing agents to discovery_list_menus tool.
    It must NOT raise a server exception.
    """
    resp = await mcp_client.post("/mcp", json=_resource_read_body("odoo://menu/1"))
    assert resp.status_code == 200
    body = _parse_sse_json(resp.text)
    result = body.get("result", {})
    assert isinstance(result, dict)
    contents = result.get("contents", [])
    assert isinstance(contents, list)
    assert len(contents) > 0, f"Expected contents in resource response, got: {result}"
    first = contents[0]
    assert isinstance(first, dict)
    text = first.get("text", "")
    assert isinstance(text, str)
    assert "menu_not_found" in text, f"Expected menu_not_found in response, got: {text}"
    assert "discovery_list_menus" in text, (
        f"Expected hint pointing to discovery_list_menus, got: {text}"
    )


async def test_startup_assertion_all_skill_paths_loaded() -> None:
    """SKILL-02: _SKILL_FILES contains all 4 declared paths with non-empty content.

    This verifies that _load_skills() startup assertion passes — if any skill file
    were missing, module import would have raised AssertionError (server fails to start).
    """
    from godoo_mcp_server.resources import _SKILL_FILES, _SKILL_PATHS

    assert set(_SKILL_FILES.keys()) == set(_SKILL_PATHS), (
        f"Skill file mismatch: loaded={set(_SKILL_FILES.keys())} expected={set(_SKILL_PATHS)}"
    )
    for p in _SKILL_PATHS:
        assert len(_SKILL_FILES[p]) > 0, f"Skill file '{p}' is empty"


async def test_all_tools_in_list(mcp_client: AsyncClient) -> None:
    """Smoke test: tools/list contains all registered tool names (full surface wired)."""
    resp = await mcp_client.post("/mcp", json=_TOOLS_LIST_BODY)
    assert resp.status_code == 200
    body = _parse_sse_json(resp.text)
    result = body.get("result", {})
    tools = result.get("tools", []) if isinstance(result, dict) else []
    assert isinstance(tools, list)
    tool_names = {t["name"] for t in tools if isinstance(t, dict)}
    # All tool groups must be present
    expected_tools = {
        # records
        "record_search",
        "record_read",
        "record_create",
        "record_update",
        "record_delete",
        # mail
        "mail_post_message",
        "mail_log_note",
        "mail_list_messages",
        "mail_schedule_activity",
        "mail_list_activities",
        "mail_mark_activity_done",
        # actions
        "action_list_actions",
        "action_execute_action",
        # attachments
        "attachments_list",
        "attachments_upload",
        "attachments_download",
        # users
        "users_whoami",
        "users_search_users",
        # discovery
        "discovery_list_models",
        "discovery_get_fields",
        "discovery_list_menus",
    }
    missing = expected_tools - tool_names
    assert not missing, (
        f"Missing tools from tools/list: {missing}. Available: {tool_names}"
    )
    # At minimum 17 tools registered (plan requirement)
    assert len(tool_names) >= 17, f"Expected >=17 tools, got {len(tool_names)}: {tool_names}"
