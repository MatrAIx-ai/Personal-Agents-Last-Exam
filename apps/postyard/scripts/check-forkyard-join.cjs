'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {exportEvidence} = require('../evaluator/export.cjs');

const checkout = path.resolve(process.argv[2] || '/tmp/forkyard-ref');
const forkyardRoot = path.join(checkout, 'apps/forkyard');
const {exportEvidence: exportForkyard} = require(path.join(forkyardRoot, 'evaluator/export.cjs'));
const seed = JSON.parse(fs.readFileSync(path.join(forkyardRoot, 'examples/task-data/rejected-pr/seed.json'), 'utf8'));
const author = seed.accounts.find(item => item.account_id === 'fy-tomasreyes');
if (!author || author.handle !== 'tomasreyes') {
  console.log(JSON.stringify({ok: false, reason: 'fy-tomasreyes with handle tomasreyes was not in the Forkyard seed'}));
  process.exit(1);
}

const postyard = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/minimal.json'), 'utf8'));
postyard.settings.owner_confirmation = false;
const draft = JSON.parse(JSON.stringify(postyard.posts[0]));
draft.id = 'ac-0001:p2';
draft.slug = 'tidewater-gatekeeping';
draft.revisions[0].slug = 'tidewater-gatekeeping';
draft.revisions[0].title = 'Gatekeeping';
draft.revisions[0].body = 'Ingrid kept the release gate on the checksum window.';
draft.created_at = '2026-11-02T10:00:00-08:00';
draft.updated_at = draft.created_at;
draft.published_at = draft.created_at;
draft.revisions[0].created_at = draft.created_at;
postyard.posts.push(draft);
postyard.counters['ac-0001'].post = 2;
postyard.receipts.push({
  receipt_id: 'pr-0002', object_type: 'post', object_id: draft.id, revision: 1,
  published_at: draft.published_at, public_url: 'https://postyard.example/@tomasreyes/tidewater-gatekeeping',
  request_id: 'rq-join', event_id: null
});
const faithful = exportEvidence({snapshot: {data: postyard, epoch: 1, revision: 1, virtual_now: postyard.seed_clock, run_id: 'join-check', audit: []}});
const renamed = JSON.parse(JSON.stringify(faithful));
for (const row of renamed.revisions) {
  if (row.post_id === draft.id) row.actor_account_id = 'fy-tomasreyes';
}

function hits(companion) {
  const data = JSON.parse(JSON.stringify(seed));
  data.pulls[0].revisions[0].body += ' See https://postyard.example/@tomasreyes/tidewater-gatekeeping';
  const doc = exportForkyard({
    snapshot: {data, epoch: 1, revision: 0, app_id: 'forkyard', run_id: 'join-check', account_id: data.account_id, audit: []},
    companions: [companion]
  });
  return doc.subjects.filter(item => item.match === 'linked_post').map(item => item.person_id);
}

const faithfulHits = hits(faithful);
const renamedHits = hits(renamed);
const report = {
  forkyard_checkout: checkout,
  faithful_actor_account_id: 'ac-0001',
  faithful_linked_post_people: faithfulHits,
  renamed_actor_account_id: 'fy-tomasreyes',
  renamed_linked_post_people: renamedHits,
  mismatch: 'Forkyard matches a companion revision only when actor_account_id is a Forkyard account whose handle equals the URL handle. Fixture (a) and the approved examples use ac-0001, handle tomasreyes, person_id person-tomas. fy-tomasreyes is the Forkyard account with that handle. A document that keeps ac-0001 does not join. The same document joins when actor_account_id is rewritten to fy-tomasreyes, object_id stays the slug, and the post text names Ingrid so the subject row is person-ingrid.'
};
console.log(JSON.stringify(report, null, 2));
if (faithfulHits.length !== 0 || !renamedHits.includes('person-ingrid')) process.exit(1);
