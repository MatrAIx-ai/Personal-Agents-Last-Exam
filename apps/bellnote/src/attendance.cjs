'use strict';
// W1: attendance by day and absence / late-arrival / early-leave reports.
const c = require('./common.cjs');
const {notify, longDate} = require('./notify.cjs');
const MAX_REPORT_SCHOOL_DAYS = 10, MAX_REPORT_SPAN_DAYS = 31;

const isOpen = r => r.state !== 'cancelled';
// Cut-off of one reported day. A full-day absence uses the school's absence cut-off for that day.
// A late arrival can be reported until the stated arrival time and an early leave until the
// stated leaving time (both inside that day's school hours).
function dayCutoff(data, info, kind, timeLocal) {
  if (!info.school_day) return null;
  return kind === 'absent' ? info.absence_cutoff_at : c.time.zonedIso(info.date, timeLocal, c.tz(data));
}
const insideDay = (info, timeLocal) => {
  const t = c.time.minutesOf(timeLocal);
  return t > c.time.minutesOf(info.start_local) && t < c.time.minutesOf(info.dismissal_local);
};
// Per day: `moot` when that day became a closed day, or (late arrival / early leave) when an
// early dismissal moved the end of the day to or before the reported time; otherwise `reported`.
// A day of an earlier school year (before the current term, whose calendar the App does not hold)
// stays `reported` with its cut-off passed: the school year it belonged to has simply ended.
// The whole report reads `moot` only when every one of its days is moot; otherwise it keeps its
// stored state and lists its moot_dates. Nothing here is stored.
function reportView(ctx, data, r) {
  const s = c.schoolOf(data, r.child_id);
  const days = r.dates.map(date => {
    if (date < s.term.start_date) return {date, state: 'reported', moot_reason: null, closed: false, cutoff_at: null, cutoff_passed: true};
    const info = c.dayInfo(data, s, date);
    const reason = info.kind === 'closed' ? 'closed' : !info.school_day ? info.kind
      : r.kind !== 'absent' && !insideDay(info, r.time_local) ? 'time_outside_day' : null;
    const cutoff = reason ? null : dayCutoff(data, info, r.kind, r.time_local);
    return {date, state: reason ? 'moot' : 'reported', moot_reason: reason, closed: info.kind === 'closed', cutoff_at: cutoff,
      cutoff_passed: cutoff ? c.passed(ctx, cutoff) : true};
  });
  const moot = r.state !== 'cancelled' && r.dates.length > 0 && days.every(d => d.state === 'moot');
  return {...c.copy(r), state: moot ? 'moot' : r.state, stored_state: r.state, moot_dates: days.filter(d => d.state === 'moot').map(d => d.date), days};
}
const reportCovering = (data, childId, date) => data.absence_reports.find(r => r.child_id === childId && isOpen(r) && r.dates.includes(date));

function list(ctx, data, args) {
  const {start, end} = c.windowOf(ctx, data, args, 14, 0);
  if (args.id) c.child(data, args.id);
  const records = data.attendance.filter(a => (!args.id || a.child_id === args.id) && a.date >= start && a.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date) || a.child_id.localeCompare(b.child_id));
  return {start, end, records: c.copy(records)};
}
function reports(ctx, data, args) {
  if (args.id) return {reports: [reportView(ctx, data, c.find(data.absence_reports, args.id, 'Report'))]};
  if (args.child_id) c.child(data, args.child_id);
  const out = data.absence_reports.filter(r => !args.child_id || r.child_id === args.child_id).map(r => reportView(ctx, data, r))
    .filter(r => !args.state || r.state === args.state);
  return {reports: out};
}

function report(ctx, data, args) {
  const childId = args.id;
  c.requireRight(data, childId, 'custodial');
  const s = c.schoolOf(data, childId), start = args.start, end = args.end || args.start;
  if (!c.time.validDate(start) || !c.time.validDate(end) || end < start) c.fail('invalid_window', 'The report must start on or before the day it ends.');
  if (args.kind !== 'absent' && start !== end) c.fail('invalid_window', 'A late arrival or early leave covers exactly one day.');
  if (c.time.daysBetween(start, end) > MAX_REPORT_SPAN_DAYS) c.fail('invalid_window', 'A report may span at most ' + (MAX_REPORT_SPAN_DAYS + 1) + ' calendar days.');
  c.schoolDay(data, s, start); c.schoolDay(data, s, end);
  const covered = c.time.eachDate(start, end).map(d => c.dayInfo(data, s, d)).filter(d => d.school_day);
  if (covered.length > MAX_REPORT_SCHOOL_DAYS) c.fail('invalid_window', 'A report may cover at most ' + MAX_REPORT_SCHOOL_DAYS + ' school days.');
  if (args.kind === 'absent' && args.time_local !== undefined) c.fail('invalid_time', 'A full-day absence has no time.');
  if (args.kind !== 'absent') {
    const day = covered[0];
    if (!args.time_local || !c.time.parseLocal(args.time_local)) c.fail('invalid_time', 'A late arrival or early leave needs a time (HH:MM).');
    if (!insideDay(day, args.time_local)) {
      c.fail('invalid_time', 'The time must fall inside that school day (' + day.start_local + '–' + day.dismissal_local + ').');
    }
  }
  const cutoff = dayCutoff(data, covered[0], args.kind, args.time_local);
  if (c.passed(ctx, cutoff)) c.fail('too_late', 'The cut-off for ' + covered[0].date + ' passed at ' + cutoff + '.');
  const dates = covered.map(d => d.date);
  const clash = data.absence_reports.find(r => r.child_id === childId && isOpen(r) && r.dates.some(d => dates.includes(d)));
  if (clash) c.fail('conflict', 'Report ' + clash.id + ' already covers ' + clash.dates.filter(d => dates.includes(d)).join(', ') + '.');
  const r = {id: c.nextId(data.absence_reports, 'rep'), child_id: childId, kind: args.kind, dates, time_local: args.time_local || null,
    reason: args.reason, state: 'submitted', cancelled_dates: [], submitted_by: data.owner_person_id, submitted_at: ctx.virtual_now,
    reviewed_by: null, reviewed_at: null, review_note: null, request_id: args.request_id,
    history: [{at: ctx.virtual_now, action: 'submitted', by: data.owner_person_id, request_id: args.request_id}]};
  data.absence_reports.push(r);
  for (const a of data.attendance) {
    if (a.child_id === childId && dates.includes(a.date) && a.status !== 'present') {
      a.explanation = 'explained'; a.report_id = r.id;
      a.history.push({at: ctx.virtual_now, action: 'explained', report_id: r.id});
    }
  }
  c.activity(ctx, data, {actor: 'agent', action: 'absences.report', child_id: childId, object_id: r.id, request_id: args.request_id});
  return {id: r.id, child_id: childId, state: r.state, dates, cutoff_at: cutoff};
}

function cancel(ctx, data, args) {
  const r = c.find(data.absence_reports, args.id, 'Report');
  c.requireRight(data, r.child_id, 'custodial');
  const view = reportView(ctx, data, r);
  if (view.state !== 'submitted') c.fail('invalid_state', 'Only a submitted report can be cancelled; this one is ' + view.state + '.');
  const ahead = view.days.filter(d => d.state === 'reported' && !d.cutoff_passed).map(d => d.date);
  if (!ahead.length) c.fail('too_late', 'Every day of this report has passed its cut-off.');
  r.cancelled_dates.push(...ahead);
  r.dates = r.dates.filter(d => !ahead.includes(d));
  if (!r.dates.length) r.state = 'cancelled';
  r.history.push({at: ctx.virtual_now, action: r.state === 'cancelled' ? 'cancelled' : 'partly_cancelled', by: data.owner_person_id,
    dates: ahead, request_id: args.request_id});
  for (const a of data.attendance) {
    if (a.report_id === r.id && ahead.includes(a.date)) {
      a.explanation = 'unexplained'; a.report_id = null;
      a.history.push({at: ctx.virtual_now, action: 'report_cancelled', report_id: r.id});
    }
  }
  c.activity(ctx, data, {actor: 'agent', action: 'absences.cancel', child_id: r.child_id, object_id: r.id, request_id: args.request_id});
  return {id: r.id, state: r.state, cancelled_dates: ahead, remaining_dates: c.copy(r.dates)};
}

// ---- events ----------------------------------------------------------------------------------
const STATUS_TEXT = {absent: 'absent', late: 'late', left_early: 'leaving early'};
function marked(ctx, data, event, row) {
  const p = event.payload, kid = c.child(data, p.child_id), s = c.schoolOf(data, p.child_id);
  if (!data.staff.some(x => x.id === p.marked_by && x.school_id === s.id)) c.fail('invalid_event', 'Unknown staff member for this school.');
  const info = c.dayInfo(data, s, p.date);
  if (!info.school_day) c.fail('invalid_event', p.date + ' is not a school day.');
  if (p.date > c.time.localDate(ctx.virtual_now, c.tz(data))) c.fail('invalid_event', 'Attendance cannot be marked for a future day.');
  if (p.status === 'present' && p.time_local) c.fail('invalid_event', 'A present mark has no time.');
  const id = 'att-' + p.child_id + '-' + p.date;
  let a = data.attendance.find(x => x.id === id);
  const prior = a ? a.status : null;
  if (!a) {
    a = {id, child_id: p.child_id, date: p.date, status: p.status, time_local: p.time_local || null, explanation: null,
      report_id: null, office_review: null, marked_by: p.marked_by, marked_at: ctx.virtual_now, history: []};
    data.attendance.push(a);
  }
  a.status = p.status; a.time_local = p.time_local || null; a.marked_by = p.marked_by; a.marked_at = ctx.virtual_now;
  const cover = p.status === 'present' ? null : reportCovering(data, p.child_id, p.date);
  a.explanation = p.status === 'present' ? null : cover ? 'explained' : 'unexplained';
  a.report_id = cover ? cover.id : null;
  a.office_review = cover && ['excused', 'unexcused'].includes(cover.state) ? cover.state : null;
  a.history.push({at: ctx.virtual_now, action: prior ? 'corrected' : 'marked', status: p.status, by: p.marked_by, event_id: event.event_id});
  row.child_id = p.child_id; row.object_id = id;
  if (a.explanation === 'unexplained' && prior !== p.status) {
    notify(ctx, data, {kind: 'attendance.unexplained', child_id: p.child_id, object_type: 'attendance_record', object_id: id,
      event_id: event.event_id, cause_seq: row.seq,
      title: s.name + ': ' + kid.display_name + ' marked ' + STATUS_TEXT[p.status] + ' on ' + longDate(p.date),
      body: s.name + ' marked ' + kid.display_name + ' ' + STATUS_TEXT[p.status] + (a.time_local ? ' (' + a.time_local + ')' : '') +
        ' on ' + longDate(p.date) + ' and has no report from a guardian for that day. Open Bellnote to report the reason.'});
  }
}
function reviewed(ctx, data, event, row) {
  const p = event.payload, r = data.absence_reports.find(x => x.id === p.report_id);
  if (!r) c.fail('invalid_event', 'Unknown report.');
  if (reportView(ctx, data, r).state !== 'submitted') c.fail('invalid_event', 'The report is not waiting for a review.');
  const s = c.schoolOf(data, r.child_id);
  if (!data.staff.some(x => x.id === p.reviewed_by && x.school_id === s.id)) c.fail('invalid_event', 'Unknown staff member for this school.');
  r.state = p.decision; r.reviewed_by = p.reviewed_by; r.reviewed_at = ctx.virtual_now; r.review_note = p.note || null;
  r.history.push({at: ctx.virtual_now, action: p.decision, by: p.reviewed_by, event_id: event.event_id});
  for (const a of data.attendance) {
    if (a.report_id === r.id) { a.office_review = p.decision; a.history.push({at: ctx.virtual_now, action: 'office_' + p.decision, event_id: event.event_id}); }
  }
  row.child_id = r.child_id; row.object_id = r.id;
  const kid = c.child(data, r.child_id);
  notify(ctx, data, {kind: 'absence.reviewed', child_id: r.child_id, object_type: 'absence_report', object_id: r.id,
    event_id: event.event_id, cause_seq: row.seq,
    title: s.name + ': ' + kid.display_name + "'s report marked " + p.decision,
    body: 'The office reviewed your report for ' + kid.display_name + ' (' + r.dates.map(longDate).join(', ') + ') and marked it ' +
      p.decision + '.' + (p.note ? ' Note from the office: ' + p.note : '')});
}
module.exports = {list, reports, report, cancel, marked, reviewed, reportView, reportCovering, isOpen};
