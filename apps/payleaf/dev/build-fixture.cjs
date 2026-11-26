'use strict';
// Writes fixtures/minimal.json. It replays one scripted year of the account through the App's own hooks, so the App accepted every step of it,
// and the App's own pay run computed every deduction, net pay and deposit.
// Run `node dev/build-fixture.cjs` after a change, or `node dev/build-fixture.cjs --check` to compare with the committed file. Never used at run time.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const plugin = require('../plugin.cjs');
const time = require('../src/time.cjs');
const {compile} = require('../tests/schema-validator.cjs');
const {counts, PLAN} = require('./check-fixture.cjs');
const base = require('./base.json');
const root = path.resolve(__dirname, '..');
const APP = require('../app.json').app_id, ZONE = base.employer.timezone, CLOCK = require('../fixtures/clock.json').initial_time;
const ACCOUNT = base.account_id, MANAGER = base.employment.manager.person_id, PLANS = base.plans.map(plan => plan.id);
const pad = (number, size = 4) => String(number).padStart(size, '0');
const total = values => values.reduce((sum, value) => sum + value, 0);

// A local time such as '2026-03-23 08:50' or '2026-11-13 23:59:59', with the UTC offset that the employer's zone has on that date.
function at(local) {
  for (const offset of ['-04:00', '-05:00']) {
    const value = local.replace(' ', 'T') + (local.length === 16 ? ':00' : '') + offset;
    if (time.iso(Date.parse(value), ZONE) === value) return value;
  }
  throw new Error('Not a local time in ' + ZONE + ': ' + local);
}
// A pay date every second Friday, for the two weeks that end on the Sunday before it. The cut-off is the Tuesday before, at 17:00.
const entry = (id, payDate) => ({id, period_start: time.addDays(payDate, -18), period_end: time.addDays(payDate, -5), pay_date: payDate,
  cutoff_at: at(time.addDays(payDate, -3) + ' 17:00'), state: 'planned', statement_id: null, history: []});
const run = n => 'pd-2026-' + pad(n, 2);
const CALENDAR = Array.from({length: 26}, (_, i) => entry(run(i + 1), time.addDays('2026-01-02', 14 * i)));
const MOVED = {[run(13)]: '2026-06-18'};
const payDate = n => MOVED[run(n)] || CALENDAR[n - 1].pay_date;

// One step of the history: a write of the account holder (`call`) or an act of payroll, the manager or the benefits team (`event`).
// '@label' stands for the ID that a labelled write made. An event payload can be a function of the data at its time.
const steps = [];
const call = (when, name, args, label) => steps.push({when: at(when), name, args, label});
const event = (when, name, args) => steps.push({when: at(when), name, args, event: true});
let adjustments = 0;
const adjust = (when, type, hours, reason, note) => event(when, 'leave.adjusted', {entry_id: 'le-' + pad(++adjustments), leave_type_id: type, hours, reason, note});
const decide = (when, label, decision, note) => event(when, 'leave.decided', {leave_request_id: '@' + label, decision, decided_by: MANAGER, ...(note ? {note} : {})});
const leave = (when, type, start, end, hours, note, label) => call(when, 'leave.request', {id: type, start, end, hours_per_day: hours, note}, label);
const HARBOR = {label: 'Harbor savings', kind: 'savings', last4: '2290'}, CHECKING = {label: 'Everyday checking', kind: 'checking', last4: '7731'};
const JOINT = {label: 'Joint savings', kind: 'savings', last4: '4410'}, CREDIT_UNION = {label: 'Credit union checking', kind: 'checking', last4: '5520'};

// The pay runs. Earnings and taxes are payroll's data: a salary of 80,600 a year, and 83,200 from the period that starts on 6 April.
// Paid leave in a period has its own salary line, and an hour is the pay of the period divided by 80. Payleaf computes the rest.
const SALARY = n => n < 9 ? 310000 : 320000;
const EXTRA_WITHHOLDING = n => n >= 5 && n <= 18 ? 2000 : 0;
const LEAVE_PAY = {vacation: 'Vacation pay', personal: 'Personal time pay', sick: 'Sick pay'};
const mileage = miles => ({kind: 'reimbursement', text: 'Mileage reimbursement, ' + miles + ' miles', amount: miles * 70});
const EXTRAS = {3: [mileage(84)], 5: [{kind: 'reimbursement', text: 'Travel reimbursement, warehouse trip of 26 and 27 January', amount: 18640, inquiry_id: '@trip'}, mileage(66)],
  6: [{kind: 'bonus', text: 'Annual bonus', amount: 240000}], 7: [mileage(102)], 9: [mileage(75)], 11: [mileage(120)], 13: [mileage(58)], 18: [mileage(93)],
  20: [mileage(110)], 22: [mileage(71)]};
function payroll(n) {
  return data => {
    const period = data.calendar.find(e => e.id === run(n)), salary = SALARY(n), lines = [];
    for (const type of data.leave_types) {
      const hours = total(data.leave_requests.filter(r => r.leave_type_id === type.id && r.stored_state === 'approved')
        .map(r => r.days.filter(day => day >= period.period_start && day <= period.period_end).length * Math.round(r.hours_per_day * 10)));
      if (hours) lines.push({kind: 'salary', text: LEAVE_PAY[type.id] + ', ' + (hours / 10).toFixed(1) + ' hours', amount: salary * hours / 800});
    }
    const extras = EXTRAS[n] || [], bonus = total(extras.filter(x => x.kind === 'bonus').map(x => x.amount));
    lines.unshift({kind: 'salary', text: 'Regular pay', amount: salary - total(lines.map(x => x.amount))});
    // Medical is taken before Social security and Medicare. The bonus has its own federal tax at 22 percent.
    const fica = salary + bonus - 12000, federal = (salary === 310000 ? 39062 : 40438) + EXTRA_WITHHOLDING(n);
    const taxes = [['Federal income tax', federal], ['Social security', Math.floor((fica * 62 + 500) / 1000)], ['Medicare', Math.floor((fica * 145 + 5000) / 10000)],
      ...(bonus ? [['Federal tax on the bonus', bonus * 22 / 100]] : [])];
    return {entry_id: run(n), statement_id: 'ps-2026-' + pad(n, 2),
      earnings: [...lines, ...extras].map((line, i) => ({line_id: 'e' + (i + 1), ...line, amount: line.amount / 100})),
      taxes: taxes.map(([text, amount], i) => ({line_id: 't' + (i + 1), text, amount: amount / 100}))};
  };
}
for (let n = 1; n <= 22; n++) event(payDate(n) + ' 06:00', 'payroll.run_posted', payroll(n));
const harbor = data => data.statements.find(s => s.id === 'ps-2026-11').deposits.find(d => d.account.last4 === HARBOR.last4).id;

// November 2025: the enrollment window for 2026. Kai keeps the PPO and the basic dental plan, and takes no vision and no spending account.
event('2025-10-27 09:00', 'enrollment.opened', {window_id: 'win-2026', plan_year: 2026, opens_at: at('2025-11-03 00:00'), closes_at: at('2025-11-14 23:59:59'), plan_ids: PLANS});
call('2025-11-10 19:30', 'benefits.elect', {id: 'win-2026', plan_id: 'medical', option_id: 'med-ppo-ee'});
call('2025-11-10 19:32', 'benefits.elect', {id: 'win-2026', plan_id: 'dental', option_id: 'den-basic-ee'});
call('2025-11-10 19:35', 'benefits.elect', {id: 'win-2026', plan_id: 'fsa', no_coverage: true});
call('2025-11-10 19:42', 'benefits.submit', {id: 'win-2026'});

// January to April: the carryover from 2025, 5 percent for retirement, a missing travel reimbursement, extra federal withholding and the first leave.
adjust('2026-01-01 00:05', 'vacation', 86, 'carryover', 'Hours carried over from 2025.');
adjust('2026-01-01 00:05', 'vacation', -6, 'forfeited', 'Hours above the carryover cap of 80.');
adjust('2026-01-01 00:05', 'sick', 40, 'carryover', 'Hours carried over from 2025.');
call('2026-01-07 19:40', 'retirement.set', {id: ACCOUNT, percent: 5});
call('2026-02-17 09:20', 'inquiries.open', {id: 'ps-2026-04', amount: 186.4, note: 'My travel reimbursement of 186.40 for the warehouse trip on 26 and 27 January is missing.'}, 'trip');
call('2026-02-17 21:10', 'withholding.update', {id: ACCOUNT, form: {...base.settings.withholding, extra_withholding: 20}});
event('2026-02-19 14:00', 'inquiry.answered', {inquiry_id: '@trip', outcome: 'corrected', correction_amount: 186.4, answered_by: 'Payroll',
  note: 'The reimbursement will be on your next pay statement.'});
leave('2026-02-20 10:15', 'vacation', '2026-03-25', '2026-03-27', 8, 'Long weekend with family.', 'march');
decide('2026-02-23 09:40', 'march', 'approve');
leave('2026-02-24 07:30', 'sick', '2026-02-24', '2026-02-25', 8, 'Flu.', 'flu');
decide('2026-02-24 09:10', 'flu', 'approve', 'Feel better soon.');
call('2026-03-01 11:05', 'inquiries.open', {id: 'ps-2026-05', line_id: 't1', amount: 20, note: 'The federal income tax is 20.00 higher than on my last statement.'}, 'tax');
event('2026-03-03 10:30', 'inquiry.answered', {inquiry_id: '@tax', outcome: 'no_change', answered_by: 'Payroll',
  note: 'Your withholding form of 17 February asks for 20.00 of extra withholding from each pay.'});
leave('2026-04-06 12:20', 'vacation', '2026-05-25', '2026-05-29', 8, 'Trip to see my parents.', 'may');
decide('2026-04-07 09:15', 'may', 'approve');
leave('2026-04-13 08:45', 'personal', '2026-05-01', '2026-05-01', 8, 'Moving to a new apartment.', 'move');
decide('2026-04-14 10:00', 'move', 'approve');

// May: Kai moves savings to a joint account and closes the old one on 21 May. The change comes after the cut-off of 19 May,
// so the run of 22 May still pays the old account. The bank returns that deposit, and payroll sends it again to checking.
call('2026-05-04 08:45', 'leave.cancel', {id: '@may', reason: 'The trip moved to July.'});
call('2026-05-20 20:30', 'deposit.update', {id: ACCOUNT, accounts: [{...JOINT, amount: 250}, {...CHECKING, remainder: true}]});
call('2026-05-20 20:41', 'deposit.update', {id: ACCOUNT, accounts: [{...JOINT, amount: 300}, {...CHECKING, remainder: true}]});
call('2026-05-26 08:10', 'inquiries.open', {id: 'ps-2026-11', amount: 200, note: 'The deposit of 200.00 went to my old Harbor savings account. I closed that account on 21 May.'}, 'deposit');
event('2026-05-27 10:00', 'deposit.updated', data => ({deposit_id: harbor(data), state: 'returned', reason: 'The receiving account is closed.'}));
call('2026-05-27 18:30', 'inquiries.withdraw', {id: '@deposit'});
event('2026-05-29 11:00', 'calendar.changed', {entry_id: run(13), pay_date: MOVED[run(13)], reason: 'The bank is closed on Juneteenth.'});
event('2026-05-29 15:00', 'deposit.updated', data => ({deposit_id: harbor(data), state: 'reissued', reason: 'Sent again to the checking account on file.',
  reissued_to: {kind: 'account', label: CHECKING.label, last4: CHECKING.last4}}));

// June to September: summer leave, a denied week, a lapsed request, a cancelled retirement change and the end of the extra withholding.
leave('2026-06-01 13:00', 'vacation', '2026-07-06', '2026-07-10', 8, 'Family trip.', 'july');
decide('2026-06-02 16:05', 'july', 'approve');
leave('2026-07-20 09:00', 'vacation', '2026-08-24', '2026-08-28', 8, 'Beach week.', 'august');
decide('2026-07-21 10:40', 'august', 'deny', 'This is the peak week for the warehouses. Please choose a week in September.');
leave('2026-07-22 08:30', 'vacation', '2026-09-14', '2026-09-18', 8, 'Beach week, moved to September.', 'september');
decide('2026-07-23 09:05', 'september', 'approve', 'Enjoy the beach.');
// No decision came before the first day, so this request lapsed on 14 August.
leave('2026-07-27 12:15', 'personal', '2026-08-14', '2026-08-14', 4, 'Dentist appointment.');
call('2026-08-03 21:00', 'retirement.set', {id: ACCOUNT, percent: 8}, 'eight');
call('2026-08-04 07:45', 'changes.cancel', {id: '@eight'});
call('2026-09-01 20:00', 'withholding.update', {id: ACCOUNT, form: base.settings.withholding});
adjust('2026-09-08 10:00', 'vacation', 8, 'grant', 'One extra day for the weekend inventory count on 5 and 6 September.');
// Email notices were off for 18 days, so two of the kept notifications have no wire message.
call('2026-09-10 08:00', 'preferences.update', {email_notices: false});
call('2026-09-28 08:00', 'preferences.update', {email_notices: true});
leave('2026-09-28 12:30', 'vacation', '2026-11-23', '2026-11-27', 8, 'Thanksgiving week.', 'thanksgiving');
decide('2026-09-29 09:20', 'thanksgiving', 'approve');

// October and November: a backdated sick day, the first pay dates of 2027, the enrollment window for 2027 and the changes that wait at the clock.
leave('2026-10-08 08:05', 'sick', '2026-10-07', '2026-10-07', 8, 'Fever.', 'fever');
decide('2026-10-08 10:30', 'fever', 'approve');
['2027-01-01', '2027-01-15', '2027-01-29', '2027-02-12'].forEach((day, i) => {
  const {id, period_start, period_end, pay_date, cutoff_at} = entry('pd-2027-' + pad(i + 1, 2), day);
  event('2026-10-19 09:0' + i, 'calendar.changed', {entry_id: id, period_start, period_end, cutoff_at, ...(i ? {pay_date, reason: 'The pay calendar for early 2027.'}
    : {pay_date: '2027-01-04', reason: 'The pay date moves to Monday, because the bank is closed on New Year\'s Day.'})});
});
event('2026-10-26 09:00', 'enrollment.opened', {window_id: 'win-2027', plan_year: 2027, opens_at: at('2026-11-02 00:00'), closes_at: at('2026-11-13 23:59:59'), plan_ids: PLANS});
call('2026-10-26 09:30', 'inquiries.open', {id: 'ps-2026-22', amount: 412.5, note: 'My travel reimbursement of 412.50 for the client visit on 13 and 14 October is missing.'});
leave('2026-10-26 14:00', 'personal', '2026-11-13', '2026-11-13', 8, 'Personal errands.');
leave('2026-11-02 12:10', 'vacation', '2026-12-28', '2026-12-31', 8, 'End of year break.');
// Pay moves to a new checking account before the cut-off of 3 November, so the change is locked for the pay of 6 November.
call('2026-11-02 19:15', 'deposit.update', {id: ACCOUNT, accounts: [{...JOINT, amount: 300}, {...CREDIT_UNION, remainder: true}]});
call('2026-11-03 20:05', 'benefits.elect', {id: 'win-2027', plan_id: 'dental', option_id: 'den-plus-ee'});
call('2026-11-03 20:07', 'benefits.elect', {id: 'win-2027', plan_id: 'vision', option_id: 'vis-ee'});
call('2026-11-03 20:12', 'benefits.elect', {id: 'win-2027', plan_id: 'fsa', yearly_amount: 1500});
call('2026-11-03 20:15', 'benefits.submit', {id: 'win-2027'});
// After that cut-off: 7 percent, then 6 percent, for the pay of 20 November. The later change replaces the earlier one.
call('2026-11-03 21:30', 'retirement.set', {id: ACCOUNT, percent: 7});
call('2026-11-03 21:34', 'retirement.set', {id: ACCOUNT, percent: 6});
// A new yearly amount is saved but not submitted again, so the submitted set still has 1,500.00.
call('2026-11-04 08:50', 'benefits.elect', {id: 'win-2027', plan_id: 'fsa', yearly_amount: 1800});

const ctx = (role, now) => Object.freeze({app_id: APP, role, virtual_now: now, binding: structuredClone(require('../fixtures/binding.json'))});
const seedValid = compile(require('../schemas/seed.schema.json'), path.join(root, 'schemas'));
// The checks that Core runs on a loaded seed and after every write and event.
function valid(data, now) {
  assert.ok(seedValid(data), 'Seed schema');
  plugin.validateSeed(ctx('infra', now), data);
}
function replay() {
  let data = {...structuredClone(base), calendar: structuredClone(CALENDAR), statements: [], changes: [], inquiries: [], leave_entries: [], leave_requests: [],
    windows: [], election_sets: [], notifications: [], activity: []};
  const ids = {}, done = {writes: 0, events: 0};
  const inputs = new Map(require('../tools.json').map(tool => [tool.name, compile(tool.inputSchema, root)]));
  const eventValid = compile(require('../schemas/events.schema.json'), path.join(root, 'schemas'));
  const resolve = value => typeof value === 'string' ? (value.startsWith('@') ? ids[value.slice(1)] || assert.fail('Unknown label ' + value) : value)
    : Array.isArray(value) ? value.map(resolve) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v)])) : value;
  function apply(step, payload) {
    const incoming = {event_id: 'ev-pl-' + (100 + ++done.events), at: step.when, operation: APP + '.' + step.name, payload};
    assert.ok(eventValid(incoming), 'Event schema');
    data = plugin.applyEvent(ctx('infra', step.when), data, incoming);
  }
  function write(step, args) {
    const name = APP + '.' + step.name, full = {...args, expected_version: {epoch: 1, revision: done.writes + done.events}, request_id: 'req-kai-' + pad(++done.writes)};
    assert.ok(inputs.get(name)(full), 'Input schema');
    const out = plugin.handleTool(ctx('agent', step.when), data, name, full);
    data = out.data;
    if (step.label) ids[step.label] = out.result.id;
  }
  // The sort is stable, and every step runs at its own time. So the clock only moves forward.
  for (const step of [...steps].sort((a, b) => Date.parse(a.when) - Date.parse(b.when))) {
    try {
      (step.event ? apply : write)(step, resolve(typeof step.args === 'function' ? step.args(data) : step.args));
      valid(data, step.when);
    } catch (error) { error.message = step.name + ' at ' + step.when + ': ' + error.message; throw error; }
  }
  return data;
}
// Calls `visit` for every timestamp in a value, with its key.
function stamps(value, visit, key = '') {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) visit(value, key);
  else if (value && typeof value === 'object') for (const [inner, item] of Object.entries(value)) stamps(item, visit, Array.isArray(value) ? key : inner);
}
// What the plan promises of the fixture, and the story it tells. A wrong count fails the build.
function promised(data) {
  const made = counts(data), read = (name, args = {}) => plugin.handleTool(ctx('agent', CLOCK), structuredClone(data), APP + '.' + name, args).result;
  const covers = (values, wanted) => assert.deepEqual([...new Set(values)].sort(), [...wanted].sort());
  for (const [name, count] of Object.entries(PLAN)) assert.deepEqual(made[name], count, 'Count of ' + name);
  covers(read('changes.list').items.map(x => x.state), ['waiting', 'replaced', 'cancelled', 'locked', 'applied']);
  covers(read('leave.list').items.map(x => x.state), ['pending', 'approved', 'denied', 'cancelled', 'taken', 'lapsed']);
  covers(data.inquiries.map(x => x.state), ['open', 'withdrawn', 'answered']);
  covers(data.inquiries.filter(x => x.answer).map(x => x.answer.outcome), ['corrected', 'no_change']);
  covers(read('benefits.windows').items.map(x => x.set_state), ['final', 'submitted']);
  covers(data.statements.flatMap(s => s.deposits.map(d => d.state)), ['sent', 'reissued']);
  covers(data.statements.flatMap(s => s.earnings.map(l => l.kind)), ['salary', 'reimbursement', 'bonus']);
  // The taxes of each run assume these settings: the extra withholding of the script, and medical at 120.00.
  data.statements.forEach((s, i) => {
    assert.equal(Math.round(s.settings_used.withholding.extra_withholding * 100), EXTRA_WITHHOLDING(i + 1), 'Extra withholding of ' + s.id);
    assert.equal(s.deductions.find(d => d.plan_id === 'medical').amount, 120, 'Medical of ' + s.id);
  });
  for (const key of ['account_id', 'owner_person_id', 'employer', 'employment', 'leave_types', 'plans']) assert.deepEqual(data[key], base[key], 'The fixture keeps ' + key + ' of base.json');
  stamps(data, value => assert.equal(time.iso(Date.parse(value), ZONE), value, 'UTC offset of ' + value));
  stamps(data, (value, key) => assert.ok(['cutoff_at', 'opens_at', 'closes_at'].includes(key) || Date.parse(value) <= Date.parse(CLOCK), value + ' is after the clock'));
}
const data = replay();
// A seed may hold any part of its history. The fixture keeps the 26 newest notifications and the activity rows from the time of the oldest one on.
data.notifications = data.notifications.slice(-PLAN.notifications);
data.activity = data.activity.filter(row => Date.parse(row.at) >= Date.parse(data.notifications[0].at));
valid(data, CLOCK);
promised(data);
const target = path.join(root, 'fixtures/minimal.json'), text = JSON.stringify(data, null, 2) + '\n', check = process.argv.includes('--check');
if (check && (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text)) {
  console.error('Generated file is out of date: fixtures/minimal.json');
  process.exitCode = 1;
} else {
  if (!check) fs.writeFileSync(target, text);
  console.log((check ? 'Checked' : 'Wrote') + ' fixtures/minimal.json (' + data.statements.length + ' pay statements, ' + steps.length + ' steps, ' + Buffer.byteLength(text) + ' bytes).');
}
