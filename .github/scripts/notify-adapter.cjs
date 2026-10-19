// Runs only from the trusted workflow revision, never from the candidate tree.
const SOURCE = { owner: 'godoo-dev', repo: 'godoo-mcp-server' };
const TARGET = { owner: 'godoo-dev', repo: 'godoo-cf-sudo-mcp' };
const WORKFLOW = '.github/workflows/ci.yml';
const REQUIRED_JOBS = ['ci (3.14)', 'package-container', 'integration'];

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function validateRun(run, workflow, expected) {
  requireValue(run.id === expected.id && run.run_attempt === expected.run_attempt,
    'CI run identity or attempt changed');
  requireValue(run.repository?.full_name === 'godoo-dev/godoo-mcp-server'
    && run.head_repository?.full_name === 'godoo-dev/godoo-mcp-server',
  'CI source repository mismatch');
  requireValue(run.workflow_id === workflow.id && run.path === WORKFLOW
    && run.name === 'CI', 'CI workflow identity mismatch');
  requireValue(run.event === 'push' && run.head_branch === 'develop',
    'Only develop push CI can propose an adapter update');
  requireValue(run.status === 'completed' && run.conclusion === 'success',
    'CI must have completed successfully');
  requireValue(typeof run.head_sha === 'string' && /^[0-9a-f]{40}$/.test(run.head_sha)
    && run.head_sha === expected.head_sha, 'CI source SHA mismatch');
}

async function candidate({ github, context, core }) {
  requireValue(context.eventName === 'workflow_run'
    && context.payload.action === 'completed', 'Expected a completed workflow_run event');
  requireValue(context.payload.repository?.full_name === 'godoo-dev/godoo-mcp-server',
    'Notification must originate in the MCP repository');
  const event = context.payload.workflow_run;
  requireValue(event && positiveInteger(event.id) && positiveInteger(event.run_attempt),
    'Invalid CI run ID or attempt');
  const { data: workflow } = await github.rest.actions.getWorkflow({
    ...SOURCE, workflow_id: 'ci.yml',
  });
  requireValue(workflow.path === WORKFLOW && workflow.name === 'CI'
    && workflow.state === 'active', 'Unexpected CI workflow');
  validateRun(event, workflow, event);
  // Re-fetch: do not trust an old event after a rerun has changed the result.
  const { data: run } = await github.rest.actions.getWorkflowRun({ ...SOURCE, run_id: event.id });
  validateRun(run, workflow, event);
  const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRun, {
    ...SOURCE, run_id: run.id, filter: 'all', per_page: 100,
  });
  for (const name of REQUIRED_JOBS) {
    // Partial reruns retain successful jobs from earlier attempts. Inspect each
    // required job's latest execution, never an older success hiding a failure.
    const executions = jobs.filter(job => job.name === name);
    requireValue(executions.length > 0 && executions.every(job =>
      positiveInteger(job.run_attempt) && job.run_attempt <= run.run_attempt
      && job.run_id === run.id && job.head_sha === run.head_sha),
    `Required CI job evidence mismatch: ${name}`);
    const attempt = Math.max(...executions.map(job => job.run_attempt));
    const latest = executions.filter(job => job.run_attempt === attempt);
    requireValue(latest.length === 1 && latest[0].status === 'completed'
      && latest[0].conclusion === 'success', `Required CI job not successful: ${name}`);
  }
  const { data: ref } = await github.rest.git.getRef({ ...SOURCE, ref: 'heads/develop' });
  if (ref.object.sha !== run.head_sha) {
    core.notice('Skipping stale CI: develop has advanced');
    return null;
  }
  return { source_sha: run.head_sha, ci_run_id: run.id, ci_run_attempt: run.run_attempt };
}

async function dispatch({ github, payload }) {
  requireValue(payload && /^[0-9a-f]{40}$/.test(payload.source_sha)
    && positiveInteger(payload.ci_run_id) && positiveInteger(payload.ci_run_attempt),
  'Invalid adapter notification payload');
  await github.rest.repos.createDispatchEvent({
    ...TARGET, event_type: 'mcp-source-update', client_payload: payload,
  });
}

module.exports = { candidate, dispatch };
