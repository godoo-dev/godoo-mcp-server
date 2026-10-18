"""Lazy schema-hashed catalog store with in-process LRU+TTL cache.

Cache key: (url, database, authenticated UID, schema_hash) — NEVER includes credentials.
Schema hash: 3 write_date probes on ir.model / ir.model.fields / ir.module.module.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, NamedTuple, TypedDict, cast

from cachetools import TTLCache

if TYPE_CHECKING:
    from godoo.client.client import OdooClient

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_CATALOG_TTL = 3600  # seconds; 1 hour
_CATALOG_MAXSIZE = 32  # max distinct cache entries

# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------


class CacheKey(NamedTuple):
    url: str
    database: str
    uid: int
    schema_hash: str


class CatalogModelRow(TypedDict):
    model: str
    name: str | bool
    info: str | bool


class CatalogSnapshotData(TypedDict):
    schema_hash: str | None
    models: list[CatalogModelRow]


class CatalogSnapshot(CatalogSnapshotData):
    cached: bool


# ---------------------------------------------------------------------------
# Module-level cache (sync TTLCache — safe to create at module level)
# asyncio.Lock is NEVER created here — see _get_lock() below (Pitfall 2)
# ---------------------------------------------------------------------------

_catalog_cache: TTLCache[CacheKey, CatalogSnapshotData] = TTLCache(
    maxsize=_CATALOG_MAXSIZE, ttl=_CATALOG_TTL
)

_catalog_lock: asyncio.Lock | None = None  # created lazily inside the event loop


def _get_lock() -> asyncio.Lock:
    """Return the module-level asyncio.Lock, creating it lazily on first call.

    CRITICAL: Must NOT be called at module import time — asyncio.Lock() must be
    created inside a running event loop (Python 3.10+ requirement; strict in 3.14).
    """
    global _catalog_lock
    if _catalog_lock is None:
        _catalog_lock = asyncio.Lock()
    return _catalog_lock


# ---------------------------------------------------------------------------
# Schema hash computation
# ---------------------------------------------------------------------------


async def compute_schema_hash(client: OdooClient) -> str | None:
    """Compute a per-target schema generation token from 3 write_date probes.

    Runs 3 parallel search_read calls (ir.model, ir.model.fields,
    ir.module.module) and joins the most-recent write_date values with "|".

    Returns None on any RPC failure — callers must handle None gracefully.
    """
    try:
        model_rows, field_rows, module_rows = await asyncio.gather(
            client.search_read(
                "ir.model",
                [],
                fields=["write_date"],
                order="write_date desc",
                limit=1,
            ),
            client.search_read(
                "ir.model.fields",
                [],
                fields=["write_date"],
                order="write_date desc",
                limit=1,
            ),
            client.search_read(
                "ir.module.module",
                [["state", "=", "installed"]],
                fields=["write_date"],
                order="write_date desc",
                limit=1,
            ),
        )
        model_date = (model_rows[0]["write_date"] or "") if model_rows else ""
        field_date = (field_rows[0]["write_date"] or "") if field_rows else ""
        module_date = (module_rows[0]["write_date"] or "") if module_rows else ""
        return f"{model_date}|{field_date}|{module_date}"
    except Exception:  # noqa: BLE001
        return None


# ---------------------------------------------------------------------------
# Snapshot builder (internal)
# ---------------------------------------------------------------------------


async def _build_snapshot(client: OdooClient, schema_hash: str) -> CatalogSnapshotData:
    """Build a catalog snapshot for the given schema_hash.

    Lazy: only introspects the core model set on first request to a target.
    Every other model is introspected on demand (D-10).
    """
    _CORE_MODELS = [
        "mail.message",
        "res.users",
        "res.partner",
        "ir.attachment",
        "ir.ui.menu",
    ]
    model_rows = cast(
        "list[CatalogModelRow]",
        await client.search_read(
            "ir.model",
            [["model", "in", _CORE_MODELS]],
            fields=["model", "name", "info"],
        ),
    )
    return {"schema_hash": schema_hash, "models": model_rows}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def get_catalog_snapshot(client: OdooClient, url: str, database: str) -> CatalogSnapshot:
    """Get or build a catalog snapshot for the given Odoo target.

    The cache key includes the target, authenticated UID, and schema hash;
    credentials are never included.

    Returns a dict with keys: schema_hash, models, cached.
    - cached=True  → returned from TTLCache (no Odoo RPC for the snapshot)
    - cached=False → freshly built and stored in cache
    """
    schema_hash = await compute_schema_hash(client)
    if schema_hash is None:
        return {"schema_hash": None, "models": [], "cached": False}

    session = client.get_session()
    uid = session.uid if session is not None else None
    if not isinstance(uid, int) or uid <= 0:
        # A catalog built without an authenticated identity may reflect a
        # different permission set, so return it only to this caller.
        snapshot = await _build_snapshot(client, schema_hash)
        return {**snapshot, "cached": False}
    key = CacheKey(url=url, database=database, uid=uid, schema_hash=schema_hash)
    async with _get_lock():
        if key in _catalog_cache:
            return {**_catalog_cache[key], "cached": True}
        snapshot = await _build_snapshot(client, schema_hash)
        _catalog_cache[key] = snapshot
        return {**snapshot, "cached": False}


def get_model_entry_from_cache(
    model_name: str, *, url: str, database: str, uid: int
) -> CatalogModelRow | None:
    """Return a cached model entry only for its exact Odoo user and target."""
    for key, snapshot in _catalog_cache.items():
        if (key.url, key.database, key.uid) != (url, database, uid):
            continue
        for entry in snapshot["models"]:
            if entry["model"] == model_name:
                return entry
    return None
