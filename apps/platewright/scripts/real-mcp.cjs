#!/usr/bin/env node
'use strict';
// Real MCP checks on the pinned public runtime for what the public verifier does not exercise (the
// Core side of T17): a task seed with its own virtual_now, time moved with env.advance_time and no
// App event, replays and idempotency conflicts of writes and events, stale versions, failure
// atomicity with Core's denial audit (several refusals, rejected events and an all-or-nothing
// multi-item event), a task policy that fences off other members, Agent attempts at Infra
// operations, read-only audit growth, and reset to the loaded data and time.
//   node scripts/real-mcp.cjs [--runtime DIR] [--output FILE]
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const locate = require('./locate.cjs');

async function run() {
  const runtime = locate.runtimeDir();
  const {prepare} = require(path.join(runtime, 'prepare.cjs')), {Client} = require(path.join(runtime, 'client.cjs'));
  const prepared = prepare(locate.packageDir), clients = [], checks = [];
  const check = (name, cond, detail) => { assert.ok(cond, name + (detail !== undefined ? ': ' + JSON.stringify(detail).slice(0, 600) : '')); checks.push({name, status: 'passed'}); };
  const open = async (role, run = 'platewright-mcp') => {
    const c = new Client('platewright', role, run, path.join(prepared.root, 'state'), 'platewright-real-mcp', {registry: prepared.registry});
    clients.push(c); await c.initialize(); return c;
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  try {
    const infra = await open('infra'), agent = await open('agent');
    const snap = async () => (await infra.call('env.snapshot'));
    // Authority: the Agent lists only platewright.* tools and cannot call an Infra operation by name.
    const listed = (await agent.request('tools/list')).result.tools.map(t => t.name);
    check('Agent discovery lists only the 11 read tools of the default scenario profile', listed.length === 11 && listed.every(n => n.startsWith('platewright.')), listed);
    for (const name of ['env.apply_event', 'env.reset', 'env.advance_time', 'env.load_seed', 'env.snapshot', 'env.event_status']) {
      check('Agent calling ' + name + ' is permission_denied', (await agent.call(name, {})).status === 'permission_denied');
    }
    check('The scenario profile denies writes', (await agent.call('platewright.pantry.set', {id: 'ing-lime', quantity: 1, unit: 'each', request_id: 'x', expected_version: {epoch: 1, revision: 0}})).status === 'permission_denied');
    check('Infra connection exposes env.advance_time', (await infra.request('tools/list')).result.tools.some(t => t.name === 'env.advance_time'));
    // A task seed with its own clock, in the sandbox profile.
    let s = await snap();
    check('Sandbox profile selected by Infra reset', (await infra.call('env.reset', {expected_version: s.version, profile: 'sandbox'})).status === 'ready');
    check('The sandbox profile lists all 22 tools', (await agent.request('tools/list')).result.tools.length === 22);
    s = await snap();
    const seed = JSON.parse(fs.readFileSync(path.join(locate.packageDir, 'fixtures/minimal.json'), 'utf8'));
    const T0 = '2026-11-08T07:30:00-05:00';
    const loaded = await infra.call('env.load_seed', {expected_version: s.version, request_id: 'task-seed', data: seed, virtual_now: T0});
    check('Infra loads a task seed with virtual_now', loaded.status === 'ready', loaded);
    s = await snap();
    check('Loaded clock and data are the task\'s', s.snapshot.virtual_now === T0 && same(s.snapshot.data, seed));
    const baseline = s;
    // Reads: business data byte-identical, version unchanged; Core's audit grows by one row with the projected id.
    const read = await agent.call('platewright.recipes.get', {id: 'rec-green-curry', servings: 6});
    let after = await snap();
    check('Read returns ok with the current version', read.status === 'ok' && same(read.version, s.version) && read.recipe.lines[0].quantity === 1050);
    check('Read leaves business data byte-identical', same(after.snapshot.data, s.snapshot.data));
    check('Read leaves the version unchanged while the audit grows by one row naming the recipe',
      same(after.version, s.version) && after.snapshot.audit.length === s.snapshot.audit.length + 1 && after.snapshot.audit.at(-1).input.id === 'rec-green-curry');
    // A committed write, its replay and a conflicting reuse of the request ID.
    const args = {id: '2026-11-14:dinner', dishes: [{recipe_id: 'rec-green-curry'}], attendees: ['person-nora', 'person-eli'],
      guests: [{guest_id: 'guest-maya', name: 'Maya', constraints: [{kind: 'allergy', allergen: 'tree_nut', strict: true}]}], request_id: 'plan-1', expected_version: read.version};
    const w = await agent.call('platewright.plan.slot.set', args);
    check('plan.slot.set commits with the next revision and reports the object state under `state`',
      w.status === 'committed' && w.state === 'planned' && w.version.revision === read.version.revision + 1 && w.default_servings === 3, w);
    check('The write result flags the guest at the slot', w.flags.some(x => x.id === 'guest-maya' && x.verdict === 'unsafe'));
    s = await snap();
    check('One activity row for the committed write, with its request_id', s.snapshot.data.activity.length === 1 && s.snapshot.data.activity[0].request_id === 'plan-1');
    check('Core audit projects the slot ID of the write', s.snapshot.audit.at(-1).input.id === '2026-11-14:dinner' && s.snapshot.audit.at(-1).result.object_id === '2026-11-14:dinner');
    const replay = await agent.call('platewright.plan.slot.set', args);
    after = await snap();
    check('Exact replay returns the stored receipt marked duplicate', replay.duplicate === true && replay.id === w.id && same(replay.version, w.version), replay);
    check('Replay changes no data and writes no activity row', same(after.snapshot.data, s.snapshot.data) && same(after.version, s.version));
    check('Same request_id with different input is idempotency_conflict', (await agent.call('platewright.plan.slot.set', {...args, attendees: ['person-nora']})).status === 'idempotency_conflict');
    check('Stale expected_version is stale_version', (await agent.call('platewright.plan.slot.set', {...args, request_id: 'plan-2'})).status === 'stale_version');
    // Failure atomicity: refusals after the hook read several records leave data and version unchanged; Core logs a denial.
    s = await snap();
    const refusals = [
      ['platewright.plan.slot.set', {id: '2026-11-07:dinner', dishes: [{recipe_id: 'rec-shakshuka'}]}, 'past_slot'],
      ['platewright.plan.slot.set', {id: '2026-11-13:dinner', dishes: [{leftovers_of: '2026-11-14:dinner', portions: 2}]}, 'leftover_unavailable'],
      ['platewright.plan.slot.mark', {id: '2026-11-14:dinner', status: 'cooked'}, 'not_yet'],
      ['platewright.members.constraint.set', {id: 'person-eli', constraint: {kind: 'allergy', allergen: 'coconut', note: 'x'}}, 'invalid_constraint'],
      ['platewright.recipes.variant.create', {id: 'rec-green-curry', swaps: [{ingredient_id: 'ing-fish-sauce', rule_id: 'rule-fish-sauce-tamari'}, {ingredient_id: 'ing-fish-sauce', to_ingredient_id: 'ing-salt'}]}, 'conflict'],
      ['platewright.shopping.item.set', {text: 'Candles', quantity: 1, unit: 'each'}, 'no_list']
    ];
    for (const [name, a, code] of refusals) {
      const r = await agent.call(name, {...a, request_id: 'refused-' + code, expected_version: s.version});
      after = await snap();
      check(`${name} refused with ${code}; data and version unchanged; denial audit row`, r.status === code && same(after.snapshot.data, s.snapshot.data) &&
        same(after.version, s.version) && after.snapshot.audit.at(-1).decision === 'deny' && after.snapshot.audit.at(-1).reason === code, r);
    }
    // A task policy (fixtures/policies-fence.json) fences off other members' constraints: Core's `ids`
    // restricts args.id, which for both constraint tools is the member.
    const policies = JSON.parse(fs.readFileSync(path.join(locate.packageDir, 'fixtures/policies-fence.json'), 'utf8'));
    s = await snap();
    check('Infra reloads the seed with a narrowed policy', (await infra.call('env.load_seed', {expected_version: s.version, request_id: 'task-seed-policy', data: seed, virtual_now: T0, policies})).status === 'ready');
    s = await snap();
    const fenced = await agent.call('platewright.members.constraint.set', {id: 'person-evan', constraint: {kind: 'dislike', tag: 'herb', note: 'x'}, request_id: 'fence-1', expected_version: s.version});
    check('Changing another member\'s constraint is permission_denied under that policy', fenced.status === 'permission_denied', fenced);
    const own = await agent.call('platewright.members.constraint.set', {id: 'person-nora', constraint: {kind: 'dislike', tag: 'herb', note: 'Not tonight', expires_on: '2026-11-08'}, request_id: 'fence-2', expected_version: s.version});
    check('The account holder\'s own constraint still commits', own.status === 'committed' && own.state === 'active', own);
    check('The result and the activity row name the constraint; Core\'s audit names the member', own.id === 'con-0001' && own.member_id === 'person-nora' &&
      (await snap()).snapshot.data.activity.at(-1).object_id === 'con-0001' && (await snap()).snapshot.audit.at(-1).input.id === 'person-nora');
    s = await snap();
    const fencedRemove = await agent.call('platewright.members.constraint.remove', {id: 'person-evan', constraint_id: 'con-evan-01', request_id: 'fence-3', expected_version: s.version});
    check('Ending another member\'s constraint is permission_denied under that policy', fencedRemove.status === 'permission_denied', fencedRemove);
    s = await snap();
    check('Restoring the package policy', (await infra.call('env.load_seed', {expected_version: s.version, request_id: 'task-seed-2', data: seed, virtual_now: T0,
      policies: JSON.parse(fs.readFileSync(path.join(locate.packageDir, 'fixtures/policies.json'), 'utf8'))})).status === 'ready');
    // Marking cooked with defaults when servings are below the attendees' portions commits (eaten capped at made).
    s = await snap();
    const small = await agent.call('platewright.plan.slot.set', {id: '2026-11-08:dinner', dishes: [{recipe_id: 'rec-green-curry', servings: 2}], request_id: 'small-1', expected_version: s.version});
    const cooked = await agent.call('platewright.plan.slot.mark', {id: '2026-11-08:dinner', status: 'cooked', request_id: 'small-2', expected_version: small.version});
    check('Default mark with servings below headcount commits with eaten capped at made', cooked.status === 'committed' && cooked.portions[0].made === 2 && cooked.portions[0].eaten === 2, cooked);
    // A limit that cannot be checked is visible in plan.get; nested results validate against the typed output schema.
    const tue = (await agent.call('platewright.plan.get', {start: '2026-11-10', end: '2026-11-10'})).slots[0];
    check('plan.get shows limit_unchecked for Evan on the lentil soup', tue.flags.some(x => x.type === 'limit_unchecked' && x.id === 'person-evan' && x.nutrient === 'kcal'), tue.flags);
    // A blank guest name is refused by the App, not by Core's validation.
    s = await snap();
    const blank = await agent.call('platewright.plan.slot.set', {id: '2026-11-12:dinner', dishes: [{recipe_id: 'rec-shakshuka'}], guests: [{guest_id: 'guest-b', name: '   ', constraints: []}], request_id: 'blank-1', expected_version: s.version});
    check('A guest name of only spaces is invalid_arguments with data unchanged', blank.status === 'invalid_arguments' && same((await snap()).snapshot.data, s.snapshot.data), blank);
    // Events: applied at their time, queryable, deduplicated; conflicting reuse refused.
    s = await snap();
    const scenario = JSON.parse(fs.readFileSync(path.join(locate.packageDir, 'examples/scenario.json'), 'utf8'));
    const applied = await infra.call('env.apply_event', {expected_version: s.version, event: scenario});
    after = await snap();
    check('member.updated commits; the clock moves to the event time', applied.status === 'committed' && after.snapshot.virtual_now === scenario.at, applied);
    check('One notification and one activity row for the event', after.snapshot.data.notifications.length === 1 && after.snapshot.data.activity.at(-1).event_id === scenario.event_id);
    check('Committed event is queryable', same((await infra.call('env.event_status', {event_id: scenario.event_id})).receipt, applied));
    check('Identical event retry is deduplicated', (await infra.call('env.apply_event', {expected_version: after.version, event: scenario})).duplicate === true);
    check('Same event ID with changed content is idempotency_conflict', (await infra.call('env.apply_event', {expected_version: after.version, event: {...scenario, at: '2026-11-08T09:30:00-05:00'}})).status === 'idempotency_conflict');
    // Rejected events: data, version and clock unchanged.
    s = await snap();
    const rejected = [
      ['an event dated before the App clock', {event_id: 'ev-early', at: '2026-11-08T08:00:00-05:00', operation: 'platewright.pantry.changed', payload: {items: [{ingredient_id: 'ing-egg', quantity: 12, unit: 'each'}]}}],
      ['a change to a cooked slot', {event_id: 'ev-cooked', at: '2026-11-08T10:00:00-05:00', operation: 'platewright.plan.changed', payload: {id: '2026-11-07:dinner', action: 'clear'}}],
      ['a multi-item pantry event with one unknown ingredient (all or nothing)', {event_id: 'ev-pantry-bad', at: '2026-11-08T10:05:00-05:00', operation: 'platewright.pantry.changed',
        payload: {items: [{ingredient_id: 'ing-egg', quantity: 12, unit: 'each'}, {ingredient_id: 'ing-coconut-milk', quantity: 400, unit: 'ml'}, {ingredient_id: 'ing-unicorn', quantity: 1, unit: 'each'}]}}],
      ['a duplicate recipe ID', {event_id: 'ev-dup-recipe', at: '2026-11-08T10:10:00-05:00', operation: 'platewright.recipe.added',
        payload: {recipe: {id: 'rec-green-curry', title: 'Copy', servings: 2, method_tags: ['simmer'], lines: [{ingredient_id: 'ing-onion', quantity: 1, unit: 'each'}], steps: ['Cook.']}}}]
    ];
    for (const [label, event] of rejected) {
      const r = await infra.call('env.apply_event', {expected_version: s.version, event});
      after = await snap();
      check(`Rejected event (${label}) is invalid_event with data, version and clock unchanged`, r.status === 'invalid_event' &&
        same(after.snapshot.data, s.snapshot.data) && same(after.version, s.version) && after.snapshot.virtual_now === s.snapshot.virtual_now, r);
    }
    // Time moved by Infra with no App event: derived states follow, business data does not change.
    const states = async () => ({
      con: (await agent.call('platewright.household.get', {id: 'person-nora'})).members[0].constraints.map(c => c.id + ':' + c.state),
      phase: (await agent.call('platewright.plan.get', {start: '2026-11-09', end: '2026-11-14'})).slots.map(x => x.id + ':' + x.phase),
      fresh: (await agent.call('platewright.pantry.list', {})).items.filter(i => ['ing-yogurt-lf', 'ing-lime'].includes(i.ingredient_id)).map(i => i.ingredient_id + ':' + i.freshness)
    });
    s = await snap();
    const before = await states();
    check('Before: Nora\'s sodium limit scheduled, upcoming slots, yogurt fresh and limes use_soon',
      before.con.includes('con-nora-02:scheduled') && before.phase.every(x => x.endsWith('upcoming')) && same(before.fresh, ['ing-yogurt-lf:fresh', 'ing-lime:use_soon']), before);
    const clockArgs = {expected_version: (await snap()).version, request_id: 'clock-1', virtual_now: '2026-11-21T08:00:00-05:00'};
    const advanced = await infra.call('env.advance_time', clockArgs);
    after = await snap();
    check('env.advance_time commits with no App event', advanced.status === 'committed' && advanced.advanced === true && after.snapshot.virtual_now === clockArgs.virtual_now, advanced);
    check('Business data is unchanged by the clock (no notification, no activity row)', same(after.snapshot.data, s.snapshot.data));
    const later = await states();
    check('After: the limit is active, the slots past, yogurt and limes expired',
      later.con.includes('con-nora-02:active') && later.phase.every(x => x.endsWith('past')) && same(later.fresh, ['ing-yogurt-lf:expired', 'ing-lime:expired']), later);
    check('A repeated clock request returns its receipt marked duplicate', (await infra.call('env.advance_time', clockArgs)).duplicate === true);
    check('The clock cannot move backwards', (await infra.call('env.advance_time', {expected_version: after.version, request_id: 'clock-2', virtual_now: '2026-11-10T08:00:00-05:00'})).status === 'invalid_time');
    // Seed validation on real Core.
    s = await snap();
    const badSeeds = [
      ['a dangling recipe reference', d => { d.plan[3].dishes[0].recipe_id = 'rec-missing'; }],
      ['a cooked slot after the loaded time', d => { d.plan[3].state = 'cooked'; d.plan[3].cooked = {at: '2026-11-08T07:00:00-05:00', portions: [{recipe_id: 'rec-black-bean-tacos', revision: 1, made: 4, eaten: 4}], deducted: false, short: []}; }],
      ['a timestamp without a UTC offset', d => { d.recipes[0].origin.at = '2026-01-10T23:00:00'; }],
      ['an unbound account', d => { d.account_id = 'platewright-other'; }]
    ];
    for (const [label, change] of badSeeds) {
      const d = structuredClone(seed); change(d);
      const r = await infra.call('env.load_seed', {expected_version: s.version, data: d, virtual_now: T0});
      check(`Seed with ${label} is rejected and leaves state unchanged`, r.status !== 'ready' && same((await snap()).snapshot.data, s.snapshot.data), r);
    }
    // Reset restores the loaded seed and the loaded time, and clears the audit.
    s = await snap();
    const reset = await infra.call('env.reset', {expected_version: s.version});
    after = await snap();
    check('Reset returns ready and advances the epoch', reset.status === 'ready' && after.version.epoch === s.version.epoch + 1 && after.version.revision === 0);
    check('Reset restores the loaded data and time', same(after.snapshot.data, baseline.snapshot.data) && after.snapshot.virtual_now === T0);
    check('Reset clears the audit (only the reset row remains) and the receipts', after.snapshot.audit.length === 1 && after.snapshot.audit[0].tool === 'env.reset' &&
      Object.keys(after.snapshot.receipts).length === 0, after.snapshot.audit);
    check('Old versions cannot write after reset', (await agent.call('platewright.pantry.set', {id: 'ing-lime', quantity: 3, unit: 'each', request_id: 'old', expected_version: s.version})).status === 'stale_version');
    // Another run keeps the package's own reference seed.
    const peer = await open('infra', 'platewright-other');
    const other = (await peer.call('env.snapshot')).snapshot;
    check('A separate run starts from the package reference seed', other.data.recipes.length === 66 && other.data.plan.length === 880 && other.virtual_now === '2026-11-08T08:00:00-05:00');
    return {schema: 'platewright.real-mcp.v1', runtime_version: require(path.join(runtime, 'package.json')).version, node: process.version, passed: true, checks};
  } catch (e) {
    return {schema: 'platewright.real-mcp.v1', node: process.version, passed: false, error: e.message, checks};
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
