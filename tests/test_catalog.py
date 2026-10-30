"""Unit tests for catalog service layer (CAT-01, CAT-02, D-12).

Covers:
  CAT-01: compute_schema_hash returns pipe-joined string from 3 write_date probes
  CAT-01: compute_schema_hash returns None on any RPC failure (graceful degradation)
  CAT-02: get_catalog_snapshot returns cached=True on second call (no OdooRPC on hit)
  CAT-02: get_catalog_snapshot returns cached=False (cache miss) on schema-hash change
  D-12:   Cache key (url, database, schema_hash) never includes credentials
  D-12:   Two users with same target get identical cache key
  Misc:   get_model_entry_from_cache returns None when cache is cold
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

from godoo_mcp_server.catalog import (
    CacheKey,
    _catalog_cache,
    compute_schema_hash,
    get_catalog_snapshot,
    get_model_entry_from_cache,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_FAKE_WRITE_DATE = "2026-01-01 00:00:00"
_FAKE_DATE_HASH = f"{_FAKE_WRITE_DATE}|{_FAKE_WRITE_DATE}|{_FAKE_WRITE_DATE}"

_CORE_MODEL_ROWS = [
    {"model": "res.partner", "name": "Contact", "info": ""},
    {"model": "res.users", "name": "User", "info": ""},
]


def _make_mock_client(
    *,
    write_date: str = _FAKE_WRITE_DATE,
    model_rows: list[dict[str, object]] | None = None,
    uid: int = 1,
) -> AsyncMock:
    """Build an AsyncMock OdooClient for catalog tests.

    By default search_read returns a single write_date row — used for the 3
    schema-hash probes. When model_rows is provided a second return_value is
    queued so _build_snapshot gets a real model list.
    """
    mock = AsyncMock()
    if model_rows is None:
        model_rows = _CORE_MODEL_ROWS  # type: ignore[assignment]
    # search_read is called 4 times in get_catalog_snapshot on a cache miss:
    #   3 times for compute_schema_hash (parallel via asyncio.gather)
    #   1 time for _build_snapshot (ir.model)
    # side_effect list: first 3 calls → write_date row; 4th call → model rows
    mock.search_read = AsyncMock(
        side_effect=[
            [{"write_date": write_date}],  # ir.model probe
            [{"write_date": write_date}],  # ir.model.fields probe
            [{"write_date": write_date}],  # ir.module.module probe
            model_rows,  # _build_snapshot: ir.model filtered to core models
        ]
        * 10  # repeat enough times for multi-call tests
    )
    mock.get_session = Mock(return_value=SimpleNamespace(uid=uid))
    return mock


# ---------------------------------------------------------------------------
# CAT-01: Schema hash computation
# ---------------------------------------------------------------------------


async def test_compute_schema_hash_returns_string() -> None:
    """CAT-01: 3 write_date probes → pipe-joined non-None string."""
    mock = AsyncMock()
    mock.search_read = AsyncMock(return_value=[{"write_date": _FAKE_WRITE_DATE}])

    result = await compute_schema_hash(mock)

    assert result is not None
    assert "|" in result
    assert len(result.split("|")) == 3
    # All 3 probes return the same date
    assert result == _FAKE_DATE_HASH


async def test_compute_schema_hash_empty_rows() -> None:
    """CAT-01: Empty row lists produce empty-string segments (not None)."""
    mock = AsyncMock()
    mock.search_read = AsyncMock(return_value=[])

    result = await compute_schema_hash(mock)

    assert result is not None
    assert result == "||"


async def test_compute_schema_hash_returns_none_on_error() -> None:
    """CAT-01: Any RPC failure → None (graceful degradation, T-04-03-05)."""
    mock = AsyncMock()
    mock.search_read = AsyncMock(side_effect=Exception("rpc failed"))

    result = await compute_schema_hash(mock)

    assert result is None


# ---------------------------------------------------------------------------
# CAT-02: Cache hit / miss
# ---------------------------------------------------------------------------


async def test_cache_hit_no_rpc() -> None:
    """CAT-02: Second call with same (url, db, hash) hits cache — no snapshot RPC."""
    _catalog_cache.clear()
    mock = _make_mock_client()

    first = await get_catalog_snapshot(mock, "http://odoo.test", "mydb")
    assert first["cached"] is False

    # Rebuild mock for second call: re-register same probes so hash is identical
    # We need a fresh side_effect list for the 3 hash probes on the second call.
    # However on a cache HIT, _build_snapshot is NOT called — only 3 hash probes run.
    mock.search_read = AsyncMock(
        side_effect=[
            [{"write_date": _FAKE_WRITE_DATE}],
            [{"write_date": _FAKE_WRITE_DATE}],
            [{"write_date": _FAKE_WRITE_DATE}],
        ]
        * 10
    )

    second = await get_catalog_snapshot(mock, "http://odoo.test", "mydb")
    assert second["cached"] is True
    # On cache hit: only 3 probes for compute_schema_hash, no _build_snapshot call
    assert mock.search_read.call_count == 3


async def test_cache_miss_on_hash_change() -> None:
    """CAT-02: Different schema hash → cache miss → fresh snapshot built."""
    _catalog_cache.clear()

    # First call with hash "dateA|dateA|dateA"
    mock_a = _make_mock_client(write_date="2026-01-01 00:00:00")
    first = await get_catalog_snapshot(mock_a, "http://odoo.test", "mydb")
    assert first["cached"] is False
    assert first["schema_hash"] == "2026-01-01 00:00:00|2026-01-01 00:00:00|2026-01-01 00:00:00"

    # Second call with DIFFERENT hash "dateB|dateB|dateB"
    mock_b = _make_mock_client(write_date="2026-06-01 12:00:00")
    second = await get_catalog_snapshot(mock_b, "http://odoo.test", "mydb")
    assert second["cached"] is False  # different key → miss
    assert second["schema_hash"] == "2026-06-01 12:00:00|2026-06-01 12:00:00|2026-06-01 12:00:00"


async def test_cache_snapshot_none_on_hash_failure() -> None:
    """CAT-02: compute_schema_hash failure → snapshot with schema_hash=None, models=[]."""
    mock = AsyncMock()
    mock.search_read = AsyncMock(side_effect=Exception("network down"))

    result = await get_catalog_snapshot(mock, "http://odoo.test", "mydb")

    assert result["schema_hash"] is None
    assert result["models"] == []
    assert result["cached"] is False


# ---------------------------------------------------------------------------
# Per-user cache isolation
# ---------------------------------------------------------------------------


async def test_cache_key_contains_authenticated_uid_but_no_credentials() -> None:
    key_user1 = CacheKey(url="http://odoo.test", database="mydb", uid=2, schema_hash="hash1")
    key_user2 = CacheKey(url="http://odoo.test", database="mydb", uid=7, schema_hash="hash1")
    assert key_user1 != key_user2
    assert "password" not in repr(key_user1)


async def test_two_users_same_target_do_not_share_cache() -> None:
    """Different authenticated UIDs cannot read catalog snapshots from each other."""
    _catalog_cache.clear()

    # "User 1" populates the cache
    mock_user1 = _make_mock_client(uid=2)
    first = await get_catalog_snapshot(mock_user1, "http://odoo.test", "mydb")
    assert first["cached"] is False

    mock_user2 = AsyncMock()
    mock_user2.get_session = Mock(return_value=SimpleNamespace(uid=7))
    mock_user2.search_read = AsyncMock(
        side_effect=[
            [{"write_date": _FAKE_WRITE_DATE}],
            [{"write_date": _FAKE_WRITE_DATE}],
            [{"write_date": _FAKE_WRITE_DATE}],
        ]
        * 10
    )
    second = await get_catalog_snapshot(mock_user2, "http://odoo.test", "mydb")
    assert second["cached"] is False


async def test_catalog_without_authenticated_uid_is_not_cached() -> None:
    """An absent session cannot create a cache entry shared across identities."""
    _catalog_cache.clear()
    mock = _make_mock_client()
    mock.get_session = Mock(return_value=None)

    result = await get_catalog_snapshot(mock, "http://odoo.test", "mydb")

    assert result["cached"] is False
    assert result["models"] == _CORE_MODEL_ROWS
    assert len(_catalog_cache) == 0


# ---------------------------------------------------------------------------
# Misc: get_model_entry_from_cache
# ---------------------------------------------------------------------------


def test_get_model_entry_from_cache_returns_none_when_cold() -> None:
    """Cache cold → get_model_entry_from_cache returns None (no await, no Odoo)."""
    _catalog_cache.clear()

    result = get_model_entry_from_cache(
        "res.partner", url="http://odoo.test", database="mydb", uid=1
    )

    assert result is None


async def test_get_model_entry_from_cache_is_scoped_to_authenticated_uid() -> None:
    _catalog_cache.clear()
    mock = _make_mock_client(model_rows=[{"model": "res.partner", "name": "Contact", "info": ""}])

    mock.get_session = Mock(return_value=SimpleNamespace(uid=8))
    await get_catalog_snapshot(mock, "http://odoo.test", "mydb")

    entry = get_model_entry_from_cache(
        "res.partner", url="http://odoo.test", database="mydb", uid=8
    )
    assert entry is not None
    assert entry["model"] == "res.partner"
    assert (
        get_model_entry_from_cache("res.partner", url="http://odoo.test", database="mydb", uid=2)
        is None
    )


def test_get_model_entry_from_cache_returns_none_for_unknown_model() -> None:
    """Non-introspected model not in any snapshot → returns None."""
    _catalog_cache.clear()

    result = get_model_entry_from_cache(
        "account.move", url="http://odoo.test", database="mydb", uid=1
    )

    assert result is None
