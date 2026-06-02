"""godoo-mcp-server CLI entrypoint."""

from __future__ import annotations

import sys
from typing import Any

import uvicorn

from godoo_mcp_server import __version__
from godoo_mcp_server.server import create_app


def main() -> None:
    """Start the MCP server or print version."""
    if "--version" in sys.argv:
        print(f"godoo-mcp-server {__version__}")
        sys.exit(0)
    app: Any = create_app()
    uvicorn.run(app, host="0.0.0.0", port=8000)  # noqa: S104


if __name__ == "__main__":
    main()
