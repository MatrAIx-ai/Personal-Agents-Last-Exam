'use strict';
// W2 Forms and permission slips: T04–T08.
const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture, ev} = require('./harness.cjs');

const QUESTIONS = [
  {id: 'q-lunch', type: 'choice', label: 'Lunch', options: ['school_sack_lunch', 'bring_own'], required: true},
  {id: 'q-emergency', type: 'text', label: 'Emergency phone for the day', required: true}];
const ANSWERS = {'q-lunch': 'bring_own', 'q-emergency': '555-0100'};
function publish(f, at = '2026-11-17T07:30:00-08:00', extra = {}) {
  return f.event(ev('form.published', at, {form_id: 'form-aquarium', school_id: 'school-alder', child_ids: ['child-theo', 'child-ines'],
    kind: 'permission_slip', title: 'Grade 3 aquarium trip', text: 'Bus leaves 08:45 on 4 December and returns by 14:30.',
    questions: QUESTIONS, fee_cents: 1800, event_date: '2026-12-04', due_at: '2026-11-25T16:00:00-08:00', ...extra}));
}
const sign = (f, extra = {}) => f.call('bellnote.forms.respond', {id: 'form-aquarium', child_id: 'child-theo', action: 'sign', form_version: 1, answers: ANSWERS, ...extra});
function refused(f, name, args, code) {
  const before = f.data, rev = f.revision, r = f.try(name, args);
  assert.equal(r.status, code, name + ' should be refused with ' + code + ': ' + r.message);
  assert.deepEqual(f.data, before); assert.equal(f.revision, rev);
}
const paidFor = (f, responseId) => f.data.payments.filter(p => p.object_id === responseId);

test('T04 forms list by child and phase; forms.get shows text, questions, fee, due time and version; closed at the due-time boundary', () => {
  const f = fixture();
  const n0 = f.data.notifications.filter(n => n.kind === 'form.published').length;
  publish(f);
  assert.equal(f.data.notifications.filter(n => n.kind === 'form.published').length, n0 + 1);
  assert.deepEqual(f.call('bellnote.forms.list', {child_id: 'child-theo'}).forms.map(x => x.id), ['form-fluclinic', 'form-aquarium']);
  assert.deepEqual(f.call('bellnote.forms.list', {child_id: 'child-nico'}).forms, []);
  const form = f.call('bellnote.forms.get', {id: 'form-aquarium'}).form;
  assert.equal(form.version, 1); assert.equal(form.fee_cents, 1800); assert.equal(form.phase, 'open');
  assert.equal(form.due_at, '2026-11-25T16:00:00-08:00'); assert.equal(form.questions.length, 2);
  assert.match(form.text, /4 December/);
  assert.deepEqual(form.responses.map(r => r.state), ['unanswered', 'unanswered']);
  assert.equal(f.try('bellnote.forms.get', {id: 'form-none'}).status, 'not_found');
  // Phase follows the clock: open one second before the due time, closed at it, with no write.
  const stored = JSON.stringify(f.data);
  f.advance('2026-11-25T15:59:59-08:00');
  assert.deepEqual(f.call('bellnote.forms.list', {phase: 'open'}).forms.map(x => x.id), ['form-aquarium'], 'The flu form closed on the 24th');
  f.advance('2026-11-25T16:00:00-08:00');
  assert.deepEqual(f.call('bellnote.forms.list', {phase: 'closed'}).forms.map(x => x.id), ['form-fluclinic', 'form-aquarium']);
  assert.equal(JSON.stringify(f.data), stored, 'Closing is derived from the clock; nothing is written');
  refused(f, 'bellnote.forms.respond', {id: 'form-aquarium', child_id: 'child-theo', action: 'sign', form_version: 1, answers: ANSWERS}, 'closed');
});

test('T05 sign and decline; required answers and types; one answer per form and child across both guardians', () => {
  const f = fixture();
  publish(f);
  refused(f, 'bellnote.forms.respond', {id: 'form-aquarium', child_id: 'child-theo', action: 'sign', form_version: 1, answers: {'q-lunch': 'bring_own'}}, 'missing_answer');
  refused(f, 'bellnote.forms.respond', {id: 'form-aquarium', child_id: 'child-theo', action: 'sign', form_version: 1, answers: {...ANSWERS, 'q-lunch': 'pizza'}}, 'missing_answer');
  refused(f, 'bellnote.forms.respond', {id: 'form-aquarium', child_id: 'child-theo', action: 'sign', form_version: 1, answers: {...ANSWERS, 'q-emergency': true}}, 'missing_answer');
  refused(f, 'bellnote.forms.respond', {id: 'form-aquarium', child_id: 'child-theo', action: 'sign', form_version: 1, answers: {...ANSWERS, 'q-other': 'x'}}, 'missing_answer');
  refused(f, 'bellnote.forms.respond', {id: 'form-aquarium', child_id: 'child-nico', action: 'sign', form_version: 1, answers: ANSWERS}, 'not_found');
  const signed = sign(f);
  assert.equal(signed.state, 'signed');
  refused(f, 'bellnote.forms.respond', {id: 'form-aquarium', child_id: 'child-theo', action: 'decline', form_version: 1}, 'already_answered');
  const declined = f.call('bellnote.forms.respond', {id: 'form-aquarium', child_id: 'child-ines', action: 'decline', form_version: 1});
  assert.equal(declined.state, 'declined'); assert.equal(declined.charged_cents, 0);
  // The other guardian's answer holds the form for that child.
  refused(f, 'bellnote.forms.respond', {id: 'form-fluclinic', child_id: 'child-theo', action: 'sign', form_version: 1, answers: {'q-consent-allergies': 'none'}}, 'already_answered');
  refused(f, 'bellnote.forms.withdraw', {id: 'fr-0001'}, 'not_yours');
  // The other guardian answers Ines's flu form by event; I cannot answer over it.
  const n0 = f.data.notifications.length;
  f.event(ev('form.answered', '2026-11-17T08:00:00-08:00', {form_id: 'form-fluclinic', child_id: 'child-ines', by_guardian_id: 'person-dana',
    action: 'sign', form_version: 1, answers: {'q-consent-allergies': 'none'}}));
  assert.equal(f.data.notifications.length, n0 + 1);
  assert.equal(f.data.notifications.at(-1).kind, 'form.answered');
  refused(f, 'bellnote.forms.respond', {id: 'form-fluclinic', child_id: 'child-ines', action: 'decline', form_version: 1}, 'already_answered');
  // And the other guardian cannot answer over mine.
  const second = f.tryEvent(ev('form.answered', '2026-11-17T08:05:00-08:00', {form_id: 'form-aquarium', child_id: 'child-theo', by_guardian_id: 'person-dana',
    action: 'sign', form_version: 1, answers: ANSWERS}));
  assert.equal(second.status, 'invalid_event');
  // Once they withdraw, I can answer.
  f.event(ev('form.answered', '2026-11-17T08:10:00-08:00', {form_id: 'form-fluclinic', child_id: 'child-ines', by_guardian_id: 'person-dana', action: 'withdraw'}));
  assert.equal(f.call('bellnote.forms.respond', {id: 'form-fluclinic', child_id: 'child-ines', action: 'decline', form_version: 1}).state, 'declined');
  const resp = f.call('bellnote.forms.get', {id: 'form-fluclinic'}).form.responses.find(r => r.child_id === 'child-ines');
  assert.equal(resp.by_person_id, 'person-maya'); assert.ok(resp.history.length >= 3, 'History keeps both guardians\' answers');
});

test('T06 fees: charged once on signing, declined and expired cards, refund on withdrawal, can_pay and can_sign checked separately', () => {
  const f = fixture();
  publish(f, '2026-11-17T07:30:00-08:00', {due_at: '2026-12-10T16:00:00-08:00'});
  refused(f, 'bellnote.forms.respond', {id: 'form-aquarium', child_id: 'child-theo', action: 'sign', form_version: 1, answers: ANSWERS, payment_method_id: 'pm-0003'}, 'payment_declined');
  assert.equal(f.data.form_responses.filter(r => r.form_id === 'form-aquarium').length, 0, 'No response is written when the charge fails');
  refused(f, 'bellnote.forms.respond', {id: 'form-aquarium', child_id: 'child-theo', action: 'sign', form_version: 1, answers: ANSWERS, payment_method_id: 'pm-9999'}, 'not_found');
  const r = sign(f);
  assert.equal(r.charged_cents, 1800); assert.ok(r.payment_id);
  const pays = paidFor(f, r.id);
  assert.equal(pays.length, 1); assert.equal(pays[0].status, 'paid'); assert.equal(pays[0].amount_cents, 1800); assert.equal(pays[0].payment_method_id, 'pm-0001');
  assert.equal(f.call('bellnote.payments.list', {child_id: 'child-theo', start: '2026-11-17', end: '2026-11-17'}).payments.length, 1);
  const w = f.call('bellnote.forms.withdraw', {id: r.id});
  assert.equal(w.refunded_cents, 1800);
  assert.equal(paidFor(f, r.id)[0].status, 'refunded');
  refused(f, 'bellnote.forms.withdraw', {id: r.id}, 'invalid_state');
  // A card past its expiry month by the clock is declined; the card record itself never changes.
  const card = JSON.stringify(f.data.payment_methods);
  f.advance('2026-11-30T23:59:00-08:00');
  assert.equal(f.call('bellnote.preferences.get').payment_methods.find(m => m.id === 'pm-0002').expired, false);
  f.advance('2026-12-01T00:00:00-08:00');
  assert.equal(f.call('bellnote.preferences.get').payment_methods.find(m => m.id === 'pm-0002').expired, true);
  refused(f, 'bellnote.forms.respond', {id: 'form-aquarium', child_id: 'child-theo', action: 'sign', form_version: 1, answers: ANSWERS, payment_method_id: 'pm-0002'}, 'payment_declined');
  assert.equal(JSON.stringify(f.data.payment_methods), card);
  // An account with no payment method at all is declined.
  const none = fixture({mutate: d => { d.preferences.default_payment_method_id = null; }});
  publish(none);
  refused(none, 'bellnote.forms.respond', {id: 'form-aquarium', child_id: 'child-theo', action: 'sign', form_version: 1, answers: ANSWERS}, 'payment_declined');
  // can_sign without can_pay: a fee form is refused, a free form and a decline are not.
  const noPay = fixture({mutate: d => { d.guardian_links.find(l => l.id === 'gl-theo-maya').can_pay = false; d.form_responses = []; }});
  publish(noPay);
  refused(noPay, 'bellnote.forms.respond', {id: 'form-aquarium', child_id: 'child-theo', action: 'sign', form_version: 1, answers: ANSWERS}, 'not_permitted');
  assert.equal(noPay.call('bellnote.forms.respond', {id: 'form-fluclinic', child_id: 'child-theo', action: 'sign', form_version: 1, answers: {'q-consent-allergies': 'none'}}).state, 'signed');
  assert.equal(noPay.call('bellnote.forms.respond', {id: 'form-aquarium', child_id: 'child-theo', action: 'decline', form_version: 1}).state, 'declined');
  // can_pay without can_sign (Nico): refused before any charge.
  const nico = fixture();
  nico.event(ev('form.published', '2026-11-17T07:30:00-08:00', {form_id: 'form-k-band', school_id: 'school-kestrel', child_ids: ['child-nico'], kind: 'permission_slip',
    title: 'Band festival', text: 'Festival on 9 December.', questions: [], fee_cents: 1200, due_at: '2026-12-01T16:00:00-08:00'}));
  refused(nico, 'bellnote.forms.respond', {id: 'form-k-band', child_id: 'child-nico', action: 'sign', form_version: 1, answers: {}}, 'not_permitted');
});

test('T07 versions: text, questions or fee changes need review; a due-time change does not; stale_form; re-signing charges only a rise', () => {
  const f = fixture();
  publish(f);
  const r = sign(f);
  // A due time change alone keeps signatures as they are.
  f.event(ev('form.changed', '2026-11-18T09:00:00-08:00', {form_id: 'form-aquarium', change: {due_at: '2026-11-26T16:00:00-08:00'}, reason: 'More time'}));
  let form = f.call('bellnote.forms.get', {id: 'form-aquarium'}).form;
  assert.equal(form.version, 1); assert.equal(form.responses.find(x => x.child_id === 'child-theo').state, 'signed');
  assert.match(f.data.notifications.at(-1).body, /None of your answers is affected/);
  // The trip date moves: version 2, my signature needs review, one effect row for it.
  const seqBefore = f.data.activity.length;
  f.event(ev('form.changed', '2026-11-19T10:30:00-08:00', {form_id: 'form-aquarium', change: {text: 'Bus leaves 08:45 on 11 December and returns by 16:15.', event_date: '2026-12-11'}, reason: 'Aquarium moved our booking'}));
  form = f.call('bellnote.forms.get', {id: 'form-aquarium'}).form;
  assert.equal(form.version, 2); assert.equal(form.versions.length, 2); assert.match(form.versions[0].text, /4 December/);
  const mine = form.responses.find(x => x.child_id === 'child-theo');
  assert.equal(mine.state, 'needs_review'); assert.equal(mine.counts_as_signed, false);
  assert.deepEqual(f.data.activity.slice(seqBefore).map(a => a.action), ['event.form.changed', 'effect.form_response.needs_review', 'effect.notification.written']);
  assert.match(f.data.notifications.at(-1).body, /Your signature for Theo Okafor no longer counts/);
  refused(f, 'bellnote.forms.respond', {id: 'form-aquarium', child_id: 'child-theo', action: 'sign', form_version: 1, answers: ANSWERS}, 'stale_form');
  const again = f.call('bellnote.forms.respond', {id: 'form-aquarium', child_id: 'child-theo', action: 'sign', form_version: 2, answers: ANSWERS});
  assert.equal(again.state, 'signed'); assert.equal(again.charged_cents, 0); assert.equal(paidFor(f, r.id).length, 1, 'No second charge');
  // The fee rises: only the difference is charged when re-signing.
  f.event(ev('form.changed', '2026-11-19T11:00:00-08:00', {form_id: 'form-aquarium', change: {fee_cents: 2200}, reason: 'Bus price'}));
  assert.equal(f.data.form_responses.find(x => x.id === r.id).state, 'needs_review');
  const rise = f.call('bellnote.forms.respond', {id: 'form-aquarium', child_id: 'child-theo', action: 'sign', form_version: 3, answers: ANSWERS});
  assert.equal(rise.charged_cents, 400); assert.equal(rise.paid_cents, 2200);
  assert.deepEqual(paidFor(f, r.id).map(p => p.amount_cents), [1800, 400]);
  // A question change also needs review.
  f.event(ev('form.changed', '2026-11-19T12:00:00-08:00', {form_id: 'form-aquarium', change: {questions: [...QUESTIONS, {id: 'q-sunscreen', type: 'boolean', label: 'Sunscreen allowed', required: false}]}, reason: 'Added question'}));
  assert.equal(f.data.form_responses.find(x => x.id === r.id).state, 'needs_review');
  // A change that changes nothing is refused as an event.
  assert.equal(f.tryEvent(ev('form.changed', '2026-11-19T12:05:00-08:00', {form_id: 'form-aquarium', change: {fee_cents: 2200}, reason: 'Same'})).status, 'invalid_event');
});

test('T08 a response still needing review at closing counts as not signed; withdrawing one refunds the fee', () => {
  const f = fixture();
  publish(f);
  sign(f);
  f.call('bellnote.forms.respond', {id: 'form-aquarium', child_id: 'child-ines', action: 'sign', form_version: 1, answers: ANSWERS});
  f.event(ev('form.changed', '2026-11-19T10:30:00-08:00', {form_id: 'form-aquarium', change: {event_date: '2026-12-11'}, reason: 'Moved'}));
  // Ines's needs_review answer is withdrawn before closing: the paid fee is refunded in full.
  const ines = f.data.form_responses.find(r => r.form_id === 'form-aquarium' && r.child_id === 'child-ines');
  assert.equal(f.call('bellnote.forms.withdraw', {id: ines.id}).refunded_cents, 1800);
  // Theo's stays needs_review through the due time: it reads not_signed, with no write.
  f.advance('2026-11-25T16:00:00-08:00');
  const theo = f.call('bellnote.forms.get', {id: 'form-aquarium'}).form.responses.find(r => r.child_id === 'child-theo');
  assert.equal(theo.state, 'needs_review'); assert.equal(theo.effective_state, 'not_signed'); assert.equal(theo.counts_as_signed, false);
  refused(f, 'bellnote.forms.withdraw', {id: theo.id}, 'closed');
});
