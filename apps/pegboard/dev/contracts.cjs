'use strict';
// Single source for Pegboard's business contracts. `node dev/build.cjs` writes
// tools.json, schemas/seed.schema.json, schemas/events.schema.json and
// schemas/state.schema.json from this file; `--check` reports drift.
// Only keywords supported by the public schema validator are used.

const APP = 'pegboard';
const VERSION = '1.0.0';
const CORE_API = '1.2.0';

const WEEKDAY = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const KIND = ['cover', 'trade', 'release', 'pickup'];
// `expired` is never stored: a pending handoff or time-off entry reads expired once the clock reaches its cut-off.
const HANDOFF_STORED = ['awaiting_coworker', 'awaiting_me', 'awaiting_manager', 'approved', 'denied', 'declined', 'cancelled', 'void'];
const HANDOFF_STATE = [...HANDOFF_STORED, 'expired'];
const TIME_OFF_STORED = ['pending', 'approved', 'denied', 'cancelled'];
const TIME_OFF_STATE = [...TIME_OFF_STORED, 'expired'];
const FLAG = ['overlap', 'short_rest', 'over_hours', 'outside_availability', 'during_time_off'];
const BLOCK = ['not_qualified', 'overlap', 'short_rest', 'over_hours'];
const SHIFT_CHANGE = ['changed', 'assigned', 'unassigned', 'cancelled'];
const NOTIFICATION_KIND = ['schedule.published', 'shift.changed', 'open_shift.posted', 'handoff.received', 'handoff.updated', 'time_off.decided'];
// Pegboard has no clock event: time is the environment's (an event's own `at`, or Core's env.advance_time).
const EVENTS = ['schedule.published', 'shift.changed', 'shift.cancelled', 'handoff.received', 'handoff.answered', 'handoff.decided', 'handoff.withdrawn', 'time_off.decided'].map(x => APP + '.' + x);

// ---- builders -------------------------------------------------------------
const str = (min = 1, max = 200) => ({ type: 'string', minLength: min, maxLength: max });
// Record IDs use the character set Mail accepts for object references, so any record can be named in a notification.
const id = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$' };
const idArg = str(1, 100);
// Caller-chosen request and event IDs are stored as given.
const callRef = str(1, 100);
const ts = { type: 'string', format: 'date-time' };
const date = { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' };
const hhmm = { type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' };
const bool = { type: 'boolean' };
const number = { type: 'number' };
const int = (min, max) => ({ type: 'integer', minimum: min, ...(max === undefined ? {} : { maximum: max }) });
const num = (min, max) => ({ type: 'number', minimum: min, maximum: max });
const en = (...values) => ({ enum: values });
const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const arr = (items, extra = {}) => ({ type: 'array', items, ...extra });
const nullable = schema => ({ anyOf: [{ type: 'null' }, schema] });
const describe = (schema, description) => ({ ...schema, description });

// ---- stored records (seed / state data) -------------------------------------
const policy = obj({
  min_rest_hours: num(0, 24), max_weekly_hours: num(1, 168), handoff_cutoff_hours: num(0, 168),
  time_off_notice_days: int(0, 90), manager_approval: bool,
});
const location = obj({ id, name: str(1, 120) });
const position = obj({ id, name: str(1, 120), hourly_rate: num(0, 1000) });
const workplace = obj({
  id, name: str(1, 120), timezone: str(1, 64), week_start: en(...WEEKDAY), currency: { type: 'string', pattern: '^[A-Z]{3}$' }, policy,
  locations: arr(location, { minItems: 1, maxItems: 20 }), positions: arr(position, { minItems: 1, maxItems: 30 }),
});
const person = obj({
  id, name: str(1, 120), role: en('employee', 'manager'), position_ids: arr(id, { maxItems: 30, uniqueItems: true }),
  max_weekly_hours: nullable(num(1, 168)),
});
const week = obj({ week_start: date, posted_at: ts });
// One row for every change to a shift: who or what made it, and each changed field as {from, to}.
const fromTo = schema => obj({ from: schema, to: schema });
const shiftChange = obj({
  posted: obj({ from: { type: 'null' }, to: nullable(id) }), start: fromTo(ts), end: fromTo(ts), position_id: fromTo(id), location_id: fromTo(id),
  assignee: fromTo(nullable(id)), cancelled: fromTo(bool),
}, []);
const shiftHistory = obj({
  at: ts, by: en('schedule', 'manager', 'handoff'), event_id: callRef, request_id: callRef, handoff_id: id, changed_by: id,
  reason: str(1, 300), change: shiftChange,
}, ['at', 'by', 'change']);
const shift = obj({
  id, location_id: id, position_id: id, start: ts, end: ts, assignee: nullable(id), cancelled_at: ts,
  history: arr(shiftHistory, { maxItems: 200 }),
}, ['id', 'location_id', 'position_id', 'start', 'end', 'assignee', 'history']);
const block = obj({ weekday: en(...DAY), start: hhmm, end: hhmm });
// One row for every step of a handoff or a time-off entry, with the state after it.
const step = obj({
  at: ts, actor: en('me', 'coworker', 'manager'), action: str(1, 40), state: str(1, 40), request_id: callRef, event_id: callRef,
  person_id: id, note: str(1, 500),
}, ['at', 'actor', 'action', 'state']);
const timeOff = obj({
  id, start_date: date, end_date: date, reason: str(1, 300), state: en(...TIME_OFF_STORED), requested_at: ts, decided_at: ts,
  decided_by: id, note: str(1, 500), history: arr(step, { minItems: 1, maxItems: 50 }),
}, ['id', 'start_date', 'end_date', 'state', 'requested_at', 'history']);
// requester gives `shift_id` (cover, trade, release) or takes it (pickup); in a trade the counterpart gives `other_shift_id`.
const handoff = obj({
  id, kind: en(...KIND), requester_id: id, counterpart_id: nullable(id), shift_id: id, other_shift_id: nullable(id),
  message: str(1, 500), state: en(...HANDOFF_STORED), cutoff_at: ts, created_at: ts, decided_by: id, note: str(1, 500),
  history: arr(step, { minItems: 1, maxItems: 50 }),
}, ['id', 'kind', 'requester_id', 'counterpart_id', 'shift_id', 'other_shift_id', 'state', 'cutoff_at', 'created_at', 'history']);
const quietHours = obj({ enabled: bool, start: hhmm, end: hhmm });
const preferences = obj({ timezone: str(1, 64), quiet_hours: quietHours, email_notices: bool, open_shift_notices: bool });
// A week is named by its first date.
const notificationObject = obj({ type: en('week', 'shift', 'handoff', 'time_off'), id });
const notification = obj({
  id, seq: int(0), kind: en(...NOTIFICATION_KIND), created_at: ts, release_at: ts, object: notificationObject,
  shift_ids: arr(id, { maxItems: 300, uniqueItems: true }), change: en(...SHIFT_CHANGE), title: str(1, 200), body: str(1, 2000),
  cause: obj({ event_id: callRef }, []), wire: { type: 'object' },
}, ['id', 'kind', 'created_at', 'release_at', 'object', 'shift_ids', 'title', 'body']);
const activity = obj({
  seq: int(1), at: ts, actor: en('agent', 'event'), action: str(1, 80), object_id: str(1, 150),
  request_id: callRef, event_id: callRef, details: { type: 'object' },
}, ['seq', 'at', 'actor', 'action', 'object_id']);

const seed = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Pegboard workplace and account records',
  description: 'History accepted by env.load_seed and kept as App data. Workplace records (policy, locations, positions, people, posted weeks, shifts with their history) and one employee account (availability, time off, handoffs, preferences, notifications, activity). Everything in a seed has already happened. Time-based states are not stored: a shift carries its start and end, a handoff its cut-off, a time-off entry its first day and a notification its release time, and all are read against the environment clock.',
  ...obj({
    account_id: id, owner_person_id: id, workplace,
    people: arr(person, { minItems: 1, maxItems: 200 }), weeks: arr(week, { maxItems: 520 }), shifts: arr(shift, { maxItems: 5000 }),
    availability: arr(block, { maxItems: 21 }), time_off: arr(timeOff, { maxItems: 500 }), handoffs: arr(handoff, { maxItems: 2000 }),
    preferences, notifications: arr(notification, { maxItems: 5000 }), activity: arr(activity, { maxItems: 20000 }),
  }),
};

// ---- incoming events ------------------------------------------------------------
const envelope = (operation, payload) => obj({ event_id: str(1, 100), at: ts, operation: { const: operation }, payload });
const postedShift = obj({ shift_id: id, location_id: id, position_id: id, start: ts, end: ts, assignee: nullable(id) });
const events = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Pegboard incoming events',
  description: 'Events Infra may apply with env.apply_event: what managers and coworkers do. Each is handled at its own `at`. There is no clock event: Infra moves time with an event or with Core\'s env.advance_time, which runs no App code.',
  type: 'object',
  oneOf: [
    envelope(EVENTS[0], obj({ week_start: date, shifts: arr(postedShift, { minItems: 1, maxItems: 300 }), posted_by: id }, ['week_start', 'shifts'])),
    envelope(EVENTS[1], obj({
      shift_id: id, change: obj({ start: ts, end: ts, position_id: id, location_id: id, assignee: nullable(id) }, []), changed_by: id, reason: str(1, 300),
    }, ['shift_id', 'change', 'changed_by'])),
    envelope(EVENTS[2], obj({ shift_id: id, changed_by: id, reason: str(1, 300) }, ['shift_id', 'changed_by'])),
    envelope(EVENTS[3], obj({
      handoff_id: id, kind: en('cover', 'trade'), from_person_id: id, their_shift_id: id, your_shift_id: id, message: str(1, 500),
    }, ['handoff_id', 'kind', 'from_person_id', 'their_shift_id'])),
    envelope(EVENTS[4], obj({ handoff_id: id, answer: en('accept', 'decline'), message: str(1, 500) }, ['handoff_id', 'answer'])),
    envelope(EVENTS[5], obj({ handoff_id: id, decision: en('approve', 'deny'), decided_by: id, note: str(1, 500) }, ['handoff_id', 'decision', 'decided_by'])),
    envelope(EVENTS[6], obj({ handoff_id: id, message: str(1, 500) }, ['handoff_id'])),
    envelope(EVENTS[7], obj({ time_off_id: id, decision: en('approve', 'deny'), decided_by: id, note: str(1, 500) }, ['time_off_id', 'decision', 'decided_by'])),
  ],
};

// ---- tool results ---------------------------------------------------------------------
const version = obj({ epoch: int(1), revision: int(0) });
const flags = arr(en(...FLAG), { uniqueItems: true });
const shiftOut = obj({
  id, location_id: id, position_id: id, start: ts, end: ts, hours: num(0, 24), assignee: nullable(id), assignee_name: nullable(str(1, 120)),
  state: en('assigned', 'open', 'cancelled'), phase: en('upcoming', 'started', 'ended'), week_start: date, is_mine: bool, flags,
  pending_handoff_id: nullable(id), cutoff_at: ts,
});
const shiftDetail = obj({
  ...shiftOut.properties, location_name: str(1, 120), position_name: str(1, 120), hourly_rate: num(0, 1000),
  cancelled_at: nullable(ts), history: shift.properties.history,
});
const shiftBrief = obj({ id, start: ts, end: ts, hours: num(0, 24), position_id: id, location_id: id, assignee: nullable(id), state: en('assigned', 'open', 'cancelled') });
const personOut = obj({ ...person.properties, is_me: bool, cap: num(1, 168) });
const weekOut = obj({
  week_start: date, week_end: date, posted_at: nullable(ts), scheduled_hours: number, cap: number, hours_left: number, over_cap: bool,
  days_worked: int(0, 7), shift_ids: arr(id), estimated_pay: obj({ amount: number, currency: workplace.properties.currency, estimate: { const: true } }),
});
const hoursCheck = obj({ week_start: date, before: number, after: number, cap: number });
const restCheck = obj({ before_hours: nullable(number), after_hours: nullable(number), minimum: number });
const sideCheck = obj({ person_id: id, shift_id: id, eligible: bool, blocks: arr(en(...BLOCK), { uniqueItems: true }), hours: hoursCheck, rest: restCheck });
const eligibilityOut = {
  ...sideCheck.properties, shift_state: en('assigned', 'open', 'cancelled'), flags: arr(en('outside_availability', 'during_time_off'), { uniqueItems: true }),
  pending_handoff_id: nullable(id), cutoff_at: ts, cutoff_passed: bool, other: nullable(sideCheck),
};
const timeOffOut = obj({
  id, start_date: date, end_date: date, days: int(1), reason: nullable(str(1, 300)), state: en(...TIME_OFF_STATE), requested_at: ts,
  expires_at: ts, decided_at: nullable(ts), decided_by: nullable(id), note: nullable(str(1, 500)), history: timeOff.properties.history,
});
const handoffOut = obj({
  id, kind: en(...KIND), state: en(...HANDOFF_STATE), asked_by_me: bool, requester_id: id, counterpart_id: nullable(id),
  shift: shiftBrief, other_shift: nullable(shiftBrief), message: nullable(str(1, 500)), cutoff_at: ts, created_at: ts,
  decided_by: nullable(id), note: nullable(str(1, 500)), history: handoff.properties.history,
});
const notificationOut = obj({
  id, kind: en(...NOTIFICATION_KIND), state: en('held', 'released'), created_at: ts, release_at: ts, object: notificationObject,
  shift_ids: notification.properties.shift_ids, change: nullable(en(...SHIFT_CHANGE)), title: str(1, 200), body: str(1, 2000), email_copy: bool,
});
const preferencesOut = obj({ ...preferences.properties, in_quiet_hours: bool });
const workplaceOut = obj({ ...workplace.properties });

// ---- tool inputs --------------------------------------------------------------------------
const windowStart = describe(ts, 'Window start, ISO 8601 with a UTC offset.');
const windowEnd = describe(ts, 'Window end (exclusive), ISO 8601 with a UTC offset.');
const cursor = describe(str(1, 100), 'Opaque value from next_cursor of the previous page.');
const message = describe(str(1, 500), 'Short note stored with the handoff and shown to the other side.');
const write = { expected_version: describe(version, 'Version from the latest result you read. A stale version is rejected with stale_version.'), request_id: describe(str(1, 100), 'Unique ID for this write. Repeating it with the same input returns the stored result. This is Core\'s idempotency key, not a handoff ID.') };

const READ = 'pegboard.read', WRITE = 'pegboard.write';
const tool = (name, read_only, resource_target, description, input, required, output, outputRequired = Object.keys(output)) => ({
  name: APP + '.' + name, description, scope: read_only ? READ : WRITE, resource_target, read_only,
  input: { ...input, ...(read_only ? {} : write) },
  required: [...required, ...(read_only ? [] : ['expected_version', 'request_id'])],
  output, outputRequired,
});
const ELIGIBILITY_ERRORS = 'not_qualified (the taker does not hold the position), overlap (the taker would work two shifts at once), short_rest (less than the minimum rest between working days), over_hours (the taker would pass their weekly cap)';

const TOOLS = [
  tool('workplace.get', true, 'workplace',
    'Read the workplace: time zone, first day of the week, locations, positions with their hourly rate, and the policy (minimum rest between working days, weekly hours cap, cut-off for handoffs in hours before a shift starts, notice for time off in days, and whether cover, trades and pickups need the manager). Also returns the account holder with the positions they hold and the weekly cap that applies to them. No side effects.',
    {}, [], { workplace: workplaceOut, me: personOut }),
  tool('team.list', true, 'workplace',
    'List the people at the workplace: name, role, the positions each holds and their weekly cap (cap is the lower of the workplace cap and their own). No side effects.',
    { position_id: describe(idArg, 'Only people who hold this position.') }, [], { people: arr(personOut) }),
  tool('shifts.list', true, 'schedule',
    'List shifts that start inside a window, earliest first. By default all posted shifts of the team are returned. Each shift of the account holder carries flags: overlap, short_rest, over_hours, outside_availability, during_time_off. A manager\'s schedule is never rejected, so the flags say where it breaks the policy or the account holder\'s own availability. Errors: not_found (an unknown person, position or location), invalid_window. No side effects.',
    {
      start: windowStart, end: windowEnd, mine: describe(bool, 'Only shifts assigned to the account holder.'), open: describe(bool, 'Only open shifts.'),
      person_id: describe(idArg, 'Only shifts assigned to this person.'), position_id: describe(idArg, 'Only shifts for this position.'),
      location_id: describe(idArg, 'Only shifts at this location.'), include_cancelled: describe(bool, 'Also return cancelled shifts; hidden by default.'),
      limit: describe(int(1, 200), 'Page size; 50 by default.'), cursor,
    }, ['start', 'end'], { shifts: arr(shiftOut), next_cursor: nullable(str(1, 100)) }),
  tool('shifts.get', true, 'shift',
    'Read one shift with its history of changes: who or what changed it, when, and each changed field. id is the shift ID. Errors: not_found. No side effects.',
    { id: describe(idArg, 'Shift ID.') }, ['id'], { shift: shiftDetail }),
  tool('hours.summary', true, 'current account',
    'Read the account holder\'s weeks that a window touches: scheduled hours, the cap that applies, hours left, days worked, the shifts counted and estimated pay (scheduled hours times each position\'s rate; an estimate, not payroll). A shift counts in the week in which it starts; cancelled shifts count nowhere. Errors: invalid_window. No side effects.',
    { start: windowStart, end: windowEnd }, ['start', 'end'], { weeks: arr(weekOut) }),
  tool('eligibility.check', true, 'shift',
    'Check in advance whether a person may take a shift, with the same rules the handoff operations apply: they hold the position, it overlaps none of their shifts, it leaves the minimum rest between working days, and their weekly hours stay within their cap. Returns every rule that fails (blocks), the weekly hours before and after, the rest gaps that would result, the cut-off and whether it has passed. id is the shift to take; person_id defaults to the account holder; give_shift_id is a shift that person would give up in exchange, and when it is given and the shift belongs to someone else, `other` holds the same check for that person taking give_shift_id (a trade). Nothing is written. Errors: not_found. No side effects.',
    { id: describe(idArg, 'The shift that would be taken.'), person_id: describe(idArg, 'Who would take it; defaults to the account holder.'), give_shift_id: describe(idArg, 'A shift the taker would give up in exchange.') }, ['id'],
    eligibilityOut),
  tool('availability.get', true, 'current account',
    'Read the weekly blocks when the account holder cannot work. No side effects.',
    {}, [], { blocks: arr(block) }),
  tool('time_off.list', true, 'current account',
    'List the account holder\'s time-off entries, newest first, with their state: pending, approved, denied, cancelled, or expired (a pending entry whose first day has begun). Closed entries are hidden unless include_closed is true. No side effects.',
    { state: describe(en(...TIME_OFF_STATE), 'Only entries in this state; it overrides include_closed.'), include_closed: describe(bool, 'Also return denied, cancelled and expired entries.') }, [],
    { time_off: arr(timeOffOut) }),
  tool('handoffs.list', true, 'current account',
    'List the handoffs the account holder is part of, newest first: cover, trade and release requests they made, pickups, and cover or trade requests coworkers sent them. State is awaiting_coworker, awaiting_me, awaiting_manager, approved, denied, declined, cancelled, void, or expired (still pending at its cut-off). Closed handoffs are hidden unless include_closed is true. id filters by a shift the handoff names. No side effects.',
    {
      state: describe(en(...HANDOFF_STATE), 'Only handoffs in this state; it overrides include_closed.'), kind: describe(en(...KIND), 'Only handoffs of this kind.'),
      id: describe(idArg, 'Only handoffs that name this shift.'), include_closed: describe(bool, 'Also return handoffs that are no longer pending.'),
      limit: describe(int(1, 100), 'Page size; 20 by default.'), cursor,
    }, [],
    { handoffs: arr(handoffOut), next_cursor: nullable(str(1, 100)) }),
  tool('handoffs.get', true, 'handoff',
    'Read one handoff: its kind, the people and shifts it names, its state, its cut-off and its history with the state after every step. id is the handoff ID. Errors: not_found. No side effects.',
    { id: describe(idArg, 'Handoff ID.') }, ['id'], { handoff: handoffOut }),
  tool('notifications.list', true, 'current account',
    'List the notifications Pegboard wrote for this account, newest first: a posted week, a manager\'s change to a shift, a newly open shift, a request from a coworker, a step on a handoff, a decision on time off. They are written for what other people do, never for the account holder\'s own writes. Every notification has a release time: the time it was written, or the end of the quiet period it was written in. It reads held before that time and released from then on. No side effects.',
    {
      kind: describe(en(...NOTIFICATION_KIND), 'Only notifications of this kind.'), state: describe(en('held', 'released'), 'Only held or only released notifications, as of now.'),
      since: describe(ts, 'Only notifications created at or after this time.'), limit: describe(int(1, 100), 'Page size; 20 by default.'), cursor,
    }, [],
    { notifications: arr(notificationOut), next_cursor: nullable(str(1, 100)) }),
  tool('preferences.get', true, 'current account',
    'Read the account preferences: time zone, quiet hours, whether notifications are also emailed and whether newly open shifts are notified. No side effects.',
    {}, [], { preferences: preferencesOut }),

  tool('availability.update', false, 'current account',
    'Replace the weekly blocks when the account holder cannot work. Flags on shifts follow at the next read; nothing is rescheduled and no one is told. Errors: invalid_arguments (a block that ends before it starts, or two blocks of one weekday that overlap).',
    { blocks: describe(arr(block, { maxItems: 21 }), 'The whole new pattern: weekday (mon to sun) with start and end as HH:MM in the workplace time zone.') }, ['blocks'],
    { id, blocks: arr(block) }),
  tool('time_off.request', false, 'current account',
    'Ask for time off for a range of whole days. The request is the commitment; the manager decides later. start and end are the first and last day (YYYY-MM-DD, both included) in the workplace time zone. The result id is the new entry. Errors: invalid_window (the range has started, ends before it starts or is longer than 30 days), too_late (less notice than the policy asks), shift_assigned (a shift of the account holder starts on one of the days: get it covered first), conflict (the days overlap another pending or approved entry).',
    { start: describe(date, 'First day off, YYYY-MM-DD.'), end: describe(date, 'Last day off, YYYY-MM-DD.'), reason: describe(str(1, 300), 'Short reason stored with the entry.') }, ['start', 'end'],
    { id, time_off: timeOffOut }),
  tool('time_off.cancel', false, 'time-off entry',
    'Cancel a time-off entry while it is pending, or after approval before its first day. id is the entry ID. Errors: not_found, invalid_state (denied, cancelled, expired, or approved and already begun).',
    { id: describe(idArg, 'Time-off entry ID.') }, ['id'], { id, time_off: timeOffOut }),
  tool('handoffs.cover', false, 'shift',
    'Ask one named coworker to take a shift of the account holder. The shift stays theirs until the coworker has accepted and, where the workplace asks for it, the manager has approved. id is the shift ID; the result id is the new handoff. Checked in this order: the shift is the account holder\'s (not_yours), it has not started and its cut-off has not passed (too_late), it has no pending handoff (already_requested), then for the coworker: ' + ELIGIBILITY_ERRORS + '. Other errors: not_found, invalid_arguments (a handoff to oneself).',
    { id: describe(idArg, 'Shift ID of a shift assigned to the account holder.'), to_person_id: describe(idArg, 'The coworker who is asked to take it.'), message }, ['id', 'to_person_id'],
    { id, handoff: handoffOut }),
  tool('handoffs.trade', false, 'shift',
    'Ask a coworker to exchange a shift of the account holder for one of theirs. Nothing changes hands until the coworker has accepted and, where the workplace asks for it, the manager has approved; then both shifts are exchanged in one step. id is the account holder\'s shift; their_shift_id is the coworker\'s; the result id is the new handoff. Checked in this order: not_yours, not_theirs (their_shift_id is not assigned to a coworker), too_late (either shift has started, or the cut-off before the earlier one has passed), already_requested (either shift has a pending handoff), then for the coworker taking the first shift and for the account holder taking the second, each with the shift they give up left out: ' + ELIGIBILITY_ERRORS + '. Other errors: not_found.',
    { id: describe(idArg, 'Shift ID of a shift assigned to the account holder.'), their_shift_id: describe(idArg, 'Shift ID of the coworker\'s shift wanted in exchange.'), message }, ['id', 'their_shift_id'],
    { id, handoff: handoffOut }),
  tool('handoffs.release', false, 'shift',
    'Ask the manager to release a shift of the account holder to the open shifts. The shift stays theirs until the manager approves. id is the shift ID; the result id is the new handoff. Errors: not_found, not_yours, too_late, already_requested.',
    { id: describe(idArg, 'Shift ID of a shift assigned to the account holder.'), message }, ['id'], { id, handoff: handoffOut }),
  tool('handoffs.pickup', false, 'shift',
    'Pick up an open shift for the account holder. It is approved at once, and the shift assigned, where the workplace does not ask for the manager; otherwise it waits for the manager\'s decision. id is the shift ID; the result id is the new handoff. Checked in this order: not_open, too_late, already_requested (a pickup of this shift is already pending), then for the account holder: ' + ELIGIBILITY_ERRORS + '. Other errors: not_found.',
    { id: describe(idArg, 'Shift ID of an open shift.'), message }, ['id'], { id, handoff: handoffOut }),
  tool('handoffs.respond', false, 'handoff',
    'Answer a cover or trade request that a coworker sent the account holder. accept is the commitment and is checked for the account holder taking the coworker\'s shift (and, in a trade, for the coworker taking theirs): ' + ELIGIBILITY_ERRORS + '. After accept the handoff waits for the manager, or is approved at once where the workplace does not ask for the manager. decline closes it. id is the handoff ID. Other errors: not_found, invalid_state (the handoff is not waiting for the account holder, or has expired).',
    { id: describe(idArg, 'Handoff ID.'), answer: describe(en('accept', 'decline'), 'accept commits the account holder to the request; decline closes it.'), message }, ['id', 'answer'],
    { id, handoff: handoffOut }),
  tool('handoffs.cancel', false, 'handoff',
    'Cancel a handoff the account holder asked for (a cover, trade or release request, or a pickup) while it is pending. No shift changes. id is the handoff ID. Errors: not_found, invalid_state (asked by a coworker, already closed, or expired).',
    { id: describe(idArg, 'Handoff ID.') }, ['id'], { id, handoff: handoffOut }),
  tool('preferences.update', false, 'current account',
    'Change account preferences. Only the fields present in patch change. Quiet hours hold new notifications until they end, except a notification about a shift that starts within 12 hours; notifications already written keep their release time. Errors: invalid_timezone, invalid_arguments (an empty patch, or quiet hours that start and end at the same time).',
    {
      patch: obj({
        timezone: describe(str(1, 64), 'IANA time zone, for example America/Los_Angeles.'),
        quiet_hours: describe(obj({ enabled: bool, start: hhmm, end: hhmm }, []), 'Any of enabled, start and end (HH:MM in the account time zone); fields left out keep their value.'),
        email_notices: describe(bool, 'Whether a new notification also carries an email message for Mail.'),
        open_shift_notices: describe(bool, 'Whether a newly open shift for a position the account holder holds is notified.'),
      }, []),
    }, ['patch'], { id, preferences: preferencesOut }),
];

const failure = obj({ status: { type: 'string' }, message: { type: 'string' }, applied: { const: false }, version, current_version: version }, ['status', 'message', 'applied', 'version']);
function toolsJson() {
  return TOOLS.map(t => ({
    name: t.name, description: t.description, scope: t.scope, resource_target: t.resource_target, read_only: t.read_only,
    inputSchema: obj(t.input, t.required),
    outputSchema: {
      type: 'object',
      anyOf: [
        obj({ status: en('ok', 'committed'), app_id: { const: APP }, version, duplicate: bool, ...t.output }, ['status', 'app_id', 'version', ...t.outputRequired]),
        failure,
      ],
    },
  }));
}

// Core state envelope, identical to the provided template apart from App identity.
function stateSchema(template) {
  const s = JSON.parse(JSON.stringify(template));
  s.properties.package_version = { const: VERSION };
  s.properties.core_api_version = { const: CORE_API };
  s.properties.app_id = { const: APP };
  return s;
}

module.exports = {
  APP, VERSION, CORE_API, WEEKDAY, DAY, KIND, HANDOFF_STORED, HANDOFF_STATE, TIME_OFF_STORED, TIME_OFF_STATE, FLAG, BLOCK, SHIFT_CHANGE,
  NOTIFICATION_KIND, EVENTS, seed, events, toolsJson, stateSchema,
};
