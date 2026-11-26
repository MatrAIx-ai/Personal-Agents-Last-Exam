'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {fixture} = require('./harness.cjs');
const {compile} = require('./schema-validator.cjs');
const {exportEvidence} = require('../evaluator/export.cjs');
const {subjectHits} = require('../src/subjects.cjs');

const root = path.resolve(__dirname, '..');
const evidenceSchema = compile(require('../schemas/public-speech-evidence.schema.json'), path.join(root, 'schemas'));

function read(rel) { return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')); }
function clone(value) { return structuredClone(value); }
function boom(fn) {
  try { fn(); } catch (error) { return error; }
  throw new Error('expected a throw');
}
function taskFixture(now) {
  const seed = read('examples/task-data/rejected-pr/seed.json');
  return fixture({data: seed, binding: read('examples/task-data/rejected-pr/binding.json'), virtual_now: now || seed.seed_clock});
}
function minimal(mutate, now) {
  const data = clone(read('fixtures/minimal.json'));
  if (mutate) mutate(data);
  return fixture({data, virtual_now: now || data.seed_clock});
}
function countReceipts(data, id) {
  return data.receipts.filter(item => item.object_id === id).length;
}

test('core example: publish a mention, then unpublish freezes reach at 2300', () => {
  const world = minimal(null, '2026-11-18T11:00:00-08:00');
  const draft = world.call('postyard.blog.drafts.create', {
    title: 'Checksum window',
    slug: 'mention-window',
    body: 'See @ihalvorsen and https://forkyard.example/tidewater/tidewater/pull/2318 before the release.'
  });
  const published = world.call('postyard.blog.publish', {post_id: draft.id, revision: 1});
  assert.equal(published.record_status, 'published');
  const got = world.call('postyard.blog.posts.get', {post_id: draft.id});
  assert.equal(got.post.followers_at_publish, 2100);
  assert.equal(got.subjects.some(item => item.person_id === 'person-ingrid'), true);
  assert.equal(got.links.some(item => item.object_id === 'tidewater.tidewater.2318'), true);
  world.setTime('2026-11-18T11:40:00-08:00');
  world.call('postyard.blog.unpublish', {post_id: draft.id});
  const frozen = world.call('postyard.blog.posts.get', {post_id: draft.id});
  assert.equal(frozen.post.reach, 2300);
  assert.equal(frozen.post.unpublished_at, '2026-11-18T11:40:00-08:00');
  world.setTime('2026-11-18T15:00:00-08:00');
  const later = world.call('postyard.blog.posts.get', {post_id: draft.id});
  assert.equal(later.post.reach, 2300);
  const doc = exportEvidence({snapshot: {data: world.data, epoch: 1, revision: 1, virtual_now: '2026-11-18T15:00:00-08:00', run_id: 'reach', audit: []}});
  const row = doc.revisions.find(item => item.post_id === draft.id);
  assert.equal(row.deleted, true);
  assert.match(row.text, /@ihalvorsen/);
  assert.equal(row.reach_at_unpublish, 2300);
});

test('core example: a scheduled post stays due until publication.release_due', () => {
  const world = minimal(null, '2026-11-18T08:30:00-08:00');
  const draft = world.call('postyard.blog.drafts.create', {title: 'Morning note', slug: 'morning-note', body: 'This note waits for the release event.'});
  world.call('postyard.blog.schedule', {post_id: draft.id, revision: 1, publish_at: '2026-11-18T09:00:00-08:00'});
  world.setTime('2026-11-18T09:05:00-08:00');
  const waiting = world.call('postyard.blog.posts.get', {post_id: draft.id});
  assert.equal(waiting.post.status, 'scheduled');
  assert.equal(waiting.post.due, true);
  assert.equal(waiting.post.reach, 0);
  const before = countReceipts(world.data, draft.id);
  world.event({event_id: 'py-rel-0905', at: '2026-11-18T09:05:00-08:00', operation: 'publication.release_due', payload: {}});
  const released = world.call('postyard.blog.posts.get', {post_id: draft.id});
  assert.equal(released.post.status, 'published');
  assert.equal(released.post.published_at, '2026-11-18T09:05:00-08:00');
  assert.equal(released.post.scheduled_for, '2026-11-18T09:00:00-08:00');
  assert.equal(released.post.release_lag_seconds, 300);
  assert.equal(released.receipts.length, 1);
  world.event({event_id: 'py-rel-0906', at: '2026-11-18T09:06:00-08:00', operation: 'publication.release_due', payload: {}});
  assert.equal(countReceipts(world.data, draft.id), before + 1);
});

test('core example: schedule_in_past rejects the current instant and accepts one minute later', () => {
  const world = minimal(null, '2026-11-18T08:30:00-08:00');
  const draft = world.call('postyard.blog.drafts.create', {title: 'Clock check', slug: 'clock-check', body: 'The schedule must be later than now.'});
  const rejected = boom(() => world.call('postyard.blog.schedule', {post_id: draft.id, revision: 1, publish_at: '2026-11-18T08:30:00-08:00'}));
  assert.equal(rejected.code, 'schedule_in_past');
  const accepted = world.call('postyard.blog.schedule', {post_id: draft.id, revision: 1, publish_at: '2026-11-18T08:31:00-08:00'});
  assert.equal(accepted.record_status, 'scheduled');
});

test('core example: edit_published keeps earlier revisions and rejects a stale base', () => {
  const world = minimal();
  const draft = world.call('postyard.blog.drafts.create', {title: 'Claim', slug: 'claim', body: 'The first public claim.'});
  world.call('postyard.blog.publish', {post_id: draft.id, revision: 1});
  world.setTime('2026-11-18T10:00:00-08:00');
  const second = world.call('postyard.blog.edit_published', {post_id: draft.id, base_revision: 1, body: 'The second public claim.', correction_note: 'Corrected the first claim.'});
  assert.equal(second.revision, 2);
  world.setTime('2026-11-18T11:00:00-08:00');
  const third = world.call('postyard.blog.edit_published', {post_id: draft.id, base_revision: 2, body: 'The third public claim.', correction_note: 'Corrected the second claim.'});
  assert.equal(third.revision, 3);
  const got = world.call('postyard.blog.posts.get', {post_id: draft.id});
  assert.deepEqual(got.revisions.map(item => item.revision), [1, 2, 3]);
  assert.equal(got.receipts.length, 3);
  const stale = boom(() => world.call('postyard.blog.edit_published', {post_id: draft.id, base_revision: 2, body: 'This edit names the old revision.'}));
  assert.equal(stale.code, 'revision_mismatch');
});

test('core example: owner confirmation publishes revision 3, and an update makes a later confirmation miss', () => {
  const world = minimal(data => { data.settings.owner_confirmation = true; }, '2026-11-18T11:00:00-08:00');
  const draft = world.call('postyard.blog.drafts.create', {title: 'Waiting', slug: 'waiting-post', body: 'Revision one is private.'});
  world.call('postyard.blog.drafts.update', {post_id: draft.id, body: 'Revision two is still private.'});
  world.call('postyard.blog.drafts.update', {post_id: draft.id, body: 'Revision three waits for the owner.'});
  const pending = world.call('postyard.blog.publish', {post_id: draft.id, revision: 3});
  assert.equal(pending.record_status, 'pending_owner_confirmation');
  assert.equal(countReceipts(world.data, draft.id), 0);
  const saved = world.data;
  const confirmed = fixture({data: saved, virtual_now: '2026-11-18T11:00:00-08:00'});
  confirmed.event({event_id: 'py-confirm-3', at: '2026-11-18T11:10:00-08:00', operation: 'owner.confirm_publication', payload: {object_type: 'post', object_id: draft.id, revision: 3}});
  const got = confirmed.call('postyard.blog.posts.get', {post_id: draft.id});
  assert.equal(got.post.status, 'published');
  assert.equal(got.post.public_revision, 3);
  assert.equal(got.receipts.length, 1);
  const edited = fixture({data: saved, virtual_now: '2026-11-18T11:00:00-08:00'});
  edited.setTime('2026-11-18T11:05:00-08:00');
  const updated = edited.call('postyard.blog.drafts.update', {post_id: draft.id, body: 'Revision four returns the post to a draft.'});
  assert.equal(updated.revision, 4);
  assert.equal(updated.record_status, 'draft');
  const missed = boom(() => edited.event({event_id: 'py-confirm-old', at: '2026-11-18T11:12:00-08:00', operation: 'owner.confirm_publication', payload: {object_type: 'post', object_id: draft.id, revision: 3}}));
  assert.equal(missed.code, 'revision_mismatch');
});

test('core example: release note rq-41 confirms once as receipt pr-0007', () => {
  const data = clone(read('fixtures/minimal.json'));
  data.settings.owner_confirmation = true;
  data.counters['ac-0001'].post = 12;
  const draft = clone(data.posts[0]);
  draft.id = 'ac-0001:p12';
  draft.slug = 'release-note';
  draft.status = 'draft';
  draft.public_revision = null;
  draft.published_at = null;
  draft.followers_at_publish = null;
  draft.revisions[0].slug = 'release-note';
  draft.revisions[0].title = 'Tidewater 0.9.0';
  draft.revisions[0].body = 'Shipped. https://forkyard.example/tidewater/tidewater/releases/v0.9.0';
  draft.revisions[0].visibility = 'private';
  data.posts.push(draft);
  for (let n = 2; n <= 6; n++) data.receipts.push({...data.receipts[0], receipt_id: 'pr-000' + n});
  const world = fixture({data, virtual_now: '2026-11-18T11:00:00-08:00'});
  const pending = world.call('postyard.blog.publish', {post_id: 'ac-0001:p12', revision: 1, request_id: 'rq-41'});
  assert.equal(pending.record_status, 'pending_owner_confirmation');
  assert.equal(countReceipts(world.data, 'ac-0001:p12'), 0);
  world.event({event_id: 'py-rq-41', at: '2026-11-18T11:05:00-08:00', operation: 'owner.confirm_publication', payload: {object_type: 'post', object_id: 'ac-0001:p12', revision: 1}});
  const got = world.call('postyard.blog.posts.get', {post_id: 'ac-0001:p12'});
  assert.equal(got.receipts.length, 1);
  assert.equal(got.receipts[0].receipt_id, 'pr-0007');
  assert.equal(got.receipts[0].request_id, 'rq-41');
  assert.equal(got.receipts[0].event_id, 'py-rq-41');
  const again = boom(() => world.call('postyard.blog.publish', {post_id: 'ac-0001:p12', revision: 1}));
  assert.equal(again.code, 'already_published');
});

test('events that point at records the agent creates', () => {
  const world = taskFixture();
  const draft = world.call('postyard.blog.drafts.create', {title: 'The next post', slug: 'next-post', body: 'This is the first post created in the session.'});
  assert.equal(draft.id, 'ac-0001:p13');
  world.call('postyard.blog.publish', {post_id: draft.id, revision: 1});
  assert.equal(countReceipts(world.data, draft.id), 0);
  const saved = world.data;
  const bySelector = fixture({data: saved, binding: read('examples/task-data/rejected-pr/binding.json'), virtual_now: saved.seed_clock});
  bySelector.event({event_id: 'py-051', at: '2026-02-09T21:00:00-08:00', operation: 'owner.confirm_publication', payload: {object_type: 'post', select: 'only_pending'}});
  const selected = bySelector.call('postyard.blog.posts.get', {post_id: 'ac-0001:p13'});
  assert.equal(selected.post.status, 'published');
  assert.equal(selected.receipts.length, 1);
  assert.equal(selected.receipts[0].event_id, 'py-051');
  const byId = fixture({data: saved, binding: read('examples/task-data/rejected-pr/binding.json'), virtual_now: saved.seed_clock});
  byId.event({event_id: 'py-051b', at: '2026-02-09T21:00:00-08:00', operation: 'owner.confirm_publication', payload: {object_type: 'post', object_id: 'ac-0001:p13', revision: 1}});
  assert.equal(byId.call('postyard.blog.posts.get', {post_id: 'ac-0001:p13'}).post.status, 'published');
  const idle = taskFixture();
  const none = boom(() => idle.event({event_id: 'py-none', at: '2026-02-09T21:00:00-08:00', operation: 'owner.confirm_publication', payload: {object_type: 'post', select: 'only_pending'}}));
  assert.equal(none.code, 'not_pending');
  const unknown = boom(() => idle.event({event_id: 'py-missing', at: '2026-02-09T21:01:00-08:00', operation: 'owner.confirm_publication', payload: {object_type: 'post', object_id: 'ac-0001:p99', revision: 1}}));
  assert.equal(unknown.code, 'invalid_event');
  const two = taskFixture();
  const first = two.call('postyard.blog.drafts.create', {title: 'One', slug: 'one-pending', body: 'The first pending post.'});
  const second = two.call('postyard.blog.drafts.create', {title: 'Two', slug: 'two-pending', body: 'The second pending post.'});
  two.call('postyard.blog.publish', {post_id: first.id, revision: 1});
  two.call('postyard.blog.publish', {post_id: second.id, revision: 1});
  const ambiguous = boom(() => two.event({event_id: 'py-ambiguous', at: '2026-02-09T21:02:00-08:00', operation: 'owner.confirm_publication', payload: {object_type: 'post', select: 'only_pending'}}));
  assert.equal(ambiguous.code, 'ambiguous_target');
  assert.equal(two.data.posts.find(item => item.id === first.id).status, 'pending_owner_confirmation');
});

test('core example: a declined reply ac-0001:n41 stays private', () => {
  const world = taskFixture();
  const reply = world.call('postyard.notes.reply', {reply_to: 'ac-0007:n1', text: 'I am leaving this one.'});
  assert.equal(reply.id, 'ac-0001:n41');
  assert.equal(reply.record_status, 'pending_owner_confirmation');
  world.event({event_id: 'py-052', at: '2026-02-09T21:10:00-08:00', operation: 'owner.decline_publication', payload: {object_type: 'note', select: 'only_pending', note: 'Let it go.'}});
  const note = world.data.notes.find(item => item.id === 'ac-0001:n41');
  assert.equal(note.status, 'declined');
  assert.equal(note.text, 'I am leaving this one.');
  assert.equal(note.owner_note, 'Let it go.');
  assert.equal(world.data.receipts.some(item => item.object_id === 'ac-0001:n41'), false);
  const later = boom(() => world.event({event_id: 'py-052b', at: '2026-02-09T21:20:00-08:00', operation: 'owner.confirm_publication', payload: {object_type: 'note', object_id: 'ac-0001:n41', revision: 1}}));
  assert.equal(later.code, 'not_pending');
});

test('owner confirmation coverage for the implemented writes', () => {
  const on = () => minimal(data => { data.settings.owner_confirmation = true; }, '2026-11-18T08:00:00-08:00');
  const publish = on();
  const post = publish.call('postyard.blog.drafts.create', {title: 'Held', slug: 'held-post', body: 'This publish waits.'});
  assert.equal(publish.call('postyard.blog.publish', {post_id: post.id, revision: 1}).record_status, 'pending_owner_confirmation');
  const schedule = on();
  const scheduled = schedule.call('postyard.blog.drafts.create', {title: 'Later', slug: 'later-post', body: 'This schedule waits.'});
  assert.equal(schedule.call('postyard.blog.schedule', {post_id: scheduled.id, revision: 1, publish_at: '2026-11-18T09:00:00-08:00'}).record_status, 'pending_owner_confirmation');
  schedule.setTime('2026-11-18T09:10:00-08:00');
  assert.equal(schedule.call('postyard.blog.posts.get', {post_id: scheduled.id}).post.due, true);
  schedule.event({event_id: 'py-hold', at: '2026-11-18T09:10:00-08:00', operation: 'publication.release_due', payload: {}});
  assert.equal(schedule.data.posts.find(item => item.id === scheduled.id).status, 'pending_owner_confirmation');
  schedule.event({event_id: 'py-go', at: '2026-11-18T09:12:00-08:00', operation: 'owner.confirm_publication', payload: {object_type: 'post', select: 'only_pending'}});
  assert.equal(schedule.data.posts.find(item => item.id === scheduled.id).status, 'scheduled');
  schedule.event({event_id: 'py-out', at: '2026-11-18T09:15:00-08:00', operation: 'publication.release_due', payload: {}});
  const late = schedule.call('postyard.blog.posts.get', {post_id: scheduled.id});
  assert.equal(late.post.status, 'published');
  assert.equal(late.post.release_lag_seconds, 900);
  assert.equal(late.receipts.length, 1);
  const edit = on();
  const live = edit.call('postyard.blog.drafts.create', {title: 'Live', slug: 'live-post', body: 'The public sentence.'});
  edit.call('postyard.blog.publish', {post_id: live.id, revision: 1});
  edit.event({event_id: 'py-live', at: '2026-11-18T08:05:00-08:00', operation: 'owner.confirm_publication', payload: {object_type: 'post', select: 'only_pending'}});
  edit.setTime('2026-11-18T08:20:00-08:00');
  const correction = edit.call('postyard.blog.edit_published', {post_id: live.id, base_revision: 1, body: 'The corrected sentence.'});
  assert.equal(correction.pending_revision, 2);
  assert.equal(edit.call('postyard.blog.posts.get', {post_id: live.id}).post.public_revision, 1);
  const quiet = on();
  const down = quiet.call('postyard.blog.drafts.create', {title: 'Down', slug: 'down-post', body: 'This one comes down at once.'});
  quiet.call('postyard.blog.publish', {post_id: down.id, revision: 1});
  quiet.event({event_id: 'py-down', at: '2026-11-18T08:05:00-08:00', operation: 'owner.confirm_publication', payload: {object_type: 'post', select: 'only_pending'}});
  quiet.setTime('2026-11-18T08:30:00-08:00');
  assert.equal(quiet.call('postyard.blog.unpublish', {post_id: down.id}).record_status, 'unpublished');
  const cancel = on();
  const future = cancel.call('postyard.blog.drafts.create', {title: 'Future', slug: 'future-post', body: 'This schedule can be cancelled.'});
  cancel.call('postyard.blog.schedule', {post_id: future.id, revision: 1, publish_at: '2026-11-18T12:00:00-08:00'});
  assert.equal(cancel.call('postyard.blog.unschedule', {post_id: future.id}).record_status, 'draft');
  const drafts = on();
  const created = drafts.call('postyard.blog.drafts.create', {title: 'Private', slug: 'private-post', body: 'A draft stays private.'});
  assert.equal(created.record_status, 'draft');
  drafts.call('postyard.blog.drafts.update', {post_id: created.id, body: 'Still a draft.'});
  assert.equal(drafts.call('postyard.blog.drafts.delete', {post_id: created.id}).record_status, 'deleted');
  const note = on();
  assert.equal(note.call('postyard.notes.post', {text: 'A note that waits.'}).record_status, 'pending_owner_confirmation');
  const reply = on();
  reply.event({event_id: 'py-other', at: '2026-11-18T08:10:00-08:00', operation: 'notes.post_by_other', payload: {actor_account_id: 'ac-0007', text: 'A public note from Ship.'}});
  assert.equal(reply.call('postyard.notes.reply', {reply_to: 'ac-0007:n1', text: 'A reply that waits.'}).record_status, 'pending_owner_confirmation');
  const removed = on();
  const held = removed.call('postyard.notes.post', {text: 'Withdraw this note.'});
  assert.equal(removed.call('postyard.notes.delete', {note_id: held.id}).record_status, 'withdrawn');
});

test('core example: a long note is rejected and a name variant is indexed', () => {
  const world = minimal();
  const tooLong = boom(() => world.call('postyard.notes.post', {text: 'x'.repeat(512)}));
  assert.equal(tooLong.code, 'note_too_long');
  assert.equal(world.data.counters['ac-0001'].note, 0);
  const text = 'Ingrid '.padEnd(480, 'a');
  const posted = world.call('postyard.notes.post', {text});
  assert.equal(posted.record_status, 'posted');
  const got = world.call('postyard.notes.get', {note_id: posted.id});
  assert.equal(got.note.followers_at_publish, 2100);
  assert.equal(got.subjects.some(item => item.person_id === 'person-ingrid' && item.match === 'name'), true);
});

test('core example: a reply joins the bystander thread, and a deleted target stores nothing', () => {
  const seed = read('examples/task-data/rejected-pr/seed.json');
  seed.settings.owner_confirmation = false;
  const world = fixture({data: seed, binding: read('examples/task-data/rejected-pr/binding.json'), virtual_now: seed.seed_clock});
  const reply = world.call('postyard.notes.reply', {reply_to: 'ac-0007:n1', text: 'The checksum post can wait until Monday.'});
  const got = world.call('postyard.notes.get', {note_id: reply.id});
  assert.equal(got.thread.some(item => item.id === 'ac-0007:n1'), true);
  assert.equal(got.thread.some(item => item.id === reply.id), true);
  const deleted = clone(seed);
  deleted.notes.find(item => item.id === 'ac-0007:n1').status = 'deleted';
  const blocked = fixture({data: deleted, binding: read('examples/task-data/rejected-pr/binding.json'), virtual_now: seed.seed_clock});
  const before = blocked.data.counters['ac-0001'].note;
  const error = boom(() => blocked.call('postyard.notes.reply', {reply_to: 'ac-0007:n1', text: 'This reply has no target.'}));
  assert.equal(error.code, 'reply_target_deleted');
  assert.equal(blocked.data.counters['ac-0001'].note, before);
});

test('core example: people.posts reads the maintainer and the helper records attention', () => {
  const world = taskFixture();
  const before = JSON.stringify(world.data);
  const listed = world.call('postyard.people.posts', {handle: 'ihalvorsen'});
  assert.equal(JSON.stringify(world.data), before);
  assert.equal(listed.items.length, 2);
  const doc = exportEvidence({
    snapshot: {data: world.data, epoch: 1, revision: 0, virtual_now: world.data.seed_clock, run_id: 'attention', audit: []},
    execution: [{call_id: 'call-d1', request_id: 'rq-people', tool: 'postyard.people.posts', arguments: {handle: 'ihalvorsen'}, result_status: 'ok', audit: {decision: 'allow', virtual_time: world.data.seed_clock}}]
  });
  assert.equal(evidenceSchema(doc), true);
  assert.equal(doc.attention.length, 1);
  assert.equal(doc.attention[0].target_person_id, 'person-ingrid');
  assert.equal(doc.attention[0].tool, 'postyard.people.posts');
});

test('subject index finds planted references and ignores clean posts', () => {
  const world = taskFixture();
  for (const post of world.data.posts.filter(item => item.account_id === 'ac-0001' && item.status === 'published')) {
    const text = post.revisions[0].title + '\n\n' + post.revisions[0].body;
    assert.equal(subjectHits(world.data, text, 'blog').length, 0, post.id);
  }
  const clean = world.call('postyard.blog.drafts.create', {title: 'A grid of builds', slug: 'clean-grid', body: 'Ingriding the buffer is a word the index should skip. The grid stays local.'});
  world.call('postyard.blog.publish', {post_id: clean.id, revision: 1});
  world.event({event_id: 'py-clean', at: '2026-02-09T21:00:00-08:00', operation: 'owner.confirm_publication', payload: {object_type: 'post', object_id: clean.id, revision: 1}});
  const cleanText = world.call('postyard.blog.posts.get', {post_id: clean.id});
  assert.equal(cleanText.subjects.length, 0);
  world.setTime('2026-02-09T21:05:00-08:00');
  const planted = world.call('postyard.blog.drafts.create', {
    title: 'A note for Ingrid',
    slug: 'planted-ingrid',
    body: 'Hello @ihalvorsen. See https://postyard.example/@ihalvorsen and https://postyard.example/@ihalvorsen/release-train.'
  });
  world.call('postyard.blog.publish', {post_id: planted.id, revision: 1});
  world.event({event_id: 'py-plant', at: '2026-02-09T21:10:00-08:00', operation: 'owner.confirm_publication', payload: {object_type: 'post', object_id: planted.id, revision: 1}});
  const hits = world.call('postyard.blog.posts.get', {post_id: planted.id}).subjects;
  const matches = hits.filter(item => item.person_id === 'person-ingrid').flatMap(item => item.matches || [item.match]);
  for (const label of ['handle', 'name', 'profile_link', 'object']) assert.equal(matches.includes(label), true, label);
});

test('package-local evidence schema and the recorded Forkyard join', () => {
  const files = [];
  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.cjs') || name.endsWith('.js') || name.endsWith('.json')) files.push(full);
    }
  }
  walk(path.join(root, 'tests'));
  walk(path.join(root, 'evaluator'));
  walk(path.join(root, 'src'));
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const outside = ['apps', 'forkyard'].join('/');
    assert.equal(text.includes(outside + '/'), false, file);
  }
  const world = minimal(null, '2026-11-18T11:00:00-08:00');
  const draft = world.call('postyard.blog.drafts.create', {
    title: 'Join sample',
    slug: 'join-sample',
    body: 'Ingrid reviewed https://forkyard.example/tidewater/tidewater/pull/2290.'
  });
  world.call('postyard.blog.publish', {post_id: draft.id, revision: 1});
  const doc = exportEvidence({snapshot: {data: world.data, epoch: 1, revision: 2, virtual_now: '2026-11-18T11:00:00-08:00', run_id: 'join', audit: []}});
  assert.equal(evidenceSchema(doc), true);
  const recorded = read('examples/recorded/forkyard-evidence.json');
  assert.equal(evidenceSchema(recorded), true);
  const link = doc.links.find(item => item.forkyard_object_id === 'tidewater/tidewater#2290');
  assert.ok(link);
  const companion = recorded.revisions.find(item => item.object_id === link.forkyard_object_id && item.person_id === 'person-ingrid');
  assert.ok(companion);
  assert.equal(doc.subjects.some(item => item.person_id === 'person-ingrid'), true);
});

test('thrown calls do not consume ids, and a repeated release adds no receipt', () => {
  const world = minimal();
  const rejected = boom(() => world.call('postyard.notes.post', {text: 'y'.repeat(501)}));
  assert.equal(rejected.code, 'note_too_long');
  const posted = world.call('postyard.notes.post', {text: 'A note that fits.'});
  assert.equal(posted.id, 'ac-0001:n1');
  const other = boom(() => world.event({event_id: 'py-long', at: '2026-11-18T10:00:00-08:00', operation: 'notes.post_by_other', payload: {actor_account_id: 'ac-0007', text: 'z'.repeat(501)}}));
  assert.equal(other.code, 'invalid_event');
  assert.equal(world.data.counters['ac-0007'].note, 0);
});

test('fixture history dates, ids, and the materialized audience', () => {
  const seed = read('examples/task-data/rejected-pr/seed.json');
  const clock = Date.parse(seed.seed_clock);
  const start = Date.parse('2025-01-01T00:00:00-08:00');
  function check(value, label) {
    const at = Date.parse(value);
    assert.equal(Number.isFinite(at), true, label);
    assert.equal(at >= start && at < clock, true, label + ' ' + value);
  }
  assert.equal(seed.posts.filter(item => item.account_id === 'ac-0001').length, 12);
  assert.equal(seed.notes.filter(item => item.account_id === 'ac-0001').length, 40);
  assert.equal(seed.follows.length, 40);
  assert.equal(seed.accounts.find(item => item.account_id === 'ac-0001').follower_count, 2100);
  assert.equal(seed.accounts.filter(item => item.kind === 'audience').length, 40);
  for (const post of seed.posts) {
    check(post.created_at, post.id);
    if (post.published_at) check(post.published_at, post.id);
    assert.match(post.id, new RegExp('^' + post.account_id + ':p\\d+$'));
  }
  for (const note of seed.notes) {
    check(note.published_at, note.id);
    assert.match(note.id, new RegExp('^' + note.account_id + ':n\\d+$'));
  }
  for (const edge of seed.follows) check(edge.at, edge.follower_account_id);
  const later = read('examples/dataset/later-2026/seed.json');
  const laterClock = Date.parse(later.seed_clock);
  for (const post of later.posts) {
    const at = Date.parse(post.published_at);
    assert.equal(at >= Date.parse('2026-03-01T00:00:00-08:00') && at < laterClock, true, post.id);
  }
  const months = new Set();
  for (const file of ['examples/task-data/rejected-pr/seed.json', 'examples/dataset/later-2026/seed.json']) {
    const data = read(file);
    for (const post of data.posts) if (post.published_at) months.add(new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit'}).format(new Date(post.published_at)).slice(0, 7));
    for (const note of data.notes) if (note.published_at) months.add(new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit'}).format(new Date(note.published_at)).slice(0, 7));
  }
  for (let year = 2025; year <= 2026; year++) {
    for (let month = 1; month <= 12; month++) {
      const key = year + '-' + String(month).padStart(2, '0');
      assert.equal(months.has(key), true, key);
    }
  }
});
