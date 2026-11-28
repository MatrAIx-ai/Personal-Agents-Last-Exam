#!/usr/bin/env node
'use strict';
// Check (d), replay. For each seed, through real Core over MCP: the seed, its
// example schedule and the reference actions run twice with the clock moved by
// several env.advance_time steps, then once with one env.advance_time jump to
// each action time and to the end. All three give the same state hash, the same
// outbound notifications (the outgoing Mail messages) and the same reads at the
// end. The whole check runs in two host time zones (TZ), each in its own
// process with its own Core processes, and the digests must match.
// Run from a full checkout: node apps/crossway/tests/replay-checks.cjs
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const {sha, hash, platform, loadSeed, session, ACTIONS, SEEDS, seedFiles} = require('./platform-lib.cjs');
const C = require('../src/clock.cjs');

const ZONES = ['America/Los_Angeles', 'Asia/Kolkata'];
const END = {dani: '2027-02-15T09:00:00-05:00', marisol: '2026-05-20T09:00:00-04:00', theo: '2026-08-20T09:00:00-04:00', priya: '2027-03-01T09:00:00-05:00'};

// Clock stops strictly between two instants, so a step never lands on an event time.
function stops(from, to, count = 3) {
  const a = Date.parse(from), b = Date.parse(to), out = [];
  for (let i = 1; i <= count; i++) {
    const t = a + Math.floor((b - a) * i / (count + 1) / 60000) * 60000;
    if (t > a && t < b) out.push(C.stamp(t));
  }
  return out;
}

async function run(p, id, mode, runId) {
  const infra = await p.open('infra', runId), agent = await p.open('agent', runId);
  const {seed} = await loadSeed(infra, id, 'full');
  const s = session(agent, infra, runId);
  const items = [...ACTIONS[id].map(a => ({at: a.at, action: a})), ...seed.schedule.events.map(e => ({at: e.at, event: e}))]
    .sort((x, y) => Date.parse(x.at) - Date.parse(y.at) || (x.action ? -1 : 1));
  let now = seed.now;
  const move = async to => {
    if (mode === 'steps') for (const t of stops(now, to)) await s.advance(t);
    if (Date.parse(to) > Date.parse(now)) await s.advance(to);
    now = to;
  };
  for (const item of items) {
    if (item.action) {
      await move(item.at);
      await item.action.run(s);
    } else {
      if (mode === 'steps') for (const t of stops(now, item.at)) await s.advance(t);
      await s.event(item.event);
      now = item.at;
    }
  }
  await move(END[id]);
  const snapshot = (await infra.call('env.snapshot')).snapshot;
  const reads = {};
  for (const name of ['account.get', 'notices.list', 'account.statements', 'vehicles.list', 'transponders.list']) {
    const out = await agent.call('crossway.' + name, {});
    delete out.version;
    reads[name] = out;
  }
  await infra.close();
  await agent.close();
  return {state_sha256: hash(snapshot), outgoing_sha256: sha(snapshot.data.outgoing), outgoing: snapshot.data.outgoing.length,
    reads_sha256: sha(reads), virtual_now: snapshot.virtual_now, tolls: snapshot.data.tolls.length, notices: snapshot.data.notices.length};
}

async function child() {
  const p = await platform(), out = {tz: process.env.TZ, offset_minutes: new Date('2026-07-01T12:00:00Z').getTimezoneOffset(), seeds: {}};
  try {
    for (const {seed_id: id} of SEEDS) {
      const first = await run(p, id, 'steps', `${id}-steps-1`);
      const second = await run(p, id, 'steps', `${id}-steps-2`);
      const jump = await run(p, id, 'jump', `${id}-jump`);
      assert.deepEqual(second, first, `${id}: the same seed, schedule and actions twice`);
      assert.deepEqual(jump, first, `${id}: one env.advance_time jump instead of steps`);
      assert.equal(first.virtual_now, END[id]);
      out.seeds[id] = first;
    }
  } finally {
    await p.close();
  }
  process.stdout.write(JSON.stringify(out));
}

function parent() {
  const results = [];
  for (const tz of ZONES) {
    const r = spawnSync(process.execPath, [__filename, '--child'], {env: {...process.env, TZ: tz}, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 600000});
    if (r.status !== 0) throw Error(`TZ=${tz} failed:\n${r.stderr || r.stdout}`);
    results.push(JSON.parse(r.stdout));
  }
  assert.notEqual(results[0].offset_minutes, results[1].offset_minutes, 'the two host time zones differ');
  for (const {seed_id: id} of SEEDS) {
    assert.deepEqual(results[1].seeds[id], results[0].seeds[id], `${id}: identical in ${ZONES.join(' and ')}`);
    assert.ok(results[0].seeds[id].outgoing > 0, `${id}: the run produced Mail notices`);
    assert.ok(seedFiles(id).schedule.events.length > 0);
  }
  console.log(JSON.stringify({app: 'crossway', check: '(d) replay', time_zones: ZONES,
    runs_per_zone: SEEDS.length * 3, seeds: results[0].seeds, passed: true}, null, 2));
}

if (process.argv.includes('--child')) child().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
else {
  try { parent(); } catch (e) { console.error(e.stack || e.message); process.exitCode = 1; }
}
