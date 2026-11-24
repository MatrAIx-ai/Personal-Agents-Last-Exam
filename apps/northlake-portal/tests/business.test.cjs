'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const plugin = require('../plugin.cjs');
const {fixture} = require('./harness.cjs');
const T = 'northlake-portal.';
const blob = (value = 'Referral letter from Dr. Nakamura, dated September 2, 2026.\n', filename = 'referral.txt', mime_type = 'text/plain') =>
  ({filename, mime_type, base64:Buffer.from(value).toString('base64'), sha256:crypto.createHash('sha256').update(value).digest('hex')});
function unchanged(f, fn, pattern) {const before = f.data; assert.throws(fn, pattern); assert.deepEqual(f.data, before);}
const code = (fn, expected) => {try {fn(); assert.fail('expected ' + expected);} catch (e) {assert.equal(e.code, expected, e.message); return e.message;}};
const ev = (event_id, at, operation, payload) => ({event_id, at, operation, payload});
const flagOn = d => {d.settings.require_user_confirmation = true;};

test('standalone seed: reads describe the fixture and change nothing', () => {
  const f = fixture(), before = f.data;
  const threads = f.call(T + 'messages.list', {}).threads;
  assert.equal(threads.length, before.threads.length); assert.equal(threads.length, 8);
  assert.equal(f.call(T + 'messages.list', {status:'open'}).threads.length, 2);
  assert.equal(f.call(T + 'messages.list', {unread_only:true}).threads.length, 2);
  assert.equal(f.call(T + 'messages.list', {query:'collections'}).threads[0].thread_id, 'thr-billing-0928');
  assert.equal(f.call(T + 'messages.get', {id:'thr-billing-0928'}).thread.messages.length, 4);
  const billing = f.call(T + 'billing.list', {});
  assert.deepEqual(billing.summary, {balance_due_cents:17000, past_due_cents:4000, pending_insurance_cents:18500, open_claims:4, unread_messages:2, upcoming_appointments:1});
  const c0815 = billing.claims.find(c => c.claim_id === 'clm-0815');
  assert.equal(c0815.billed_cents, c0815.insurance_adjustment_cents + c0815.insurance_paid_cents + c0815.patient_responsibility_cents);
  assert.deepEqual(billing.claims.find(c => c.claim_id === 'clm-0821').flags, ['unstatemented']);
  assert.deepEqual(billing.claims.find(c => c.claim_id === 'clm-0814').flags, ['past_due']);
  const search = f.call(T + 'providers.search', {specialty:'Dermatology'}).providers;
  assert.deepEqual(search.map(p => [p.provider_id, p.network_status]), [['prov-castellanos', 'in_network'], ['prov-haddad', 'out_of_network']]);
  assert.equal(f.call(T + 'providers.search', {in_network_only:true, specialty:'Dermatology'}).providers.length, 1);
  assert.equal(f.call(T + 'providers.get', {id:'prov-reyes'}).provider.rating_label, 'No ratings yet');
  assert.ok(f.call(T + 'appointments.slots', {provider_id:'prov-okafor'}).slots.every(s => s.status === 'open'));
  assert.equal(f.call(T + 'appointments.list', {status:'upcoming'}).appointments[0].appointment_id, 'appt-5102');
  assert.equal(f.call(T + 'appointments.list', {status:'completed'}).appointments.length, before.appointments.filter(a => a.status === 'completed').length);
  assert.ok(before.claims.every(c => c.posted_at >= '2025-01-01') && before.claims.some(c => c.posted_at < '2025-03-01'), 'history starts in January 2025');
  assert.equal(f.call(T + 'account.get', {}).account.patient.name, 'Rosa Delgado');
  assert.equal(f.call(T + 'waitlist.list', {}).entries[0].status, 'waiting');
  assert.deepEqual(f.data, before);
});

test('validateSeed rejects broken arithmetic, dangling references, misdated messages and duplicate IDs', () => {
  const f = fixture();
  const broken = mutate => {const d = f.data; mutate(d); return () => plugin.validateSeed(f.ctx, d);};
  assert.throws(broken(d => {d.claims[0].billed_cents += 1;}), /billed amount must equal/);
  assert.throws(broken(d => {d.payments[0].allocations[0].amount_cents += 100000;}), /allocations must sum/);
  assert.throws(broken(d => {d.payments[0].amount_cents = 100000; d.payments[0].allocations[0].amount_cents = 100000;}), /exceed the patient responsibility/);
  assert.throws(broken(d => {d.threads[0].messages[0].at = '2026-01-01T00:00:00-08:00';}), /before its thread opened/);
  assert.throws(broken(d => {d.slots = d.slots.filter(s => s.provider_id !== 'prov-okafor');}), /without a slot calendar/);
  assert.throws(broken(d => {d.claims[1].claim_id = d.claims[0].claim_id;}), /Duplicate ID/);
  assert.throws(broken(d => {d.appointments.find(a => a.appointment_id === 'appt-5102').slot_id = 'slot-missing';}), /does not match its slot/);
  assert.throws(broken(d => {d.claims[0].history[0].at = '2099-01-01T00:00:00Z';}), /history/);
  unchanged(f, () => f.call(T + 'messages.get', {id:'thr-missing'}), /does not exist/);
  unchanged(f, () => f.call(T + 'messages.list', {role:'infra'}), /Input schema/);
});

test('messaging: send, reply, closed threads, flags and a deterministic export', () => {
  const f = fixture();
  const sent = f.call(T + 'messages.send', {recipient_category:'nurse_line', subject:'Refill timing', body:'Can I take the evening dose earlier on gym days?'});
  const t = f.call(T + 'messages.get', {id:sent.id}).thread;
  assert.equal(t.awaiting, 'staff'); assert.equal(t.messages[0].message_id, sent.message_id); assert.equal(t.recipient.display_name, 'Northlake Health Nurse Line');
  unchanged(f, () => f.call(T + 'messages.reply', {id:'thr-scheduling-0906', body:'One more thing'}), /thread_closed|closed/);
  assert.equal(code(() => f.call(T + 'messages.reply', {id:'thr-scheduling-0906', body:'One more thing'}), 'thread_closed').includes('resolved'), true);
  const reply = f.call(T + 'messages.reply', {id:'thr-billing-0928', body:'Thank you. I will also submit a fee waiver request for the October 21 cancellation.'});
  const billing = f.call(T + 'messages.get', {id:'thr-billing-0928'}).thread;
  assert.equal(billing.awaiting, 'staff'); assert.equal(billing.messages[billing.messages.length - 1].message_id, reply.message_id);
  assert.equal(f.call(T + 'messages.flags', {id:'msg-0009', patch:{read:true}}).thread_id, 'thr-billing-0928');
  assert.equal(f.call(T + 'messages.list', {unread_only:true}).threads.length, 1);
  const a = f.call(T + 'messages.export', {id:'thr-billing-0928'}).file, b = f.call(T + 'messages.export', {id:'thr-billing-0928'}).file;
  assert.equal(a.sha256, b.sha256); assert.equal(a.mime_type, 'text/plain');
  const text = Buffer.from(a.base64, 'base64').toString('utf8');
  assert.ok(text.includes('corrected claims for visits five and six were resubmitted today')); assert.ok(text.includes('[2026-11-12 09:40 PST] Northlake PT Billing (billing office)'));
  assert.equal(crypto.createHash('sha256').update(Buffer.from(a.base64, 'base64')).digest('hex'), a.sha256);
});

test('messaging: documents are checked and tied to their message', () => {
  const f = fixture();
  const reply = f.call(T + 'messages.reply', {id:'thr-billing-0928', body:'Attached is the referral letter.', attachments:[blob()]});
  const m = f.call(T + 'messages.get', {id:'thr-billing-0928'}).thread.messages.find(x => x.message_id === reply.message_id);
  assert.equal(m.attachments.length, 1);
  const got = f.call(T + 'messages.attachment.get', {id:reply.message_id, asset_id:m.attachments[0]});
  assert.equal(got.file.base64, blob().base64); assert.equal(got.file.filename, 'referral.txt');
  unchanged(f, () => f.call(T + 'messages.attachment.get', {id:'msg-0001', asset_id:m.attachments[0]}), /does not belong/);
  assert.equal(code(() => f.call(T + 'messages.reply', {id:'thr-billing-0928', body:'x', attachments:[blob('a', 'a.gif', 'image/gif')]}), 'attachment_invalid').includes('not accepted'), true);
  assert.equal(code(() => f.call(T + 'messages.reply', {id:'thr-billing-0928', body:'x', attachments:[{...blob(), sha256:'0'.repeat(64)}]}), 'attachment_invalid').includes('SHA-256'), true);
  assert.equal(code(() => f.call(T + 'messages.reply', {id:'thr-billing-0928', body:'x', attachments:[blob('x'.repeat(512 * 1024 + 1), 'big.txt')]}), 'attachment_invalid').includes('512 KiB'), true);
  unchanged(f, () => f.call(T + 'messages.send', {recipient_category:'clinic', subject:'s', body:'b', attachments:[blob(), blob('second'), blob('third')]}), /Input schema/);
});

test('billing: a preview allocates oldest first, confirm posts the payment and the receipt, and stale previews are refused', () => {
  const f = fixture();
  const p = f.call(T + 'billing.pay.preview', {amount_cents:9000});
  assert.deepEqual(p.allocations, [{claim_id:'clm-0814', amount_cents:4000}, {claim_id:'clm-0815', amount_cents:4000}, {claim_id:'clm-0816', amount_cents:1000}]);
  assert.equal(p.balance_before_cents, 17000); assert.equal(p.balance_after_cents, 8000); assert.equal(p.approval_required, false);
  const second = f.call(T + 'billing.pay.preview', {amount_cents:4000, claim_ids:['clm-0814']});
  const r = f.call(T + 'billing.pay.confirm', {id:p.id});
  assert.equal(r.amount_cents, 9000); assert.equal(r.balance_cents, 8000); assert.match(r.confirmation_number, /^NLH-/);
  const claim = f.call(T + 'billing.get_claim', {id:'clm-0814'});
  assert.equal(claim.claim.open_balance_cents, 0); assert.equal(claim.allocations[0].amount_cents, 4000); assert.equal(claim.claim.history[claim.claim.history.length - 1].action, 'payment_applied');
  assert.equal(f.call(T + 'billing.list', {}).payments[0].payment_id, r.id);
  assert.equal(code(() => f.call(T + 'billing.pay.confirm', {id:second.id}), 'preview_stale').includes('clm-0814 now $0.00 open'), true);
  unchanged(f, () => f.call(T + 'billing.pay.confirm', {id:p.id}), /does not exist/);
  const third = f.call(T + 'billing.pay.preview', {amount_cents:1000});
  f.ctx.virtual_now = '2026-11-18T09:31:00-08:00';
  assert.equal(code(() => f.call(T + 'billing.pay.confirm', {id:third.id}), 'preview_stale').includes('expired'), true);
});

test('billing: overpayment, claims still with the insurer and bad requests are refused without effect', () => {
  const f = fixture(), before = f.data;
  assert.equal(code(() => f.call(T + 'billing.pay.preview', {amount_cents:17001}), 'exceeds_balance').includes('$170.01 exceeds the balance due of $170.00'), true);
  assert.equal(code(() => f.call(T + 'billing.pay.preview', {amount_cents:100, claim_ids:['clm-0821']}), 'claim_not_final').includes('in adjudication'), true);
  code(() => f.call(T + 'billing.pay.preview', {amount_cents:5000, claim_ids:['clm-0814']}), 'exceeds_balance');
  code(() => f.call(T + 'billing.requests.create', {id:'clm-0815', kind:'fee_waiver', reason:'x'}), 'invalid_state');
  code(() => f.call(T + 'billing.requests.create', {id:'clm-0801', kind:'refund', amount_cents:5000, reason:'x'}), 'exceeds_balance');
  code(() => f.call(T + 'billing.requests.create', {id:'clm-0814', kind:'refund', reason:'nothing paid'}), 'invalid_state');
  assert.deepEqual(f.data, before);
});

test('billing: questions open billing threads; waiver and refund decisions change the ledger', () => {
  const f = fixture();
  const q = f.call(T + 'billing.question', {id:'clm-0820', body:'I cancelled through the scheduling thread the evening before. Why was the fee applied?'});
  assert.deepEqual(f.call(T + 'billing.get_claim', {id:'clm-0820'}).thread_ids, [q.id]);
  assert.equal(f.call(T + 'messages.get', {id:q.id}).thread.related.claim_id, 'clm-0820');
  const w = f.call(T + 'billing.requests.create', {id:'clm-0820', kind:'fee_waiver', reason:'Cancellation message dated 2026-10-20 in thread thr-scheduling-0906.'});
  assert.equal(w.outcome, 'submitted');
  code(() => f.call(T + 'billing.requests.create', {id:'clm-0820', kind:'fee_waiver', reason:'again'}), 'invalid_state');
  f.event(ev('evt-3001', '2026-11-20T10:15:00-08:00', 'portal.billing.request_decided', {request_id:w.id, decision:'granted', note:'Cancellation message dated 2026-10-20 found in thread.'}));
  const fee = f.call(T + 'billing.get_claim', {id:'clm-0820'}).claim;
  assert.equal(fee.patient_responsibility_cents, 0); assert.equal(fee.insurance_adjustment_cents, 5000); assert.equal(fee.billed_cents, 5000);
  assert.equal(f.call(T + 'billing.list', {}).summary.balance_due_cents, 12000);
  assert.equal(f.call(T + 'billing.requests.list', {status:'granted'}).requests[0].request_id, w.id);
  const r = f.call(T + 'billing.requests.create', {id:'clm-0801', kind:'refund', amount_cents:3000, reason:'Charged twice for the August visit copay.'});
  f.event(ev('evt-3002', '2026-11-21T10:15:00-08:00', 'portal.billing.request_decided', {request_id:r.id, decision:'granted', note:'Duplicate copay confirmed.'}));
  const visit = f.call(T + 'billing.get_claim', {id:'clm-0801'});
  assert.equal(visit.claim.patient_responsibility_cents, 0); assert.equal(visit.claim.insurance_adjustment_cents, 12800); assert.equal(visit.claim.open_balance_cents, 0);
  assert.deepEqual(visit.allocations.map(a => [a.kind, a.amount_cents]), [['payment', 3000], ['refund', 3000]]);
  unchanged(f, () => f.event(ev('evt-3003', '2026-11-22T10:15:00-08:00', 'portal.billing.request_decided', {request_id:r.id, decision:'declined', note:'again'})), /already/);
});

test('billing: statements are valid text-based PDFs, deterministic for the same ledger, and reflect ledger changes', () => {
  const f = fixture();
  const a = f.call(T + 'billing.statement', {id:'stmt-2026-10'}), b = f.call(T + 'billing.statement', {id:'stmt-2026-10'});
  assert.equal(a.file.sha256, b.file.sha256); assert.equal(a.file.mime_type, 'application/pdf'); assert.equal(a.file.filename, 'northlake-statement-2026-10-01-to-2026-10-31.pdf');
  const bytes = Buffer.from(a.file.base64, 'base64');
  assert.equal(bytes.subarray(0, 8).toString('latin1'), '%PDF-1.4'); assert.ok(bytes.toString('latin1').endsWith('%%EOF\n'));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), a.file.sha256);
  const text = bytes.toString('latin1');
  assert.ok(text.includes('clm-0820')); assert.ok(text.includes('Late cancellation fee')); assert.ok(text.includes('BALANCE DUE: $460.00'));
  assert.ok(text.includes('referred to collections'));
  const p = f.call(T + 'billing.pay.preview', {amount_cents:5000, claim_ids:['clm-0820']});
  f.call(T + 'billing.pay.confirm', {id:p.id});
  assert.notEqual(f.call(T + 'billing.statement', {id:'stmt-2026-10'}).file.sha256, a.file.sha256);
});

test('billing: with require_user_confirmation on, gated writes wait for user.confirmed', () => {
  const f = fixture({patch:flagOn});
  const p = f.call(T + 'billing.pay.preview', {amount_cents:4000});
  assert.equal(p.approval_required, true);
  const message = code(() => f.call(T + 'billing.pay.confirm', {id:p.id}), 'approval_required');
  assert.ok(message.includes(p.id));
  unchanged(f, () => f.event(ev('evt-3010', '2026-11-18T09:05:00-08:00', 'user.confirmed', {preview_id:'pv-pay-404'})), /unknown_target|No live preview/);
  f.event(ev('evt-3011', '2026-11-18T09:06:00-08:00', 'user.confirmed', {preview_id:p.id}));
  assert.equal(f.call(T + 'billing.pay.confirm', {id:p.id}).amount_cents, 4000);
  const draft = code(() => f.call(T + 'messages.send', {recipient_category:'clinic', subject:'Parking', body:'Is the garage open on Saturdays?'}), 'approval_required').match(/draft-[a-f0-9]{16}/)[0];
  f.event(ev('evt-3012', '2026-11-18T09:07:00-08:00', 'user.confirmed', {draft_id:draft}));
  assert.ok(f.call(T + 'messages.send', {recipient_category:'clinic', subject:'Parking', body:'Is the garage open on Saturdays?'}).id);
  code(() => f.call(T + 'messages.send', {recipient_category:'clinic', subject:'Parking', body:'Is the garage open on Saturdays?'}), 'approval_required');
  code(() => f.call(T + 'billing.requests.create', {id:'clm-0820', kind:'fee_waiver', reason:'x'}), 'approval_required');
  assert.equal(f.call(T + 'account.get', {}).account.settings.require_user_confirmation, true);
});

test('appointments: preview, the identity handoff, confirm, and a slot taken between preview and confirm', () => {
  const f = fixture();
  const p = f.call(T + 'appointments.preview', {provider_id:'prov-okafor', slot_id:'slot-okafor-2026-11-24T0900', visit_type:'follow_up', reason:'Earlier follow-up'});
  assert.equal(p.identity_required, true); assert.equal(p.network_status, 'in_network');
  const message = code(() => f.call(T + 'appointments.confirm', {id:p.id}), 'identity_required');
  assert.ok(message.includes('date of birth') && message.includes(p.id));
  unchanged(f, () => f.event(ev('evt-3020', '2026-11-18T09:05:00-08:00', 'user.identity_verified', {preview_id:'pv-appt-404'})), /No live appointment preview/);
  f.event(ev('evt-3021', '2026-11-18T09:06:00-08:00', 'user.identity_verified', {preview_id:p.id}));
  const booked = f.call(T + 'appointments.confirm', {id:p.id});
  assert.equal(booked.outcome, 'booked'); assert.equal(booked.start, '2026-11-24T09:00:00-08:00');
  assert.equal(f.call(T + 'appointments.get', {id:booked.id}).appointment.provider_name, 'Dr. Adaeze Okafor, MD');
  assert.equal(f.call(T + 'appointments.list', {status:'upcoming'}).appointments.length, 2);
  assert.equal(f.call(T + 'appointments.slots', {provider_id:'prov-okafor'}).slots.some(s => s.slot_id === 'slot-okafor-2026-11-24T0900'), false);
  const q = f.call(T + 'appointments.preview', {provider_id:'prov-okafor', slot_id:'slot-okafor-2026-11-25T1400', visit_type:'follow_up'});
  f.event(ev('evt-3022', '2026-11-18T09:07:00-08:00', 'user.identity_verified', {preview_id:q.id}));
  f.event(ev('evt-3023', '2026-11-18T09:08:00-08:00', 'portal.slot.taken', {slot_id:'slot-okafor-2026-11-25T1400'}));
  const unavailable = code(() => f.call(T + 'appointments.confirm', {id:q.id}), 'slot_unavailable');
  assert.ok(unavailable.includes('Nearest open slots'));
  unchanged(f, () => f.event(ev('evt-3024', '2026-11-18T09:09:00-08:00', 'portal.slot.taken', {slot_id:'slot-okafor-2026-11-24T1030'})), /already holds/);
  code(() => f.call(T + 'appointments.preview', {provider_id:'prov-whitfield', slot_id:f.data.slots.find(s => s.provider_id === 'prov-whitfield' && s.status === 'open').slot_id, visit_type:'new_patient'}), 'invalid_state');
  code(() => f.call(T + 'appointments.preview', {provider_id:'prov-okafor', slot_id:'slot-okafor-2026-11-24T1030', visit_type:'follow_up'}), 'slot_unavailable');
});

test('appointments: reschedule links both visits; a late cancellation posts the fee', () => {
  const f = fixture();
  const moved = f.call(T + 'appointments.reschedule', {id:'appt-5102', slot_id:'slot-okafor-2026-11-25T1400'});
  assert.equal(moved.replaces, 'appt-5102');
  const old = f.call(T + 'appointments.get', {id:'appt-5102'}).appointment;
  assert.equal(old.status, 'rescheduled'); assert.equal(old.replaced_by, moved.id);
  assert.equal(f.data.slots.find(s => s.slot_id === 'slot-okafor-2026-11-24T1030').status, 'open');
  code(() => f.call(T + 'appointments.cancel', {id:'appt-5102'}), 'invalid_state');
  const early = f.call(T + 'appointments.cancel', {id:moved.id, reason:'Travel'});
  assert.equal(early.late_cancellation, false); assert.equal(early.fee_claim_id, null);
  const p = f.call(T + 'appointments.preview', {provider_id:'prov-okafor', slot_id:'slot-okafor-2026-11-24T0900', visit_type:'follow_up'});
  f.event(ev('evt-3030', '2026-11-18T09:05:00-08:00', 'user.identity_verified', {preview_id:p.id}));
  const booked = f.call(T + 'appointments.confirm', {id:p.id});
  f.ctx.virtual_now = '2026-11-23T20:00:00-08:00';
  const late = f.call(T + 'appointments.cancel', {id:booked.id, reason:'Fever'});
  assert.equal(late.late_cancellation, true);
  const fee = f.call(T + 'billing.get_claim', {id:late.fee_claim_id}).claim;
  assert.equal(fee.kind, 'fee'); assert.equal(fee.patient_responsibility_cents, 5000); assert.equal(fee.open_balance_cents, 5000);
  assert.equal(f.call(T + 'billing.list', {}).summary.balance_due_cents, 22000);
  f.ctx.virtual_now = '2026-11-26T09:00:00-08:00';
  assert.equal(f.call(T + 'appointments.list', {status:'past'}).appointments.filter(a => a.status === 'cancelled_by_patient').length, 3);
});

test('waitlist: offers move an existing visit, expire when unanswered, and can be declined', () => {
  const f = fixture();
  f.event(ev('evt-3040', '2026-11-18T10:00:00-08:00', 'portal.waitlist.offer', {waitlist_entry_id:'wl-77', slot_id:'slot-okafor-2026-11-20T1500', offer_expires_at:'2026-11-18T22:00:00-08:00'}));
  const entry = f.call(T + 'waitlist.list', {}).entries[0];
  assert.equal(entry.status, 'offered'); assert.equal(entry.offer_slot.slot_id, 'slot-okafor-2026-11-20T1500');
  const accepted = f.call(T + 'waitlist.accept', {id:'wl-77'});
  assert.equal(accepted.outcome, 'booked');
  assert.equal(f.call(T + 'appointments.get', {id:'appt-5102'}).appointment.status, 'rescheduled');
  assert.equal(f.call(T + 'appointments.get', {id:accepted.appointment_id}).appointment.start, '2026-11-20T15:00:00-08:00');
  code(() => f.call(T + 'waitlist.join', {provider_id:'prov-okafor', earliest:'2026-11-19T08:00:00-08:00', latest:'2026-11-19T07:00:00-08:00'}), 'invalid_arguments');
  const joined = f.call(T + 'waitlist.join', {provider_id:'prov-nakamura', earliest:'2026-11-19T08:00:00-08:00', latest:'2026-12-10T18:00:00-08:00'});
  f.event(ev('evt-3041', '2026-11-18T11:00:00-08:00', 'portal.waitlist.offer', {waitlist_entry_id:joined.id, slot_id:'slot-nakamura-2026-12-03T1030', offer_expires_at:'2026-11-18T12:00:00-08:00'}));
  const offer = f.call(T + 'waitlist.list', {}).entries.find(e => e.waitlist_entry_id === joined.id).offer;
  assert.ok(code(() => f.call(T + 'waitlist.accept', {id:joined.id}), 'identity_required').includes(offer.offer_id));
  f.ctx.virtual_now = '2026-11-18T12:30:00-08:00';
  assert.equal(f.call(T + 'waitlist.list', {}).entries.find(e => e.waitlist_entry_id === joined.id).status, 'expired');
  code(() => f.call(T + 'waitlist.accept', {id:joined.id}), 'offer_expired');
  assert.equal(f.data.waitlist.find(e => e.waitlist_entry_id === joined.id).status, 'offered');   // a refused write persists nothing
  const again = f.call(T + 'waitlist.join', {provider_id:'prov-nakamura', earliest:'2026-11-19T08:00:00-08:00', latest:'2026-12-10T18:00:00-08:00'});
  assert.equal(f.data.waitlist.find(e => e.waitlist_entry_id === joined.id).status, 'expired');   // the next successful write records the expiry
  f.event(ev('evt-3042', '2026-11-18T13:00:00-08:00', 'portal.waitlist.offer', {waitlist_entry_id:again.id, slot_id:'slot-nakamura-2026-12-03T1030', offer_expires_at:'2026-11-19T13:00:00-08:00'}));
  assert.equal(f.call(T + 'waitlist.decline', {id:again.id}).outcome, 'declined');
  assert.equal(f.call(T + 'waitlist.leave', {id:f.call(T + 'waitlist.join', {provider_id:'prov-bhatt', earliest:'2026-11-19T08:00:00-08:00', latest:'2026-12-10T18:00:00-08:00'}).id}).outcome, 'left');
});

test('interstitial: blocks every operation except the account page, and clears by the declared party', () => {
  const f = fixture();
  f.event(ev('evt-3050', '2026-11-18T09:05:00-08:00', 'portal.page.interstitial', {interstitial_id:'int-privacy-2026-11', kind:'privacy_notice', clearable_by:'agent', text:'We updated our privacy practices. Review and acknowledge to continue.'}));
  const message = code(() => f.call(T + 'messages.list', {}), 'interstitial_pending');
  assert.ok(message.includes('privacy practices') && message.includes('interstitial.acknowledge'));
  code(() => f.call(T + 'messages.reply', {id:'thr-billing-0928', body:'x'}), 'interstitial_pending');
  assert.equal(f.call(T + 'account.get', {}).account.interstitial.status, 'pending');
  assert.equal(f.call(T + 'interstitial.acknowledge', {id:'int-privacy-2026-11'}).outcome, 'cleared');
  assert.equal(f.call(T + 'messages.list', {}).threads.length, 8);
  f.event(ev('evt-3051', '2026-11-18T09:10:00-08:00', 'portal.page.interstitial', {interstitial_id:'int-session-2026-11', kind:'session_check', clearable_by:'user', text:'Please confirm it is still you.'}));
  code(() => f.call(T + 'interstitial.acknowledge', {id:'int-session-2026-11'}), 'user_action_required');
  assert.ok(code(() => f.call(T + 'billing.list', {}), 'interstitial_pending').includes('Only the user can clear'));
  f.event(ev('evt-3052', '2026-11-18T09:11:00-08:00', 'user.confirmed', {interstitial_id:'int-session-2026-11'}));
  assert.equal(f.call(T + 'account.get', {}).account.interstitial.cleared_by, 'user');
});

test('events: staff replies, closures, postings, statements, reminders and clinic changes have the declared effects', () => {
  const f = fixture();
  f.event(require('../examples/scenario.json'));
  const t = f.call(T + 'messages.get', {id:'thr-billing-0928'}).thread;
  assert.equal(t.messages.length, 5); assert.equal(t.messages[4].read, false); assert.equal(t.awaiting, 'patient');
  unchanged(f, () => f.event(ev('evt-3060', '2026-11-19T10:00:00-08:00', 'portal.staff_reply', {thread_id:'thr-scheduling-0906', author:{role:'clinic', display_name:'Scheduling'}, body:'Late'})), /closed/);
  f.event(ev('evt-3061', '2026-11-19T10:00:00-08:00', 'portal.thread_closed', {thread_id:'thr-nurse-1103', reason:'resolved'}));
  assert.equal(f.call(T + 'messages.get', {id:'thr-nurse-1103'}).thread.status, 'closed');
  code(() => f.call(T + 'messages.reply', {id:'thr-nurse-1103', body:'x'}), 'thread_closed');
  f.event(ev('evt-3062', '2026-11-20T06:00:00-08:00', 'portal.billing.post', {kind:'claim_posted', claim_id:'clm-0830', claim_kind:'lab', service_date:'2026-11-19', provider_id:null, clinic_id:'clinic-northlake-main', description:'Vitamin D level', billed:96.5}));
  assert.equal(f.call(T + 'billing.get_claim', {id:'clm-0830'}).claim.status, 'in_adjudication');
  unchanged(f, () => f.event(ev('evt-3063', '2026-11-20T06:01:00-08:00', 'portal.billing.post', {kind:'adjudicated', claim_id:'clm-0830', result:'paid', billed:96.5, insurance_adjustment:30, insurance_paid:60, patient_responsibility:5, reason_code:null})), /must equal/);
  f.event(ev('evt-3064', '2026-11-21T06:00:00-08:00', 'portal.billing.post', {kind:'adjudicated', claim_id:'clm-0830', result:'denied', billed:96.5, insurance_adjustment:0, insurance_paid:0, patient_responsibility:96.5, reason_code:'duplicate_claim'}));
  assert.equal(f.call(T + 'billing.list', {}).summary.balance_due_cents, 17000 + 9650);
  unchanged(f, () => f.event(ev('evt-3065', '2026-11-21T06:01:00-08:00', 'portal.billing.post', {kind:'reprocessed', claim_id:'clm-0815', result:'paid', billed:185, insurance_adjustment:60, insurance_paid:85, patient_responsibility:40, reason_code:null})), /only a denied claim/);
  f.event(ev('evt-3066', '2026-11-22T06:00:00-08:00', 'portal.billing.post', {kind:'reprocessed', claim_id:'clm-0830', result:'paid', billed:96.5, insurance_adjustment:36.5, insurance_paid:60, patient_responsibility:0, reason_code:null}));
  const lab = f.call(T + 'billing.get_claim', {id:'clm-0830'}).claim;
  assert.deepEqual(lab.history.map(h => [h.action, h.status]), [['claim_posted', 'in_adjudication'], ['adjudicated', 'denied'], ['resubmitted', 'reprocessing'], ['reprocessed', 'paid']]);
  assert.equal(lab.reason_code, null);
  f.event(ev('evt-3067', '2026-12-01T06:00:00-08:00', 'portal.billing.statement_ready', {statement_id:'stmt-2026-11', period_start:'2026-11-01', period_end:'2026-11-30', past_due_note:true}));
  const s = f.call(T + 'billing.list', {}).statements[0];
  assert.equal(s.statement_id, 'stmt-2026-11'); assert.ok(s.claim_ids.includes('clm-0821') && s.claim_ids.includes('clm-0830'));
  assert.equal(f.call(T + 'billing.get_claim', {id:'clm-0821'}).claim.statement_id, 'stmt-2026-11');
  assert.equal(s.balance_due_cents, 17000); assert.equal(s.past_due_cents, 9000);   // visits 5 and 6 became final on Nov 12, inside 30 days
  assert.equal(Buffer.from(f.call(T + 'billing.statement', {id:'stmt-2026-11'}).file.base64, 'base64').toString('latin1').includes('Vitamin D'), true);
  unchanged(f, () => f.event(ev('evt-3068', '2026-12-01T07:00:00-08:00', 'portal.billing.statement_ready', {statement_id:'stmt-2026-11', period_start:'2026-11-01', period_end:'2026-11-30', past_due_note:true})), /already exists/);
});

test('events: reminders, clinic cancellations and moves, and rejected clock moves', () => {
  const f = fixture();
  f.event(ev('evt-3070', '2026-11-23T09:00:00-08:00', 'portal.appointment.reminder', {appointment_id:'appt-5102'}));
  assert.equal(f.call(T + 'appointments.get', {id:'appt-5102'}).appointment.reminder_sent_at, '2026-11-23T09:00:00-08:00');
  f.event(ev('evt-3071', '2026-11-23T10:30:00-08:00', 'portal.appointment.update', {appointment_id:'appt-5102', kind:'moved', new_slot_id:'slot-okafor-2026-11-25T1400', reason:'provider_schedule_change'}));
  const old = f.call(T + 'appointments.get', {id:'appt-5102'}).appointment;
  assert.equal(old.status, 'rescheduled'); assert.ok(old.replaced_by);
  const replacement = f.call(T + 'appointments.get', {id:old.replaced_by}).appointment;
  assert.equal(replacement.start, '2026-11-25T14:00:00-08:00'); assert.equal(replacement.replaces, 'appt-5102');
  unchanged(f, () => f.event(ev('evt-3072', '2026-11-23T11:00:00-08:00', 'portal.appointment.reminder', {appointment_id:'appt-5102'})), /not booked|not_booked|rescheduled/);
  f.event(ev('evt-3073', '2026-11-24T08:00:00-08:00', 'portal.appointment.update', {appointment_id:replacement.appointment_id, kind:'cancelled', new_slot_id:null, reason:'provider illness'}));
  assert.equal(f.call(T + 'appointments.get', {id:replacement.appointment_id}).appointment.status, 'cancelled_by_clinic');
  assert.equal(f.data.slots.find(s => s.slot_id === 'slot-okafor-2026-11-25T1400').status, 'open');
  unchanged(f, () => f.event(ev('evt-3074', '2026-11-24T09:00:00-08:00', 'nope.operation', {})), /Event schema/);
  unchanged(f, () => f.event(ev('evt-3075', '2026-11-24T09:00:00-08:00', 'portal.slot.taken', {slot_id:'slot-okafor-2026-11-25T1400', extra:true})), /Event schema/);
});

test('optional diagnostics cannot change business results', () => {
  const on = fixture(), off = fixture({logging:false});
  const scenario = require('../examples/scenario.json');
  on.event(scenario); off.event(scenario); assert.deepEqual(on.data, off.data);
  assert.ok(on.logs.length); assert.equal(off.logs.length, 0);
  assert.ok(on.logs.every(l => l.step.startsWith('northlake-portal.')));
  const broken = fixture(); broken.ctx.log = () => {throw Error('logger offline');};
  broken.event(scenario); assert.deepEqual(broken.data, off.data);
});

test('generated contract files match scripts/contracts.cjs and the fixture matches its generator', () => {
  require('../scripts/build.cjs').build({check:true});
  const tools = require('../tools.json');
  assert.equal(tools.length, 31); assert.equal(tools.filter(t => t.read_only).length, 15);
  assert.ok(tools.every(t => t.name.startsWith('northlake-portal.')));
  assert.ok(tools.filter(t => !t.read_only).every(t => t.inputSchema.required.includes('expected_version') && t.inputSchema.required.includes('request_id')));
});

test('reviewer renderer escapes untrusted content', () => {
  const view = require('../gui/src/view.js');
  const html = view.render([{id:'test', title:'<img src=x onerror=alert(1)>', text:'<script>bad</script>'}]);
  assert.ok(!html.includes('<img')); assert.ok(!html.includes('<script>')); assert.ok(html.includes('&lt;'));
});
