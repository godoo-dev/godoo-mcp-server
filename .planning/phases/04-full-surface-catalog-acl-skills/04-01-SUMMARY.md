---
phase: 04-full-surface-catalog-acl-skills
plan: "01"
subsystem: api
tags: [mail, chatter, odoo, fastmcp, mcp, godoo-client, message_post, activities]

# Dependency graph
requires:
  - phase: 03-core-primitives
    provides: records.py tool pattern (imports, _make_config, OdooError->ToolError, test helpers)
provides:
  - 6 mail/chatter MCP tools registered on the fastmcp mcp instance
  - mail.py tool module following records.py pattern exactly
  - test_mail.py unit tests with 8 test functions covering all 6 tools
affects:
  - 04-06-integration (integration tests will cover mail tools against live container)
  - agents using mail/chatter workflow

# Tech tracking
tech-stack:
  added: []
  patterns:
    - client.call() pattern for Odoo methods not in godoo-client high-level API
    - HTML body wrapping: body if "<" in body else f"<p>{body}</p>"
    - cast() instead of type: ignore for mypy --strict on json.loads return values

key-files:
  created:
    - src/godoo_mcp_server/tools/mail.py
    - tests/test_mail.py
  modified:
    - src/godoo_mcp_server/server.py

key-decisions:
  - "cast() over type: ignore[return-value] for json.loads in test helpers — mypy --strict compliant"
  - "A1/A2 assumptions documented inline: activity_schedule and action_feedback method names pending integration verification"

patterns-established:
  - "client.call() pattern: await client.call(model, method, [ids], kwargs_dict) for all non-CRUD Odoo operations"
  - "HTML body wrap: check '<' in body before wrapping in <p> tags"
  - "None-omission for optional activity kwargs: build kwargs dict, add note/user_id only if not None"

requirements-completed: [MAIL-01]

# Metrics
duration: 15min
completed: 2026-06-02
---

# Phase 4 Plan 01: Mail/Chatter Tool Handlers Summary

**6 mail/chatter MCP tools (message_post, log_note, list_messages, schedule_activity, list_activities, mark_activity_done) with OdooError->ToolError wrapping and full unit test coverage**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-06-02T15:50:00Z
- **Completed:** 2026-06-02T16:05:00Z
- **Tasks:** 2
- **Files modified:** 3 (created: 2, modified: 1)

## Accomplishments

- Created `src/godoo_mcp_server/tools/mail.py` with all 6 mail tool handlers following the records.py pattern exactly
- Registered mail module as side-effect import in server.py; all 6 tools appear in tools/list
- Created `tests/test_mail.py` with 8 tests: 6 isError=True boundary checks, 1 no-traceback, 1 tools/list verification
- mypy --strict passes on both mail.py and test_mail.py; full suite 31 passed, no regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Create tools/mail.py with all 6 mail tool handlers** - `017c8df` (feat)
2. **Task 2: Write unit tests for all 6 mail tools** - `54e9655` (test)

**Plan metadata:** (committed with SUMMARY.md)

## Files Created/Modified

- `src/godoo_mcp_server/tools/mail.py` - 6 mail/chatter MCP tools: mail_post_message, mail_log_note, mail_list_messages, mail_schedule_activity, mail_list_activities, mail_mark_activity_done
- `src/godoo_mcp_server/server.py` - Added side-effect import for mail module
- `tests/test_mail.py` - 8 unit tests covering all 6 tools, error boundary, no-traceback, and tools/list verification

## Decisions Made

- Used `cast(dict[str, object], json.loads(...))` instead of `# type: ignore[return-value]` in test helper `_parse_sse_json` — the type: ignore comments in test_records.py do not satisfy mypy --strict under Python 3.14; cast is the correct fix. Filed as a deviation (Rule 1).
- Documented assumptions A1 (activity_schedule method name) and A2 (action_feedback method name) with inline comments as planned — both are standard Odoo 16/17 API but unverified without a live container.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] mypy --strict failure on _parse_sse_json: type: ignore[return-value] inadequate under Python 3.14**
- **Found during:** Task 2 (test_mail.py mypy verification)
- **Issue:** Copying `# type: ignore[return-value]` from test_records.py produced `Unused "type: ignore" comment [unused-ignore]` and `Returning Any from function declared to return "dict[str, object]" [no-any-return]` — mypy --strict sees through the ignore under this Python/mypy version
- **Fix:** Replaced both `type: ignore` comments in `_parse_sse_json` with `cast(dict[str, object], json.loads(...))` — semantically equivalent but mypy-clean
- **Files modified:** tests/test_mail.py
- **Verification:** `uv run mypy tests/test_mail.py --strict` exits 0 with no errors
- **Committed in:** `54e9655` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug)
**Impact on plan:** Fix needed for mypy --strict acceptance criterion. No scope change. The same fix should be backported to test_records.py in a future cleanup (deferred — out of scope for this plan).

## Issues Encountered

None beyond the mypy deviation above.

## Known Stubs

None — tools wire directly to godoo-client RPC calls; no hardcoded empty returns.

## Threat Surface Scan

No new network endpoints, auth paths, or schema changes beyond what the plan's threat model covers. The 6 mail tools follow the identical trust boundary as existing record tools: per-request OdooClient from request.state.odoo_creds, Odoo enforces ACL. No new surface introduced.

## Next Phase Readiness

- MAIL-01 unit coverage complete. Ready for Plan 02 (actions + attachments tools).
- Integration tests for all mail tools are deferred to Plan 06 (vertical integration test suite against live Odoo container).
- A1/A2 method name assumptions will be verified in Plan 06 integration tests.

---
*Phase: 04-full-surface-catalog-acl-skills*
*Completed: 2026-06-02*
