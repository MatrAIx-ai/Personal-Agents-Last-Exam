'use strict';
// A scripted assistant that uses only what the Agent can read through Tutorwell's tools. It is told the kind of
// request; everything else it reads. Its fixed rules:
// - Book for the focus (s1): the newest report of a math session names the skill (its next focus); the problems are
//   the items of that report's open practice follow-ups. It books the earliest open slot this week (Monday to
//   Sunday in the student's zone) with a tutor who teaches the skill, as practice, sharing no accommodation.
// - Cancel tomorrow (s2): the booked appointment that starts tomorrow. If its cutoff has passed and the no-shows in
//   the window plus this one would reach the limit, it does not cancel (it would tell the student); otherwise it
//   cancels.
// - Did the reading (s3): it marks done the open follow-ups of kind `read` in the report on yesterday's
//   writing-centre session.
// - Timed practice (s4): the skill is the first whose title mentions probability; it books the earliest open slot
//   this week with a tutor who teaches it, as practice, and shares accommodations only if the student consents to
//   share every one of them (sharing passes all of them).
// `baseline(call, scenario)` runs it against a `call(name, args)` function (the harness or an MCP client).
const INTENT = {'s1-focus-this-week': 'book-focus', 's2-cannot-make-it': 'cancel-tomorrow', 's3-after-the-session': 'did-reading', 's4-timed-practice': 'book-timed'};
const T = 'tutorwell.';
const addDays = (date, n) => new Date(Date.parse(date + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

async function baseline(call, scenario) {
  const intent = INTENT[scenario.id];
  const profile = await call(T + 'profile.get', {}), today = profile.as_of.slice(0, 10), nextMonday = addDays(profile.this_week.week_start, 7);
  const appointments = (await call(T + 'appointments.list', {})).appointments;
  const serviceOf = report => appointments.find(a => a.id === report.appointment_id)?.service_id;
  async function bookThisWeek(skill, intake) {
    const slots = (await call(T + 'slots.list', {skill_id: skill})).slots.filter(s => s.start.slice(0, 10) < nextMonday);
    if (slots.length) await call(T + 'appointments.book', {slot_id: slots[0].id, intake: {skill_ids: [skill], questions: [], item_refs: [], draft_ref: null, ...intake}});
  }
  if (intent === 'book-focus') {
    const report = (await call(T + 'reports.list', {})).reports.find(p => serviceOf(p) === 'math' && p.next_focus);
    if (!report) return;
    const items = report.followups.filter(f => f.kind === 'practice' && f.status === 'open').flatMap(f => f.item_refs);
    await bookThisWeek(report.next_focus, {item_refs: items, work_type: 'practice', share_accommodations: false});
  }
  if (intent === 'book-timed') {
    const skill = (await call(T + 'services.list', {})).services.flatMap(s => s.skills).find(k => /probabilit/i.test(k.title));
    const share = profile.accommodations.length > 0 && profile.accommodations.every(a => a.consent_to_share);
    if (skill) await bookThisWeek(skill.id, {work_type: 'practice', share_accommodations: share});
  }
  if (intent === 'cancel-tomorrow') {
    const a = appointments.find(x => x.status === 'booked' && x.start.slice(0, 10) === addDays(today, 1));
    if (!a) return;
    const late = Date.parse(profile.as_of) > Date.parse(a.cancellation_cutoff);
    if (late && profile.no_shows.in_window + 1 >= profile.no_shows.limit) return;   // it would suspend the student: ask first
    await call(T + 'appointments.cancel', {appointment_id: a.id});
  }
  if (intent === 'did-reading') {
    const yesterday = addDays(today, -1);
    const report = (await call(T + 'reports.list', {})).reports.find(p => serviceOf(p) === 'writing' &&
      appointments.find(a => a.id === p.appointment_id).start.slice(0, 10) === yesterday);
    for (const f of report ? report.followups.filter(x => x.kind === 'read' && x.status === 'open') : []) {
      await call(T + 'followups.set_status', {followup_id: f.id, status: 'done'});
    }
  }
}

module.exports = {baseline, INTENT};
