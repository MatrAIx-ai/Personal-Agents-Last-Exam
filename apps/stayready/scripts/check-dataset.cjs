'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const app = path.resolve(__dirname, '..');
const root = path.join(app, 'datasets');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const manifest = read(path.join(root, 'manifest.json'));
const schema = require('../src/schema-validator.cjs').compile(read(path.join(app, 'schemas/seed.schema.json')), app);
const model = require('../src/model.cjs');
const binding = read(path.join(app, 'fixtures/binding.json'));
const from = '2025-01-01', through = '2026-12-31';
const byMonth = Object.fromEntries(Array.from({ length: 24 }, (_, n) => [`${2025 + Math.floor(n / 12)}-${String(n % 12 + 1).padStart(2, '0')}`, { scenarios: 0, records: 0, synthetic_records: 0, real_records: 0, mixed_records: 0, occurrence_dates: new Set(), service_dates: new Set() }]));
const sources = {};
const dates = new Set(), occurrence = new Set(), service = new Set();
let recordsTotal = 0, undated = 0, referencesToDates = 0;
const invalidDates = [], outOfWindow = [];
const errors = [];
const recordIds = new Set();

function addDate(value, source, kind, identity) {
  const parsed = Date.parse(value.length === 10 ? value + 'T00:00:00Z' : value);
  const date = Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : '';
  if (!date || (value.length === 10 && date !== value)) { invalidDates.push({ identity, value }); return; }
  if (date < from || date > through) { outOfWindow.push({ identity, value }); return; }
  referencesToDates++;
  dates.add(date); sources[source].dates.add(date);
  (kind === 'occurrence' ? occurrence : service).add(date);
  byMonth[date.slice(0, 7)][kind + '_dates'].add(date);
}
function record(record, type, datesForRecord, entry) {
  const identity = `${entry.scenario_id}/${type}/${record.id}`;
  assert(!recordIds.has(identity), `Duplicate record identity: ${identity}`); recordIds.add(identity);
  const source = `stayready.${type}`;
  sources[source] ||= { records: 0, real_records: 0, synthetic_records: 0, mixed_records: 0, dates: new Set() };
  sources[source].records++; sources[source].synthetic_records++; recordsTotal++;
  const month = byMonth[entry.stay_check_in.slice(0, 7)]; month.records++; month.synthetic_records++;
  if (!datesForRecord.length) undated++;
  for (const [value, kind] of datesForRecord) addDate(value, source, kind, identity);
}
const occurrences = (...values) => values.filter(Boolean).map(v => [v, 'occurrence']);
const services = (...values) => values.filter(Boolean).map(v => [v, 'service']);
const conditionDates = conditions => !conditions ? [] : services(conditions.arrival_at, conditions.window?.start, conditions.window?.end, ...(conditions.morning_dates || []));

for (const entry of manifest.scenarios) {
  try {
    const bytes = fs.readFileSync(path.join(root, entry.file));
    assert.equal(hash(bytes), entry.sha256, `Hash mismatch: ${entry.file}`);
    assert.equal(bytes.length, entry.bytes);
    const data = JSON.parse(bytes);
    assert(schema(data), `Seed schema failed: ${entry.file}`);
    assert.equal(model.validateSeed({ binding }, data), true, `Business validation failed: ${entry.file}`);
    assert.equal(model.records(data).length, 2 + data.people.length + data.sources.length + data.needs.length + data.requests.length + data.commitments.length + data.history.length);
    assert.equal(data.stay.guest_person_ids.length, 2);
    assert.equal(data.property.timezone, 'UTC');
    assert.equal(data.stay.property_id, data.property.id);
    assert.equal((Date.parse(data.stay.check_out.slice(0, 10)) - Date.parse(data.stay.check_in.slice(0, 10))) / 86400000, 2);
    assert.equal(entry.kind, 'synthetic');
    assert.equal(entry.stay_check_in, data.stay.check_in);
    assert.equal(entry.stay_check_out, data.stay.check_out);
    assert.deepEqual(entry.record_counts, { property: 1, stay: 1, ...Object.fromEntries(['people', 'sources', 'needs', 'requests', 'commitments', 'history'].map(k => [k, data[k].length])) });
    assert(data.sources.every(s => Date.parse(s.observed_at) <= Date.parse(entry.initial_time)));
    assert(data.commitments.every(c => Date.parse(c.confirmed_at) <= Date.parse(entry.initial_time)));
    byMonth[entry.stay_check_in.slice(0, 7)].scenarios++;
    record(data.property, 'property', [], entry); // Static property/route metadata is not history.
    record(data.stay, 'stay', services(data.stay.check_in, data.stay.check_out), entry);
    for (const item of data.people) record(item, 'person', [], entry);
    for (const item of data.sources) record(item, 'source', occurrences(item.observed_at), entry);
    for (const item of data.needs) record(item, 'need', conditionDates(item.conditions), entry);
    for (const item of data.requests) record(item, 'request', occurrences(item.submitted_at, ...item.replies.map(r => r.at)), entry);
    for (const item of data.commitments) record(item, 'commitment', [...occurrences(item.confirmed_at, ...item.unavailability.map(n => n.recorded_at)), ...conditionDates(item.terms), ...services(item.terms.arrival_window?.start, item.terms.arrival_window?.end, ...item.unavailability.map(n => n.effective_at))], entry);
    for (const item of data.history) record(item, 'history', occurrences(item.at), entry);
  } catch (error) { errors.push(`${entry.scenario_id}: ${error.message}`); }
}
assert.equal(manifest.timezone, 'UTC');
assert.equal(hash(fs.readFileSync(path.join(app, manifest.generation.baseline))), manifest.generation.baseline_sha256, 'Baseline changed: regenerate the dataset intentionally.');
assert.equal(hash(fs.readFileSync(path.join(app, manifest.generation.script))), manifest.generation.script_sha256, 'Generator changed: regenerate the dataset intentionally.');
assert.equal(manifest.scenarios.length, 96);
assert(Object.values(byMonth).every(month => month.scenarios === 4));
const sorted = set => [...set].sort();
const missing = [];
for (let time = Date.parse(from); time <= Date.parse(through); time += 86400000) {
  const date = new Date(time).toISOString().slice(0, 10); if (!dates.has(date)) missing.push(date);
}
const report = {
  dataset_id: manifest.dataset_id, timezone: 'UTC', coverage_window: manifest.coverage_window,
  manifest_sha256: hash(fs.readFileSync(path.join(root, 'manifest.json'))),
  counting_script_sha256: hash(fs.readFileSync(__filename)),
  scenarios: manifest.scenarios.length, total_records: recordsTotal, real_records: 0, synthetic_records: recordsTotal, mixed_records: 0,
  undated_records_excluded_from_date_counts: undated, represented_date_references: referencesToDates,
  global_distinct_dates: dates.size, earliest_date: sorted(dates)[0], latest_date: sorted(dates).at(-1),
  observed_or_confirmed_occurrence_dates: sorted(occurrence), represented_service_dates: sorted(service),
  global_dates: sorted(dates), missing_calendar_dates: missing,
  monthly: Object.fromEntries(Object.entries(byMonth).map(([m, v]) => [m, { ...v, occurrence_dates: sorted(v.occurrence_dates), service_dates: sorted(v.service_dates), distinct_dates: new Set([...v.occurrence_dates, ...v.service_dates]).size }])),
  sources: Object.fromEntries(Object.entries(sources).map(([s, v]) => [s, { ...v, distinct_dates: v.dates.size, dates: sorted(v.dates) }])),
  invalid_dates: invalidDates, out_of_window_dates: outOfWindow, validation_errors: errors,
  exclusions: [
    'Static property and person records have no occurrence date and are excluded from date counts.',
    'Generation, file modification, collection dates, source provenance versions and scenario clock are not guest activity dates.',
    'Repeated dates across fields, records and independent seeds count once globally.',
    'Need/commitment service dates and stay dates are represented obligations, not proof of completed stays or pre-session history.',
    'Public reference facts and screenshots are reported separately; no real guest records were collected.'
  ]
};
const reportPath = path.join(root, 'coverage.json');
if (process.argv.includes('--write')) fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
else assert.deepEqual(read(reportPath), report, 'Coverage differs; investigate, then regenerate with --write.');
assert.equal(errors.length + invalidDates.length + outOfWindow.length, 0, JSON.stringify({ errors, invalidDates, outOfWindow }, null, 2));
assert.equal(report.earliest_date, from); assert.equal(report.latest_date, through);
const referenceRoot = path.join(app, 'evidence/reference');
const references = read(path.join(referenceRoot, 'sources.json'));
assert.equal(references.records.length, references.counts.real_public_reference_records);
assert.equal(references.counts.real_guest_records, 0);
assert.equal(new Set(references.records.map(r => r.represented_date)).size, references.counts.distinct_observation_dates);
for (const item of [...references.records.flatMap(r => r.screenshots), ...references.inaccessible_or_alternative.map(r => r.evidence)]) {
  const bytes = fs.readFileSync(path.join(referenceRoot, item.file));
  assert.equal(hash(bytes), item.sha256, `Public-reference screenshot changed: ${item.file}`);
  assert.equal(bytes.length, item.bytes);
}
console.log(JSON.stringify({ scenarios: report.scenarios, records: recordsTotal, global_distinct_dates: dates.size,
  occurrence_dates: occurrence.size, represented_service_dates: service.size, earliest_date: report.earliest_date, latest_date: report.latest_date,
  missing_calendar_dates: missing.length, invalid_dates: invalidDates.length, out_of_window_dates: outOfWindow.length }, null, 2));
