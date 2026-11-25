#!/usr/bin/env node
'use strict';
// Authoring-time generator of the reference family's earlier history, from 2025-01-01 up to the
// hand-written 2026–27 school year (which starts on 2026-08-26). It is deterministic: a fixed seed
// and a small PRNG, no clock and no Math.random, so scripts/build-reference-fixture.cjs rebuilds the
// same bytes on every run. `node scripts/history.cjs --check` rebuilds the reference fixture,
// compares it with the committed file and runs the history checks below.
//
// What it generates (each record in its own ID series, so hand-written IDs are untouched):
//   - the district calendar of January to June 2025 and of 2025–26 (breaks, holidays, early
//     dismissals and three unplanned changes announced to the family);
//   - attendance exceptions (absent, late, leaving early) with the reports that explained them, the
//     office's reviews, one report cancelled before its cut-off, and unexplained marks;
//   - forms of both years with versions and answers by Maya, Dana and Sam, and their fees;
//   - a former babysitter on Theo's and Ines's pickup lists and dismissal changes of both years;
//   - lunch purchases from each school's menu, top-ups after low-balance notices, refunds, the
//     year-end rollovers, and the menus of the weeks the children bought lunch;
//   - one notification for every event that concerned the account, in the App's own wording.
// Rules it obeys: school-day records only on school days of that year's calendar; Ines starts
// kindergarten in August 2025; Nico was in grade 5 at Alder Elementary until June 2025; rights are
// the seeded ones (Maya is not custodial for Nico and cannot sign for him, Dana cannot pay for
// Ines), so nothing of Nico's pickup list or dismissal plans appears; no restricted person and no
// pickup person outside their approved period is named; no purchase carries a child's restricted
// allergen; balances never pass the debt limit and each year ends in a rollover that matches the
// hand-written carry-over of 2026-08-26.
const fs = require('node:fs'), path = require('node:path');
const time = require('../src/time.cjs');
const {longDate, money} = require('../src/notify.cjs');
const {MODE_TEXT} = require('../src/pickup.cjs');

const SEED = 20250101, FLOOR = '2025-01-01', LAST = '2026-08-25', TZ = 'America/Los_Angeles';
const at = (date, hm) => time.zonedIso(date, hm, TZ);
const h = (when, action, extra = {}) => ({at: when, action, ...extra});
const MAYA = 'person-maya', DANA = 'person-dana', SAM = 'person-sam', SITTER = 'person-marisol';
const A = 'school-alder', K = 'school-kestrel';
const OFFICE = {[A]: 'staff-office-alder', [K]: 'staff-office-kestrel'};
const SCHOOL_NAME = {[A]: 'Alder Elementary', [K]: 'Kestrel Ridge Middle School'};
const MARK_TIME = {[A]: '09:15', [K]: '08:45'}, LUNCH_TIME = {[A]: '11:55', [K]: '12:20'};

// mulberry32: a tiny deterministic PRNG.
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- calendar -----------------------------------------------------------------------------------
// School years as they reach the history: spring 2025 (from the first day after winter break) and
// 2025–26. Both schools share the district's breaks and holidays; early dismissals are per school.
const YEARS = [
  {id: '2024-25', start: '2025-01-06', end: '2025-06-13', next: '2025–26'},
  {id: '2025-26', start: '2025-08-27', end: '2026-06-12', next: '2026–27'}
];
const range = (a, b, reason) => time.eachDate(a, b).map(date => ({date, kind: 'closed', reason}));
const DISTRICT_CLOSED = [
  ...range('2025-01-01', '2025-01-03', 'Winter break'), {date: '2025-01-20', kind: 'closed', reason: 'Martin Luther King Jr. Day'},
  ...range('2025-02-17', '2025-02-21', 'Mid-winter break'), ...range('2025-04-07', '2025-04-11', 'Spring break'),
  {date: '2025-05-26', kind: 'closed', reason: 'Memorial Day'}, {date: '2025-09-01', kind: 'closed', reason: 'Labor Day'},
  ...range('2025-11-27', '2025-11-28', 'Thanksgiving break'), ...range('2025-12-22', '2026-01-02', 'Winter break'),
  {date: '2026-01-19', kind: 'closed', reason: 'Martin Luther King Jr. Day'}, ...range('2026-02-16', '2026-02-20', 'Mid-winter break'),
  ...range('2026-04-06', '2026-04-10', 'Spring break'), {date: '2026-05-25', kind: 'closed', reason: 'Memorial Day'}];
const early = (date, dismissal, reason, announced = null) => ({date, kind: 'early_dismissal', dismissal_local: dismissal, reason, announced_at: announced});
// Unplanned changes carry the time the school announced them (a school.day_changed notification).
const CALENDAR = {
  [A]: [...DISTRICT_CLOSED, early('2025-03-14', '12:30', 'Parent-teacher conferences'), early('2025-06-13', '12:30', 'Last day of school'),
    {date: '2025-03-19', kind: 'closed', reason: 'Power outage', announced_at: at('2025-03-18', '18:30')},
    early('2025-10-24', '12:30', 'Parent-teacher conferences'), early('2025-11-14', '12:30', 'Heating failure', at('2025-11-14', '07:30')),
    early('2025-12-19', '12:30', 'Last day before winter break'), early('2026-03-13', '12:30', 'Parent-teacher conferences'),
    early('2026-06-12', '12:30', 'Last day of school')],
  [K]: [...DISTRICT_CLOSED, early('2025-03-07', '12:15', 'Teacher planning afternoon'), early('2025-06-13', '12:15', 'Last day of school'),
    early('2025-10-10', '12:15', 'Teacher planning afternoon'), early('2025-12-19', '12:15', 'Last day before winter break'),
    {date: '2026-01-27', kind: 'closed', reason: 'Water main repair', announced_at: at('2026-01-26', '17:45')},
    early('2026-03-06', '12:15', 'Teacher planning afternoon'), early('2026-06-12', '12:15', 'Last day of school')]
};
const BELL = {[A]: {start: '08:40', dismissal: '15:10'}, [K]: {start: '08:10', dismissal: '14:50'}};
const yearOf = date => YEARS.find(y => date >= y.start && date <= y.end) || null;
const entryOf = (school, date) => CALENDAR[school].find(e => e.date === date) || null;
function dayOf(school, date) {
  const e = entryOf(school, date), wd = time.weekday(date);
  if (!yearOf(date)) return {school_day: false, kind: 'outside_term'};
  if (wd === 0 || wd === 6) return {school_day: false, kind: 'weekend'};
  if (e && e.kind === 'closed') return {school_day: false, kind: 'closed', reason: e.reason};
  return {school_day: true, kind: e ? 'early_dismissal' : 'regular', dismissal: e ? e.dismissal_local : BELL[school].dismissal};
}
const isSchoolDay = (school, date) => dayOf(school, date).school_day;
// Where each child was in each year (the child record holds only the current school and grade).
const ENROLLMENT = {
  'child-theo': [{year: '2024-25', school: A, grade: '1'}, {year: '2025-26', school: A, grade: '2'}],
  'child-ines': [{year: '2025-26', school: A, grade: 'K'}],
  'child-nico': [{year: '2024-25', school: A, grade: '5'}, {year: '2025-26', school: K, grade: '6'}]
};
function enrollment(child, date) {
  const y = yearOf(date);
  return y ? ENROLLMENT[child].find(e => e.year === y.id) || null : null;
}
const schoolOn = (child, date) => (enrollment(child, date) || {}).school || null;
const schoolDaysOf = (child, start, end) => time.eachDate(start, end).filter(d => { const e = enrollment(child, d); return e && isSchoolDay(e.school, d); });
// Absence cut-off (Alder: 08:30; Kestrel: 09:00) and dismissal-change cut-off (Alder: 90 minutes
// before that day's dismissal; Kestrel: 12:00), as the district policy and the school override say.
const absenceCutoff = (school, date) => at(date, school === A ? '08:30' : '09:00');
function dismissalCutoff(school, date) {
  if (school === K) return at(date, '12:00');
  const m = time.minutesOf(dayOf(school, date).dismissal) - 90;
  return at(date, String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'));
}

// ---- menus ---------------------------------------------------------------------------------------
// A weekday rotation per school and year; every day has an item free of each child's restrictions.
const I = (id, name, allergens) => ({id, name, allergens});
const MENUS = {
  [A]: {
    '2024-25': [[I('item-pizza', 'Cheese pizza', ['milk', 'wheat']), I('item-salad', 'Garden salad', [])],
      [I('item-chicken-wrap', 'Chicken wrap', ['wheat']), I('item-rice-beans', 'Rice and beans', [])],
      [I('item-pb-sandwich', 'Peanut butter sandwich', ['peanut', 'wheat']), I('item-turkey', 'Turkey sandwich', ['wheat'])],
      [I('item-teriyaki-bowl', 'Teriyaki rice bowl', ['soy', 'wheat']), I('item-veggie-soup', 'Vegetable soup', [])],
      [I('item-fish-sticks', 'Fish sticks', ['fish', 'wheat']), I('item-bean-tacos', 'Bean tacos', [])]],
    '2025-26': [[I('item-pizza', 'Cheese pizza', ['milk', 'wheat']), I('item-salad', 'Garden salad', [])],
      [I('item-chicken-bowl', 'Chicken rice bowl', ['soy']), I('item-rice-beans', 'Rice and beans', [])],
      [I('item-turkey', 'Turkey sandwich', ['wheat']), I('item-almond-bar', 'Almond oat bar', ['tree_nut', 'wheat'])],
      [I('item-pasta', 'Pasta with tomato sauce', ['wheat']), I('item-veggie-soup', 'Vegetable soup', [])],
      [I('item-burrito', 'Bean and cheese burrito', ['milk', 'wheat']), I('item-fish-tacos', 'Fish tacos', ['fish', 'wheat'])]]
  },
  [K]: {
    '2024-25': null,
    '2025-26': [[I('item-mac', 'Macaroni and cheese', ['milk', 'wheat']), I('item-chili', 'Vegetable chili', [])],
      [I('item-teriyaki', 'Teriyaki chicken', ['soy', 'wheat']), I('item-hummus', 'Hummus plate', ['sesame'])],
      [I('item-shrimp-rice', 'Shrimp fried rice', ['shellfish', 'egg', 'soy']), I('item-bean-bowl', 'Black bean bowl', [])],
      [I('item-pizza', 'Cheese pizza', ['milk', 'wheat']), I('item-turkey', 'Turkey sandwich', ['wheat'])],
      [I('item-burger', 'Turkey burger', ['wheat', 'sesame']), I('item-yogurt', 'Yogurt parfait', ['milk', 'tree_nut'])]]
  }
};
const menuItems = (school, date) => MENUS[school][yearOf(date).id][time.weekday(date) - 1];

// ---- generation ------------------------------------------------------------------------------------
function generate(base) {
  const rnd = prng(SEED);
  const pick = list => list[Math.floor(rnd() * list.length)];
  const kids = Object.fromEntries(base.children.map(k => [k.id, k]));
  const out = {people: [], pickup_people: [], dismissal_changes: [], attendance: [], absence_reports: [], forms: [], form_responses: [],
    lunch_transactions: [], menu_days: [], payments: [], notifications: []};
  const notes = [];
  const note = (kind, when, child, objType, objId, title, body) => notes.push({kind, at: when, child_id: child, object_type: objType, object_id: objId, title, body, event_id: null, wire: null});
  const name = id => id === MAYA ? 'Maya Chen' : id === DANA ? 'Dana Okafor' : id === SAM ? 'Sam Reyes' : id === SITTER ? 'Marisol Teague' : id;
  let payN = 0;
  const payId = () => 'pay-h' + String(++payN).padStart(4, '0');

  // ---- pickup: a babysitter on Theo's list (spring 2025) and Ines's (from kindergarten), removed in June 2026.
  out.people.push({person_id: SITTER, display_name: 'Marisol Teague', phone: '555-0126'});
  const sitter = [['pp-h0001', 'child-theo', '2025-01-07', '2025-01-08', '10:40'], ['pp-h0002', 'child-ines', '2025-08-27', '2025-08-28', '11:15']];
  for (const [id, child, added, reviewed, rt] of sitter) {
    out.pickup_people.push({id, child_id: child, person_id: SITTER, display_name: 'Marisol Teague', relationship: 'babysitter', phone: '555-0126', status: 'removed',
      added_by: MAYA, created_at: at(added, '20:05'), history: [h(at(added, '20:05'), 'added_pending_review', {by: MAYA}), h(at(reviewed, rt), 'approved', {by: OFFICE[A]}),
        h(at('2026-06-15', child === 'child-theo' ? '19:00' : '19:01'), 'removed', {by: MAYA})]});
    note('pickup.person_reviewed', at(reviewed, rt), child, 'pickup_person', id, SCHOOL_NAME[A] + ': Marisol Teague approved to collect ' + kids[child].display_name,
      'The office approved Marisol Teague as a person who may collect ' + kids[child].display_name + '.');
  }
  const SITTER_FROM = {'child-theo': '2025-01-09', 'child-ines': '2025-08-29'}, SITTER_TO = '2026-06-12';

  // ---- calendar announcements.
  for (const school of [A, K]) for (const e of CALENDAR[school].filter(x => x.announced_at)) {
    const s = SCHOOL_NAME[school], dayId = 'day-' + school.slice(7) + '-' + e.date;
    const here = Object.keys(ENROLLMENT).filter(c => schoolOn(c, e.date) === school);
    const custodial = here.filter(c => base.guardian_links.some(l => l.child_id === c && l.person_id === MAYA && l.custodial));
    const lines = custodial.map(c => e.kind === 'closed' ? kids[c].display_name + ': no dismissal change for that day.'
      : kids[c].display_name + "'s way home that day is still the usual one (" + MODE_TEXT[kids[c].default_dismissal] + ').');
    const when = e.kind === 'closed' ? s + ' will be closed on ' + longDate(e.date) + '.'
      : s + ' will dismiss at ' + e.dismissal_local + ' on ' + longDate(e.date) + ' (usually ' + BELL[school].dismissal + ').';
    const cutoff = e.kind === 'early_dismissal' && custodial.length ? ' Changes for that day can be made until ' + time.localTime(dismissalCutoff(school, e.date), TZ) + ' that day.' : '';
    note('school.day_changed', e.announced_at, here.length === 1 ? here[0] : null, 'school_day', dayId,
      s + ': ' + (e.kind === 'closed' ? 'closed' : 'early dismissal at ' + e.dismissal_local) + ' on ' + longDate(e.date),
      [when, 'Reason given: ' + e.reason + '.', ...lines].join(' ') + cutoff);
  }

  // ---- attendance exceptions and reports.
  const used = new Set(); // child|date already carrying an exception
  const free = (child, d) => !used.has(child + '|' + d) && dayOf(schoolOn(child, d), d).kind === 'regular';
  function pickDays(child, from, to, n) {
    const days = schoolDaysOf(child, from, to);
    const starts = days.map((d, i) => days.slice(i, i + n)).filter(run => run.length === n && run.every(d => free(child, d)) &&
      time.daysBetween(run[0], run[n - 1]) <= n + 3);
    const run = pick(starts);
    run.forEach(d => used.add(child + '|' + d));
    return run;
  }
  let repN = 0;
  const repId = () => 'rep-tmp' + String(++repN).padStart(4, '0');
  const mark = (child, date, status, timeLocal, explanation, reportId, review, reviewedAt) => {
    const school = schoolOn(child, date), when = timeLocal ? at(date, timeLocal) : at(date, MARK_TIME[school]);
    const rec = {id: 'att-' + child + '-' + date, child_id: child, date, status, time_local: timeLocal, explanation, report_id: reportId, office_review: review,
      marked_by: OFFICE[school], marked_at: when, history: [h(when, 'marked', {status, by: OFFICE[school]})]};
    if (review) rec.history.push(h(reviewedAt, 'office_' + review));
    out.attendance.push(rec);
    if (explanation === 'unexplained') {
      const text = {absent: 'absent', late: 'late', left_early: 'leaving early'}[status];
      note('attendance.unexplained', when, child, 'attendance_record', rec.id, SCHOOL_NAME[school] + ': ' + kids[child].display_name + ' marked ' + text + ' on ' + longDate(date),
        SCHOOL_NAME[school] + ' marked ' + kids[child].display_name + ' ' + text + (timeLocal ? ' (' + timeLocal + ')' : '') + ' on ' + longDate(date) +
          ' and has no report from a guardian for that day.' + (base.guardian_links.some(l => l.child_id === child && l.person_id === MAYA && l.custodial) ? ' Open Bellnote to report the reason.' : ''));
    }
  };
  const minutes = (lo, hi) => { const m = lo + Math.floor(rnd() * (hi - lo)); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
  // Episodes: [child, kind, from, to, days, reason, decision, note]
  const EPISODES = [
    ['child-theo', 'ill', '2025-01-21', '2025-02-14', 1, 'Fever', 'excused', null],
    ['child-theo', 'ill', '2025-03-03', '2025-03-28', 2, 'Stomach flu', 'excused', 'Feel better.'],
    ['child-theo', 'late_unreported', '2025-04-14', '2025-05-16', 1],
    ['child-theo', 'early', '2025-05-05', '2025-05-30', 1, 'Dentist appointment', 'excused', null],
    ['child-nico', 'absent_unreported', '2025-02-03', '2025-02-28', 1],
    ['child-nico', 'late_unreported', '2025-05-01', '2025-05-30', 1],
    ['child-theo', 'ill', '2025-10-06', '2025-10-31', 1, 'Cold', 'excused', null],
    ['child-theo', 'late', '2025-11-03', '2025-11-21', 1, 'Doctor appointment', 'excused', null],
    ['child-theo', 'ill', '2026-01-05', '2026-01-30', 2, 'Flu', 'excused', 'Feel better soon.'],
    ['child-theo', 'late_unreported', '2026-02-02', '2026-02-27', 1],
    ['child-theo', 'trip', '2026-04-02', '2026-04-03', 2, 'Family trip before spring break', 'unexcused', 'Travel during school days is not an excused absence under district policy.'],
    ['child-theo', 'early', '2026-05-04', '2026-05-29', 1, 'Dentist appointment', 'excused', null],
    ['child-ines', 'ill', '2025-09-15', '2025-10-03', 2, 'Fever', 'excused', null],
    ['child-ines', 'cancelled', '2025-10-13', '2025-10-31', 1, 'Sore throat'],
    ['child-ines', 'ill', '2025-11-03', '2025-11-21', 1, 'Cough', 'excused', null],
    ['child-ines', 'early', '2025-12-01', '2025-12-12', 1, 'Allergist appointment', 'excused', 'Thank you for letting us know.'],
    ['child-ines', 'late', '2026-01-12', '2026-01-30', 1, 'Pediatrician appointment', 'excused', null],
    ['child-ines', 'ill', '2026-02-23', '2026-03-13', 3, 'Strep throat', 'excused', 'Feel better.'],
    ['child-ines', 'absent_unreported', '2026-03-16', '2026-04-03', 1],
    ['child-nico', 'absent_unreported', '2025-10-13', '2025-11-07', 1],
    ['child-nico', 'absent_unreported', '2026-01-05', '2026-01-23', 1],
    ['child-nico', 'early_unreported', '2026-04-13', '2026-05-08', 1]
  ];
  for (const [child, kind, from, to, n, reason, decision, officeNote] of EPISODES) {
    const school = schoolOn(child, from);
    const dates = kind === 'trip' ? (() => { const r = schoolDaysOf(child, from, to); r.forEach(d => used.add(child + '|' + d)); return r; })() : pickDays(child, from, to, n);
    if (kind.endsWith('_unreported')) {
      const status = kind.startsWith('absent') ? 'absent' : kind.startsWith('late') ? 'late' : 'left_early';
      mark(child, dates[0], status, status === 'absent' ? null : status === 'late' ? minutes(9 * 60 + 2, 9 * 60 + 25) : '13:10', 'unexplained', null, null);
      continue;
    }
    const by = rnd() < 0.3 ? DANA : MAYA, first = dates[0];
    const r = {id: repId(), child_id: child, kind: 'absent', dates, time_local: null, reason, state: 'submitted', cancelled_dates: [], submitted_by: by,
      submitted_at: null, reviewed_by: null, reviewed_at: null, review_note: null, request_id: null, history: []};
    let status = 'absent', markTime = null;
    if (kind === 'ill') r.submitted_at = at(first, minutes(6 * 60 + 20, 8 * 60 + 15));
    else if (kind === 'trip') r.submitted_at = at(time.addDays(first, -8), '21:00');
    else if (kind === 'cancelled') r.submitted_at = at(time.addDays(first, -1), '21:10');
    else if (kind === 'late') { r.kind = 'late'; r.time_local = '09:45'; r.submitted_at = at(first, minutes(7 * 60 + 10, 8 * 60 + 20)); status = 'late'; markTime = '09:50'; }
    else if (kind === 'early') { r.kind = 'early_leave'; r.time_local = '13:30'; r.submitted_at = at(time.addDays(first, -1), minutes(19 * 60, 21 * 60 + 30)); status = 'left_early'; markTime = '13:30'; }
    r.history.push(h(r.submitted_at, 'submitted', {by}));
    if (kind === 'cancelled') {
      const when = at(first, '07:20');
      Object.assign(r, {state: 'cancelled', dates: [], cancelled_dates: [first]});
      r.history.push(h(when, 'cancelled', {by, dates: [first]}));
      used.delete(child + '|' + first); // she went to school after all
      out.absence_reports.push(r);
      continue;
    }
    const reviewedAt = at(dates[dates.length - 1], minutes(13 * 60 + 10, 15 * 60 + 40));
    Object.assign(r, {state: decision, reviewed_by: OFFICE[school], reviewed_at: reviewedAt, review_note: officeNote});
    r.history.push(h(reviewedAt, decision, {by: OFFICE[school]}));
    out.absence_reports.push(r);
    for (const d of dates) mark(child, d, status, markTime, 'explained', r.id, decision, reviewedAt);
    note('absence.reviewed', reviewedAt, child, 'absence_report', r.id, SCHOOL_NAME[school] + ': ' + kids[child].display_name + "'s report marked " + decision,
      'The office reviewed your report for ' + kids[child].display_name + ' (' + dates.map(longDate).join(', ') + ') and marked it ' + decision + '.' +
        (officeNote ? ' Note from the office: ' + officeNote : ''));
  }
  const away = (child, d) => out.attendance.some(a => a.child_id === child && a.date === d && ['absent', 'left_early'].includes(a.status));

  // ---- dismissal changes (custodial children only: Theo and Ines).
  let dcN = 0;
  const dcId = () => 'dc-h' + String(++dcN).padStart(4, '0');
  for (const child of ['child-theo', 'child-ines']) {
    const days = schoolDaysOf(child, FLOOR, LAST).filter(d => dayOf(A, d).kind === 'regular' && !away(child, d) && !CALENDAR[A].some(e => e.announced_at && e.date === d));
    for (let i = 0; i < days.length; i++) {
      if (rnd() > 0.06) continue;
      const date = days[i], sitterOk = date >= SITTER_FROM[child] && date <= SITTER_TO;
      const options = child === 'child-theo'
        ? [['pickup', DANA], ['pickup', DANA], ['after_care', null], ['pickup', MAYA], ...(sitterOk ? [['pickup', SITTER], ['pickup', SITTER]] : [])]
        : [['pickup', MAYA], ['pickup', DANA], ['pickup', DANA], ...(sitterOk ? [['pickup', SITTER], ['pickup', SITTER]] : [])];
      const [mode, person] = pick(options), by = rnd() < 0.35 ? DANA : MAYA;
      const created = at(time.addDays(date, -1), minutes(18 * 60 + 30, 21 * 60 + 45));
      const d = {id: dcId(), child_id: child, date, mode, person_id: person, note: null, recorded_by: by, actor: 'seed', created_at: created, status: 'active',
        replaces: null, replaced_by: null, request_id: null, event_id: null, history: [h(created, 'recorded', {by})]};
      const describe = x => x.mode === 'pickup' ? 'collected by ' + name(x.person_id) : MODE_TEXT[x.mode];
      out.dismissal_changes.push(d);
      if (by === DANA) note('dismissal.recorded', created, child, 'dismissal_change', d.id, 'Dana Okafor changed ' + kids[child].display_name + "'s way home on " + longDate(date),
        'Dana Okafor recorded that ' + kids[child].display_name + ' will be ' + describe(d) + ' on ' + longDate(date) + '.');
      const roll = rnd();
      if (by === MAYA && roll < 0.2) {
        // Dana changes the plan the next morning, before the cut-off.
        const when = at(date, '07:35'), alt = d.person_id === DANA ? ['pickup', MAYA] : ['pickup', DANA];
        const d2 = {id: dcId(), child_id: child, date, mode: alt[0], person_id: alt[1], note: null, recorded_by: DANA, actor: 'seed', created_at: when, status: 'active',
          replaces: d.id, replaced_by: null, request_id: null, event_id: null, history: [h(when, 'recorded', {by: DANA})]};
        Object.assign(d, {status: 'replaced', replaced_by: d2.id}); d.history.push(h(when, 'replaced', {by: d2.id}));
        out.dismissal_changes.push(d2);
        note('dismissal.recorded', when, child, 'dismissal_change', d2.id, 'Dana Okafor changed ' + kids[child].display_name + "'s way home on " + longDate(date),
          'Dana Okafor recorded that ' + kids[child].display_name + ' will be ' + describe(d2) + ' on ' + longDate(date) + '. This replaces the earlier plan (' + describe(d) + ', set by you).');
      } else if (by === MAYA && roll < 0.3) {
        const when = at(date, '07:05');
        d.status = 'cancelled'; d.history.push(h(when, 'cancelled', {by: MAYA}));
      }
      i += 2; // at most one change in three school days
    }
  }

  // ---- forms and responses.
  const q = {
    lunch: {id: 'q-lunch', type: 'choice', label: 'Lunch for the day', options: ['school_sack_lunch', 'bring_own'], required: true},
    phone: {id: 'q-emergency', type: 'text', label: 'Emergency phone for the day', required: true},
    chaperone: {id: 'q-chaperone', type: 'boolean', label: 'I can volunteer as a chaperone', required: false},
    allergies: {id: 'q-allergies', type: 'text', label: 'Known allergies (write "none" if none)', required: true},
    doses: {id: 'q-doses', type: 'number', label: 'Puffs per dose', required: true},
    size: {id: 'q-size', type: 'choice', label: 'T-shirt size', options: ['youth_s', 'youth_m', 'youth_l', 'adult_s'], required: true},
    consent: {id: 'q-consent-allergies', type: 'text', label: 'Known vaccine allergies (write "none" if none)', required: true},
    glasses: {id: 'q-glasses', type: 'boolean', label: 'My child wears glasses or contact lenses', required: false},
    attending: {id: 'q-attending', type: 'boolean', label: 'A guardian will attend', required: true}
  };
  const form = (id, school, kidsOf, kind, title, text, questions, fee, eventDate, due, published) => {
    const content = {title, text, questions: structuredClone(questions), fee_cents: fee, event_date: eventDate};
    const f = {id, school_id: school, child_ids: kidsOf, kind, ...content, due_at: due, version: 1,
      versions: [{version: 1, at: published, ...structuredClone(content), reason: null, event_id: null}], published_at: published,
      history: [h(published, 'published', {version: 1})]};
    out.forms.push(f);
    const names = kidsOf.map(k => kids[k].display_name).join(' and ');
    note('form.published', published, kidsOf.length === 1 ? kidsOf[0] : null, 'form', id, SCHOOL_NAME[school] + ': ' + title,
      SCHOOL_NAME[school] + ' sent a form for ' + names + ': "' + title + '". ' + (fee ? 'Fee: ' + money(fee) + '. ' : 'No fee. ') +
        'Answers are due by ' + time.longDateTime(due, TZ) + '.');
    return f;
  };
  let frN = 0;
  const respond = (f, child, by, action, answers, when, method = 'pm-0001') => {
    const r = {id: 'fr-h' + String(++frN).padStart(4, '0'), form_id: f.id, child_id: child, by_person_id: by, state: action, form_version: f.version,
      answers: action === 'declined' ? {} : answers, paid_cents: 0, payment_ids: [], answered_at: when, history: [h(when, action, {by, form_version: f.version})]};
    if (action === 'signed' && f.fee_cents) {
      r.paid_cents = f.fee_cents;
      if (by === MAYA) {
        const p = {id: payId(), kind: 'form_fee', child_id: child, amount_cents: f.fee_cents, payment_method_id: method, object_type: 'form_response', object_id: r.id,
          status: 'paid', paid_at: when, refunded_at: null, refund_reason: null, request_id: null};
        out.payments.push(p); r.payment_ids.push(p.id);
      }
    }
    out.form_responses.push(r);
    if (by !== MAYA) note('form.answered', when, child, 'form_response', r.id, name(by) + ' ' + action + ' "' + f.title + '" for ' + kids[child].display_name,
      name(by) + ' ' + action + ' "' + f.title + '" for ' + kids[child].display_name + ' (version ' + f.version + '). Their answer holds the form for ' +
        kids[child].display_name + '; it cannot be changed from this account.');
    return r;
  };
  const T = 'child-theo', N = 'child-nico', IN = 'child-ines', TI = [T, IN];
  // Spring 2025: Theo in grade 1 at Alder; Nico, in grade 5 at Alder, gets Kestrel's form for incoming grade 6 families.
  let f = form('form-2025-vision', A, [T], 'medical_consent', 'Vision and hearing screening', 'The school nurse screens vision and hearing on 12 March. Sign to consent, or decline.',
    [q.glasses], 0, '2025-03-12', at('2025-03-07', '16:00'), at('2025-02-24', '15:00'));
  respond(f, T, DANA, 'signed', {'q-glasses': false}, at('2025-02-25', '07:40'));
  form('form-2025-yearbook', A, [T], 'information', 'Yearbook order', 'Order the 2024–25 yearbook. The fee covers one copy.', [q.size], 1800, null, at('2025-03-28', '16:00'), at('2025-03-03', '15:00'));
  f = form('form-2025-zoo', A, [T], 'permission_slip', 'Grade 1 zoo trip', 'Grade 1 visits the county zoo on 2 May. The bus leaves at 09:00 and returns by 14:00; the fee covers the bus and entry.',
    [q.lunch, q.phone], 1200, '2025-05-02', at('2025-04-25', '16:00'), at('2025-04-14', '15:00'));
  respond(f, T, MAYA, 'signed', {'q-lunch': 'school_sack_lunch', 'q-emergency': '555-0100'}, at('2025-04-15', '20:10'));
  f = form('form-2025-k-orientation', K, [N], 'information', 'Grade 6 orientation evening', 'Incoming grade 6 students and their families are invited to meet the teachers on 21 May at 18:00.',
    [q.attending], 0, '2025-05-21', at('2025-05-16', '16:00'), at('2025-05-05', '15:00'));
  respond(f, N, SAM, 'signed', {'q-attending': true}, at('2025-05-06', '19:30'));
  f = form('form-2025-field-day', A, [T], 'information', 'Field day', 'Field day is on 6 June. Send a hat and a water bottle; families may volunteer at the stations.',
    [q.chaperone], 0, '2025-06-06', at('2025-05-30', '16:00'), at('2025-05-19', '15:00'));
  respond(f, T, MAYA, 'signed', {'q-chaperone': true}, at('2025-05-19', '21:05'));
  // 2025–26: Theo in grade 2 and Ines in kindergarten at Alder; Nico in grade 6 at Kestrel.
  f = form('form-2526-inhaler', A, [IN], 'medication', 'Rescue inhaler authorization (2025–26)', 'Authorizes the health office to keep and give Ines her rescue inhaler as prescribed.',
    [q.doses, q.allergies], 0, null, at('2026-06-12', '12:00'), at('2025-08-20', '12:00'));
  respond(f, IN, MAYA, 'signed', {'q-doses': 2, 'q-allergies': 'peanut, tree nuts'}, at('2025-08-21', '19:00'));
  f = form('form-2526-emergency', A, TI, 'information', 'Emergency contacts and release (2025–26)', 'Confirm the phone number the school should call first in an emergency this year.',
    [q.phone], 0, null, at('2025-09-12', '16:00'), at('2025-08-27', '15:00'));
  respond(f, T, MAYA, 'signed', {'q-emergency': '555-0100'}, at('2025-08-27', '21:00'));
  respond(f, IN, MAYA, 'signed', {'q-emergency': '555-0100'}, at('2025-08-27', '21:01'));
  f = form('form-2526-k-emergency', K, [N], 'information', 'Emergency contacts and release (2025–26)', 'Confirm the phone number the school should call first in an emergency this year.',
    [q.phone], 0, null, at('2025-09-12', '16:00'), at('2025-08-27', '15:00'));
  respond(f, N, SAM, 'signed', {'q-emergency': '555-0167'}, at('2025-08-28', '18:30'));
  f = form('form-2526-picture', A, TI, 'information', 'Fall picture day order', 'Picture day is 2 October. Order packages through the photographer separately.',
    [q.size], 0, '2025-10-02', at('2025-10-02', '08:00'), at('2025-09-22', '15:00'));
  respond(f, T, MAYA, 'signed', {'q-size': 'youth_s'}, at('2025-09-23', '20:40'));
  respond(f, IN, DANA, 'signed', {'q-size': 'youth_s'}, at('2025-09-24', '07:20'));
  f = form('form-2526-orchard', A, TI, 'permission_slip', 'Apple orchard walk', 'Classes walk to the orchard on 17 October. The fee covers the cider-press demonstration.',
    [q.phone, q.chaperone], 500, '2025-10-17', at('2025-10-10', '16:00'), at('2025-09-29', '15:00'));
  respond(f, T, DANA, 'signed', {'q-emergency': '555-0142'}, at('2025-09-30', '07:45'));
  respond(f, IN, MAYA, 'signed', {'q-emergency': '555-0100', 'q-chaperone': false}, at('2025-09-30', '20:15'));
  f = form('form-2526-flu', A, TI, 'medical_consent', 'School flu clinic consent (2025)', 'A visiting nurse team will offer the seasonal flu vaccine at school on 5 November. Sign to consent, or decline.',
    [q.consent], 0, '2025-11-05', at('2025-10-29', '16:00'), at('2025-10-13', '15:00'));
  respond(f, T, DANA, 'signed', {'q-consent-allergies': 'none'}, at('2025-10-14', '07:30'));
  respond(f, IN, MAYA, 'declined', {}, at('2025-10-14', '21:00'));
  f = form('form-2526-winter-sing', A, TI, 'information', 'Winter sing-along', 'Families are welcome at the winter sing-along on 18 December at 14:00.',
    [q.chaperone], 0, '2025-12-18', at('2025-12-12', '16:00'), at('2025-12-01', '15:00'));
  respond(f, T, MAYA, 'signed', {'q-chaperone': false}, at('2025-12-02', '20:30'));
  respond(f, IN, DANA, 'signed', {'q-chaperone': true}, at('2025-12-03', '07:15'));
  // A form whose trip date moved after Maya signed: version 2, signed again with no second charge.
  f = form('form-2526-science', A, [T], 'permission_slip', 'Grade 2 science center trip', 'Bus leaves 09:00 on 22 January and returns by 14:15.',
    [q.lunch, q.phone], 1500, '2026-01-22', at('2026-01-16', '16:00'), at('2026-01-05', '15:00'));
  const sci = respond(f, T, MAYA, 'signed', {'q-lunch': 'school_sack_lunch', 'q-emergency': '555-0100'}, at('2026-01-05', '20:30'));
  const changedAt = at('2026-01-12', '10:00'), reason = 'The science center moved our booking';
  Object.assign(f, {version: 2, text: 'Bus leaves 09:00 on 29 January and returns by 14:15.', event_date: '2026-01-29'});
  f.versions.push({version: 2, at: changedAt, title: f.title, text: f.text, questions: structuredClone(f.questions), fee_cents: f.fee_cents, event_date: f.event_date, reason, event_id: null});
  f.history.push(h(changedAt, 'changed', {version: 2, changed_fields: ['text', 'event_date'], reason}));
  note('form.changed', changedAt, T, 'form', f.id, SCHOOL_NAME[A] + ': "' + f.title + '" was changed',
    'The school changed the text and the event date on "' + f.title + '" (' + reason + '). Your signature for Theo Okafor no longer counts: review version 2 and sign again or withdraw.');
  const resigned = at('2026-01-12', '20:05');
  sci.history.push(h(changedAt, 'needs_review', {form_version: 2}), h(resigned, 'signed', {by: MAYA, form_version: 2}));
  Object.assign(sci, {form_version: 2, answered_at: resigned});
  f = form('form-2526-farm', A, [IN], 'permission_slip', 'Kindergarten farm visit', 'Kindergarten visits Hollow Creek farm on 8 May. The fee covers the bus.',
    [q.lunch, q.phone], 800, '2026-05-08', at('2026-05-01', '16:00'), at('2026-04-20', '15:00'));
  const farm = respond(f, IN, MAYA, 'signed', {'q-lunch': 'bring_own', 'q-emergency': '555-0100'}, at('2026-04-20', '20:15'), 'pm-0002');
  const withdrawn = at('2026-04-30', '07:30');
  Object.assign(farm, {state: 'withdrawn', paid_cents: 0}); farm.history.push(h(withdrawn, 'withdrawn', {by: MAYA, refunded_cents: 800}));
  Object.assign(out.payments.find(p => p.id === farm.payment_ids[0]), {status: 'refunded', refunded_at: withdrawn, refund_reason: 'withdrawn'});
  f = form('form-2526-field-day', A, TI, 'information', 'Field day', 'Field day is on 5 June. Send a hat and a water bottle; families may volunteer at the stations.',
    [q.chaperone], 0, '2026-06-05', at('2026-05-29', '16:00'), at('2026-05-18', '15:00'));
  respond(f, T, MAYA, 'signed', {'q-chaperone': false}, at('2026-05-18', '20:50'));
  respond(f, IN, MAYA, 'signed', {'q-chaperone': false}, at('2026-05-18', '20:51'));
  f = form('form-2526-k-science-fair', K, [N], 'information', 'Science fair entry', 'Grade 6 students may enter the science fair on 19 March.',
    [q.chaperone], 0, '2026-03-19', at('2026-02-13', '16:00'), at('2026-01-26', '15:00'));
  respond(f, N, SAM, 'declined', {}, at('2026-01-27', '19:10'));
  f = form('form-2526-k-physical', K, [N], 'medical_consent', 'Spring sports physical', 'Consent for the school physical required before spring sports tryouts.',
    [q.allergies], 0, null, at('2026-02-27', '16:00'), at('2026-02-02', '15:00'));
  respond(f, N, SAM, 'signed', {'q-allergies': 'milk'}, at('2026-02-03', '18:40'));
  f = form('form-2526-k-outdoor', K, [N], 'permission_slip', 'Grade 6 outdoor school', 'Grade 6 spends 20 to 22 May at the county outdoor school. The fee covers lodging, meals and the bus.',
    [q.allergies, q.phone], 9500, '2026-05-20', at('2026-04-24', '16:00'), at('2026-03-30', '15:00'));
  respond(f, N, SAM, 'signed', {'q-allergies': 'milk', 'q-emergency': '555-0167'}, at('2026-03-31', '19:00'));

  // ---- lunch: menus, purchases, refunds, top-ups after low-balance notices, year-end rollovers.
  const PRICE = {'child-theo': {'2024-25': 350, '2025-26': 360}, 'child-ines': {'2025-26': 330}, 'child-nico': {'2024-25': 350, '2025-26': 400}};
  // Before 2026–27 the children bought school lunch about once a week, on Fridays, and now and then on
  // another day; the rest of the week they took lunch from home.
  const BUYS = {'child-theo': [5], 'child-ines': [5], 'child-nico': [5]};
  const CARRY = Object.fromEntries(base.lunch_transactions.filter(t => t.kind === 'adjustment' && t.note === 'Balance carried over from last year').map(t => [t.lunch_account_id, t]));
  const OPENING = {'lunch-theo': 1840, 'lunch-nico': 2210};
  const REFUNDS = {'child-theo': '2025-03', 'child-nico': '2025-10'};
  const menuDays = new Map();
  let txN = 0;
  const txId = () => 'tx-h' + String(++txN).padStart(4, '0');
  for (const acct of base.lunch_accounts) {
    const child = acct.child_id, kid = kids[child], thr = acct.low_balance_threshold_cents;
    // Purchases first (they do not depend on the balance).
    const buys = [];
    let refunded = false;
    for (const date of schoolDaysOf(child, FLOOR, LAST)) {
      const r = rnd(), school = schoolOn(child, date);
      const buy = BUYS[child].includes(time.weekday(date)) ? r > 0.08 : r < 0.03;
      if (!buy || out.attendance.some(a => a.child_id === child && a.date === date && a.status === 'absent')) continue;
      const items = menuItems(school, date), item = items.find(it => !it.allergens.some(x => kid.meal_restrictions.includes(x)));
      menuDays.set(school + '|' + date, items);
      const price = PRICE[child][yearOf(date).id];
      buys.push({kind: 'purchase', amount: -price, at: at(date, LUNCH_TIME[school]), item: item.name, allergens: [...item.allergens], date});
      if (!refunded && REFUNDS[child] && date.startsWith(REFUNDS[child])) {
        refunded = true;
        buys.push({kind: 'purchase', amount: -price, at: at(date, LUNCH_TIME[school].slice(0, 3) + '58'), item: item.name, allergens: [...item.allergens], date});
        buys.push({kind: 'refund', amount: price, at: at(date, '14:00'), item: item.name, note: 'Charged twice', date});
      }
    }
    const opening = OPENING[acct.id] ? [{kind: 'adjustment', amount: OPENING[acct.id], at: at('2025-01-02', '08:00'), note: 'Balance brought forward from 2024'}] : [];
    const carry = CARRY[acct.id].amount_cents;
    // Simulate with top-ups after low-balance notices; the last top-up of 2025–26 is placed so the
    // year ends on the balance the hand-written year carries over.
    const simulate = finalDate => {
      const rows = [...opening], ups = [];
      let bal = opening.reduce((s, x) => s + x.amount, 0), notified = false, pending = null, minBal = bal, firstYearEnd = null;
      const push = row => { rows.push(row); bal += row.amount; minBal = Math.min(minBal, bal);
        if (row.kind === 'purchase' && bal < thr && !notified) { notified = true; row.low = bal; }
        else if (bal >= thr) notified = false; };
      const upRnd = prng(SEED + acct.id.length * 7919 + carry);
      for (const b of buys) {
        // Year-end rollover between the two years.
        if (b.date >= '2025-08-27' && firstYearEnd === null && opening.length) {
          firstYearEnd = bal;
          if (bal !== 0) { push({kind: 'adjustment', amount: -bal, at: at('2025-06-30', '17:00'), note: 'Year-end rollover: balance moved to the 2025–26 school year'}); }
          if (firstYearEnd !== 0) push({kind: 'adjustment', amount: firstYearEnd, at: at('2025-08-27', '08:00'), note: 'Balance carried over from last year'});
          pending = null;
        }
        if (!opening.length && !rows.length) push({kind: 'topup', amount: 4000, at: at('2025-08-24', '19:30')});
        if (pending && Date.parse(pending.at) < Date.parse(b.at)) { push(pending); ups.push(pending); pending = null; }
        if (finalDate && !finalDate.done && b.date > finalDate.date) {
          const after = buys.filter(x => x.date > finalDate.date).reduce((s, x) => s + x.amount, 0);
          finalDate.done = true;
          const amount = carry - bal - after;
          if (amount < 500 || amount > 20000) return null;
          const row = {kind: 'topup', amount, at: at(finalDate.date, '19:30')};
          push(row); ups.push(row); pending = null;
        }
        push({...b});
        if (bal < thr && !pending && !(finalDate && b.date >= time.addDays(finalDate.date, -3) && b.date <= finalDate.date)) {
          const next = time.addDays(b.date, upRnd() < 0.7 ? 0 : 1);
          if (!finalDate || next < finalDate.date) pending = {kind: 'topup', amount: [2000, 2500, 3000][Math.floor(upRnd() * 3)], at: at(next, upRnd() < 0.5 ? '20:00' : '21:15')};
        }
      }
      if (pending) return null;
      return bal === carry && minBal >= -1000 ? rows : null;
    };
    let rows = null;
    for (let d = '2026-05-03'; !rows && d >= '2026-03-01'; d = time.addDays(d, -7)) rows = simulate({date: d});
    if (!rows) throw new Error('No final top-up date balances ' + acct.id);
    rows.push({kind: 'adjustment', amount: -carry, at: at('2026-06-30', '17:00'), note: 'Year-end rollover: balance moved to the 2026–27 school year'});
    let bal = 0;
    for (const r of rows) {
      bal += r.amount;
      const tx = {id: txId(), lunch_account_id: acct.id, child_id: child, kind: r.kind, amount_cents: r.amount, item: r.item || null, allergens: r.allergens || [], at: r.at,
        payment_id: null, note: r.note || null, request_id: null, event_id: null};
      if (r.kind === 'topup') {
        const p = {id: payId(), kind: 'lunch_topup', child_id: child, amount_cents: r.amount, payment_method_id: r.at < '2025-10' ? 'pm-0002' : 'pm-0001',
          object_type: 'lunch_transaction', object_id: tx.id, status: 'paid', paid_at: r.at, refunded_at: null, refund_reason: null, request_id: null};
        tx.payment_id = p.id; out.payments.push(p);
      }
      out.lunch_transactions.push(tx);
      if (r.kind === 'refund') note('lunch.refund', r.at, child, 'lunch_transaction', tx.id, 'Lunch refund for ' + kid.display_name + ': ' + money(r.amount),
        'The cafeteria credited ' + money(r.amount) + ' to ' + kid.display_name + "'s lunch account for " + r.item + '. Balance: ' + money(bal) + '.');
      if (r.low !== undefined) note('lunch.low_balance', r.at, child, 'lunch_account', acct.id, kid.display_name + "'s lunch balance is " + money(r.low),
        kid.display_name + "'s lunch balance fell to " + money(r.low) + ', under your threshold of ' + money(thr) + '.');
    }
  }
  for (const [key, items] of [...menuDays].sort((x, y) => x[0].split('|')[1].localeCompare(y[0].split('|')[1]) || x[0].localeCompare(y[0]))) {
    const [school, date] = key.split('|');
    out.menu_days.push({id: 'menu-' + school.slice(7) + '-' + date, school_id: school, date, items: structuredClone(items)});
  }

  // ---- ordering: every collection in time order; notifications numbered in that order.
  const byTime = key => (x, y) => Date.parse(x[key]) - Date.parse(y[key]) || x.id.localeCompare(y.id);
  out.attendance.sort((x, y) => x.date.localeCompare(y.date) || x.child_id.localeCompare(y.child_id));
  // Report IDs follow submission order; attendance and notifications that name a report follow it.
  const ids = new Map(out.absence_reports.sort(byTime('submitted_at')).map((r, i) => [r.id, 'rep-h' + String(i + 1).padStart(4, '0')]));
  for (const r of out.absence_reports) r.id = ids.get(r.id);
  for (const a of out.attendance) if (a.report_id) a.report_id = ids.get(a.report_id);
  for (const n of notes) if (n.object_type === 'absence_report') n.object_id = ids.get(n.object_id);
  out.dismissal_changes.sort((x, y) => x.date.localeCompare(y.date) || Date.parse(x.created_at) - Date.parse(y.created_at));
  out.form_responses.sort(byTime('answered_at'));
  out.lunch_transactions.sort(byTime('at'));
  out.payments.sort(byTime('paid_at'));
  notes.sort((x, y) => Date.parse(x.at) - Date.parse(y.at) || x.object_id.localeCompare(y.object_id));
  out.notifications = notes.map((n, i) => ({id: 'ntf-h' + String(i + 1).padStart(4, '0'), ...n}));
  return out;
}
// Merge the generated history in front of the hand-written records (both in time order).
function merge(d) {
  const g = generate(d);
  d.people.push(...g.people);
  for (const k of ['pickup_people', 'dismissal_changes', 'attendance', 'absence_reports', 'forms', 'form_responses', 'lunch_transactions', 'menu_days', 'payments', 'notifications']) {
    d[k] = [...g[k], ...d[k]];
  }
  return d;
}

// ---- checks of the generated history (used by scripts/check-fixtures.cjs) ---------------------------
const isGenerated = id => /^(rep|dc|fr|tx|pay|ntf|pp)-h\d{4}$/.test(id) || /^form-20(25|26)-/.test(id) || /^form-2526-/.test(id);
function historyProblems(data, fail) {
  const counts = {};
  const gen = k => data[k].filter(r => r.id && (isGenerated(r.id) || (k === 'attendance' || k === 'menu_days') && r.date < '2026-08-26'));
  for (const k of ['attendance', 'absence_reports', 'forms', 'form_responses', 'dismissal_changes', 'pickup_people', 'lunch_transactions', 'menu_days', 'payments', 'notifications']) counts[k] = gen(k).length;
  const links = data.guardian_links, right = (child, person, r) => links.some(l => l.child_id === child && l.person_id === person && l[r]);
  const kidName = id => data.children.find(k => k.id === id).display_name;
  // Calendar: generated school-day records fall on school days of that year at the child's school then.
  for (const a of gen('attendance')) { const s = schoolOn(a.child_id, a.date); if (!s || !isSchoolDay(s, a.date)) fail(a.id + ' is not on a school day of ' + a.date.slice(0, 4)); }
  for (const r of gen('absence_reports')) for (const d of [...r.dates, ...r.cancelled_dates]) if (!isSchoolDay(schoolOn(r.child_id, d), d)) fail(r.id + ' covers ' + d + ', not a school day');
  for (const d of gen('dismissal_changes')) if (!isSchoolDay(schoolOn(d.child_id, d.date), d.date)) fail(d.id + ' is not on a school day');
  for (const m of gen('menu_days')) if (!isSchoolDay(m.school_id, m.date)) fail(m.id + ' is not on a school day');
  for (const f of gen('forms')) if (!isSchoolDay(f.school_id, time.localDate(f.due_at, TZ))) fail(f.id + ' is not due on a school day');
  for (const t of gen('lunch_transactions').filter(x => x.kind === 'purchase')) {
    const date = time.localDate(t.at, TZ), s = schoolOn(t.child_id, date);
    if (!s || !isSchoolDay(s, date)) fail(t.id + ' purchase is not on a school day');
    if (data.attendance.some(a => a.child_id === t.child_id && a.date === date && a.status === 'absent')) fail(t.id + ' purchase on a day the child was absent');
    const menu = data.menu_days.find(m => m.school_id === s && m.date === date);
    if (!menu || !menu.items.some(i => i.name === t.item)) fail(t.id + ' item is not on that day\'s menu');
    const kid = data.children.find(k => k.id === t.child_id);
    if (t.allergens.some(x => kid.meal_restrictions.includes(x))) fail(t.id + ' carries a restricted allergen');
  }
  // Enrollment: Ines has no school-day records before kindergarten.
  for (const k of ['attendance', 'lunch_transactions']) for (const r of gen(k)) {
    const date = r.date || time.localDate(r.at, TZ);
    if (r.child_id === 'child-ines' && date < '2025-08-24') fail(r.id + ' is before Ines started school');
  }
  // Rights as seeded: reports and dismissal changes only by custodial guardians; answers by can_sign
  // guardians; fees paid from this account only where the account holder can pay; nothing of a
  // non-custodial child's pickup list or dismissal plans; no restricted or unapproved collector.
  for (const r of gen('absence_reports')) if (!right(r.child_id, r.submitted_by, 'custodial') || !right(r.child_id, data.owner_person_id, 'custodial')) fail(r.id + ' reported without custodial rights');
  for (const r of gen('form_responses')) {
    if (!right(r.child_id, r.by_person_id, 'can_sign')) fail(r.id + ' answered without can_sign');
    if (r.paid_cents && !right(r.child_id, r.by_person_id, 'can_pay')) fail(r.id + ' fee paid without can_pay');
  }
  for (const d of gen('dismissal_changes')) {
    if (!right(d.child_id, data.owner_person_id, 'custodial') || !right(d.child_id, d.recorded_by, 'custodial')) fail(d.id + ' for a child without custodial rights');
    if (d.person_id && data.restrictions.some(r => r.child_id === d.child_id && r.person_id === d.person_id)) fail(d.id + ' names a restricted person');
    if (d.person_id && !right(d.child_id, d.person_id, 'can_pickup')) {
      const pp = data.pickup_people.find(p => p.child_id === d.child_id && p.person_id === d.person_id && p.history.some(x => x.action === 'approved'));
      const from = pp && pp.history.find(x => x.action === 'approved').at, to = pp && (pp.history.find(x => x.action === 'removed') || {}).at;
      if (!pp || Date.parse(d.created_at) < Date.parse(from) || (to && Date.parse(d.created_at) > Date.parse(to))) fail(d.id + ' names a person not approved at the time');
    }
    if (Date.parse(d.created_at) >= Date.parse(dismissalCutoff(schoolOn(d.child_id, d.date), d.date))) fail(d.id + ' recorded after its cut-off');
  }
  for (const p of gen('pickup_people')) if (!right(p.child_id, data.owner_person_id, 'custodial')) fail(p.id + ' pickup person for a child without custodial rights');
  for (const n of gen('notifications')) {
    if (['pickup.person_reviewed', 'dismissal.recorded', 'dismissal.void'].includes(n.kind) && !right(n.child_id, data.owner_person_id, 'custodial')) fail(n.id + ' leaks pickup details');
    for (const k of data.children.filter(x => !right(x.id, data.owner_person_id, 'custodial'))) {
      if (n.kind === 'school.day_changed' && n.body.includes(k.display_name)) fail(n.id + ' names a non-custodial child\'s plan');
    }
  }
  // Report cut-offs: an absence before that day's cut-off, a late arrival or early leave before its time.
  for (const r of gen('absence_reports')) {
    const d = r.dates[0] || r.cancelled_dates[0], s = schoolOn(r.child_id, d);
    const cutoff = r.kind === 'absent' ? absenceCutoff(s, d) : at(d, r.time_local);
    if (Date.parse(r.submitted_at) >= Date.parse(cutoff)) fail(r.id + ' submitted after its cut-off');
    const cancelled = r.history.find(x => x.action === 'cancelled');
    if (cancelled && Date.parse(cancelled.at) >= Date.parse(cutoff)) fail(r.id + ' cancelled after its cut-off');
  }
  // Ledgers: each account's generated rows sum to zero (the year-end rollover moves the balance to the
  // next year), and the 2026 rollover equals the hand-written carry-over of 2026-08-26.
  for (const a of data.lunch_accounts) {
    const rows = gen('lunch_transactions').filter(t => t.lunch_account_id === a.id);
    const sum = rows.reduce((s, t) => s + t.amount_cents, 0);
    const close = rows.find(t => t.note === 'Year-end rollover: balance moved to the 2026–27 school year');
    const carry = data.lunch_transactions.find(t => !isGenerated(t.id) && t.lunch_account_id === a.id && t.note === 'Balance carried over from last year');
    if (sum !== 0) fail(a.id + ' generated rows do not end in a rollover to zero');
    if (!close || !carry || close.amount_cents !== -carry.amount_cents) fail(a.id + ' 2026 rollover does not match the hand-written carry-over');
    const before = rows.filter(t => t !== close).reduce((s, t) => s + t.amount_cents, 0);
    if (carry && before !== carry.amount_cents) fail(a.id + ' generated history does not produce the carried-over balance');
    for (const t of rows.filter(x => x.kind === 'topup')) {
      const p = data.payments.find(x => x.id === t.payment_id), pol = data.district.policy;
      if (t.amount_cents < pol.topup_min_cents || t.amount_cents > pol.topup_max_cents) fail(t.id + ' top-up outside the district range');
      if (!p || !right(t.child_id, data.owner_person_id, 'can_pay')) fail(t.id + ' top-up without a payment or can_pay');
    }
  }
  // Notifications match their causes, one each.
  const nts = gen('notifications'), one = (kind, objId, what) => { const n = nts.filter(x => x.kind === kind && x.object_id === objId).length; if (n !== 1) fail(what + ': ' + n + ' ' + kind + ' notifications'); };
  for (const a of gen('attendance').filter(x => x.explanation === 'unexplained')) one('attendance.unexplained', a.id, a.id);
  for (const r of gen('absence_reports').filter(x => ['excused', 'unexcused'].includes(x.state))) one('absence.reviewed', r.id, r.id);
  for (const f of gen('forms')) { one('form.published', f.id, f.id); if (nts.filter(x => x.kind === 'form.changed' && x.object_id === f.id).length !== f.version - 1) fail(f.id + ' form.changed count'); }
  for (const r of gen('form_responses').filter(x => x.by_person_id !== data.owner_person_id)) one('form.answered', r.id, r.id);
  for (const d of gen('dismissal_changes').filter(x => x.recorded_by !== data.owner_person_id)) one('dismissal.recorded', d.id, d.id);
  for (const t of gen('lunch_transactions').filter(x => x.kind === 'refund')) one('lunch.refund', t.id, t.id);
  for (const p of gen('pickup_people')) one('pickup.person_reviewed', p.id, p.id);
  for (const s of [A, K]) for (const e of CALENDAR[s].filter(x => x.announced_at)) one('school.day_changed', 'day-' + s.slice(7) + '-' + e.date, s + ' ' + e.date);
  // Low-balance notices: one per crossing under the threshold on a purchase, over the whole ledger.
  for (const a of data.lunch_accounts) {
    let bal = 0, notified = false; const expect = [];
    for (const t of data.lunch_transactions.filter(x => x.lunch_account_id === a.id).sort((x, y) => Date.parse(x.at) - Date.parse(y.at))) {
      bal += t.amount_cents;
      if (t.kind === 'purchase' && bal < a.low_balance_threshold_cents && !notified) { notified = true; expect.push(t.at); }
      else if (bal >= a.low_balance_threshold_cents) notified = false;
    }
    const got = data.notifications.filter(n => n.kind === 'lunch.low_balance' && n.object_id === a.id).map(n => n.at);
    if (JSON.stringify(got.sort()) !== JSON.stringify(expect.sort())) fail(a.id + ' low-balance notifications do not match the crossings');
  }
  // Payments for generated fees and top-ups belong to generated records.
  for (const p of gen('payments')) {
    const ok = p.object_type === 'lunch_transaction' ? gen('lunch_transactions').some(t => t.id === p.object_id && t.payment_id === p.id && t.amount_cents === p.amount_cents)
      : gen('form_responses').some(r => r.id === p.object_id && r.payment_ids.includes(p.id) && r.by_person_id === data.owner_person_id);
    if (!ok) fail(p.id + ' does not match its top-up or response');
  }
  // Every generated record is dated inside the history: on or after the floor and before the hand-written year.
  const stamps = JSON.stringify(['attendance', 'absence_reports', 'forms', 'form_responses', 'dismissal_changes', 'pickup_people', 'lunch_transactions', 'menu_days', 'payments', 'notifications']
    .map(k => gen(k)))
    .match(/"\d{4}-\d{2}-\d{2}/g) || [];
  if (stamps.some(s => s.slice(1) < FLOOR || s.slice(1) > '2026-06-30')) fail('a generated record is dated outside 2025-01-01 to 2026-06-30');
  counts.history_floor = FLOOR;
  return counts;
}

module.exports = {SEED, FLOOR, LAST, CALENDAR, YEARS, ENROLLMENT, generate, merge, historyProblems, isGenerated, isSchoolDay, schoolOn, dayOf, absenceCutoff, dismissalCutoff};
if (require.main === module) {
  const {build} = require('./build-reference-fixture.cjs');
  const file = path.resolve(__dirname, '../fixtures/reference.json'), data = build(), text = JSON.stringify(data, null, 2) + '\n';
  const problems = [], counts = historyProblems(data, m => problems.push(m));
  const same = fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text;
  console.log(JSON.stringify({seed: SEED, floor: FLOOR, generated: counts, matches_committed_fixture: same, problems}));
  if (process.argv.includes('--check') && (!same || problems.length)) process.exitCode = 1;
}
