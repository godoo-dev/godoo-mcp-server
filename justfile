odoo_majors := "18 19"

set shell := ["bash", "-euo", "pipefail", "-c"]

# Project tools: corepack's pnpm shim (only created when no pnpm is on PATH) and node_modules/.bin.
export PATH := justfile_directory() / ".corepack/bin" + ":" + justfile_directory() / "node_modules/.bin" + ":" + env("PATH")

default:
    @just --list

[private]
tools:
    command -v pnpm >/dev/null || { mkdir -p .corepack/bin && corepack enable --install-directory .corepack/bin pnpm; }

sync: tools
    pnpm install --frozen-lockfile

lint: sync
    pnpm typecheck
    pnpm lint
    uv run --project tests/acceptance --locked --only-group dev ruff format --check tests/acceptance
    uv run --project tests/acceptance --locked --only-group dev ruff check tests/acceptance

test *args: sync
    pnpm exec vitest run {{ args }}
    node --test .github/testing/candidate.test.mjs

build: sync
    pnpm build

offline evidence: tools
    #!/usr/bin/env bash
    set -euo pipefail
    for variable in $(compgen -e); do
      case "$variable" in ODOO_*|MCP_*|PYTHONPATH|PYTHONHOME|VIRTUAL_ENV|DEBUG|AWS_SESSION_TOKEN) unset "$variable";; esac
    done
    evidence={{ quote(absolute_path(evidence)) }}
    node .github/testing/candidate.mjs start-offline --evidence "$evidence"
    pnpm install --frozen-lockfile
    pnpm typecheck
    pnpm lint
    uv run --project tests/acceptance --locked --only-group dev ruff format --check tests/acceptance
    uv run --project tests/acceptance --locked --only-group dev ruff check tests/acceptance
    pnpm build
    pnpm exec vitest run --reporter=default --reporter=junit --outputFile.junit="$evidence/offline.xml"
    node --test --test-reporter=junit --test-reporter-destination="$evidence/controls.xml" .github/testing/candidate.test.mjs
    printf -v server_command '%q %q' "$(command -v node)" "$PWD/dist/node.mjs"
    node .github/testing/http-probe.mjs --command "$server_command" --evidence "$evidence/http-source"
    node .github/testing/candidate.mjs finish-offline --evidence "$evidence"

package directory source_ref evidence: tools
    node .github/testing/candidate.mjs package --directory {{ quote(absolute_path(directory)) }} --source-ref {{ quote(source_ref) }} --evidence {{ quote(absolute_path(evidence)) }}

image directory:
    node .github/testing/candidate.mjs image --directory {{ quote(absolute_path(directory)) }}

odoo directory major="18":
    node .github/testing/candidate.mjs odoo --directory {{ quote(absolute_path(directory)) }} --major {{ quote(major) }}

archive directory:
    node .github/testing/candidate.mjs archive --directory {{ quote(absolute_path(directory)) }}

# The full check: every CI stage in order, writing into one external directory.
check directory source_ref="local":
    {{ just_executable() }} offline {{ quote(absolute_path(directory) / "offline") }}
    {{ just_executable() }} package {{ quote(absolute_path(directory) / "candidate") }} {{ quote(source_ref) }} {{ quote(absolute_path(directory) / "offline") }}
    {{ just_executable() }} image {{ quote(absolute_path(directory) / "candidate") }}
    for major in {{ odoo_majors }}; do {{ just_executable() }} odoo {{ quote(absolute_path(directory) / "candidate") }} "$major"; done
    {{ just_executable() }} archive {{ quote(absolute_path(directory) / "candidate") }}

r2: sync
    pnpm exec vitest run tests/ts/artifacts.test.ts tests/ts/storage.test.ts tests/ts/worker.test.ts

# Set up per-project semantic navigation (Claude Code LSP plugin, Codex Serena). Safe to rerun.
setup-nav:
    #!/usr/bin/env bash
    set -euo pipefail
    for tool in corepack uvx; do
        command -v "$tool" >/dev/null || { echo "setup-nav: $tool not on PATH" >&2; exit 1; }
    done
    corepack pnpm install --frozen-lockfile
    if command -v claude >/dev/null; then
        claude plugin install typescript-lsp@claude-plugins-official --scope project
        echo "setup-nav: start Claude Code with 'corepack pnpm exec claude' so the project language server is on PATH"
    else
        echo "setup-nav: claude not on PATH; skipping Claude Code plugin"
    fi
    if command -v codex >/dev/null; then
        if codex mcp get serena >/dev/null 2>&1; then
            echo "setup-nav: Codex loads Serena from .codex/config.toml"
        else
            echo "setup-nav: trust this checkout (or its main checkout) in Codex so it loads .codex/config.toml" >&2
        fi
    else
        echo "setup-nav: codex not on PATH; skipping Codex check"
    fi
    uvx --from serena-agent==2.1.0 serena project health-check {{ quote(justfile_directory()) }}
