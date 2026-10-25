#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.14"
# dependencies = []
# ///
"""Drive a real owned MCP process without Odoo or external credentials."""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import socket
import subprocess
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

PROTOCOL = "2026-07-28"


def clean_env() -> dict[str, str]:
    return {
        k: v
        for k, v in os.environ.items()
        if not k.startswith("ODOO_") and k not in {"PYTHONPATH", "PYTHONHOME", "VIRTUAL_ENV"}
    }


def probe(python: Path, evidence: Path) -> None:
    evidence.mkdir(parents=True, exist_ok=True)
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    url = f"http://127.0.0.1:{port}"
    observations = []
    with (evidence / "server.log").open("w") as log:
        process = subprocess.Popen(
            [str(python), "-I", "-m", "godoo_mcp_server"],
            cwd=evidence,
            env={**clean_env(), "HOST": "127.0.0.1", "PORT": str(port)},
            stdout=log,
            stderr=subprocess.STDOUT,
        )
        try:
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError((evidence / "server.log").read_text())
                try:
                    with urllib.request.urlopen(f"{url}/healthz", timeout=1) as response:
                        assert json.load(response) == {"status": "ok"}
                    break
                except OSError, urllib.error.URLError:
                    time.sleep(0.1)
            else:
                raise RuntimeError("MCP health readiness timed out")

            def request(
                method="tools/list",
                params=None,
                *,
                creds=True,
                header=None,
                metadata=True,
                raw=None,
                verb="POST",
            ):
                params = dict(params or {})
                if metadata:
                    params["_meta"] = {
                        "io.modelcontextprotocol/protocolVersion": PROTOCOL,
                        "io.modelcontextprotocol/clientCapabilities": {},
                    }
                body = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
                request_id = str(uuid.uuid4())
                headers = {
                    "Content-Type": "application/json",
                    "Accept": "application/json, text/event-stream",
                    "MCP-Protocol-Version": PROTOCOL,
                    "MCP-Method": header or method,
                    "X-Request-ID": request_id,
                }
                if "name" in params or "uri" in params:
                    headers["MCP-Name"] = params.get("name", params.get("uri"))
                if creds:
                    headers.update(
                        {
                            "X-Odoo-Url": "http://127.0.0.1:1",
                            "X-Odoo-Database": "probe",
                            "X-Odoo-Username": "probe",
                            "X-Odoo-Password": "probe",
                        }
                    )
                req = urllib.request.Request(
                    f"{url}/mcp",
                    method=verb,
                    headers=headers,
                    data=None if verb == "GET" else (raw or json.dumps(body).encode()),
                )
                try:
                    response = urllib.request.urlopen(req, timeout=5)
                except urllib.error.HTTPError as exc:
                    response = exc
                with response:
                    text = response.read().decode()
                    record = {
                        "method": method,
                        "status": response.code,
                        "request_id": request_id,
                        "body": text,
                        "headers": dict(response.headers),
                    }
                    observations.append(record)
                    assert "mcp-session-id" not in {k.lower() for k in response.headers}
                    if response.code != 401:
                        assert response.headers["x-request-id"] == request_id
                    payload = next(
                        (
                            line[5:].strip()
                            for line in text.splitlines()
                            if line.startswith("data:")
                        ),
                        text,
                    )
                    return response.code, json.loads(payload) if payload and verb != "GET" else None

            for _ in range(2):
                status, payload = request()
                assert status == 200
                tools = {tool["name"]: tool for tool in payload["result"]["tools"]}
                assert "users_whoami" in tools
                assert tools["guidance_get"]["annotations"]["readOnlyHint"] is True
                assert tools["record_create"]["annotations"]["readOnlyHint"] is False
            status, payload = request("server/discover")
            assert status == 200 and payload["result"]["supportedVersions"] == [PROTOCOL]
            status, payload = request("resources/read", {"uri": "skill://index.json"})
            assert status == 200
            index = json.loads(payload["result"]["contents"][0]["text"])
            for topic in index["topics"]:
                status, resource = request("resources/read", {"uri": topic["url"]})
                assert status == 200
                status, tool = request(
                    "tools/call", {"name": "guidance_get", "arguments": {"path": topic["path"]}}
                )
                assert status == 200 and not tool["result"].get("isError")
                text = resource["result"]["contents"][0]["text"]
                assert text and not text.startswith("# Not Found")
                assert text == tool["result"]["content"][0]["text"]
            status, payload = request(creds=False)
            assert status == 401 and payload["error"] == "missing_credentials"
            status, payload = request(header="resources/list")
            assert status == 400 and payload["error"]["code"] == -32020
            status, payload = request(metadata=False)
            assert status == 400 and payload["error"]["code"] == -32602
            status, payload = request(raw=b"{")
            assert status == 400 and payload["error"]["code"] == -32700
            status, _ = request(verb="GET")
            assert status == 405
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
            (evidence / "http.json").write_text(
                json.dumps(
                    {
                        "url": url,
                        "pid": process.pid,
                        "exit": process.returncode,
                        "observations": observations,
                    },
                    indent=2,
                )
                + "\n"
            )
    print(f"Real HTTP proof: {len(observations)} requests, owned process reaped")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--python", required=True, type=Path)
    parser.add_argument("--evidence-dir", required=True, type=Path)
    args = parser.parse_args()
    with contextlib.chdir(args.evidence_dir.parent):
        probe(args.python.absolute(), args.evidence_dir.resolve())
