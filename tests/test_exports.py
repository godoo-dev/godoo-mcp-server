"""Record delivery contracts; also run against Miniflare by `just r2`."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, Mock
from urllib.parse import parse_qs, urlsplit

import httpx
import obstore
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import Encoding, NoEncryption, PrivateFormat
from godoo.client.errors import OdooAccessError
from obstore.store import MemoryStore

from godoo_mcp_server import artifacts
from godoo_mcp_server.artifacts import ArtifactStorage
from godoo_mcp_server.server import create_app
from godoo_mcp_server.tools import records
from tests.test_records import _parse_sse_json, _tool_call_body


@pytest.fixture
async def storage(monkeypatch):
    if os.environ.get("R2_TEST_ENDPOINT"):
        storage = ArtifactStorage.from_env()
    else:
        storage = ArtifactStorage(MemoryStore())
        monkeypatch.setattr(ArtifactStorage, "from_env", lambda: storage)
        monkeypatch.setattr(
            obstore, "sign_async", AsyncMock(return_value="https://download.test/file")
        )
    yield storage
    async for page in obstore.list(storage.store):
        for item in page:
            await obstore.delete_async(storage.store, item["path"])


@pytest.fixture
async def backend(storage, monkeypatch):
    client = AsyncMock()
    client.__aenter__.return_value = client
    client.search_read.return_value = client.read.return_value = [
        {"id": 1, "name": "PRIVATE-ROW" + "é" * 300, "amount": 1e-7, "total": 1e20}
    ]
    monkeypatch.setattr(records, "OdooClient", Mock(return_value=client))
    return client


async def call(client, tool="record_search", **arguments):
    arguments = {
        "model": "res.partner",
        **({"ids": [1]} if tool == "record_read" else {}),
        **arguments,
    }
    response = await client.post("/mcp", json=_tool_call_body(tool, arguments))
    assert response.status_code == 200
    return _parse_sse_json(response.text)["result"]


@pytest.mark.parametrize("tool", ["record_search", "record_read"])
async def test_delivery_and_exact_byte_boundary(mcp_client, backend, storage, tool, caplog):
    inline = await call(mcp_client, tool, max_return_bytes=None)
    content = inline["content"][0]["text"].encode()
    exact = await call(mcp_client, tool, max_return_bytes=len(content))
    assert exact["structuredContent"] == inline["structuredContent"]
    for arguments in ({}, {"max_return_bytes": len(content) - 1}, {"max_return_bytes": 0}):
        result = await call(mcp_client, tool, **arguments)
        receipt = result["structuredContent"]
        assert json.loads(result["content"][0]["text"]) == receipt
        assert "PRIVATE-ROW" not in json.dumps(result) + caplog.text
        assert receipt["row_count"] == 1 and receipt["size_bytes"] == len(content)
        assert receipt["sha256"] == hashlib.sha256(content).hexdigest()
        assert receipt["expires_in_seconds"] == 3600 and receipt["retention_seconds"] == 5400
        expires = datetime.fromisoformat(receipt["expires_at"])
        assert datetime.fromisoformat(receipt["delete_after"]) >= expires + timedelta(minutes=30)
        key = f"exports/v1/5400/{receipt['artifact_id']}.json"
        assert await (await obstore.get_async(storage.store, key)).bytes_async() == content
        if os.environ.get("R2_TEST_ENDPOINT"):
            url = receipt["download_url"]
            async with httpx.AsyncClient() as download:
                response = await download.get(url)
                assert response.content == content
                assert response.headers["cache-control"] == "no-store"
                invalid_urls = [url.split("?")[0], url.replace("3600", "1")]
                for invalid in invalid_urls:
                    assert (await download.get(invalid)).status_code == 403
    if os.environ.get("R2_TEST_ENDPOINT"):
        short = await obstore.sign_async(storage.store, "GET", key, timedelta(seconds=1))
        await asyncio.sleep(1.1)
        async with httpx.AsyncClient() as download:
            assert (await download.get(short)).status_code == 403
    assert (backend.search_read if tool == "record_search" else backend.read).await_count == 5


async def test_query_arguments_and_empty_delivery(mcp_client, backend):
    backend.search_read.return_value = []
    assert (await call(mcp_client))["structuredContent"]["records"] == []
    query = dict(
        domain=[["active", "=", True]], fields=["name"], limit=2, offset=3, order="id desc"
    )
    result = await call(mcp_client, **query, max_return_bytes=0)
    assert result["structuredContent"]["delivery"] == "artifact"
    backend.search_read.assert_awaited_with("res.partner", query.pop("domain"), **query)
    await call(mcp_client, "record_read", ids=[4, 2], fields=None, max_return_bytes=0)
    backend.read.assert_awaited_once_with("res.partner", [4, 2], None)


@pytest.mark.parametrize("value", [-1, 0.5, True])
async def test_invalid_threshold_precedes_odoo(mcp_client, backend, value):
    assert (await call(mcp_client, max_return_bytes=value))["isError"]
    backend.search_read.assert_not_awaited()


@pytest.mark.parametrize("failure", ["access", "config", "size"])
async def test_failure_never_spills_rows(mcp_client, backend, storage, monkeypatch, failure):
    secret = "PROVIDER-SECRET"
    if failure == "access":
        backend.search_read.side_effect = OdooAccessError(secret)
    elif failure == "config":
        monkeypatch.setattr(
            ArtifactStorage, "from_env", Mock(side_effect=artifacts.export_error("Invalid storage"))
        )
    elif failure == "size":
        monkeypatch.setattr(artifacts, "MAX_ARTIFACT_BYTES", 1)
    result = await call(mcp_client)
    assert result["isError"]
    assert secret not in json.dumps(result) and "PRIVATE-ROW" not in json.dumps(result)
    assert [item async for page in obstore.list(storage.store) for item in page] == []


@pytest.mark.parametrize("error", [RuntimeError("SECRET"), asyncio.CancelledError()])
async def test_committed_upload_failure_is_cleaned(storage, monkeypatch, tmp_path, error):
    put = obstore.put_async

    async def failed_upload(*args, **kwargs):
        await put(*args, **kwargs)
        raise error

    monkeypatch.setattr(obstore, "put_async", failed_upload)
    file = tmp_path / "result.json"
    file.write_bytes(b"private")
    expected = asyncio.CancelledError if isinstance(error, asyncio.CancelledError) else Exception
    with pytest.raises(expected) as caught:
        await storage.publish(file, "c" * 32)
    assert "SECRET" not in str(caught.value)
    assert [item async for page in obstore.list(storage.store) for item in page] == []


async def test_cleanup_uses_persisted_deadlines(storage):
    keys = [f"exports/v1/{seconds}/{n * 32}.json" for seconds, n in [(5400, "a"), (600, "b")]]
    for key in [*keys, "unrelated", "exports/v1/1/not-managed.json"]:
        await obstore.put_async(storage.store, key, b"private")
    objects = {item["path"]: item async for page in obstore.list(storage.store) for item in page}
    modified = objects[keys[0]]["last_modified"]
    restarted = ArtifactStorage(storage.store, 1, 0)
    assert await restarted.cleanup_expired(now=modified + timedelta(minutes=89)) == 1
    assert await restarted.cleanup_expired(now=modified + timedelta(minutes=90)) == 1
    assert await restarted.cleanup_expired(now=modified + timedelta(minutes=91)) == 0
    assert {item["path"] async for page in obstore.list(storage.store) for item in page} == {
        "unrelated",
        "exports/v1/1/not-managed.json",
    }


async def test_cleanup_worker_stops_with_server(monkeypatch):
    started, stopped = asyncio.Event(), asyncio.Event()

    async def sweep():
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            stopped.set()

    monkeypatch.setenv("ODOO_EXPORT_PROVIDER", "r2")
    monkeypatch.setattr(ArtifactStorage, "from_env", lambda: Mock(cleanup_expired=sweep))
    app = create_app()
    async with app.router.lifespan_context(app):
        await asyncio.wait_for(started.wait(), 1)
    assert stopped.is_set()


@pytest.mark.parametrize("provider", ["r2", "s3", "gcs"])
async def test_provider_configuration_and_signing(monkeypatch, provider):
    env = dict(
        ODOO_EXPORT_PROVIDER=provider,
        ODOO_EXPORT_BUCKET="private-exports",
        ODOO_EXPORT_ENDPOINT="https://example.r2.cloudflarestorage.com",
        ODOO_EXPORT_URL_TTL_MINUTES="15",
        ODOO_EXPORT_CLEANUP_GRACE_MINUTES="5",
        AWS_ACCESS_KEY_ID="test-access",
        AWS_SECRET_ACCESS_KEY="test-secret",
        AWS_REGION="eu-west-1",
        AWS_SKIP_SIGNATURE="true",
        AWS_ENDPOINT_URL_S3="https://wrong.test",
    )
    for name, value in env.items():
        monkeypatch.setenv(name, value)
    if provider == "gcs":
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        account = {
            "private_key_id": "test-key",
            "client_email": "test@example.iam.gserviceaccount.com",
            "private_key": key.private_bytes(
                Encoding.PEM, PrivateFormat.PKCS8, NoEncryption()
            ).decode(),
        }
        monkeypatch.setenv("GOOGLE_SERVICE_ACCOUNT_KEY", json.dumps(account))
    storage = ArtifactStorage.from_env()
    url = await obstore.sign_async(
        storage.store, "GET", "exports/test.json", storage.download_lifetime
    )
    assert parse_qs(urlsplit(url).query)[
        "X-Goog-Expires" if provider == "gcs" else "X-Amz-Expires"
    ] == ["900"]
    assert storage.retention_seconds == 1200
    if provider == "r2":
        assert urlsplit(url).hostname == "example.r2.cloudflarestorage.com"
    for name, value in [
        ("ODOO_EXPORT_PROVIDER", "unknown"),
        ("ODOO_EXPORT_BUCKET", ""),
        ("ODOO_EXPORT_URL_TTL_MINUTES", "0"),
        ("ODOO_EXPORT_CLEANUP_GRACE_MINUTES", "-1"),
        ("ODOO_EXPORT_ENDPOINT", "http://example.test"),
    ]:
        with monkeypatch.context() as patch:
            patch.setenv(name, value)
            if name.endswith("ENDPOINT") and provider == "gcs":
                continue
            with pytest.raises(Exception, match="not configured correctly"):
                ArtifactStorage.from_env()
