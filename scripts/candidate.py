#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.14"
# dependencies = []
# ///
"""Candidate identities shared by local checks and credential-free promotion preflight."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import tomllib
import xml.etree.ElementTree as ET
import zipfile
from email.parser import BytesParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANDATORY = {"offline", "package", "odoo18"}


def run(*args: str, cwd: Path = ROOT) -> str:
    return subprocess.check_output(args, cwd=cwd, text=True).strip()


def sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def source_identity() -> dict:
    """Include tracked changes and untracked input bytes; ignored outputs are not inputs."""
    patch = subprocess.check_output(["git", "diff", "HEAD", "--binary"], cwd=ROOT)
    names = subprocess.check_output(
        ["git", "ls-files", "--others", "--exclude-standard", "-z"], cwd=ROOT
    ).split(b"\0")
    untracked = {
        os.fsdecode(name): sha256(ROOT / os.fsdecode(name))
        for name in names
        if name and (ROOT / os.fsdecode(name)).is_file()
    }
    return {
        "sha": run("git", "rev-parse", "HEAD"),
        "patch_sha256": hashlib.sha256(patch).hexdigest(),
        "untracked": untracked,
        "dirty": bool(patch or untracked or run("git", "status", "--porcelain")),
    }


def version() -> str:
    return tomllib.loads((ROOT / "pyproject.toml").read_text())["project"]["version"]


def require_results(results: dict, requested19: bool = False) -> None:
    expected = MANDATORY | ({"odoo19"} if requested19 or "odoo19" in results else set())
    if set(results) != expected or any(
        not isinstance(results[name], dict) or results[name].get("result") != "success"
        for name in MANDATORY
    ):
        raise ValueError(f"Every mandatory job must succeed: {results}")
    if "odoo19" in expected and (
        not isinstance(results["odoo19"], dict)
        or results["odoo19"].get("result") != ("success" if requested19 else "skipped")
    ):
        raise ValueError(f"Requested compatibility result must match selection: {results}")


def require_junit(path: Path) -> int:
    root = ET.parse(path).getroot()
    cases = list(root.iter("testcase"))
    if not cases or any(
        any(child.tag in {"skipped", "failure", "error"} for child in case) for case in cases
    ):
        raise ValueError(f"Empty, skipped or failing required suite: {path}")
    # Collection/setup errors may live outside testcase nodes.
    if any(
        int(suite.get(key, "0"))
        for suite in root.iter("testsuite")
        for key in ("errors", "failures", "skipped")
    ):
        raise ValueError(f"Required suite did not complete: {path}")
    return len(cases)


def file_record(path: Path) -> dict:
    return {"file": path.name, "sha256": sha256(path)}


def read_manifest(directory: Path) -> dict:
    return json.loads((directory / "candidate.json").read_text())


def write_manifest(directory: Path, manifest: dict) -> None:
    (directory / "candidate.json").write_text(json.dumps(manifest, indent=2) + "\n")


def check_file(directory: Path, record: dict) -> Path:
    name = record["file"]
    if Path(name).name != name or name in {".", ".."}:
        raise ValueError("Candidate file must be a direct child")
    path = directory / name
    if path.is_symlink() or sha256(path) != record["sha256"]:
        raise ValueError(f"Candidate hash mismatch: {name}")
    return path


def verify(directory: Path, *, complete: bool = False, release_ref: str | None = None) -> dict:
    manifest = read_manifest(directory)
    if manifest["source"] != source_identity():
        raise ValueError("Candidate source identity differs from checkout")
    if manifest["version"] != version() or manifest["lock_sha256"] != sha256(ROOT / "uv.lock"):
        raise ValueError("Candidate version/lock mismatch")
    wheel = check_file(directory, manifest["wheel"])
    check_file(directory, manifest["requirements"])
    with zipfile.ZipFile(wheel) as archive:
        metadata = [name for name in archive.namelist() if name.endswith(".dist-info/METADATA")]
        if len(metadata) != 1:
            raise ValueError("Expected one wheel metadata record")
        fields = BytesParser().parsebytes(archive.read(metadata[0]))
        if fields["Name"] != "godoo-mcp-server" or fields["Version"] != manifest["version"]:
            raise ValueError("Wheel metadata differs from candidate")
    if complete:
        image = manifest["image"]
        check_file(directory, image["archive"])
        if not re.fullmatch(r"sha256:[0-9a-f]{64}", image["id"]):
            raise ValueError("Missing tested image identity")
        if manifest.get("odoo18") != {"requested_major": 18, "observed_major": 18}:
            raise ValueError("Successful Odoo18 proof is required first")
        for name in ("integration", "image"):
            record = manifest["proofs"][name]
            if require_junit(check_file(directory, record)) != record["tests"]:
                raise ValueError("Candidate test count mismatch")
        facts = [
            json.loads(line)
            for line in check_file(directory, manifest["odoo_facts"]).read_text().splitlines()
        ]
        if len(facts) != 2 or any(
            row.get("requested_major") != 18
            or row.get("observed_major") != 18
            or row.get("modules") != ["base", "mail"]
            for row in facts
        ):
            raise ValueError("Missing observed18 facts for both required harnesses")
    if release_ref is not None:
        require_release_ref(release_ref, manifest["source"]["sha"], manifest["version"])
        if manifest["source"]["dirty"] or manifest["source_ref"] != release_ref:
            raise ValueError("Publication requires a clean matching tag candidate")
    return manifest


def require_release_ref(ref: str, sha: str, package_version: str) -> None:
    if ref != f"refs/tags/v{package_version}":
        raise ValueError("Publication ref must be the v<metadata-version> tag")
    if run("git", "rev-parse", f"{ref}^{{commit}}") != sha:
        raise ValueError("Release tag points at another source SHA")
    subprocess.run(["git", "merge-base", "--is-ancestor", sha, "origin/main"], cwd=ROOT, check=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("required")
    release = sub.add_parser("release-ref")
    release.add_argument("--ref", required=True)
    check = sub.add_parser("verify")
    check.add_argument("--candidate-dir", required=True, type=Path)
    check.add_argument("--release-ref")
    check.add_argument("--loaded-image", action="store_true")
    args = parser.parse_args()
    if args.command == "required":
        requested = os.environ.get("REQUESTED19", "false")
        if requested not in {"true", "false"}:
            raise ValueError("REQUESTED19 must be true or false")
        require_results(json.loads(os.environ["RESULTS"]), requested == "true")
    elif args.command == "release-ref":
        require_release_ref(args.ref, run("git", "rev-parse", "HEAD"), version())
    else:
        manifest = verify(args.candidate_dir, complete=True, release_ref=args.release_ref)
        if args.loaded_image:
            observed = run(
                "docker", "image", "inspect", "--format", "{{.Id}}", manifest["image"]["id"]
            )
            if observed != manifest["image"]["id"]:
                raise ValueError("Loaded image differs from tested image")
        print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
