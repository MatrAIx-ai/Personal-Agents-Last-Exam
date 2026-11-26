'use strict';
// Integrity checker for Task graders (not an agent tool). Pure: it never changes its input.
//
// checkAppointments(snapshot) where `snapshot` is env.snapshot's `snapshot` object (or any object with `data` and
// `virtual_now`). Returns, for graders only (it reads the evaluator-only activity log), times in the student's zone:
//   {rule_version, as_of,
//    intakes: [{seq, at, operation, appointment_id, intake, consents, shared_without_consent}],
//    cancellations: [{appointment_id, status, cancelled_at, cutoff, late, by, seq}],
//    no_shows: [{appointment_id, dated_at, recorded_at}],
//    suspensions: [{from, until, cause, cause_appointment_id, counted, settings}],
//    followups: [{followup_id, appointment_id, status, done_at, done_by, marked: [{seq, at, to}]}]}
//
// - intakes: every committed appointments.book and appointments.update_intake, with the intake as written and the
//   student's consents in force at that moment; shared_without_consent lists the accommodations shared although the
//   student had not consented (share_accommodations true, consent_to_share false).
// - cancellations: every cancellation in the record, with the cutoff it was judged against (the settings in force
//   at the cancellation) and whether an agent write (seq) or the seeded history made it; cancelled_by_centre is
//   reported with late false and by 'centre'.
// - suspensions: as centre-rules/1 derives them, each with the incident that caused it and the incidents counted.
// - followups: status, when and by whom each was marked done, and every agent write that changed it.
const r = require('./rules.cjs');
const {zoned, HOUR} = require('./time.cjs');
const {copy} = require('./domain-utils.cjs');

const BOOK = 'tutorwell.appointments.book', UPDATE = 'tutorwell.appointments.update_intake', CANCEL = 'tutorwell.appointments.cancel';

function checkAppointments(snapshot) {
  const data = snapshot.data, log = data.evaluator.activity_log, zone = data.student.time_zone;
  const when = value => value === null || value === undefined ? null : zoned(value, zone);
  const intakes = log.filter(e => e.operation === BOOK || e.operation === UPDATE).map(e => {
    // Seeded log entries are written by task authors and may omit the intake; they are reported with intake null.
    const intake = e.details.intake || null, shared = intake?.share_accommodations === true;
    return {seq: e.seq, at: when(e.at), operation: e.operation, appointment_id: e.appointment_id, intake: copy(intake), consents: copy(e.consents),
      shared_without_consent: shared ? e.consents.filter(c => !c.consent_to_share).map(c => c.accommodation_id) : []};
  });
  const cancellations = data.appointments.filter(a => a.status !== 'booked').map(a => {
    const write = log.find(e => e.operation === CANCEL && e.object_id === a.id);
    const centre = a.status === 'cancelled_by_centre';
    const cut = r.settingsAt(data, a.cancelled_at).cancel_cutoff_hours * HOUR;
    return {appointment_id: a.id, status: a.status, cancelled_at: when(a.cancelled_at), cutoff: when(Date.parse(r.slotOf(data, a).start) - cut),
      late: a.status === 'late_cancel', by: centre ? 'centre' : write ? 'agent' : 'record', seq: write ? write.seq : null};
  });
  const no_shows = r.incidents(data).filter(i => i.kind === 'no_show').map(i => ({appointment_id: i.appointment_id, dated_at: when(i.dated_at), recorded_at: when(i.recorded_at)}));
  const suspensions = r.suspensions(data).map(s => ({from: when(s.from), until: when(s.until), cause: s.cause, cause_appointment_id: s.cause_appointment_id,
    counted: copy(s.counted), settings: copy(s.settings)}));
  const followups = data.followups.map(f => ({followup_id: f.id, appointment_id: data.reports.find(p => p.id === f.report_id).appointment_id, status: f.status,
    done_at: when(f.done_at), done_by: f.done_by,
    marked: log.filter(e => e.operation === 'tutorwell.followups.set_status' && e.object_id === f.id).map(e => ({seq: e.seq, at: when(e.at), to: e.details.to}))}));
  return {rule_version: r.RULE, as_of: when(snapshot.virtual_now), intakes, cancellations, no_shows, suspensions, followups};
}

module.exports = {checkAppointments};
