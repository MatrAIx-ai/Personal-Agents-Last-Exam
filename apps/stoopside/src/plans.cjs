'use strict';
// Previewed changes. A plan is computed from the current (settled) data and the
// caller's arguments; it lists every member it will notify or commit and a
// `basis` fingerprint of everything it read. Confirming recomputes the plan:
// domain errors are raised again, and a different basis is `preview_stale`.
// Writes that notify several members or commit other people (event changes,
// RSVPs, posts) use plans; other writes are single calls.
const {fail} = require('./domain-utils.cjs');
const R = require('./rules.cjs');
const V = require('./visibility.cjs');
const {ms, label, localDate} = require('./clock.cjs');
const {guestRecipients, groupRecipients, postRecipients} = require('./transitions.cjs');

const EVENT_FIELDS = ['title', 'description', 'start', 'end', 'venue', 'capacity', 'guest_limit', 'rsvp_open', 'rsvp_close'];
const MOVE_FIELDS = ['start', 'end', 'venue'];
const names = (data, ids) => ids.map(id => ({member_id: id, display_name: R.member(data, id).display_name}));

function visibleEvent(data, id, viewer) {
  const e = data.events.find(x => x.id === id);
  if (!e || !V.canSee(V.currentWorld(data), viewer, {type: 'event', id})) fail('not_found', `Event ${id} does not exist.`);
  return e;
}

function checkTimes(f) {
  for (const k of ['start', 'end', 'rsvp_open', 'rsvp_close']) ms(f[k]);
  if (!(ms(f.start) < ms(f.end))) fail('invalid_arguments', 'The event must end after it starts.');
  if (!(ms(f.rsvp_open) < ms(f.rsvp_close)) || ms(f.rsvp_close) > ms(f.end)) fail('invalid_arguments', 'RSVPs must open before they close, and close by the end of the event.');
}

// ---- Events: create, edit, cancel ------------------------------------------

function eventPlan(data, args, now, actor) {
  const fields = args.fields || {};
  if (args.change === 'create') {
    const g = R.group(data, args.group_id);
    R.requireRole(data, g.id, actor, 'event_host');
    for (const k of EVENT_FIELDS) if (k !== 'description' && fields[k] === undefined) fail('invalid_arguments', `A new event needs ${k}.`);
    const draft = {description: '', ...fields};
    checkTimes(draft);
    if (ms(draft.start) <= now) fail('invalid_arguments', 'A new event must start in the future.');
    return {kind: 'event', change: 'create', group_id: g.id, event_id: null, fields: draft, notify: null, recipients: [],
      reconfirm: [], basis: JSON.stringify({group: g.id, role: R.roleOf(data, g.id, actor)})};
  }
  const e = visibleEvent(data, args.event_id, actor);
  if (!R.canManageEvent(data, e, actor)) fail('role_required', 'Only this event\'s hosts, co-organizers and organizers can change it.');
  const state = R.eventState(e, now);
  if (state !== 'published') fail('invalid_state', `The event is ${state}.`);
  const rsvps = data.rsvps.filter(r => r.event_id === e.id).map(r => [r.id, r.answer, r.guests, r.children]);
  const base = {event: e.id, revisions: e.revisions.length, rsvps};
  if (args.change === 'cancel') {
    const recipients = guestRecipients(data, e).filter(m => m !== actor).sort();
    return {kind: 'event', change: 'cancel', group_id: e.group_id, event_id: e.id, fields: {}, notify: 'guests', recipients,
      reconfirm: [], basis: JSON.stringify({...base, recipients})};
  }
  if (args.change !== 'edit') fail('invalid_arguments', 'change must be create, edit or cancel.');
  const changed = Object.fromEntries(Object.entries(fields).filter(([k, v]) => EVENT_FIELDS.includes(k) && e[k] !== v));
  if (!Object.keys(changed).length) fail('invalid_arguments', 'Nothing to change.');
  checkTimes({...e, ...changed});
  const moved = MOVE_FIELDS.some(k => k in changed);
  if (moved && !args.notify) fail('notify_required', 'Changing the date, time or venue needs notify: guests or group.');
  if (changed.capacity !== undefined && changed.capacity < R.taken(data, e)) {
    fail('capacity_below_yes', `${R.taken(data, e)} places are already taken; capacity cannot go below that.`);
  }
  const notify = args.notify || null;
  const recipients = (notify === 'group' ? groupRecipients(data, e.group_id) : notify === 'guests' ? guestRecipients(data, e) : [])
    .filter(m => m !== actor).sort();
  const reconfirm = moved ? data.rsvps.filter(r => r.event_id === e.id && r.answer === 'yes').map(r => r.id) : [];
  return {kind: 'event', change: 'edit', group_id: e.group_id, event_id: e.id, fields: changed, notify, recipients, reconfirm,
    basis: JSON.stringify({...base, recipients, notify})};
}

function eventSummary(data, plan) {
  const e = plan.event_id ? R.event(data, plan.event_id) : null;
  const g = R.group(data, plan.group_id);
  const notes = {
    create: 'Creates the event. Nobody is notified.',
    edit: plan.reconfirm.length ? `Each yes RSVP (${plan.reconfirm.length}) becomes needs_reconfirm and holds its place for 48 hours.` : 'RSVPs are unchanged.',
    cancel: 'Cancelling notifies every open RSVP, locks the event\'s sign-up sheets and cannot be undone.',
  };
  return {change: plan.change, group_id: g.id, event_id: plan.event_id, title: plan.fields.title || e.title,
    fields: structuredClone(plan.fields), notify: plan.notify, recipient_count: plan.recipients.length,
    recipients: names(data, plan.recipients), rsvps_to_reconfirm: plan.reconfirm.length, note: notes[plan.change]};
}

// ---- RSVPs ---------------------------------------------------------------

function rsvpPlan(data, args, now, user) {
  const e = visibleEvent(data, args.event_id, user);
  R.requireMember(data, e.group_id, user);
  const r = R.rsvpFor(data, e.id, user), current = r ? r.answer : null;
  let prefilled = null;
  let guests = args.guests, children = args.children;
  if (guests === undefined || children === undefined) {
    const latest = R.latestRsvpInGroup(data, e.group_id, user);
    if (latest) {
      prefilled = {rsvp_id: latest.id, event_id: latest.event_id, event_title: R.event(data, latest.event_id).title,
        answered_at: latest.updated_at, guests: latest.guests, children: latest.children};
    }
    if (guests === undefined) guests = latest ? latest.guests : 0;
    if (children === undefined) children = latest ? latest.children : 0;
  }
  if (args.answer === 'no') { guests = 0; children = 0; }
  const state = R.eventState(e, now);
  let outcome;
  if (args.answer === 'no') {
    if (state !== 'published' || now >= ms(e.start)) fail('rsvp_closed', `${e.title} has ${state === 'cancelled' ? 'been cancelled' : 'started'}.`);
    if (!r || current === 'no') fail('invalid_state', 'There is no RSVP to change to no.');
    outcome = current === 'offered' ? 'decline_offer' : 'no';
  } else {
    if (guests > e.guest_limit) fail('guest_limit_exceeded', `${e.title} allows at most ${e.guest_limit} guests per RSVP.`);
    const need = 1 + guests + children, free = e.capacity - R.taken(data, e);
    const held = r && R.HOLDING.has(current) ? R.places(r) : 0;
    if (current === 'expired' && !args.rejoin_waitlist) {
      fail('claim_expired', `The offer for ${e.title} expired at ${label(ms(r.revisions.at(-1).at), R.group(data, e.group_id))}. Pass rejoin_waitlist to join the back of the waitlist.`);
    }
    if (current === 'offered' || current === 'needs_reconfirm') {
      if (state !== 'published') fail('rsvp_closed', `${e.title} is ${state}.`);
      outcome = need <= held + free ? (current === 'offered' ? 'claim' : 'reconfirm') : 'waitlist';
    } else {
      R.rsvpWindow(e, now);
      outcome = current === 'waitlist' ? 'waitlist' : need <= held + free ? (current === 'yes' ? 'update' : 'yes') : 'waitlist';
    }
  }
  const result = {yes: 'yes', claim: 'yes', reconfirm: 'yes', update: 'yes', waitlist: 'waitlist', no: 'no', decline_offer: 'no'}[outcome];
  const free = e.capacity - R.taken(data, e);
  return {kind: 'rsvp', event_id: e.id, group_id: e.group_id, answer: args.answer, guests, children, prefilled, outcome, result,
    current, recipients: [],
    basis: JSON.stringify({event: e.id, revisions: e.revisions.length, rsvp: r && [r.answer, r.guests, r.children, r.offer_expires_at, r.revisions.length], free, outcome})};
}

function rsvpSummary(data, plan, now) {
  const e = R.event(data, plan.event_id), g = R.group(data, e.group_id), r = R.rsvpFor(data, e.id, data.user_member_id);
  const notes = {
    yes: 'You get a place.', update: 'Your place is kept with the new counts.', claim: 'Claims the offered place.',
    reconfirm: 'Reconfirms your place.', waitlist: 'There is no room: this RSVP goes on the waitlist.',
    no: 'Your answer becomes no and any place you hold is released.', decline_offer: 'Declines the offer; the place passes to the next waitlisted member.',
  };
  return {event: {id: e.id, title: e.title, start: e.start, end: e.end, venue: e.venue, group: g.name},
    answer: plan.answer, guests: plan.guests, children: plan.children, places: plan.answer === 'no' ? 0 : 1 + plan.guests + plan.children,
    prefilled_from: plan.prefilled, current_answer: plan.current, outcome: plan.outcome, resulting_answer: plan.result,
    offer_expires_at: r && r.answer === 'offered' ? r.offer_expires_at : null,
    reconfirm_by: r && r.answer === 'needs_reconfirm' ? r.reconfirm_by : null,
    places_free: Math.max(0, e.capacity - R.taken(data, e)), note: notes[plan.outcome]};
}

// ---- Posts, comments, announcements, edits -------------------------------------

function visiblePost(data, id, viewer) {
  const p = data.posts.find(x => x.id === id);
  if (!p || !V.canSee(V.currentWorld(data), viewer, {type: 'post', id})) fail('not_found', `Post ${id} does not exist.`);
  return p;
}

function postPlan(data, args, now, user) {
  const g = R.group(data, args.group_id);
  R.requireMember(data, g.id, user);
  const views = require('./views.cjs');
  if (args.edit_of) {
    const target = visiblePost(data, args.edit_of, user);
    if (target.group_id !== g.id) fail('not_found', 'That post is in another group.');
    if (target.author_member_id !== user) fail('role_required', 'Only the author can edit a post.');
    if (views.postLocked(data, target, now)) fail('post_locked', 'Announcements, and posts on a past or cancelled event, cannot be edited.');
    const root = R.rootOf(data, target);
    if (args.audience !== undefined && args.audience !== root.audience) fail('invalid_arguments', 'An edit changes text only; the audience stays the same.');
    return {kind: 'post', mode: 'edit', group_id: g.id, post_kind: target.kind, audience: root.audience, event_id: target.event_id,
      parent_id: target.parent_id, edit_of: target.id, text: args.text, recipients: [],
      basis: JSON.stringify({target: target.id, revisions: target.revisions.length})};
  }
  const kind = args.kind;
  let audience = args.audience, eventId = args.event_id || null, parent = null;
  if (kind === 'comment') {
    if (!args.parent_id) fail('invalid_arguments', 'A comment needs parent_id.');
    parent = visiblePost(data, args.parent_id, user);
    if (parent.group_id !== g.id) fail('not_found', 'That post is in another group.');
    const root = R.rootOf(data, parent);
    const inherited = root.kind === 'announcement' ? 'group' : root.audience;
    if (audience !== undefined && audience !== inherited) fail('invalid_arguments', `Comments use the parent's audience (${inherited}).`);
    audience = inherited;
    eventId = null;
  } else {
    if (args.parent_id) fail('invalid_arguments', 'Only comments take parent_id.');
    if (audience === undefined) fail('audience_required', 'Choose an audience: group, event_guests or hosts_only.');
    if (kind === 'announcement') {
      R.requireRole(data, g.id, user, 'co_organizer');
      if (audience !== 'group') fail('invalid_arguments', 'Announcements go to the whole group.');
      const today = localDate(now, g.utc_offset);
      if (data.posts.some(p => p.group_id === g.id && p.kind === 'announcement' && localDate(ms(p.created_at), g.utc_offset) === today)) {
        fail('announcement_limit_reached', `${g.name} already has an announcement today (${today}).`);
      }
    }
    if (audience === 'event_guests' && !eventId) fail('invalid_arguments', 'event_guests needs event_id.');
    if (eventId) {
      const e = visibleEvent(data, eventId, user);
      if (e.group_id !== g.id) fail('invalid_arguments', 'The event is in another group.');
    }
  }
  const draft = {id: '(new)', group_id: g.id, kind, audience, event_id: eventId, parent_id: parent ? parent.id : null, author_member_id: user};
  const recipients = postRecipients({...data, posts: [...data.posts, draft]}, draft);
  return {kind: 'post', mode: 'new', group_id: g.id, post_kind: kind, audience, event_id: eventId, parent_id: draft.parent_id,
    edit_of: null, text: args.text, recipients,
    basis: JSON.stringify({recipients, role: R.roleOf(data, g.id, user), parent: parent && [parent.id, parent.state]})};
}

function postSummary(data, plan) {
  const channel = plan.post_kind === 'announcement' ? 'email' : 'in_app';
  return {mode: plan.mode, kind: plan.post_kind, group_id: plan.group_id, audience: plan.audience, event_id: plan.event_id,
    parent_id: plan.parent_id, edit_of: plan.edit_of, text: plan.text, channel,
    recipient_count: plan.recipients.length, recipients: names(data, plan.recipients),
    note: plan.mode === 'edit' ? 'An edit changes text only and notifies nobody.' :
      `Publishing notifies ${plan.recipients.length} ${plan.recipients.length === 1 ? 'member' : 'members'}. Deleting later recalls nothing already delivered.`};
}

module.exports = {eventPlan, eventSummary, rsvpPlan, rsvpSummary, postPlan, postSummary, visibleEvent, visiblePost, EVENT_FIELDS, MOVE_FIELDS};
