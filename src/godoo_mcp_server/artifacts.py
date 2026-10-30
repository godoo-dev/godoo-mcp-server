"""Private object storage for export artifacts; credentials never enter receipts."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import re
import tempfile
import uuid
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING
from urllib.parse import quote, urlsplit

import obstore
from obstore.exceptions import NotFoundError
from obstore.store import GCSStore, S3Store
from pydantic import TypeAdapter

from godoo_mcp_server.odoo_runtime import ClassifiedToolError

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from obstore.store import S3Config

logger = logging.getLogger("godoo_mcp_server.artifacts")
CLEANUP_INTERVAL_SECONDS = 60
_MANAGED_KEY = re.compile(r"exports/v1/([1-9][0-9]*)/[0-9a-f]{32}\.(?:json|bin)")
MAX_ARTIFACT_BYTES = 100 * 1024 * 1024
_RESULT_ADAPTER = TypeAdapter(dict[str, object])


def export_error(message: str) -> ClassifiedToolError:
    return ClassifiedToolError(message, category="export_failed")


def _https_url(value: str) -> bool:
    parsed = urlsplit(value)
    return bool(parsed.scheme == "https" and parsed.hostname and not parsed.username)


@dataclass(frozen=True)
class ArtifactStorage:
    store: S3Store | GCSStore
    url_ttl_minutes: int = 60
    cleanup_grace_minutes: int = 30

    @property
    def download_lifetime(self) -> timedelta:
        return timedelta(minutes=self.url_ttl_minutes)

    @property
    def retention_seconds(self) -> int:
        return (self.url_ttl_minutes + self.cleanup_grace_minutes) * 60

    @classmethod
    def from_env(cls) -> ArtifactStorage:
        """Select private storage and validate URL/cleanup timings, in minutes."""
        try:
            provider = os.environ["ODOO_EXPORT_PROVIDER"].lower()
            bucket = os.environ["ODOO_EXPORT_BUCKET"]
            ttl = int(os.environ.get("ODOO_EXPORT_URL_TTL_MINUTES", "60"))
            grace = int(os.environ.get("ODOO_EXPORT_CLEANUP_GRACE_MINUTES", "30"))
            if not bucket or not 1 <= ttl <= 10080 or grace < 0:
                raise ValueError
            # Reject durations that cannot be represented as a cleanup timestamp.
            datetime.now(UTC) + timedelta(minutes=ttl + grace)
            store: S3Store | GCSStore
            if provider in {"s3", "r2"}:
                endpoint = os.environ.get("ODOO_EXPORT_ENDPOINT")
                if provider == "r2" and not endpoint:
                    raise ValueError
                if endpoint and not _https_url(endpoint):
                    raise ValueError
                options: S3Config = {"skip_signature": False}
                if endpoint:
                    options["endpoint"] = endpoint
                    options["aws_endpoint_url_s3"] = endpoint
                if provider == "r2":
                    options["region"] = "auto"
                    options["virtual_hosted_style_request"] = False
                store = S3Store(bucket, config=options)
            elif provider == "gcs":
                store = GCSStore(bucket, skip_signature=False)
            else:
                raise ValueError
            return cls(store, ttl, grace)
        except Exception:
            raise export_error("Private export storage is not configured correctly") from None

    async def publish(
        self,
        file: Path,
        artifact_id: str,
        *,
        mimetype: str = "application/json",
        filename: str | None = None,
    ) -> tuple[str, str, str]:
        # Duration in the key makes cleanup independent of process memory and
        # later config changes. Only this versioned namespace is swept.
        suffix = "json" if filename is None else "bin"
        key = f"exports/v1/{self.retention_seconds}/{artifact_id}.{suffix}"
        try:
            # Sign before uploading: retention measured from last_modified is
            # then at least the signed lifetime plus grace, including slow uploads.
            expires_at = datetime.now(UTC).replace(microsecond=0) + self.download_lifetime
            url = await obstore.sign_async(self.store, "GET", key, self.download_lifetime)
            if not _https_url(url):
                raise ValueError
            attributes = {"Content-Type": mimetype, "Cache-Control": "no-store"}
            if filename is not None:
                attributes["Content-Disposition"] = (
                    f"attachment; filename*=UTF-8''{quote(filename, safe='')}"
                )
            await obstore.put_async(
                self.store,
                key,
                file,
                attributes=attributes,
            )
            metadata = await obstore.head_async(self.store, key)
            if datetime.now(UTC) >= expires_at:
                raise ValueError
            delete_after = metadata["last_modified"] + timedelta(seconds=self.retention_seconds)
            return url, expires_at.isoformat(), delete_after.isoformat()
        except BaseException as error:
            # Upload errors/cancellation can leave a committed object. Attempt only
            # deletion of this invocation's random key; sweeps handle residuals.
            cleanup = asyncio.ensure_future(obstore.delete_async(self.store, key))
            try:
                await asyncio.wait_for(asyncio.shield(cleanup), timeout=5)
            except BaseException:
                cleanup.cancel()
                logger.warning("export_object_cleanup_failed")
            if isinstance(error, Exception):
                raise export_error("Private export delivery failed") from None
            raise

    async def cleanup_expired(self, *, now: datetime | None = None) -> int:
        """Delete only expired managed objects, including those from previous processes."""
        cutoff = now or datetime.now(UTC)
        deleted = 0
        async for page in obstore.list(self.store, prefix="exports/v1/"):
            for metadata in page:
                match = _MANAGED_KEY.fullmatch(metadata["path"])
                if match is None:
                    continue
                try:
                    deadline = metadata["last_modified"] + timedelta(seconds=int(match[1]))
                except OverflowError, ValueError:
                    continue
                if deadline > cutoff:
                    continue
                try:
                    await obstore.delete_async(self.store, metadata["path"])
                    deleted += 1
                except NotFoundError, FileNotFoundError:
                    # Another replica may already have swept this immutable key.
                    pass
                except Exception:
                    logger.warning("export_object_cleanup_failed")
        return deleted


async def deliver_record_result(
    result: dict[str, object],
    *,
    max_return_bytes: int | None,
    model: str,
    tool: str,
    row_count: int,
) -> dict[str, object]:
    """Keep small results inline; store the exact result object above the caller's bound."""
    if max_return_bytes is None:
        return result
    content = _RESULT_ADAPTER.dump_json(result)
    if len(content) <= max_return_bytes:
        return result
    receipt = await deliver_artifact(content, source={"tool": tool, "model": model})
    properties = {name: {"type": "array" if name == "records" else "object"} for name in result}
    if "count" in properties:
        properties["count"] = {"type": "integer"}
    return {
        **receipt,
        "format": "json",
        "encoding": "utf-8",
        "schema": {"type": "object", "properties": properties},
        "row_count": row_count,
    }


async def deliver_artifact(
    content: bytes,
    *,
    source: dict[str, object],
    mimetype: str = "application/json",
    filename: str | None = None,
) -> dict[str, object]:
    """Publish bytes once and return only metadata and a private download capability."""
    if len(content) > MAX_ARTIFACT_BYTES:
        raise export_error("Content exceeds the 100 MiB artifact size limit")
    storage = ArtifactStorage.from_env()
    artifact_id = uuid.uuid4().hex
    try:
        with tempfile.TemporaryDirectory(prefix="godoo-result-") as directory:
            file = Path(directory) / "content"
            file.write_bytes(content)
            url, expires_at, delete_after = await storage.publish(
                file, artifact_id, mimetype=mimetype, filename=filename
            )
    except Exception:
        raise export_error("Private export delivery failed") from None
    return {
        "delivery": "artifact",
        "artifact_id": artifact_id,
        "download_url": url,
        "expires_at": expires_at,
        "expires_in_seconds": storage.url_ttl_minutes * 60,
        "size_bytes": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
        "retention_seconds": storage.retention_seconds,
        "cleanup_grace_seconds": storage.cleanup_grace_minutes * 60,
        "delete_after": delete_after,
        "source": source,
    }


async def _cleanup_loop(storage: ArtifactStorage) -> None:
    while True:
        try:
            await storage.cleanup_expired()
        except Exception:
            # Retry next sweep; provider errors can contain secrets or object names.
            logger.warning("export_cleanup_sweep_failed")
        await asyncio.sleep(CLEANUP_INTERVAL_SECONDS)


@asynccontextmanager
async def export_lifespan(server: object) -> AsyncIterator[None]:
    if "ODOO_EXPORT_PROVIDER" not in os.environ:
        yield
        return
    task = asyncio.create_task(_cleanup_loop(ArtifactStorage.from_env()))
    try:
        yield
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
