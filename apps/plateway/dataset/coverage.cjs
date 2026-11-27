'use strict';
const fs = require('node:fs');
const path = require('node:path');
const plugin = require('../plugin.cjs');
const { ms } = require('../src/time.cjs');
const lib = require('./lib.cjs');
const { AWAY, NO_DELIVERY } = require('./generate.cjs');
const { asOf } = require('./as-of.cjs');
const { ZONE, FIRST, LAST, START, END, REFERENCE, FILES } = lib;

const OUT = { json: 'dataset/COVERAGE.json', md: 'dataset/COVERAGE.md' };
const METHOD = ['dataset/lib.cjs', 'dataset/feedback.cjs', 'dataset/generate.cjs', 'dataset/as-of.cjs', 'dataset/coverage.cjs'];
const INSTANTS = ['2026-01-01', REFERENCE, '2026-12-15', END];
const instantsOf = files => {
  const timeout = files.full.orders.find(o => o.cancellation && o.cancellation.reason === 'not_accepted');
  return [lib.instant(new Date(ms(timeout.accept_by) + 1).toISOString()), ...INSTANTS.map(lib.instant)].sort((a, b) => ms(a) - ms(b));
};
const GAP_DAYS = 7;
const KINDS = [
  { kind: 'order', source: FILES.full, path: 'orders[]', id: 'orders[].id', date_field: 'placed_at' },
  { kind: 'order_line', source: FILES.full, path: 'orders[].lines[]', id: 'orders[].lines[].id', date_field: 'placed_at of the parent order' },
  { kind: 'refund', source: FILES.full, path: 'orders[].refunds[]', id: 'orders[].refunds[].id', date_field: 'at' },
  { kind: 'rating', source: FILES.full, path: 'orders[].rating', id: '<order id>/rating', date_field: 'rating.at' },
  { kind: 'line_report', source: FILES.full, path: 'orders[].lines[].report', id: '<line id>/report', date_field: 'report.at' },
  { kind: 'notice', source: FILES.full, path: 'notices[]', id: 'notices[].id', date_field: 'at' },
  { kind: 'replay_step', source: FILES.replay, path: 'steps[]', id: 'steps[].id', date_field: 'at' },
];
const ROLES = {
  [FILES.base]: 'Seed at the window start ' + START + ': the account, addresses, cards, zones, restaurants and menu with the earlier prices; no orders.',
  [FILES.replay]: 'Every committed step in time order: the account holder\'s tool calls and Infra events, each with its time.',
  [FILES.full]: 'Seed at ' + END + ', the state after every step: all records of the window.',
};
const plural = kind => kind + 's';
const money = c => '$' + (c / 100).toFixed(2);

function inventory(files) {
  const items = [...lib.dated(files.full).map(i => ({ ...i, source: FILES.full })), ...files.replay.steps.map(s => ({ kind: 'replay_step', id: s.id, at: s.at, source: FILES.replay, action: s.operation || s.tool }))];
  const invalid = items.filter(i => typeof i.at !== 'string' || !Number.isFinite(ms(i.at)));
  const dated = items.filter(i => !invalid.includes(i)).map(i => ({ ...i, date: lib.localDate(i.at) }));
  const outside = dated.filter(i => i.date < FIRST || i.date > LAST);
  return { invalid, outside, counted: dated.filter(i => i.date >= FIRST && i.date <= LAST) };
}

function span(list) {
  const dates = [...new Set(list.map(i => i.date))].sort();
  return { distinct_dates: dates.length, earliest: dates[0] || null, latest: dates[dates.length - 1] || null };
}

function extra(counted, records) {
  const dated = new Set(records.map(i => i.date)), kinds = new Map();
  const label = a => /^(menu_item|restaurant)\./.test(a) ? 'menu or restaurant events' : a.startsWith('order.') ? 'order events' : a.startsWith('plateway.cart.') ? 'cart edits' : a;
  for (const i of counted) if (i.kind === 'replay_step' && !dated.has(i.date)) { const k = label(i.action); kinds.set(k, (kinds.get(k) || 0) + 1); }
  return [...kinds].map(([k, n]) => n + ' ' + k).join(' and ');
}

function gaps(dates) {
  const out = [];
  let run = null;
  for (let d = FIRST; d <= LAST; d = lib.addDays(d, 1)) {
    if (!dates.has(d)) { run = run || { from: d, to: d }; run.to = d; continue; }
    if (run) out.push(run);
    run = null;
  }
  if (run) out.push(run);
  return out.map(r => {
    let days = 0;
    for (let d = r.from; d <= r.to; d = lib.addDays(d, 1)) days++;
    const away = AWAY.find(([from, to]) => from <= r.to && to >= r.from);
    const reason = away ? 'The account holder is away from ' + away[0] + ' to ' + away[1] + ', so the generator plans no orders.' : NO_DELIVERY.some(d => d >= r.from && d <= r.to) ? 'Includes Thanksgiving, when the generator plans no orders; otherwise ordinary variation between orders.' : 'No order is planned in these days; ordinary variation between orders.';
    return { kind: 'days_without_records', from: r.from, to: r.to, days, reason };
  }).filter(g => g.days >= GAP_DAYS);
}

function describe(seed, order, label) {
  const name = seed.restaurants.find(r => r.id === order.restaurant_id).name;
  const line = l => l.quantity + ' × ' + l.name + (l.options.length ? ' (' + l.options.map(o => o.name).join(', ') + ')' : '') + (l.label ? ' — ' + l.label : '') + (l.removed ? ' [removed: ' + l.removed_reason + ']' : '') + (l.report ? ' [reported ' + l.report.kind + ']' : '');
  return {
    example: label, id: order.id, placed_at: order.placed_at, restaurant: name, address_id: order.address_id, card_id: order.card_id, mode: order.mode, status: order.status,
    lines: order.lines.map(line), total_cents: order.total_cents, refunds: order.refunds.map(r => r.id + ' ' + r.reason + ' ' + money(r.amount_cents)),
    cancellation: order.cancellation ? order.cancellation.reason : null, rating: order.rating ? order.rating.stars + ' stars' + (order.rating.text ? ': ' + order.rating.text : '') : null,
    timeline: order.timeline.map(t => t.at + ' ' + t.note), notices: seed.notices.filter(n => n.order_id === order.id).map(n => n.id + ' ' + n.title),
  };
}

function representative(seed) {
  const used = new Set();
  const find = (label, test) => { const o = seed.orders.find(x => !used.has(x.id) && test(x)); if (!o) return null; used.add(o.id); return describe(seed, o, label); };
  const plain = o => o.status === 'delivered' && !o.lines.some(l => l.report || l.removed) && !o.timeline.some(t => t.note.startsWith('Delayed'));
  return [
    find('first order of the window', () => true),
    find('last order of the window', o => o === seed.orders[seed.orders.length - 1]),
    find('first order after the reference clock', o => ms(o.placed_at) >= ms(REFERENCE)),
    find('office lunch with a line for a colleague', o => o.address_id === 'a-2' && o.lines.some(l => l.label) && plain(o)),
    find('scheduled dinner released at its time', o => o.mode === 'scheduled' && plain(o) && lib.localDate(o.placed_at) === lib.localDate(o.delivery_at)),
    find('breakfast scheduled the evening before', o => o.mode === 'scheduled' && plain(o)),
    find('delayed order', o => o.status === 'delivered' && o.timeline.some(t => t.note.startsWith('Delayed'))),
    find('line removed as unavailable while preparing', o => o.lines.some(l => l.removed_reason === 'unavailable')),
    find('reported line refunded', o => o.lines.some(l => l.report)),
    find('rejected by the restaurant', o => o.cancellation && o.cancellation.reason === 'rejected'),
    find('not accepted within 20 minutes', o => o.cancellation && o.cancellation.reason === 'not_accepted'),
    find('cancelled by the account holder before preparation', o => o.cancellation && o.cancellation.reason === 'account_holder' && o.cancellation.stage === 'submitted'),
    find('cancelled by the account holder while preparing', o => o.cancellation && o.cancellation.reason === 'account_holder' && o.cancellation.stage === 'preparing'),
  ].filter(Boolean);
}

function compute(files = lib.load()) {
  const { invalid, outside, counted } = inventory(files);
  const records = counted.filter(i => i.source === FILES.full);
  const after = i => ms(i.at) >= ms(REFERENCE);
  const all = new Set(counted.map(i => i.date));
  const monthly = lib.months().map(month => {
    const inMonth = counted.filter(i => i.date.startsWith(month)), mine = inMonth.filter(i => i.source === FILES.full);
    const row = { month };
    for (const k of KINDS) row[plural(k.kind)] = inMonth.filter(i => i.kind === k.kind).length;
    return { ...row, records: mine.length, distinct_dates: new Set(mine.map(i => i.date)).size, distinct_dates_with_replay_log: new Set(inMonth.map(i => i.date)).size, records_after_reference_clock: mine.filter(after).length, real: 0, synthetic: mine.length };
  });
  const perDate = Object.fromEntries([...all].sort().map(d => [d, { records: 0, orders: 0, replay_steps: 0 }]));
  for (const i of counted) { if (i.source === FILES.full) perDate[i.date].records++; if (i.kind === 'order') perDate[i.date].orders++; if (i.kind === 'replay_step') perDate[i.date].replay_steps++; }
  const sources = [FILES.base, FILES.replay, FILES.full].map(file => ({ file, role: ROLES[file], kind: 'synthetic', bytes: fs.statSync(lib.file(file)).size, sha256: lib.sha256(file) }));
  const kinds = KINDS.map(k => { const list = counted.filter(i => i.kind === k.kind); return { ...k, records: list.length, ...span(list) }; });
  const full = files.full;
  return {
    schema: 'plateway.coverage.v1',
    scope: 'Environment dataset coverage of the Plateway delivery dataset ' + files.replay.dataset_id + ', whole window. Not a Task history report: a Task reports its own selection after its first-session cutoff (dataset/as-of.cjs).',
    dataset_id: files.replay.dataset_id,
    time_zone: ZONE,
    window: { from: FIRST, to: LAST },
    reference_clock: REFERENCE,
    reproduce: ['node dataset/generate.cjs --check', 'node dataset/coverage.cjs --check'],
    counting: 'Every timestamp is ISO 8601 with its offset; each is converted to its calendar date in ' + ZONE + ' before counting. No record is date-only. A date counts once however many records or sources fall on it. Records outside the window and invalid dates would be excluded and listed; there are none.',
    sources,
    method: METHOD.map(file => ({ file, sha256: lib.sha256(file) })),
    record_kinds: kinds,
    exclusions: [
      { records: 'restaurants[] and dishes[] in ' + FILES.full, count: full.restaurants.length + full.dishes.length, reason: 'Catalog records describe the menu as it stands and carry no occurrence date; their dated changes are the replay steps menu_item.price_changed, menu_item.availability_changed and restaurant.status_changed.' },
      { records: 'holder, zones[], addresses[] and cards[] in ' + FILES.full, count: 1 + full.zones.length + full.addresses.length + full.cards.length, reason: 'Account rows with no occurrence date.' },
      { records: FILES.base, count: 0, reason: 'Holds only the account and catalog at the window start; no dated records.' },
    ],
    invalid_dates: invalid.length,
    outside_window: outside.length,
    totals: { records: records.length, replay_steps: counted.filter(i => i.kind === 'replay_step').length, app_records: plugin.records(full).length, catalog_records: full.restaurants.length + full.dishes.length },
    distinct_dates: {
      coverage: span(records).distinct_dates,
      coverage_basis: 'Counted over the records loaded into the App (' + FILES.full + '), which Agents and Infra read back.',
      coverage_note: 'The global count over both sources adds ' + (all.size - span(records).distinct_dates) + ' days on which the replay log holds only ' + extra(counted, records) + '; those days have no App record.',
      by_source: { [FILES.full]: span(records).distinct_dates, [FILES.replay]: span(counted.filter(i => i.source === FILES.replay)).distinct_dates },
      by_kind: Object.fromEntries(kinds.map(k => [k.kind, k.distinct_dates])),
      global: all.size,
    },
    earliest: span(counted).earliest,
    latest: span(counted).latest,
    provenance: { real: 0, synthetic: records.length, mixed: 0, note: 'Every record and step is synthetic, written by the App while dataset/generate.cjs replayed it; none was collected or observed.' },
    partitions: [
      { partition: 'synthetic, dated before the reference clock', from: START, to: REFERENCE, records: records.filter(i => !after(i)).length, replay_steps: counted.filter(i => i.kind === 'replay_step' && !after(i)).length },
      { partition: 'synthetic, dated at or after the reference clock: generated, never observed', from: REFERENCE, to: END, records: records.filter(after).length, replay_steps: counted.filter(i => i.kind === 'replay_step' && after(i)).length },
    ],
    monthly,
    months_without_orders: monthly.filter(m => m.orders === 0).map(m => m.month),
    gaps: [
      { kind: 'real_data_anchor', period: '2026-11', status: 'stated gap, pending maintainer agreement', reason: 'DoorDash is only the workflow reference. The approved proposal (proposals/environment/plateway-delivery.md, line 96: "N/A: no crawling or copied menus") excludes collecting its data, and Plateway\'s restaurants, menus, couriers and account are invented, so there is no real source to collect around November 2026; the whole window is synthetic.' },
      { kind: 'mail_history', status: 'stated gap', reason: 'The ' + full.notices.length + ' notices are in the App\'s own notice log only; the dataset holds no Mail history for them. Mail is optional, and the Mail sender treats notices present in a loaded seed as history.' },
      ...gaps(new Set(records.map(i => i.date))),
    ],
    dates: perDate,
    representative: representative(full),
  };
}

function monthlyOf(views, notices) {
  const rows = Object.fromEntries(lib.months().map(m => [m, { orders: 0, order_lines: 0, refunds: 0, ratings: 0, line_reports: 0, notices: 0 }]));
  const bump = (at, key) => { const m = lib.localDate(at).slice(0, 7); if (rows[m]) rows[m][key]++; };
  for (const o of views) {
    bump(o.placed_at, 'orders');
    for (const l of o.lines) { bump(o.placed_at, 'order_lines'); if (l.report) bump(l.report.at, 'line_reports'); }
    for (const r of o.refunds) bump(r.at, 'refunds');
    if (o.rating) bump(o.rating.at, 'ratings');
  }
  for (const n of notices) bump(n.at, 'notices');
  return rows;
}

async function demonstrate(runtimeDir, files) {
  const { prepare } = require(path.join(runtimeDir, 'prepare.cjs'));
  const { Client } = require(path.join(runtimeDir, 'client.cjs'));
  const prepared = prepare(lib.ROOT);
  const clients = [];
  const open = async role => {
    const c = new Client(prepared.app, role, 'dataset-load', path.join(prepared.root, 'state'), 'plateway-dataset-load', { registry: prepared.registry });
    clients.push(c);
    await c.initialize();
    return c;
  };
  try {
    const infra = await open('infra'), agent = await open('agent');
    const version = async () => (await infra.call('env.snapshot')).version;
    const instants = [];
    for (const [i, text] of instantsOf(files).entries()) {
      const selection = asOf(text, files);
      const loaded = await infra.call('env.load_seed', { expected_version: await version(), request_id: 'dataset-load-' + (i + 1), data: selection.data, virtual_now: selection.virtual_now, bundle: selection.bundle });
      if (loaded.status !== 'ready') throw Error('env.load_seed at ' + selection.as_of + ': ' + loaded.status + ' ' + (loaded.message || ''));
      const account = await agent.call('plateway.account.get', {});
      const listed = (await agent.call('plateway.orders.list', {})).orders;
      const later = (await agent.call('plateway.orders.list', { from: selection.virtual_now })).orders;
      const views = [];
      for (const o of listed) views.push((await agent.call('plateway.orders.get', { order_id: o.id })).order);
      const snapshot = (await infra.call('env.snapshot')).snapshot;
      const readBack = monthlyOf(views, snapshot.data.notices);
      const expected = monthlyOf(selection.data.orders, selection.data.notices);
      const dish = (await agent.call('plateway.menu_items.get', { item_id: 'mi-13' })).item;
      const cart = await agent.call('plateway.cart.get', {});
      const totals = Object.fromEntries(['orders', 'order_lines', 'refunds', 'ratings', 'line_reports', 'notices'].map(k => [k, Object.values(readBack).reduce((s, r) => s + r[k], 0)]));
      let staged = null;
      if (selection.events.length) {
        const event = selection.events[0];
        const applied = await infra.call('env.apply_event', { expected_version: await version(), event });
        const p = event.payload;
        const item = p.item_id ? (await agent.call('plateway.menu_items.get', { item_id: p.item_id })).item : null;
        const target = p.order_id ? 'order ' + p.order_id + ' ' + (await agent.call('plateway.orders.get', { order_id: p.order_id })).order.status
          : item ? item.id + ' ' + money(item.price_cents) + (item.available ? ', available' : ', sold out')
            : p.restaurant_id + ' ' + (await agent.call('plateway.restaurants.get', { restaurant_id: p.restaurant_id })).restaurant.status;
        staged = { event_id: event.event_id, at: event.at, operation: event.operation, status: applied.status, target_after: target };
      }
      instants.push({
        as_of: selection.as_of,
        seed_id: selection.data.seed_id,
        load: { tool: 'env.load_seed', status: loaded.status, loaded_objects: loaded.loaded, bundle_dataset_id: loaded.quality.dataset_id, automated_checks: loaded.quality.automated_pass ? 'pass' : 'fail' },
        account_now: account.now,
        steps_applied: selection.steps_applied,
        steps_withheld: selection.steps_withheld,
        orders_in_selection: selection.data.orders.length,
        orders_listed: listed.length,
        listed_ids_match_selection: JSON.stringify(listed.map(o => o.id).sort()) === JSON.stringify(selection.data.orders.map(o => o.id).sort()),
        latest_listed_placed_at: listed.length ? listed.map(o => o.placed_at).sort((a, b) => ms(b) - ms(a))[0] : null,
        orders_listed_from_as_of: later.length,
        timers_committed: selection.timers_committed.length,
        open_orders: selection.open_orders.map(o => o.order_id + ' ' + o.status),
        open_orders_match_core: JSON.stringify(selection.open_orders.map(o => o.order_id + ' ' + o.status)) === JSON.stringify(listed.filter(o => !['delivered', 'cancelled'].includes(o.status)).map(o => o.id + ' ' + o.status).sort((a, b) => Number(a.split(' ')[0].slice(2)) - Number(b.split(' ')[0].slice(2)))),
        read_back: totals,
        monthly_read_back_matches_selection: JSON.stringify(readBack) === JSON.stringify(expected),
        cart_lines: cart.lines.length,
        menu_item_mi_13_price_cents: dish.price_cents,
        staged_events_available: selection.events.length,
        first_staged_event: staged,
        ...(ms(selection.as_of) === ms(END) ? { monthly_read_back: readBack } : {}),
      });
    }
    return { interface: 'Real Core ' + require(path.join(runtimeDir, 'package.json')).version + ' over MCP stdio: Infra loads each selection with env.load_seed (data, virtual_now and provenance bundle) and reads env.snapshot; the Agent reads plateway.account.get, plateway.orders.list, plateway.orders.get for every listed order, plateway.cart.get and plateway.menu_items.get; the first staged event, if any, is applied with env.apply_event.', runtime: require(path.join(runtimeDir, 'package.json')).version, instants };
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    prepared.cleanup();
  }
}

const table = (head, rows) => ['| ' + head.join(' | ') + ' |', '| ' + head.map(() => '---').join(' | ') + ' |', ...rows.map(r => '| ' + r.join(' | ') + ' |')].join('\n');
function render(report) {
  const k = Object.fromEntries(report.record_kinds.map(x => [x.kind, x]));
  const lines = [
    '# Plateway delivery dataset: coverage',
    '',
    report.scope,
    '',
    '- Dataset: `' + report.dataset_id + '`; window ' + report.window.from + ' to ' + report.window.to + ' inclusive; time zone `' + report.time_zone + '`; reference clock (the fixture clock) `' + report.reference_clock + '`.',
    '- Reproduce: ' + report.reproduce.map(c => '`' + c + '`').join(', then ') + ' from `apps/plateway`. This file and `COVERAGE.json` are written by `dataset/coverage.cjs`.',
    '- Counting: ' + report.counting,
    '- Smoke fixture and delivery dataset: `fixtures/minimal.json` and this dataset share the account and the catalog (equal at the fixture clock, checked by `tests/t26-dataset.test.cjs`) but have independent order histories. The fixture serves the business tests, the examples and the proposal\'s example events; the dataset serves evaluation, and Tasks select their history from it with `dataset/as-of.cjs`. The IDs overlap but name different orders: the fixture\'s `o-1` … `o-12` (and its `ol-`, `rf-` and `n-` IDs) are not the dataset\'s, and the proposal\'s example events name fixture IDs.',
    '',
    '## Sources',
    '',
    table(['File', 'Role', 'Kind', 'Bytes', 'SHA-256'], report.sources.map(s => ['`' + s.file + '`', s.role, s.kind, String(s.bytes), '`' + s.sha256 + '`'])),
    '',
    'Method: ' + report.method.map(m => '`' + m.file + '` (`' + m.sha256.slice(0, 16) + '…`)').join(', ') + '; full hashes in `COVERAGE.json`.',
    '',
    '## Record kinds, IDs and date fields',
    '',
    table(['Kind', 'Source', 'Records at', 'Stable ID', 'Date field', 'Records', 'Distinct dates', 'Earliest', 'Latest'], report.record_kinds.map(x => [x.kind, '`' + x.source + '`', '`' + x.path + '`', '`' + x.id + '`', x.date_field, String(x.records), String(x.distinct_dates), x.earliest, x.latest])),
    '',
    'Excluded from date counts:',
    '',
    ...report.exclusions.map(e => '- ' + e.records + ' (' + e.count + '): ' + e.reason),
    '- Invalid dates: ' + report.invalid_dates + '; records outside the window: ' + report.outside_window + '.',
    '',
    '## Totals',
    '',
    '- Dated records in `' + FILES.full + '`: ' + report.totals.records + ' (' + ['order', 'order_line', 'refund', 'rating', 'line_report', 'notice'].map(x => k[x].records + ' ' + x.replace('_', ' ') + 's').join(', ') + '). App records (`plugin.records`: restaurants, dishes and orders): ' + report.totals.app_records + '.',
    '- Replay steps in `' + FILES.replay + '`: ' + report.totals.replay_steps + '.',
    '- Coverage figure: **' + report.distinct_dates.coverage + '** distinct dates. ' + report.distinct_dates.coverage_basis + ' ' + report.distinct_dates.coverage_note + ' Per source: ' + Object.entries(report.distinct_dates.by_source).map(([f, n]) => '`' + f + '` ' + n).join(', ') + '; global deduplicated count over both sources: ' + report.distinct_dates.global + '.',
    '- Earliest date ' + report.earliest + ', latest date ' + report.latest + '. Months without orders: ' + (report.months_without_orders.length ? report.months_without_orders.join(', ') : 'none') + '.',
    '',
    '## Real and synthetic',
    '',
    '- Real ' + report.provenance.real + ', synthetic ' + report.provenance.synthetic + ', mixed ' + report.provenance.mixed + '. ' + report.provenance.note,
    '',
    table(['Partition', 'From', 'To', 'Records', 'Replay steps'], report.partitions.map(p => [p.partition, p.from, p.to, String(p.records), String(p.replay_steps)])),
    '',
    '## Monthly coverage',
    '',
    table(['Month', 'Orders', 'Lines', 'Refunds', 'Ratings', 'Reports', 'Notices', 'Records', 'Replay steps', 'Distinct dates (records)', 'Distinct dates (with replay log)', 'After reference clock', 'Real', 'Synthetic'],
      report.monthly.map(m => [m.month, m.orders, m.order_lines, m.refunds, m.ratings, m.line_reports, m.notices, m.records, m.replay_steps, m.distinct_dates, m.distinct_dates_with_replay_log, m.records_after_reference_clock, m.real, m.synthetic].map(String))),
    '',
    'Per-date counts are in `COVERAGE.json` (`dates`).',
    '',
    '## Gaps',
    '',
    ...report.gaps.map(g => g.kind === 'real_data_anchor' ? '- No real-data anchor (' + g.period + '; ' + g.status + '): ' + g.reason : g.kind === 'mail_history' ? '- No Mail history (' + g.status + '): ' + g.reason : '- ' + g.from + ' to ' + g.to + ' (' + g.days + ' days without any App record): ' + g.reason),
    '',
    '## Representative records',
    '',
    table(['Example', 'Order', 'Placed', 'Restaurant', 'Address', 'Mode', 'Status', 'Lines', 'Total', 'Refunds', 'Rating'], report.representative.map(r => [r.example, r.id, r.placed_at, r.restaurant, r.address_id, r.mode, r.status + (r.cancellation ? ' (' + r.cancellation + ')' : ''), r.lines.join('; '), money(r.total_cents), r.refunds.join('; ') || '—', r.rating || '—'])),
    '',
    'Timelines and notices of these orders are in `COVERAGE.json` (`representative`).',
    '',
  ];
  if (report.loading) {
    const l = report.loading, last = l.instants[l.instants.length - 1];
    lines.push('## Loading and query demonstration', '', l.interface, '',
      table(['As of', 'Seed ID', 'env.load_seed', 'Agent clock', 'Steps applied / withheld', 'Orders selected / listed', 'Same IDs', 'Latest listed order', 'Listed from the as-of instant'],
        l.instants.map(x => [x.as_of, '`' + x.seed_id + '`', x.load.status + ', ' + x.load.loaded_objects + ' objects, bundle `' + x.load.bundle_dataset_id + '`, automated checks ' + x.load.automated_checks, x.account_now,
          x.steps_applied + ' / ' + x.steps_withheld, x.orders_in_selection + ' / ' + x.orders_listed, x.listed_ids_match_selection ? 'yes' : 'no', x.latest_listed_placed_at || '—', String(x.orders_listed_from_as_of)])),
      '',
      table(['As of', 'Lines', 'Refunds', 'Ratings', 'Reports', 'Notices', 'Monthly read-back equals the selection', 'Timers committed', 'Open orders (same as Core reads)', 'Cart lines', 'mi-13 price', 'Staged events', 'First staged event applied'],
        l.instants.map(x => [x.as_of, x.read_back.order_lines, x.read_back.refunds, x.read_back.ratings, x.read_back.line_reports, x.read_back.notices, x.monthly_read_back_matches_selection ? 'yes' : 'no', x.timers_committed, (x.open_orders.join(', ') || 'none') + (x.open_orders_match_core ? ' (yes)' : ' (no)'), x.cart_lines, money(x.menu_item_mi_13_price_cents), x.staged_events_available,
          x.first_staged_event ? x.first_staged_event.operation + ' at ' + x.first_staged_event.at + ': ' + x.first_staged_event.status + '; then ' + x.first_staged_event.target_after : '—'].map(String))),
      '', 'Lines, refunds, ratings and reports are read back with plateway.orders.get, notices with env.snapshot. The first row cuts one millisecond after an acceptance limit passed with no later step yet: the selection commits that timer, as the App\'s next write would, so its order is cancelled in the seed and in Core\'s reads alike and is not an open order. At ' + last.as_of + ' the whole window is loaded; its monthly read-back (`loading.instants[].monthly_read_back` in `COVERAGE.json`) equals the monthly table above, which `dataset/coverage.cjs` checks.', '');
  }
  return lines.join('\n');
}

async function report({ runtimeDir, files = lib.load() } = {}) {
  const out = compute(files);
  out.loading = await demonstrate(runtimeDir, files);
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const option = (name, fallback) => { const i = argv.lastIndexOf(name); return i >= 0 ? argv[i + 1] : fallback; };
  const runtimeDir = path.resolve(option('--runtime', process.env.PALE_RUNTIME_ROOT || path.join(lib.ROOT, '..', '..', 'runtime')));
  const out = await report({ runtimeDir });
  const end = out.loading.instants[out.loading.instants.length - 1];
  const fresh = { [OUT.json]: lib.pretty(out), [OUT.md]: render(out) };
  const monthlyOk = out.monthly.every(m => Object.keys(end.monthly_read_back[m.month]).every(key => end.monthly_read_back[m.month][key] === m[key]));
  if (!monthlyOk) throw Error('The monthly counts read back through MCP differ from the computed coverage.');
  if (argv.includes('--check')) {
    const differs = Object.keys(fresh).filter(rel => !fs.existsSync(lib.file(rel)) || fs.readFileSync(lib.file(rel), 'utf8') !== fresh[rel]);
    console.log(differs.length ? 'coverage report differs: ' + differs.join(', ') : 'coverage report is up to date: ' + out.totals.records + ' records, ' + out.distinct_dates.coverage + ' distinct dates (' + out.distinct_dates.global + ' with the replay log), ' + out.earliest + ' to ' + out.latest);
    process.exitCode = differs.length ? 1 : 0;
    return;
  }
  for (const [rel, text] of Object.entries(fresh)) fs.writeFileSync(lib.file(rel), text);
  console.log(JSON.stringify({ records: out.totals.records, replay_steps: out.totals.replay_steps, distinct_dates: out.distinct_dates.coverage, with_replay_log: out.distinct_dates.global, earliest: out.earliest, latest: out.latest }));
}

if (require.main === module) main().catch(e => { console.error(e.message); process.exit(1); });
module.exports = { compute, render, monthlyOf, OUT, INSTANTS, instantsOf, KINDS };
