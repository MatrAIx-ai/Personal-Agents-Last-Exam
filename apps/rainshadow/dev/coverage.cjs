#!/usr/bin/env node
'use strict';
// Reproducible date coverage of the full-window evaluation dataset.
//   node dev/coverage.cjs          write datasets/full-window/coverage.{json,md}
//   node dev/coverage.cjs --check  exit 1 if the committed reports differ from a fresh count
// Reads only datasets/full-window/{seed.json,clock.json,dataset.json}: the records that
// tests/dataset.integration.cjs loads into the App with env.load_seed. Every timestamp is
// converted to a local date in America/Denver, the account's time zone (records of the Pacific
// places are converted too). A forecast counts on the date it was issued and an alert message
// on the date it was sent; the hours and days a forecast covers, an alert's onset and end and a
// watch's window are what was forecast, announced or watched, not history, and are reported apart.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { ms, localDate, addDays } = require('../src/util.cjs');
const { alertStatus, watchStatus, noticeState } = require('../src/model.cjs');

const DIR = path.resolve(__dirname, '../datasets/full-window');
const TZ = 'America/Denver', START = '2025-01-01', END = '2026-12-31';
const read = name => fs.readFileSync(path.join(DIR, name));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function count() {
  const seedBytes = read('seed.json'), data = JSON.parse(seedBytes), clock = JSON.parse(read('clock.json')).initial_time, dataset = JSON.parse(read('dataset.json'));
  const T = ms(clock), kindOf = new Map(data.sources.map(s => [s.id, s.kind]));
  const dateOf = value => { const t = ms(value); return Number.isNaN(t) ? null : localDate(t, TZ); };
  const days = []; for (let d = START; d <= END; d = addDays(d, 1)) days.push(d);
  const months = [...new Set(days.map(d => d.slice(0, 7)))];
  const families = [
    { id: 'actions', label: 'Actions: activity log rows (every event, every account write, and their effects)', field: 'activity[].at', rows: data.activity.map(a => ({ id: 'activity#' + a.seq, at: a.at })) },
    { id: 'account_writes', label: 'The account holder\'s own writes (activity rows with actor "agent")', field: 'activity[].at', rows: data.activity.filter(a => a.actor === 'agent').map(a => ({ id: 'activity#' + a.seq, at: a.at })) },
    { id: 'weather_issuances', label: 'Weather forecast issuances, by issue time', field: 'issuances[].issued_at (weather sources)', rows: data.issuances.filter(i => kindOf.get(i.source_id) === 'weather').map(i => ({ id: i.id, at: i.issued_at })), tool: 'rainshadow.forecast.issuances' },
    { id: 'air_quality_issuances', label: 'Air-quality forecast issuances, by issue time', field: 'issuances[].issued_at (air-quality source)', rows: data.issuances.filter(i => kindOf.get(i.source_id) === 'air_quality').map(i => ({ id: i.id, at: i.issued_at })), tool: 'rainshadow.forecast.issuances' },
    { id: 'observations', label: 'Observations, by observation time (the newest per place is what conditions.get shows)', field: 'observations[].observed_at', rows: data.observations.map(o => ({ id: o.id, at: o.observed_at })), tool: 'rainshadow.conditions.get' },
    { id: 'alert_messages', label: 'Alert messages (issued, updated, cancelled), by sending time', field: 'alerts[].messages[].sent_at', rows: data.alerts.flatMap(a => a.messages.map(m => ({ id: m.message_id, at: m.sent_at }))), tool: 'rainshadow.alerts.list, rainshadow.alerts.get' },
    { id: 'acknowledgements', label: 'Acknowledgements of alert messages', field: 'acknowledgements[].acknowledged_at', rows: data.acknowledgements.map(a => ({ id: a.message_id, at: a.acknowledged_at })), tool: 'rainshadow.alerts.get' },
    { id: 'watch_changes', label: 'Watches: created, changed, cancelled', field: 'watches[].created_at, updated_at, cancelled_at', rows: data.watches.flatMap(w => [{ id: w.id, at: w.created_at }, ...(w.updated_at ? [{ id: w.id + '#updated', at: w.updated_at }] : []), ...(w.cancelled_at ? [{ id: w.id + '#cancelled', at: w.cancelled_at }] : [])]), tool: 'rainshadow.watches.list' },
    { id: 'notices', label: 'Notices, by creation time', field: 'notices[].created_at', rows: data.notices.map(n => ({ id: n.id, at: n.created_at })), tool: 'rainshadow.notices.list' },
    { id: 'saved_places', label: 'Places saved at the clock, by the time they were saved', field: 'saved_places[].saved_at', rows: data.saved_places.map(s => ({ id: s.place_id, at: s.saved_at })), tool: 'rainshadow.places.list' },
  ];
  const ACTIONS = ['actions'], ALL = families.map(f => f.id).filter(x => x !== 'account_writes');

  const report = { invalid: [], families: {}, dates: {} };
  for (const f of families) {
    const out = { label: f.label, date_field: f.field, read_through: f.tool ?? 'env.snapshot (Infra)', provenance: { synthetic: 0, real: 0, mixed: 0 }, records: f.rows.length, in_window: 0, excluded: { before_window: 0, after_window: 0, after_clock: 0, invalid_date: 0 }, distinct_dates: 0, earliest: null, latest: null, by_month: {} };
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

  // What was forecast, announced or watched: not history.
  const rows = data.issuances.flatMap(i => [...(i.hourly ?? []).map(r => r.start), ...(i.daily ?? []).map(r => r.date + 'T12:00:00Z')]);
  const announced = {
    forecast_rows: rows.length, forecast_rows_after_clock: rows.filter(x => ms(x) > T).length,
    alert_messages_with_times: data.alerts.reduce((n, a) => n + a.messages.filter(m => m.ends).length, 0), alerts_ending_after_clock: data.alerts.filter(a => { const m = [...a.messages].reverse().find(x => x.ends); return m && ms(m.ends) > T && alertStatus(a, T) !== 'cancelled'; }).length,
    watches: data.watches.length, watch_windows_after_clock: data.watches.filter(w => ms(w.start) > T).length,
    note: 'The hours and days a forecast covers, the onset and end an alert announces and the window a watch looks at are excluded from every count above; only issue, sending, acknowledgement, creation and change times count.',
  };
  const monthly = months.map(m => {
    const inMonth = days.filter(d => d.slice(0, 7) === m), f = id => report.families[id].by_month[m];
    return {
      month: m, days: inMonth.length, dates_with_any_record: inMonth.filter(d => all.has(d)).length, dates_with_actions: inMonth.filter(d => actions.has(d)).length,
      weather_issuances: f('weather_issuances').records, air_quality_issuances: f('air_quality_issuances').records, observations: f('observations').records, alert_messages: f('alert_messages').records,
      acknowledgements: f('acknowledgements').records, watch_changes: f('watch_changes').records, notices: f('notices').records, account_writes: f('account_writes').records, actions: f('actions').records, provenance: 'synthetic',
    };
  });
  const by = (list, key) => Object.fromEntries(Object.entries(list.reduce((o, x) => (o[key(x)] = (o[key(x)] || 0) + 1, o), {})).sort(([a], [b]) => (a < b ? -1 : 1)));
  const json = {
    scope: 'Environment dataset coverage of the Rainshadow full-window evaluation dataset (datasets/full-window), as loaded by tests/dataset.integration.cjs. Not a Task history report.',
    dataset: {
      dataset_id: dataset.dataset_id, version: dataset.version, clock,
      files: { 'seed.json': { bytes: seedBytes.length, sha256: sha(seedBytes) }, 'clock.json': { sha256: sha(read('clock.json')) }, 'dataset.json': { sha256: sha(read('dataset.json')) } },
      records: dataset.expected_counts.records, provenance: dataset.sources.map(s => ({ source_id: s.source_id, kind: s.kind, tool: s.generation?.tool ?? null, seed: s.generation?.seed ?? null })),
      record_ids: 'Stable IDs: issuances iss-<source>-<place>-<yyyymmdd>-<hh> and aq-<place>-<yyyymmdd>-10 (the fixture\'s detailed days keep iss-<source>-<place>-<n>), observations ob-<place>-<yyyymmdd>-<hh>, alert threads al-<yyyymmdd>-<n> with messages <thread>-m<n>, watches w-NNNN, notices ntc-NNNN, activity rows by seq.',
    },
    time_zone: TZ, window: { start: START, end: END, days: days.length },
    method: 'Each record family has one authoritative date field. Timestamps (all with a UTC offset, Mountain or Pacific) are converted to a local date in ' + TZ + '. A record counts when its local date is in the window and it is not after the dataset clock; missing or unparseable dates are counted as invalid and listed. Distinct dates are counted per family and once globally (a date with several records or families counts once). Each family names the Agent tool that reads it; the activity log is read through Infra\'s env.snapshot.',
    families: report.families,
    global: {
      actions_only: { families: ACTIONS, distinct_dates: actions.size, earliest: [...actions].sort()[0], latest: [...actions].sort().at(-1), gaps: gaps(actions) },
      all_history: { families: ALL, distinct_dates: all.size, earliest: [...all].sort()[0], latest: [...all].sort().at(-1), gaps: gaps(all) },
    },
    forecast_and_announced_times: announced,
    states_at_clock: {
      issuances_by_place: by(data.issuances, i => i.place_id), issuances_by_source: by(data.issuances, i => i.source_id), alerts: by(data.alerts, a => alertStatus(a, T)),
      watches: by(data.watches, w => watchStatus(w, T)), notices: by(data.notices, n => noticeState(n, T)), notices_by_kind: by(data.notices, n => n.kind), saved_places: data.saved_places.map(s => s.label),
    },
    invalid_or_missing_dates: report.invalid,
    monthly,
  };
  return { json, data };
}

function markdown(json, data) {
  const f = json.families, g = json.global, lines = [];
  const row = cells => '| ' + cells.join(' | ') + ' |';
  lines.push('# Rainshadow full-window dataset: date coverage', '');
  lines.push('Generated by `node dev/coverage.cjs` from the files below; `node dev/coverage.cjs --check` fails if this report is stale. ' + json.scope, '');
  lines.push('- Dataset: `' + json.dataset.dataset_id + '` ' + json.dataset.version + ', ' + json.dataset.records + ' records, all synthetic (source `' + json.dataset.provenance[0].source_id + '`, `' + json.dataset.provenance[0].tool + '`, seed ' + json.dataset.provenance[0].seed + '). No real or mixed records.');
  lines.push('- Files: `seed.json` ' + json.dataset.files['seed.json'].bytes + ' bytes, sha256 `' + json.dataset.files['seed.json'].sha256 + '`; `dataset.json` sha256 `' + json.dataset.files['dataset.json'].sha256 + '`; `clock.json` sha256 `' + json.dataset.files['clock.json'].sha256 + '`.');
  lines.push('- Dataset clock: ' + json.dataset.clock + '. Counting time zone: ' + json.time_zone + '. Window: ' + json.window.start + ' to ' + json.window.end + ' (' + json.window.days + ' days).');
  lines.push('- ' + json.dataset.record_ids, '');
  lines.push('## Method', '', json.method, '');
  lines.push('## Totals by record family', '');
  lines.push(row(['Family', 'Date field', 'Read through', 'Records', 'In window', 'Distinct dates', 'Earliest', 'Latest', 'Excluded']));
  lines.push(row(['---', '---', '---', '---:', '---:', '---:', '---', '---', '---']));
  for (const x of Object.values(f)) {
    const ex = Object.entries(x.excluded).filter(([, n]) => n).map(([k, n]) => n + ' ' + k.replace(/_/g, ' ')).join('; ') || 'none';
    lines.push(row([x.label, '`' + x.date_field + '`', '`' + x.read_through + '`', x.records, x.in_window, x.distinct_dates, x.earliest, x.latest, ex]));
  }
  lines.push('', '## Global distinct dates', '');
  lines.push('- Actions only (the activity log): **' + g.actions_only.distinct_dates + '** of ' + json.window.days + ' dates, ' + g.actions_only.earliest + ' to ' + g.actions_only.latest + '; ' + g.actions_only.gaps.dates_without_records + ' dates without an action; longest stretches without one: ' + g.actions_only.gaps.longest.map(r => r.from + ' to ' + r.to + ' (' + r.days + ' days)').join(', ') + '.');
  lines.push('- All history (the families above except the account\'s writes, which the actions already contain): **' + g.all_history.distinct_dates + '** of ' + json.window.days + ' dates, ' + g.all_history.earliest + ' to ' + g.all_history.latest + '; ' + g.all_history.gaps.dates_without_records + ' dates without any record; longest stretches: ' + g.all_history.gaps.longest.map(r => r.from + ' to ' + r.to + ' (' + r.days + ' days)').join(', ') + '.', '');
  const a = json.forecast_and_announced_times;
  lines.push('## Forecast, announced and watched times (excluded)', '');
  lines.push('The issuances hold ' + a.forecast_rows + ' hourly and daily forecast rows (' + a.forecast_rows_after_clock + ' for times after the clock); ' + a.alert_messages_with_times + ' alert messages announce an onset and an end (' + a.alerts_ending_after_clock + ' alert still runs past the clock); ' + a.watches + ' watches each look at a window (' + a.watch_windows_after_clock + ' window starts after the clock). ' + a.note, '');
  lines.push('## Monthly coverage', '');
  lines.push(row(['Month', 'Days', 'Dates with any record', 'Dates with actions', 'Weather issuances', 'Air-quality issuances', 'Observations', 'Alert messages', 'Acknowledgements', 'Watch changes', 'Notices', 'Account writes', 'Actions', 'Provenance']));
  lines.push(row(['---', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---']));
  for (const m of json.monthly) lines.push(row([m.month, m.days, m.dates_with_any_record, m.dates_with_actions, m.weather_issuances, m.air_quality_issuances, m.observations, m.alert_messages, m.acknowledgements, m.watch_changes, m.notices, m.account_writes, m.actions, m.provenance]));
  lines.push('', '## States at the dataset clock', '');
  for (const [k, v] of Object.entries(json.states_at_clock)) lines.push('- ' + k.replace(/_/g, ' ') + ': ' + (Array.isArray(v) ? v.join(', ') : Object.entries(v).map(([s, n]) => s + ' ' + n).join(', ')));
  lines.push('- invalid or missing dates: ' + (json.invalid_or_missing_dates.length ? json.invalid_or_missing_dates.join(', ') : 'none'), '');
  lines.push('## Representative records', '');
  const brief = x => '```json\n' + JSON.stringify(x, null, 1).replace(/\n\s*/g, ' ') + '\n```';
  const thread = data.alerts.find(x => x.messages.length >= 2 && x.messages.some(m => m.type === 'update')), watch = data.watches.find(w => w.updated_at), aq = data.issuances.find(i => i.id.startsWith('aq-marrow-2025'));
  const weather = data.issuances.find(i => i.id.startsWith('iss-pfo-quill-2025')), notice = data.notices.find(n => n.kind === 'watch.triggered') || data.notices[0];
  lines.push('An alert thread with an update:', '', brief(thread), '');
  lines.push('A watch the account holder moved:', '', brief({ ...watch, evaluation: { status: watch.evaluation.status, evaluated_at: watch.evaluation.evaluated_at, cause: watch.evaluation.cause } }), '');
  lines.push('A weekly air-quality outlook:', '', brief(aq), '');
  lines.push('A fortnightly weather issuance (first 3 of its 24 hourly rows, first 2 of its 5 daily rows):', '', brief({ ...weather, hourly: weather.hourly.slice(0, 3), daily: weather.daily.slice(0, 2) }), '');
  lines.push('A notice (wire copy omitted):', '', brief({ ...notice, wire: notice.wire ? '…' : undefined }), '');
  lines.push('## Loading and queries', '', '`node tests/dataset.integration.cjs --runtime DIR` loads `seed.json` through the public runtime with `env.load_seed` and the dataset clock, then reads it back through the App\'s MCP tools: every place\'s issuances, alerts and the account\'s watches, notices and saved places, month by month against this report, the newest observation, and one write on the loaded data. Its report is in `docs/validation/rainshadow/`.', '');
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
  console.log('Actions on ' + json.global.actions_only.distinct_dates + ' dates, all history on ' + json.global.all_history.distinct_dates + ' of ' + json.window.days + ' dates.');
}

module.exports = { count };
if (require.main === module) main();
