'use strict';
// centre-rules/1: the centre's own rules, computed from the record when read (reads change nothing).
//
// - Settings: weekly_cap, cancel_cutoff_hours, no_show_limit, no_show_window_days, suspension_days. The settings
//   in force at a time are the latest entry at or before it; every result is judged by the settings in force when
//   it is recorded, so a later change alters no earlier result.
// - Weeks run Monday to Sunday in the student's time zone. An appointment counts toward the week of its start
//   unless it is cancelled (cancelled, late_cancel or cancelled_by_centre).
// - The cancellation cutoff is cancel_cutoff_hours before the start (exact hours). A cancellation at or before the
//   cutoff is `cancelled`, one after it `late_cancel`; from the start on, cancelling and editing are refused.
// - No outcome is inferred from the clock: after its start a booked appointment is `awaiting_outcome` until the
//   centre's attendance event sets `completed` or `no_show` (once, however late).
// - Each appointment adds at most one incident to the no-show count: a no_show, dated at its session start and
//   recorded when the centre's event arrives, or a late_cancel, dated and recorded at the cancellation. When an
//   incident is recorded and at least no_show_limit incidents recorded by then are dated within the last
//   no_show_window_days (exact days, inclusive), the student is suspended for suspension_days from that moment.
//   A suspension refuses new bookings only.
const {ms, HOUR, DAY, weekStart} = require('./time.cjs');

const RULE = 'centre-rules/1';
const SETTINGS = ['weekly_cap', 'cancel_cutoff_hours', 'no_show_limit', 'no_show_window_days', 'suspension_days'];
// The range of each setting; tutorwell.rules.changed refuses a value outside it (invalid_value).
const RANGES = {weekly_cap: [1, 20], cancel_cutoff_hours: [0, 168], no_show_limit: [1, 20], no_show_window_days: [1, 365], suspension_days: [1, 365]};

function settingsAt(data, at) {
  let current = null;
  for (const s of data.settings) if (ms(s.at) <= ms(at) && (!current || ms(s.at) >= ms(current.at))) current = s;
  return current && Object.fromEntries(SETTINGS.map(k => [k, current[k]]));
}
const slotOf = (data, appointment) => data.slots.find(s => s.id === appointment.slot_id);
const cutoff = (data, appointment, at) => ms(slotOf(data, appointment).start) - settingsAt(data, at).cancel_cutoff_hours * HOUR;
const countsTowardWeek = appointment => appointment.status === 'booked';
const started = (data, appointment, at) => ms(at) >= ms(slotOf(data, appointment).start);

// The status a read shows.
function statusOf(data, appointment, now) {
  if (appointment.status !== 'booked') return appointment.status;
  if (appointment.outcome) return appointment.outcome.outcome;
  return started(data, appointment, now) ? 'awaiting_outcome' : 'booked';
}

function weekCount(data, week) {
  const zone = data.student.time_zone;
  return data.appointments.filter(a => countsTowardWeek(a) && weekStart(slotOf(data, a).start, zone) === week).length;
}

// Incidents that count as no-shows, each recorded at a time no later than the record's own virtual time.
function incidents(data) {
  const out = [];
  for (const a of data.appointments) {
    if (a.status === 'late_cancel') out.push({appointment_id: a.id, kind: 'late_cancel', dated_at: a.cancelled_at, recorded_at: a.cancelled_at});
    else if (a.outcome?.outcome === 'no_show') out.push({appointment_id: a.id, kind: 'no_show', dated_at: slotOf(data, a).start, recorded_at: a.outcome.recorded_at});
  }
  return out.sort((x, y) => ms(x.recorded_at) - ms(y.recorded_at) || (x.appointment_id < y.appointment_id ? -1 : 1));
}
const inWindow = (list, at, days) => list.filter(i => ms(i.recorded_at) <= ms(at) && ms(i.dated_at) <= ms(at) && ms(i.dated_at) >= ms(at) - days * DAY);

// Every suspension the record implies, with its cause and the incidents it counted.
function suspensions(data) {
  const all = incidents(data), out = [];
  for (const i of all) {
    const s = settingsAt(data, i.recorded_at), counted = inWindow(all, i.recorded_at, s.no_show_window_days);
    if (counted.length >= s.no_show_limit) {
      out.push({from: i.recorded_at, until: ms(i.recorded_at) + s.suspension_days * DAY, cause: i.kind, cause_appointment_id: i.appointment_id,
        counted: counted.map(x => x.appointment_id), settings: s});
    }
  }
  return out;
}
// The suspension in force at `now` (the one that ends last if several overlap), or null.
function suspensionAt(data, now) {
  const active = suspensions(data).filter(s => ms(s.from) <= ms(now) && ms(now) < s.until);
  return active.sort((a, b) => b.until - a.until)[0] || null;
}
function noShowsInWindow(data, now) {
  const s = settingsAt(data, now);
  return inWindow(incidents(data), now, s.no_show_window_days).length;
}

module.exports = {RULE, SETTINGS, RANGES, settingsAt, slotOf, cutoff, countsTowardWeek, started, statusOf, weekCount, incidents, suspensions, suspensionAt, noShowsInWindow};
