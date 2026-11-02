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
    node --test scripts/candidate.test.mjs

build: sync
    pnpm build

offline evidence:
    node scripts/candidate.mjs offline --evidence "{{ absolute_path(evidence) }}"

package directory source_ref="local" evidence="":
    node scripts/candidate.mjs package --directory "{{ absolute_path(directory) }}" --source-ref "{{ source_ref }}" {{ if evidence != "" { "--evidence '" + absolute_path(evidence) + "'" } else { "" } }}

image directory:
    node scripts/candidate.mjs image --directory "{{ absolute_path(directory) }}"

odoo directory major="18":
    node scripts/candidate.mjs odoo --directory "{{ absolute_path(directory) }}" --major "{{ major }}"

archive directory:
    node scripts/candidate.mjs archive --directory "{{ absolute_path(directory) }}"

r2: sync
    pnpm exec vitest run tests/ts/artifacts.test.ts tests/ts/storage.test.ts tests/ts/worker.test.ts

# All gates consume one immutable package, Worker bundle and container image.
validate evidence:
    just offline "{{ absolute_path(evidence) }}/offline"
    just package "{{ absolute_path(evidence) }}/candidate" "local" "{{ absolute_path(evidence) }}/offline"
    just image "{{ absolute_path(evidence) }}/candidate"
    just odoo "{{ absolute_path(evidence) }}/candidate" 18
    just odoo "{{ absolute_path(evidence) }}/candidate" 19
    just archive "{{ absolute_path(evidence) }}/candidate"
