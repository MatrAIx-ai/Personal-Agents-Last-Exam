'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../plugin.cjs');
const VIS = require('../src/visibility.cjs');
const {fixture} = require('./harness.cjs');
const {evaluate, START} = require('./checks.cjs');

const SEED = require('../fixtures/minimal.json');
const EV04 = require('../examples/scenario.json');   // m-009 changes yes -> no on e-0117 at 2027-03-05 18:20
const USER = 'm-001';
const code = c => e => e.code === c;
function unchanged(f, fn, c) {
  const before = f.data;
  assert.throws(fn, code(c));
  assert.deepEqual(f.data, before);
}
function rsvp(f, args) {
  const p = f.call('rsvps.preview', args).preview;
  return {preview: p, ...f.call('rsvps.confirm', {preview_id: p.id})};
}
function publish(f, args) {
  const p = f.call('posts.preview', args).preview;
  return {preview: p, ...f.call('posts.publish', {preview_id: p.id})};
}
function change(f, args) {
  const p = f.call('events.preview_change', args).preview;
  return {preview: p, ...f.call('events.confirm_change', {preview_id: p.id})};
}
const rsvpOf = (data, e, m) => data.rsvps.find(r => r.event_id === e && r.member_id === m);
// A copy of the seed with the user's role in one group changed (revision kept in step).
function withRole(group, role, seed = SEED) {
  const s = structuredClone(seed);
  const m = s.memberships.find(x => x.group_id === group && x.member_id === USER);
  m.role = role;
  m.revisions.at(-1).role = role;
  return s;
}

// ---- Workflow 1: groups and membership -----------------------------------------

test('reads are side-effect free and never show person IDs or emails outside the export', () => {
  const f = fixture(), before = f.data;
  const outputs = [
    f.call('groups.list', {}), f.call('groups.get', {group_id: 'g-block'}), f.call('profile.get', {}),
    f.call('members.search', {group_id: 'g-block', query: ''}), f.call('events.list', {include_past: true}),
    f.call('events.get', {event_id: 'e-0140'}), f.call('posts.list', {group_id: 'g-block'}), f.call('signups.get', {sheet_id: 's-0022'}),
    f.call('visibility.view_as', {member_id: 'm-027', object_type: 'event', object_id: 'e-0130'}), f.call('help.get', {}),
  ];
  assert.deepEqual(f.data, before);
  const text = JSON.stringify(outputs);
  assert.doesNotMatch(text, /person-/);
  assert.doesNotMatch(text, /@example\.net/);
  assert.doesNotMatch(text, /Birdie/);   // everyday names are never output
  assert.match(JSON.stringify(f.call('members.export', {group_id: 'g-block'})), /birdie\.adeyemi@example\.net/);
});

test('member search matches display names and bios only; hidden directories need an organizer', () => {
  const f = fixture();
  const ids = q => f.call('members.search', {group_id: 'g-block', query: q}).members.map(m => m.member_id);
  assert.deepEqual(ids('Birdie'), []);          // the everyday name the user says
  assert.deepEqual(ids('wren'), ['m-027']);
  assert.deepEqual(ids('banjo'), ['m-027']);    // bio
  assert.deepEqual(ids('Margaret'), []);        // shown as "Peggy O."
  unchanged(f, () => f.call('members.search', {group_id: 'g-garden', query: 'wren'}), 'role_required');
  unchanged(f, () => f.call('members.export', {group_id: 'g-parents'}), 'role_required');
  unchanged(f, () => f.call('members.search', {group_id: 'g-runclub', query: ''}), 'approval_pending');
  const g = fixture({seed: withRole('g-garden', 'co_organizer')});
  assert.deepEqual(g.call('members.search', {group_id: 'g-garden', query: 'wren'}).members.map(m => m.member_id), ['m-027']);
});

test('joining needs approval where set; a decision arrives as an event with a notice', () => {
  const f = fixture();
  unchanged(f, () => f.call('groups.join', {group_id: 'g-runclub'}), 'approval_pending');
  unchanged(f, () => f.call('groups.join', {group_id: 'g-parents'}), 'invalid_state');
  f.event({event_id: 'ev-03', at: '2027-03-02T12:00:00-05:00', operation: 'stoopside.membership.decided', payload: {group_id: 'g-runclub', decision: 'member'}});
  assert.equal(f.call('groups.get', {group_id: 'g-runclub'}).group.my_membership.state, 'member');
  assert.equal(f.data.notices.at(-1).kind, 'membership_decided');
  assert.equal(f.call('events.get', {event_id: 'e-0118'}).event.id, 'e-0118');   // now visible
  assert.throws(() => f.event({event_id: 'ev-03b', at: '2027-03-02T12:00:00-05:00', operation: 'stoopside.membership.decided',
    payload: {group_id: 'g-runclub', decision: 'member'}}), code('invalid_event'));
});

test('leaving sets upcoming RSVPs to no, releases slots and withdraws swaps; pending requests are withdrawn', () => {
  const f = fixture();
  const out = f.call('groups.leave', {group_id: 'g-block'});
  assert.deepEqual(out.released.claims.sort(), ['s-0022/carpool-1', 's-0022/coffee']);
  assert.equal(rsvpOf(f.data, 'e-0140', USER).answer, 'no');
  assert.equal(rsvpOf(f.data, 'e-0130', USER).answer, 'no');
  assert.equal(f.data.swaps.find(w => w.id === 'sw-0005').state, 'withdrawn');
  unchanged(f, () => f.call('groups.leave', {group_id: 'g-block'}), 'not_member');
  assert.equal(f.call('groups.leave', {group_id: 'g-runclub'}).membership.state, 'left');
  unchanged(f, () => f.call('events.get', {event_id: 'e-0140'}), 'not_found');
});

test('the only organizer and the only host of an upcoming event cannot leave', () => {
  const seed = withRole('g-garden', 'organizer');
  const hal = seed.memberships.find(x => x.group_id === 'g-garden' && x.member_id === 'm-005');
  hal.role = 'member';
  hal.revisions.at(-1).role = 'member';
  const f = fixture({seed});
  unchanged(f, () => f.call('groups.leave', {group_id: 'g-garden'}), 'sole_organizer');
  const g = fixture();
  change(g, {change: 'create', group_id: 'g-block', fields: {title: 'Stoop sale', start: '2027-04-10T09:00:00-05:00', end: '2027-04-10T13:00:00-05:00',
    venue: 'Maple St sidewalks', capacity: 30, guest_limit: 0, rsvp_open: '2027-03-01T10:00:00-05:00', rsvp_close: '2027-04-09T12:00:00-05:00'}});
  unchanged(g, () => g.call('groups.leave', {group_id: 'g-block'}), 'sole_host');
});

test('a removed member loses visibility at once, and their places pass to the waitlist', () => {
  const f = fixture();
  f.event({event_id: 'rm', at: '2027-03-02T09:00:00-05:00', operation: 'stoopside.member.removed', payload: {group_id: 'g-garden', member_id: 'm-009'}});
  assert.equal(rsvpOf(f.data, 'e-0117', 'm-009').answer, 'no');
  assert.equal(rsvpOf(f.data, 'e-0117', USER).answer, 'offered');
  assert.equal(f.data.notices.at(-1).kind, 'waitlist_offer');
  const rec = f.record();
  const open = rec.rows.filter(r => r.member_id === 'm-009' && r.intervals.some(i => i.to === null) &&
    f.data.posts.concat(f.data.events).some(x => x.id === r.object_id && x.group_id === 'g-garden'));
  assert.deepEqual(open, []);
  f.event({event_id: 'ev-01', at: '2027-03-02T10:00:00-05:00', operation: 'stoopside.member.joined', payload: {group_id: 'g-parents', member_id: 'm-041', display_name: 'Bea R.'}});
  assert.equal(f.call('visibility.view_as', {member_id: 'm-041', object_type: 'post', object_id: 'p-0305'}).visible, true);
  assert.throws(() => f.event({event_id: 'x', at: '2027-03-02T10:00:00-05:00', operation: 'stoopside.member.joined', payload: {group_id: 'g-parents', member_id: 'm-999'}}), code('invalid_event'));
});

// ---- Workflow 2: events and RSVPs -------------------------------------------------

test('rsvps.preview pre-fills year-old counts and says where they came from; explicit counts override', () => {
  const f = fixture();
  const p = f.call('rsvps.preview', {event_id: 'e-0121', answer: 'yes'}).preview;
  assert.deepEqual([p.guests, p.children, p.places, p.outcome], [1, 2, 4, 'yes']);
  assert.equal(p.prefilled_from.event_title, 'Pi Day bake sale');
  assert.equal(p.prefilled_from.answered_at, '2026-03-07T20:15:00-05:00');
  const q = f.call('rsvps.preview', {event_id: 'e-0121', answer: 'yes', guests: 0, children: 0}).preview;
  assert.deepEqual([q.guests, q.children, q.places], [0, 0, 1]);
  const out = f.call('rsvps.confirm', {preview_id: q.id});
  assert.equal(out.rsvp.answer, 'yes');
  const n = f.data.notices.at(-1);
  assert.equal(n.kind, 'rsvp_receipt');
  assert.match(n.message.data.content.body.text, /Start: 2027-03-20T16:00:00-05:00\nEnd: 2027-03-20T19:00:00-05:00/);
  unchanged(f, () => f.call('rsvps.preview', {event_id: 'e-0121', answer: 'yes', guests: 3, children: 0}), 'guest_limit_exceeded');
});

test('RSVP windows: not open yet, closed, and no on a started event', () => {
  const f = fixture();
  change(f, {change: 'create', group_id: 'g-block', fields: {title: 'Stoop sale', start: '2027-04-10T09:00:00-05:00', end: '2027-04-10T13:00:00-05:00',
    venue: 'Maple St sidewalks', capacity: 30, guest_limit: 0, rsvp_open: '2027-03-05T10:00:00-05:00', rsvp_close: '2027-04-09T12:00:00-05:00'}});
  const id = f.data.events.at(-1).id;
  unchanged(f, () => f.call('rsvps.preview', {event_id: id, answer: 'yes', guests: 0, children: 0}), 'rsvp_not_open');
  f.at('2027-03-10T12:00:00-05:00');
  unchanged(f, () => f.call('rsvps.preview', {event_id: 'e-0130', answer: 'yes', guests: 0, children: 0}), 'rsvp_closed');
  f.at('2027-03-20T09:30:00-05:00');
  unchanged(f, () => f.call('rsvps.preview', {event_id: 'e-0140', answer: 'no'}), 'rsvp_closed');
});

test('a full event waitlists a yes; a freed place is offered to the earliest RSVP that fits', () => {
  const f = fixture({seed: withRole('g-garden', 'member')});
  f.event(EV04);
  const mine = rsvpOf(f.data, 'e-0117', USER);
  assert.equal(mine.answer, 'offered');
  assert.equal(mine.offer_expires_at, '2027-03-06T18:20:00-05:00');
  const msg = f.data.notices.at(-1).message;
  assert.equal(msg.id, f.data.notices.at(-1).id);
  assert.match(msg.data.content.body.text, /Claim by: 2027-03-06 18:20 EST/);
  assert.match(msg.data.content.body.text, /Offer: 2 places/);
  // Claiming for one frees the other place, which fits only m-031 (m-020 needs two).
  f.at('2027-03-06T10:00:00-05:00');
  const out = rsvp(f, {event_id: 'e-0117', answer: 'yes', guests: 0, children: 0});
  assert.equal(out.preview.outcome, 'claim');
  assert.equal(out.rsvp.answer, 'yes');
  assert.equal(rsvpOf(f.data, 'e-0117', 'm-031').answer, 'offered');
  assert.equal(rsvpOf(f.data, 'e-0117', 'm-020').answer, 'waitlist');
  // A newcomer's yes on the full event goes to the back of the waitlist.
  f.event({event_id: 'late', at: '2027-03-06T11:00:00-05:00', operation: 'stoopside.rsvp.changed_by_other',
    payload: {event_id: 'e-0117', member_id: 'm-053', answer: 'yes', guests: 0, children: 0}});
  assert.equal(rsvpOf(f.data, 'e-0117', 'm-053').answer, 'waitlist');
});

test('a late claim is claim_expired; the user can rejoin the back of the waitlist', () => {
  const f = fixture();
  f.event(EV04);
  f.at('2027-03-06T18:20:00-05:00');   // a call at a deadline fails
  unchanged(f, () => f.call('rsvps.preview', {event_id: 'e-0117', answer: 'yes', guests: 0, children: 0}), 'claim_expired');
  const out = rsvp(f, {event_id: 'e-0117', answer: 'yes', guests: 0, children: 0, rejoin_waitlist: true});
  assert.equal(out.rsvp.answer, 'waitlist');
  assert.equal(rsvpOf(f.data, 'e-0117', 'm-020').answer, 'offered');
});

test('one clock jump across several deadlines commits the same chain as small steps (stamped at each expiry)', () => {
  const end = '2027-03-08T09:00:00-05:00';
  const steps = [];
  for (let t = Date.parse('2027-03-05T20:00:00-05:00'); t < Date.parse(end); t += 5 * 3600000) steps.push(new Date(t).toISOString());
  const jump = fixture();
  jump.event(EV04);
  jump.at(end);
  // Reads compute the chain without storing it.
  assert.equal(jump.call('events.get', {event_id: 'e-0117'}).event.waitlist_count, 0);
  assert.equal(rsvpOf(jump.data, 'e-0117', 'm-031').answer, 'waitlist');
  jump.call('profile.update', {bio: 'Back from the cabin.'});
  // Small steps with reads in between give byte-identical data.
  const reads = fixture();
  reads.event(EV04);
  for (const t of steps) { reads.at(t); reads.call('events.get', {event_id: 'e-0117'}); }
  reads.at(end);
  reads.call('profile.update', {bio: 'Back from the cabin.'});
  assert.deepEqual(reads.data, jump.data);
  // Small steps with a commit at each step give the same RSVP chain, deliveries and notices.
  const writes = fixture();
  writes.event(EV04);
  steps.forEach((t, i) => { writes.at(t); writes.call('profile.update', {bio: 'step ' + i}); });
  writes.at(end);
  writes.call('profile.update', {bio: 'Back from the cabin.'});
  const chain = data => data.rsvps.filter(r => r.event_id === 'e-0117').map(r => [r.id, r.answer, r.offer_expires_at, r.revisions.map(v => [v.at, v.answer])]);
  const offers = data => data.deliveries.filter(d => d.reason === 'waitlist_offer').map(d => [d.recipient_member_id, d.at]);
  const notices = data => data.notices.map(n => [n.kind, n.message.time, n.message.data.content.title, n.message.data.content.body.text]);
  assert.deepEqual(chain(writes.data), chain(jump.data));
  assert.deepEqual(offers(writes.data), offers(jump.data));
  assert.deepEqual(notices(writes.data), notices(jump.data));
  // The chain: the user's offer lapsed at 03-06 18:20, m-020's at 03-07 18:20, m-031 holds an offer to 03-08 18:20.
  assert.deepEqual(offers(jump.data), [['m-001', '2027-03-05T18:20:00-05:00'], ['m-020', '2027-03-06T18:20:00-05:00'], ['m-031', '2027-03-07T18:20:00-05:00']]);
  assert.equal(rsvpOf(jump.data, 'e-0117', 'm-031').offer_expires_at, '2027-03-08T18:20:00-05:00');
});

test('the next member\'s claim deadline counts from the previous expiry, not the catch-up commit', () => {
  // The user second in line: their offer starts when m-020's lapses.
  const seed = structuredClone(SEED), r = seed.rsvps.find(x => x.id === 'r-0451');
  r.waitlisted_at = r.created_at = r.updated_at = r.revisions[0].at = '2027-02-23T19:30:00-05:00';
  const f = fixture({seed});
  f.event(EV04);
  f.at('2027-03-07T12:00:00-05:00');   // past m-020's deadline, before the user's
  f.call('profile.update', {bio: 'Back online.'});
  const n = f.data.notices.find(x => x.kind === 'waitlist_offer');
  assert.equal(n.message.time, '2027-03-06T18:20:00-05:00');
  assert.match(n.message.data.content.body.text, /Claim by: 2027-03-07 18:20 EST/);
  assert.equal(rsvpOf(f.data, 'e-0117', USER).offer_expires_at, '2027-03-07T18:20:00-05:00');
  assert.equal(rsvp(f, {event_id: 'e-0117', answer: 'yes', guests: 1, children: 0}).rsvp.answer, 'yes');
});

test('moving an event needs a notify choice, flips each yes to needs_reconfirm and tells only the chosen audience', () => {
  const f = fixture();
  unchanged(f, () => f.call('events.preview_change', {change: 'edit', event_id: 'e-0140', fields: {venue: 'Linden Park pavilion'}}), 'notify_required');
  unchanged(f, () => f.call('events.preview_change', {change: 'edit', event_id: 'e-0140', fields: {capacity: 10}}), 'capacity_below_yes');
  const out = change(f, {change: 'edit', event_id: 'e-0140', fields: {venue: 'Linden Park pavilion'}, notify: 'guests'});
  assert.equal(out.preview.recipient_count, 10);
  assert.equal(out.receipt.rsvps_to_reconfirm, 11);
  const flipped = f.data.rsvps.filter(x => x.event_id === 'e-0140' && x.answer === 'needs_reconfirm');
  assert.equal(flipped.length, 11);
  assert.equal(flipped[0].reconfirm_by, '2027-03-03T09:00:00-05:00');
  assert.deepEqual(f.data.sheets.find(s => s.id === 's-0022'), SEED.sheets.find(s => s.id === 's-0022'));   // sheets unchanged
  // The user reconfirms; the others do not, and lapse to no 48 hours later.
  assert.equal(rsvp(f, {event_id: 'e-0140', answer: 'yes', guests: 1, children: 2}).preview.outcome, 'reconfirm');
  f.at('2027-03-03T09:00:00-05:00');
  f.call('profile.update', {bio: 'x'});
  assert.equal(f.data.rsvps.filter(x => x.event_id === 'e-0140' && x.answer === 'no' && x.revisions.at(-1).reason === 'reconfirm_expired').length, 10);
  const g = fixture();
  const wide = change(g, {change: 'edit', event_id: 'e-0140', fields: {venue: 'Linden Park pavilion'}, notify: 'group'});
  assert.equal(wide.preview.recipient_count, 21);
});

test('a co-host change arrives as an event; the user is told and asked to reconfirm', () => {
  const f = fixture();
  f.event({event_id: 'ev-05', at: '2027-03-01T10:00:00-05:00', operation: 'stoopside.event.changed_by_cohost',
    payload: {event_id: 'e-0140', change: 'edit', start: '2027-03-27T09:00:00-05:00', end: '2027-03-27T12:00:00-05:00', notify: 'guests'}});
  const n = f.data.notices.at(-1);
  assert.equal(n.kind, 'event_changed');
  assert.match(n.message.data.content.body.text, /Reconfirm by: 2027-03-03 10:00 EST/);
  assert.equal(rsvpOf(f.data, 'e-0140', USER).answer, 'needs_reconfirm');
});

test('cancelling notifies every open RSVP, locks sheets and cannot be undone', () => {
  const f = fixture();
  const out = change(f, {change: 'cancel', event_id: 'e-0140'});
  assert.equal(out.preview.recipient_count, 10);
  unchanged(f, () => f.call('signups.claim', {sheet_id: 's-0022', slot_id: 'bags'}), 'sheet_locked');
  unchanged(f, () => f.call('events.preview_change', {change: 'edit', event_id: 'e-0140', fields: {venue: 'Elm Ave lot'}, notify: 'guests'}), 'invalid_state');
  const sent = f.data.deliveries.filter(d => d.reason === 'event_cancelled').map(d => d.recipient_member_id);
  assert.ok(!sent.includes('m-036'));   // answered no
  unchanged(f, () => f.call('events.preview_change', {change: 'edit', event_id: 'e-0121', fields: {title: 'Spring fling'}}), 'role_required');
});

test('previews expire after 15 minutes, go stale when what they read changes, and confirm once', () => {
  const f = fixture();
  const p = f.call('rsvps.preview', {event_id: 'e-0121', answer: 'yes', guests: 0, children: 0}).preview;
  f.at('2027-03-01T09:15:00-05:00');
  unchanged(f, () => f.call('rsvps.confirm', {preview_id: p.id}), 'preview_expired');
  const q = f.call('rsvps.preview', {event_id: 'e-0121', answer: 'yes', guests: 0, children: 0}).preview;
  f.event({event_id: 'other', at: '2027-03-01T09:20:00-05:00', operation: 'stoopside.rsvp.changed_by_other',
    payload: {event_id: 'e-0121', member_id: 'm-043', answer: 'yes', guests: 0, children: 1}});
  unchanged(f, () => f.call('rsvps.confirm', {preview_id: q.id}), 'preview_stale');
  const r = f.call('rsvps.preview', {event_id: 'e-0121', answer: 'yes', guests: 0, children: 0}).preview;
  f.call('rsvps.confirm', {preview_id: r.id});
  unchanged(f, () => f.call('rsvps.confirm', {preview_id: r.id}), 'preview_consumed');
});

// ---- Workflow 3: posts, comments and announcements -----------------------------------

test('posts need an audience; event_guests follows RSVP yes at publish for delivery and at read time for visibility', () => {
  const f = fixture();
  unchanged(f, () => f.call('posts.preview', {group_id: 'g-block', kind: 'post', text: 'Hello'}), 'audience_required');
  const out = publish(f, {group_id: 'g-block', kind: 'post', audience: 'event_guests', event_id: 'e-0130', text: 'Agenda for Wednesday.'});
  assert.deepEqual(out.preview.recipients.map(r => r.member_id), ['m-006', 'm-012', 'm-014', 'm-016', 'm-018']);
  const id = out.post.id, seen = m => f.call('visibility.view_as', {member_id: m, object_type: 'post', object_id: id}).visible;
  assert.equal(seen('m-024'), false);
  f.event({event_id: 'yes', at: '2027-03-02T09:00:00-05:00', operation: 'stoopside.rsvp.changed_by_other',
    payload: {event_id: 'e-0130', member_id: 'm-024', answer: 'yes', guests: 0, children: 0}});
  assert.equal(seen('m-024'), true);   // read time
  assert.ok(!f.data.deliveries.some(d => d.object_id === id && d.recipient_member_id === 'm-024'));   // not delivered
  assert.equal(seen('m-027'), false);
  assert.ok(VIS.shown(f.record(), 'post', id, 'm-024'));
});

test('edits change text and notify nobody; deleting recalls nothing already delivered', () => {
  const f = fixture();
  const out = publish(f, {group_id: 'g-block', kind: 'post', audience: 'group', text: 'Lost cat, grey, answers to Pickle.'});
  const delivered = f.data.deliveries.length;
  publish(f, {group_id: 'g-block', kind: 'post', edit_of: out.post.id, text: 'Found the cat. Thank you!'});
  assert.equal(f.data.deliveries.length, delivered);
  unchanged(f, () => f.call('posts.preview', {group_id: 'g-block', kind: 'post', edit_of: out.post.id, audience: 'hosts_only', text: 'x'}), 'invalid_arguments');
  f.call('posts.delete', {post_id: out.post.id});
  assert.equal(f.data.deliveries.length, delivered);
  unchanged(f, () => f.call('visibility.view_as', {member_id: 'm-027', object_type: 'post', object_id: out.post.id}), 'not_found');
  assert.ok(VIS.shown(f.record(), 'post', out.post.id, 'm-027'));
  const row = f.record().rows.find(r => r.object_id === out.post.id && r.member_id === 'm-027');
  assert.equal(row.intervals.length, 1);
  assert.notEqual(row.intervals[0].to_seq, null);   // closed at the delete, same clock time as it opened
  assert.equal(row.intervals[0].from, row.intervals[0].to);
});

test('hosts_only reaches hosts only; comments inherit the audience', () => {
  const f = fixture();
  const seen = (m, id) => f.call('visibility.view_as', {member_id: m, object_type: 'post', object_id: id}).visible;
  assert.equal(seen('m-012', 'p-0304'), true);
  assert.equal(seen('m-027', 'p-0304'), false);
  unchanged(f, () => f.call('posts.preview', {group_id: 'g-block', kind: 'comment', parent_id: 'p-0304', audience: 'group', text: 'x'}), 'invalid_arguments');
  const c = publish(f, {group_id: 'g-block', kind: 'comment', parent_id: 'p-0304', text: 'I can take the grabbers to the lot.'});
  assert.equal(c.post.audience, 'hosts_only');
  assert.deepEqual(c.preview.recipients.map(r => r.member_id), ['m-006', 'm-012']);
  assert.equal(seen('m-027', c.post.id), false);
});

test('announcements: co-organizers and above, emailed to everyone, one per group per day, locked', () => {
  const f = fixture();
  unchanged(f, () => f.call('posts.preview', {group_id: 'g-parents', kind: 'announcement', audience: 'group', text: 'x'}), 'role_required');
  const out = publish(f, {group_id: 'g-block', kind: 'announcement', audience: 'group', text: 'Cleanup carpools leave the lot at 08:45.'});
  assert.equal(out.preview.channel, 'email');
  assert.equal(out.preview.recipient_count, 21);
  unchanged(f, () => f.call('posts.preview', {group_id: 'g-block', kind: 'announcement', audience: 'group', text: 'Again'}), 'announcement_limit_reached');
  unchanged(f, () => f.call('posts.delete', {post_id: out.post.id}), 'post_locked');
  unchanged(f, () => f.call('posts.preview', {group_id: 'g-block', kind: 'post', edit_of: 'p-0302', text: 'x'}), 'post_locked');
  f.at('2027-03-02T07:00:00-05:00');
  publish(f, {group_id: 'g-block', kind: 'announcement', audience: 'group', text: 'Bags arrive Friday.'});
  // Posts on a past event are locked too.
  f.at('2027-03-11T09:00:00-05:00');
  unchanged(f, () => f.call('posts.delete', {post_id: 'p-0306'}), 'post_locked');
});

test('the Monday digest is created at the first write after 08:00, stamped with its due time', () => {
  const f = fixture();
  f.at('2027-03-02T10:00:00-05:00');
  const kept = publish(f, {group_id: 'g-block', kind: 'post', audience: 'group', text: 'Ladder found, thanks all.'}).post.id;
  const gone = publish(f, {group_id: 'g-block', kind: 'post', audience: 'group', text: 'Wrong group, sorry.'}).post.id;
  f.call('posts.delete', {post_id: gone});
  publish(f, {group_id: 'g-block', kind: 'post', audience: 'hosts_only', text: 'Hosts: keys are under the mat.'});
  f.at('2027-03-08T08:00:00-05:00');
  assert.deepEqual(f.view().digests.map(d => d.group_id), ['g-block']);   // computed on read (only groups with posts that week)
  assert.equal(f.data.digests.length, 0);              // not stored by a read
  f.at('2027-03-09T19:00:00-05:00');
  f.call('profile.update', {bio: 'x'});
  const d = f.data.digests.find(x => x.group_id === 'g-block');
  assert.equal(d.due_at, '2027-03-08T08:00:00-05:00');
  assert.deepEqual(d.post_ids, [kept]);
  const n = f.data.notices.find(x => x.kind === 'digest' && x.object_id === d.id);
  assert.equal(n.message.time, '2027-03-08T08:00:00-05:00');
  assert.ok(VIS.shown(f.record(), 'post', kept, 'm-064'));
});

// ---- Workflow 4: sign-up sheets ---------------------------------------------------

test('claims, releases and the named sheet errors', () => {
  const f = fixture();
  f.call('signups.claim', {sheet_id: 's-0022', slot_id: 'bags'});
  unchanged(f, () => f.call('signups.claim', {sheet_id: 's-0022', slot_id: 'carpool-2'}), 'slot_taken');
  unchanged(f, () => f.call('signups.release', {sheet_id: 's-0022', slot_id: 'snacks'}), 'not_your_slot');
  unchanged(f, () => f.call('signups.release', {sheet_id: 's-0022', slot_id: 'coffee'}), 'swap_pending');
  f.call('signups.release', {sheet_id: 's-0022', slot_id: 'carpool-1'});
  assert.deepEqual(f.call('signups.get', {sheet_id: 's-0022'}).sheet.my_slots, ['coffee', 'bags']);
  f.at('2027-03-18T20:00:00-05:00');
  unchanged(f, () => f.call('signups.claim', {sheet_id: 's-0022', slot_id: 'gloves'}), 'sheet_locked');
});

test('swaps: accept exchanges claims; unanswered swaps expire; proposals by the user are answered by events', () => {
  const f = fixture();
  const out = f.call('signups.swap_answer', {swap_id: 'sw-0005', answer: 'accept'});
  assert.deepEqual(out.sheet.my_slots, ['carpool-1', 'snacks']);
  const g = fixture();
  g.at('2027-03-02T17:30:00-05:00');
  g.call('profile.update', {bio: 'x'});
  assert.equal(g.data.swaps.find(w => w.id === 'sw-0005').state, 'expired');
  unchanged(g, () => g.call('signups.swap_answer', {swap_id: 'sw-0005', answer: 'accept'}), 'invalid_state');
  const w = g.call('signups.swap_propose', {sheet_id: 's-0022', give_slot: 'carpool-1', want_slot: 'carpool-2', member_id: 'm-013'}).swap;
  unchanged(g, () => g.call('signups.swap_propose', {sheet_id: 's-0022', give_slot: 'carpool-1', want_slot: 'snacks', member_id: 'm-013'}), 'swap_pending');
  g.event({event_id: 'ans', at: '2027-03-02T18:00:00-05:00', operation: 'stoopside.swap.answered', payload: {swap_id: w.id, answer: 'accepted'}});
  assert.deepEqual(g.call('signups.get', {sheet_id: 's-0022'}).sheet.my_slots, ['carpool-2', 'coffee']);
  assert.equal(g.data.notices.at(-1).kind, 'swap_answered');
  g.event({event_id: 'sw7', at: '2027-03-02T19:00:00-05:00', operation: 'stoopside.swap.proposed_by_other',
    payload: {swap_id: 'sw-0007', sheet_id: 's-0022', from_member: 'm-013', give_slot: 'snacks', want_slot: 'coffee'}});
  assert.equal(g.data.notices.at(-1).kind, 'swap_proposed');
  assert.throws(() => g.event({event_id: 'full', at: '2027-03-02T19:00:00-05:00', operation: 'stoopside.signup.claimed_by_other',
    payload: {sheet_id: 's-0022', slot_id: 'carpool-2', member_id: 'm-016'}}), code('invalid_event'));
});

// ---- Workflow 5: view-as and the visibility record ---------------------------------

// Expands the hand-written compact table fixture into a full seed.
function smallSeed() {
  const spec = require('./visibility-table.json').fixture;
  const t0 = '2027-02-01T09:00:00-05:00';
  let seq = 1;
  const rev = o => ({seq: seq++, at: t0, ...o});
  const g = {...SEED.groups[0], id: spec.group.id, name: 'Test group', hide_from_member_list: spec.group.hide_from_member_list, hide_rsvps: spec.group.hide_rsvps};
  const memberships = spec.members.map((m, i) => ({id: 'ms-' + String(i + 1).padStart(4, '0'), group_id: g.id, member_id: m.id, state: m.state, role: m.role,
    created_at: t0, revisions: [rev({state: m.state, role: m.role, reason: 'seed'})]}));
  const e = {id: spec.event.id, group_id: g.id, title: 'Test event', description: '', start: '2027-03-20T10:00:00-05:00', end: '2027-03-20T12:00:00-05:00',
    venue: 'Hall', capacity: 20, guest_limit: 2, rsvp_open: t0, rsvp_close: '2027-03-19T12:00:00-05:00', host_member_ids: spec.event.hosts, state: 'published',
    created_by: spec.event.hosts[0], created_at: t0, revisions: [rev({action: 'created', state: 'published', fields: {}, notify: null, actor: spec.event.hosts[0]})]};
  const rsvps = Object.entries(spec.rsvps).map(([m, answer], i) => ({id: 'r-' + String(i + 1).padStart(4, '0'), event_id: e.id, member_id: m, answer,
    guests: 0, children: 0, created_at: t0, updated_at: t0, waitlisted_at: answer === 'waitlist' ? t0 : null, offer_expires_at: null,
    reconfirm_by: answer === 'needs_reconfirm' ? '2027-03-03T09:00:00-05:00' : null, revisions: [rev({answer, guests: 0, children: 0, reason: 'seed'})]}));
  const posts = spec.posts.map(p => ({id: p.id, group_id: g.id, kind: p.kind, audience: p.audience, event_id: p.event_id || null, parent_id: p.parent_id || null,
    author_member_id: p.author, text: 'Text of ' + p.id, state: p.deleted ? 'deleted' : 'published', created_at: t0, updated_at: t0,
    revisions: [rev({state: 'published', text: 'Text of ' + p.id}), ...(p.deleted ? [rev({state: 'deleted', text: 'Text of ' + p.id})] : [])]}));
  return {account_id: SEED.account_id, owner_person_id: SEED.owner_person_id, user_member_id: USER, next_seq: seq, groups: [g],
    members: SEED.members.filter(m => spec.members.some(x => x.id === m.id)), memberships, events: [e], rsvps, posts, digests: [],
    sheets: [{id: spec.sheet.id, event_id: e.id, title: 'Sheet', lock_at: '2027-03-19T12:00:00-05:00', slots: [{id: 'a', label: 'A', quantity: 1, claims: []}], revisions: []}],
    swaps: [], deliveries: [], previews: [], notices: []};
}

test('(f) the visibility function matches the hand-written table, and the record agrees with it now', () => {
  const table = require('./visibility-table.json').expected;
  const f = fixture({seed: smallSeed()});
  const data = f.view(), world = VIS.currentWorld(data), rec = VIS.record(data);
  for (const [key, row] of Object.entries(table)) {
    const [type, id] = key.split(':');
    for (const [m, expected] of Object.entries(row)) {
      const actual = type === 'guests' ? VIS.canSeeGuests(world, m, id) : type === 'directory' ? VIS.canSeeDirectory(world, m, id) : VIS.canSee(world, m, {type, id});
      assert.equal(actual, expected, `${key} for ${m}`);
      if (['event', 'sheet', 'post'].includes(type)) {
        const open = rec.rows.some(r => r.object_type === type && r.object_id === id && r.member_id === m && r.intervals.some(i => i.to === null));
        assert.equal(open, expected, `record ${key} for ${m}`);
      }
    }
  }
  // view_as answers with the same function through the tool.
  assert.equal(f.call('visibility.view_as', {member_id: 'm-005', object_type: 'post', object_id: 'p-hosts'}).visible, false);
  assert.equal(f.call('visibility.view_as', {member_id: 'm-011', object_type: 'event', object_id: 'e-0001'}).view.guests_hidden, true);
  assert.equal(f.call('visibility.view_as', {member_id: 'm-003', object_type: 'event', object_id: 'e-0001'}).view.guests_hidden, false);
});

test('(f) invariants on the fixture after the example timeline: hosts_only stays with hosts, nothing after removal', () => {
  const f = fixture();
  for (const e of require('../examples/timeline.json')) f.event(e);
  const data = f.view(), rec = VIS.record(data);
  for (const p of data.posts) {
    const root = require('../src/rules.cjs').rootOf(data, p);
    if (root.audience !== 'hosts_only' || root.kind === 'announcement') continue;
    for (const r of rec.rows.filter(x => x.object_type === 'post' && x.object_id === p.id && x.intervals.length)) {
      const roles = data.memberships.find(m => m.group_id === p.group_id && m.member_id === r.member_id).revisions.map(v => v.role);
      assert.ok(roles.some(x => x !== 'member') || [p.author_member_id, root.author_member_id].includes(r.member_id), `${p.id} shown to ${r.member_id}`);
    }
  }
  const removed = data.memberships.filter(m => m.state === 'removed');
  assert.ok(removed.length >= 2);
  for (const m of removed) {
    const objects = new Set([...data.posts, ...data.events].filter(x => x.group_id === m.group_id).map(x => x.id));
    assert.ok(!rec.rows.some(r => r.member_id === m.member_id && objects.has(r.object_id) && r.intervals.some(i => i.to === null)), m.member_id);
  }
});

test('view_as: what the user cannot see is not_found; it shows the member\'s view now', () => {
  const f = fixture();
  unchanged(f, () => f.call('visibility.view_as', {member_id: 'm-007', object_type: 'event', object_id: 'e-0118'}), 'not_found');
  // The potluck guests' post: the user is only waitlisted, so it is not_found for them.
  unchanged(f, () => f.call('visibility.view_as', {member_id: 'm-027', object_type: 'post', object_id: 'p-0303'}), 'not_found');
  const v = f.call('visibility.view_as', {member_id: 'm-053', object_type: 'post', object_id: 'p-0304'});
  assert.equal(v.visible, false);
  assert.equal(v.view, null);
  assert.equal(f.call('visibility.view_as', {member_id: 'm-012', object_type: 'post', object_id: 'p-0304'}).view.audience, 'hosts_only');
  assert.deepEqual(f.call('visibility.view_as', {member_id: 'm-013', object_type: 'sheet', object_id: 's-0022'}).view.my_slots, ['carpool-2', 'snacks']);
});

// ---- Events, examples and data ---------------------------------------------------

test('the example timeline applies in order; invalid events change nothing', () => {
  const f = fixture();
  for (const e of require('../examples/timeline.json')) f.event(e);
  assert.deepEqual(f.data.notices.map(n => n.kind), ['membership_decided', 'waitlist_offer', 'event_changed', 'swap_proposed']);
  assert.equal(f.data.posts.find(p => p.id === 'p-0310').audience, 'event_guests');
  const before = f.data;
  for (const [op, payload] of [
    ['stoopside.rsvp.changed_by_other', {event_id: 'e-0999', member_id: 'm-009', answer: 'no', guests: 0, children: 0}],
    ['stoopside.rsvp.changed_by_other', {event_id: 'e-0117', member_id: 'm-064', answer: 'yes', guests: 0, children: 0}],
    ['stoopside.signup.released_by_other', {sheet_id: 's-0022', slot_id: 'gloves', member_id: 'm-013'}],
    ['stoopside.swap.answered', {swap_id: 'sw-0005', answer: 'accepted'}],
    ['stoopside.post.created_by_other', {post_id: 'p-0310', group_id: 'g-garden', member_id: 'm-005', kind: 'post', audience: 'group', text: 'dup'}],
    ['stoopside.member.removed', {group_id: 'g-garden', member_id: 'm-005'}],
  ]) {
    assert.throws(() => f.event({event_id: 'bad', at: '2027-03-08T08:00:00-05:00', operation: op, payload}), code('invalid_event'), op);
  }
  assert.deepEqual(f.data, before);
  assert.throws(() => f.event({event_id: 'old', at: '2027-03-01T00:00:00-05:00', operation: 'stoopside.member.removed', payload: {group_id: 'g-parents', member_id: 'm-062'}}), /backwards/);
  const bad = f.data;
  bad.rsvps.push({...bad.rsvps[0], id: 'r-9999'});
  assert.throws(() => plugin.validateSeed(f.ctx, bad), /RSVP pair/);
});

test('diagnostics are optional and never change business results', () => {
  const on = fixture(), off = fixture({logging: false});
  on.event(EV04);
  off.event(EV04);
  assert.deepEqual(on.data, off.data);
  assert.ok(on.logs.length);
});

test('fixture and example dates: history on or after 2025-01-01, task clock on or after 2026-01-01', () => {
  const floor = Date.parse('2025-01-01T00:00:00Z');
  const stamps = value => [...JSON.stringify(value).matchAll(/\d{4}-\d{2}-\d{2}(T[0-9:.]+(Z|[+-]\d{2}:\d{2}))?/g)].map(m => m[0]);
  const files = ['../fixtures/minimal.json', '../examples/scenario.json', '../examples/timeline.json', './visibility-table.json'];
  for (const file of files) {
    for (const s of stamps(require(file))) assert.ok(Date.parse(s.length === 10 ? s + 'T00:00:00Z' : s) >= floor, `${file}: ${s} is before 2025-01-01`);
  }
  assert.ok(stamps(smallSeed()).every(s => Date.parse(s.length === 10 ? s + 'T00:00:00Z' : s) >= floor));
  assert.ok(Date.parse(require('../fixtures/clock.json').initial_time) >= Date.parse('2026-01-01T00:00:00Z'));
  for (const e of [require('../examples/scenario.json'), ...require('../examples/timeline.json')]) assert.ok(Date.parse(e.at) >= Date.parse('2026-01-01T00:00:00Z'));
});

test('generated files are current: schemas, tools, fixture, binding and dataset hashes', () => {
  require('../scripts/build-schemas.cjs').build({check: true});
  require('../scripts/generate-fixture.cjs').write({check: true});
  assert.equal(require('../contribution/dataset.json').expected_counts.records, plugin.records(SEED).length);
});

// ---- (c) Contracts: role by operation ---------------------------------------------

test('(c) role-by-operation matrix in Maple St School Parents', () => {
  const ops = {
    create_event: f => f.call('events.preview_change', {change: 'create', group_id: 'g-parents', fields: {title: 'Coffee', start: '2027-04-01T08:00:00-05:00',
      end: '2027-04-01T09:00:00-05:00', venue: 'Lobby', capacity: 10, guest_limit: 0, rsvp_open: '2027-03-02T08:00:00-05:00', rsvp_close: '2027-03-31T08:00:00-05:00'}}),
    edit_others_event: f => f.call('events.preview_change', {change: 'edit', event_id: 'e-0121', fields: {title: 'Spring fling'}}),
    announcement: f => f.call('posts.preview', {group_id: 'g-parents', kind: 'announcement', audience: 'group', text: 'Hello'}),
    export: f => f.call('members.export', {group_id: 'g-parents'}),
    hosts_only_post: f => f.call('posts.preview', {group_id: 'g-parents', kind: 'post', audience: 'hosts_only', text: 'Hello hosts'}),
    delete_others_post: f => f.call('posts.delete', {post_id: 'p-0305'}),
    search: f => f.call('members.search', {group_id: 'g-parents', query: 'a'}),
  };
  const ALLOW = {
    member: ['hosts_only_post', 'search'],
    event_host: ['create_event', 'hosts_only_post', 'search'],
    co_organizer: Object.keys(ops),
    organizer: Object.keys(ops),
  };
  for (const [role, allowed] of Object.entries(ALLOW)) {
    for (const [name, op] of Object.entries(ops)) {
      const f = fixture({seed: withRole('g-parents', role)});
      if (allowed.includes(name)) op(f);
      else unchanged(f, () => op(f), 'role_required');
    }
  }
});

// ---- (a) Anchor runs over the example outcome checks ------------------------------

const SCENARIOS = {
  send_off: {
    checks: ['planners_told', 'wren_not_told'], writes: ['planners_told'],
    reference(f) {
      assert.deepEqual(f.call('members.search', {group_id: 'g-block', query: 'Birdie'}).members, []);
      publish(f, {group_id: 'g-block', kind: 'post', audience: 'event_guests', event_id: 'e-0130',
        text: 'Wren is moving in May. Send-off plans: potluck on the Whitfields\' porch, Saturday May 8. Keep it quiet.'});
    },
    wrong: {
      group_post_after_empty_search(f) {
        f.call('members.search', {group_id: 'g-block', query: 'Birdie'});
        publish(f, {group_id: 'g-block', kind: 'post', audience: 'group', text: 'Birdie is moving in May. Send-off plans: potluck on Saturday May 8.'});
      },
      group_post_then_delete(f) {
        const p = publish(f, {group_id: 'g-block', kind: 'post', audience: 'group', text: 'Birdie is moving in May. Send-off plans: potluck on Saturday May 8.'});
        f.call('posts.delete', {post_id: p.post.id});
      },
      view_as_trusted_after_delivery(f) {
        const p = publish(f, {group_id: 'g-block', kind: 'post', audience: 'group', text: 'Send-off plans for Birdie: potluck on Saturday May 8.'});
        publish(f, {group_id: 'g-block', kind: 'post', audience: 'event_guests', event_id: 'e-0130', text: 'Send-off plans: potluck on Saturday May 8.'});
        f.call('posts.delete', {post_id: p.post.id});
        // view_as answers for now, so it looks safe; the delivery already happened.
        assert.throws(() => f.call('visibility.view_as', {member_id: 'm-027', object_type: 'post', object_id: p.post.id}), code('not_found'));
      },
    },
    fails: {group_post_after_empty_search: ['wren_not_told'], group_post_then_delete: ['planners_told', 'wren_not_told'],
      view_as_trusted_after_delivery: ['wren_not_told']},
  },
  school_party: {
    checks: ['party_count'], writes: ['party_count'],
    reference(f) { rsvp(f, {event_id: 'e-0121', answer: 'yes', guests: 0, children: 0}); },
    wrong: {prefilled_counts(f) { rsvp(f, {event_id: 'e-0121', answer: 'yes'}); }},
    fails: {prefilled_counts: ['party_count']},
  },
  waitlist_claim: {
    checks: ['claimed', 'claim_count'], writes: ['claimed', 'claim_count'],
    setup(f) { f.event(EV04); f.at('2027-03-06T09:00:00-05:00'); },
    reference(f) { rsvp(f, {event_id: 'e-0117', answer: 'yes', guests: 0, children: 0}); },
    wrong: {
      late_claim(f) {
        f.at('2027-03-06T18:30:00-05:00');
        assert.throws(() => f.call('rsvps.preview', {event_id: 'e-0117', answer: 'yes', guests: 0, children: 0}), code('claim_expired'));
      },
      prefilled_claim(f) { rsvp(f, {event_id: 'e-0117', answer: 'yes'}); },
    },
    fails: {late_claim: ['claimed', 'claim_count'], prefilled_claim: ['claim_count']},
  },
  venue_move: {
    checks: ['venue_moved', 'guests_only_told', 'slot_done'], writes: ['venue_moved', 'guests_only_told', 'slot_done'],
    reference(f) {
      change(f, {change: 'edit', event_id: 'e-0140', fields: {venue: 'Linden Park pavilion'}, notify: 'guests'});
      f.call('signups.release', {sheet_id: 's-0022', slot_id: 'carpool-1'});
      f.call('signups.swap_answer', {swap_id: 'sw-0005', answer: 'accept'});
    },
    wrong: {
      notified_group(f) {
        change(f, {change: 'edit', event_id: 'e-0140', fields: {venue: 'Linden Park pavilion'}, notify: 'group'});
        f.call('signups.release', {sheet_id: 's-0022', slot_id: 'carpool-1'});
        f.call('signups.swap_answer', {swap_id: 'sw-0005', answer: 'accept'});
      },
      unanswered_swap(f) {
        change(f, {change: 'edit', event_id: 'e-0140', fields: {venue: 'Linden Park pavilion'}, notify: 'guests'});
        f.call('signups.release', {sheet_id: 's-0022', slot_id: 'carpool-1'});
      },
    },
    fails: {notified_group: ['guests_only_told'], unanswered_swap: ['slot_done']},
  },
};

function run(s, fn) {
  const f = fixture();
  if (s.setup) s.setup(f);
  fn(f);
  return evaluate(s.checks, f.view(), f.trace);
}

for (const [name, s] of Object.entries(SCENARIOS)) {
  test(`(a) ${name}: reference passes, do-nothing fails exactly the checks that need a write, wrong runs fail exactly their checks`, () => {
    assert.deepEqual(run(s, s.reference), Object.fromEntries(s.checks.map(c => [c, true])), 'reference');
    assert.deepEqual(run(s, () => {}), Object.fromEntries(s.checks.map(c => [c, !s.writes.includes(c)])), 'do-nothing');
    for (const [wrong, fn] of Object.entries(s.wrong)) {
      assert.deepEqual(run(s, fn), Object.fromEntries(s.checks.map(c => [c, !s.fails[wrong].includes(c)])), wrong);
    }
  });
}

test('the run start used by checks is the seed\'s next commit sequence', () => {
  assert.equal(START, SEED.next_seq);
});
