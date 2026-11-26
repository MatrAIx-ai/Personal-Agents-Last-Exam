#!/usr/bin/env node
'use strict';
// Reproducible 24-month Environment dataset coverage & load/query check (docs/submission-evidence.md §3).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const plugin = require('../plugin.cjs');
const { compile } = require('../tests/schema-validator.cjs');

const ROOT = path.resolve(__dirname, '..');
const DATASET_REL = process.argv[2] || 'fixtures/eval-2025-2026.json';
const TIME_ZONE = 'America/Los_Angeles';
const WINDOW_START = '2025-01-01';
const WINDOW_END = '2026-12-31';

function toLocalDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error('Invalid timestamp: ' + iso);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

const datasetPath = path.join(ROOT, DATASET_REL);
const raw = fs.readFileSync(datasetPath);
const data = JSON.parse(raw.toString('utf8'));
const binding = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/binding.json'), 'utf8'));
const seedValid = compile(JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas/seed.schema.json'), 'utf8')), path.join(ROOT, 'schemas'));
if (!seedValid(data)) throw new Error('Dataset failed seed.schema.json validation');
plugin.validateSeed({ binding }, data);

const perSource = {
  'skills.versions.created_at': new Set(),
  'eval_reports.ran_at': new Set(),
  'deployments.at': new Set(),
  'alerts.created_at': new Set(),
  'policy.updated_at': new Set(),
};
const allDates = new Set();
const monthly = {};
for (const yr of [2025, 2026]) {
  for (let m = 1; m <= 12; m++) monthly[`${yr}-${String(m).padStart(2, '0')}`] = 0;
}

let totalTimestampedEvents = 0;
function record(source, iso) {
  if (!iso) return;
  const day = toLocalDate(iso);
  if (day < WINDOW_START || day > WINDOW_END) return;
  perSource[source].add(day);
  allDates.add(day);
  monthly[day.slice(0, 7)] = (monthly[day.slice(0, 7)] || 0) + 1;
  totalTimestampedEvents++;
}

record('policy.updated_at', data.policy.updated_at);
for (const s of data.skills) {
  for (const v of s.versions) record('skills.versions.created_at', v.created_at);
}
for (const r of data.eval_reports) record('eval_reports.ran_at', r.ran_at);
for (const dep of data.deployments) record('deployments.at', dep.at);
for (const al of data.alerts) record('alerts.created_at', al.created_at);

// Load & query smoke verification against the actual dataset
const listRes = plugin.handleTool(
  { app_id: 'loopvault', run_id: 'coverage-check', virtual_now: '2026-12-31T18:00:00-08:00', binding },
  structuredClone(data),
  'loopvault.skills.list',
  {}
).result;

const sortedDates = [...allDates].sort();
const monthsCovered = Object.values(monthly).filter(n => n > 0).length;
const report = {
  app_id: 'loopvault',
  scope: 'environment_evaluation_dataset',
  source_file: DATASET_REL,
  source_sha256: crypto.createHash('sha256').update(raw).digest('hex'),
  provenance: '100% synthetic (MIT)',
  counting_time_zone: TIME_ZONE,
  coverage_window: { start: WINDOW_START, end: WINDOW_END },
  total_skills: data.skills.length,
  total_versions: data.skills.reduce((a, s) => a + s.versions.length, 0),
  total_eval_reports: data.eval_reports.length,
  total_timestamped_records_in_window: totalTimestampedEvents,
  per_source_distinct_dates: Object.fromEntries(Object.entries(perSource).map(([k, v]) => [k, v.size])),
  global_deduplicated_distinct_dates: sortedDates.length,
  earliest_date: sortedDates[0] || null,
  latest_date: sortedDates[sortedDates.length - 1] || null,
  months_covered: monthsCovered,
  months_total: 24,
  monthly_record_counts: monthly,
  load_and_query_check: {
    schema_valid: true,
    skills_queried: listRes.skills.length,
    first_skill_id: listRes.skills[0]?.id || null,
  },
};

if (require.main === module) console.log(JSON.stringify(report, null, 2));
module.exports = { report };
