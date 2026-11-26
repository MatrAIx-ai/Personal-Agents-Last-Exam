'use strict';
// Writes the evaluation dataset in data/evaluation/: two years (1 January 2025 to 31 December 2026) of one employee's synthetic history.
// Like dev/build-fixture.cjs, it replays a scripted history through the App's own hooks, so the App accepted every step and computed every
// deduction, net pay, deposit and leave accrual. A small seeded PRNG adds the sick days and the mileage lines, so a rerun gives the same bytes.
// Run `node dev/generate-evaluation-data.cjs` after a change, or with `--check` to compare with the committed files. Never used at run time.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const plugin = require('../plugin.cjs');
const time = require('../src/time.cjs');
const {records} = require('../src/model.cjs');
const {compile} = require('../tests/schema-validator.cjs');
const base = require('./base.json');

const VERSION = '1.0.0', PRNG_SEED = 20250101;
const root = path.resolve(__dirname, '..'), OUT = path.join(root, 'data/evaluation');
const APP = require('../app.json').app_id, ZONE = base.employer.timezone, ACCOUNT = base.account_id, MANAGER = base.employment.manager.person_id;
const PLANS = base.plans.map(plan => plan.id);
// The replay starts at the first moment of the window. The full-window seed is read at the last hour of it, so every record of 2025 and 2026 is in the past.
const START = '2025-01-01T00:00:00-05:00', CLOCK = '2026-12-31T23:00:00-05:00';
const pad = (number, size = 4) => String(number).padStart(size, '0');
const total = values => values.reduce((sum, value) => sum + value, 0);

// mulberry32: a small PRNG with a fixed seed.
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = prng(PRNG_SEED);
const pick = list => list[Math.floor(random() * list.length)];
const between = (low, high) => low + Math.floor(random() * (high - low + 1));

// A local time such as '2025-03-04 08:50', with the UTC offset that the employer's zone has on that date.
function at(local) {
  for (const offset of ['-04:00', '-05:00']) {
    const value = local.replace(' ', 'T') + (local.length === 16 ? ':00' : '') + offset;
    if (time.iso(Date.parse(value), ZONE) === value) return value;
  }
  throw new Error('Not a local time in ' + ZONE + ': ' + local);
}
// The same company holidays each year. In 2025 Independence Day is a Friday; in 2026 it is a Saturday, so the Friday before is off.
const HOLIDAYS = ['2025-01-01', '2025-01-20', '2025-02-17', '2025-05-26', '2025-06-19', '2025-07-04', '2025-09-01', '2025-11-11', '2025-11-27', '2025-11-28',
  '2025-12-25', ...base.employer.holidays, '2027-01-01'];
const working = day => time.weekday(day) % 6 !== 0 && !HOLIDAYS.includes(day);

// A pay date every second Friday, for the two weeks that end on the Sunday before it. The cut-off is the Tuesday before, at 17:00.
const entry = (id, payDate) => ({id, period_start: time.addDays(payDate, -18), period_end: time.addDays(payDate, -5), pay_date: payDate,
  cutoff_at: at(time.addDays(payDate, -3) + ' 17:00'), state: 'planned', statement_id: null, history: []});
const run = (year, n) => 'pd-' + year + '-' + pad(n, 2);
const FIRST = {2025: '2025-01-03', 2026: '2026-01-02'};
const calendarOf = year => Array.from({length: 26}, (_, i) => entry(run(year, i + 1), time.addDays(FIRST[year], 14 * i)));
const CALENDAR = {2025: calendarOf(2025), 2026: calendarOf(2026)};
const MOVED = {[run(2025, 14)]: '2025-07-03', [run(2026, 13)]: '2026-06-18'};
const payDate = (year, n) => MOVED[run(year, n)] || CALENDAR[year][n - 1].pay_date;

// One step of the history: a write of the account holder (`call`) or an act of payroll, the manager or the benefits team (`event`).
// '@label' stands for the ID that a labelled write made. Arguments can be a function of the data at that time.
const steps = [];
const call = (when, name, args, label) => steps.push({when: at(when), name, args, label});
const event = (when, name, args) => steps.push({when: at(when), name, args, event: true});
let adjustments = 0;
const adjust = (when, type, hours, reason, note) => event(when, 'leave.adjusted', data => ({entry_id: 'le-' + pad(++adjustments), leave_type_id: type,
  hours: typeof hours === 'function' ? hours(data) : hours, reason, note}));
const decide = (when, label, decision, note) => event(when, 'leave.decided', {leave_request_id: '@' + label, decision, decided_by: MANAGER, ...(note ? {note} : {})});
const leaves = [];
const leave = (when, type, start, end, hours, note, label) => {
  leaves.push([start, end]);
  call(when, 'leave.request', {id: type, start, end, hours_per_day: hours, ...(note ? {note} : {})}, label);
};
const HARBOR = {label: 'Harbor savings', kind: 'savings', last4: '2290'}, CHECKING = {label: 'Everyday checking', kind: 'checking', last4: '7731'};
const JOINT = {label: 'Joint savings', kind: 'savings', last4: '4410'}, CREDIT_UNION = {label: 'Credit union checking', kind: 'checking', last4: '5520'};
const FORM = base.settings.withholding, FREELANCE = {...FORM, other_income: 2400};
const read = (data, when, name, args = {}) => plugin.handleTool(ctx('agent', when), structuredClone(data), APP + '.' + name, args).result;
const balanceOf = (data, when, type) => read(data, when, 'leave.balances').items.find(row => row.leave_type_id === type).balance;

// Pay. A salary of 78,000 a year, 80,600 from the period that starts on 7 April 2025, and 83,200 from the period that starts on 6 April 2026.
// Earnings and taxes are payroll's data. Payleaf computes the deductions, net pay, deposits and leave accruals.
const RAISES = [['2023-03-06', 78000], ['2025-04-07', 80600], ['2026-04-06', 83200]];
const salaryAt = day => RAISES.filter(([from]) => from <= day).pop()[1];
// Federal income tax for each yearly salary, before the W-4 adjustments. The benefits taken before Social security and Medicare, in cents.
const FEDERAL = {78000: 37686, 80600: 39062, 83200: 40438}, PRETAX = {2025: 17172, 2026: 12000};
const LEAVE_PAY = {vacation: 'Vacation pay', personal: 'Personal time pay', sick: 'Sick pay'};
const mileage = (miles, note) => ({kind: 'reimbursement', text: 'Mileage reimbursement, ' + miles + ' miles' + (note || ''), amount: miles * 70});
const EXTRAS = {
  [run(2025, 6)]: [{kind: 'bonus', text: 'Annual bonus', amount: 200000}, {kind: 'reimbursement', text: 'Mileage reimbursement, 84 miles on 12 and 13 February', amount: 5880, inquiry_id: '@feb-miles'}],
  [run(2025, 20)]: [{kind: 'reimbursement', text: 'Mileage reimbursement, 102 miles on 20 August', amount: 7140, inquiry_id: '@aug-miles'}],
  [run(2026, 5)]: [{kind: 'reimbursement', text: 'Travel reimbursement, warehouse trip of 26 and 27 January', amount: 18640, inquiry_id: '@trip'}],
  [run(2026, 6)]: [{kind: 'bonus', text: 'Annual bonus', amount: 240000}],
  [run(2026, 24)]: [{kind: 'reimbursement', text: 'Travel reimbursement, client visit of 13 and 14 October', amount: 41250, inquiry_id: '@client'}],
  [run(2026, 26)]: [{kind: 'reimbursement', text: 'Mileage reimbursement, 61 miles on 19 November', amount: 4270, inquiry_id: '@nov-miles'}]
};
// Most runs carry no mileage. About one run in three pays the mileage of a site visit.
const MILES = {};
for (const year of [2025, 2026]) for (let n = 1; n <= 26; n++) if (!EXTRAS[run(year, n)] && random() < 0.35) MILES[run(year, n)] = between(28, 140);
// The run whose statement lacks the mileage of a site visit: the inquiries below ask for it.
const MISSING = [run(2025, 5), run(2025, 18), run(2026, 25)];
MISSING.forEach(id => delete MILES[id]);

// The form that a run uses: the change locked for it, else the form in use.
const formFor = (data, when) => { const {withholding} = read(data, when, 'settings.get').settings; return (withholding.locked || {value: withholding.in_use}).value; };
function payroll(year, n) {
  return data => {
    const id = run(year, n), when = at(payDate(year, n) + ' 06:00'), period = data.calendar.find(e => e.id === id), salary = salaryAt(period.period_start) * 100 / 26, lines = [];
    for (const type of data.leave_types) {
      const hours = total(data.leave_requests.filter(r => r.leave_type_id === type.id && r.stored_state === 'approved')
        .map(r => r.days.filter(day => day >= period.period_start && day <= period.period_end).length * Math.round(r.hours_per_day * 10)));
      if (hours) lines.push({kind: 'salary', text: LEAVE_PAY[type.id] + ', ' + (hours / 10).toFixed(1) + ' hours', amount: salary * hours / 800});
    }
    const extras = [...(EXTRAS[id] || []), ...(MILES[id] ? [mileage(MILES[id])] : [])], bonus = total(extras.filter(x => x.kind === 'bonus').map(x => x.amount));
    lines.unshift({kind: 'salary', text: 'Regular pay', amount: salary - total(lines.map(x => x.amount))});
    const form = formFor(data, when), fica = salary + bonus - PRETAX[year];
    const federal = FEDERAL[salary * 26 / 100] + Math.round(form.extra_withholding * 100) + Math.round(form.other_income * 10 / 26);
    const taxes = [['Federal income tax', federal], ['Social security', Math.floor((fica * 62 + 500) / 1000)], ['Medicare', Math.floor((fica * 145 + 5000) / 10000)],
      ...(bonus ? [['Federal tax on the bonus', bonus * 22 / 100]] : [])];
    return {entry_id: id, statement_id: 'ps-' + year + '-' + pad(n, 2),
      earnings: [...lines, ...extras].map((line, i) => ({line_id: 'e' + (i + 1), ...line, amount: line.amount / 100})),
      taxes: taxes.map(([text, amount], i) => ({line_id: 't' + (i + 1), text, amount: amount / 100}))};
  };
}
for (const year of [2025, 2026]) for (let n = 1; n <= 26; n++) event(payDate(year, n) + ' 06:00', 'payroll.run_posted', payroll(year, n));

// 2025, January to June: the carryover from 2024, a larger savings transfer, freelance income on the W-4, a missing mileage line, and spring leave.
adjust('2025-01-01 00:05', 'vacation', 78, 'carryover', 'Hours carried over from 2024.');
adjust('2025-01-01 00:05', 'sick', 32, 'carryover', 'Hours carried over from 2024.');
call('2025-02-10 19:30', 'deposit.update', {id: ACCOUNT, accounts: [{...HARBOR, amount: 250}, {...CHECKING, remainder: true}]});
leave('2025-02-24 12:10', 'vacation', '2025-04-14', '2025-04-18', 8, 'Spring trip to see my sister.', 'spring');
decide('2025-02-25 09:30', 'spring', 'approve', 'Have a good trip.');
call('2025-03-03 20:45', 'withholding.update', {id: ACCOUNT, form: FREELANCE});
call('2025-03-04 08:20', 'inquiries.open', {id: 'ps-2025-05', amount: 58.8, note: 'My mileage of 84 miles for the site visits on 12 and 13 February is missing. That is 58.80.'}, 'feb-miles');
event('2025-03-06 15:10', 'inquiry.answered', {inquiry_id: '@feb-miles', outcome: 'corrected', correction_amount: 58.8, answered_by: 'Payroll',
  note: 'The mileage report came in late. It will be on your next pay statement.'});
call('2025-03-17 12:40', 'inquiries.open', {id: 'ps-2025-06', line_id: 't4', amount: 440, note: 'Why is the federal tax on my bonus 440.00? It looks higher than my normal rate.'}, 'bonus-tax');
event('2025-03-19 11:00', 'inquiry.answered', {inquiry_id: '@bonus-tax', outcome: 'no_change', answered_by: 'Payroll',
  note: 'A bonus has federal tax at a flat 22 percent. The amount is correct.'});
leave('2025-05-05 18:30', 'vacation', '2025-06-30', '2025-07-03', 8, 'Fourth of July week with family in Los Angeles.', 'july25');
decide('2025-05-06 10:15', 'july25', 'approve');
leave('2025-05-12 13:05', 'personal', '2025-05-30', '2025-05-30', 8, 'Car inspection and errands.', 'car');
decide('2025-05-13 09:00', 'car', 'approve');
call('2025-05-27 21:15', 'inquiries.open', data => {
  const net = data.statements.find(s => s.id === 'ps-2025-11').net_pay;
  return {id: 'ps-2025-11', amount: net, note: 'Can you confirm my net pay of ' + net.toFixed(2) + ' in writing? My new landlord asks for proof of income.'};
}, 'net');
call('2025-05-28 07:50', 'inquiries.withdraw', {id: '@net'});
event('2025-06-02 11:00', 'calendar.changed', {entry_id: run(2025, 14), pay_date: MOVED[run(2025, 14)], reason: 'The bank is closed on Independence Day.'});
call('2025-06-27 21:00', 'preferences.update', {timezone: 'America/Los_Angeles'});

// 2025, July to December: a denied week, a cancelled trip, a smaller transfer after a car repair, and the enrollment window for 2026.
call('2025-07-07 08:00', 'preferences.update', {timezone: 'America/New_York'});
leave('2025-07-14 09:20', 'vacation', '2025-08-18', '2025-08-22', 8, 'Beach week.', 'beach25');
decide('2025-07-15 16:40', 'beach25', 'deny', 'The warehouse audit is that week. Please choose another week.');
leave('2025-07-21 12:30', 'personal', '2025-08-08', '2025-08-08', 4, 'School registration.', 'school');
decide('2025-07-22 10:05', 'school', 'approve');
leave('2025-07-28 19:10', 'vacation', '2025-10-13', '2025-10-17', 8, 'Fall trip to the mountains.', 'fall');
decide('2025-07-29 09:45', 'fall', 'approve', 'Enjoy the mountains.');
call('2025-08-04 20:20', 'deposit.update', {id: ACCOUNT, accounts: [{...HARBOR, amount: 150}, {...CHECKING, remainder: true}]});
call('2025-09-08 08:40', 'inquiries.open', {id: 'ps-2025-18', amount: 71.4, note: 'My mileage of 102 miles for the visit to the north warehouse on 20 August is missing. That is 71.40.'}, 'aug-miles');
event('2025-09-10 14:30', 'inquiry.answered', {inquiry_id: '@aug-miles', outcome: 'corrected', correction_amount: 71.4, answered_by: 'Payroll',
  note: 'The mileage will be on the pay statement of 26 September.'});
call('2025-09-29 08:15', 'leave.cancel', {id: '@fall', reason: 'The trip is cancelled.'});
leave('2025-10-06 12:00', 'personal', '2025-10-31', '2025-10-31', 8, 'Moving day.', 'moving25');
decide('2025-10-07 09:10', 'moving25', 'approve');
event('2025-10-27 09:00', 'enrollment.opened', {window_id: 'win-2026', plan_year: 2026, opens_at: at('2025-11-03 00:00'), closes_at: at('2025-11-14 23:59:59'), plan_ids: PLANS});
leave('2025-10-27 13:30', 'vacation', '2025-11-24', '2025-11-26', 8, 'Thanksgiving week.', 'thanks25');
decide('2025-10-28 08:55', 'thanks25', 'approve');
// Kai first keeps the spending account, then drops it with vision and moves to the free dental plan.
call('2025-11-05 20:10', 'benefits.elect', {id: 'win-2026', plan_id: 'fsa', yearly_amount: 1000});
call('2025-11-10 19:30', 'benefits.elect', {id: 'win-2026', plan_id: 'medical', option_id: 'med-ppo-ee'});
call('2025-11-10 19:32', 'benefits.elect', {id: 'win-2026', plan_id: 'dental', option_id: 'den-basic-ee'});
call('2025-11-10 19:34', 'benefits.elect', {id: 'win-2026', plan_id: 'vision', no_coverage: true});
call('2025-11-10 19:35', 'benefits.elect', {id: 'win-2026', plan_id: 'fsa', no_coverage: true});
call('2025-11-10 19:42', 'benefits.submit', {id: 'win-2026'});
call('2025-12-01 19:05', 'deposit.update', {id: ACCOUNT, accounts: [{...HARBOR, amount: 200}, {...CHECKING, remainder: true}]});
call('2025-12-08 20:30', 'withholding.update', {id: ACCOUNT, form: FORM});

// 2026, January to April: the year-end forfeits, 5 percent for retirement, a missing travel reimbursement, extra federal withholding and the first leave.
adjust('2026-01-01 00:05', 'vacation', data => -(balanceOf(data, at('2026-01-01 00:05'), 'vacation') - 80), 'forfeited', 'Hours above the carryover cap of 80.');
adjust('2026-01-01 00:05', 'personal', data => -balanceOf(data, at('2026-01-01 00:05'), 'personal'), 'forfeited', 'Personal time does not carry over.');
call('2026-01-07 19:40', 'retirement.set', {id: ACCOUNT, percent: 5});
call('2026-02-17 09:20', 'inquiries.open', {id: 'ps-2026-04', amount: 186.4, note: 'My travel reimbursement of 186.40 for the warehouse trip on 26 and 27 January is missing.'}, 'trip');
call('2026-02-17 21:10', 'withholding.update', {id: ACCOUNT, form: {...FORM, extra_withholding: 20}});
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

// 2026, May: savings move to a joint account, and the old account closes on 21 May. The change comes after the cut-off of 19 May,
// so the run of 22 May still pays the old account. The bank returns that deposit, and payroll sends it again to checking.
const harbor = data => data.statements.find(s => s.id === 'ps-2026-11').deposits.find(d => d.account.last4 === HARBOR.last4).id;
call('2026-05-04 08:45', 'leave.cancel', {id: '@may', reason: 'The trip moved to July.'});
call('2026-05-20 20:30', 'deposit.update', {id: ACCOUNT, accounts: [{...JOINT, amount: 250}, {...CHECKING, remainder: true}]});
call('2026-05-20 20:41', 'deposit.update', {id: ACCOUNT, accounts: [{...JOINT, amount: 300}, {...CHECKING, remainder: true}]});
call('2026-05-26 08:10', 'inquiries.open', {id: 'ps-2026-11', amount: 200, note: 'The deposit of 200.00 went to my old Harbor savings account. I closed that account on 21 May.'}, 'deposit');
event('2026-05-27 10:00', 'deposit.updated', data => ({deposit_id: harbor(data), state: 'returned', reason: 'The receiving account is closed.'}));
call('2026-05-27 18:30', 'inquiries.withdraw', {id: '@deposit'});
event('2026-05-29 11:00', 'calendar.changed', {entry_id: run(2026, 13), pay_date: MOVED[run(2026, 13)], reason: 'The bank is closed on Juneteenth.'});
event('2026-05-29 15:00', 'deposit.updated', data => ({deposit_id: harbor(data), state: 'reissued', reason: 'Sent again to the checking account on file.',
  reissued_to: {kind: 'account', label: CHECKING.label, last4: CHECKING.last4}}));

// 2026, June to September: summer leave, a denied week, a lapsed request, a cancelled retirement change and the end of the extra withholding.
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
call('2026-09-01 20:00', 'withholding.update', {id: ACCOUNT, form: FORM});
adjust('2026-09-08 10:00', 'vacation', 8, 'grant', 'One extra day for the weekend inventory count on 5 and 6 September.');
// Email notices were off for 18 days, so the notifications of that time have no wire message.
call('2026-09-10 08:00', 'preferences.update', {email_notices: false});
call('2026-09-28 08:00', 'preferences.update', {email_notices: true});
leave('2026-09-28 12:30', 'vacation', '2026-11-23', '2026-11-27', 8, 'Thanksgiving week.', 'thanksgiving');
decide('2026-09-29 09:20', 'thanksgiving', 'approve');

// 2026, October to December: the first pay dates of 2027, the enrollment window for 2027, a new checking account, and the changes for 2027.
// The plan's calendar.changed adds one entry per event, so the four early 2027 pay dates are four events.
['2027-01-01', '2027-01-15', '2027-01-29', '2027-02-12'].forEach((day, i) => {
  const {id, period_start, period_end, pay_date, cutoff_at} = entry('pd-2027-' + pad(i + 1, 2), day);
  event('2026-10-19 09:0' + i, 'calendar.changed', {entry_id: id, period_start, period_end, cutoff_at, ...(i ? {pay_date, reason: 'The pay calendar for early 2027.'}
    : {pay_date: '2027-01-04', reason: 'The pay date moves to Monday, because the bank is closed on New Year\'s Day.'})});
});
event('2026-10-26 09:00', 'enrollment.opened', {window_id: 'win-2027', plan_year: 2027, opens_at: at('2026-11-02 00:00'), closes_at: at('2026-11-13 23:59:59'), plan_ids: PLANS});
call('2026-10-26 09:30', 'inquiries.open', {id: 'ps-2026-22', amount: 412.5, note: 'My travel reimbursement of 412.50 for the client visit on 13 and 14 October is missing.'}, 'client');
leave('2026-10-26 14:00', 'personal', '2026-11-13', '2026-11-13', 8, 'Personal errands.', 'errands');
leave('2026-11-02 12:10', 'vacation', '2026-12-28', '2026-12-31', 8, 'End of year break.', 'yearend');
// Pay moves to a new checking account before the cut-off of 3 November, so the change reaches the pay of 6 November.
call('2026-11-02 19:15', 'deposit.update', {id: ACCOUNT, accounts: [{...JOINT, amount: 300}, {...CREDIT_UNION, remainder: true}]});
call('2026-11-03 20:05', 'benefits.elect', {id: 'win-2027', plan_id: 'dental', option_id: 'den-plus-ee'});
call('2026-11-03 20:07', 'benefits.elect', {id: 'win-2027', plan_id: 'vision', option_id: 'vis-ee'});
call('2026-11-03 20:12', 'benefits.elect', {id: 'win-2027', plan_id: 'fsa', yearly_amount: 1500});
call('2026-11-03 20:15', 'benefits.submit', {id: 'win-2027'});
// After that cut-off: 7 percent, then 6 percent, for the pay of 20 November. The later change replaces the earlier one.
call('2026-11-03 21:30', 'retirement.set', {id: ACCOUNT, percent: 7});
call('2026-11-03 21:34', 'retirement.set', {id: ACCOUNT, percent: 6});
// A new yearly amount is saved but not submitted again, so it is dropped when the window closes.
call('2026-11-04 08:50', 'benefits.elect', {id: 'win-2027', plan_id: 'fsa', yearly_amount: 1800});
decide('2026-11-05 10:00', 'errands', 'approve');
decide('2026-11-09 09:30', 'yearend', 'approve', 'Happy holidays.');
event('2026-11-10 13:45', 'inquiry.answered', {inquiry_id: '@client', outcome: 'corrected', correction_amount: 412.5, answered_by: 'Payroll',
  note: 'The reimbursement will be on the pay statement of 20 November.'});
call('2026-12-07 08:35', 'inquiries.open', {id: 'ps-2026-25', amount: 42.7, note: 'My mileage of 61 miles for the site visit on 19 November is missing. That is 42.70.'}, 'nov-miles');
event('2026-12-09 11:20', 'inquiry.answered', {inquiry_id: '@nov-miles', outcome: 'corrected', correction_amount: 42.7, answered_by: 'Payroll',
  note: 'The mileage will be on the pay statement of 18 December.'});
// At the clock: 8 percent is locked for the first pay of 2027, a new W-4 waits for the second one, and a January trip waits for the manager.
call('2026-12-28 20:15', 'retirement.set', {id: ACCOUNT, percent: 8});
call('2026-12-29 19:30', 'withholding.update', {id: ACCOUNT, form: {...FORM, extra_withholding: 10}});
leave('2026-12-28 18:40', 'vacation', '2027-01-25', '2027-01-26', 8, 'Ski weekend.');

// Sick days, from the PRNG: a weekday off with no other leave, asked for that morning or the next one, and approved within a few hours.
const NOTES = ['Fever.', 'Bad cold.', 'Stomach bug.', 'Migraine.', 'Sore throat.', 'Doctor visit.', 'Back pain.'];
const busy = new Set(leaves.flatMap(([start, end]) => { const days = []; for (let d = start; d <= end; d = time.addDays(d, 1)) days.push(d); return days; }));
function sickDays(year, months) {
  for (const month of months) {
    let start;
    do start = year + '-' + pad(month, 2) + '-' + pad(between(2, 26), 2);
    while (!working(start) || busy.has(start) || busy.has(time.addDays(start, 1)) || busy.has(time.addDays(start, -1)));
    const end = random() < 0.3 && working(time.addDays(start, 1)) ? time.addDays(start, 1) : start, late = random() < 0.25 && working(time.addDays(end, 1));
    for (let d = start; d <= end; d = time.addDays(d, 1)) busy.add(d);
    const asked = (late ? time.addDays(end, 1) : start) + ' 0' + between(6, 8) + ':' + pad(between(0, 59), 2), label = 'sick-' + start;
    call(asked, 'leave.request', {id: 'sick', start, end, hours_per_day: 8, note: pick(NOTES)}, label);
    decide(asked.slice(0, 10) + ' ' + between(10, 15) + ':' + pad(between(0, 59), 2), label, 'approve', random() < 0.5 ? 'Feel better soon.' : undefined);
  }
}
sickDays(2025, [1, 3, 9, 12]);
sickDays(2026, [4, 10, 12]);

const ctx = (role, now) => Object.freeze({app_id: APP, role, virtual_now: now, binding: structuredClone(require('../fixtures/binding.json'))});
const seedValid = compile(require('../schemas/seed.schema.json'), path.join(root, 'schemas'));
// The checks that Core runs on a loaded seed and after every write and event.
function valid(data, now) {
  assert.ok(seedValid(data), 'Seed schema');
  plugin.validateSeed(ctx('infra', now), data);
}
// The election set in force for 2025 was submitted in the window of November 2024, which is before this history starts.
const HISTORY_2025 = {id: 'els-0001', window_id: null, plan_year: 2025, choices: [{plan_id: 'medical', choice: {option_id: 'med-ppo-ee'}},
  {plan_id: 'dental', choice: {option_id: 'den-plus-ee'}}, {plan_id: 'vision', choice: {option_id: 'vis-ee'}}, {plan_id: 'fsa', choice: {yearly_amount: 1000}}],
  submitted_at: '2024-11-12T19:40:00-05:00', request_id: null};
HISTORY_2025.history = [{at: HISTORY_2025.submitted_at, choices: structuredClone(HISTORY_2025.choices), request_id: null}];

// The state at `until`: every step at or before that time, replayed in time order. Each record is in its state at that time.
// Payroll published the two-year pay calendar for 2025 and 2026 before the history starts, so it is in the starting seed.
function build(until = CLOCK) {
  assert.ok(Date.parse(until) >= Date.parse(START) && Date.parse(until) <= Date.parse(CLOCK), 'The time is not inside ' + START + ' to ' + CLOCK + ': ' + until);
  let data = {...structuredClone(base), employer: {...structuredClone(base.employer), holidays: [...HOLIDAYS]}, calendar: structuredClone([...CALENDAR[2025], ...CALENDAR[2026]]), statements: [],
    changes: [], inquiries: [], leave_entries: [], leave_requests: [], windows: [], election_sets: [structuredClone(HISTORY_2025)], notifications: [], activity: []};
  const ids = {}, done = {writes: 0, events: 0};
  const inputs = new Map(require('../tools.json').map(tool => [tool.name, compile(tool.inputSchema, root)]));
  const eventValid = compile(require('../schemas/events.schema.json'), path.join(root, 'schemas'));
  const resolve = value => typeof value === 'string' ? (value.startsWith('@') ? ids[value.slice(1)] || assert.fail('Unknown label ' + value) : value)
    : Array.isArray(value) ? value.map(resolve) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v)])) : value;
  function apply(step, payload) {
    const incoming = {event_id: 'ev-pl-' + pad(1000 + ++done.events), at: step.when, operation: APP + '.' + step.name, payload};
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
  // The sort is stable, and every step runs at its own time. So the clock only moves forward. Adjustments count their IDs in replay order.
  adjustments = 0;
  for (const step of [...steps].sort((a, b) => Date.parse(a.when) - Date.parse(b.when))) {
    if (Date.parse(step.when) > Date.parse(until)) break;
    try {
      (step.event ? apply : write)(step, resolve(typeof step.args === 'function' ? step.args(data) : step.args));
      valid(data, step.when);
    } catch (error) { error.message = step.name + ' at ' + step.when + ': ' + error.message; throw error; }
  }
  data.employment.annual_salary = salaryAt(time.localDay(Date.parse(until), ZONE));
  valid(data, until);
  return data;
}

// The provenance record. The runtime checks it when a bundle is loaded with the seed.
function dataset(data) {
  return {schema_version: 'pale.dataset.v1', dataset_id: 'payleaf-evaluation-2025-2026', version: VERSION,
    description: 'Synthetic evaluation history of one salaried employee at a fictional employer, from 1 January 2025 to 31 December 2026, read at ' + CLOCK + '. ' +
      'Every record is synthetic: the product, the employer, the people, the bank accounts and the plans are fictional, and nothing was collected. ' +
      'A development script replays a scripted history, with sick days and mileage lines from a seeded PRNG, through the App\'s own hooks, so the App computed every deduction, net pay, deposit and leave accrual.',
    record_source_ids: ['evaluation-generator'],
    sources: [{source_id: 'evaluation-generator', kind: 'synthetic',
      description: 'Scripted synthetic history with seeded random variation; no external collection and no real person, employer, bank or carrier. Dates are represented event dates of the fictional history, not collection dates.',
      uri: null, license: 'MIT', usage: 'permitted', collection: null,
      generation: {method: 'scripted replay with a seeded PRNG (mulberry32)', tool: 'apps/payleaf/dev/generate-evaluation-data.cjs', tool_version: VERSION, seed: PRNG_SEED,
        parameters: {start: START, clock: CLOCK, timezone: ZONE}}}],
    transformations: ['None. The seed is the App state after the replay, with the yearly salary in effect at the clock.'],
    expected_counts: {records: records(data).length, assets: 0},
    quality_policy: {duplicate_records: 'reject', duplicate_assets: 'reject', missing_assets: 'allow_declared'},
    review: {status: 'pending', reviewer: null, notes: 'Automated checks do not replace human review of realism and variation.'}};
}
const json = value => JSON.stringify(value, null, 2) + '\n';
const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');
function outputs() {
  const data = build(CLOCK), files = {'seed.json': json(data), 'clock.json': json({initial_time: CLOCK}), 'dataset.json': json(dataset(data))};
  const counts = {steps: steps.length, writes: steps.filter(s => !s.event).length, events: steps.filter(s => s.event).length, records: records(data).length};
  files['manifest.json'] = json({schema: 'payleaf.evaluation-manifest.v1', generator: 'apps/payleaf/dev/generate-evaluation-data.cjs', generator_version: VERSION,
    prng: 'mulberry32', prng_seed: PRNG_SEED, start: START, clock: CLOCK, timezone: ZONE, provenance: 'synthetic', counts,
    files: Object.fromEntries(Object.entries(files).map(([name, text]) => [name, {bytes: Buffer.byteLength(text), sha256: sha256(text)}]))});
  return {data, files};
}
function main() {
  const check = process.argv.includes('--check'), {files} = outputs(), stale = [];
  for (const [name, text] of Object.entries(files)) {
    const target = path.join(OUT, name);
    if (check) { if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text) stale.push(name); } else { fs.mkdirSync(OUT, {recursive: true}); fs.writeFileSync(target, text); }
  }
  if (stale.length) {
    console.error('Generated files are out of date in data/evaluation: ' + stale.join(', '));
    process.exitCode = 1;
    return;
  }
  const manifest = JSON.parse(files['manifest.json']);
  console.log((check ? 'Checked' : 'Wrote') + ' data/evaluation (' + manifest.counts.records + ' records, ' + manifest.counts.steps + ' steps, ' + manifest.files['seed.json'].bytes + ' bytes of seed).');
}
if (require.main === module) main();
module.exports = {build, START, CLOCK, VERSION, PRNG_SEED};
