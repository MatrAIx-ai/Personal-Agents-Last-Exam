'use strict';
// Pure business rules. Nothing here writes; time effects are computed from
// stored due times and the supplied clock (ctx.virtual_now).
const {fail} = require('./domain-utils.cjs');
const {ms, HOUR, MINUTE} = require('./clock.cjs');

const OFFER_HOURS = 24;
const RECONFIRM_HOURS = 48;
const SWAP_HOURS = 48;
const PREVIEW_MINUTES = 15;
const DIGEST_DAYS = 7;

const ROLES = ['member', 'event_host', 'co_organizer', 'organizer'];
const rank = role => ROLES.indexOf(role);
// RSVPs that hold places, and RSVPs that are still open (notified on changes).
const HOLDING = new Set(['yes', 'needs_reconfirm', 'offered']);
const OPEN = new Set(['yes', 'needs_reconfirm', 'offered', 'waitlist']);
// Guests for the `event_guests` audience: a confirmed place, including one held for reconfirmation.
const GUEST = new Set(['yes', 'needs_reconfirm']);

const byId = (list, id, code = 'not_found', what = 'Record') => {
  const item = list.find(x => x.id === id);
  if (!item) fail(code, `${what} ${id} does not exist.`);
  return item;
};
const group = (data, id, code) => byId(data.groups, id, code, 'Group');
const member = (data, id, code) => byId(data.members, id, code, 'Member');
const event = (data, id, code) => byId(data.events, id, code, 'Event');
const post = (data, id, code) => byId(data.posts, id, code, 'Post');
const sheet = (data, id, code) => byId(data.sheets, id, code, 'Sheet');

function membership(data, groupId, memberId) {
  return data.memberships.find(x => x.group_id === groupId && x.member_id === memberId) || null;
}

function isMember(data, groupId, memberId) {
  const m = membership(data, groupId, memberId);
  return Boolean(m && m.state === 'member');
}

function roleOf(data, groupId, memberId) {
  const m = membership(data, groupId, memberId);
  return m && m.state === 'member' ? m.role : null;
}

function requireMember(data, groupId, memberId) {
  const m = membership(data, groupId, memberId);
  if (m && m.state === 'pending') fail('approval_pending', 'Your request to join this group is waiting for an organizer.');
  if (!m || m.state !== 'member') fail('not_member', 'Only group members can do this.');
  return m;
}

function requireRole(data, groupId, memberId, min) {
  const m = requireMember(data, groupId, memberId);
  if (rank(m.role) < rank(min)) fail('role_required', `This needs the ${min.replace('_', '-')} role or above.`);
  return m;
}

// Group hosts: organizers, co-organizers and event hosts.
const isGroupHost = role => role !== null && rank(role) >= rank('event_host');

function canManageEvent(data, e, memberId) {
  const role = roleOf(data, e.group_id, memberId);
  return role !== null && (rank(role) >= rank('co_organizer') || (rank(role) >= rank('event_host') && e.host_member_ids.includes(memberId)));
}

const places = r => 1 + r.guests + r.children;

function rsvpFor(data, eventId, memberId) {
  return data.rsvps.find(r => r.event_id === eventId && r.member_id === memberId) || null;
}

function taken(data, e) {
  return data.rsvps.filter(r => r.event_id === e.id && HOLDING.has(r.answer)).reduce((s, r) => s + places(r), 0);
}

function eventState(e, now) {
  if (e.state === 'cancelled') return 'cancelled';
  return now >= ms(e.end) ? 'past' : 'published';
}

function rsvpWindow(e, now) {
  const state = eventState(e, now);
  if (state !== 'published' || now >= ms(e.rsvp_close)) fail('rsvp_closed', `RSVPs for ${e.title} are closed.`);
  if (now < ms(e.rsvp_open)) fail('rsvp_not_open', `RSVPs for ${e.title} open at ${e.rsvp_open}.`);
}

function offerEnds(e, at) {
  return Math.min(at + OFFER_HOURS * HOUR, ms(e.rsvp_close));
}

function reconfirmEnds(e, at) {
  return Math.min(at + RECONFIRM_HOURS * HOUR, ms(e.start));
}

// Effective sheet lock: its lock time, or at once when the event is cancelled.
function sheetLocked(data, s, now) {
  const e = event(data, s.event_id);
  return now >= ms(s.lock_at) || eventState(e, now) === 'cancelled';
}

function swapEnds(s, at) {
  return Math.min(at + SWAP_HOURS * HOUR, ms(s.lock_at));
}

const previewEnds = at => at + PREVIEW_MINUTES * MINUTE;

// Post root (comments inherit their parent's audience and event).
function rootOf(data, p) {
  let x = p;
  for (let i = 0; x.parent_id && i < 20; i++) x = post(data, x.parent_id, 'invalid_seed');
  return x;
}

// The user's most recent RSVP in a group (by updated_at, then ID), used to pre-fill counts.
function latestRsvpInGroup(data, groupId, memberId) {
  const ids = new Set(data.events.filter(e => e.group_id === groupId).map(e => e.id));
  return data.rsvps.filter(r => r.member_id === memberId && ids.has(r.event_id))
    .sort((a, b) => ms(b.updated_at) - ms(a.updated_at) || b.id.localeCompare(a.id))[0] || null;
}

module.exports = {
  OFFER_HOURS, RECONFIRM_HOURS, SWAP_HOURS, PREVIEW_MINUTES, DIGEST_DAYS, ROLES, HOLDING, OPEN, GUEST,
  rank, byId, group, member, event, post, sheet, membership, isMember, roleOf, requireMember, requireRole,
  isGroupHost, canManageEvent, places, rsvpFor, taken, eventState, rsvpWindow, offerEnds, reconfirmEnds,
  sheetLocked, swapEnds, previewEnds, rootOf, latestRsvpInGroup,
};
