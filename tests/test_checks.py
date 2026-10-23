"""Credential-free rejection tests for candidate and integration/release boundaries."""

from __future__ import annotations

import copy
import json
import zipfile

import pytest

from scripts import candidate
from tests.odoo_proof import requested_major


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
