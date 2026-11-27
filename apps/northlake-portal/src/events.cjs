'use strict';
// Events Infra applies through env.apply_event. The handler reads the event's time as now (Core sets ctx.virtual_now to it).
const c = require('./common.cjs');
const messaging = require('./messaging.cjs');
const appointments = require('./appointments.cjs');
const {fail, parse, FINAL, money, cents} = c;

function patient(data) {return {role:'patient', display_name:data.patient.name};}
function decided(ctx, data, cl, p, action) {
  const amounts = {billed:cents(p.billed, 'billed'), adj:cents(p.insurance_adjustment, 'insurance_adjustment'), paid:cents(p.insurance_paid, 'insurance_paid'), resp:cents(p.patient_responsibility, 'patient_responsibility')};
  if (amounts.adj + amounts.paid + amounts.resp !== amounts.billed) fail('invalid_event', 'Billed amount must equal insurance adjustment plus insurance payment plus patient responsibility.');
  if ((p.result === 'denied') !== (p.reason_code !== null && p.reason_code !== undefined)) fail('invalid_event', 'A denial needs a reason code; a paid claim has none.');
  if (c.paidByPatient(data, cl.claim_id) > amounts.resp) fail('invalid_event', 'Patient responsibility cannot fall below what the patient already paid on claim ' + cl.claim_id + '.');
  cl.status = p.result; cl.billed_cents = amounts.billed; cl.insurance_adjustment_cents = amounts.adj; cl.insurance_paid_cents = amounts.paid; cl.patient_responsibility_cents = amounts.resp;
  cl.reason_code = p.result === 'denied' ? p.reason_code : null;
  c.stampClaim(ctx, cl, action, p.result === 'denied' ? 'Denied: ' + p.reason_code : 'Insurer paid ' + money(amounts.paid) + ', adjusted ' + money(amounts.adj) + '; you owe ' + money(amounts.resp));
}

const HANDLERS = {
  'portal.staff_reply'(ctx, data, p) {
    const t = c.thread(data, p.thread_id);
    if (t.status === 'closed') fail('thread_closed', 'Thread ' + t.thread_id + ' is closed' + (t.closed_reason ? ' (' + t.closed_reason + ')' : '') + '; the staff reply was not added.');
    const m = messaging.addMessage(ctx, data, t, p.author, p.body, false);
    messaging.attach(ctx, data, m, p.attachments);
    c.stamp(ctx, t, 'thread_id', 'staff_replied', p.author.display_name);
  },
  'portal.thread_closed'(ctx, data, p) {
    const t = c.thread(data, p.thread_id);
    if (t.status === 'closed') fail('thread_closed', 'Thread ' + t.thread_id + ' is already closed.');
    t.status = 'closed'; t.awaiting = null; t.closed_reason = p.reason;
    c.stamp(ctx, t, 'thread_id', 'closed', p.reason);
  },
  'portal.billing.post'(ctx, data, p) {
    if (p.kind === 'claim_posted') {
      if (data.claims.some(x => x.claim_id === p.claim_id)) fail('invalid_event', 'Claim ' + p.claim_id + ' already exists.');
      c.clinic(data, p.clinic_id);
      if (p.provider_id !== null) c.provider(data, p.provider_id);
      data.claims.push({claim_id:p.claim_id, kind:p.claim_kind, service_date:p.service_date, provider_id:p.provider_id, clinic_id:p.clinic_id, description:p.description, status:'in_adjudication',
        billed_cents:cents(p.billed, 'billed'), insurance_adjustment_cents:0, insurance_paid_cents:0, patient_responsibility_cents:0, reason_code:null, statement_id:null,
        posted_at:ctx.virtual_now, updated_at:ctx.virtual_now, history:[{at:ctx.virtual_now, action:'claim_posted', status:'in_adjudication', detail:'Billed ' + money(cents(p.billed, 'billed')) + ' to ' + data.patient.insurance.payer}]});
      c.log(ctx, c.PREFIX + 'claim_posted', {claim_id:p.claim_id});
      return;
    }
    const cl = c.claim(data, p.claim_id);
    if (p.kind === 'adjudicated') {
      if (FINAL.has(cl.status)) fail('invalid_event', 'Claim ' + cl.claim_id + ' is already ' + cl.status + '; use kind reprocessed for a denied claim.');
      decided(ctx, data, cl, p, 'adjudicated');
    } else {
      if (cl.status !== 'denied') fail('invalid_event', 'Claim ' + cl.claim_id + ' is ' + cl.status.replace('_', ' ') + '; only a denied claim can be reprocessed.');
      cl.status = 'reprocessing';
      c.stampClaim(ctx, cl, 'resubmitted', 'Corrected claim resubmitted to ' + data.patient.insurance.payer);
      decided(ctx, data, cl, p, 'reprocessed');
    }
  },
  'portal.billing.statement_ready'(ctx, data, p) {
    if (data.statements.some(s => s.statement_id === p.statement_id)) fail('invalid_event', 'Statement ' + p.statement_id + ' already exists.');
    if (p.period_start > p.period_end) fail('invalid_event', 'Statement period is reversed.');
    const nowMs = c.now(ctx), endMs = parse(p.period_end + 'T23:59:59Z');
    const inPeriod = cl => cl.service_date >= p.period_start && cl.service_date <= p.period_end;
    const claims = data.claims.filter(cl => inPeriod(cl) || (cl.statement_id === null && parse(cl.posted_at) <= endMs));
    for (const cl of claims) if (cl.statement_id === null) cl.statement_id = p.statement_id;
    const payments = data.payments.filter(pm => c.dayOf(pm.at) >= p.period_start && c.dayOf(pm.at) <= p.period_end);
    const summary = c.summary(data, nowMs);
    data.statements.push({statement_id:p.statement_id, period_start:p.period_start, period_end:p.period_end, generated_at:ctx.virtual_now, past_due_note:p.past_due_note,
      claim_ids:claims.map(cl => cl.claim_id), payment_ids:payments.map(pm => pm.payment_id), balance_due_cents:summary.balance_due_cents, past_due_cents:summary.past_due_cents,
      filename:'northlake-statement-' + p.period_start + '-to-' + p.period_end + '.pdf'});
    c.log(ctx, c.PREFIX + 'statement_ready', {statement_id:p.statement_id});
  },
  'portal.billing.request_decided'(ctx, data, p) {
    const r = c.request(data, p.request_id);
    if (r.status !== 'submitted') fail('invalid_event', 'Request ' + r.request_id + ' was already ' + r.status + '.');
    const cl = c.claim(data, r.claim_id);
    r.status = p.decision; r.decision_note = p.note;
    c.stamp(ctx, r, 'request_id', p.decision, p.note || null);
    if (p.decision !== 'granted') return;
    if (r.kind === 'fee_waiver') {
      cl.insurance_adjustment_cents += cl.patient_responsibility_cents; cl.patient_responsibility_cents = 0;
      c.stampClaim(ctx, cl, 'fee_waived', 'Waiver ' + r.request_id + ' granted');
    } else {
      const amount = r.amount_cents ?? c.paidByPatient(data, cl.claim_id);
      if (amount <= 0 || amount > c.paidByPatient(data, cl.claim_id)) fail('invalid_event', 'Refund exceeds what was paid on claim ' + cl.claim_id + '.');
      data.payments.push({payment_id:c.nextId(data, 'rf'), at:ctx.virtual_now, kind:'refund', amount_cents:amount, method:'portal_refund', last4:data.patient.card_on_file ? data.patient.card_on_file.last4 : null,
        allocations:[{claim_id:cl.claim_id, amount_cents:amount}], confirmation_number:'RF-' + c.short(r.request_id + '|' + ctx.virtual_now).toUpperCase().slice(0, 10), note:'Refund granted on request ' + r.request_id});
      cl.patient_responsibility_cents -= amount; cl.insurance_adjustment_cents += amount;
      c.stampClaim(ctx, cl, 'refund_posted', money(amount) + ' refunded on request ' + r.request_id);
    }
  },
  'portal.appointment.update'(ctx, data, p) {
    const nowMs = c.now(ctx), a = c.appointment(data, p.appointment_id);
    if (appointments.effectiveStatus(a, nowMs) !== 'booked') fail('not_booked', 'Appointment ' + a.appointment_id + ' is not booked.');
    if (p.kind === 'cancelled') {
      a.status = 'cancelled_by_clinic'; a.cancellation_reason = p.reason;
      c.slot(data, a.slot_id).status = 'open';
      c.stamp(ctx, a, 'appointment_id', 'cancelled_by_clinic', p.reason);
      return;
    }
    if (!p.new_slot_id) fail('invalid_event', 'A moved appointment needs new_slot_id.');
    const s = c.slot(data, p.new_slot_id);
    if (s.provider_id !== a.provider_id) fail('invalid_event', 'The new slot is with another provider.');
    if (s.status !== 'open') fail('invalid_event', 'Slot ' + s.slot_id + ' is ' + s.status + '.');
    appointments.moveTo(ctx, data, a, s, 'moved_by_clinic');
    a.cancellation_reason = null;
    a.history[a.history.length - 1].detail = p.reason + '; moved to ' + a.replaced_by;
  },
  'portal.appointment.reminder'(ctx, data, p) {
    const a = c.appointment(data, p.appointment_id);
    if (appointments.effectiveStatus(a, c.now(ctx)) !== 'booked') fail('not_booked', 'Appointment ' + a.appointment_id + ' is ' + a.status.replace(/_/g, ' ') + '; no reminder was sent.');
    a.reminder_sent_at = ctx.virtual_now;
    c.stamp(ctx, a, 'appointment_id', 'reminder_sent');
  },
  'portal.slot.taken'(ctx, data, p) {
    const s = c.slot(data, p.slot_id);
    if (data.appointments.some(a => a.slot_id === s.slot_id && a.status === 'booked')) fail('slot_booked', 'The patient already holds slot ' + s.slot_id + '.');
    if (s.status === 'taken') fail('invalid_event', 'Slot ' + s.slot_id + ' is already taken.');
    s.status = 'taken';
    for (const e of data.waitlist) if (e.status === 'offered' && e.offer.slot_id === s.slot_id) {
      e.status = 'waiting'; const offer = e.offer; e.offer = null;
      c.stamp(ctx, e, 'waitlist_entry_id', 'offer_withdrawn', 'Slot ' + s.slot_id + ' was taken (offer ' + offer.offer_id + ')');
    }
    c.log(ctx, c.PREFIX + 'slot_taken', {slot_id:s.slot_id});
  },
  'portal.waitlist.offer'(ctx, data, p) {
    appointments.expireOffers(ctx, data);
    const e = c.entry(data, p.waitlist_entry_id), s = c.slot(data, p.slot_id);
    if (e.status !== 'waiting') fail('invalid_event', 'Waitlist entry ' + e.waitlist_entry_id + ' is ' + e.status + ', not waiting.');
    if (s.provider_id !== e.provider_id || s.status !== 'open') fail('invalid_event', 'Slot ' + s.slot_id + ' is not an open slot with this provider.');
    if (parse(p.offer_expires_at) <= c.now(ctx)) fail('invalid_event', 'The offer must expire after it is made.');
    e.status = 'offered'; e.offer = {offer_id:c.nextId(data, 'offer'), slot_id:s.slot_id, offered_at:ctx.virtual_now, offer_expires_at:p.offer_expires_at, approved:false, identity_verified:false};
    c.stamp(ctx, e, 'waitlist_entry_id', 'offered', 'Slot ' + s.slot_id + ' until ' + p.offer_expires_at);
  },
  'portal.page.interstitial'(ctx, data, p) {
    if (data.interstitial && data.interstitial.status === 'pending') fail('invalid_event', 'Interstitial ' + data.interstitial.interstitial_id + ' is already pending.');
    if (c.allIds(data).includes(p.interstitial_id)) fail('invalid_event', 'ID ' + p.interstitial_id + ' is already used.');
    data.interstitial = {interstitial_id:p.interstitial_id, kind:p.kind, clearable_by:p.clearable_by, text:p.text, status:'pending', set_at:ctx.virtual_now, cleared_at:null, cleared_by:null};
    c.log(ctx, c.PREFIX + 'interstitial_set', {interstitial_id:p.interstitial_id});
  },
  'user.confirmed'(ctx, data, p) {
    const nowMs = c.now(ctx);
    if (p.preview_id !== undefined) {
      const pv = data.previews.find(x => x.preview_id === p.preview_id);
      if (!pv || nowMs > parse(pv.expires_at)) fail('unknown_target', 'No live preview ' + p.preview_id + '.');
      pv.approved = true; c.log(ctx, c.PREFIX + 'user_confirmed', {preview_id:pv.preview_id}); return;
    }
    if (p.offer_id !== undefined) {
      const e = data.waitlist.find(x => x.offer && x.offer.offer_id === p.offer_id && x.status === 'offered' && parse(x.offer.offer_expires_at) >= nowMs);
      if (!e) fail('unknown_target', 'No open offer ' + p.offer_id + '.');
      e.offer.approved = true; c.log(ctx, c.PREFIX + 'user_confirmed', {offer_id:p.offer_id}); return;
    }
    if (p.interstitial_id !== undefined) {
      const i = data.interstitial;
      if (!i || i.interstitial_id !== p.interstitial_id || i.status !== 'pending') fail('unknown_target', 'No pending interstitial ' + p.interstitial_id + '.');
      i.status = 'cleared'; i.cleared_at = ctx.virtual_now; i.cleared_by = 'user'; c.log(ctx, c.PREFIX + 'interstitial_cleared', {interstitial_id:i.interstitial_id}); return;
    }
    if (!/^draft-[a-f0-9]{16}$/.test(p.draft_id)) fail('unknown_target', 'Draft IDs look like draft-<16 hex characters>.');
    if (data.approvals.some(a => a.target_id === p.draft_id)) fail('unknown_target', 'Draft ' + p.draft_id + ' is already approved.');
    data.approvals.push({target_id:p.draft_id, at:ctx.virtual_now});
    c.log(ctx, c.PREFIX + 'user_confirmed', {draft_id:p.draft_id});
  },
  'user.identity_verified'(ctx, data, p) {
    const nowMs = c.now(ctx);
    if (p.preview_id !== undefined) {
      const pv = data.previews.find(x => x.preview_id === p.preview_id && x.kind === 'appointment');
      if (!pv || nowMs > parse(pv.expires_at)) fail('unknown_target', 'No live appointment preview ' + p.preview_id + '.');
      pv.identity_verified = true; c.log(ctx, c.PREFIX + 'identity_verified', {preview_id:pv.preview_id}); return;
    }
    const e = data.waitlist.find(x => x.offer && x.offer.offer_id === p.offer_id && x.status === 'offered' && parse(x.offer.offer_expires_at) >= nowMs);
    if (!e) fail('unknown_target', 'No open offer ' + p.offer_id + '.');
    e.offer.identity_verified = true; c.log(ctx, c.PREFIX + 'identity_verified', {offer_id:p.offer_id});
  }
};
function applyEvent(ctx, data, event) {
  const handler = HANDLERS[event.operation];
  if (!handler) fail('invalid_event', 'Unsupported operation.');
  handler(ctx, data, event.payload);
  c.log(ctx, c.PREFIX + 'event_applied', {event_id:event.event_id, operation:event.operation});
  return data;
}
module.exports = {applyEvent};
