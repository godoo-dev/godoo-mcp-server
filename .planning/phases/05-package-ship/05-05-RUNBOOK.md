# 05-05 Release Gate — Manual Runbook

> Plan 05-05 is `autonomous: false`. The steps below are credential-gated release
> actions that must be performed by a human with the relevant PyPI / GitHub / npm
> accounts. They produce real external side effects (publishing, deprecation).

**Repo:** `godoo-dev/godoo-mcp-server` · **Package:** `godoo-mcp-server 0.1.0`
**Publish workflow:** `.github/workflows/publish.yml` · **Container port:** `8000`

## Status at time of writing

| Task | Covers | Status |
|------|--------|--------|
| 3 — Docker image smoke-test | SC-2 / REL-02 | ✅ **Automated** — `tests/e2e/test_docker_image.py` (`uv run pytest -m e2e`). Manual steps below kept as reference/fallback only. |
| 1 — Trusted Publishers + GH environments | D-01 prerequisite | 🔑 Manual — needs PyPI/TestPyPI + GitHub accounts |
| 2 — TestPyPI dry-run | D-01 (hard gate) | 🔑 Manual — run the workflow, verify install |
| 4 — npm deprecation | REL-03 / SC-4 | 🔑 Manual — needs npm auth |

Full automated suite is green: integration (9 passed), e2e (2 passed incl. LLM roundtrip
+ Docker image test).

---

## Task 1 — One-time registry + GitHub environment setup

### A. GitHub environment `testpypi`
`https://github.com/godoo-dev/godoo-mcp-server/settings/environments` → **New environment**
→ name exactly `testpypi` (case-sensitive; must match `environment: testpypi` in `publish.yml`).

### B. TestPyPI Trusted Publisher
`https://test.pypi.org/manage/account/publishing/` → **Add a new pending publisher**:

| Field | Value |
|---|---|
| PyPI project name | `godoo-mcp-server` |
| Owner | `godoo-dev` |
| Repository name | `godoo-mcp-server` |
| Workflow filename | `publish.yml` |
| Environment name | `testpypi` |

### C. GitHub environment `pypi`
Same path as A → name exactly `pypi`.

### D. PyPI Trusted Publisher
`https://pypi.org/manage/account/publishing/` → **Add a new pending publisher**: same
fields as B, but **Environment name = `pypi`**.

> ⚠️ The **Owner** field must match the GitHub account that actually owns the repo. Confirmed
> value is `godoo-dev` (the org). A wrong owner causes a silent OIDC 403 at publish time.

✅ **Done when:** both pending publishers appear on their `account/publishing/` pages, and
both environments appear in GitHub Settings → Environments.

---

## Task 2 — TestPyPI dry-run (D-01 HARD GATE) 🔑

```
git push origin develop
```

`https://github.com/godoo-dev/godoo-mcp-server/actions/workflows/publish.yml` →
**Run workflow** → branch `develop` → **Run workflow**.

`workflow_dispatch` runs `build` + `publish-testpypi` only (PyPI + Docker publish require a
`v*` tag push). Wait for both jobs green, then verify in a clean venv (PowerShell):

```powershell
python3.14 -m venv $env:TEMP\testpypi-verify
& "$env:TEMP\testpypi-verify\Scripts\Activate.ps1"
pip install --index-url https://test.pypi.org/simple/ --extra-index-url https://pypi.org/simple/ godoo-mcp-server
godoo-mcp-server --version      # expect: godoo-mcp-server 0.1.0
python -m godoo_mcp_server --version
```

✅ **Done when:** Actions green · `https://test.pypi.org/project/godoo-mcp-server/` shows
`0.1.0` · both `--version` commands print `godoo-mcp-server 0.1.0`.

---

## Task 3 — Docker image smoke-test (SC-2 / REL-02) — AUTOMATED

Now covered by automation:

```
uv run pytest tests/e2e/test_docker_image.py -m e2e --tb=short
```

This builds the image, runs it against an Odoo testcontainer, asserts `/healthz` healthy and
a real `record_search` MCP call. **No manual action required.**

<details>
<summary>Manual equivalent (reference / fallback only)</summary>

Throwaway Odoo (mirrors the test harness: Odoo 17.0 + Postgres 15, db `test_odoo`, admin/admin):

```powershell
docker network create odoo-smoke

docker run -d --name odoo-smoke-pg --network odoo-smoke --network-alias db `
  -e POSTGRES_USER=odoo -e POSTGRES_PASSWORD=odoo -e POSTGRES_DB=test_odoo `
  postgres:15-alpine

docker run -d --name odoo-smoke-web --network odoo-smoke -p 8069:8069 `
  -e HOST=db -e PORT=5432 -e USER=odoo -e PASSWORD=odoo `
  odoo:17.0 -- --database test_odoo --without-demo all --max-cron-threads 0 --init base
# wait ~60s for first-run DB init: docker logs -f odoo-smoke-web

docker build -t godoo-mcp-server:smoke-test .
docker run --rm --network odoo-smoke --name gms-smoke -p 8000:8000 `
  -e ODOO_URL=http://odoo-smoke-web:8069 `
  -e ODOO_DATABASE=test_odoo -e ODOO_USERNAME=admin -e ODOO_PASSWORD=admin `
  godoo-mcp-server:smoke-test

# verify (second terminal):
docker inspect gms-smoke --format '{{.State.Health.Status}}'   # expect: healthy
curl http://localhost:8000/healthz                             # expect: {"status": "ok"}

# cleanup:
docker rm -f gms-smoke odoo-smoke-web odoo-smoke-pg
docker network rm odoo-smoke
```

> Do NOT override the container `PORT` — the baked `HEALTHCHECK` hardcodes `:8000`.
</details>

---

## Task 4 — npm deprecation (REL-03 / SC-4) 🔑

```
npm whoami     # must be marcfargas (npm login if not)
npm deprecate @marcfargas/odoo-mcp "Deprecated: use godoo-mcp-server (PyPI) as successor — https://pypi.org/project/godoo-mcp-server/"
npm view @marcfargas/odoo-mcp     # confirm 'deprecated:' shows
```

> Deprecate only — do **NOT** unpublish. The package must remain installable (version `0.1.4`).
> Have your npm OTP ready if 2FA is enabled.

✅ **Done when:** `npm view` shows the deprecation message and the package is still listed.

---

## Closing the phase

Once Tasks 1, 2, 4 are complete, report the outcomes (especially the D-01 dry-run result).
The orchestrator then writes `05-05-SUMMARY.md`, updates STATE.md / ROADMAP.md, and marks
Phase 5 complete.

## outome

(testpypi-verify) PS C:\Users\marc\AppData\Local\Temp\testpypi-verify> godoo-mcp-server --version      # expect: godoo-mcp-server 0.1.0
godoo-mcp-server 0.1.0
(testpypi-verify) PS C:\Users\marc\AppData\Local\Temp\testpypi-verify> python -m godoo_mcp_server --version   
godoo-mcp-server 0.1.0       

npm view @marcfargas/odoo-mcp     # confirm 'deprecated:' shows                                                                       

@marcfargas/odoo-mcp@0.1.4 | LGPL-3.0 | deps: 5 | versions: 6
MCP server for safe, policy-governed access to Odoo
https://github.com/marcfargas/odoo-toolbox#readme

DEPRECATED ⚠️  - Deprecated: use godoo-mcp-server (PyPI) as successor — https://pypi.org/project/godoo-mcp-server/

