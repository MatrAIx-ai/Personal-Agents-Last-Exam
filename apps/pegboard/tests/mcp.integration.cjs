#!/usr/bin/env node
'use strict';
// Real-MCP checks on the public reference runtime, for what the common verifier does not
// exercise for this App: every tool through MCP with its declared output schema, Core
// contracts (T18), failure atomicity, replays and how they are counted, policy narrowing,
// the audit projection, time moved with Core's env.advance_time and no App event (T17),
// a task seed with its own virtual_now, and reset to the loaded seed and time (T19).
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
const A = 'pegboard.';
const at = (date, hhmm) => date + 'T' + hhmm + (hhmm.length === 5 ? ':00' : '') + '-08:00';
const clone = x => structuredClone(x);
const ME = 'person-noor', TOMAS = 'person-tomas', KAI = 'person-kai', ROSA = 'person-rosa';
const SUN_CLOSE = 'sh-1122-05', MON = 'sh-1123-01', THU = 'sh-1126-02', FRI = 'sh-1127-05', SAT = 'sh-1128-05', WED_OPEN = 'sh-1125-02';
const WEEK = { start: at('2026-11-23', '00:00'), end: at('2026-11-30', '00:00') };

async function main() {
  const prepared = prepare(appDir), clients = [], checks = [], started = Date.now();
  const check = (name, ok) => { assert.ok(ok, name); checks.push(name); };
  const equal = (name, actual, expected) => { assert.deepEqual(actual, expected, name); checks.push(name); };
  const client = async (role, run = 'integration') => { const c = new Client(prepared.app, role, run, path.join(prepared.root, 'state'), 'pegboard-integration', { registry: prepared.registry }); clients.push(c); await c.initialize(); return c; };
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
    const advance = async (request_id, virtual_now) => infra.call('env.advance_time', { request_id, expected_version: await version(), virtual_now });
    const handoffState = async id => (await read('handoffs.get', { id })).handoff.state;
    const shiftOf = async id => (await read('shifts.get', { id })).shift;

    // The App-only tests validate with a vendored copy of the host's schema validator.
    check('tests/schema-validator.cjs is identical to the validator of this runtime', fs.readFileSync(path.join(appDir, 'tests/schema-validator.cjs')).equals(fs.readFileSync(path.join(runtime.root, 'contracts/schema-validator.cjs'))));

    // Discovery and policy narrowing under the default `scenario` profile.
    const scenarioTools = (await agent.request('tools/list')).result.tools.map(t => t.name);
    equal('scenario profile lists the 12 reads and 9 of the 10 writes', [scenarioTools.length, scenarioTools.filter(x => x.startsWith('env.')).length, scenarioTools.includes(A + 'availability.update')], [21, 0, false]);
    const infraTools = (await infra.request('tools/list')).result.tools.map(t => t.name).filter(x => x.startsWith('env.')).sort();
    check('the host offers its clock operation on the Infra connection (runtime 1.6.0 or later)', infraTools.includes('env.advance_time'));
    check('a write outside the scenario profile is denied', (await write('availability.update', { blocks: [] })).status === 'permission_denied');
    check('an object outside the policy ids is denied', (await write('handoffs.cover', { id: MON, to_person_id: 'person-pip' })).status === 'permission_denied');
    check('a handoff outside the policy ids cannot be answered', (await write('handoffs.respond', { id: 'ho-0009', answer: 'decline' })).status === 'permission_denied');
    check('the allowed object commits', (await write('handoffs.cover', { id: THU, to_person_id: TOMAS })).status === 'committed');
    check('a field outside the policy fields is denied', (await write('preferences.update', { patch: { open_shift_notices: false, email_notices: false } })).status === 'permission_denied');
    check('the allowed field commits', (await write('preferences.update', { patch: { open_shift_notices: false } })).status === 'committed');
    for (const name of ['env.apply_event', 'env.reset', 'env.load_seed', 'env.snapshot', 'env.advance_time']) check('Agent cannot call ' + name, (await agent.call(name, {})).status === 'permission_denied');

    // Every tool once through real MCP under `sandbox`; Core validates each result against tools.json.
    check('reset to the sandbox profile', (await infra.call('env.reset', { expected_version: await version(), profile: 'sandbox' })).status === 'ready');
    const baseline = await state();
    const all = (await agent.request('tools/list')).result.tools;
    equal('sandbox profile lists all 22 tools', [all.length, all.filter(t => t.annotations.readOnlyHint).length], [22, 12]);
    const reads = [
      ['workplace.get', {}], ['team.list', { position_id: 'pos-cashier' }], ['shifts.list', { ...WEEK, mine: true }], ['shifts.list', { ...WEEK, open: true }], ['shifts.get', { id: MON }], ['hours.summary', WEEK],
      ['eligibility.check', { id: WED_OPEN }], ['eligibility.check', { id: 'sh-1127-02', give_shift_id: FRI }], ['availability.get', {}], ['time_off.list', { include_closed: true }],
      ['handoffs.list', { include_closed: true }], ['handoffs.get', { id: 'ho-0014' }], ['notifications.list', { limit: 100 }], ['preferences.get', {}],
    ];
    const timings = [], results = {};
    for (const [name, args] of reads) { const t0 = Date.now(), r = await read(name, args); timings.push(Date.now() - t0); results[name] = r; check('read ' + name + ' returns ok', r.status === 'ok' && r.app_id === 'pegboard'); }
    equal('the week of 23 November through MCP: 20 of 24 hours, and the open Wednesday shift would make 26', [results['hours.summary'].weeks[0].scheduled_hours, results['hours.summary'].weeks[0].cap, results['eligibility.check'].other.eligible, (await read('eligibility.check', { id: WED_OPEN })).blocks, (await read('eligibility.check', { id: WED_OPEN })).hours.after], [20, 24, true, ['over_hours'], 26]);
    reads.push(['eligibility.check', { id: WED_OPEN }], ['eligibility.check', { id: WED_OPEN }]);
    const afterReads = await state();
    equal('reads leave business data and the version unchanged', [afterReads.data, afterReads.revision], [baseline.data, baseline.revision]);
    equal('each allowed read has one audit row', afterReads.audit.slice(-reads.length).map(r => [r.tool, r.decision]), reads.map(([name]) => [A + name, 'allow']));

    const writes = [
      await write('availability.update', { blocks: [{ weekday: 'thu', start: '09:00', end: '13:00' }] }),
      await write('preferences.update', { patch: { open_shift_notices: false } }),
      await write('time_off.request', { start: '2026-12-12', end: '2026-12-13', reason: 'Recital weekend' }),
    ];
    writes.push(await write('time_off.cancel', { id: writes[2].id }), await write('handoffs.cover', { id: THU, to_person_id: TOMAS, message: 'Could you take the kiosk on Thursday?' }));
    writes.push(await write('handoffs.cancel', { id: writes[4].id }), await write('handoffs.trade', { id: THU, their_shift_id: 'sh-1126-03' }), await write('handoffs.release', { id: FRI }), await write('handoffs.respond', { id: 'ho-0014', answer: 'decline', message: 'Sorry, I am at my hours that week.' }));
    equal('nine writes commit through MCP', writes.map(w => w.status), Array(9).fill('committed'));
    equal('a committed write returns the object ID and the new version', [writes.map(w => w.id), writes[8].version.revision === (await version()).revision], [['pegboard-noor', 'pegboard-noor', 'to-0006', 'to-0006', 'ho-0015', 'ho-0015', 'ho-0016', 'ho-0017', 'ho-0014'], true]);
    equal('flags follow the new availability at the next read', (await read('shifts.list', { ...WEEK, mine: true })).shifts.filter(s => s.flags.length).map(s => [s.id, s.flags]), [[THU, ['outside_availability']]]);
    // W4 through MCP: the release is approved, then the open Wednesday shift is picked up and approved.
    check('the manager approves the release (event)', (await event(ev('ev-release', at('2026-11-21', '18:30'), 'handoff.decided', { handoff_id: 'ho-0017', decision: 'approve', decided_by: ROSA }))).status === 'committed');
    equal('with Friday released, the open Wednesday shift fits', [(await read('eligibility.check', { id: WED_OPEN })).eligible, (await shiftOf(FRI)).state], [true, 'open']);
    const pickup = await write('handoffs.pickup', { id: WED_OPEN });
    writes.push(pickup);
    equal('the pickup waits for the manager and the shift is still open', [pickup.status, pickup.id, pickup.handoff.state, (await shiftOf(WED_OPEN)).state], ['committed', 'ho-0018', 'awaiting_manager', 'open']);
    check('the manager approves the pickup (event)', (await event(ev('ev-pickup', at('2026-11-21', '18:40'), 'handoff.decided', { handoff_id: 'ho-0018', decision: 'approve', decided_by: ROSA }))).status === 'committed');
    equal('the shift is mine and the week reads 22 hours', [(await shiftOf(WED_OPEN)).assignee, (await read('hours.summary', WEEK)).weeks[0].scheduled_hours], [ME, 22]);
    const after = await state();
    equal('each committed write added one activity row with its request_id', after.data.activity.filter(a => a.actor === 'agent').slice(-10).map(a => [a.action, a.request_id]), ['availability.update', 'preferences.update', 'time_off.request', 'time_off.cancel', 'handoffs.cover', 'handoffs.cancel', 'handoffs.trade', 'handoffs.release', 'handoffs.respond', 'handoffs.pickup'].map((x, i) => [x, 'int-' + (n - 9 + i)]));
    equal('each event added its own row and one for each effect', after.data.activity.filter(a => a.actor === 'event').slice(-6).map(a => [a.action, a.object_id, a.event_id]), [
      ['handoff.decided', 'ho-0017', 'ev-release'], ['shift.reassigned', FRI, 'ev-release'], ['notification.created', 'ntf-0017', 'ev-release'],
      ['handoff.decided', 'ho-0018', 'ev-pickup'], ['shift.reassigned', WED_OPEN, 'ev-pickup'], ['notification.created', 'ntf-0018', 'ev-pickup'],
    ]);

    // T18: Core contracts, and how a replay and a rejection appear in the evaluator records.
    const v = await version(), args = { id: SAT, request_id: 'same-request', expected_version: v };
    check('my pending request for Saturday is cancelled first', (await write('handoffs.cancel', { id: 'ho-0013' })).status === 'committed');
    const v2 = await version(), ask = { id: SAT, to_person_id: KAI, request_id: 'same-request', expected_version: v2 };
    const first = await agent.call(A + 'handoffs.cover', ask), once = await state();
    const again = await agent.call(A + 'handoffs.cover', ask), twice = await state();
    check('a repeated request_id returns the stored receipt', first.status === 'committed' && again.duplicate === true && again.version.revision === first.version.revision && again.id === first.id && again.handoff.state === 'awaiting_coworker');
    equal('the replay wrote nothing: no second handoff, same version, no activity row and no audit row', [twice.data.handoffs.length, twice.revision, twice.data.activity.length, twice.audit.length], [once.data.handoffs.length, once.revision, once.data.activity.length, once.audit.length]);
    check('the same request_id with different input is rejected', (await agent.call(A + 'handoffs.cover', { ...ask, to_person_id: 'person-jo' })).status === 'idempotency_conflict');
    const stale = await agent.call(A + 'handoffs.cancel', { id: first.id, request_id: 'stale-1', expected_version: args.expected_version });
    check('a stale version is rejected and names the current one', stale.status === 'stale_version' && stale.applied === false && stale.current_version.revision === first.version.revision);
    check('caller cannot pass role or run', (await agent.call(A + 'workplace.get', { role: 'infra', run_id: 'other' })).status === 'invalid_arguments');
    check('a write without request_id is rejected', (await agent.call(A + 'handoffs.cancel', { id: first.id, expected_version: await version() })).status === 'invalid_arguments');

    // Failure atomicity for a tool call and for an event.
    const beforeFail = await state(), failed = await write('handoffs.cover', { id: MON, to_person_id: KAI });
    const afterFail = await state();
    check('a business failure names its reason and applies nothing', failed.status === 'not_qualified' && failed.applied === false);
    equal('a failed call leaves data and version unchanged and writes no activity row', [afterFail.data, afterFail.revision], [beforeFail.data, beforeFail.revision]);
    equal('Core appended one denial audit row for the rejected attempt', [afterFail.audit.length, afterFail.audit.at(-1).decision, afterFail.audit.at(-1).reason], [beforeFail.audit.length + 1, 'deny', 'not_qualified']);
    const refusals = [];
    for (const [name, a] of [['handoffs.pickup', { id: MON }], ['handoffs.cover', { id: 'sh-1123-02', to_person_id: KAI }], ['handoffs.trade', { id: MON, their_shift_id: WED_OPEN }], ['handoffs.cover', { id: SAT, to_person_id: TOMAS }], ['handoffs.cover', { id: MON, to_person_id: TOMAS }], ['handoffs.cover', { id: MON, to_person_id: 'person-ines' }], ['handoffs.pickup', { id: 'sh-1127-01' }], ['time_off.request', { start: '2026-11-26', end: '2026-11-26' }], ['time_off.request', { start: '2026-12-05', end: '2026-12-05' }], ['time_off.request', { start: '2026-12-26', end: '2026-12-27' }], ['time_off.cancel', { id: 'to-0004' }], ['shifts.get', { id: 'sh-none' }], ['shifts.list', { start: WEEK.end, end: WEEK.start }], ['preferences.update', { patch: { timezone: 'Nowhere/Land' } }]]) refusals.push(name.includes('.get') || name.includes('.list') ? (await read(name, a)).status : (await write(name, a)).status);
    equal('App errors reach the Agent by name', refusals, ['not_open', 'not_yours', 'not_theirs', 'already_requested', 'overlap', 'short_rest', 'over_hours', 'too_late', 'shift_assigned', 'conflict', 'invalid_state', 'not_found', 'invalid_window', 'invalid_timezone']);
    equal('none of them changed data or version', [(await state()).data, (await state()).revision], [beforeFail.data, beforeFail.revision]);
    const scenario = JSON.parse(fs.readFileSync(path.join(appDir, 'examples/scenario.json'), 'utf8'));
    const early = await event({ ...scenario, event_id: 'too-early', at: at('2026-11-21', '17:00') });
    check('an event dated before the App clock is rejected', early.status === 'invalid_event' && early.applied === false);
    const long = clone(scenario); long.event_id = 'too-long'; long.payload.change = { end: at('2026-11-23', '23:00') };
    check('a change that makes a shift longer than 16 hours is rejected as invalid_event', (await event(long)).status === 'invalid_event');
    check('a decision for a handoff that is not waiting for the manager is rejected', (await event(ev('wrong-state', at('2026-11-21', '19:00'), 'handoff.decided', { handoff_id: first.id, decision: 'approve', decided_by: ROSA }))).status === 'invalid_event');
    check('Pegboard has no clock event: such an operation is rejected', (await event(ev('no-clock-event', at('2026-11-21', '19:00'), 'clock.advanced', {}))).status !== 'committed');
    const afterRejected = await state();
    equal('rejected events leave data and the clock unchanged', [afterRejected.data, afterRejected.virtual_now], [afterFail.data, afterFail.virtual_now]);

    // An event through MCP: handled at its own time, with a receipt and the audit projection.
    const applied = await event(scenario), stored = await state();
    check('the declared event commits and moves the clock to its own time', applied.status === 'committed' && stored.virtual_now === scenario.at);
    equal('the event receipt is queryable', (await infra.call('env.event_status', { event_id: scenario.event_id })).receipt.event_id, scenario.event_id);
    const monday = await shiftOf(MON), newest = (await read('notifications.list', { limit: 1 })).notifications[0];
    equal('the manager\'s change is applied as given, flagged, and told at the event time', [monday.start, monday.flags, monday.history.at(-1).event_id, newest.kind, newest.change, newest.object.id, newest.created_at, newest.release_at, newest.title], [at('2026-11-23', '05:00'), ['short_rest'], scenario.event_id, 'shift.changed', 'changed', MON, scenario.at, scenario.at, 'Your Monday shift at Finch Street now starts at 05:00']);
    const beforeReplay = await state(), replayed = await event(scenario), afterReplay = await state();
    equal('a repeated event returns the stored receipt and writes nothing: same version, no activity row and no audit row', [replayed.duplicate, afterReplay.revision, afterReplay.data.activity.length, afterReplay.audit.length], [true, beforeReplay.revision, beforeReplay.data.activity.length, beforeReplay.audit.length]);
    await read('shifts.list', { ...WEEK, mine: true });
    const windowRow = (await state()).audit.at(-1);
    equal('the audit row of a read shows the window', [windowRow.tool, windowRow.decision, windowRow.input], [A + 'shifts.list', 'allow', WEEK]);
    const released = await write('handoffs.release', { id: MON });
    const writeRow = (await state()).audit.at(-1);
    equal('the audit row of a write shows the shift and the request', [released.status, writeRow.tool, writeRow.decision, writeRow.input.id, writeRow.input.request_id], ['committed', A + 'handoffs.release', 'allow', MON, 'int-' + n]);

    // T17: the platform clock. Infra moves time with env.advance_time; no App code runs.
    check('Kai accepts in quiet hours', (await event(ev('ev-night', at('2026-11-21', '23:10'), 'handoff.answered', { handoff_id: first.id, answer: 'accept', message: 'I can close on the 28th.' }))).status === 'committed');
    const t0 = await state(), heldNotice = t0.data.notifications.at(-1);
    const noticeState = async () => (await read('notifications.list', { limit: 1 })).notifications[0].state;
    equal('the notification is held with a release time at the end of the quiet period, and its wire message is dated then', [heldNotice.kind, heldNotice.created_at, heldNotice.release_at, heldNotice.wire.time, await noticeState(), await handoffState(first.id)], ['handoff.updated', at('2026-11-21', '23:10'), at('2026-11-22', '07:00'), at('2026-11-22', '07:00'), 'held', 'awaiting_manager']);
    equal('before the release time the sender has only the notifications that are already released', sender.pending(t0).map(x => x.id), ['ntf-0017', 'ntf-0018', 'ntf-0019']);
    const backwards = await advance('clock-back', at('2026-11-21', '22:00'));
    check('an earlier time is refused with invalid_time', backwards.status === 'invalid_time');
    const moved = await advance('clock-0700', at('2026-11-22', '07:00')), t1 = await state();
    equal('env.advance_time commits, names the clock before and after and adds one revision', [moved.status, moved.advanced, moved.previous_virtual_now, moved.virtual_now, moved.version.revision], ['committed', true, at('2026-11-21', '23:10'), at('2026-11-22', '07:00'), t0.revision + 1]);
    equal('moving the clock changes no business record and writes no activity row', [t1.data, t1.virtual_now], [t0.data, at('2026-11-22', '07:00')]);
    equal('the held notification now reads released, with no App event', await noticeState(), 'released');
    equal('and the sender picks it up from the snapshot', sender.pending(t1).map(x => [x.id, x.wire.time]).at(-1), [heldNotice.id, at('2026-11-22', '07:00')]);
    const clockRow = t1.audit.at(-1);
    equal('Core records the clock move: an audit row with the clock before and after, and a receipt', [clockRow.tool, clockRow.decision, clockRow.clock, t1.receipts['clock:clock-0700'] !== undefined], ['env.advance_time', 'allow', { request_id: 'clock-0700', from: at('2026-11-21', '23:10'), requested: at('2026-11-22', '07:00'), to: at('2026-11-22', '07:00') }, true]);
    const sameClock = await infra.call('env.advance_time', { request_id: 'clock-0700', expected_version: { epoch: t0.epoch, revision: t0.revision }, virtual_now: at('2026-11-22', '07:00') });
    equal('a repeated clock request returns the stored receipt and moves nothing', [sameClock.duplicate, (await state()).revision], [true, t1.revision]);
    check('the same clock request ID for another time is rejected', (await advance('clock-0700', at('2026-11-22', '08:00'))).status === 'idempotency_conflict');
    const still = await advance('clock-0700-again', at('2026-11-22', '07:00'));
    equal('the same instant is acknowledged without advancing', [still.status, still.advanced, (await state()).revision], ['committed', false, t1.revision]);
    check('a write with a version from before the clock move is stale', (await agent.call(A + 'handoffs.cancel', { id: first.id, request_id: 'old-observation', expected_version: { epoch: t0.epoch, revision: t0.revision } })).status === 'stale_version');

    check('the clock moves to the start of Sunday\'s close', (await advance('clock-sun-1600', at('2026-11-22', '16:00'))).status === 'committed');
    equal('a shift that has started reads started and cannot be handed over', [(await shiftOf(SUN_CLOSE)).phase, (await write('handoffs.release', { id: SUN_CLOSE })).status, (await write('handoffs.cover', { id: SUN_CLOSE, to_person_id: KAI })).status], ['started', 'too_late', 'too_late']);
    await advance('clock-sun-2000', at('2026-11-22', '20:00'));
    equal('and ended once its end has passed', (await shiftOf(SUN_CLOSE)).phase, 'ended');
    equal('the cover Kai accepted is still waiting for the manager one second before its cut-off', [(await advance('clock-cutoff-1', at('2026-11-27', '15:59:59'))).status, await handoffState(first.id)], ['committed', 'awaiting_manager']);
    await advance('clock-cutoff', at('2026-11-27', '16:00'));
    equal('at its cut-off it reads expired, with no App event, and the shift is still mine', [await handoffState(first.id), (await shiftOf(SAT)).assignee, (await shiftOf(SAT)).pending_handoff_id], ['expired', ME, null]);
    check('a decision after the cut-off is rejected', (await event(ev('ev-too-late', at('2026-11-27', '16:30'), 'handoff.decided', { handoff_id: first.id, decision: 'approve', decided_by: ROSA }))).status === 'invalid_event');
    equal('an expired handoff cannot be cancelled, and the shift can no longer be handed over', [(await write('handoffs.cancel', { id: first.id })).status, (await write('handoffs.cover', { id: SAT, to_person_id: TOMAS })).status], ['invalid_state', 'too_late']);
    const pendingOff = async () => (await read('time_off.list', { include_closed: true })).time_off.find(t => t.id === 'to-0005').state;
    equal('the holiday request is still pending', await pendingOff(), 'pending');
    await advance('clock-holiday', at('2026-12-24', '00:00'));
    equal('a pending time-off entry reads expired when its first day begins', await pendingOff(), 'expired');
    check('and a decision after that is rejected', (await event(ev('ev-holiday', at('2026-12-24', '09:00'), 'time_off.decided', { time_off_id: 'to-0005', decision: 'approve', decided_by: ROSA }))).status === 'invalid_event');
    const t2 = await state();
    equal('across the clock moves no business record changed', t2.data, t1.data);
    equal('one audit row per clock move', t2.audit.filter(r => r.tool === 'env.advance_time' && r.decision === 'allow').map(r => r.clock.to), [at('2026-11-22', '07:00'), at('2026-11-22', '07:00'), at('2026-11-22', '16:00'), at('2026-11-22', '20:00'), at('2026-11-27', '15:59:59'), at('2026-11-27', '16:00'), at('2026-12-24', '00:00')]);
    const missed = await event({ ...scenario, event_id: 'missed-boundary', at: at('2026-11-23', '09:00') });
    check('an event dated before the advanced clock is rejected', missed.status === 'invalid_event');

    // A task seed with its own clock, then reset to that seed and that time (T19).
    const task = clone(baseline.data), taskNow = '2026-11-22T09:00:00-06:00';
    task.workplace.policy.manager_approval = false; task.people[0].max_weekly_hours = null; task.availability = []; task.notifications = []; task.activity = [];
    task.preferences = { timezone: 'America/Chicago', quiet_hours: { enabled: false, start: '23:00', end: '06:00' }, email_notices: false, open_shift_notices: true };
    const loaded = await infra.call('env.load_seed', { expected_version: await version(), data: task, virtual_now: taskNow, request_id: 'task-seed' });
    check('Infra loads a task seed with its own virtual_now', loaded.status === 'ready' && loaded.loaded === 203);
    const taskSnap = await state();
    equal('the loaded seed and time are the baseline', [taskSnap.data, taskSnap.virtual_now, taskSnap.initial_virtual_now, taskSnap.audit.length], [task, taskNow, taskNow, 1]);
    const prefs = (await read('preferences.get')).preferences, place = await read('workplace.get');
    equal('the Agent sees the task account', [prefs.timezone, prefs.email_notices, place.workplace.policy.manager_approval, place.me.cap, (await read('notifications.list')).notifications.length], ['America/Chicago', false, false, 40, 0]);
    const unbound = clone(task); unbound.account_id = 'someone-else';
    check('a seed for an account the binding does not declare is rejected', (await infra.call('env.load_seed', { expected_version: await version(), data: unbound })).status === 'invalid_seed');
    const dangling = clone(task); dangling.shifts[0].position_id = 'pos-none';
    check('a seed with a dangling reference is rejected', (await infra.call('env.load_seed', { expected_version: await version(), data: dangling })).status === 'invalid_seed');
    const stillMine = clone(task); stillMine.shifts.find(s => s.id === 'sh-1110-03').assignee = ME;
    check('a seed with an approved cover whose shift is still mine is rejected', (await infra.call('env.load_seed', { expected_version: await version(), data: stillMine })).status === 'invalid_seed');
    const twoPending = clone(task); twoPending.handoffs.push({ ...twoPending.handoffs.find(h => h.id === 'ho-0013'), id: 'ho-0015' });
    check('a seed with two pending handoffs on one shift is rejected', (await infra.call('env.load_seed', { expected_version: await version(), data: twoPending })).status === 'invalid_seed');
    const offset = clone(task); offset.shifts[0].start = '2026-11-09T06:00:00';
    check('a seed timestamp without a UTC offset is rejected', (await infra.call('env.load_seed', { expected_version: await version(), data: offset })).status !== 'ready');
    const storedState = clone(task); storedState.handoffs.find(h => h.id === 'ho-0002').state = 'expired';
    check('a seed that stores a time-based state is rejected', (await infra.call('env.load_seed', { expected_version: await version(), data: storedState })).status !== 'ready');
    equal('rejected seeds leave the loaded baseline', (await state()).data, task);
    const direct = await write('handoffs.pickup', { id: WED_OPEN });
    equal('where the workplace asks for no approval, a pickup is approved at once and the shift is mine', [direct.status, direct.handoff.state, (await shiftOf(WED_OPEN)).assignee, (await shiftOf(WED_OPEN)).history.at(-1).request_id, (await read('hours.summary', WEEK)).weeks[0].scheduled_hours], ['committed', 'approved', ME, 'int-' + n, 26]);
    check('Infra moves the task clock', (await advance('task-clock', '2026-11-22T12:00:00-06:00')).status === 'committed');
    const reset = await infra.call('env.reset', { expected_version: await version() }), restored = await state();
    check('reset returns ready', reset.status === 'ready');
    equal('reset restores the loaded seed and the loaded time, and clears the audit and the clock receipts', [restored.data, restored.virtual_now, restored.audit.length, restored.epoch > taskSnap.epoch, Object.keys(restored.receipts).filter(k => k.startsWith('clock:'))], [task, taskNow, 1, true, []]);
    check('a version from before the reset is stale', (await agent.call(A + 'handoffs.pickup', { id: WED_OPEN, request_id: 'old-epoch', expected_version: { epoch: taskSnap.epoch, revision: taskSnap.revision } })).status === 'stale_version');
    const peer = await client('infra', 'other-run'), other = (await peer.call('env.snapshot')).snapshot;
    equal('another run still has the package fixture', [other.data.handoffs.length, other.data.notifications.length, other.virtual_now], [14, 16, at('2026-11-21', '18:00')]);

    const report = { schema: 'pegboard.mcp-integration.v1', app_version: require('../app.json').version, runtime_version: runtime.version, node: process.version, checks: checks.length, passed: true, read_call_ms: { max: Math.max(...timings), mean: Math.round(timings.reduce((a, b) => a + b, 0) / timings.length) }, duration_ms: Date.now() - started, names: checks };
    if (opts.report) fs.writeFileSync(path.resolve(opts.report), JSON.stringify(report, null, 2) + '\n');
    console.log('PASS: ' + checks.length + ' real-MCP checks for pegboard ' + report.app_version + ' on runtime ' + report.runtime_version + ' (' + report.duration_ms + ' ms; read calls mean ' + report.read_call_ms.mean + ' ms, max ' + report.read_call_ms.max + ' ms).');
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    prepared.cleanup();
  }
}
main().catch(e => { console.error('FAIL: ' + e.message); process.exitCode = 1; });
