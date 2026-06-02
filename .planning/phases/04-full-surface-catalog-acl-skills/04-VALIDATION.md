---
phase: "04"
slug: full-surface-catalog-acl-skills
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-02
---

# Phase 04 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 9 + pytest-asyncio 1.1 (asyncio_mode=auto) |
| **Config file** | pyproject.toml [tool.pytest.ini_options] |
| **Quick run command** | `uv run pytest tests/ -m "not integration" --tb=short` |
| **Full suite command** | `uv run pytest --tb=short -m "not integration"` |
| **Integration run** | `uv run pytest -m integration --tb=short` |
| **Estimated runtime** | ~10–30s unit; ~60–120s integration (container startup) |

---

## Sampling Rate

- **After every task commit:** Run `uv run pytest tests/ -m "not integration" --tb=short`
- **After every plan wave:** Run `uv run pytest --tb=short -m "not integration"` (full unit suite)
- **Before `/gsd:verify-work`:** Full suite (unit + integration) must be green
- **Max feedback latency:** ~30s (unit); ~120s (integration)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Automated Command | File Exists | Status |
|---------|------|------|-------------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | MAIL-01 | `uv run pytest tests/test_mail.py -k post_message` | ❌ Wave 0 | ⬜ pending |
| 04-01-02 | 01 | 1 | MAIL-01 | `uv run pytest tests/test_mail.py -k log_note` | ❌ Wave 0 | ⬜ pending |
| 04-01-03 | 01 | 1 | MAIL-01 | `uv run pytest tests/test_mail.py -k list_messages` | ❌ Wave 0 | ⬜ pending |
| 04-01-04 | 01 | 1 | MAIL-01 | `uv run pytest tests/test_mail.py -k schedule_activity` | ❌ Wave 0 | ⬜ pending |
| 04-01-05 | 01 | 1 | MAIL-01 | `uv run pytest tests/test_mail.py -k list_activities` | ❌ Wave 0 | ⬜ pending |
| 04-01-06 | 01 | 1 | MAIL-01 | `uv run pytest tests/test_mail.py -k mark_done` | ❌ Wave 0 | ⬜ pending |
| 04-02-01 | 02 | 1 | ACT-01 | `uv run pytest tests/test_actions.py` | ❌ Wave 0 | ⬜ pending |
| 04-02-02 | 02 | 1 | ATT-01 | `uv run pytest tests/test_attachments.py` | ❌ Wave 0 | ⬜ pending |
| 04-02-03 | 02 | 1 | USER-02 | `uv run pytest tests/test_users.py -k search_users` | ❌ Wave 0 | ⬜ pending |
| 04-02-04 | 02 | 1 | DISC-03 | `uv run pytest tests/test_discovery.py -k list_menus` | ❌ Wave 0 | ⬜ pending |
| 04-03-01 | 03 | 1 | CAT-01 | `uv run pytest tests/test_catalog.py -k schema_hash` | ❌ Wave 0 | ⬜ pending |
| 04-03-02 | 03 | 1 | CAT-02 | `uv run pytest tests/test_catalog.py -k cache_hit` | ❌ Wave 0 | ⬜ pending |
| 04-03-03 | 03 | 1 | CAT-02 | `uv run pytest tests/test_catalog.py -k cache_miss` | ❌ Wave 0 | ⬜ pending |
| 04-03-04 | 03 | 1 | CAT-02 (D-12 isolation) | `uv run pytest tests/test_catalog.py -k isolation` | ❌ Wave 0 | ⬜ pending |
| 04-05-01 | 05 | 2 | RES-01 | `uv run pytest tests/test_resources.py -k model_resource` | ❌ Wave 0 | ⬜ pending |
| 04-05-02 | 05 | 2 | RES-01 | `uv run pytest tests/test_resources.py -k skill_index` | ❌ Wave 0 | ⬜ pending |
| 04-05-03 | 05 | 2 | SKILL-01 | `uv run pytest tests/test_resources.py -k skill_file` | ❌ Wave 0 | ⬜ pending |
| 04-05-04 | 05 | 2 | SKILL-02 | `uv run pytest tests/test_resources.py -k startup_assertion` | ❌ Wave 0 | ⬜ pending |
| 04-06-01 | 06 | 3 | integration | `uv run pytest tests/integration/test_vertical.py -m integration` | ❌ Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

All test files below are new and must be created (scaffolded) before or alongside their corresponding plan wave:

- [ ] `tests/test_mail.py` — stubs + tests for MAIL-01 (6 tools: post_message, log_note, list_messages, schedule_activity, list_activities, mark_activity_done)
- [ ] `tests/test_actions.py` — stubs + tests for ACT-01 (action_list_actions, action_execute_action)
- [ ] `tests/test_attachments.py` — stubs + tests for ATT-01 (list, upload, download; includes base64 edge cases and empty-file guard)
- [ ] `tests/test_catalog.py` — stubs + tests for CAT-01, CAT-02, D-12 isolation (schema hash, cache hit/miss, credential-free key)
- [ ] `tests/test_resources.py` — stubs + tests for RES-01, SKILL-01, SKILL-02, startup assertion, Option B action resource cold-cache
- [ ] Extend `tests/test_users.py` — add users_search_users test cases (USER-02)
- [ ] Extend `tests/test_discovery.py` — add discovery_list_menus test cases (DISC-03)
- [ ] Extend `tests/integration/test_vertical.py` — add mail + attachments integration scenarios

**Existing infrastructure (usable as-is, no changes needed):**
- `tests/conftest.py` — mcp_client fixture (lifespan + ASGI transport + fake credentials)
- `tests/integration/conftest.py` — odoo_harness, mcp_client_factory, second_user_credentials
- `asyncio_mode = "auto"` in pyproject.toml — no per-test @pytest.mark.asyncio needed

---

## Manual-Only Verifications

All phase behaviors have automated verification. No manual-only verifications required for Phase 4.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify commands (every plan in 04-01 through 04-06 has `<automated>` blocks)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (8 files listed above)
- [x] No watch-mode flags (all commands are single-run: pytest, mypy; no --watch)
- [x] Feedback latency < 30s for unit suite; < 120s for integration
- [x] `nyquist_compliant: true` set in frontmatter — every task has an automated verify command

**Approval:** pending execution
