'use strict';
// What a read returns for a shift, a handoff and a time-off entry, and the words used in
// notifications. States that depend on time are derived here from the supplied clock.
const { ms, isoAt, weekdayOf, round2, WEEKDAYS } = require('./util.cjs');
const { zoneOf, hoursOf, shiftDay, shiftWeek, shiftState, shiftPhase, handoffState, timeOffStart, timeOffState, cutoffOf, pendingFor } = require('./model.cjs');

const DAY = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const capital = word => word[0].toUpperCase() + word.slice(1);
// '2026-11-23' -> 'Monday 23 November'
const dayText = date => capital(WEEKDAYS[weekdayOf(date)]) + ' ' + Number(date.slice(8, 10)) + ' ' + MONTHS[Number(date.slice(5, 7)) - 1];
const clock = (data, value) => isoAt(ms(value), zoneOf(data)).slice(11, 16);
const nameOf = (ix, personId) => ix.people.get(personId)?.name ?? personId;
// Notification text names people the way coworkers do: by the first word of their name.
const firstName = (ix, personId) => nameOf(ix, personId).split(' ')[0];
const positionText = (ix, shift) => ix.positions.get(shift.position_id).name.toLowerCase();
// 'the barista shift on Monday 23 November, 05:00 to 11:00 at Finch Street'
function shiftText(data, ix, shift) {
  return 'the ' + positionText(ix, shift) + ' shift on ' + dayText(shiftDay(data, shift)) + ', ' + clock(data, shift.start) + ' to ' + clock(data, shift.end)
    + ' at ' + ix.locations.get(shift.location_id).name;
}
// A reason, message or note quoted inside a longer text ends as a sentence.
const sentence = text => (/[.!?]$/.test(text) ? text : text + '.');

function presentShift(data, ix, shift, now, flags) {
  const state = shiftState(shift), mine = state === 'assigned' && shift.assignee === data.owner_person_id, pending = pendingFor(data, shift.id, now);
  return {
    id: shift.id, location_id: shift.location_id, position_id: shift.position_id, start: shift.start, end: shift.end, hours: round2(hoursOf(shift)),
    assignee: shift.assignee, assignee_name: shift.assignee === null ? null : nameOf(ix, shift.assignee), state, phase: shiftPhase(shift, now),
    week_start: shiftWeek(data, shift), is_mine: mine, flags: mine ? flags.get(shift.id) || [] : [], pending_handoff_id: pending ? pending.id : null,
    cutoff_at: isoAt(cutoffOf(data, [shift]), zoneOf(data)),
  };
}
function presentShiftDetail(data, ix, shift, now, flags) {
  const position = ix.positions.get(shift.position_id);
  return {
    ...presentShift(data, ix, shift, now, flags), location_name: ix.locations.get(shift.location_id).name, position_name: position.name,
    hourly_rate: position.hourly_rate, cancelled_at: shift.cancelled_at ?? null, history: shift.history,
  };
}
const briefShift = shift => ({
  id: shift.id, start: shift.start, end: shift.end, hours: round2(hoursOf(shift)), position_id: shift.position_id, location_id: shift.location_id,
  assignee: shift.assignee, state: shiftState(shift),
});
function presentHandoff(data, ix, handoff, now) {
  return {
    id: handoff.id, kind: handoff.kind, state: handoffState(handoff, now), asked_by_me: handoff.requester_id === data.owner_person_id,
    requester_id: handoff.requester_id, counterpart_id: handoff.counterpart_id, shift: briefShift(ix.shifts.get(handoff.shift_id)),
    other_shift: handoff.other_shift_id === null ? null : briefShift(ix.shifts.get(handoff.other_shift_id)), message: handoff.message ?? null,
    cutoff_at: handoff.cutoff_at, created_at: handoff.created_at, decided_by: handoff.decided_by ?? null, note: handoff.note ?? null, history: handoff.history,
  };
}
function presentTimeOff(data, entry, now) {
  const days = Math.round((Date.parse(entry.end_date) - Date.parse(entry.start_date)) / 86400000) + 1;
  return {
    id: entry.id, start_date: entry.start_date, end_date: entry.end_date, days, reason: entry.reason ?? null, state: timeOffState(data, entry, now),
    requested_at: entry.requested_at, expires_at: isoAt(timeOffStart(data, entry), zoneOf(data)), decided_at: entry.decided_at ?? null,
    decided_by: entry.decided_by ?? null, note: entry.note ?? null, history: entry.history,
  };
}
const blockOrder = (a, b) => DAY.indexOf(a.weekday) - DAY.indexOf(b.weekday) || (a.start < b.start ? -1 : 1);

module.exports = { dayText, clock, nameOf, firstName, positionText, sentence, shiftText, presentShift, presentShiftDetail, briefShift, presentHandoff, presentTimeOff, blockOrder };
