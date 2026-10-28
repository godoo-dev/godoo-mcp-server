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
import tarfile
import tomllib
import xml.etree.ElementTree as ET
import zipfile
from email.parser import BytesParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANDATORY = {"offline", "r2", "package", "image", "odoo", "archive"}


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


def require_results(results: dict) -> None:
    if set(results) != MANDATORY or any(
        not isinstance(result, dict) or result.get("result") != "success"
        for result in results.values()
    ):
        raise ValueError(f"Every mandatory job must succeed: {results}")


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
        majors = manifest["odoo_majors"]
        if 18 not in majors or any(type(major) is not int or major < 18 for major in majors):
            raise ValueError("Missing supported Odoo qualification majors")
        for major in majors:
            qualification = json.loads((directory / f"odoo-{major}.json").read_text())
            if qualification["image_id"] != image["id"]:
                raise ValueError("Qualification used another candidate image")
            for name in ("integration", "image"):
                record = qualification["proofs"][name]
                if require_junit(check_file(directory, record)) != record["tests"]:
                    raise ValueError("Candidate test count mismatch")
            validate_facts(check_file(directory, qualification["facts"]), major)
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


def loaded_image_ref(directory: Path, manifest: dict) -> str:
    """Accept only daemon identities derived from the exact tested image archive."""
    image = manifest["image"]
    archive_path = check_file(directory, image["archive"])
    with tarfile.open(archive_path) as archive:
        entries = json.load(archive.extractfile("manifest.json"))
        if len(entries) != 1 or entries[0].get("RepoTags") != [image["tag"]]:
            raise ValueError("Expected the single tested image tag in archive")
        config = archive.extractfile(entries[0]["Config"]).read()
        config_id = "sha256:" + hashlib.sha256(config).hexdigest()
        identities = {config_id}
        if "index.json" in archive.getnames():
            index = json.load(archive.extractfile("index.json"))
            descriptors = index["manifests"]
            if len(descriptors) != 1:
                raise ValueError("Expected one archived image descriptor")
            descriptor = descriptors[0]
            digest = descriptor["digest"]
            if not re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
                raise ValueError("Invalid archived image digest")
            payload = archive.extractfile("blobs/sha256/" + digest.split(":")[1]).read()
            if "sha256:" + hashlib.sha256(payload).hexdigest() != digest:
                raise ValueError("Archived image descriptor digest mismatch")
            if json.loads(payload)["config"]["digest"] != config_id:
                raise ValueError("Archived image descriptor config mismatch")
            identities.add(digest)
    if image["id"] not in identities:
        raise ValueError("Tested image identity differs from archive")
    observed = run("docker", "image", "inspect", "--format", "{{.Id}}", image["tag"])
    if observed not in identities:
        raise ValueError("Loaded image differs from tested archive")
    return image["tag"]


def validate_facts(path: Path, major: int) -> list:
    facts = [json.loads(line) for line in path.read_text().splitlines()]
    if len(facts) != 2 or any(
        row.get("requested_major") != major
        or row.get("observed_major") != major
        or row.get("modules") != ["base", "mail"]
        for row in facts
    ):
        raise ValueError(f"Missing observed Odoo{major} facts for both harnesses")
    return facts


def record_package(directory: Path, source_ref: str) -> None:
    identity = json.loads((directory / "source.json").read_text())
    if source_identity() != identity:
        raise ValueError("Source changed while building/testing candidate")
    wheels = list(directory.glob("*.whl"))
    if len(wheels) != 1:
        raise ValueError("Expected exactly one candidate wheel")
    write_manifest(
        directory,
        {
            "schema": 1,
            "source": identity,
            "source_ref": source_ref,
            "version": version(),
            "lock_sha256": sha256(ROOT / "uv.lock"),
            "wheel": file_record(wheels[0]),
            "requirements": file_record(directory / "requirements.txt"),
            "tools": {
                "uv": run("uv", "--version"),
                "python": run("uv", "run", "--frozen", "python", "--version"),
            },
        },
    )
    verify(directory)


def record_image(directory: Path, tag: str, majors: list[int]) -> None:
    manifest = verify(directory)
    if not majors or any(major < 18 for major in majors):
        raise ValueError("Select Odoo majors >=18")
    manifest.update(
        {
            "image": {
                "id": run("docker", "image", "inspect", "--format", "{{.Id}}", tag),
                "tag": tag,
                "archive": file_record(directory / "image.tar"),
            },
            "odoo_majors": majors,
        }
    )
    write_manifest(directory, manifest)


def record_qualification(directory: Path, major: int) -> None:
    manifest = verify(directory)
    facts = directory / f"odoo-{major}-facts.jsonl"
    for row in validate_facts(facts, major):
        for resource, identity in [
            *(("container", item["id"]) for item in row["containers"]),
            ("network", row["network_id"]),
        ]:
            if (
                subprocess.run(
                    ["docker", resource, "inspect", identity], capture_output=True
                ).returncode
                == 0
            ):
                raise ValueError(f"Owned {resource} remains after teardown: {identity}")
    proofs = {}
    for name in ("integration", "image"):
        report = directory / f"odoo-{major}-{name}.xml"
        proofs[name] = {**file_record(report), "tests": require_junit(report)}
    (directory / f"odoo-{major}.json").write_text(
        json.dumps(
            {
                "image_id": manifest["image"]["id"],
                "proofs": proofs,
                "facts": file_record(facts),
            },
            indent=2,
        )
        + "\n"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("required")
    sub.add_parser("source")
    sub.add_parser("version")
    junit = sub.add_parser("junit")
    junit.add_argument("path", type=Path)
    release = sub.add_parser("release-ref")
    release.add_argument("--ref", required=True)
    for command in ("verify", "record-package", "record-image", "record-qualification"):
        check = sub.add_parser(command)
        check.add_argument("--candidate-dir", required=True, type=Path)
        if command == "verify":
            check.add_argument("--release-ref")
            check.add_argument("--loaded-image", action="store_true")
            check.add_argument("--complete", action="store_true")
        elif command == "record-package":
            check.add_argument("--source-ref", required=True)
        elif command == "record-image":
            check.add_argument("--tag", required=True)
            check.add_argument("--majors", required=True, nargs="+", type=int)
        else:
            check.add_argument("--major", required=True, type=int)
    args = parser.parse_args()
    if args.command == "required":
        require_results(json.loads(os.environ["RESULTS"]))
    elif args.command == "source":
        print(json.dumps(source_identity()))
    elif args.command == "version":
        print(version())
    elif args.command == "junit":
        print(require_junit(args.path))
    elif args.command == "release-ref":
        require_release_ref(args.ref, run("git", "rev-parse", "HEAD"), version())
    elif args.command == "record-package":
        record_package(args.candidate_dir, args.source_ref)
    elif args.command == "record-image":
        record_image(args.candidate_dir, args.tag, args.majors)
    elif args.command == "record-qualification":
        record_qualification(args.candidate_dir, args.major)
    else:
        manifest = verify(args.candidate_dir, complete=args.complete, release_ref=args.release_ref)
        if args.loaded_image:
            loaded_image_ref(args.candidate_dir, manifest)
        print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
