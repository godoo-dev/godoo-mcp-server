"""Phase 1 placeholder test — ensures pytest collects and runs."""


def test_package_importable() -> None:
    """Verify the package imports without error."""
    import godoo_mcp_server  # noqa: F401

    assert godoo_mcp_server.__version__ is not None
