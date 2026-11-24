#!/usr/bin/env node
'use strict';
// Walkthrough on the public runtime with Notes 1.0.0 and Calendar 1.3.0 beside Platewright. There is
// no App-to-App channel: the Agent connection reads a recipe kept as a note (notes.get), saves it in
// Platewright (platewright.recipes.create), plans it, and adds the dinner to the calendar
// (calendar.create). The report shows each record with its version and that Platewright's state is
// not touched by the Notes and Calendar calls.
//   node scripts/notes-calendar-walkthrough.cjs [--runtime DIR] [--notes DIR] [--calendar DIR] [--output FILE]
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const locate = require('./locate.cjs');

const NOW = '2026-11-08T08:00:00-05:00';
const NOTE = {
  id: 'note-lentil-soup', account_id: 'notes-nora', created_at: '2026-10-02T19:00:00-04:00', updated_at: '2026-10-02T19:00:00-04:00',
  history: [{at: '2026-10-02T19:00:00-04:00', action: 'seeded'}],
  title: 'Lemony lentil and spinach soup (from the Saturday class)',
  body: 'Serves 4. 200 g red lentils, 1 onion, 2 garlic cloves, 1 l vegetable stock, 100 g baby spinach, 1 lemon.\n' +
    'Soften the onion and garlic. Add the lentils and stock and simmer 20 minutes. Stir in the spinach and the lemon juice.',
  tags: ['recipes'], pinned: false, archived: false, trashed: false, attachments: [], revisions: []
};
// What the Agent carries from the note into Platewright's structured form.
const RECIPE = {title: 'Lemony lentil and spinach soup', servings: 4, method_tags: ['simmer'], tags: ['soup', 'vegan'], active_minutes: 10, total_minutes: 30,
  lines: [{ingredient_id: 'ing-lentils-red', quantity: 200, unit: 'g'}, {ingredient_id: 'ing-onion', quantity: 1, unit: 'each'},
    {ingredient_id: 'ing-garlic', quantity: 2, unit: 'each'}, {ingredient_id: 'ing-veg-stock', quantity: 1, unit: 'l'},
    {ingredient_id: 'ing-spinach', quantity: 100, unit: 'g'}, {ingredient_id: 'ing-lemon', quantity: 1, unit: 'each'}],
  steps: ['Soften the onion and garlic.', 'Add the lentils and stock and simmer for 20 minutes.', 'Stir in the spinach and the lemon juice.']};

async function run() {
  const runtime = locate.runtimeDir();
  const {prepare} = require(path.join(runtime, 'prepare.cjs')), {Client} = require(path.join(runtime, 'client.cjs'));
  const notesDir = locate.packageOf('notes', 'apps/notes'), calendarDir = locate.packageOf('calendar', 'examples/apps/calendar');
  const prepared = prepare(locate.packageDir, [notesDir, calendarDir]), clients = [], checks = [], records = {};
  const check = (name, cond, detail) => { assert.ok(cond, name + (detail !== undefined ? ': ' + JSON.stringify(detail).slice(0, 600) : '')); checks.push({name, status: 'passed'}); };
  const open = async (app, role) => {
    const c = new Client(app, role, 'walkthrough', path.join(prepared.root, 'state'), 'platewright-walkthrough', {registry: prepared.registry});
    clients.push(c); await c.initialize(); return c;
  };
  try {
    const binding = JSON.parse(fs.readFileSync(path.join(locate.packageDir, 'fixtures/binding.json'), 'utf8'));
    binding.accounts.push({app_id: 'notes', account_id: 'notes-nora', owner_person_id: 'person-nora'}, {app_id: 'calendar', account_id: 'calendar-nora', owner_person_id: 'person-nora'});
    const infra = {}, agent = {};
    for (const app of ['platewright', 'notes', 'calendar']) {
      infra[app] = await open(app, 'infra');
      let s = await infra[app].call('env.snapshot');
      check(app + ': sandbox profile', (await infra[app].call('env.reset', {expected_version: s.version, profile: 'sandbox'})).status === 'ready');
      s = await infra[app].call('env.snapshot');
      const data = app === 'notes' ? {account_id: 'notes-nora', owner_person_id: 'person-nora', notes: [NOTE]}
        : app === 'calendar' ? {account_id: 'calendar-nora', owner_person_id: 'person-nora', calendar_id: 'cal-home', timezone: 'America/New_York', events: []}
        : s.snapshot.data;
      const loaded = await infra[app].call('env.load_seed', {expected_version: s.version, request_id: 'walkthrough-' + app, data, binding, virtual_now: NOW});
      check(app + ': Infra loads the account for person-nora at ' + NOW, loaded.status === 'ready', loaded);
      agent[app] = await open(app, 'agent');
    }
    const pwBefore = await infra.platewright.call('env.snapshot');
    // 1. Read the recipe kept as a note.
    const note = await agent.notes.call('notes.get', {id: NOTE.id});
    check('notes.get returns the recipe note', note.status === 'ok' && note.item.body.includes('200 g red lentils'), note);
    records.notes_read = {id: note.item.id, title: note.item.title, version: note.version};
    const pwAfterNotes = await infra.platewright.call('env.snapshot');
    check('Platewright state is unchanged by the Notes call', JSON.stringify(pwAfterNotes.snapshot.data) === JSON.stringify(pwBefore.snapshot.data) && JSON.stringify(pwAfterNotes.version) === JSON.stringify(pwBefore.version));
    // 2. Save it in Platewright and plan it.
    const saved = await agent.platewright.call('platewright.recipes.create', {...RECIPE, request_id: 'carry-note-1', expected_version: pwAfterNotes.version});
    check('platewright.recipes.create commits the carried recipe', saved.status === 'committed' && saved.state === 'active' && saved.revision === 1, saved);
    const checked = await agent.platewright.call('platewright.recipes.check', {id: saved.id, date: '2026-11-11'});
    check('The saved soup is checked for the household like any recipe', checked.status === 'ok' && checked.verdicts.length === 4, checked);
    const planned = await agent.platewright.call('platewright.plan.slot.set', {id: '2026-11-11:dinner', dishes: [{recipe_id: saved.id}], request_id: 'carry-note-2', expected_version: saved.version});
    check('The soup is planned for Wednesday dinner', planned.status === 'committed' && planned.state === 'planned', planned);
    records.platewright_recipe = {id: saved.id, version: saved.version, verdicts: checked.verdicts.map(v => ({id: v.id, verdict: v.verdict}))};
    records.platewright_slot = {id: planned.id, version: planned.version, default_servings: planned.default_servings};
    const pwMid = await infra.platewright.call('env.snapshot');
    // 3. Add the dinner to the calendar.
    const calVersion = (await infra.calendar.call('env.snapshot')).version;
    const event = await agent.calendar.call('calendar.create', {title: 'Dinner: ' + RECIPE.title, start: '2026-11-11T18:30:00-05:00', end: '2026-11-11T19:30:00-05:00',
      timezone: 'America/New_York', location: 'Home', request_id: 'carry-note-3', expected_version: calVersion});
    check('calendar.create commits the dinner event', event.status === 'committed' && typeof event.id === 'string', event);
    const stored = await agent.calendar.call('calendar.get', {id: event.id});
    check('The calendar event is stored with the planned time', stored.status === 'ok' && stored.event.start === '2026-11-11T18:30:00-05:00', stored);
    records.calendar_event = {id: event.id, version: event.version, start: stored.event.start, title: stored.event.title};
    const pwAfter = await infra.platewright.call('env.snapshot');
    check('Platewright state is unchanged by the Calendar calls', JSON.stringify(pwAfter.snapshot.data) === JSON.stringify(pwMid.snapshot.data) && JSON.stringify(pwAfter.version) === JSON.stringify(pwMid.version));
    const notesAfter = (await infra.notes.call('env.snapshot')).snapshot;
    check('Notes state is unchanged: the note was read, not moved', JSON.stringify(notesAfter.data.notes) === JSON.stringify([NOTE]));
    check('Platewright recorded only its own two writes after the seed\'s events', pwAfter.snapshot.data.activity.slice(pwBefore.snapshot.data.activity.length).map(a => a.action).join() === 'recipes.create,plan.slot.set');
    return {schema: 'platewright.notes-calendar-walkthrough.v1', runtime_version: require(path.join(runtime, 'package.json')).version, node: process.version,
      apps: {platewright: '1.0.0', notes: JSON.parse(fs.readFileSync(path.join(notesDir, 'app.json'))).version, calendar: JSON.parse(fs.readFileSync(path.join(calendarDir, 'app.json'))).version},
      passed: true, records, checks};
  } catch (e) {
    return {schema: 'platewright.notes-calendar-walkthrough.v1', node: process.version, passed: false, error: e.message, records, checks};
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    prepared.cleanup();
  }
}
if (require.main === module) {
  run().then(report => {
    const text = JSON.stringify(report, null, 2) + '\n', out = locate.option('output');
    if (out) fs.writeFileSync(out, text);
    process.stdout.write(text);
    if (!report.passed) process.exitCode = 1;
  });
}
module.exports = {run};
