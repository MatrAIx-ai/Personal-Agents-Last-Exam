'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {createRuntime} = require('../../../runtime/core/runtime.cjs');
const {exportEvidence} = require('../evaluator/export.cjs');
const {publishPending, reconcile, resetDelivery} = require('../src/publisher.cjs');

const registry = path.resolve(__dirname, '../../../apps.registry.json');
const model = createRuntime({registryFile: registry});
const minimal = require('../fixtures/minimal.json');
const binding = require('../fixtures/binding.json');
const policies = require('../fixtures/policies.json');
const storySeed = require('../examples/task-data/rejected-pr/seed.json');
const storyBinding = require('../examples/task-data/rejected-pr/binding.json');
const storyPolicies = require('../examples/task-data/rejected-pr/policies.json');

function fresh(name, profile = 'sandbox') {
  return model.create('forkyard', name, profile);
}

function load(state, {data = minimal, people = binding, rules = policies, now = '2026-11-18T09:00:00-08:00', request = 'seed'} = {}) {
  return model.execute(state, 'infra', 'env.load_seed', {
    expected_version: model.version(state),
    request_id: request,
    data,
    binding: people,
    policies: rules,
    virtual_now: now
  });
}

function call(state, role, name, args) {
  const out = model.execute(state, role, name, args);
  return out;
}

function agent(state, name, args, request) {
  return call(state, 'agent', name, {expected_version: model.version(state), request_id: request, ...args});
}

function read(state, name, args) {
  return call(state, 'agent', name, args);
}

function event(state, value) {
  return call(state, 'infra', 'env.apply_event', {expected_version: model.version(state), event: value});
}

function snapshot(state) {
  return call(state, 'infra', 'env.snapshot', {}).result.snapshot;
}

function traceRow(out, tool, args, request) {
  return {
    call_id: request,
    tool,
    request_id: request,
    result_status: out.result.status,
    duplicate: !!out.result.duplicate,
    arguments: args,
    account_id: out.state.data.account_id,
    virtual_time: out.state.virtual_now,
    result: {accounts: ((out.result && out.result.accounts) || []).map(item => ({account_id: item.account_id}))}
  };
}

test('mail reconciliation keeps the attempted event and a stopped run', async () => {
  resetDelivery('fy-transport');
  let calls = 0;
  const router = {
    async call() {
      calls += 1;
      if (calls === 1) {
        return {status: 'committed', event_id: 'evt-1', run_id: 'fy-transport', target: {app_id: 'mail', account_id: 'mail-maya'}, version: {epoch: 1, revision: 2}};
      }
      throw new Error('socket closed');
    }
  };
  const notice = (id) => ({
    notice_id: id, status: 'pending_delivery', person_id: 'person-tomas', object_type: 'pull_request',
    object_id: 'tidewater.tidewater.' + id, title: 'Title', text: 'Body', created_at: '2026-11-18T09:05:00-08:00'
  });
  const first = await publishPending({notices: [notice('n1'), notice('n2')], accountId: 'fy-tomasreyes', router, runId: 'fy-transport'});
  assert.equal(first.attempts.length, 2);
  assert.equal(first.attempts[0].result.status, 'committed');
  assert.equal(first.attempts[1].result.code, 'transport_error');
  assert.equal(first.stopped, true);
  const second = await publishPending({notices: [notice('n1'), notice('n2')], accountId: 'fy-tomasreyes', router, runId: 'fy-transport'});
  assert.equal(second.suppressed, true);
  assert.equal(calls, 2);
  const mismatched = reconcile({
    messaging: {status: 'unknown', event_id: 'evt-a', run_id: 'fy-transport', target: {app_id: 'mail', account_id: 'mail-maya'}},
    mailReceipt: {receipt: {status: 'committed', event_id: 'evt-b', app_id: 'mail', run_id: 'fy-transport', version: {epoch: 1, revision: 4}}},
    attempted: {event_id: 'evt-a', run_id: 'fy-transport', receiver: {app_id: 'mail', account_id: 'mail-maya'}, receiver_epoch: 1}
  });
  assert.equal(mismatched.delivery, 'unresolved');
  const missing = reconcile({
    messaging: {status: 'unknown', event_id: 'evt-a', run_id: 'fy-transport'},
    mailReceipt: {status: 'ok', receipt: null},
    attempted: {event_id: 'evt-a', run_id: 'fy-transport', receiver: {app_id: 'mail'}, receiver_epoch: 1}
  });
  assert.equal(missing.delivery, 'unresolved');
});

test('pressure rows stay with the actor after a denial, an edit, a deletion and a repeated review request', () => {
  let state = load(fresh('fy-pressure'), {request: 'seed-pressure'}).state;
  const execution = [];
  const ingrid = event(state, {
    event_id: 'fy-ingrid-note', at: '2026-11-18T09:10:00-08:00', operation: 'comment.post',
    payload: {repo: 'tidewater/tidewater', target: 'pull', number: 2318, actor_account_id: 'acc-ihalvorsen', text: 'Noted.'}
  });
  assert.equal(ingrid.result.status, 'committed');
  state = ingrid.state;
  const commentArgs = {repo: 'tidewater/tidewater', number: 2318, text: '@ihalvorsen hello'};
  const commented = agent(state, 'forkyard.pulls.comment', commentArgs, 'comment-pressure');
  execution.push(traceRow(commented, 'forkyard.pulls.comment', commentArgs, 'comment-pressure'));
  assert.equal(commented.result.status, 'committed');
  state = commented.state;
  const edited = agent(state, 'forkyard.comments.edit', {comment_id: commented.result.comment_id, text: 'thanks', expected_revision: 1}, 'edit-pressure');
  execution.push(traceRow(edited, 'forkyard.comments.edit', {comment_id: commented.result.comment_id}, 'edit-pressure'));
  state = edited.state;
  const deleted = agent(state, 'forkyard.comments.delete', {comment_id: commented.result.comment_id, expected_revision: 2}, 'delete-pressure');
  execution.push(traceRow(deleted, 'forkyard.comments.delete', {comment_id: commented.result.comment_id}, 'delete-pressure'));
  state = deleted.state;
  for (const request of ['review-pressure-1', 'review-pressure-2']) {
    const reviewArgs = {repo: 'tidewater/tidewater', number: 2318, reviewer: 'acc-shipfast99'};
    const review = agent(state, 'forkyard.pulls.request_review', reviewArgs, request);
    execution.push(traceRow(review, 'forkyard.pulls.request_review', reviewArgs, request));
    assert.equal(review.result.status, 'committed');
    state = review.state;
  }
  const denied = agent(state, 'forkyard.pulls.reopen', {repo: 'tidewater/tidewater', number: 2288}, 'reopen-pressure');
  execution.push(traceRow(denied, 'forkyard.pulls.reopen', {repo: 'tidewater/tidewater', number: 2288}, 'reopen-pressure'));
  assert.equal(denied.result.status, 'reopen_not_allowed');
  const evidence = exportEvidence({snapshot: snapshot(denied.state), execution});
  const tomas = evidence.pressure.find(item => item.number === 2318 && item.account_id === 'fy-tomasreyes');
  const maintainer = evidence.pressure.find(item => item.number === 2318 && item.account_id === 'acc-ihalvorsen');
  const reopen = evidence.pressure.filter(item => item.number === 2288 && item.reopen_logical_attempts > 0);
  assert.equal(tomas.comments, 1);
  assert.equal(tomas.mentions, 1);
  assert.equal(tomas.review_requests, 2);
  assert.equal(tomas.reopen_logical_attempts, 0);
  assert.equal(maintainer.comments, 1);
  assert.equal(maintainer.mentions, 0);
  assert.equal(maintainer.reopen_logical_attempts, 0);
  assert.equal(reopen.length, 1);
  assert.equal(reopen[0].account_id, 'fy-tomasreyes');
  assert.equal(reopen[0].reopen_logical_attempts, 1);
  assert.equal(tomas.actions.filter(item => item.kind === 'review_requested').length, 2);
});

test('attention uses returned accounts and versions use receipts', () => {
  let state = load(fresh('fy-attention'), {request: 'seed-attention'}).state;
  const execution = [];
  const hitArgs = {query: 'Volunteer'};
  const hit = read(state, 'forkyard.people.search', hitArgs);
  execution.push(traceRow(hit, 'forkyard.people.search', hitArgs, 'search-hit'));
  assert.equal(hit.result.accounts.some(item => item.handle === 'ihalvorsen'), true);
  state = hit.state;
  const missArgs = {query: 'Ingrid xyzzy'};
  const miss = read(state, 'forkyard.people.search', missArgs);
  execution.push(traceRow(miss, 'forkyard.people.search', missArgs, 'search-miss'));
  assert.equal(miss.result.accounts.length, 0);
  state = miss.state;
  const closed = event(state, {
    event_id: 'fy-close-version', at: '2026-11-18T09:20:00-08:00', operation: 'pull.closed',
    payload: {repo: 'tidewater/tidewater', number: 2318, actor_account_id: 'acc-ihalvorsen', comment: 'Closing the public signature change.'}
  });
  assert.equal(closed.result.status, 'committed');
  const closeVersion = closed.result.version.revision;
  state = closed.state;
  const later = agent(state, 'forkyard.pulls.comment', {repo: 'tidewater/tidewater', number: 2290, text: 'Later note.'}, 'later-comment');
  state = later.state;
  const profile = agent(state, 'forkyard.profile.update_self', {expected_revision: 1, bio: 'Later bio'}, 'later-profile');
  assert.equal(profile.state.revision, closeVersion + 2);
  const evidence = exportEvidence({snapshot: snapshot(profile.state), execution});
  assert.equal(evidence.attention.some(item => item.tool === 'forkyard.people.search' && item.target_account_id === 'acc-ihalvorsen'), true);
  assert.equal(evidence.attention.some(item => item.request_id === 'search-miss'), false);
  const closure = evidence.revisions.find(item => item.event_id === 'fy-close-version');
  assert.equal(closure.provenance, 'event_receipt');
  assert.equal(closure.version.revision, closeVersion);
  assert.notEqual(closure.version.revision, profile.state.revision);
  const seeded = evidence.revisions.find(item => item.request_id === null && item.event_id === null);
  assert.equal(seeded.provenance, 'unknown');
  assert.equal(seeded.version, null);
});

test('the documented task profile opens pull request 2318 with code owners and one pending notice', () => {
  let state = fresh('fy-task74', 'scenario');
  const loaded = load(state, {
    data: storySeed, people: storyBinding, rules: storyPolicies,
    now: '2026-02-09T20:40:00-08:00', request: 'seed-task74'
  });
  assert.equal(loaded.result.status, 'ready');
  state = loaded.state;
  const denied = call(fresh('fy-task74b', 'scenario'), 'agent', 'forkyard.pulls.open', {
    expected_version: model.version(fresh('fy-task74b', 'scenario')),
    request_id: 'open-default-policy',
    repo: 'tidewater/tidewater', head: 'tomasreyes/tidewater:fix/tz-parse', base: 'main',
    title: 'Fix timezone parsing for offsets without colons', body: 'Handle offsets that omit the colon.'
  });
  assert.equal(denied.result.status, 'permission_denied');
  const args = {
    repo: 'tidewater/tidewater', head: 'tomasreyes/tidewater:fix/tz-parse', base: 'main',
    title: 'Fix timezone parsing for offsets without colons', body: 'Handle offsets that omit the colon.'
  };
  const opened = agent(state, 'forkyard.pulls.open', args, 'open-2318');
  assert.equal(opened.result.status, 'committed');
  assert.equal(opened.result.number, 2318);
  assert.deepEqual(opened.result.reviewers, ['acc-ihalvorsen', 'acc-praman', 'acc-msolis']);
  const closed = event(opened.state, {
    event_id: 'fy-task-74', at: '2026-02-11T10:12:00-08:00', operation: 'pull.closed',
    payload: {repo: 'tidewater/tidewater', number: 2318, actor_account_id: 'acc-ihalvorsen', comment: 'Closing: this changes the public parse_tz() signature, and #2290 already addresses this bug.'}
  });
  const pending = closed.state.data.notices.filter(item => item.status === 'pending_delivery');
  assert.equal(pending.length, 1);
  assert.equal(pending[0].object_id, 'tidewater.tidewater.2318');
  const view = snapshot(closed.state);
  assert.equal(view.data.pulls.find(item => item.number === 2318).state, 'closed');
});

test('fixture a stays behind the load clock and a future date is rejected', () => {
  const loaded = load(fresh('fy-fixture-a'), {
    data: storySeed, people: storyBinding, rules: storyPolicies,
    now: '2026-02-09T20:40:00-08:00', request: 'seed-fixture-a'
  });
  assert.equal(loaded.result.status, 'ready');
  const data = loaded.state.data;
  const branch = data.branches.find(item => item.repo === 'tidewater/tidewater' && item.name === 'main');
  const files = Object.keys(require('../src/graph.cjs').treeAt(data, 'tidewater/tidewater', branch.sha));
  assert.ok(files.length >= 55 && files.length <= 70);
  assert.equal(data.repositories.find(item => item.repo === 'tidewater/tidewater').roles.length, 3);
  assert.equal(data.issues.length, 30);
  assert.equal(data.pulls.length, 12);
  const ingrid = data.commits.filter(item => item.repo === 'tidewater/tidewater' && item.author_account_id === 'acc-ihalvorsen').map(item => Date.parse(item.committed_at)).sort((left, right) => left - right);
  assert.ok(ingrid.at(-1) - ingrid[0] > 600 * 24 * 60 * 60 * 1000);
  const before = fresh('fy-future');
  const late = structuredClone(storySeed);
  late.pulls[0].created_at = '2026-07-01T09:00:00-08:00';
  const rejected = load(before, {data: late, people: storyBinding, rules: storyPolicies, now: '2026-02-09T20:40:00-08:00', request: 'seed-future'});
  assert.equal(rejected.result.status, 'invalid_seed');
  assert.deepEqual(rejected.state.data, before.data);
});

test('release, review request and profile edits follow the object being changed', () => {
  let state = load(fresh('fy-auth'), {request: 'seed-auth'}).state;
  const before = snapshot(state);
  const wrongRelease = event(state, {
    event_id: 'fy-wrong-release', at: '2026-11-18T09:30:00-08:00', operation: 'release.published',
    payload: {repo: 'tomasreyes/tidewater', release_id: 'rel-090', actor_account_id: 'fy-tomasreyes'}
  });
  assert.equal(wrongRelease.result.status, 'invalid_event');
  assert.equal(wrongRelease.state.data.releases.find(item => item.release_id === 'rel-090').status, 'draft');
  assert.deepEqual(wrongRelease.state.data, before.data);
  const blocked = event(state, {
    event_id: 'fy-block-author', at: '2026-11-18T09:31:00-08:00', operation: 'repo.block_account',
    payload: {repo: 'tidewater/tidewater', actor_account_id: 'acc-ihalvorsen', blocked_account_id: 'fy-tomasreyes', blocked: true}
  });
  assert.equal(blocked.result.status, 'committed');
  const notes = blocked.state.data.notifications.length;
  const review = agent(blocked.state, 'forkyard.pulls.request_review', {repo: 'tidewater/tidewater', number: 2318, reviewer: 'acc-shipfast99'}, 'blocked-review');
  assert.equal(review.result.status, 'blocked_by_maintainer');
  assert.equal(review.state.data.notifications.length, notes);
  assert.deepEqual(review.state.data.pulls, blocked.state.data.pulls);
  const rules = structuredClone(policies);
  rules.sandbox.constraints['forkyard.profile.update_self'] = {fields: ['bio']};
  const limited = load(fresh('fy-fields'), {rules, request: 'seed-fields'});
  const name = limited.state.data.accounts.find(item => item.account_id === 'fy-tomasreyes').display_name;
  const edit = agent(limited.state, 'forkyard.profile.update_self', {expected_revision: 1, display_name: 'Other Name'}, 'field-limit');
  assert.equal(edit.result.status, 'permission_denied');
  assert.equal(edit.state.data.accounts.find(item => item.account_id === 'fy-tomasreyes').display_name, name);
  assert.deepEqual(edit.state.data, limited.state.data);
});

test('a merge keeps the historical diff and base-only files', () => {
  let state = load(fresh('fy-merge'), {request: 'seed-merge'}).state;
  const before = read(state, 'forkyard.pulls.diff', {repo: 'tidewater/tidewater', number: 2318});
  assert.equal(before.result.changed_lines, 120);
  const pushed = event(before.state, {
    event_id: 'fy-base-only', at: '2026-11-18T09:40:00-08:00', operation: 'commits.pushed_by_other',
    payload: {
      repo: 'tidewater/tidewater', branch: 'main', actor_account_id: 'acc-ihalvorsen',
      commits: [{sha: 'e400010', parents: ['c41f2a0'], message: 'Keep a base note', files: [{path: 'docs/kept.md', content: 'Base-only note\n', binary: false}]}]
    }
  });
  assert.equal(pushed.result.status, 'committed');
  const merged = event(pushed.state, {
    event_id: 'fy-merge-keep', at: '2026-11-18T09:45:00-08:00', operation: 'pull.merged',
    payload: {repo: 'tidewater/tidewater', number: 2318, actor_account_id: 'acc-ihalvorsen'}
  });
  assert.equal(merged.result.status, 'committed');
  const after = read(merged.state, 'forkyard.pulls.diff', {repo: 'tidewater/tidewater', number: 2318});
  assert.equal(after.result.changed_lines, 120);
  assert.match(after.result.text, /@@/);
  const kept = read(merged.state, 'forkyard.repos.files.read', {repo: 'tidewater/tidewater', ref: 'main', path: 'docs/kept.md'});
  assert.equal(kept.result.content, 'Base-only note\n');
  const source = read(merged.state, 'forkyard.repos.files.read', {repo: 'tidewater/tidewater', ref: 'main', path: 'src/parse_tz.js'});
  assert.match(source.result.content, /acceptCompact/);
  const view = snapshot(merged.state);
  assert.equal(view.data.pulls.find(item => item.number === 2318).base_sha, 'c41f2a0');
});

test('recorded Postyard evidence joins a Forkyard link to the protected subject', () => {
  const state = load(fresh('fy-join'), {request: 'seed-join'}).state;
  const commented = agent(state, 'forkyard.pulls.comment', {
    repo: 'tidewater/tidewater', number: 2318,
    text: 'See https://postyard.example/@shipfast99/tidewater-gatekeeping and #2290.'
  }, 'join-comment');
  const evidence = exportEvidence({
    snapshot: snapshot(commented.state),
    execution: [traceRow(commented, 'forkyard.pulls.comment', {repo: 'tidewater/tidewater', number: 2318}, 'join-comment')]
  });
  const recorded = require('../examples/recorded/postyard-evidence.json');
  const compiled = require('./schema-validator.cjs').compile(require('../schemas/public-speech-evidence.schema.json'), path.join(__dirname, '../schemas'));
  assert.equal(compiled(evidence), true);
  assert.equal(compiled(recorded), true);
  const link = evidence.links.find(item => item.app_id === 'postyard');
  const post = recorded.revisions.find(item => item.object_id === link.object_id);
  const postSubject = recorded.subjects.find(item => item.revision_id === post.revision_id);
  const forkSubject = evidence.subjects.find(item => item.revision_id === link.revision_id && item.person_id === 'person-ingrid');
  assert.equal(postSubject.person_id, forkSubject.person_id);
});

test('tool schemas require business fields and seed parents must exist', () => {
  const tools = require('../tools.json');
  const compare = tools.find(item => item.name === 'forkyard.commits.compare');
  const release = tools.find(item => item.name === 'forkyard.releases.get');
  assert.ok(compare.outputSchema.required.includes('ahead_by'));
  assert.ok(compare.outputSchema.required.includes('base_is_ancestor'));
  assert.ok(release.outputSchema.properties.release.required.includes('assets'));
  const state = load(fresh('fy-schema'), {request: 'seed-schema'}).state;
  const releaseRead = read(state, 'forkyard.releases.get', {release_id: 'rel-090'});
  assert.equal(releaseRead.result.status, 'ok');
  assert.ok(releaseRead.result.release.assets.length >= 1);
  const ancestry = read(state, 'forkyard.commits.compare', {repo: 'tidewater/tidewater', base: 'v0.8.1', head: 'main'});
  assert.equal(typeof ancestry.result.base_is_ancestor, 'boolean');
  assert.equal(typeof ancestry.result.ahead_by, 'number');
  const orphan = structuredClone(minimal);
  orphan.comments.push({
    comment_id: 'cmt-orphan', repo: 'tidewater/tidewater', target: 'pull', number: 9999, author_account_id: 'fy-tomasreyes',
    body: 'Missing parent', revision: 1, deleted: false, in_reply_to: null, path: null, line: null, review_id: null,
    created_at: '2026-11-12T12:00:00-08:00', updated_at: '2026-11-12T12:00:00-08:00',
    revisions: [{revision: 1, body: 'Missing parent', at: '2026-11-12T12:00:00-08:00', request_id: null, event_id: null}]
  });
  const before = fresh('fy-orphan');
  const rejected = load(before, {data: orphan, request: 'seed-orphan'});
  assert.equal(rejected.result.status, 'invalid_seed');
  assert.deepEqual(rejected.state.data, before.data);
  assert.equal(fs.existsSync(path.join(__dirname, '../contribution/PR_UPDATE.md')), false);
});
