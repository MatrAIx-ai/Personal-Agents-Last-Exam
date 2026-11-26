'use strict';
// Agent-visible read results. Every field is listed explicitly: the evaluator-only activity log and the integrity
// checker's grader-only findings never appear here. All times are written in the student's time zone.
const {fail, copy} = require('./domain-utils.cjs');
const {ms, local, zoned, weekStart, plus} = require('./time.cjs');
const r = require('./rules.cjs');

// Unknown IDs: the error lists the valid ones (the sets are small) and names the read tool that lists them.
function find(list, id, what, lister, label = x => x.id) {
  const item = list.find(x => x.id === id);
  if (!item) fail('not_found', `${what} ${JSON.stringify(id)} does not exist. Known: ${list.map(label).join(', ') || 'none'}. tutorwell.${lister} lists them.`);
  return item;
}
// A skill ID given as a service, or a service ID given as a skill, is named as what it is.
function service(data, id) {
  const k = data.skills.find(x => x.id === id);
  if (k && !data.services.some(s => s.id === id)) {
    fail('not_found', `Service ${JSON.stringify(id)} does not exist: ${id} is a skill (${k.title}); filter by it with skill_id. Services: ${data.services.map(s => `${s.id} (${s.title})`).join(', ')}.`);
  }
  return find(data.services, id, 'Service', 'services.list', s => `${s.id} (${s.title})`);
}
function skill(data, id) {
  const s = data.services.find(x => x.id === id);
  if (s && !data.skills.some(k => k.id === id)) fail('not_found', `Skill ${JSON.stringify(id)} does not exist: ${id} is a service (${s.title}); filter by it with service_id. tutorwell.services.list lists the skills of each service.`);
  return find(data.skills, id, 'Skill', 'services.list', k => `${k.id} (${k.title})`);
}
const tutor = (data, id) => find(data.tutors, id, 'Tutor', 'tutors.list', t => `${t.id} (${t.name})`);
const tutorOf = (data, slot) => data.tutors.find(t => t.id === slot.tutor_id);
const zone = data => data.student.time_zone;
const when = (data, value) => value === null || value === undefined ? null : zoned(value, zone(data));
const slotTimes = (data, s) => ({start: when(data, s.start), end: when(data, plus(s.start, s.minutes)), weekday: local(s.start, zone(data)).weekday});
// An unknown slot: the error lists the open ones, earliest first.
function slot(data, id, now) {
  const s = data.slots.find(x => x.id === id);
  if (!s) {
    const open = data.slots.filter(x => isOpen(data, x, now)).sort((a, b) => ms(a.start) - ms(b.start)).map(x => x.id);
    fail('not_found', `Slot ${JSON.stringify(id)} does not exist. Open slots: ${open.join(', ') || 'none'}. tutorwell.slots.list lists them with their times.`);
  }
  return s;
}
// An unknown appointment: the error lists the booked ones (for a change or a cancellation) or those with a report,
// each with its start and tutor.
function appointmentFor(data, id, now, which = 'booked') {
  const a = data.appointments.find(x => x.id === id);
  if (a) return a;
  const pick = which === 'booked' ? x => r.statusOf(data, x, now) === 'booked' : x => data.reports.some(p => p.appointment_id === x.id);
  const label = x => { const s = r.slotOf(data, x); return `${x.id} (${local(s.start, zone(data)).weekday} ${when(data, s.start)}, ${tutorOf(data, s).name})`; };
  const shown = data.appointments.filter(pick).sort((x, y) => ms(r.slotOf(data, x).start) - ms(r.slotOf(data, y).start)).map(label);
  fail('not_found', `Appointment ${JSON.stringify(id)} does not exist. ${which === 'booked' ? 'Booked appointments' : 'Appointments with a report'}: ${shown.join(', ') || 'none'}. tutorwell.appointments.list lists them all with their times and status.`);
}
// An unknown follow-up: the error lists the open ones with their kind, items and due time, then the done ones.
function followupFor(data, id) {
  const f = data.followups.find(x => x.id === id);
  if (f) return f;
  const label = x => `${x.id} (${x.kind} ${x.item_refs.join(' ') || 'no item'}${x.due_at ? ', due ' + when(data, x.due_at) : ''})`;
  const open = data.followups.filter(x => x.status === 'open').map(label), done = data.followups.filter(x => x.status === 'done').map(x => x.id);
  fail('not_found', `Follow-up ${JSON.stringify(id)} does not exist. Open: ${open.join(', ') || 'none'}. Done: ${done.join(', ') || 'none'}. tutorwell.reports.list lists them with their reports.`);
}
const isOpen = (data, s, now) => s.withdrawn_at === null && ms(s.start) > ms(now) && !data.appointments.some(a => a.slot_id === s.id && a.status === 'booked');

function rulesText(data, now) {
  const s = r.settingsAt(data, now);
  return [
    `At most ${s.weekly_cap} appointments per Monday-to-Sunday week (${zone(data)}), across services; an appointment counts toward the week of its start unless it is cancelled.`,
    'A booking needs an open slot that starts after now. The writing centre requires a draft reference. Take-home exam work is not tutored.',
    `The cancellation cutoff is ${s.cancel_cutoff_hours} hours before the start. A cancellation after the cutoff is a late cancellation, which counts as a no-show. From the start on, an appointment cannot be cancelled and its intake cannot be changed.`,
    'Only the centre records attendance (completed or no_show), once, however late. Until then a started appointment is awaiting_outcome: it still counts toward its week and is not a no-show.',
    `When a no-show or late cancellation is recorded and ${s.no_show_limit} or more are dated within the last ${s.no_show_window_days} days, the student is suspended for ${s.suspension_days} days from that moment. A suspension refuses new bookings only.`,
    'Results are judged by the settings in force when they are recorded; a later change of settings changes no earlier result.'
  ];
}
function servicesList(data, now) {
  return {as_of: when(data, now), rule_version: r.RULE, settings: r.settingsAt(data, now), rules: rulesText(data, now),
    services: data.services.map(s => ({id: s.id, title: s.title, description: s.description, requires_draft: s.requires_draft,
      skills: data.skills.filter(k => k.service_id === s.id).map(k => ({id: k.id, title: k.title}))}))};
}
function tutorsList(data, now, a) {
  if (a.service_id !== undefined) service(data, a.service_id);
  if (a.skill_id !== undefined) skill(data, a.skill_id);
  return {as_of: when(data, now), tutors: data.tutors.filter(t => (a.service_id === undefined || t.service_id === a.service_id) &&
    (a.skill_id === undefined || t.skill_ids.includes(a.skill_id))).map(t => ({id: t.id, name: t.name, service_id: t.service_id,
    skill_ids: copy(t.skill_ids), modes: copy(t.modes)}))};
}
function slotsList(data, now, a) {
  if (a.service_id !== undefined) service(data, a.service_id);
  if (a.tutor_id !== undefined) tutor(data, a.tutor_id);
  if (a.skill_id !== undefined) skill(data, a.skill_id);
  const slots = data.slots.filter(s => {
    const t = tutorOf(data, s);
    return isOpen(data, s, now) && (a.service_id === undefined || t.service_id === a.service_id) && (a.tutor_id === undefined || t.id === a.tutor_id) &&
      (a.skill_id === undefined || t.skill_ids.includes(a.skill_id));
  }).sort((x, y) => ms(x.start) - ms(y.start) || (x.id < y.id ? -1 : 1));
  return {as_of: when(data, now), slots: slots.map(s => ({id: s.id, tutor_id: s.tutor_id, service_id: tutorOf(data, s).service_id, ...slotTimes(data, s),
    minutes: s.minutes, mode: s.mode}))};
}
function appointment(data, now, a) {
  const s = r.slotOf(data, a), status = r.statusOf(data, a, now), report = data.reports.find(p => p.appointment_id === a.id);
  return {id: a.id, slot_id: s.id, service_id: tutorOf(data, s).service_id, tutor_id: s.tutor_id, ...slotTimes(data, s), minutes: s.minutes, mode: s.mode,
    status, booked_at: when(data, a.booked_at), intake: copy(a.intake), cancellation_cutoff: status === 'booked' ? when(data, r.cutoff(data, a, now)) : null,
    cancelled_at: when(data, a.cancelled_at), outcome_recorded_at: when(data, a.outcome?.recorded_at), counts_toward_week: r.countsTowardWeek(a),
    report_id: report ? report.id : null};
}
function appointmentsList(data, now, a) {
  const all = [...data.appointments].sort((x, y) => ms(r.slotOf(data, x).start) - ms(r.slotOf(data, y).start) || (x.id < y.id ? -1 : 1));
  return {as_of: when(data, now), appointments: all.map(x => appointment(data, now, x)).filter(x => a.status === undefined || x.status === a.status)};
}
function reportsList(data, now, a) {
  if (a.appointment_id !== undefined) appointmentFor(data, a.appointment_id, now, 'reported');
  const reports = data.reports.filter(p => a.appointment_id === undefined || p.appointment_id === a.appointment_id)
    .sort((x, y) => ms(y.posted_at) - ms(x.posted_at) || (x.id < y.id ? 1 : -1));
  return {as_of: when(data, now), reports: reports.map(p => ({id: p.id, appointment_id: p.appointment_id, posted_at: when(data, p.posted_at),
    covered_skill_ids: copy(p.covered_skill_ids), next_focus: p.next_focus,
    followups: data.followups.filter(f => f.report_id === p.id).map(f => ({id: f.id, kind: f.kind, item_refs: copy(f.item_refs), minutes: f.minutes,
      due_at: when(data, f.due_at), status: f.status, done_at: when(data, f.done_at)}))}))};
}
function period(data, s) {
  return s && {from: when(data, s.from), until: when(data, s.until), cause: s.cause, cause_appointment_id: s.cause_appointment_id};
}
function profileGet(data, now) {
  const s = r.settingsAt(data, now), week = weekStart(now, zone(data));
  const weeks = new Map();
  for (const a of data.appointments) {
    const w = weekStart(r.slotOf(data, a).start, zone(data));
    if (r.countsTowardWeek(a) && w >= week) weeks.set(w, (weeks.get(w) || 0) + 1);
  }
  return {as_of: when(data, now), display_name: data.student.display_name, time_zone: zone(data),
    accommodations: data.accommodations.map(x => ({id: x.id, title: x.title, consent_to_share: x.consent_to_share})),
    this_week: {week_start: week, count: r.weekCount(data, week), weekly_cap: s.weekly_cap},
    weekly_counts: [...weeks].sort(([x], [y]) => (x < y ? -1 : 1)).map(([week_start, count]) => ({week_start, count})),
    no_shows: {in_window: r.noShowsInWindow(data, now), window_days: s.no_show_window_days, limit: s.no_show_limit},
    suspension: period(data, r.suspensionAt(data, now))};
}

module.exports = {slot, servicesList, tutorsList, slotsList, appointmentsList, reportsList, profileGet, appointment, appointmentFor, followupFor, period, find, skill, when, isOpen, tutorOf};
