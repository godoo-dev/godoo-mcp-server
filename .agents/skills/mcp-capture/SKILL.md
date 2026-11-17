---
name: mcp-capture
description: Retain, triage or retrieve godoo-mcp-server requests, work breakdowns, decisions and deferred observations in its GitHub issues, and route findings this project does not own (Odoo server behaviour to Atlas intake, library or Stateman behaviour to their projects). Project knowledge itself uses mcp-docs.
---

# Capture godoo-mcp-server work

The tracker is GitHub issues on the public repository `godoo-dev/godoo-mcp-server`.
Pass `--repo godoo-dev/godoo-mcp-server` on every `gh` command. Private
destinations, if any, are bound in the ignored local `.mafe-si.toml`; their
absence never blocks public work.

## Classify first

Decide what the material is before writing anything:

| Material | Home |
| --- | --- |
| Request, decision, remaining work, actionable deferred observation | Issue here |
| Knowledge this project owns (MCP tools, served guidance, runtime, release) | [mcp-docs](../mcp-docs/SKILL.md) |
| Odoo server behaviour, by version, edition or module | Atlas intake (below) |
| Godoo client-library behaviour: client configuration, errors, helper semantics | The owning library project: `godoo-dev/godoo-ts` or `godoo-dev/godoo-py` |
| Stateman planning, apply and target semantics | `godoo-dev/godoo-stateman` |
| Synthesis or decisions spanning several components | The owner's cross-project workspace, as links to the owners |
| Working notes, research packets | `.scratch/` (owner-paths); keep what matters through docs or an issue |

Only Odoo claims go to Atlas. This server's conventions, Godoo library behaviour
and retired CLI behaviour are not Atlas facts, even when they were learned while
investigating Odoo.

## Route what this project does not own

This session writes only this repository's records. For another owner:

1. Write the finding as a short handoff: the claim, the Odoo version, edition
   and modules involved, how it was observed, and which text here depends on it.
2. Hand it over through **mafe-si:coordinate-projects**; the receiving project
   retains it from its own session. A handoff proposal sends nothing by itself.
3. For Odoo behaviour (Atlas intake): once Atlas reports the fact ID, add the
   reflection and its `atlas:<fact-id>` marker here through mcp-docs. Until
   then the dependent text stays unmarked; if work here is blocked on the fact,
   keep an issue here that names the dependency without quoting private Atlas
   text or paths.

## Decide whether to write

Write for an explicit request, an actionable follow-up, a blocker, an open
decision or remaining acceptance. A handback, merge or passing check alone
warrants no write; routine progress stays in the session and an open PR's
correction stays in that PR. Recording material does not authorize executing it.

## Retrieve and deduplicate

Open a referenced record with its comments:

```sh
gh issue view NUMBER --repo godoo-dev/godoo-mcp-server --comments
gh pr view NUMBER --repo godoo-dev/godoo-mcp-server --comments
```

Without a reference, search open and closed issues and PRs, then read likely
matches:

```sh
gh search issues --repo godoo-dev/godoo-mcp-server --include-prs 'terms'
gh issue list --repo godoo-dev/godoo-mcp-server --state all --search 'terms' --limit 50
```

Update or link existing coverage instead of creating a duplicate. Completed
delivery stays closed; a follow-up gets its own issue that links it.

Incoming material from another system carries a source marker in the body,
`<!-- godoo-capture-source: sha256:HEX -->`, where HEX is the SHA-256 of the
source's provider, namespace and full original key. Keep the original key
private. Search for the exact marker before creating:

```sh
gh search issues --repo godoo-dev/godoo-mcp-server --include-prs 'godoo-capture-source: sha256:HEX'
```

## Create, update and close

Compose the body once from the reader's point of view, using
**reporting-for-humans** when available: the problem or outcome, essential
facts and limits, decisions, current disposition (untriaged, open, testing,
deferred, waiting on a named input) and next actor. Link supporting material
instead of copying it. Public text carries no private identities, hosts, local
or thread paths, original source keys or private links.

Run **mafe-si:pre-post** immediately before each tracker write, then:

```sh
gh issue create --repo godoo-dev/godoo-mcp-server --title 'Concrete outcome' --body-file "$body"
gh issue edit NUMBER --repo godoo-dev/godoo-mcp-server --body-file "$body"
gh issue comment NUMBER --repo godoo-dev/godoo-mcp-server --body-file "$body"
gh issue close NUMBER --repo godoo-dev/godoo-mcp-server --reason completed
```

Read a record back only if the command reported an error. Keep the body current
and short: update the body for changed claims, and comment only for a
substantive update readers should notice. Close as `completed` only for
established completion; use `--reason 'not planned'` for authorized
supersession, with the rationale in the body first.

Split larger work into linked issues or a checklist; preserve the original
request's outcome when the breakdown changes. GitHub has no native blocked-by
link here; state dependencies in the body. Do not invent priority, assignees or
schedules. Report ownership conflicts and owner decisions to Marc in the
conversation.

## Deferred observations

For an off-task finding, classify it, search for coverage, then write a brief
issue (or a handoff for another owner) and return to the task.
