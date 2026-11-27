'use strict';
// Record consistency, object IDs and the states that are derived from stored records and
// the supplied time. Core owns persistence, versions and policy.
const { fail, ms, unique, byId, validTimeZone, validDate, localDate, localToInstant, weekStartOf, weekdayOf, writtenOffset, WEEKDAYS, minutesOf, HOUR } = require('./util.cjs');

// ---- lookups --------------------------------------------------------------
function index(data) {
  return {
    people: byId(data.people),
    locations: byId(data.workplace.locations),
    positions: byId(data.workplace.positions),
    shifts: byId(data.shifts),
    handoffs: byId(data.handoffs),
    timeOff: byId(data.time_off),
    weeks: new Map(data.weeks.map(w => [w.week_start, w])),
  };
}
const zoneOf = data => data.workplace.timezone;
const hoursOf = shift => (ms(shift.end) - ms(shift.start)) / HOUR;
// The local date and the week a shift counts in: those in which it starts.
const shiftDay = (data, shift) => localDate(ms(shift.start), zoneOf(data));
const shiftWeek = (data, shift) => weekStartOf(shiftDay(data, shift), data.workplace.week_start);
const capOf = (data, person) => Math.min(data.workplace.policy.max_weekly_hours, person.max_weekly_hours ?? Infinity);

// ---- derived states -------------------------------------------------------------
// Time-based states are never stored. A shift's phase follows its start and end, a pending
// handoff expires at its cut-off, a pending time-off entry expires when its first day begins
// and a notification is held until its release time. Every read, every write check, every
// event and the Infra-run sender derive them from the supplied time in this one place.
const shiftState = shift => (shift.cancelled_at ? 'cancelled' : shift.assignee === null ? 'open' : 'assigned');
const shiftPhase = (shift, now) => (now < ms(shift.start) ? 'upcoming' : now < ms(shift.end) ? 'started' : 'ended');
const PENDING = ['awaiting_coworker', 'awaiting_me', 'awaiting_manager'];
const handoffPending = (handoff, now) => PENDING.includes(handoff.state) && now < ms(handoff.cutoff_at);
const handoffState = (handoff, now) => (PENDING.includes(handoff.state) && now >= ms(handoff.cutoff_at) ? 'expired' : handoff.state);
const timeOffStart = (data, entry) => localToInstant(entry.start_date, '00:00', zoneOf(data));
const timeOffState = (data, entry, now) => (entry.state === 'pending' && now >= timeOffStart(data, entry) ? 'expired' : entry.state);
const notificationState = (notification, now) => (ms(notification.release_at) > now ? 'held' : 'released');
// A handoff must be asked for, answered and decided before this instant.
const cutoffOf = (data, shifts) => Math.min(...shifts.map(s => ms(s.start))) - data.workplace.policy.handoff_cutoff_hours * HOUR;
const namedShifts = handoff => [handoff.shift_id, handoff.other_shift_id].filter(Boolean);
// The pending handoff that names a shift, if any. Only one can exist at a time.
const pendingFor = (data, shiftId, now) => data.handoffs.find(h => handoffPending(h, now) && namedShifts(h).includes(shiftId)) || null;

// ---- seed / state validation ------------------------------------------------------------------
const HISTORY_FIELDS = ['start', 'end', 'position_id', 'location_id', 'assignee', 'cancelled'];
const sameValue = (key, a, b) => (key === 'start' || key === 'end' ? ms(a) === ms(b) : a === b);
function validateSeed(ctx, data) {
  const bad = message => fail('invalid_seed', message);
  const person = ctx.binding.people.some(p => p.person_id === data.owner_person_id);
  const account = ctx.binding.accounts.some(a => a.app_id === ctx.app_id && a.account_id === data.account_id && a.owner_person_id === data.owner_person_id);
  if (!person || !account) bad('Account and owner must be declared in the supplied binding.');

  if (!unique(objects(data))) bad('Record IDs must be unique across the workplace, locations, positions, people, shifts, time-off entries, handoffs and notifications.');
  // Every stored instant carries its UTC offset. The seed schema already asks for it; the
  // rule is repeated here so that it does not depend on who validated the shape.
  for (const [where, value] of timestamps(data)) if (typeof value !== 'string' || writtenOffset(value) === null || Number.isNaN(ms(value))) bad(where + ': a timestamp needs its UTC offset.');
  const ix = index(data), me = data.owner_person_id, now = ms(ctx.virtual_now), zone = zoneOf(data);
  if (!validTimeZone(zone)) bad('The workplace time zone is unknown.');
  if (ix.people.get(me)?.role !== 'employee') bad('The account holder must be one of the people, with the role employee.');
  for (const p of data.people) if (p.position_ids.some(x => !ix.positions.has(x))) bad('Person ' + p.id + ' holds an unknown position.');

  const startDay = WEEKDAYS.indexOf(data.workplace.week_start);
  if (!unique(data.weeks.map(w => w.week_start))) bad('A week can be posted once.');
  for (const w of data.weeks) if (!validDate(w.week_start) || weekdayOf(w.week_start) !== startDay) bad('Week ' + w.week_start + ' does not start on a ' + data.workplace.week_start + '.');

  for (const s of data.shifts) {
    if (!ix.locations.has(s.location_id) || !ix.positions.has(s.position_id)) bad('Shift ' + s.id + ' names an unknown location or position.');
    if (s.assignee !== null && !ix.people.has(s.assignee)) bad('Shift ' + s.id + ' is assigned to an unknown person.');
    if (ms(s.end) <= ms(s.start)) bad('Shift ' + s.id + ' does not end after it starts.');
    if (hoursOf(s) > 16) bad('Shift ' + s.id + ' is longer than 16 hours.');
    if (!ix.weeks.has(shiftWeek(data, s))) bad('Shift ' + s.id + ' starts in a week that has not been posted.');
    // The history must lead to the shift as it is: each row follows from the one before it,
    // and the last value a row gives for a field is the stored one.
    let at = -Infinity;
    const known = {};
    for (const row of s.history) {
      if (ms(row.at) < at) bad('Shift ' + s.id + ': history rows must be in time order.');
      at = ms(row.at);
      if (row.change.posted) known.assignee = row.change.posted.to;
      for (const key of HISTORY_FIELDS) {
        const change = row.change[key];
        if (change === undefined) continue;
        if (key in known && !sameValue(key, known[key], change.from)) bad('Shift ' + s.id + ': the history row at ' + row.at + ' does not follow from the rows before it (' + key + ').');
        known[key] = change.to;
      }
    }
    for (const key of Object.keys(known)) {
      if (!sameValue(key, known[key], key === 'cancelled' ? s.cancelled_at !== undefined : s[key])) bad('Shift ' + s.id + ': its history does not lead to its ' + (key === 'cancelled' ? 'state' : key) + '.');
    }
  }

  const perDay = new Map();
  for (const b of data.availability) {
    if (minutesOf(b.end) <= minutesOf(b.start)) bad('An availability block must end after it starts.');
    const day = perDay.get(b.weekday) || [];
    if (day.some(o => minutesOf(o.start) < minutesOf(b.end) && minutesOf(b.start) < minutesOf(o.end))) bad('Availability blocks of one weekday cannot overlap.');
    day.push(b); perDay.set(b.weekday, day);
  }

  for (const t of data.time_off) {
    if (!validDate(t.start_date) || !validDate(t.end_date) || t.end_date < t.start_date) bad('Time-off entry ' + t.id + ' needs valid dates in order.');
    if (['approved', 'denied'].includes(t.state) && (t.decided_at === undefined || !ix.people.has(t.decided_by))) bad('Time-off entry ' + t.id + ': a decided entry names who decided it and when.');
    if (t.history[t.history.length - 1].state !== t.state) bad('Time-off entry ' + t.id + ': the last history row must carry its state.');
  }

  const pending = new Set();
  for (const h of data.handoffs) {
    const shift = ix.shifts.get(h.shift_id), other = h.other_shift_id === null ? null : ix.shifts.get(h.other_shift_id);
    if (!shift || other === undefined) bad('Handoff ' + h.id + ' names an unknown shift.');
    if (!ix.people.has(h.requester_id) || (h.counterpart_id !== null && !ix.people.has(h.counterpart_id))) bad('Handoff ' + h.id + ' names an unknown person.');
    const two = ['cover', 'trade'].includes(h.kind);
    if (two !== (h.counterpart_id !== null) || (h.kind === 'trade') !== (other !== null)) bad('Handoff ' + h.id + ': a cover names a coworker, a trade names a coworker and a second shift, a release or a pickup names neither.');
    if (two ? ![h.requester_id, h.counterpart_id].includes(me) || h.requester_id === h.counterpart_id : h.requester_id !== me) bad('Handoff ' + h.id + ' must have the account holder as one of its two people.');
    if (h.state === 'awaiting_coworker' && (!two || h.requester_id !== me)) bad('Handoff ' + h.id + ': only a cover or trade the account holder asked for can wait for a coworker.');
    if (h.state === 'awaiting_me' && h.counterpart_id !== me) bad('Handoff ' + h.id + ': only a coworker\'s request can wait for the account holder.');
    if (h.history[h.history.length - 1].state !== h.state) bad('Handoff ' + h.id + ': the last history row must carry its state.');
    if (h.decided_by !== undefined && !ix.people.has(h.decided_by)) bad('Handoff ' + h.id + ' names an unknown manager.');
    if (handoffPending(h, now)) {
      for (const idValue of namedShifts(h)) { if (pending.has(idValue)) bad('Shift ' + idValue + ' is named by two pending handoffs.'); pending.add(idValue); }
      const fits = h.kind === 'pickup' ? shiftState(shift) === 'open'
        : shiftState(shift) === 'assigned' && shift.assignee === h.requester_id && (other === null || (shiftState(other) === 'assigned' && other.assignee === h.counterpart_id));
      if (!fits) bad('Handoff ' + h.id + ' is pending, but its shifts are no longer held as it states.');
      if (ms(h.cutoff_at) > Math.min(ms(shift.start), other ? ms(other.start) : Infinity)) bad('Handoff ' + h.id + ': the cut-off cannot be after its shift starts.');
    }
    // An approved handoff moved its shifts, and each move is in that shift's history. With the
    // history rule above, an approved cover whose shift is still the requester's is refused
    // unless a later change gave it back.
    if (h.state === 'approved') {
      const moves = { cover: [[shift, h.counterpart_id]], trade: [[shift, h.counterpart_id], [other, h.requester_id]], release: [[shift, null]], pickup: [[shift, h.requester_id]] }[h.kind];
      for (const [s, to] of moves) {
        if (!s.history.some(row => row.handoff_id === h.id && row.change.assignee && row.change.assignee.to === to)) bad('Handoff ' + h.id + ' is approved, but shift ' + s.id + ' has no history row that moves it as the handoff states.');
      }
    }
  }

  if (!validTimeZone(data.preferences.timezone)) bad('The account time zone is unknown.');
  if (data.preferences.quiet_hours.start === data.preferences.quiet_hours.end) bad('Quiet hours cannot start and end at the same time.');

  for (const n of data.notifications) {
    const known = { week: ix.weeks, shift: ix.shifts, handoff: ix.handoffs, time_off: ix.timeOff }[n.object.type];
    if (!known.has(n.object.id)) bad('Notification ' + n.id + ' names an unknown ' + n.object.type.replace('_', '-') + '.');
    if (n.shift_ids.some(x => !ix.shifts.has(x))) bad('Notification ' + n.id + ' names an unknown shift.');
    if (ms(n.release_at) < ms(n.created_at)) bad('Notification ' + n.id + ': the release time cannot be before the creation time.');
  }

  let seq = 0;
  for (const row of data.activity) {
    if (row.seq <= seq) bad('Activity rows must have increasing sequence numbers.');
    seq = row.seq;
  }
}

// Every stored instant, with the place it was found.
function timestamps(data) {
  const out = [];
  const rows = (where, list) => list.forEach(row => out.push([where + ' history', row.at]));
  for (const w of data.weeks) out.push(['Week ' + w.week_start, w.posted_at]);
  for (const s of data.shifts) {
    out.push(['Shift ' + s.id, s.start], ['Shift ' + s.id, s.end]);
    if (s.cancelled_at !== undefined) out.push(['Shift ' + s.id, s.cancelled_at]);
    rows('Shift ' + s.id, s.history);
    for (const row of s.history) for (const key of ['start', 'end']) if (row.change[key]) out.push(['Shift ' + s.id + ' history', row.change[key].from], ['Shift ' + s.id + ' history', row.change[key].to]);
  }
  for (const t of data.time_off) { out.push(['Time-off entry ' + t.id, t.requested_at]); if (t.decided_at !== undefined) out.push(['Time-off entry ' + t.id, t.decided_at]); rows('Time-off entry ' + t.id, t.history); }
  for (const h of data.handoffs) { out.push(['Handoff ' + h.id, h.cutoff_at], ['Handoff ' + h.id, h.created_at]); rows('Handoff ' + h.id, h.history); }
  for (const n of data.notifications) out.push(['Notification ' + n.id, n.created_at], ['Notification ' + n.id, n.release_at]);
  for (const a of data.activity) out.push(['Activity row ' + a.seq, a.at]);
  return out;
}

// One object ID per record, so record-only imports count the same things.
const records = data => [data.workplace, ...data.workplace.locations, ...data.workplace.positions, ...data.people, ...data.shifts, ...data.time_off, ...data.handoffs, ...data.notifications];
function objects(data) { return records(data).map(x => x.id); }
// Pegboard keeps no reference into another App.
const references = () => [];

module.exports = {
  validateSeed, records, objects, references,
  index, zoneOf, hoursOf, shiftDay, shiftWeek, capOf, shiftState, shiftPhase, PENDING, handoffPending, handoffState, timeOffStart, timeOffState,
  notificationState, cutoffOf, namedShifts, pendingFor,
};
