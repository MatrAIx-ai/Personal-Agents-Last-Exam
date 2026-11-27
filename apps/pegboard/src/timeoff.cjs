'use strict';
// W2: the weekly blocks when the account holder cannot work, and time off.
// A time-off request is the commitment; the manager's decision arrives as an event.
const { fail, ms, localDate, addDays, validDate, nextId, minutesOf } = require('./util.cjs');
const { index, objects, zoneOf, shiftDay, timeOffState } = require('./model.cjs');
const { assignedTo } = require('./rules.cjs');
const { presentTimeOff, blockOrder, dayText } = require('./present.cjs');
const { record } = require('./notifications.cjs');

const OPEN = ['pending', 'approved'];
const NEWEST = (a, b) => ms(b.requested_at) - ms(a.requested_at) || (a.id < b.id ? 1 : -1);

function getAvailability(ctx, data) { return { blocks: [...data.availability].sort(blockOrder) }; }

function updateAvailability(ctx, data, args) {
  const blocks = [...args.blocks].sort(blockOrder);
  blocks.forEach((b, i) => {
    if (minutesOf(b.end) <= minutesOf(b.start)) fail('invalid_arguments', 'The block on ' + b.weekday + ' ends before it starts.');
    const previous = blocks[i - 1];
    if (previous && previous.weekday === b.weekday && minutesOf(b.start) < minutesOf(previous.end)) fail('invalid_arguments', 'Two blocks on ' + b.weekday + ' overlap.');
  });
  data.availability = blocks;
  record(data, { at: ctx.virtual_now, actor: 'agent', action: 'availability.update', object_id: data.account_id, request_id: args.request_id, details: { blocks: blocks.length } });
  return { id: data.account_id, blocks };
}

function list(ctx, data, args) {
  const now = ms(ctx.virtual_now);
  const shown = data.time_off.filter(t => {
    const state = timeOffState(data, t, now);
    return args.state !== undefined ? state === args.state : args.include_closed || OPEN.includes(state);
  }).sort(NEWEST);
  return { time_off: shown.map(t => presentTimeOff(data, t, now)) };
}

function request(ctx, data, args) {
  const now = ms(ctx.virtual_now), zone = zoneOf(data), today = localDate(now, zone), policy = data.workplace.policy, { start, end } = args;
  if (!validDate(start) || !validDate(end)) fail('invalid_window', 'start and end must be calendar dates.');
  if (end < start) fail('invalid_window', 'end is before start.');
  if (start <= today) fail('invalid_window', 'The range has already started: the first day must be after today (' + today + ').');
  if (end > addDays(start, 29)) fail('invalid_window', 'A request can cover at most 30 days.');
  const earliest = addDays(today, policy.time_off_notice_days);
  if (start < earliest) fail('too_late', 'Time off needs ' + policy.time_off_notice_days + ' days of notice: the first day can be ' + earliest + ' at the earliest.');
  const held = assignedTo(data, data.owner_person_id).find(s => { const day = shiftDay(data, s); return day >= start && day <= end; });
  if (held) fail('shift_assigned', 'You hold shift ' + held.id + ' on ' + dayText(shiftDay(data, held)) + '. Get it covered, traded or released first.');
  const clash = data.time_off.find(t => OPEN.includes(timeOffState(data, t, now)) && t.start_date <= end && start <= t.end_date);
  if (clash) fail('conflict', 'These days overlap time-off entry ' + clash.id + ' (' + clash.start_date + ' to ' + clash.end_date + ').');
  const entry = {
    id: nextId(objects(data), 'to-'), start_date: start, end_date: end, ...(args.reason !== undefined ? { reason: args.reason } : {}),
    state: 'pending', requested_at: ctx.virtual_now, history: [{ at: ctx.virtual_now, actor: 'me', action: 'requested', state: 'pending', request_id: args.request_id }],
  };
  data.time_off.push(entry);
  record(data, { at: ctx.virtual_now, actor: 'agent', action: 'time_off.request', object_id: entry.id, request_id: args.request_id, details: { start_date: start, end_date: end } });
  return { id: entry.id, time_off: presentTimeOff(data, entry, now) };
}

function cancel(ctx, data, args) {
  const now = ms(ctx.virtual_now), entry = index(data).timeOff.get(args.id);
  if (!entry) fail('not_found', 'No time-off entry ' + args.id + '. Use time_off.list.');
  const state = timeOffState(data, entry, now), today = localDate(now, zoneOf(data));
  if (!(state === 'pending' || (state === 'approved' && today < entry.start_date))) fail('invalid_state', 'Entry ' + entry.id + ' is ' + state + (state === 'approved' ? ' and has begun' : '') + '; it cannot be cancelled.');
  entry.state = 'cancelled';
  entry.history.push({ at: ctx.virtual_now, actor: 'me', action: 'cancelled', state: 'cancelled', request_id: args.request_id });
  record(data, { at: ctx.virtual_now, actor: 'agent', action: 'time_off.cancel', object_id: entry.id, request_id: args.request_id });
  return { id: entry.id, time_off: presentTimeOff(data, entry, now) };
}

module.exports = { getAvailability, updateAvailability, list, request, cancel };
