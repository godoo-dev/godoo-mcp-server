odoo_majors := "18 19"

set shell := ["bash", "-euo", "pipefail", "-c"]

# List the available development commands.
default:
    @just --list

sync:
    uv sync --frozen --all-groups

lint: sync
    uv run --frozen ruff check .
    uv run --frozen ruff format --check .
    uv run --frozen mypy --strict src/

test *args: sync
    #!/usr/bin/env bash
    set -euo pipefail
    unset PYTHONPATH PYTHONHOME VIRTUAL_ENV
    for variable in ${!ODOO_@} ${!MCP_@}; do unset "$variable"; done
    uv run --frozen pytest {{ args }}

http evidence python=".venv/bin/python":
    uv run --frozen python scripts/http_probe.py --python "{{ absolute_path(python) }}" --evidence-dir "{{ absolute_path(evidence) }}"

offline evidence: lint
    mkdir -p "{{ evidence }}"
    just test --capture=tee-sys -o junit_logging=all --junitxml="{{ evidence }}/offline.xml" --basetemp="{{ evidence }}/offline-tmp"
    uv run --frozen python scripts/candidate.py junit "{{ evidence }}/offline.xml"
    just http "{{ evidence }}/http-source"

# Build and exercise one wheel outside the source checkout.
package directory source_ref="local": sync
    #!/usr/bin/env bash
    set -euo pipefail
    directory=$(realpath -m "{{ directory }}")
    [[ "$directory" != "{{ justfile_directory() }}" && "$directory" != "{{ justfile_directory() }}"/* && ! -e "$directory/candidate.json" ]]
    mkdir -p "$directory"
    uv run --frozen python scripts/candidate.py source > "$directory/source.json"
    uv build --wheel --out-dir "$directory"
    uv export --frozen --no-dev --no-emit-project --no-header > "$directory/requirements.txt"
    consumer=$(mktemp -d)
    trap 'rm -rf "$consumer"' EXIT
    uv venv --python "{{ justfile_directory() }}/.venv/bin/python" "$consumer/venv"
    uv pip sync --require-hashes --python "$consumer/venv/bin/python" "$directory/requirements.txt"
    uv pip install --python "$consumer/venv/bin/python" --no-deps "$directory/"*.whl
    "$consumer/venv/bin/python" -I scripts/installed_probe.py "$(uv run --frozen python scripts/candidate.py version)"
    just http "$directory/http-installed" "$consumer/venv/bin/python"
    uv run --frozen python scripts/candidate.py record-package --candidate-dir "$directory" --source-ref "{{ source_ref }}"

# Build once; all Odoo matrix entries consume this exact archive.
image directory: sync
    #!/usr/bin/env bash
    set -euo pipefail
    directory=$(realpath "{{ directory }}")
    uv run --frozen python scripts/candidate.py verify --candidate-dir "$directory"
    context=$(mktemp -d)
    tag="godoo-mcp-server:candidate-$(cat /proc/sys/kernel/random/uuid)"
    trap 'rm -rf "$context"; docker image rm "$tag"' EXIT
    cp pyproject.toml uv.lock Dockerfile "$context"
    mkdir "$context/dist"
    cp "$directory/"*.whl "$context/dist"
    docker build --pull --provenance=false --tag "$tag" "$context"
    docker save --output "$directory/image.tar" "$tag"
    uv run --frozen python scripts/candidate.py record-image --candidate-dir "$directory" --tag "$tag" --majors {{ odoo_majors }}

odoo directory major="18": sync
    #!/usr/bin/env bash
    set -euo pipefail
    directory=$(realpath "{{ directory }}")
    uv run --frozen python scripts/candidate.py verify --candidate-dir "$directory"
    tag=$(uv run --frozen python -c 'import json,sys; print(json.load(open(sys.argv[1]))["image"]["tag"])' "$directory/candidate.json")
    owned=false
    if ! docker image inspect "$tag" >/dev/null 2>&1; then
        owned=true
        trap 'if $owned; then docker image rm "$tag"; fi' EXIT
        docker load --input "$directory/image.tar"
    fi
    uv run --frozen python scripts/candidate.py verify --candidate-dir "$directory" --loaded-image
    unset PYTHONPATH PYTHONHOME VIRTUAL_ENV
    for variable in ${!ODOO_@} ${!MCP_@}; do unset "$variable"; done
    export ODOO_VERSION="{{ major }}.0" MCP_TEST_ODOO_MAJOR="{{ major }}" MCP_REQUIRED_TESTS=1
    export MCP_CANDIDATE_IMAGE=$(docker image inspect --format '{{ '{{.Id}}' }}' "$tag")
    export MCP_EXPECTED_VERSION=$(uv run --frozen python scripts/candidate.py version)
    export MCP_ODOO_FACTS="$directory/odoo-{{ major }}-facts.jsonl"
    rm -f "$MCP_ODOO_FACTS"
    for suite in integration image; do
        if [[ "$suite" == integration ]]; then selection="-m integration tests/integration"; else selection="-m e2e tests/e2e/test_docker_image.py"; fi
        uv run --frozen pytest $selection --capture=tee-sys -o junit_logging=all --junitxml="$directory/odoo-{{ major }}-$suite.xml" --basetemp="$directory/odoo-{{ major }}-$suite-tmp"
    done
    uv run --frozen python scripts/candidate.py record-qualification --candidate-dir "$directory" --major {{ major }}

archive directory:
    python scripts/candidate.py verify --candidate-dir "{{ directory }}" --complete
    docker load --input "{{ directory }}/image.tar"
    python scripts/candidate.py verify --candidate-dir "{{ directory }}" --complete --loaded-image

# Node dependencies are only used by the local R2 emulator.
r2: sync
    npm ci --prefix tests/r2
    node tests/r2/run.mjs
