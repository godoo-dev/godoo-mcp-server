# Module workflows

Installed addons, their revisions and the caller's access determine which of
these workflows is available. Use `discovery_get_fields` to inspect candidate
models, then `record_search` with explicit fields and small limits. Confirm
record identity and company scope before a change. Discovery describes fields;
use `model_call` only with a trusted installed method signature, following the
[tool boundaries](../SKILL.md#tool-boundaries).

The pointers below identify version-sensitive questions to resolve against the
installed system. They do not certify optional addons on this target.

## Accounting

<!-- atlas: modules/accounting-filter-posted-state -->
Inspect the installed entry-state field and choices before selecting the posted
entries relevant to the user's request. Keep inspection bounded by company and
an explicit period or record set.

<!-- atlas: modules/accounting-cash-account-discovery-via-journals -->
<!-- atlas: modules/accounting-account-code-company-context -->
Resolve the intended journal, company and associated accounts from permitted
records. Inspect the installed account/company representation instead of guessing
account codes or using sample IDs. Read the selected entries and lines before
an authorized operation, then read them again to confirm the resulting state.
Do not infer accounting policy from this procedure.

## Attendance

Resolve the employee explicitly and inspect available attendance fields and
matching records before choosing a change.

<!-- atlas: modules/attendance-one-open-per-employee -->
Check the installed system's treatment of open attendance before creating or
closing a record; inspect existing candidates and resolve ambiguity first.

<!-- atlas: modules/attendance-datetimes-utc -->
Confirm the installed datetime contract and the intended instants before supplying
check-in or check-out values. Make only the authorized change and read back the
employee and timestamps. Do not guess an employee from the current login.

## Contracts

<!-- atlas: modules/contracts-recurring-billing-models -->
Discover the installed contract models, fields and permitted records; do not
assume an OCA addon or recurring operation is present.

<!-- atlas: base/search-active-domain-override -->
When archived data matters, inspect the active field and use a deliberate domain
and context for that query. Check their interaction on this target rather than
assuming every archived record was included.

<!-- atlas: modules/contracts-price-per-billing-cycle-not-monthly -->
Inspect billing frequency, applicable dates and the installed price semantics
before interpreting an amount or authorizing billing. Do not substitute a monthly
estimate for the configured cycle. Obtain a trusted signature for any billing
method and read back the affected contract and generated records afterward.

## Product configuration

<!-- atlas: modules/product-configurator-variant-creation-modes -->
Inspect the installed template, attribute, value and variant relationships and
available creation-mode choices. Read the affected records before proposing a
configuration change.

<!-- atlas: modules/product-configurator-create-variant-immutable-after-use -->
Check the installed restrictions on changing creation mode after use. Do not
promise that changing an attribute will regenerate existing variants. Apply only
the requested edit, then inspect the actual affected configuration and variants.

## Timesheets

<!-- atlas: modules/timesheets-project-task-domain-gating -->
Resolve the intended project, task and employee using the installed fields and
selection constraints; do not infer a valid combination from separate matches.
Inspect existing entries for the requested work before creating another.

For an authorized entry, supply the user's explicit hours, date and description
through the discovered schema. Read back those values and their associations.

<!-- atlas: modules/timesheets-cost-amount-computed-from-employee -->
Inspect how this installation derives cost amounts before considering an amount
edit; do not replace an installed computation with a guessed rate.

For every workflow, inspect `model_call` results rather than executing returned
actions automatically. An empty fixture does not demonstrate the requested
business outcome. A denied write ends the operation; a lost mutation reply calls
for independent readback before any retry.
