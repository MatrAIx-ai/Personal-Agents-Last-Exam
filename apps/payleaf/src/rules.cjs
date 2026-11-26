'use strict';
const c = require('./common.cjs');
const views = require('./views.cjs');
const payrun = require('./payrun.cjs');
const {ms, cents, tenths, sum, time} = c;
// A stored time is a full timestamp with a UTC offset. The wire message of a notification follows Mail's schema instead.
const TIME_KEY = /^at$|_at$/, WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const noOffset = value => Object.entries(value).some(([key, item]) => typeof item === 'string' ? TIME_KEY.test(key) && !WITH_OFFSET.test(item)
  : item !== null && typeof item === 'object' && key !== 'email' && noOffset(item));
// Plain JSON with sorted keys, so two values compare by content.
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const accountKey = account => ({label: account.label, kind: account.kind, last4: account.last4});

// The rules that a seed must keep. Core runs them on every loaded seed and after every write and event.
function validate(ctx, data, code = 'invalid_seed') {
  const bad = message => c.fail(code, message);
  const now = ms(ctx.virtual_now), zone = c.zone(data);
  const amounts = (...values) => { if (values.some(v => v !== null && v !== undefined && !c.twoDecimals(v))) bad('An amount has more than two decimals.'); };
  const decimal = (...values) => { if (values.some(v => v !== null && v !== undefined && !c.oneDecimal(v))) bad('A number of hours or a percentage has more than one decimal.'); };
  const days = (...values) => { if (values.some(v => !time.validDay(v))) bad('A date is not a real calendar date.'); };
  if (!time.validZone(zone) || !time.validZone(data.preferences.timezone)) bad('A time zone is unknown.');
  if (noOffset(data)) bad('A timestamp has no UTC offset.');
  const ids = new Set();
  const take = id => { if (ids.has(id)) bad('The ID ' + id + ' is used twice.'); ids.add(id); };
  const rules = data.employer.rules;
  days(...data.employer.holidays, data.employment.start_date);
  decimal(rules.max_retirement_percent);
  amounts(data.employment.annual_salary);

  // Plans first: choices and deductions name them.
  const options = new Set();
  for (const plan of data.plans) {
    take(plan.id);
    if (plan.kind === 'options' ? !plan.options.length || plan.yearly_max !== null : plan.options.length) bad('A plan with options has at least one option and no yearly maximum. A plan with a yearly amount has no options.');
    amounts(plan.yearly_max);
    for (const option of plan.options) {
      if (options.has(option.id)) bad('The option ' + option.id + ' is used twice.');
      options.add(option.id);
      amounts(option.per_pay_cost);
    }
  }
  const fits = (planId, choice) => {
    const plan = c.planOf(data, planId);
    if (!plan) bad('A choice names a plan that does not exist.');
    if (choice.no_coverage) return;
    if (choice.option_id !== undefined ? plan.kind !== 'options' || !plan.options.some(o => o.id === choice.option_id) : plan.kind !== 'yearly_amount') bad('A choice does not fit its plan.');
    amounts(choice.yearly_amount);
    if (choice.yearly_amount !== undefined && plan.yearly_max !== null && cents(choice.yearly_amount) > cents(plan.yearly_max)) bad('A yearly amount is above the maximum of its plan.');
  };
  const setup = deposit => {
    for (const account of deposit.accounts) { amounts(account.amount); decimal(account.percent); }
    const problem = payrun.splitProblem(deposit.accounts);
    if (problem) bad(problem);
  };
  const form = withholding => amounts(withholding.dependents_amount, withholding.other_income, withholding.deductions, withholding.extra_withholding);
  const settings = value => { setup(value.deposit); form(value.withholding); decimal(value.retirement.percent); };
  settings(data.settings);

  // The pay calendar and the statements.
  for (const entry of data.calendar) {
    take(entry.id);
    days(entry.period_start, entry.period_end, entry.pay_date);
    if (entry.period_end < entry.period_start) bad('A pay period ends before it starts.');
    if (ms(entry.cutoff_at) >= time.startOfDay(time.addDays(entry.pay_date, 1), zone)) bad('A cut-off is after its pay date.');
    const statement = data.statements.find(s => s.id === entry.statement_id);
    if (entry.state === 'paid' ? !statement || statement.entry_id !== entry.id : entry.statement_id !== null) bad('A paid entry has its statement, and a planned entry has none.');
  }
  const paidOrder = data.calendar.filter(e => e.state === 'paid').sort(c.calendarOrder);
  for (const statement of data.statements) {
    take(statement.id);
    const entry = data.calendar.find(e => e.id === statement.entry_id);
    if (!entry || entry.statement_id !== statement.id) bad('A statement names a pay calendar entry that does not point back to it.');
    if (statement.pay_date !== entry.pay_date || statement.period_start !== entry.period_start || statement.period_end !== entry.period_end) bad('A statement and its pay calendar entry do not agree.');
    // A run posts after its cut-off. A statement posted after the clock would let a later valid change break the rules below.
    if (ms(statement.posted_at) < ms(entry.cutoff_at) || ms(statement.posted_at) > now) bad('A statement is posted before the cut-off of its run, or after the current time.');
    if (!statement.earnings.length) bad('A statement has no earnings line.');
    const lineIds = c.linesOf(statement).map(line => line.line_id);
    if (new Set(lineIds).size !== lineIds.length) bad('A statement uses one line ID twice.');
    amounts(...c.linesOf(statement).map(line => line.amount), ...statement.deductions.map(d => d.due), statement.net_pay);
    for (const line of statement.earnings) if (line.inquiry_id !== null && !data.inquiries.some(q => q.id === line.inquiry_id)) bad('An earnings line names an inquiry that does not exist.');
    const earned = sum(statement.earnings.map(l => cents(l.amount))), afterTaxes = earned - sum(statement.taxes.map(l => cents(l.amount)));
    if (afterTaxes < 0) bad('The taxes of a statement are above its earnings.');
    let cut = false;
    for (const d of statement.deductions) {
      const plan = d.plan_id === null ? null : c.planOf(data, d.plan_id);
      if (d.kind === 'retirement' ? d.plan_id !== null || d.option_id !== null : !plan || (plan.kind === 'options' ? !plan.options.some(o => o.id === d.option_id) : d.option_id !== null)) bad('A deduction names a plan or an option that does not fit it.');
      if (cents(d.amount) > cents(d.due) || cut && d.amount !== 0) bad('A deduction takes more than is due, or it is taken after a deduction that was cut.');
      if (cents(d.amount) < cents(d.due)) cut = true;
    }
    const taken = sum(statement.deductions.map(d => cents(d.amount)));
    if (taken > afterTaxes || cut && taken !== afterTaxes) bad('The deductions of a statement do not follow from the pay left after taxes.');
    if (cents(statement.net_pay) !== afterTaxes - taken) bad('The net pay of a statement does not follow from its lines.');
    const used = statement.settings_used;
    settings(used);
    const split = payrun.split(cents(statement.net_pay), used.deposit.accounts).map((amount, i) => ({amount, account: accountKey(used.deposit.accounts[i])})).filter(x => x.amount > 0);
    if (!same(split, statement.deposits.map(d => ({amount: cents(d.amount), account: d.account})))) bad('The deposits of a statement do not follow from its net pay and its deposit setup.');
    for (const deposit of statement.deposits) {
      take(deposit.id);
      const states = deposit.history.map(h => h.state);
      if (!['sent', 'sent,returned', 'sent,returned,reissued'].includes(states.join(',')) || states[states.length - 1] !== deposit.state) bad('The history of a deposit does not follow the order sent, returned, reissued.');
      const to = deposit.reissued_to;
      if ((to !== null) !== (deposit.state === 'reissued') || to && (to.kind === 'account') !== (to.last4 !== null)) bad('A reissued deposit names the account or the check it went to.');
    }
    if (used.election_set_id !== null && !data.election_sets.some(s => s.id === used.election_set_id)) bad('A statement names an election set that does not exist.');
    for (const id of used.change_ids) {
      const change = data.changes.find(x => x.id === id);
      if (!change || change.stored_state !== 'applied' || change.entry_id !== entry.id || !same(change.value, used[change.setting])) bad('A statement names a change that it did not apply.');
    }
  }
  const last = paidOrder[paidOrder.length - 1];
  if (last) {
    const used = data.statements.find(s => s.id === last.statement_id).settings_used;
    if (!views.SETTINGS.every(setting => same(used[setting], data.settings[setting]))) bad('The settings are not the values that the last posted run used.');
  }

  // Setting changes.
  const shapes = {deposit: value => Array.isArray(value.accounts), withholding: value => value.filing_status !== undefined, retirement: value => value.percent !== undefined};
  const groups = new Map();
  for (const change of data.changes) {
    take(change.id);
    if (!shapes[change.setting](change.value)) bad('The value of a change does not fit its setting.');
    if (change.setting === 'deposit') setup(change.value);
    if (change.setting === 'withholding') form(change.value);
    if (change.setting === 'retirement') decimal(change.value.percent);
    const stored = change.stored_state, entry = data.calendar.find(e => e.id === change.entry_id);
    if (stored === 'applied' || stored === 'replaced' ? !entry || entry.state !== 'paid' || ms(change.made_at) >= ms(entry.cutoff_at) : change.entry_id !== null) bad('A change is applied or replaced only for a paid run whose cut-off was after it.');
    if ((stored === 'cancelled') !== (change.cancelled_at !== null) || stored === 'cancelled' && ms(change.cancelled_at) < ms(change.made_at)) bad('The state of a change does not fit its cancel time.');
    if (stored === null && paidOrder.some(e => ms(change.made_at) < ms(e.cutoff_at))) bad('A change made before the cut-off of a posted run was not stored by that run.');
    if (stored === 'applied' || stored === 'replaced') {
      const key = change.entry_id + '|' + change.setting;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(change);
    }
  }
  for (const rows of groups.values()) {
    const applied = rows.filter(x => x.stored_state === 'applied');
    const latest = rows.reduce((a, b) => ms(b.made_at) >= ms(a.made_at) ? b : a);
    if (applied.length !== 1 || applied[0] !== latest) bad('Each posted run applies the latest change of a setting, and the earlier ones are replaced.');
    const statement = data.statements.find(s => s.id === data.calendar.find(e => e.id === latest.entry_id).statement_id);
    if (!statement.settings_used.change_ids.includes(latest.id)) bad('A statement does not name a change that it applied.');
  }

  // Pay inquiries.
  const open = new Set();
  for (const inquiry of data.inquiries) {
    take(inquiry.id);
    const statement = data.statements.find(s => s.id === inquiry.statement_id);
    if (!statement || inquiry.line_id !== null && !c.linesOf(statement).some(l => l.line_id === inquiry.line_id)) bad('An inquiry names a statement or a line that does not exist.');
    amounts(inquiry.amount);
    const answer = inquiry.answer;
    if ((inquiry.state === 'withdrawn') !== (inquiry.withdrawn_at !== null) || (inquiry.state === 'answered') !== (answer !== null)) bad('The state of an inquiry does not fit its fields.');
    if (answer && (answer.outcome === 'corrected') !== (answer.correction_amount !== null)) bad('A corrected answer has a correction amount, and a no_change answer has none.');
    if (answer) amounts(answer.correction_amount);
    if (inquiry.state === 'open') {
      const key = inquiry.statement_id + '|' + inquiry.line_id;
      if (open.has(key)) bad('One statement line has two open inquiries.');
      open.add(key);
    }
  }

  // Leave.
  for (const type of data.leave_types) {
    take(type.id);
    decimal(type.accrual_per_period, type.carryover_cap);
    if ((type.carryover_cap === null) !== (type.carryover_date === null) || type.carryover_date !== null && !time.validDay('2023-' + type.carryover_date)) bad('A carryover cap needs a real carryover date, and a leave type with no cap has none.');
  }
  for (const entry of data.leave_entries) {
    take(entry.id);
    decimal(entry.hours);
    if (!data.leave_types.some(t => t.id === entry.leave_type_id) || entry.statement_id !== null && !data.statements.some(s => s.id === entry.statement_id)) bad('A leave entry names a leave type or a statement that does not exist.');
    if (entry.hours === 0) bad('A leave entry has zero hours.');
  }
  const held = new Map();
  for (const request of data.leave_requests) {
    take(request.id);
    days(request.start, request.end, ...request.days);
    decimal(request.hours_per_day, request.hours);
    if (!data.leave_types.some(t => t.id === request.leave_type_id)) bad('A leave request names a leave type that does not exist.');
    if (request.end < request.start || !same(request.days, c.workingDays(data, request.start, request.end)) || !request.days.length) bad('A leave request has no working day, or its days do not follow from its range.');
    if (tenths(request.hours) !== request.days.length * tenths(request.hours_per_day)) bad('The hours of a leave request do not follow from its days.');
    const stored = request.stored_state;
    // Approved leave that is cancelled keeps its decision.
    const decided = request.decided_at !== null && request.decided_by !== null;
    if ((stored === 'approved' || stored === 'denied') && !decided || stored === 'pending' && request.decided_at !== null || (stored === 'cancelled') !== (request.cancelled_at !== null)) bad('The state of a leave request does not fit its fields.');
    if (!views.holds(views.leaveState(data, request, now))) continue;
    for (const day of request.days) {
      if (held.has(day)) bad('Two leave requests that are pending, approved or taken share the day ' + day + '.');
      held.set(day, request.id);
    }
  }

  // Benefits enrollment.
  const years = new Set();
  for (const window of data.windows) {
    take(window.id);
    if (years.has(window.plan_year)) bad('One plan year has two enrollment windows.');
    years.add(window.plan_year);
    if (ms(window.closes_at) <= ms(window.opens_at) || ms(window.closes_at) >= time.startOfDay(String(window.plan_year).padStart(4, '0') + '-01-01', zone)) bad('An enrollment window closes before it opens, or after its plan year starts.');
    if (!window.plan_ids.length || new Set(window.plan_ids).size !== window.plan_ids.length || window.plan_ids.some(id => !c.planOf(data, id))) bad('An enrollment window names no plan, a plan twice or an unknown plan.');
    for (const save of window.saved) {
      if (!window.plan_ids.includes(save.plan_id)) bad('A saved choice names a plan that is not in its window.');
      fits(save.plan_id, save.choice);
      if (ms(save.saved_at) < ms(window.opens_at) || ms(save.saved_at) >= ms(window.closes_at)) bad('A choice was saved while its window was not open.');
    }
    const set = views.setOf(data, window);
    if ((set ? set.id : null) !== window.set_id) bad('An enrollment window and its election set do not agree.');
  }
  const setYears = new Set();
  for (const set of data.election_sets) {
    take(set.id);
    if (setYears.has(set.plan_year)) bad('One plan year has two election sets.');
    setYears.add(set.plan_year);
    const window = set.window_id === null ? null : data.windows.find(w => w.id === set.window_id);
    if (set.window_id !== null && (!window || window.plan_year !== set.plan_year)) bad('An election set names a window that does not exist, or one of another plan year.');
    if (set.window_id === null && years.has(set.plan_year)) bad('An election set with no window is for a plan year that has a window.');
    const plans = set.choices.map(x => x.plan_id);
    if (new Set(plans).size !== plans.length) bad('An election set names a plan twice.');
    for (const row of set.choices) fits(row.plan_id, row.choice);
    if (window && !same([...plans].sort(), [...window.plan_ids].sort())) bad('An election set does not have a choice for each plan of its window.');
    if (window && (ms(set.submitted_at) < ms(window.opens_at) || ms(set.submitted_at) >= ms(window.closes_at))) bad('An election set was submitted while its window was not open.');
    const lastRow = set.history[set.history.length - 1];
    if (lastRow && (!same(lastRow.choices, set.choices) || lastRow.at !== set.submitted_at)) bad('The last history row of an election set is not its submitted choices.');
    for (const row of set.history) for (const x of row.choices) fits(x.plan_id, x.choice);
  }

  for (const notification of data.notifications) {
    take(notification.id);
  }
  for (const notification of data.notifications) if (!ids.has(notification.object_id)) bad('A notification names an object that does not exist.');
  data.activity.forEach((row, index) => {
    if (index && row.seq <= data.activity[index - 1].seq) bad('The activity rows are not in order.');
    if (row.object_id !== data.account_id && !ids.has(row.object_id)) bad('An activity row names an object that does not exist.');
  });
}
module.exports = {validate, same};
