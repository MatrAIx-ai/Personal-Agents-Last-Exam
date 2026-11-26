#!/usr/bin/env node
'use strict';
// Reproducible date coverage of the full-window evaluation dataset.
//   node dev/coverage.cjs          write datasets/full-window/coverage.{json,md}
//   node dev/coverage.cjs --check  exit 1 if the committed reports differ from a fresh count
// Reads only datasets/full-window/{seed.json,clock.json,dataset.json}: the records that
// tests/dataset.integration.cjs loads into the App with env.load_seed. Every timestamp is
// converted to a local date in America/Chicago, the account's time zone. A revision counts on
// the date it was received (when it reached Belltower); the effective periods of public notices
// are what the notices announce, not history, and are reported separately.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { ms, localDate, addDays } = require('../src/util.cjs');
const { itemStatus, notificationState, effectOf } = require('../src/model.cjs');

const DIR = path.resolve(__dirname, '../datasets/full-window');
const TZ = 'America/Chicago', START = '2025-01-01', END = '2026-12-31';
const read = name => fs.readFileSync(path.join(DIR, name));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function count() {
  const seedBytes = read('seed.json'), data = JSON.parse(seedBytes), clock = JSON.parse(read('clock.json')).initial_time, dataset = JSON.parse(read('dataset.json'));
  const T = ms(clock);
  const dateOf = value => { const t = ms(value); return Number.isNaN(t) ? null : localDate(t, TZ); };
  const days = []; for (let d = START; d <= END; d = addDays(d, 1)) days.push(d);
  const months = [...new Set(days.map(d => d.slice(0, 7)))];
  const revisions = data.items.flatMap(i => i.revisions.map(r => ({ id: i.id + '#' + r.number, at: r.received_at, r, item: i })));
  const families = [
    { id: 'actions', label: 'Actions: activity log rows (every arriving revision, every account write, and their effects)', field: 'activity[].at', rows: data.activity.map(a => ({ id: 'activity#' + a.seq, at: a.at })) },
    { id: 'account_writes', label: 'Dana\'s own writes (activity rows with actor "agent"): follow rules, preferences, read marks, clippings', field: 'activity[].at', rows: data.activity.filter(a => a.actor === 'agent').map(a => ({ id: 'activity#' + a.seq, at: a.at })) },
    { id: 'publications', label: 'New items: revision 1, by receipt', field: 'items[].revisions[0].received_at', rows: revisions.filter(x => x.r.number === 1).map(x => ({ id: x.item.id, at: x.at })) },
    { id: 'updates', label: 'Updates', field: 'items[].revisions[].received_at (type update)', rows: revisions.filter(x => x.r.type === 'update') },
    { id: 'corrections', label: 'Corrections', field: 'items[].revisions[].received_at (type correction)', rows: revisions.filter(x => x.r.type === 'correction') },
    { id: 'retractions', label: 'Retractions', field: 'items[].revisions[].received_at (type retraction)', rows: revisions.filter(x => x.r.type === 'retraction') },
    { id: 'copies_and_reports', label: 'Copies and reports of another item (revisions with based_on)', field: 'items[].revisions[].received_at (with based_on)', rows: revisions.filter(x => x.r.based_on) },
    { id: 'read_marks', label: 'Read marks', field: 'read_marks[].read_at', rows: data.read_marks.map(m => ({ id: m.item_id + '#' + m.revision, at: m.read_at })) },
    { id: 'clipping_changes', label: 'Clippings kept at the clock: when made and when changed', field: 'clippings[].created_at, clippings[].history[].replaced_at', rows: data.clippings.flatMap(c => [{ id: c.id, at: c.created_at }, ...c.history.map((h, i) => ({ id: c.id + '#' + i, at: h.replaced_at }))]) },
    { id: 'notifications', label: 'Notifications, by creation time', field: 'notifications[].created_at', rows: data.notifications.map(n => ({ id: n.id, at: n.created_at })) },
  ];
  const ACTIONS = ['actions'], ALL = families.map(f => f.id).filter(x => x !== 'account_writes');

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

  // What notices announce: effective periods. Not history; the ones that start after the clock are scheduled future.
  const notices = data.items.filter(i => i.kind === 'notice').map(i => ({ i, r: [...i.revisions].reverse().find(x => x.type !== 'retraction') }));
  const effective = notices.filter(x => x.r.effective);
  const periods = {
    notices: notices.length, with_effective_period: effective.length, open_ended: effective.filter(x => x.r.effective.end === null).length,
    starting_after_clock: effective.filter(x => ms(x.r.effective.start) > T).length,
    in_effect_at_clock: effective.filter(x => effectOf(x.r, T) === 'in_effect' && itemStatus(x.i) !== 'retracted').length,
    ending_after_clock: effective.filter(x => x.r.effective.end !== null && ms(x.r.effective.end) > T).length,
    latest_start: effective.map(x => x.r.effective.start).sort((a, b) => ms(a) - ms(b)).at(-1),
    note: 'Effective periods are the dates a notice announces (a closure, a ban, opening hours). They are excluded from every coverage count above; only the dates the notices were received count.',
  };
  const monthly = months.map(m => {
    const inMonth = days.filter(d => d.slice(0, 7) === m), f = id => report.families[id].by_month[m];
    return {
      month: m, days: inMonth.length, dates_with_any_record: inMonth.filter(d => all.has(d)).length, dates_with_actions: inMonth.filter(d => actions.has(d)).length,
      publications: f('publications').records, updates: f('updates').records, corrections: f('corrections').records, retractions: f('retractions').records, copies_and_reports: f('copies_and_reports').records,
      read_marks: f('read_marks').records, account_writes: f('account_writes').records, notifications: f('notifications').records, actions: f('actions').records, provenance: 'synthetic',
    };
  });
  const by = (list, key) => Object.fromEntries(Object.entries(list.reduce((o, x) => (o[key(x)] = (o[key(x)] || 0) + 1, o), {})).sort(([a], [b]) => (a < b ? -1 : 1)));
  const json = {
    scope: 'Environment dataset coverage of the Belltower full-window evaluation dataset (datasets/full-window), as loaded by tests/dataset.integration.cjs. Not a Task history report.',
    dataset: {
      dataset_id: dataset.dataset_id, version: dataset.version, clock,
      files: { 'seed.json': { bytes: seedBytes.length, sha256: sha(seedBytes) }, 'clock.json': { sha256: sha(read('clock.json')) }, 'dataset.json': { sha256: sha(read('dataset.json')) } },
      records: dataset.expected_counts.records, provenance: dataset.sources.map(s => ({ source_id: s.source_id, kind: s.kind, tool: s.generation?.tool ?? null, seed: s.generation?.seed ?? null })),
      record_ids: 'Stable IDs: items it-<source>-<yy><nnn>, revisions by item and number, read marks by item and revision, follow rules fl-NNNN, clippings clp-NNNN, notifications ntf-NNNN, activity rows by seq.',
    },
    time_zone: TZ, window: { start: START, end: END, days: days.length },
    method: 'Each record family has one authoritative date field. Timestamps (all with a UTC offset) are converted to a local date in ' + TZ + '. A revision counts on the date it was received; publication times differ by minutes. A record counts when its local date is in the window and it is not after the dataset clock; missing or unparseable dates are counted as invalid and listed. Distinct dates are counted per family and once globally (a date with several records or families counts once). Removed clippings and follow rules are no longer stored: their dates appear only through the activity log.',
    families: report.families,
    global: {
      actions_only: { families: ACTIONS, distinct_dates: actions.size, earliest: [...actions].sort()[0], latest: [...actions].sort().at(-1), gaps: gaps(actions) },
      all_history: { families: ALL, distinct_dates: all.size, earliest: [...all].sort()[0], latest: [...all].sort().at(-1), gaps: gaps(all) },
    },
    effective_periods: periods,
    states_at_clock: {
      items_by_source: by(data.items, i => i.source_id), items_by_status: by(data.items, itemStatus), items_by_kind: by(data.items, i => i.kind),
      follow_rules: by(data.follows, f => (f.paused ? 'paused' : 'active') + ', ' + f.delivery), clippings: by(data.clippings, c => c.watch ? 'watched' : 'not watched'),
      notifications: by(data.notifications, n => notificationState(n, T)), notifications_by_kind: by(data.notifications, n => n.kind),
    },
    invalid_or_missing_dates: report.invalid,
    monthly,
  };
  return { json, data };
}

function markdown(json, data) {
  const f = json.families, g = json.global, lines = [];
  const row = cells => '| ' + cells.join(' | ') + ' |';
  lines.push('# Belltower full-window dataset: date coverage', '');
  lines.push('Generated by `node dev/coverage.cjs` from the files below; `node dev/coverage.cjs --check` fails if this report is stale. ' + json.scope, '');
  lines.push('- Dataset: `' + json.dataset.dataset_id + '` ' + json.dataset.version + ', ' + json.dataset.records + ' records, all synthetic (source `' + json.dataset.provenance[0].source_id + '`, `' + json.dataset.provenance[0].tool + '`, seed ' + json.dataset.provenance[0].seed + '). No real or mixed records.');
  lines.push('- Files: `seed.json` ' + json.dataset.files['seed.json'].bytes + ' bytes, sha256 `' + json.dataset.files['seed.json'].sha256 + '`; `dataset.json` sha256 `' + json.dataset.files['dataset.json'].sha256 + '`; `clock.json` sha256 `' + json.dataset.files['clock.json'].sha256 + '`.');
  lines.push('- Dataset clock: ' + json.dataset.clock + '. Counting time zone: ' + json.time_zone + '. Window: ' + json.window.start + ' to ' + json.window.end + ' (' + json.window.days + ' days).');
  lines.push('- ' + json.dataset.record_ids, '');
  lines.push('## Method', '', json.method, '');
  lines.push('## Totals by record family', '');
  lines.push(row(['Family', 'Date field', 'Records', 'In window', 'Distinct dates', 'Earliest', 'Latest', 'Excluded']));
  lines.push(row(['---', '---', '---:', '---:', '---:', '---', '---', '---']));
  for (const x of Object.values(f)) {
    const ex = Object.entries(x.excluded).filter(([, n]) => n).map(([k, n]) => n + ' ' + k.replace(/_/g, ' ')).join('; ') || 'none';
    lines.push(row([x.label, '`' + x.date_field + '`', x.records, x.in_window, x.distinct_dates, x.earliest, x.latest, ex]));
  }
  lines.push('', '## Global distinct dates', '');
  lines.push('- Actions only (the activity log): **' + g.actions_only.distinct_dates + '** of ' + json.window.days + ' dates, ' + g.actions_only.earliest + ' to ' + g.actions_only.latest + '; ' + g.actions_only.gaps.dates_without_records + ' dates without an action' + (g.actions_only.gaps.longest.length ? '; longest stretches without one: ' + g.actions_only.gaps.longest.map(r => r.from + ' to ' + r.to + ' (' + r.days + ' day' + (r.days === 1 ? '' : 's') + ')').join(', ') : '') + '.');
  lines.push('- All history (the families above except Dana\'s writes, which the actions already contain): **' + g.all_history.distinct_dates + '** of ' + json.window.days + ' dates, ' + g.all_history.earliest + ' to ' + g.all_history.latest + '; ' + g.all_history.gaps.dates_without_records + ' dates without any record' + (g.all_history.gaps.missing_dates ? ': ' + g.all_history.gaps.missing_dates.join(', ') : '') + '.', '');
  const p = json.effective_periods;
  lines.push('## Effective periods of notices (excluded)', '');
  lines.push(p.notices + ' items are public notices; ' + p.with_effective_period + ' carry an effective period (' + p.open_ended + ' open-ended). At the clock ' + p.in_effect_at_clock + ' are in effect, ' + p.ending_after_clock + ' end after it and ' + p.starting_after_clock + ' start after it (the latest start is ' + p.latest_start + '). ' + p.note, '');
  lines.push('## Monthly coverage', '');
  lines.push(row(['Month', 'Days', 'Dates with any record', 'Dates with actions', 'New items', 'Updates', 'Corrections', 'Retractions', 'Copies and reports', 'Read marks', 'Dana\'s writes', 'Notifications', 'Actions', 'Provenance']));
  lines.push(row(['---', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---']));
  for (const m of json.monthly) lines.push(row([m.month, m.days, m.dates_with_any_record, m.dates_with_actions, m.publications, m.updates, m.corrections, m.retractions, m.copies_and_reports, m.read_marks, m.account_writes, m.notifications, m.actions, m.provenance]));
  lines.push('', '## States at the dataset clock', '');
  for (const [k, v] of Object.entries(json.states_at_clock)) lines.push('- ' + k.replace(/_/g, ' ') + ': ' + Object.entries(v).map(([s, n]) => s + ' ' + n).join(', '));
  lines.push('- invalid or missing dates: ' + (json.invalid_or_missing_dates.length ? json.invalid_or_missing_dates.join(', ') : 'none'), '');
  lines.push('## Representative records', '');
  const corrected = data.items.find(i => i.revisions.some(r => r.type === 'correction') && data.items.some(c => c.revisions.some(r => r.based_on && r.based_on.item_id === i.id)));
  const copyOf = corrected && data.items.find(c => c.revisions.some(r => r.based_on && r.based_on.item_id === corrected.id));
  const clip = data.clippings.find(c => c.history.length), note = data.notifications.find(n => n.kind === 'item.corrected') || data.notifications[0];
  const brief = x => '```json\n' + JSON.stringify(x, null, 1).replace(/\n\s*/g, ' ') + '\n```';
  lines.push('An item corrected by its publisher:', '', brief(corrected), '');
  lines.push('Another source\'s copy or report of it:', '', brief(copyOf), '');
  lines.push('A clipping Dana changed:', '', brief(clip), '');
  lines.push('A notification (wire copy omitted):', '', brief({ ...note, wire: note.wire ? '…' : undefined }), '');
  lines.push('## Loading and queries', '', '`node tests/dataset.integration.cjs --runtime DIR` loads `seed.json` through the public runtime with `env.load_seed` and the dataset clock, then reads it back through the App\'s MCP tools: every month of the window through `belltower.items.list`, both ends of the window, a corrected item with its revisions and copies, the read marks, clippings, follow rules and notifications, and one write on the loaded data. Its report is in `docs/validation/belltower/`.', '');
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
  console.log('Actions on ' + json.global.actions_only.distinct_dates + ' dates, all history on ' + json.global.all_history.distinct_dates + ' of ' + json.window.days + ' dates; ' + json.effective_periods.with_effective_period + ' notice periods reported apart.');
}

module.exports = { count };
if (require.main === module) main();
