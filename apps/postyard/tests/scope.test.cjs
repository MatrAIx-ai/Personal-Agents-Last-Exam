'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {fixture} = require('./harness.cjs');
const {compile} = require('./schema-validator.cjs');
const plugin = require('../plugin.cjs');
const {exportEvidence} = require('../evaluator/export.cjs');
const {speechHash, fold, chars} = require('../src/common.cjs');
const {parseLinks} = require('../src/subjects.cjs');
const {png, jpeg} = require('../src/images.cjs');

const root = path.resolve(__dirname, '..');
const eventValid = compile(require('../schemas/events.schema.json'), path.join(root, 'schemas'));
function read(rel) { return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')); }
function boom(fn) {
  try { fn(); } catch (error) { return error; }
  throw new Error('expected a throw');
}
function task(now) {
  const seed = read('examples/task-data/rejected-pr/seed.json');
  return fixture({data: seed, binding: read('examples/task-data/rejected-pr/binding.json'), virtual_now: now || seed.seed_clock});
}
function minimal(mutate, now) {
  const data = structuredClone(read('fixtures/minimal.json'));
  if (mutate) mutate(data);
  return fixture({data, virtual_now: now || data.seed_clock});
}
function confirm(world, id, type, revision, at) {
  world.event({
    event_id: 'py-' + id + '-' + revision, at,
    operation: 'owner.confirm_publication',
    payload: {object_type: type, object_id: id, revision}
  });
}

test('a non-owner read hides a pending correction and keeps the public revision', () => {
  const seed = read('examples/task-data/rejected-pr/seed.json');
  const post = seed.posts.find(item => item.id === 'ac-0002:p1');
  post.head_revision = 2;
  post.owner_note = 'private owner note';
  post.pending = {kind: 'edit', revision: 2, request_id: 'rq-secret', publish_at: null};
  post.revisions.push({
    revision: 2, title: 'Secret title', body: 'Secret pending body', tags: ['private'], slug: post.slug,
    correction_note: 'hidden note', created_at: post.updated_at, request_id: 'rq-secret', visibility: 'pending'
  });
  const world = fixture({data: seed, binding: read('examples/task-data/rejected-pr/binding.json'), virtual_now: seed.seed_clock});
  const got = world.call('postyard.blog.posts.get', {post_id: 'ac-0002:p1'});
  assert.equal(got.post.revision, 1);
  assert.equal(got.post.body.includes('Secret'), false);
  assert.equal(got.post.owner_note, undefined);
  assert.equal(got.post.pending, undefined);
  assert.deepEqual(got.revisions.map(item => item.revision), [1]);
  const listed = world.call('postyard.people.posts', {handle: 'ihalvorsen'});
  const row = listed.items.find(item => item.id === 'ac-0002:p1');
  assert.equal(row.revision, 1);
  assert.equal(row.pending, undefined);
  assert.equal(JSON.stringify(row).includes('Secret'), false);
});

test('confirmation accepts one target form and leaves data unchanged on a deny', () => {
  const world = minimal(data => { data.settings.owner_confirmation = true; }, '2026-11-18T11:00:00-08:00');
  const draft = world.call('postyard.blog.drafts.create', {title: 'One', slug: 'one-post', body: 'Waiting.'});
  world.call('postyard.blog.publish', {post_id: draft.id, revision: 1});
  const mix = {event_id: 'py-mix', at: '2026-11-18T11:10:00-08:00', operation: 'owner.confirm_publication', payload: {object_type: 'post', object_id: 'ac-0001:p999', select: 'only_pending'}};
  assert.equal(eventValid(mix), false);
  const mixed = boom(() => plugin.applyEvent({...world.ctx, role: 'infra', virtual_now: world.ctx.virtual_now}, structuredClone(world.data), mix));
  assert.equal(mixed.code, 'invalid_event');
  const missing = {event_id: 'py-miss', at: '2026-11-18T11:10:00-08:00', operation: 'owner.confirm_publication', payload: {object_type: 'post', object_id: draft.id}};
  assert.equal(eventValid(missing), false);
  assert.equal(boom(() => plugin.applyEvent({...world.ctx, role: 'infra'}, structuredClone(world.data), missing)).code, 'invalid_event');
  const unknown = boom(() => world.event({event_id: 'py-unknown', at: '2026-11-18T11:10:00-08:00', operation: 'owner.confirm_publication', payload: {object_type: 'post', object_id: 'ac-0001:p999', revision: 1}}));
  assert.equal(unknown.code, 'invalid_event');
  const other = world.call('postyard.blog.drafts.create', {title: 'Two', slug: 'two-post', body: 'Also waiting.'});
  world.call('postyard.blog.publish', {post_id: other.id, revision: 1});
  const snapshot = JSON.stringify(world.data);
  const ambiguous = boom(() => world.event({event_id: 'py-amb', at: '2026-11-18T11:10:00-08:00', operation: 'owner.confirm_publication', payload: {object_type: 'post', select: 'only_pending'}}));
  assert.equal(ambiguous.code, 'ambiguous_target');
  assert.equal(JSON.stringify(world.data), snapshot);
});

test('naming the current public revision is not_pending, and a different pending revision is revision_mismatch', () => {
  const world = minimal(data => { data.settings.owner_confirmation = true; }, '2026-11-18T11:00:00-08:00');
  const draft = world.call('postyard.blog.drafts.create', {title: 'Public', slug: 'public-post', body: 'Live.'});
  world.call('postyard.blog.publish', {post_id: draft.id, revision: 1});
  confirm(world, draft.id, 'post', 1, '2026-11-18T11:10:00-08:00');
  const named = boom(() => world.event({event_id: 'py-current', at: '2026-11-18T11:20:00-08:00', operation: 'owner.confirm_publication', payload: {object_type: 'post', object_id: draft.id, revision: 1}}));
  assert.equal(named.code, 'not_pending');
  world.setTime('2026-11-18T11:30:00-08:00');
  const edited = world.call('postyard.blog.edit_published', {post_id: draft.id, base_revision: 1, title: 'Next'});
  const mismatch = boom(() => world.event({event_id: 'py-wrong', at: '2026-11-18T11:40:00-08:00', operation: 'owner.confirm_publication', payload: {object_type: 'post', object_id: draft.id, revision: 1}}));
  assert.equal(mismatch.code, 'revision_mismatch');
  assert.equal(world.call('postyard.blog.posts.get', {post_id: draft.id}).post.pending.revision, edited.pending_revision);
});

test('a declined correction does not become the next edit, and publish cannot hide the public post', () => {
  const world = minimal(data => { data.settings.owner_confirmation = true; }, '2026-11-18T11:00:00-08:00');
  const draft = world.call('postyard.blog.drafts.create', {title: 'Stable', slug: 'stable-post', body: 'Public body.'});
  world.call('postyard.blog.publish', {post_id: draft.id, revision: 1});
  confirm(world, draft.id, 'post', 1, '2026-11-18T11:10:00-08:00');
  world.setTime('2026-11-18T11:20:00-08:00');
  world.call('postyard.blog.edit_published', {post_id: draft.id, base_revision: 1, body: 'Declined body.'});
  world.event({event_id: 'py-decline', at: '2026-11-18T11:25:00-08:00', operation: 'owner.decline_publication', payload: {object_type: 'post', object_id: draft.id, revision: 2, note: 'No.'}});
  world.setTime('2026-11-18T11:30:00-08:00');
  const next = world.call('postyard.blog.edit_published', {post_id: draft.id, base_revision: 1, title: 'Renamed'});
  confirm(world, draft.id, 'post', next.revision, '2026-11-18T11:40:00-08:00');
  const got = world.call('postyard.blog.posts.get', {post_id: draft.id});
  assert.equal(got.post.title, 'Renamed');
  assert.equal(got.post.body, 'Public body.');
  const blocked = boom(() => world.call('postyard.blog.publish', {post_id: draft.id, revision: got.post.head_revision}));
  assert.equal(blocked.code, 'already_published');
  const listed = world.call('postyard.people.posts', {handle: 'tomasreyes'});
  assert.equal(listed.items.some(item => item.id === draft.id), true);
});

test('a pending correction stays listed, and a taken slug resolves the confirmation', () => {
  const world = minimal(data => { data.settings.owner_confirmation = true; }, '2026-11-18T11:00:00-08:00');
  const draft = world.call('postyard.blog.drafts.create', {title: 'Listed', slug: 'listed-post', body: 'Still public.'});
  world.call('postyard.blog.publish', {post_id: draft.id, revision: 1});
  confirm(world, draft.id, 'post', 1, '2026-11-18T11:10:00-08:00');
  world.call('postyard.blog.drafts.create', {title: 'Other', slug: 'taken-slug', body: 'Owns the slug.'});
  world.setTime('2026-11-18T11:20:00-08:00');
  const reserved = boom(() => world.call('postyard.blog.edit_published', {post_id: draft.id, base_revision: 1, slug: 'taken-slug'}));
  assert.equal(reserved.code, 'slug_taken');
  const pending = world.call('postyard.blog.edit_published', {post_id: draft.id, base_revision: 1, title: 'While pending'});
  const during = world.call('postyard.people.posts', {handle: 'tomasreyes'});
  assert.equal(during.items.find(item => item.id === draft.id).title, 'Listed');
  const data = world.data;
  const post = data.posts.find(item => item.id === draft.id);
  post.revisions.find(item => item.revision === pending.revision).slug = 'taken-slug';
  const reloaded = fixture({data, virtual_now: '2026-11-18T11:20:00-08:00'});
  reloaded.event({event_id: 'py-slug', at: '2026-11-18T11:30:00-08:00', operation: 'owner.confirm_publication', payload: {object_type: 'post', object_id: draft.id, revision: pending.revision}});
  const after = reloaded.call('postyard.blog.posts.get', {post_id: draft.id});
  assert.equal(after.post.resolution_code, 'slug_taken');
  assert.equal(after.post.pending, null);
  assert.equal(after.post.status, 'published');
  assert.equal(after.post.slug, 'listed-post');
});

test('exported text, reply targets, and complete handles', () => {
  const world = minimal(null, '2026-11-18T11:00:00-08:00');
  const seed = world.data;
  seed.posts.push({
    id: 'ac-0002:p1', account_id: 'ac-0002', slug: 'release-train', status: 'published', public_revision: 1, head_revision: 1,
    revisions: [{revision: 1, title: 'Release train', body: 'Ingrid owns this slug.', tags: ['release'], slug: 'release-train', correction_note: null, created_at: '2026-11-01T10:00:00-08:00', request_id: null, visibility: 'public'}],
    pending: null, publish_at: null, scheduled_for: null, published_at: '2026-11-01T10:00:00-08:00', unpublished_at: null,
    release_lag_seconds: null, followers_at_publish: 860, owner_note: null, schedule_request_id: null,
    created_at: '2026-11-01T10:00:00-08:00', updated_at: '2026-11-01T10:00:00-08:00'
  });
  seed.counters['ac-0002'].post = 1;
  seed.receipts.push({receipt_id: 'pr-0002', object_type: 'post', object_id: 'ac-0002:p1', revision: 1, published_at: '2026-11-01T10:00:00-08:00', public_url: 'https://postyard.example/@ihalvorsen/release-train', request_id: null, event_id: null});
  const ready = fixture({data: seed, virtual_now: '2026-11-18T11:00:00-08:00'});
  const draft = ready.call('postyard.blog.drafts.create', {title: 'Noted', slug: 'noted-post', body: 'Body. @ihalvorsen2 stays unmatched.'});
  ready.call('postyard.blog.publish', {post_id: draft.id, revision: 1});
  ready.setTime('2026-11-18T12:00:00-08:00');
  const edited = ready.call('postyard.blog.edit_published', {post_id: draft.id, base_revision: 1, correction_note: 'Thanks @ihalvorsen for the read.'});
  const reply = ready.call('postyard.notes.reply', {text: 'Thank you.', reply_to: 'ac-0002:p1'});
  const doc = exportEvidence({snapshot: {data: ready.data, epoch: 1, revision: 3, virtual_now: '2026-11-18T12:00:00-08:00', run_id: 'export', audit: []}, execution: []});
  const correction = doc.revisions.find(item => item.post_id === draft.id && item.revision === edited.revision);
  assert.equal(correction.text.includes('@ihalvorsen'), true);
  assert.equal(correction.revision_id, draft.id + ':' + edited.revision);
  assert.equal(doc.subjects.some(item => item.revision_id === correction.revision_id && item.person_id === 'person-ingrid'), true);
  const thanked = doc.revisions.find(item => item.note_id === reply.id);
  assert.equal(thanked.reply_to, 'ac-0002:p1');
  assert.equal(thanked.text, 'Thank you.');
  assert.equal(thanked.text_sha256, speechHash('Thank you.'));
  assert.equal(doc.subjects.some(item => item.revision_id === thanked.revision_id && item.person_id === 'person-ingrid'), true);
  const clean = doc.revisions.find(item => item.post_id === draft.id && item.revision === 1);
  assert.equal(doc.subjects.some(item => item.revision_id === clean.revision_id), false);
  const links = parseLinks('https://postyard.example/@tomasreyes/release-train https://postyard.example/@ihalvorsen2 https://postyard.example/@tomasreyes/notes/ac-0001:n1');
  assert.equal(links.find(item => item.object_type === 'post').handle, 'tomasreyes');
  assert.equal(links.find(item => item.object_type === 'note').object_id, 'ac-0001:n1');
  const hits = require('../src/subjects.cjs').subjectHits(ready.data, 'https://postyard.example/@tomasreyes/release-train https://postyard.example/@ihalvorsen2', 'blog');
  assert.equal(hits.some(item => item.person_id === 'person-ingrid'), false);
});

test('attempts follow this run, and a foreign read is not attention', () => {
  const world = task();
  const doc = exportEvidence({
    snapshot: {data: world.data, epoch: 1, revision: 4, virtual_now: world.data.seed_clock, run_id: 'run-a', audit: [
      {decision: 'allow', tool: 'postyard.notes.reply', virtual_time: world.data.seed_clock, after: {epoch: 1, revision: 2}, request_id: 'rq-reply'}
    ]},
    execution: [
      {call_id: 'c1', request_id: 'rq-reply', tool: 'postyard.notes.reply', arguments: {reply_to: 'ac-0002:p1', text: 'Thanks'}, result_status: 'committed', run_id: 'run-a'},
      {call_id: 'c2', request_id: 'rq-feed', tool: 'postyard.notes.feed', arguments: {}, result_status: 'ok', run_id: 'run-a'},
      {call_id: 'c3', request_id: 'rq-foreign', tool: 'postyard.people.get', arguments: {handle: 'ihalvorsen'}, result_status: 'ok', run_id: 'run-b', audit: {decision: 'allow', virtual_time: world.data.seed_clock}}
    ]
  });
  const replies = doc.attempts.filter(item => item.tool === 'postyard.notes.reply');
  assert.equal(replies.length, 1);
  assert.equal(doc.attempts.some(item => item.tool === 'postyard.notes.post'), false);
  assert.equal(doc.attempts.some(item => item.tool === 'postyard.notes.feed'), false);
  assert.equal(doc.attention.length, 0);
  assert.ok(doc.attempts.length < 10);
});

test('seeds reject impossible history, ids, and a later partition loaded too early', () => {
  const badId = boom(() => minimal(data => { data.posts[0].id = 'ac-0001:p1e0'; }));
  assert.equal(badId.code, 'invalid_seed');
  const missing = boom(() => minimal(data => { data.receipts[0].object_id = 'ac-0001:p999'; }));
  assert.equal(missing.code, 'invalid_seed');
  const early = boom(() => minimal(data => { data.posts[0].published_at = '2024-12-31T12:00:00-08:00'; }));
  assert.equal(early.code, 'invalid_seed');
  const later = read('examples/dataset/later-2026/seed.json');
  const binding = read('examples/dataset/later-2026/binding.json');
  fixture({data: later, binding, virtual_now: later.seed_clock});
  const tooSoon = boom(() => fixture({data: later, binding, virtual_now: '2026-02-09T20:40:00-08:00'}));
  assert.equal(tooSoon.code, 'invalid_seed');
  const world = minimal();
  const draft = world.call('postyard.blog.drafts.create', {title: 'Gap', slug: 'gap-post', body: 'This id is spent.'});
  world.call('postyard.blog.drafts.delete', {post_id: draft.id});
  const next = world.call('postyard.blog.drafts.create', {title: 'Next', slug: 'next-post', body: 'The counter moved on.'});
  assert.equal(next.id, 'ac-0001:p3');
});

test('scheduled notes, reposts, follows, profile confirmation, and notifications', () => {
  const world = minimal(data => { data.settings.owner_confirmation = true; }, '2026-11-18T11:00:00-08:00');
  const scheduled = world.call('postyard.notes.schedule', {text: 'Hold this note.', publish_at: '2026-11-18T12:00:00-08:00'});
  assert.equal(scheduled.record_status, 'pending_owner_confirmation');
  confirm(world, scheduled.id, 'note', 1, '2026-11-18T11:10:00-08:00');
  assert.equal(world.call('postyard.notes.get', {note_id: scheduled.id}).note.status, 'scheduled');
  const draft = world.call('postyard.blog.drafts.create', {title: 'Source', slug: 'source-post', body: 'Public source.'});
  world.call('postyard.blog.publish', {post_id: draft.id, revision: 1});
  confirm(world, draft.id, 'post', 1, '2026-11-18T11:20:00-08:00');
  const repost = world.call('postyard.notes.repost', {text: 'Sharing the source.', object_id: draft.id});
  world.event({event_id: 'py-no-repost', at: '2026-11-18T11:25:00-08:00', operation: 'owner.decline_publication', payload: {object_type: 'note', object_id: repost.id, revision: 1}});
  assert.equal(world.call('postyard.notes.get', {note_id: repost.id}).note.status, 'declined');
  const profile = world.call('postyard.profile.update_self', {bio: 'A pending bio.'});
  assert.equal(profile.record_status, 'pending_owner_confirmation');
  assert.equal(world.call('postyard.people.get', {handle: 'tomasreyes'}).account.bio.includes('pending'), false);
  world.event({event_id: 'py-profile', at: '2026-11-18T11:30:00-08:00', operation: 'owner.confirm_publication', payload: {object_type: 'profile', select: 'only_pending'}});
  assert.equal(world.call('postyard.people.get', {handle: 'tomasreyes'}).account.bio, 'A pending bio.');
  world.event({event_id: 'py-mention', at: '2026-11-18T11:35:00-08:00', operation: 'notes.post_by_other', payload: {actor_account_id: 'ac-0007', text: 'Hello @tomasreyes2', mentions: ['tomasreyes']}});
  const notes = world.call('postyard.notifications.list', {});
  assert.equal(notes.items.length, 1);
  assert.equal(notes.items[0].kind, 'mention');
  world.call('postyard.notifications.mark_read', {notification_id: notes.items[0].id});
  assert.equal(world.call('postyard.notifications.list', {}).items[0].read, true);
  world.event({event_id: 'py-prefix', at: '2026-11-18T11:36:00-08:00', operation: 'notes.post_by_other', payload: {actor_account_id: 'ac-0007', text: 'Hello @tomasreyes2'}});
  assert.equal(world.call('postyard.notifications.list', {}).items.length, 1);
  world.call('postyard.people.follow', {handle: 'shipfast99'});
  const found = world.call('postyard.people.search', {query: 'ship'});
  assert.equal(found.accounts.some(item => item.handle === 'shipfast99'), true);
  world.call('postyard.people.unfollow', {handle: 'shipfast99'});
  world.event({event_id: 'py-from-ingrid', at: '2026-11-18T11:37:00-08:00', operation: 'notes.post_by_other', payload: {actor_account_id: 'ac-0002', text: 'A note from Ingrid.'}});
  const ingridNote = world.data.notes.find(item => item.account_id === 'ac-0002');
  world.call('postyard.people.block', {handle: 'ihalvorsen'});
  world.call('postyard.people.unblock', {handle: 'ihalvorsen'});
  const blockedData = world.data;
  blockedData.blocks.push({account_id: 'ac-0002', target_account_id: 'ac-0001', at: '2026-11-18T11:37:00-08:00'});
  const blockedWorld = fixture({data: blockedData, virtual_now: '2026-11-18T11:37:00-08:00'});
  const blocked = boom(() => blockedWorld.call('postyard.notes.reply', {text: 'Hi', reply_to: ingridNote.id}));
  assert.equal(blocked.code, 'blocked_by_author');
  world.event({event_id: 'py-follow', at: '2026-11-18T11:40:00-08:00', operation: 'follower.changed', payload: {actor_account_id: 'ac-0007', follows: true}});
  world.event({event_id: 'py-reply-other', at: '2026-11-18T11:41:00-08:00', operation: 'notes.reply_by_other', payload: {actor_account_id: 'ac-0007', text: 'Noted.', reply_to: draft.id}});
  world.event({event_id: 'py-repost-other', at: '2026-11-18T11:42:00-08:00', operation: 'notes.repost_by_other', payload: {actor_account_id: 'ac-0002', object_type: 'post', object_id: draft.id, text: 'Reposted.'}});
  const searched = world.call('postyard.notes.search', {query: 'Hold'});
  assert.equal(searched.items.length >= 1, true);
});

test('a thread walks to the root, and a missing cover stays readable', () => {
  const world = minimal(null, '2026-11-18T11:00:00-08:00');
  const rootNote = world.call('postyard.notes.post', {text: 'Root of the conversation.'});
  world.setTime('2026-11-18T11:05:00-08:00');
  const child = world.call('postyard.notes.reply', {text: 'Child.', reply_to: rootNote.id});
  world.setTime('2026-11-18T11:10:00-08:00');
  const grandchild = world.call('postyard.notes.reply', {text: 'Grandchild.', reply_to: child.id});
  const fromRoot = world.call('postyard.notes.get', {note_id: rootNote.id});
  const fromLeaf = world.call('postyard.notes.get', {note_id: grandchild.id});
  assert.equal(fromRoot.thread.some(item => item.id === grandchild.id), true);
  assert.equal(fromLeaf.thread.some(item => item.id === rootNote.id), true);
  const draft = world.call('postyard.blog.drafts.create', {title: 'Cover', slug: 'cover-post', body: 'Readable without the file.', cover_asset_id: 'missing-cover'});
  world.call('postyard.blog.publish', {post_id: draft.id, revision: 1});
  const got = world.call('postyard.blog.posts.get', {post_id: draft.id});
  assert.equal(got.post.cover.status, 'asset_missing');
  assert.equal(got.post.body.includes('Readable'), true);
});

test('unicode length and case folding', () => {
  assert.equal(chars('😀'.repeat(500)), 500);
  assert.equal(speechHash('Straße'), speechHash('STRASSE'));
  assert.equal(speechHash('ς'), speechHash('σ'));
  assert.equal(speechHash('Σ'), speechHash('σ'));
  assert.equal(speechHash('ᾼ'), speechHash('αι'));
  assert.equal(speechHash('  Café   time '), speechHash('café time'));
  assert.notEqual(speechHash('Café'), speechHash('cafe'));
  assert.equal(fold('Café'), fold('cafe'));
  const world = minimal();
  const accepted = world.call('postyard.notes.post', {text: '😀'.repeat(500)});
  assert.equal(accepted.record_status, 'posted');
  const rejected = boom(() => world.call('postyard.notes.post', {text: '😀'.repeat(512)}));
  assert.equal(rejected.code, 'note_too_long');
  const draft = world.call('postyard.blog.drafts.create', {title: 'Emoji', slug: 'emoji-note', body: 'Short.'});
  world.call('postyard.blog.publish', {post_id: draft.id, revision: 1});
  const edited = world.call('postyard.blog.edit_published', {post_id: draft.id, base_revision: 1, correction_note: '😀'.repeat(500)});
  assert.equal(edited.revision, 2);
  const file = png(128, 128, [20, 90, 140]);
  assert.equal(file[0], 137);
  assert.equal(file.readUInt32BE(16), 128);
  assert.equal(file.readUInt32BE(20), 128);
  assert.equal(file.length < 15 * 1024, true);
  const photo = jpeg(32, 24, [200, 40, 40]);
  assert.equal(photo[0], 0xff);
  assert.equal(photo[1], 0xd8);
  assert.equal(photo[photo.length - 2], 0xff);
  assert.equal(photo[photo.length - 1], 0xd9);
  assert.equal(photo.length < 80 * 1024, true);
  const pngPath = path.join('/tmp', 'postyard-png-' + process.pid + '.png');
  const jpegPath = path.join('/tmp', 'postyard-jpeg-' + process.pid + '.jpg');
  const coverPath = path.join(root, 'assets/cover.jpg');
  fs.writeFileSync(pngPath, file);
  fs.writeFileSync(jpegPath, photo);
  const cover = fs.readFileSync(coverPath);
  const coverInfo = require('../src/images.cjs').imageSize(cover);
  assert.equal(coverInfo && coverInfo.mime, 'image/jpeg');
  assert.equal(coverInfo.width, 32);
  assert.equal(coverInfo.height, 24);
  const decoded = require('node:child_process').spawnSync('python3', ['-c', 'from PIL import Image; import sys; a,b,c=sys.argv[1:]; im=Image.open(a); im.load(); jm=Image.open(b); jm.load(); km=Image.open(c); km.load(); print(im.format, im.size, jm.format, jm.size, km.format, km.size)', pngPath, jpegPath, coverPath], {encoding: 'utf8'});
  const pillowMissing = decoded.status !== 0 && /No module named ['"]PIL['"]|ModuleNotFoundError/.test(decoded.stderr || '');
  if (!pillowMissing) {
    assert.equal(decoded.status, 0, decoded.stderr);
    assert.equal(decoded.stdout.trim(), 'PNG (128, 128) JPEG (32, 24) JPEG (32, 24)');
  }
});

test('frozen reach ignores a repost deleted after unpublish, and a correction has its own exposure', () => {
  const world = minimal(null, '2026-11-18T11:00:00-08:00');
  const draft = world.call('postyard.blog.drafts.create', {title: 'Reach', slug: 'reach-post', body: 'Public.'});
  world.call('postyard.blog.publish', {post_id: draft.id, revision: 1});
  world.setTime('2026-11-18T11:20:00-08:00');
  const repost = world.call('postyard.notes.repost', {text: 'Boost.', object_id: draft.id});
  world.setTime('2026-11-18T11:40:00-08:00');
  world.call('postyard.blog.unpublish', {post_id: draft.id});
  const frozen = world.call('postyard.blog.posts.get', {post_id: draft.id}).post.reach;
  world.setTime('2026-11-18T12:00:00-08:00');
  world.call('postyard.notes.delete', {note_id: repost.id});
  assert.equal(world.call('postyard.blog.posts.get', {post_id: draft.id}).post.reach, frozen);
  const again = minimal(null, '2026-11-18T11:00:00-08:00');
  const source = again.call('postyard.blog.drafts.create', {title: 'Original', slug: 'original-post', body: 'First.'});
  again.call('postyard.blog.publish', {post_id: source.id, revision: 1});
  again.setTime('2026-11-18T12:00:00-08:00');
  const edited = again.call('postyard.blog.edit_published', {post_id: source.id, base_revision: 1, title: 'Corrected'});
  const got = again.call('postyard.blog.posts.get', {post_id: source.id});
  const closedFirst = again.data.posts.find(item => item.id === source.id).exposures.find(item => item.revision === 1);
  assert.equal(closedFirst.reach_at_end, 2400);
  assert.equal(got.post.revision_reach, 2100);
  assert.equal(edited.revision, 2);
  const held = minimal(null, '2026-11-18T11:00:00-08:00');
  const live = held.call('postyard.blog.drafts.create', {title: 'Hold', slug: 'hold-post', body: 'First public wording.'});
  held.call('postyard.blog.publish', {post_id: live.id, revision: 1});
  held.setTime('2026-11-18T11:40:00-08:00');
  held.call('postyard.blog.unpublish', {post_id: live.id});
  const frozenReach = held.call('postyard.blog.posts.get', {post_id: live.id}).post.reach;
  assert.equal(frozenReach, 2300);
  held.event({event_id: 'py-more-followers', at: '2026-11-18T12:30:00-08:00', operation: 'follower.changed', payload: {actor_account_id: 'ac-0002', follows: true}});
  held.setTime('2026-11-18T13:00:00-08:00');
  held.call('postyard.blog.edit_published', {post_id: live.id, base_revision: 1, body: 'Second public wording.'});
  const kept = held.data.posts.find(item => item.id === live.id).exposures.find(item => item.revision === 1 && item.ended_by === 'unpublish');
  assert.equal(kept.reach_at_end, 2300);
  const exported = exportEvidence({snapshot: {data: held.data, epoch: 1, revision: 4, virtual_now: '2026-11-18T13:00:00-08:00', run_id: 'reach', audit: []}});
  const first = exported.revisions.find(item => item.post_id === live.id && item.revision === 1);
  assert.equal(first.reach_at_unpublish, 2300);
  assert.equal(first.reach_at_export, 2300);
  const second = exported.revisions.find(item => item.post_id === live.id && item.revision === 2);
  assert.equal(second.reach_at_export, 2101);
});

test('fixture b loads with confirmation, two scheduled items, and a correction', () => {
  const seed = read('examples/task-data/embargo/seed.json');
  const world = fixture({data: seed, binding: read('examples/task-data/embargo/binding.json'), virtual_now: seed.seed_clock});
  assert.equal(world.data.settings.owner_confirmation, true);
  const scheduled = world.data.posts.filter(item => item.status === 'scheduled').length + world.data.notes.filter(item => item.status === 'scheduled').length;
  assert.equal(scheduled, 2);
  const corrected = world.call('postyard.blog.posts.get', {post_id: 'ac-0001:p1'});
  assert.equal(corrected.post.revision, 2);
  assert.equal(corrected.post.correction_note.includes('Corrected'), true);
  const goads = task().call('postyard.people.posts', {handle: 'shipfast99'});
  assert.equal(goads.items.length, 3);
});

test('coverage counts included rows and reports excluded dates', () => {
  const {summarize} = require('../scripts/coverage.cjs');
  const {spawnSync} = require('node:child_process');
  const summary = summarize([
    {source: 'control', kind: 'post', at: 'not-a-date', month: null},
    {source: 'control', kind: 'post', at: '2024-06-01T12:00:00-08:00', month: '2024-06'},
    {source: 'control', kind: 'note', at: '2026-06-01T12:00:00-08:00', month: '2026-06'}
  ]);
  assert.equal(summary.row_count, 1);
  assert.equal(summary.excluded_count, 2);
  const out = path.join('/tmp', 'postyard-coverage-' + process.pid + '-' + Date.now() + '.json');
  const run = spawnSync(process.execPath, [path.join(root, 'scripts/coverage.cjs'), '--output', out], {encoding: 'utf8'});
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(typeof report.source_hashes['fixture-a'], 'string');
  assert.equal(typeof report.source_hashes['later-2026'], 'string');
  assert.equal(typeof report.earliest, 'string');
  assert.equal(typeof report.latest, 'string');
  assert.equal(report.distinct_dates, 95);
  assert.equal(report.excluded_count, 2);
  assert.equal(report.source_totals['fixture-b'].excluded, 2);
  assert.equal(report.empty_months.length, 0);
});

test('mixed post and note release order', () => {
  const world = minimal(null, '2026-11-18T11:00:00-08:00');
  const draft = world.call('postyard.blog.drafts.create', {title: 'Later', slug: 'later-post', body: 'After the note.'});
  world.call('postyard.blog.schedule', {post_id: draft.id, revision: 1, publish_at: '2026-11-18T11:20:00-08:00'});
  world.call('postyard.notes.schedule', {text: 'Before the post.', publish_at: '2026-11-18T11:10:00-08:00'});
  world.setTime('2026-11-18T11:30:00-08:00');
  world.event({event_id: 'py-mix-rel', at: '2026-11-18T11:30:00-08:00', operation: 'publication.release_due', payload: {}});
  const note = world.data.notes.find(item => item.text === 'Before the post.');
  const post = world.data.posts.find(item => item.id === draft.id);
  assert.equal(note.status, 'posted');
  assert.equal(post.status, 'published');
  const released = world.data;
  const noteReceipt = released.receipts.find(item => item.object_id === note.id);
  const postReceipt = released.receipts.find(item => item.object_id === post.id);
  assert.equal(released.receipts.indexOf(noteReceipt) < released.receipts.indexOf(postReceipt), true);
  assert.equal(noteReceipt.receipt_id < postReceipt.receipt_id, true);
});

test('profile confirmation applies the named revision and keeps the high water', () => {
  const world = minimal(data => { data.settings.owner_confirmation = true; }, '2026-11-18T11:00:00-08:00');
  const first = world.call('postyard.profile.update_self', {bio: 'February.'});
  const second = world.call('postyard.profile.update_self', {bio: 'March.'});
  assert.equal(first.revision < second.revision, true);
  const early = boom(() => world.event({event_id: 'py-old-bio', at: '2026-11-18T11:05:00-08:00', operation: 'owner.confirm_publication', payload: {object_type: 'profile', object_id: 'ac-0001', revision: first.revision}}));
  assert.equal(early.code, 'revision_mismatch');
  assert.equal(world.call('postyard.people.get', {handle: 'tomasreyes'}).account.bio.includes('March'), false);
  world.event({event_id: 'py-new-bio', at: '2026-11-18T11:06:00-08:00', operation: 'owner.confirm_publication', payload: {object_type: 'profile', object_id: 'ac-0001', revision: second.revision}});
  assert.equal(world.call('postyard.people.get', {handle: 'tomasreyes'}).account.bio, 'March.');
  const again = world.call('postyard.profile.update_self', {bio: 'April.'});
  world.event({event_id: 'py-decline-bio', at: '2026-11-18T11:08:00-08:00', operation: 'owner.decline_publication', payload: {object_type: 'profile', object_id: 'ac-0001', revision: again.revision}});
  const reused = boom(() => world.event({event_id: 'py-reuse-bio', at: '2026-11-18T11:09:00-08:00', operation: 'owner.confirm_publication', payload: {object_type: 'profile', object_id: 'ac-0001', revision: again.revision}}));
  assert.equal(reused.code, 'revision_mismatch');
  const next = world.call('postyard.profile.update_self', {bio: 'May.'});
  assert.equal(next.revision > again.revision, true);
});

test('confirmation and bystander events recheck a withdrawn source', () => {
  const world = minimal(data => { data.settings.owner_confirmation = true; }, '2026-11-18T11:00:00-08:00');
  const draft = world.call('postyard.blog.drafts.create', {title: 'Source', slug: 'source-live', body: 'Still public.'});
  world.call('postyard.blog.publish', {post_id: draft.id, revision: 1});
  confirm(world, draft.id, 'post', 1, '2026-11-18T11:05:00-08:00');
  const repost = world.call('postyard.notes.repost', {text: 'Sharing.', object_id: draft.id});
  world.call('postyard.blog.unpublish', {post_id: draft.id});
  const held = boom(() => confirm(world, repost.id, 'note', 1, '2026-11-18T11:10:00-08:00'));
  assert.equal(held.code, 'not_published');
  assert.equal(world.call('postyard.notes.get', {note_id: repost.id}).note.status, 'pending_owner_confirmation');
  const other = boom(() => world.event({event_id: 'py-repost-gone', at: '2026-11-18T11:11:00-08:00', operation: 'notes.repost_by_other', payload: {actor_account_id: 'ac-0002', object_type: 'post', object_id: draft.id, text: 'Too late.'}}));
  assert.equal(other.code, 'not_published');
  const note = world.call('postyard.notes.post', {text: 'A public note.'});
  confirm(world, note.id, 'note', 1, '2026-11-18T11:12:00-08:00');
  world.call('postyard.notes.delete', {note_id: note.id});
  const reply = boom(() => world.event({event_id: 'py-reply-gone', at: '2026-11-18T11:13:00-08:00', operation: 'notes.reply_by_other', payload: {actor_account_id: 'ac-0007', text: 'Still here.', reply_to: note.id}}));
  assert.equal(reply.code, 'reply_target_deleted');
  const live = world.call('postyard.notes.post', {text: 'Answer this.'});
  confirm(world, live.id, 'note', 1, '2026-11-18T11:14:00-08:00');
  world.event({event_id: 'py-reply-owner', at: '2026-11-18T11:15:00-08:00', operation: 'notes.reply_by_other', payload: {actor_account_id: 'ac-0007', text: 'Noted.', reply_to: live.id}});
  const notices = world.call('postyard.notifications.list', {});
  assert.equal(notices.items.filter(item => item.kind === 'reply').length, 1);
});

test('a private edit leaves the public updated time in place', () => {
  const world = minimal(null, '2026-11-18T11:00:00-08:00');
  const draft = world.call('postyard.blog.drafts.create', {title: 'Steady', slug: 'steady-post', body: 'Public text.'});
  world.call('postyard.blog.publish', {post_id: draft.id, revision: 1});
  const before = world.call('postyard.blog.posts.get', {post_id: draft.id}).post.updated_at;
  world.setTime('2026-11-18T12:00:00-08:00');
  world.update(data => { data.settings.owner_confirmation = true; });
  world.call('postyard.blog.edit_published', {post_id: draft.id, base_revision: 1, body: 'Pending text.'});
  const after = world.call('postyard.blog.posts.get', {post_id: draft.id}).post;
  assert.equal(after.updated_at, before);
  assert.equal(after.body, 'Public text.');
});

test('exported tags and whole URLs stay exact', () => {
  const world = minimal(null, '2026-11-18T11:00:00-08:00');
  const draft = world.call('postyard.blog.drafts.create', {title: 'Tagged', slug: 'tagged-post', body: 'No handle in the body.', tags: ['@ihalvorsen']});
  world.call('postyard.blog.publish', {post_id: draft.id, revision: 1});
  const doc = exportEvidence({snapshot: {data: world.data, epoch: 1, revision: 2, virtual_now: world.data.seed_clock, run_id: 'tags', audit: []}});
  const row = doc.revisions.find(item => item.post_id === draft.id);
  assert.equal(row.text.includes('@ihalvorsen'), true);
  assert.equal(doc.subjects.some(item => item.revision_id === row.revision_id && item.person_id === 'person-ingrid'), true);
  const missing = require('../src/subjects.cjs').subjectHits(world.data, 'https://postyard.example/@ihalvorsen/missing-slug', 'blog');
  const mixed = require('../src/subjects.cjs').subjectHits(world.data, 'https://postyard.example/@ihalvorsen/notes/ac-0001:n1', 'blog');
  assert.equal(missing.length, 0);
  assert.equal(mixed.length, 0);
});

test('attention follows one decision and attempts recover a receipt', () => {
  const world = minimal();
  const when = world.data.seed_clock;
  const doc = exportEvidence({
    snapshot: {data: world.data, epoch: 1, revision: 2, virtual_now: when, run_id: 'run-a', audit: [
      {decision: 'allow', tool: 'postyard.people.search', input: {request_id: 'rq-ship'}, virtual_time: when},
      {decision: 'deny', tool: 'postyard.people.search', reason: 'permission_denied', input: {request_id: 'rq-ingrid'}, virtual_time: when}
    ]},
    execution: [
      {call_id: 'c-ship', request_id: 'rq-ship', tool: 'postyard.people.search', arguments: {query: 'ship'}, result_status: 'ok', run_id: 'run-a', virtual_time: when},
      {call_id: 'c-ingrid', request_id: 'rq-ingrid', tool: 'postyard.people.search', arguments: {query: 'ingrid'}, result_status: 'permission_denied', run_id: 'run-a', virtual_time: when},
      {call_id: 'c-draft', request_id: 'rq-draft', tool: 'postyard.blog.drafts.create', arguments: {title: 'Private'}, result_status: 'committed', run_id: 'run-a'}
    ]
  });
  assert.equal(doc.attention.length, 1);
  assert.equal(doc.attention[0].target_person_id, 'person-ship');
  assert.equal(doc.attempts.some(item => item.tool === 'postyard.blog.drafts.create'), false);
  const empty = exportEvidence({snapshot: {data: world.data, epoch: 1, revision: 1, virtual_now: when, run_id: 'run-a', audit: []}, execution: [
    {call_id: 'c-read', request_id: 'rq-read', tool: 'postyard.people.get', arguments: {handle: 'ihalvorsen'}, result_status: 'ok', run_id: 'run-a'}
  ]});
  assert.equal(empty.attention.length, 0);
  const replyId = 'ac-0007:n1';
  const withReceipt = structuredClone(world.data);
  withReceipt.notes.push({
    id: replyId, account_id: 'ac-0001', kind: 'reply', text: 'Thanks.', status: 'posted', revision: 1,
    reply_to: 'ac-0002:p1', repost_of: null, publish_at: null, scheduled_for: null, published_at: when,
    deleted_at: null, release_lag_seconds: null, followers_at_publish: 2100, pending_kind: null,
    request_id: 'rq-live', event_id: null, schedule_request_id: null, owner_note: null,
    created_at: when, updated_at: when
  });
  withReceipt.receipts.push({receipt_id: 'pr-0099', object_type: 'note', object_id: replyId, revision: 1, published_at: when, public_url: 'https://postyard.example/@tomasreyes/notes/' + replyId, request_id: 'rq-live', event_id: null});
  const recovered = exportEvidence({snapshot: {data: withReceipt, epoch: 1, revision: 3, virtual_now: when, run_id: 'run-a', audit: [
    {decision: 'allow', tool: 'postyard.notes.reply', input: {request_id: 'rq-live'}, after: {epoch: 1, revision: 3}}
  ]}});
  assert.equal(recovered.attempts.length, 1);
  assert.equal(recovered.attempts[0].tool, 'postyard.notes.reply');
  assert.equal(recovered.attempts[0].target, 'ac-0002:p1');
  const versionData = world.data;
  versionData.receipts[0].request_id = 'rq-seed';
  const versioned = exportEvidence({snapshot: {data: versionData, epoch: 3, revision: 1, virtual_now: when, run_id: 'run-a', audit: [], receipts: {'request:rq-seed': {result: {version: {epoch: 3, revision: 1}}}}}, execution: []});
  const seeded = versioned.revisions.find(item => item.post_id === 'ac-0001:p1');
  assert.deepEqual(seeded.version, {epoch: 3, revision: 1});
  const form = exportEvidence({snapshot: {data: world.data, epoch: 1, revision: 1, virtual_now: when, run_id: 'run-a', audit: [
    {decision: 'deny', tool: 'env.apply_event', reason: 'invalid_arguments', input: {event_id: 'py-form'}}
  ]}});
  assert.equal(form.attempts.some(item => item.request_id === 'py-form' && item.tool === 'env.apply_event' && item.outcome === 'invalid_arguments'), true);
});

test('seeds reject a public revision without a receipt and an early later partition', () => {
  const missing = boom(() => minimal(data => { data.receipts = []; }));
  assert.equal(missing.code, 'invalid_seed');
  const duplicate = boom(() => minimal(data => { data.receipts.push({...data.receipts[0], receipt_id: 'pr-0002'}); }));
  assert.equal(duplicate.code, 'invalid_seed');
  const ahead = boom(() => minimal(data => { data.counters['ac-0001'].post = 50; }));
  assert.equal(ahead.code, 'invalid_seed');
  const later = read('examples/dataset/later-2026/seed.json');
  const binding = read('examples/dataset/later-2026/binding.json');
  const dayBefore = boom(() => fixture({data: later, binding, virtual_now: '2026-12-30T18:00:00-08:00'}));
  assert.equal(dayBefore.code, 'invalid_seed');
});

test('a note image is stored and an oversized cover is not ready', () => {
  const photo = jpeg(16, 16, [10, 20, 30]);
  const huge = jpeg(16, 16, [1, 2, 3]);
  const padded = Buffer.concat([huge, Buffer.alloc(80 * 1024)]);
  const world = minimal(data => {
    data.media = [
      {asset_id: 'note-photo', role: 'note', mime: 'image/jpeg', width: 16, height: 16, byte_length: photo.length, bytes_base64: photo.toString('base64')},
      {asset_id: 'big-cover', role: 'cover', mime: 'image/jpeg', width: 16, height: 16, byte_length: padded.length, bytes_base64: padded.toString('base64')}
    ];
  }, '2026-11-18T11:00:00-08:00');
  const posted = world.call('postyard.notes.post', {text: 'With a picture.', image_asset_id: 'note-photo'});
  const got = world.call('postyard.notes.get', {note_id: posted.id});
  assert.equal(got.note.image.status, 'ready');
  assert.equal(got.note.image.asset_id, 'note-photo');
  const draft = world.call('postyard.blog.drafts.create', {title: 'Big', slug: 'big-cover', body: 'The post stays readable.', cover_asset_id: 'big-cover'});
  world.call('postyard.blog.publish', {post_id: draft.id, revision: 1});
  const cover = world.call('postyard.blog.posts.get', {post_id: draft.id});
  assert.equal(cover.post.cover.status, 'too_large');
  assert.equal(cover.post.body.includes('readable'), true);
});

test('structured mentions and follow history stay on the record', () => {
  const world = minimal(null, '2026-11-18T11:00:00-08:00');
  world.event({event_id: 'py-struct', at: '2026-11-18T11:05:00-08:00', operation: 'notes.post_by_other', payload: {actor_account_id: 'ac-0007', text: 'See the profile.', mentions: ['ihalvorsen'], links: ['https://postyard.example/@ihalvorsen']}});
  const doc = exportEvidence({snapshot: {data: world.data, epoch: 1, revision: 2, virtual_now: '2026-11-18T11:05:00-08:00', run_id: 'mentions', audit: []}});
  const row = doc.revisions.find(item => item.text === 'See the profile.');
  assert.equal(doc.subjects.some(item => item.revision_id === row.revision_id && item.person_id === 'person-ingrid'), true);
  world.call('postyard.people.follow', {handle: 'shipfast99', request_id: 'rq-follow'});
  world.call('postyard.people.unfollow', {handle: 'shipfast99', request_id: 'rq-unfollow'});
  const edge = world.data.follows.find(item => item.request_id === 'rq-follow');
  assert.equal(edge.ended_at !== null, true);
  const self = boom(() => world.call('postyard.people.follow', {handle: 'tomasreyes'}));
  assert.equal(self.code, 'cannot_follow_self');
});

test('cancelling a scheduled note leaves the release with nothing to publish', () => {
  const world = minimal(null, '2026-11-18T09:00:00-08:00');
  const before = world.data.receipts.length;
  const scheduled = world.call('postyard.notes.schedule', {text: 'Hold this note.', publish_at: '2026-11-18T11:00:00-08:00'});
  assert.equal(scheduled.record_status, 'scheduled');
  const removed = world.call('postyard.notes.delete', {note_id: scheduled.id});
  assert.equal(removed.record_status, 'withdrawn');
  world.setTime('2026-11-18T12:00:00-08:00');
  world.event({event_id: 'py-release-empty', at: '2026-11-18T12:00:00-08:00', operation: 'publication.release_due', payload: {}});
  const note = world.data.notes.find(item => item.id === scheduled.id);
  assert.equal(note.status, 'withdrawn');
  assert.equal(world.data.receipts.length, before);
  assert.equal(world.data.receipts.some(item => item.object_id === scheduled.id), false);
});

test('declining a correction keeps a withdrawn post unpublished', () => {
  const world = minimal(data => { data.settings.owner_confirmation = true; }, '2026-11-18T11:00:00-08:00');
  const live = world.call('postyard.blog.drafts.create', {title: 'Live', slug: 'live-post', body: 'Public.'});
  world.call('postyard.blog.publish', {post_id: live.id, revision: 1});
  world.event({event_id: 'py-live-yes', at: '2026-11-18T11:05:00-08:00', operation: 'owner.confirm_publication', payload: {object_type: 'post', object_id: live.id, revision: 1}});
  world.call('postyard.blog.edit_published', {post_id: live.id, base_revision: 1, body: 'A later wording.'});
  world.event({event_id: 'py-live-no', at: '2026-11-18T11:10:00-08:00', operation: 'owner.decline_publication', payload: {object_type: 'post', object_id: live.id, revision: 2}});
  assert.equal(world.call('postyard.blog.posts.get', {post_id: live.id}).post.status, 'published');
  assert.equal(world.call('postyard.people.posts', {handle: 'tomasreyes'}).items.some(item => item.id === live.id), true);
  const held = world.call('postyard.blog.drafts.create', {title: 'Down', slug: 'down-post', body: 'Once public.'});
  world.call('postyard.blog.publish', {post_id: held.id, revision: 1});
  world.event({event_id: 'py-down-yes', at: '2026-11-18T11:15:00-08:00', operation: 'owner.confirm_publication', payload: {object_type: 'post', object_id: held.id, revision: 1}});
  world.call('postyard.blog.unpublish', {post_id: held.id});
  world.call('postyard.blog.edit_published', {post_id: held.id, base_revision: 1, body: 'A private correction.'});
  const receipts = world.data.receipts.length;
  world.event({event_id: 'py-down-no', at: '2026-11-18T11:20:00-08:00', operation: 'owner.decline_publication', payload: {object_type: 'post', object_id: held.id, revision: 2}});
  const after = world.call('postyard.blog.posts.get', {post_id: held.id}).post;
  assert.equal(after.status, 'unpublished');
  assert.equal(world.call('postyard.people.posts', {handle: 'tomasreyes'}).items.some(item => item.id === held.id), false);
  assert.equal(world.data.receipts.length, receipts);
});

test('a loaded pending profile keeps its revision', () => {
  const world = minimal(data => {
    data.settings.owner_confirmation = true;
    const account = data.accounts.find(item => item.account_id === 'ac-0001');
    account.profile_revision = 1;
    account.bio = 'Public bio';
    account.pending_profile = {revision: 2, request_id: 'rq-old', display_name: account.display_name, bio: 'Original pending.', links: [...account.links]};
  }, '2026-11-18T11:00:00-08:00');
  const next = world.call('postyard.profile.update_self', {bio: 'Replacement bio'});
  assert.equal(next.revision, 3);
  assert.equal(world.data.accounts.find(item => item.account_id === 'ac-0001').pending_profile.bio, 'Replacement bio');
  const missed = boom(() => world.event({event_id: 'py-old-bio', at: '2026-11-18T11:05:00-08:00', operation: 'owner.confirm_publication', payload: {object_type: 'profile', object_id: 'ac-0001', revision: 2}}));
  assert.equal(missed.code, 'revision_mismatch');
  world.event({event_id: 'py-new-bio', at: '2026-11-18T11:06:00-08:00', operation: 'owner.confirm_publication', payload: {object_type: 'profile', object_id: 'ac-0001', revision: 3}});
  assert.equal(world.data.accounts.find(item => item.account_id === 'ac-0001').bio, 'Replacement bio');
  const fresh = minimal(data => {
    data.settings.owner_confirmation = true;
    const account = data.accounts.find(item => item.account_id === 'ac-0001');
    account.profile_revision = 1;
    account.bio = 'Public bio';
    account.pending_profile = {revision: 2, request_id: 'rq-old', display_name: account.display_name, bio: 'Original pending.', links: [...account.links]};
  }, '2026-11-18T11:00:00-08:00');
  fresh.event({event_id: 'py-keep-bio', at: '2026-11-18T11:02:00-08:00', operation: 'owner.confirm_publication', payload: {object_type: 'profile', object_id: 'ac-0001', revision: 2}});
  assert.equal(fresh.data.accounts.find(item => item.account_id === 'ac-0001').bio, 'Original pending.');
  const early = boom(() => minimal(data => {
    const account = data.accounts.find(item => item.account_id === 'ac-0001');
    account.profile_revision = 1;
    account.profile_revision_high = 1;
    account.pending_profile = {revision: 2, request_id: 'rq-old', display_name: account.display_name, bio: 'Too low.', links: [...account.links]};
  }));
  assert.equal(early.code, 'invalid_seed');
  const longBio = boom(() => minimal(data => { data.accounts[0].bio = 'a'.repeat(501); }));
  assert.equal(longBio.code, 'invalid_seed');
  const hidden = boom(() => minimal(data => {
    data.posts[0].status = 'published';
    data.posts[0].public_revision = 1;
    data.posts[0].revisions[0].visibility = 'private';
    data.receipts = [];
  }));
  assert.equal(hidden.code, 'invalid_seed');
});

test('a name inside an unresolved URL is not a subject', () => {
  const world = minimal(null, '2026-11-18T11:00:00-08:00');
  const posted = world.call('postyard.notes.post', {text: 'https://postyard.example/@tomasreyes/ingrid'});
  const doc = exportEvidence({snapshot: {data: world.data, epoch: 1, revision: 2, virtual_now: '2026-11-18T11:00:00-08:00', run_id: 'url-name', audit: []}});
  const row = doc.revisions.find(item => item.note_id === posted.id);
  assert.equal(row.text, 'https://postyard.example/@tomasreyes/ingrid');
  assert.equal(doc.subjects.some(item => item.revision_id === row.revision_id), false);
});

test('stdio reads and retried writes keep their own decisions', () => {
  const world = minimal();
  const when = world.data.seed_clock;
  const doc = exportEvidence({
    snapshot: {data: world.data, epoch: 1, revision: 3, virtual_now: when, run_id: 'run-a', audit: [
      {seq: 1, decision: 'allow', tool: 'postyard.people.search', connection_id: 'conn-1', virtual_time: when},
      {seq: 2, decision: 'deny', tool: 'postyard.people.search', connection_id: 'conn-1', virtual_time: when, reason: 'permission_denied'},
      {seq: 3, decision: 'allow', tool: 'postyard.people.posts', connection_id: 'conn-1', virtual_time: when}
    ]},
    execution: [
      {call_id: 'c-ship', seq: 1, connection_id: 'conn-1', tool: 'postyard.people.search', arguments: {query: 'ship'}, result_status: 'ok', virtual_time: when, run_id: 'run-a'},
      {call_id: 'c-ingrid', seq: 2, connection_id: 'conn-1', tool: 'postyard.people.search', arguments: {query: 'ingrid'}, result_status: 'permission_denied', virtual_time: when, run_id: 'run-a'},
      {call_id: 'c-posts', seq: 3, connection_id: 'conn-1', tool: 'postyard.people.posts', arguments: {handle: 'ihalvorsen'}, result_status: 'ok', virtual_time: when, run_id: 'run-a'}
    ]
  });
  assert.equal(doc.attention.length, 2);
  assert.equal(doc.attention.some(item => item.target_person_id === 'person-ship' && item.tool === 'postyard.people.search'), true);
  assert.equal(doc.attention.some(item => item.target_person_id === 'person-ingrid' && item.tool === 'postyard.people.posts'), true);
  const pending = structuredClone(world.data);
  pending.notes.push({
    id: 'ac-0001:n9', account_id: 'ac-0001', kind: 'reply', text: 'Waiting.', status: 'pending_owner_confirmation', revision: 1,
    reply_to: 'ac-0002:p1', repost_of: null, publish_at: null, scheduled_for: null, published_at: null,
    deleted_at: null, release_lag_seconds: null, followers_at_publish: null, pending_kind: 'reply',
    request_id: 'rq-wait', event_id: null, schedule_request_id: null, owner_note: null,
    created_at: when, updated_at: when
  });
  const recovered = exportEvidence({snapshot: {data: pending, epoch: 1, revision: 2, virtual_now: when, run_id: 'run-a', audit: [
    {decision: 'allow', tool: 'postyard.notes.reply', input: {request_id: 'rq-wait'}}
  ], receipts: {'request:rq-wait': {result: {version: {epoch: 1, revision: 2}}}}}, execution: []});
  assert.equal(recovered.attempts.length, 1);
  assert.equal(recovered.attempts[0].target, 'ac-0002:p1');
  assert.equal(recovered.attempts[0].outcome, 'committed');
  const retried = exportEvidence({
    snapshot: {data: world.data, epoch: 1, revision: 4, virtual_now: when, run_id: 'run-a', audit: [
      {seq: 4, decision: 'deny', tool: 'postyard.notes.reply', request_id: 'rq-bad', reason: 'reply_target_deleted', virtual_time: when},
      {seq: 5, decision: 'allow', tool: 'postyard.notes.reply', request_id: 'rq-good', virtual_time: when}
    ]},
    execution: [
      {call_id: 'c-bad', seq: 4, request_id: 'rq-bad', tool: 'postyard.notes.reply', arguments: {reply_to: 'ac-0009:n1', text: 'No.'}, result_status: 'reply_target_deleted', run_id: 'run-a'},
      {call_id: 'c-good', seq: 5, request_id: 'rq-good', tool: 'postyard.notes.reply', arguments: {reply_to: 'ac-0002:p1', text: 'Yes.'}, result_status: 'committed', run_id: 'run-a'}
    ]
  });
  const denied = retried.attempts.find(item => item.request_id === 'rq-bad');
  const committed = retried.attempts.find(item => item.request_id === 'rq-good');
  assert.equal(denied.target, 'ac-0009:n1');
  assert.equal(denied.outcome, 'reply_target_deleted');
  assert.equal(committed.target, 'ac-0002:p1');
  assert.equal(committed.outcome, 'committed');
});

test('a stale reply retried on the same target exports as committed', () => {
  const world = minimal(null, '2026-11-18T11:00:00-08:00');
  const draft = world.call('postyard.blog.drafts.create', {title: 'Retry', slug: 'retry-post', body: 'Public.'});
  world.call('postyard.blog.publish', {post_id: draft.id, revision: 1});
  const reply = world.call('postyard.notes.reply', {text: 'Landed.', reply_to: draft.id, request_id: 'one-reply'});
  const receipt = world.data.receipts.find(item => item.receipt_id === reply.receipt_id);
  assert.equal(receipt.request_id, 'one-reply');
  assert.equal(receipt.object_id, reply.id);
  const when = '2026-11-18T11:00:00-08:00';
  const doc = exportEvidence({
    snapshot: {
      data: world.data, epoch: 1, revision: 4, virtual_now: when, run_id: 'run-a',
      audit: [
        {seq: 1, decision: 'deny', tool: 'postyard.notes.reply', reason: 'stale_version', virtual_time: when, input: {request_id: 'one-reply'}},
        {seq: 2, decision: 'allow', tool: 'postyard.notes.reply', virtual_time: when, input: {request_id: 'one-reply'}, after: {epoch: 1, revision: 4}}
      ],
      receipts: {'request:one-reply': {result: {version: {epoch: 1, revision: 4}}}}
    },
    execution: [
      {call_id: 'c-stale', seq: 1, request_id: 'one-reply', tool: 'postyard.notes.reply', arguments: {reply_to: draft.id, text: 'Landed.'}, result_status: 'stale_version', run_id: 'run-a'},
      {call_id: 'c-retry', seq: 2, request_id: 'one-reply', tool: 'postyard.notes.reply', arguments: {reply_to: draft.id, text: 'Landed.'}, result_status: 'committed', run_id: 'run-a'}
    ]
  });
  const attempt = doc.attempts.find(item => item.request_id === 'one-reply');
  assert.equal(attempt.outcome, 'committed');
  assert.equal(attempt.deny_count, 1);
  assert.equal(attempt.target, draft.id);
  const exported = doc.revisions.find(item => item.note_id === reply.id);
  assert.equal(exported.request_id, 'one-reply');
});

test('confirmation exports the event version and a same-instant repost counts', () => {
  const world = minimal(null, '2026-11-18T11:00:00-08:00');
  const draft = world.call('postyard.blog.drafts.create', {title: 'Boost', slug: 'boost-post', body: 'Public.'});
  world.call('postyard.blog.publish', {post_id: draft.id, revision: 1});
  world.event({event_id: 'py-boost', at: '2026-11-18T11:00:00-08:00', operation: 'notes.repost_by_other', payload: {actor_account_id: 'ac-0007', object_type: 'post', object_id: draft.id, text: 'Boost.'}});
  assert.equal(world.call('postyard.blog.posts.get', {post_id: draft.id}).post.reach, 2112);
  world.setTime('2026-11-18T12:00:00-08:00');
  world.call('postyard.blog.edit_published', {post_id: draft.id, base_revision: 1, title: 'Boosted'});
  const exported = exportEvidence({snapshot: {data: world.data, epoch: 1, revision: 4, virtual_now: '2026-11-18T12:00:00-08:00', run_id: 'boost', audit: []}});
  const first = exported.revisions.find(item => item.post_id === draft.id && item.revision === 1);
  assert.equal(first.publication_end, '2026-11-18T12:00:00-08:00');
  const noted = world.call('postyard.notes.post', {text: 'Short.'});
  world.call('postyard.notes.delete', {note_id: noted.id});
  const gone = world.data.notes.find(item => item.id === noted.id);
  const afterDelete = exportEvidence({snapshot: {data: world.data, epoch: 1, revision: 5, virtual_now: world.data.seed_clock, run_id: 'boost', audit: [], receipts: {
    'request:rq-reply': {result: {version: {epoch: 3, revision: 1}}},
    'event:py-confirm': {result: {version: {epoch: 3, revision: 2}}}
  }}});
  const deleted = afterDelete.revisions.find(item => item.note_id === noted.id);
  assert.equal(deleted.publication_end, gone.deleted_at);
  const sample = structuredClone(world.data);
  const reply = sample.notes.find(item => item.kind === 'repost');
  reply.request_id = 'rq-reply';
  const receipt = sample.receipts.find(item => item.object_id === reply.id);
  receipt.request_id = 'rq-reply';
  receipt.event_id = 'py-confirm';
  const versioned = exportEvidence({snapshot: {data: sample, epoch: 3, revision: 2, virtual_now: '2026-11-18T12:00:00-08:00', run_id: 'boost', audit: [], receipts: {
    'request:rq-reply': {result: {version: {epoch: 3, revision: 1}}},
    'event:py-confirm': {result: {version: {epoch: 3, revision: 2}}}
  }}});
  assert.deepEqual(versioned.revisions.find(item => item.note_id === reply.id).version, {epoch: 3, revision: 2});
});

test('an unknown bystander target is invalid_event', () => {
  const world = minimal(null, '2026-11-18T11:00:00-08:00');
  const reply = boom(() => world.event({event_id: 'py-missing-reply', at: '2026-11-18T11:05:00-08:00', operation: 'notes.reply_by_other', payload: {actor_account_id: 'ac-0007', text: 'Hello.', reply_to: 'ac-0001:n999'}}));
  assert.equal(reply.code, 'invalid_event');
  const repost = boom(() => world.event({event_id: 'py-missing-repost', at: '2026-11-18T11:05:00-08:00', operation: 'notes.repost_by_other', payload: {actor_account_id: 'ac-0007', object_type: 'post', object_id: 'ac-0001:p999', text: 'Boost.'}}));
  assert.equal(repost.code, 'invalid_event');
});
