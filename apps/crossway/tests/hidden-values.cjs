#!/usr/bin/env node
'use strict';
// Check (e), hidden values, through real Core over MCP. Each seed's example
// schedule is given sentinel strings in its pending payloads (event IDs, new
// toll IDs, an extra decision-table entry). Before every event, all ten read
// tools are called (notices.get and disputes.get for every notice and dispute)
// and every Agent-visible output so far, the reference actions' write outputs
// included, is searched: no sentinel of an event that has not fired may appear.
// Once an event fires, its toll ID must appear in tolls.list (so the search can
// see what it looks for), and event IDs and decision tables never appear. The
// page and controller files served by the Web Host carry no sentinel either;
// tests/web-checks.cjs searches the rendered pages.
// Run from a full checkout: node apps/crossway/tests/hidden-values.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {platform, loadSeed, session, ACTIONS, sentinelSchedule, SEEDS} = require('./platform-lib.cjs');

async function everyRead(s) {
  const before = s.outputs.length;
  await s.read('account.get');
  await s.read('account.statements');
  await s.read('vehicles.list');
  await s.read('transponders.list');
  await s.read('tolls.list', {limit: 500});
  const notices = (await s.read('notices.list')).notices;
  for (const n of notices) await s.read('notices.get', {notice_id: n.id});
  for (const n of notices.filter(x => x.dispute_id)) await s.read('disputes.get', {dispute_id: n.dispute_id});
  await s.read('disputes.reasons');
  await s.read('policies.get');
  return s.outputs.length - before;
}

async function main() {
  const p = await platform(), summary = {};
  const files = ['gui/index.html', 'gui/src/app.js'].map(f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')).join('\n');
  assert.ok(!files.includes('SNTL'), 'the served page files carry no sentinel');
  try {
    for (const {seed_id: id} of SEEDS) {
      const infra = await p.open('infra', 'hidden-' + id), agent = await p.open('agent', 'hidden-' + id);
      await loadSeed(infra, id, 'full');
      const s = session(agent, infra, 'hidden-' + id);
      const schedule = sentinelSchedule(id), actions = [...ACTIONS[id]];
      const discovery = JSON.stringify((await agent.request('tools/list')).result);
      let reads = 0;
      const search = (pending, fired) => {
        const text = discovery + JSON.stringify(s.outputs);
        for (const x of pending) assert.ok(!text.includes(x), `${id}: pending sentinel ${x} is visible`);
        for (const x of fired) assert.ok(!text.includes(x), `${id}: hidden sentinel ${x} is visible`);
      };
      const hiddenFired = [];
      for (const [k, item] of schedule.entries()) {
        // Reference actions due before this event run first, at their own times.
        while (actions.length && Date.parse(actions[0].at) <= Date.parse(item.event.at)) {
          const a = actions.shift();
          if (Date.parse(a.at) > Date.parse((await infra.call('env.snapshot')).snapshot.virtual_now)) await s.advance(a.at);
          await a.run(s);
        }
        reads += await everyRead(s);
        // Pending: this event and every later one. A sentinel string can appear
        // only from its own event, so the whole output history is searched.
        search(schedule.slice(k).flatMap(x => x.all), hiddenFired);
        await s.event(item.event);
        hiddenFired.push(...item.hidden);
        const tolls = JSON.stringify(await s.read('tolls.list', {limit: 500}));
        for (const x of item.surfaces) assert.ok(tolls.includes(x), `${id}: fired toll ${x} is not in tolls.list`);
      }
      for (const a of actions) { await s.advance(a.at); await a.run(s); }
      reads += await everyRead(s);
      search([], hiddenFired);
      summary[id] = {events: schedule.length, sentinels: schedule.flatMap(x => x.all).length, agent_outputs_searched: s.outputs.length, read_calls: reads};
      await infra.close();
      await agent.close();
    }
    console.log(JSON.stringify({app: 'crossway', check: '(e) hidden values', seeds: summary, passed: true}, null, 2));
  } finally {
    await p.close();
  }
}
main().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
