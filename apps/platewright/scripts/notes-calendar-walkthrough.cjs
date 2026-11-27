#!/usr/bin/env node
'use strict';
// Walkthrough on the public runtime with Notes 1.0.0 and Calendar 1.3.0 beside Platewright. There is
// no App-to-App channel: the Agent connection reads a recipe kept as a note (notes.get), saves it in
// Platewright (platewright.recipes.create), plans it, and adds the dinner to the calendar
// (calendar.create). Each step is a separate Agent call to one App through that App's own tools.
// The transcript records the pinned versions and contracts, the account binding, every request and
// result with its request ID, each App's version and data hash after every step, and the failure
// paths: arguments the pinned Calendar contract does not accept, a stale version, a write whose
// response the caller did not receive (resolved by retrying with the same request ID), a repeated
// and a conflicting request ID, a policy that denies the write, Platewright running without Notes and
// Calendar, and a Calendar package of another version refused before any call.
//   node scripts/notes-calendar-walkthrough.cjs [--runtime DIR] [--notes DIR] [--calendar DIR] [--output FILE]
// With --output the transcript is written to FILE (evidence/notes-calendar-walkthrough.json in the
// package is the committed copy); it holds no wall-clock time or Node version, so it is the same on
// every run.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
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
const DINNER = {title: 'Dinner: ' + RECIPE.title, start: '2026-11-11T18:30:00-05:00', end: '2026-11-11T19:30:00-05:00', timezone: 'America/New_York', location: 'Home'};
// The pinned dependencies and the exact contracts the walkthrough uses: the version in app.json and
// the SHA-256 of each tool's input and output schema as published in the package's tools.json.
const PINS = {
  notes: {version: '1.0.0', relative: 'apps/notes', tools: {'notes.get': '14c36bfea7c370098c77b9fd4f1f6486f25ae8cede60dace135b665a67c677a1'}},
  calendar: {version: '1.3.0', relative: 'examples/apps/calendar', tools: {
    'calendar.create': '2766b94e57d0f0db30a2e82a1304b6e2c372498eb1c12fe42715aebc4be8599d', 'calendar.get': '05928b6305c5617d3c737886d09feeb87b05af3f1409aa6b33622acc74aba5ae'}}
};
const sha = x => crypto.createHash('sha256').update(typeof x === 'string' || Buffer.isBuffer(x) ? x : JSON.stringify(x)).digest('hex');

// Refuses a dependency whose version or contract is not the pinned one, before any call is made.
function pinned(app, dir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'app.json'), 'utf8')), pin = PINS[app];
  const listed = JSON.parse(fs.readFileSync(path.join(dir, manifest.tools), 'utf8')), tools = listed.tools || listed;
  const contracts = Object.fromEntries(Object.keys(pin.tools).map(name => { const t = tools.find(x => x.name === name); return [name, t ? sha({input: t.inputSchema, output: t.outputSchema}) : null]; }));
  const problems = [];
  if (manifest.version !== pin.version) problems.push(`${app} ${manifest.version} is not the pinned ${pin.version}`);
  for (const [name, hash] of Object.entries(contracts)) if (hash !== pin.tools[name]) problems.push(`${name} contract ${hash ? hash.slice(0, 12) : 'missing'} is not the pinned ${pin.tools[name].slice(0, 12)}`);
  return {app, version: manifest.version, contracts, compatible: !problems.length, problems};
}

async function run() {
  const runtime = locate.runtimeDir();
  const {prepare} = require(path.join(runtime, 'prepare.cjs')), {Client} = require(path.join(runtime, 'client.cjs')), {digestTree} = require(path.join(runtime, 'verify.cjs'));
  const notesDir = locate.packageOf('notes', PINS.notes.relative), calendarDir = locate.packageOf('calendar', PINS.calendar.relative);
  const checks = [], steps = [], records = {}, preparedAll = [], clients = [];
  const check = (name, cond, detail) => { assert.ok(cond, name + (detail !== undefined ? ': ' + JSON.stringify(detail).slice(0, 600) : '')); checks.push({name, status: 'passed'}); };
  const pins = {notes: pinned('notes', notesDir), calendar: pinned('calendar', calendarDir)};
  check('Notes and Calendar are the pinned versions with the pinned contracts', pins.notes.compatible && pins.calendar.compatible, pins);
  const platewrightTools = fs.readFileSync(path.join(locate.packageDir, 'tools.json'));
  const revisions = {
    runtime: require(path.join(runtime, 'package.json')).version,
    platewright: {version: require('../app.json').version, tools_json_sha256: sha(platewrightTools), contract: ['platewright.recipes.create', 'platewright.recipes.check', 'platewright.plan.slot.set']},
    notes: {version: pins.notes.version, package_sha256: digestTree(notesDir), contracts: pins.notes.contracts},
    calendar: {version: pins.calendar.version, package_sha256: digestTree(calendarDir), contracts: pins.calendar.contracts}
  };
  const binding = JSON.parse(fs.readFileSync(path.join(locate.packageDir, 'fixtures/binding.json'), 'utf8'));
  binding.accounts.push({app_id: 'notes', account_id: 'notes-nora', owner_person_id: 'person-nora'}, {app_id: 'calendar', account_id: 'calendar-nora', owner_person_id: 'person-nora'});

  // One run of the given Apps, each with its account for person-nora loaded at NOW.
  async function start(apps, runId, profiles = {}) {
    const prepared = prepare(locate.packageDir, apps.filter(a => a !== 'platewright').map(a => a === 'notes' ? notesDir : calendarDir));
    preparedAll.push(prepared);
    const open = async (app, role) => { const c = new Client(app, role, runId, path.join(prepared.root, 'state'), 'platewright-walkthrough', {registry: prepared.registry}); clients.push(c); await c.initialize(); return c; };
    const infra = {}, agent = {};
    for (const app of apps) {
      infra[app] = await open(app, 'infra');
      let s = await infra[app].call('env.snapshot');
      const profile = profiles[app] || 'sandbox';
      check(`${runId}: ${app} uses the ${profile} profile`, (await infra[app].call('env.reset', {expected_version: s.version, profile})).status === 'ready');
      s = await infra[app].call('env.snapshot');
      const data = app === 'notes' ? {account_id: 'notes-nora', owner_person_id: 'person-nora', notes: [NOTE]}
        : app === 'calendar' ? {account_id: 'calendar-nora', owner_person_id: 'person-nora', calendar_id: 'cal-home', timezone: 'America/New_York', events: []}
        : s.snapshot.data;
      const loaded = await infra[app].call('env.load_seed', {expected_version: s.version, request_id: 'walkthrough-' + app, data, binding, virtual_now: NOW});
      check(`${runId}: Infra loads the ${app} account for person-nora at ${NOW}`, loaded.status === 'ready', loaded);
      agent[app] = await open(app, 'agent');
    }
    const state = async () => {
      const out = {};
      for (const app of apps) {
        const s = await infra[app].call('env.snapshot');
        out[app] = {account_id: s.snapshot.data.account_id, version: s.version, data_sha256: sha(s.snapshot.data)};
      }
      return out;
    };
    return {infra, agent, state};
  }
  // Records one Agent call: the request, the result and every App's version and data hash after it.
  async function step(env, label, app, tool, args, {meaning = null, keep = r => r} = {}) {
    const result = await env.agent[app].call(tool, args);
    const after = await env.state();
    steps.push({step: steps.length + 1, label, caller: 'agent (account holder person-nora)', direction: 'Agent -> ' + app, app, tool, request: args,
      request_id: args.request_id || null, result: keep(result), meaning, state_after: after});
    return {result, after};
  }
  const project = r => { const {status, id, state, version, duplicate, revision, message, applied} = r; return {status, ...(id !== undefined ? {id} : {}), ...(state !== undefined ? {state} : {}),
    ...(revision !== undefined ? {revision} : {}), ...(version !== undefined ? {version} : {}), ...(duplicate !== undefined ? {duplicate} : {}), ...(applied !== undefined ? {applied} : {}), ...(message !== undefined ? {message} : {})}; };
  const audit = async (env, app, from) => (await env.infra[app].call('env.snapshot')).snapshot.audit.slice(from)
    .map(a => ({seq: a.seq, actor: a.actor, tool: a.tool, decision: a.decision, ...(a.reason ? {reason: a.reason} : {}), ...(a.request_id ? {request_id: a.request_id} : {}),
      ...(a.inputs && a.inputs.request_id ? {request_id: a.inputs.request_id} : {}), before: a.before, after: a.after, state_changed: a.state_changed}));

  try {
    // Main run: Notes, Platewright and Calendar side by side, each with person-nora's account.
    const env = await start(['platewright', 'notes', 'calendar'], 'walkthrough');
    const initial = await env.state();
    records.initial_state = initial;
    const auditStart = {};
    for (const app of ['platewright', 'notes', 'calendar']) auditStart[app] = (await env.infra[app].call('env.snapshot')).snapshot.audit.length;

    // 1. Read the recipe kept as a note.
    const n = await step(env, 'Read the recipe note', 'notes', 'notes.get', {id: NOTE.id}, {keep: r => ({status: r.status, item: {id: r.item.id, title: r.item.title, updated_at: r.item.updated_at, body_sha256: sha(r.item.body)}, version: r.version})});
    check('notes.get returns the recipe note', n.result.status === 'ok' && n.result.item.body.includes('200 g red lentils'), n.result);
    records.notes_read = {id: n.result.item.id, title: n.result.item.title, version: n.result.version, body_sha256: sha(n.result.item.body)};
    check('Platewright state is unchanged by the Notes call', JSON.stringify(n.after.platewright) === JSON.stringify(initial.platewright));
    check('Notes state is unchanged by its read', JSON.stringify(n.after.notes) === JSON.stringify(initial.notes));

    // 2. Save it in Platewright and plan it: a local commit in Platewright only.
    const saved = await step(env, 'Save the carried recipe', 'platewright', 'platewright.recipes.create', {...RECIPE, request_id: 'carry-note-1', expected_version: n.after.platewright.version},
      {meaning: 'local commit in Platewright', keep: project});
    check('platewright.recipes.create commits the carried recipe', saved.result.status === 'committed' && saved.result.state === 'active' && saved.result.revision === 1, saved.result);
    check('The saved recipe holds the quantities read from the note', (await env.agent.platewright.call('platewright.recipes.get', {id: saved.result.id})).recipe.lines.map(l => l.quantity + ' ' + l.unit).join(', ') === '200 g, 1 each, 2 each, 1 l, 100 g, 1 each');
    const checked = await env.agent.platewright.call('platewright.recipes.check', {id: saved.result.id, date: '2026-11-11'});
    check('The saved soup is checked for the household like any recipe', checked.status === 'ok' && checked.verdicts.length === 4, checked);
    const planned = await step(env, 'Plan the soup for Wednesday dinner', 'platewright', 'platewright.plan.slot.set', {id: '2026-11-11:dinner', dishes: [{recipe_id: saved.result.id}], request_id: 'carry-note-2', expected_version: saved.result.version},
      {meaning: 'local commit in Platewright', keep: r => ({...project(r), default_servings: r.default_servings})});
    check('The soup is planned for Wednesday dinner', planned.result.status === 'committed' && planned.result.state === 'planned', planned.result);
    records.platewright_recipe = {id: saved.result.id, version: saved.result.version, verdicts: checked.verdicts.map(v => ({id: v.id, verdict: v.verdict}))};
    records.platewright_slot = {id: planned.result.id, version: planned.result.version, default_servings: planned.result.default_servings};
    check('Notes and Calendar are unchanged by the Platewright writes', JSON.stringify([planned.after.notes, planned.after.calendar]) === JSON.stringify([initial.notes, initial.calendar]));
    const pwMid = planned.after.platewright;
    const calVersion = planned.after.calendar.version;

    // 3. Calendar refuses arguments its pinned contract does not define, and a stale version.
    const foreign = await step(env, 'Send Calendar a field it does not define (recipe_id)', 'calendar', 'calendar.create', {...DINNER, recipe_id: saved.result.id, request_id: 'carry-note-bad', expected_version: calVersion},
      {meaning: 'refused by the receiver; nothing committed', keep: project});
    check('Calendar 1.3.0 refuses an argument outside its contract and writes nothing', foreign.result.status === 'invalid_arguments' && JSON.stringify(foreign.after) === JSON.stringify(planned.after), foreign.result);
    const stale = await step(env, 'Create the event with a stale Calendar version', 'calendar', 'calendar.create', {...DINNER, request_id: 'carry-note-stale', expected_version: {epoch: calVersion.epoch, revision: calVersion.revision + 5}},
      {meaning: 'refused by the receiver; nothing committed', keep: project});
    check('A stale expected_version is stale_version and writes nothing', stale.result.status === 'stale_version' && JSON.stringify(stale.after) === JSON.stringify(planned.after), stale.result);

    // 4. A write whose response the caller does not receive: the request reaches Calendar, which
    // commits it, but the result is withheld from the caller (as if the connection dropped), so the
    // outcome is unknown to the caller. It resolves the outcome by sending the same request again
    // with the same request ID: Calendar returns its stored receipt, marked duplicate, with the same
    // event ID, and no second event exists.
    const lost = await env.agent.calendar.call('calendar.create', {...DINNER, request_id: 'carry-note-3', expected_version: calVersion});
    const afterLost = await env.state();
    steps.push({step: steps.length + 1, label: 'Create the dinner event; the response is withheld from the caller', caller: 'agent (account holder person-nora)', direction: 'Agent -> calendar', app: 'calendar', tool: 'calendar.create',
      request: {...DINNER, request_id: 'carry-note-3', expected_version: calVersion}, request_id: 'carry-note-3', result: 'not received by the caller (outcome unknown to it)', meaning: 'receiver commit happened in Calendar; the caller cannot tell yet', state_after: afterLost});
    check('The withheld write did commit in Calendar (Infra view)', lost.status === 'committed' && afterLost.calendar.version.revision === calVersion.revision + 1);
    const retry = await step(env, 'Resolve the unknown outcome: send the same request with the same request ID', 'calendar', 'calendar.create', {...DINNER, request_id: 'carry-note-3', expected_version: calVersion},
      {meaning: 'receiver commit confirmed by Calendar\'s stored receipt', keep: project});
    check('The retry returns the stored receipt (duplicate) with the same event ID and version', retry.result.status === 'committed' && retry.result.duplicate === true && retry.result.id === lost.id && JSON.stringify(retry.result.version) === JSON.stringify(lost.version), retry.result);
    check('The retry writes nothing more in any App', JSON.stringify(retry.after) === JSON.stringify(afterLost));
    const conflict = await step(env, 'Reuse the request ID with a changed title', 'calendar', 'calendar.create', {...DINNER, title: 'Soup night', request_id: 'carry-note-3', expected_version: calVersion},
      {meaning: 'refused; nothing committed', keep: project});
    check('The same request ID with changed input is idempotency_conflict and writes nothing', conflict.result.status === 'idempotency_conflict' && JSON.stringify(conflict.after) === JSON.stringify(afterLost), conflict.result);

    // 5. The result inside Calendar: the account, the record, its version and the planned time.
    const got = await step(env, 'Read the event back from Calendar', 'calendar', 'calendar.get', {id: lost.id}, {keep: r => ({status: r.status, event: r.event, version: r.version})});
    check('The calendar event is stored with the planned time', got.result.status === 'ok' && got.result.event.start === DINNER.start && got.result.event.title === DINNER.title, got.result);
    const calSnap = (await env.infra.calendar.call('env.snapshot')).snapshot;
    check('Calendar holds exactly one event, in calendar-nora\'s account', calSnap.data.account_id === 'calendar-nora' && calSnap.data.events.length === 1 && calSnap.data.events[0].id === lost.id, calSnap.data.events.map(e => e.id));
    records.calendar_event = {account_id: calSnap.data.account_id, id: lost.id, version: lost.version, start: got.result.event.start, title: got.result.event.title, events_in_calendar: calSnap.data.events.length};

    // 6. A repeated Platewright write returns its receipt and adds nothing.
    const again = await step(env, 'Send the recipe write again with the same request ID', 'platewright', 'platewright.recipes.create', {...RECIPE, request_id: 'carry-note-1', expected_version: n.after.platewright.version},
      {meaning: 'local commit confirmed by Platewright\'s stored receipt', keep: project});
    check('Platewright returns the stored receipt for the repeated write and adds no second recipe', again.result.duplicate === true && again.result.id === saved.result.id &&
      (await env.agent.platewright.call('platewright.recipes.search', {query: 'lentil and spinach'})).items.length === 1, again.result);
    const pwAfter = (await env.infra.platewright.call('env.snapshot'));
    check('Platewright state is unchanged by the Calendar calls', JSON.stringify(again.after.platewright) === JSON.stringify(pwMid));
    const notesAfter = (await env.infra.notes.call('env.snapshot')).snapshot;
    check('Notes state is unchanged: the note was read, not moved', JSON.stringify(notesAfter.data.notes) === JSON.stringify([NOTE]));
    check('Platewright recorded only its own two writes after the seed\'s events', pwAfter.snapshot.data.activity.slice(-2).map(a => a.action + ':' + a.request_id).join() === 'recipes.create:carry-note-1,plan.slot.set:carry-note-2' &&
      pwAfter.snapshot.data.activity.filter(a => a.actor !== 'event').length === 2);
    records.audit = {platewright: await audit(env, 'platewright', auditStart.platewright), notes: await audit(env, 'notes', auditStart.notes), calendar: await audit(env, 'calendar', auditStart.calendar)};
    records.audit_note = 'Core audit rows of each App after the seed (wall-clock fields left out). A replayed write returns its stored receipt and adds no audit row; refused calls add a deny row and change nothing.';
    records.receipts = {};
    for (const app of ['platewright', 'calendar']) records.receipts[app] = Object.entries((await env.infra[app].call('env.snapshot')).snapshot.receipts)
      .filter(([key]) => key.includes('carry-note')).map(([key, r]) => ({key, status: r.result.status, id: r.result.id, version: r.result.version}));
    records.final_state = await env.state();

    // 7. Denied: a task whose Calendar policy lists no calendar.create (Calendar's scenario profile).
    const denied = await start(['platewright', 'calendar'], 'walkthrough-denied', {calendar: 'scenario'});
    const deniedBefore = await denied.state();
    const d = await step(denied, 'Create the event under a policy that does not allow calendar.create', 'calendar', 'calendar.create', {...DINNER, request_id: 'carry-note-denied', expected_version: deniedBefore.calendar.version},
      {meaning: 'denied by the receiver\'s policy; nothing committed', keep: project});
    check('Under a policy without calendar.create the write is permission_denied and neither App changes', d.result.status === 'permission_denied' && JSON.stringify(d.after) === JSON.stringify(deniedBefore), d.result);

    // 8. Missing dependency: Platewright alone. The Agent has no Notes or Calendar tools, and
    // Platewright's own workflow does not need them.
    const alone = await start(['platewright'], 'walkthrough-alone');
    const aloneBefore = await alone.state();
    const missing = await step(alone, 'Call notes.get in a run without Notes', 'platewright', 'notes.get', {id: NOTE.id}, {meaning: 'no such dependency in this run', keep: project});
    const missingCal = await step(alone, 'Call calendar.create in a run without Calendar', 'platewright', 'calendar.create', {...DINNER, request_id: 'carry-note-missing', expected_version: aloneBefore.platewright.version}, {meaning: 'no such dependency in this run', keep: project});
    check('Without Notes and Calendar their tools are refused and Platewright is unchanged', missing.result.status === 'permission_denied' && missingCal.result.status === 'permission_denied' && JSON.stringify(missingCal.after) === JSON.stringify(aloneBefore), [missing.result, missingCal.result]);
    const solo = await step(alone, 'Save the same recipe in Platewright alone', 'platewright', 'platewright.recipes.create', {...RECIPE, request_id: 'carry-note-alone', expected_version: aloneBefore.platewright.version}, {meaning: 'local commit in Platewright', keep: project});
    check('Platewright completes its own write without Notes or Calendar', solo.result.status === 'committed', solo.result);

    // 9. Incompatible version: a copy of Calendar whose app.json says 1.4.0 (a test double made in a
    // temporary directory for this check only) is refused by the pin check before any call.
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'platewright-calendar-copy-'));
    try {
      fs.cpSync(calendarDir, copy, {recursive: true});
      const manifest = JSON.parse(fs.readFileSync(path.join(copy, 'app.json'), 'utf8')); manifest.version = '1.4.0';
      fs.writeFileSync(path.join(copy, 'app.json'), JSON.stringify(manifest, null, 2));
      const tools = JSON.parse(fs.readFileSync(path.join(copy, 'tools.json'), 'utf8')), list = tools.tools || tools;
      list.find(t => t.name === 'calendar.create').inputSchema.required.push('calendar_id');
      fs.writeFileSync(path.join(copy, 'tools.json'), JSON.stringify(tools, null, 2));
      const gate = pinned('calendar', copy);
      records.incompatible_calendar = {what: 'test double: a temporary copy of Calendar 1.3.0 with app.json version 1.4.0 and calendar.create requiring calendar_id', compatible: gate.compatible, problems: gate.problems};
      check('A Calendar package of another version or contract is refused before any call', !gate.compatible && gate.problems.length === 2, gate);
    } finally { fs.rmSync(copy, {recursive: true, force: true}); }

    return {schema: 'platewright.notes-calendar-walkthrough.v2', revisions, passed: true,
      binding: binding.accounts.filter(a => a.owner_person_id === 'person-nora'),
      meanings: {
        local_commit: 'Platewright committed the recipe and the planned meal in its own state (receipts with version; activity rows carry the request IDs).',
        receiver_commit: 'Calendar committed the event in calendar-nora\'s calendar (stored receipt, calendar.get, Infra snapshot with one event).',
        recipient_confirmation: 'Not applicable and not claimed: the event is in the account holder\'s own calendar with no attendee, and nothing is sent to another person. Platewright sends nothing to any App; each write is a separate Agent call.'
      },
      records, steps, checks};
  } catch (e) {
    return {schema: 'platewright.notes-calendar-walkthrough.v2', passed: false, error: e.message, records, steps, checks};
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    for (const p of preparedAll) p.cleanup();
  }
}
if (require.main === module) {
  run().then(report => {
    const text = JSON.stringify(report, null, 2) + '\n', out = locate.option('output');
    if (out) fs.writeFileSync(out, text);
    process.stdout.write(text);
    process.stdout.write(JSON.stringify({node: process.version, passed: report.passed, checks: report.checks.length}) + '\n');
    if (!report.passed) process.exitCode = 1;
  });
}
module.exports = {run};
