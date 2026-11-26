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

const {fixture} = require('../tests/harness.cjs');
const postyardSeed = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/minimal.json'), 'utf8'));
postyardSeed.settings.owner_confirmation = true;
const world = fixture({data: postyardSeed, virtual_now: '2026-11-18T11:00:00-08:00'});
const draft = world.call('postyard.blog.drafts.create', {
  title: 'Gatekeeping', slug: 'tidewater-gatekeeping', body: 'Ingrid kept the release gate on the checksum window.'
});
world.call('postyard.blog.publish', {post_id: draft.id, revision: 1});
world.event({
  event_id: 'py-join-confirm', at: '2026-11-18T11:10:00-08:00', operation: 'owner.confirm_publication',
  payload: {object_type: 'post', object_id: draft.id, revision: 1}
});
const faithful = exportEvidence({snapshot: {data: world.data, epoch: 1, revision: 2, virtual_now: '2026-11-18T11:10:00-08:00', run_id: 'join-check', audit: []}});
if (faithful.revisions.some(item => item.post_id === draft.id && item.actor_account_id !== 'ac-0001')) {
  console.log(JSON.stringify({ok: false, reason: 'the live export must keep actor ac-0001'}));
  process.exit(1);
}
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
let head = 'unknown';
try {
  head = require('node:child_process').execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
} catch (error) {
  head = 'unknown';
}
const currentJoin = head.startsWith('80417c59460dff88d383f9e2cc5da14186ef6ef5');
const recordedSample = head.startsWith('e9fe739b0b6af11d3805756a4916c028cf41bb4e');
const report = {
  forkyard_checkout: checkout,
  forkyard_head: head,
  pins: {
    recorded_sample: 'e9fe739b0b6af11d3805756a4916c028cf41bb4e',
    native_join: '80417c59460dff88d383f9e2cc5da14186ef6ef5'
  },
  faithful_actor_account_id: 'ac-0001',
  faithful_person_id: 'person-tomas',
  faithful_linked_post_people: faithfulHits,
  renamed_actor_account_id: 'fy-tomasreyes',
  renamed_linked_post_people: renamedHits,
  linked_post: 'The linked_post subject names the person in the post text. The companion revision keeps the author person_id.',
  task_74: 'Task #74 can use the native ac-0001 document. No actor rewrite is required at the native join pin.'
};
console.log(JSON.stringify(report, null, 2));
if (currentJoin) {
  if (!faithfulHits.includes('person-ingrid') || !renamedHits.includes('person-ingrid')) process.exit(1);
} else if (recordedSample) {
  if (faithfulHits.length !== 0 || !renamedHits.includes('person-ingrid')) process.exit(1);
} else if (faithfulHits.length === 0 || !faithfulHits.includes('person-ingrid') || !renamedHits.includes('person-ingrid')) {
  process.exit(1);
}
