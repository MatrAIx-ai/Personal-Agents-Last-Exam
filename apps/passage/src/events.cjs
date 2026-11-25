'use strict';
// Infra-applied events. Each handler observes the event's own `at` as ctx.virtual_now.
// The App never schedules itself: the task's runner decides when a request is processed and
// supplies its business-day computation; Passage checks it against its own rule.
const c = require('./common.cjs');
const o = require('./office.cjs');
const {notice} = require('./notices.cjs');

// Structural equality: object key order is ignored, array order is kept.
const canon = v => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v;
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

function processed(ctx, data, event) {
  const p = event.payload, r = c.find(data.requests, p.request_id, 'Request');
  // A replayed event ID is a no-op: the request already records it.
  if (r.processed_event_id === event.event_id) { c.log(ctx, 'passage.processed_replay', {record_id:r.id}); return data; }
  if (r.status !== 'submitted') c.fail('invalid_state', 'Request ' + r.id + ' was already processed by event ' + r.processed_event_id + '.');
  const expected = o.computation(data, r.submitted_on, r.business_days);
  const wrong = ['submitted_on', 'business_days', 'counted_days', 'skipped_holidays', 'due_on'].filter(k => !same(p[k], expected[k]));
  if (wrong.length) {
    c.fail('invalid_event', 'The business-day computation does not match Passage\'s rule (' + wrong.join(', ') + '). Request ' + r.id +
      ' was submitted on ' + r.submitted_on + ' and is processed in ' + r.business_days + ' business days: counted ' +
      expected.counted_days.join(', ') + (expected.skipped_holidays.length ? '; holidays skipped ' + expected.skipped_holidays.join(', ') : '') +
      '; due on ' + expected.due_on + '.');
  }
  const today = o.today(data, event.at);
  if (today < r.due_on) c.fail('not_due', 'Request ' + r.id + ' is not due until ' + r.due_on + ' (office date now ' + today + ').');

  const doc = c.find(data.documents, r.document_id, 'Document'), sigId = c.signatureIdFor(r.id);
  if (data.signatures.some(s => s.id === sigId)) c.fail('invalid_state', 'Signature ' + sigId + ' already exists.');
  const sig = {id:sigId, request_id:r.id, document_id:doc.id, issued_at:event.at, signed_on:today, valid_until:o.validUntil(data, today)};
  data.signatures.push(sig);
  Object.assign(r, {status:'processed', processed_at:event.at, processed_event_id:event.event_id, signature_id:sigId});
  c.stamp(ctx, r, 'processed', {signature_id:sigId});
  notice(ctx, data, 'signature_issued', 'Your I-20 travel signature is ready',
    'Dear ' + doc.holder_name + ',\n\nYour Travel Signature Request ' + r.id + ' has been processed. Your I-20 was signed for travel on ' + sig.signed_on +
    '. The travel signature is valid until ' + sig.valid_until + ' and lapses on that date; request a new one before then if you will travel later. ' +
    'Carry the signed I-20 with your passport and visa when you re-enter the United States.\n\n' + data.office.name,
    {object_type:'travel_signature', object_id:sigId});
  return data;
}

function applyEvent(ctx, data, event) {
  if (event.operation === 'passage.request.processed') return processed(ctx, data, event);
  c.fail('invalid_event', 'Unsupported operation.');
}

module.exports = {applyEvent};
