#!/usr/bin/env node
'use strict';
// Real-MCP checks on the public runtime for what the public verifier does not exercise.
// Needs the PALE checkout (or PALE_RUNTIME_ROOT); the App-only tests do not.
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
let root = __dirname, runtime = process.env.PALE_RUNTIME_ROOT;
if (!runtime) { while (!fs.existsSync(path.join(root, 'runtime/launch.cjs'))) { const parent = path.dirname(root); if (parent === root) throw Error('Run inside the public PALE checkout, or set PALE_RUNTIME_ROOT.'); root = parent; } runtime = path.join(root, 'runtime'); }
const {Client} = require(path.join(path.resolve(runtime), 'client.cjs'));
const registry = path.resolve(__dirname, '../registry.json'), APP = 'ribbonwell';
const seed = () => structuredClone(require('../fixtures/minimal.json')), binding = () => structuredClone(require('../fixtures/binding.json')), policies = () => structuredClone(require('../fixtures/policies.json'));
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const checks = [], clients = [];
const check = (name, ok = true) => { assert.ok(ok, name); checks.push(name); };
const NOV23 = '2026-11-23T10:00:00-05:00';

(async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ribbonwell-mcp-'));
  const open = async (role, run, options = {}) => { const c = new Client(APP, role, run, stateDir, 'ribbonwell-integration', {registry, ...options}); clients.push(c); await c.initialize(); return c; };
  try {
    const infra = await open('infra', 'main', {initialProfile: 'sandbox'}), agent = await open('agent', 'main');
    const snap = async (c = infra) => c.call('env.snapshot');
    const version = async () => (await snap()).version;
    let n = 0;
    const write = async (name, args, c = agent) => c.call(APP + '.' + name, {...args, expected_version: await version(), request_id: 'req-' + (++n)});
    const read = (name, args = {}, c = agent) => c.call(APP + '.' + name, args);
    const advance = async (to, c = infra) => c.call('env.advance_time', {expected_version: (await snap(c)).version, virtual_now: to, request_id: 'clock-' + (++n)});
    const event = async (e, c = infra) => c.call('env.apply_event', {expected_version: (await snap(c)).version, event: e});
    const ev = (event_id, at, operation, payload) => ({event_id, at, operation: APP + '.' + operation, payload});
    const train = seed().items.find(i => i.name === 'Wooden train set').item_id;

    // 1. A task loads its own history with its own clock.
    const loaded = await infra.call('env.load_seed', {expected_version: await version(), request_id: 'task-seed', data: seed(), binding: binding(), policies: policies(), virtual_now: NOV23});
    check('A task seed loads with its own clock', loaded.status === 'ready' && (await read('account.get')).now === NOV23);
    const early = seed(); early.lists[0].created_at = '2024-12-31T18:59:59-05:00';
    check('A record dated before 2025-01-01 is refused', (await infra.call('env.load_seed', {expected_version: await version(), data: early})).status === 'invalid_seed');
    const late = seed(); late.items[0].updated_at = '2026-11-23T10:00:01-05:00';
    check('A record dated after the loaded clock is refused', (await infra.call('env.load_seed', {expected_version: await version(), data: late})).status === 'invalid_seed');
    const unbound = seed(); unbound.members[0].person_id = null;
    check('A seed with no member for the account owner is refused', (await infra.call('env.load_seed', {expected_version: await version(), data: unbound})).status === 'invalid_seed');
    const baseline = (await snap()).snapshot.data;
    check('Refused loads leave the loaded baseline unchanged', hash(baseline) === hash(seed()));

    // 2. Agent against Infra authority, and what an Agent can never read.
    for (const tool of ['env.apply_event', 'env.reset', 'env.snapshot', 'env.advance_time', 'env.load_seed'])
      check('The Agent calling ' + tool + ' gets permission_denied', (await agent.call(tool, {})).status === 'permission_denied');
    const everything = JSON.stringify([await read('lists.get', {id: 'lst-priya-family', include_removed: true}), await read('claims.list', {limit: 100}), await read('exchanges.list'), await read('notifications.list', {limit: 100}), await read('account.get'), await read('items.search', {query: ''})]);
    const own = new Set(baseline.items.filter(i => i.list_id === 'lst-priya-family').map(i => i.item_id)), hidden = baseline.claims.filter(c => own.has(c.item_id));
    check('The snapshot holds the six claims on the member\'s own list', hidden.length === 6);
    check('No Agent read returns a claim on the member\'s own list, an assignment or the draw salt', hidden.every(c => !everything.includes(c.claim_id)) && !everything.includes('"giver"') && !everything.includes(baseline.settings.draw_salt));

    // 3. Writes, replays, conflicts and stale versions.
    const v0 = await version(), args = {id: train, quantity: 1, expected_version: v0, request_id: 'reserve-1'};
    const first = await agent.call(APP + '.claims.reserve', args);
    check('A reservation commits and returns its hold', first.status === 'committed' && first.reserved_until === '2026-12-07T10:00:00-05:00' && first.version.revision === v0.revision + 1);
    const afterFirst = await snap();
    const replay = await agent.call(APP + '.claims.reserve', args);
    check('An exact repeat returns the stored receipt marked duplicate', replay.duplicate === true && replay.id === first.id);
    check('A replay has no second effect and leaves no audit row', hash((await snap()).snapshot.data) === hash(afterFirst.snapshot.data) && (await snap()).snapshot.audit.length === afterFirst.snapshot.audit.length);
    check('The same request_id with different input is an idempotency_conflict', (await agent.call(APP + '.claims.reserve', {...args, quantity: 2})).status === 'idempotency_conflict');
    check('A stale expected_version is refused', (await agent.call(APP + '.claims.release', {id: first.id, expected_version: v0, request_id: 'stale-1'})).status === 'stale_version');
    const refused = await write('claims.reserve', {id: train});
    check('A business refusal carries its code and changes nothing', refused.status === 'already_claimed' && refused.applied === false && hash((await snap()).snapshot.data) === hash(afterFirst.snapshot.data));
    const audit = (await snap()).snapshot.audit;
    check('Refused calls are counted from deny audit rows and their reasons', ['idempotency_conflict', 'stale_version', 'already_claimed'].every(r => audit.some(a => a.decision === 'deny' && a.reason === r)));
    check('An audit row carries no arguments and no request ID', audit.every(a => !('arguments' in a) && !('args' in a) && !('request_id' in a)));
    const row = (await snap()).snapshot.data.activity.at(-1);
    check('The activity row joins a write to the Agent trace by request_id', row.request_id === 'reserve-1' && row.action === 'claims.reserve' && row.object_id === first.id);

    // 4. Time: nothing is rewritten, the clock raises the revision, one jump equals small steps.
    const beforeClock = await snap();
    check('env.advance_time commits', (await advance('2026-12-07T09:59:59-05:00')).status === 'committed');
    check('One second before the hold ends the claim reads reserved', (await read('items.get', {id: train})).item.remaining === 0);
    check('A write prepared before the clock moved is stale', (await agent.call(APP + '.claims.update', {id: first.id, patch: {note: 'x'}, expected_version: beforeClock.version, request_id: 'old-form'})).status === 'stale_version');
    await advance('2026-12-07T10:00:00-05:00');
    const lapsed = await read('items.get', {id: train});
    check('At exactly reserved_until the claim reads lapsed and frees its quantity', lapsed.item.remaining === 1 && lapsed.item.claims.find(c => c.mine).status === 'lapsed');
    const afterClock = await snap();
    check('Time alone rewrites no business data', hash(afterClock.snapshot.data) === hash(beforeClock.snapshot.data));
    check('The snapshot keeps the stored status; a grader derives lapsed from reserved_until and the clock', afterClock.snapshot.data.claims.find(c => c.claim_id === first.id).status === 'reserved' && Date.parse(afterClock.snapshot.virtual_now) >= Date.parse(first.reserved_until));
    const jump = await open('infra', 'jump', {initialProfile: 'sandbox'}), steps = await open('infra', 'steps', {initialProfile: 'sandbox'});
    for (const c of [jump, steps]) await c.call('env.load_seed', {expected_version: (await snap(c)).version, request_id: 'task-seed', data: seed(), binding: binding(), policies: policies(), virtual_now: NOV23});
    await advance('2026-12-25T00:00:00-05:00', jump);
    for (let day = 24; day <= 30; day++) await advance('2026-11-' + day + 'T00:00:00-05:00', steps);
    for (let day = 1; day <= 25; day++) await advance('2026-12-' + String(day).padStart(2, '0') + 'T00:00:00-05:00', steps);
    check('One clock jump and 32 daily steps leave identical business data', hash((await snap(jump)).snapshot.data) === hash((await snap(steps)).snapshot.data));
    const viewer = await open('agent', 'jump');
    check('An undrawn exchange reads expired once time passes its date, with no App event', (await viewer.call(APP + '.exchanges.get', {id: 'exc-family-cookies'})).exchange.status === 'expired');

    // 5. Events reach a record the Agent created; no match is rejected and changes nothing.
    const vest = await write('items.add', {id: 'lst-priya-family', item: {name: 'Trail running vest'}});
    const applied = await event(ev('ev-match-1', '2026-12-08T12:05:00-05:00', 'claim.recorded', {actor_member_id: 'mem-dev', item_match: {list_id: 'lst-priya-family', name: 'trail running vest'}, status: 'purchased'}));
    check('A prewritten event reaches an Agent-created item by match key', applied.status === 'committed' && (await snap()).snapshot.data.claims.some(c => c.item_id === vest.id && c.member_id === 'mem-dev'));
    check('The Agent still sees no claim on that own-list item', (await read('items.get', {id: vest.id})).item.claims_hidden === true);
    const beforeMiss = await snap();
    const miss = await event(ev('ev-match-2', '2026-12-08T12:10:00-05:00', 'claim.recorded', {actor_member_id: 'mem-kamala', item_match: {list_id: 'lst-priya-family', name: 'No such item'}, status: 'reserved'}));
    check('An event with no match is invalid_event and leaves state and clock unchanged', miss.status === 'invalid_event' && hash((await snap()).snapshot.data) === hash(beforeMiss.snapshot.data) && (await snap()).snapshot.virtual_now === beforeMiss.snapshot.virtual_now);
    check('Infra reads the committed event with env.event_status', (await infra.call('env.event_status', {event_id: 'ev-match-1'})).receipt.status === 'committed');
    check('An event dated before the current time is refused by Core', (await event(ev('ev-old', '2026-12-01T00:00:00-05:00', 'item.changed', {actor_member_id: 'mem-tomas', item_id: 'itm-tomas-014', removed: true}))).status === 'invalid_event');

    // 6. Policies: a read-only profile, and a task that forbids exactly one patch key.
    const restricted = policies();
    restricted.sandbox.constraints = {'ribbonwell.claims.update': {fields: ['quantity', 'reserved_until', 'note', 'for_exchange_id']}, 'ribbonwell.items.add': {ids: ['lst-leela-family']}};
    await infra.call('env.load_seed', {expected_version: await version(), request_id: 'task-seed-2', data: seed(), binding: binding(), policies: restricted, virtual_now: NOV23});
    const held = await write('claims.reserve', {id: train});
    check('A task can forbid marking a claim purchased (the status key)', (await write('claims.update', {id: held.id, patch: {status: 'purchased'}})).status === 'permission_denied');
    check('…while other keys of the same tool stay allowed', (await write('claims.update', {id: held.id, patch: {note: 'Ask first.'}})).status === 'committed');
    check('A task can limit additions to one named list', (await write('items.add', {id: 'lst-priya-family', item: {name: 'Not allowed here'}})).status === 'permission_denied' && (await write('items.add', {id: 'lst-leela-family', item: {name: 'Allowed here'}})).status === 'committed');
    const browse = await open('infra', 'browse', {initialProfile: 'scenario'}), reader = await open('agent', 'browse');
    check('The scenario profile lists reads only', (await reader.request('tools/list')).result.tools.every(t => t.annotations.readOnlyHint === true));
    check('…and denies a write', (await reader.call(APP + '.items.add', {id: 'lst-priya-family', item: {name: 'X'}, expected_version: (await snap(browse)).version, request_id: 'w1'})).status === 'permission_denied');

    // 7. Reset restores the most recently loaded seed and its time, twenty times over.
    const loadedBaseline = hash(seed());
    for (let i = 0; i < 20; i++) {
      await write('items.add', {id: 'lst-leela-family', item: {name: 'Cycle ' + i}});
      await advance('2026-11-2' + (4 + i % 5) + 'T0' + (i % 9) + ':00:00-05:00').catch(() => {});
      const r = await infra.call('env.reset', {expected_version: await version()});
      assert.equal(r.status, 'ready');
      const s = (await snap()).snapshot;
      assert.equal(hash(s.data), loadedBaseline); assert.equal(s.virtual_now, NOV23); assert.deepEqual(s.audit.map(a => a.tool), ['env.reset']);
    }
    check('Twenty reset cycles each restore the loaded data and clock and clear the earlier audit rows');
    check('Runs are isolated: another run still holds its own data', hash((await snap(browse)).snapshot.data) === hash(seed()));

    // 8. Records dated after the clock are delivered as events and cannot be read before their time.
    const schedule = require('../fixtures/schedules/late-2026.json'), later = await open('infra', 'later', {initialProfile: 'sandbox'}), early2 = await open('agent', 'later');
    const firstItem = schedule.find(e => e.operation === APP + '.item.added'), lastItem = schedule.filter(e => e.operation === APP + '.item.added').at(-1);
    const notesBefore = (await early2.call(APP + '.notifications.list', {limit: 1})).total;
    check('At the clock, an item the schedule adds later cannot be read or found', (await early2.call(APP + '.items.get', {id: lastItem.payload.item.item_id})).status === 'not_found' &&
      !(await early2.call(APP + '.lists.get', {id: lastItem.payload.list_id})).items.some(i => i.item_id === lastItem.payload.item.item_id));
    let appliedAll = true, seenFirst = null;
    for (const e of schedule) { appliedAll = appliedAll && (await event(e, later)).status === 'committed';
      if (e === firstItem) seenFirst = [(await early2.call(APP + '.items.get', {id: firstItem.payload.item.item_id})).item.name, (await early2.call(APP + '.items.get', {id: lastItem.payload.item.item_id})).status]; }
    check('All ' + schedule.length + ' scheduled events from 19 November to 31 December 2026 apply in order', appliedAll);
    check('Each scheduled item appears when its own event runs, not before', seenFirst[0] === firstItem.payload.item.name && seenFirst[1] === 'not_found' && (await early2.call(APP + '.items.get', {id: lastItem.payload.item.item_id})).item.name === lastItem.payload.item.name);
    check('The schedule adds notifications dated after the clock', (await early2.call(APP + '.notifications.list', {limit: 1})).total > notesBefore && (await snap(later)).snapshot.virtual_now >= schedule.at(-1).at.slice(0, 10));
    console.log(JSON.stringify({app: APP, runtime: require(path.join(path.resolve(runtime), 'package.json')).version, node: process.version, passed: true, checks}, null, 2));
  } catch (e) { console.error(JSON.stringify({app: APP, passed: false, completed: checks.length, error: e.message}, null, 2)); process.exitCode = 1; }
  finally { await Promise.allSettled(clients.map(c => c.close())); fs.rmSync(stateDir, {recursive: true, force: true}); }
})();
