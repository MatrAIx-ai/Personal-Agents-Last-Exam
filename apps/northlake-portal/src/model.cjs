'use strict';
// Seed validation and the data-relationship hooks Core calls. Reports facts about records; grants nothing.
const c = require('./common.cjs');
const {fail, parse, FINAL} = c;

function timeline(created, updated, history, what) {
  if (parse(created) > parse(updated)) fail('invalid_seed', what + ': timestamps are reversed.');
  let previous = parse(created);
  for (const h of history) {
    const at = parse(h.at);
    if (!Number.isFinite(at) || at < previous || at > parse(updated)) fail('invalid_seed', what + ': history is out of order.');
    previous = at;
  }
  if (!history.length || previous !== parse(updated)) fail('invalid_seed', what + ': history must end with the last update.');
}

function validateSeed(ctx, data) {
  c.references(ctx, data);
  const seen = new Map();
  const unique = (id, what) => {
    if (seen.has(id)) fail('invalid_seed', 'Duplicate ID ' + id + ' (' + what + ' and ' + seen.get(id) + ').');
    seen.set(id, what);
  };
  unique(data.patient.patient_id, 'patient');
  if (data.interstitial) {
    unique(data.interstitial.interstitial_id, 'interstitial');
    if ((data.interstitial.status === 'cleared') !== (data.interstitial.cleared_at !== null)) fail('invalid_seed', 'A cleared interstitial needs cleared_at; a pending one must not have it.');
  }
  const clinics = new Set();
  for (const x of data.clinics) {unique(x.clinic_id, 'clinic'); clinics.add(x.clinic_id);}
  const providers = new Map();
  for (const p of data.providers) {
    unique(p.provider_id, 'provider'); providers.set(p.provider_id, p);
    if (!clinics.has(p.clinic_id)) fail('invalid_seed', 'Provider ' + p.provider_id + ' names unknown clinic ' + p.clinic_id + '.');
    if ((p.rating === null) !== (p.review_count === 0)) fail('invalid_seed', 'Provider ' + p.provider_id + ': a rating needs reviews and reviews need a rating.');
  }
  const slots = new Map();
  for (const s of data.slots) {
    unique(s.slot_id, 'slot'); slots.set(s.slot_id, s);
    const p = providers.get(s.provider_id);
    if (!p) fail('invalid_seed', 'Slot ' + s.slot_id + ' names unknown provider ' + s.provider_id + '.');
    if (s.clinic_id !== p.clinic_id) fail('invalid_seed', 'Slot ' + s.slot_id + ' is not at its provider\'s clinic.');
    if (parse(s.start) >= parse(s.end)) fail('invalid_seed', 'Slot ' + s.slot_id + ' ends before it starts.');
  }
  const appointments = new Map();
  for (const a of data.appointments) {
    unique(a.appointment_id, 'appointment'); appointments.set(a.appointment_id, a);
    if (!providers.has(a.provider_id)) fail('invalid_seed', 'Appointment ' + a.appointment_id + ' names unknown provider ' + a.provider_id + '.');
    if (!data.slots.some(s => s.provider_id === a.provider_id)) fail('invalid_seed', 'Appointment ' + a.appointment_id + ' is on a provider without a slot calendar.');
    const s = slots.get(a.slot_id);
    if (!s || s.provider_id !== a.provider_id || s.start !== a.start || s.end !== a.end || s.clinic_id !== a.clinic_id) fail('invalid_seed', 'Appointment ' + a.appointment_id + ' does not match its slot.');
    if (a.status === 'booked' && s.status !== 'booked') fail('invalid_seed', 'Booked appointment ' + a.appointment_id + ' sits on a slot marked ' + s.status + '.');
    if ((a.status === 'rescheduled') !== (a.replaced_by !== null)) fail('invalid_seed', 'Appointment ' + a.appointment_id + ': rescheduled appointments link to their replacement.');
    if (a.status.startsWith('cancelled') !== (a.cancellation_reason !== null) && a.status === 'cancelled_by_clinic') fail('invalid_seed', 'Appointment ' + a.appointment_id + ': clinic cancellations need a reason.');
    timeline(a.created_at, a.updated_at, a.history, 'Appointment ' + a.appointment_id);
  }
  for (const a of data.appointments) {
    if (a.replaced_by !== null && !appointments.has(a.replaced_by)) fail('invalid_seed', 'Appointment ' + a.appointment_id + ' is replaced by unknown ' + a.replaced_by + '.');
    if (a.replaces !== null && !appointments.has(a.replaces)) fail('invalid_seed', 'Appointment ' + a.appointment_id + ' replaces unknown ' + a.replaces + '.');
  }
  for (const s of data.slots) {
    const n = data.appointments.filter(a => a.slot_id === s.slot_id && a.status === 'booked').length;
    if ((s.status === 'booked') !== (n === 1) || n > 1) fail('invalid_seed', 'Slot ' + s.slot_id + ' is ' + s.status + ' but has ' + n + ' booked appointment(s).');
  }
  for (const w of data.waitlist) {
    unique(w.waitlist_entry_id, 'waitlist entry');
    if (!providers.has(w.provider_id)) fail('invalid_seed', 'Waitlist entry ' + w.waitlist_entry_id + ' names unknown provider.');
    if (w.appointment_id !== null && !appointments.has(w.appointment_id)) fail('invalid_seed', 'Waitlist entry ' + w.waitlist_entry_id + ' names unknown appointment.');
    if (w.booked_appointment_id !== null && !appointments.has(w.booked_appointment_id)) fail('invalid_seed', 'Waitlist entry ' + w.waitlist_entry_id + ' names unknown booked appointment.');
    if (parse(w.earliest) >= parse(w.latest)) fail('invalid_seed', 'Waitlist entry ' + w.waitlist_entry_id + ': earliest must precede latest.');
    if (w.status === 'offered' && w.offer === null) fail('invalid_seed', 'Waitlist entry ' + w.waitlist_entry_id + ': an offered entry must carry its offer.');
    if (w.status === 'waiting' && w.offer !== null) fail('invalid_seed', 'Waitlist entry ' + w.waitlist_entry_id + ': a waiting entry has no open offer.');
    if (w.offer) {unique(w.offer.offer_id, 'offer'); if (!slots.has(w.offer.slot_id)) fail('invalid_seed', 'Offer ' + w.offer.offer_id + ' names unknown slot.');}
    timeline(w.created_at, w.updated_at, w.history, 'Waitlist entry ' + w.waitlist_entry_id);
  }
  const claims = new Map();
  for (const cl of data.claims) {
    unique(cl.claim_id, 'claim'); claims.set(cl.claim_id, cl);
    if (!clinics.has(cl.clinic_id)) fail('invalid_seed', 'Claim ' + cl.claim_id + ' names unknown clinic.');
    if (cl.provider_id !== null && !providers.has(cl.provider_id)) fail('invalid_seed', 'Claim ' + cl.claim_id + ' names unknown provider.');
    const sum = cl.insurance_adjustment_cents + cl.insurance_paid_cents + cl.patient_responsibility_cents;
    if (cl.status === 'in_adjudication' ? sum !== 0 : sum !== cl.billed_cents) fail('invalid_seed', 'Claim ' + cl.claim_id + ': billed amount must equal insurance adjustment plus insurance payment plus patient responsibility' + (cl.status === 'in_adjudication' ? ', and nothing is decided while in adjudication.' : '.'));
    if ((cl.status === 'denied') !== (cl.reason_code !== null) && cl.status !== 'reprocessing') fail('invalid_seed', 'Claim ' + cl.claim_id + ': denied claims carry a reason code and only they do.');
    timeline(cl.posted_at, cl.updated_at, cl.history, 'Claim ' + cl.claim_id);
    if (cl.history[cl.history.length - 1].status !== cl.status) fail('invalid_seed', 'Claim ' + cl.claim_id + ': history must end in the current status.');
  }
  const paid = new Map();
  for (const p of data.payments) {
    unique(p.payment_id, 'payment');
    let total = 0;
    for (const a of p.allocations) {
      if (!claims.has(a.claim_id)) fail('invalid_seed', 'Payment ' + p.payment_id + ' is applied to unknown claim ' + a.claim_id + '.');
      total += a.amount_cents;
      paid.set(a.claim_id, (paid.get(a.claim_id) || 0) + (p.kind === 'refund' ? -a.amount_cents : a.amount_cents));
    }
    if (total !== p.amount_cents) fail('invalid_seed', 'Payment ' + p.payment_id + ': allocations must sum to the amount.');
  }
  for (const [id, amount] of paid) {
    const cl = claims.get(id);
    if (amount < 0) fail('invalid_seed', 'Claim ' + id + ': refunds exceed payments.');
    if (amount > cl.patient_responsibility_cents) fail('invalid_seed', 'Claim ' + id + ': payments exceed the patient responsibility.');
    if (amount > 0 && !FINAL.has(cl.status)) fail('invalid_seed', 'Claim ' + id + ': a claim still with the insurer cannot carry payments.');
  }
  for (const r of data.billing_requests) {
    unique(r.request_id, 'request');
    if (!claims.has(r.claim_id)) fail('invalid_seed', 'Request ' + r.request_id + ' names unknown claim.');
    if ((r.status === 'submitted') === (r.decision_note !== null)) fail('invalid_seed', 'Request ' + r.request_id + ': decided requests carry a decision note and only they do.');
    timeline(r.created_at, r.updated_at, r.history, 'Request ' + r.request_id);
  }
  const statements = new Set();
  for (const s of data.statements) {
    unique(s.statement_id, 'statement'); statements.add(s.statement_id);
    if (s.period_start > s.period_end) fail('invalid_seed', 'Statement ' + s.statement_id + ': period is reversed.');
    for (const id of s.claim_ids) if (!claims.has(id)) fail('invalid_seed', 'Statement ' + s.statement_id + ' lists unknown claim ' + id + '.');
    for (const id of s.payment_ids) if (!data.payments.some(p => p.payment_id === id)) fail('invalid_seed', 'Statement ' + s.statement_id + ' lists unknown payment ' + id + '.');
  }
  for (const cl of data.claims) if (cl.statement_id !== null && !statements.has(cl.statement_id)) fail('invalid_seed', 'Claim ' + cl.claim_id + ' names unknown statement.');
  const messages = new Set();
  for (const t of data.threads) {
    unique(t.thread_id, 'thread');
    if (t.related.claim_id !== null && !claims.has(t.related.claim_id)) fail('invalid_seed', 'Thread ' + t.thread_id + ' relates to unknown claim.');
    if (t.related.appointment_id !== null && !appointments.has(t.related.appointment_id)) fail('invalid_seed', 'Thread ' + t.thread_id + ' relates to unknown appointment.');
    if ((t.status === 'closed') !== (t.awaiting === null)) fail('invalid_seed', 'Thread ' + t.thread_id + ': open threads await someone; closed threads await nobody.');
    let previous = parse(t.opened_at);
    for (const m of t.messages) {
      unique(m.message_id, 'message'); messages.add(m.message_id);
      if (parse(m.at) < parse(t.opened_at)) fail('invalid_seed', 'Message ' + m.message_id + ' is dated before its thread opened.');
      if (parse(m.at) < previous) fail('invalid_seed', 'Thread ' + t.thread_id + ': messages are out of order.');
      previous = parse(m.at);
      if (parse(m.at) > parse(t.updated_at)) fail('invalid_seed', 'Message ' + m.message_id + ' is newer than its thread.');
    }
    timeline(t.opened_at, t.updated_at, t.history, 'Thread ' + t.thread_id);
  }
  for (const p of data.previews) {
    unique(p.preview_id, 'preview');
    if ((p.kind === 'payment') !== ('amount_cents' in p.payload)) fail('invalid_seed', 'Preview ' + p.preview_id + ': payload does not match its kind.');
    if (p.kind === 'appointment' && !slots.has(p.payload.slot_id)) fail('invalid_seed', 'Preview ' + p.preview_id + ' names unknown slot.');
    if (parse(p.created_at) >= parse(p.expires_at)) fail('invalid_seed', 'Preview ' + p.preview_id + ' expires before it was created.');
  }
  for (const a of data.approvals) unique(a.target_id, 'approval');
  const plan = data.patient.insurance.plan_id;
  if (!data.providers.some(p => p.networks.some(n => n.plan_id === plan))) fail('invalid_seed', 'No provider declares network status for the insurance plan on file.');
}

// Account-level business records (used for dataset counts and asset ownership).
function records(data) {
  return [...data.threads, ...data.threads.flatMap(t => t.messages), ...data.claims, ...data.payments, ...data.billing_requests, ...data.statements, ...data.appointments, ...data.waitlist];
}
const KEYS = ['thread_id', 'message_id', 'claim_id', 'payment_id', 'request_id', 'statement_id', 'appointment_id', 'waitlist_entry_id'];
const objects = data => records(data).map(r => r[KEYS.find(k => k in r)]);
const assetReferences = data => data.threads.flatMap(t => t.messages.flatMap(m => m.attachments.map(asset_id => ({asset_id, object_id:m.message_id, object_type:'message'}))));

module.exports = {validateSeed, records, objects, references:() => [], assetReferences};
