"""Shared explicit-major observation and safe owned-resource evidence."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import httpx


def requested_major() -> int:
    major = int(os.environ.get("MCP_TEST_ODOO_MAJOR", "18"))
    if major < 18:
        raise ValueError("Odoo majors before18 are unsupported")
    requested = os.environ.get("ODOO_VERSION", f"{major}.0")
    if requested not in {str(major), f"{major}.0"}:
        raise ValueError(f"ODOO_VERSION={requested} conflicts with selected major {major}")
    os.environ["ODOO_VERSION"] = f"{major}.0"
    return major


async def observe(harness: Any, major: int) -> None:
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.post(
            f"{harness.url}/jsonrpc",
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "call",
                "params": {"service": "common", "method": "version", "args": []},
            },
        )
    observed = response.json()["result"]["server_version_info"][0]
    assert observed == major, response.text
    started = harness._started
    rows = []
    for container in (started.odoo_container, started.postgres_container):
        wrapped = container.get_wrapped_container()
        wrapped.reload()
        rows.append(
            {
                "id": wrapped.id,
                "image_id": wrapped.image.id,
                "image_digests": wrapped.image.attrs.get("RepoDigests", []),
            }
        )
    record = {
        "requested_major": major,
        "observed_major": observed,
        "modules": ["base", "mail"],
        "containers": rows,
        "network_id": started._network.id,
    }
    destination = os.environ.get("MCP_ODOO_FACTS")
    if destination:
        with Path(destination).open("a") as stream:
            stream.write(json.dumps(record) + "\n")
    print("ODOO_PROOF", json.dumps(record), flush=True)
