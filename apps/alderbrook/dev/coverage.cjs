'use strict';
// Counts the dated claim lifecycle steps in the delivered evaluation seeds and writes data/evaluation/coverage.json and coverage.md.
// It reads only the files that env.load_seed loads. Usage: node dev/coverage.cjs [--check]. With --check it writes nothing and fails when a report differs.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const records = require('./evaluation-records.cjs');

const ROOT = path.resolve(__dirname, '..'), DIR = path.join(ROOT, 'data/evaluation');
const {ZONE, WINDOW, KINDS} = records;
const sha256 = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
const months = () => {
  const out = [];
  for (let y = 2025; y <= 2026; y++) for (let m = 1; m <= 12; m++) out.push(y + '-' + String(m).padStart(2, '0'));
  return out;
};
const dayNumber = day => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / 86400000;
const dayText = n => new Date(n * 86400000).toISOString().slice(0, 10);
const range = list => list.length ? {earliest: list.reduce((a, b) => a < b ? a : b), latest: list.reduce((a, b) => a > b ? a : b)} : {earliest: null, latest: null};
const distinct = rows => [...new Set(rows.map(r => r.day))].sort();

function report() {
  const manifestBytes = fs.readFileSync(path.join(DIR, 'manifest.json')), manifest = JSON.parse(manifestBytes);
  const files = [{path: 'data/evaluation/manifest.json', bytes: manifestBytes.length, sha256: sha256(manifestBytes)}];
  const all = [], scheduled = [], context = {loss_at: [], evidence_dated: [], policy_terms: 0, notifications: [], activity: []}, accounts = [], hashErrors = [];
  for (const entry of manifest.accounts) {
    const seedBytes = fs.readFileSync(path.join(DIR, entry.seed)), bindingBytes = fs.readFileSync(path.join(DIR, entry.binding));
    for (const [file, bytes, expected] of [[entry.seed, seedBytes, entry.seed_sha256], [entry.binding, bindingBytes, entry.binding_sha256]]) {
      files.push({path: 'data/evaluation/' + file, bytes: bytes.length, sha256: sha256(bytes)});
      if (sha256(bytes) !== expected) hashErrors.push(file);
    }
    const seed = JSON.parse(seedBytes), rows = records.lifecycle(seed.account_id, seed.claims);
    all.push(...rows);
    scheduled.push(...records.scheduled(seed.account_id, seed.claims, entry.virtual_now));
    for (const claim of seed.claims) {
      context.loss_at.push({day: records.day(claim.loss_at)});
      for (const item of claim.evidence) context.evidence_dated.push({day: records.day(item.dated)});
    }
    context.policy_terms += seed.policies.length;
    context.notifications.push(...seed.notifications.map(n => ({day: records.day(n.at)})));
    context.activity.push(...seed.activity.map(a => ({day: records.day(a.at), action: a.action, ref: seed.account_id + '/' + a.object_id})));
    const inside = rows.filter(r => r.day && r.day >= WINDOW.start && r.day <= WINDOW.end && Date.parse(r.at) < Date.parse(entry.virtual_now));
    accounts.push({account_id: seed.account_id, provenance: entry.provenance, virtual_now: entry.virtual_now, policies: seed.policies.length, claims: seed.claims.length,
      claim_states: tally(seed.claims.map(c => c.state + (c.outcome ? ':' + c.outcome : ''))), lifecycle_steps: rows.length, counted_steps: inside.length,
      distinct_dates: distinct(inside).length, ...range(distinct(inside))});
  }
  const clockOf = new Map(manifest.accounts.map(a => [a.account_id, Date.parse(a.virtual_now)]));
  const exclusions = [], counted = [];
  for (const row of all) {
    const reason = !row.day ? 'The time is missing or has no UTC offset.' : row.day < WINDOW.start ? 'Before the coverage window: the claim started in late 2024.'
      : row.day > WINDOW.end ? 'After the coverage window.' : Date.parse(row.at) >= clockOf.get(row.account_id) ? 'At or after the seed clock, so it is not past activity.' : null;
    if (reason) exclusions.push({account_id: row.account_id, claim_id: row.claim_id, kind: row.kind, record_id: row.record_id, at: row.at, reason});
    else counted.push(row);
  }
  const days = distinct(counted), first = dayNumber(WINDOW.start), last = dayNumber(WINDOW.end), active = new Set(days), gaps = [];
  let run = null;
  for (let n = first; n <= last + 1; n++) {
    if (n <= last && !active.has(dayText(n))) { run = run || {from: dayText(n), days: 0}; run.days++; run.to = dayText(n); }
    else if (run) { gaps.push(run); run = null; }
  }
  const weekday = day => new Date(dayNumber(day) * 86400000).getUTCDay(), holidays = new Set(manifest.generator.holidays_without_insurer_work);
  const idle = [];
  for (let n = first; n <= last; n++) if (!active.has(dayText(n))) idle.push(dayText(n));
  const monthly = months().map(month => {
    const rows = counted.filter(r => r.day.startsWith(month));
    return {month, distinct_dates: distinct(rows).length, steps: rows.length, claims_filed: rows.filter(r => r.kind === 'claim_filed').length,
      by_kind: Object.fromEntries(KINDS.map(k => [k.kind, rows.filter(r => r.kind === k.kind).length]))};
  });
  const contextSummary = rows => ({records: rows.length, in_window: rows.filter(r => r.day && r.day >= WINDOW.start && r.day <= WINDOW.end).length,
    distinct_dates_in_window: distinct(rows.filter(r => r.day && r.day >= WINDOW.start && r.day <= WINDOW.end)).length, ...range(rows.filter(r => r.day).map(r => r.day))});
  return {
    schema: 'alderbrook.evaluation-coverage.v1',
    scope: 'Environment evaluation dataset of the Alderbrook App: every delivered account seed in data/evaluation/, as env.load_seed loads it. This is not a Task history report.',
    dataset: {dataset_id: manifest.dataset_id, version: manifest.version, generator: manifest.generator.tool, generator_version: manifest.generator.version, seed: manifest.generator.seed},
    provenance: {...Object.fromEntries(['real', 'mixed', 'synthetic'].map(kind => [kind, manifest.accounts.filter(a => a.provenance === kind).length])),
      unit: 'account seed', statement: manifest.statement},
    time_zone: ZONE, window: WINDOW, seed_clock: [...new Set(manifest.accounts.map(a => a.virtual_now))],
    counting_rule: 'Each lifecycle step counts on its calendar day in ' + ZONE + '. A step counts when its day is inside the window and its time is before the seed clock. Several steps on one day count once.',
    authoritative_fields: KINDS.map(k => ({kind: k.kind, records: k.list, field: k.field})),
    not_counted: [
      {field: 'policies[].term.start, policies[].term.end', reason: 'Policy effective and expiration dates are context, not claim activity.'},
      {field: 'claims[].loss_at', reason: 'The time of the loss. The claim counts on its filing day.'},
      {field: 'claims[].evidence[].dated', reason: 'When a photo or receipt was made. The evidence counts on the day it was added to the claim.'},
      {field: 'claims[].estimates[].lines[].decisions[].decided_at', reason: 'A line decision is part of its determination or its dispute decision, and it has the same time. That step already counts.'},
      {field: 'notifications[].at', reason: 'The App writes one notification for each insurer event, at the time of that event. So it repeats a counted date.'},
      {field: 'activity[].at, claims[].history[].at', reason: 'The App log of every write and event. It also holds writes that keep no dated record of their own (payee.set, claims.update, preferences.update). Their dates are left out, so the count is lower than the log. See context.activity_only_dates.'},
      {field: 'requests[].due_at, offers[].respond_by', reason: 'Deadlines. When one is after the seed clock it is listed under scheduled.'}],
    files, hash_errors: hashErrors,
    totals: {accounts: accounts.length, policies: accounts.reduce((s, a) => s + a.policies, 0), claims: accounts.reduce((s, a) => s + a.claims, 0),
      lifecycle_steps: all.length, counted_steps: counted.length, excluded_steps: exclusions.length, scheduled_items: scheduled.length},
    global: {distinct_dates: days.length, ...range(days), window_days: last - first + 1, days_without_activity: last - first + 1 - days.length,
      weekend_dates: days.filter(d => [0, 6].includes(weekday(d))).length, weekday_dates: days.filter(d => ![0, 6].includes(weekday(d))).length,
      inactive_weekend_or_holiday_days: idle.filter(d => [0, 6].includes(weekday(d)) || holidays.has(d)).length},
    per_kind: KINDS.map(k => {
      const rows = counted.filter(r => r.kind === k.kind), d = distinct(rows);
      return {kind: k.kind, field: k.field, steps: rows.length, excluded: exclusions.filter(r => r.kind === k.kind).length, distinct_dates: d.length, ...range(d)};
    }),
    monthly,
    gaps: {months_without_activity: monthly.filter(m => !m.steps).map(m => m.month), longest: [...gaps].sort((a, b) => b.days - a.days || (a.from < b.from ? -1 : 1)).slice(0, 10),
      runs_without_activity: gaps.length},
    per_account: accounts,
    exclusions,
    scheduled: {rule: 'Deadlines after the seed clock: the due time of an open request and the answer time of an open offer. They are future items, not past activity.', items: scheduled},
    context: {policy_terms: context.policy_terms, loss_at: contextSummary(context.loss_at), evidence_dated: contextSummary(context.evidence_dated),
      notifications: contextSummary(context.notifications), activity: contextSummary(context.activity),
      activity_only_dates: (() => {
        const only = context.activity.filter(a => a.day && a.day >= WINDOW.start && a.day <= WINDOW.end && !active.has(a.day));
        return [...new Set(only.map(a => a.day))].sort().map(day => ({day, actions: [...new Set(only.filter(a => a.day === day).map(a => a.action))].sort()}));
      })()},
    dates: days.map(day => {
      const rows = counted.filter(r => r.day === day);
      return {day, steps: rows.length, records: rows.map(r => r.account_id + '/' + r.claim_id + '/' + r.kind + '/' + r.record_id)};
    })
  };
}
function tally(values) {
  const out = {};
  for (const value of values) out[value] = (out[value] || 0) + 1;
  return out;
}
const GROUPS = [['Filed', ['claim_filed']], ['Evidence', ['evidence_added']], ['Requests', ['request_issued', 'request_answered']], ['Estimates', ['estimate_submitted']],
  ['Decisions', ['determination_issued']], ['Disputes', ['dispute_opened', 'dispute_decided']], ['Offers', ['offer_issued', 'offer_answered']],
  ['Rentals', ['rental_started', 'rental_ended']], ['Payments', ['payment_issued']], ['Repairs done', ['repair_completed']], ['Closed or withdrawn', ['claim_closed', 'claim_withdrawn']]];
function markdown(r) {
  const row = cells => '| ' + cells.join(' | ') + ' |';
  const lines = ['# Alderbrook evaluation data: coverage', '',
    'Written by `node apps/alderbrook/dev/coverage.cjs` from the files in this folder. Do not edit it by hand. The full numbers are in `coverage.json`.', '',
    '- Scope: ' + r.scope,
    '- Provenance: all ' + r.provenance.synthetic + ' account seeds are synthetic. Real records: ' + r.provenance.real + '. Mixed: ' + r.provenance.mixed + '.',
    '- Time zone: `' + r.time_zone + '`. Window: ' + r.window.start + ' to ' + r.window.end + '. Seed clock: `' + r.seed_clock.join('`, `') + '`.',
    '- Rule: ' + r.counting_rule,
    '- Totals: ' + r.totals.accounts + ' accounts, ' + r.totals.policies + ' policy terms, ' + r.totals.claims + ' claims, ' + r.totals.lifecycle_steps + ' lifecycle steps. ' +
      r.totals.counted_steps + ' steps count. ' + r.totals.excluded_steps + ' are excluded, and ' + r.totals.scheduled_items + ' scheduled items are listed apart.',
    '- Distinct dates: **' + r.global.distinct_dates + '** of ' + r.global.window_days + ' days in the window (' + r.global.weekday_dates + ' weekdays, ' + r.global.weekend_dates +
      ' weekend days). Earliest ' + r.global.earliest + ', latest ' + r.global.latest + '.',
    '- Hash check against `manifest.json`: ' + (r.hash_errors.length ? 'FAILED for ' + r.hash_errors.join(', ') : 'every seed and binding matches') + '.', '',
    '## Date field of each lifecycle step', '', row(['Step', 'Records', 'Date field', 'Steps counted', 'Distinct dates', 'Earliest', 'Latest']), row(['---', '---', '---', '---:', '---:', '---', '---'])];
  for (const k of r.per_kind) lines.push(row([k.kind, '`' + r.authoritative_fields.find(f => f.kind === k.kind).records + '`', '`' + k.field + '`', k.steps, k.distinct_dates, k.earliest || '', k.latest || '']));
  lines.push('', 'Not counted: ' + r.not_counted.map(n => '`' + n.field + '` (' + n.reason.replace(/\.$/, '') + ')').join('; ') + '.', '',
    '## Monthly coverage', '', 'Steps per month by group, in ' + r.time_zone + '. One source: the synthetic generator.', '',
    row(['Month', 'Distinct dates', 'Steps', ...GROUPS.map(g => g[0])]), row(['---', ...Array(GROUPS.length + 2).fill('---:')]));
  for (const m of r.monthly) lines.push(row([m.month, m.distinct_dates, m.steps, ...GROUPS.map(([, kinds]) => kinds.reduce((s, k) => s + m.by_kind[k], 0))]));
  lines.push('', '## Gaps', '', '- Months with no activity: ' + (r.gaps.months_without_activity.length ? r.gaps.months_without_activity.join(', ') : 'none') + '.',
    '- Days with no activity: ' + r.global.days_without_activity + ', in ' + r.gaps.runs_without_activity + ' runs. ' + r.global.inactive_weekend_or_holiday_days + ' of them are weekends or holidays, when the insurer does not work.',
    '- Longest runs with no activity: ' + r.gaps.longest.map(g => g.from + (g.days > 1 ? ' to ' + g.to : '') + ' (' + g.days + ' days)').join(', ') + '.', '',
    '## Exclusions and scheduled items', '', '- Excluded steps: ' + r.exclusions.length + '. ' + Object.entries(tally(r.exclusions.map(e => e.reason))).map(([reason, n]) => n + ': ' + reason).join(' ') ,
    '- Scheduled items after the seed clock: ' + r.scheduled.items.length + '. ' + r.scheduled.rule, '',
    '## Accounts', '', row(['Account', 'Policy terms', 'Claims', 'Claim states', 'Steps counted', 'Distinct dates', 'Earliest', 'Latest']), row(['---', '---:', '---:', '---', '---:', '---:', '---', '---']));
  for (const a of r.per_account) lines.push(row([a.account_id, a.policies, a.claims, Object.entries(a.claim_states).map(([k, n]) => k + ' ' + n).join(', '), a.counted_steps, a.distinct_dates, a.earliest || '', a.latest || '']));
  lines.push('', '## Context that is not counted', '', row(['Field', 'Records', 'In window', 'Distinct dates in window', 'Earliest', 'Latest']), row(['---', '---:', '---:', '---:', '---', '---']));
  for (const [name, c] of Object.entries(r.context).filter(([name]) => name !== 'policy_terms')) lines.push(row(['`' + name + '`', c.records, c.in_window, c.distinct_dates_in_window, c.earliest, c.latest]));
  lines.push('', 'Policy terms: ' + r.context.policy_terms + ' records. Their dates are context only.', '',
    'Dates in the window that only the activity log has: ' + r.context.activity_only_dates.length + ' (' + [...new Set(r.context.activity_only_dates.flatMap(d => d.actions))].join(', ') + '). They are not counted.',
    '', '`coverage.json` lists, for each counted date, the IDs of the records behind it as `account/claim/step/record`.', '');
  return lines.join('\n');
}
function main() {
  const check = process.argv.includes('--check'), r = report();
  const outputs = [['coverage.json', JSON.stringify(r, null, 2) + '\n'], ['coverage.md', markdown(r)]], stale = [];
  for (const [name, text] of outputs) {
    const target = path.join(DIR, name);
    if (check) { if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text) stale.push(name); }
    else fs.writeFileSync(target, text);
  }
  if (r.hash_errors.length) { console.error('Hash mismatch: ' + r.hash_errors.join(', ')); process.exitCode = 1; }
  if (stale.length) { console.error('Coverage report is out of date: ' + stale.join(', ')); process.exitCode = 1; }
  console.log((check ? 'Checked' : 'Wrote') + ' data/evaluation/coverage.json and coverage.md: ' + r.totals.accounts + ' accounts, ' + r.totals.claims + ' claims, ' +
    r.totals.counted_steps + ' counted steps, ' + r.global.distinct_dates + ' distinct dates from ' + r.global.earliest + ' to ' + r.global.latest + ', ' +
    r.totals.excluded_steps + ' excluded, ' + r.totals.scheduled_items + ' scheduled.');
}
if (require.main === module) main();
module.exports = {report};
