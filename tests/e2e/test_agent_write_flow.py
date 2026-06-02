"""E2E test: headless claude -p agent creates a res.partner.category over real Streamable-HTTP
transport. Each run makes a billable Claude API call — keep this suite tiny and opt-in.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from godoo.testcontainers import StartedOdooContainer


@pytest.mark.e2e
@pytest.mark.asyncio(loop_scope="session")
async def test_agent_creates_partner_category(
    mcp_config_file: Path,
    odoo_harness: "StartedOdooContainer",
) -> None:
    """D-01/D-02: agent creates res.partner.category via real MCP transport; Odoo verify-back
    confirms the record exists. Skips cleanly if prerequisites absent (D-08).
    """
    # Step 1: Generate unique tag name — deterministic verify-back without cleanup (D-09/D-10)
    tag_name = f"E2ETest-{uuid.uuid4().hex[:8]}"

    # Step 2: Build the agent prompt — MUST include exact model name, exact field name,
    # exact value — per Pitfall 4 (vague prompts lead to wrong model/field)
    prompt = (
        f"Using the godoo MCP tools, create a new partner category (model: res.partner.category) "
        f"with the name field set to exactly '{tag_name}'. "
        f"Use the record_create tool. Return the id of the created record."
    )

    # Step 3: Launch the claude subprocess
    # --strict-mcp-config REQUIRED (T-04.1-08): prevents dev MCP servers from loading
    # --allowedTools scoped to mcp__godoo__* (T-04.1-09): bypassPermissions PROHIBITED
    proc = await asyncio.create_subprocess_exec(
        "claude",
        "-p",
        prompt,
        "--mcp-config",
        str(mcp_config_file),
        "--strict-mcp-config",
        "--allowedTools",
        "mcp__godoo__*",
        "--output-format",
        "json",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    # Step 4: Wait for completion with timeout (T-04.1-11 DoS mitigation)
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=120.0)
    except asyncio.TimeoutError:
        proc.kill()
        pytest.fail("Agent subprocess timed out after 120s")

    # Step 5: Parse the JSON result
    result = json.loads(stdout.decode())

    # Step 6: Auth skip guard (D-08 best-effort)
    # Turn auth failures into clean skips rather than hard failures
    if result.get("is_error") is True:
        error_text = result.get("result", "")
        stderr_text = stderr.decode()
        combined = (error_text + stderr_text).lower()
        if any(kw in combined for kw in ("auth", "api key", "anthropic")):
            pytest.skip(
                f"Claude auth unavailable — skipping e2e test (D-08). "
                f"Error: {error_text!r}"
            )

    # Step 7: D-02 assertion — agent JSON result
    assert result.get("is_error") is False, (
        f"Agent returned is_error=True. stderr={stderr.decode()!r}"
    )
    assert result.get("subtype") == "success", (
        f"Agent subtype not 'success': {result.get('subtype')!r}. stderr={stderr.decode()!r}"
    )

    # Step 8: D-02 verify-back — independent Odoo query (authoritative proof, never
    # just the agent's claim)
    records = await odoo_harness.client.search_read(
        "res.partner.category",
        domain=[["name", "=", tag_name]],
        fields=["id", "name"],
    )
    assert len(records) == 1, (
        f"Expected 1 partner category with name={tag_name!r}, found {len(records)}. "
        f"Agent result: {result.get('result', '')!r}"
    )
    # No record cleanup (D-10): ephemeral testcontainer session — entire container
    # is discarded at session end
