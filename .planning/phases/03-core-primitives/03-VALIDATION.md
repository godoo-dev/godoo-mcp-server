---
phase: 03
slug: core-primitives
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-02
---

# Phase 03 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 9.x + pytest-asyncio 1.x (`asyncio_mode = "auto"`) |
| **Config file** | `pyproject.toml [tool.pytest.ini_options]` |
| **Quick run command** | `uv run pytest -m "not integration" --tb=short -q` |
| **Full suite command** | `uv run pytest -m "not integration" --tb=short` (unit) + `uv run pytest -m integration --tb=short` (integration, Docker required) |
| **Estimated runtime** | Unit suite: ~5–10 s; integration suite: ~60–120 s (Odoo container start included) |

---

## Sampling Rate

- **After every task commit:** Run `uv run pytest -m "not integration" --tb=short -q`
- **After every plan wave:** Run `uv run pytest -m "not integration" --tb=short` + `uv run mypy --strict src/` + `uv run ruff check .`
- **Before `/gsd:verify-work`:** Full suite (unit + integration) must be green
- **Max feedback latency:** ~10 s (unit); ~120 s (integration)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01-T1 | 01 | 1 | USER-01, ERR-01 | T-03-01, T-03-02, T-03-03 | `session_id` absent from response; ToolError carries no traceback | unit | `uv run pytest -m "not integration" --tb=short -q && uv run mypy --strict src/ && uv run ruff check src/godoo_mcp_server/tools/users.py && uv run ruff format --check src/godoo_mcp_server/tools/users.py` | ❌ W0 (authored this phase) | ⬜ pending |
| 03-01-T2 | 01 | 1 | USER-01, ERR-01 | T-03-02 | ToolError carries no traceback (`"Traceback" not in text`) | unit | `uv run pytest tests/test_users.py -x --tb=short && uv run ruff check tests/test_users.py && uv run ruff format --check tests/test_users.py` | ❌ W0 (authored this phase) | ⬜ pending |
| 03-02-T1 | 02 | 1 | REC-01..05, ERR-01 | T-03-05, T-03-06, T-03-07 | ToolError carries no traceback; no `_client` singleton; limit=80 default enforced | unit | `uv run pytest -m "not integration" --tb=short -q && uv run mypy --strict src/ && uv run ruff check src/godoo_mcp_server/tools/records.py && uv run ruff format --check src/godoo_mcp_server/tools/records.py` | ❌ W0 (authored this phase) | ⬜ pending |
| 03-02-T2 | 02 | 1 | REC-01..05, ERR-01 | T-03-05 | `"Traceback" not in text` for all five tools | unit | `uv run pytest tests/test_records.py -x --tb=short && uv run pytest -m "not integration" --tb=short -q && uv run ruff check tests/test_records.py && uv run ruff format --check tests/test_records.py` | ❌ W0 (authored this phase) | ⬜ pending |
| 03-03-T1 | 03 | 1 | DISC-01, DISC-02, ERR-01 | T-03-08, T-03-09 | ToolError carries no traceback; no `_client` singleton; `limit=500` for ir.model | unit | `uv run pytest -m "not integration" --tb=short -q && uv run mypy --strict src/ && uv run ruff check src/godoo_mcp_server/tools/discovery.py && uv run ruff format --check src/godoo_mcp_server/tools/discovery.py` | ❌ W0 (authored this phase) | ⬜ pending |
| 03-03-T2 | 03 | 1 | DISC-01, DISC-02, ERR-01 | T-03-08 | `"Traceback" not in text` for discovery tools | unit | `uv run pytest tests/test_discovery.py -x --tb=short && uv run pytest -m "not integration" --tb=short -q && uv run ruff check tests/test_discovery.py && uv run ruff format --check tests/test_discovery.py` | ❌ W0 (authored this phase) | ⬜ pending |
| 03-04-T1 | 04 | 2 | USER-01, REC-01..05, DISC-01, DISC-02, ERR-01 | T-03-12, T-03-13 | `"odoo_whoami" absent from tool list; "users_whoami" present; "Traceback" not in SC-4 error` | unit + integration setup | `uv run pytest tests/test_transport.py -x --tb=short && uv run pytest -m "not integration" --tb=short -q && uv run ruff check tests/test_transport.py tests/integration/test_vertical.py && uv run ruff format --check tests/test_transport.py tests/integration/test_vertical.py` | ❌ W0 (modified this phase) | ⬜ pending |
| 03-04-T2 | 04 | 2 | — | — | N/A (human gate: confirm unit suite green before server.py swap) | manual | See Manual-Only Verifications | N/A | ⬜ pending |
| 03-04-T3 | 04 | 2 | REC-01, USER-01, DISC-01, ERR-01 | T-03-12, T-03-13 | `"probe"` absent from server.py; `probe.py` deleted; all 8 tools registered | unit + static | `uv run pytest -m "not integration" --tb=short -q && uv run mypy --strict src/ && uv run ruff check . && uv run ruff format --check . && python -c "import importlib; importlib.import_module('godoo_mcp_server.server'); print('server imports OK')"` | ✅ (modifies existing server.py; deletes probe.py) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing Phase 2 infrastructure (`conftest` fixtures `odoo_harness` / `mcp_client_factory`) covers all phase integration-test requirements; no separate Wave-0 setup plan is needed. Per-plan tasks author their own test files:

- `tests/test_users.py` — authored in plan 03-01 Task 2 (USER-01, ERR-01 unit tests)
- `tests/test_records.py` — authored in plan 03-02 Task 2 (REC-01..05, ERR-01 unit tests)
- `tests/test_discovery.py` — authored in plan 03-03 Task 2 (DISC-01, DISC-02, ERR-01 unit tests)
- Integration tests (SC-3/SC-4/SC-5) — added to existing `tests/integration/test_vertical.py` in plan 03-04 Task 1

Shared fixtures reused from Phase 2 (no new `conftest.py` created):
- `mcp_client` (unit tests) — from `tests/conftest.py`
- `odoo_harness`, `mcp_client_factory`, `second_user_credentials` (integration) — from `tests/integration/conftest.py`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Confirm unit suite green before server.py probe swap | USER-01, D-13 | Blocking gate: if unit suite is red at this point, the import swap must not proceed — probe.py removal would break server startup on top of existing failures | Run `uv run pytest -m "not integration" --tb=short`. Expected: all tests pass. Type "approved" to proceed; describe any failures to abort. |

All other phase behaviors have automated verification.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or are the explicit human-gate checkpoint (03-04-T2)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (T2 checkpoint is the only non-automated task, surrounded by T1 and T3 which are both automated)
- [x] Wave 0: no separate setup plan needed — test files are authored inline by each plan's second task
- [x] No watch-mode flags in any `<verify>` block
- [x] Feedback latency: unit suite ~5–10 s; well within 60 s threshold
- [x] `nyquist_compliant: true` set in frontmatter (every task maps to an automated command or an explicit human gate)

**Approval:** pending
