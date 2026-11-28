'use strict';
// Commits time effects that fell due before the current write or event.
// Reads never call this on stored data; they compute the same view on a copy.
// Due effects are applied one at a time in (due time, ID) order, and each is
// stamped with its own deadline, so one long clock advance and several short
// ones produce the same records.
const R = require('./rules.cjs');
const C = require('./clock.cjs');
const {notify, money} = require('./notices.cjs');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function history(record, at, action, extra = {}) {
  record.history.push({at, action, ...extra});
}

function shortDate(date) {
  return `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`;
}

function localTime(at) {
  const t = C.ms(at);
  return C.stamp(t).slice(0, 16).replace('T', ' ');
}

function noticeFields(data, n) {
  const p = R.plaza(data, n.plaza_id);
  return [['Notice', n.id], ['Plate', n.plate], ['Toll', `${p.name} plaza, ${localTime(n.toll_at)}`],
    ['Vehicle class charged', n.class_charged], ['Toll amount', money(n.toll_cents)]];
}

function nextStatementPeriod(data) {
  return data.statements.length ? C.nextMonth(data.statements[data.statements.length - 1].period) : C.monthOf(data.opened_on);
}

function statementDueAt(period) {
  return C.midnight(`${C.nextMonth(period)}-01`);
}

// Every effect that is due at `now`, unordered.
function dueEffects(data, now) {
  const out = [];
  for (const n of data.notices) {
    if ((n.state === 'issued' || n.state === 'escalated') && now >= R.dueAt(n)) {
      out.push({t: R.dueAt(n), id: n.id, kind: n.state === 'issued' ? 'escalate' : 'collections', record: n});
    }
  }
  for (const v of data.vehicles) {
    if (v.temporary && !v.ended_at && v.possession_end !== null) {
      const t = C.midnight(C.addDays(v.possession_end, 1));
      if (now >= t) out.push({t, id: v.id, kind: 'temp_expired', record: v});
    }
  }
  const period = nextStatementPeriod(data), t = statementDueAt(period);
  if (now >= t) out.push({t, id: `st-${period}`, kind: 'statement', period});
  return out;
}

function applyEffect(data, e) {
  const at = C.stamp(e.t), pol = R.policy(data);
  if (e.kind === 'escalate') {
    const n = e.record;
    n.state = 'escalated';
    n.late_fee_cents = pol.late_fee_cents;
    n.escalated_at = at;
    n.due_date = C.addDays(n.due_date, pol.escalated_due_days);
    history(n, at, 'escalated', {late_fee_cents: n.late_fee_cents, due_date: n.due_date});
    notify(data, {at, kind: 'notice_escalated', object_type: 'notice', object_id: n.id,
      title: `Toll notice ${n.id} is overdue: ${money(R.noticeAmount(n))} now due by ${shortDate(n.due_date)}`,
      fields: [...noticeFields(data, n), ['Late fee', money(n.late_fee_cents)], ['Amount due', money(R.noticeAmount(n))],
        ['New due date', n.due_date], ['Dispute window closes', R.disputeWindowCloses(data, n)],
        ['Next step', `Unpaid on ${n.due_date}, the notice goes to collections.`]]});
  } else if (e.kind === 'collections') {
    const n = e.record;
    n.state = 'collections';
    n.collections_at = at;
    history(n, at, 'sent_to_collections', {amount_cents: R.noticeAmount(n)});
    notify(data, {at, kind: 'notice_collections', object_type: 'notice', object_id: n.id,
      title: `Toll notice ${n.id} was sent to collections: ${money(R.noticeAmount(n))}`,
      fields: [...noticeFields(data, n), ['Late fee', money(n.late_fee_cents)], ['Amount sent to collections', money(R.noticeAmount(n))],
        ['Status', 'Crossway can no longer accept payment or a dispute for this notice.']]});
  } else if (e.kind === 'temp_expired') {
    const v = e.record;
    v.ended_at = at;
    history(v, at, 'temporary_plate_expired', {possession_end: v.possession_end});
    for (const tp of data.transponders.filter(x => x.vehicle_id === v.id)) {
      tp.vehicle_id = null;
      history(tp, at, 'unassigned', {vehicle_id: v.id, reason: 'vehicle_ended'});
    }
    notify(data, {at, kind: 'temp_plate_expired', object_type: 'vehicle', object_id: v.id,
      title: `Temporary plate ${v.plate} expired on your Crossway account`,
      fields: [['Vehicle', `${v.label} (${v.id})`], ['Plate', v.plate], ['Possession', `${v.possession_start} to ${v.possession_end}`],
        ['Effect', 'Tolls on this plate after the end date are no longer billed to this account.']]});
  } else {
    statement(data, e.period, at);
  }
}

function statement(data, period, at) {
  const start = C.midnight(`${period}-01`), end = statementDueAt(period);
  const previous = data.statements[data.statements.length - 1];
  const opening = previous ? previous.closing_balance_cents : 0;
  const rows = data.ledger.filter(l => C.ms(l.at) >= start && C.ms(l.at) < end);
  const sum = kind => rows.filter(l => l.kind === kind).reduce((s, l) => s + l.amount_cents, 0);
  const s = {
    id: `st-${period}`, period, issued_at: at,
    opening_balance_cents: opening,
    closing_balance_cents: opening + rows.reduce((total, l) => total + l.amount_cents, 0),
    toll_count: rows.filter(l => l.kind === 'toll').length,
    toll_cents: -sum('toll'), topup_cents: sum('topup'), replenish_cents: sum('replenish'),
    notices_issued: data.notices.filter(n => C.ms(n.issued_at) >= start && C.ms(n.issued_at) < end).length,
  };
  data.statements.push(s);
  const [y, m] = period.split('-');
  notify(data, {at, kind: 'statement', object_type: 'statement', object_id: s.id,
    title: `Crossway statement for ${MONTH_NAMES[Number(m) - 1]} ${y}: closing balance ${money(s.closing_balance_cents)}`,
    fields: [['Statement', s.id], ['Period', `${period}-01 to ${C.addDays(`${C.nextMonth(period)}-01`, -1)}`],
      ['Opening balance', money(s.opening_balance_cents)], ['Tolls', `${s.toll_count}, ${money(s.toll_cents)}`],
      ['Top-ups', money(s.topup_cents)], ['Auto-replenish', money(s.replenish_cents)],
      ['Closing balance', money(s.closing_balance_cents)], ['Violation notices issued', s.notices_issued]]});
}

function settle(ctx, data) {
  const now = C.ms(ctx.virtual_now);
  for (;;) {
    const due = dueEffects(data, now);
    if (!due.length) return data;
    due.sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    applyEffect(data, due[0]);
  }
}

module.exports = {settle, history, dueEffects, shortDate, localTime, noticeFields};
