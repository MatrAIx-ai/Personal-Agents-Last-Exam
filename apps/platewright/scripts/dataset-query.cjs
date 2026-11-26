#!/usr/bin/env node
'use strict';
// Loading and retrieval demonstration for the dataset coverage report: starts Platewright on the
// pinned public runtime with its reference seed (a fresh run loads fixtures/reference.json at the
// time in fixtures/clock.json), reads every counted record family back through the Agent's MCP
// tools (activity rows through Infra's env.snapshot, the only reader of that evaluator record), and
// compares what came back with evidence/dataset-coverage.json. The report holds no wall-clock time,
// so it is the same on every run.
//   node scripts/dataset-query.cjs [--runtime DIR] [--output FILE]   (default: evidence/dataset-query.json)
const fs = require('node:fs'), path = require('node:path');
const locate = require('./locate.cjs');
const P = 'platewright.';

const addDays = (date, n) => { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function run() {
  const runtime = locate.runtimeDir();
  const {prepare} = require(path.join(runtime, 'prepare.cjs')), {Client} = require(path.join(runtime, 'client.cjs'));
  const coverage = JSON.parse(fs.readFileSync(path.join(locate.packageDir, 'evidence/dataset-coverage.json'), 'utf8'));
  const expected = Object.fromEntries(coverage.sources.map(s => [s.family, s]));
  const prepared = prepare(locate.packageDir), clients = [];
  const open = async role => { const c = new Client('platewright', role, 'dataset-query', path.join(prepared.root, 'state'), 'platewright-dataset-query', {registry: prepared.registry}); clients.push(c); await c.initialize(); return c; };
  const families = [];
  const family = (name, tool, calls, sample, records, rows) => {
    const e = expected[name];
    families.push({family: name, tool, calls, sample, records_retrieved: records, rows_retrieved: rows, records_in_report: name === 'activity' ? null : e.records, rows_in_report: e.dated_rows,
      matches: (name === 'activity' || records === e.records) && rows === e.dated_rows});
  };
  try {
    const infra = await open('infra'), agent = await open('agent');
    const snap = await infra.call('env.snapshot');
    const loaded = {version: snap.version, virtual_now: snap.virtual_now ?? snap.snapshot.virtual_now ?? null, profile: snap.profile ?? snap.snapshot.profile ?? null};
    // Plan slots, in windows of 42 days (the longest plan.get allows) over the whole coverage window.
    const slots = new Map(); let calls = 0, sample = null;
    for (let start = coverage.window.start; start <= coverage.window.end; start = addDays(start, 42)) {
      const end = addDays(start, 41) > coverage.window.end ? coverage.window.end : addDays(start, 41);
      const r = await agent.call(P + 'plan.get', {start, end}); calls++;
      if (r.status !== 'ok') throw new Error('plan.get ' + start + ': ' + r.status);
      if (!sample) sample = {arguments: {start, end}, status: r.status, slots: r.slots.length, first: r.slots[0] && {id: r.slots[0].id, state: r.slots[0].state, dishes: r.slots[0].dishes.length}};
      for (const s of r.slots) slots.set(s.id, s);
    }
    const slotList = [...slots.values()];
    family('plan_slots', P + 'plan.get', calls, sample, slotList.length, slotList.length);
    family('plan_slot_history', P + 'plan.get', 0, {note: 'the same calls; each slot carries its history'}, slotList.length, slotList.reduce((n, s) => n + s.history.length, 0));
    // Recipes: listed by recipes.search (archived included), each read with recipes.get for its history.
    const ids = []; let offset = 0, searches = 0, first = null;
    for (;;) {
      const r = await agent.call(P + 'recipes.search', {include_archived: true, limit: 100, offset}); searches++;
      if (!first) first = {arguments: {include_archived: true, limit: 100, offset: 0}, status: r.status, total: r.total, items: r.items.length};
      ids.push(...r.items.map(x => x.id));
      if (r.next_offset == null) break; offset = r.next_offset;
    }
    let recipeRows = 0;
    for (const id of ids) { const r = await agent.call(P + 'recipes.get', {id}); if (r.status !== 'ok') throw new Error('recipes.get ' + id); recipeRows += r.recipe.history.length; }
    family('recipe_history', P + 'recipes.search + ' + P + 'recipes.get', searches + ids.length, first, ids.length, recipeRows);
    const household = await agent.call(P + 'household.get', {});
    const constraints = household.members.flatMap(m => m.constraints);
    family('constraint_history', P + 'household.get', 1, {arguments: {}, status: household.status, members: household.members.length, constraints: constraints.length},
      constraints.length, constraints.reduce((n, c) => n + c.history.length, 0));
    const pantry = await agent.call(P + 'pantry.list', {include_out: true});
    family('pantry_history', P + 'pantry.list', 1, {arguments: {include_out: true}, status: pantry.status, items: pantry.items.length},
      pantry.items.length, pantry.items.reduce((n, i) => n + i.history.length, 0));
    const shopping = await agent.call(P + 'shopping.get', {});
    family('shopping_line_history', P + 'shopping.get', 1, {arguments: {}, status: shopping.status, lines: shopping.list.lines.length, window: [shopping.list.start, shopping.list.end]},
      shopping.list.lines.length, shopping.list.lines.reduce((n, l) => n + l.history.length, 0));
    const notes = await agent.call(P + 'notifications.list', {});
    family('notifications', P + 'notifications.list', 1, {arguments: {}, status: notes.status, notifications: notes.notifications.length,
      first: notes.notifications[0] && {at: notes.notifications[0].at, title: notes.notifications[0].title}}, notes.notifications.length, notes.notifications.length);
    const activity = snap.snapshot.data.activity;
    family('activity', 'env.snapshot (Infra)', 1, {arguments: {}, rows: activity.length}, null, activity.length);
    // Retrieved dates agree with the report: the earliest and latest plan slot and the count per year.
    const dates = slotList.map(s => s.date).sort();
    const perYear = {}; for (const d of dates) perYear[d.slice(0, 4)] = (perYear[d.slice(0, 4)] || 0) + 1;
    return {schema: 'platewright.dataset-query.v1', runtime_version: require(path.join(runtime, 'package.json')).version, app_version: require('../app.json').version,
      seed: coverage.seed, loaded, coverage_report: 'evidence/dataset-coverage.json',
      passed: families.every(f => f.matches), families,
      plan_slots_retrieved: {earliest: dates[0], latest: dates.at(-1), per_year: perYear}};
  } catch (e) {
    return {schema: 'platewright.dataset-query.v1', passed: false, error: e.message, families};
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    prepared.cleanup();
  }
}
if (require.main === module) {
  run().then(report => {
    const text = JSON.stringify(report, null, 2) + '\n', out = locate.option('output') || path.join(locate.packageDir, 'evidence/dataset-query.json');
    fs.writeFileSync(out, text);
    process.stdout.write(JSON.stringify({passed: report.passed, families: report.families.map(f => [f.family, f.records_retrieved, f.rows_retrieved, f.matches]), error: report.error}) + '\n');
    if (!report.passed) process.exitCode = 1;
  });
}
module.exports = {run};
