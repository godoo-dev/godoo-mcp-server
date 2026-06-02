---
status: partial
phase: 03-core-primitives
source: [03-VERIFICATION.md]
started: 2026-06-02
updated: 2026-06-02
---

## Current Test

[awaiting human testing — requires Docker + live Odoo via godoo-testcontainers]

## Tests

### 1. SC-3 — record CRUD round-trip against live Odoo (test_record_crud_roundtrip)
expected: create → search → read → update → delete → verify-deletion on `res.partner.category` completes without error; each step returns isError != True with the expected structured payload.
result: [pending]

### 2. SC-4 — invalid domain → structured error (test_invalid_domain_structured_error)
expected: an invalid domain on record_search returns isError=True with a non-empty Odoo error message; "Traceback" is NOT present in the error text.
result: [pending]

### 3. SC-5 — full credential path in CI (test_credential_resolution_record_search)
expected: credential resolution → Odoo authenticate → record_search path runs green; records list returned (may be empty) with isError != True.

result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps

How to run: `uv run pytest -m integration --tb=short` (requires Docker). Also runs in CI via the `integration` job in `.github/workflows/ci.yml`.
