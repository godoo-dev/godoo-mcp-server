odoo_majors := "18 19"

set shell := ["bash", "-euo", "pipefail", "-c"]

default:
    @just --list

sync:
    pnpm install --frozen-lockfile

lint: sync
    pnpm typecheck
    pnpm lint

test *args: sync
    pnpm exec vitest run {{ args }}
    node --test .github/testing/candidate.test.mjs

build: sync
    pnpm build

offline evidence:
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
    pnpm build
    pnpm exec vitest run --reporter=default --reporter=junit --outputFile.junit="$evidence/offline.xml"
    node --test --test-reporter=junit --test-reporter-destination="$evidence/controls.xml" .github/testing/candidate.test.mjs
    printf -v server_command '%q %q' "$(command -v node)" "$PWD/dist/node.mjs"
    node .github/testing/http-probe.mjs --command "$server_command" --evidence "$evidence/http-source"
    node .github/testing/candidate.mjs finish-offline --evidence "$evidence"

package directory source_ref evidence:
    node .github/testing/candidate.mjs package --directory {{ quote(absolute_path(directory)) }} --source-ref {{ quote(source_ref) }} --evidence {{ quote(absolute_path(evidence)) }}

image directory:
    node .github/testing/candidate.mjs image --directory {{ quote(absolute_path(directory)) }}

odoo directory major="18":
    node .github/testing/candidate.mjs odoo --directory {{ quote(absolute_path(directory)) }} --major {{ quote(major) }}

archive directory:
    node .github/testing/candidate.mjs archive --directory {{ quote(absolute_path(directory)) }}

r2: sync
    pnpm exec vitest run tests/ts/artifacts.test.ts tests/ts/storage.test.ts tests/ts/worker.test.ts

# Run the same CI workflow locally, retaining its tested-candidate artifact.
validate evidence *args:
    #!/usr/bin/env bash
    set -euo pipefail
    options=()
    if [[ -f .git ]]; then
      common=$(git rev-parse --path-format=absolute --git-common-dir)
      options+=(--container-options "--volume $common:$common:ro")
    fi
    act workflow_dispatch --workflows .github/workflows/ci.yml --network host --rm \
      --env-file /dev/null --secret-file /dev/null --input-file /dev/null --var-file /dev/null \
      --platform ubuntu-latest=ghcr.io/catthehacker/ubuntu:act-latest@sha256:62d572b92f9f32d3427b6d220ad1f9dca9c7b6ffad37d295425037dbff78abaf \
      --artifact-server-path {{ quote(absolute_path(evidence)) }} "${options[@]}" {{ args }}
