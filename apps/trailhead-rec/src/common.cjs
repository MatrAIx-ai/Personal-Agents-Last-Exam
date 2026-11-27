'use strict';

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  throw err;
}

function copy(v) {
  return structuredClone(v);
}

function nowOf(ctx) {
  return (ctx && ctx.virtual_now) || '2026-11-18T12:00:00+00:00';
}

function parseMs(ts) {
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) fail('invalid_timestamp', `Invalid ISO-8601 timestamp: ${ts}`);
  return ms;
}

function stamp(record, at, action, note) {
  record.updated_at = at;
  record.history.push(note ? { at, action, note } : { at, action });
}

function nextId(prefix, list, requested) {
  if (requested) {
    if (list.some((r) => r.id === requested)) fail('duplicate_id', `Duplicate ID: ${requested}`);
    return requested;
  }
  let n = list.length + 1;
  while (list.some((r) => r.id === `${prefix}-${n}`)) n += 1;
  return `${prefix}-${n}`;
}

function effectivePassStatus(pass, virtualNow) {
  if (pass.status === 'depleted' || pass.remaining_visits <= 0) return 'depleted';
  if (pass.status === 'active' && parseMs(virtualNow) > parseMs(pass.expires_at)) {
    return 'expired';
  }
  return pass.status;
}

function isFacilityClosedAt(fac, ts) {
  return Boolean(fac && fac.closed_until && parseMs(ts) <= parseMs(fac.closed_until));
}

function effectiveEnrollmentStatus(enr, virtualNow) {
  if (enr.status === 'offer_pending' && enr.offer_expires_at && parseMs(virtualNow) > parseMs(enr.offer_expires_at)) {
    return 'offer_expired';
  }
  return enr.status;
}

// Commit derived virtual-time expirations on writes and events (never on reads)
function syncVirtualExpirations(data, virtualNow) {
  const nowMs = parseMs(virtualNow);
  for (const pass of data.passes) {
    if (pass.status === 'active' && nowMs > parseMs(pass.expires_at)) {
      pass.status = 'expired';
    }
  }
  for (const enr of data.enrollments) {
    if (enr.status === 'offer_pending' && enr.offer_expires_at && nowMs > parseMs(enr.offer_expires_at)) {
      enr.status = 'offer_expired';
      stamp(enr, virtualNow, 'offer_expired');
    }
  }
}

function hasSignedWaiver(member, waiverType) {
  if (!waiverType) return true;
  const w = (member.waivers || []).find((x) => x.waiver_type === waiverType);
  return Boolean(w && w.status === 'signed');
}

function evaluateEnrollment(data, { program, member, virtualNow, forOfferAcceptance = false }) {
  const reasons = [];
  if (member.age < program.min_age || member.age > program.max_age) {
    reasons.push('ELIGIBILITY_FAILED');
  }
  if (program.prerequisite_skill && !(member.completed_skills || []).includes(program.prerequisite_skill)) {
    reasons.push('ELIGIBILITY_FAILED');
  }
  if (program.required_waiver && !hasSignedWaiver(member, program.required_waiver)) {
    reasons.push('WAIVER_CONSENT_REQUIRED');
  }
  const fee_cents = member.resident ? program.resident_fee_cents : program.non_resident_fee_cents;
  const seatsOpen = Math.max(0, program.capacity - program.enrolled_count);

  if (!forOfferAcceptance) {
    const dup = data.enrollments.find(
      (e) =>
        e.program_id === program.id &&
        e.person_ref === member.person_ref &&
        ['waitlisted', 'offer_pending', 'enrolled'].includes(effectiveEnrollmentStatus(e, virtualNow))
    );
    if (dup) reasons.push('DUPLICATE_ENROLLMENT');
  }

  const willSeat = forOfferAcceptance || seatsOpen > 0;
  if (willSeat && data.household_credit_cents < fee_cents) {
    reasons.push('INSUFFICIENT_CREDIT');
  }

  const uniqueReasons = [...new Set(reasons)];
  let outcome_if_submitted = 'ineligible';
  if (uniqueReasons.length === 0) {
    outcome_if_submitted = willSeat ? 'enrolled' : 'waitlisted';
  }
  return {
    eligible: uniqueReasons.length === 0,
    reasons: uniqueReasons,
    fee_cents,
    outcome_if_submitted,
  };
}

function assertAccountBinding(ctx, data) {
  const binding = ctx && ctx.binding;
  if (!binding) return;
  const people = new Set((binding.people || []).map((p) => p.person_id));
  const acct = (binding.accounts || []).find(
    (a) => a.app_id === 'trailhead-rec' && a.account_id === data.account_id && a.owner_person_id === data.owner_person_id
  );
  if (!acct) fail('invalid_seed', 'Account or owner_person_id is not bound in fixtures/binding.json.');
  if (!people.has(data.owner_person_id)) fail('invalid_seed', `Unknown owner_person_id: ${data.owner_person_id}`);
  for (const m of data.members) {
    if (!people.has(m.person_ref)) fail('invalid_seed', `Unknown member person_ref: ${m.person_ref}`);
  }
}

module.exports = {
  fail,
  copy,
  nowOf,
  parseMs,
  stamp,
  nextId,
  effectivePassStatus,
  isFacilityClosedAt,
  effectiveEnrollmentStatus,
  syncVirtualExpirations,
  hasSignedWaiver,
  evaluateEnrollment,
  assertAccountBinding,
};
