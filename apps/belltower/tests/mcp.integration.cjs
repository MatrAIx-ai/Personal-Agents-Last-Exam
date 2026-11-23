#!/usr/bin/env node
'use strict';
// Real-MCP checks on the public reference runtime, for what the common verifier does not
// exercise for this App: every tool through MCP with its declared output schema, Core
// contracts (T17), failure atomicity, replays and how they are counted, policy narrowing,
// the audit projection, time moved with Core's env.advance_time and no App event (T16),
// a task seed with its own virtual_now, and reset to the loaded seed and time (T18).
//
//   node tests/mcp.integration.cjs --runtime DIR [--report FILE]
//
// DIR is the `runtime` directory of a public PALE checkout, 1.6.0 or later (the clock
// operation). PALE_RUNTIME_ROOT=DIR works too. Nothing else outside this package is read.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const appDir = path.resolve(__dirname, '..');
const sender = require('../infra/sender.cjs');

function options() {
  const out = { runtime: process.env.PALE_RUNTIME_ROOT };
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i], value = process.argv[i + 1];
    if (!['--runtime', '--report'].includes(key) || !value) return null;
    out[key.slice(2)] = value;
  }
  return out.runtime ? out : null;
}
function runtimeAt(dir) {
  const root = path.resolve(dir);
  try { const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); return pkg.name === '@pale/app-runtime' ? { root, version: pkg.version } : null; } catch { return null; }
}
const opts = options(), runtime = opts && runtimeAt(opts.runtime);
if (!runtime) {
  console.error('Usage: node tests/mcp.integration.cjs --runtime DIR [--report FILE]\nDIR must be the runtime directory of a public PALE checkout (package @pale/app-runtime).');
  process.exit(2);
}
const { prepare } = require(path.join(runtime.root, 'prepare.cjs')), { Client } = require(path.join(runtime.root, 'client.cjs'));
const A = 'belltower.';
const at = (date, hhmm) => date + 'T' + hhmm + (hhmm.length === 5 ? ':00' : '') + '-06:00';
const clone = x => structuredClone(x);
const TUE = '2026-11-17', WED = '2026-11-18', SAT = '2026-11-21';
const BRIDGE = 'it-roads-0031', LIBRARY = 'it-city-0207', BOIL = 'it-water-0112', CLINIC = 'it-cour-0907', MAIN = 'it-water-0115', COPY = 'it-round-5521';
const MB = 'ar-millbrook', MN = 'ar-millbrook-north', OQ = 'ar-old-quay';

async function main() {
  const prepared = prepare(appDir), clients = [], checks = [], started = Date.now();
  const check = (name, ok) => { assert.ok(ok, name); checks.push(name); };
  const equal = (name, actual, expected) => { assert.deepEqual(actual, expected, name); checks.push(name); };
  const client = async (role, run = 'integration') => { const c = new Client(prepared.app, role, run, path.join(prepared.root, 'state'), 'belltower-integration', { registry: prepared.registry }); clients.push(c); await c.initialize(); return c; };
  try {
    const infra = await client('infra'), agent = await client('agent');
    const snap = async () => (await infra.call('env.snapshot'));
    const state = async () => (await snap()).snapshot;
    const version = async () => (await snap()).version;
    let n = 0;
    const write = async (name, args) => agent.call(A + name, { ...args, request_id: 'int-' + (++n), expected_version: await version() });
    const read = async (name, args = {}) => agent.call(A + name, args);
    const event = async e => infra.call('env.apply_event', { expected_version: await version(), event: e });
    const ev = (id, when, name, payload) => ({ event_id: id, at: when, operation: A + name, payload });
    const revision = (number, when, more = {}) => ({ number, published_at: when, headline: 'Integration headline ' + number, body: 'Integration body ' + number + '.', topics: ['libraries'], area_ids: [OQ], priority: 'routine', ...more });
    const advance = async (request_id, virtual_now) => infra.call('env.advance_time', { request_id, expected_version: await version(), virtual_now });
    const itemOf = async (id, number) => (await read('items.get', number === undefined ? { id } : { id, revision: number })).item;
    const notes = async (args = {}) => (await read('notifications.list', { limit: 100, ...args })).notifications.reverse();
    const proposal = id => clone(require('./proposal-events.json').find(e => e.event_id === id));

    // The App-only tests validate with a vendored copy of the host's schema validator.
    check('tests/schema-validator.cjs is identical to the validator of this runtime', fs.readFileSync(path.join(appDir, 'tests/schema-validator.cjs')).equals(fs.readFileSync(path.join(runtime.root, 'contracts/schema-validator.cjs'))));

    // Discovery and policy narrowing under the default `scenario` profile.
    const scenarioTools = (await agent.request('tools/list')).result.tools.map(t => t.name);
    equal('scenario profile lists the 9 reads and 5 of the 8 writes', [scenarioTools.length, scenarioTools.filter(x => x.startsWith('env.')).length, scenarioTools.includes(A + 'follows.create'), scenarioTools.includes(A + 'clippings.update')], [14, 0, false, true]);
    const infraTools = (await infra.request('tools/list')).result.tools.map(t => t.name).filter(x => x.startsWith('env.')).sort();
    check('the host offers its clock operation on the Infra connection (runtime 1.6.0 or later)', infraTools.includes('env.advance_time'));
    check('a write outside the scenario profile is denied', (await write('follows.create', { topics: ['weather'], delivery: 'digest' })).status === 'permission_denied');
    check('an item outside the policy ids cannot be marked', (await write('reading.mark', { id: MAIN })).status === 'permission_denied');
    check('a clipping outside the policy ids cannot be changed', (await write('clippings.update', { id: 'clp-0001', patch: { note: 'Not this one.' } })).status === 'permission_denied');
    check('a rule outside the policy ids cannot be changed', (await write('follows.update', { id: 'fl-0003', patch: { paused: true } })).status === 'permission_denied');
    const marked = await write('reading.mark', { id: BRIDGE });
    equal('the allowed item is marked at its latest revision', [marked.status, marked.id, marked.mark.revision, marked.mark.read_at], ['committed', BRIDGE, 2, at(TUE, '17:00')]);
    check('a field outside the policy fields is denied', (await write('clippings.update', { id: 'clp-0004', patch: { revision: 2, watch: true } })).status === 'permission_denied');
    const movedClip = await write('clippings.update', { id: 'clp-0004', patch: { revision: 2, note: 'Library shuts at 19:00. Meet at 18:00.' } });
    equal('the allowed fields commit: the clipping moves to revision 2 and keeps revision 1 in its history', [movedClip.status, movedClip.clipping.revision, movedClip.clipping.is_current, movedClip.clipping.history.map(v => [v.revision, v.request_id])], ['committed', 2, true, [[1, 'int-' + n]]]);
    check('a preference outside the policy fields is denied', (await write('preferences.update', { patch: { corrections: 'immediate', email_notices: false } })).status === 'permission_denied');
    check('the allowed preference commits', (await write('preferences.update', { patch: { corrections: 'immediate' } })).status === 'committed');
    check('the allowed rule field commits', (await write('follows.update', { id: 'fl-0004', patch: { paused: true } })).status === 'committed');
    for (const name of ['env.apply_event', 'env.reset', 'env.load_seed', 'env.snapshot', 'env.advance_time']) check('Agent cannot call ' + name, (await agent.call(name, {})).status === 'permission_denied');

    // Every tool once through real MCP under `sandbox`; Core validates each result against tools.json.
    check('reset to the sandbox profile', (await infra.call('env.reset', { expected_version: await version(), profile: 'sandbox' })).status === 'ready');
    const baseline = await state();
    const all = (await agent.request('tools/list')).result.tools;
    equal('sandbox profile lists all 17 tools', [all.length, all.filter(t => t.annotations.readOnlyHint).length], [17, 9]);
    const reads = [
      ['sources.list', {}], ['sources.list', { kind: 'aggregator' }], ['areas.list', {}], ['areas.list', { id: MB }], ['items.list', {}], ['items.list', { query: 'Kestrel Thursday' }], ['items.list', { start: at(TUE, '00:00'), end: at(WED, '00:00') }],
      ['items.list', { area_id: MN, min_priority: 'urgent' }], ['items.list', { changed_since_read: true, limit: 100 }], ['items.get', { id: BRIDGE }], ['items.get', { id: BRIDGE, revision: 1 }], ['items.get', { id: 'it-cour-0893' }], ['items.get', { id: BOIL }],
      ['follows.list', {}], ['reading.list', { id: BOIL }], ['clippings.list', {}], ['notifications.list', { limit: 100 }], ['notifications.list', { state: 'held' }], ['preferences.get', {}],
      ['notifications.list', { start: at(TUE, '00:00'), end: at(WED, '00:00') }],
    ];
    const timings = [], results = [];
    for (const [name, args] of reads) { const t0 = Date.now(), r = await read(name, args); timings.push(Date.now() - t0); results.push(r); check('read ' + name + ' ' + JSON.stringify(args) + ' returns ok', r.status === 'ok' && r.app_id === 'belltower'); }
    equal('the fixture through MCP: six sources, nine areas, a first page of twenty of 48 items', [results[0].sources.length, results[1].sources.length, results[2].areas.length, results[3].areas.length, results[4].items.length, results[4].next_cursor], [6, 2, 9, 3, 20, '20']);
    equal('the word of the corrected claim is found in revision 1 of the bridge notice', results[5].items.map(i => [i.id, i.revision, i.matched_revisions]), [[BRIDGE, 2, [1]]]);
    equal('the acceptance example of W2: revision 2 by default with the publisher\'s note, revision 1 by number', [results[9].item.revision, results[9].item.is_latest, results[9].item.type, results[9].item.note.startsWith('An earlier version gave the wrong start day.'), results[9].item.revisions.length, results[10].item.revision, results[10].item.is_latest, results[10].item.headline],
      [2, true, 'correction', true, 2, 1, false, 'Kestrel Bridge closed for deck repairs from Thursday']);
    equal('a retracted item has no body and keeps its note; the boil-water notice lists four references', [results[11].item.status, results[11].item.body, results[11].item.note !== null, results[12].item.referenced_by.length], ['retracted', null, true, 4]);
    equal('the account through MCP: 5 rules, 3 marks of the notice, 4 clippings, 12 notifications of which one is held', [results[13].follows.length, results[14].marks.length, results[15].clippings.length, results[16].notifications.length, results[17].notifications.map(x => x.id)], [5, 3, 4, 12, ['ntf-0011']]);
    equal('a window over the creation time of notifications: the two written on Tuesday, newest first', results[19].notifications.map(x => [x.id, x.created_at]), [['ntf-0012', at(TUE, '16:30')], ['ntf-0011', at(TUE, '11:20')]]);
    const afterReads = await state();
    equal('reads leave business data and the version unchanged, and no read mark appears', [afterReads.data, afterReads.revision, afterReads.data.read_marks.length], [baseline.data, baseline.revision, 14]);
    equal('each allowed read has one audit row', afterReads.audit.slice(-reads.length).map(r => [r.tool, r.decision]), reads.map(([name]) => [A + name, 'allow']));

    const writes = [
      await write('follows.create', { area_ids: [MN], delivery: 'immediate' }),
      await write('preferences.update', { patch: { digest_time: '19:00' } }),
      await write('reading.mark', { id: LIBRARY }),
      await write('clippings.add', { id: BRIDGE, note: 'Early shift on Thursday.', linked_object: { app_id: 'calendar', object_type: 'event', object_id: 'evt-early-shift-1119' } }),
    ];
    writes.push(await write('follows.update', { id: writes[0].id, patch: { delivery: 'digest', topics: ['roads'] } }), await write('clippings.update', { id: writes[3].id, patch: { watch: true } }));
    writes.push(await write('clippings.remove', { id: writes[3].id }), await write('follows.remove', { id: writes[0].id }));
    equal('all eight writes commit through MCP', writes.map(w => w.status), Array(8).fill('committed'));
    equal('a committed write returns the object ID and the new version', [writes.map(w => w.id), writes[7].version.revision === (await version()).revision], [['fl-0006', 'belltower-dana', LIBRARY, 'clp-0005', 'fl-0006', 'clp-0005', 'clp-0005', 'fl-0006'], true]);
    const after = await state();
    equal('each committed write added one activity row with its request_id', after.data.activity.slice(-8).map(a => [a.actor, a.action, a.request_id]), ['follows.create', 'preferences.update', 'reading.mark', 'clippings.add', 'follows.update', 'clippings.update', 'clippings.remove', 'follows.remove'].map((x, i) => ['agent', x, 'int-' + (n - 7 + i)]));
    equal('the removed rule and clipping are gone, and their IDs stay retired', [(await read('follows.list')).follows.length, (await read('clippings.list')).clippings.length, (await write('clippings.add', { id: BRIDGE })).id], [5, 4, 'clp-0006']);

    // T17: Core contracts, and how a replay and a rejection appear in the evaluator records.
    const v = await version(), ask = { id: CLINIC, revision: 1, request_id: 'same-request', expected_version: v };
    const beforeMark = await state();
    const firstTry = await agent.call(A + 'reading.mark', ask);
    check('marking a revision that is already marked is refused', firstTry.status === 'already_read' && firstTry.applied === false);
    const rule = { topics: ['weather'], delivery: 'digest', request_id: 'same-request-2', expected_version: v };
    const first = await agent.call(A + 'follows.create', rule), once = await state();
    const again = await agent.call(A + 'follows.create', rule), twice = await state();
    check('a repeated request_id returns the stored receipt', first.status === 'committed' && again.duplicate === true && again.version.revision === first.version.revision && again.id === first.id && again.follow.state === 'active');
    equal('the replay wrote nothing: no second rule, same version, no activity row and no audit row', [twice.data.follows.length, twice.revision, twice.data.activity.length, twice.audit.length], [once.data.follows.length, once.revision, once.data.activity.length, once.audit.length]);
    check('the same request_id with different input is rejected', (await agent.call(A + 'follows.create', { ...rule, topics: ['power'] })).status === 'idempotency_conflict');
    const stale = await agent.call(A + 'follows.remove', { id: first.id, request_id: 'stale-1', expected_version: v });
    check('a stale version is rejected and names the current one', stale.status === 'stale_version' && stale.applied === false && stale.current_version.revision === first.version.revision);
    check('caller cannot pass role or run', (await agent.call(A + 'preferences.get', { role: 'infra', run_id: 'other' })).status === 'invalid_arguments');
    check('a write without request_id is rejected', (await agent.call(A + 'follows.remove', { id: first.id, expected_version: await version() })).status === 'invalid_arguments');
    check('a write without expected_version is rejected', (await agent.call(A + 'follows.remove', { id: first.id, request_id: 'no-version' })).status === 'invalid_arguments');
    equal('the refused mark of the first attempt left one denial row and no data change', [beforeMark.data.read_marks.length, (await state()).data.read_marks.length, once.audit.at(-2).decision, once.audit.at(-2).reason], [15, 15, 'deny', 'already_read']);

    // Failure atomicity for a tool call and for an event.
    const beforeFail = await state(), failed = await write('clippings.add', { id: LIBRARY });
    const afterFail = await state();
    check('a business failure names its reason and applies nothing', failed.status === 'already_clipped' && failed.applied === false);
    equal('a failed call leaves data and version unchanged and writes no activity row', [afterFail.data, afterFail.revision], [beforeFail.data, beforeFail.revision]);
    equal('Core appended one denial audit row for the rejected attempt', [afterFail.audit.length, afterFail.audit.at(-1).decision, afterFail.audit.at(-1).reason], [beforeFail.audit.length + 1, 'deny', 'already_clipped']);
    const refusals = [];
    for (const [name, a, isWrite] of [['items.get', { id: 'it-nowhere-1' }], ['items.get', { id: BRIDGE, revision: 3 }], ['items.list', { area_id: 'ar-nowhere' }], ['items.list', { start: at(WED, '00:00'), end: at(TUE, '00:00') }], ['items.list', { query: '?!' }],
      ['follows.create', { topics: ['weather'], delivery: 'immediate' }, true], ['follows.create', { delivery: 'digest' }, true], ['follows.update', { id: first.id, patch: {} }, true], ['reading.mark', { id: BOIL }, true],
      ['clippings.update', { id: 'clp-0004', patch: { revision: 1 } }, true], ['clippings.update', { id: 'clp-0004', patch: { revision: 3 } }, true], ['preferences.update', { patch: { timezone: 'Mars/Olympus_Mons' } }, true], ['preferences.update', { patch: { digest_time: '23:00' } }, true]]) {
      refusals.push((isWrite ? await write(name, a) : await read(name, a)).status);
    }
    equal('App errors reach the Agent by name', refusals, ['not_found', 'not_found', 'not_found', 'invalid_window', 'invalid_arguments', 'already_following', 'invalid_arguments', 'invalid_arguments', 'already_read', 'invalid_revision', 'not_found', 'invalid_timezone', 'invalid_arguments']);
    equal('none of them changed data or version', [(await state()).data, (await state()).revision], [beforeFail.data, beforeFail.revision]);
    const scenario = JSON.parse(fs.readFileSync(path.join(appDir, 'examples/scenario.json'), 'utf8'));
    const early = await event({ ...scenario, event_id: 'too-early', at: at(TUE, '16:00'), payload: { ...scenario.payload, revision: { ...scenario.payload.revision, published_at: at(TUE, '16:00') } } });
    check('an event dated before the App clock is rejected', early.status === 'invalid_event' && early.applied === false);
    check('a revision that is not the next one is rejected as invalid_event', (await event(ev('wrong-number', at(TUE, '17:30'), 'item.updated', { item_id: BRIDGE, revision: revision(4, at(TUE, '17:30')) }))).status === 'invalid_event');
    check('a revision of a retracted item is rejected as invalid_event', (await event(ev('after-retraction', at(TUE, '17:30'), 'item.updated', { item_id: 'it-cour-0893', revision: revision(3, at(TUE, '17:30')) }))).status === 'invalid_event');
    check('a basis that does not exist is rejected as invalid_event', (await event(ev('no-basis', at(TUE, '17:30'), 'item.published', { item_id: 'it-test-1', source_id: 'src-roundup', kind: 'article', revision: revision(1, at(TUE, '17:30'), { based_on: { item_id: BRIDGE, revision: 3, relation: 'copy' } }) }))).status === 'invalid_event');
    check('a correction without the publisher\'s note never reaches the App', (await event(ev('no-note', at(TUE, '17:30'), 'item.corrected', { item_id: BRIDGE, revision: revision(3, at(TUE, '17:30')) }))).status === 'invalid_arguments');
    check('Belltower has no clock event: such an operation is rejected', (await event(ev('no-clock-event', at(TUE, '19:00'), 'clock.advanced', {}))).status !== 'committed');
    const afterRejected = await state();
    equal('rejected events leave data and the clock unchanged', [afterRejected.data, afterRejected.virtual_now], [afterFail.data, afterFail.virtual_now]);

    // An event through MCP: handled at its own time, with a receipt and the audit projection.
    const applied = await event(scenario), stored = await state();
    check('the declared event commits and moves the clock to its own time', applied.status === 'committed' && stored.virtual_now === scenario.at);
    equal('the event receipt is queryable', (await infra.call('env.event_status', { event_id: scenario.event_id })).receipt.event_id, scenario.event_id);
    const copy = await itemOf(COPY), original = await itemOf(BRIDGE), held = (await notes()).at(-1);
    equal('the copy is stored as published, names revision 1 of the corrected original, and the original lists it', [copy.received_at, copy.based_on, original.latest_revision, original.referenced_by.map(r => [r.item_id, r.used_revision, r.relation])], [scenario.at, { item_id: BRIDGE, revision: 1, relation: 'copy' }, 2, [[COPY, 1, 'copy']]]);
    equal('one notification, written at the event time and held by the quiet hours until 07:00', [held.kind, held.item_id, held.state, held.created_at, held.release_at, held.reasons, held.matched_follow_ids], ['item.published', COPY, 'held', scenario.at, at(WED, '07:00'), ['follow'], ['fl-0003']]);
    equal('the event wrote its own activity row and one for its effect', stored.data.activity.slice(-2).map(a => [a.actor, a.action, a.object_id, a.event_id]), [['event', 'item.published', COPY, scenario.event_id], ['event', 'notification.created', held.id, scenario.event_id]]);
    const beforeReplay = await state(), replayed = await event(scenario), afterReplay = await state();
    equal('a repeated event returns the stored receipt and writes nothing: same version, no activity row and no audit row', [replayed.duplicate, afterReplay.revision, afterReplay.data.activity.length, afterReplay.audit.length], [true, beforeReplay.revision, beforeReplay.data.activity.length, beforeReplay.audit.length]);
    const windowArgs = { start: at(WED, '00:00'), end: at('2026-11-19', '00:00') };
    await read('items.list', windowArgs);
    const windowRow = (await state()).audit.at(-1);
    equal('the audit row of a read shows the window', [windowRow.tool, windowRow.decision, windowRow.input], [A + 'items.list', 'allow', windowArgs]);
    await read('items.get', { id: COPY, revision: 1 });
    const itemRow = (await state()).audit.at(-1);
    equal('the audit row of a read shows which item was read', [itemRow.tool, itemRow.decision, itemRow.input.id], [A + 'items.get', 'allow', COPY]);
    const clipped = await write('clippings.add', { id: COPY, note: 'A copy of the old version.' });
    const writeRow = (await state()).audit.at(-1);
    equal('the audit row of a write shows the item and the request', [clipped.status, writeRow.tool, writeRow.decision, writeRow.input.id, writeRow.input.request_id], ['committed', A + 'clippings.add', 'allow', COPY, 'int-' + n]);

    // T16: the platform clock. Infra moves time with env.advance_time; no App code runs.
    const t0 = await state();
    const plan0 = sender.plan(t0);
    equal('before 07:00 the sender has the library correction, due since Tuesday 18:00, and skips the held notification', [plan0.dispatch.map(x => x.id), plan0.skipped, plan0.left_out.history], [['ntf-0011'], [{ notification_id: held.id, reason: 'held', release_at: at(WED, '07:00') }], 11]);
    const backwards = await advance('clock-back', at(WED, '06:00'));
    check('an earlier time is refused with invalid_time', backwards.status === 'invalid_time');
    const moved = await advance('clock-0700', at(WED, '07:00')), t1 = await state();
    equal('env.advance_time commits, names the clock before and after and adds one revision', [moved.status, moved.advanced, moved.previous_virtual_now, moved.virtual_now, moved.version.revision], ['committed', true, scenario.at, at(WED, '07:00'), t0.revision + 1]);
    equal('moving the clock changes no business record and writes no activity row', [t1.data, t1.virtual_now], [t0.data, at(WED, '07:00')]);
    equal('the held notification now reads released and the bridge closure is in effect, with no App event', [(await notes()).at(-1).state, (await itemOf(BRIDGE)).effect, (await itemOf(BRIDGE, 1)).effect], ['released', 'in_effect', 'upcoming']);
    equal('and the sender picks both up from the snapshot, in order of release time', sender.plan(t1).dispatch.map(x => [x.id, x.wire.time]), [['ntf-0011', at(TUE, '18:00')], [held.id, at(WED, '07:00')]]);
    const clockRow = t1.audit.at(-1);
    equal('Core records the clock move: an audit row with the clock before and after, and a receipt', [clockRow.tool, clockRow.decision, clockRow.clock, t1.receipts['clock:clock-0700'] !== undefined], ['env.advance_time', 'allow', { request_id: 'clock-0700', from: scenario.at, requested: at(WED, '07:00'), to: at(WED, '07:00') }, true]);
    const sameClock = await infra.call('env.advance_time', { request_id: 'clock-0700', expected_version: { epoch: t0.epoch, revision: t0.revision }, virtual_now: at(WED, '07:00') });
    equal('a repeated clock request returns the stored receipt and moves nothing', [sameClock.duplicate, (await state()).revision], [true, t1.revision]);
    check('the same clock request ID for another time is rejected', (await advance('clock-0700', at(WED, '08:00'))).status === 'idempotency_conflict');
    const still = await advance('clock-0700-again', at(WED, '07:00'));
    equal('the same instant is acknowledged without advancing', [still.status, still.advanced, (await state()).revision], ['committed', false, t1.revision]);
    check('a write with a version from before the clock move is stale', (await agent.call(A + 'reading.mark', { id: COPY, request_id: 'old-observation', expected_version: { epoch: t0.epoch, revision: t0.revision } })).status === 'stale_version');
    // A replaced version is not mailed, judged at first dispatch: the copy is corrected after its release, before any run.
    const fixed = await event(ev('ev-copy-fixed', at(WED, '07:05'), 'item.corrected', { item_id: COPY, revision: { ...revision(2, at(WED, '07:05'), { topics: ['roads'], area_ids: [MB, 'ar-ferry-hill'], priority: 'important' }), note: 'The closure starts on Wednesday, as Public Works corrected on Tuesday.' } }));
    check('the aggregator corrects its copy at 07:05 (event)', fixed.status === 'committed');
    const t2 = await state(), plan2 = sender.plan(t2), all2 = await notes({ id: COPY });
    equal('in the log the 07:00 notification stays released and is followed by the correction', all2.map(x => [x.kind, x.revision, x.state, x.release_at, x.supersedes]), [['item.published', 1, 'released', at(WED, '07:00'), null], ['item.corrected', 2, 'released', at(WED, '07:05'), null]]);
    equal('a sender that first runs now skips the released notification of the replaced revision and dispatches its correction', [plan2.dispatch.map(x => x.id), plan2.skipped], [['ntf-0011', all2[1].id], [{ notification_id: held.id, reason: 'replaced', revision: 1, latest_revision: 2 }]]);
    check('the clock moves on to the end of the bridge closure', (await advance('clock-sat-1800', at(SAT, '18:00'))).status === 'committed');
    const t3 = await state();
    equal('the corrected bridge notice reads ended; across the clock moves no business record changed', [(await itemOf(BRIDGE)).effect, t3.data], ['ended', t2.data]);
    equal('one audit row per clock move', t3.audit.filter(r => r.tool === 'env.advance_time' && r.decision === 'allow').map(r => r.clock.to), [at(WED, '07:00'), at(WED, '07:00'), at(SAT, '18:00')]);
    const missed = await event({ ...proposal('ev-it-210'), event_id: 'missed-boundary' });
    check('an event dated before the advanced clock is rejected', missed.status === 'invalid_event');

    // A task seed with its own clock, then reset to that seed and that time (T18).
    const task = clone(baseline.data), taskNow = '2026-11-22T09:00:00-05:00';
    task.read_marks = []; task.clippings = []; task.notifications = []; task.activity = [];
    task.preferences = { timezone: 'America/New_York', quiet_hours: { enabled: false, start: '23:00', end: '06:00' }, digest_time: '07:30', corrections: 'immediate', email_notices: false };
    const topics = ['water', 'power', 'roads', 'transit', 'schools', 'libraries', 'health', 'safety', 'weather', 'government'];
    task.follows = [...topics.map((topic, i) => ({ id: 'fl-01' + String(i).padStart(2, '0'), source_ids: [], area_ids: [], topics: [topic], min_priority: 'routine', delivery: 'digest', paused: false, created_at: '2026-11-20T08:00:00-05:00' })),
      ...topics.map((topic, i) => ({ id: 'fl-02' + String(i).padStart(2, '0'), source_ids: ['src-works'], area_ids: [OQ], topics: [topic], min_priority: 'urgent', delivery: 'immediate', paused: i % 2 === 1, created_at: '2026-11-20T08:00:00-05:00' }))];
    const loaded = await infra.call('env.load_seed', { expected_version: await version(), data: task, virtual_now: taskNow, request_id: 'task-seed' });
    check('Infra loads a task seed with its own virtual_now', loaded.status === 'ready' && loaded.loaded === 6 + 9 + 48 + 20);
    const taskSnap = await state();
    equal('the loaded seed and time are the baseline', [taskSnap.data, taskSnap.virtual_now, taskSnap.initial_virtual_now, taskSnap.audit.length], [task, taskNow, taskNow, 1]);
    const prefs = (await read('preferences.get')).preferences;
    equal('the Agent sees the task account', [prefs.timezone, prefs.email_notices, prefs.next_digest_at, (await read('follows.list', { state: 'paused' })).follows.length, (await read('notifications.list')).notifications.length, (await itemOf(BRIDGE)).last_read_revision, (await itemOf(BRIDGE)).effect], ['America/New_York', false, '2026-11-23T07:30:00-05:00', 5, 0, null, 'ended']);
    check('with twenty rules loaded, one more is refused with limit_exceeded', (await write('follows.create', { topics: ['community'], delivery: 'digest' })).status === 'limit_exceeded');
    const rejectSeed = async (name, change) => { const bad = clone(task); change(bad); check(name, (await infra.call('env.load_seed', { expected_version: await version(), data: bad })).status === 'invalid_seed'); };
    await rejectSeed('a seed for an account the binding does not declare is rejected', bad => { bad.account_id = 'someone-else'; });
    await rejectSeed('a seed with a dangling reference is rejected', bad => { bad.items[0].source_id = 'src-nowhere'; });
    await rejectSeed('a seed whose revisions are not numbered from 1 in order is rejected', bad => { bad.items.find(i => i.id === BRIDGE).revisions[1].number = 3; });
    await rejectSeed('a seed with a based_on that names a missing revision is rejected', bad => { bad.items.find(i => i.id === 'it-round-5517').revisions[0].based_on.revision = 3; });
    await rejectSeed('a seed with a duplicate ID is rejected', bad => { bad.follows[1].id = bad.follows[0].id; });
    await rejectSeed('a seed with a notification that skips the delivery rules is rejected', bad => { bad.notifications = clone(baseline.data.notifications).filter(x => x.id !== 'ntf-0011'); });
    const offset = clone(task); offset.items[0].revisions[0].published_at = '2026-10-26T07:20:00';
    check('a seed timestamp without a UTC offset is rejected', (await infra.call('env.load_seed', { expected_version: await version(), data: offset })).status !== 'ready');
    const storedState = clone(task); storedState.items[0].status = 'current';
    check('a seed that stores a derived state is rejected', (await infra.call('env.load_seed', { expected_version: await version(), data: storedState })).status !== 'ready');
    equal('rejected seeds leave the loaded baseline', (await state()).data, task);
    const urgent = await event(ev('ev-task-1', '2026-11-22T23:30:00-05:00', 'item.published', { item_id: 'it-works-9001', source_id: 'src-works', kind: 'notice', revision: revision(1, '2026-11-22T23:25:00-05:00', { topics: ['water'], area_ids: ['ar-quayside'], priority: 'urgent', effective: { start: '2026-11-22T23:00:00-05:00', end: null } }) }));
    const told = (await notes()).at(-1);
    equal('an event on the task seed: an immediate rule wins, quiet hours are off, no email message is prepared', [urgent.status, told.delivery, told.state, told.matched_follow_ids, told.email_prepared, (await itemOf('it-works-9001')).effect], ['committed', 'immediate', 'released', ['fl-0100', 'fl-0200'], false, 'in_effect']);
    check('Infra moves the task clock', (await advance('task-clock', '2026-11-23T12:00:00-05:00')).status === 'committed');
    const reset = await infra.call('env.reset', { expected_version: await version() }), restored = await state();
    check('reset returns ready', reset.status === 'ready');
    equal('reset restores the loaded seed and the loaded time, and clears the audit and the clock receipts', [restored.data, restored.virtual_now, restored.audit.length, restored.epoch > taskSnap.epoch, Object.keys(restored.receipts).filter(k => k.startsWith('clock:'))], [task, taskNow, 1, true, []]);
    check('a version from before the reset is stale', (await agent.call(A + 'reading.mark', { id: BRIDGE, request_id: 'old-epoch', expected_version: { epoch: taskSnap.epoch, revision: taskSnap.revision } })).status === 'stale_version');
    const peer = await client('infra', 'other-run'), other = (await peer.call('env.snapshot')).snapshot;
    equal('another run still has the package fixture', [other.data.follows.length, other.data.notifications.length, other.virtual_now], [5, 12, at(TUE, '17:00')]);

    const report = { schema: 'belltower.mcp-integration.v1', app_version: require('../app.json').version, runtime_version: runtime.version, node: process.version, checks: checks.length, passed: true, read_call_ms: { max: Math.max(...timings), mean: Math.round(timings.reduce((a, b) => a + b, 0) / timings.length) }, duration_ms: Date.now() - started, names: checks };
    if (opts.report) fs.writeFileSync(path.resolve(opts.report), JSON.stringify(report, null, 2) + '\n');
    console.log('PASS: ' + checks.length + ' real-MCP checks for belltower ' + report.app_version + ' on runtime ' + report.runtime_version + ' (' + report.duration_ms + ' ms; read calls mean ' + report.read_call_ms.mean + ' ms, max ' + report.read_call_ms.max + ' ms).');
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    prepared.cleanup();
  }
}
main().catch(e => { console.error('FAIL: ' + e.message); process.exitCode = 1; });
