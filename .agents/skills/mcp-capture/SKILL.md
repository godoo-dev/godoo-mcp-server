---
name: mcp-capture
description: Retain, triage or retrieve godoo-mcp-server GitHub requests, work breakdowns and deferred observations; preserve source identity, privacy and remaining acceptance.
---

# Capture operational MCP work

Work in the explicitly selected godoo-mcp-server checkout. Read its `AGENTS.md`
and [ownership conventions](../../../docs/ownership.md). The default repository
is `godoo-dev/godoo-mcp-server` at
https://github.com/godoo-dev/godoo-mcp-server. Verify `git remote -v` and
`gh repo view godoo-dev/godoo-mcp-server --json nameWithOwner,url,visibility,hasIssuesEnabled`
before a write; a mismatch blocks that write. Always pass the explicit repository.
Ignored local `.mafe-si.toml` supplies machine-specific category/evidence bindings;
do not fall back to inherited HQ intake. Missing private bindings do not block
public work with the verified repository.

## Select purpose and home

Before composing, choose the audience and purpose. Requests, actionable deferred
observations, open decisions and remaining acceptance belong in GitHub issues.
Canonical product knowledge goes through [mcp-docs](../mcp-docs/SKILL.md) with the
selected destination and sources. Rich provisional research/review packets use
owner-paths outside source unless the user or established discussion explicitly
selects GitHub for that detail. Link distinct homes; do not publish the packet
merely for durability. A missing supporting home blocks only that supporting
write, not a self-contained work record.

Use available `reporting-for-humans` for work text after choosing its destination.
Without it, write a self-contained problem/result, essential evidence and limits,
material decisions, actual disposition, remaining acceptance and next actor/action.
Preserve attributed authority versus suggestions. Keep API-access blockers useful:
state what could not be checked, its impact and who can supply the missing input.
Never publish private identities, company hosts, original source keys, thread/local
paths or private links in titles, bodies, comments, labels, attachments or metadata.
Summarize essential qualified meaning when the evidence is inaccessible publicly.

## Retrieve and deduplicate

Open an explicit reference first:

```sh
gh issue view NUMBER --repo godoo-dev/godoo-mcp-server --json number,title,body,state,url,labels,assignees,comments
gh pr view NUMBER --repo godoo-dev/godoo-mcp-server --json title,body,state,url,mergeCommit,mergedAt,files
```

Otherwise search scoped terms in issues and PRs with `--state all`; inspect likely
matches and relevant linked decisions. For complete source-identity lookup,
including closed issues, use the paginated repository endpoint rather than
relying on a search index or the CLI's default limit:

```sh
gh api --paginate 'repos/godoo-dev/godoo-mcp-server/issues?state=all&per_page=100' \
  --jq '.[] | select(has("pull_request") | not) | {number,title,state,body,html_url}'
```

For incoming material retain a stable identity privately, including provider,
namespace and full original key. Public intake uses the marker
`<!-- godoo-capture-source: sha256:HEX -->`, where HEX is SHA256 of the stable,
unambiguously serialized source identity. Keep the original-to-hash mapping in
private evidence. Search for the exact marker across all pages/states and inspect
semantic coverage, including PRs. Retries reuse the full identity. A distinct
correction or independently tracked split gets a distinct identity and links the
original outcome. GitHub provides no atomic idempotent create: serialize intake;
if a write receipt is uncertain, reconcile exact identity and current coverage
before retrying. Retain any acknowledged URL before validation and read it directly:
REST lists can lag a new issue even when direct readback succeeds. An absent
list/search hit alone does not prove failure. Without a conclusive receipt, defer
a duplicate create and report uncertain capture. Multiple matches require
reconciliation, not another issue.
Existing canonical coverage stays canonical; do not recreate completed delivery.

## Retain, triage and update

Prepare exact text in an external body file. Inspect `gh issue create --help` or
`gh issue edit --help` for unfamiliar operations. Concrete writes are:

```sh
gh issue create --repo godoo-dev/godoo-mcp-server --title 'Concrete outcome' --body-file "$body_file"
gh issue edit NUMBER --repo godoo-dev/godoo-mcp-server --body-file "$body_file"
```

Read back every real result with `issue view`, including metadata and comments;
verify meaning, source marker, links, privacy, actual state and repository. Retain
the actual URL. Readback failure does not undo a successful write.

Reuse existing requests and preserve the original outcome, decisions and useful
breakdown. Link independently useful pieces; distinguish ordering, dependencies,
ideas and agreed work in prose/checklists. GitHub open state does not reset an
existing testing/deferred/untriaged disposition: state it in the body. Do not
invent priority, assignment, scheduling or a worker claim. Retain likely supplier
ownership and dependencies without contacting agents or opening other projects'
records. Report unresolved owner decisions to Marc in this conversation.

At a consequential handback, retrieve the active record and known affected linked
summaries/discussions. Recompose changed current claims: result, limits, decision
or blocker, remaining acceptance and next actor. Reconcile contradictory active
summaries against the authoritative current account, including evaluation versus
production scope. Preserve dated proposals and closed delivery accounts as history.
Do not append every handback to the body. Skip routine unchanged progress. Use
`gh issue comment NUMBER --repo godoo-dev/godoo-mcp-server --body-file "$body_file"`
only for an authorized substantive discussion/update deserving readers' attention;
no migration chatter or agent messages. Batch related changes.

Retain off-task actionable observations briefly through this same search,
source, placement and readback path, then resume the task. Capture does not
execute the observation. Respect report-only scope. Close with
`gh issue close NUMBER --repo godoo-dev/godoo-mcp-server --reason completed`
only for established completion; use `--reason 'not planned'` for an authorized
supersession/withdrawal and preserve its rationale in the body first. A tracking
redirect says tracking migrated, not problem fixed. Do not reopen completed work
because later operational acceptance remains elsewhere.

## Incoming owner invocation

Preserve supplied authority, source, existing grants/holdings and remaining
acceptance. Retention alone accepts no implementation and launches no work.
Return project identity, canonical URLs, created/updated/already-covered result,
actual disposition, next actor and gaps through the current invocation only.
No mailboxes, notifications, delegates or cross-agent messages; this project has
no standing scheduler or `mafe-pending` dispatcher. An open PR correction stays
in that PR when appropriate. A later operational fix retains linked remaining
work and requires its own source-before-operation checks/authority; source merge
does not itself authorize deployment, publication or business writes.
