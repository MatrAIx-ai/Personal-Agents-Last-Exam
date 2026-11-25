'use strict';
// Runnable without a host: a German slot is released (examples/scenario.json); the applicant finds
// that Germany is the competent consulate (6 nights against 5), cancels the French booking, books
// the first German slot after 2027-03-18, registers a file with the misspelled letter, replaces it
// with the corrected letter before the appointment, and the appointment is held as complete.
const assert = require('node:assert/strict');
const {fixture} = require('../tests/harness.cjs');
const f = fixture();
f.event(require('./scenario.json'));

const src = (app_id, object_type, object_id) => ({app_id, object_type, object_id});
const trip = [{country:'DE', check_in:'2027-04-19', check_out:'2027-04-25'}, {country:'FR', check_in:'2027-04-25', check_out:'2027-04-30'}];
const competence = f.call('visaslot.competence', {trip:{stays:trip}});
assert.deepEqual([competence.main_country, competence.rule], ['DE', 'most_nights']);

const french = f.call('visaslot.appointments', {id:'appt-0324'}).item;
const cancelled = f.call('visaslot.cancel', {appointment_id:french.id, appointment_version:french.version});
const slots = f.call('visaslot.slots', {consulate_id:'de-chicago', from:'2027-03-19', to:'2027-04-30'}).slots;
const booked = f.call('visaslot.book', {consulate_id:'de-chicago', slot_at:slots[0].slot_at, slot_version:slots[0].version}).appointment;
assert.deepEqual([booked.id, booked.slot_at], ['appt-0331', '2027-03-31T09:00:00-05:00']);

const documents = name => ({
  invitation_letter:{source:src('confdesk', 'invitation_letter', 'letter-0388'), name_on_letter:name, issued_on:name === 'ZHAO Mingyu' ? '2027-03-26' : '2027-03-08'},
  travel_signature:{source:src('passage', 'travel_signature', 'sig-0142'), signed_on:'2027-02-15', valid_until:'2028-02-15'},
  accommodation:trip.map((s, i) => ({...s, source:src('task-hotel', 'reservation', ['H-5521', 'H-5530'][i])})),
  travel:{enter_on:'2027-04-19', leave_on:'2027-04-30'}
});
f.ctx.virtual_now = '2027-03-08T18:00:00-06:00';
const first = f.call('visaslot.file.submit', {appointment_id:booked.id, documents:documents('ZHOU Mingyu')});
f.ctx.virtual_now = '2027-03-26T19:00:00-05:00';
const second = f.call('visaslot.file.submit', {appointment_id:booked.id, documents:documents('ZHAO Mingyu')});
f.event({event_id:'held-de-chi-20270331-0900', at:'2027-03-31T09:00:00-05:00', operation:'visaslot.appointment.held',
  payload:{consulate_id:'de-chicago', slot_at:'2027-03-31T09:00:00-05:00'}});
const file = f.call('visaslot.file.get', {appointment_id:booked.id});
assert.equal(file.check.result, 'complete');

console.log(JSON.stringify({app:'visaslot', released:require('./scenario.json').payload, competence,
  cancelled:{id:cancelled.appointment.id, status:cancelled.appointment.status, released_slot:cancelled.released_slot},
  german_slots_after_qual:slots.map(s => s.slot_at), booked:{id:booked.id, slot_at:booked.slot_at, version:booked.version},
  first_file:{version:first.file.version, missing_if_held_now:first.missing_if_held_now},
  replacement:{version:second.file.version, replaced_version:second.replaced_version, missing_if_held_now:second.missing_if_held_now},
  check:file.check, history:f.call('visaslot.appointments', {id:booked.id}).item.history}, null, 2));
