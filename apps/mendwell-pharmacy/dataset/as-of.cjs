'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const plugin = require('../plugin.cjs');
const { ms, toIso } = require('../src/time.cjs');
const { applyDueTimers } = require('../src/timers.cjs');
const { project } = require('../src/operations.cjs');
const { eventTargets } = require('../src/guards.cjs');
const { relation, fillAccess, collectorVia } = require('../src/authority.cjs');
const { cardUsable, liveAuthorization } = require('../src/payment.cjs');
const { isOpen } = require('../src/time.cjs');
const lib = require('./lib.cjs');

const TERMINAL = ['collected', 'returned_to_stock', 'cancelled'];
const compact = iso => new Date(ms(iso)).toISOString().replace(/[-:]/g, '');
const digest = (data, at) => crypto.createHash('sha256').update(JSON.stringify({ virtual_now: at, data: { ...data, seed_id: null } })).digest('hex').slice(0, 12);
const selectionId = (data, at) => lib.SEED_IDS.asOf + compact(at) + '-' + digest(data, at);
const outcome = f => f.state + (f.cancellation ? ' (' + f.cancellation.reason + ')' : '');
const labelSources = declared => declared.sources.filter(s => s.kind === 'reused').map(s => s.source_id);
const OWNER = lib.OWNER;
const KEYS = [['plan_requests', 'plan_request_id'], ['grants', 'grant_id'], ['renewals', 'renewal_id'], ['fills', 'fill_id'], ['authorizations', 'authorization_id']];
const idsOf = data => new Set(KEYS.flatMap(([list, key]) => data[list].map(r => r[key])));
const prefix = id => id.replace(/-\d+$/, '');

function stageable(data, step) {
  if (step.by !== 'infra') return false;
  try { eventTargets(data, lib.envelope(step)); } catch { return false; }
  const p = step.payload;
  if (step.operation === 'grant.changed') {
    const stored = data.grants.find(g => g.grant_id === p.grant_id);
    if (p.status === 'revoked' || p.patient_id === undefined) return Boolean(stored);
    return !stored;
  }
  if (step.operation === 'rx.received') return !data.prescriptions.some(r => r.rx_id === p.rx_id);
  if (step.operation === 'renewal.replied' && p.rx) return !data.prescriptions.some(r => r.rx_id === p.rx.rx_id);
  return true;
}

function effect(data, step) {
  const p = step.payload, t = ms(step.at), fill = id => data.fills.find(f => f.fill_id === id);
  if (step.operation === 'fill.collection_attempted') {
    const f = fill(p.fill_id), who = p.collector_id;
    if (f.hold !== null && !TERMINAL.includes(f.state)) return 'refused on_hold';
    if (f.state !== 'ready') return 'refused not_ready';
    if (!isOpen(data.stores.find(s => s.store_id === f.store_id), t)) return 'refused store_closed';
    if (!collectorVia(data, f, who, t)) return 'refused collector_not_authorized';
    if (f.amount_due_cents > 0) {
      const auth = liveAuthorization(data, f), card = data.cards.find(c => c.card_id === (auth ? auth.card_id : p.card_id));
      if (!card || (!auth && card.owner_id !== who) || !cardUsable(card, t)) return 'refused payment_failed';
    }
    return 'collected';
  }
  if (step.operation === 'plan.decided') {
    const pr = data.plan_requests.find(r => r.plan_request_id === p.plan_request_id), f = fill(pr.fill_id);
    if (pr.state !== 'pending' || f.state !== 'pending_plan_decision' || f.claim_id !== pr.claim_id) return 'ignored';
    return f.hold ? (f.hold.stored_decision ? 'ignored' : 'stored') : 'decided';
  }
  if (step.operation === 'fill.hold_placed') { const f = fill(p.fill_id); return f.hold !== null || TERMINAL.includes(f.state) ? 'ignored' : 'held while ' + f.state; }
  if (step.operation === 'fill.hold_released') { const f = fill(p.fill_id); return f.hold === null || TERMINAL.includes(f.state) ? 'ignored' : 'released'; }
  if (step.operation === 'renewal.replied') return data.renewals.find(r => r.renewal_id === p.renewal_id).state === 'pending' ? 'replied' : 'ignored';
  return 'applied';
}
const outcomeOf = (data, step) => {
  if (step.operation !== 'fill.collection_attempted') return null;
  const f = data.fills.find(x => x.fill_id === step.payload.fill_id), r = f.refusals.at(-1);
  return f.state === 'collected' && f.closed_at === step.at ? 'collected' : r && r.at === step.at ? 'refused ' + r.reason : 'unchanged';
};

const created = new WeakMap();
function createdBy(files) {
  if (created.has(files.replay)) return created.get(files.replay);
  const data = structuredClone(files.base), made = new Map(), effects = new Map();
  for (const step of files.replay.steps) {
    const before = idsOf(data);
    if (step.by === 'infra') { applyDueTimers(data, step.at); effects.set(step.id, effect(data, step)); }
    lib.apply(data, step);
    const fresh = [...idsOf(data)].filter(id => !before.has(id));
    if (fresh.length) made.set(step.id, fresh);
  }
  const out = { made, effects };
  created.set(files.replay, out);
  return out;
}

function play(data, later, take, { made, effects }) {
  let state = structuredClone(data);
  const map = new Map(), mine = new Set(), script = [], results = new Map();
  const remap = value => {
    if (typeof value === 'string') {
      if (map.has(value)) return map.get(value);
      if (mine.has(value)) throw Object.assign(Error('ID ' + value + ' names another record here'), { code: 'id_conflict' });
      return value;
    }
    if (Array.isArray(value)) return value.map(remap);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remap(v)]));
    return value;
  };
  for (const step of later) {
    if (step.by === 'infra') {
      let event;
      try { event = { ...step, payload: remap(step.payload) }; } catch { continue; }
      if (!stageable(state, event)) continue;
      applyDueTimers(state, event.at);
      const expected = effect(state, event);
      if (expected !== effects.get(step.id)) continue;
      try { lib.apply(state, event); } catch { continue; }
      const seen = outcomeOf(state, event);
      if (seen !== null && seen !== expected) throw Error('Event ' + step.id + ' did ' + seen + ' where ' + expected + ' was expected.');
      script.push({ kind: 'event', step: event });
    } else if (take.has(step.id)) {
      let action;
      try { action = { ...step, args: remap(step.args) }; } catch (e) { results.set(step.id, e.code); continue; }
      const trial = structuredClone(state), before = idsOf(state);
      try { lib.apply(trial, action); } catch (e) { results.set(step.id, e.code || 'error'); continue; }
      state = trial;
      results.set(step.id, 'committed');
      const fresh = [...idsOf(state)].filter(id => !before.has(id));
      const kept = [...fresh];
      for (const id of made.get(step.id) || []) {
        const m = fresh.find(x => prefix(x) === prefix(id));
        if (!m) continue;
        fresh.splice(fresh.indexOf(m), 1);
        map.set(id, m);
        mine.add(m);
      }
      for (const m of fresh) mine.add(m);
      script.push({ kind: 'action', step: action, made: kept });
    }
  }
  return { state, script, results };
}

function patientOf(data, fillId) {
  const f = data.fills.find(x => x.fill_id === fillId);
  return data.prescriptions.find(r => r.rx_id === f.rx_id).patient_id;
}
const visibleTo = (data, person, at) => data.fills.filter(f => fillAccess(relation(data, person, patientOf(data, f.fill_id), ms(at)), f.fill_id) !== null).map(f => f.fill_id);

function dependsOn(event, actions) {
  const values = new Set(JSON.stringify(event.payload).match(/"[^"]*"/g).map(x => JSON.parse(x)));
  const direct = actions.filter(a => a.made.some(id => values.has(id)) || values.has(a.step.args.fill_id) || (a.step.args.plan_request_id && values.has(a.step.args.plan_request_id)));
  return (direct.length ? direct : actions).map(a => a.step.id);
}

function scenario(data, at, later, files) {
  const made = createdBy(files);
  const seen = project(data, at);
  const open = seen.fills.filter(f => !TERMINAL.includes(f.state));
  const fills = new Set(open.map(f => f.fill_id));
  const requests = new Map(files.full.plan_requests.map(r => [r.plan_request_id, r.fill_id]));
  const target = s => fills.has(s.args.fill_id) ? s.args.fill_id : fills.has(requests.get(s.args.plan_request_id)) ? requests.get(s.args.plan_request_id) : null;
  const actions = later.filter(s => s.by !== 'infra' && target(s));
  const none = play(data, later, new Set(), made);
  const owner = play(data, later, new Set(actions.filter(s => s.by === OWNER).map(s => s.id)), made);
  const household = play(data, later, new Set(actions.map(s => s.id)), made);
  const ends = [none, owner, household].map(r => project(r.state, lib.END));
  const result = (end, id) => outcome(end.fills.find(x => x.fill_id === id));
  const unconditional = new Set(none.script.map(x => x.step.id));
  const visible = new Set(visibleTo(data, OWNER, at));
  const taken = [];
  const script = owner.script.map(x => {
    if (x.kind === 'action') {
      taken.push({ step: x.step, made: x.made });
      return { kind: 'action', id: x.step.id, at: x.step.at, by: x.step.by, tool: x.step.tool, args: x.step.args };
    }
    const entry = { kind: 'event', event: lib.envelope(x.step) };
    if (!unconditional.has(x.step.id)) entry.after = dependsOn(x.step, taken);
    return entry;
  });
  return {
    account_holder: { person_id: OWNER, visible_fills: [...visible], visible_open_fills: open.filter(f => visible.has(f.fill_id)).map(f => f.fill_id) },
    events: none.script.map(x => lib.envelope(x.step)),
    account_holder_script: script,
    conditional_events: script.filter(x => x.kind === 'event' && x.after).map(x => ({ after: x.after, event: x.event })),
    open_fills: open.map(f => {
      const id = f.fill_id, recorded = outcome(files.full.fills.find(x => x.fill_id === id));
      const [a, b, c] = ends.map(end => result(end, id));
      return {
        fill_id: id, patient_id: patientOf(data, id), status: f.state, on_hold: f.hold !== null, visible_to_account_holder: visible.has(id),
        after_staged_events: a, with_account_holder_actions: b, with_household_actions: c, in_dataset: recorded,
        completed_by_staged_events: a === recorded, completed_with_account_holder_actions: b === recorded, completed_with_household_actions: c === recorded,
        actions: actions.filter(s => target(s) === id).map(s => ({
          id: s.id, at: s.at, by: s.by, tool: s.tool, account_holder: s.by === OWNER,
          with_account_holder_actions: s.by === OWNER ? owner.results.get(s.id) : 'not taken: needs ' + s.by,
          with_household_actions: household.results.get(s.id),
        })),
      };
    }),
  };
}

function bundle(data, at, applied, withheld, timers, files) {
  const declared = lib.read('contribution/dataset.json'), bytes = lib.bytesOf(files);
  const sources = ['delivery-dataset', ...labelSources(declared)];
  return {
    dataset: {
      schema_version: declared.schema_version,
      dataset_id: data.seed_id,
      version: declared.version,
      description: 'As-of selection of the Mendwell delivery dataset ' + lib.SEED_IDS.full + ' at ' + at + ': the household, the catalog as it stood at that instant (store stock included) and every record dated before it. The pharmacy records are synthetic; the drug facts are paraphrases of the cited DailyMed labels. Fills still open at that instant have only the history they had then (see open_fills in the selection).',
      record_source_ids: sources,
      sources: declared.sources.filter(s => sources.includes(s.source_id)),
      transformations: ['Replayed the ' + applied + ' steps of ' + lib.FILES.replay + ' (sha256 ' + lib.digestOf(bytes[lib.FILES.replay]) + ') dated before ' + at + ' over ' + lib.FILES.base + ' (sha256 ' + lib.digestOf(bytes[lib.FILES.base]) + ') through the App handlers, then committed the ' + timers + ' timers due before that instant as the App\'s next write would; the ' + withheld + ' later steps are withheld.'],
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
  const timers = applyDueTimers(data, toIso(ms(at) - 1));
  data.seed_id = selectionId(data, at);
  lib.validate(data, at);
  const later = files.replay.steps.slice(applied);
  const { open_fills, events, account_holder, account_holder_script, conditional_events } = scenario(data, at, later, files);
  return {
    schema: 'mendwell-pharmacy.as-of.v1',
    dataset_id: files.replay.dataset_id,
    as_of: at,
    virtual_now: at,
    steps_applied: applied,
    steps_withheld: later.length,
    timers_committed: timers.map(t => ({ kind: t.kind, fill_id: t.fill_id, at: t.at })),
    summary: lib.summarize(data),
    data,
    account_holder,
    open_fills,
    events,
    account_holder_script,
    conditional_events,
    bundle: bundle(data, at, applied, later.length, timers.length, files),
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
  const { data, events, account_holder_script: script, conditional_events: conditional, bundle: b, ...head } = selection;
  const brief = { ...head, seed_id: data.seed_id, counters: data.issued || {}, staged_events: events.length, account_holder_script_steps: script.length, conditional_events: conditional.length };
  const out = option('--out');
  if (out) {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, lib.pretty(selection));
    console.log(JSON.stringify({ ...brief, out }));
  } else if (argv.includes('--summary')) console.log(lib.pretty(brief).trimEnd());
  else process.stdout.write(lib.pretty(selection));
}

if (require.main === module) main();
module.exports = { asOf, compact, selectionId, stageable, visibleTo, TERMINAL, OWNER };
