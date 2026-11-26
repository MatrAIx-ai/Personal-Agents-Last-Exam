'use strict';
const c = require('./common.cjs');
const views = require('./views.cjs');
const payrun = require('./payrun.cjs');
const {ms, cents, tenths, fromTenths, time, fail, copy, hoursText} = c;
const A = c.APP + '.';

const decimals = (...values) => { if (values.some(v => v !== undefined && !c.twoDecimals(v))) fail('invalid_arguments', 'An amount has at most two decimals.'); };
const tenthsOnly = (...values) => { if (values.some(v => v !== undefined && !c.oneDecimal(v))) fail('invalid_arguments', 'Hours and percentages have at most one decimal.'); };
// `start` and `end` of a list are calendar days, both included.
function window(args) {
  if (args.start !== undefined && args.end !== undefined && args.end < args.start) fail('invalid_window', 'The window ends before it starts.');
  return day => (args.start === undefined || day >= args.start) && (args.end === undefined || day <= args.end);
}
const dayOf = (data, value) => time.localDay(ms(value), c.zone(data));
const byTime = key => (a, b) => ms(a[key]) - ms(b[key]) || c.compare(a.id, b.id);
const account = (data, id) => { if (id !== data.account_id) fail('not_found', 'No account has this ID. Use the account ID of this Payleaf account.'); };
const changeOf = (data, id) => c.find(data.changes, id, 'setting change');
const inquiryOf = (data, id) => c.find(data.inquiries, id, 'pay inquiry');
const requestOf = (data, id) => c.find(data.leave_requests, id, 'leave request');
const windowOf = (data, id) => c.find(data.windows, id, 'enrollment window');

// One check for `leave.preview` and `leave.request`. It lists every rule that a request would break, in the order of the error table.
function leaveCheck(data, args, now) {
  const type = c.leaveTypeOf(data, args.id), rules = data.employer.rules, today = c.today(data, now), failures = [];
  const add = (code, message) => failures.push({code, message});
  const span = time.dayNumber(args.end) - time.dayNumber(args.start) + 1;
  const days = span >= 1 && span <= 366 ? c.workingDays(data, args.start, args.end) : [];
  if (span < 1) add('invalid_window', 'The last day is before the first day.');
  if (span > 30) add('invalid_window', 'A request covers at most 30 calendar days.');
  if (span >= 1 && span <= 366 && !days.length) add('invalid_window', 'The range has no working day.');
  const earliest = time.addDays(today, -rules.sick_backdate_days), notice = time.addDays(today, rules.leave_notice_days);
  if (!type.needs_notice && args.start < earliest) add('invalid_window', type.name + ' can start at most ' + rules.sick_backdate_days + ' days ago, on ' + earliest + ' or later.');
  if (type.needs_notice && args.start < notice) add('too_late', type.name + ' needs ' + rules.leave_notice_days + ' days of notice. The first day must be ' + notice + ' or later.');
  const held = new Set(data.leave_requests.filter(r => views.holds(views.leaveState(data, r, now))).flatMap(r => r.days));
  if (days.some(day => held.has(day))) add('conflict', 'A day of this request is in another pending, approved or taken request.');
  const hours = days.length * tenths(args.hours_per_day), available = views.balance(data, type, now).available;
  if (hours > available) add('insufficient_balance', 'The request needs ' + hoursText(hours) + ' hours, and ' + hoursText(available) + ' hours of ' + type.name + ' are available.');
  return {type, days, hours, available, failures};
}
// A setting write is a setting change. It applies to the planned run with the earliest cut-off after the moment of the change.
function settingChange(t, data, setting, value, action) {
  const change = {id: c.nextId(c.allIds(data), 'chg-'), setting, value: copy(value), made_at: t.at, request_id: t.ref, stored_state: null, entry_id: null,
    cancelled_at: null, history: []};
  data.changes.push(change);
  c.record(t, data, action, change.id, false, change.history);
  const state = views.changeStates(data, t.now).get(change.id);
  return {id: change.id, state: state.state, applies_to: c.targetView(state.target)};
}

const reads = {
  'employment.get': (data, args, now) => ({account_id: data.account_id, employment: copy(data.employment),
    employer: {name: data.employer.name, timezone: data.employer.timezone, rules: copy(data.employer.rules), holidays: [...data.employer.holidays].sort()},
    flags: views.accountFlags(data, now)}),
  'calendar.list'(data, args, now) {
    const inside = window(args);
    return {items: data.calendar.filter(e => inside(e.pay_date)).sort((a, b) => c.compare(a.pay_date, b.pay_date) || c.compare(a.id, b.id)).map(e => views.entryView(e, now))};
  },
  'pay_statements.list'(data, args) {
    const inside = window(args);
    return {items: data.statements.filter(s => inside(s.pay_date)).sort((a, b) => c.compare(a.pay_date, b.pay_date) || c.compare(a.id, b.id)).map(s => views.statementRow(data, s))};
  },
  'pay_statements.get': (data, args) => ({statement: views.statementView(data, c.statementOf(data, args.id))}),
  'settings.get': (data, args, now) => views.settingsView(data, now),
  'changes.list'(data, args, now) {
    const inside = window(args), states = views.changeStates(data, now);
    return {items: data.changes.filter(x => (args.setting === undefined || x.setting === args.setting) && (args.state === undefined || states.get(x.id).state === args.state) &&
      inside(dayOf(data, x.made_at))).sort(byTime('made_at')).map(x => views.changeView(x, states))};
  },
  'inquiries.list'(data, args) {
    if (args.id !== undefined) c.statementOf(data, args.id);
    return {items: data.inquiries.filter(q => (args.id === undefined || q.statement_id === args.id) && (args.state === undefined || q.state === args.state))
      .sort(byTime('opened_at')).map(copy)};
  },
  'leave.balances': (data, args, now) => ({items: data.leave_types.map(type => views.balanceRow(data, type, now))}),
  'leave.list'(data, args, now) {
    if (args.id !== undefined) c.leaveTypeOf(data, args.id);
    window(args);
    // A request is in the window when its range overlaps it.
    return {items: data.leave_requests.filter(r => (args.id === undefined || r.leave_type_id === args.id) && (args.state === undefined || views.leaveState(data, r, now) === args.state) &&
      (args.start === undefined || r.end >= args.start) && (args.end === undefined || r.start <= args.end))
      .sort((a, b) => c.compare(a.start, b.start) || c.compare(a.id, b.id)).map(r => views.requestView(data, r, now))};
  },
  'leave.preview'(data, args, now) {
    tenthsOnly(args.hours_per_day);
    const {type, days, hours, available, failures} = leaveCheck(data, args, now);
    return {leave_type_id: type.id, start: args.start, end: args.end, hours_per_day: args.hours_per_day, days, working_days: days.length, hours: fromTenths(hours),
      available_before: fromTenths(available), available_after: fromTenths(available - hours), allowed: !failures.length, failures};
  },
  'benefits.windows': (data, args, now) => ({items: [...data.windows].sort((a, b) => a.plan_year - b.plan_year).map(w => views.windowRow(data, w, now))}),
  'benefits.get': (data, args, now) => ({window: views.windowView(data, windowOf(data, args.id), now)}),
  'notifications.list'(data, args) {
    const inside = window(args);
    return {items: data.notifications.filter(n => inside(dayOf(data, n.at))).sort(byTime('at')).map(n => ({id: n.id, at: n.at, kind: n.kind, event_id: n.event_id,
      object_type: n.object_type, object_id: n.object_id, title: n.title, text: n.text, email_stored: n.email !== null}))};
  },
  'preferences.get': data => ({preferences: copy(data.preferences)})
};

const writes = {
  'deposit.update'(t, data, args) {
    decimals(...args.accounts.map(a => a.amount));
    tenthsOnly(...args.accounts.map(a => a.percent));
    account(data, args.id);
    const problem = payrun.splitProblem(args.accounts);
    if (problem) fail('invalid_split', problem);
    return settingChange(t, data, 'deposit', {accounts: args.accounts}, 'deposit.update');
  },
  'withholding.update'(t, data, args) {
    const f = args.form;
    decimals(f.dependents_amount, f.other_income, f.deductions, f.extra_withholding);
    account(data, args.id);
    return settingChange(t, data, 'withholding', f, 'withholding.update');
  },
  'retirement.set'(t, data, args) {
    tenthsOnly(args.percent);
    account(data, args.id);
    const max = data.employer.rules.max_retirement_percent;
    if (tenths(args.percent) > tenths(max)) fail('over_limit', 'The retirement percentage is above the plan maximum of ' + max + ' percent.');
    return settingChange(t, data, 'retirement', {percent: args.percent}, 'retirement.set');
  },
  'changes.cancel'(t, data, args) {
    const change = changeOf(data, args.id), {state} = views.changeStates(data, t.now).get(change.id);
    if (state === 'replaced' || state === 'cancelled' || state === 'applied') fail('invalid_state', 'The change is ' + state + '. Only a waiting change can be cancelled.');
    if (state === 'locked') fail('too_late', 'The cut-off of the run that this change applies to has passed. The change is locked.');
    Object.assign(change, {stored_state: 'cancelled', cancelled_at: t.at});
    c.record(t, data, 'changes.cancel', change.id, false, change.history);
    return {id: change.id};
  },
  'inquiries.open'(t, data, args) {
    decimals(args.amount);
    const statement = c.statementOf(data, args.id), line = args.line_id ?? null;
    if (line !== null && !c.linesOf(statement).some(l => l.line_id === line)) fail('not_found', 'The pay statement has no line with this ID.');
    const rules = data.employer.rules;
    if (t.now >= time.limitEnd(statement.pay_date, rules.inquiry_window_days, c.zone(data))) fail('too_late', 'Questions about a pay statement are possible until ' + rules.inquiry_window_days +
      ' days after its pay date. The last day was ' + time.addDays(statement.pay_date, rules.inquiry_window_days) + '.');
    if (data.inquiries.some(q => q.state === 'open' && q.statement_id === statement.id && q.line_id === line)) fail('already_open', line === null
      ? 'The whole statement already has an open inquiry.' : 'This statement line already has an open inquiry.');
    const inquiry = {id: c.nextId(c.allIds(data), 'inq-'), statement_id: statement.id, line_id: line, amount: args.amount, note: args.note, opened_at: t.at,
      request_id: t.ref, state: 'open', withdrawn_at: null, answer: null};
    data.inquiries.push(inquiry);
    c.record(t, data, 'inquiries.open', inquiry.id);
    return {id: inquiry.id};
  },
  'inquiries.withdraw'(t, data, args) {
    const inquiry = inquiryOf(data, args.id);
    if (inquiry.state !== 'open') fail('invalid_state', 'The inquiry is ' + inquiry.state + '. Only an open inquiry can be withdrawn.');
    Object.assign(inquiry, {state: 'withdrawn', withdrawn_at: t.at});
    c.record(t, data, 'inquiries.withdraw', inquiry.id);
    return {id: inquiry.id};
  },
  'leave.request'(t, data, args) {
    tenthsOnly(args.hours_per_day);
    const {type, days, hours, failures} = leaveCheck(data, args, t.now);
    if (failures.length) fail(failures[0].code, failures[0].message);
    const request = {id: c.nextId(c.allIds(data), 'lv-'), leave_type_id: type.id, start: args.start, end: args.end, hours_per_day: args.hours_per_day, days,
      hours: fromTenths(hours), note: args.note ?? null, requested_at: t.at, request_id: t.ref, stored_state: 'pending', decided_at: null, decided_by: null,
      decision_note: null, cancelled_at: null, cancel_reason: null};
    data.leave_requests.push(request);
    c.record(t, data, 'leave.request', request.id);
    return {id: request.id, state: 'pending', hours: request.hours};
  },
  'leave.cancel'(t, data, args) {
    const request = requestOf(data, args.id), state = views.leaveState(data, request, t.now);
    if (state !== 'pending' && state !== 'approved') fail('invalid_state', 'The leave request is ' + state + '. It cannot be cancelled.');
    if (state === 'approved' && t.now >= time.startOfDay(request.start, c.zone(data))) fail('too_late', 'Approved leave can be cancelled only before its first day.');
    Object.assign(request, {stored_state: 'cancelled', cancelled_at: t.at, cancel_reason: args.reason ?? null});
    c.record(t, data, 'leave.cancel', request.id);
    return {id: request.id};
  },
  'benefits.elect'(t, data, args) {
    decimals(args.yearly_amount);
    const w = windowOf(data, args.id);
    if (!w.plan_ids.includes(args.plan_id)) fail('not_found', 'The enrollment window has no plan with this ID.');
    const plan = c.planOf(data, args.plan_id);
    if (args.option_id !== undefined && plan.kind !== 'options' || args.yearly_amount !== undefined && plan.kind !== 'yearly_amount') fail('invalid_arguments',
      plan.kind === 'options' ? 'This plan takes one of its options or no coverage.' : 'This plan takes a yearly amount or no coverage.');
    if (args.option_id !== undefined && !plan.options.some(o => o.id === args.option_id)) fail('not_found', 'The plan has no option with this ID.');
    if (views.windowState(w, t.now) !== 'open') fail('window_closed', 'Choices can be saved only while the window is open, from ' + w.opens_at + ' until ' + w.closes_at + '.');
    if (args.yearly_amount !== undefined && plan.yearly_max !== null && cents(args.yearly_amount) > cents(plan.yearly_max)) fail('over_limit', 'The yearly amount is above the plan maximum of ' +
      c.amountText(cents(plan.yearly_max)) + '.');
    const choice = args.option_id !== undefined ? {option_id: args.option_id} : args.yearly_amount !== undefined ? {yearly_amount: args.yearly_amount} : {no_coverage: true};
    w.saved.push({plan_id: plan.id, choice, saved_at: t.at, request_id: t.ref});
    c.record(t, data, 'benefits.elect', w.id);
    return {id: w.id};
  },
  'benefits.submit'(t, data, args) {
    const w = windowOf(data, args.id);
    if (views.windowState(w, t.now) !== 'open') fail('window_closed', 'A set can be submitted only while the window is open, from ' + w.opens_at + ' until ' + w.closes_at + '.');
    const choices = w.plan_ids.map(id => ({plan_id: id, choice: views.savedChoice(data, w, c.planOf(data, id), t.now)}));
    const missing = choices.filter(x => x.choice === null).map(x => x.plan_id);
    if (missing.length) fail('incomplete', 'Save a choice for every plan of the window first. No choice is saved for: ' + missing.join(', ') + '.');
    let set = views.setOf(data, w);
    if (!set) {
      set = {id: c.nextId(c.allIds(data), 'els-'), window_id: w.id, plan_year: w.plan_year, choices, submitted_at: t.at, request_id: t.ref, history: []};
      data.election_sets.push(set);
      w.set_id = set.id;
    } else Object.assign(set, {choices, submitted_at: t.at, request_id: t.ref});
    set.history.push({at: t.at, choices: copy(choices), request_id: t.ref});
    c.record(t, data, 'benefits.submit', set.id);
    return {id: set.id, state: 'submitted'};
  },
  'preferences.update'(t, data, args) {
    if (args.timezone === undefined && args.email_notices === undefined) fail('invalid_arguments', 'Give the time zone or email_notices.');
    if (args.timezone !== undefined && !time.validZone(args.timezone)) fail('invalid_timezone', 'The time zone is unknown. Use an IANA name such as America/New_York.');
    Object.assign(data.preferences, {timezone: args.timezone ?? data.preferences.timezone, email_notices: args.email_notices ?? data.preferences.email_notices});
    c.record(t, data, 'preferences.update', data.account_id);
    return {id: data.account_id};
  }
};
function handleTool(ctx, data, name, args) {
  const short = name.startsWith(A) ? name.slice(A.length) : '', now = ms(ctx.virtual_now);
  if ([args.start, args.end].some(day => day !== undefined && !time.validDay(day))) fail('invalid_arguments', 'A day is not a real calendar date. Use YYYY-MM-DD.');
  if (reads[short]) return {data, result: {...reads[short](data, args, now), now: time.iso(now, c.zone(data))}};
  if (!writes[short]) fail('unknown_tool', 'Unknown Payleaf operation.');
  const result = writes[short]({ctx, at: ctx.virtual_now, now, actor: 'agent', ref: args.request_id}, data, args);
  return {data, result};
}
module.exports = {handleTool};
