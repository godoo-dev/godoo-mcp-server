# Activities (Scheduled Tasks)

Activities in Odoo are scheduled to-do items attached to records. They appear in the
Odoo activity view and are used to track follow-ups, calls, meetings, and other tasks
that need to happen by a specific date.

## Schedule an Activity

Use `mail_schedule_activity` to create a new activity on a record.

**When to use:** When you need to schedule a follow-up action on a record — a call to
a customer, a document review, an email to send by a certain date.

**Required information:**
- The technical model name of the record
- The numeric identifier of the record
- The type of activity to schedule (described in plain language; the tool resolves
  the matching activity type from the Odoo instance)
- A deadline date (the date by which the activity should be completed)

**Optional information:**
- A short note describing what needs to be done
- The user to assign the activity to (defaults to the authenticated user)

**What it returns:** On success, the identifier of the newly created activity.
On failure, an error response with `isError: true`.

**Pattern:**
1. Get the record identifier via `record_search`.
2. Call `mail_schedule_activity` with the model name, record identifier, activity type
   description, and deadline date.
3. Optionally specify a note and assigned user.

## View Pending Activities

Use `mail_list_activities` to retrieve the activities currently scheduled on a record.

**When to use:** Before scheduling a new activity (to avoid duplicates), or to review
what follow-ups are pending for a record.

**Required information:** The technical model name and the numeric record identifier.

**What it returns:** A list of activity objects. Each object includes the activity type,
the deadline date, the assigned user, the note, and the activity identifier.

The list shows all activities on the record regardless of which user scheduled them,
subject to the authenticated user's access rights.

## Mark an Activity as Done

Use `mail_mark_activity_done` to complete a pending activity.

**When to use:** After completing the action described in an activity — a call was made,
a document was reviewed, an email was sent.

**Required information:**
- The numeric identifier of the activity (obtained from `mail_list_activities`)
- Optionally, feedback describing what was done

**What it returns:** A confirmation that the activity was marked done, or an error if
the activity does not exist or the user does not have permission to complete it.

**Pattern:**
1. Call `mail_list_activities` to see which activities are pending.
2. Identify the activity identifier for the one you completed.
3. Call `mail_mark_activity_done` with that identifier and optional completion feedback.

## Notes

Activities require the model to support chatter (the mail mixin). Models that do not
support chatter also do not support activities.

The available activity types depend on what is configured in the Odoo instance.
Common types include calls, emails, document uploads, and generic to-dos.
Use `discovery_get_fields` on the activity model to explore what types are available,
or simply describe the type in plain language and the tool will resolve it.
