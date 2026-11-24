#!/usr/bin/env node
'use strict';
// Checks (d) and (e) over the three fixtures and their default schedules.
// Run from a full checkout: node apps/switchback/tests/schedule-checks.cjs
//
// (d) Replay, through real Core with separate Infra and Agent MCP connections:
//     each schedule is applied once with the clock jumping straight to each
//     event (env.apply_event moves it) and one env.advance_time jump to the
//     end, and once in small env.advance_time steps with Agent reads between
//     them. Both runs must end with the same state hash and the same notices.
// (e) Hidden values, App-only through the tool handlers: an observer reads the
//     Agent tools on a fixed probe grid. No output contains a scheduled value
//     (alert, closure, update or check-in, or a claimed night shown booked)
//     before its event fires, and a copy of the fixture that differs only in
//     the evaluator-side claim-times file gives the identical trace until the
//     first claim whose time differs. The page files contain none of these values.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const app = path.join(root, 'apps/switchback');
const {prepare} = require(path.join(root, 'runtime/prepare.cjs'));
const {Client} = require(path.join(root, 'runtime/client.cjs'));
const plugin = require('../plugin.cjs');
const generator = require('../fixtures/generate.cjs');
const {READS} = require('../src/operations.cjs');
const {settle} = require('../src/settle.cjs');

const FIXTURES = ['minimal', 'high-country', 'desert-rivers'];
const load = rel => JSON.parse(fs.readFileSync(path.join(app, rel), 'utf8'));
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
const sha = value => crypto.createHash('sha256').update(canonical(value)).digest('hex');
const HOUR = 3600 * 1000;
const isoZ = t => new Date(t).toISOString().replace('.000Z', 'Z');

// ---- (d) Replay through real Core ----------------------------------------------

async function replay(prepared, name, mode) {
  const stateDir = path.join(prepared.root, 'state'), run = `replay-${mode}-${name}`, clients = [];
  const open = async role => { const c = new Client(prepared.app, role, run, stateDir, 'switchback-schedule-checks', {registry: prepared.registry}); clients.push(c); await c.initialize(); return c; };
  try {
    const infra = await open('infra'), agent = await open('agent');
    const seed = load(`fixtures/${name}.json`), schedule = load(`fixtures/schedules/${name}.json`);
    let v = (await infra.call('env.snapshot')).version, n = 0, reads = 0, advances = 0;
    const loaded = await infra.call('env.load_seed', {expected_version: v, data: seed, virtual_now: schedule.initial_time, request_id: 'load-' + name});
    assert.equal(loaded.status, 'ready', JSON.stringify(loaded).slice(0, 300));
    v = (await infra.call('env.snapshot')).version;
    const advance = async t => {
      const out = await infra.call('env.advance_time', {expected_version: v, request_id: `clock-${++n}`, virtual_now: isoZ(t)});
      assert.equal(out.status, 'committed', JSON.stringify(out)); v = out.version; advances++;
    };
    const read = async () => {
      const out = await agent.call('switchback.reservations.list', {});
      assert.equal(out.status, 'ok'); reads++;
    };
    let now = Date.parse(schedule.initial_time);
    const end = Date.parse(schedule.end_time);
    const stepTo = async target => {
      // Small steps: six hours at a time, with an Agent read after every fourth step.
      while (now + 6 * HOUR < target) { now += 6 * HOUR; await advance(now); if (advances % 4 === 0) await read(); }
    };
    for (const e of schedule.events) {
      if (mode === 'steps') await stepTo(Date.parse(e.at));
      const out = await infra.call('env.apply_event', {expected_version: v, event: e});
      assert.equal(out.status, 'committed', `${e.event_id}: ${JSON.stringify(out)}`);
      v = out.version; now = Date.parse(e.at);
    }
    if (mode === 'steps') await stepTo(end);
    await advance(end);  // the jump run's one jump; the last small step in the step run
    const final = await infra.call('env.snapshot');
    const view = await agent.call('switchback.reservations.list', {});
    return {hash: sha(final.snapshot.data), notices: final.snapshot.data.notices, view: view.reservations,
      virtual_now: final.snapshot.virtual_now, events: schedule.events.length, advances, reads};
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
  }
}

async function checkD() {
  const prepared = prepare(app), out = [];
  try {
    for (const name of FIXTURES) {
      const jump = await replay(prepared, name, 'jump'), steps = await replay(prepared, name, 'steps');
      assert.equal(steps.hash, jump.hash, name + ': state hash');
      assert.deepEqual(steps.notices, jump.notices, name + ': notices');
      assert.deepEqual(steps.view, jump.view, name + ': Agent view at the end');
      assert.equal(Date.parse(steps.virtual_now), Date.parse(jump.virtual_now));
      assert.ok(jump.notices.length > 0);
      out.push({fixture: name, events: jump.events, jump_advances: jump.advances, step_advances: steps.advances, step_reads: steps.reads,
        notices: jump.notices.length, state_sha256: jump.hash});
    }
  } finally {
    prepared.cleanup();
  }
  return out;
}

// ---- (e) Hidden values ------------------------------------------------------------

// Strings that only exist once an event has fired.
function markers(e) {
  const p = e.payload;
  switch (e.operation) {
    case 'switchback.alert.posted': return [p.alert_id, p.text];
    case 'switchback.alert.updated': return p.text ? [p.text] : [];
    case 'switchback.alert.cancelled': return [`"cancelled_at":"${e.at}"`];
    case 'switchback.closure.ordered': return [p.closure_id, p.reason];
    case 'switchback.reservation.checked_in': return [`{"at":"${e.at}","action":"checked_in"}`];
    default: return [];
  }
}

const binding = load('fixtures/binding.json');

// The observer: the same reads on a fixed grid, whatever the schedule holds.
function trace(name, schedule, probeSites) {
  let data = structuredClone(load(`fixtures/${name}.json`));
  const ctx = now => ({app_id: 'switchback', role: 'agent', virtual_now: now, binding});
  const start = Date.parse(schedule.initial_time), end = Date.parse(schedule.end_time), out = [];
  const pending = [...schedule.events];
  for (let t = start; t <= end; t += 12 * HOUR) {
    while (pending.length && Date.parse(pending[0].at) <= t) {
      const e = pending.shift();
      data = plugin.applyEvent({...ctx(e.at), role: 'infra'}, data, structuredClone(e));
      plugin.validateSeed(ctx(e.at), data);
    }
    // handleTool settles a copy of the data for every read; the observer settles
    // once per probe and calls the same read functions. The first probe compares
    // both paths to show the outputs are the tools' outputs.
    const now = isoZ(t), view = settle({...ctx(now), log: undefined}, structuredClone(data));
    const reads = [['alerts.list', {}], ['reservations.list', {}], ['facilities.search', {}],
      ...probeSites.map(c => ['sites.get', {site_id: c.site_id, arrival: c.nights[0], departure: c.departure}])];
    const outputs = reads.map(([tool, args]) => ({tool, args, text: JSON.stringify(READS[tool](view, args, t))}));
    if (t === start) for (const [i, [tool, args]] of reads.entries()) assert.equal(JSON.stringify(plugin.handleTool(ctx(now), data, 'switchback.' + tool, args).result), outputs[i].text);
    out.push({t, outputs});
  }
  return out;
}

function claimIndex(e) {
  return Number(e.event_id.split('-').at(-1)) - 1;
}

function checkE() {
  const pages = ['gui/index.html', 'gui/src/app.js'].map(f => fs.readFileSync(path.join(app, f), 'utf8')).join('\n');
  const {templates} = generator.templates(), out = [];
  for (const name of FIXTURES) {
    const schedule = load(`fixtures/schedules/${name}.json`), template = templates[name];
    const addDays = (d, k) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
    const claims = schedule.events.filter(e => e.operation === 'switchback.inventory.claimed');
    const probeSites = claims.map(e => ({site_id: e.payload.site_id, nights: e.payload.nights, departure: addDays(e.payload.nights.at(-1), 1)}));
    // Copies that differ only in the evaluator-side file: one with every claim at
    // another instant in its window, and four that each move one late claim.
    const rand = generator.rng(0x5eed + name.length), own = load(`fixtures/evaluator/${name}.claim-times.json`).times;
    const redrawn = generator.drawTimes(template, n => Math.floor(rand() * (n + 1)));
    const late = [...claims].sort((a, b) => generator.claimWindow(template, template.claims[claimIndex(b)])[1] - generator.claimWindow(template, template.claims[claimIndex(a)])[1]).slice(0, 4);
    const variants = [['every claim redrawn', redrawn], ...late.map(e => [`${e.event_id} redrawn`, {...own, [e.event_id]: redrawn[e.event_id]}])]
      .map(([label, times]) => [label, generator.schedule(template, times)]);
    for (const [, alt] of variants) {
      assert.deepEqual(alt.events.map(e => ({...e, at: null})).sort((a, b) => a.event_id.localeCompare(b.event_id)),
        schedule.events.map(e => ({...e, at: null})).sort((a, b) => a.event_id.localeCompare(b.event_id)), 'only claim times differ');
    }
    const A = trace(name, schedule, probeSites);
    let checked = 0;
    for (const e of schedule.events) {
      const at = Date.parse(e.at), list = markers(e);
      for (const m of list) assert.ok(!pages.includes(m), `${name}: page source contains ${m}`);
      for (const probe of A) {
        const text = probe.outputs.map(o => o.text).join('\n');
        if (probe.t < at) {
          for (const m of list) { assert.ok(!text.includes(m), `${name}: ${e.event_id} visible before it fires: ${m}`); checked++; }
          if (e.operation === 'switchback.inventory.claimed') {
            const o = probe.outputs.find(x => x.tool === 'sites.get' && x.args.site_id === e.payload.site_id && x.args.arrival === e.payload.nights[0]);
            const states = JSON.parse(o.text).nights.filter(n => e.payload.nights.includes(n.date)).map(n => n.state);
            assert.ok(!states.includes('booked'), `${name}: ${e.event_id} nights booked before the claim`); checked++;
          }
        }
      }
      // Not vacuous: every marker shows up once its event has fired.
      for (const m of list) assert.ok(A.some(p => p.t >= at && p.outputs.some(o => o.text.includes(m))), `${name}: ${e.event_id} never visible: ${m}`);
    }
    // Identical agent-visible traces until the first claim whose time differs.
    const compared = variants.map(([label, alt]) => {
      const B = trace(name, alt, probeSites), altAt = Object.fromEntries(alt.events.map(e => [e.event_id, Date.parse(e.at)]));
      const first = Math.min(...claims.filter(e => Date.parse(e.at) !== altAt[e.event_id]).map(e => Math.min(Date.parse(e.at), altAt[e.event_id])));
      let same = 0;
      for (let i = 0; i < A.length && A[i].t < first; i++) { assert.deepEqual(B[i], A[i], `${name}, ${label}: trace differs at probe ${i}`); same++; }
      assert.ok(same > 0, `${name}, ${label}: at least one probe before the first differing claim`);
      const differs = A.findIndex((p, i) => JSON.stringify(p) !== JSON.stringify(B[i]));
      return {variant: label, first_differing_claim_at: isoZ(first), identical_probes_before_it: same, first_probe_that_differs: differs === -1 ? null : differs};
    });
    out.push({fixture: name, probes: A.length, reads_per_probe: A[0].outputs.length, hidden_value_assertions: checked, variants: compared});
  }
  return out;
}

async function main() {
  const e = checkE();
  console.log(JSON.stringify({check: 'e', fixtures: e}, null, 2));
  const d = await checkD();
  console.log(JSON.stringify({check: 'd', fixtures: d}, null, 2));
  console.log(JSON.stringify({app: 'switchback', passed: ['(d) replay: jump and small steps give the same hash, notices and Agent view for all three schedules',
    '(e) no scheduled value is visible before its event; traces match until the first differing claim time; pages hold no scheduled value']}, null, 2));
}
main().catch(err => { console.error(err.stack || err.message); process.exitCode = 1; });
