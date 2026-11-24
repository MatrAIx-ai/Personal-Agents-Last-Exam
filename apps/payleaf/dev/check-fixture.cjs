'use strict';
// Checks that a seed is consistent. The sums and states are worked out here by hand, and compared with the seed and with what the App reads.
// Run `node dev/check-fixture.cjs [seed.json [time]]`. The default is fixtures/minimal.json, read at the time in fixtures/clock.json.
// The package fixture is also checked against the counts that the plan promises. Exits 1 on a failure.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {compile} = require('../tests/schema-validator.cjs');
const seedSchema = compile(require('../schemas/seed.schema.json'), path.resolve(__dirname, '../schemas'));
const FIXTURE = path.resolve(__dirname, '../fixtures/minimal.json');
const SETTINGS = ['deposit', 'withholding', 'retirement'];
const ms = Date.parse, cents = amount => Math.round(amount * 100), tenths = value => Math.round(value * 10);
const total = values => values.reduce((sum, value) => sum + value, 0);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
// Calendar order: cut-off, then pay date, then ID.
const order = (a, b) => ms(a.cutoff_at) - ms(b.cutoff_at) || compare(a.pay_date, b.pay_date) || compare(a.id, b.id);
const runView = entry => entry ? {entry_id: entry.id, pay_date: entry.pay_date, cutoff_at: entry.cutoff_at} : null;

// The plan's counts for the package fixture (section 4, "Synthetic data and assets").
const PLAN = {rules: 5, holidays: 11, calendar: {2026: 26, 2027: 4}, statements: 22, lines: 150, deposits: 44, changes: 9, inquiries: 4, leave_types: 3,
  leave_entries: 70, leave_requests: 12, plans: 4, options: 9, windows: 2, election_sets: 2, notifications: 26};
function counts(data) {
  const calendar = {};
  for (const entry of data.calendar) calendar[entry.pay_date.slice(0, 4)] = (calendar[entry.pay_date.slice(0, 4)] || 0) + 1;
  return {rules: Object.keys(data.employer.rules).length, holidays: data.employer.holidays.length, calendar, statements: data.statements.length,
    lines: total(data.statements.map(s => s.earnings.length + s.taxes.length + s.deductions.length)), deposits: total(data.statements.map(s => s.deposits.length)),
    changes: data.changes.length, inquiries: data.inquiries.length, leave_types: data.leave_types.length, leave_entries: data.leave_entries.length,
    leave_requests: data.leave_requests.length, plans: data.plans.length, options: total(data.plans.map(p => p.options.length)), windows: data.windows.length,
    election_sets: data.election_sets.length, notifications: data.notifications.length, activity: data.activity.length};
}

// Calendar days in the employer's time zone.
function dayOf(instant, zone) {
  const parts = new Intl.DateTimeFormat('en-US', {timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(new Date(instant));
  const part = type => parts.find(p => p.type === type).value;
  return part('year') + '-' + part('month') + '-' + part('day');
}
const addDays = (day, days) => new Date(ms(day + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
// A working day is Monday to Friday and not a company holiday.
function workingDays(data, start, end) {
  const days = [];
  for (let day = start; day <= end; day = addDays(day, 1)) if (new Date(day + 'T00:00:00Z').getUTCDay() % 6 && !data.employer.holidays.includes(day)) days.push(day);
  return days;
}

// 1. Every statement follows from its lines and the settings in force.
const windowOf = (data, year) => data.windows.find(w => w.plan_year === year) || null;
const setOf = (data, year) => {
  const window = windowOf(data, year);
  return data.election_sets.find(s => window ? s.window_id === window.id : s.plan_year === year && s.window_id === null) || null;
};
// The choice in force for a plan. With no choice in the set, a plan that rolls over keeps the choice of the year before, and any other plan has no coverage.
function choiceFor(data, year, plan) {
  const window = windowOf(data, year), set = setOf(data, year);
  const row = set && (!window || window.plan_ids.includes(plan.id)) ? set.choices.find(x => x.plan_id === plan.id) : null;
  if (row) return row.choice;
  const first = Math.min(...data.windows.map(w => w.plan_year), ...data.election_sets.map(s => s.plan_year));
  return plan.rolls_over && year - 1 >= first ? choiceFor(data, year - 1, plan) : {no_coverage: true};
}
// Fixed amounts in order, then each percentage of what is left after them (rounded down), then the remainder. No deposit for zero.
function split(net, accounts) {
  const out = accounts.map(() => 0);
  let left = net;
  accounts.forEach((a, i) => { if (a.amount !== undefined) { out[i] = Math.min(cents(a.amount), left); left -= out[i]; } });
  const base = left;
  accounts.forEach((a, i) => { if (a.percent !== undefined) { out[i] = Math.floor(base * tenths(a.percent) / 1000); left -= out[i]; } });
  accounts.forEach((a, i) => { if (a.remainder) out[i] = left; });
  return accounts.map((a, i) => ({account: {label: a.label, kind: a.kind, last4: a.last4}, amount: out[i]})).filter(x => x.amount > 0);
}
function expectedStatement(data, statement, earlier) {
  const year = statement.pay_date.slice(0, 4), used = statement.settings_used, perYear = data.employer.rules.pay_periods_per_year;
  const afterTaxes = total(statement.earnings.map(l => cents(l.amount))) - total(statement.taxes.map(l => cents(l.amount)));
  const salary = total(statement.earnings.filter(l => l.kind === 'salary').map(l => cents(l.amount))), due = [];
  for (const plan of data.plans) {
    const choice = choiceFor(data, Number(year), plan);
    if (choice.option_id !== undefined) due.push({plan_id: plan.id, option_id: choice.option_id, due: cents(plan.options.find(o => o.id === choice.option_id).per_pay_cost)});
    if (choice.yearly_amount === undefined) continue;
    const yearly = cents(choice.yearly_amount), taken = total(earlier.filter(s => s.pay_date.startsWith(year)).flatMap(s => s.deductions)
      .filter(d => d.plan_id === plan.id).map(d => cents(d.amount)));
    due.push({plan_id: plan.id, option_id: null, due: Math.min(Math.ceil(yearly / perYear), yearly - taken)});
  }
  // The retirement percentage of the salary lines, rounded half up to the cent.
  due.push({plan_id: null, option_id: null, due: Math.floor((tenths(used.retirement.percent) * salary + 500) / 1000)});
  let left = afterTaxes, cut = false;
  const deductions = due.filter(d => d.due > 0).map(d => {
    const amount = cut ? 0 : Math.min(d.due, left);
    cut = cut || amount < d.due;
    left -= amount;
    return {...d, amount};
  });
  const net = afterTaxes - total(deductions.map(d => d.amount));
  return {deductions, net, deposits: split(net, used.deposit.accounts)};
}
function settingsInForce(data, statement, previous) {
  const used = statement.settings_used, applied = data.changes.filter(x => x.stored_state === 'applied' && x.entry_id === statement.entry_id);
  for (const setting of SETTINGS) {
    const change = applied.find(x => x.setting === setting);
    if (change) assert.deepEqual(used[setting], change.value, 'the ' + setting + ' setting is not the value of the change that its run applied');
    else if (previous) assert.deepEqual(used[setting], previous.settings_used[setting], 'the ' + setting + ' setting changed with no applied change');
  }
  assert.deepEqual([...used.change_ids].sort(), applied.map(x => x.id).sort(), 'the statement does not name the changes that its run applied');
  const set = setOf(data, Number(statement.pay_date.slice(0, 4)));
  assert.equal(used.election_set_id, set ? set.id : null, 'the statement does not name the election set in force on its pay date');
}
const posted = data => [...data.statements].sort((a, b) => ms(a.posted_at) - ms(b.posted_at) || compare(a.id, b.id));
function statementsRaw(data, check) {
  const list = posted(data);
  list.forEach((statement, index) => check(statement.id, () => {
    settingsInForce(data, statement, list[index - 1]);
    const expected = expectedStatement(data, statement, list.slice(0, index));
    assert.deepEqual(statement.deductions.map(d => ({plan_id: d.plan_id, option_id: d.option_id, due: cents(d.due), amount: cents(d.amount)})), expected.deductions,
      'the deductions do not follow from the election set, the retirement percentage and the pay left after taxes');
    assert.equal(cents(statement.net_pay), expected.net, 'the net pay does not follow from the lines');
    assert.deepEqual(statement.deposits.map(d => ({account: d.account, amount: cents(d.amount)})), expected.deposits, 'the deposits do not follow from the net pay and the deposit setup');
  }));
  const last = list[list.length - 1];
  if (last) check('settings', () => SETTINGS.forEach(setting => assert.deepEqual(data.settings[setting], last.settings_used[setting], 'the ' + setting + ' setting is not the one that the last run used')));
}
function statementsRead(data, f, now, check) {
  for (const statement of data.statements) check(statement.id, () => {
    const view = f.call('pay_statements.get', {id: statement.id}).statement, fixed = total(statement.settings_used.deposit.accounts.filter(a => a.amount !== undefined).map(a => cents(a.amount)));
    const flags = [...(cents(statement.net_pay) < fixed ? ['short_deposit'] : []), ...(statement.deductions.some(d => cents(d.amount) < cents(d.due)) ? ['deductions_cut'] : [])];
    const sums = lines => total(lines.map(l => cents(l.amount))) / 100;
    assert.deepEqual({earnings: view.earnings_total, taxes: view.taxes_total, deductions: view.deductions_total, net: view.net_pay, flags: view.flags},
      {earnings: sums(statement.earnings), taxes: sums(statement.taxes), deductions: sums(statement.deductions), net: statement.net_pay, flags}, 'the totals or the flags that the App reads do not match the lines');
  });
}

// 2. Every setting change points at the right pay run: the first cut-off after the moment of the change.
function changesRaw(data, check) {
  const entries = [...data.calendar].sort(order), groups = new Map();
  const first = change => entries.find(e => ms(e.cutoff_at) > ms(change.made_at)) || null;
  data.changes.forEach((change, index) => check(change.id, () => {
    const run = first(change), stored = change.stored_state;
    if (stored === 'applied' || stored === 'replaced') {
      assert.equal(change.entry_id, run && run.id, 'the change is stored for ' + change.entry_id + ', and the first cut-off after it is the one of ' + (run && run.id));
      const key = change.entry_id + '|' + change.setting;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({change, index});
    }
    if (stored === 'applied') {
      const statement = data.statements.find(s => s.entry_id === change.entry_id);
      assert.ok(statement && statement.settings_used.change_ids.includes(change.id), 'the statement of ' + change.entry_id + ' does not name the change');
      assert.deepEqual(statement.settings_used[change.setting], change.value, 'the statement of ' + change.entry_id + ' did not use the value of the change');
    }
    if (stored === 'cancelled') assert.ok(ms(change.cancelled_at) >= ms(change.made_at) && (!run || ms(change.cancelled_at) < ms(run.cutoff_at)), 'the change was cancelled before it was made or after the cut-off of its run');
  }));
  // A run applies the latest change of a setting, and the earlier ones of the same run are replaced.
  for (const [key, rows] of groups) check(key, () => {
    const latest = rows.reduce((a, b) => ms(b.change.made_at) >= ms(a.change.made_at) ? b : a);
    assert.ok(latest.change.stored_state === 'applied' && rows.filter(r => r.change.stored_state === 'applied').length === 1, 'the run did not apply only the latest change of the setting');
  });
}
function changesRead(data, f, now, check) {
  const shown = new Map(f.call('changes.list').items.map(x => [x.id, x])), expected = new Map(), groups = new Map();
  const planned = data.calendar.filter(e => e.state === 'planned').sort(order);
  data.changes.forEach((change, index) => {
    if (change.stored_state) {
      expected.set(change.id, {state: change.stored_state, applies_to: change.stored_state === 'cancelled' ? null : runView(data.calendar.find(e => e.id === change.entry_id))});
      return;
    }
    const target = planned.find(e => ms(e.cutoff_at) > ms(change.made_at)) || null, key = change.setting + '|' + (target ? target.id : '');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({change, index, target});
  });
  // Among the changes of one setting for one run, the latest one reads locked from the cut-off and waiting before it. The earlier ones read replaced.
  for (const rows of groups.values()) {
    rows.sort((a, b) => ms(a.change.made_at) - ms(b.change.made_at) || a.index - b.index);
    rows.forEach(({change, target}, i) => expected.set(change.id, {applies_to: runView(target),
      state: i < rows.length - 1 ? 'replaced' : target && now >= ms(target.cutoff_at) ? 'locked' : 'waiting'}));
  }
  for (const change of data.changes) check(change.id, () => {
    const {state, applies_to} = shown.get(change.id);
    assert.deepEqual({state, applies_to}, expected.get(change.id), 'the state or the pay run that the App reads is not the one that follows from the calendar and the clock');
  });
}

// 3. Every leave balance matches its entries and requests.
function leaveState(data, request, today) {
  const type = data.leave_types.find(t => t.id === request.leave_type_id);
  if (request.stored_state === 'approved' && today > request.end) return 'taken';
  if (request.stored_state === 'pending' && type.needs_notice && today >= request.start) return 'lapsed';
  return request.stored_state;
}
function expectedBalance(data, type, today) {
  const rows = data.leave_requests.filter(r => r.leave_type_id === type.id).map(r => ({r, state: leaveState(data, r, today)}));
  const hoursIn = state => total(rows.filter(x => x.state === state).map(x => tenths(x.r.hours)));
  const balance = total(data.leave_entries.filter(e => e.leave_type_id === type.id).map(e => tenths(e.hours))) - hoursIn('taken');
  const pending = hoursIn('pending'), approved = hoursIn('approved');
  let expiring = 0, next = null;
  if (type.carryover_cap !== null) {
    next = today.slice(0, 4) + '-' + type.carryover_date;
    if (next < today) next = String(Number(today.slice(0, 4)) + 1) + '-' + type.carryover_date;
    // What is above the cap on the carryover date, after the hours that pending and approved requests hold for days up to that date.
    const held = total(rows.filter(x => x.state === 'pending' || x.state === 'approved').map(x => x.r.days.filter(d => d <= next).length * tenths(x.r.hours_per_day)));
    expiring = Math.max(0, balance - held - tenths(type.carryover_cap));
  }
  return {balance: balance / 10, pending_hours: pending / 10, approved_hours: approved / 10, available: (balance - pending - approved) / 10,
    expiring: expiring / 10, next_carryover_date: next};
}
function leaveRaw(data, check) {
  for (const request of data.leave_requests) check(request.id, () => {
    const days = workingDays(data, request.start, request.end);
    assert.deepEqual(request.days, days, 'the days of the request are not the working days of its range');
    assert.equal(tenths(request.hours), days.length * tenths(request.hours_per_day), 'the hours of the request do not follow from its days');
  });
  // Each posted run adds one entry for each leave type that earns hours.
  for (const statement of data.statements) check(statement.id, () => {
    for (const type of data.leave_types.filter(t => t.accrual_per_period > 0)) {
      const rows = data.leave_entries.filter(e => e.statement_id === statement.id && e.leave_type_id === type.id);
      assert.ok(rows.length === 1 && rows[0].reason === 'accrual' && rows[0].hours === type.accrual_per_period && ms(rows[0].at) === ms(statement.posted_at),
        'the run did not add one accrual of ' + type.accrual_per_period + ' hours of ' + type.id);
    }
  });
}
function leaveRead(data, f, now, check) {
  const today = dayOf(now, data.employer.timezone), shown = new Map(f.call('leave.list').items.map(r => [r.id, r.state]));
  for (const request of data.leave_requests) check(request.id, () => assert.equal(shown.get(request.id), leaveState(data, request, today), 'the state that the App reads does not fit the clock'));
  const balances = f.call('leave.balances').items;
  for (const type of data.leave_types) check(type.id, () => {
    const {balance, pending_hours, approved_hours, available, expiring, next_carryover_date} = balances.find(row => row.leave_type_id === type.id);
    assert.deepEqual({balance, pending_hours, approved_hours, available, expiring, next_carryover_date}, expectedBalance(data, type, today),
      'the balance that the App reads does not match the entries and the requests');
  });
}

// 4. Every election set fits its window.
function fits(data, row) {
  const plan = data.plans.find(p => p.id === row.plan_id), choice = row.choice;
  assert.ok(plan, 'a choice names an unknown plan');
  if (choice.option_id !== undefined) assert.ok(plan.kind === 'options' && plan.options.some(o => o.id === choice.option_id), 'an option is not one of its plan');
  if (choice.yearly_amount !== undefined) assert.ok(plan.kind === 'yearly_amount' && (plan.yearly_max === null || cents(choice.yearly_amount) <= cents(plan.yearly_max)), 'a yearly amount does not fit its plan');
}
const inside = (window, value) => ms(value) >= ms(window.opens_at) && ms(value) < ms(window.closes_at);
function electionsRaw(data, check) {
  for (const set of data.election_sets) check(set.id, () => {
    const window = data.windows.find(w => w.id === set.window_id) || null, plans = set.choices.map(x => x.plan_id);
    assert.equal(new Set(plans).size, plans.length, 'the set names a plan twice');
    set.choices.forEach(row => fits(data, row));
    assert.equal(data.election_sets.filter(s => s.plan_year === set.plan_year).length, 1, 'the plan year has two election sets');
    if (set.window_id === null) return assert.ok(!windowOf(data, set.plan_year), 'a set with no window is for a plan year that has a window');
    assert.ok(window && window.plan_year === set.plan_year && window.set_id === set.id, 'the set and its window do not point at each other');
    assert.deepEqual([...plans].sort(), [...window.plan_ids].sort(), 'the set does not have one choice for each plan of its window');
    assert.ok(inside(window, set.submitted_at) && set.history.every(row => inside(window, row.at)), 'the set was submitted while its window was not open');
    const last = set.history[set.history.length - 1];
    assert.ok(last && last.at === set.submitted_at && last.request_id === set.request_id, 'the last history row of the set is not its submission');
    assert.deepEqual(last.choices, set.choices, 'the last history row of the set does not hold its choices');
  });
  for (const window of data.windows) check(window.id, () => {
    assert.ok(ms(window.opens_at) < ms(window.closes_at) && dayOf(ms(window.closes_at), data.employer.timezone) < window.plan_year + '-01-01', 'the window does not close before its plan year starts');
    for (const save of window.saved) {
      assert.ok(window.plan_ids.includes(save.plan_id) && inside(window, save.saved_at), 'a choice was saved for a plan outside the window, or while the window was not open');
      fits(data, save);
    }
  });
}
function electionsRead(data, f, now, check) {
  for (const window of data.windows) check(window.id, () => {
    const view = f.call('benefits.get', {id: window.id}).window, set = data.election_sets.find(s => s.window_id === window.id);
    const state = now < ms(window.opens_at) ? 'upcoming' : now < ms(window.closes_at) ? 'open' : 'closed';
    const expected = set ? {id: set.id, state: state === 'closed' ? 'final' : 'submitted'} : state === 'closed' ? {id: null, state: 'defaulted'} : null;
    assert.deepEqual({state: view.state, set: view.set && {id: view.set.id, state: view.set.state}}, {state, set: expected}, 'the state that the App reads does not fit the clock');
  });
}

// 5. The package fixture has the counts of the plan, every state of a setting change at the clock, and a size under 1 MB.
function planRead(data, f, now, check, file) {
  check('counts', () => {
    const made = counts(data);
    for (const [name, value] of Object.entries(PLAN)) assert.deepEqual(made[name], value, 'the count of ' + name.replace('_', ' ') + ' is ' + JSON.stringify(made[name]) + ', not ' + JSON.stringify(value));
  });
  check('change states', () => assert.deepEqual([...new Set(f.call('changes.list').items.map(x => x.state))].sort(), ['applied', 'cancelled', 'locked', 'replaced', 'waiting'],
    'the changes do not cover every state at the clock'));
  check('size', () => assert.ok(fs.statSync(file).size < 1048576, 'the fixture is 1 MB or larger'));
}

// `raw` reads the seed as it is, so it can report a seed that the App refuses. `read` compares with what the App reads through its tools.
const CHECKS = [{title: 'Every statement follows from its lines and the settings in force', raw: statementsRaw, read: statementsRead},
  {title: 'Every setting change points at the right pay run', raw: changesRaw, read: changesRead},
  {title: 'Every leave balance matches its entries and requests', raw: leaveRaw, read: leaveRead},
  {title: 'Every election set fits its window', raw: electionsRaw, read: electionsRead},
  {title: 'The fixture has the counts of the plan', read: planRead, fixtureOnly: true}];
function main(file, clock) {
  const data = require(path.resolve(file)), now = ms(clock), checks = CHECKS.filter(c => !c.fixtureOnly || path.resolve(file) === FIXTURE), errors = checks.map(() => []);
  const checker = index => (label, check) => { try { check(); } catch (error) { errors[index].push(label + ': ' + error.message); } };
  console.log('Seed: ' + file + ', read at ' + clock);
  if (!seedSchema(data)) {
    console.log('FAIL  The seed does not match schemas/seed.schema.json. No check was run.');
    process.exitCode = 1;
    return;
  }
  const shown = value => typeof value === 'object' ? Object.entries(value).map(([year, n]) => n + ' in ' + year).join(' and ') : value;
  console.log('Counts: ' + Object.entries(counts(data)).map(([name, value]) => name.replace('_', ' ') + ' ' + shown(value)).join(', '));
  checks.forEach(({raw}, index) => { if (raw) raw(data, checker(index)); });
  let f = null;
  try { f = require('../tests/harness.cjs').fixture({seed: data, now: clock}); } catch (error) { errors.forEach(list => list.push('The App refuses the seed: ' + error.message)); }
  if (f) checks.forEach(({read}, index) => { if (read) read(data, f, now, checker(index), file); });
  errors.forEach((list, index) => console.log((list.length ? 'FAIL  ' : 'ok    ') + checks[index].title + list.map(error => '\n      ' + error).join('')));
  const failed = errors.filter(list => list.length).length;
  console.log((checks.length - failed) + ' of ' + checks.length + ' checks passed.');
  process.exitCode = failed ? 1 : 0;
}
if (require.main === module) main(process.argv[2] || path.relative(process.cwd(), FIXTURE), process.argv[3] || require('../fixtures/clock.json').initial_time);
module.exports = {counts, PLAN};
