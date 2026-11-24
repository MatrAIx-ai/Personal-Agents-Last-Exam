'use strict';
// Record consistency for seeds, history and every committed state (Core calls validateSeed after
// each write and event). The seed is history: everything in it has already happened.
const c = require('./common.cjs');
const COLLECTIONS = Object.freeze(['schools', 'staff', 'children', 'guardian_links', 'pickup_people', 'restrictions', 'dismissal_changes',
  'attendance', 'absence_reports', 'forms', 'form_responses', 'lunch_accounts', 'lunch_transactions', 'menu_days',
  'payment_methods', 'payments', 'notifications']);
const bad = message => c.fail('invalid_seed', message);
const TIME_KEYS = new Set(['at', 'created_at', 'paid_at', 'refunded_at', 'marked_at', 'submitted_at', 'reviewed_at', 'answered_at',
  'due_at', 'published_at', 'changed_at', 'time']);

function walkTimes(value, path) {
  if (Array.isArray(value)) { value.forEach((v, i) => walkTimes(v, path + '[' + i + ']')); return; }
  if (!value || typeof value !== 'object') return;
  for (const [k, v] of Object.entries(value)) {
    if (TIME_KEYS.has(k) && typeof v === 'string' && !c.time.hasOffset(v)) bad('Timestamp without a UTC offset at ' + path + '.' + k);
    if (k !== 'wire') walkTimes(v, path + '.' + k);
  }
}
function validCutoff(rule) {
  return rule && (rule.anchor === 'fixed' ? !!c.time.parseLocal(rule.local_time) && rule.minutes_before === undefined
    : rule.anchor === 'dismissal' && Number.isInteger(rule.minutes_before) && rule.minutes_before >= 0 && rule.local_time === undefined);
}

function validateSeed(ctx, data) {
  // Account and owner must be the ones the trusted binding declares.
  const people = ctx.binding.people.some(p => p.person_id === data.owner_person_id);
  const acct = ctx.binding.accounts.some(a => a.app_id === ctx.app_id && a.account_id === data.account_id && a.owner_person_id === data.owner_person_id);
  if (!people || !acct) bad('The account and its owner must be declared in the trusted binding.');
  walkTimes(data, 'data');
  const d = data.district;
  if (!c.time.validZone(d.time_zone)) bad('Unknown time zone ' + d.time_zone + '.');
  const checkPolicy = (pol, partial) => {
    for (const k of ['absence_cutoff_local', 'dismissal_change_cutoff_local']) if ((!partial || pol[k] !== undefined) && !validCutoff(pol[k])) bad('Invalid cut-off rule ' + k + '.');
  };
  checkPolicy(d.policy, false);
  if (d.policy.topup_min_cents > d.policy.topup_max_cents) bad('The top-up range is reversed.');

  // Unique IDs across every collection.
  const ids = new Set([d.id]);
  for (const k of COLLECTIONS) for (const r of data[k]) { if (ids.has(r.id)) bad('Duplicate ID ' + r.id + '.'); ids.add(r.id); }
  const personIds = new Set();
  for (const p of data.people) { if (personIds.has(p.person_id)) bad('Duplicate person ' + p.person_id + '.'); personIds.add(p.person_id); }
  if (!personIds.has(data.owner_person_id)) bad('The account holder must have a person record.');
  const by = k => new Map(data[k].map(r => [r.id, r]));
  const schools = by('schools'), children = by('children'), forms = by('forms'), methods = by('payment_methods');
  const accounts = by('lunch_accounts'), payments = by('payments');
  const need = (ok, what) => { if (!ok) bad('Dangling or invalid reference: ' + what + '.'); };

  for (const s of data.schools) {
    checkPolicy(s.policy || {}, true);
    const p = c.policy(data, s);
    if (p.topup_min_cents > p.topup_max_cents) bad('The top-up range is reversed for ' + s.id + '.');
    need(s.term.start_date <= s.term.end_date && c.time.minutesOf(s.bell.start_local) < c.time.minutesOf(s.bell.dismissal_local), s.id + ' term and bell times');
    const dates = new Set();
    for (const e of s.calendar) {
      need(!dates.has(e.date), s.id + ' calendar date ' + e.date + ' listed twice'); dates.add(e.date);
      need((e.kind === 'early_dismissal') === (e.dismissal_local !== null), s.id + ' calendar entry ' + e.date + ' dismissal time');
    }
  }
  for (const s of data.staff) need(schools.has(s.school_id), s.id + ' school');
  for (const k of data.children) {
    need(schools.has(k.school_id), k.id + ' school');
    for (const a of k.meal_restrictions) need(c.ALLERGENS.includes(a), k.id + ' meal restriction ' + a);
    need(data.guardian_links.some(l => l.child_id === k.id && l.person_id === data.owner_person_id), k.id + ' has no guardian link for the account holder');
  }
  const pairs = new Set();
  for (const l of data.guardian_links) {
    need(children.has(l.child_id) && personIds.has(l.person_id), l.id + ' child/person');
    need(!pairs.has(l.child_id + '|' + l.person_id), l.id + ' duplicate guardian link'); pairs.add(l.child_id + '|' + l.person_id);
  }
  for (const r of data.restrictions) {
    need(children.has(r.child_id) && personIds.has(r.person_id), r.id + ' child/person');
    need(!c.guardianLink(data, r.child_id, r.person_id), r.id + ' restricts a guardian of the same child');
  }
  for (const p of data.pickup_people) {
    need(children.has(p.child_id) && personIds.has(p.person_id), p.id + ' child/person');
    if (['approved', 'pending_review'].includes(p.status) && c.restricted(data, p.child_id, p.person_id)) bad('Person ' + p.person_id + ' is both on the list and restricted for ' + p.child_id + '.');
    need(data.pickup_people.filter(x => x.child_id === p.child_id && x.person_id === p.person_id && ['approved', 'pending_review'].includes(x.status)).length <= 1, p.id + ' listed twice');
  }
  const activeDays = new Set();
  for (const ch of data.dismissal_changes) {
    need(children.has(ch.child_id) && c.time.validDate(ch.date), ch.id + ' child/date');
    need((ch.mode === 'pickup') === (ch.person_id !== null) && (ch.person_id === null || personIds.has(ch.person_id)), ch.id + ' person');
    if (ch.status === 'active') {
      if (activeDays.has(ch.child_id + '|' + ch.date)) bad('Two active dismissal changes for ' + ch.child_id + ' on ' + ch.date + '.');
      activeDays.add(ch.child_id + '|' + ch.date);
      if (ch.person_id && c.restricted(data, ch.child_id, ch.person_id)) bad('An active dismissal change names a restricted person: ' + ch.id + '.');
    }
  }
  const reports = by('absence_reports');
  for (const a of data.attendance) {
    need(children.has(a.child_id) && a.id === 'att-' + a.child_id + '-' + a.date, a.id + ' child/date');
    need(a.report_id === null || reports.has(a.report_id), a.id + ' report');
  }
  for (const r of data.absence_reports) need(children.has(r.child_id) && r.dates.every(c.time.validDate), r.id + ' child/dates');
  for (const f of data.forms) {
    need(schools.has(f.school_id) && f.child_ids.every(id => children.has(id) && children.get(id).school_id === f.school_id), f.id + ' school/children');
    need(f.versions.length === f.version && f.versions.every((v, i) => v.version === i + 1), f.id + ' version history');
  }
  const respPairs = new Set();
  for (const r of data.form_responses) {
    const f = forms.get(r.form_id);
    need(f && f.child_ids.includes(r.child_id), r.id + ' form/child');
    need(!respPairs.has(r.form_id + '|' + r.child_id), r.id + ' second response for the same form and child'); respPairs.add(r.form_id + '|' + r.child_id);
    if (r.form_version < 1 || r.form_version > f.version) bad('Response ' + r.id + ' names version ' + r.form_version + ', which form ' + f.id + ' never had.');
    need(c.guardianLink(data, r.child_id, r.by_person_id), r.id + ' answering guardian');
    const paid = r.payment_ids.map(id => payments.get(id)).filter(p => p && p.status === 'paid').reduce((s, p) => s + p.amount_cents, 0);
    need(r.payment_ids.every(id => payments.has(id)), r.id + ' payments');
    if (r.by_person_id === data.owner_person_id) need(paid === r.paid_cents, r.id + ' paid amount equals its paid payments');
  }
  const acctChildren = new Set();
  for (const a of data.lunch_accounts) {
    need(children.has(a.child_id) && !acctChildren.has(a.child_id), a.id + ' child'); acctChildren.add(a.child_id);
    const sum = data.lunch_transactions.filter(t => t.lunch_account_id === a.id).reduce((s, t) => s + t.amount_cents, 0);
    if (sum !== a.balance_cents) bad('Lunch account ' + a.id + ' balance ' + a.balance_cents + ' does not equal the sum of its transactions (' + sum + ').');
  }
  for (const t of data.lunch_transactions) {
    const a = accounts.get(t.lunch_account_id);
    need(a && a.child_id === t.child_id, t.id + ' account/child');
    for (const x of t.allergens) need(c.ALLERGENS.includes(x), t.id + ' allergen ' + x);
    need(t.payment_id === null || payments.has(t.payment_id), t.id + ' payment');
  }
  for (const m of data.menu_days) {
    need(schools.has(m.school_id), m.id + ' school');
    for (const i of m.items) for (const x of i.allergens) need(c.ALLERGENS.includes(x), m.id + ' allergen ' + x);
  }
  for (const p of data.payments) {
    need(methods.has(p.payment_method_id) && children.has(p.child_id), p.id + ' method/child');
    need(p.object_type === 'form_response' ? data.form_responses.some(r => r.id === p.object_id && r.payment_ids.includes(p.id))
      : data.lunch_transactions.some(t => t.id === p.object_id && t.payment_id === p.id), p.id + ' paid object');
    need((p.status === 'refunded') === (p.refunded_at !== null), p.id + ' refund time');
  }
  for (const s of data.staff) need(!personIds.has(s.id), s.id + ' staff ID reused as a person');
  if (data.preferences.default_payment_method_id !== null) need(methods.has(data.preferences.default_payment_method_id), 'default payment method');
  for (const n of data.notifications) need(n.child_id === null || children.has(n.child_id), n.id + ' child');
  let seq = 0;
  for (const row of data.activity) { need(row.seq === seq + 1, 'activity sequence'); seq = row.seq; }
}
// Core uses records() for dataset counts/quality and objects() for stable object IDs.
function records(data) {
  return COLLECTIONS.flatMap(k => data[k].map(r => ({collection: k, ...r})));
}
const objects = data => COLLECTIONS.flatMap(k => data[k].map(r => r.id));
// Bellnote stores no reference into another App's state.
const references = () => [];
module.exports = {validateSeed, records, objects, references, COLLECTIONS};
