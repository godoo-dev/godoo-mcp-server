#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.14"
# dependencies = []
# ///
"""Reject an occupied or unreadable GHCR tag before production publication."""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

TOKEN_URL = "https://ghcr.io/token"
REGISTRY_URL = "https://ghcr.io/v2"
MANIFEST_TYPES = (
    "application/vnd.oci.image.manifest.v1+json, "
    "application/vnd.docker.distribution.manifest.v2+json, "
    "application/vnd.oci.image.index.v1+json, "
    "application/vnd.docker.distribution.manifest.list.v2+json"
)


def require_missing_tag(repository: str, version: str, user: str, credential: str) -> None:
    """Only the registry's authenticated missing-manifest response permits a write."""
    if not re.fullmatch(r"[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._-]*", repository):
        raise ValueError("Expected a lowercase owner/repository")
    if not re.fullmatch(r"[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}", version):
        raise ValueError("Invalid container version tag")
    if not user or not credential:
        raise ValueError("GHCR read authorization is required")
    query = urllib.parse.urlencode({"service": "ghcr.io", "scope": f"repository:{repository}:pull"})
    basic = base64.b64encode(f"{user}:{credential}".encode()).decode()
    request = urllib.request.Request(
        f"{TOKEN_URL}?{query}", headers={"Authorization": f"Basic {basic}"}
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            token = json.load(response)["token"]
    except urllib.error.URLError, ValueError, KeyError:
        raise RuntimeError("GHCR token request failed; registry state is unknown") from None
    if not isinstance(token, str) or not token:
        raise RuntimeError("GHCR returned no read token; registry state is unknown")
    request = urllib.request.Request(
        f"{REGISTRY_URL}/{repository}/manifests/{version}",
        headers={"Authorization": f"Bearer {token}", "Accept": MANIFEST_TYPES},
    )
    try:
        with urllib.request.urlopen(request, timeout=30):
            pass
    except urllib.error.HTTPError as error:
        with error:
            try:
                errors = json.load(error)["errors"]
            except ValueError, KeyError, TypeError:
                errors = None
        if error.code == 404 and errors == [
            {"code": "MANIFEST_UNKNOWN", "message": "manifest unknown"}
        ]:
            return
        raise RuntimeError(
            f"GHCR manifest check returned HTTP {error.code}; registry state is unknown"
        ) from None
    except urllib.error.URLError:
        raise RuntimeError("GHCR manifest request failed; registry state is unknown") from None
    raise RuntimeError("GHCR version tag already exists; reconcile its bytes before publication")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("repository")
    parser.add_argument("version")
    args = parser.parse_args()
    require_missing_tag(
        args.repository, args.version, os.environ["GHCR_USER"], os.environ["GHCR_TOKEN"]
    )
    print(f"Confirmed absent: ghcr.io/{args.repository}:{args.version}")


if __name__ == "__main__":
    main()
