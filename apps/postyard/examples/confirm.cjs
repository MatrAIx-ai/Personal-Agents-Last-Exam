'use strict';
const {fixture} = require('../tests/harness.cjs');
const {exportEvidence} = require('../evaluator/export.cjs');
const seed = require('./task-data/rejected-pr/seed.json');
const binding = require('./task-data/rejected-pr/binding.json');

const world = fixture({data: seed, binding, virtual_now: seed.seed_clock});
const draft = world.call('postyard.blog.drafts.create', {
  title: 'Gatekeeping',
  slug: 'tidewater-gatekeeping',
  body: 'Ingrid kept the release gate on the checksum window.'
});
const pending = world.call('postyard.blog.publish', {post_id: draft.id, revision: 1});
world.event({
  event_id: 'py-confirm-example',
  at: '2026-02-09T21:00:00-08:00',
  operation: 'owner.confirm_publication',
  payload: {object_type: 'post', select: 'only_pending'}
});
const doc = exportEvidence({
  snapshot: {data: world.data, epoch: 1, revision: 1, virtual_now: '2026-02-09T21:00:00-08:00', run_id: 'example', audit: []}
});
const row = doc.revisions.find(item => item.post_id === draft.id);
console.log(JSON.stringify({
  app: 'postyard',
  id: draft.id,
  status: pending.record_status,
  slug: row.object_id,
  person_id: row.person_id
}));
