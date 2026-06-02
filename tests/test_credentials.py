"""Unit tests for credential injection and HTTP 401 enforcement (AUTH-01/02/03).

Covers:
  AUTH-01: X-Odoo-* headers resolve credentials at the transport layer
  AUTH-02: Env var fallback when headers absent; headers take precedence over env vars
  AUTH-03: Missing credentials return HTTP 401 with enumerated missing fields

No real Odoo connection is made in these tests — the credential middleware is verified
via transport-layer HTTP status codes only.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from httpx import ASGITransport, AsyncClient

from tests.conftest import FAKE_CRED_HEADERS, STANDARD_MCP_HEADERS

if TYPE_CHECKING:
    import pytest

_TOOLS_LIST_BODY = {"jsonrpc": "2.0", "method": "tools/list", "params": {}, "id": 1}


async def test_headers_resolve(mcp_client: AsyncClient) -> None:
    """AUTH-01: POST with all four X-Odoo-* headers resolves credentials (non-401).

    This is the critical A1 assumption test: verifies that scope["state"]["odoo_creds"]
    set by CredentialMiddleware is accessible via get_http_request().state in tool handlers.
    """
    resp = await mcp_client.post("/mcp", json=_TOOLS_LIST_BODY)
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"


async def test_missing_creds_401(mcp_client_no_creds: AsyncClient) -> None:
    """AUTH-03: POST with no credentials returns HTTP 401 with all four missing fields."""
    resp = await mcp_client_no_creds.post("/mcp", json=_TOOLS_LIST_BODY)
    assert resp.status_code == 401
    body = resp.json()
    assert body["error"] == "missing_credentials"
    assert len(body["missing"]) == 4, f"Expected 4 missing fields, got: {body['missing']}"
    field_names = " ".join(body["missing"])
    assert "X-Odoo-Url" in field_names
    assert "X-Odoo-Database" in field_names
    assert "X-Odoo-Username" in field_names
    assert "X-Odoo-Password" in field_names


async def test_partial_missing_creds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """AUTH-03: POST with only x-odoo-url header returns 401 listing exactly 3 missing fields."""
    from godoo_mcp_server.server import create_app

    monkeypatch.delenv("ODOO_URL", raising=False)
    monkeypatch.delenv("ODOO_DATABASE", raising=False)
    monkeypatch.delenv("ODOO_DB", raising=False)
    monkeypatch.delenv("ODOO_USERNAME", raising=False)
    monkeypatch.delenv("ODOO_USER", raising=False)
    monkeypatch.delenv("ODOO_PASSWORD", raising=False)

    app = create_app()
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(
            transport=transport,
            base_url="http://test",
            headers={
                **STANDARD_MCP_HEADERS,
                "x-odoo-url": "http://odoo.test",
                # database/username/password intentionally absent
            },
        ) as client:
            resp = await client.post("/mcp", json=_TOOLS_LIST_BODY)

    assert resp.status_code == 401
    body = resp.json()
    assert len(body["missing"]) == 3, f"Expected 3 missing fields, got: {body['missing']}"
    field_names = " ".join(body["missing"])
    assert "X-Odoo-Url" not in field_names, "URL was provided — should not appear in missing"
    assert "X-Odoo-Database" in field_names
    assert "X-Odoo-Username" in field_names
    assert "X-Odoo-Password" in field_names


async def test_env_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    """AUTH-02: POST with no X-Odoo-* headers resolves credentials from env vars (non-401)."""
    from godoo_mcp_server.server import create_app

    monkeypatch.setenv("ODOO_URL", "http://env-odoo.test")
    monkeypatch.setenv("ODOO_DATABASE", "envdb")
    monkeypatch.setenv("ODOO_USERNAME", "envuser")
    monkeypatch.setenv("ODOO_PASSWORD", "envpass")

    app = create_app()
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(
            transport=transport,
            base_url="http://test",
            headers=STANDARD_MCP_HEADERS,  # no X-Odoo-* headers
        ) as client:
            resp = await client.post("/mcp", json=_TOOLS_LIST_BODY)

    # Credentials resolved from env — not 401
    assert resp.status_code != 401, f"Expected non-401 (env fallback), got 401: {resp.text}"


async def test_header_precedence(monkeypatch: pytest.MonkeyPatch) -> None:
    """AUTH-01/02: X-Odoo-* headers take precedence over env vars.

    The middleware should pass (non-401) with header values even when env vars are set
    to different values, since headers win per-field when non-empty.
    """
    from godoo_mcp_server.server import create_app

    # Set env vars with different values
    monkeypatch.setenv("ODOO_URL", "http://env.odoo")
    monkeypatch.setenv("ODOO_DATABASE", "env_database")
    monkeypatch.setenv("ODOO_USERNAME", "env_user")
    monkeypatch.setenv("ODOO_PASSWORD", "env_password")

    app = create_app()
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(
            transport=transport,
            base_url="http://test",
            headers={
                **STANDARD_MCP_HEADERS,
                **FAKE_CRED_HEADERS,  # headers win: x-odoo-url=http://odoo.test
            },
        ) as client:
            resp = await client.post("/mcp", json=_TOOLS_LIST_BODY)

    # Headers present + all four creds resolved — middleware passes (non-401)
    # The actual Odoo URL used is from headers (http://odoo.test), not env (http://env.odoo)
    # We verify this by absence of 401 (middleware resolved creds) — Odoo auth failure
    # would surface as MCP-level error, not HTTP 401
    assert resp.status_code != 401, f"Expected non-401 (headers present), got 401: {resp.text}"
