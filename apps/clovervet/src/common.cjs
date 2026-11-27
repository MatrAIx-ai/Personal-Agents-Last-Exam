'use strict';

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/;
const DAY_MS = 86400 * 1000;
const HOUR_MS = 3600 * 1000;

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

function toIsoOffset(ms) {
  return new Date(ms).toISOString().replace('Z', '+00:00');
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

function validateRequirementRef(ref) {
  if (ref === null || ref === undefined) return { valid: true, present: false };
  if (typeof ref !== 'object' || Array.isArray(ref)) return { valid: false, present: true, reason: 'REFERENCE_INVALID' };
  if (!['file_ref', 'asset_ref'].includes(ref.kind)) return { valid: false, present: true, reason: 'REFERENCE_INVALID' };
  if (typeof ref.id !== 'string' || !ID_RE.test(ref.id)) return { valid: false, present: true, reason: 'REFERENCE_INVALID' };
  if (ref.version !== undefined && ref.version !== null) {
    if (!Number.isInteger(ref.version) || ref.version < 1) return { valid: false, present: true, reason: 'REFERENCE_INVALID' };
  }
  return { valid: true, present: true };
}

function effectiveClearanceStatus(cert, virtualNow) {
  if (cert.status === 'issued' && parseMs(virtualNow) > parseMs(cert.valid_until)) {
    return 'expired';
  }
  return cert.status;
}

// Commit derived expired clearances on writes/events (never on reads)
function syncExpiredClearances(data, virtualNow) {
  const nowMs = parseMs(virtualNow);
  for (const cert of data.clearances) {
    if (cert.status === 'issued' && nowMs > parseMs(cert.valid_until)) {
      cert.status = 'expired';
      stamp(cert, virtualNow, 'expired');
    }
  }
}

function resolveClearanceRule(data, { species, clearance_type, rule_id }) {
  if (rule_id) {
    const r = data.clearance_rules.find((x) => x.id === rule_id);
    if (!r) fail('not_found', `Unknown clearance rule: ${rule_id}`);
    if (r.species !== species || r.clearance_type !== clearance_type) {
      fail('validation_error', `Rule ${rule_id} does not match ${species} / ${clearance_type}`);
    }
    return r;
  }
  const r = data.clearance_rules.find((x) => x.species === species && x.clearance_type === clearance_type);
  if (!r) fail('not_found', `No seeded clearance rule for ${species} / ${clearance_type}`);
  return r;
}

function evaluateClearance(data, { pet, rule, stay_start_at, stay_end_at, requirement_ref, virtualNow }) {
  const reasons = [];
  const nowMs = parseMs(virtualNow);
  const startMs = parseMs(stay_start_at);
  const endMs = stay_end_at ? parseMs(stay_end_at) : startMs;

  if (endMs < startMs) reasons.push('INVALID_STAY_WINDOW');
  const refCheck = validateRequirementRef(requirement_ref);
  if (!refCheck.valid) reasons.push('REFERENCE_INVALID');

  // Interstate travel 10-day pre-departure window
  if (rule.max_days_before_departure !== null) {
    const leadDays = (startMs - nowMs) / DAY_MS;
    if (leadDays < 0 || leadDays > rule.max_days_before_departure) {
      reasons.push('CERTIFICATE_WINDOW_EXCEEDED');
    }
  }

  // Wellness exam recency check
  if (!pet.last_exam_at || !pet.exam_valid_until) {
    reasons.push('EXAM_PREREQUISITE_MISSING');
  } else {
    const examAgeDays = (nowMs - parseMs(pet.last_exam_at)) / DAY_MS;
    if (examAgeDays > rule.max_exam_age_days || parseMs(pet.exam_valid_until) < nowMs) {
      reasons.push('EXAM_PREREQUISITE_EXPIRED');
    }
  }

  // Check each required vaccine from seeded rule
  const petVax = data.vaccinations.filter((v) => v.pet_id === pet.id);
  for (const req of rule.required_vaccines) {
    const matches = petVax
      .filter((v) => v.vaccine_type === req.vaccine_type)
      .sort((a, b) => parseMs(b.administered_at) - parseMs(a.administered_at));
    if (!matches.length) {
      reasons.push(`VACCINE_MISSING:${req.vaccine_type}`);
      continue;
    }
    const latest = matches[0];
    const expMs = parseMs(latest.expires_at);
    const admMs = parseMs(latest.administered_at);
    const waitDays = Math.max(req.min_waiting_days, latest.waiting_period_days || 0);
    if (expMs < endMs) {
      reasons.push('VACCINE_EXPIRES_BEFORE_END');
    }
    if (startMs < admMs + waitDays * DAY_MS) {
      reasons.push('WAITING_PERIOD_UNMET');
    }
  }

  const uniqueReasons = [...new Set(reasons)];
  const computed_valid_until = toIsoOffset(nowMs + rule.certificate_validity_days * DAY_MS);
  const requirement_ref_status = !refCheck.present ? 'none' : refCheck.valid ? 'valid' : 'invalid';

  return {
    eligible: uniqueReasons.length === 0,
    rule_id: rule.id,
    reasons: uniqueReasons,
    evaluated_at: virtualNow,
    computed_valid_until,
    requirement_ref_status,
  };
}

function hasValidLab(data, petId, panelType, requiredStatuses, virtualNow) {
  const nowMs = parseMs(virtualNow);
  return data.lab_results.some(
    (l) =>
      l.pet_id === petId &&
      l.panel_type === panelType &&
      requiredStatuses.includes(l.status) &&
      parseMs(l.valid_until) >= nowMs
  );
}

function assertAccountBinding(ctx, data) {
  const binding = ctx && ctx.binding;
  if (!binding) return;
  const people = new Set((binding.people || []).map((p) => p.person_id));
  const acct = (binding.accounts || []).find(
    (a) => a.app_id === 'clovervet' && a.account_id === data.account_id && a.owner_person_id === data.owner_person_id
  );
  if (!acct) fail('invalid_seed', 'Account or owner_person_id is not bound in fixtures/binding.json.');
  if (!people.has(data.owner_person_id)) fail('invalid_seed', `Unknown owner_person_id: ${data.owner_person_id}`);
  for (const pet of data.pets) {
    for (const ct of pet.authorized_caretakers || []) {
      if (!people.has(ct.person_ref)) fail('invalid_seed', `Unknown caretaker person_ref: ${ct.person_ref}`);
    }
  }
}

module.exports = {
  ID_RE,
  DAY_MS,
  HOUR_MS,
  fail,
  copy,
  nowOf,
  parseMs,
  toIsoOffset,
  stamp,
  nextId,
  validateRequirementRef,
  effectiveClearanceStatus,
  syncExpiredClearances,
  resolveClearanceRule,
  evaluateClearance,
  hasValidLab,
  assertAccountBinding,
};
