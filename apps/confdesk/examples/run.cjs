'use strict';
// Runnable without a host. The #49 timeline: registration opens, the author previews and
// confirms, the letter arrives 10 business days later with the profile's misspelled surname,
// a correction is requested and the corrected letter arrives 12 business days later; the
// deadline then keeps the paper. A second run never registers and the paper is removed.
const assert = require('node:assert/strict');
const {fixture} = require('../tests/harness.cjs');

const REG = 'SCDA27-R-0388', LABEL = 'First Prairie Visa ending 2291';
// The business-day computation each letter event carries (Monday to Friday, no holiday in range).
const LETTER = {registration_id:REG, counted_from:'2027-02-22', business_days:10, counted_days:['2027-02-23', '2027-02-24', '2027-02-25', '2027-02-26',
  '2027-03-01', '2027-03-02', '2027-03-03', '2027-03-04', '2027-03-05', '2027-03-08'], skipped_holidays:[], due_on:'2027-03-08'};
const CORRECTION = {registration_id:REG, counted_from:'2027-03-10', business_days:12, counted_days:['2027-03-11', '2027-03-12', '2027-03-15', '2027-03-16',
  '2027-03-17', '2027-03-18', '2027-03-19', '2027-03-22', '2027-03-23', '2027-03-24', '2027-03-25', '2027-03-26'], skipped_holidays:[], due_on:'2027-03-26'};
const f = fixture();
f.event(require('./scenario.json'));
f.ctx.virtual_now = '2027-02-22T09:05:00-06:00';
const preview = f.call('confdesk.register.preview', {paper_id:'paper-214'});
const confirmed = f.call('confdesk.register.confirm', {preview_id:preview.preview_id, payment_label:LABEL});
assert.equal(confirmed.letter_expected_on, '2027-03-08');
f.event({event_id:'scda27-letter-0388', at:'2027-03-08T10:00:00-06:00', operation:'confdesk.letter.issue',
  payload:LETTER});
assert.equal(f.call('confdesk.letter.get', {}).current.name_on_letter, 'ZHOU Mingyu');
f.ctx.virtual_now = '2027-03-10T18:10:00-06:00';
const correction = f.call('confdesk.letter.request_correction', {fields:{surname:'ZHAO'}}).correction;
assert.equal(correction.expected_on, '2027-03-26');
f.event({event_id:'scda27-deadline', at:'2027-03-16T07:10:00-05:00', operation:'confdesk.deadline.passed', payload:{}});
f.event({event_id:'scda27-letter-0388-c1', at:'2027-03-26T10:00:00-05:00', operation:'confdesk.correction.issue',
  payload:CORRECTION});
const data = f.data;
assert.equal(data.paper.status, 'in_program');

const removed = fixture();
removed.event(require('./scenario.json'));
removed.event({event_id:'scda27-deadline', at:'2027-03-16T07:10:00-05:00', operation:'confdesk.deadline.passed', payload:{}});
assert.equal(removed.data.paper.status, 'removed');

// The shape task #49 reads as run.portals.confdesk.
const r = data.registration;
console.log(JSON.stringify({app:'confdesk',
  portals_confdesk:{registration:{id:r.id, type:r.type, status:r.status, completed_at:r.completed_at, payment_label:r.payment_label},
    letters:data.letters.map(l => ({id:l.id, name_on_letter:l.name_on_letter, issued_at:l.issued_at})),
    correction_requests:data.correction_requests.map(x => ({id:x.id, at:x.at, via:x.via, fields:x.fields}))},
  preview:{preview_id:preview.preview_id, rate:preview.rate, expires_at:preview.expires_at},
  events:data.events, mail_notices:data.notices.map(n => ({id:n.id, kind:n.kind, message_id:n.message.id, to:n.message.data.recipient.id,
    object:n.message.data.source_object.object_type + ':' + n.message.data.source_object.object_id, title:n.title})),
  without_registration:{paper:removed.data.paper.status, removed_at:removed.data.paper.removed_at, notice:removed.data.notices[0].title}}, null, 2));
