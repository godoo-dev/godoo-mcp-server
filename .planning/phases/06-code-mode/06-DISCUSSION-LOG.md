# Phase 6: Code Mode - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-03
**Phase:** 6-Code Mode
**Areas discussed:** Sandbox mechanism, Code surface shape, Return value contract, Capability grant source, Sync/async surface

---

## Sandbox mechanism

Initial framing offered Docker-sidecar vs subprocess+seccomp vs hybrid. The user
challenged the framing twice — first raising Azure Container Apps deployment and
microVMs, then deflating the threat model entirely. Two research passes
(sandbox-options + Azure-Sandboxes/monty) reshaped the decision.

| Option (as it evolved) | Description | Selected |
|--------|-------------|----------|
| Docker sidecar only | Fresh container/call, `--network none`, strongest portable isolation | |
| Subprocess + seccomp/namespaces | Lighter, Linux-only (won't run on Windows dev) | |
| Hybrid env-var switch | Two security-critical paths to audit | |
| ACA Dynamic Sessions / Sandboxes (microVM) | Hyper-V/microVM isolation for multi-tenant | deferred behind seam |
| **Thin SandboxRunner seam + same-container subprocess** | Fresh subprocess in server venv, egress-allowlisted to Odoo, behind 1-method ABC | ✓ |

**User's choice:** Thin `SandboxRunner` seam over a same-container subprocess backend.
**Notes:** Key reframes from the user — (1) "godoo-mcp-server is fully stateless, the
only thing it can see is the single user secrets; the most you could achieve is hijack
a concurrent request context in async, not even that on a threaded server" → collapsed
the multi-tenant microVM justification. (2) "How is a script supposed to reach Odoo
without a network? You seem to be protecting a bank, not a mid-size business" →
`--network none` replaced with deployment-layer egress-allowlist to the Odoo host.
(3) "Why can't we use pydantic/monty in the same container?" → researched; monty's
philosophy is right but it can't run the third-party `godoo-client`, so rejected.

---

## Code surface shape

| Option | Description | Selected |
|--------|-------------|----------|
| Pre-injected `odoo` client global | Parent builds the client bound to request creds; script calls `odoo.search_read(...)` | ✓ |
| Script builds its own client from injected creds | `from godoo_client import OdooClient`; more boilerplate | |

**User's choice:** Pre-injected `odoo` client global.
**Notes:** It is real CPython in the server venv, so imports aren't restricted —
isolation is process + egress, not language-level.

---

## Sync/async surface

| Option | Description | Selected |
|--------|-------------|----------|
| Sync facade over the async client | Plain sync scripts, runner owns the loop, fewest footguns | ✓ |
| Raw async client, scripts use await | Full concurrency but missing-await footgun + boilerplate | |

**User's choice:** Sync facade over the async client.

---

## Return value contract

| Option | Description | Selected |
|--------|-------------|----------|
| Assign `result`, serialize to JSON | Explicit, teachable; stdout/stderr captured separately | ✓ |
| Last-expression value (REPL) | Awkward across a subprocess running a script | |
| stdout capture only | Fragile; debug prints pollute payload | |

**User's choice:** Assign `result`, parent serializes to JSON.

---

## Capability grant source

| Option | Description | Selected |
|--------|-------------|----------|
| Drop it — full user ACL, egress-allowlist is the control | Same privilege as the `call` tool; Odoo enforces ACL | ✓ |
| Soft `capabilities=["write"]` opt-in | Audit/telemetry signal, no hard enforcement | |
| Hard read-only-default enforcement | Re-introduces proxy plumbing | |

**User's choice:** Drop it — full user ACL. Records CODE-02 relaxed (egress-allowlist),
CODE-03 dropped, CODE-04 dropped as deliberate requirement changes.

---

## Claude's Discretion

- Audit-log shape, rate-limiting (best-effort in-process counter), and the new
  `codemode.md` skill file layout — user said "ready for context," delegating these.
- `SandboxRunner` ABC signature, timeout/rlimit/seccomp specifics, sync-facade
  implementation, cred-threading mechanism.

## Deferred Ideas

- ACA Sandboxes / microVM / per-call-container backend (multi-tenant future, behind the seam).
- Durable / cross-instance rate limiting (conflicts with stateless design).
- Warm-pool latency optimization (only if a container backend is added).
- Odoo server-action Code Mode (spike-gated at godoo-hq).
