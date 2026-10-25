"""Credential-free rejection tests for candidate and integration/release boundaries."""

from __future__ import annotations

import copy
import hashlib
import io
import json
import os
import subprocess
import sys
import tarfile
import zipfile

import pytest

from scripts import candidate
from tests.odoo_proof import requested_major


@pytest.fixture
def archived_image(tmp_path):
    config = b'{"rootfs":{"diff_ids":["sha256:test-layer"]}}'
    config_id = "sha256:" + hashlib.sha256(config).hexdigest()
    payload = json.dumps({"config": {"digest": config_id}}).encode()
    descriptor_id = "sha256:" + hashlib.sha256(payload).hexdigest()
    tag = "godoo-mcp-server:candidate-owned"
    files = {
        "manifest.json": json.dumps(
            [{"Config": "config.json", "RepoTags": [tag], "Layers": []}]
        ).encode(),
        "config.json": config,
        "index.json": json.dumps({"manifests": [{"digest": descriptor_id}]}).encode(),
        "blobs/sha256/" + descriptor_id.split(":")[1]: payload,
    }
    archive = tmp_path / "image.tar"
    with tarfile.open(archive, "w") as stream:
        for name, content in files.items():
            member = tarfile.TarInfo(name)
            member.size = len(content)
            stream.addfile(member, io.BytesIO(content))
    manifest = {"image": {"id": config_id, "tag": tag, "archive": candidate.file_record(archive)}}
    return tmp_path, manifest, config_id, descriptor_id


@pytest.mark.parametrize("recorded_kind", [2, 3])
@pytest.mark.parametrize("loaded_kind", [2, 3])
def test_loaded_archive_accepts_both_daemon_identity_forms(
    archived_image, monkeypatch, recorded_kind, loaded_kind
):
    directory, manifest, *_ = archived_image
    manifest["image"]["id"] = archived_image[recorded_kind]
    calls = []

    def inspect(*args):
        calls.append(args)
        return archived_image[loaded_kind]

    monkeypatch.setattr(candidate, "run", inspect)
    assert candidate.loaded_image_ref(directory, manifest) == manifest["image"]["tag"]
    assert calls[0][-1] == manifest["image"]["tag"]


def test_loaded_archive_rejects_retargeted_tag(archived_image, monkeypatch):
    directory, manifest, *_ = archived_image
    monkeypatch.setattr(candidate, "run", lambda *args: "sha256:" + "f" * 64)
    with pytest.raises(ValueError, match="Loaded image differs"):
        candidate.loaded_image_ref(directory, manifest)


def test_loaded_archive_rejects_unrelated_recorded_identity(archived_image):
    directory, manifest, *_ = archived_image
    manifest["image"]["id"] = "sha256:" + "f" * 64
    with pytest.raises(ValueError, match="Tested image identity differs"):
        candidate.loaded_image_ref(directory, manifest)


def test_loaded_archive_rejects_unrelated_recorded_tag(archived_image):
    directory, manifest, *_ = archived_image
    manifest["image"]["tag"] += "-other"
    with pytest.raises(ValueError, match="single tested image tag"):
        candidate.loaded_image_ref(directory, manifest)


@pytest.mark.parametrize("result", ["failure", "skipped", "cancelled", "", None, False])
def test_required_rejects_every_non_success(result):
    results = {name: {"result": "success"} for name in candidate.MANDATORY}
    candidate.require_results(results)
    results["odoo18"]["result"] = result
    with pytest.raises(ValueError):
        candidate.require_results(results)


@pytest.mark.parametrize("names", [[], ["offline", "package"], ["offline", "package", "extra"]])
def test_required_rejects_missing_or_unexpected_jobs(names):
    with pytest.raises(ValueError):
        candidate.require_results({name: {"result": "success"} for name in names})


@pytest.mark.parametrize("requested", [True, False])
@pytest.mark.parametrize(
    "state", ["success", "failure", "cancelled", "skipped", "pending", "missing", None]
)
def test_requested_compatibility_contributes_to_required(requested, state):
    results = {name: {"result": "success"} for name in candidate.MANDATORY}
    if state != "missing":
        results["odoo19"] = {"result": state}
    result = subprocess.run(
        [sys.executable, str(candidate.ROOT / "scripts/candidate.py"), "required"],
        env={**os.environ, "RESULTS": json.dumps(results), "REQUESTED19": str(requested).lower()},
        text=True,
        capture_output=True,
    )
    accepted = state == ("success" if requested else "skipped") or (
        not requested and state == "missing"
    )
    assert (result.returncode == 0) == accepted, result.stderr


@pytest.mark.parametrize(
    "content",
    [
        '<testsuite tests="0"/>',
        '<testsuite tests="1" skipped="1"><testcase><skipped/></testcase></testsuite>',
        '<testsuite tests="1"><testcase><failure/></testcase></testsuite>',
        '<testsuite tests="0" errors="1"><error/></testsuite>',
    ],
)
def test_required_suite_rejects_empty_skipped_and_failed(tmp_path, content):
    path = tmp_path / "suite.xml"
    path.write_text(content)
    with pytest.raises(ValueError):
        candidate.require_junit(path)
    path.write_text('<testsuite tests="1"><testcase name="actual-proof"/></testsuite>')
    assert candidate.require_junit(path) == 1


@pytest.fixture
def packed_candidate(tmp_path, monkeypatch):
    identity = {"sha": "a" * 40, "patch_sha256": "b" * 64, "untracked": {}, "dirty": False}
    monkeypatch.setattr(candidate, "source_identity", lambda: identity)
    monkeypatch.setattr(candidate, "version", lambda: "1.2.3")
    root = tmp_path / "source"
    root.mkdir()
    (root / "uv.lock").write_text("locked")
    monkeypatch.setattr(candidate, "ROOT", root)
    wheel = tmp_path / "godoo_mcp_server-1.2.3-py3-none-any.whl"
    with zipfile.ZipFile(wheel, "w") as archive:
        archive.writestr(
            "godoo_mcp_server-1.2.3.dist-info/METADATA", "Name: godoo-mcp-server\nVersion: 1.2.3\n"
        )
    requirements = tmp_path / "requirements.txt"
    requirements.write_text("dependency==1.0\n")
    manifest = {
        "source": identity,
        "version": "1.2.3",
        "lock_sha256": candidate.sha256(root / "uv.lock"),
        "source_ref": "refs/tags/v1.2.3",
        "wheel": candidate.file_record(wheel),
        "requirements": candidate.file_record(requirements),
    }
    candidate.write_manifest(tmp_path, manifest)
    return tmp_path, manifest


@pytest.mark.parametrize("field", ["source", "version", "lock_sha256", "wheel", "requirements"])
def test_candidate_rejects_identity_or_bytes(packed_candidate, field):
    directory, manifest = packed_candidate
    candidate.verify(directory)
    changed = copy.deepcopy(manifest)
    if field in {"wheel", "requirements"}:
        (directory / changed[field]["file"]).write_bytes(b"different bytes")
    else:
        changed[field] = "different"
        candidate.write_manifest(directory, changed)
    with pytest.raises(ValueError):
        candidate.verify(directory)


def test_later_major_rejects_without_same_candidate18(packed_candidate):
    directory, _ = packed_candidate
    with pytest.raises(KeyError):
        candidate.verify(directory, complete=True)


def test_candidate_rejects_image_archive_and_major(packed_candidate):
    directory, manifest = packed_candidate
    image = directory / "image.tar"
    image.write_bytes(b"tested-image-archive")
    facts = directory / "facts.jsonl"
    facts.write_text(
        (
            json.dumps({"requested_major": 18, "observed_major": 18, "modules": ["base", "mail"]})
            + "\n"
        )
        * 2
    )
    report = directory / "proof.xml"
    report.write_text('<testsuite tests="1"><testcase name="public-proof"/></testsuite>')
    manifest.update(
        {
            "image": {"id": "sha256:" + "c" * 64, "archive": candidate.file_record(image)},
            "odoo18": {"requested_major": 18, "observed_major": 18},
            "proofs": {
                name: {**candidate.file_record(report), "tests": 1}
                for name in ("integration", "image")
            },
            "odoo_facts": candidate.file_record(facts),
        }
    )
    candidate.write_manifest(directory, manifest)
    candidate.verify(directory, complete=True)
    for field, replacement in (
        ("id", "sha256:wrong"),
        ("archive", {"file": "image.tar", "sha256": "0" * 64}),
    ):
        changed = copy.deepcopy(manifest)
        changed["image"][field] = replacement
        candidate.write_manifest(directory, changed)
        with pytest.raises(ValueError):
            candidate.verify(directory, complete=True)
    manifest["odoo18"]["observed_major"] = 19
    candidate.write_manifest(directory, manifest)
    with pytest.raises(ValueError):
        candidate.verify(directory, complete=True)


def test_release_requires_matching_tag_version_sha_and_main(monkeypatch):
    sha = "a" * 40
    monkeypatch.setattr(candidate, "run", lambda *args: sha)
    calls = []
    monkeypatch.setattr(candidate.subprocess, "run", lambda *args, **kwargs: calls.append(args))
    candidate.require_release_ref("refs/tags/v1.2.3", sha, "1.2.3")
    assert calls[0][0] == ["git", "merge-base", "--is-ancestor", sha, "origin/main"]
    for ref in ("refs/heads/main", "refs/tags/v1.2.4", "v1.2.3"):
        with pytest.raises(ValueError):
            candidate.require_release_ref(ref, sha, "1.2.3")
    with pytest.raises(ValueError):
        candidate.require_release_ref("refs/tags/v1.2.3", "b" * 40, "1.2.3")


def test_harness_rejects17_before_provisioning(monkeypatch):
    monkeypatch.setenv("ODOO_VERSION", "17.0")
    monkeypatch.delenv("MCP_TEST_ODOO_MAJOR", raising=False)
    with pytest.raises(ValueError):
        requested_major()


def test_harness_rejects19_before_candidate18(monkeypatch):
    monkeypatch.setenv("ODOO_VERSION", "19.0")
    monkeypatch.setenv("MCP_TEST_ODOO_MAJOR", "19")
    monkeypatch.delenv("MCP_18_CANDIDATE_PROOF", raising=False)
    with pytest.raises(ValueError):
        requested_major()
