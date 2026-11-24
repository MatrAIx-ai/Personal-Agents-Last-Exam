'use strict';
// Workflow 2: billing. Claims carry the insurer's arithmetic; payments are allocated to claims; the balance is derived.
const c = require('./common.cjs');
const documents = require('./documents.cjs');
const messaging = require('./messaging.cjs');
const {fail, copy, parse, FINAL, money} = c;

function list(ctx, data, args) {
  const nowMs = c.now(ctx), status = args.status || 'all';
  const claims = data.claims.filter(cl => status === 'all' || (status === 'open' ? c.openBalance(data, cl) > 0 : cl.status === status))
    .map(cl => c.claimView(data, cl, nowMs)).sort((a, b) => b.service_date.localeCompare(a.service_date) || a.claim_id.localeCompare(b.claim_id));
  const payments = copy(data.payments).sort((a, b) => parse(b.at) - parse(a.at));
  const statements = copy(data.statements).sort((a, b) => b.period_start.localeCompare(a.period_start));
  return {summary:c.summary(data, nowMs), claims, payments, statements};
}
function getClaim(ctx, data, args) {
  const cl = c.claim(data, args.id), nowMs = c.now(ctx);
  const allocations = data.payments.flatMap(p => p.allocations.filter(a => a.claim_id === cl.claim_id).map(a => ({payment_id:p.payment_id, at:p.at, kind:p.kind, amount_cents:a.amount_cents})));
  return {claim:c.claimView(data, cl, nowMs), allocations, thread_ids:data.threads.filter(t => t.related.claim_id === cl.claim_id).map(t => t.thread_id)};
}
const statement = (ctx, data, args) => {const s = c.statement(data, args.id); return {statement:copy(s), file:documents.statementPdf(data, s)};};
function requestsList(ctx, data, args) {
  const status = args.status || 'all';
  return {requests:copy(data.billing_requests.filter(r => status === 'all' || r.status === status)).sort((a, b) => parse(b.created_at) - parse(a.created_at))};
}

function payPreview(ctx, data, args) {
  const nowMs = c.now(ctx);
  const targets = args.claim_ids ? args.claim_ids.map(id => c.claim(data, id)) : data.claims.filter(cl => c.openBalance(data, cl) > 0);
  for (const cl of targets) if (!FINAL.has(cl.status)) fail('claim_not_final', 'Claim ' + cl.claim_id + ' is still ' + cl.status.replace('_', ' ') + '; it can be paid once the insurer\'s decision is posted.');
  const open = targets.map(cl => [cl, c.openBalance(data, cl)]).filter(([, b]) => b > 0).sort((a, b) => a[0].service_date.localeCompare(b[0].service_date));
  const total = open.reduce((s, [, b]) => s + b, 0);
  if (args.amount_cents > total) fail('exceeds_balance', money(args.amount_cents) + ' exceeds the ' + (args.claim_ids ? 'selected claims\' balance' : 'balance due') + ' of ' + money(total) + '.');
  const allocations = [];
  let remaining = args.amount_cents;
  for (const [cl, balance] of open) {
    if (remaining <= 0) break;
    const amount = Math.min(balance, remaining);
    allocations.push({claim_id:cl.claim_id, amount_cents:amount});
    remaining -= amount;
  }
  const before = c.summary(data, nowMs).balance_due_cents;
  const p = {preview_id:c.nextId(data, 'pv-pay'), kind:'payment', created_at:ctx.virtual_now, expires_at:c.iso(nowMs + c.minutes(data.settings.preview_ttl_minutes)), approved:false, identity_verified:false,
    fingerprint:c.ledgerFingerprint(data, allocations.map(a => a.claim_id)), payload:{amount_cents:args.amount_cents, allocations, balance_before_cents:before, balance_after_cents:before - args.amount_cents}};
  data.previews.push(p);
  c.log(ctx, c.PREFIX + 'payment_previewed', {preview_id:p.preview_id});
  return {id:p.preview_id, ...copy(p.payload), expires_at:p.expires_at, approval_required:data.settings.require_user_confirmation};
}
function payConfirm(ctx, data, args) {
  const nowMs = c.now(ctx), p = c.livePreview(ctx, data, args.id, 'payment');
  const ids = p.payload.allocations.map(a => a.claim_id);
  if (c.ledgerFingerprint(data, ids) !== p.fingerprint) {
    const figures = ids.map(id => id + ' now ' + money(c.openBalance(data, c.claim(data, id))) + ' open').join(', ');
    fail('preview_stale', 'The ledger changed since preview ' + p.preview_id + ' (' + figures + '; balance due ' + money(c.summary(data, nowMs).balance_due_cents) + '). Request a new preview.');
  }
  c.gate(data, p, p.preview_id, 'Paying ' + money(p.payload.amount_cents));
  const card = data.patient.card_on_file;
  const payment = {payment_id:c.nextId(data, 'pay'), at:ctx.virtual_now, kind:'payment', amount_cents:p.payload.amount_cents, method:'portal_card_on_file', last4:card ? card.last4 : null,
    allocations:copy(p.payload.allocations), confirmation_number:'NLH-' + c.short(p.preview_id + '|' + ctx.virtual_now).toUpperCase().slice(0, 10), note:'Online payment from preview ' + p.preview_id};
  data.payments.push(payment);
  for (const a of payment.allocations) c.stampClaim(ctx, c.claim(data, a.claim_id), 'payment_applied', money(a.amount_cents) + ' from ' + payment.payment_id);
  c.dropPreview(data, p.preview_id);
  c.log(ctx, c.PREFIX + 'payment_posted', {payment_id:payment.payment_id});
  return {id:payment.payment_id, preview_id:p.preview_id, confirmation_number:payment.confirmation_number, amount_cents:payment.amount_cents, balance_cents:c.summary(data, nowMs).balance_due_cents, paid_at:ctx.virtual_now};
}
function question(ctx, data, args) {
  const cl = c.claim(data, args.id);
  return messaging.openThread(ctx, data, {category:'billing_office', subject:'Question about claim ' + cl.claim_id + ' (' + cl.description + ', ' + cl.service_date + ')', body:args.body, related:{claim_id:cl.claim_id}});
}
function requestCreate(ctx, data, args) {
  const cl = c.claim(data, args.id);
  if (data.billing_requests.some(r => r.claim_id === cl.claim_id && r.kind === args.kind && r.status === 'submitted')) fail('invalid_state', 'A ' + args.kind.replace('_', ' ') + ' request for claim ' + cl.claim_id + ' is already submitted.');
  if (args.kind === 'fee_waiver') {
    if (cl.kind !== 'fee') fail('invalid_state', 'Fee waivers apply to fee charges. Claim ' + cl.claim_id + ' is a ' + cl.kind + ' charge; ask a billing question or request a refund instead.');
    if (cl.patient_responsibility_cents === 0) fail('invalid_state', 'Claim ' + cl.claim_id + ' has no patient responsibility to waive.');
  } else {
    const paid = c.paidByPatient(data, cl.claim_id);
    if (paid <= 0) fail('invalid_state', 'Nothing has been paid on claim ' + cl.claim_id + ', so there is nothing to refund.');
    if (args.amount_cents !== undefined && args.amount_cents > paid) fail('exceeds_balance', 'A refund of ' + money(args.amount_cents) + ' exceeds the ' + money(paid) + ' paid on claim ' + cl.claim_id + '.');
  }
  c.draftGate(data, c.draftId({request:[args.id, args.kind, args.amount_cents ?? null, args.reason]}), 'Submitting this ' + args.kind.replace('_', ' ') + ' request');
  const r = {request_id:c.nextId(data, 'req'), kind:args.kind, claim_id:cl.claim_id, amount_cents:args.amount_cents ?? null, reason:args.reason, status:'submitted', decision_note:null,
    created_at:ctx.virtual_now, updated_at:ctx.virtual_now, history:[]};
  data.billing_requests.push(r);
  c.stamp(ctx, r, 'request_id', 'submitted');
  return {id:r.request_id, outcome:'submitted'};
}
// A late cancellation posts a fee charge. Fees have no insurer, so they are final at once with zero insurance amounts.
function postFee(ctx, data, a, f) {
  const fee = data.health_system.late_cancellation_fee_cents;
  const cl = {claim_id:c.nextId(data, 'clm-fee'), kind:'fee', service_date:f.day(parse(a.start)), provider_id:a.provider_id, clinic_id:a.clinic_id,
    description:'Late cancellation fee, visit of ' + f.day(parse(a.start)), status:'paid', billed_cents:fee, insurance_adjustment_cents:0, insurance_paid_cents:0,
    patient_responsibility_cents:fee, reason_code:null, statement_id:null, posted_at:ctx.virtual_now, updated_at:ctx.virtual_now,
    history:[{at:ctx.virtual_now, action:'fee_posted', status:'paid', detail:'Cancelled inside the ' + data.health_system.cancellation_notice_hours + '-hour notice window (' + a.appointment_id + ').'}]};
  data.claims.push(cl);
  c.log(ctx, c.PREFIX + 'fee_posted', {claim_id:cl.claim_id, appointment_id:a.appointment_id});
  return cl;
}
module.exports = {list, getClaim, statement, requestsList, payPreview, payConfirm, question, requestCreate, postFee};
