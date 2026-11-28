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
const timezone=manifest.timezone;
const localDate=value=>{if(value.length===10)return value;const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));return `${parts.year}-${parts.month}-${parts.day}`;};
const variation={check_in_days:new Set(),check_in_times:new Set(),check_out_times:new Set(),source_observed_times:new Set(),request_lead_hours:new Set(),current_companions:new Set(),request_counts:new Set(),request_statuses:new Set(),days_by_pattern:{}};
let requestsWithAcknowledgment=0,confirmedRequests=0,historyRecords=0;
const byMonth = Object.fromEntries(Array.from({ length: 24 }, (_, n) => [`${2025 + Math.floor(n / 12)}-${String(n % 12 + 1).padStart(2, '0')}`, { scenarios: 0, records: 0, synthetic_records: 0, real_records: 0, mixed_records: 0, occurrence_dates: new Set(), service_dates: new Set() }]));
const sources = {};
const dates = new Set(), occurrence = new Set(), service = new Set();
let recordsTotal = 0, undated = 0, referencesToDates = 0;
const invalidDates = [], outOfWindow = [];
const errors = [];
const recordIds = new Set();

function addDate(value, source, kind, identity) {
  const parsed = Date.parse(value.length === 10 ? value + 'T00:00:00Z' : value);
  const date = Number.isFinite(parsed) ? localDate(value) : '';
  if (!date || (value.length === 10 && new Date(parsed).toISOString().slice(0,10) !== value)) { invalidDates.push({ identity, value }); return; }
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
  const month = byMonth[localDate(entry.stay_check_in).slice(0, 7)]; month.records++; month.synthetic_records++;
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
    assert.equal(data.property.timezone, timezone);
    assert.equal(data.stay.property_id, data.property.id);
    assert.equal((Date.parse(localDate(data.stay.check_out)) - Date.parse(localDate(data.stay.check_in))) / 86400000, 2);
    assert.equal(entry.kind, 'synthetic');
    assert.equal(entry.stay_check_in, data.stay.check_in);
    assert.equal(entry.stay_check_out, data.stay.check_out);
    assert.deepEqual(entry.record_counts, { property: 1, stay: 1, ...Object.fromEntries(['people', 'sources', 'needs', 'requests', 'commitments', 'history'].map(k => [k, data[k].length])) });
    assert(data.sources.every(s => Date.parse(s.observed_at) <= Date.parse(entry.initial_time)));
    assert(data.commitments.every(c => Date.parse(c.confirmed_at) <= Date.parse(entry.initial_time)));
    assert(data.requests.every(r => Date.parse(r.submitted_at) < Date.parse(entry.initial_time) && r.replies.every(reply => Date.parse(reply.at) < Date.parse(entry.initial_time))), 'Prior request/reply history must precede the scenario session.');
    assert(data.history.every(h => Date.parse(h.at) < Date.parse(entry.initial_time)), 'Prior operation/event history must precede the scenario session.');
    assert(data.requests.length>=2 && data.requests.length<=4,'Each scenario contains 2–4 causal requests.');
    assert(data.history.length>0,'Prior histories must be delivered in the actual seed.');
    variation.check_in_days.add(localDate(data.stay.check_in).slice(8));
    variation.check_in_times.add(data.stay.check_in.slice(11));variation.check_out_times.add(data.stay.check_out.slice(11));
    variation.days_by_pattern[entry.pattern] ||= new Set();variation.days_by_pattern[entry.pattern].add(localDate(data.stay.check_in).slice(8));
    variation.current_companions.add(data.stay.guest_person_ids.find(id=>id!==data.owner_person_id));variation.request_counts.add(data.requests.length);
    for(const s of data.sources)variation.source_observed_times.add(s.observed_at.slice(11));
    for(const r of data.requests) {
      variation.request_statuses.add(r.status);variation.request_lead_hours.add(Math.round((Date.parse(data.stay.check_in)-Date.parse(r.submitted_at))/3600000));
      assert(r.replies.some(reply=>reply.outcome==='acknowledged'),'Every authored request has a real acknowledgment.');requestsWithAcknowledgment++;
      if(r.status==='confirmed')confirmedRequests++;
      assert(data.history.some(h=>h.operation==='stayready.request.submit'&&h.target_id===r.id));
      for(const reply of r.replies)assert(data.history.some(h=>h.event_id===reply.event_id&&h.target_id===r.id&&h.outcome===reply.outcome));
    }
    historyRecords+=data.history.length;
    byMonth[localDate(entry.stay_check_in).slice(0, 7)].scenarios++;
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
assert.equal(manifest.timezone, read(path.join(app,'fixtures/minimal.json')).property.timezone);
assert.equal(hash(fs.readFileSync(path.join(app, manifest.generation.baseline))), manifest.generation.baseline_sha256, 'Baseline changed: regenerate the dataset intentionally.');
assert.equal(hash(fs.readFileSync(path.join(app, manifest.generation.script))), manifest.generation.script_sha256, 'Generator changed: regenerate the dataset intentionally.');
for(const input of manifest.generation.inputs)assert.equal(hash(fs.readFileSync(path.join(app,input.file))),input.sha256,'Generator input changed: '+input.file);
assert.equal(manifest.scenarios.length, 96);
assert.equal(recordsTotal,manifest.expected_counts.records);
const declaration=read(path.join(root,'declaration.json'));
const datasetValidator=require('../src/schema-validator.cjs').compile(read(path.join(app,'schemas/dataset.schema.json')),app);
assert(datasetValidator(declaration),'Complete evaluation dataset declaration must satisfy the public schema.');
assert.equal(declaration.dataset_id,manifest.dataset_id);assert.deepEqual(declaration.expected_counts,{records:recordsTotal,assets:0});
assert.equal(declaration.sources[0].kind,'synthetic');assert.equal(declaration.sources[0].uri,'manifest.json');
const baselineDeclaration=read(path.join(app,'contribution/dataset.json'));
assert(datasetValidator(baselineDeclaration));assert.equal(baselineDeclaration.expected_counts.records,model.records(read(path.join(app,'fixtures/minimal.json'))).length);
const delivered=baselineDeclaration.sources.find(s=>s.source_id==='authored-scenario-library');
assert(delivered,'Contribution must explicitly link the delivered library');assert.equal(delivered.uri,'../datasets/declaration.json');
assert.equal(delivered.generation.parameters.manifest,'../datasets/manifest.json');
assert.deepEqual(delivered.generation.parameters.expected_counts,{scenarios:96,records:recordsTotal,assets:0});
assert(variation.check_in_days.size>=12);assert(variation.check_in_times.size>=4);assert(variation.source_observed_times.size>=24);
assert(variation.request_lead_hours.size>=24);assert.equal(variation.current_companions.size,2);
assert.deepEqual([...variation.request_counts].sort(),[2,3,4]);
assert(Object.values(variation.days_by_pattern).every(days=>days.size>=3),'Every pattern must vary day-of-month.');
for(const status of ['confirmed','declined','needs_clarification','withdrawn'])assert(variation.request_statuses.has(status));
assert(Object.values(byMonth).every(month => month.scenarios === 4));
const sorted = set => [...set].sort();
const missing = [];
for (let time = Date.parse(from); time <= Date.parse(through); time += 86400000) {
  const date = new Date(time).toISOString().slice(0, 10); if (!dates.has(date)) missing.push(date);
}
const report = {
  dataset_id: manifest.dataset_id, timezone, coverage_window: manifest.coverage_window,
  manifest_sha256: hash(fs.readFileSync(path.join(root, 'manifest.json'))),
  counting_script_sha256: hash(fs.readFileSync(__filename)),
  variation_time_fields: 'Time-of-day samples are UTC serialization; calendar-day coverage is normalized to '+timezone+'.',
  variation: Object.fromEntries(Object.entries(variation).map(([key,value])=>[key,value instanceof Set?sorted(value):Object.fromEntries(Object.entries(value).map(([pattern,days])=>[pattern,sorted(days)]))])),
  prior_history: {requests_with_acknowledgment:requestsWithAcknowledgment,confirmed_requests:confirmedRequests,history_records:historyRecords},
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
console.log(JSON.stringify({ scenarios: report.scenarios, records: recordsTotal, global_distinct_dates: dates.size,
  occurrence_dates: occurrence.size, represented_service_dates: service.size, earliest_date: report.earliest_date, latest_date: report.latest_date,
  requests_with_acknowledgment:requestsWithAcknowledgment,confirmed_requests:confirmedRequests,history_records:historyRecords,
  missing_calendar_dates: missing.length, invalid_dates: invalidDates.length, out_of_window_dates: outOfWindow.length }, null, 2));
