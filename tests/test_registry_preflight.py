"""Exercise GHCR response handling and the native pre-write boundary."""

from __future__ import annotations

import base64
import json
import subprocess
import textwrap
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from scripts import registry_preflight


@pytest.fixture
def registry(monkeypatch):
    state = {
        "token_status": 200,
        "status": 404,
        "body": {"errors": [{"code": "MANIFEST_UNKNOWN", "message": "manifest unknown"}]},
        "requests": [],
    }

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            state["requests"].append((self.path, self.headers.get("Authorization")))
            if self.path.startswith("/token?"):
                self.send_response(state["token_status"])
                body = {"token": "test-read-token"}
            else:
                self.send_response(state["status"])
                body = state["body"]
            self.end_headers()
            self.wfile.write(json.dumps(body).encode())

        def log_message(self, *_):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever)
    thread.start()
    address = f"http://127.0.0.1:{server.server_port}"
    monkeypatch.setattr(registry_preflight, "TOKEN_URL", address + "/token")
    monkeypatch.setattr(registry_preflight, "REGISTRY_URL", address + "/v2")
    try:
        yield state
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def check_tag():
    registry_preflight.require_missing_tag("godoo-dev/godoo-mcp-server", "0.2.0", "user", "secret")


def test_authenticated_missing_manifest(registry):
    check_tag()
    token_request, manifest_request = registry["requests"]
    assert "scope=repository%3Agodoo-dev%2Fgodoo-mcp-server%3Apull" in token_request[0]
    assert token_request[1] == "Basic " + base64.b64encode(b"user:secret").decode()
    assert manifest_request == (
        "/v2/godoo-dev/godoo-mcp-server/manifests/0.2.0",
        "Bearer test-read-token",
    )


@pytest.mark.parametrize("status", [200, 401, 403, 429, 500])
def test_existing_or_unreadable_manifest_stops(registry, status):
    registry["status"] = status
    with pytest.raises(RuntimeError):
        check_tag()


@pytest.mark.parametrize("body", [None, "not found", {}, {"errors": [{"code": "DENIED"}]}])
def test_unrecognized_404_is_unknown(registry, body):
    registry["body"] = body
    with pytest.raises(RuntimeError, match="unknown"):
        check_tag()


def test_denied_token_stops_before_manifest_request(registry):
    registry["token_status"] = 403
    with pytest.raises(RuntimeError, match="token request failed"):
        check_tag()
    assert len(registry["requests"]) == 1


@pytest.mark.parametrize("status,allowed", [(200, False), (403, False), (404, True)])
def test_native_promotion_checks_before_both_writes(
    registry, monkeypatch, tmp_path, status, allowed
):
    registry["status"] = status
    candidate_dir = tmp_path / "candidate"
    candidate_dir.mkdir()
    (candidate_dir / "candidate.json").write_text(
        json.dumps(
            {"version": "0.2.0", "wheel": {"file": "tested.whl"}, "image": {"tag": "tested-image"}}
        )
    )
    for name, value in {
        "RUNNER_TEMP": str(tmp_path),
        "REGISTRY": "pypi",
        "GHCR_USER": "user",
        "GHCR_TOKEN": "secret",
        "GHCR_REPOSITORY": "godoo-dev/godoo-mcp-server",
    }.items():
        monkeypatch.setenv(name, value)
    effects = []

    def command(args, **kwargs):
        if args[:2] == ["python", "scripts/registry_preflight.py"]:
            registry_preflight.require_missing_tag(args[2], args[3], "user", "secret")
        else:
            effects.append(args)

    monkeypatch.setattr(subprocess, "run", command)
    workflow = (Path(__file__).resolve().parents[1] / ".github/workflows/publish.yml").read_text()
    script = textwrap.dedent(
        workflow.rsplit("          python - <<'PY'\n", 1)[1].split("\n          PY")[0]
    )
    if allowed:
        exec(script, {})
        assert effects[0][:2] == ["uv", "publish"]
        assert any(args[:2] == ["docker", "push"] for args in effects)
    else:
        with pytest.raises(RuntimeError):
            exec(script, {})
        assert effects == []
