#!/usr/bin/env node
'use strict';
// Authoring-time builder for fixtures/reference.json, the package's reference seed. It is run by
// hand when the fixture is edited, never at run time; the JSON output is what is committed and
// loaded. Deterministic: no randomness and no wall clock. Everything is fictional; phone numbers
// use the 555-01xx range. `--check` fails if the committed JSON differs from the builder.
// The records below are the hand-written 2026–27 school year; scripts/history.cjs generates the
// family's earlier history (from 2025-01-01, the environment's history floor) in front of them.
const fs = require('node:fs'), path = require('node:path');
const time = require('../src/time.cjs');
const history = require('./history.cjs');
const root = path.resolve(__dirname, '..'), TZ = 'America/Los_Angeles';
const at = (date, hm) => time.zonedIso(date, hm, TZ);
const h = (when, action, extra = {}) => ({at: when, action, ...extra});

function build({withHistory = true} = {}) {
  const d = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/minimal.json'), 'utf8'));
  for (const k of ['dismissal_changes', 'attendance', 'absence_reports', 'forms', 'form_responses', 'lunch_transactions', 'menu_days', 'payments', 'notifications']) d[k] = [];
  // ---- schools: a 12-week window (5 October to 25 December 2026) with 3 closed days and 2 early dismissals each.
  const cal = (date, kind, reason, dismissal = null, changed = null) => ({date, kind, dismissal_local: dismissal, reason,
    changed_at: changed ? changed[0] : null, event_id: changed ? changed[1] : null});
  const closure = ['2026-10-14T16:30:00-07:00', 'ev-hist-closure-1016-alder'], closureK = ['2026-10-14T16:30:00-07:00', 'ev-hist-closure-1016-kestrel'];
  d.schools[0].calendar = [cal('2026-10-16', 'closed', 'District air-quality closure', null, closure), cal('2026-10-23', 'early_dismissal', 'Parent-teacher conferences', '12:30'),
    cal('2026-11-26', 'closed', 'Thanksgiving break'), cal('2026-11-27', 'closed', 'Thanksgiving break'), cal('2026-12-18', 'early_dismissal', 'Last day before winter break', '12:30')];
  d.schools[1].calendar = [cal('2026-10-09', 'early_dismissal', 'Teacher planning afternoon', '12:15'), cal('2026-10-16', 'closed', 'District air-quality closure', null, closureK),
    cal('2026-11-26', 'closed', 'Thanksgiving break'), cal('2026-11-27', 'closed', 'Thanksgiving break'), cal('2026-12-04', 'early_dismissal', 'Teacher planning afternoon', '12:15')];
  d.staff.push({id: 'staff-cafe-kestrel', name: 'Kestrel cafeteria office', role: 'Cafeteria', school_id: 'school-kestrel'});
  d.people.push({person_id: 'person-lena', display_name: 'Lena Marsh', phone: '555-0155'}, {person_id: 'person-owen', display_name: 'Owen Pike', phone: '555-0177'},
    {person_id: 'person-tomas', display_name: 'Tomas Ferro', phone: '555-0184'});
  const schoolOf = {'child-theo': d.schools[0], 'child-ines': d.schools[0], 'child-nico': d.schools[1]};
  const isSchoolDay = (s, date) => {
    const wd = time.weekday(date), e = s.calendar.find(c => c.date === date);
    return wd !== 0 && wd !== 6 && !(e && e.kind === 'closed') && date >= s.term.start_date;
  };
  const schoolDays = (s, start, end) => time.eachDate(start, end).filter(x => isSchoolDay(s, x));
  const office = s => s.id === 'school-alder' ? 'staff-office-alder' : 'staff-office-kestrel';

  // ---- pickup people in every state, one restriction.
  d.pickup_people.push(
    {id: 'pp-0003', child_id: 'child-theo', person_id: 'person-lena', display_name: 'Lena Marsh', relationship: 'aunt', phone: '555-0155', status: 'denied',
      added_by: 'person-maya', created_at: at('2026-10-01', '20:10'), history: [h(at('2026-10-01', '20:10'), 'added_pending_review', {by: 'person-maya'}), h(at('2026-10-02', '11:00'), 'denied', {by: 'staff-office-alder'})]},
    {id: 'pp-0004', child_id: 'child-ines', person_id: 'person-owen', display_name: 'Owen Pike', relationship: 'family friend', phone: '555-0177', status: 'approved',
      added_by: 'person-dana', created_at: at('2026-09-08', '19:00'), history: [h(at('2026-09-08', '19:00'), 'added_pending_review', {by: 'person-dana'}), h(at('2026-09-09', '10:30'), 'approved', {by: 'staff-office-alder'})]},
    {id: 'pp-0005', child_id: 'child-theo', person_id: 'person-owen', display_name: 'Owen Pike', relationship: 'family friend', phone: '555-0177', status: 'removed',
      added_by: 'person-dana', created_at: at('2026-09-08', '19:01'), history: [h(at('2026-09-08', '19:01'), 'added_pending_review', {by: 'person-dana'}),
        h(at('2026-09-09', '10:31'), 'approved', {by: 'staff-office-alder'}), h(at('2026-10-20', '08:00'), 'removed', {by: 'person-maya'})]},
    {id: 'pp-0006', child_id: 'child-nico', person_id: 'person-tomas', display_name: 'Tomas Ferro', relationship: 'coach', phone: '555-0184', status: 'approved',
      added_by: 'person-sam', created_at: at('2026-09-14', '18:00'), history: [h(at('2026-09-14', '18:00'), 'added_approved', {by: 'person-sam'})]});

  // ---- absence reports (6) and 8 weeks of attendance.
  const rep = (id, child, kind, dates, extra) => ({id, child_id: child, kind, dates, time_local: null, reason: 'Illness', state: 'submitted', cancelled_dates: [],
    submitted_by: 'person-maya', submitted_at: null, reviewed_by: null, reviewed_at: null, review_note: null, request_id: null, history: [], ...extra});
  const reviewedRep = (r, decision, when, note = null) => {
    const s = schoolOf[r.child_id];
    Object.assign(r, {state: decision, reviewed_by: office(s), reviewed_at: when, review_note: note});
    r.history = [h(r.submitted_at, 'submitted', {by: r.submitted_by}), h(when, decision, {by: office(s)})];
    return r;
  };
  d.absence_reports.push(
    reviewedRep(rep('rep-0001', 'child-theo', 'absent', ['2026-09-29'], {reason: 'Stomach bug', submitted_at: at('2026-09-29', '07:05')}), 'excused', at('2026-09-29', '14:00'), 'Feel better.'),
    reviewedRep(rep('rep-0002', 'child-ines', 'absent', ['2026-10-06', '2026-10-07'], {reason: 'Fever', submitted_by: 'person-dana', submitted_at: at('2026-10-06', '06:50')}), 'excused', at('2026-10-07', '13:30')),
    {...rep('rep-0003', 'child-theo', 'absent', ['2026-10-16'], {reason: 'Dentist appointment', submitted_at: at('2026-10-12', '21:00')}), history: [h(at('2026-10-12', '21:00'), 'submitted', {by: 'person-maya'})]},
    reviewedRep(rep('rep-0004', 'child-ines', 'late', ['2026-10-21'], {kind: 'late', time_local: '10:00', reason: 'Overslept', submitted_at: at('2026-10-21', '08:10')}), 'unexcused', at('2026-10-21', '15:00'), 'Not an excused reason under district policy.'),
    {...rep('rep-0005', 'child-theo', 'early_leave', [], {time_local: '13:30', reason: 'Orthodontist', state: 'cancelled', cancelled_dates: ['2026-11-04'], submitted_at: at('2026-11-02', '20:00')}),
      history: [h(at('2026-11-02', '20:00'), 'submitted', {by: 'person-maya'}), h(at('2026-11-03', '19:30'), 'cancelled', {by: 'person-maya', dates: ['2026-11-04']})]},
    {...rep('rep-0006', 'child-ines', 'absent', ['2026-11-23', '2026-11-24', '2026-11-25'], {reason: 'Family travel for Thanksgiving', submitted_at: at('2026-11-16', '21:30')}),
      history: [h(at('2026-11-16', '21:30'), 'submitted', {by: 'person-maya'})]});
  const special = {
    'child-theo|2026-09-29': {status: 'absent', report: 'rep-0001', review: 'excused'},
    'child-ines|2026-10-06': {status: 'absent', report: 'rep-0002', review: 'excused'},
    'child-ines|2026-10-07': {status: 'absent', report: 'rep-0002', review: 'excused'},
    'child-ines|2026-10-21': {status: 'late', time: '10:05', report: 'rep-0004', review: 'unexcused'},
    'child-nico|2026-10-28': {status: 'absent'},
    'child-theo|2026-11-12': {status: 'late', time: '09:05'},
    'child-nico|2026-11-06': {status: 'left_early', time: '13:10'}
  };
  for (const kid of d.children) {
    const s = schoolOf[kid.id];
    for (const date of schoolDays(s, '2026-09-21', '2026-11-16')) {
      const sp = special[kid.id + '|' + date] || {status: 'present'};
      const markAt = sp.time && sp.time > '09:00' ? at(date, time.isoInZone(time.zonedInstant(date, sp.time, TZ) + 10 * 60000, TZ).slice(11, 16)) : at(date, s.id === 'school-alder' ? '09:15' : '08:45');
      d.attendance.push({id: 'att-' + kid.id + '-' + date, child_id: kid.id, date, status: sp.status, time_local: sp.time || null,
        explanation: sp.status === 'present' ? null : sp.report ? 'explained' : 'unexplained', report_id: sp.report || null, office_review: sp.review || null,
        marked_by: office(s), marked_at: markAt, history: [h(markAt, 'marked', {status: sp.status, by: office(s)})]});
    }
  }

  // ---- dismissal changes.
  const dc = (id, child, date, mode, person, by, created, status, extra = {}) => ({id, child_id: child, date, mode, person_id: person, note: null, recorded_by: by,
    actor: 'seed', created_at: created, status, replaces: null, replaced_by: null, request_id: null, event_id: null, history: [h(created, 'recorded', {by})], ...extra});
  d.dismissal_changes.push(
    dc('dc-0001', 'child-theo', '2026-10-23', 'pickup', 'person-rosa', 'person-maya', at('2026-10-21', '19:00'), 'active'),
    dc('dc-0002', 'child-ines', '2026-11-06', 'pickup', 'person-dana', 'person-dana', at('2026-11-04', '18:00'), 'replaced', {replaced_by: 'dc-0003',
      history: [h(at('2026-11-04', '18:00'), 'recorded', {by: 'person-dana'}), h(at('2026-11-05', '07:30'), 'replaced', {by: 'dc-0003'})]}),
    dc('dc-0003', 'child-ines', '2026-11-06', 'pickup', 'person-owen', 'person-maya', at('2026-11-05', '07:30'), 'active', {replaces: 'dc-0002'}),
    dc('dc-0004', 'child-theo', '2026-11-20', 'pickup', 'person-dana', 'person-dana', at('2026-11-16', '21:15'), 'active'),
    dc('dc-0005', 'child-theo', '2026-10-30', 'walker', null, 'person-maya', at('2026-10-29', '20:00'), 'cancelled',
      {history: [h(at('2026-10-29', '20:00'), 'recorded', {by: 'person-maya'}), h(at('2026-10-29', '20:30'), 'cancelled', {by: 'person-maya'})]}));

  // ---- forms (10) and responses (14).
  const q = {
    lunch: {id: 'q-lunch', type: 'choice', label: 'Lunch for the day', options: ['school_sack_lunch', 'bring_own'], required: true},
    phone: {id: 'q-emergency', type: 'text', label: 'Emergency phone for the day', required: true},
    chaperone: {id: 'q-chaperone', type: 'boolean', label: 'I can volunteer as a chaperone', required: false},
    allergies: {id: 'q-allergies', type: 'text', label: 'Known allergies (write "none" if none)', required: true},
    doses: {id: 'q-doses', type: 'number', label: 'Puffs per dose', required: true},
    size: {id: 'q-size', type: 'choice', label: 'T-shirt size', options: ['youth_s', 'youth_m', 'youth_l', 'adult_s'], required: true}
  };
  const form = (id, school, kids, kind, title, text, questions, fee, eventDate, due, published, extra = {}) => {
    const content = {title, text, questions, fee_cents: fee, event_date: eventDate};
    return {id, school_id: school, child_ids: kids, kind, ...content, due_at: due, version: 1,
      versions: [{version: 1, at: published, ...structuredClone(content), reason: null, event_id: null}], published_at: published,
      history: [h(published, 'published', {version: 1})], ...extra};
  };
  const A = 'school-alder', K = 'school-kestrel', TI = ['child-theo', 'child-ines'];
  const aquarium = form('form-aquarium', A, ['child-theo'], 'permission_slip', 'Grade 3 aquarium trip', 'Bus leaves 08:45 on 4 December and returns by 14:30.',
    [q.lunch, q.phone], 1800, '2026-12-04', at('2026-11-25', '16:00'), at('2026-11-12', '16:00'));
  aquarium.version = 2; aquarium.text = 'Bus leaves 08:45 on 11 December and returns by 16:15.'; aquarium.event_date = '2026-12-11';
  aquarium.versions.push({version: 2, at: at('2026-11-16', '10:30'), title: aquarium.title, text: aquarium.text, questions: [q.lunch, q.phone], fee_cents: 1800,
    event_date: '2026-12-11', reason: 'Aquarium moved our booking', event_id: 'ev-hist-aquarium-change'});
  aquarium.history.push(h(at('2026-11-16', '10:30'), 'changed', {version: 2, changed_fields: ['text', 'event_date'], reason: 'Aquarium moved our booking'}));
  d.forms = [
    form('form-pumpkin', A, TI, 'permission_slip', 'Pumpkin farm walk', 'Classes walk to the community farm on 16 October. Fee covers the hayride.', [q.phone, q.chaperone], 600, '2026-10-16', at('2026-10-09', '16:00'), at('2026-09-28', '15:00')),
    form('form-picture-day', A, TI, 'information', 'Picture day order', 'Picture day is 1 October. Order packages through the photographer separately.', [q.size], 0, '2026-10-01', at('2026-10-01', '08:00'), at('2026-09-21', '15:00')),
    form('form-fluclinic', A, TI, 'medical_consent', 'School flu clinic consent', 'A visiting nurse team will offer the seasonal flu vaccine at school on 3 December. Sign to consent, or decline.',
      [{id: 'q-consent-allergies', type: 'text', label: 'Known vaccine allergies (write "none" if none)', required: true}], 0, '2026-12-03', at('2026-11-24', '16:00'), at('2026-11-09', '15:00')),
    aquarium,
    form('form-inhaler', A, ['child-ines'], 'medication', 'Rescue inhaler authorization', 'Authorizes the health office to keep and give Ines her rescue inhaler as prescribed.', [q.doses, q.allergies], 0, null, at('2026-12-15', '16:00'), at('2026-09-02', '12:00')),
    form('form-k-band', K, ['child-nico'], 'permission_slip', 'Regional band festival', 'The band travels to the regional festival on 9 December; the fee covers the bus.', [q.phone], 1200, '2026-12-09', at('2026-11-30', '16:00'), at('2026-11-02', '15:00')),
    form('form-k-science', K, ['child-nico'], 'permission_slip', 'Wetlands field study', 'Grade 7 science visits the county wetlands on 23 October.', [q.lunch], 0, '2026-10-23', at('2026-10-20', '16:00'), at('2026-10-05', '15:00')),
    form('form-k-physical', K, ['child-nico'], 'medical_consent', 'Winter sports physical', 'Consent for the school physical required before winter sports tryouts.', [q.allergies], 0, null, at('2026-12-11', '16:00'), at('2026-11-13', '15:00')),
    form('form-library', A, TI, 'information', 'Library card program', 'Opt in to the city library card program run with the school library.', [q.chaperone], 0, null, at('2026-11-06', '16:00'), at('2026-10-26', '15:00')),
    form('form-winter-concert', A, TI, 'permission_slip', 'Winter concert evening', 'The winter concert is on 15 December at 18:00; the fee covers the costume rental.', [q.size], 500, '2026-12-15', at('2026-12-10', '16:00'), at('2026-11-09', '15:30'))
  ];
  const resp = (id, formId, child, by, state, version, answers, when, extra = {}) => ({id, form_id: formId, child_id: child, by_person_id: by, state, form_version: version,
    answers, paid_cents: 0, payment_ids: [], answered_at: when, history: [h(when, state === 'needs_review' ? 'signed' : state, {by, form_version: version})], ...extra});
  d.form_responses = [
    resp('fr-0001', 'form-pumpkin', 'child-ines', 'person-maya', 'signed', 1, {'q-emergency': '555-0100'}, at('2026-09-29', '20:00'), {paid_cents: 600, payment_ids: ['pay-0003']}),
    resp('fr-0002', 'form-pumpkin', 'child-theo', 'person-dana', 'signed', 1, {'q-emergency': '555-0142', 'q-chaperone': true}, at('2026-09-30', '07:40'), {paid_cents: 600}),
    resp('fr-0003', 'form-picture-day', 'child-theo', 'person-maya', 'declined', 1, {}, at('2026-09-24', '21:00')),
    resp('fr-0004', 'form-picture-day', 'child-ines', 'person-dana', 'signed', 1, {'q-size': 'youth_s'}, at('2026-09-25', '07:30')),
    resp('fr-0005', 'form-fluclinic', 'child-theo', 'person-dana', 'signed', 1, {'q-consent-allergies': 'none'}, at('2026-11-10', '07:45')),
    resp('fr-0006', 'form-fluclinic', 'child-ines', 'person-maya', 'declined', 1, {}, at('2026-11-10', '21:10')),
    resp('fr-0007', 'form-aquarium', 'child-theo', 'person-maya', 'needs_review', 1, {'q-lunch': 'school_sack_lunch', 'q-emergency': '555-0100'}, at('2026-11-12', '21:00'),
      {paid_cents: 1800, payment_ids: ['pay-0004'], history: [h(at('2026-11-12', '21:00'), 'signed', {by: 'person-maya', form_version: 1}), h(at('2026-11-16', '10:30'), 'needs_review', {form_version: 2})]}),
    resp('fr-0008', 'form-inhaler', 'child-ines', 'person-maya', 'signed', 1, {'q-doses': 2, 'q-allergies': 'peanut, tree nuts'}, at('2026-09-03', '19:00')),
    resp('fr-0009', 'form-k-band', 'child-nico', 'person-sam', 'signed', 1, {'q-emergency': '555-0167'}, at('2026-11-03', '18:00'), {paid_cents: 1200}),
    resp('fr-0010', 'form-k-science', 'child-nico', 'person-sam', 'declined', 1, {}, at('2026-10-06', '19:00')),
    resp('fr-0011', 'form-library', 'child-theo', 'person-maya', 'withdrawn', 1, {'q-chaperone': false}, at('2026-10-27', '20:00'),
      {history: [h(at('2026-10-27', '20:00'), 'signed', {by: 'person-maya', form_version: 1}), h(at('2026-10-29', '07:15'), 'withdrawn', {by: 'person-maya'})]}),
    resp('fr-0012', 'form-library', 'child-ines', 'person-maya', 'signed', 1, {'q-chaperone': false}, at('2026-10-27', '20:01')),
    resp('fr-0013', 'form-winter-concert', 'child-theo', 'person-maya', 'signed', 1, {'q-size': 'youth_m'}, at('2026-11-10', '20:30'), {paid_cents: 500, payment_ids: ['pay-0005']}),
    resp('fr-0014', 'form-winter-concert', 'child-ines', 'person-maya', 'withdrawn', 1, {'q-size': 'youth_s'}, at('2026-11-10', '20:31'),
      {payment_ids: ['pay-0006'], history: [h(at('2026-11-10', '20:31'), 'signed', {by: 'person-maya', form_version: 1}), h(at('2026-11-13', '07:00'), 'withdrawn', {by: 'person-maya', refunded_cents: 500})]})
  ];

  // ---- payment methods (2) and payments (8).
  d.payment_methods = d.payment_methods.filter(m => m.id !== 'pm-0003');
  const pay = (id, kind, child, amount, method, objType, objId, when, status = 'paid', refunded = null, reason = null) => ({id, kind, child_id: child, amount_cents: amount,
    payment_method_id: method, object_type: objType, object_id: objId, status, paid_at: when, refunded_at: refunded, refund_reason: reason, request_id: null});

  // ---- menus: 4 weeks (26 October to 20 November) at each school, with allergen tags.
  const alderItems = [
    [{id: 'item-pizza', name: 'Cheese pizza', allergens: ['milk', 'wheat']}, {id: 'item-salad', name: 'Garden salad', allergens: []}],
    [{id: 'item-peanut-noodles', name: 'Peanut noodle bowl', allergens: ['peanut', 'wheat', 'soy']}, {id: 'item-rice-beans', name: 'Rice and beans', allergens: []}],
    [{id: 'item-turkey', name: 'Turkey sandwich', allergens: ['wheat']}, {id: 'item-almond-bar', name: 'Almond oat bar', allergens: ['tree_nut', 'wheat']}],
    [{id: 'item-fish-tacos', name: 'Fish tacos', allergens: ['fish', 'wheat']}, {id: 'item-chicken-bowl', name: 'Chicken rice bowl', allergens: ['soy']}],
    [{id: 'item-burrito', name: 'Bean and cheese burrito', allergens: ['milk', 'wheat']}, {id: 'item-egg-wrap', name: 'Egg and potato wrap', allergens: ['egg', 'wheat']}]];
  const kestrelItems = [
    [{id: 'item-mac', name: 'Macaroni and cheese', allergens: ['milk', 'wheat']}, {id: 'item-chili', name: 'Vegetable chili', allergens: []}],
    [{id: 'item-teriyaki', name: 'Teriyaki chicken', allergens: ['soy', 'wheat']}, {id: 'item-sesame-noodles', name: 'Sesame noodles', allergens: ['sesame', 'wheat', 'soy']}],
    [{id: 'item-shrimp-rice', name: 'Shrimp fried rice', allergens: ['shellfish', 'egg', 'soy']}, {id: 'item-bean-bowl', name: 'Black bean bowl', allergens: []}],
    [{id: 'item-pizza', name: 'Cheese pizza', allergens: ['milk', 'wheat']}, {id: 'item-hummus', name: 'Hummus plate', allergens: ['sesame']}],
    [{id: 'item-turkey', name: 'Turkey sandwich', allergens: ['wheat']}, {id: 'item-yogurt', name: 'Yogurt parfait', allergens: ['milk', 'tree_nut']}]];
  for (const [s, items] of [[d.schools[0], alderItems], [d.schools[1], kestrelItems]]) {
    for (const date of schoolDays(s, '2026-10-26', '2026-11-20')) {
      d.menu_days.push({id: 'menu-' + s.id.slice(7) + '-' + date, school_id: s.id, date, items: structuredClone(items[time.weekday(date) - 1])});
    }
  }
  // ---- lunch transactions: top-ups, a carried-over adjustment, and one purchase per school day from 12 October.
  const tx = [];
  let n = 0;
  const addTx = (child, kind, amount, when, extra = {}) => {
    const id = 'tx-' + String(++n).padStart(4, '0');
    tx.push({id, lunch_account_id: 'lunch-' + child.slice(6), child_id: child, kind, amount_cents: amount, item: null, allergens: [], at: when,
      payment_id: null, note: null, request_id: null, event_id: null, ...extra});
    return id;
  };
  const payments = [];
  const topup = (child, amount, when, payId) => { const id = addTx(child, 'topup', amount, when, {payment_id: payId}); payments.push(pay(payId, 'lunch_topup', child, amount, 'pm-0001', 'lunch_transaction', id, when)); };
  topup('child-theo', 5000, at('2026-09-20', '19:00'), 'pay-0001');
  topup('child-ines', 5000, at('2026-09-20', '19:02'), 'pay-0002');
  topup('child-nico', 5000, at('2026-09-20', '19:04'), 'pay-0007');
  topup('child-theo', 5000, at('2026-10-25', '18:00'), 'pay-0008');
  addTx('child-theo', 'refund', 375, at('2026-10-08', '14:00'), {item: 'Chicken rice bowl', note: 'Meal not served (field trip)'});
  addTx('child-nico', 'refund', 425, at('2026-10-30', '14:00'), {item: 'Teriyaki chicken', note: 'Charged twice'});
  const price = {'child-theo': 375, 'child-ines': 345, 'child-nico': 425};
  const rotation = [{name: 'Lunch of the day', allergens: ['wheat']}, {name: 'Rice and beans', allergens: []}];
  const restricted = new Set(['child-ines|2026-11-04']); // the cafeteria sold Ines an almond bar
  for (const kid of d.children) {
    const s = schoolOf[kid.id], days = schoolDays(s, '2026-09-21', '2026-11-13');
    days.forEach((date, i) => {
      if (kid.id === 'child-theo' && i % 3 === 2) return; // Theo brings lunch some days
      if (kid.id === 'child-nico' && i % 2 === 1) return;
      if (kid.id === 'child-ines' && i % 4 === 3 && !restricted.has(kid.id + '|' + date)) return;
      const a = d.attendance.find(x => x.child_id === kid.id && x.date === date);
      if (a && a.status === 'absent') return;
      const menu = d.menu_days.find(m => m.school_id === s.id && m.date === date);
      let item = menu ? menu.items.find(it => !it.allergens.some(x => kid.meal_restrictions.includes(x))) || menu.items[1] : rotation[i % 2];
      if (restricted.has(kid.id + '|' + date)) item = menu.items.find(it => it.id === 'item-almond-bar');
      addTx(kid.id, 'purchase', -price[kid.id], at(date, s.id === 'school-alder' ? '11:55' : '12:20'), {item: item.name, allergens: [...item.allergens]});
      if (kid.id === 'child-ines' && date === '2026-11-04') addTx(kid.id, 'purchase', -275, at(date, '13:40'), {item: 'Fruit cup', allergens: []}); // over the 6.00 daily limit
    });
  }
  d.lunch_transactions = tx;
  d.payments = [...payments,
    pay('pay-0003', 'form_fee', 'child-ines', 600, 'pm-0001', 'form_response', 'fr-0001', at('2026-09-29', '20:00')),
    pay('pay-0004', 'form_fee', 'child-theo', 1800, 'pm-0002', 'form_response', 'fr-0007', at('2026-11-12', '21:00')),
    pay('pay-0005', 'form_fee', 'child-theo', 500, 'pm-0001', 'form_response', 'fr-0013', at('2026-11-10', '20:30')),
    pay('pay-0006', 'form_fee', 'child-ines', 500, 'pm-0001', 'form_response', 'fr-0014', at('2026-11-10', '20:31'), 'refunded', at('2026-11-13', '07:00'), 'withdrawn')]
    .sort((a, b) => a.id.localeCompare(b.id));
  // A balance carried over from last year makes each account end at its story value: Theo 12.50,
  // Ines 3.10 (under her 5.00 threshold, notified), Nico 20.00.
  const target = {'lunch-theo': 1250, 'lunch-ines': 310, 'lunch-nico': 2000};
  for (const acct of d.lunch_accounts) {
    const sum = tx.filter(t => t.lunch_account_id === acct.id).reduce((s, t) => s + t.amount_cents, 0);
    addTx(acct.child_id, 'adjustment', target[acct.id] - sum, at('2026-08-26', '08:00'), {note: 'Balance carried over from last year'});
  }
  tx.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const lowNotes = [], refundNotes = [];
  for (const acct of d.lunch_accounts) {
    let bal = 0, notified = false;
    for (const t of tx.filter(x => x.lunch_account_id === acct.id)) {
      bal += t.amount_cents;
      if (t.kind === 'refund') refundNotes.push({acct, t, bal});
      if (bal < acct.low_balance_threshold_cents && !notified && t.kind === 'purchase') { notified = true; lowNotes.push({acct, t, bal}); }
      else if (bal >= acct.low_balance_threshold_cents) notified = false;
    }
    acct.balance_cents = bal; acct.low_balance_notified = notified;
  }

  // ---- notifications (20): what the school, the cafeteria and the other guardians did.
  const nt = [];
  const note = (kind, when, child, objType, objId, title, body) => nt.push({id: 'ntf-' + String(nt.length + 1).padStart(4, '0'), kind, at: when, child_id: child,
    object_type: objType, object_id: objId, title, body, event_id: null, wire: null});
  const pub = f => note('form.published', f.published_at, f.child_ids.length === 1 ? f.child_ids[0] : null, 'form', f.id, (f.school_id === A ? 'Alder Elementary' : 'Kestrel Ridge Middle School') + ': ' + f.title,
    (f.school_id === A ? 'Alder Elementary' : 'Kestrel Ridge Middle School') + ' sent a form for ' + f.child_ids.map(id => d.children.find(k => k.id === id).display_name).join(' and ') +
      ': "' + f.title + '". ' + (f.fee_cents ? 'Fee: $' + (f.fee_cents / 100).toFixed(2) + '. ' : 'No fee. ') + 'Answers are due by ' + time.longDateTime(f.due_at, TZ) + '.');
  const F = id => d.forms.find(f => f.id === id);
  d.forms.forEach(pub);
  // The other guardians' answers, in the App's wording.
  const answered = r => { const f = F(r.form_id), who = d.people.find(p => p.person_id === r.by_person_id).display_name, kid = d.children.find(k => k.id === r.child_id).display_name,
    verb = r.state === 'declined' ? 'declined' : 'signed';
    note('form.answered', r.answered_at, r.child_id, 'form_response', r.id, who + ' ' + verb + ' "' + f.title + '" for ' + kid,
      who + ' ' + verb + ' "' + f.title + '" for ' + kid + ' (version ' + r.form_version + '). Their answer holds the form for ' + kid + '; it cannot be changed from this account.'); };
  d.form_responses.filter(r => r.by_person_id !== d.owner_person_id).forEach(answered);
  // The office's reviews of pickup people.
  for (const p of d.pickup_people) for (const x of p.history.filter(e => ['approved', 'denied'].includes(e.action))) {
    const kid = d.children.find(k => k.id === p.child_id).display_name, verb = x.action === 'approved' ? 'approved' : 'did not approve';
    note('pickup.person_reviewed', x.at, p.child_id, 'pickup_person', p.id, 'Alder Elementary: ' + p.display_name + (x.action === 'approved' ? ' approved to collect ' : ' not approved to collect ') + kid,
      'The office ' + verb + ' ' + p.display_name + ' as a person who may collect ' + kid + '.');
  }
  note('absence.reviewed', at('2026-09-29', '14:00'), 'child-theo', 'absence_report', 'rep-0001', "Alder Elementary: Theo Okafor's report marked excused", 'The office reviewed your report for Theo Okafor (Tuesday, September 29) and marked it excused.');
  note('absence.reviewed', at('2026-10-07', '13:30'), 'child-ines', 'absence_report', 'rep-0002', "Alder Elementary: Ines Okafor's report marked excused", 'The office reviewed the report sent by Dana Okafor for Ines Okafor (Tuesday, October 6 and Wednesday, October 7) and marked it excused.');
  note('school.day_changed', at('2026-10-14', '16:30'), null, 'school_day', 'day-alder-2026-10-16', 'Alder Elementary: closed on Friday, October 16',
    'Alder Elementary will be closed on Friday, October 16. Reason given: District air-quality closure. Theo Okafor: no dismissal change for that day. Theo Okafor: the absence reported on Monday, October 12 no longer applies to that day. Ines Okafor: no dismissal change for that day.');
  note('school.day_changed', at('2026-10-14', '16:30'), 'child-nico', 'school_day', 'day-kestrel-2026-10-16', 'Kestrel Ridge Middle School: closed on Friday, October 16',
    'Kestrel Ridge Middle School will be closed on Friday, October 16. Reason given: District air-quality closure.');
  note('absence.reviewed', at('2026-10-21', '15:00'), 'child-ines', 'absence_report', 'rep-0004', "Alder Elementary: Ines Okafor's report marked unexcused", 'The office reviewed your report for Ines Okafor (Wednesday, October 21) and marked it unexcused. Note from the office: Not an excused reason under district policy.');
  note('attendance.unexplained', at('2026-10-28', '08:45'), 'child-nico', 'attendance_record', 'att-child-nico-2026-10-28', 'Kestrel Ridge Middle School: Nico Reyes marked absent on Wednesday, October 28',
    'Kestrel Ridge Middle School marked Nico Reyes absent on Wednesday, October 28 and has no report from a guardian for that day.');
  note('dismissal.recorded', at('2026-11-04', '18:00'), 'child-ines', 'dismissal_change', 'dc-0002', 'Dana Okafor changed Ines Okafor\'s way home on Friday, November 6', 'Dana Okafor recorded that Ines Okafor will be collected by Dana Okafor on Friday, November 6.');
  for (const {acct, t, bal} of refundNotes) {
    const name = d.children.find(k => k.id === acct.child_id).display_name, money = c => '$' + (Math.abs(c) / 100).toFixed(2);
    note('lunch.refund', t.at, acct.child_id, 'lunch_transaction', t.id, 'Lunch refund for ' + name + ': ' + money(t.amount_cents),
      'The cafeteria credited ' + money(t.amount_cents) + ' to ' + name + "'s lunch account for " + t.item + '. Balance: ' + money(bal) + '.');
  }
  for (const {acct, t, bal} of lowNotes) {
    const name = d.children.find(k => k.id === acct.child_id).display_name, money = c => (c < 0 ? '-$' : '$') + (Math.abs(c) / 100).toFixed(2);
    note('lunch.low_balance', t.at, acct.child_id, 'lunch_account', acct.id, name + "'s lunch balance is " + money(bal),
      name + "'s lunch balance fell to " + money(bal) + ', under your threshold of ' + money(acct.low_balance_threshold_cents) + '.');
  }
  note('attendance.unexplained', at('2026-11-06', '13:20'), 'child-nico', 'attendance_record', 'att-child-nico-2026-11-06', 'Kestrel Ridge Middle School: Nico Reyes marked leaving early on Friday, November 6',
    'Kestrel Ridge Middle School marked Nico Reyes leaving early (13:10) on Friday, November 6 and has no report from a guardian for that day.');
  note('attendance.unexplained', at('2026-11-12', '09:15'), 'child-theo', 'attendance_record', 'att-child-theo-2026-11-12', 'Alder Elementary: Theo Okafor marked late on Thursday, November 12',
    'Alder Elementary marked Theo Okafor late (09:05) on Thursday, November 12 and has no report from a guardian for that day. Open Bellnote to report the reason.');
  note('form.changed', at('2026-11-16', '10:30'), 'child-theo', 'form', 'form-aquarium', 'Alder Elementary: "Grade 3 aquarium trip" was changed',
    'The school changed the text and the event date on "Grade 3 aquarium trip" (Aquarium moved our booking). Your signature for Theo Okafor no longer counts: review version 2 and sign again or withdraw.');
  note('dismissal.recorded', at('2026-11-16', '21:15'), 'child-theo', 'dismissal_change', 'dc-0004', 'Dana Okafor changed Theo Okafor\'s way home on Friday, November 20', 'Dana Okafor recorded that Theo Okafor will be collected by Dana Okafor on Friday, November 20.');
  nt.sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).forEach((x, i) => { x.id = 'ntf-' + String(i + 1).padStart(4, '0'); });
  d.notifications = nt;
  // The family's earlier history, from 2025-01-01 to the summer of 2026, generated in front of the
  // hand-written school year (scripts/history.cjs; fixed seed, no clock).
  return withHistory ? history.merge(d) : d;
}
const file = path.join(root, 'fixtures/reference.json');
const text = () => JSON.stringify(build(), null, 2) + '\n';
const matches = () => fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text();
module.exports = {build, matches};
if (require.main === module) {
  if (process.argv.includes('--check')) {
    if (!matches()) { console.error('fixtures/reference.json differs from its builder'); process.exitCode = 1; }
    else console.log('fixtures/reference.json matches its builder.');
  } else { const t = text(); fs.writeFileSync(file, t); console.log('Wrote fixtures/reference.json (' + Buffer.byteLength(t) + ' bytes).'); }
}
