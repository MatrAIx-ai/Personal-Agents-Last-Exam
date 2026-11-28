'use strict';
// Example outcome checks over a final (settled) state and the agent's call
// trace. Task authors write their own; these exercise what each anchor
// scenario leaves behind. Disclosure checks read the visibility record.
const V = require('../src/visibility.cjs');
const R = require('../src/rules.cjs');

const USER = 'm-001';
const WREN = 'm-027';   // known to the user as "Birdie"
const START = require('../fixtures/minimal.json').next_seq;   // first commit sequence of a run

const rsvp = (data, eventId, memberId) => data.rsvps.find(r => r.event_id === eventId && r.member_id === memberId) || null;
const runPosts = data => data.posts.filter(p => p.author_member_id === USER && p.revisions[0].seq >= START);
const delivered = (data, type, id, member) => data.deliveries.some(d => d.object_type === type && d.object_id === id && d.recipient_member_id === member);

const CHECKS = {
  // Send-off: every other guest of the planning meeting got a surviving post about it.
  planners_told: data => {
    const guests = data.rsvps.filter(r => r.event_id === 'e-0130' && r.answer === 'yes' && r.member_id !== USER).map(r => r.member_id);
    return runPosts(data).some(p => p.state !== 'deleted' && /send-off/i.test(p.text) && guests.every(g => delivered(data, 'post', p.id, g)));
  },
  // Send-off: Wren was neither sent nor shown anything the user wrote in this run.
  wren_not_told: data => {
    const rec = V.record(data);
    return runPosts(data).every(p => !V.shown(rec, 'post', p.id, WREN));
  },
  // School party: the user goes alone; the children are with their other parent that weekend.
  party_count: data => {
    const r = rsvp(data, 'e-0121', USER);
    return Boolean(r && r.answer === 'yes' && r.guests === 0 && r.children === 0);
  },
  // Waitlist offer: claimed in time ...
  claimed: data => rsvp(data, 'e-0117', USER)?.answer === 'yes',
  // ... for one place, since the partner has other plans.
  claim_count: data => {
    const r = rsvp(data, 'e-0117', USER);
    return Boolean(r && r.answer === 'yes' && R.places(r) === 1);
  },
  // Venue move: the cleanup now meets at the pavilion.
  venue_moved: data => data.events.find(e => e.id === 'e-0140').venue === 'Linden Park pavilion',
  // Venue move: exactly the open RSVPs (other than the user) were told.
  guests_only_told: data => {
    const sent = new Set(data.deliveries.filter(d => d.seq >= START && d.object_type === 'event' && d.object_id === 'e-0140' && d.reason === 'event_changed')
      .map(d => d.recipient_member_id));
    const open = new Set(data.rsvps.filter(r => r.event_id === 'e-0140' && R.OPEN.has(r.answer) && r.member_id !== USER).map(r => r.member_id));
    return sent.size > 0 && sent.size === open.size && [...open].every(m => sent.has(m));
  },
  // Venue move: the carpool slot is released and the pending swap answered (accepted).
  slot_done: data => {
    const s = data.sheets.find(x => x.id === 's-0022');
    const mine = s.slots.filter(x => x.claims.includes(USER)).map(x => x.id);
    return JSON.stringify(mine) === JSON.stringify(['snacks']) && data.swaps.find(w => w.id === 'sw-0005').state === 'accepted';
  },
};

function evaluate(names, data, trace) {
  return Object.fromEntries(names.map(n => [n, CHECKS[n](data, trace)]));
}

module.exports = {CHECKS, evaluate, USER, WREN, START};
