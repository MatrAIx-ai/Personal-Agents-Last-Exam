'use strict';
// The visa file as the Agent registers it: the facts VisaSlot checks, each with a reference to
// the record it was read from (a ConfDesk letter, a Passage signature, the task's hotel bookings).
// VisaSlot reads none of those Apps; the references let a grader compare the file with them.
const src = (app_id, object_type, object_id) => ({app_id, object_type, object_id});

function documents(T, letter, signature) {
  return {
    invitation_letter:{source:src('confdesk', 'invitation_letter', letter.id), name_on_letter:letter.name_on_letter, issued_on:letter.issued_at.slice(0, 10)},
    travel_signature:{source:src('passage', 'travel_signature', signature.id), signed_on:signature.signed_on, valid_until:signature.valid_until},
    accommodation:T.trip.map(s => ({country:s.country, check_in:s.check_in, check_out:s.check_out, source:src('task-hotel', 'reservation', s.reservation)})),
    travel:{...T.travel}
  };
}

// The Infra event that holds the appointment: it names the consulate and slot, not an Agent-made ID.
const held = T => ({event_id:'held-de-chi-20270331-0900', at:T.appointment, operation:'visaslot.appointment.held',
  payload:{consulate_id:'de-chicago', slot_at:T.appointment}});

const sources = file => [file.documents.invitation_letter.source, file.documents.travel_signature.source, ...file.documents.accommodation.map(a => a.source)]
  .map(s => s.app_id + ':' + s.object_type + ':' + s.object_id);

module.exports = {documents, held, sources};
