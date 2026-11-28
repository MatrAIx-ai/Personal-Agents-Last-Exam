'use strict';
// Scenario events, applied by Infra through env.apply_event at the event's time.
// Other members act only through these. Stoopside has no scheduler: time
// effects due before the event are settled first, then the event applies.
const {fail} = require('./domain-utils.cjs');
const {log} = require('./diagnostics.cjs');
const R = require('./rules.cjs');
const P = require('./plans.cjs');
const T = require('./transitions.cjs');
const {ms, label} = require('./clock.cjs');
const {settle} = require('./settle.cjs');
const {notify, deliver, seq} = require('./notices.cjs');
const {applyEventPlan, applyPostPlan, exchange} = require('./operations.cjs');

const known = (fn, ...args) => {
  try { return fn(...args); } catch (e) { fail('invalid_event', e.message); }
};
const other = (data, id) => {
  const m = known(R.member, data, id);
  if (m.id === data.user_member_id) fail('invalid_event', 'Scenario events act for other members; the user acts through tools.');
  return m;
};

// Runs a business rule check and reports its failure as invalid_event.
function rule(fn) {
  try { return fn(); } catch (e) { fail('invalid_event', `${e.code || 'error'}: ${e.message}`); }
}

const HANDLERS = {
  'stoopside.member.joined'(ctx, data, p) {
    const g = known(R.group, data, p.group_id), m = other(data, p.member_id);
    if (R.isMember(data, g.id, m.id)) fail('invalid_event', `${m.id} is already a member.`);
    if (p.display_name !== undefined) m.display_name = p.display_name;
    T.joinMembership(data, g.id, m.id, ctx.virtual_now, 'member', 'joined');
  },
  'stoopside.member.removed'(ctx, data, p) {
    const g = known(R.group, data, p.group_id), m = known(R.member, data, p.member_id), ms_ = R.membership(data, g.id, m.id);
    if (!ms_ || ms_.state !== 'member') fail('invalid_event', `${m.id} is not a member.`);
    if (ms_.role === 'organizer' && !data.memberships.some(x => x.group_id === g.id && x.state === 'member' && x.role === 'organizer' && x.member_id !== m.id)) {
      fail('invalid_event', 'The only organizer cannot be removed.');
    }
    T.releaseMember(data, g.id, m.id, ctx.virtual_now, 'removed');
    T.reviseMembership(data, ms_, ctx.virtual_now, 'removed', ms_.role, 'removed');
    if (m.id === data.user_member_id) {
      notify(data, {at: ctx.virtual_now, kind: 'membership_removed', object_type: 'group', object_id: g.id,
        title: `You were removed from ${g.name}`, fields: [['Group', g.name], ['Effect', 'Your upcoming RSVPs are now no and your sign-up slots were released.']]});
    }
  },
  'stoopside.membership.decided'(ctx, data, p) {
    const g = known(R.group, data, p.group_id), user = data.user_member_id, m = R.membership(data, g.id, user);
    if (!m || m.state !== 'pending') fail('invalid_event', 'There is no pending request to decide.');
    T.reviseMembership(data, m, ctx.virtual_now, p.decision, 'member', 'decided');
    deliver(data, {at: ctx.virtual_now, recipients: [user], object_type: 'membership', object_id: m.id, channel: 'email', reason: 'membership_decided'});
    notify(data, {at: ctx.virtual_now, kind: 'membership_decided', object_type: 'group', object_id: g.id,
      title: p.decision === 'member' ? `You joined ${g.name}` : `Your request to join ${g.name} was declined`,
      fields: [['Group', g.name], ['Decision', p.decision], ['Decided', label(ms(ctx.virtual_now), g)]]});
  },
  'stoopside.rsvp.changed_by_other'(ctx, data, p, now) {
    const e = known(R.event, data, p.event_id), m = other(data, p.member_id);
    if (!R.isMember(data, e.group_id, m.id)) fail('invalid_event', `${m.id} is not a member of the event's group.`);
    const r = R.rsvpFor(data, e.id, m.id), current = r ? r.answer : null;
    const at = ctx.virtual_now;
    if (p.answer === 'no') {
      if (!r || current === 'no') fail('invalid_event', 'There is no RSVP to change to no.');
      if (R.eventState(e, now) !== 'published' || now >= ms(e.start)) fail('invalid_event', 'The event is not open for changes.');
      const held = R.HOLDING.has(current);
      T.setRsvp(data, r, at, {answer: 'no', guests: 0, children: 0}, 'changed_by_member');
      if (held) T.allocate(data, e, at);
      return;
    }
    if (p.guests > e.guest_limit) fail('invalid_event', 'guest_limit_exceeded');
    const need = 1 + p.guests + p.children, held = r && R.HOLDING.has(current) ? R.places(r) : 0;
    const free = e.capacity - R.taken(data, e);
    if (current === 'expired') fail('invalid_event', 'claim_expired');
    if (current !== 'offered' && current !== 'needs_reconfirm') rule(() => R.rsvpWindow(e, now));
    const answer = need <= held + free && current !== 'waitlist' ? 'yes' : 'waitlist';
    const row = r || T.newRsvp(data, e, m.id, at);
    T.setRsvp(data, row, at, {answer, guests: p.guests, children: p.children}, 'changed_by_member');
    if (held > (answer === 'yes' ? need : 0) || answer === 'waitlist') T.allocate(data, e, at);
  },
  'stoopside.event.changed_by_cohost'(ctx, data, p, now) {
    const e = known(R.event, data, p.event_id);
    const actor = p.member_id || e.host_member_ids.find(id => id !== data.user_member_id);
    if (!actor || actor === data.user_member_id) fail('invalid_event', 'A co-host change needs another host.');
    const fields = Object.fromEntries(P.EVENT_FIELDS.filter(k => p[k] !== undefined).map(k => [k, p[k]]));
    const plan = rule(() => P.eventPlan(data, {change: p.change, event_id: e.id, fields, notify: p.notify}, now, actor));
    applyEventPlan(data, plan, ctx.virtual_now, actor);
  },
  'stoopside.signup.claimed_by_other'(ctx, data, p, now) {
    const s = known(R.sheet, data, p.sheet_id), m = other(data, p.member_id), slot = known(R.byId, s.slots, p.slot_id, 'not_found', 'Slot');
    if (R.sheetLocked(data, s, now)) fail('invalid_event', 'sheet_locked');
    if (slot.claims.includes(m.id)) fail('invalid_event', 'The member already holds this slot.');
    if (slot.claims.length >= slot.quantity) fail('invalid_event', 'slot_taken');
    slot.claims.push(m.id);
    s.revisions.push({seq: seq(data), at: ctx.virtual_now, action: 'claim', slot_id: slot.id, member_id: m.id, reason: 'claimed_by_other'});
  },
  'stoopside.signup.released_by_other'(ctx, data, p, now) {
    const s = known(R.sheet, data, p.sheet_id), m = other(data, p.member_id), slot = known(R.byId, s.slots, p.slot_id, 'not_found', 'Slot');
    if (R.sheetLocked(data, s, now)) fail('invalid_event', 'sheet_locked');
    if (!slot.claims.includes(m.id)) fail('invalid_event', 'not_your_slot');
    if (data.swaps.some(w => w.sheet_id === s.id && w.state === 'proposed' &&
      ((w.from_member_id === m.id && w.give_slot === slot.id) || (w.to_member_id === m.id && w.want_slot === slot.id)))) {
      fail('invalid_event', 'swap_pending');
    }
    slot.claims = slot.claims.filter(x => x !== m.id);
    s.revisions.push({seq: seq(data), at: ctx.virtual_now, action: 'release', slot_id: slot.id, member_id: m.id, reason: 'released_by_other'});
  },
  'stoopside.swap.proposed_by_other'(ctx, data, p, now) {
    if (data.swaps.some(w => w.id === p.swap_id)) fail('invalid_event', 'Swap ID already exists.');
    const s = known(R.sheet, data, p.sheet_id), from = other(data, p.from_member), user = data.user_member_id;
    const give = known(R.byId, s.slots, p.give_slot, 'not_found', 'Slot'), want = known(R.byId, s.slots, p.want_slot, 'not_found', 'Slot');
    if (R.sheetLocked(data, s, now)) fail('invalid_event', 'sheet_locked');
    if (!give.claims.includes(from.id) || !want.claims.includes(user)) fail('invalid_event', 'not_your_slot');
    if (data.swaps.some(w => w.sheet_id === s.id && w.state === 'proposed' &&
      [[w.from_member_id, w.give_slot], [w.to_member_id, w.want_slot]].some(([a, b]) => (a === from.id && b === give.id) || (a === user && b === want.id)))) {
      fail('invalid_event', 'swap_pending');
    }
    const e = R.event(data, s.event_id), g = R.group(data, e.group_id);
    const w = {id: p.swap_id, sheet_id: s.id, from_member_id: from.id, to_member_id: user, give_slot: give.id, want_slot: want.id,
      state: 'proposed', proposed_at: ctx.virtual_now, expires_at: require('./clock.cjs').iso(R.swapEnds(s, now), g.utc_offset), decided_at: null};
    data.swaps.push(w);
    deliver(data, {at: ctx.virtual_now, recipients: [user], object_type: 'swap', object_id: w.id, channel: 'email', reason: 'swap_proposed'});
    notify(data, {at: ctx.virtual_now, kind: 'swap_proposed', object_type: 'swap', object_id: w.id,
      title: `${from.display_name} asks to swap ${give.label} for your ${want.label}`,
      fields: [['Event', `${e.title} (${e.id})`], ['Sheet', `${s.title} (${s.id})`], ['They give you', give.label], ['They want', want.label],
        ['Answer by', label(ms(w.expires_at), g)], ['Swap', w.id]]});
  },
  'stoopside.swap.answered'(ctx, data, p, now) {
    const w = data.swaps.find(x => x.id === p.swap_id);
    if (!w || w.from_member_id !== data.user_member_id) fail('invalid_event', 'Unknown swap proposed by the user.');
    if (w.state !== 'proposed' || now >= ms(w.expires_at)) fail('invalid_event', `Swap ${w.id} is no longer open.`);
    const s = R.sheet(data, w.sheet_id), e = R.event(data, s.event_id), g = R.group(data, e.group_id);
    if (p.answer === 'accepted') {
      if (R.sheetLocked(data, s, now)) fail('invalid_event', 'sheet_locked');
      rule(() => exchange(data, w, ctx.virtual_now));
    }
    w.state = p.answer;
    w.decided_at = ctx.virtual_now;
    deliver(data, {at: ctx.virtual_now, recipients: [w.from_member_id], object_type: 'swap', object_id: w.id, channel: 'email', reason: 'swap_' + p.answer});
    notify(data, {at: ctx.virtual_now, kind: 'swap_answered', object_type: 'swap', object_id: w.id,
      title: `Swap ${p.answer}: ${R.member(data, w.to_member_id).display_name} ${p.answer} your swap on ${s.title}`,
      fields: [['Event', `${e.title} (${e.id})`], ['Swap', w.id], ['You gave', w.give_slot], ['You asked for', w.want_slot], ['Answer', p.answer], ['When', label(ms(ctx.virtual_now), g)]]});
  },
  'stoopside.post.created_by_other'(ctx, data, p, now) {
    if (data.posts.some(x => x.id === p.post_id)) fail('invalid_event', 'Post ID already exists.');
    const m = other(data, p.member_id);
    const args = {group_id: p.group_id, kind: p.kind, audience: p.audience, event_id: p.event_ref, parent_id: p.parent_id, text: p.text};
    const plan = rule(() => P.postPlan(data, args, now, m.id));
    applyPostPlan(data, plan, ctx.virtual_now, m.id, p.post_id);
  },
};

function applyEvent(ctx, data, event) {
  const handler = HANDLERS[event.operation];
  if (!handler) fail('invalid_event', 'Unsupported operation.');
  settle(ctx, data);
  handler(ctx, data, event.payload, ms(ctx.virtual_now));
  log(ctx, 'stoopside.event', {event_id: event.event_id, operation: event.operation});
  return data;
}

module.exports = {applyEvent, HANDLERS};
