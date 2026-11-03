# Qualified unreleased SDK packages

Exact archives from godoo-ts PR #30, qualified head c197666fcf9fc08965a1d865c759666cd37b7d5e,
merged as 1ff88685b800f5d2e47bfb56d2f3dd7ef069df5d (identical source tree).
Source: https://github.com/godoo-dev/godoo-ts/actions/runs/41530723251
Artifact 13183040480. Upstream LGPL-3.0 licenses are inside both archives.

These version strings predate publication of the portable APIs. Keep exact bytes
until a published release containing the contract can replace this pin.

- client SHA256: d4ab354a78e8d5f787d81d2b5d93e9021c80dc68967e20c1bb5a4683ef02dc31
- introspection SHA256: 9574708fb3c14e8b727240e3ccc1faa9c052e248fbab4d8e7e2050265d8cb32b

The pnpm client patch injects request-local fetch into the direct network client;
it does not modify portable implementations or effect declarations.
