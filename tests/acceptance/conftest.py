"""Session-scoped fixtures for integration tests (require Docker + real Odoo)."""

from __future__ import annotations

import asyncio
import datetime
import hashlib
import hmac
import json
import os
import shlex
import socket
import ssl
import subprocess
import uuid
import xml.etree.ElementTree as ET
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from functools import partial
from pathlib import Path
from typing import TYPE_CHECKING, Any
from urllib.parse import parse_qsl, quote, urlencode, urlsplit

import httpx
import pytest
import pytest_asyncio
import uvicorn
from godoo.testcontainers import TestHarness
from httpx import AsyncClient
from starlette.requests import Request
from starlette.responses import StreamingResponse

from .odoo_proof import observe, requested_major

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator, Callable


# Standard MCP headers required for every MCP request.
# Redefined here to avoid conftest import-chain issues — same values as tests/conftest.py.
STANDARD_MCP_HEADERS: dict[str, str] = {
    "content-type": "application/json",
    "accept": "application/json, text/event-stream",
    "mcp-protocol-version": "2026-07-28",
}


@pytest.fixture
def mcp_process_factory(tmp_path: Path, artifact_store) -> Callable[..., Any]:
    """Launch an owned server using the selected runtime, with real private storage."""

    @asynccontextmanager
    async def start(name: str = "mcp-process", *, code_policy: dict | None = None):
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = int(listener.getsockname()[1])
        log_path = tmp_path / f"{name}.log"
        root = Path(__file__).resolve().parents[2]
        image = os.environ.get("MCP_CANDIDATE_IMAGE")
        container = f"mcp-acceptance-{uuid.uuid4().hex}" if image else None
        environment = {
            key: value
            for key, value in os.environ.items()
            if not key.startswith("ODOO_") and key not in {"DEBUG", "AWS_SESSION_TOKEN"}
        }
        environment.update(artifact_store.environment)
        environment.update(HOST="127.0.0.1", PORT=str(port))
        if code_policy is not None:
            environment["ODOO_CODE_POLICY"] = json.dumps(code_policy)
        if image:
            command = [
                "docker",
                "create",
                "--name",
                container,
                "--network",
                "host",
            ]
            for key in [*artifact_store.environment, "HOST", "PORT", *(["ODOO_CODE_POLICY"] if code_policy is not None else [])]:
                command += [
                    "--env",
                    "NODE_EXTRA_CA_CERTS=/tmp/mcp-acceptance-ca.pem"
                    if key == "NODE_EXTRA_CA_CERTS"
                    else key,
                ]
            command += [image]
        else:
            command = shlex.split(os.environ.get("MCP_SERVER_COMMAND", ""))
            if not command:
                command = ["node", str(root / "dist" / "node.mjs")]

        async def docker(*arguments):
            result = await asyncio.to_thread(
                subprocess.run,
                ["docker", *arguments],
                check=True,
                capture_output=True,
                text=True,
                env=environment,
                timeout=30,
            )
            return result.stdout.strip()

        with log_path.open("wb") as log_file:
            process = None
            try:
                if image:
                    await docker(*command[1:])
                    # docker cp streams the certificate through the CLI, so the
                    # daemon need not see the runner's filesystem (including act).
                    await docker(
                        "cp",
                        str(artifact_store.cert),
                        f"{container}:/tmp/mcp-acceptance-ca.pem",
                    )
                    command = ["docker", "start", "--attach", container]
                process = await asyncio.create_subprocess_exec(
                    *command,
                    cwd=root,
                    stdout=log_file,
                    stderr=log_file,
                    env=environment,
                )
                url = f"http://127.0.0.1:{port}"
                handle = OwnedProcess(process, container)
                async with AsyncClient(timeout=1) as client:
                    deadline = asyncio.get_running_loop().time() + 45
                    while asyncio.get_running_loop().time() < deadline:
                        if process.returncode is not None:
                            raise AssertionError(log_path.read_text())
                        try:
                            if (await client.get(f"{url}/healthz")).status_code == 200:
                                break
                        except httpx.HTTPError:
                            pass
                        await asyncio.sleep(0.1)
                    else:
                        raise AssertionError(f"MCP health check timed out: {log_path.read_text()}")
                expected_version = os.environ.get("MCP_EXPECTED_VERSION")
                if image:
                    assert expected_version, "MCP_EXPECTED_VERSION is required for an image trial"
                    expected_image = await docker("image", "inspect", "--format", "{{.Id}}", image)
                    observed_image = await docker("inspect", "--format", "{{.Image}}", container)
                    assert observed_image == expected_image, (
                        "Running MCP image differs from candidate"
                    )
                    uid = int(await docker("exec", container, "id", "-u"))
                    assert uid > 0, "The candidate MCP server must run as non-root"
                    version = await docker("exec", container, "godoo-mcp-server", "--version")
                    assert version == expected_version, "Running MCP version differs from candidate"
                    record = {
                        "expected_image": expected_image,
                        "observed_image": observed_image,
                        "container_id": await docker("inspect", "--format", "{{.Id}}", container),
                        "uid": uid,
                        "version": version,
                    }
                    facts = os.environ.get("MCP_IMAGE_FACTS")
                    if facts:
                        with Path(facts).open("a") as stream:
                            stream.write(json.dumps(record) + "\n")
                    print("MCP_IMAGE_PROOF", json.dumps(record), flush=True)
                elif expected_version:
                    version_process = await asyncio.create_subprocess_exec(
                        *command,
                        "--version",
                        cwd=root,
                        env=environment,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE,
                    )
                    stdout, _stderr = await asyncio.wait_for(
                        version_process.communicate(), timeout=15
                    )
                    assert version_process.returncode == 0
                    assert stdout.decode().strip() == expected_version
                yield url, log_path, handle
            finally:
                if container:
                    await asyncio.to_thread(
                        subprocess.run,
                        ["docker", "rm", "-f", container],
                        capture_output=True,
                        timeout=15,
                    )
                if process is not None and process.returncode is None:
                    process.terminate()
                    try:
                        await asyncio.wait_for(process.wait(), timeout=5)
                    except TimeoutError:
                        process.kill()
                        await process.wait()

    return start


class OwnedProcess:
    """A container's process-kill test kills the server, not just its Docker CLI."""

    def __init__(self, process, container):
        self.process, self.container = process, container

    def kill(self):
        if self.container:
            subprocess.run(
                ["docker", "kill", self.container],
                check=True,
                capture_output=True,
                timeout=15,
            )
        else:
            self.process.kill()

    async def wait(self):
        return await self.process.wait()


@pytest_asyncio.fixture(loop_scope="session")
async def mcp_process(
    mcp_process_factory: Callable[..., Any],
) -> AsyncGenerator[tuple[str, Path]]:
    async with mcp_process_factory() as (url, log_path, _process):
        yield url, log_path


_SECOND_USER_LOGIN = "integration_test_user2"
_SECOND_USER_PASSWORD = "TestPass123!"


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def odoo_harness() -> AsyncGenerator[TestHarness]:
    """Use the selected disposable Odoo major, regardless of library defaults."""
    major = requested_major()
    async with TestHarness(
        modules=["base", "mail", "project"],
        snapshot=False,
        database="test_odoo",
        admin_password="admin",
    ) as harness:
        await observe(harness, major)
        yield harness


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def second_user_credentials(odoo_harness: TestHarness) -> tuple[str, str]:
    """A portal user has deliberately different model ACLs from the administrator."""
    groups = await odoo_harness.client.search_read(
        "ir.model.data",
        [["module", "=", "base"], ["name", "=", "group_portal"]],
        fields=["res_id"],
    )
    # Odoo19 renamed the explicitly assigned group relation; keep the portal ACL
    # fixture equivalent across both observed majors rather than omitting groups.
    group_field = "group_ids" if requested_major() >= 19 else "groups_id"
    user_id = await odoo_harness.client.create(
        "res.users",
        {
            "name": "Integration Portal User",
            "login": _SECOND_USER_LOGIN,
            "password": _SECOND_USER_PASSWORD,
            group_field: [(6, 0, [groups[0]["res_id"]])],
        },
    )
    assert isinstance(user_id, int) and user_id > 0
    return _SECOND_USER_LOGIN, _SECOND_USER_PASSWORD


@pytest.fixture
def mcp_client_factory(default_mcp) -> Callable[..., AsyncClient]:
    """Function-scoped factory: creates an AsyncClient per call with per-user X-Odoo-* headers.

    Returns un-entered AsyncClient instances — callers enter them with ``async with client:``.
    """

    class MCPClient(AsyncClient):
        def build_request(self, method: str, url: Any, **kwargs: Any) -> httpx.Request:
            body = kwargs.get("json")
            if isinstance(body, dict):
                params = body.setdefault("params", {})
                if isinstance(params, dict):
                    params.setdefault(
                        "_meta",
                        {
                            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                            "io.modelcontextprotocol/clientCapabilities": {},
                        },
                    )
                headers = dict(kwargs.pop("headers", {}) or {})
                headers["mcp-method"] = body["method"]
                if body["method"] == "tools/call":
                    headers["mcp-name"] = body["params"]["name"]
                elif body["method"] == "resources/read":
                    headers["mcp-name"] = body["params"]["uri"]
                kwargs["headers"] = headers
            return super().build_request(method, url, **kwargs)

    def _make(
        *,
        url: str,
        database: str,
        username: str,
        password: str,
        server_url: str | None = None,
        timeout: float = 30,
    ) -> AsyncClient:
        return MCPClient(
            base_url=server_url or default_mcp[0],
            timeout=timeout,
            headers={
                **STANDARD_MCP_HEADERS,
                "x-odoo-url": url,
                "x-odoo-database": database,
                "x-odoo-username": username,
                "x-odoo-password": password,
            },
        )

    return _make


@pytest.fixture
def odoo_clients(mcp_client_factory: Callable[..., AsyncClient], odoo_harness: TestHarness) -> Any:
    return partial(
        mcp_client_factory,
        url=odoo_harness.url,
        database=odoo_harness._database,
        username="admin",
        password="admin",
    )


@pytest_asyncio.fixture(loop_scope="session")
async def odoo_mcp(odoo_clients: Any) -> AsyncGenerator[AsyncClient]:
    async with odoo_clients() as client:
        yield client


@dataclass
class OdooReply:
    """Fault controls for a real committed Odoo write, never a simulated database."""

    url: str = ""
    model: str = "res.partner.category"
    marker: str = field(default_factory=lambda: f"reply-{uuid.uuid4()}")
    drop: bool = False
    writes: int = 0
    ids: list[int] = field(default_factory=list)
    committed: asyncio.Event = field(default_factory=asyncio.Event)
    release: asyncio.Event = field(default_factory=asyncio.Event)
    closed: asyncio.Event = field(default_factory=asyncio.Event)


@pytest_asyncio.fixture(loop_scope="session")
async def odoo_reply(odoo_harness: TestHarness) -> AsyncGenerator[OdooReply]:
    """Let Starlette/uvicorn handle HTTP; delay or truncate just the marked Odoo reply."""
    reply = OdooReply()
    async with AsyncClient(timeout=30) as upstream:

        async def proxy(scope: Any, receive: Any, send: Any) -> None:
            request = await Request(scope, receive).json()
            args = request.get("params", {}).get("args", [])
            marked = args[3:5] == [reply.model, "create"] and args[5][0].get("name") == reply.marker
            if marked:
                reply.writes += 1
            response = await upstream.post(f"{odoo_harness.url}/jsonrpc", json=request)

            async def body() -> AsyncGenerator[bytes]:
                try:
                    if marked:
                        record_id = response.json()["result"]
                        assert isinstance(record_id, int), response.text
                        reply.ids.append(record_id)
                        reply.committed.set()
                        if reply.drop:
                            raise ConnectionResetError("drop committed Odoo reply")
                        await reply.release.wait()
                    yield response.content
                finally:
                    if marked:
                        reply.closed.set()

            await StreamingResponse(
                body(), status_code=response.status_code, media_type="application/json"
            )(scope, receive, send)

        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            reply.url = f"http://127.0.0.1:{listener.getsockname()[1]}"
            server = uvicorn.Server(uvicorn.Config(proxy, lifespan="off", log_level="critical"))
            task = asyncio.create_task(server.serve(sockets=[listener]))
            try:
                async with asyncio.timeout(5):
                    while not server.started:
                        if task.done():
                            await task
                            raise AssertionError("Odoo reply proxy exited before startup")
                        await asyncio.sleep(0.01)
                yield reply
            finally:
                reply.release.set()
                server.should_exit = True
                await asyncio.wait_for(task, timeout=5)


@dataclass
class ArtifactStore:
    endpoint: str
    cert: Path

    @property
    def environment(self):
        return {
            "ODOO_EXPORT_PROVIDER": "r2",
            "ODOO_EXPORT_BUCKET": "private-exports",
            "ODOO_EXPORT_ENDPOINT": self.endpoint,
            "ODOO_EXPORT_URL_TTL_MINUTES": "60",
            "ODOO_EXPORT_CLEANUP_GRACE_MINUTES": "30",
            "AWS_ACCESS_KEY_ID": "test-access",
            "AWS_SECRET_ACCESS_KEY": "test-secret",
            "NODE_EXTRA_CA_CERTS": str(self.cert),
        }

    @property
    def tls(self):
        return ssl.create_default_context(cafile=str(self.cert))

    async def download(self, url):
        async with AsyncClient(verify=self.tls) as client:
            response = await client.get(url)
        assert response.status_code == 200, response.text
        return response.content

    async def keys(self):
        """Independently sign S3 list requests, checking actual Miniflare objects."""
        result, cursor = [], None
        async with AsyncClient(verify=self.tls) as client:
            while True:
                query = {"list-type": "2", "prefix": "exports/v1/"}
                if cursor is not None:
                    query["continuation-token"] = cursor
                url = f"{self.endpoint}/private-exports?{urlencode(query)}"
                response = await client.get(url, headers=self._headers(url))
                assert response.status_code == 200, response.text
                document = ET.fromstring(response.text)
                namespace = {"s3": "http://s3.amazonaws.com/doc/2006-03-01/"}
                result.extend(
                    element.text for element in document.findall("s3:Contents/s3:Key", namespace)
                )
                if document.findtext("s3:IsTruncated", namespaces=namespace) != "true":
                    return result
                next_cursor = document.findtext("s3:NextContinuationToken", namespaces=namespace)
                assert next_cursor and next_cursor != cursor
                cursor = next_cursor

    def _headers(self, url):
        """AWS Signature Version 4 for a bodyless test-owned GET."""
        now = datetime.datetime.now(datetime.UTC)
        date, stamp = now.strftime("%Y%m%d"), now.strftime("%Y%m%dT%H%M%SZ")
        parts = urlsplit(url)
        query = "&".join(
            f"{quote(key, safe='~-._')}={quote(value, safe='~-._')}"
            for key, value in sorted(parse_qsl(parts.query, keep_blank_values=True))
        )
        digest = hashlib.sha256(b"").hexdigest()
        signed = "host;x-amz-content-sha256;x-amz-date"
        canonical = (
            f"GET\n{parts.path}\n{query}\nhost:{parts.netloc}\n"
            f"x-amz-content-sha256:{digest}\nx-amz-date:{stamp}\n\n{signed}\n{digest}"
        )
        scope = f"{date}/auto/s3/aws4_request"
        message = (
            f"AWS4-HMAC-SHA256\n{stamp}\n{scope}\n{hashlib.sha256(canonical.encode()).hexdigest()}"
        )
        signing = b"AWS4test-secret"
        for value in (date, "auto", "s3", "aws4_request"):
            signing = hmac.new(signing, value.encode(), hashlib.sha256).digest()
        signature = hmac.new(signing, message.encode(), hashlib.sha256).hexdigest()
        return {
            "X-Amz-Date": stamp,
            "X-Amz-Content-Sha256": digest,
            "Authorization": (
                f"AWS4-HMAC-SHA256 Credential=test-access/{scope}, "
                f"SignedHeaders={signed}, Signature={signature}"
            ),
        }


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def artifact_store(tmp_path_factory):
    root = Path(__file__).resolve().parents[2]
    log_path = tmp_path_factory.mktemp("r2-service") / "service.log"
    with log_path.open("wb") as log:
        process = await asyncio.create_subprocess_exec(
            "node",
            str(root / ".github" / "testing" / "r2-service.mjs"),
            cwd=root,
            stdout=asyncio.subprocess.PIPE,
            stderr=log,
        )
        try:
            async with asyncio.timeout(45):
                while True:
                    line = await process.stdout.readline()
                    if not line:
                        raise AssertionError(f"R2 service exited: {log_path.read_text()}")
                    try:
                        ready = json.loads(line)
                    except ValueError:
                        continue
                    if "endpoint" in ready and "cert" in ready:
                        break
            yield ArtifactStore(ready["endpoint"], Path(ready["cert"]))
        finally:
            if process.returncode is None:
                process.terminate()
                try:
                    await asyncio.wait_for(process.wait(), timeout=15)
                except TimeoutError:
                    process.kill()
                    await process.wait()


@pytest_asyncio.fixture(loop_scope="session")
async def default_mcp(mcp_process_factory):
    external = os.environ.get("MCP_SERVER_URL")
    if external:
        log = os.environ.get("MCP_SERVER_LOG")
        if not log:
            raise ValueError(
                "MCP_SERVER_LOG is required with MCP_SERVER_URL for telemetry acceptance"
            )
        yield external, Path(log)
    else:
        async with mcp_process_factory("default") as (url, log, _process):
            yield url, log
