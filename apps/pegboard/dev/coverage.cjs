#!/usr/bin/env node
'use strict';
// Reproducible date coverage of the full-window evaluation dataset.
//   node dev/coverage.cjs          write datasets/full-window/coverage.{json,md}
//   node dev/coverage.cjs --check  exit 1 if the committed reports differ from a fresh count
// Reads only datasets/full-window/{seed.json,clock.json,dataset.json}: the records that
// tests/dataset.integration.cjs loads into the App with env.load_seed. Every timestamp is
// converted to a local date in America/Los_Angeles, the workplace and account time zone;
// date-only fields are already dates in that zone. Records outside 2025-01-01..2026-12-31 and
// shift dates after the dataset clock are excluded from coverage and reported separately.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { ms, localDate, addDays } = require('../src/util.cjs');
const { shiftState, handoffState, timeOffState } = require('../src/model.cjs');

const DIR = path.resolve(__dirname, '../datasets/full-window');
const TZ = 'America/Los_Angeles', START = '2025-01-01', END = '2026-12-31';
const read = name => fs.readFileSync(path.join(DIR, name));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function count() {
  const seedBytes = read('seed.json'), data = JSON.parse(seedBytes), clock = JSON.parse(read('clock.json')).initial_time, dataset = JSON.parse(read('dataset.json'));
  const T = ms(clock), me = data.owner_person_id;
  const dateOf = value => { const t = ms(value); return Number.isNaN(t) ? null : localDate(t, TZ); };
  const days = []; for (let d = START; d <= END; d = addDays(d, 1)) days.push(d);
  const months = [...new Set(days.map(d => d.slice(0, 7)))];

  // Each family: the records, the authoritative date field and its local date. A family is
  // history (it happened by the dataset clock) unless marked otherwise.
  const posted = new Set(data.shifts.map(s => s.history[0].at));
  const families = [
    { id: 'actions', label: 'Actions: activity log rows (every committed App write and applied event, with its effects)', field: 'activity[].at', rows: data.activity.map(a => ({ id: 'activity#' + a.seq, at: a.at })) },
    { id: 'account_writes', label: 'Noor\'s own writes (activity rows with actor "agent")', field: 'activity[].at', rows: data.activity.filter(a => a.actor === 'agent').map(a => ({ id: 'activity#' + a.seq, at: a.at })) },
    { id: 'workplace_events', label: 'Events from the workplace: postings, manager changes and decisions, coworker requests and answers (activity rows with actor "event", without their effects)', field: 'activity[].at', rows: data.activity.filter(a => a.actor === 'event' && a.event_id && !['notification.created', 'shift.reassigned', 'handoff.voided'].includes(a.action)).map(a => ({ id: 'activity#' + a.seq, at: a.at })) },
    { id: 'schedule_postings', label: 'Weekly schedule postings', field: 'weeks[].posted_at', rows: data.weeks.map(w => ({ id: 'week ' + w.week_start, at: w.posted_at })) },
    { id: 'shift_changes', label: 'Shift history rows after the posting: manager changes, cancellations and handoff moves', field: 'shifts[].history[].at', rows: data.shifts.flatMap(s => s.history.slice(1).map((h, i) => ({ id: s.id + '#' + (i + 1), at: h.at }))) },
    { id: 'handoffs', label: 'Handoffs: covers, trades, releases and pickups, by request time', field: 'handoffs[].created_at', rows: data.handoffs.map(h => ({ id: h.id, at: h.created_at })) },
    { id: 'handoff_steps', label: 'Handoff history rows: requests, answers, decisions, cancellations, voids', field: 'handoffs[].history[].at', rows: data.handoffs.flatMap(h => h.history.map((x, i) => ({ id: h.id + '#' + i, at: x.at }))) },
    { id: 'time_off', label: 'Time-off requests, by request time', field: 'time_off[].requested_at', rows: data.time_off.map(t => ({ id: t.id, at: t.requested_at })) },
    { id: 'notifications', label: 'Notifications, by creation time', field: 'notifications[].created_at', rows: data.notifications.map(n => ({ id: n.id, at: n.created_at })) },
    { id: 'shifts_worked', label: 'Shifts by start date, not cancelled (any assignee or open); in the window, all started before the clock', field: 'shifts[].start', rows: data.shifts.filter(s => shiftState(s) !== 'cancelled').map(s => ({ id: s.id, at: s.start })), occurrence: true },
    { id: 'account_shifts_worked', label: 'Noor\'s shifts by start date', field: 'shifts[].start', rows: data.shifts.filter(s => shiftState(s) === 'assigned' && s.assignee === me).map(s => ({ id: s.id, at: s.start })), occurrence: true },
  ];
  const ACTIONS = ['actions'], ALL = families.map(f => f.id).filter(x => x !== 'account_writes' && x !== 'workplace_events');

  const report = { invalid: [], families: {}, dates: {} };
  for (const f of families) {
    const out = { label: f.label, date_field: f.field, provenance: { synthetic: 0, real: 0, mixed: 0 }, records: f.rows.length, in_window: 0, excluded: { before_window: 0, after_window: 0, after_clock: 0, invalid_date: 0 }, distinct_dates: 0, earliest: null, latest: null, by_month: {} };
    const dates = new Set();
    for (const row of f.rows) {
      const d = dateOf(row.at);
      if (!d) { out.excluded.invalid_date++; report.invalid.push(f.id + ' ' + row.id); continue; }
      if (d < START) { out.excluded.before_window++; continue; }
      if (d > END) { out.excluded.after_window++; continue; }
      if (ms(row.at) > T) { out.excluded.after_clock++; continue; }
      out.in_window++; out.provenance.synthetic++;
      dates.add(d);
      const m = d.slice(0, 7), b = out.by_month[m] || (out.by_month[m] = { records: 0, dates: new Set() });
      b.records++; b.dates.add(d);
    }
    const sorted = [...dates].sort();
    Object.assign(out, { distinct_dates: sorted.length, earliest: sorted[0] ?? null, latest: sorted.at(-1) ?? null });
    out.by_month = Object.fromEntries(months.map(m => [m, { records: out.by_month[m]?.records ?? 0, dates: out.by_month[m]?.dates.size ?? 0 }]));
    report.families[f.id] = out;
    report.dates[f.id] = dates;
  }
  const union = ids => { const s = new Set(); for (const id of ids) for (const d of report.dates[id]) s.add(d); return s; };
  const gaps = set => {
    const missing = days.filter(d => !set.has(d)), runs = [];
    for (const d of missing) { const last = runs.at(-1); if (last && addDays(last.to, 1) === d) { last.to = d; last.days++; } else runs.push({ from: d, to: d, days: 1 }); }
    runs.sort((a, b) => b.days - a.days || (a.from < b.from ? -1 : 1));
    return { dates_without_records: missing.length, longest: runs.slice(0, 5), ...(missing.length <= 40 ? { missing_dates: missing } : {}) };
  };
  const actions = union(ACTIONS), all = union(ALL);

  // Shift dates after the clock: posted, but not history. Out of the window as well.
  const future = data.shifts.filter(s => ms(s.start) > T);
  const futureDates = [...new Set(future.map(s => dateOf(s.start)))].sort();
  const monthly = months.map(m => {
    const inMonth = days.filter(d => d.slice(0, 7) === m), f = id => report.families[id].by_month[m];
    return {
      month: m, days: inMonth.length, dates_with_any_record: inMonth.filter(d => all.has(d)).length, dates_with_actions: inMonth.filter(d => actions.has(d)).length,
      actions: f('actions').records, account_writes: f('account_writes').records, workplace_events: f('workplace_events').records, schedule_postings: f('schedule_postings').records,
      shift_changes: f('shift_changes').records, handoffs: f('handoffs').records, time_off: f('time_off').records, notifications: f('notifications').records,
      shifts_worked: f('shifts_worked').records, account_shifts_worked: f('account_shifts_worked').records,
      provenance: 'synthetic',
    };
  });
  const by = (list, key) => Object.fromEntries(Object.entries(list.reduce((o, x) => (o[key(x)] = (o[key(x)] || 0) + 1, o), {})).sort(([a], [b]) => (a < b ? -1 : 1)));
  const json = {
    scope: 'Environment dataset coverage of the Pegboard full-window evaluation dataset (datasets/full-window), as loaded by tests/dataset.integration.cjs. Not a Task history report.',
    dataset: {
      dataset_id: dataset.dataset_id, version: dataset.version, clock: clock,
      files: { 'seed.json': { bytes: seedBytes.length, sha256: sha(seedBytes) }, 'clock.json': { sha256: sha(read('clock.json')) }, 'dataset.json': { sha256: sha(read('dataset.json')) } },
      records: dataset.expected_counts.records, provenance: dataset.sources.map(s => ({ source_id: s.source_id, kind: s.kind, tool: s.generation?.tool ?? null, seed: s.generation?.seed ?? null })),
      record_ids: 'Stable IDs: shifts sh-YYMMDD-NN (local start date and slot), handoffs ho-NNNN, time off to-NNNN, notifications ntf-NNNN, activity rows by seq, weeks by week_start.',
    },
    time_zone: TZ, window: { start: START, end: END, days: days.length },
    method: 'Each record family has one authoritative date field. Timestamps (all with a UTC offset) are converted to a local date in ' + TZ + '. A record counts when its local date is in the window and it is not after the dataset clock; missing or unparseable dates are counted as invalid and listed. Distinct dates are counted per family and once globally (a date with several records or families counts once). Shift dates after the clock are posted future schedule, not history: they are excluded and reported under future_posted_shifts.',
    families: report.families,
    global: {
      actions_only: { families: ACTIONS, distinct_dates: actions.size, earliest: [...actions].sort()[0], latest: [...actions].sort().at(-1), gaps: gaps(actions) },
      all_history: { families: ALL, distinct_dates: all.size, earliest: [...all].sort()[0], latest: [...all].sort().at(-1), gaps: gaps(all) },
    },
    future_posted_shifts: { shifts: future.length, distinct_dates: futureDates.length, first: futureDates[0] ?? null, last: futureDates.at(-1) ?? null, account_shifts: future.filter(s => s.assignee === me && shiftState(s) === 'assigned').length, note: 'They are not history and fall outside the window, so every coverage count above excludes them.' },
    states_at_clock: {
      shifts: by(data.shifts, shiftState), handoffs: by(data.handoffs, h => handoffState(h, T)), handoffs_by_kind: by(data.handoffs, h => h.kind + (h.requester_id === me ? '' : ' (from a coworker)')),
      time_off: by(data.time_off, t => timeOffState(data, t, T)), notifications_by_kind: by(data.notifications, n => n.kind),
    },
    invalid_or_missing_dates: report.invalid,
    monthly,
  };
  return { json, data };
}

function markdown(json, data) {
  const f = json.families, g = json.global, lines = [];
  const row = cells => '| ' + cells.join(' | ') + ' |';
  lines.push('# Pegboard full-window dataset: date coverage', '');
  lines.push('Generated by `node dev/coverage.cjs` from the files below; `node dev/coverage.cjs --check` fails if this report is stale. ' + json.scope, '');
  lines.push('- Dataset: `' + json.dataset.dataset_id + '` ' + json.dataset.version + ', ' + json.dataset.records + ' records, all synthetic (source `' + json.dataset.provenance[0].source_id + '`, `' + json.dataset.provenance[0].tool + '`, seed ' + json.dataset.provenance[0].seed + '). No real or mixed records.');
  lines.push('- Files: `seed.json` ' + json.dataset.files['seed.json'].bytes + ' bytes, sha256 `' + json.dataset.files['seed.json'].sha256 + '`; `dataset.json` sha256 `' + json.dataset.files['dataset.json'].sha256 + '`; `clock.json` sha256 `' + json.dataset.files['clock.json'].sha256 + '`.');
  lines.push('- Dataset clock: ' + json.dataset.clock + '. Counting time zone: ' + json.time_zone + '. Window: ' + json.window.start + ' to ' + json.window.end + ' (' + json.window.days + ' days).');
  lines.push('- ' + json.dataset.record_ids, '');
  lines.push('## Method', '', json.method, '');
  lines.push('## Totals by record family', '');
  lines.push(row(['Family', 'Date field', 'Records', 'In window', 'Distinct dates', 'Earliest', 'Latest', 'Excluded']));
  lines.push(row(['---', '---', '---:', '---:', '---:', '---', '---', '---']));
  for (const [id, x] of Object.entries(f)) {
    const ex = Object.entries(x.excluded).filter(([, n]) => n).map(([k, n]) => n + ' ' + k.replace(/_/g, ' ')).join('; ') || 'none';
    lines.push(row([x.label, '`' + x.date_field + '`', x.records, x.in_window, x.distinct_dates, x.earliest, x.latest, ex]));
  }
  lines.push('', '## Global distinct dates', '');
  lines.push('- Actions only (the activity log): **' + g.actions_only.distinct_dates + '** of ' + json.window.days + ' dates, ' + g.actions_only.earliest + ' to ' + g.actions_only.latest + '; ' + g.actions_only.gaps.dates_without_records + ' dates without an action; longest stretches without one: ' + g.actions_only.gaps.longest.map(r => r.from + ' to ' + r.to + ' (' + r.days + ' days)').join(', ') + '.');
  lines.push('- All history (actions, postings, shift changes, handoffs, time off, notifications and shifts that took place): **' + g.all_history.distinct_dates + '** of ' + json.window.days + ' dates, ' + g.all_history.earliest + ' to ' + g.all_history.latest + '; dates without any record: ' + (g.all_history.gaps.missing_dates || []).join(', ') + (g.all_history.gaps.dates_without_records ? ' (the café is closed on New Year\'s Day, Thanksgiving Day and Christmas Day; actions can still fall on those days).' : '.'), '');
  lines.push('## Future posted shifts (excluded)', '');
  const fu = json.future_posted_shifts;
  lines.push(fu.shifts + ' shifts on ' + fu.distinct_dates + ' dates from ' + fu.first + ' to ' + fu.last + ' (' + fu.account_shifts + ' of them Noor\'s) were posted before the clock for dates after it. ' + fu.note, '');
  lines.push('## Monthly coverage', '');
  lines.push(row(['Month', 'Days', 'Dates with any record', 'Dates with actions', 'Actions', 'Noor\'s writes', 'Workplace events', 'Postings', 'Shift changes', 'Handoffs', 'Time off', 'Notifications', 'Shifts worked', 'Noor\'s shifts', 'Provenance']));
  lines.push(row(['---', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---']));
  for (const m of json.monthly) lines.push(row([m.month, m.days, m.dates_with_any_record, m.dates_with_actions, m.actions, m.account_writes, m.workplace_events, m.schedule_postings, m.shift_changes, m.handoffs, m.time_off, m.notifications, m.shifts_worked, m.account_shifts_worked, m.provenance]));
  lines.push('', '## States at the dataset clock', '');
  for (const [k, v] of Object.entries(json.states_at_clock)) lines.push('- ' + k.replace(/_/g, ' ') + ': ' + Object.entries(v).map(([s, n]) => s + ' ' + n).join(', '));
  lines.push('- invalid or missing dates: ' + (json.invalid_or_missing_dates.length ? json.invalid_or_missing_dates.join(', ') : 'none'), '');
  lines.push('## Representative records', '');
  const first = data.handoffs.find(h => h.history.length >= 3 && h.state === 'approved' && h.requester_id === data.owner_person_id), coworker = data.handoffs.find(h => h.requester_id !== data.owner_person_id && h.state === 'declined');
  const off = data.time_off.find(t => t.state === 'approved'), note = data.notifications.find(n => n.kind === 'handoff.received');
  const brief = x => '```json\n' + JSON.stringify(x, null, 1).replace(/\n\s*/g, ' ') + '\n```';
  lines.push('A cover Noor asked for, accepted and approved:', '', brief(first), '');
  lines.push('A coworker request Noor declined:', '', brief(coworker), '');
  lines.push('An approved time-off entry:', '', brief(off), '');
  lines.push('A notification (wire copy omitted):', '', brief({ ...note, wire: note.wire ? '…' : undefined }), '');
  lines.push('## Loading and queries', '', '`node tests/dataset.integration.cjs --runtime DIR` loads `seed.json` through the public runtime with `env.load_seed` and the dataset clock, then reads it back through the App\'s MCP tools: every month of the window through `pegboard.shifts.list`, both ends of the window, the future posted weeks, the handoff, time-off and notification lists, and one write on the loaded data. Its report is in `docs/validation/pegboard/`.', '');
  return lines.join('\n') + '\n';
}

function main() {
  const { json, data } = count(), files = { 'coverage.json': JSON.stringify(json, null, 2) + '\n', 'coverage.md': markdown(json, data) };
  if (process.argv.includes('--check')) {
    const bad = Object.entries(files).filter(([name, text]) => !fs.existsSync(path.join(DIR, name)) || fs.readFileSync(path.join(DIR, name), 'utf8') !== text).map(([n]) => n);
    if (bad.length) { console.error('Stale coverage report: ' + bad.join(', ') + '. Run node dev/coverage.cjs.'); process.exit(1); }
    console.log('datasets/full-window coverage reports match the dataset.');
    return;
  }
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(DIR, name), text);
  console.log('Actions on ' + json.global.actions_only.distinct_dates + ' dates, all history on ' + json.global.all_history.distinct_dates + ' of ' + json.window.days + ' dates; ' + json.future_posted_shifts.shifts + ' future posted shifts excluded.');
}

module.exports = { count };
if (require.main === module) main();
