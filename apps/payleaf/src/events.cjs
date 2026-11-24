'use strict';
const c = require('./common.cjs');
const views = require('./views.cjs');
const payrun = require('./payrun.cjs');
const rules = require('./rules.cjs');
const notices = require('./notices.cjs');
const {ms, cents, money, sum, time} = c;
const A = c.APP + '.';
// What payroll, the manager and the benefits team do arrives here. Their acts are applied as given: only the listed rules are checked.
const bad = message => c.fail('invalid_event', message);
const fresh = (data, id) => { if (c.allIds(data).includes(id)) bad('The ID ' + id + ' already exists.'); };
const amounts = values => { if (values.some(v => !c.twoDecimals(v) || v <= 0)) bad('An amount is zero or less, or it has more than two decimals.'); };
const dates = (...values) => { if (values.some(v => v !== undefined && !time.validDay(v))) bad('A date is not a real calendar date.'); };

const handlers = {
  'payroll.run_posted'(t, data, p) {
    const entry = data.calendar.find(e => e.id === p.entry_id) || bad('The event names a pay calendar entry that does not exist.');
    if (entry.state === 'paid') bad('The run of this pay calendar entry is already posted.');
    if (t.now < ms(entry.cutoff_at)) bad('The cut-off of this run has not passed.');
    if (c.planned(data)[0] !== entry) bad('An earlier run is not posted yet. Runs post in the order of their cut-offs.');
    fresh(data, p.statement_id);
    if (!p.earnings.length) bad('A pay run has no earnings line.');
    amounts([...p.earnings, ...p.taxes].map(line => line.amount));
    const lineIds = [...p.earnings, ...p.taxes].map(line => line.line_id);
    if (new Set(lineIds).size !== lineIds.length) bad('A pay run uses one line ID twice.');
    if (p.earnings.some(line => line.inquiry_id !== undefined && !data.inquiries.some(q => q.id === line.inquiry_id))) bad('An earnings line names an inquiry that does not exist.');
    const earned = sum(p.earnings.map(l => cents(l.amount))), afterTaxes = earned - sum(p.taxes.map(l => cents(l.amount)));
    if (afterTaxes < 0) bad('The taxes of a pay run are above its earnings.');
    const year = Number(entry.pay_date.slice(0, 4)), force = views.inForce(data, year, t.now);
    if (!force) bad('The enrollment window of the plan year of this pay date has not closed.');
    // The settings this run uses: for each setting, the latest change for this run that is not cancelled.
    const states = views.changeStates(data, t.now), used = c.copy(data.settings), stored = [];
    for (const setting of views.SETTINGS) {
      const group = data.changes.map((change, index) => ({change, index}))
        .filter(({change}) => change.setting === setting && !change.stored_state && states.get(change.id).target === entry)
        .sort((a, b) => ms(a.change.made_at) - ms(b.change.made_at) || a.index - b.index);
      group.forEach(({change}, i) => {
        const last = i === group.length - 1;
        Object.assign(change, {stored_state: last ? 'applied' : 'replaced', entry_id: entry.id});
        if (last) used[setting] = c.copy(change.value);
        stored.push(change);
      });
    }
    const salary = sum(p.earnings.filter(l => l.kind === 'salary').map(l => cents(l.amount)));
    const deductions = payrun.deductionLines(data, entry.pay_date, used, force, salary, afterTaxes);
    const net = afterTaxes - sum(deductions.map(d => d.amount)), split = payrun.split(net, used.deposit.accounts), ids = c.allIds(data), deposits = [];
    used.deposit.accounts.forEach((account, i) => {
      if (split[i] <= 0) return;
      const id = c.nextId(ids, 'dep-');
      ids.push(id);
      deposits.push({id, account: {label: account.label, kind: account.kind, last4: account.last4}, amount: money(split[i]), state: 'sent',
        history: [{at: t.at, state: 'sent', reason: null, event_id: t.ref}], reissued_to: null});
    });
    const statement = {id: p.statement_id, entry_id: entry.id, pay_date: entry.pay_date, period_start: entry.period_start, period_end: entry.period_end,
      posted_at: t.at, event_id: t.ref,
      earnings: p.earnings.map(l => ({line_id: l.line_id, kind: l.kind, text: l.text, amount: l.amount, inquiry_id: l.inquiry_id ?? null})),
      taxes: p.taxes.map(l => ({line_id: l.line_id, text: l.text, amount: l.amount})),
      deductions: deductions.map(d => ({...d, due: money(d.due), amount: money(d.amount)})), net_pay: money(net),
      settings_used: {...c.copy(used), election_set_id: force.set_id, change_ids: stored.filter(x => x.stored_state === 'applied').map(x => x.id)}, deposits};
    if (new Set(c.linesOf(statement).map(l => l.line_id)).size !== c.linesOf(statement).length) bad('A line ID of the pay run is also the ID of a deduction line.');
    data.statements.push(statement);
    Object.assign(entry, {state: 'paid', statement_id: statement.id});
    entry.history.push({at: t.at, action: 'paid', event_id: t.ref, from: null, to: null, reason: null});
    data.settings = used;
    c.record(t, data, 'payroll.run_posted', entry.id);
    c.record(t, data, 'statement.written', statement.id, true);
    for (const change of stored) c.record(t, data, 'change.' + change.stored_state, change.id, true, change.history);
    for (const type of data.leave_types) {
      if (!(type.accrual_per_period > 0)) continue;
      const id = c.nextId(ids, 'le-r');
      ids.push(id);
      data.leave_entries.push({id, leave_type_id: type.id, at: t.at, hours: type.accrual_per_period, reason: 'accrual', note: null, statement_id: statement.id, event_id: t.ref});
      c.record(t, data, 'leave.earned', id, true);
    }
    return {object: statement.id, statement};
  },
  'calendar.changed'(t, data, p) {
    dates(p.pay_date, p.period_start, p.period_end);
    const entry = data.calendar.find(e => e.id === p.entry_id), zone = c.zone(data);
    const after = cutoff => ms(cutoff) >= time.startOfDay(time.addDays(p.pay_date || entry.pay_date, 1), zone);
    if (!entry) {
      if ([p.period_start, p.period_end, p.pay_date, p.cutoff_at].some(v => v === undefined)) bad('The event names an entry that does not exist. To add one, give its pay period, pay date and cut-off.');
      fresh(data, p.entry_id);
      if (p.period_end < p.period_start) bad('A pay period ends before it starts.');
      if (ms(p.cutoff_at) <= t.now) bad('A cut-off must be later than the time of the event.');
      if (after(p.cutoff_at)) bad('A cut-off cannot be after its pay date.');
      const added = {id: p.entry_id, period_start: p.period_start, period_end: p.period_end, pay_date: p.pay_date, cutoff_at: p.cutoff_at, state: 'planned',
        statement_id: null, history: [{at: t.at, action: 'added', event_id: t.ref, from: null, to: {pay_date: p.pay_date, cutoff_at: p.cutoff_at}, reason: p.reason ?? null}]};
      data.calendar.push(added);
      c.record(t, data, 'calendar.changed', added.id);
      return {object: added.id, entry: added, before: null, payload: p};
    }
    if (entry.state === 'paid') bad('The run of this entry is posted. A paid entry does not change.');
    if (p.period_start !== undefined && p.period_start !== entry.period_start || p.period_end !== undefined && p.period_end !== entry.period_end) bad('The pay period of an entry does not change.');
    const cutoff = p.cutoff_at !== undefined && ms(p.cutoff_at) !== ms(entry.cutoff_at) ? p.cutoff_at : entry.cutoff_at, payDate = p.pay_date ?? entry.pay_date;
    if (cutoff === entry.cutoff_at && payDate === entry.pay_date) bad('The event changes nothing: it gives no new pay date and no new cut-off.');
    if (cutoff !== entry.cutoff_at && t.now >= ms(entry.cutoff_at)) bad('The cut-off of this entry has passed. It cannot move.');
    if (cutoff !== entry.cutoff_at && ms(cutoff) <= t.now) bad('A cut-off must be later than the time of the event.');
    if (after(cutoff)) bad('A cut-off cannot be after its pay date.');
    const before = {pay_date: entry.pay_date, cutoff_at: entry.cutoff_at};
    Object.assign(entry, {pay_date: payDate, cutoff_at: cutoff});
    entry.history.push({at: t.at, action: 'moved', event_id: t.ref, from: before, to: {pay_date: payDate, cutoff_at: cutoff}, reason: p.reason ?? null});
    c.record(t, data, 'calendar.changed', entry.id);
    return {object: entry.id, entry, before, payload: p};
  },
  'deposit.updated'(t, data, p) {
    const row = c.depositsOf(data).find(r => r.deposit.id === p.deposit_id) || bad('The event names a deposit that does not exist.');
    const deposit = row.deposit, to = p.reissued_to;
    if ({sent: 'returned', returned: 'reissued'}[deposit.state] !== p.state) bad('A deposit moves only from sent to returned, and from returned to reissued.');
    if ((p.state === 'reissued') !== (to !== undefined)) bad('A reissued deposit names the account or the check it went to. A returned one names none.');
    if (to && (to.kind === 'account') !== (to.last4 !== undefined)) bad('An account has its last four digits, and a check has none.');
    deposit.state = p.state;
    deposit.history.push({at: t.at, state: p.state, reason: p.reason ?? null, event_id: t.ref});
    if (to) deposit.reissued_to = {kind: to.kind, label: to.label, last4: to.last4 ?? null};
    c.record(t, data, 'deposit.updated', deposit.id);
    return {object: deposit.id, statement: row.statement, deposit, payload: p};
  },
  'inquiry.answered'(t, data, p) {
    const inquiry = data.inquiries.find(q => q.id === p.inquiry_id) || bad('The event names an inquiry that does not exist.');
    if (inquiry.state !== 'open') bad('The inquiry is not open.');
    if (p.outcome === 'corrected' ? p.correction_amount === undefined : p.correction_amount !== undefined) bad('A corrected answer gives the correction amount. A no_change answer gives none.');
    if (p.outcome === 'corrected') amounts([p.correction_amount]);
    Object.assign(inquiry, {state: 'answered', answer: {outcome: p.outcome, correction_amount: p.correction_amount ?? null, answered_by: p.answered_by,
      note: p.note ?? null, answered_at: t.at, event_id: t.ref}});
    c.record(t, data, 'inquiry.answered', inquiry.id);
    return {object: inquiry.id, inquiry};
  },
  'leave.decided'(t, data, p) {
    const request = data.leave_requests.find(r => r.id === p.leave_request_id) || bad('The event names a leave request that does not exist.');
    if (views.leaveState(data, request, t.now) !== 'pending') bad('The leave request is not pending. A request that lapsed takes no decision.');
    Object.assign(request, {stored_state: p.decision === 'approve' ? 'approved' : 'denied', decided_at: t.at, decided_by: p.decided_by, decision_note: p.note ?? null});
    c.record(t, data, 'leave.decided', request.id);
    return {object: request.id, request};
  },
  'leave.adjusted'(t, data, p) {
    const type = data.leave_types.find(x => x.id === p.leave_type_id) || bad('The event names a leave type that does not exist.');
    fresh(data, p.entry_id);
    if (!c.oneDecimal(p.hours) || p.hours === 0) bad('A leave adjustment has zero hours, or more than one decimal.');
    const entry = {id: p.entry_id, leave_type_id: type.id, at: t.at, hours: p.hours, reason: p.reason, note: p.note ?? null, statement_id: null, event_id: t.ref};
    data.leave_entries.push(entry);
    if (p.hours < 0 && views.balance(data, type, t.now).available < 0) bad('The adjustment would take the available hours below zero.');
    c.record(t, data, 'leave.adjusted', entry.id);
    return {object: type.id, entry};
  },
  'enrollment.opened'(t, data, p) {
    fresh(data, p.window_id);
    if (data.windows.some(w => w.plan_year === p.plan_year) || views.historySet(data, p.plan_year)) bad('The plan year already has an enrollment window or an election set.');
    if (!p.plan_ids.length || new Set(p.plan_ids).size !== p.plan_ids.length || p.plan_ids.some(id => !c.planOf(data, id))) bad('A window names no plan, a plan twice or an unknown plan.');
    if (ms(p.closes_at) <= ms(p.opens_at)) bad('The window closes before it opens.');
    if (ms(p.closes_at) >= time.startOfDay(String(p.plan_year).padStart(4, '0') + '-01-01', c.zone(data))) bad('The window does not close before its plan year starts.');
    const window = {id: p.window_id, plan_year: p.plan_year, opens_at: p.opens_at, closes_at: p.closes_at, plan_ids: [...p.plan_ids], saved: [], set_id: null, event_id: t.ref};
    data.windows.push(window);
    c.record(t, data, 'enrollment.opened', window.id);
    return {object: window.id, window};
  }
};
function applyEvent(ctx, data, event) {
  const kind = event.operation.startsWith(A) ? event.operation.slice(A.length) : '';
  if (!handlers[kind]) bad('Unsupported operation.');
  const t = {ctx, at: event.at, now: ms(event.at), actor: 'event', ref: event.event_id};
  const {object, ...details} = handlers[kind](t, data, event.payload);
  notices.write(t, data, kind, object, details);
  // The same rules as a seed. A failure rejects the event and leaves the state unchanged.
  rules.validate(ctx, data, 'invalid_event');
  return data;
}
module.exports = {applyEvent};
