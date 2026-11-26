'use strict';
// Deterministic independent scenarios, not an export of real guest history.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const app = path.resolve(__dirname, '..');
const output = path.join(app, 'datasets');
const baselinePath = path.join(app, 'fixtures/minimal.json');
const baselineBytes = fs.readFileSync(baselinePath);
const baseline = JSON.parse(baselineBytes);
const dayMs = 86400000;
const copy = value => structuredClone(value);
const iso = value => new Date(value).toISOString().replace('.000Z', 'Z');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const patterns = [
  ['arrival-mismatch', 'A confirmed arrival window ends before the updated arrival time; changing a need alone must not rewrite the commitment.'],
  ['route-unavailable', 'The confirmed step-free route has an effective unavailability notice; a named route and its window matter.'],
  ['breakfast-partial', 'Two mornings are requested but the hotel has confirmed only the first; the second remains unresolved.'],
  ['guest-replaced', 'The current companion is different; the former companion\'s confirmed breakfast remains until explicitly cancelled.']
];
const meals = ['Plant-based breakfast', 'No dairy ingredients', 'No peanuts in the prepared breakfast', 'Plain porridge with fruit separately', 'No egg ingredients', 'Breakfast without sesame ingredients'];

function shift(value, delta) {
  if (Array.isArray(value)) return value.map(v => shift(v, delta));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shift(v, delta)]));
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(T.*Z)?$/.test(value)) {
    const next = iso(Date.parse(value.length === 10 ? value + 'T00:00:00Z' : value) + delta);
    return value.length === 10 ? next.slice(0, 10) : next;
  }
  return value;
}

function commitment(seed, need, id, terms, originalConditions = need.conditions) {
  return { id, need_id: need.id, request_id: null, request_conditions: copy(originalConditions), terms,
    confirmed_at: iso(Date.parse(seed.stay.check_in) - dayMs - 4 * 3600000), status: 'active', unavailability: [] };
}

function scenario(year, month, slot) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const date = [2, 10, 18, last - 2][slot];
  const checkIn = Date.UTC(year, month - 1, date, 15);
  const delta = checkIn - Date.parse(baseline.stay.check_in);
  const data = shift(baseline, delta);
  const id = `${year}-${String(month).padStart(2, '0')}-${patterns[slot][0]}`;
  const byNeed = name => data.needs.find(n => n.id === name);
  const arrival = byNeed('need-arrival');
  // Rotate substantive request values; dates are not the only varied fields.
  for (let person = 1; person <= 3; person++) {
    const meal = meals[(month + (year - 2025) * 2 + person + slot) % meals.length];
    data.sources.find(s => s.id === `source-breakfast-person-${person}`).fields.meal_request = meal;
    byNeed(`need-breakfast-person-${person}`).conditions.meal_request = meal;
  }
  for (const source of data.sources) source.provenance = { app_id: 'fixture', object_id: `${id}:${source.id}`, observed_version: '1' };

  if (slot === 0) {
    const old = copy(arrival.conditions);
    const hour = month % 2 ? 23 : 22;
    const minute = month % 3 === 0 ? '45' : '30';
    const current = `${data.stay.check_in.slice(0, 10)}T${hour}:${minute}:00Z`;
    const source = data.sources.find(s => s.id === 'source-arrival');
    source.fields.arrival_at = current;
    source.version = 2;
    source.provenance.observed_version = '2';
    arrival.conditions.arrival_at = current;
    arrival.revision = 2;
    arrival.source_versions[0].version = 2;
    data.commitments.push(commitment(data, arrival, 'commitment-baseline-arrival', {
      stay_id: data.stay.id, service: 'late_arrival', person_ids: copy(arrival.person_ids),
      arrival_window: { start: data.stay.check_in.slice(0, 10) + 'T21:00:00Z', end: data.stay.check_in.slice(0, 10) + 'T22:00:00Z' },
      entrance_id: 'east', access_method_id: month % 2 ? 'night-desk' : 'staff-meeting'
    }, old));
  } else if (slot === 1) {
    data.commitments[0].unavailability.push({ event_id: `known-outage-${id}`,
      recorded_at: iso(checkIn - dayMs + 3600000), effective_at: iso(checkIn - 3 * 3600000),
      reason: month % 2 ? 'East corridor temporarily closed for maintenance.' : 'Lift on the confirmed east route is unavailable.' });
  } else if (slot === 2) {
    const need = byNeed('need-breakfast-person-1');
    data.commitments.push(commitment(data, need, 'commitment-baseline-breakfast', {
      ...copy(need.conditions), morning_dates: [need.conditions.morning_dates[0]]
    }));
  } else {
    const oldNeed = byNeed('need-breakfast-person-2');
    data.commitments.push(commitment(data, oldNeed, 'commitment-former-guest-breakfast', copy(oldNeed.conditions)));
    data.stay.guest_person_ids = ['person-1', 'person-3'];
    data.stay.guest_revision = 2;
    arrival.person_ids = copy(data.stay.guest_person_ids);
    arrival.conditions.person_ids = copy(data.stay.guest_person_ids);
    arrival.revision = 2;
    arrival.review_required = true;
  }
  return { id, data, virtualNow: iso(checkIn + 3 * 3600000), pattern: patterns[slot][0], description: patterns[slot][1] };
}

fs.mkdirSync(path.join(output, 'seeds'), { recursive: true });
const entries = [];
for (let year = 2025; year <= 2026; year++) for (let month = 1; month <= 12; month++) for (let slot = 0; slot < 4; slot++) {
  const item = scenario(year, month, slot);
  const file = `seeds/${item.id}.json`;
  const bytes = json(item.data);
  fs.writeFileSync(path.join(output, file), bytes);
  entries.push({ scenario_id: item.id, file, sha256: hash(bytes), bytes: Buffer.byteLength(bytes),
    kind: 'synthetic', source_id: 'authored-scenario-library', pattern: item.pattern,
    description: item.description, initial_time: item.virtualNow, account_id: item.data.account_id,
    stay_check_in: item.data.stay.check_in, stay_check_out: item.data.stay.check_out,
    record_counts: { property: 1, stay: 1, ...Object.fromEntries(['people', 'sources', 'needs', 'requests', 'commitments', 'history'].map(k => [k, item.data[k].length])) } });
}
const manifest = {
  dataset_id: 'stayready-evaluation-2025-2026', version: '1.0.0', timezone: 'UTC',
  coverage_window: { from: '2025-01-01', through: '2026-12-31' },
  generation: { method: 'Deterministic template composition and date normalization from the authored baseline, with four distinct hotel-service situations each month.',
    generated_on: '2026-11-26', script: 'scripts/generate-dataset.cjs', script_sha256: hash(fs.readFileSync(__filename)),
    baseline: 'fixtures/minimal.json', baseline_sha256: hash(baselineBytes), random_seed: null },
  provenance: { source_id: 'authored-scenario-library', kind: 'synthetic', license: 'MIT',
    real_guest_records: 0, mixed_guest_records: 0,
    statement: 'All people, personal facts, hotel policies, requests, commitments and represented event dates are authored fiction. Each entry is an independent reset seed, not continuous guest history. November 2026 public reference facts are kept separately in evidence/reference/sources.json; they are not imported guest data.',
    future_dates: 'Records dated after collection are synthetic prospective scenarios, never observations of actual future events.',
    record_identity: 'scenario_id plus record_type plus record id; App-local IDs are intentionally reused only across isolated runs.',
    anchor_acceptance: 'pending-maintainer-review' },
  scenarios: entries
};
fs.writeFileSync(path.join(output, 'manifest.json'), json(manifest));
console.log(`Generated ${entries.length} independent StayReady seeds (4 per month); each has one property, two nights and two current guests.`);
