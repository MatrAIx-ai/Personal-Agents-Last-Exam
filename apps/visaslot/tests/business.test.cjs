'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const plugin = require('../plugin.cjs');
const {fixture} = require('./harness.cjs');

const appDir = path.resolve(__dirname, '..');
const runtimeDir = path.resolve(appDir, '../../runtime');
const hasRuntime = fs.existsSync(path.join(runtimeDir, 'prepare.cjs'));
const code = value => ({code:value});
function unchanged(f, fn, expected) { const before = f.data; assert.throws(fn, expected); assert.deepEqual(f.data, before); }

const DE_0331 = '2027-03-31T09:00:00-05:00';
const DE_0406 = '2027-04-06T09:30:00-05:00';
const DE_0317 = '2027-03-17T14:00:00-05:00';
const FR_0407 = '2027-04-07T11:00:00-05:00';
const src = (app_id, object_type, object_id) => ({app_id, object_type, object_id});
// Mingyu's trip: 6 nights in Germany, then 5 in France; a complete file unless changed.
function documents(change = d => d) {
  return change({
    invitation_letter:{source:src('confdesk', 'invitation_letter', 'letter-0388'), name_on_letter:'ZHAO Mingyu', issued_on:'2027-03-26'},
    travel_signature:{source:src('passage', 'travel_signature', 'sig-0142'), signed_on:'2027-02-15', valid_until:'2028-02-15'},
    accommodation:[
      {country:'DE', check_in:'2027-04-19', check_out:'2027-04-25', source:src('task-hotel', 'reservation', 'H-5521')},
      {country:'FR', check_in:'2027-04-25', check_out:'2027-04-30', source:src('task-hotel', 'reservation', 'H-5530')}],
    travel:{enter_on:'2027-04-19', leave_on:'2027-04-30'}
  });
}
const slotVersion = (f, consulate, at) => f.data.slots.find(s => s.consulate_id === consulate && Date.parse(s.slot_at) === Date.parse(at)).version;
const slotOf = (f, consulate, at) => f.data.slots.find(s => s.consulate_id === consulate && Date.parse(s.slot_at) === Date.parse(at));
const appointment = (f, id) => f.data.appointments.find(a => a.id === id);
const book = (f, slot_at = DE_0331, consulate_id = 'de-chicago') =>
  f.call('visaslot.book', {consulate_id, slot_at, slot_version:slotVersion(f, consulate_id, slot_at)}).appointment;
const submit = (f, appointment_id, docs = documents()) => f.call('visaslot.file.submit', {appointment_id, documents:docs});
const tag = at => at.replace(/[^0-9]/g, '').slice(0, 12);
const held = (slot_at = DE_0331, consulate_id = 'de-chicago', at = slot_at, event_id = 'held-' + consulate_id + '-' + tag(slot_at)) =>
  ({event_id, at, operation:'visaslot.appointment.held', payload:{consulate_id, slot_at}});
const slotEvent = (operation, slot_at, at, consulate_id = 'de-chicago', extra = {}) =>
  ({event_id:operation.split('.').at(-1) + '-' + consulate_id + '-' + tag(slot_at) + '-' + tag(at), at, operation, payload:{consulate_id, slot_at, ...extra}});
// A German appointment for 2027-03-31 with a file registered on 2027-03-27.
function filed(docs = documents()) {
  const f = fixture();
  book(f);
  f.ctx.virtual_now = '2027-03-27T10:00:00-05:00';
  submit(f, 'appt-0331', docs);
  return f;
}

test('generated schemas and tools.json match their single source', () => {
  require('../build/schemas.cjs').build({check:true});
  assert.deepEqual(require('../build/schemas.cjs').RULES, require('../src/rules.cjs').RULES);
});

test('reads change nothing and show appointments, checklists and files', () => {
  const f = fixture(), before = f.data;
  const list = f.call('visaslot.appointments', {});
  assert.deepEqual(list.items.map(a => [a.id, a.status, a.file_version]), [['appt-0612', 'held', 2], ['appt-0324', 'booked', null]]);
  assert.equal(list.items[0].check.result, 'complete');
  assert.ok(!('file' in list.items[0]), 'scheduling views leave the documents to visaslot.file.get');
  assert.deepEqual(f.call('visaslot.appointments', {id:'appt-0324'}).item, list.items[1]);
  assert.throws(() => f.call('visaslot.appointments', {id:'appt-9999'}), code('not_found'));
  const old = f.call('visaslot.file.get', {appointment_id:'appt-0612'});
  assert.deepEqual([old.appointment_status, old.file.version, old.history.length, old.missing_if_held_now, old.check.result], ['held', 2, 1, null, 'complete']);
  assert.deepEqual(f.call('visaslot.file.get', {appointment_id:'appt-0324'}).missing_if_held_now,
    [{item:'visa_file', rule:'file_submitted', expected:'submitted', found:null}]);
  const list2 = f.call('visaslot.checklist', {category:'business'});
  assert.deepEqual(list2.items.find(i => i.item === 'invitation_letter').checked_by, ['name_matches_passport', 'letter_issued_by_appointment']);
  assert.deepEqual(list2.items.find(i => i.item === 'passport').checked_by, []);
  assert.deepEqual(list2.rules, ['file_submitted', 'consulate_competent', 'name_matches_passport', 'letter_issued_by_appointment',
    'signature_valid_through_return', 'covers_every_night']);
  assert.ok(!f.call('visaslot.checklist', {category:'tourism'}).items.some(i => i.item === 'invitation_letter'));
  assert.throws(() => f.call('visaslot.checklist', {category:'study'}), code('not_found'));
  assert.deepEqual(f.data, before);
});

test('competence: the main destination has the most nights; a tie goes to the country entered first', () => {
  const f = fixture();
  const stays = list => ({trip:{stays:list.map(([country, check_in, check_out]) => ({country, check_in, check_out}))}});
  const most = f.call('visaslot.competence', stays([['FR', '2027-04-25', '2027-04-30'], ['DE', '2027-04-19', '2027-04-25']]));
  assert.deepEqual([most.main_country, most.rule, most.total_nights], ['DE', 'most_nights', 11]);
  assert.deepEqual(most.nights_by_country, [{country:'DE', nights:6, first_night:'2027-04-19'}, {country:'FR', nights:5, first_night:'2027-04-25'}]);
  assert.deepEqual(most.consulates.map(x => x.id), ['de-chicago']);
  // 5 and 5: France is entered first.
  const tie = f.call('visaslot.competence', stays([['DE', '2027-04-24', '2027-04-29'], ['FR', '2027-04-19', '2027-04-24']]));
  assert.deepEqual([tie.main_country, tie.rule, tie.consulates.map(x => x.id)], ['FR', 'tie_first_entry', ['fr-chicago']]);
  // Split stays add up; a short first stay in Italy does not win a three-way count.
  const split = f.call('visaslot.competence', stays([['IT', '2027-04-17', '2027-04-19'], ['FR', '2027-04-19', '2027-04-21'],
    ['DE', '2027-04-21', '2027-04-23'], ['FR', '2027-04-23', '2027-04-24'], ['DE', '2027-04-24', '2027-04-25']]));
  assert.deepEqual([split.main_country, split.rule, split.nights_by_country.map(r => r.nights)], ['FR', 'tie_first_entry', [2, 3, 3]]);
  assert.deepEqual(f.call('visaslot.competence', stays([['IT', '2027-04-17', '2027-04-20']])).consulates, []);
  assert.throws(() => f.call('visaslot.competence', stays([['DE', '2027-04-19', '2027-04-25'], ['FR', '2027-04-24', '2027-04-30']])), code('invalid_arguments'));
  assert.throws(() => f.call('visaslot.competence', stays([['DE', '2027-04-25', '2027-04-25']])), code('invalid_arguments'));
  assert.throws(() => f.call('visaslot.competence', stays([['DE', '2027-02-30', '2027-03-02']])), code('invalid_arguments'));
});

test('slots lists open future slots by local date, and past slots disappear on the clock', () => {
  const f = fixture();
  const de = (from, to) => f.call('visaslot.slots', {consulate_id:'de-chicago', from, to}).slots.map(s => s.slot_at);
  assert.deepEqual(de('2027-03-01', '2027-04-30'), ['2027-03-04T09:00:00-06:00', '2027-03-09T10:30:00-06:00', '2027-03-16T09:00:00-05:00',
    DE_0317, DE_0331, DE_0406]); // 2027-04-01 is taken
  assert.deepEqual(de('2027-03-31', '2027-03-31'), [DE_0331]);
  assert.equal(f.call('visaslot.slots', {consulate_id:'fr-chicago', from:'2027-01-01', to:'2027-12-31'}).slots[0].slot_at, '2027-03-03T09:00:00-06:00');
  f.ctx.virtual_now = '2027-03-17T13:59:59-05:00';
  assert.deepEqual(de('2027-03-01', '2027-04-30'), [DE_0317, DE_0331, DE_0406]);
  f.ctx.virtual_now = DE_0317; // a slot that has started is gone
  assert.deepEqual(de('2027-03-01', '2027-04-30'), [DE_0331, DE_0406]);
  assert.throws(() => de('2027-04-30', '2027-03-01'), code('invalid_arguments'));
  assert.throws(() => f.call('visaslot.slots', {consulate_id:'it-chicago', from:'2027-03-01', to:'2027-03-31'}), code('not_found'));
});

test('booking an open slot creates the appointment in the shape task #49 reads', () => {
  const f = fixture();
  const out = f.call('visaslot.book', {consulate_id:'de-chicago', slot_at:DE_0331, slot_version:1});
  assert.deepEqual(out.appointment, {id:'appt-0331', consulate_id:'de-chicago', country:'DE', slot_at:DE_0331, status:'booked', version:1,
    created_at:'2027-02-10T09:00:00-06:00', updated_at:'2027-02-10T09:00:00-06:00',
    history:[{at:'2027-02-10T09:00:00-06:00', status:'booked', slot_at:DE_0331, action:'booked'}], cancellation:null, check:null, file_version:null});
  assert.deepEqual(slotOf(f, 'de-chicago', DE_0331), {consulate_id:'de-chicago', slot_at:DE_0331, status:'booked', version:2, appointment_id:'appt-0331'});
  assert.ok(!f.call('visaslot.slots', {consulate_id:'de-chicago', from:'2027-03-31', to:'2027-03-31'}).slots.length);
  // The slot time may be written in any offset; the stored time keeps the consulate's spelling.
  const g = fixture();
  assert.equal(g.call('visaslot.book', {consulate_id:'de-chicago', slot_at:'2027-03-31T14:00:00Z', slot_version:1}).appointment.slot_at, DE_0331);
});

test('a slot taken between search and book is refused; a slot that changed since it was read is stale', () => {
  const f = fixture();
  const [seen] = f.call('visaslot.slots', {consulate_id:'de-chicago', from:'2027-03-31', to:'2027-03-31'}).slots;
  f.event(slotEvent('visaslot.slot.taken', DE_0331, '2027-02-10T09:05:00-06:00'));
  unchanged(f, () => f.call('visaslot.book', {consulate_id:'de-chicago', slot_at:seen.slot_at, slot_version:seen.version}), code('slot_unavailable'));
  f.event(slotEvent('visaslot.slot.released', DE_0331, '2027-02-10T09:10:00-06:00'));
  // Open again, but not the slot the agent read: version 1 is now 3.
  unchanged(f, () => f.call('visaslot.book', {consulate_id:'de-chicago', slot_at:seen.slot_at, slot_version:seen.version}), code('stale_version'));
  assert.equal(book(f).id, 'appt-0331');
  unchanged(f, () => f.call('visaslot.book', {consulate_id:'de-chicago', slot_at:'2027-03-31T10:00:00-05:00', slot_version:1}), code('not_found'));
  unchanged(f, () => f.call('visaslot.book', {consulate_id:'xx-chicago', slot_at:DE_0331, slot_version:1}), code('not_found'));
  f.ctx.virtual_now = DE_0406;
  unchanged(f, () => f.call('visaslot.book', {consulate_id:'de-chicago', slot_at:DE_0406, slot_version:1}), code('slot_unavailable'));
});

test('reschedule moves the appointment and releases the old slot; stale versions are refused', () => {
  const f = fixture();
  const a = book(f, DE_0317);
  f.ctx.virtual_now = '2027-02-12T08:00:00-06:00';
  const v = slotVersion(f, 'de-chicago', DE_0331);
  unchanged(f, () => f.call('visaslot.reschedule', {appointment_id:a.id, appointment_version:a.version + 1, slot_at:DE_0331, slot_version:v}), code('stale_version'));
  unchanged(f, () => f.call('visaslot.reschedule', {appointment_id:a.id, appointment_version:a.version, slot_at:DE_0331, slot_version:v + 1}), code('stale_version'));
  unchanged(f, () => f.call('visaslot.reschedule', {appointment_id:a.id, appointment_version:a.version, slot_at:DE_0317, slot_version:2}), code('invalid_arguments'));
  unchanged(f, () => f.call('visaslot.reschedule', {appointment_id:a.id, appointment_version:a.version, slot_at:'2027-04-01T10:00:00-05:00', slot_version:2}), code('slot_unavailable'));
  unchanged(f, () => f.call('visaslot.reschedule', {appointment_id:a.id, appointment_version:a.version, slot_at:FR_0407, slot_version:1}), code('not_found'));
  const out = f.call('visaslot.reschedule', {appointment_id:a.id, appointment_version:1, slot_at:DE_0331, slot_version:v});
  assert.deepEqual([out.appointment.id, out.appointment.slot_at, out.appointment.version, out.appointment.status], ['appt-0317', DE_0331, 2, 'booked']);
  assert.deepEqual(out.appointment.history, [
    {at:'2027-02-10T09:00:00-06:00', status:'booked', slot_at:DE_0317, action:'booked'},
    {at:'2027-02-12T08:00:00-06:00', status:'booked', slot_at:DE_0331, action:'rescheduled'}]);
  assert.deepEqual(out.released_slot, {consulate_id:'de-chicago', slot_at:DE_0317, version:3});
  assert.deepEqual(slotOf(f, 'de-chicago', DE_0331).appointment_id, 'appt-0317');
  // The released slot can be booked again by anyone, at its new version.
  assert.ok(f.call('visaslot.slots', {consulate_id:'de-chicago', from:'2027-03-17', to:'2027-03-17'}).slots.some(s => s.version === 3));
  // The version read before the reschedule is now stale; after the slot starts nothing changes.
  unchanged(f, () => f.call('visaslot.reschedule', {appointment_id:a.id, appointment_version:1, slot_at:DE_0406, slot_version:1}), code('stale_version'));
  f.ctx.virtual_now = DE_0331;
  unchanged(f, () => f.call('visaslot.reschedule', {appointment_id:a.id, appointment_version:2, slot_at:DE_0406, slot_version:1}), code('invalid_state'));
});

test('cancel releases the slot, needs the current version and closes when the slot starts', () => {
  const f = fixture();
  unchanged(f, () => f.call('visaslot.cancel', {appointment_id:'appt-0324', appointment_version:2}), code('stale_version'));
  const out = f.call('visaslot.cancel', {appointment_id:'appt-0324', appointment_version:1});
  assert.deepEqual([out.appointment.status, out.appointment.version, out.appointment.cancellation], ['cancelled', 2,
    {by:'applicant', at:'2027-02-10T09:00:00-06:00', reason:null}]);
  assert.deepEqual(out.appointment.history.at(-1), {at:'2027-02-10T09:00:00-06:00', status:'cancelled', slot_at:'2027-03-24T09:00:00-05:00', action:'cancelled'});
  assert.deepEqual(out.released_slot, {consulate_id:'fr-chicago', slot_at:'2027-03-24T09:00:00-05:00', version:3});
  unchanged(f, () => f.call('visaslot.cancel', {appointment_id:'appt-0324', appointment_version:2}), code('invalid_state'));
  unchanged(f, () => f.call('visaslot.cancel', {appointment_id:'appt-0612', appointment_version:2}), code('invalid_state'));
  // Booking the same date again gets the next ID.
  assert.equal(book(f, '2027-03-24T09:00:00-05:00', 'fr-chicago').id, 'appt-0324-2');
  const g = fixture();
  g.ctx.virtual_now = '2027-03-24T09:00:00-05:00';
  unchanged(g, () => g.call('visaslot.cancel', {appointment_id:'appt-0324', appointment_version:1}), code('invalid_state'));
});

test('the visa file is replaced until the appointment starts and rejected after it starts', () => {
  const f = fixture();
  book(f);
  f.ctx.virtual_now = '2027-03-10T09:00:00-06:00';
  const first = submit(f, 'appt-0331', documents(d => ({...d, invitation_letter:{...d.invitation_letter, name_on_letter:'ZHOU Mingyu', issued_on:'2027-03-08'}})));
  assert.deepEqual([first.file.version, first.replaced_version, first.file.locked_at], [1, null, null]);
  assert.deepEqual(first.missing_if_held_now, [{item:'invitation_letter', rule:'name_matches_passport', expected:'ZHAO Mingyu', found:'ZHOU Mingyu'}]);
  f.ctx.virtual_now = '2027-03-31T08:59:59-05:00';
  const second = submit(f, 'appt-0331');
  assert.deepEqual([second.file.version, second.replaced_version, second.missing_if_held_now], [2, 1, []]);
  const got = f.call('visaslot.file.get', {appointment_id:'appt-0331'});
  assert.deepEqual(got.history, [{version:1, submitted_at:'2027-03-10T09:00:00-06:00', documents:first.file.documents, replaced_at:'2027-03-31T08:59:59-05:00'}]);
  assert.deepEqual([got.file.documents, got.missing_if_held_now, got.check], [documents(), [], null]);
  assert.equal(appointment(f, 'appt-0331').version, 1, 'a file does not change the appointment version');
  f.ctx.virtual_now = DE_0331; // the appointment has started, even before it is held
  unchanged(f, () => submit(f, 'appt-0331'), code('invalid_state'));
  f.event(held());
  unchanged(f, () => submit(f, 'appt-0331'), code('invalid_state'));
  unchanged(f, () => submit(f, 'appt-0612'), code('invalid_state'));
  const g = fixture();
  g.call('visaslot.cancel', {appointment_id:'appt-0324', appointment_version:1});
  unchanged(g, () => submit(g, 'appt-0324'), code('invalid_state'));
  unchanged(g, () => submit(g, 'appt-9999'), code('not_found'));
});

test('a letter or signature dated after the submission day at the consulate is rejected', () => {
  const f = fixture();
  book(f);
  // 23:30 in Chicago on 2027-03-25 is already 2027-03-26 in UTC; the consulate's date decides.
  f.ctx.virtual_now = '2027-03-25T23:30:00-05:00';
  unchanged(f, () => submit(f, 'appt-0331'), code('document_dated_after_submission'));
  unchanged(f, () => submit(f, 'appt-0331', documents(d => ({...d, invitation_letter:{...d.invitation_letter, issued_on:'2027-03-25'},
    travel_signature:{...d.travel_signature, signed_on:'2027-03-26'}}))), code('document_dated_after_submission'));
  f.ctx.virtual_now = '2027-03-26T00:00:00-05:00';
  assert.equal(submit(f, 'appt-0331').file.version, 1, 'a document dated today is accepted');
  const bad = change => unchanged(f, () => submit(f, 'appt-0331', documents(change)), code('invalid_arguments'));
  bad(d => ({...d, accommodation:[...d.accommodation, {...d.accommodation[1], check_in:'2027-04-29', check_out:'2027-05-01'}]}));
  bad(d => ({...d, accommodation:[{...d.accommodation[0], check_out:'2027-04-19'}]}));
  bad(d => ({...d, travel:{enter_on:'2027-04-30', leave_on:'2027-04-19'}}));
  bad(d => ({...d, travel_signature:{...d.travel_signature, valid_until:'2027-02-01'}}));
  bad(d => ({...d, travel_signature:{...d.travel_signature, valid_until:'2027-02-15'}})); // lapses the day it is signed
  bad(d => ({...d, travel:{enter_on:'2027-04-31', leave_on:'2027-05-02'}}));
  // Stays outside the travel dates would change the competent consulate: six German nights before a 25 April entry.
  bad(d => ({...d, travel:{enter_on:'2027-04-25', leave_on:'2027-04-30'}}));
  bad(d => ({...d, travel:{enter_on:'2027-04-19', leave_on:'2027-04-29'}}));
});

test('appointment held with a complete file: complete, file locked, recorded once', () => {
  const f = filed();
  f.event(held());
  const a = appointment(f, 'appt-0331');
  assert.deepEqual(a.check, {appointment_id:'appt-0331', held_at:DE_0331, result:'complete', missing:[]});
  assert.deepEqual([a.status, a.version, a.file.locked_at, a.history.at(-1)], ['held', 2, DE_0331, {at:DE_0331, status:'held', slot_at:DE_0331, action:'held'}]);
  assert.deepEqual(f.data.checks.at(-1), {event_id:'held-de-chicago-202703310900', consulate_id:'de-chicago', slot_at:DE_0331, held_at:DE_0331,
    appointment_id:'appt-0331', result:'complete', missing:[]});
  assert.deepEqual(f.call('visaslot.file.get', {appointment_id:'appt-0331'}).check, a.check);
  unchanged(f, () => f.call('visaslot.cancel', {appointment_id:'appt-0331', appointment_version:2}), code('invalid_state'));
});

test('each rule fails on its own with one missing entry', () => {
  const run = (f, slot = DE_0331, consulate = 'de-chicago') => { f.event(held(slot, consulate)); return appointment(f, f.data.checks.at(-1).appointment_id).check; };
  const only = (check, entry) => assert.deepEqual([check.result, check.missing], ['refused', [entry]]);
  // file_submitted: nothing registered.
  const none = fixture(); book(none);
  only(run(none), {item:'visa_file', rule:'file_submitted', expected:'submitted', found:null});
  // consulate_competent: a French appointment for a trip with more nights in Germany.
  const fr = fixture(); book(fr, FR_0407, 'fr-chicago');
  fr.ctx.virtual_now = '2027-03-27T10:00:00-05:00'; submit(fr, 'appt-0407');
  only(run(fr, FR_0407, 'fr-chicago'), {item:'appointment', rule:'consulate_competent', expected:'DE', found:'FR'});
  // name_matches_passport: the uncorrected letter. Order and case of the name do not matter.
  only(run(filed(documents(d => ({...d, invitation_letter:{...d.invitation_letter, name_on_letter:'ZHOU Mingyu'}})))),
    {item:'invitation_letter', rule:'name_matches_passport', expected:'ZHAO Mingyu', found:'ZHOU Mingyu'});
  assert.equal(run(filed(documents(d => ({...d, invitation_letter:{...d.invitation_letter, name_on_letter:'Mingyu Zhao'}})))).result, 'complete');
  // signature_valid_through_return: the I-20 signature lapses before the return.
  only(run(filed(documents(d => ({...d, travel_signature:{...d.travel_signature, signed_on:'2026-03-09', valid_until:'2027-03-09'}})))),
    {item:'travel_signature', rule:'signature_valid_through_return', expected:'2027-04-30', found:'2027-03-09'});
  // valid_until is exclusive: a signature lapsing on the return date does not cover it; one lapsing the next day does.
  only(run(filed(documents(d => ({...d, travel_signature:{...d.travel_signature, valid_until:'2027-04-30'}})))),
    {item:'travel_signature', rule:'signature_valid_through_return', expected:'2027-04-30', found:'2027-04-30'});
  assert.equal(run(filed(documents(d => ({...d, travel_signature:{...d.travel_signature, valid_until:'2027-05-01'}})))).result, 'complete');
  // covers_every_night: one night without a stay.
  only(run(filed(documents(d => ({...d, accommodation:[d.accommodation[0], {...d.accommodation[1], check_in:'2027-04-26'}]})))),
    {item:'accommodation', rule:'covers_every_night', nights:['2027-04-25']});
  // letter_issued_by_appointment: an agent cannot register a letter dated after the submission day, and
  // the appointment is always later, so this rule fails only for a file a Task seeds as pre-registered.
  const seeded = filed(), data = seeded.data, a = data.appointments.find(x => x.id === 'appt-0331');
  a.file.documents.invitation_letter.issued_on = '2027-04-01';
  seeded.load(data);
  assert.deepEqual(seeded.call('visaslot.file.get', {appointment_id:'appt-0331'}).missing_if_held_now,
    [{item:'invitation_letter', rule:'letter_issued_by_appointment', expected:'2027-03-31', found:'2027-04-01'}]);
  only(run(seeded), {item:'invitation_letter', rule:'letter_issued_by_appointment', expected:'2027-03-31', found:'2027-04-01'});
  // Several failures are listed in rule order, as in the proposal's example.
  const two = filed(documents(d => ({...d, invitation_letter:{...d.invitation_letter, name_on_letter:'ZHOU Mingyu'},
    accommodation:[d.accommodation[0], {...d.accommodation[1], check_out:'2027-04-27'}, {...d.accommodation[1], check_in:'2027-04-28'}]})));
  two.event(held());
  assert.deepEqual(appointment(two, 'appt-0331').check, {appointment_id:'appt-0331', held_at:DE_0331, result:'refused', missing:[
    {item:'invitation_letter', rule:'name_matches_passport', expected:'ZHAO Mingyu', found:'ZHOU Mingyu'},
    {item:'accommodation', rule:'covers_every_night', nights:['2027-04-27']}]});
});

test('held with no appointment in that slot records no_appointment and changes nothing else', () => {
  const f = fixture(), before = f.data;
  f.event(held());
  const after = f.data;
  assert.deepEqual(after.checks.at(-1), {event_id:'held-de-chicago-202703310900', consulate_id:'de-chicago', slot_at:DE_0331, held_at:DE_0331,
    appointment_id:null, result:'no_appointment', missing:[]});
  assert.deepEqual({...after, checks:before.checks}, before);
  // A cancelled appointment no longer occupies its slot.
  const g = fixture();
  g.call('visaslot.cancel', {appointment_id:'appt-0324', appointment_version:1});
  g.event(held('2027-03-24T09:00:00-05:00', 'fr-chicago'));
  assert.deepEqual([g.data.checks.at(-1).result, appointment(g, 'appt-0324').status], ['no_appointment', 'cancelled']);
  unchanged(g, () => g.event(held(DE_0406, 'xx-chicago', DE_0406, 'held-x')), code('not_found'));
});

test('a replayed held event keeps the original result; the check is not due before the slot', () => {
  const f = filed(documents(d => ({...d, invitation_letter:{...d.invitation_letter, name_on_letter:'ZHOU Mingyu'}})));
  unchanged(f, () => f.event(held(DE_0331, 'de-chicago', '2027-03-31T08:59:00-05:00')), code('not_due'));
  f.event(held());
  const first = f.data;
  // Replaying the same event ID changes nothing, even though the result would now be computed again.
  f.event(held());
  assert.deepEqual(f.data, first);
  assert.equal(f.data.checks.filter(x => x.event_id === 'held-de-chicago-202703310900').length, 1);
  unchanged(f, () => f.event(held(DE_0406, 'de-chicago', DE_0406, 'held-de-chicago-202703310900')), code('already_exists'));
  unchanged(f, () => f.event(held(DE_0331, 'de-chicago', DE_0406, 'held-again')), code('already_exists'));
  // A no_appointment result replays the same way.
  const g = fixture();
  g.event(held(DE_0406));
  const once = g.data;
  g.event(held(DE_0406));
  assert.deepEqual(g.data, once);
});

test('slot.released and slot.taken change availability and are validated', () => {
  const f = fixture();
  const at = '2027-02-11T08:00:00-06:00';
  f.event(require('../examples/scenario.json'));
  assert.deepEqual(slotOf(f, 'de-chicago', '2027-04-08T09:00:00-05:00'), {consulate_id:'de-chicago', slot_at:'2027-04-08T09:00:00-05:00', status:'open', version:1, appointment_id:null});
  f.event(slotEvent('visaslot.slot.released', '2027-04-01T10:00:00-05:00', at)); // the taken slot comes back
  assert.deepEqual([slotOf(f, 'de-chicago', '2027-04-01T10:00:00-05:00').status, slotOf(f, 'de-chicago', '2027-04-01T10:00:00-05:00').version], ['open', 3]);
  unchanged(f, () => f.event(slotEvent('visaslot.slot.released', DE_0331, at)), code('invalid_event')); // already open
  unchanged(f, () => f.event(slotEvent('visaslot.slot.released', '2027-03-24T09:00:00-05:00', at, 'fr-chicago')), code('invalid_event')); // booked
  unchanged(f, () => f.event(slotEvent('visaslot.slot.released', '2027-02-11T07:00:00-06:00', at)), code('invalid_event')); // past
  unchanged(f, () => f.event(slotEvent('visaslot.slot.released', '2027-04-09T14:00:00Z', at)), code('invalid_event')); // not local time
  f.event(slotEvent('visaslot.slot.taken', DE_0331, at));
  assert.deepEqual([slotOf(f, 'de-chicago', DE_0331).status, slotOf(f, 'de-chicago', DE_0331).version], ['taken', 2]);
  unchanged(f, () => f.event(slotEvent('visaslot.slot.taken', DE_0331, at)), code('invalid_event'));
  unchanged(f, () => f.event(slotEvent('visaslot.slot.taken', '2027-03-24T09:00:00-05:00', at, 'fr-chicago')), code('invalid_event'));
  unchanged(f, () => f.event(slotEvent('visaslot.slot.taken', '2027-05-01T09:00:00-05:00', at)), code('not_found'));
  unchanged(f, () => f.event(slotEvent('visaslot.slot.taken', DE_0406, at, 'xx-chicago')), code('not_found'));
});

test('appointment.cancelled_by_consulate cancels the booked appointment and closes its slot', () => {
  const f = fixture();
  book(f);
  const ev = slotEvent('visaslot.appointment.cancelled_by_consulate', DE_0331, '2027-03-01T08:00:00-06:00', 'de-chicago', {reason:'Consulate closed for a public holiday.'});
  f.event(ev);
  const a = appointment(f, 'appt-0331');
  assert.deepEqual([a.status, a.version, a.cancellation, a.history.at(-1)], ['cancelled', 2,
    {by:'consulate', at:'2027-03-01T08:00:00-06:00', reason:'Consulate closed for a public holiday.'},
    {at:'2027-03-01T08:00:00-06:00', status:'cancelled', slot_at:DE_0331, action:'cancelled_by_consulate'}]);
  assert.deepEqual([slotOf(f, 'de-chicago', DE_0331).status, slotOf(f, 'de-chicago', DE_0331).appointment_id], ['closed', null]);
  unchanged(f, () => f.call('visaslot.book', {consulate_id:'de-chicago', slot_at:DE_0331, slot_version:3}), code('slot_unavailable'));
  unchanged(f, () => f.event({...ev, event_id:'again'}), code('not_found'));
  // A closed slot can be released again by the consulate.
  f.event(slotEvent('visaslot.slot.released', DE_0331, '2027-03-02T08:00:00-06:00'));
  assert.equal(book(f).id, 'appt-0331-2');
  const g = fixture();
  g.ctx.virtual_now = '2027-03-24T09:00:00-05:00';
  unchanged(g, () => g.event(slotEvent('visaslot.appointment.cancelled_by_consulate', '2027-03-24T09:00:00-05:00', '2027-03-24T09:00:00-05:00', 'fr-chicago')), code('invalid_event'));
  const h = fixture();
  h.event(slotEvent('visaslot.appointment.cancelled_by_consulate', '2027-03-24T09:00:00-05:00', '2027-02-11T08:00:00-06:00', 'fr-chicago'));
  assert.equal(appointment(h, 'appt-0324').cancellation.reason, null);
});

test('task #49 can read the appointment history it needs from the state', () => {
  // A pre-qual German slot booked and moved before its time, then held after the qual.
  const f = fixture();
  const early = book(f, '2027-03-04T09:00:00-06:00');
  f.ctx.virtual_now = '2027-02-20T12:00:00-06:00';
  f.call('visaslot.reschedule', {appointment_id:early.id, appointment_version:1, slot_at:DE_0331, slot_version:1});
  f.ctx.virtual_now = '2027-03-27T10:00:00-05:00';
  submit(f, early.id);
  f.event(held());
  const a = appointment(f, early.id);
  assert.deepEqual(a.history.map(({at, status, slot_at}) => ({at, status, slot_at})), [
    {at:'2027-02-10T09:00:00-06:00', status:'booked', slot_at:'2027-03-04T09:00:00-06:00'},
    {at:'2027-02-20T12:00:00-06:00', status:'booked', slot_at:DE_0331},
    {at:DE_0331, status:'held', slot_at:DE_0331}]);
  assert.deepEqual([a.id, a.consulate_id, a.country, a.slot_at, a.status], ['appt-0304', 'de-chicago', 'DE', DE_0331, 'held']);
});

test('Core: the Agent cannot fire Infra events; request and event replays, stale versions and reset', {skip:!hasRuntime && 'public runtime not present'}, () => {
  const {prepare} = require(path.join(runtimeDir, 'prepare.cjs'));
  const p = prepare(appDir);
  try {
    const m = p.model;
    let s = m.create('visaslot', 'core-check', 'sandbox');
    const seed = structuredClone(s.data);
    const run = (role, name, args = {}) => { const out = m.execute(s, role, name, args); s = out.state; return out.result; };
    const v = () => m.version(s);
    assert.ok(m.tools(s, 'agent').every(n => n.startsWith('visaslot.')));
    assert.ok(!m.tools(s, 'agent').some(n => /held|released|taken|cancelled_by_consulate/.test(n)));
    const event = held();
    for (const [name, args] of [['env.apply_event', {expected_version:v(), event}], ['env.reset', {expected_version:v()}],
      ['env.load_seed', {expected_version:v(), data:seed}], ['env.advance_time', {expected_version:v(), virtual_now:DE_0331, request_id:'t'}],
      ['env.snapshot', {}], ['visaslot.appointment.held', event.payload]]) {
      assert.equal(run('agent', name, args).status, 'permission_denied', name);
    }
    assert.deepEqual(s.data, seed);
    const args = {consulate_id:'de-chicago', slot_at:DE_0331, slot_version:1, expected_version:v(), request_id:'book-1'};
    const booked = run('agent', 'visaslot.book', args);
    assert.equal(booked.status, 'committed');
    const replay = run('agent', 'visaslot.book', args);
    assert.deepEqual([replay.duplicate, replay.appointment], [true, booked.appointment]);
    assert.equal(run('agent', 'visaslot.book', {...args, request_id:'book-2', slot_at:DE_0406}).status, 'stale_version');
    assert.equal(run('agent', 'visaslot.cancel', {appointment_id:'appt-0331', appointment_version:1, expected_version:v(), request_id:'c-1'}).status, 'committed');
    assert.equal(run('agent', 'visaslot.reschedule', {appointment_id:'appt-0331', appointment_version:1, slot_at:DE_0406, slot_version:1,
      expected_version:v(), request_id:'r-1'}).status, 'invalid_state');
    const applied = run('infra', 'env.apply_event', {expected_version:v(), event});
    assert.equal(applied.status, 'committed');
    const after = structuredClone(s.data);
    assert.equal(after.checks.at(-1).result, 'no_appointment');
    const again = run('infra', 'env.apply_event', {expected_version:v(), event});
    assert.deepEqual([again.duplicate, again.event_id, again.version], [true, event.event_id, applied.version]);
    assert.deepEqual(run('infra', 'env.event_status', {event_id:event.event_id}).receipt.event_id, event.event_id);
    assert.equal(run('infra', 'env.apply_event', {expected_version:v(), event:{...event, payload:{...event.payload, slot_at:DE_0406}}}).status, 'idempotency_conflict');
    assert.deepEqual(s.data, after);
    assert.equal(run('infra', 'env.reset', {expected_version:v()}).status, 'ready');
    assert.deepEqual(s.data, seed);
    assert.equal(s.virtual_now, '2027-02-10T09:00:00-06:00');
    assert.equal(run('agent', 'visaslot.book', {...args, expected_version:v()}).status, 'committed', 'request IDs are cleared by reset');
  } finally { p.cleanup(); }
});

test('reset in the App harness: loading the fixture again restores it exactly', () => {
  const f = filed();
  f.event(held());
  const seed = require('../fixtures/minimal.json');
  f.load(seed);
  assert.deepEqual(f.data, seed);
  const all = JSON.stringify(seed).match(/\d{4}-\d{2}-\d{2}/g);
  assert.ok(all.every(d => d >= '2026-01-01'), 'every seed date is on or after 2026-01-01');
});

test('seed validation rejects broken slots, appointments, files and checks', () => {
  const f = filed();
  f.event(held());
  const mutate = fn => { const d = f.data; fn(d); return d; };
  const rejects = (fn, pattern) => assert.throws(() => plugin.validateSeed(f.ctx, mutate(fn)), pattern);
  const appt = (d, id = 'appt-0331') => d.appointments.find(a => a.id === id);
  rejects(d => { d.account_id = 'unbound'; }, /binding/);
  rejects(d => { d.consulates[0].timezone = 'Mars/Olympus'; }, /IANA/);
  rejects(d => { d.slots[1].slot_at = '2027-03-03T15:00:00Z'; }, /local UTC offset/);
  rejects(d => { d.slots.push({...d.slots[1]}); }, /Duplicate slot/);
  rejects(d => { d.slots.find(s => s.appointment_id === 'appt-0324').status = 'open'; }, /Only a booked slot|slot disagree/);
  rejects(d => { appt(d, 'appt-0324').country = 'DE'; }, /country/);
  rejects(d => { appt(d, 'appt-0324').status = 'held'; }, /last history entry/);
  rejects(d => { appt(d).history[1].at = '2027-02-01T00:00:00-06:00'; }, /time order|before its slot/);
  rejects(d => { appt(d).check.result = 'refused'; }, /check must be the rules/);
  rejects(d => { appt(d).check.missing = [{item:'visa_file', rule:'file_submitted', expected:'submitted', found:null}]; }, /check must be the rules/);
  rejects(d => { appt(d).file.locked_at = null; }, /locked/);
  rejects(d => { appt(d).file.version = 3; }, /versions/);
  rejects(d => { appt(d).file.documents.accommodation[1].check_in = '2027-04-24'; }, /share the night/);
  rejects(d => { appt(d).file.submitted_at = '2027-04-01T00:00:00-05:00'; }, /lifetime/);
  rejects(d => { appt(d, 'appt-0612').file_history[0].replaced_at = '2026-06-02T00:00:00-05:00'; }, /replaced/);
  rejects(d => { d.checks.at(-1).result = 'refused'; }, /does not match/);
  rejects(d => { d.checks.pop(); }, /exactly one held event/);
  rejects(d => { d.checks.push({...d.checks[0]}); }, /Duplicate held event/);
  rejects(d => { appt(d, 'appt-0324').cancellation = {by:'applicant', at:'2027-01-21T00:00:00-06:00', reason:null}; }, /cancellation/);
  rejects(d => { d.checklists.push({...d.checklists[0]}); }, /checklist category/);
});

test('each README event example is valid and applies to the fixture', () => {
  const readme = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8');
  const examples = [...readme.matchAll(/```json\n(\{"event_id".*\})\n```/g)].map(m => JSON.parse(m[1]));
  assert.deepEqual(examples.map(e => e.operation).sort(), [...require('../app.json').event_types].sort());
  assert.deepEqual(examples[0], require('../examples/scenario.json'));
  for (const e of examples) { const f = fixture(); f.event(e); assert.notDeepEqual(f.data, fixture().data); }
});

test('optional diagnostics carry IDs only and cannot change business results', () => {
  const run = f => { book(f); f.ctx.virtual_now = '2027-03-27T10:00:00-05:00'; submit(f, 'appt-0331'); f.event(held()); return f.data; };
  const on = fixture(), off = fixture({logging:false});
  assert.deepEqual(run(on), run(off));
  assert.ok(on.logs.length); assert.equal(off.logs.length, 0);
  const text = JSON.stringify(on.logs);
  for (const secret of ['ZHAO', 'Mingyu', 'letter-0388', 'H-5521']) assert.ok(!text.includes(secret), 'logs carry IDs, not file contents');
  const broken = fixture(); broken.ctx.log = () => { throw Error('logger offline'); };
  assert.deepEqual(run(broken), off.data);
});

test('the Web page maps its actions to declared Agent tools', () => {
  const source = fs.readFileSync(path.join(__dirname, '../gui/src/app.js'), 'utf8')
    .replace(/^import .*$/m, 'const el=()=>null,date=String,time=String,tag=()=>null,textBlock=()=>null,metadata=()=>null,mount=()=>{};')
    .replace('export const config', 'const config');
  const config = new Function(source + '\nreturn config;')();
  const tools = require('../tools.json').map(t => t.name);
  for (const tool of [config.list, config.get, ...config.actions.map(a => a.tool)]) assert.ok(tools.includes(tool), tool);
  for (const used of new Set(source.match(/visaslot\.[a-z_.]+[a-z]/g))) assert.ok(tools.includes(used), used);
  assert.deepEqual(config.actions.find(a => a.tool === 'visaslot.cancel').prefill({id:'appt-0324', version:1}), {appointment_id:'appt-0324', appointment_version:1});
});

test('reviewer renderer escapes untrusted content', () => {
  const view = require('../gui/src/view.js');
  const html = view.render([{id:'test', title:'<img src=x onerror=alert(1)>', body:'<script>bad</script>'}]);
  assert.ok(!html.includes('<img')); assert.ok(!html.includes('<script>')); assert.ok(html.includes('&lt;'));
});

// Seeds may serialize objects with any key order; only array order carries meaning.
const reorder = (v, keys) => Array.isArray(v) ? v.map(x => reorder(x, keys)) : v && typeof v === 'object' ? Object.fromEntries(keys(Object.keys(v)).map(k => [k, reorder(v[k], keys)])) : v;
const KEY_ORDERS = [ks => [...ks].sort(), ks => [...ks].reverse()];

test('a seed is accepted whatever its object key order, including a held appointment and its check', () => {
  const f = filed(); f.event(held());
  for (const keys of KEY_ORDERS) { const g = fixture(); g.load(reorder(f.data, keys)); assert.deepEqual(g.data, reorder(f.data, keys)); }
});
