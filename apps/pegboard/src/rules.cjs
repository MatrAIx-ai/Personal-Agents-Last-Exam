'use strict';
// The workplace policy applied to people: the one eligibility check that every employee-side
// action uses, the flags on the account holder's own shifts, and weekly hours.
// Managers are not checked: what they post, change or decide is applied as given, and the
// flags say where the result breaks the policy or the account holder's own availability.
const { ms, localDate, localMinutes, datesBetween, weekdayOf, SHORT_DAYS, minutesOf, round2, addDays, HOUR } = require('./util.cjs');
const { zoneOf, hoursOf, shiftDay, shiftWeek, capOf } = require('./model.cjs');
const FLAG_ORDER = ['overlap', 'short_rest', 'over_hours', 'outside_availability', 'during_time_off'];

const byStart = (a, b) => ms(a.start) - ms(b.start) || (a.id < b.id ? -1 : 1);
// Shifts a person is responsible for: assigned and not cancelled.
const assignedTo = (data, personId) => data.shifts.filter(s => !s.cancelled_at && s.assignee === personId).sort(byStart);
const overlaps = (a, b) => ms(a.start) < ms(b.end) && ms(b.start) < ms(a.end);
const sum = shifts => shifts.reduce((total, s) => total + hoursOf(s), 0);

// Working days of a list of shifts: local date -> { first start, last end } of the shifts that start on it.
function workingDays(data, shifts) {
  const days = new Map();
  for (const s of shifts) {
    const day = shiftDay(data, s), d = days.get(day) || { day, first: Infinity, last: -Infinity };
    d.first = Math.min(d.first, ms(s.start)); d.last = Math.max(d.last, ms(s.end));
    days.set(day, d);
  }
  return [...days.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
}
// Rest before and after the working day of `shift` within `shifts` (which contains it), in
// hours: from the last shift of the previous working day to the first shift of this one, and
// from the last shift of this one to the first shift of the next. null when there is none.
function restAround(data, shifts, shift) {
  const days = workingDays(data, shifts), i = days.findIndex(d => d.day === shiftDay(data, shift)), today = days[i];
  return {
    before: i > 0 ? (today.first - days[i - 1].last) / HOUR : null,
    after: i < days.length - 1 ? (days[i + 1].first - today.last) / HOUR : null,
    opens: ms(shift.start) === today.first, closes: ms(shift.end) === today.last,
  };
}

// May `personId` take `shift`, giving up `giveUpId` in exchange (a trade) or nothing?
// The four rules, in the order a write reports them:
//   not_qualified  the person does not hold the shift's position
//   overlap        it overlaps another shift they are assigned
//   short_rest     it opens or closes a working day with less than the minimum rest next to it
//   over_hours     it adds hours and takes their week past their cap
function eligibility(data, ix, personId, shift, giveUpId = null) {
  const person = ix.people.get(personId), policy = data.workplace.policy, week = shiftWeek(data, shift);
  const held = assignedTo(data, personId), kept = held.filter(s => s.id !== giveUpId && s.id !== shift.id), next = [...kept, shift];
  const inWeek = list => sum(list.filter(s => shiftWeek(data, s) === week));
  const rest = restAround(data, next, shift), before = inWeek(held), after = inWeek(next), cap = capOf(data, person);
  const blocks = [];
  if (!person.position_ids.includes(shift.position_id)) blocks.push('not_qualified');
  if (kept.some(s => overlaps(s, shift))) blocks.push('overlap');
  if ((rest.opens && rest.before !== null && rest.before < policy.min_rest_hours) || (rest.closes && rest.after !== null && rest.after < policy.min_rest_hours)) blocks.push('short_rest');
  if (after > cap && after > before) blocks.push('over_hours');
  return {
    person_id: personId, shift_id: shift.id, eligible: blocks.length === 0, blocks,
    hours: { week_start: week, before: round2(before), after: round2(after), cap },
    rest: { before_hours: rest.before === null ? null : round2(rest.before), after_hours: rest.after === null ? null : round2(rest.after), minimum: policy.min_rest_hours },
  };
}

// Does [start, end) of a shift touch one of the weekly unavailable blocks?
function outsideAvailability(data, shift) {
  if (!data.availability.length) return false;
  const zone = zoneOf(data), start = ms(shift.start), end = ms(shift.end);
  return datesBetween(start, end, zone).some(day => {
    const from = localDate(start, zone) === day ? localMinutes(start, zone) : 0, to = localDate(end, zone) === day ? localMinutes(end, zone) : 1440;
    const weekday = SHORT_DAYS[weekdayOf(day)];
    return data.availability.some(b => b.weekday === weekday && minutesOf(b.start) < to && from < minutesOf(b.end));
  });
}
const duringTimeOff = (data, shift) => { const day = shiftDay(data, shift); return data.time_off.some(t => t.state === 'approved' && t.start_date <= day && day <= t.end_date); };
// The two personal flags, for a shift the account holder holds or would take.
const personalFlags = (data, shift) => [...(outsideAvailability(data, shift) ? ['outside_availability'] : []), ...(duringTimeOff(data, shift) ? ['during_time_off'] : [])];

// Flags on every shift of the account holder. Computed when read, never stored.
//   overlap               two of their shifts overlap
//   short_rest            less than the minimum rest between the last shift of one working day and
//                         the first shift of the next: both of those shifts carry it
//   over_hours            the shifts that take the week past the cap, counted in order of start time
//   outside_availability  the shift touches one of their own weekly blocks
//   during_time_off       the shift starts on a day of their approved time off
function flagsOfAccount(data, ix) {
  const me = data.owner_person_id, mine = assignedTo(data, me), policy = data.workplace.policy, cap = capOf(data, ix.people.get(me));
  const flags = new Map(mine.map(s => [s.id, new Set()]));
  mine.forEach((a, i) => mine.slice(i + 1).forEach(b => { if (overlaps(a, b)) { flags.get(a.id).add('overlap'); flags.get(b.id).add('overlap'); } }));
  const days = workingDays(data, mine);
  days.slice(1).forEach((today, i) => {
    const previous = days[i];
    if ((today.first - previous.last) / HOUR >= policy.min_rest_hours) return;
    for (const s of mine) {
      const day = shiftDay(data, s);
      if ((day === previous.day && ms(s.end) === previous.last) || (day === today.day && ms(s.start) === today.first)) flags.get(s.id).add('short_rest');
    }
  });
  const running = new Map();
  for (const s of mine) {
    const week = shiftWeek(data, s), total = (running.get(week) || 0) + hoursOf(s);
    running.set(week, total);
    if (total > cap) flags.get(s.id).add('over_hours');
  }
  for (const s of mine) for (const flag of personalFlags(data, s)) flags.get(s.id).add(flag);
  return new Map([...flags].map(([idValue, set]) => [idValue, FLAG_ORDER.filter(f => set.has(f))]));
}

// The account holder's week that starts on `weekStart`.
function weekSummary(data, ix, weekStart) {
  const me = data.owner_person_id, mine = assignedTo(data, me).filter(s => shiftWeek(data, s) === weekStart);
  const hours = sum(mine), cap = capOf(data, ix.people.get(me));
  const pay = mine.reduce((total, s) => total + hoursOf(s) * ix.positions.get(s.position_id).hourly_rate, 0);
  return {
    week_start: weekStart, week_end: addDays(weekStart, 6), posted_at: ix.weeks.get(weekStart)?.posted_at ?? null,
    scheduled_hours: round2(hours), cap, hours_left: round2(Math.max(0, cap - hours)), over_cap: hours > cap,
    days_worked: new Set(mine.map(s => shiftDay(data, s))).size, shift_ids: mine.map(s => s.id),
    estimated_pay: { amount: round2(pay), currency: data.workplace.currency, estimate: true },
  };
}

module.exports = { assignedTo, byStart, overlaps, eligibility, personalFlags, flagsOfAccount, weekSummary };
