'use strict';
// Agent tool handlers. Reads work on a settled copy and return it unchanged;
// writes settle due time effects first, then apply one business transition.
const {fail} = require('./domain-utils.cjs');
const {log} = require('./diagnostics.cjs');
const R = require('./rules.cjs');
const V = require('./views.cjs');
const C = require('./clock.cjs');
const {settle, history} = require('./settle.cjs');
const {notify, money} = require('./notices.cjs');
const {ledger, receipt} = require('./account.cjs');
const {withdraw} = require('./disputes.cjs');
const {nextId} = require('./ids.cjs');

const P = 'crossway.';
const copy = value => structuredClone(value);
const FINAL = 'Payment is final and closes the right to dispute.';

// ---- Reads ------------------------------------------------------------------

const READS = {
  'account.get'(data, args, now) {
    return {account: V.accountView(data, now)};
  },
  'account.statements'(data, args) {
    return {statements: data.statements.filter(s => args.period === undefined || s.period === args.period).map(copy),
      balance_cents: data.balance_cents};
  },
  'vehicles.list'(data, args) {
    return {vehicles: data.vehicles.map(v => V.vehicleView(data, v)).filter(v => args.status === undefined || v.status === args.status)};
  },
  'transponders.list'(data) {
    return {transponders: data.transponders.map(t => V.transponderView(data, t))};
  },
  'tolls.list'(data, args) {
    const from = args.from ? C.midnight(args.from) : -Infinity, to = args.to ? C.midnight(C.addDays(args.to, 1)) : Infinity;
    const plate = args.plate ? R.normalizePlate(args.plate) : undefined;
    const rows = data.tolls.filter(t => C.ms(t.at) >= from && C.ms(t.at) < to &&
      (args.vehicle_id === undefined || t.vehicle_id === args.vehicle_id) &&
      (args.plaza_id === undefined || t.plaza_id === args.plaza_id) &&
      (args.transponder_id === undefined || t.transponder_id === args.transponder_id) &&
      (plate === undefined || t.plate_seen === plate) &&
      (args.disposition === undefined || t.disposition === args.disposition));
    rows.sort((a, b) => C.ms(b.at) - C.ms(a.at) || (a.id < b.id ? 1 : -1));
    return {total: rows.length, tolls: rows.slice(0, args.limit || 100).map(t => V.tollView(data, t))};
  },
  'notices.list'(data, args, now) {
    const plate = args.plate ? R.normalizePlate(args.plate) : undefined;
    return {notices: data.notices.filter(n => (args.state === undefined || n.state === args.state) &&
      (args.vehicle_id === undefined || n.vehicle_id === args.vehicle_id) &&
      (plate === undefined || n.plate === plate) &&
      (!args.open_only || ['issued', 'escalated', 'disputed'].includes(n.state)))
      .map(n => V.noticeView(data, n, now))};
  },
  'notices.get'(data, args, now) {
    const n = R.notice(data, args.notice_id);
    const toll = data.tolls.find(t => t.id === n.toll_id);
    const d = n.dispute_id ? R.dispute(data, n.dispute_id) : null;
    return {notice: V.noticeView(data, n, now), toll: V.tollView(data, toll), dispute: d ? copy(d) : null};
  },
  'disputes.reasons'(data) {
    const p = R.policy(data);
    return {reasons: Object.entries(R.REASONS).map(([reason, r]) => ({reason, label: r.label, required: copy(r.required)})),
      rules: [
        `An issued or escalated notice can be disputed once, within ${p.dispute_window_days} days of issue.`,
        'While a dispute is submitted, the notice\'s fees and due date are frozen and it cannot be paid.',
        `Granted: the notice is dismissed at $0.00. Denied: it returns to its prior state, due ${p.denial_due_days} days after the decision. Withdrawn: it returns with the days that remained. All three are final.`,
        'sold_or_not_in_possession needs a transfer date after the toll date. Evidence is a list of shared object references {app_id, account_id, object_id}; Crossway records them as given.',
        FINAL,
      ]};
  },
  'disputes.get'(data, args, now) {
    if ((args.dispute_id === undefined) === (args.notice_id === undefined)) fail('invalid_arguments', 'Give exactly one of dispute_id or notice_id.');
    let d;
    if (args.dispute_id !== undefined) d = R.dispute(data, args.dispute_id);
    else {
      const n = R.notice(data, args.notice_id);
      if (!n.dispute_id) fail('not_found', `Notice ${n.id} has no dispute.`);
      d = R.dispute(data, n.dispute_id);
    }
    return {dispute: copy(d), notice: V.noticeView(data, R.notice(data, d.notice_id), now)};
  },
  'policies.get'(data) {
    return {policies: V.policyText(data)};
  },
};

// ---- Shared write helpers ----------------------------------------------------

function today(now) {
  return C.localDate(now);
}

function previewRecord(ctx, data, now, fields) {
  const p = {id: nextId(data.run.previews, 'pv'), created_at: ctx.virtual_now,
    expires_at: C.stamp(now + R.policy(data).preview_minutes * C.MINUTE), used_at: null, ...fields};
  data.run.previews.push(p);
  return p;
}

function usePreview(ctx, data, id, kind, now) {
  const p = R.byId(data.run.previews, id, 'not_found', 'Preview');
  if (p.kind !== kind) fail('not_found', 'Preview is for a different action.');
  if (p.used_at) fail('preview_used', 'This preview was already confirmed. Start a new preview.');
  if (now >= C.ms(p.expires_at)) fail('preview_expired', `The preview expired at ${p.expires_at}; preview again.`);
  return p;
}

function inRange(value, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) fail('amount_out_of_range', `Amount must be between ${money(min)} and ${money(max)}.`);
}

function cardSummary(c) {
  return {id: c.id, label: R.cardLabel(c), holder_name: c.holder_name, holder_person_id: c.holder_person_id};
}

function checkPlateFree(data, candidate, ignoreId = null) {
  if (data.authority.plates_on_other_accounts.includes(candidate.plate)) {
    fail('plate_on_another_account', `Plate ${candidate.plate} is listed on another toll account.`);
  }
  const clash = data.vehicles.find(v => v.id !== ignoreId && v.plate === candidate.plate && R.intervalsOverlap(v, candidate));
  if (clash) fail('plate_already_listed', `Plate ${candidate.plate} is already listed as ${clash.id} for an overlapping period.`);
}

function checkDates(data, v) {
  if (!C.validDate(v.possession_start) || (v.possession_end !== null && !C.validDate(v.possession_end))) fail('invalid_arguments', 'Dates must be valid YYYY-MM-DD.');
  if (v.possession_end !== null && v.possession_end < v.possession_start) fail('end_before_start', 'The end date is before the start date.');
  const max = R.policy(data).temporary_plate_max_days;
  if (v.temporary && C.daysBetween(v.possession_start, v.possession_end) > max) {
    fail('temp_too_long', `A temporary plate's end date must be at most ${max} days after its start.`);
  }
}

function unassign(data, v, at) {
  for (const tp of data.transponders.filter(x => x.vehicle_id === v.id)) {
    tp.vehicle_id = null;
    history(tp, at, 'unassigned', {vehicle_id: v.id, reason: 'vehicle_ended'});
  }
}

function payLines(data, ids) {
  return ids.map(id => {
    const n = R.notice(data, id), block = R.payBlock(n);
    if (block) fail(block[0], block[1]);
    return {notice_id: n.id, plate: n.plate, toll_date: C.localDate(C.ms(n.toll_at)), plaza_name: R.plaza(data, n.plaza_id).name,
      state: n.state, amount_cents: R.noticeAmount(n)};
  });
}

function disputeDraft(data, args, now) {
  const n = R.notice(data, args.notice_id), block = R.disputeBlock(data, n, now);
  if (block) fail(block[0], block[1]);
  const reason = R.REASONS[args.reason];
  if (!reason) fail('invalid_arguments', 'Unknown dispute reason.');
  const evidence = args.evidence || [];
  for (const field of reason.required) {
    const value = field === 'evidence' ? evidence : args[field];
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) {
      fail('missing_required_field', `Reason ${args.reason} requires ${field}.`);
    }
  }
  const bad = evidence.find(ref => !R.validEvidenceRef(ref));
  if (bad !== undefined) fail('invalid_evidence_ref', 'Each evidence item must be {app_id, account_id, object_id} with ID-shaped strings.');
  const draft = {notice_id: n.id, reason: args.reason, transfer_date: null, agency_id: null, transponder_id: null, explanation: null,
    evidence: evidence.map(ref => ({app_id: ref.app_id, account_id: ref.account_id, object_id: ref.object_id}))};
  if (args.reason === 'sold_or_not_in_possession') {
    if (!C.validDate(args.transfer_date)) fail('invalid_arguments', 'transfer_date must be YYYY-MM-DD.');
    if (C.localDate(C.ms(n.toll_at)) <= args.transfer_date) {
      fail('toll_before_transfer', `The toll on ${C.localDate(C.ms(n.toll_at))} was on or before the transfer date ${args.transfer_date}.`);
    }
    draft.transfer_date = args.transfer_date;
  } else if (args.reason === 'paid_by_rental_agency') {
    R.byId(data.authority.rental_agencies, args.agency_id, 'not_found', 'Rental agency');
    draft.agency_id = args.agency_id;
  } else if (args.reason === 'transponder_malfunction') {
    R.transponder(data, args.transponder_id);
    draft.transponder_id = args.transponder_id;
  } else {
    draft.explanation = args.explanation;
  }
  return {n, draft};
}

// ---- Writes -----------------------------------------------------------------

const WRITES = {
  'account.replenish.set'(ctx, data, args, now) {
    const pol = R.policy(data), rule = data.replenish;
    const next = {enabled: args.enabled, card_id: args.card_id ?? rule.card_id,
      amount_cents: args.amount_cents ?? rule.amount_cents, threshold_cents: args.threshold_cents ?? rule.threshold_cents};
    inRange(next.amount_cents, pol.replenish_min_cents, pol.replenish_max_cents);
    inRange(next.threshold_cents, pol.threshold_min_cents, pol.threshold_max_cents);
    const c = R.card(data, next.card_id);
    if (next.enabled || args.card_id !== undefined) R.requireChargeable(c, now);
    Object.assign(rule, next, {updated_at: ctx.virtual_now});
    return {replenish: V.replenishView(data, now), account_status: R.accountStatus(data)};
  },
  'account.topup.preview'(ctx, data, args, now) {
    const pol = R.policy(data);
    inRange(args.amount_cents, pol.topup_min_cents, pol.topup_max_cents);
    const c = R.card(data, args.card_id ?? data.replenish.card_id);
    R.requireChargeable(c, now);
    const p = previewRecord(ctx, data, now, {kind: 'topup', amount_cents: args.amount_cents, card_id: c.id,
      balance_before_cents: data.balance_cents, balance_after_cents: data.balance_cents + args.amount_cents});
    return {preview: {...copy(p), card: cardSummary(c),
      text: `Confirming charges ${money(args.amount_cents)} to ${R.cardLabel(c)} (cardholder ${c.holder_name}).`}};
  },
  'account.topup.confirm'(ctx, data, args, now) {
    const p = usePreview(ctx, data, args.preview_id, 'topup', now);
    const c = R.card(data, p.card_id);
    R.requireChargeable(c, now);
    p.used_at = ctx.virtual_now;
    const r = receipt(data, {kind: 'topup', created_at: ctx.virtual_now, card_id: c.id, amount_cents: p.amount_cents});
    ledger(data, ctx.virtual_now, 'topup', p.amount_cents, r.id);
    const wasSuspended = Boolean(data.suspended_at);
    data.suspended_at = null;
    data.replenish.consecutive_failures = 0;
    notify(data, {at: ctx.virtual_now, kind: 'receipt', object_type: 'receipt', object_id: r.id,
      title: `Top-up receipt: ${money(p.amount_cents)} from ${R.cardLabel(c)}`,
      fields: [['Receipt', r.id], ['Card', `${R.cardLabel(c)}, cardholder ${c.holder_name}`], ['Amount', money(p.amount_cents)],
        ['New balance', money(data.balance_cents)], ['Account status', R.accountStatus(data) + (wasSuspended ? ' (suspension lifted)' : '')]]});
    return {receipt: copy(r), account: V.accountView(data, now)};
  },
  'vehicles.add'(ctx, data, args, now) {
    const pol = R.policy(data), temporary = Boolean(args.temporary);
    if (args.class > pol.vehicle_classes.length) fail('invalid_arguments', 'Unknown vehicle class.');
    if (!temporary && (args.possession_end !== undefined || args.rental_agency_id !== undefined)) {
      fail('invalid_arguments', 'Only a temporary plate takes an end date or rental agency when added; end possession with vehicles.end.');
    }
    if (temporary && args.possession_end === undefined) fail('missing_required_field', 'A temporary plate needs possession_end.');
    if (args.rental_agency_id !== undefined) R.byId(data.authority.rental_agencies, args.rental_agency_id, 'not_found', 'Rental agency');
    const v = {id: nextId(data.vehicles, 'v'), plate: R.normalizePlate(args.plate), class: args.class, label: args.label,
      temporary, rental_agency_id: args.rental_agency_id ?? null, possession_start: args.possession_start ?? today(now),
      possession_end: temporary ? args.possession_end : null, ended_at: null, added_at: ctx.virtual_now, history: []};
    checkDates(data, v);
    checkPlateFree(data, v);
    history(v, ctx.virtual_now, 'added', {possession_start: v.possession_start, possession_end: v.possession_end});
    data.vehicles.push(v);
    return {vehicle: V.vehicleView(data, v)};
  },
  'vehicles.update'(ctx, data, args, now) {
    const v = R.vehicle(data, args.vehicle_id), next = {...copy(v)};
    if (args.possession_start === undefined && args.possession_end === undefined && args.label === undefined) {
      fail('invalid_arguments', 'Nothing to update.');
    }
    if (args.label !== undefined) next.label = args.label;
    if (args.possession_start !== undefined) next.possession_start = args.possession_start;
    if (args.possession_end !== undefined) {
      if (!v.temporary && !v.ended_at) fail('invalid_state', 'Possession of an active vehicle is ended with vehicles.end.');
      if (v.temporary && !v.ended_at && args.possession_end < today(now)) fail('invalid_state', 'To end a temporary plate early, use vehicles.end.');
      if (v.ended_at && args.possession_end > today(now)) fail('end_in_future', 'An ended vehicle\'s end date cannot be in the future.');
      next.possession_end = args.possession_end;
    }
    checkDates(data, next);
    checkPlateFree(data, next, v.id);
    const before = {possession_start: v.possession_start, possession_end: v.possession_end, label: v.label};
    Object.assign(v, {label: next.label, possession_start: next.possession_start, possession_end: next.possession_end});
    history(v, ctx.virtual_now, 'updated', {from: before});
    return {vehicle: V.vehicleView(data, v)};
  },
  'vehicles.end'(ctx, data, args, now) {
    const v = R.vehicle(data, args.vehicle_id);
    if (v.ended_at) fail('invalid_state', `Vehicle ${v.id} already ended on ${v.possession_end}; correct the date with vehicles.update.`);
    const end = args.end_date ?? today(now);
    if (!C.validDate(end)) fail('invalid_arguments', 'end_date must be a valid YYYY-MM-DD date.');
    if (end < v.possession_start) fail('end_before_start', 'The end date is before the start date.');
    if (end > today(now)) fail('end_in_future', 'The end date cannot be in the future.');
    v.possession_end = end;
    v.ended_at = ctx.virtual_now;
    history(v, ctx.virtual_now, 'ended', {possession_end: end});
    unassign(data, v, ctx.virtual_now);
    return {vehicle: V.vehicleView(data, v),
      note: 'Notices already issued for tolls after the end date are not changed; dispute them.'};
  },
  'transponders.assign'(ctx, data, args) {
    const tp = R.transponder(data, args.transponder_id), v = R.vehicle(data, args.vehicle_id);
    if (v.ended_at) fail('invalid_state', `Vehicle ${v.id} has ended.`);
    if (tp.vehicle_id === v.id) fail('invalid_state', `Transponder ${tp.id} is already assigned to ${v.id}.`);
    const other = data.transponders.find(x => x.vehicle_id === v.id);
    if (other) fail('transponder_in_use', `Vehicle ${v.id} already has transponder ${other.id}.`);
    const from = {vehicle_id: tp.vehicle_id, class: tp.class};
    tp.vehicle_id = v.id;
    tp.class = v.class;
    history(tp, ctx.virtual_now, 'assigned', {vehicle_id: v.id, class: v.class, from});
    return {transponder: V.transponderView(data, tp)};
  },
  'notices.pay.preview'(ctx, data, args, now) {
    const lines = payLines(data, args.notice_ids);
    const c = R.card(data, args.card_id ?? data.replenish.card_id);
    R.requireChargeable(c, now);
    const total = lines.reduce((s, l) => s + l.amount_cents, 0);
    const p = previewRecord(ctx, data, now, {kind: 'pay', notice_ids: copy(args.notice_ids), lines, total_cents: total, card_id: c.id});
    return {preview: {...copy(p), card: cardSummary(c), final_text: FINAL}};
  },
  'notices.pay.confirm'(ctx, data, args, now) {
    const p = usePreview(ctx, data, args.preview_id, 'pay', now);
    const lines = payLines(data, p.notice_ids);
    for (const [i, line] of lines.entries()) {
      if (line.amount_cents !== p.lines[i].amount_cents) {
        fail('amount_changed', `Notice ${line.notice_id} is now ${money(line.amount_cents)}, not the previewed ${money(p.lines[i].amount_cents)}; preview again.`);
      }
    }
    const c = R.card(data, p.card_id);
    R.requireChargeable(c, now);
    p.used_at = ctx.virtual_now;
    const r = receipt(data, {kind: 'notice_payment', created_at: ctx.virtual_now, card_id: c.id, amount_cents: p.total_cents, notice_ids: copy(p.notice_ids)});
    for (const id of p.notice_ids) {
      const n = R.notice(data, id);
      n.state = 'paid';
      n.paid_at = ctx.virtual_now;
      n.payment_receipt_id = r.id;
      history(n, ctx.virtual_now, 'paid', {receipt_id: r.id, amount_cents: R.noticeAmount(n)});
    }
    notify(data, {at: ctx.virtual_now, kind: 'receipt', object_type: 'receipt', object_id: r.id,
      title: `Payment receipt: ${money(p.total_cents)} for ${p.notice_ids.length} toll notice${p.notice_ids.length > 1 ? 's' : ''}`,
      fields: [['Receipt', r.id], ...p.lines.map(l => [`Notice ${l.notice_id}`, `plate ${l.plate}, toll ${l.toll_date}, ${money(l.amount_cents)}`]),
        ['Total', money(p.total_cents)], ['Card', `${R.cardLabel(c)}, cardholder ${c.holder_name}`], ['Note', FINAL]]});
    return {receipt: copy(r), notices: p.notice_ids.map(id => V.noticeView(data, R.notice(data, id), now))};
  },
  'disputes.preview'(ctx, data, args, now) {
    const {n, draft} = disputeDraft(data, args, now);
    const pol = R.policy(data);
    const p = previewRecord(ctx, data, now, {kind: 'dispute', ...draft});
    return {preview: {...copy(p), notice: V.noticeView(data, n, now), rules: [
      `A notice can be disputed once, within ${pol.dispute_window_days} days of issue; this window closes ${R.disputeWindowCloses(data, n)}.`,
      'While the dispute is open, the notice\'s fees and due date are frozen and it cannot be paid.',
      `Granted: the notice is dismissed at $0.00. Denied: it returns to ${n.state}, due ${pol.denial_due_days} days after the decision. Withdrawn: it returns with the ${C.daysBetween(today(now), n.due_date)} days that remain now.`,
      'Evidence references are recorded as given; Crossway does not read other Apps.',
    ]}};
  },
  'disputes.confirm'(ctx, data, args, now) {
    const p = usePreview(ctx, data, args.preview_id, 'dispute', now);
    const n = R.notice(data, p.notice_id), block = R.disputeBlock(data, n, now);
    if (block) fail(block[0], block[1]);
    p.used_at = ctx.virtual_now;
    const d = {id: nextId(data.disputes, 'dp'), notice_id: n.id, reason: p.reason, transfer_date: p.transfer_date,
      agency_id: p.agency_id, transponder_id: p.transponder_id, explanation: p.explanation, evidence: copy(p.evidence),
      state: 'submitted', submitted_at: ctx.virtual_now, decided_at: null, withdrawn_at: null,
      prior_state: n.state, remaining_days: C.daysBetween(today(now), n.due_date), receipt_id: null};
    const r = receipt(data, {kind: 'dispute', created_at: ctx.virtual_now, notice_ids: [n.id], dispute_id: d.id});
    d.receipt_id = r.id;
    data.disputes.push(d);
    n.state = 'disputed';
    n.dispute_id = d.id;
    history(n, ctx.virtual_now, 'disputed', {dispute_id: d.id});
    notify(data, {at: ctx.virtual_now, kind: 'dispute_received', object_type: 'dispute', object_id: d.id,
      title: `Dispute ${d.id} received for toll notice ${n.id}`,
      fields: [['Dispute', d.id], ['Notice', n.id], ['Plate', n.plate], ['Reason', R.REASONS[d.reason].label],
        ['Evidence', d.evidence.map(e => `${e.app_id}/${e.account_id}/${e.object_id}`).join('; ') || 'none'],
        ['While open', 'fees and due date are frozen'], ['Receipt', r.id]]});
    return {dispute: copy(d), receipt: copy(r), notice: V.noticeView(data, n, now)};
  },
  'disputes.withdraw'(ctx, data, args, now) {
    const d = R.dispute(data, args.dispute_id);
    if (d.state !== 'submitted') fail('invalid_state', `Dispute ${d.id} is ${d.state}; only a submitted dispute can be withdrawn.`);
    const n = R.notice(data, d.notice_id);
    withdraw(data, d, n, ctx.virtual_now, now);
    return {dispute: copy(d), notice: V.noticeView(data, n, now)};
  },
};

function handleTool(ctx, data, name, args) {
  if (!name.startsWith(P)) fail('unknown_tool', 'Unknown Crossway operation.');
  const op = name.slice(P.length), now = C.ms(ctx.virtual_now);
  const {expected_version, request_id, ...input} = args;
  if (READS[op]) {
    // Compute due time effects on a copy so that reads never change state.
    const view = settle({...ctx, log: undefined}, copy(data));
    return {data, result: READS[op](view, input, now)};
  }
  if (!WRITES[op]) fail('unknown_tool', 'Unknown Crossway operation.');
  settle(ctx, data);
  const result = WRITES[op](ctx, data, input, now);
  log(ctx, 'crossway.' + op, {request_id: request_id || null});
  return {data, result};
}

module.exports = {handleTool, READS, WRITES};
