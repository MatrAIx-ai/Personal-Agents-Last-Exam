'use strict';
// Runnable without a host: Mingyu's I-20 travel signature lapses on 2027-03-09. He submitted
// a Travel Signature Request on 2027-02-08 (req-0142, in the fixture). An early processing
// event is refused; on the 5th business day the office signs the I-20 and the signature runs
// to 2028-02-15. Both notices carry Mail CloudEvents for Infra to publish.
const assert = require('node:assert/strict');
const {fixture} = require('../tests/harness.cjs');
const f = fixture();
const before = f.call('passage.documents.status', {}).documents[0];
assert.deepEqual([before.travel_signature_status, before.current_signature.valid_until, before.pending_request_id], ['valid', '2027-03-09', 'req-0142']);

const again = f.call('passage.travel_signature.request', {}); // a second click changes nothing
assert.deepEqual([again.created, again.request.id, again.request.due_on], [false, 'req-0142', '2027-02-15']);

const event = require('./scenario.json');
let early = null;
try { f.event({...event, event_id:'processed-req-0142-early', at:'2027-02-12T16:00:00-06:00'}); } catch (e) { early = e.code; }
assert.equal(early, 'not_due');

f.event(event); // 2027-02-15T10:00:00-06:00
const after = f.call('passage.documents.status', {}).documents[0];
assert.deepEqual([after.current_signature.id, after.current_signature.signed_on, after.current_signature.valid_until], ['sig-0142', '2027-02-15', '2028-02-15']);
const mail = f.data.notices.filter(n => n.ref.object_id === 'req-0142' || n.ref.object_id === 'sig-0142').map(n => n.message);

console.log(JSON.stringify({app:'passage',
  before:{signature:before.current_signature.id, status:before.travel_signature_status, lapses_on:before.current_signature.valid_until, pending:before.pending_request_id},
  duplicate_request:{created:again.created, id:again.request.id},
  early_event:early,
  processed:{event_id:event.event_id, at:event.at, request:f.call('passage.requests.list', {}).items[0]},
  after:{signature:after.current_signature, status:after.travel_signature_status},
  mail_messages:mail.map(m => ({id:m.id, to:m.data.recipient, source_object:m.data.source_object, title:m.data.content.title}))}, null, 2));
