'use strict';

const c = require('./common.cjs');

function findById(list, id, label) {
  const found = list.find((x) => x.id === id);
  if (!found) c.fail('not_found', `${label} not found: ${id}`);
  return found;
}

function assetWarning(ctx, assetId) {
  if (!assetId) return null;
  // Runtime passes ctx.assets.read(id) which throws code='unavailable' when asset is missing
  if (ctx && ctx.assets && typeof ctx.assets.read === 'function') {
    try {
      ctx.assets.read(assetId);
      return null;
    } catch (err) {
      if (err && (err.code === 'unavailable' || err.code === 'not_available')) {
        return `ASSET_MISSING: optional asset ${assetId} is not materialized`;
      }
      throw err;
    }
  }
  const catalog = ctx && ctx.resources && Array.isArray(ctx.resources.assets) ? ctx.resources.assets : null;
  if (!catalog) return null;
  const desc = catalog.find((a) => a.asset_id === assetId);
  if (!desc || (desc.availability && desc.availability.status !== 'ready')) {
    return `ASSET_MISSING: optional asset ${assetId} is not materialized`;
  }
  return null;
}

function checkSlotCompatibility(data, pet, slot, visitType, virtualNow, excludeApptId = null) {
  if (slot.status !== 'open') c.fail('SLOT_CONFLICT', `Slot ${slot.id} is not open (${slot.status}).`);
  if (!slot.visit_types.includes(visitType)) {
    c.fail('validation_error', `Slot ${slot.id} does not support visit type ${visitType}.`);
  }
  const vet = findById(data.vets, slot.vet_id, 'Veterinarian');
  if (!vet.species_supported.includes(pet.species)) {
    c.fail('HANDLING_CONSTRAINT_MISMATCH', `Vet ${vet.id} does not treat species ${pet.species}.`);
  }
  if (visitType === 'travel_certificate_exam' && !vet.usda_accredited) {
    c.fail('validation_error', `Vet ${vet.id} is not USDA-accredited for travel certificates.`);
  }
  if (slot.cat_only_slot && pet.species !== 'cat') {
    c.fail('HANDLING_CONSTRAINT_MISMATCH', `Slot ${slot.id} is restricted to cats only.`);
  }
  if (pet.handling_flags.includes('fear_free_room') && !slot.fear_free_room) {
    c.fail('HANDLING_CONSTRAINT_MISMATCH', `Pet ${pet.id} requires a fear_free_room slot.`);
  }
  if (pet.handling_flags.includes('cat_only_slot') && !slot.cat_only_slot) {
    c.fail('HANDLING_CONSTRAINT_MISMATCH', `Pet ${pet.id} requires a cat_only_slot.`);
  }
  if (visitType === 'dental_cleaning') {
    const okBlood = c.hasValidLab(data, pet.id, 'pre_anesthetic_bloodwork', ['cleared'], virtualNow);
    if (!okBlood) {
      c.fail('LAB_PREREQUISITE_MISSING', `Pet ${pet.id} requires valid pre_anesthetic_bloodwork within 30 days for dental_cleaning.`);
    }
  }
  // Check overlapping active appointments for the same pet
  const sStart = c.parseMs(slot.starts_at);
  const sEnd = c.parseMs(slot.ends_at);
  for (const a of data.appointments) {
    if (a.id === excludeApptId || a.pet_id !== pet.id || a.status !== 'scheduled') continue;
    const aStart = c.parseMs(a.starts_at);
    const aEnd = c.parseMs(a.ends_at);
    if (sStart < aEnd && sEnd > aStart) {
      c.fail('SLOT_CONFLICT', `Pet ${pet.id} already has an overlapping appointment ${a.id}.`);
    }
  }
}

function handleTool(ctx, data, name, args) {
  const now = c.nowOf(ctx);

  // --- Pets ---
  if (name === 'clovervet.pet.list') {
    const items = data.pets.filter((p) => {
      if (!args.include_inactive && p.status !== 'active') return false;
      if (args.species && p.species !== args.species) return false;
      return true;
    });
    return { data, result: { items: c.copy(items) } };
  }

  if (name === 'clovervet.pet.get') {
    const pet = findById(data.pets, args.id, 'Pet');
    const vaccinations = data.vaccinations.filter((v) => v.pet_id === pet.id);
    const lab_results = data.lab_results.filter((l) => l.pet_id === pet.id);
    return {
      data,
      result: {
        item: c.copy(pet),
        vaccinations: c.copy(vaccinations),
        lab_results: c.copy(lab_results),
        asset_warning: assetWarning(ctx, pet.card_asset_id),
      },
    };
  }

  if (name === 'clovervet.pet.update') {
    c.syncExpiredClearances(data, now);
    const pet = findById(data.pets, args.id, 'Pet');
    if (pet.status !== 'active') {
      c.fail('invalid_state_transition', `Cannot update pet in status: ${pet.status}`);
    }
    const patch = args.patch || {};
    if (!Object.keys(patch).length) c.fail('validation_error', 'Patch cannot be empty.');
    if (patch.authorized_caretakers && ctx && ctx.binding && Array.isArray(ctx.binding.people)) {
      const bound = new Set(ctx.binding.people.map((p) => p.person_id));
      for (const ct of patch.authorized_caretakers) {
        if (!bound.has(ct.person_ref)) c.fail('validation_error', `Unbound caretaker person_ref: ${ct.person_ref}`);
      }
    }
    for (const k of ['weight_kg', 'handling_flags', 'authorized_caretakers', 'notes']) {
      if (patch[k] !== undefined) pet[k] = c.copy(patch[k]);
    }
    c.stamp(pet, now, 'updated');
    return { data, result: { id: pet.id } };
  }

  // --- Vaccinations & Clearances ---
  if (name === 'clovervet.vaccination.list') {
    const vaccinations = args.pet_id ? data.vaccinations.filter((v) => v.pet_id === args.pet_id) : data.vaccinations;
    const lab_results = args.pet_id ? data.lab_results.filter((l) => l.pet_id === args.pet_id) : data.lab_results;
    return { data, result: { vaccinations: c.copy(vaccinations), lab_results: c.copy(lab_results) } };
  }

  if (name === 'clovervet.clearance.check') {
    const pet = findById(data.pets, args.pet_id, 'Pet');
    const rule = c.resolveClearanceRule(data, {
      species: pet.species,
      clearance_type: args.clearance_type,
      rule_id: args.rule_id,
    });
    const res = c.evaluateClearance(data, {
      pet,
      rule,
      stay_start_at: args.stay_start_at,
      stay_end_at: args.stay_end_at ?? null,
      requirement_ref: args.requirement_ref ?? null,
      virtualNow: now,
    });
    return { data, result: res };
  }

  if (name === 'clovervet.clearance.list') {
    const items = args.pet_id ? data.clearances.filter((x) => x.pet_id === args.pet_id) : data.clearances;
    const effective_statuses = items.map((x) => ({
      id: x.id,
      effective_status: c.effectiveClearanceStatus(x, now),
    }));
    return { data, result: { items: c.copy(items), effective_statuses } };
  }

  if (name === 'clovervet.clearance.issue') {
    c.syncExpiredClearances(data, now);
    const pet = findById(data.pets, args.pet_id, 'Pet');
    if (pet.status !== 'active') c.fail('invalid_state_transition', `Pet ${pet.id} is not active.`);
    const rule = c.resolveClearanceRule(data, {
      species: pet.species,
      clearance_type: args.clearance_type,
      rule_id: args.rule_id,
    });
    const check = c.evaluateClearance(data, {
      pet,
      rule,
      stay_start_at: args.stay_start_at,
      stay_end_at: args.stay_end_at ?? null,
      requirement_ref: args.requirement_ref ?? null,
      virtualNow: now,
    });
    if (!check.eligible) {
      c.fail(check.reasons[0], `Clearance prerequisites unmet: ${check.reasons.join(', ')}`);
    }
    const id = c.nextId('cert', data.clearances, args.id);
    const cert = {
      id,
      account_id: data.account_id,
      pet_id: pet.id,
      rule_id: rule.id,
      clearance_type: args.clearance_type,
      status: 'issued',
      stay_start_at: args.stay_start_at,
      stay_end_at: args.stay_end_at ?? null,
      issued_at: now,
      valid_until: check.computed_valid_until,
      requirement_ref: args.requirement_ref ? c.copy(args.requirement_ref) : null,
      certificate_asset_id: null,
      notes: args.notes || '',
      created_at: now,
      updated_at: now,
      history: [{ at: now, action: 'issued' }],
    };
    data.clearances.push(cert);
    return { data, result: { id, certificate_id: id, valid_until: cert.valid_until } };
  }

  if (name === 'clovervet.clearance.revoke') {
    c.syncExpiredClearances(data, now);
    const cert = findById(data.clearances, args.id, 'Clearance certificate');
    if (cert.status !== 'issued') {
      c.fail('invalid_state_transition', `Cannot revoke clearance in status: ${cert.status}`);
    }
    cert.status = 'revoked';
    c.stamp(cert, now, 'revoked', args.reason || undefined);
    return { data, result: { id: cert.id } };
  }

  // --- Slots & Appointments ---
  if (name === 'clovervet.slot.search') {
    const items = data.slots.filter((s) => {
      if (s.status !== 'open') return false;
      if (args.branch_id && s.branch_id !== args.branch_id) return false;
      if (args.vet_id && s.vet_id !== args.vet_id) return false;
      if (args.visit_type && !s.visit_types.includes(args.visit_type)) return false;
      if (args.fear_free_room !== undefined && s.fear_free_room !== args.fear_free_room) return false;
      if (args.cat_only_slot !== undefined && s.cat_only_slot !== args.cat_only_slot) return false;
      return true;
    });
    return { data, result: { items: c.copy(items) } };
  }

  if (name === 'clovervet.appointment.list') {
    const items = data.appointments.filter((a) => {
      if (args.pet_id && a.pet_id !== args.pet_id) return false;
      if (args.status && a.status !== args.status) return false;
      return true;
    });
    return { data, result: { items: c.copy(items) } };
  }

  if (name === 'clovervet.appointment.get') {
    const item = findById(data.appointments, args.id, 'Appointment');
    return { data, result: { item: c.copy(item) } };
  }

  if (name === 'clovervet.appointment.book') {
    c.syncExpiredClearances(data, now);
    const pet = findById(data.pets, args.pet_id, 'Pet');
    if (pet.status !== 'active') c.fail('invalid_state_transition', `Pet ${pet.id} is not active.`);
    const slot = findById(data.slots, args.slot_id, 'Clinic slot');
    checkSlotCompatibility(data, pet, slot, args.visit_type, now);

    const caretaker = args.caretaker_person_ref || data.owner_person_id;
    if (caretaker !== data.owner_person_id) {
      const del = (pet.authorized_caretakers || []).find((x) => x.person_ref === caretaker);
      if (!del || del.scope === 'pickup_only') {
        c.fail('validation_error', `Caretaker ${caretaker} is not authorized for clinic visits for ${pet.id}.`);
      }
    }

    const id = c.nextId('appt', data.appointments, args.id);
    const confirmation_code = `CV-${id.toUpperCase()}`;
    slot.status = 'booked';
    const appt = {
      id,
      account_id: data.account_id,
      pet_id: pet.id,
      branch_id: slot.branch_id,
      vet_id: slot.vet_id,
      slot_id: slot.id,
      visit_type: args.visit_type,
      starts_at: slot.starts_at,
      ends_at: slot.ends_at,
      status: 'scheduled',
      confirmation_code,
      caretaker_person_ref: caretaker,
      penalty_free_until: null,
      cancellation_fee_cents: 0,
      notes: args.notes || '',
      created_at: now,
      updated_at: now,
      history: [{ at: now, action: 'booked' }],
    };
    data.appointments.push(appt);
    return { data, result: { id, confirmation_code } };
  }

  if (name === 'clovervet.appointment.reschedule') {
    c.syncExpiredClearances(data, now);
    const appt = findById(data.appointments, args.id, 'Appointment');
    if (appt.status !== 'scheduled') {
      c.fail('invalid_state_transition', `Only scheduled appointments can be rescheduled (current: ${appt.status}).`);
    }
    const pet = findById(data.pets, appt.pet_id, 'Pet');
    const newSlot = findById(data.slots, args.new_slot_id, 'Clinic slot');
    checkSlotCompatibility(data, pet, newSlot, appt.visit_type, now, appt.id);

    const oldSlot = data.slots.find((s) => s.id === appt.slot_id);
    if (oldSlot && oldSlot.status === 'booked') oldSlot.status = 'open';
    newSlot.status = 'booked';
    appt.slot_id = newSlot.id;
    appt.branch_id = newSlot.branch_id;
    appt.vet_id = newSlot.vet_id;
    appt.starts_at = newSlot.starts_at;
    appt.ends_at = newSlot.ends_at;
    appt.penalty_free_until = null;
    if (args.notes !== undefined) appt.notes = args.notes;
    c.stamp(appt, now, 'rescheduled', `Moved to ${newSlot.id}`);
    return { data, result: { id: appt.id, confirmation_code: appt.confirmation_code } };
  }

  if (name === 'clovervet.appointment.cancel') {
    c.syncExpiredClearances(data, now);
    const appt = findById(data.appointments, args.id, 'Appointment');
    if (appt.status !== 'scheduled') {
      c.fail('invalid_state_transition', `Cannot cancel appointment in status: ${appt.status}`);
    }
    const branch = findById(data.branches, appt.branch_id, 'Clinic branch');
    const nowMs = c.parseMs(now);
    const startMs = c.parseMs(appt.starts_at);
    const penaltyWaived = appt.penalty_free_until && nowMs <= c.parseMs(appt.penalty_free_until);
    const within24h = startMs - nowMs < 24 * c.HOUR_MS;
    const fee = within24h && !penaltyWaived ? branch.late_cancel_fee_cents : 0;

    const slot = data.slots.find((s) => s.id === appt.slot_id);
    if (slot && slot.status === 'booked') slot.status = 'open';
    appt.status = 'cancelled';
    appt.cancellation_fee_cents = fee;
    c.stamp(appt, now, 'cancelled', args.reason || (fee ? `Late cancel fee ${fee} cents` : 'Cancelled without fee'));
    return { data, result: { id: appt.id, cancellation_fee_cents: fee } };
  }

  // --- Prescriptions & Refills ---
  if (name === 'clovervet.prescription.list') {
    const prescriptions = args.pet_id ? data.prescriptions.filter((x) => x.pet_id === args.pet_id) : data.prescriptions;
    const refill_requests = args.pet_id ? data.refill_requests.filter((x) => x.pet_id === args.pet_id) : data.refill_requests;
    return { data, result: { prescriptions: c.copy(prescriptions), refill_requests: c.copy(refill_requests) } };
  }

  if (name === 'clovervet.prescription.get') {
    const prescription = data.prescriptions.find((x) => x.id === args.id) || null;
    const refill_request = data.refill_requests.find((x) => x.id === args.id) || null;
    if (!prescription && !refill_request) c.fail('not_found', `Prescription or refill not found: ${args.id}`);
    return { data, result: { prescription: c.copy(prescription), refill_request: c.copy(refill_request) } };
  }

  if (name === 'clovervet.prescription.request_refill') {
    c.syncExpiredClearances(data, now);
    const rx = findById(data.prescriptions, args.prescription_id, 'Prescription');
    const pet = findById(data.pets, rx.pet_id, 'Pet');
    if (pet.status !== 'active') c.fail('invalid_state_transition', `Pet ${pet.id} is not active.`);
    if (c.parseMs(now) > c.parseMs(rx.expires_at)) c.fail('PRESCRIPTION_EXPIRED', `Prescription ${rx.id} is expired.`);
    if (rx.refills_remaining <= 0) c.fail('NO_REFILLS_REMAINING', `Prescription ${rx.id} has 0 refills remaining.`);

    const conflictAllergens = rx.allergen_tags.filter((a) => pet.allergies.includes(a));
    if (conflictAllergens.length) {
      c.fail('ALLERGEN_CONFLICT', `Formulation allergens (${conflictAllergens.join(', ')}) conflict with ${pet.id} allergies.`);
    }
    if (pet.weight_kg < rx.min_weight_kg || pet.weight_kg > rx.max_weight_kg) {
      c.fail('WEIGHT_BAND_MISMATCH', `Pet ${pet.id} weight (${pet.weight_kg} kg) is outside prescription band ${rx.min_weight_kg}-${rx.max_weight_kg} kg.`);
    }
    if (rx.requires_heartworm_test && !c.hasValidLab(data, pet.id, 'heartworm_antigen', ['negative'], now)) {
      c.fail('HEARTWORM_TEST_OVERDUE', `Pet ${pet.id} requires a valid negative heartworm_antigen test.`);
    }
    const dup = data.refill_requests.find(
      (r) => r.prescription_id === rx.id && ['requested', 'vet_review'].includes(r.status)
    );
    if (dup) c.fail('DUPLICATE_ACTIVE_REFILL', `Active refill ${dup.id} already exists for ${rx.id}.`);

    const id = c.nextId('rfl', data.refill_requests, args.id);
    const refill_receipt_id = `rcpt-${id}`;
    const req = {
      id,
      account_id: data.account_id,
      prescription_id: rx.id,
      pet_id: pet.id,
      status: 'requested',
      fulfillment_mode: args.fulfillment_mode,
      pickup_branch_id: args.pickup_branch_id ?? (args.fulfillment_mode === 'clinic_pickup' ? pet.primary_branch_id : null),
      pickup_person_ref: args.pickup_person_ref ?? (args.fulfillment_mode === 'clinic_pickup' ? data.owner_person_id : null),
      shipping_address: args.shipping_address || '',
      refill_receipt_id,
      decision_note: '',
      notes: args.notes || '',
      created_at: now,
      updated_at: now,
      history: [{ at: now, action: 'requested' }],
    };
    data.refill_requests.push(req);
    return { data, result: { id, refill_receipt_id } };
  }

  if (name === 'clovervet.prescription.amend_refill') {
    c.syncExpiredClearances(data, now);
    const rfl = findById(data.refill_requests, args.id, 'Refill request');
    if (!['requested', 'vet_review'].includes(rfl.status)) {
      c.fail('invalid_state_transition', `Cannot amend refill in status: ${rfl.status}`);
    }
    const patch = args.patch || {};
    if (!Object.keys(patch).length) c.fail('validation_error', 'Patch cannot be empty.');
    for (const k of ['fulfillment_mode', 'pickup_branch_id', 'pickup_person_ref', 'shipping_address', 'notes']) {
      if (patch[k] !== undefined) rfl[k] = patch[k];
    }
    c.stamp(rfl, now, `amended_${rfl.status}`);
    return { data, result: { id: rfl.id } };
  }

  if (name === 'clovervet.prescription.cancel_refill') {
    c.syncExpiredClearances(data, now);
    const rfl = findById(data.refill_requests, args.id, 'Refill request');
    if (!['requested', 'vet_review'].includes(rfl.status)) {
      c.fail('invalid_state_transition', `Cannot cancel refill in status: ${rfl.status}`);
    }
    rfl.status = 'cancelled';
    c.stamp(rfl, now, 'cancelled', args.reason || undefined);
    return { data, result: { id: rfl.id } };
  }

  c.fail('unknown_tool', `Unknown CloverVet operation: ${name}`);
}

module.exports = { handleTool };
