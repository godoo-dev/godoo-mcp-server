"""godoo-mcp-server CLI entrypoint."""

from __future__ import annotations

import os
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
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(app, host=host, port=port)  # noqa: S104


if __name__ == "__main__":
    main()
