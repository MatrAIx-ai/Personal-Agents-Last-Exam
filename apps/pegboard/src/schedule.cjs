'use strict';
// W1: the posted schedule, the team, the workplace policy, weekly hours and the advance
// check of who may take a shift. Everything here is a read.
const { fail, ms, isoAt, localDate, weekStartOf, addDays } = require('./util.cjs');
const { index, zoneOf, capOf, shiftState, cutoffOf, pendingFor } = require('./model.cjs');
const { byStart, eligibility, personalFlags, flagsOfAccount, weekSummary } = require('./rules.cjs');
const { presentShift, presentShiftDetail } = require('./present.cjs');
const { page } = require('./notifications.cjs');

function needShift(ix, id) {
  const shift = ix.shifts.get(id);
  if (!shift) fail('not_found', 'No shift ' + id + '. Use shifts.list to find a shift ID.');
  return shift;
}
function needPerson(ix, id) {
  const person = ix.people.get(id);
  if (!person) fail('not_found', 'No person ' + id + '. Use team.list.');
  return person;
}
function window(args) {
  const start = ms(args.start), end = ms(args.end);
  if (!(end > start)) fail('invalid_window', 'end must be after start.');
  return { start, end };
}
const presentPerson = (data, person) => ({ ...person, is_me: person.id === data.owner_person_id, cap: capOf(data, person) });

function workplace(ctx, data) {
  return { workplace: data.workplace, me: presentPerson(data, index(data).people.get(data.owner_person_id)) };
}

function team(ctx, data, args) {
  const ix = index(data);
  if (args.position_id !== undefined && !ix.positions.has(args.position_id)) fail('not_found', 'No position ' + args.position_id + '. Use workplace.get.');
  return { people: data.people.filter(p => args.position_id === undefined || p.position_ids.includes(args.position_id)).map(p => presentPerson(data, p)) };
}

function list(ctx, data, args) {
  const ix = index(data), now = ms(ctx.virtual_now), { start, end } = window(args), me = data.owner_person_id;
  if (args.person_id !== undefined) needPerson(ix, args.person_id);
  if (args.position_id !== undefined && !ix.positions.has(args.position_id)) fail('not_found', 'No position ' + args.position_id + '. Use workplace.get.');
  if (args.location_id !== undefined && !ix.locations.has(args.location_id)) fail('not_found', 'No location ' + args.location_id + '. Use workplace.get.');
  const flags = flagsOfAccount(data, ix);
  const all = data.shifts.filter(s => {
    const state = shiftState(s), t = ms(s.start);
    if (t < start || t >= end) return false;
    if (state === 'cancelled' && !args.include_cancelled) return false;
    if (args.mine && !(state === 'assigned' && s.assignee === me)) return false;
    if (args.open && state !== 'open') return false;
    if (args.person_id !== undefined && !(state === 'assigned' && s.assignee === args.person_id)) return false;
    return (args.position_id === undefined || s.position_id === args.position_id) && (args.location_id === undefined || s.location_id === args.location_id);
  }).sort(byStart);
  const { items, next_cursor } = page(args, all, 50);
  return { shifts: items.map(s => presentShift(data, ix, s, now, flags)), next_cursor };
}

function get(ctx, data, args) {
  const ix = index(data);
  return { shift: presentShiftDetail(data, ix, needShift(ix, args.id), ms(ctx.virtual_now), flagsOfAccount(data, ix)) };
}

function hours(ctx, data, args) {
  const ix = index(data), zone = zoneOf(data), { start, end } = window(args), first = weekStartOf(localDate(start, zone), data.workplace.week_start);
  const last = weekStartOf(localDate(end - 1, zone), data.workplace.week_start), weeks = [];
  for (let w = first; w <= last; w = addDays(w, 7)) {
    if (weeks.length === 53) fail('invalid_window', 'The window covers more than 53 weeks.');
    weeks.push(weekSummary(data, ix, w));
  }
  return { weeks };
}

function check(ctx, data, args) {
  const ix = index(data), now = ms(ctx.virtual_now), me = data.owner_person_id, shift = needShift(ix, args.id);
  const person = needPerson(ix, args.person_id ?? me), give = args.give_shift_id === undefined ? null : needShift(ix, args.give_shift_id);
  const trade = give !== null && shiftState(shift) === 'assigned' && shift.assignee !== person.id;
  const named = give ? [shift, give] : [shift], cutoff = cutoffOf(data, named), pending = pendingFor(data, shift.id, now);
  return {
    ...eligibility(data, ix, person.id, shift, give ? give.id : null),
    shift_state: shiftState(shift), flags: person.id === me ? personalFlags(data, shift) : [], pending_handoff_id: pending ? pending.id : null,
    cutoff_at: isoAt(cutoff, zoneOf(data)), cutoff_passed: now >= cutoff || named.some(s => now >= ms(s.start)),
    other: trade ? eligibility(data, ix, shift.assignee, give, shift.id) : null,
  };
}

module.exports = { needShift, needPerson, workplace, team, list, get, hours, check };
