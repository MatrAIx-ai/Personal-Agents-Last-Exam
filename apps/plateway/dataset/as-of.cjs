'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const plugin = require('../plugin.cjs');
const { ms, toIso } = require('../src/time.cjs');
const { applyDueTimers } = require('../src/timers.cjs');
const lib = require('./lib.cjs');

const SOURCES = ['delivery-dataset'];
const compact = iso => new Date(ms(iso)).toISOString().replace(/[-:]/g, '');
const digest = (data, at) => crypto.createHash('sha256').update(JSON.stringify({ virtual_now: at, data: { ...data, seed_id: null } })).digest('hex').slice(0, 12);
const selectionId = (data, at) => lib.SEED_IDS.asOf + compact(at) + '-' + digest(data, at);
const exists = (data, step) => step.payload.order_id === undefined || data.orders.some(o => o.id === step.payload.order_id);
const outcome = o => o.status + (o.cancellation ? ' (' + o.cancellation.reason + ')' : '');
const read = (data, at, id) => plugin.handleTool({ app_id: 'plateway', run_id: lib.RUN, role: 'agent', virtual_now: at, binding: lib.BINDING }, data, 'plateway.orders.get', { order_id: id }).result.order;

function openOrders(data, at, staged, later, files) {
  const open = data.orders.map(o => ({ id: o.id, status: read(data, at, o.id).status })).filter(o => !['delivered', 'cancelled'].includes(o.status));
  if (!open.length) return [];
  const after = structuredClone(data);
  for (const step of staged) lib.apply(after, step);
  return open.map(o => {
    const projected = outcome(read(after, lib.END, o.id));
    const recorded = outcome(files.full.orders.find(x => x.id === o.id));
    return {
      order_id: o.id, status: o.status, after_staged_events: projected, in_dataset: recorded, completed_by_staged_events: projected === recorded,
      withheld_account_holder_steps: later.filter(s => s.by !== 'infra' && s.args.order_id === o.id).map(s => ({ id: s.id, at: s.at, tool: s.tool })),
    };
  });
}

function bundle(data, at, applied, withheld, timers) {
  const declared = lib.read('contribution/dataset.json');
  return {
    dataset: {
      schema_version: declared.schema_version,
      dataset_id: data.seed_id,
      version: declared.version,
      description: 'As-of selection of the Plateway delivery dataset ' + lib.SEED_IDS.full + ' at ' + at + ': the account, the catalog as it stood at that instant and every record dated before it. All records are synthetic; orders still open at that instant have only the history they had then (see open_orders in the selection).',
      record_source_ids: SOURCES,
      sources: declared.sources.filter(s => SOURCES.includes(s.source_id)),
      transformations: ['Replayed the ' + applied + ' steps of ' + lib.FILES.replay + ' (sha256 ' + lib.sha256(lib.FILES.replay) + ') dated before ' + at + ' over ' + lib.FILES.base + ' (sha256 ' + lib.sha256(lib.FILES.base) + ') through the App handlers, then committed the ' + timers + ' timers due before that instant as the App\'s next write would; the ' + withheld + ' later steps are withheld.'],
      expected_counts: { records: plugin.records(data).length, assets: 0 },
      quality_policy: declared.quality_policy,
      review: declared.review,
    },
    catalog: lib.read('contribution/assets.catalog.json'),
    blobs: {},
  };
}

function asOf(text, files = lib.load()) {
  const at = lib.instant(text);
  if (ms(at) < ms(lib.START) || ms(at) > ms(lib.END)) throw Error('The instant must be from ' + lib.START + ' to ' + lib.END + ', the dataset window.');
  const { data, applied } = lib.replay(files.base, files.replay.steps, at);
  const timers = applyDueTimers(data, toIso(ms(at) - 1, lib.ZONE));
  data.seed_id = selectionId(data, at);
  lib.validate(data, at);
  const later = files.replay.steps.slice(applied);
  const staged = later.filter(s => s.by === 'infra' && exists(data, s));
  return {
    schema: 'plateway.as-of.v1',
    dataset_id: files.replay.dataset_id,
    as_of: at,
    virtual_now: at,
    steps_applied: applied,
    steps_withheld: later.length,
    timers_committed: timers.map(t => ({ kind: t.kind, order_id: t.order_id, at: t.at })),
    summary: lib.summarize(data),
    data,
    open_orders: openOrders(data, at, staged, later, files),
    events: staged.map(lib.envelope),
    bundle: bundle(data, at, applied, later.length, timers.length),
  };
}

function main() {
  const argv = process.argv.slice(2);
  const option = name => { const i = argv.lastIndexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const at = option('--at');
  if (!at) {
    console.error('Usage: node dataset/as-of.cjs --at <instant> [--out FILE] [--summary]\n  <instant> is a date (local midnight in ' + lib.ZONE + ') or a date-time with an offset, from ' + lib.START + ' to ' + lib.END + '.');
    process.exit(2);
  }
  let selection;
  try { selection = asOf(at); } catch (e) { console.error(e.message); process.exit(1); }
  const { data, events, bundle: b, ...head } = selection;
  const brief = { ...head, seed_id: data.seed_id, counters: data.issued || {}, cart_lines: data.cart.lines.length, staged_events: events.length };
  const out = option('--out');
  if (out) {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, lib.pretty(selection));
    console.log(JSON.stringify({ ...brief, out }));
  } else if (argv.includes('--summary')) console.log(lib.pretty(brief).trimEnd());
  else process.stdout.write(lib.pretty(selection));
}

if (require.main === module) main();
module.exports = { asOf, compact, selectionId };
