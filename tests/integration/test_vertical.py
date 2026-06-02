"""Integration tests for the full vertical slice against a real Odoo container.

Covers:
  TRANS-02 (integration): tools/list + users_whoami against live Odoo
  AUTH-04: Two concurrent requests with different credentials see different UIDs
  SC-3: create → search → read → update → delete round-trip on res.partner.category
  SC-4: invalid domain → OdooError → isError=True with Odoo message, no traceback
  SC-5: credential resolution → Odoo authenticate → record_search path verified

All tests are marked @pytest.mark.integration and are excluded from the default pytest run
(addopts = "-m 'not integration'" in pyproject.toml). Run explicitly with:
    uv run pytest -m integration --tb=short
"""

from __future__ import annotations

import asyncio
import json
from typing import TYPE_CHECKING, Any

import pytest

if TYPE_CHECKING:
    from collections.abc import Callable

    from godoo.testcontainers import StartedOdooContainer

_MCP_PATH = "/mcp"

_TOOLS_LIST_BODY: dict[str, Any] = {
    "jsonrpc": "2.0",
    "method": "tools/list",
    "params": {},
    "id": 1,
}

_WHOAMI_CALL_BODY: dict[str, Any] = {
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {"name": "users_whoami", "arguments": {}},
    "id": 2,
}


def _parse_sse_json(text: str) -> dict[str, Any]:
    """Parse JSON payload from an MCP SSE response body.

    MCP Streamable HTTP response format:
      event: message\\r\\ndata: {JSON}\\r\\n\\r\\n
    """
    for line in text.splitlines():
        if line.startswith("data:"):
            return json.loads(line[len("data:") :].strip())  # type: ignore[return-value]
    return json.loads(text)  # type: ignore[return-value]


@pytest.mark.integration
class TestVerticalSlice:
    """Full vertical slice + concurrency isolation tests against real Odoo."""

    async def test_tools_list(
        self,
        mcp_client_factory: Callable[..., Any],
        odoo_harness: StartedOdooContainer,
    ) -> None:
        """TRANS-02: tools/list returns HTTP 200 with valid MCP response against real Odoo."""
        client = mcp_client_factory(
            url=odoo_harness.url,
            database=odoo_harness._database,
            username="admin",
            password="admin",
        )
        async with client:
            resp = await client.post(_MCP_PATH, json=_TOOLS_LIST_BODY)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        body = _parse_sse_json(resp.text)
        result = body.get("result", {})
        tools = result.get("tools", []) if isinstance(result, dict) else []
        tool_names = [t["name"] for t in tools if isinstance(t, dict)]
        assert "users_whoami" in tool_names, (
            f"users_whoami not in tools list. Available: {tool_names}"
        )

    async def test_full_vertical(
        self,
        mcp_client_factory: Callable[..., Any],
        odoo_harness: StartedOdooContainer,
    ) -> None:
        """TRANS-02: full connect -> tools/list -> tools/call -> real Odoo RPC path."""
        client = mcp_client_factory(
            url=odoo_harness.url,
            database=odoo_harness._database,
            username="admin",
            password="admin",
        )
        async with client:
            resp = await client.post(_MCP_PATH, json=_WHOAMI_CALL_BODY)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        body = _parse_sse_json(resp.text)
        result_text = body["result"]["content"][0]["text"]
        result = json.loads(result_text)
        assert "uid" in result, f"'uid' missing from users_whoami response: {result}"
        assert isinstance(result["uid"], int), f"uid is not int: {result['uid']!r}"
        assert result["uid"] > 0, f"uid must be positive, got: {result['uid']}"
        assert "database" in result, f"'database' missing from users_whoami response: {result}"
        assert "username" in result, f"'username' missing from users_whoami response: {result}"
        assert isinstance(result["username"], str), f"username is not str: {result['username']!r}"

    async def test_concurrent_isolation(
        self,
        mcp_client_factory: Callable[..., Any],
        odoo_harness: StartedOdooContainer,
        second_user_credentials: tuple[str, str],
    ) -> None:
        """AUTH-04: Two concurrent requests with different creds return different UIDs."""
        user2_login, user2_password = second_user_credentials

        async def _call_whoami(username: str, password: str) -> dict[str, Any]:
            client = mcp_client_factory(
                url=odoo_harness.url,
                database=odoo_harness._database,
                username=username,
                password=password,
            )
            async with client:
                resp = await client.post(_MCP_PATH, json=_WHOAMI_CALL_BODY)
            assert resp.status_code == 200, (
                f"whoami failed for {username!r}: {resp.status_code}: {resp.text}"
            )
            body = _parse_sse_json(resp.text)
            result_text = body["result"]["content"][0]["text"]
            return json.loads(result_text)  # type: ignore[return-value]

        results = await asyncio.gather(
            _call_whoami("admin", "admin"),
            _call_whoami(user2_login, user2_password),
        )
        assert results[0]["uid"] != results[1]["uid"], (
            f"Cross-user bleed: both requests returned uid={results[0]['uid']}"
        )

    async def test_record_crud_roundtrip(
        self,
        mcp_client_factory: Callable[..., Any],
        odoo_harness: StartedOdooContainer,
    ) -> None:
        """SC-3: create → search → read → update → delete round-trip on res.partner.category."""
        client = mcp_client_factory(
            url=odoo_harness.url,
            database=odoo_harness._database,
            username="admin",
            password="admin",
        )
        async with client:
            # create
            resp = await client.post(
                _MCP_PATH,
                json={
                    "jsonrpc": "2.0",
                    "method": "tools/call",
                    "params": {
                        "name": "record_create",
                        "arguments": {
                            "model": "res.partner.category",
                            "values": {"name": "Phase3TestTag"},
                        },
                    },
                    "id": 10,
                },
            )
            assert resp.status_code == 200
            create_body = _parse_sse_json(resp.text)
            assert create_body.get("result", {}).get("isError") is not True, (
                f"record_create returned isError: {create_body}"
            )
            create_result = json.loads(create_body["result"]["content"][0]["text"])
            assert "id" in create_result, (
                f"'id' missing from record_create response: {create_result}"
            )
            new_id: int = create_result["id"]
            assert isinstance(new_id, int) and new_id > 0, (
                f"Expected positive int id, got: {new_id!r}"
            )

            # search by name
            resp = await client.post(
                _MCP_PATH,
                json={
                    "jsonrpc": "2.0",
                    "method": "tools/call",
                    "params": {
                        "name": "record_search",
                        "arguments": {
                            "model": "res.partner.category",
                            "domain": [["name", "=", "Phase3TestTag"]],
                        },
                    },
                    "id": 11,
                },
            )
            assert resp.status_code == 200
            search_body = _parse_sse_json(resp.text)
            assert search_body.get("result", {}).get("isError") is not True, (
                f"record_search returned isError: {search_body}"
            )
            search_result = json.loads(search_body["result"]["content"][0]["text"])
            assert "records" in search_result, f"'records' missing: {search_result}"
            assert len(search_result["records"]) > 0, "Expected non-empty search result"
            assert search_result["records"][0]["id"] == new_id, (
                f"Search did not return created record id={new_id}"
            )

            # read by id
            resp = await client.post(
                _MCP_PATH,
                json={
                    "jsonrpc": "2.0",
                    "method": "tools/call",
                    "params": {
                        "name": "record_read",
                        "arguments": {
                            "model": "res.partner.category",
                            "ids": [new_id],
                        },
                    },
                    "id": 12,
                },
            )
            assert resp.status_code == 200
            read_body = _parse_sse_json(resp.text)
            assert read_body.get("result", {}).get("isError") is not True, (
                f"record_read returned isError: {read_body}"
            )
            read_result = json.loads(read_body["result"]["content"][0]["text"])
            assert "records" in read_result, f"'records' missing: {read_result}"
            assert isinstance(read_result["records"], list), "records must be a list"

            # update name
            resp = await client.post(
                _MCP_PATH,
                json={
                    "jsonrpc": "2.0",
                    "method": "tools/call",
                    "params": {
                        "name": "record_update",
                        "arguments": {
                            "model": "res.partner.category",
                            "ids": [new_id],
                            "values": {"name": "Phase3TestTagUpdated"},
                        },
                    },
                    "id": 13,
                },
            )
            assert resp.status_code == 200
            update_body = _parse_sse_json(resp.text)
            assert update_body.get("result", {}).get("isError") is not True, (
                f"record_update returned isError: {update_body}"
            )
            update_result = json.loads(update_body["result"]["content"][0]["text"])
            assert update_result.get("success") is True, (
                f"record_update did not return success=True: {update_result}"
            )

            # delete
            resp = await client.post(
                _MCP_PATH,
                json={
                    "jsonrpc": "2.0",
                    "method": "tools/call",
                    "params": {
                        "name": "record_delete",
                        "arguments": {
                            "model": "res.partner.category",
                            "ids": [new_id],
                        },
                    },
                    "id": 14,
                },
            )
            assert resp.status_code == 200
            delete_body = _parse_sse_json(resp.text)
            assert delete_body.get("result", {}).get("isError") is not True, (
                f"record_delete returned isError: {delete_body}"
            )
            delete_result = json.loads(delete_body["result"]["content"][0]["text"])
            assert delete_result.get("success") is True, (
                f"record_delete did not return success=True: {delete_result}"
            )

            # verify deletion — final search should return empty
            resp = await client.post(
                _MCP_PATH,
                json={
                    "jsonrpc": "2.0",
                    "method": "tools/call",
                    "params": {
                        "name": "record_search",
                        "arguments": {
                            "model": "res.partner.category",
                            "domain": [["id", "=", new_id]],
                        },
                    },
                    "id": 15,
                },
            )
            assert resp.status_code == 200
            final_search_body = _parse_sse_json(resp.text)
            final_search_result = json.loads(final_search_body["result"]["content"][0]["text"])
            records_after_delete = final_search_result.get("records", [])
            assert len(records_after_delete) == 0, (
                f"Record id={new_id} still found after delete: {records_after_delete}"
            )

    async def test_invalid_domain_structured_error(
        self,
        mcp_client_factory: Callable[..., Any],
        odoo_harness: StartedOdooContainer,
    ) -> None:
        """SC-4: invalid domain → OdooError → isError=True with Odoo message, no traceback."""
        client = mcp_client_factory(
            url=odoo_harness.url,
            database=odoo_harness._database,
            username="admin",
            password="admin",
        )
        async with client:
            resp = await client.post(
                _MCP_PATH,
                json={
                    "jsonrpc": "2.0",
                    "method": "tools/call",
                    "params": {
                        "name": "record_search",
                        "arguments": {
                            "model": "res.partner",
                            "domain": [["nonexistent_field_xyz", "=", "value"]],
                        },
                    },
                    "id": 20,
                },
            )
        assert resp.status_code == 200
        body = _parse_sse_json(resp.text)
        result = body.get("result", {})
        assert isinstance(result, dict)
        assert result.get("isError") is True, (
            f"Expected isError=True for invalid domain, got: {result}"
        )
        content = result.get("content", [])
        assert len(content) > 0, "Expected non-empty content in error response"
        error_text = content[0].get("text", "")
        assert isinstance(error_text, str) and len(error_text) > 0, (
            "Expected non-empty error text string"
        )
        assert "Traceback" not in error_text, (
            f"Python traceback leaked into error response: {error_text[:200]}"
        )

    async def test_credential_resolution_record_search(
        self,
        mcp_client_factory: Callable[..., Any],
        odoo_harness: StartedOdooContainer,
    ) -> None:
        """SC-5: credential resolution → Odoo authenticate → record_search path verified."""
        client = mcp_client_factory(
            url=odoo_harness.url,
            database=odoo_harness._database,
            username="admin",
            password="admin",
        )
        async with client:
            resp = await client.post(
                _MCP_PATH,
                json={
                    "jsonrpc": "2.0",
                    "method": "tools/call",
                    "params": {
                        "name": "record_search",
                        "arguments": {
                            "model": "res.partner",
                            "domain": [["active", "=", True]],
                            "limit": 5,
                        },
                    },
                    "id": 30,
                },
            )
        assert resp.status_code == 200
        body = _parse_sse_json(resp.text)
        result = body.get("result", {})
        assert isinstance(result, dict)
        assert result.get("isError") is not True, (
            f"record_search with valid credentials returned isError: {result}"
        )
        search_result = json.loads(result["content"][0]["text"])
        assert "records" in search_result, f"'records' key missing from response: {search_result}"
        assert isinstance(search_result["records"], list), (
            f"'records' is not a list: {search_result['records']!r}"
        )
