#!/usr/bin/env node
'use strict';
// Real-MCP checks on the public runtime for what the public verifier does not exercise.
// Needs the PALE checkout (or PALE_RUNTIME_ROOT); the App-only tests do not.
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
let root = __dirname, runtime = process.env.PALE_RUNTIME_ROOT;
if (!runtime) { while (!fs.existsSync(path.join(root, 'runtime/launch.cjs'))) { const parent = path.dirname(root); if (parent === root) throw Error('Run inside the public PALE checkout, or set PALE_RUNTIME_ROOT.'); root = parent; } runtime = path.join(root, 'runtime'); }
const {Client} = require(path.join(path.resolve(runtime), 'client.cjs'));
const derive = require('../src/derive.cjs');
const registry = path.resolve(__dirname, '../registry.json'), APP = 'lanternbox';
const seed = () => structuredClone(require('../fixtures/minimal.json')), binding = () => structuredClone(require('../fixtures/binding.json')), policies = () => structuredClone(require('../fixtures/policies.json'));
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const checks = [], clients = [];
const check = (name, ok = true) => { assert.ok(ok, name); checks.push(name); };
const NOV19 = '2026-11-19T10:00:00-05:00', PAID_THROUGH = '2026-12-03T00:00:00-05:00', NEXT_PERIOD = '2027-01-03T00:00:00-05:00';

(async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanternbox-mcp-'));
  const open = async (role, run, options = {}) => { const c = new Client(APP, role, run, stateDir, 'lanternbox-integration', {registry, ...options}); clients.push(c); await c.initialize(); return c; };
  try {
    const infra = await open('infra', 'main', {initialProfile: 'sandbox'}), agent = await open('agent', 'main');
    const snap = async (c = infra) => c.call('env.snapshot');
    const version = async (c = infra) => (await snap(c)).version;
    let n = 0;
    const write = async (name, args = {}, c = agent, i = infra) => c.call(APP + '.' + name, {...args, expected_version: await version(i), request_id: 'req-' + (++n)});
    const read = (name, args = {}, c = agent) => c.call(APP + '.' + name, args);
    const advance = async (to, c = infra) => c.call('env.advance_time', {expected_version: (await snap(c)).version, virtual_now: to, request_id: 'clock-' + (++n)});
    const event = async (e, c = infra) => c.call('env.apply_event', {expected_version: (await snap(c)).version, event: e});
    const ev = (event_id, at, operation, payload) => ({event_id, at, operation: APP + '.' + operation, payload});
    const load = async (c, options = {}) => c.call('env.load_seed', {expected_version: (await snap(c)).version, request_id: 'task-seed-' + (++n), data: seed(), binding: binding(), policies: policies(), virtual_now: NOV19, ...options});
    const account = async (c = agent) => (await read('account.get', {}, c)).account;

    // 1. A task loads its own household with its own clock.
    const loaded = await load(infra);
    check('A task seed loads with its own clock', loaded.status === 'ready' && (await read('account.get')).now === NOV19);
    const early = seed(); early.history[0].started_at = '2024-12-31T18:59:59-05:00';
    check('A viewing dated before 2025-01-01 is refused', (await infra.call('env.load_seed', {expected_version: await version(), data: early})).status === 'invalid_seed');
    const late = seed(); late.watchlist[0].added_at = '2026-11-19T10:00:01-05:00';
    check('A record dated after the loaded clock is refused', (await infra.call('env.load_seed', {expected_version: await version(), data: late})).status === 'invalid_seed');
    const other = binding(); other.accounts[0].owner_person_id = 'person-dele';
    check('A seed whose owner profile is not the account owner in the binding is refused', (await infra.call('env.load_seed', {expected_version: await version(), data: seed(), binding: other})).status === 'invalid_seed');
    const baseline = (await snap()).snapshot.data;
    check('Refused loads leave the loaded baseline unchanged', hash(baseline) === hash(seed()));

    // 2. Agent against Infra authority.
    for (const tool of ['env.apply_event', 'env.reset', 'env.snapshot', 'env.advance_time', 'env.load_seed'])
      check('The Agent calling ' + tool + ' gets permission_denied', (await agent.call(tool, {})).status === 'permission_denied');
    const listed = (await agent.request('tools/list')).result.tools.map(t => t.name);
    check('The Agent connection lists the 23 operations and no env.* tool', listed.length === 23 && listed.every(name => name.startsWith('lanternbox.')));

    // 3. Writes, replays, conflicts and stale versions.
    const v0 = await version(), args = {id: 'prof-dele', title_id: 'ttl-paper-kites', expected_version: v0, request_id: 'list-1'};
    const first = await agent.call(APP + '.watchlist.add', args);
    check('A write commits and returns the object ID with the committed version', first.status === 'committed' && first.id === 'prof-dele' && first.title_id === 'ttl-paper-kites' && first.version.revision === v0.revision + 1);
    const afterFirst = await snap();
    const replay = await agent.call(APP + '.watchlist.add', args);
    check('An exact repeat returns the stored receipt marked duplicate', replay.duplicate === true && replay.title_id === first.title_id);
    check('A replay has no second effect and leaves no audit row', hash((await snap()).snapshot.data) === hash(afterFirst.snapshot.data) && (await snap()).snapshot.audit.length === afterFirst.snapshot.audit.length);
    check('The same request_id with different input is an idempotency_conflict', (await agent.call(APP + '.watchlist.add', {...args, title_id: 'ttl-marigold-station'})).status === 'idempotency_conflict');
    check('A stale expected_version is refused', (await agent.call(APP + '.watchlist.remove', {id: 'prof-dele', title_id: 'ttl-paper-kites', expected_version: v0, request_id: 'stale-1'})).status === 'stale_version');
    const refused = await write('watchlist.add', {id: 'prof-timi', title_id: 'ttl-salt-on'});
    check('A business refusal carries its code and changes nothing', refused.status === 'restricted' && refused.applied === false && hash((await snap()).snapshot.data) === hash(afterFirst.snapshot.data));
    const audit = (await snap()).snapshot.audit;
    check('Refused calls are counted from deny audit rows and their reasons', ['idempotency_conflict', 'stale_version', 'restricted'].every(r => audit.some(a => a.decision === 'deny' && a.reason === r)));
    check('An audit row carries no arguments and no request ID', audit.every(a => !('arguments' in a) && !('args' in a) && !('request_id' in a)));
    const row = (await snap()).snapshot.data.activity.at(-1);
    check('The activity row joins a write to the Agent trace by request_id', row.request_id === 'list-1' && row.action === 'watchlist.add' && row.object_id === 'ttl-paper-kites' && row.profile_id === 'prof-dele');
    const before = await snap();
    await read('history.list', {id: 'prof-sana'}); await read('catalog.search', {query: 'harbor'});
    const afterReads = await snap();
    check('Reads leave business data and version unchanged and add allow audit rows', hash(afterReads.snapshot.data) === hash(before.snapshot.data) && afterReads.version.revision === before.version.revision && afterReads.snapshot.audit.length === before.snapshot.audit.length + 2);

    // 4. A profile deletion: the counts are in the result and in the activity row of the snapshot.
    const counts = (await read('profiles.get', {id: 'prof-bisi'})).counts, held = (await snap()).snapshot.data;
    const gone = await write('profiles.delete', {id: 'prof-bisi'});
    const left = (await snap()).snapshot.data, deletion = left.activity.at(-1);
    check('The rows actually removed from the snapshot are the profile\'s own: 31 viewings, 9 progress rows, 4 list entries', held.history.length - left.history.length === 31 && held.progress.length - left.progress.length === 9 &&
      held.watchlist.length - left.watchlist.length === 4 && ![...left.history, ...left.progress, ...left.watchlist, ...left.profiles].some(r => r.profile_id === 'prof-bisi'));
    check('profiles.delete returns the removed counts that profiles.get announced', gone.status === 'committed' && JSON.stringify(gone.removed) === JSON.stringify({history_rows: 31, progress_rows: 9, watchlist_entries: 4}) && JSON.stringify(counts) === JSON.stringify(gone.removed));
    check('The same counts are in the activity row', JSON.stringify(deletion.removed) === JSON.stringify(gone.removed) && deletion.action === 'profiles.delete' && deletion.object_id === 'prof-bisi');

    const viewings = left.history.length, marked = await write('progress.set', {id: 'prof-dele', playable_id: 'ep-harbor-s2e03', patch: {position_seconds: 0}});
    const mark = (await snap()).snapshot.data;
    check('progress.set records the value it replaced and adds no viewing row', marked.status === 'committed' && mark.history.length === viewings && mark.activity.at(-1).replaced.completed === true && mark.activity.at(-1).replaced.set_by === 'playback' &&
      mark.progress.find(r => r.profile_id === 'prof-dele' && r.playable_id === 'ep-harbor-s2e03').set_by === 'agent');

    // 5. An event reaches a profile the Agent created; no match is rejected and changes nothing.
    const view = (id, at, name) => ev(id, at, 'playback.recorded', {profile_name: name, device_id: 'dev-kids-tablet', playable_id: 'ttl-otter-club', started_at: '2026-11-21T16:00:00-05:00', position_seconds: 1200, completed: false});
    const ola = await write('profiles.create', {profile: {name: 'Ola', kind: 'kids'}});
    const applied = await event(view('ev-ola-1', '2026-11-21T16:20:00-05:00', 'Ola'));
    const after = (await snap()).snapshot.data;
    check('A prewritten viewing reaches an Agent-created profile by its name', ola.id === 'prof-r1' && applied.status === 'committed' && after.history.at(-1).profile_id === 'prof-r1' && after.progress.some(r => r.profile_id === 'prof-r1' && r.set_by === 'playback'));
    const beforeMiss = await snap();
    const miss = await event(view('ev-ola-2', '2026-11-21T17:00:00-05:00', 'Olu'));
    check('An event naming no profile is invalid_event and leaves state and clock unchanged', miss.status === 'invalid_event' && hash((await snap()).snapshot.data) === hash(beforeMiss.snapshot.data) && (await snap()).snapshot.virtual_now === beforeMiss.snapshot.virtual_now);
    check('Infra reads the committed event with env.event_status', (await infra.call('env.event_status', {event_id: 'ev-ola-1'})).receipt.status === 'committed');
    check('An exact repeat of an applied event is a duplicate with no second row', (await event(view('ev-ola-1', '2026-11-21T16:20:00-05:00', 'Ola'))).duplicate === true && (await snap()).snapshot.data.history.length === after.history.length);
    check('An event dated before the current time is refused by Core', (await event(view('ev-old', '2026-11-20T00:00:00-05:00', 'Ola'))).status === 'invalid_event');

    // 6. Plan and billing by time: nothing is rewritten, the clock raises the revision, one jump equals small steps.
    await write('profiles.delete', {id: 'prof-r1'}); await write('profiles.delete', {id: 'prof-timi'});
    const change = await write('plan.change', {id: 'basic'});
    check('A downgrade is stored as pending, due at paid_through', change.status === 'committed' && change.effect === 'downgrade_pending' && change.effective_at === PAID_THROUGH && (await account()).plan_id === 'standard');
    check('A second pending change replaces the first: one change can be pending', (await write('plan.cancel')).status === 'committed' && (await account()).pending.kind === 'cancel' && (await write('plan.resume')).cleared === 'cancel' && (await account()).pending === null);
    await write('plan.change', {id: 'basic'});
    const beforeClock = await snap(), tin = async () => (await read('titles.get', {title_id: 'ttl-tin-roof', id: 'prof-sana'})).title.availability;
    check('Before its end date a title reads leaving_soon', await tin() === 'leaving_soon');
    check('env.advance_time commits', (await advance('2026-12-02T23:59:59-05:00')).status === 'committed');
    check('Once the clock has passed available_until, titles.get reads expired with no event', await tin() === 'expired');
    check('One second before paid_through the account reads active on standard', (await account()).status === 'active' && (await account()).plan_id === 'standard');
    check('A write prepared before the clock moved is stale', (await agent.call(APP + '.plan.resume', {expected_version: beforeClock.version, request_id: 'old-form'})).status === 'stale_version');
    await advance(PAID_THROUGH);
    const due = await account();
    check('At exactly paid_through, with no charge, the downgrade is in effect and the account reads past_due', due.plan_id === 'basic' && due.status === 'past_due' && due.suspends_at === '2026-12-10T00:00:00-05:00' && due.next_charge.amount_cents === 999);
    const afterClock = await snap();
    check('Time alone rewrites no business data: no notification and no activity row', hash(afterClock.snapshot.data) === hash(beforeClock.snapshot.data));
    const view2 = derive.account(afterClock.snapshot.data, afterClock.snapshot.virtual_now);
    check('The snapshot keeps the stored plan; src/derive.cjs gives a grader what the reads return', afterClock.snapshot.data.account.plan_id === 'standard' && view2.plan_id === 'basic' && view2.status === 'past_due');
    await advance('2026-12-10T00:00:00-05:00');
    check('Seven days later, with no App event, the account reads suspended', (await account()).status === 'suspended' && hash((await snap()).snapshot.data) === hash(beforeClock.snapshot.data));
    const blocked = await write('watchlist.add', {id: 'prof-dele', title_id: 'ttl-marigold-station'});
    check('A write on a suspended account is account_inactive; reads still work', blocked.status === 'account_inactive' && (await read('watchlist.list', {id: 'prof-dele'})).status === 'ok');
    const paid = await event(ev('ev-paid', '2026-12-11T09:00:00-05:00', 'billing.charged', {period_start: PAID_THROUGH, period_end: NEXT_PERIOD, amount_cents: 999, result: 'paid'}));
    const settled = (await snap()).snapshot.data;
    check('A paid charge returns the account to active and stores the downgrade with one plan.changed notification', paid.status === 'committed' && (await account()).status === 'active' && settled.account.plan_id === 'basic' && settled.account.pending === null &&
      settled.notifications.filter(x => x.kind === 'plan.changed').length === 1);
    check('A charge for the wrong period is invalid_event', (await event(ev('ev-wrong', '2026-12-12T09:00:00-05:00', 'billing.charged', {period_start: PAID_THROUGH, period_end: NEXT_PERIOD, amount_cents: 999, result: 'paid'}))).status === 'invalid_event');
    const jump = await open('infra', 'jump', {initialProfile: 'sandbox'}), steps = await open('infra', 'steps', {initialProfile: 'sandbox'});
    for (const c of [jump, steps]) await load(c);
    await advance('2026-12-25T00:00:00-05:00', jump);
    for (let day = 20; day <= 30; day++) await advance('2026-11-' + day + 'T00:00:00-05:00', steps);
    for (let day = 1; day <= 25; day++) await advance('2026-12-' + String(day).padStart(2, '0') + 'T00:00:00-05:00', steps);
    const viewer = await open('agent', 'jump'), stepper = await open('agent', 'steps');
    check('One clock jump and 36 daily steps leave identical business data', hash((await snap(jump)).snapshot.data) === hash((await snap(steps)).snapshot.data) && hash((await snap(jump)).snapshot.data) === hash(seed()));
    const same = async (name, a = {}) => JSON.stringify({...(await read(name, a, viewer)), version: null}) === JSON.stringify({...(await read(name, a, stepper)), version: null});
    check('…and identical readings: the account is suspended and three titles read expired', await same('account.get') && await same('catalog.search', {limit: 100}) && (await account(viewer)).status === 'suspended' &&
      (await read('catalog.search', {availability: 'expired'}, viewer)).total === 3);

    // 7. Policies: a read-only profile, and a task that allows writes on one profile only.
    const narrow = policies(), mine = {ids: ['prof-sana']};
    narrow.sandbox.constraints = {'lanternbox.watchlist.add': mine, 'lanternbox.watchlist.remove': mine, 'lanternbox.progress.set': mine, 'lanternbox.history.hide': mine, 'lanternbox.profiles.delete': {ids: []},
      'lanternbox.profiles.update': {ids: ['prof-sana'], fields: ['autoplay', 'notify_new_episodes', 'notify_leaving']}, 'lanternbox.history.list': mine, 'lanternbox.plan.change': {ids: ['premium']}};
    await load(infra, {policies: narrow});
    check('With writes allowed on one profile, the same write on another profile is permission_denied', (await write('watchlist.add', {id: 'prof-dele', title_id: 'ttl-paper-kites'})).status === 'permission_denied' &&
      (await write('progress.set', {id: 'prof-dele', playable_id: 'ep-harbor-s2e04', patch: {completed: true}})).status === 'permission_denied');
    check('…and it commits on the allowed profile', (await write('watchlist.add', {id: 'prof-sana', title_id: 'ttl-marigold-station'})).status === 'committed' &&
      (await write('progress.set', {id: 'prof-sana', playable_id: 'ttl-paper-kites', patch: {position_seconds: 300}})).status === 'committed');
    check('profiles.update passes its changes in patch, so a task can allow some settings and not the ceiling or the name', (await write('profiles.update', {id: 'prof-sana', patch: {autoplay: false}})).status === 'committed' &&
      (await write('profiles.update', {id: 'prof-sana', patch: {maturity_ceiling: '13+'}})).status === 'permission_denied' && (await write('profiles.update', {id: 'prof-timi', patch: {autoplay: true}})).status === 'permission_denied');
    check('A task can forbid every profile deletion and allow only the upgrade', (await write('profiles.delete', {id: 'prof-bisi'})).status === 'permission_denied' && (await write('plan.change', {id: 'basic'})).status === 'permission_denied' &&
      (await write('plan.change', {id: 'premium'})).status === 'committed');
    check('The same narrowing works for a read: another profile\'s history is permission_denied', (await read('history.list', {id: 'prof-dele'})).status === 'permission_denied' && (await read('history.list', {id: 'prof-sana'})).status === 'ok');
    const data = (await snap()).snapshot.data;
    check('Denied calls changed nothing on the other profiles', hash(data.profiles.filter(p => p.profile_id !== 'prof-sana')) === hash(seed().profiles.filter(p => p.profile_id !== 'prof-sana')) && data.watchlist.filter(w => w.profile_id === 'prof-dele').length === 6);
    const browse = await open('infra', 'browse', {initialProfile: 'scenario'}), reader = await open('agent', 'browse');
    check('The scenario profile lists reads only', (await reader.request('tools/list')).result.tools.every(t => t.annotations.readOnlyHint === true));
    check('…and denies a write', (await reader.call(APP + '.watchlist.add', {id: 'prof-sana', title_id: 'ttl-marigold-station', expected_version: (await snap(browse)).version, request_id: 'w1'})).status === 'permission_denied');

    // 8. Reset restores the most recently loaded seed and its time, twenty times over.
    await load(infra);
    const loadedBaseline = hash(seed());
    for (let i = 0; i < 20; i++) {
      await write('watchlist.add', {id: 'prof-dele', title_id: 'ttl-paper-kites'});
      if (i % 2) await write('profiles.delete', {id: 'prof-bisi'});
      await advance('2026-11-2' + (i % 9) + 'T0' + (i % 9) + ':00:00-05:00');
      const r = await infra.call('env.reset', {expected_version: await version()});
      assert.equal(r.status, 'ready');
      const s = (await snap()).snapshot;
      assert.equal(hash(s.data), loadedBaseline); assert.equal(s.virtual_now, NOV19); assert.deepEqual(s.audit.map(a => a.tool), ['env.reset']);
    }
    check('Twenty reset cycles each restore the loaded data and clock and clear the earlier audit rows');
    check('Runs are isolated: another run still holds its own data', hash((await snap(browse)).snapshot.data) === hash(seed()));
    console.log(JSON.stringify({app: APP, runtime: require(path.join(path.resolve(runtime), 'package.json')).version, node: process.version, passed: true, checks}, null, 2));
  } catch (e) { console.error(JSON.stringify({app: APP, passed: false, completed: checks.length, last: checks.at(-1), error: e.message}, null, 2)); process.exitCode = 1; }
  finally { await Promise.allSettled(clients.map(c => c.close())); fs.rmSync(stateDir, {recursive: true, force: true}); }
})();
