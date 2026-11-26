'use strict';
const c = require('./common.cjs');
const {ms, cents, money, tenths, fromTenths, sum, time, copy} = c;
// Everything here is computed from stored records and the supplied clock when it is read. Nothing is stored.
const SETTINGS = ['deposit', 'withholding', 'retirement'];
const NONE = {no_coverage: true};

// Setting changes. Stored `cancelled`, `applied` and `replaced` win. Among the other changes of one setting for one run,
// the latest reads `locked` once the clock reaches the cut-off of the run and `waiting` before it, and the earlier ones read `replaced`.
function changeStates(data, now) {
  const out = new Map(), groups = new Map();
  data.changes.forEach((change, index) => {
    if (change.stored_state) {
      const entry = change.stored_state === 'cancelled' ? null : data.calendar.find(e => e.id === change.entry_id) || null;
      out.set(change.id, {state: change.stored_state, target: entry});
      return;
    }
    const target = c.targetOf(data, ms(change.made_at)), key = change.setting + '|' + (target ? target.id : '');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({change, index, target});
  });
  for (const rows of groups.values()) {
    rows.sort((a, b) => ms(a.change.made_at) - ms(b.change.made_at) || a.index - b.index);
    rows.forEach((row, i) => out.set(row.change.id, {target: row.target,
      state: i < rows.length - 1 ? 'replaced' : row.target && now >= ms(row.target.cutoff_at) ? 'locked' : 'waiting'}));
  }
  return out;
}
function changeView(change, states) {
  const {state, target} = states.get(change.id);
  return {id: change.id, setting: change.setting, value: copy(change.value), made_at: change.made_at, request_id: change.request_id, state,
    applies_to: state === 'cancelled' ? null : c.targetView(target), cancelled_at: change.cancelled_at, history: copy(change.history)};
}
function settingsView(data, now) {
  const states = changeStates(data, now), settings = {};
  for (const setting of SETTINGS) {
    const rows = data.changes.filter(change => change.setting === setting);
    const waiting = rows.find(change => states.get(change.id).state === 'waiting');
    const locked = rows.filter(change => states.get(change.id).state === 'locked')
      .sort((a, b) => c.calendarOrder(states.get(a.id).target, states.get(b.id).target))[0];
    settings[setting] = {in_use: copy(data.settings[setting]), waiting: waiting ? changeView(waiting, states) : null, locked: locked ? changeView(locked, states) : null};
  }
  return {settings, next_change_applies_to: c.targetView(c.targetOf(data, now))};
}

// Leave. Approved leave reads `taken` once the clock passes its last day. A pending request that needs notice reads `lapsed` from its first day.
function leaveState(data, request, now) {
  const type = data.leave_types.find(t => t.id === request.leave_type_id), zone = c.zone(data);
  if (request.stored_state === 'approved' && now >= time.startOfDay(time.addDays(request.end, 1), zone)) return 'taken';
  if (request.stored_state === 'pending' && type.needs_notice && now >= time.startOfDay(request.start, zone)) return 'lapsed';
  return request.stored_state;
}
const holds = state => state === 'pending' || state === 'approved' || state === 'taken';
// The next carryover date on or after the day, from a recurring MM-DD.
function nextCarryover(day, monthDay) {
  const year = Number(day.slice(0, 4)), date = String(year).padStart(4, '0') + '-' + monthDay;
  return date >= day ? date : String(year + 1).padStart(4, '0') + '-' + monthDay;
}
// Hours of one leave type, in tenths.
function balance(data, type, now) {
  const rows = data.leave_requests.filter(r => r.leave_type_id === type.id).map(r => ({r, state: leaveState(data, r, now)}));
  const hoursIn = state => sum(rows.filter(x => x.state === state).map(x => tenths(x.r.hours)));
  const total = sum(data.leave_entries.filter(e => e.leave_type_id === type.id).map(e => tenths(e.hours))) - hoursIn('taken');
  const pending = hoursIn('pending'), approved = hoursIn('approved');
  let expiring = 0, next = null;
  if (type.carryover_cap !== null) {
    next = nextCarryover(c.today(data, now), type.carryover_date);
    const held = sum(rows.filter(x => x.state === 'pending' || x.state === 'approved').map(x => x.r.days.filter(d => d <= next).length * tenths(x.r.hours_per_day)));
    expiring = Math.max(0, total - held - tenths(type.carryover_cap));
  }
  return {balance: total, pending, approved, available: total - pending - approved, expiring, next};
}
function balanceRow(data, type, now) {
  const b = balance(data, type, now);
  return {leave_type_id: type.id, name: type.name, needs_notice: type.needs_notice, accrual_per_period: type.accrual_per_period,
    carryover_cap: type.carryover_cap, carryover_date: type.carryover_date, balance: fromTenths(b.balance), pending_hours: fromTenths(b.pending),
    approved_hours: fromTenths(b.approved), available: fromTenths(b.available), expiring: fromTenths(b.expiring), next_carryover_date: b.next,
    entries: data.leave_entries.filter(e => e.leave_type_id === type.id).sort((x, y) => ms(x.at) - ms(y.at)).map(copy)};
}
function requestView(data, request, now) {
  const state = leaveState(data, request, now), type = data.leave_types.find(t => t.id === request.leave_type_id);
  const notice = time.addDays(c.today(data, now), data.employer.rules.leave_notice_days);
  const {stored_state, ...rest} = copy(request);
  return {...rest, state, flags: type.needs_notice && state === 'pending' && request.start < notice ? ['lapsing'] : []};
}

// Benefits. A plan year is a calendar year.
function windowState(window, now) {
  return now < ms(window.opens_at) ? 'upcoming' : now < ms(window.closes_at) ? 'open' : 'closed';
}
const windowOf = (data, year) => data.windows.find(w => w.plan_year === year) || null;
const setOf = (data, window) => data.election_sets.find(s => s.window_id === window.id) || null;
const historySet = (data, year) => data.election_sets.find(s => s.plan_year === year && s.window_id === null) || null;
const firstYear = data => Math.min(...data.windows.map(w => w.plan_year), ...data.election_sets.map(s => s.plan_year));
// The choice in force for one plan in one plan year, or null while the window of that year is not closed.
function choiceInForce(data, year, plan, now, depth = 0) {
  const window = windowOf(data, year);
  if (window && windowState(window, now) !== 'closed') return null;
  const set = window ? setOf(data, window) : historySet(data, year);
  const chosen = set && (!window || window.plan_ids.includes(plan.id)) ? set.choices.find(x => x.plan_id === plan.id) : null;
  if (chosen) return copy(chosen.choice);
  // The default: the choice of the year before for a plan that rolls over, and no coverage for any other plan.
  if (!plan.rolls_over || year - 1 < firstYear(data) || depth > 60) return {...NONE};
  return choiceInForce(data, year - 1, plan, now, depth + 1) || {...NONE};
}
// The election set in force for a plan year, with a choice for every plan. Null while the window of that year is not closed.
function inForce(data, year, now) {
  const window = windowOf(data, year);
  if (window && windowState(window, now) !== 'closed') return null;
  const set = window ? setOf(data, window) : historySet(data, year);
  return {set_id: set ? set.id : null, state: set ? 'final' : 'defaulted',
    choices: data.plans.map(plan => ({plan_id: plan.id, choice: choiceInForce(data, year, plan, now)}))};
}
// What the person has saved for a plan in a window: the latest explicit save, else the choice that rolls over before any
// submission, else the submitted choice.
function savedChoice(data, window, plan, now) {
  const saves = window.saved.filter(s => s.plan_id === plan.id), set = setOf(data, window);
  if (saves.length) return copy(saves[saves.length - 1].choice);
  if (!set) return plan.rolls_over ? choiceInForce(data, window.plan_year - 1, plan, now) || {...NONE} : null;
  const chosen = set.choices.find(x => x.plan_id === plan.id);
  return chosen ? copy(chosen.choice) : null;
}
function setView(data, window, now) {
  const set = setOf(data, window), state = windowState(window, now);
  if (set) return {id: set.id, state: state === 'closed' ? 'final' : 'submitted', submitted_at: set.submitted_at, request_id: set.request_id,
    choices: copy(set.choices), history: copy(set.history)};
  if (state !== 'closed') return null;
  return {id: null, state: 'defaulted', submitted_at: null, request_id: null, history: [],
    choices: window.plan_ids.map(id => ({plan_id: id, choice: choiceInForce(data, window.plan_year, c.planOf(data, id), now)}))};
}
function windowRow(data, window, now) {
  const set = setView(data, window, now);
  return {id: window.id, plan_year: window.plan_year, state: windowState(window, now), opens_at: window.opens_at, closes_at: window.closes_at,
    plan_ids: [...window.plan_ids], set_id: set ? set.id : null, set_state: set ? set.state : null};
}
function windowView(data, window, now) {
  return {id: window.id, plan_year: window.plan_year, state: windowState(window, now), opens_at: window.opens_at, closes_at: window.closes_at,
    event_id: window.event_id, plans: window.plan_ids.map(id => {
      const plan = c.planOf(data, id);
      return {...copy(plan), in_force: choiceInForce(data, window.plan_year - 1, plan, now) || {...NONE}, saved: savedChoice(data, window, plan, now)};
    }), saves: copy(window.saved), set: setView(data, window, now)};
}

// Pay statements.
const total = lines => sum(lines.map(line => cents(line.amount)));
function statementFlags(statement) {
  const fixed = sum(statement.settings_used.deposit.accounts.filter(a => a.amount !== undefined).map(a => cents(a.amount))), flags = [];
  if (cents(statement.net_pay) < fixed) flags.push('short_deposit');
  if (statement.deductions.some(d => cents(d.amount) < cents(d.due))) flags.push('deductions_cut');
  return flags;
}
function statementRow(data, statement) {
  return {id: statement.id, entry_id: statement.entry_id, pay_date: statement.pay_date, period_start: statement.period_start, period_end: statement.period_end,
    posted_at: statement.posted_at, earnings_total: money(total(statement.earnings)), taxes_total: money(total(statement.taxes)),
    deductions_total: money(total(statement.deductions)), net_pay: statement.net_pay, flags: statementFlags(statement)};
}
function statementView(data, statement) {
  return {...copy(statement), ...statementRow(data, statement), last_inquiry_day: time.addDays(statement.pay_date, data.employer.rules.inquiry_window_days)};
}
const entryView = (entry, now) => ({...copy(entry), cutoff_passed: now >= ms(entry.cutoff_at)});

// Account flags. They are computed when read and never stored.
function accountFlags(data, now) {
  const flags = [], states = changeStates(data, now);
  if ([...states.values()].some(s => s.state === 'waiting')) flags.push('change_waiting');
  if (c.depositsOf(data).some(row => row.deposit.state === 'returned')) flags.push('deposit_returned');
  if (data.leave_types.some(type => balance(data, type, now).expiring > 0)) flags.push('leave_expiring');
  const open = data.windows.filter(w => windowState(w, now) === 'open' && !setOf(data, w));
  if (open.length) flags.push('enrollment_open');
  const loses = w => w.plan_ids.some(id => {
    const plan = c.planOf(data, id), choice = !plan.rolls_over && choiceInForce(data, w.plan_year - 1, plan, now);
    return !!choice && !choice.no_coverage;
  });
  if (open.some(loses)) flags.push('will_default');
  return flags;
}
module.exports = {SETTINGS, NONE, changeStates, changeView, settingsView, leaveState, holds, balance, balanceRow, requestView, windowState, windowOf,
  setOf, historySet, choiceInForce, inForce, savedChoice, setView, windowRow, windowView, statementFlags, statementRow, statementView, entryView, accountFlags};
