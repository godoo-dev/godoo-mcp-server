# Scheduled activities

Activities are pending follow-ups attached to records. Check this target model
supports activities; chatter fields alone do not establish `mail.activity.mixin`.
Read `mail_list_activities(model, res_id, limit)` when checking pending work or
avoiding a duplicate. It returns `activities` and page `count`, subject to ACLs.
A full page is not proof that every pending activity has been listed.
The dedicated list tool has no offset; if more inspection is needed, use bounded
`record_search` pages on `mail.activity` with this target's verified `res_model`
and `res_id` fields and any other relevant filters.

## Schedule

`mail_schedule_activity` requires `model`, numeric `res_id`, numeric
`activity_type_id`, and `date_deadline` as `YYYY-MM-DD`. Optional inputs are
`note` and numeric `user_id` (a **res.users** ID; omitted means Odoo's default).
It returns `activity_id`.

Find the intended type with `record_search(model="mail.activity.type", ...)`,
requesting `id` and `name` and resolving ambiguity. Type IDs are instance-specific;
neither a guessed Email/Call ID nor plain-language text is the required argument.
Field metadata describes types of fields, not the available activity-type records.
Use permitted user records to resolve an explicitly requested assignee; do not
confuse user IDs here with partner IDs used for chatter recipients.

For an already authorized activity, resolve its target/type/assignee, check for an
existing matching follow-up, schedule it, then read the returned activity's
`activity_type_id`, assignee, deadline, summary and note to verify the outcome.
A deadline is a calendar date, not a UTC timestamp; use the user's intended date.
There is no summary input on this tool; a returned summary can be Odoo's default.
Do not promise a custom summary that was never sent.

In stock Odoo 18, `activity_schedule` uses the supplied summary or the type's
summary, and the supplied note or its default note. With no assignee, it uses
the type's default user, then the current user. A missing resolved type falls
back to the model's default type; a type for another model is retained with a
warning. Explicit activity values are merged after the defaults, so this does
not guarantee repair of every invalid numeric input. Client onchange behavior
is not the native method contract, and installed addons can alter defaults.
The tool still requires its numeric type and deadline inputs.

<!-- atlas: mail/activities-schedule-basic -->
For native `activity_schedule` calls, identify the type by its XML ID. If you
create a `mail.activity` row directly instead, resolve the target model to an
`ir.model` record and use its numeric ID for `res_model_id`; a technical model
name is not that field's value.

## Complete

<!-- atlas: mail/activities-completion-and-chaining -->
`mail_mark_activity_done(activity_id, feedback=...)` invokes `action_feedback`.
Select the specific pending activity that the user has completed or asked to close.
Completion can remove the pending row and post feedback to the target thread;
do not require a persistent row whose state becomes `done` as the only success check.
Configured activity types can also chain a next activity; inspect pending work
and thread readback for those effects. Do not recreate a completed
activity because its old row is missing.

Scheduling and completion mutate Odoo and may notify people. If a write is denied,
stop. If its reply is lost, independently check the outcome before a retry;
a repeat schedule can create a duplicate and repeat completion can fail or add effects.
