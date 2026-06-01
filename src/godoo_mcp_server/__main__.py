"""godoo-mcp-server CLI entrypoint."""

import sys

from godoo_mcp_server import __version__


def main() -> None:
    """Print version and exit (Phase 1 scaffold only)."""
    if "--version" in sys.argv:
        print(f"godoo-mcp-server {__version__}")
        sys.exit(0)
    print("godoo-mcp-server: use --version or start the MCP server (Phase 2+)")
    sys.exit(1)


if __name__ == "__main__":
    main()
