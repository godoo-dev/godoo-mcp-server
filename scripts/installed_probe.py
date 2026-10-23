#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.14"
# dependencies = []
# ///
"""Run with the isolated consumer's interpreter, never with a source path injection."""

import importlib.metadata
import importlib.resources
import json
import subprocess
import sys
from pathlib import Path

import godoo_mcp_server
from godoo_mcp_server.resources import _SKILL_FILES, _SKILL_PATHS

expected = sys.argv[1]
origin = Path(godoo_mcp_server.__file__).resolve()
assert origin.is_relative_to(Path(sys.prefix).resolve()), origin
assert godoo_mcp_server.__version__ == importlib.metadata.version("godoo-mcp-server") == expected
assert (
    subprocess.check_output(
        [str(Path(sys.executable).parent / "godoo-mcp-server"), "--version"], text=True
    ).strip()
    == f"godoo-mcp-server {expected}"
)
assert set(_SKILL_FILES) == set(_SKILL_PATHS) and all(_SKILL_FILES.values())
bundled = importlib.resources.files("godoo_mcp_server") / "skills"
assert (bundled / "CC0-1.0.txt").read_text()
assert (bundled / "PROVENANCE.md").read_text()
for distribution in importlib.metadata.distributions():
    direct = distribution.read_text("direct_url.json")
    if direct:
        assert not json.loads(direct).get("dir_info", {}).get("editable"), direct
print(
    json.dumps(
        {
            "origin": str(origin),
            "version": expected,
            "guidance_topics": len(_SKILL_PATHS),
            "client_version": importlib.metadata.version("godoo-client"),
        }
    )
)
