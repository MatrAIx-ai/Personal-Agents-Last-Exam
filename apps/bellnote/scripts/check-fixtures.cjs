#!/usr/bin/env node
'use strict';
// Consistency checks for Bellnote fixtures beyond validateSeed: ledgers, payments, restrictions,
// form versions, school days for every dated commitment (the earlier school years by the calendar in
// scripts/history.cjs), allergen tags, fictional phone numbers, dates on or after 2025-01-01 (the
// history floor), the generated history's rules (see historyProblems in scripts/history.cjs), the
// declared record count, the size budget and the size of the reads that take no window.
// Usage: node scripts/check-fixtures.cjs [file ...]
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const plugin = require('../plugin.cjs');
const {compile} = require('../tests/schema-validator.cjs');
const c = require('../src/common.cjs');
const seedValid = compile(require('../schemas/seed.schema.json'), path.join(root, 'schemas'));
const history = require('./history.cjs');
const FLOOR = history.FLOOR;
// Size budget: Core reads and validates the whole state on every call, so the reference stays small.
const BUDGET = {pretty: 1024 * 1024, compact: 384 * 1024};

function check(data, {binding = require('../fixtures/binding.json'), bytes, now = require('../fixtures/clock.json').initial_time} = {}) {
  const problems = [], ok = (cond, msg) => { if (!cond) problems.push(msg); };
  ok(seedValid(data), 'seed schema');
  try { plugin.validateSeed({app_id: 'bellnote', binding}, data); } catch (e) { problems.push('validateSeed: ' + e.message); }
  const zone = data.district.time_zone, schools = new Map(data.schools.map(s => [s.id, s]));
  const kidSchool = id => schools.get(data.children.find(k => k.id === id).school_id);
  // A date in an earlier school year is checked against that year's calendar and the school the child
  // attended then; the App's own calendar holds only the current term.
  const earlier = (s, date) => date < s.term.start_date;
  const childDay = (id, date) => earlier(kidSchool(id), date) ? !!history.schoolOn(id, date) && history.isSchoolDay(history.schoolOn(id, date), date) : c.dayInfo(data, kidSchool(id), date).school_day;
  const schoolDay = (s, date) => earlier(s, date) ? history.isSchoolDay(s.id, date) : c.dayInfo(data, s, date).school_day;
  // Ledgers: balance = sum of transactions, and the running balance never passes the debt limit.
  for (const a of data.lunch_accounts) {
    const list = data.lunch_transactions.filter(t => t.lunch_account_id === a.id).sort((x, y) => Date.parse(x.at) - Date.parse(y.at));
    const limit = c.policy(data, kidSchool(a.child_id)).meal_debt_limit_cents;
    let bal = 0;
    for (const t of list) { bal += t.amount_cents; ok(bal >= -limit, a.id + ' passes the debt limit at ' + t.id); }
    ok(bal === a.balance_cents, a.id + ' balance equals the sum of its transactions');
  }
  // Payments match a response or a top-up, with matching amounts.
  for (const p of data.payments) {
    if (p.object_type === 'lunch_transaction') {
      const t = data.lunch_transactions.find(x => x.id === p.object_id);
      ok(t && t.kind === 'topup' && t.payment_id === p.id && t.amount_cents === p.amount_cents && t.child_id === p.child_id, p.id + ' matches its top-up');
    } else {
      const r = data.form_responses.find(x => x.id === p.object_id);
      ok(r && r.payment_ids.includes(p.id) && r.by_person_id === data.owner_person_id && r.child_id === p.child_id, p.id + ' matches its form response');
    }
  }
  for (const t of data.lunch_transactions.filter(x => x.kind === 'topup')) ok(data.payments.some(p => p.id === t.payment_id), t.id + ' top-up has a payment');
  for (const r of data.form_responses.filter(x => x.by_person_id === data.owner_person_id)) {
    const f = data.forms.find(x => x.id === r.form_id), paid = r.payment_ids.map(id => data.payments.find(p => p.id === id)).filter(p => p.status === 'paid').reduce((s, p) => s + p.amount_cents, 0);
    ok(paid === r.paid_cents, r.id + ' paid amount equals its paid payments');
    if (r.state === 'signed') ok(r.paid_cents === f.fee_cents, r.id + ' signed response paid the current fee');
  }
  // Restrictions and lists.
  for (const p of data.pickup_people) ok(!(['approved', 'pending_review'].includes(p.status) && c.restricted(data, p.child_id, p.person_id)), p.id + ' is restricted for its child');
  // Form versions.
  for (const r of data.form_responses) {
    const f = data.forms.find(x => x.id === r.form_id);
    ok(f.versions.some(v => v.version === r.form_version), r.id + ' names a version its form had');
    if (r.state === 'signed') ok(r.form_version === f.version, r.id + ' signed response is at the current version');
  }
  // Dated commitments fall on school days (a day closed later by an event reads moot instead).
  const changedLater = (s, date, since) => s.calendar.some(e => e.date === date && e.kind === 'closed' && e.changed_at && Date.parse(e.changed_at) > Date.parse(since));
  for (const f of data.forms) ok(schoolDay(schools.get(f.school_id), c.time.localDate(f.due_at, zone)), f.id + ' is due on a school day');
  for (const r of data.absence_reports) for (const d of r.dates) ok(childDay(r.child_id, d) || changedLater(kidSchool(r.child_id), d, r.submitted_at), r.id + ' covers ' + d + ', not a school day');
  for (const d of data.dismissal_changes) ok(childDay(d.child_id, d.date) || changedLater(kidSchool(d.child_id), d.date, d.created_at), d.id + ' is not on a school day');
  for (const a of data.attendance) ok(childDay(a.child_id, a.date), a.id + ' is not on a school day');
  for (const m of data.menu_days) ok(schoolDay(schools.get(m.school_id), m.date), m.id + ' is not on a school day');
  // Allergen tags from the fixed list.
  const tags = [...data.menu_days.flatMap(m => m.items.flatMap(i => i.allergens)), ...data.lunch_transactions.flatMap(t => t.allergens), ...data.children.flatMap(k => k.meal_restrictions)];
  ok(tags.every(t => c.ALLERGENS.includes(t)), 'allergen tags come from the fixed list');
  // Fictional phone numbers and dates.
  const phones = [...data.people.map(p => p.phone), ...data.pickup_people.map(p => p.phone)].filter(Boolean);
  ok(phones.every(p => /^555-01\d\d$/.test(p)), 'phone numbers use the fictional 555-01xx range');
  const dates = JSON.stringify(data).match(/"\d{4}-\d{2}-\d{2}/g) || [];
  ok(dates.every(d => d.slice(1) >= FLOOR), 'every date is on or after ' + FLOOR);
  const compact = Buffer.byteLength(JSON.stringify(data));
  if (bytes !== undefined) ok(bytes < BUDGET.pretty, 'fixture is under 1 MiB');
  ok(compact < BUDGET.compact, 'fixture is under ' + BUDGET.compact / 1024 + ' KiB as compact JSON');
  ruleProblems(data, {childDay, kidSchool, earlier}, msg => problems.push(msg));
  // The generated history (reference fixture only) also obeys the generator's own rules (calendar and
  // enrollment of the earlier years, purchases from that day's menu, ledgers and rollovers).
  const generated = data.notifications.some(n => history.isGenerated(n.id)) ? history.historyProblems(data, m => problems.push('history: ' + m)) : null;
  // Reads that take no window: their size at the loaded time.
  const ctx = {app_id: 'bellnote', run_id: 'check', role: 'agent', binding, virtual_now: now};
  const default_read_bytes = {};
  for (const [name, args] of [['absences.list', {}], ['forms.list', {}], ['attendance.list', {}], ['notifications.list', {}], ['payments.list', {}],
    ['lunch.account_get', {id: data.lunch_accounts[0]?.id}], ['menu.list', {id: data.schools[0].id}], ['pickup.get', {id: data.children[0].id}]]) {
    try { default_read_bytes[name] = Buffer.byteLength(JSON.stringify(plugin.handleTool(ctx, structuredClone(data), 'bellnote.' + name, args).result)); } catch (e) { default_read_bytes[name] = 'error: ' + e.code; }
  }
  const counts = Object.fromEntries(['schools', 'children', 'guardian_links', 'pickup_people', 'restrictions', 'attendance', 'absence_reports', 'forms', 'form_responses',
    'lunch_accounts', 'lunch_transactions', 'menu_days', 'payment_methods', 'payments', 'notifications', 'dismissal_changes'].map(k => [k, data[k].length]));
  const records = plugin.records(data).length;
  return {problems, counts, records, compact_bytes: compact, generated, default_read_bytes};
}

// The App's rules, applied to every record of a fixture, hand-written and generated alike: whatever
// the App would refuse as a write or an event must not be in a seed either, and every event the seed
// says happened left the notification the App writes for it, in the App's wording conventions.
function ruleProblems(data, {childDay, kidSchool, earlier}, fail) {
  const zone = data.district.time_zone, owner = data.owner_person_id;
  const link = (child, person) => data.guardian_links.find(l => l.child_id === child && l.person_id === person) || null;
  const right = (child, person, r) => !!link(child, person)?.[r];
  const staffOf = (child, id) => data.staff.some(s => s.id === id && s.school_id === kidSchool(child).id);
  // Cut-offs of a child's day: the earlier school years by their own calendar, the current term by the App's.
  const day = (child, date) => {
    if (earlier(kidSchool(child), date)) {
      const s = history.schoolOn(child, date), d = s && history.dayOf(s, date);
      return d && d.school_day ? {absence: history.absenceCutoff(s, date), dismissal: history.dismissalCutoff(s, date), dismissal_at: c.time.zonedIso(date, d.dismissal, zone)} : null;
    }
    const i = c.dayInfo(data, kidSchool(child), date);
    return i.school_day ? {absence: i.absence_cutoff_at, dismissal: i.dismissal_change_cutoff_at, dismissal_at: i.dismissal_at} : null;
  };
  const before = (a, b) => Date.parse(a) < Date.parse(b);
  // W1: reports by custodial guardians, before their cut-off; cancellations before the cancelled days' cut-offs.
  for (const r of data.absence_reports) {
    if (!right(r.child_id, r.submitted_by, 'custodial')) fail(r.id + ' reported by a guardian without custodial rights');
    const first = [...r.dates, ...r.cancelled_dates].sort()[0], info = first && day(r.child_id, first);
    if (info) {
      const cutoff = r.kind === 'absent' ? info.absence : c.time.zonedIso(first, r.time_local, zone);
      if (!before(r.submitted_at, cutoff)) fail(r.id + ' submitted after its cut-off');
    }
    for (const x of r.history.filter(e => ['cancelled', 'partly_cancelled'].includes(e.action))) {
      for (const d of x.dates || r.cancelled_dates) {
        const i = day(r.child_id, d), cutoff = i && (r.kind === 'absent' ? i.absence : c.time.zonedIso(d, r.time_local, zone));
        if (cutoff && !before(x.at, cutoff)) fail(r.id + ' cancelled ' + d + ' after its cut-off');
        if (!right(r.child_id, x.by, 'custodial')) fail(r.id + ' cancelled by a guardian without custodial rights');
      }
    }
  }
  // W2: answers by guardians who can sign, before the form closes; a fee only by a guardian who can pay.
  for (const r of data.form_responses) {
    const f = data.forms.find(x => x.id === r.form_id), v = f.versions.find(x => x.version === r.form_version);
    if (!right(r.child_id, r.by_person_id, 'can_sign')) fail(r.id + ' answered by a guardian who cannot sign for the child');
    if ((r.paid_cents > 0 || (['signed', 'needs_review'].includes(r.state) && v && v.fee_cents > 0)) && !right(r.child_id, r.by_person_id, 'can_pay')) fail(r.id + ' fee paid by a guardian who cannot pay for the child');
    if (!before(r.answered_at, f.due_at) || before(r.answered_at, f.published_at)) fail(r.id + ' answered outside the form\'s open period');
    if (r.by_person_id !== owner && r.state === 'signed' && r.paid_cents !== f.fee_cents) fail(r.id + ' other guardian\'s signature does not record the current fee');
  }
  // W3: pickup people added by custodial guardians; dismissal changes by a custodial guardian or the
  // office, before that day's cut-off (the other guardian and the office before dismissal), naming
  // nobody restricted and only a collector approved at that time.
  for (const p of data.pickup_people) if (!right(p.child_id, p.added_by, 'custodial')) fail(p.id + ' added by a guardian without custodial rights');
  const approvedAt = (child, person, when) => right(child, person, 'can_pickup') || data.pickup_people.some(p => p.child_id === child && p.person_id === person &&
    p.history.some(x => ['approved', 'added_approved'].includes(x.action) && !before(when, x.at)) && !p.history.some(x => ['removed', 'revoked', 'denied'].includes(x.action) && before(x.at, when)));
  for (const d of data.dismissal_changes) {
    const byGuardian = d.recorded_by !== 'seed' && link(d.child_id, d.recorded_by);
    if (byGuardian ? !byGuardian.custodial : !staffOf(d.child_id, d.recorded_by)) fail(d.id + ' recorded by someone who cannot change the way home');
    if (d.person_id && c.restricted(data, d.child_id, d.person_id)) fail(d.id + ' names a restricted person');
    if (d.mode === 'pickup' && !approvedAt(d.child_id, d.person_id, d.created_at)) fail(d.id + ' names a person not approved at the time');
    const info = day(d.child_id, d.date);
    if (info) {
      const own = d.recorded_by === owner && d.actor !== 'event';
      if (!before(d.created_at, own ? info.dismissal : info.dismissal_at)) fail(d.id + ' recorded after its cut-off');
    }
  }
  // W4: top-ups by an account holder who can pay, inside the school's range, each with its payment.
  for (const t of data.lunch_transactions.filter(x => x.kind === 'topup')) {
    const pol = c.policy(data, kidSchool(t.child_id));
    if (!right(t.child_id, owner, 'can_pay')) fail(t.id + ' top-up for a child the account holder cannot pay for');
    if (t.amount_cents < pol.topup_min_cents || t.amount_cents > pol.topup_max_cents) fail(t.id + ' top-up outside the top-up range');
  }
  for (const t of data.lunch_transactions.filter(x => x.kind === 'purchase')) if (!childDay(t.child_id, c.time.localDate(t.at, zone))) fail(t.id + ' purchase is not on a school day');
  // Notifications: one for every event the seed records, none of a non-custodial child's pickup list.
  const custodialMe = child => right(child, owner, 'custodial');
  const count = (kind, objId) => data.notifications.filter(n => n.kind === kind && n.object_id === objId).length;
  const expect = (n, kind, objId) => { const got = count(kind, objId); if (got !== n) fail(objId + ': ' + got + ' ' + kind + ' notifications, expected ' + n); };
  for (const a of data.attendance) if (a.history.some(x => x.action === 'marked') && a.status !== 'present' && a.history[0].at && a.explanation === 'unexplained') expect(1, 'attendance.unexplained', a.id);
  for (const r of data.absence_reports) expect(['excused', 'unexcused'].includes(r.state) ? 1 : 0, 'absence.reviewed', r.id);
  for (const f of data.forms) { expect(1, 'form.published', f.id); expect(f.version - 1, 'form.changed', f.id); }
  for (const r of data.form_responses) expect(r.history.filter(x => x.by && x.by !== owner).length, 'form.answered', r.id);
  for (const d of data.dismissal_changes) expect(d.recorded_by !== owner && custodialMe(d.child_id) ? 1 : 0, 'dismissal.recorded', d.id);
  for (const t of data.lunch_transactions) expect(t.kind === 'refund' ? 1 : 0, 'lunch.refund', t.id);
  for (const p of data.pickup_people) expect(custodialMe(p.child_id) ? p.history.filter(x => ['approved', 'denied', 'revoked'].includes(x.action)).length : 0, 'pickup.person_reviewed', p.id);
  for (const s of data.schools) for (const e of s.calendar.filter(x => x.changed_at)) expect(1, 'school.day_changed', 'day-' + s.id.replace(/^school-/, '') + '-' + e.date);
  for (const n of data.notifications) {
    if (['pickup.person_reviewed', 'dismissal.recorded', 'dismissal.void'].includes(n.kind) && !custodialMe(n.child_id)) fail(n.id + ' tells a non-custodial guardian about the pickup list');
    // Wording: names and long dates, never a raw ID, an ISO date or a field name.
    const text = n.title + ' ' + n.body;
    if (/\b(rep|fr|pp|dc|pay|tx|ntf|att|pm|form|person|staff|child|lunch|school|day|gl|r)-[a-z0-9]/.test(text)) fail(n.id + ' text shows a record ID');
    if (/\d{4}-\d{2}-\d{2}/.test(text)) fail(n.id + ' text shows an ISO date');
    if (/\b[a-z]+_[a-z_]+\b/.test(text)) fail(n.id + ' text shows a field name');
  }
}
module.exports = {check, ruleProblems};
if (require.main === module) {
  const files = process.argv.slice(2).length ? process.argv.slice(2) : ['fixtures/minimal.json', 'fixtures/reference.json'];
  let failed = false;
  for (const f of files) {
    const file = path.resolve(root, f), text = fs.readFileSync(file, 'utf8');
    const {problems, counts, records, compact_bytes, generated, default_read_bytes} = check(JSON.parse(text), {bytes: Buffer.byteLength(text)});
    if (path.basename(file) === 'reference.json') {
      const declared = require('../contribution/dataset.json').expected_counts.records;
      if (records !== declared) problems.push('contribution/dataset.json declares ' + declared + ' records, the fixture has ' + records);
      if (!require('./build-reference-fixture.cjs').matches()) problems.push('fixtures/reference.json differs from its builder (node scripts/build-reference-fixture.cjs)');
    }
    console.log(JSON.stringify({fixture: path.relative(root, file), bytes: Buffer.byteLength(text), compact_bytes, records, passed: !problems.length, problems, counts,
      generated_history: generated, default_read_bytes}));
    failed = failed || problems.length > 0;
  }
  if (failed) process.exitCode = 1;
}
