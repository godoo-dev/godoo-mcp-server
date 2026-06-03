# Phase 6: Code Mode - Context

**Gathered:** 2026-06-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver a single `execute_odoo_code` MCP tool behind which an AI agent writes
composable Python that manipulates Odoo, run in a per-invocation sandbox. This is
the minimal-tools philosophy taken to its logical extreme: one tool, agent-authored
code, knowledge supplied via skills.

**In scope:** the `execute_odoo_code` tool, the sandbox execution mechanism, the
code surface the agent writes against, the result contract, audit logging, and
Code Mode skill recipes.

**Out of scope:** Odoo *server-action* Code Mode (writing code that runs *inside*
Odoo as a server action) — that is a separate, spike-gated effort tracked at
`godoo-hq/.planning/seeds/spike-code-mode-feasibility.md`. Do not plan it here.

</domain>

<decisions>
## Implementation Decisions

### Sandbox Architecture
- **D-01:** Ship a thin **`SandboxRunner` abstraction** — an ABC with a single
  method (≈ `async def execute(code, creds) -> SandboxResult`), backend selected at
  startup (env var). Already blueprinted in `ARCHITECTURE.md`. v1.0 ships exactly
  **one** backend behind it; the seam exists so a stronger backend can slot in later
  without touching callers (~20 lines of indirection).
- **D-02:** The v1.0 backend is a **fresh per-invocation Python subprocess inside the
  server's own container/venv** — `godoo-client` is already present, spawn is fast,
  and it runs on the maintainer's Windows dev box. NOT a separate Docker container
  per call, NOT a microVM. Per-invocation isolation = fresh process (clean globals)
  + `rlimits` + `seccomp` + hard-kill timeout + non-root uid + creds passed via
  **stdin/env, never argv**.
- **D-03:** Network egress control lives at the **deployment/network layer** (Docker
  network / ACA egress policy / k8s NetworkPolicy), **allowlisted to the Odoo host
  only** — NOT per-call code, and explicitly **NOT `--network none`** (the script
  must reach Odoo). The sandboxed script makes **direct `godoo-client` calls to
  Odoo** with the user's creds.
- **D-04:** microVM / per-call container / **ACA Sandboxes** are explicitly **NOT
  security requirements** for this architecture (see threat model). They are deferred
  and can slot behind the `SandboxRunner` seam if a multi-tenant deployment ever
  materializes.

### Threat Model (why the sandbox is deliberately light)
- **D-05:** The blast radius is bounded by **statelessness + per-request creds**. The
  sandboxed script is a *separate process* handed only *its own* invocation's creds;
  it cannot read the parent process memory, so it cannot reach concurrent requests'
  credentials (that attack surface lives in the parent, which the sandbox never
  touches — and on a threaded/request-scoped server, not even there). The server
  holds **no standing secret store**. Maximum exposure = the single user's own creds,
  which the script is already authorized to use. Therefore the only controls that
  earn their place are: **block network exfiltration** (egress allowlist to Odoo) and
  **cap resources** (rlimits + timeout). The kernel-escape-to-other-tenants scenario
  that justifies microVMs **has no target** in this design. Design value for this
  phase: *proportionate to a mid-size business, not a bank vault.*

### Code Surface
- **D-06:** The agent writes **raw Python**. The parent injects a **pre-built `odoo`
  client global** bound to the request's creds — script writes
  `odoo.search_read('res.partner', [...])`. Creds never appear in script text. It is
  real CPython in the server venv, so the script *can* import anything — isolation is
  process + egress, **not** language-level (no import restriction, no RestrictedPython).
- **D-07:** The injected `odoo` is a **sync facade** over the async `godoo-client`.
  Scripts are plain **sync** (no `async`/`await`); the runner owns the event loop and
  wraps the async calls. Chosen for "simple Odoo manipulation script" ergonomics and
  to eliminate the missing-`await` agent footgun. Cost: a small sync-over-async
  wrapper in the runner.

### Return Contract
- **D-08:** The script assigns a **`result`** variable (or calls `result(...)`); the
  runner serializes `result` to **JSON** and returns it as the tool output.
  **stdout/stderr are captured separately** for debugging/audit and are NOT part of
  the result payload.

### Capabilities / ACL
- **D-09:** **No write-gating, no read-only-default, no method allowlist** for Code
  Mode. The script runs with the user's **full Odoo ACL** — identical privilege to the
  existing `call` primitive, which already permits arbitrary methods. Odoo enforces
  ACL (consistent with Phase 4 D-12: no ACL replication). A Code-Mode-specific
  restriction was judged redundant belt-and-suspenders over a door already open.

### Audit & Rate Limiting
- **D-10:** Keep **per-invocation audit logging** (timestamp, user-credential hash,
  the code, result status). Cheap and valuable. Follow Phase 3 D-07/D-08: sanitize,
  never leak credentials or Python internals.
- **D-11:** Rate limiting = **simple best-effort in-process per-credential counter**
  (lazy `asyncio.Lock` per the established Python 3.14 pattern — never module-level);
  resets on restart, which is acceptable for the stateless design. Not durable; a
  cross-instance limiter is out of scope (would fight statelessness).

### Requirement Relaxations (MUST propagate to REQUIREMENTS.md)
- **D-12:** **CODE-02 relaxed** — "no direct network from sandbox" → "network egress
  **allowlisted to the Odoo host** at the deployment layer; sandbox reaches Odoo
  directly." The `OdooRpcProxy` IPC channel is **removed** from the design.
- **D-13:** **CODE-03 dropped** — "allowlisted Odoo RPC only" (via proxy) is redundant
  with the `call` tool.
- **D-14:** **CODE-04 dropped as a hard control** — "read-only by default" (see D-09).
- **Retained:** **CODE-01** (`execute_odoo_code` tool) and **CODE-05** (per-invocation
  isolation + audit + rate-limit + timeout) — isolation now = subprocess (D-02);
  audit/rate-limit per D-10/D-11.

### Skill Recipes
- **D-15:** Add **one new `codemode.md` skill file** with `execute_odoo_code` recipes;
  leave existing skill files unchanged. Must add a matching `index.json` entry — the
  Phase 4 SKILL-02 startup assertion enforces `.md` ↔ index parity.

### Claude's Discretion
- Exact `SandboxRunner` ABC signature and `SandboxResult` shape.
- Default timeout value, `rlimit` values, and the `seccomp` profile specifics.
- The audit-log record schema.
- The sync-facade implementation approach (per-call loop vs persistent loop).
- How creds are threaded into the subprocess (stdin handshake vs scoped env).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements
- `.planning/ROADMAP.md` — Phase 6 entry: goal, success criteria (SC-1..SC-5).
- `.planning/REQUIREMENTS.md` — CODE-01..CODE-05 definitions. **Note the D-12/13/14
  relaxations above — REQUIREMENTS.md must be updated to match.**
- `.planning/PROJECT.md` — Key Decisions table (sandbox row) and the Security/Code
  Mode constraints block. **The "no direct network / allowlisted RPC only / read-only
  default" non-negotiables are deliberately relaxed by D-09/D-12/D-13/D-14.**

### Architecture & pitfalls
- `.planning/research/ARCHITECTURE.md` — §Code Mode Sandbox Boundary: the
  `SandboxRunner` sub-package blueprint (`codemode/` with `tool.py`, `runner.py`,
  etc.) and build order. **Adjust: the `proxy.py`/`grants.py` allowlist layer is
  removed per D-13; the design simplifies to runner + tool + sync facade.**
- `.planning/research/PITFALLS.md` — Pitfall 1 (RestrictedPython is NOT a boundary —
  still honored: we use OS process isolation, not language-level), Pitfall 8 (network
  egress — now satisfied by deployment-layer allowlist, not in-process), Pitfall 9
  (capability gate — intentionally dropped per D-09).

### Industry pattern & out-of-scope spike
- `../godoo-hq/.planning/quick/260601-sy2-update-spine-state-topology-dev-log-and-/260601-sy2-RESEARCH.md`
  — MCP Code Mode industry briefing (Cloudflare/Anthropic patterns, token savings).
- `../godoo-hq/.planning/seeds/spike-code-mode-feasibility.md` — Odoo server-action
  Code Mode (OUT OF SCOPE for this phase; remains spike-gated).

### External (evaluated during discussion)
- https://github.com/pydantic/monty — evaluated as an in-process sandbox; **rejected**:
  Rust Python VM that won't support third-party libs, so `godoo-client` can't run in
  it. Its capability model (deny-all, expose only registered host functions) is the
  right *philosophy* but the wrong *implementation* here.
- https://sandboxes.azure.com/docs/sandboxes — **ACA Sandboxes** (Build-'26 microVM
  primitive; the forward-looking Azure path). Candidate future backend behind the
  `SandboxRunner` seam IF a multi-tenant deployment needs hardware isolation.
- https://github.com/Azure-Samples/azure-container-apps-sandboxes — official samples
  (incl. MCP-server-in-sandbox patterns) for that future backend.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Tool registration** (`server.py:27-36`): each tool module is side-effect imported
  after `mcp` is defined. `codemode/tool.py` adds one import line, feature-flaggable
  via a `CODE_MODE_ENABLED` env check.
- **Credential access** (`records.py:50-52`, `credentials.py:108`):
  `request.state.odoo_creds`. The `execute_odoo_code` handler reads creds the same way,
  then hands them to the runner.
- **`OdooCredentials` dataclass** (`credentials.py:20-36`): `repr=False` to prevent
  password leakage. Serialize securely into the subprocess (stdin/env, never argv,
  never logged).
- **Error surfacing** (`records.py:63-64`): `except OdooError as e: raise ToolError(...)`.
  Code Mode adds a `SandboxError` (timeout / resource-kill) → `ToolError` with a
  sanitized message.
- **`godoo-client` call surface** as used elsewhere: `search_read`, `read`, `create`,
  `write`, `unlink`, `execute_kw`. The sync facade wraps these.

### Established Patterns
- **Async-only `godoo-client`** → the sync facade (D-07) wraps it; the runner owns the
  loop.
- **Lazy `asyncio.Lock`** (`_get_lock()` pattern, never module-level in 3.14) — applies
  to the rate-limiter counter (D-11).
- **Skill `.md` ↔ `index.json` parity** asserted at startup (Phase 4 SKILL-02) — the new
  `codemode.md` needs its index entry (D-15).

### Integration Points
- New greenfield sub-package `src/godoo_mcp_server/codemode/` (tool + runner + sync
  facade + audit + rate-limiter). No Code Mode scaffolding exists yet.
- Tool registers via the side-effect-import pattern in `server.py`.

</code_context>

<specifics>
## Specific Ideas

- **Proportionality is an explicit design value** this phase: "protecting a mid-size
  business, not a bank vault." Every isolation control must justify itself against the
  actual (light) threat model in D-05.
- **monty's philosophy** (deny-all by default, re-grant only via host-registered
  functions) is the conceptually correct sandbox model — noted even though the monty
  implementation was rejected for this use case.
- **ACA Sandboxes** is the named future home for hardware isolation if multi-tenancy
  ever demands it — captured so the `SandboxRunner` seam has a concrete target.

</specifics>

<deferred>
## Deferred Ideas

- **ACA Sandboxes / microVM / per-call-container backend** — for a hypothetical
  multi-tenant deployment, slotted behind the `SandboxRunner` seam. Not v1.0.
- **Durable / cross-instance rate limiting** — conflicts with the stateless design;
  defer unless a concrete need appears.
- **Warm-pool / container-spawn latency optimization** — only relevant if a
  container/microVM backend is later added.
- **Odoo server-action Code Mode** — separate, spike-gated effort at `godoo-hq`.

</deferred>

---

*Phase: 6-Code Mode*
*Context gathered: 2026-06-03*
