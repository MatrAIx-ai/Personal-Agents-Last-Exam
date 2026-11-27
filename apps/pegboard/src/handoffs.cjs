'use strict';
// W3 and W4: getting a shift covered (cover, trade, release), answering a coworker's
// request, and picking up an open shift. A shift stays with its assignee until a handoff
// that names it is approved; nothing changes hands while anything is pending.
const { fail, ms, isoAt, nextId } = require('./util.cjs');
const { index, objects, zoneOf, shiftState, handoffState, handoffPending, cutoffOf, pendingFor } = require('./model.cjs');
const { eligibility } = require('./rules.cjs');
const { presentHandoff, nameOf } = require('./present.cjs');
const { record, page } = require('./notifications.cjs');
const { needShift, needPerson } = require('./schedule.cjs');

const WORDS = {
  not_qualified: (name, check, shift, ix) => name + ' does not hold the position ' + ix.positions.get(shift.position_id).name + '.',
  overlap: name => name + ' already works a shift that overlaps this one.',
  short_rest: (name, check) => name + ' would have ' + Math.min(...[check.rest.before_hours, check.rest.after_hours].filter(x => x !== null)) + ' hours of rest next to this shift; the workplace minimum is ' + check.rest.minimum + '.',
  over_hours: (name, check) => name + ' would have ' + check.hours.after + ' hours that week; the cap is ' + check.hours.cap + '.',
};
// Refuse with the first failing rule, in the order the check reports them.
function allow(data, ix, personId, shift, giveUpId) {
  const check = eligibility(data, ix, personId, shift, giveUpId);
  if (check.eligible) return;
  const code = check.blocks[0], name = personId === data.owner_person_id ? 'The account holder' : nameOf(ix, personId);
  fail(code, WORDS[code](name, check, shift, ix) + ' Use eligibility.check to see every rule.');
}
function mine(data, shift) {
  if (shiftState(shift) !== 'assigned' || shift.assignee !== data.owner_person_id) fail('not_yours', 'Shift ' + shift.id + ' is not assigned to the account holder.');
}
function inTime(data, shifts, now) {
  if (shifts.some(s => now >= ms(s.start))) fail('too_late', 'A shift that has started cannot be handed over.');
  if (now >= cutoffOf(data, shifts)) fail('too_late', 'The cut-off has passed: a handoff must be asked for at least ' + data.workplace.policy.handoff_cutoff_hours + ' hours before the shift starts.');
}
function free(data, shifts, now) {
  for (const s of shifts) { const h = pendingFor(data, s.id, now); if (h) fail('already_requested', 'Shift ' + s.id + ' already has a pending handoff (' + h.id + ').'); }
}

// One more step of a handoff: the new state and a history row.
function step(handoff, row) {
  handoff.state = row.state;
  handoff.history.push(row);
}
// Move the shifts of an approved handoff. Each move is one history row on the shift.
function settle(data, ix, handoff, at, cause) {
  const shift = ix.shifts.get(handoff.shift_id), other = handoff.other_shift_id === null ? null : ix.shifts.get(handoff.other_shift_id);
  const move = (s, to) => { s.history.push({ at, by: 'handoff', handoff_id: handoff.id, ...cause, change: { assignee: { from: s.assignee, to } } }); s.assignee = to; };
  if (handoff.kind === 'cover') move(shift, handoff.counterpart_id);
  else if (handoff.kind === 'trade') { move(shift, handoff.counterpart_id); move(other, handoff.requester_id); }
  else if (handoff.kind === 'release') move(shift, null);
  else move(shift, handoff.requester_id);
  return other ? [shift, other] : [shift];
}

function open(ctx, data, args, spec) {
  const at = ctx.virtual_now, firstState = spec.state;
  const handoff = {
    id: nextId(objects(data), 'ho-'), kind: spec.kind, requester_id: data.owner_person_id, counterpart_id: spec.counterpart ?? null,
    shift_id: spec.shift.id, other_shift_id: spec.other ? spec.other.id : null, ...(args.message !== undefined ? { message: args.message } : {}),
    state: firstState, cutoff_at: isoAt(cutoffOf(data, spec.other ? [spec.shift, spec.other] : [spec.shift]), zoneOf(data)), created_at: at,
    history: [{ at, actor: 'me', action: 'requested', state: firstState, request_id: args.request_id }],
  };
  data.handoffs.push(handoff);
  record(data, { at, actor: 'agent', action: 'handoffs.' + spec.kind, object_id: handoff.id, request_id: args.request_id, details: { shift_id: handoff.shift_id, ...(handoff.other_shift_id ? { other_shift_id: handoff.other_shift_id } : {}), state: handoff.state } });
  return handoff;
}
const result = (ctx, data, handoff) => ({ id: handoff.id, handoff: presentHandoff(data, index(data), handoff, ms(ctx.virtual_now)) });

function cover(ctx, data, args) {
  const ix = index(data), now = ms(ctx.virtual_now), shift = needShift(ix, args.id), to = needPerson(ix, args.to_person_id);
  if (to.id === data.owner_person_id) fail('invalid_arguments', 'A handoff to yourself changes nothing.');
  mine(data, shift); inTime(data, [shift], now); free(data, [shift], now);
  allow(data, ix, to.id, shift, null);
  return result(ctx, data, open(ctx, data, args, { kind: 'cover', shift, counterpart: to.id, state: 'awaiting_coworker' }));
}

function trade(ctx, data, args) {
  const ix = index(data), now = ms(ctx.virtual_now), me = data.owner_person_id, shift = needShift(ix, args.id), theirs = needShift(ix, args.their_shift_id);
  mine(data, shift);
  if (shiftState(theirs) !== 'assigned' || theirs.assignee === me) fail('not_theirs', 'Shift ' + theirs.id + ' is not assigned to a coworker.');
  inTime(data, [shift, theirs], now); free(data, [shift, theirs], now);
  allow(data, ix, theirs.assignee, shift, theirs.id);
  allow(data, ix, me, theirs, shift.id);
  return result(ctx, data, open(ctx, data, args, { kind: 'trade', shift, other: theirs, counterpart: theirs.assignee, state: 'awaiting_coworker' }));
}

function release(ctx, data, args) {
  const ix = index(data), now = ms(ctx.virtual_now), shift = needShift(ix, args.id);
  mine(data, shift); inTime(data, [shift], now); free(data, [shift], now);
  return result(ctx, data, open(ctx, data, args, { kind: 'release', shift, state: 'awaiting_manager' }));
}

function pickup(ctx, data, args) {
  const ix = index(data), now = ms(ctx.virtual_now), shift = needShift(ix, args.id);
  if (shiftState(shift) !== 'open') fail('not_open', 'Shift ' + shift.id + ' is not open.');
  inTime(data, [shift], now); free(data, [shift], now);
  allow(data, ix, data.owner_person_id, shift, null);
  const needsManager = data.workplace.policy.manager_approval;
  const handoff = open(ctx, data, args, { kind: 'pickup', shift, state: needsManager ? 'awaiting_manager' : 'approved' });
  if (!needsManager) settle(data, ix, handoff, ctx.virtual_now, { request_id: args.request_id });
  return result(ctx, data, handoff);
}

function respond(ctx, data, args) {
  const ix = index(data), now = ms(ctx.virtual_now), me = data.owner_person_id, handoff = ix.handoffs.get(args.id), at = ctx.virtual_now;
  if (!handoff) fail('not_found', 'No handoff ' + args.id + '. Use handoffs.list.');
  const state = handoffState(handoff, now);
  if (state !== 'awaiting_me') fail('invalid_state', 'Handoff ' + handoff.id + ' is ' + state + '; it is not waiting for your answer.');
  const note = args.message !== undefined ? { note: args.message } : {};
  if (args.answer === 'decline') step(handoff, { at, actor: 'me', action: 'declined', state: 'declined', request_id: args.request_id, ...note });
  else {
    const theirs = ix.shifts.get(handoff.shift_id), given = handoff.other_shift_id === null ? null : ix.shifts.get(handoff.other_shift_id);
    allow(data, ix, me, theirs, given ? given.id : null);
    if (given) allow(data, ix, handoff.requester_id, given, theirs.id);
    const needsManager = data.workplace.policy.manager_approval;
    step(handoff, { at, actor: 'me', action: 'accepted', state: needsManager ? 'awaiting_manager' : 'approved', request_id: args.request_id, ...note });
    if (!needsManager) settle(data, ix, handoff, at, { request_id: args.request_id });
  }
  record(data, { at, actor: 'agent', action: 'handoffs.respond', object_id: handoff.id, request_id: args.request_id, details: { answer: args.answer, state: handoff.state } });
  return result(ctx, data, handoff);
}

function cancel(ctx, data, args) {
  const ix = index(data), now = ms(ctx.virtual_now), handoff = ix.handoffs.get(args.id);
  if (!handoff) fail('not_found', 'No handoff ' + args.id + '. Use handoffs.list.');
  const state = handoffState(handoff, now);
  if (handoff.requester_id !== data.owner_person_id) fail('invalid_state', 'Handoff ' + handoff.id + ' was asked for by a coworker; decline it with handoffs.respond.');
  if (!handoffPending(handoff, now)) fail('invalid_state', 'Handoff ' + handoff.id + ' is ' + state + '; only a pending handoff can be cancelled.');
  step(handoff, { at: ctx.virtual_now, actor: 'me', action: 'cancelled', state: 'cancelled', request_id: args.request_id });
  record(data, { at: ctx.virtual_now, actor: 'agent', action: 'handoffs.cancel', object_id: handoff.id, request_id: args.request_id, details: { state: handoff.state } });
  return result(ctx, data, handoff);
}

const CLOSED = (handoff, now) => !handoffPending(handoff, now);
function list(ctx, data, args) {
  const ix = index(data), now = ms(ctx.virtual_now);
  if (args.id !== undefined) needShift(ix, args.id);
  const all = data.handoffs.map((h, order) => ({ h, order })).filter(({ h }) => {
    if (args.kind !== undefined && h.kind !== args.kind) return false;
    if (args.id !== undefined && h.shift_id !== args.id && h.other_shift_id !== args.id) return false;
    return args.state !== undefined ? handoffState(h, now) === args.state : args.include_closed || !CLOSED(h, now);
  }).sort((a, b) => ms(b.h.created_at) - ms(a.h.created_at) || b.order - a.order);
  const { items, next_cursor } = page(args, all);
  return { handoffs: items.map(({ h }) => presentHandoff(data, ix, h, now)), next_cursor };
}

function get(ctx, data, args) {
  const ix = index(data), handoff = ix.handoffs.get(args.id);
  if (!handoff) fail('not_found', 'No handoff ' + args.id + '. Use handoffs.list.');
  return { handoff: presentHandoff(data, ix, handoff, ms(ctx.virtual_now)) };
}

module.exports = { cover, trade, release, pickup, respond, cancel, list, get, step, settle };
