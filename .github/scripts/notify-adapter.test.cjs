const { test } = require('node:test');
const assert = require('node:assert/strict');
const { candidate, dispatch } = require('./notify-adapter.cjs');

function fixture() {
  const run = {
    id: 123, run_attempt: 2, workflow_id: 456, name: 'CI',
    path: '.github/workflows/ci.yml', event: 'push', head_branch: 'develop',
    status: 'completed', conclusion: 'success', head_sha: 'a'.repeat(40),
    repository: { full_name: 'godoo-dev/godoo-mcp-server' },
    head_repository: { full_name: 'godoo-dev/godoo-mcp-server' },
  };
  const state = {
    run, workflow: { id: 456, name: 'CI', path: run.path, state: 'active' },
    head: run.head_sha,
    jobs: ['ci (3.14)', 'integration', 'package-container'].map(name => ({
      name, status: 'completed', conclusion: 'success',
      run_attempt: 2, run_id: 123, head_sha: run.head_sha,
    })), notices: [], dispatched: [],
  };
  const context = {
    eventName: 'workflow_run', payload: { action: 'completed',
      repository: { full_name: 'godoo-dev/godoo-mcp-server' },
      workflow_run: structuredClone(run) },
  };
  const github = {
    rest: {
      actions: {
        getWorkflow: async args => {
          assert.equal(args.owner, 'godoo-dev');
          assert.equal(args.repo, 'godoo-mcp-server');
          assert.equal(args.workflow_id, 'ci.yml');
          return { data: state.workflow };
        },
        getWorkflowRun: async args => {
          assert.equal(args.run_id, 123);
          return { data: state.run };
        },
        listJobsForWorkflowRun: () => {},
      },
      git: { getRef: async args => {
        assert.equal(args.ref, 'heads/develop');
        return { data: { object: { sha: state.head } } };
      } },
      repos: { createDispatchEvent: async args => state.dispatched.push(args) },
    },
    paginate: async (method, args) => {
      assert.equal(method, github.rest.actions.listJobsForWorkflowRun);
      assert.equal(args.filter, 'all');
      return state.jobs;
    },
  };
  const core = { notice: message => state.notices.push(message) };
  return { state, context, github, core };
}

test('successful exact-head CI dispatches only the agreed immutable evidence', async () => {
  const f = fixture();
  const payload = await candidate(f);
  await dispatch({ github: f.github, payload });
  assert.deepEqual(f.state.dispatched, [{
    owner: 'godoo-dev', repo: 'godoo-cf-sudo-mcp', event_type: 'mcp-source-update',
    client_payload: { source_sha: 'a'.repeat(40), ci_run_id: 123, ci_run_attempt: 2 },
  }]);
});

const invalid = {
  'PR event': f => { f.state.run.event = 'pull_request'; },
  'manual run': f => { f.state.run.event = 'workflow_dispatch'; },
  'feature branch': f => { f.state.run.head_branch = 'feature'; },
  'failure': f => { f.state.run.conclusion = 'failure'; },
  'cancelled': f => { f.state.run.conclusion = 'cancelled'; },
  'incomplete': f => { f.state.run.status = 'in_progress'; },
  'fork source': f => { f.state.run.head_repository.full_name = 'fork/server'; },
  'wrong repository': f => { f.state.run.repository.full_name = 'fork/server'; },
  'different workflow': f => { f.state.run.workflow_id = 999; },
  'wrong workflow path': f => { f.state.run.path = '.github/workflows/other.yml'; },
  'wrong workflow name': f => { f.state.run.name = 'Other'; },
  'replaced workflow': f => { f.state.workflow.path = '.github/workflows/other.yml'; },
  'disabled workflow': f => { f.state.workflow.state = 'disabled_manually'; },
  'changed run': f => { f.state.run.id = 789; },
  'new rerun attempt': f => { f.state.run.run_attempt = 3; },
  'different SHA': f => { f.state.run.head_sha = 'b'.repeat(40); },
  'malformed SHA in event': f => { f.context.payload.workflow_run.head_sha = 'refs/heads/develop'; },
  'noninteger run ID': f => { f.context.payload.workflow_run.id = '123'; },
  'invalid attempt': f => { f.context.payload.workflow_run.run_attempt = 0; },
  'wrong origin': f => { f.context.payload.repository.full_name = 'fork/server'; },
  'wrong trigger': f => { f.context.eventName = 'push'; },
  'wrong action': f => { f.context.payload.action = 'requested'; },
  'missing required job': f => { f.state.jobs.pop(); },
  'skipped required job': f => { f.state.jobs[0].conclusion = 'skipped'; },
  'incomplete job': f => { f.state.jobs[0].status = 'in_progress'; },
  'future job attempt': f => { f.state.jobs[0].run_attempt = 3; },
  'job source mismatch': f => { f.state.jobs[0].head_sha = 'b'.repeat(40); },
  'job run mismatch': f => { f.state.jobs[0].run_id = 789; },
  'duplicate job': f => { f.state.jobs.push(f.state.jobs[0]); },
};
for (const [name, change] of Object.entries(invalid)) {
  test(`rejects ${name} without dispatching`, async () => {
    const f = fixture();
    change(f);
    await assert.rejects(candidate(f));
    assert.deepEqual(f.state.dispatched, []);
  });
}

test('stale successful CI is a no-op', async () => {
  const f = fixture();
  f.state.head = 'b'.repeat(40);
  assert.equal(await candidate(f), null);
  assert.equal(f.state.notices.length, 1);
  assert.deepEqual(f.state.dispatched, []);
});

test('API failures fail closed', async () => {
  const f = fixture();
  f.github.rest.actions.getWorkflowRun = async () => { throw new Error('API unavailable'); };
  await assert.rejects(candidate(f), /API unavailable/);
  assert.deepEqual(f.state.dispatched, []);
});

test('dispatch rejects malformed evidence and surfaces delivery failures', async () => {
  const f = fixture();
  await assert.rejects(dispatch({ github: f.github, payload: { source_sha: 'main' } }));
  f.github.rest.repos.createDispatchEvent = async () => { throw new Error('dispatch failed'); };
  await assert.rejects(dispatch({ github: f.github, payload: await candidate(f) }), /dispatch failed/);
});


test('partial rerun preserves successful prior jobs and accepts the rerun outcome', async () => {
  const f = fixture();
  f.state.jobs[0].run_attempt = 1;
  f.state.jobs[2].run_attempt = 1;
  f.state.jobs.push({ ...f.state.jobs[1], run_attempt: 1, conclusion: 'failure' });
  assert.deepEqual(await candidate(f), {
    source_sha: 'a'.repeat(40), ci_run_id: 123, ci_run_attempt: 2,
  });
});

test('an older success never masks a latest skipped or failed job', async () => {
  for (const conclusion of ['skipped', 'failure']) {
    const f = fixture();
    f.state.jobs.push({ ...f.state.jobs[1], run_attempt: 1 });
    f.state.jobs[1].conclusion = conclusion;
    await assert.rejects(candidate(f));
  }
});
