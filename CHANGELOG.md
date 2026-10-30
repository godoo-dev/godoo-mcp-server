# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-10-31

### Changed

- Adopt production PyPI `godoo-client==0.4.0` with a frozen registry lock.
- Target MCP 2026-07-28 and independent stateless HTTP requests.
- Format chatter bodies as Markdown, HTML or literal text.
- Deliver oversized record results through private artifact storage.
- Qualify installed wheels and exact images against Odoo 18 and 19 before promotion.

### Added

- Friendly dynamic property names and choices through existing discovery, read,
  update and scoped search tools, including sparse single-record changes.
- Friendly properties during record creation, with parent-specific preflight,
  defaults, explicit clears and uncertain-write handling.

## [0.1.0] - 2026-06-03

### Added

- Stateless Streamable HTTP MCP server built on `fastmcp` and `uvicorn`
- Raw Odoo primitives exposed as MCP tools:
  - `record.*` — search, read, create, update, delete records
  - `discovery.*` — list models, get fields, list menus
  - `users.*` — whoami, search users
  - `mail.*` — post message, log note, list messages, schedule activity, list activities, mark activity done
  - `action.*` — execute action, list actions
  - `attachments.*` — list, upload, download attachments
- Skill Markdown files served as MCP Resources for agent discovery
- Per-request credential resolution from `X-Odoo-*` request headers with `ODOO_*` environment variable fallback
- In-process LRU + TTL catalog cache with schema-hash invalidation
- Docker image based on `python:3.14-slim` (`ghcr.io/godoo-dev/godoo-mcp-server`)
- `pip install godoo-mcp-server` installable package with `godoo-mcp-server` console script
- `/healthz` unauthenticated health check endpoint
