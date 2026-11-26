'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const root = path.resolve(__dirname, '..');
function read(rel) { return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')); }
function clone(value) { return structuredClone(value); }

test('public runtime replay, reset, release, and selector denies', () => {
  const {prepare} = require('../../../runtime/prepare.cjs');
  const prep = prepare(root);
  try {
    const model = prep.model;
    const seed = read('examples/task-data/rejected-pr/seed.json');
    const binding = read('examples/task-data/rejected-pr/binding.json');
    const policies = read('examples/task-data/rejected-pr/policies.json');
    let state = model.create('postyard', 'run-postyard', 'sandbox');
    const loaded = model.execute(state, 'infra', 'env.load_seed', {
      expected_version: model.version(state), request_id: 'load-rejected', data: seed, binding, policies, virtual_now: seed.seed_clock
    });
    assert.equal(loaded.result.status, 'ready', JSON.stringify(loaded.result));
    state = loaded.state;
    assert.equal(model.tools(state, 'agent').some(name => name.startsWith('env.')), false);
    const listed = model.execute(state, 'agent', 'postyard.blog.posts.list', {limit: 5});
    assert.equal(listed.result.status, 'ok');
    assert.equal(JSON.stringify(listed.state.data), JSON.stringify(state.data));
    const advanced = model.execute(state, 'infra', 'env.advance_time', {
      expected_version: model.version(state), request_id: 'clock-1', virtual_now: '2026-02-09T21:00:00-08:00'
    });
    assert.equal(advanced.result.status, 'committed');
    assert.equal(JSON.stringify(advanced.state.data.posts), JSON.stringify(state.data.posts));
    const createArgs = {
      expected_version: model.version(advanced.state), request_id: 'rq-create', title: 'Session draft', slug: 'session-draft', body: 'Created after the seed.'
    };
    const created = model.execute(advanced.state, 'agent', 'postyard.blog.drafts.create', createArgs);
    assert.equal(created.result.id, 'ac-0001:p13');
    const replay = model.execute(created.state, 'agent', 'postyard.blog.drafts.create', createArgs);
    assert.equal(replay.result.duplicate, true);
    assert.equal(replay.state.data.counters['ac-0001'].post, 13);
    const conflict = model.execute(created.state, 'agent', 'postyard.blog.drafts.create', {
      ...createArgs, expected_version: model.version(created.state)
    });
    assert.equal(conflict.result.status, 'idempotency_conflict');
    assert.equal(conflict.state.data.counters['ac-0001'].post, 13);
    const reset = model.execute(created.state, 'infra', 'env.reset', {expected_version: model.version(created.state)});
    const resetAgain = model.execute(reset.state, 'infra', 'env.reset', {expected_version: model.version(reset.state)});
    assert.equal(JSON.stringify(reset.state.data), JSON.stringify(seed));
    assert.equal(JSON.stringify(resetAgain.state.data), JSON.stringify(reset.state.data));
    assert.equal(resetAgain.state.virtual_now, reset.state.virtual_now);
    assert.equal(resetAgain.state.epoch, reset.state.epoch + 1);
    const minimalSeed = clone(read('fixtures/minimal.json'));
    const releaseLoad = model.execute(resetAgain.state, 'infra', 'env.load_seed', {
      expected_version: model.version(resetAgain.state), request_id: 'load-minimal', data: minimalSeed,
      binding: read('fixtures/binding.json'), policies: read('fixtures/policies.json'), virtual_now: '2026-11-18T08:30:00-08:00'
    });
    assert.equal(releaseLoad.result.status, 'ready', JSON.stringify(releaseLoad.result));
    let current = releaseLoad.state;
    const made = model.execute(current, 'agent', 'postyard.blog.drafts.create', {
      expected_version: model.version(current), request_id: 'rq-draft', title: 'Release once', slug: 'release-once', body: 'One receipt for this post.'
    });
    current = made.state;
    const scheduled = model.execute(current, 'agent', 'postyard.blog.schedule', {
      expected_version: model.version(current), request_id: 'rq-sched', post_id: made.result.id, revision: 1, publish_at: '2026-11-18T09:00:00-08:00'
    });
    current = scheduled.state;
    const moved = model.execute(current, 'infra', 'env.advance_time', {
      expected_version: model.version(current), request_id: 'clock-2', virtual_now: '2026-11-18T09:05:00-08:00'
    });
    assert.equal(moved.state.data.posts.find(item => item.id === made.result.id).status, 'scheduled');
    current = moved.state;
    const event = {event_id: 'py-040', at: '2026-11-18T09:05:00-08:00', operation: 'publication.release_due', payload: {}};
    const first = model.execute(current, 'infra', 'env.apply_event', {expected_version: model.version(current), event});
    assert.equal(first.result.status, 'committed');
    const receipts = first.state.data.receipts.filter(item => item.object_id === made.result.id);
    assert.equal(receipts.length, 1);
    const second = model.execute(first.state, 'infra', 'env.apply_event', {expected_version: model.version(first.state), event});
    assert.equal(second.result.duplicate, true);
    assert.equal(second.state.data.receipts.filter(item => item.object_id === made.result.id).length, 1);
    const directArgs = {
      expected_version: model.version(second.state), request_id: 'rq-direct', title: 'Direct', slug: 'direct-post', body: 'Published in one call.'
    };
    const directDraft = model.execute(second.state, 'agent', 'postyard.blog.drafts.create', directArgs);
    const publishArgs = {
      expected_version: model.version(directDraft.state), request_id: 'rq-direct-pub', post_id: directDraft.result.id, revision: 1
    };
    const direct = model.execute(directDraft.state, 'agent', 'postyard.blog.publish', publishArgs);
    const directReplay = model.execute(direct.state, 'agent', 'postyard.blog.publish', publishArgs);
    assert.equal(directReplay.result.duplicate, true);
    assert.equal(directReplay.state.data.receipts.filter(item => item.object_id === directDraft.result.id).length, 1);
    const pendingSeed = clone(seed);
    const pendingLoad = model.execute(second.state, 'infra', 'env.load_seed', {
      expected_version: model.version(second.state), request_id: 'load-pending', data: pendingSeed, binding, policies, virtual_now: pendingSeed.seed_clock
    });
    current = pendingLoad.state;
    const denied = model.execute(current, 'infra', 'env.apply_event', {
      expected_version: model.version(current),
      event: {event_id: 'py-deny', at: '2026-02-09T21:00:00-08:00', operation: 'owner.confirm_publication', payload: {object_type: 'post', select: 'only_pending'}}
    });
    assert.equal(denied.result.status, 'not_pending');
    assert.equal(JSON.stringify(denied.state.data), JSON.stringify(current.data));
    assert.equal(denied.state.audit.at(-1).decision, 'deny');
    assert.equal(denied.state.audit.at(-1).reason, 'not_pending');
    assert.equal(denied.state.audit.at(-1).trace.event_id, 'py-deny');
    const one = model.execute(current, 'agent', 'postyard.blog.drafts.create', {
      expected_version: model.version(current), request_id: 'rq-a', title: 'A', slug: 'pending-a', body: 'Pending post A.'
    });
    const two = model.execute(one.state, 'agent', 'postyard.blog.drafts.create', {
      expected_version: model.version(one.state), request_id: 'rq-b', title: 'B', slug: 'pending-b', body: 'Pending post B.'
    });
    const pubA = model.execute(two.state, 'agent', 'postyard.blog.publish', {
      expected_version: model.version(two.state), request_id: 'rq-pa', post_id: one.result.id, revision: 1
    });
    const pubB = model.execute(pubA.state, 'agent', 'postyard.blog.publish', {
      expected_version: model.version(pubA.state), request_id: 'rq-pb', post_id: two.result.id, revision: 1
    });
    const both = model.execute(pubB.state, 'infra', 'env.apply_event', {
      expected_version: model.version(pubB.state),
      event: {event_id: 'py-both', at: '2026-02-09T21:05:00-08:00', operation: 'owner.confirm_publication', payload: {object_type: 'post', select: 'only_pending'}}
    });
    assert.equal(both.result.status, 'ambiguous_target');
    assert.equal(both.state.audit.at(-1).reason, 'ambiguous_target');
    assert.equal(both.state.audit.at(-1).trace.event_id, 'py-both');
    assert.equal(JSON.stringify(both.state.data.posts.map(item => item.status)), JSON.stringify(pubB.state.data.posts.map(item => item.status)));
    const mix = model.execute(pubB.state, 'infra', 'env.apply_event', {
      expected_version: model.version(pubB.state),
      event: {event_id: 'py-mix', at: '2026-02-09T21:10:00-08:00', operation: 'owner.confirm_publication', payload: {object_type: 'post', object_id: 'ac-0001:p999', revision: 1}}
    });
    assert.equal(mix.result.status, 'invalid_event');
    assert.equal(mix.state.audit.at(-1).decision, 'deny');
    assert.equal(mix.state.audit.at(-1).reason, 'invalid_event');
    assert.equal(mix.state.audit.at(-1).trace.event_id, 'py-mix');
    assert.equal(JSON.stringify(mix.state.data), JSON.stringify(pubB.state.data));
    const confirmed = model.execute(pubB.state, 'infra', 'env.apply_event', {
      expected_version: model.version(pubB.state),
      event: {event_id: 'py-one', at: '2026-02-09T21:10:00-08:00', operation: 'owner.confirm_publication', payload: {object_type: 'post', object_id: one.result.id, revision: 1}}
    });
    assert.equal(confirmed.result.status, 'committed');
    const confirmReplay = model.execute(confirmed.state, 'infra', 'env.apply_event', {
      expected_version: model.version(confirmed.state),
      event: {event_id: 'py-one', at: '2026-02-09T21:10:00-08:00', operation: 'owner.confirm_publication', payload: {object_type: 'post', object_id: one.result.id, revision: 1}}
    });
    assert.equal(confirmReplay.result.duplicate, true);
    assert.equal(confirmReplay.state.data.receipts.filter(item => item.object_id === one.result.id).length, 1);
  } finally {
    prep.cleanup();
  }
});
