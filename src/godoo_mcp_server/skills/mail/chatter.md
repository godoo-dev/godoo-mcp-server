# Chatter and Messaging

The chatter is Odoo's per-record communication thread. Records that support chatter
(those built on the mail mixin) have a message history visible in the Odoo UI.
This guide explains how to post to, log notes on, and read the chatter of any record.

## Post a Message

Use `mail_post_message` to post a message that appears in the chatter and optionally
notifies followers.

**When to use:** Communicating with a customer or stakeholder about a record — an
order confirmation, a support reply, a status update.

**Required information:**
- The technical model name (e.g. the model of the record you want to message)
- The numeric identifier of the record
- The message body as plain text or simple HTML

**What it returns:** On success, a confirmation with the new message identifier.
On failure (model does not support chatter, record not found, permission denied),
an error response with `isError: true`.

**Pattern:**
1. Confirm the model supports chatter: check `discovery_get_fields` — mail-mixin models
   have message-related fields.
2. Get the record identifier via `record_search`.
3. Call `mail_post_message` with the model name, record identifier, and message body.

## Log an Internal Note

Use `mail_log_note` to log an internal note visible only to internal users, not
to customers or external followers.

**When to use:** Recording internal observations, analyst notes, or process steps
that should not be sent to customers.

**Required information:** Same as `mail_post_message` — model name, record identifier,
and note body.

**What it returns:** Confirmation with the new note identifier, or an error response.

**Difference from `mail_post_message`:** Notes are marked as internal; they do not
trigger notification emails to followers. External users (portal users, customers)
cannot see internal notes.

## Read Chatter History

Use `mail_list_messages` to retrieve the message thread for a record.

**When to use:** Reading the conversation history before composing a reply, or auditing
what was communicated about a record.

**Required information:** The model name and the record identifier.

**Optional:** A limit on the number of messages to return. Messages are returned in
reverse chronological order (newest first).

**What it returns:** A list of message objects. Each message includes the author, the
timestamp, whether it is an internal note or an external message, and the body text.

**Pattern:**
1. Call `mail_list_messages` with model name and record identifier.
2. Read through the returned messages to understand the conversation history.
3. Compose a reply using `mail_post_message` with appropriate context.

## Error Handling

All chatter tools raise `isError: true` when:
- The model does not inherit the mail mixin (chatter not supported)
- The record identifier does not exist
- The authenticated user does not have access to the record
- The Odoo instance rejects the call for any other reason

Read the error text in the response — it describes the specific failure. Do not retry
with identical arguments; diagnose the error first.

## Notes

Not every model supports chatter. Standard models that do include sales orders,
purchase orders, invoice records, CRM opportunities, contacts, helpdesk tickets,
and project tasks. Custom models may or may not have it depending on how they were built.

To check: call `discovery_get_fields` on the model. If the model supports chatter,
you will see fields related to messages and followers in the field list.
