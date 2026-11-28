'use strict';
// Read models. Each function takes settled data and an instant and returns
// plain copies. No view carries a person_id, an everyday name or (outside
// members.export) an email address.
const R = require('./rules.cjs');
const V = require('./visibility.cjs');
const {ms} = require('./clock.cjs');

const name = (data, id) => R.member(data, id).display_name;
const who = (data, id) => ({member_id: id, display_name: name(data, id)});

function myMembership(data, g, user) {
  const m = R.membership(data, g.id, user);
  return m ? {state: m.state, role: m.state === 'member' ? m.role : null} : null;
}

function groupView(data, g, user) {
  return {id: g.id, name: g.name, description: g.description, utc_offset: g.utc_offset, time_zone: g.tz_label,
    requires_approval: g.requires_approval, hide_from_member_list: g.hide_from_member_list, hide_rsvps: g.hide_rsvps,
    member_count: data.memberships.filter(m => m.group_id === g.id && m.state === 'member').length,
    my_membership: myMembership(data, g, user)};
}

function memberView(data, m, groupId) {
  const x = R.member(data, m);
  return {member_id: x.id, display_name: x.display_name, bio: x.bio, role: R.roleOf(data, groupId, m)};
}

function waitlistPosition(data, r) {
  if (r.answer !== 'waitlist') return null;
  const queue = data.rsvps.filter(x => x.event_id === r.event_id && x.answer === 'waitlist')
    .sort((a, b) => ms(a.waitlisted_at) - ms(b.waitlisted_at) || a.id.localeCompare(b.id));
  return queue.findIndex(x => x.id === r.id) + 1;
}

function rsvpView(data, r) {
  if (!r) return null;
  return {id: r.id, event_id: r.event_id, answer: r.answer, guests: r.guests, children: r.children, places: R.places(r),
    updated_at: r.updated_at, waitlist_position: waitlistPosition(data, r), offer_expires_at: r.offer_expires_at,
    reconfirm_by: r.reconfirm_by};
}

function eventSummary(data, e, now, user) {
  const taken = R.taken(data, e);
  return {id: e.id, group_id: e.group_id, title: e.title, start: e.start, end: e.end, venue: e.venue,
    state: R.eventState(e, now), capacity: e.capacity, places_taken: taken, places_free: Math.max(0, e.capacity - taken),
    waitlist_count: data.rsvps.filter(r => r.event_id === e.id && r.answer === 'waitlist').length,
    guest_limit: e.guest_limit, rsvp_open: e.rsvp_open, rsvp_close: e.rsvp_close,
    hosts: e.host_member_ids.map(id => who(data, id)),
    my_rsvp: rsvpView(data, R.rsvpFor(data, e.id, user))};
}

function eventDetail(data, e, now, viewer, world = V.currentWorld(data)) {
  const out = {...eventSummary(data, e, now, viewer), description: e.description,
    changes: e.revisions.filter(v => v.action !== 'created').map(v => ({at: v.at, action: v.action, fields: structuredClone(v.fields), notify: v.notify})),
    sheets: data.sheets.filter(s => s.event_id === e.id).map(s => ({id: s.id, title: s.title}))};
  if (V.canSeeGuests(world, viewer, e.id)) {
    out.guests_hidden = false;
    out.guests = data.rsvps.filter(r => r.event_id === e.id && r.answer !== 'no')
      .sort((a, b) => a.member_id.localeCompare(b.member_id))
      .map(r => ({...who(data, r.member_id), answer: r.answer, guests: r.guests, children: r.children}));
  } else {
    out.guests_hidden = true;
    out.guests = [];
  }
  return out;
}

function postView(data, p, now) {
  const root = R.rootOf(data, p);
  return {id: p.id, group_id: p.group_id, kind: p.kind, audience: p.kind === 'announcement' ? 'group' : root.audience,
    event_id: root.event_id, parent_id: p.parent_id, author: who(data, p.author_member_id), text: p.text, state: p.state,
    created_at: p.created_at, updated_at: p.updated_at, locked: postLocked(data, p, now)};
}

function postLocked(data, p, now) {
  if (p.kind === 'announcement') return true;
  const root = R.rootOf(data, p);
  const eventId = p.event_id || root.event_id;
  return Boolean(eventId) && R.eventState(R.event(data, eventId), now) !== 'published';
}

function sheetView(data, s, now, viewer) {
  return {id: s.id, event_id: s.event_id, title: s.title, lock_at: s.lock_at, locked: R.sheetLocked(data, s, now),
    slots: s.slots.map(slot => ({id: slot.id, label: slot.label, quantity: slot.quantity,
      open: slot.quantity - slot.claims.length, claimed_by: slot.claims.map(id => who(data, id))})),
    my_slots: s.slots.filter(slot => slot.claims.includes(viewer)).map(slot => slot.id)};
}

function swapView(data, w) {
  return {id: w.id, sheet_id: w.sheet_id, from: who(data, w.from_member_id), to: who(data, w.to_member_id),
    give_slot: w.give_slot, want_slot: w.want_slot, state: w.state, proposed_at: w.proposed_at,
    expires_at: w.expires_at, decided_at: w.decided_at};
}

const HELP = {
  time: [
    'Times are shown in the group\'s fixed UTC offset (no daylight-saving changes).',
    'Stoopside follows the environment clock. Your reads and writes do not move it; only a scheduled clock advance or a scenario event does.',
    'Deadlines (RSVP close, waitlist claims, reconfirmations, sheet locks, swap expiry and the Monday digest) are worked out from stored due times. A deadline that passes is committed at the next write or event, stamped with its own due time. A missed deadline therefore needs a scheduled clock advance or event before anything changes.',
    'A preview expires 15 minutes after it is made (preview_expired). Confirming fails with preview_stale if anything the preview read has changed since.',
  ],
  groups: [
    'Membership: pending, then member or declined; a member can leave or be removed. Roles: organizer, co-organizer, event host, member.',
    'Members see member IDs, display names, bios and roles. A display name can differ from the name you use for someone. Emails appear only in members.export, which needs co-organizer or above.',
    'Search matches parts of display names and bios only. With hide_from_member_list on, only organizers and co-organizers can search or list members.',
    'Leaving withdraws a pending request, or sets your RSVPs for upcoming events in the group to no and releases your sign-up slots. The only organizer cannot leave (sole_organizer), nor can the only host of an upcoming event (sole_host).',
  ],
  events: [
    'Hosts create, edit and cancel events through events.preview_change and events.confirm_change. Every group member sees every event.',
    'An RSVP carries guest and child counts; each person takes one place. guest_limit caps guests (children are not capped but take places).',
    'rsvps.preview pre-fills guests and children from your latest RSVP in that group when you leave them out, and shows where they came from and when.',
    'A yes that does not fit goes on the waitlist. A freed place is offered for 24 hours, or until RSVPs close if sooner, to the earliest waitlisted RSVP that fits; an expired offer passes on to the next. Claim an offer with rsvps.preview and rsvps.confirm. After an offer expires, rsvps.preview answers claim_expired unless you ask to rejoin the waitlist.',
    'Changing an event\'s date, time or venue needs a notify choice: guests (every open RSVP) or group (every member). Each yes becomes needs_reconfirm, which holds the place for 48 hours (or until the event starts) and then becomes no.',
    'Cancelling notifies every open RSVP, locks the event\'s sign-up sheets and cannot be undone.',
  ],
  posts: [
    'posts.preview needs an audience for posts and announcements (audience_required): group, event_guests (needs an event) or hosts_only. Comments use their parent\'s audience.',
    'event_guests means RSVP yes: at publish for who is notified, and at read time for who can see it. hosts_only means organizers, co-organizers and event hosts.',
    'Publishing notifies the audience. An edit changes text only and notifies nobody. Deleting hides the post but recalls nothing already delivered.',
    'Announcements (co-organizer and above) are emailed to every member at once, one per group per calendar day (announcement_limit_reached).',
    'Announcements, and posts on a past or cancelled event, cannot be edited or deleted (post_locked).',
    'A digest of the last seven days of surviving group posts falls due Mondays at 08:00 group time and is created at the first write or event after that.',
  ],
  signups: [
    'A sign-up sheet belongs to an event. Each slot has a quantity; claim and release one unit until the sheet locks (sheet_locked), or at once if the event is cancelled.',
    'A swap trades your claim on one slot for another member\'s claim on another. It needs their acceptance and expires after 48 hours or at the lock. Claims in a pending swap cannot be released or offered again (swap_pending).',
    'Event edits leave sheets unchanged.',
  ],
  visibility: [
    'visibility.view_as shows a group, event, post or sheet as a named member sees it now. It does not show what was already delivered to them.',
    'Anything you cannot see yourself is not_found.',
    'Stoopside keeps every delivery and every revision of memberships, RSVPs and posts. The visibility record is computed from that history; it is not an agent tool.',
  ],
};

module.exports = {name, who, groupView, memberView, rsvpView, eventSummary, eventDetail, postView, postLocked, sheetView, swapView, HELP};
