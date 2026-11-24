'use strict';
// Business transitions shared by tool writes, scenario events and settle.
// Every change appends a revision with the next commit sequence number (seq),
// which is what the visibility record replays.
const R = require('./rules.cjs');
const {ms, iso, label} = require('./clock.cjs');
const {notify, deliver, seq} = require('./notices.cjs');
const {nextId} = require('./ids.cjs');

function reviseMembership(data, m, at, state, role, reason) {
  m.state = state;
  m.role = role;
  m.revisions.push({seq: seq(data), at, state, role, reason});
}

function joinMembership(data, groupId, memberId, at, state, reason) {
  let m = R.membership(data, groupId, memberId);
  if (!m) {
    m = {id: nextId(data.memberships, 'ms'), group_id: groupId, member_id: memberId, state, role: 'member', created_at: at, revisions: []};
    data.memberships.push(m);
  }
  reviseMembership(data, m, at, state, 'member', reason);
  return m;
}

// Sets an RSVP's answer and counts, keeping its due times in step.
function setRsvp(data, r, at, {answer, guests = r.guests, children = r.children}, reason, extra = {}) {
  const e = R.event(data, r.event_id);
  const t = ms(at);
  if (answer === 'waitlist' && r.answer !== 'waitlist') r.waitlisted_at = at;
  if (answer !== 'waitlist' && answer !== 'offered') r.waitlisted_at = null;
  r.offer_expires_at = answer === 'offered' ? iso(R.offerEnds(e, t), groupOf(data, e).utc_offset) : null;
  r.reconfirm_by = answer === 'needs_reconfirm' ? iso(R.reconfirmEnds(e, t), groupOf(data, e).utc_offset) : null;
  Object.assign(r, {answer, guests, children, updated_at: at});
  r.revisions.push({seq: seq(data), at, answer, guests, children, reason, ...extra});
  return r;
}

function newRsvp(data, e, memberId, at) {
  const r = {id: nextId(data.rsvps, 'r'), event_id: e.id, member_id: memberId, answer: 'no', guests: 0, children: 0,
    created_at: at, updated_at: at, waitlisted_at: null, offer_expires_at: null, reconfirm_by: null, revisions: []};
  data.rsvps.push(r);
  return r;
}

const groupOf = (data, e) => R.group(data, e.group_id);

// Offers freed places, earliest waitlisted RSVP that fits first, while RSVPs are
// open. `at` is the instant the places were freed (a due time during settle).
function allocate(data, e, at) {
  const t = ms(at);
  if (R.eventState(e, t) !== 'published' || t >= ms(e.rsvp_close)) return;
  let free = e.capacity - R.taken(data, e);
  const waiting = data.rsvps.filter(r => r.event_id === e.id && r.answer === 'waitlist')
    .sort((a, b) => ms(a.waitlisted_at) - ms(b.waitlisted_at) || a.id.localeCompare(b.id));
  for (const r of waiting) {
    if (free <= 0) break;
    if (R.places(r) > free) continue;
    free -= R.places(r);
    setRsvp(data, r, at, {answer: 'offered'}, 'place_freed');
    offerNotice(data, e, r, at);
  }
}

function offerNotice(data, e, r, at) {
  const g = groupOf(data, e);
  deliver(data, {at, recipients: [r.member_id], object_type: 'rsvp', object_id: r.id, channel: 'email', reason: 'waitlist_offer'});
  if (r.member_id !== data.user_member_id) return;
  const end = ms(r.offer_expires_at), n = R.places(r);
  const who = n === 1 ? 'you' : `you and ${n - 1} ${n - 1 === 1 ? 'other' : 'others'}`;
  notify(data, {at, kind: 'waitlist_offer', object_type: 'rsvp', object_id: r.id,
    title: `A place opened for ${e.title}: claim by ${label(end, g).slice(5)}`,
    fields: [['Event', `${e.title} (${e.id})`], ['Group', g.name], ['Offer', `${n} ${n === 1 ? 'place' : 'places'} (${who}; guests ${r.guests}, children ${r.children})`],
      ['Claim by', label(end, g)], ['RSVP', `${r.id}, currently offered`],
      ['Note', 'After that time the offer passes to the next waitlisted member.']]});
}

// Ends a member's open RSVPs for future events in a group, releases their
// claims on unlocked sheets, and re-offers the freed places.
function releaseMember(data, groupId, memberId, at, reason) {
  const t = ms(at), touched = new Set(), released = {rsvps: [], claims: []};
  for (const r of data.rsvps) {
    const e = R.event(data, r.event_id);
    if (e.group_id !== groupId || r.member_id !== memberId || !R.OPEN.has(r.answer) || R.eventState(e, t) !== 'published') continue;
    const held = R.HOLDING.has(r.answer);
    setRsvp(data, r, at, {answer: 'no'}, reason);
    released.rsvps.push(r.id);
    if (held) touched.add(e);
  }
  for (const s of data.sheets) {
    const e = R.event(data, s.event_id);
    if (e.group_id !== groupId || R.sheetLocked(data, s, t)) continue;
    for (const slot of s.slots) {
      if (!slot.claims.includes(memberId)) continue;
      slot.claims = slot.claims.filter(x => x !== memberId);
      s.revisions.push({seq: seq(data), at, action: 'release', slot_id: slot.id, member_id: memberId, reason});
      released.claims.push(`${s.id}/${slot.id}`);
    }
    for (const w of data.swaps) {
      if (w.sheet_id === s.id && w.state === 'proposed' && (w.from_member_id === memberId || w.to_member_id === memberId)) {
        w.state = 'withdrawn';
        w.decided_at = at;
      }
    }
  }
  for (const e of touched) allocate(data, e, at);
  return released;
}

function guestRecipients(data, e) {
  return data.rsvps.filter(r => r.event_id === e.id && R.OPEN.has(r.answer)).map(r => r.member_id);
}

function groupRecipients(data, groupId) {
  return data.memberships.filter(m => m.group_id === groupId && m.state === 'member').map(m => m.member_id);
}

// Members told about a post when it is published: everyone in the group for
// `group`, the RSVP `yes` guests and event hosts for `event_guests`, group
// hosts for `hosts_only`. Comments use their root post's audience.
function postRecipients(data, p) {
  const root = R.rootOf(data, p);
  const audience = p.kind === 'announcement' ? 'group' : root.audience;
  const all = groupRecipients(data, p.group_id);
  let out;
  if (audience === 'group') out = all;
  else if (audience === 'hosts_only') out = all.filter(m => R.isGroupHost(R.roleOf(data, p.group_id, m)));
  else {
    const e = R.event(data, root.event_id);
    out = all.filter(m => e.host_member_ids.includes(m) || R.GUEST.has(R.rsvpFor(data, e.id, m)?.answer));
  }
  // A comment also reaches the author of its root post.
  if (p.parent_id && all.includes(root.author_member_id)) out = [...out, root.author_member_id];
  return [...new Set(out)].filter(m => m !== p.author_member_id).sort();
}

module.exports = {reviseMembership, joinMembership, setRsvp, newRsvp, allocate, offerNotice, releaseMember,
  guestRecipients, groupRecipients, postRecipients, groupOf};
