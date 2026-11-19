# Discuss

Use this workflow only for the channels and messages in the user's request.
Installed addons, revision and access rights determine what is available. Start
with [tool boundaries](../SKILL.md#tool-boundaries); metadata is not a method
signature, and sending a message can notify other people.

## Locate and inspect

<!-- atlas: mail/discuss-channel-model-rename -->
<!-- atlas: mail/discuss-channel-member-model-rename -->
Discover the installed channel and membership model names before selecting a
model for `record_search`. Do not treat names from a different Odoo release as
fallback endpoints. Use `discovery_get_fields` on the candidate models and resolve
the intended channel with a small search requesting explicit fields.

<!-- atlas: mail/discuss-channel-types -->
Inspect the installed channel-type choices and the selected channel's type.
Read its membership through the discovered relations, within the caller's access.
Resolve the intended participants; a similarly named channel is insufficient
identity evidence. An inaccessible membership list leaves an unresolved scope.

Use bounded `record_search` or `record_read` calls to inspect relevant messages
through the fields and relations actually available. Limit the date range and
requested fields to the task. A full page or an empty result is not evidence of
complete history or correct targeting.

## Post and verify

<!-- atlas: mail/discuss-post-and-direct-message -->
For an authorized post, confirm the channel, audience and final body first.
Select a posting operation only after obtaining its installed signature from a
trusted source. Invoke it with `model_call`, using native arguments and the
selected record IDs where that signature requires them. Do not infer direct-message
creation or posting arguments from field metadata.

<!-- atlas: mail/discuss-channel-add-members -->
Membership changes need their own authorized participant scope and a trusted
installed method contract. Inspect existing members before requesting a change;
do not add people merely to make a post possible.

Inspect the returned `result`, then read the affected message or membership to
confirm destination, content and participants. Do not report success from a
truthy response alone. If a mutation loses its reply, inspect its outcome before
retrying; a duplicate post or invitation can have external effects. Stop on denial.
