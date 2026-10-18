from __future__ import annotations

import asyncio

import pytest
from godoo.client.errors import OdooAuthError, OdooNetworkError

from godoo_mcp_server.odoo_runtime import (
    AuthenticationConnectionError,
    ClassifiedToolError,
    managed_odoo_client,
    safe_tool_error,
)


class FakeClient:
    def __init__(self, enter_error: Exception | None = None) -> None:
        self.enter_error = enter_error
        self.closed = asyncio.Event()

    async def __aenter__(self) -> FakeClient:
        if self.enter_error:
            raise self.enter_error
        return self

    async def aclose(self) -> None:
        self.closed.set()


async def test_transport_closes_when_authentication_entry_fails() -> None:
    client = FakeClient(OdooAuthError("password must never appear in public diagnostics"))
    with pytest.raises(OdooAuthError):
        async with managed_odoo_client(client):
            pytest.fail("failed authentication must not enter the client context")
    assert client.closed.is_set()


async def test_transport_closes_when_authentication_entry_is_cancelled() -> None:
    entered = asyncio.Event()

    class WaitingEntryClient(FakeClient):
        async def __aenter__(self) -> FakeClient:
            entered.set()
            await asyncio.Event().wait()
            return self

    client = WaitingEntryClient()

    async def authenticate() -> None:
        async with managed_odoo_client(client):
            pytest.fail("cancelled authentication must not enter the client context")

    task = asyncio.create_task(authenticate())
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert client.closed.is_set()


async def test_cleanup_runs_when_request_is_cancelled() -> None:
    client = FakeClient()
    entered = asyncio.Event()

    async def operation() -> None:
        async with managed_odoo_client(client):
            entered.set()
            await asyncio.Event().wait()

    task = asyncio.create_task(operation())
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert client.closed.is_set()


async def test_cleanup_timeout_cancels_and_reaps_close_task(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import godoo_mcp_server.odoo_runtime as runtime

    cancelled = asyncio.Event()

    class SlowClient(FakeClient):
        async def aclose(self) -> None:
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                cancelled.set()
                raise

    monkeypatch.setattr(runtime, "_CLEANUP_TIMEOUT_SECONDS", 0.01)
    async with managed_odoo_client(SlowClient()):
        pass
    assert cancelled.is_set()


async def test_close_failure_does_not_replace_operation_error_or_log_raw_detail(
    caplog: pytest.LogCaptureFixture,
) -> None:
    class FailingCloseClient(FakeClient):
        async def aclose(self) -> None:
            raise RuntimeError("secret=never-log-this")

    with pytest.raises(ValueError, match="operation failed"):
        async with managed_odoo_client(FailingCloseClient()):
            raise ValueError("operation failed")
    assert "never-log-this" not in caplog.text


def test_network_failure_after_mutation_is_a_safe_unknown_outcome() -> None:
    error = safe_tool_error(
        OdooNetworkError("request body and bearer secret must not escape"),
        write_may_have_dispatched=True,
    )
    assert isinstance(error, ClassifiedToolError)
    assert error.category == "unknown_write"
    assert "unknown" in str(error).lower()
    assert "bearer" not in str(error)


def test_authentication_failure_has_pre_dispatch_category() -> None:
    error = safe_tool_error(
        OdooAuthError("private credential detail"), write_may_have_dispatched=True
    )
    assert isinstance(error, ClassifiedToolError)
    assert error.category == "auth_failed"
    assert "private" not in str(error)


def test_auth_connection_failure_stays_pre_dispatch_even_for_write() -> None:
    error = safe_tool_error(AuthenticationConnectionError(), write_may_have_dispatched=True)
    assert isinstance(error, ClassifiedToolError)
    assert error.category == "auth_connection_failed"
