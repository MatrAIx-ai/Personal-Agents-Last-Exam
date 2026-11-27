'use strict';
// A separate run: the same appointment, but the visa file registers the letter as first issued
// (ZHOU Mingyu, read from ConfDesk's superseded letter). Held at the same time, the appointment
// is refused on the name rule alone; everything else in the file is the same as in the main run.
const {documents, held, sources} = require('./visa-file.cjs');

async function run({open, sandbox, write, event, clock, equal, ok, T, letter, signature}) {
  const visaslot = await open('visaslot', 'agent', 'refused'), infra = await open('visaslot', 'infra', 'refused');
  await sandbox(infra);
  await clock([infra], T.file_replaced);
  const [slot] = (await visaslot.call('visaslot.slots', {consulate_id:'de-chicago', from:'2027-03-31', to:'2027-03-31'})).slots;
  const booked = (await write(visaslot, infra, 'visaslot.book', {consulate_id:'de-chicago', slot_at:slot.slot_at, slot_version:slot.version})).appointment;
  const filed = await write(visaslot, infra, 'visaslot.file.submit', {id:booked.id, documents:documents(T, letter, signature)});
  equal('Refused run: the uncorrected letter is accepted on file but flagged before the appointment',
    [booked.id, filed.missing_if_held_now.map(m => m.rule)], ['appt-0331', ['name_matches_passport']]);
  await event(infra, held(T));
  const file = await visaslot.call('visaslot.file.get', {id:booked.id});
  equal('Refused run: held with the uncorrected letter, the appointment is refused on name_matches_passport only',
    [file.check.result, file.check.missing], ['refused', [{item:'invitation_letter', rule:'name_matches_passport', expected:'ZHAO Mingyu', found:'ZHOU Mingyu'}]]);
  ok('Refused run: the file points at the original ConfDesk letter', sources(file.file)[0] === 'confdesk:invitation_letter:letter-0388');
  return {appointment:booked.id, check:file.check};
}
module.exports = {run};
