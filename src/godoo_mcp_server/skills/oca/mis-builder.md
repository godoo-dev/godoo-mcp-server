# MIS Builder

Installed addons, revision and access determine whether this workflow is
available. Read [tool boundaries](../SKILL.md#tool-boundaries) first. Use only
trusted installed method signatures with `model_call`; field discovery cannot
supply those signatures. Report an unavailable capability instead of guessing it.

## Read and compute

<!-- atlas: oca/mis-builder-key-models -->
Use `discovery_get_fields` to inspect the installed report, instance and period
models. Locate the requested instance with a bounded `record_search`, then read
its selected template, company, dates and periods through the actual relations.
Resolve ambiguous names before computing anything.

<!-- atlas: oca/mis-builder-compute-report-structure -->
Obtain the installed compute contract from a trusted source. If the operation
fits the authorized request, call it and inspect `result` for actual rows, columns,
values and errors according to that contract. Empty data is not proof that a
report computed correctly. Compare the returned scope with the selected instance
and periods and investigate errors before presenting totals.

<!-- atlas: oca/mis-builder-drilldown-returns-move-line-domain -->
For a requested drilldown, inspect the installed return contract and any returned
domain or action. Constrain subsequent reads to the authorized company and period;
do not execute a returned action automatically or assume it contains records.
No export format or download behavior is implied by a compute response.

## Edit a template

Read the current template, KPI definitions and referenced styles before proposing
an edit. Identify which report instances use the affected template. Limit changes
to the user's requested scope; do not clone or delete a template from guessed
method names.

<!-- atlas: oca/mis-builder-dev-kpi-name-valid-identifier -->
Check the installed constraints on KPI names before creating or renaming one.

<!-- atlas: oca/mis-builder-dev-type-defaults-compare-accumulation -->
Inspect the KPI type and its configured comparison and accumulation behavior;
do not infer defaults from the displayed value alone.

<!-- atlas: oca/mis-builder-dev-expression-syntax -->
<!-- atlas: oca/mis-builder-dev-accountingnone-null-semantics -->
Validate expressions against the installed evaluator, including its handling of
missing values. Use the target's trusted documentation rather than transplanting
an expression cookbook or assuming ordinary Python evaluation.

<!-- atlas: oca/mis-builder-cell-style-vs-row-style -->
Inspect the installed distinction between cell and row styling before changing
a style reference. Keep presentation edits separate from intended value changes.

Apply a bounded edit with the supported record tools or a trusted method contract.
Read back the changed definitions, recompute the selected instance and inspect
both values and errors. If the mutation reply is lost, inspect the stored result
before retrying. Stop on a denied write and state any unverified report scope.
