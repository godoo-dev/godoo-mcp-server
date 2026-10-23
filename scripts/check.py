#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.14"
# dependencies = []
# ///
"""Frozen native offline/package/Odoo checks; no publication or external credentials."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

from candidate import (
    ROOT,
    file_record,
    require_junit,
    run,
    sha256,
    source_identity,
    verify,
    version,
    write_manifest,
)
from http_probe import clean_env, probe


def execute(*args: str, cwd: Path = ROOT, env: dict | None = None) -> None:
    print("+", " ".join(args), flush=True)
    subprocess.run(args, cwd=cwd, env=env or clean_env(), check=True)


def suite(directory: Path, name: str, *args: str, env: dict | None = None) -> dict:
    report = directory / f"{name}.xml"
    report.unlink(missing_ok=True)
    execute(
        "uv",
        "run",
        "--frozen",
        "pytest",
        *args,
        "--capture=tee-sys",
        "-o",
        "junit_logging=all",
        f"--junitxml={report}",
        f"--basetemp={directory / (name + '-tmp')}",
        env=env,
    )
    return {**file_record(report), "tests": require_junit(report)}


def offline(directory: Path) -> None:
    for arguments in (
        ("ruff", "check", "."),
        ("ruff", "format", "--check", "."),
        ("mypy", "--strict", "src/"),
    ):
        execute("uv", "run", "--frozen", *arguments)
    suite(directory, "offline")
    probe(ROOT / ".venv/bin/python", directory / "http-source")


def package(directory: Path, source_ref: str) -> None:
    if (directory / "candidate.json").exists():
        raise ValueError("Use a new candidate directory; do not overwrite a tested candidate")
    identity = source_identity()
    execute("uv", "build", "--wheel", "--out-dir", str(directory))
    wheels = list(directory.glob("*.whl"))
    if len(wheels) != 1:
        raise ValueError("Expected exactly one candidate wheel")
    requirements = directory / "requirements.txt"
    requirements.write_text(
        run(
            "uv",
            "export",
            "--frozen",
            "--no-dev",
            "--no-emit-project",
            "--no-header",
        )
    )
    with tempfile.TemporaryDirectory(prefix="mcp-consumer-") as temporary:
        consumer = Path(temporary)
        python = consumer / ".venv/bin/python"
        execute("uv", "venv", "--python", str(ROOT / ".venv/bin/python"), str(consumer / ".venv"))
        execute(
            "uv",
            "pip",
            "sync",
            "--require-hashes",
            "--python",
            str(python),
            str(requirements),
            cwd=consumer,
        )
        execute(
            "uv",
            "pip",
            "install",
            "--python",
            str(python),
            "--no-deps",
            str(wheels[0]),
            cwd=consumer,
        )
        execute(
            str(python), "-I", str(ROOT / "scripts/installed_probe.py"), version(), cwd=consumer
        )
        probe(python, directory / "http-installed")
    if source_identity() != identity:
        raise ValueError("Source changed while building/testing candidate")
    write_manifest(
        directory,
        {
            "schema": 1,
            "source": identity,
            "source_ref": source_ref,
            "version": version(),
            "lock_sha256": sha256(ROOT / "uv.lock"),
            "wheel": file_record(wheels[0]),
            "requirements": file_record(requirements),
            "tools": {
                "uv": run("uv", "--version"),
                "python": run(str(ROOT / ".venv/bin/python"), "--version"),
            },
        },
    )
    verify(directory)


def odoo(directory: Path, major: int) -> None:
    requested = os.environ.get("ODOO_VERSION", f"{major}.0")
    if requested not in {str(major), f"{major}.0"}:
        raise ValueError(f"Explicit ODOO_VERSION={requested} conflicts with required {major}")
    manifest = verify(directory, complete=major == 19)
    if major == 19 and manifest.get("odoo18", {}).get("observed_major") != 18:
        raise ValueError("Optional19 needs the same candidate's successful18 proof")
    execute("docker", "info", "--format", "{{.ServerVersion}}")
    tag = f"godoo-mcp-server:candidate-{uuid.uuid4().hex}"
    owned_image = major == 18
    if not owned_image:
        # A downloaded archive preserves the exact18-tested image bytes.
        execute("docker", "load", "--input", str(directory / manifest["image"]["archive"]["file"]))
        tag = manifest["image"]["id"]
    try:
        if owned_image:
            with tempfile.TemporaryDirectory(prefix="mcp-image-") as temporary:
                context = Path(temporary)
                for name in ("pyproject.toml", "uv.lock", "Dockerfile"):
                    shutil.copy2(ROOT / name, context / name)
                (context / "dist").mkdir()
                shutil.copy2(directory / manifest["wheel"]["file"], context / "dist")
                execute(
                    "docker",
                    "build",
                    "--pull",
                    "--label",
                    f"org.opencontainers.image.revision={manifest['source']['sha']}",
                    "--label",
                    f"dev.godoo.wheel.sha256={manifest['wheel']['sha256']}",
                    "--tag",
                    tag,
                    str(context),
                )
        image_id = run("docker", "image", "inspect", "--format", "{{.Id}}", tag)
        if not owned_image and image_id != manifest["image"]["id"]:
            raise ValueError("Optional19 image differs from tested18 image")
        prefix = "" if major == 18 else "odoo19-"
        facts = directory / f"{prefix}odoo-facts.jsonl"
        facts.unlink(missing_ok=True)
        env = {
            **clean_env(),
            "ODOO_VERSION": f"{major}.0",
            "MCP_TEST_ODOO_MAJOR": str(major),
            "MCP_CANDIDATE_IMAGE": image_id,
            "MCP_ODOO_FACTS": str(facts),
            "MCP_EXPECTED_VERSION": manifest["version"],
            "MCP_REQUIRED_TESTS": "1",
            "MCP_18_CANDIDATE_PROOF": str(directory),
        }
        proofs = {}
        proofs["integration"] = suite(
            directory,
            f"{prefix}integration",
            "-m",
            "integration",
            "tests/integration/test_vertical.py",
            env=env,
        )
        proofs["image"] = suite(
            directory, f"{prefix}image", "-m", "e2e", "tests/e2e/test_docker_image.py", env=env
        )
        facts_rows = [json.loads(line) for line in facts.read_text().splitlines()]
        if len(facts_rows) != 2 or any(row["observed_major"] != major for row in facts_rows):
            raise ValueError("Missing actual Odoo major observations")
        cleanup = []
        for row in facts_rows:
            for resource, identity in [
                *(("container", c["id"]) for c in row["containers"]),
                ("network", row["network_id"]),
            ]:
                result = subprocess.run(
                    ["docker", resource, "inspect", identity], capture_output=True
                )
                if result.returncode == 0:
                    raise ValueError(f"Owned {resource} remains after fixture teardown: {identity}")
                cleanup.append({"kind": resource, "id": identity, "removed": True})
        (directory / f"{prefix}cleanup.json").write_text(json.dumps(cleanup, indent=2) + "\n")
        verify(directory, complete=major == 19)
        if owned_image:
            archive = directory / "image.tar"
            execute("docker", "save", "--output", str(archive), tag)
            manifest.update(
                {
                    "image": {"id": image_id, "tag": tag, "archive": file_record(archive)},
                    "proofs": proofs,
                    "odoo_facts": file_record(facts),
                    "odoo18": {"requested_major": 18, "observed_major": 18},
                }
            )
            write_manifest(directory, manifest)
            verify(directory, complete=True)
        else:
            (directory / "odoo19.json").write_text(
                json.dumps(
                    {
                        "candidate_sha256": sha256(directory / "candidate.json"),
                        "image_id": image_id,
                        "proofs": proofs,
                        "observed_major": 19,
                    },
                    indent=2,
                )
                + "\n"
            )
    finally:
        if owned_image:
            # Only this invocation's unique tag; caller-supplied fixture images are retained.
            subprocess.run(["docker", "image", "rm", tag], check=False)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("offline", "package", "odoo18", "odoo19"))
    parser.add_argument("--candidate-dir", type=Path)
    parser.add_argument("--evidence-dir", type=Path)
    parser.add_argument("--source-ref", default=os.environ.get("GITHUB_REF", "local"))
    args = parser.parse_args()
    directory = args.evidence_dir if args.mode == "offline" else args.candidate_dir
    if directory is None:
        if args.mode != "offline":
            parser.error("--candidate-dir is required for immutable artifact checks")
        directory = Path(tempfile.mkdtemp(prefix="mcp-offline-"))
    directory = directory.expanduser().resolve()
    if directory.is_relative_to(ROOT):
        parser.error("Place candidate/evidence outside the checkout")
    directory.mkdir(parents=True, exist_ok=True)
    print(f"Evidence: {directory}", flush=True)
    execute("uv", "sync", "--frozen", "--all-groups")
    if args.mode == "offline":
        offline(directory)
    elif args.mode == "package":
        package(directory, args.source_ref)
    else:
        odoo(directory, 18 if args.mode == "odoo18" else 19)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, subprocess.CalledProcessError) as error:
        print(f"Check rejected: {error}", file=sys.stderr)
        raise SystemExit(1) from error
