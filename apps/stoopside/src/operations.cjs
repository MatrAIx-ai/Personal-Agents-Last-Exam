'use strict';
// Agent tool handlers. Reads work on a settled copy and return it unchanged;
// writes settle due time effects first, then apply one business transition.
const {fail} = require('./domain-utils.cjs');
const {log} = require('./diagnostics.cjs');
const R = require('./rules.cjs');
const V = require('./views.cjs');
const VIS = require('./visibility.cjs');
const P = require('./plans.cjs');
const T = require('./transitions.cjs');
const {ms, iso, label} = require('./clock.cjs');
const {settle} = require('./settle.cjs');
const {notify, deliver, seq} = require('./notices.cjs');
const {nextId} = require('./ids.cjs');

const PREFIX = 'stoopside.';
const copy = value => structuredClone(value);
const lower = s => s.toLocaleLowerCase('en-US');
const offsetOf = stamp => (/[+-]\d{2}:\d{2}$/.exec(stamp) || ['Z'])[0];

function visibleSheet(data, id, viewer) {
  const s = data.sheets.find(x => x.id === id);
  if (!s || !VIS.canSee(VIS.currentWorld(data), viewer, {type: 'sheet', id})) fail('not_found', `Sheet ${id} does not exist.`);
  return s;
}

// ---- Reads ------------------------------------------------------------------

const READS = {
  'groups.list'(data, args) {
    const q = lower(args.query || '');
    return {groups: data.groups.filter(g => lower(g.name + ' ' + g.description).includes(q)).map(g => V.groupView(data, g, data.user_member_id))};
  },
  'groups.get'(data, args, now) {
    const g = R.group(data, args.group_id), user = data.user_member_id;
    const hosts = data.memberships.filter(m => m.group_id === g.id && m.state === 'member' && m.role !== 'member')
      .sort((a, b) => R.rank(b.role) - R.rank(a.role) || a.member_id.localeCompare(b.member_id))
      .map(m => ({...V.who(data, m.member_id), role: m.role}));
    const upcoming = R.isMember(data, g.id, user)
      ? data.events.filter(e => e.group_id === g.id && R.eventState(e, now) === 'published')
        .sort((a, b) => ms(a.start) - ms(b.start) || a.id.localeCompare(b.id)).map(e => V.eventSummary(data, e, now, user))
      : [];
    return {group: V.groupView(data, g, user), hosts, upcoming_events: upcoming};
  },
  'members.search'(data, args) {
    const g = R.group(data, args.group_id), user = data.user_member_id;
    R.requireMember(data, g.id, user);
    if (!VIS.canSeeDirectory(VIS.currentWorld(data), user, g.id)) fail('role_required', `${g.name} hides its member list from members who are not organizers.`);
    const q = lower(args.query);
    return {members: data.memberships.filter(m => m.group_id === g.id && m.state === 'member')
      .map(m => V.memberView(data, m.member_id, g.id))
      .filter(m => lower(m.display_name).includes(q) || lower(m.bio).includes(q))
      .sort((a, b) => a.display_name.localeCompare(b.display_name) || a.member_id.localeCompare(b.member_id))};
  },
  'members.export'(data, args) {
    const g = R.group(data, args.group_id);
    R.requireRole(data, g.id, data.user_member_id, 'co_organizer');
    return {group_id: g.id, members: data.memberships.filter(m => m.group_id === g.id && m.state === 'member')
      .sort((a, b) => a.member_id.localeCompare(b.member_id))
      .map(m => ({...V.memberView(data, m.member_id, g.id), email: R.member(data, m.member_id).email, member_since: m.created_at}))};
  },
  'profile.get'(data) {
    const me = R.member(data, data.user_member_id);
    return {profile: {member_id: me.id, display_name: me.display_name, bio: me.bio},
      memberships: data.memberships.filter(m => m.member_id === me.id)
        .map(m => ({group_id: m.group_id, group_name: R.group(data, m.group_id).name, state: m.state, role: m.state === 'member' ? m.role : null}))};
  },
  'events.list'(data, args, now) {
    const user = data.user_member_id, world = VIS.currentWorld(data);
    if (args.group_id) R.requireMember(data, R.group(data, args.group_id).id, user);
    return {events: data.events.filter(e => (!args.group_id || e.group_id === args.group_id) &&
        VIS.canSee(world, user, {type: 'event', id: e.id}) && (args.include_past || R.eventState(e, now) !== 'past'))
      .sort((a, b) => ms(a.start) - ms(b.start) || a.id.localeCompare(b.id)).map(e => V.eventSummary(data, e, now, user))};
  },
  'events.get'(data, args, now) {
    const e = P.visibleEvent(data, args.event_id, data.user_member_id);
    return {event: V.eventDetail(data, e, now, data.user_member_id)};
  },
  'posts.list'(data, args, now) {
    const user = data.user_member_id, g = R.group(data, args.group_id), world = VIS.currentWorld(data);
    R.requireMember(data, g.id, user);
    return {posts: data.posts.filter(p => p.group_id === g.id && VIS.canSee(world, user, {type: 'post', id: p.id}) &&
        (!args.event_id || R.rootOf(data, p).event_id === args.event_id))
      .sort((a, b) => ms(a.created_at) - ms(b.created_at) || a.id.localeCompare(b.id)).map(p => V.postView(data, p, now))};
  },
  'signups.get'(data, args, now) {
    const user = data.user_member_id, s = visibleSheet(data, args.sheet_id, user);
    return {sheet: V.sheetView(data, s, now, user),
      swaps: data.swaps.filter(w => w.sheet_id === s.id && (w.from_member_id === user || w.to_member_id === user)).map(w => V.swapView(data, w))};
  },
  'visibility.view_as'(data, args, now) {
    const user = data.user_member_id, world = VIS.currentWorld(data), ref = {type: args.object_type, id: args.object_id};
    const exists = {group: data.groups, event: data.events, post: data.posts, sheet: data.sheets}[ref.type].some(x => x.id === ref.id);
    if (!exists || !VIS.canSee(world, user, ref)) fail('not_found', `${ref.type} ${ref.id} does not exist.`);
    const m = R.member(data, args.member_id);
    const visible = VIS.canSee(world, m.id, ref);
    let view = null;
    if (visible) {
      if (ref.type === 'group') view = V.groupView(data, R.group(data, ref.id), m.id);
      if (ref.type === 'event') view = V.eventDetail(data, R.event(data, ref.id), now, m.id, world);
      if (ref.type === 'post') view = V.postView(data, R.post(data, ref.id), now);
      if (ref.type === 'sheet') view = V.sheetView(data, R.sheet(data, ref.id), now, m.id);
    }
    return {member: V.who(data, m.id), object_type: ref.type, object_id: ref.id, visible, view, as_of: iso(now),
      note: 'Shows what this member can see now. It does not show what was already delivered to them.'};
  },
  'help.get'(data, args) {
    const topics = args.topic ? [args.topic] : Object.keys(V.HELP);
    return {topics: topics.map(t => ({topic: t, rules: [...V.HELP[t]]}))};
  },
};

// ---- Previews ----------------------------------------------------------------

function storePreview(ctx, data, plan, summary, now) {
  const p = {id: nextId(data.previews, 'pv'), kind: plan.kind, created_at: ctx.virtual_now,
    expires_at: iso(R.previewEnds(now), offsetOf(ctx.virtual_now)), consumed_at: null, request: copy(plan.request), basis: plan.basis, summary: copy(summary)};
  data.previews.push(p);
  return {id: p.id, kind: p.kind, created_at: p.created_at, expires_at: p.expires_at, ...copy(summary)};
}

function usePreview(ctx, data, id, kind, now, replan) {
  const p = data.previews.find(x => x.id === id);
  if (!p || p.kind !== kind) fail('not_found', `Preview ${id} does not exist.`);
  if (p.consumed_at) fail('preview_consumed', 'This preview was already confirmed. Preview again.');
  const plan = replan(p.request);
  if (now >= ms(p.expires_at)) fail('preview_expired', 'The preview expired after 15 minutes; preview again.');
  if (plan.basis !== p.basis) fail('preview_stale', 'Something the preview read has changed; preview again.');
  p.consumed_at = ctx.virtual_now;
  return {p, plan};
}

// ---- Commits shared with scenario events ----------------------------------------

function eventFields(e, g) {
  return [['Event', `${e.title} (${e.id})`], ['Group', g.name], ['When', `${label(ms(e.start), g)} to ${label(ms(e.end), g).slice(11)}`],
    ['Venue', e.venue]];
}

// Applies an event plan as `actor` at `at`. The user gets a receipt when they
// are the actor, and a notice when they are a recipient.
function applyEventPlan(data, plan, at, actor) {
  const user = data.user_member_id, g = R.group(data, plan.group_id);
  let e;
  if (plan.change === 'create') {
    e = {id: nextId(data.events, 'e'), group_id: g.id, ...copy(plan.fields), host_member_ids: [actor], state: 'published',
      created_by: actor, created_at: at, revisions: []};
    for (const k of P.EVENT_FIELDS) e[k] = plan.fields[k];
    data.events.push(e);
    e.revisions.push({seq: seq(data), at, action: 'created', state: 'published', fields: {}, notify: null, actor});
  } else {
    e = R.event(data, plan.event_id);
    const before = Object.fromEntries(Object.keys(plan.fields).map(k => [k, e[k]]));
    if (plan.change === 'cancel') e.state = 'cancelled';
    Object.assign(e, copy(plan.fields));
    e.revisions.push({seq: seq(data), at, action: plan.change === 'cancel' ? 'cancelled' : 'edited', state: e.state,
      fields: copy(plan.fields), notify: plan.notify, actor, previous: before});
    for (const id of plan.reconfirm) T.setRsvp(data, R.byId(data.rsvps, id), at, {answer: 'needs_reconfirm'}, 'event_changed');
    if (plan.recipients.length) {
      deliver(data, {at, recipients: plan.recipients, object_type: 'event', object_id: e.id, channel: 'email',
        reason: plan.change === 'cancel' ? 'event_cancelled' : 'event_changed'});
    }
    if (plan.change === 'edit' && plan.fields.capacity !== undefined) T.allocate(data, e, at);
  }
  const changes = Object.entries(plan.fields).filter(([k]) => k !== 'description').map(([k, v]) => `${k} ${v}`).join('; ');
  const mine = R.rsvpFor(data, e.id, user);
  if (actor === user) {
    return notify(data, {at, kind: 'event_receipt', object_type: 'event', object_id: e.id,
      title: `${{create: 'Created', edit: 'Updated', cancel: 'Cancelled'}[plan.change]}: ${e.title}`,
      fields: [...eventFields(e, g), ['Change', plan.change === 'edit' ? changes : plan.change],
        ['Notified', plan.recipients.length ? `${plan.recipients.length} members (${plan.notify})` : 'nobody'],
        ['RSVPs to reconfirm', plan.reconfirm.length || null]]});
  }
  if (!plan.recipients.includes(user)) return null;
  if (plan.change === 'cancel') {
    return notify(data, {at, kind: 'event_cancelled', object_type: 'event', object_id: e.id, title: `Cancelled: ${e.title}`,
      fields: [...eventFields(e, g), ['Your RSVP', mine ? `${mine.id}, ${mine.answer}` : null], ['Note', 'The event is cancelled and its sign-up sheets are locked.']]});
  }
  return notify(data, {at, kind: 'event_changed', object_type: 'event', object_id: e.id, title: `Changed: ${e.title}`,
    fields: [...eventFields(e, g), ['Change', changes], ['Your RSVP', mine ? `${mine.id}, ${mine.answer}` : null],
      ['Reconfirm by', mine && mine.answer === 'needs_reconfirm' ? `${label(ms(mine.reconfirm_by), g)} (after that it becomes no)` : null]]});
}

function applyRsvpPlan(data, plan, at) {
  const user = data.user_member_id, e = R.event(data, plan.event_id), g = R.group(data, e.group_id);
  const r = R.rsvpFor(data, e.id, user) || T.newRsvp(data, e, user, at);
  const heldBefore = R.HOLDING.has(r.answer) ? R.places(r) : 0;
  T.setRsvp(data, r, at, {answer: plan.result, guests: plan.guests, children: plan.children}, 'rsvp_' + plan.outcome);
  const heldAfter = R.HOLDING.has(r.answer) ? R.places(r) : 0;
  if (heldAfter < heldBefore || plan.result === 'waitlist') T.allocate(data, e, at);
  const position = V.rsvpView(data, r).waitlist_position;
  const n = notify(data, {at, kind: 'rsvp_receipt', object_type: 'rsvp', object_id: r.id,
    title: `RSVP ${r.answer}: ${e.title}`,
    fields: [...eventFields(e, g), ['Start', e.start], ['End', e.end], ['Answer', r.answer], ['Guests', r.guests], ['Children', r.children],
      ['Places', r.answer === 'no' ? 0 : R.places(r)], ['Waitlist position', position], ['RSVP', r.id]]});
  return {rsvp: V.rsvpView(data, r), notice_id: n};
}

function applyPostPlan(data, plan, at, author, id = null) {
  const user = data.user_member_id;
  if (plan.mode === 'edit') {
    const p = R.post(data, plan.edit_of);
    p.text = plan.text;
    p.state = 'edited';
    p.updated_at = at;
    p.revisions.push({seq: seq(data), at, state: 'edited', text: plan.text});
    return {post: p, notice_id: null};
  }
  const p = {id: id || nextId(data.posts, 'p'), group_id: plan.group_id, kind: plan.post_kind, audience: plan.audience,
    event_id: plan.event_id, parent_id: plan.parent_id, author_member_id: author, text: plan.text, state: 'published',
    created_at: at, updated_at: at, revisions: []};
  data.posts.push(p);
  p.revisions.push({seq: seq(data), at, state: 'published', text: plan.text});
  const channel = p.kind === 'announcement' ? 'email' : 'in_app';
  if (plan.recipients.length) deliver(data, {at, recipients: plan.recipients, object_type: 'post', object_id: p.id, channel, reason: p.kind});
  const g = R.group(data, p.group_id);
  const fields = [['Group', g.name], ['Post', p.id], ['Kind', p.kind], ['Audience', p.audience], ['Event', p.event_id],
    ['Notified', `${plan.recipients.length} members`], ['Text', p.text]];
  let noticeId = null;
  if (author === user) {
    noticeId = notify(data, {at, kind: 'post_receipt', object_type: 'post', object_id: p.id, title: `Posted in ${g.name}: ${p.text.slice(0, 80)}`, fields});
  } else if (p.kind === 'announcement' && plan.recipients.includes(user)) {
    noticeId = notify(data, {at, kind: 'announcement', object_type: 'post', object_id: p.id,
      title: `${g.name} announcement: ${p.text.slice(0, 120)}`,
      fields: [['Group', g.name], ['From', R.member(data, author).display_name], ['Announcement', p.text]]});
  }
  return {post: p, notice_id: noticeId};
}

function exchange(data, w, at) {
  const s = R.sheet(data, w.sheet_id);
  const give = s.slots.find(x => x.id === w.give_slot), want = s.slots.find(x => x.id === w.want_slot);
  if (!give.claims.includes(w.from_member_id) || !want.claims.includes(w.to_member_id)) fail('not_your_slot', 'One of the swapped claims is no longer held.');
  if (want.claims.includes(w.from_member_id) || give.claims.includes(w.to_member_id)) fail('invalid_state', 'One member already holds the other slot.');
  give.claims = give.claims.map(m => (m === w.from_member_id ? w.to_member_id : m));
  want.claims = want.claims.map(m => (m === w.to_member_id ? w.from_member_id : m));
  s.revisions.push({seq: seq(data), at, action: 'swap', slot_id: give.id, member_id: w.to_member_id, reason: w.id});
  s.revisions.push({seq: seq(data), at, action: 'swap', slot_id: want.id, member_id: w.from_member_id, reason: w.id});
}

function liveSwap(data, w, now) {
  if (w.state !== 'proposed') fail('invalid_state', `Swap ${w.id} is ${w.state}.`);
  if (now >= ms(w.expires_at)) fail('invalid_state', `Swap ${w.id} expired at ${w.expires_at}.`);
}

function pendingSwapOn(data, sheetId, memberId, slotId) {
  return data.swaps.find(w => w.sheet_id === sheetId && w.state === 'proposed' &&
    ((w.from_member_id === memberId && w.give_slot === slotId) || (w.to_member_id === memberId && w.want_slot === slotId))) || null;
}

// ---- Writes -----------------------------------------------------------------

const WRITES = {
  'groups.join'(ctx, data, args) {
    const g = R.group(data, args.group_id), user = data.user_member_id, m = R.membership(data, g.id, user);
    if (m && m.state === 'pending') fail('approval_pending', 'Your request to join is already waiting for an organizer.');
    if (m && m.state === 'member') fail('invalid_state', 'You are already a member.');
    if (m && m.state === 'removed') fail('role_required', 'An organizer removed you from this group.');
    const out = T.joinMembership(data, g.id, user, ctx.virtual_now, g.requires_approval ? 'pending' : 'member', 'join');
    return {membership: {group_id: g.id, state: out.state, role: out.state === 'member' ? out.role : null}};
  },
  'groups.leave'(ctx, data, args, now) {
    const g = R.group(data, args.group_id), user = data.user_member_id, m = R.membership(data, g.id, user);
    if (!m || !['member', 'pending'].includes(m.state)) fail('not_member', 'You are not a member of this group.');
    let released = {rsvps: [], claims: []};
    if (m.state === 'member') {
      if (m.role === 'organizer' && !data.memberships.some(x => x.group_id === g.id && x.state === 'member' && x.role === 'organizer' && x.member_id !== user)) {
        fail('sole_organizer', 'You are the only organizer; hand the role over before leaving.');
      }
      const solo = data.events.find(e => e.group_id === g.id && R.eventState(e, now) === 'published' && ms(e.start) > now &&
        e.host_member_ids.length === 1 && e.host_member_ids[0] === user);
      if (solo) fail('sole_host', `You are the only host of ${solo.title} (${solo.id}).`);
      released = T.releaseMember(data, g.id, user, ctx.virtual_now, 'left_group');
    }
    T.reviseMembership(data, m, ctx.virtual_now, 'left', m.role, m.state === 'pending' ? 'withdrew_request' : 'left');
    return {membership: {group_id: g.id, state: 'left', role: null}, released};
  },
  'profile.update'(ctx, data, args) {
    if (args.display_name === undefined && args.bio === undefined) fail('invalid_arguments', 'Nothing to change.');
    const me = R.member(data, data.user_member_id);
    if (args.display_name !== undefined) me.display_name = args.display_name;
    if (args.bio !== undefined) me.bio = args.bio;
    return {profile: {member_id: me.id, display_name: me.display_name, bio: me.bio}};
  },
  'events.preview_change'(ctx, data, args, now) {
    const plan = P.eventPlan(data, args, now, data.user_member_id);
    plan.request = copy(args);
    return {preview: storePreview(ctx, data, plan, P.eventSummary(data, plan), now)};
  },
  'events.confirm_change'(ctx, data, args, now) {
    const {plan} = usePreview(ctx, data, args.preview_id, 'event', now, request => P.eventPlan(data, request, now, data.user_member_id));
    const noticeId = applyEventPlan(data, plan, ctx.virtual_now, data.user_member_id);
    const e = plan.event_id ? R.event(data, plan.event_id) : data.events.at(-1);
    return {event: V.eventDetail(data, e, now, data.user_member_id),
      receipt: {change: plan.change, event_id: e.id, at: ctx.virtual_now, recipient_count: plan.recipients.length, notify: plan.notify,
        rsvps_to_reconfirm: plan.reconfirm.length, notice_id: noticeId}};
  },
  'rsvps.preview'(ctx, data, args, now) {
    const plan = P.rsvpPlan(data, args, now, data.user_member_id);
    plan.request = copy(args);
    return {preview: storePreview(ctx, data, plan, P.rsvpSummary(data, plan, now), now)};
  },
  'rsvps.confirm'(ctx, data, args, now) {
    const {plan} = usePreview(ctx, data, args.preview_id, 'rsvp', now, request => P.rsvpPlan(data, request, now, data.user_member_id));
    const out = applyRsvpPlan(data, plan, ctx.virtual_now);
    return {rsvp: out.rsvp, receipt: {event_id: plan.event_id, outcome: plan.outcome, at: ctx.virtual_now, notice_id: out.notice_id}};
  },
  'posts.preview'(ctx, data, args, now) {
    const plan = P.postPlan(data, args, now, data.user_member_id);
    plan.request = copy(args);
    return {preview: storePreview(ctx, data, plan, P.postSummary(data, plan), now)};
  },
  'posts.publish'(ctx, data, args, now) {
    const {plan} = usePreview(ctx, data, args.preview_id, 'post', now, request => P.postPlan(data, request, now, data.user_member_id));
    const out = applyPostPlan(data, plan, ctx.virtual_now, data.user_member_id);
    return {post: V.postView(data, out.post, now),
      receipt: {post_id: out.post.id, mode: plan.mode, at: ctx.virtual_now, recipient_count: plan.recipients.length, notice_id: out.notice_id}};
  },
  'posts.delete'(ctx, data, args, now) {
    const user = data.user_member_id, p = P.visiblePost(data, args.post_id, user);
    if (p.author_member_id !== user && R.rank(R.roleOf(data, p.group_id, user)) < R.rank('co_organizer')) {
      fail('role_required', 'Only the author, co-organizers and organizers can delete a post.');
    }
    if (V.postLocked(data, p, now)) fail('post_locked', 'Announcements, and posts on a past or cancelled event, cannot be deleted.');
    p.state = 'deleted';
    p.updated_at = ctx.virtual_now;
    p.revisions.push({seq: seq(data), at: ctx.virtual_now, state: 'deleted', text: p.text});
    return {post: {id: p.id, state: p.state, deleted_at: ctx.virtual_now,
      note: 'Deleted. Anything already delivered stays delivered.'}};
  },
  'signups.claim'(ctx, data, args, now) {
    const user = data.user_member_id, s = visibleSheet(data, args.sheet_id, user);
    R.requireMember(data, R.event(data, s.event_id).group_id, user);
    if (R.sheetLocked(data, s, now)) fail('sheet_locked', `The sheet locked at ${s.lock_at}.`);
    const slot = R.byId(s.slots, args.slot_id, 'not_found', 'Slot');
    if (slot.claims.includes(user)) fail('invalid_state', 'You already hold this slot.');
    if (slot.claims.length >= slot.quantity) fail('slot_taken', `${slot.label} is full.`);
    slot.claims.push(user);
    s.revisions.push({seq: seq(data), at: ctx.virtual_now, action: 'claim', slot_id: slot.id, member_id: user, reason: 'claim'});
    return {sheet: V.sheetView(data, s, now, user)};
  },
  'signups.release'(ctx, data, args, now) {
    const user = data.user_member_id, s = visibleSheet(data, args.sheet_id, user);
    if (R.sheetLocked(data, s, now)) fail('sheet_locked', `The sheet locked at ${s.lock_at}.`);
    const slot = R.byId(s.slots, args.slot_id, 'not_found', 'Slot');
    if (!slot.claims.includes(user)) fail('not_your_slot', 'You do not hold this slot.');
    const w = pendingSwapOn(data, s.id, user, slot.id);
    if (w) fail('swap_pending', `Swap ${w.id} involves this claim; answer or withdraw it first.`);
    slot.claims = slot.claims.filter(m => m !== user);
    s.revisions.push({seq: seq(data), at: ctx.virtual_now, action: 'release', slot_id: slot.id, member_id: user, reason: 'release'});
    return {sheet: V.sheetView(data, s, now, user)};
  },
  'signups.swap_propose'(ctx, data, args, now) {
    const user = data.user_member_id, s = visibleSheet(data, args.sheet_id, user);
    if (R.sheetLocked(data, s, now)) fail('sheet_locked', `The sheet locked at ${s.lock_at}.`);
    const give = R.byId(s.slots, args.give_slot, 'not_found', 'Slot'), want = R.byId(s.slots, args.want_slot, 'not_found', 'Slot');
    const other = R.member(data, args.member_id);
    if (other.id === user || give.id === want.id) fail('invalid_arguments', 'A swap is between two different slots and two members.');
    if (!give.claims.includes(user)) fail('not_your_slot', `You do not hold ${give.label}.`);
    if (!want.claims.includes(other.id)) fail('not_your_slot', `${other.display_name} does not hold ${want.label}.`);
    const pending = pendingSwapOn(data, s.id, user, give.id) || pendingSwapOn(data, s.id, other.id, want.id);
    if (pending) fail('swap_pending', `Swap ${pending.id} already involves one of these claims.`);
    const g = T.groupOf(data, R.event(data, s.event_id));
    const w = {id: nextId(data.swaps, 'sw'), sheet_id: s.id, from_member_id: user, to_member_id: other.id, give_slot: give.id,
      want_slot: want.id, state: 'proposed', proposed_at: ctx.virtual_now, expires_at: iso(R.swapEnds(s, now), g.utc_offset), decided_at: null};
    data.swaps.push(w);
    deliver(data, {at: ctx.virtual_now, recipients: [other.id], object_type: 'swap', object_id: w.id, channel: 'email', reason: 'swap_proposed'});
    return {swap: V.swapView(data, w)};
  },
  'signups.swap_answer'(ctx, data, args, now) {
    const user = data.user_member_id;
    const w = data.swaps.find(x => x.id === args.swap_id && (x.from_member_id === user || x.to_member_id === user));
    if (!w) fail('not_found', `Swap ${args.swap_id} does not exist.`);
    const s = R.sheet(data, w.sheet_id);
    liveSwap(data, w, now);
    if (args.answer === 'withdraw' ? w.from_member_id !== user : w.to_member_id !== user) {
      fail('invalid_arguments', args.answer === 'withdraw' ? 'Only the member who proposed a swap can withdraw it.' : 'Only the member asked can accept or decline.');
    }
    if (args.answer === 'accept') {
      if (R.sheetLocked(data, s, now)) fail('sheet_locked', `The sheet locked at ${s.lock_at}.`);
      exchange(data, w, ctx.virtual_now);
    }
    w.state = {accept: 'accepted', decline: 'declined', withdraw: 'withdrawn'}[args.answer];
    w.decided_at = ctx.virtual_now;
    const other = w.from_member_id === user ? w.to_member_id : w.from_member_id;
    deliver(data, {at: ctx.virtual_now, recipients: [other], object_type: 'swap', object_id: w.id, channel: 'email', reason: 'swap_' + w.state});
    return {swap: V.swapView(data, w), sheet: V.sheetView(data, s, now, user)};
  },
};

function handleTool(ctx, data, name, args) {
  if (!name.startsWith(PREFIX)) fail('unknown_tool', 'Unknown Stoopside operation.');
  const op = name.slice(PREFIX.length), now = ms(ctx.virtual_now);
  const {expected_version, request_id, ...input} = args;
  if (READS[op]) {
    // Compute due time effects on a copy so that reads never change state.
    const view = settle({...ctx, log: undefined}, copy(data));
    return {data, result: READS[op](view, input, now)};
  }
  if (!WRITES[op]) fail('unknown_tool', 'Unknown Stoopside operation.');
  settle(ctx, data);
  const result = WRITES[op](ctx, data, input, now);
  log(ctx, 'stoopside.' + op, {request_id: request_id || null});
  return {data, result};
}

module.exports = {handleTool, READS, WRITES, applyEventPlan, applyPostPlan, exchange};
