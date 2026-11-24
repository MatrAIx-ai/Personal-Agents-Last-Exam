#!/usr/bin/env node
'use strict';
// Consistency checks for Bellnote fixtures beyond validateSeed: ledgers, payments, restrictions,
// form versions, school days for every dated commitment, allergen tags, fictional phone numbers,
// dates on or after 2026-01-01 and the size limit. Usage: node scripts/check-fixtures.cjs [file ...]
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const plugin = require('../plugin.cjs');
const {compile} = require('../tests/schema-validator.cjs');
const c = require('../src/common.cjs');
const seedValid = compile(require('../schemas/seed.schema.json'), path.join(root, 'schemas'));

function check(data, {binding = require('../fixtures/binding.json'), bytes} = {}) {
  const problems = [], ok = (cond, msg) => { if (!cond) problems.push(msg); };
  ok(seedValid(data), 'seed schema');
  try { plugin.validateSeed({app_id: 'bellnote', binding}, data); } catch (e) { problems.push('validateSeed: ' + e.message); }
  const zone = data.district.time_zone, schools = new Map(data.schools.map(s => [s.id, s]));
  const kidSchool = id => schools.get(data.children.find(k => k.id === id).school_id);
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
  const isDay = (s, date) => c.dayInfo(data, s, date).school_day;
  for (const f of data.forms) ok(isDay(schools.get(f.school_id), c.time.localDate(f.due_at, zone)), f.id + ' is due on a school day');
  for (const r of data.absence_reports) for (const d of r.dates) ok(isDay(kidSchool(r.child_id), d) || changedLater(kidSchool(r.child_id), d, r.submitted_at), r.id + ' covers ' + d + ', not a school day');
  for (const d of data.dismissal_changes) ok(isDay(kidSchool(d.child_id), d.date) || changedLater(kidSchool(d.child_id), d.date, d.created_at), d.id + ' is not on a school day');
  for (const a of data.attendance) ok(isDay(kidSchool(a.child_id), a.date), a.id + ' is not on a school day');
  // Allergen tags from the fixed list.
  const tags = [...data.menu_days.flatMap(m => m.items.flatMap(i => i.allergens)), ...data.lunch_transactions.flatMap(t => t.allergens), ...data.children.flatMap(k => k.meal_restrictions)];
  ok(tags.every(t => c.ALLERGENS.includes(t)), 'allergen tags come from the fixed list');
  // Fictional phone numbers and dates.
  const phones = [...data.people.map(p => p.phone), ...data.pickup_people.map(p => p.phone)].filter(Boolean);
  ok(phones.every(p => /^555-01\d\d$/.test(p)), 'phone numbers use the fictional 555-01xx range');
  const dates = JSON.stringify(data).match(/"\d{4}-\d{2}-\d{2}/g) || [];
  ok(dates.every(d => d.slice(1) >= '2026-01-01'), 'every date is on or after 2026-01-01');
  if (bytes !== undefined) ok(bytes < 1024 * 1024, 'fixture is under 1 MiB');
  const counts = Object.fromEntries(['schools', 'children', 'guardian_links', 'pickup_people', 'restrictions', 'attendance', 'absence_reports', 'forms', 'form_responses',
    'lunch_accounts', 'lunch_transactions', 'menu_days', 'payment_methods', 'payments', 'notifications', 'dismissal_changes'].map(k => [k, data[k].length]));
  return {problems, counts};
}
module.exports = {check};
if (require.main === module) {
  const files = process.argv.slice(2).length ? process.argv.slice(2) : ['fixtures/minimal.json', 'fixtures/reference.json'];
  let failed = false;
  for (const f of files) {
    const file = path.resolve(root, f), text = fs.readFileSync(file, 'utf8');
    const {problems, counts} = check(JSON.parse(text), {bytes: Buffer.byteLength(text)});
    console.log(JSON.stringify({fixture: path.relative(root, file), bytes: Buffer.byteLength(text), passed: !problems.length, problems, counts}));
    failed = failed || problems.length > 0;
  }
  if (failed) process.exitCode = 1;
}
