'use strict';

const c = require('./common.cjs');

function applyEvent(ctx, data, event) {
  const op = event.operation;
  const p = event.payload || {};
  const at = event.at;
  c.parseMs(at);
  c.syncExpiredClearances(data, at);

  if (op === 'vet.vaccination_logged') {
    const pet = data.pets.find((x) => x.id === p.pet_id);
    if (!pet) c.fail('invalid_event', `Unknown pet_id: ${p.pet_id}`);
    const id = c.nextId('vax', data.vaccinations);
    data.vaccinations.push({
      id,
      account_id: data.account_id,
      pet_id: pet.id,
      vaccine_type: p.vaccine_type,
      administered_at: p.administered_at,
      expires_at: p.expires_at,
      waiting_period_days: p.waiting_period_days,
      clinic_branch_id: p.clinic_branch_id,
      lot_number: p.lot_number || `LOT-${event.event_id}`,
      created_at: at,
      updated_at: at,
    });
    return data;
  }

  if (op === 'vet.lab_result_posted') {
    const pet = data.pets.find((x) => x.id === p.pet_id);
    if (!pet) c.fail('invalid_event', `Unknown pet_id: ${p.pet_id}`);
    const id = c.nextId('lab', data.lab_results);
    data.lab_results.push({
      id,
      account_id: data.account_id,
      pet_id: pet.id,
      panel_type: p.panel_type,
      status: p.status,
      collected_at: at,
      valid_until: p.valid_until,
      note: p.note,
    });
    return data;
  }

  if (op === 'vet.visit_outcome_logged') {
    const appt = data.appointments.find((x) => x.id === p.appointment_id);
    if (!appt) c.fail('invalid_event', `Unknown appointment_id: ${p.appointment_id}`);
    if (!['scheduled', 'checked_in'].includes(appt.status)) {
      c.fail('invalid_event', `Cannot record visit outcome for appointment in status: ${appt.status}`);
    }
    appt.status = p.outcome;
    c.stamp(appt, at, `outcome:${p.outcome}`, p.note);

    if (p.outcome === 'completed') {
      const pet = data.pets.find((x) => x.id === appt.pet_id);
      if (pet) {
        if (['wellness_exam', 'travel_certificate_exam'].includes(appt.visit_type)) {
          pet.last_exam_at = at;
          pet.exam_valid_until = p.exam_valid_until || c.toIsoOffset(c.parseMs(at) + 365 * c.DAY_MS);
        }
        if (p.recorded_weight_kg !== undefined && p.recorded_weight_kg !== null) {
          pet.weight_kg = p.recorded_weight_kg;
        }
        c.stamp(pet, at, `visit_completed:${appt.visit_type}`, p.note);
      }
    }
    return data;
  }

  if (op === 'prescription.decision') {
    const rfl = data.refill_requests.find((x) => x.id === p.refill_id);
    if (!rfl) c.fail('invalid_event', `Unknown refill_id: ${p.refill_id}`);
    if (!['requested', 'vet_review'].includes(rfl.status)) {
      c.fail('invalid_event', `Cannot decide refill in status: ${rfl.status}`);
    }
    rfl.status = p.decision;
    rfl.decision_note = p.note;
    c.stamp(rfl, at, `decision:${p.decision}`, p.note);
    if (['approved_pickup', 'approved_delivery'].includes(p.decision)) {
      const rx = data.prescriptions.find((x) => x.id === rfl.prescription_id);
      if (rx && rx.refills_remaining > 0) {
        rx.refills_remaining -= 1;
        rx.updated_at = at;
      }
    }
    return data;
  }

  if (op === 'clinic.schedule_disruption') {
    const fromMs = c.parseMs(p.affected_from);
    const untilMs = c.parseMs(p.affected_until);
    for (const s of data.slots) {
      if (s.branch_id !== p.branch_id) continue;
      if (p.vet_id && s.vet_id !== p.vet_id) continue;
      const st = c.parseMs(s.starts_at);
      if (st >= fromMs && st <= untilMs && s.status === 'open') {
        s.status = 'disrupted';
      }
    }
    for (const a of data.appointments) {
      if (a.status !== 'scheduled' || a.branch_id !== p.branch_id) continue;
      if (p.vet_id && a.vet_id !== p.vet_id) continue;
      const st = c.parseMs(a.starts_at);
      if (st >= fromMs && st <= untilMs) {
        a.penalty_free_until = p.penalty_free_until;
        c.stamp(a, at, 'disruption_penalty_waived', p.reason);
      }
    }
    return data;
  }

  c.fail('invalid_event', `Unsupported CloverVet event operation: ${op}`);
}

module.exports = { applyEvent };
