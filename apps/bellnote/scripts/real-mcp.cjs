#!/usr/bin/env node
'use strict';
// Real MCP checks on the pinned public runtime for what the public verifier does not exercise:
// a task seed with its own virtual_now, time moved with env.advance_time and no App event,
// replays and idempotency conflicts of business writes and events, stale versions, failure
// atomicity with Core's denial audit, Agent attempts at Infra operations, read-only audit growth,
// and reset to the loaded data and time. Core-side parts of T18/T19.
//   node scripts/real-mcp.cjs [--runtime DIR] [--output FILE]
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const locate = require('./locate.cjs');

async function run() {
  const runtime = locate.runtimeDir();
  const {prepare} = require(path.join(runtime, 'prepare.cjs')), {Client} = require(path.join(runtime, 'client.cjs'));
  const prepared = prepare(locate.packageDir), clients = [], checks = [];
  const check = (name, cond, detail) => { assert.ok(cond, name + (detail !== undefined ? ': ' + JSON.stringify(detail).slice(0, 600) : '')); checks.push({name, status: 'passed'}); };
  const open = async (role, run = 'bellnote-mcp') => { const c = new Client('bellnote', role, run, path.join(prepared.root, 'state'), 'bellnote-real-mcp', {registry: prepared.registry}); clients.push(c); await c.initialize(); return c; };
  try {
    const infra = await open('infra'), agent = await open('agent');
    const snap = async () => (await infra.call('env.snapshot'));
    // Authority: the Agent connection lists no Infra operation and cannot call one by name.
    const listed = (await agent.request('tools/list')).result.tools.map(t => t.name);
    check('Agent discovery lists only bellnote.* business tools', listed.length > 0 && listed.every(n => n.startsWith('bellnote.')));
    for (const name of ['env.apply_event', 'env.reset', 'env.advance_time', 'env.load_seed', 'env.snapshot']) {
      check('Agent calling ' + name + ' is permission_denied', (await agent.call(name, {})).status === 'permission_denied');
    }
    const infraTools = (await infra.request('tools/list')).result.tools.map(t => t.name);
    check('Infra connection exposes env.advance_time', infraTools.includes('env.advance_time'));
    // A task seed with its own clock, in the sandbox profile.
    let s = await snap();
    check('Sandbox profile selected by Infra reset', (await infra.call('env.reset', {expected_version: s.version, profile: 'sandbox'})).status === 'ready');
    s = await snap();
    const seed = JSON.parse(fs.readFileSync(path.join(locate.packageDir, 'fixtures/minimal.json'), 'utf8'));
    const loaded = await infra.call('env.load_seed', {expected_version: s.version, request_id: 'task-seed', data: seed, virtual_now: '2026-11-17T07:10:00-08:00'});
    check('Infra loads a task seed with virtual_now', loaded.status === 'ready', loaded);
    s = await snap();
    check('Loaded clock and data are the task\'s', s.snapshot.virtual_now === '2026-11-17T07:10:00-08:00' && JSON.stringify(s.snapshot.data) === JSON.stringify(seed));
    const baseline = s;
    // Reads: business data byte-identical; Core's audit may grow (one allowed row).
    const read = await agent.call('bellnote.pickup.get', {id: 'child-theo', start: '2026-11-17', end: '2026-11-20'});
    let after = await snap();
    check('Read returns ok with the current version', read.status === 'ok' && JSON.stringify(read.version) === JSON.stringify(s.version));
    check('Read leaves business data byte-identical', JSON.stringify(after.snapshot.data) === JSON.stringify(s.snapshot.data));
    check('Read leaves the version unchanged while the audit grows by one row', JSON.stringify(after.version) === JSON.stringify(s.version) && after.snapshot.audit.length === s.snapshot.audit.length + 1);
    // A committed write, its replay and a conflicting reuse.
    const args = {id: 'child-theo', kind: 'absent', start: '2026-11-17', reason: 'Fever', request_id: 'report-1', expected_version: read.version};
    const w = await agent.call('bellnote.absences.report', args);
    check('Report before the cut-off commits with the next revision', w.status === 'committed' && w.version.revision === read.version.revision + 1 && w.state === 'submitted', w);
    s = await snap();
    check('One activity row for the committed write', s.snapshot.data.activity.length === 1 && s.snapshot.data.activity[0].request_id === 'report-1');
    const replay = await agent.call('bellnote.absences.report', args);
    check('Exact replay returns the stored receipt marked duplicate', replay.duplicate === true && replay.id === w.id, replay);
    after = await snap();
    check('Replay changes no data and writes no activity row', JSON.stringify(after.snapshot.data) === JSON.stringify(s.snapshot.data) && JSON.stringify(after.version) === JSON.stringify(s.version));
    check('Same request_id with different input is idempotency_conflict', (await agent.call('bellnote.absences.report', {...args, reason: 'Other'})).status === 'idempotency_conflict');
    check('Stale expected_version is stale_version', (await agent.call('bellnote.absences.report', {...args, request_id: 'report-2', start: '2026-11-18'})).status === 'stale_version');
    // Failure atomicity: a declined card leaves data, version, balance and notifications unchanged; Core appends a denial row.
    s = await snap();
    const declined = await agent.call('bellnote.lunch.topup', {id: 'lunch-ines', amount_cents: 2000, payment_method_id: 'pm-0003', request_id: 'topup-declined', expected_version: s.version});
    after = await snap();
    check('Declined card is payment_declined', declined.status === 'payment_declined', declined);
    check('Refused write leaves data and version unchanged', JSON.stringify(after.snapshot.data) === JSON.stringify(s.snapshot.data) && JSON.stringify(after.version) === JSON.stringify(s.version));
    check('Core records the refusal as a denial audit row', after.snapshot.audit.at(-1).decision === 'deny' && after.snapshot.audit.at(-1).reason === 'payment_declined');
    // A repeated top-up charges once.
    const top = {id: 'lunch-ines', amount_cents: 2000, request_id: 'topup-1', expected_version: s.version};
    const t1 = await agent.call('bellnote.lunch.topup', top), t2 = await agent.call('bellnote.lunch.topup', top);
    s = await snap();
    check('Top-up commits with its payment and new balance', t1.status === 'committed' && t1.balance_cents === 2310 && t1.payment.status === 'paid', t1);
    check('Repeated top-up request returns the stored receipt', t2.duplicate === true && t2.payment.id === t1.payment.id);
    check('Only one payment and one transaction were written', s.snapshot.data.payments.filter(p => p.request_id === 'topup-1').length === 1 &&
      s.snapshot.data.lunch_transactions.filter(t => t.request_id === 'topup-1').length === 1);
    // Events: at their own time, deduplicated, conflicting reuse rejected, backwards time rejected.
    const event = {event_id: 'ev-bn-130', at: '2026-11-18T12:10:00-08:00', operation: 'bellnote.lunch.charged',
      payload: {transaction_id: 'tx-0412', child_id: 'child-ines', kind: 'purchase', amount_cents: -425, item: 'Peanut noodle bowl', allergens: ['peanut', 'wheat', 'soy']}};
    const e1 = await infra.call('env.apply_event', {expected_version: s.version, event});
    check('Event commits at its own time', e1.status === 'committed' && (await snap()).snapshot.virtual_now === event.at, e1);
    check('Identical event retry is duplicate', (await infra.call('env.apply_event', {expected_version: s.version, event})).duplicate === true);
    s = await snap();
    check('Changed event under the same ID is idempotency_conflict', (await infra.call('env.apply_event', {expected_version: s.version, event: {...event, payload: {...event.payload, amount_cents: -500}}})).status === 'idempotency_conflict');
    const early = await infra.call('env.apply_event', {expected_version: s.version, event: {...event, event_id: 'ev-early', at: '2026-11-18T08:00:00-08:00', payload: {...event.payload, transaction_id: 'tx-0500'}}});
    check('Event dated before the App clock is invalid_event', early.status === 'invalid_event');
    const debt = await infra.call('env.apply_event', {expected_version: s.version, event: {...event, event_id: 'ev-debt', payload: {...event.payload, transaction_id: 'tx-0501', amount_cents: -3000}}});
    after = await snap();
    check('Charge past the debt limit is invalid_event with state and clock unchanged', debt.status === 'invalid_event' && JSON.stringify(after.snapshot.data) === JSON.stringify(s.snapshot.data) &&
      after.snapshot.virtual_now === s.snapshot.virtual_now);
    const lunch = await agent.call('bellnote.lunch.account_get', {id: 'lunch-ines', start: '2026-11-18', end: '2026-11-18'});
    check('Purchase of a restricted item reads restricted_item at read time', lunch.transactions[0].restricted_item === true && lunch.account.balance_cents === 1885, lunch);
    // Time alone: env.advance_time runs no App code; derived states change, business data does not.
    s = await snap();
    const before = JSON.stringify(s.snapshot.data);
    const adv = await infra.call('env.advance_time', {expected_version: s.version, request_id: 'clock-1', virtual_now: '2026-12-01T00:00:00-08:00'});
    after = await snap();
    check('env.advance_time commits and changes only the clock and revision', adv.status === 'committed' && adv.advanced === true && JSON.stringify(after.snapshot.data) === before &&
      after.version.revision === s.version.revision + 1, adv);
    const form = await agent.call('bellnote.forms.get', {id: 'form-fluclinic'});
    const prefs = await agent.call('bellnote.preferences.get', {});
    const day = await agent.call('bellnote.schools.get', {id: 'school-alder', start: '2026-11-30', end: '2026-11-30'});
    check('After the clock moves, the form reads closed', form.form.phase === 'closed');
    check('After the clock moves, the November card reads expired', prefs.payment_methods.find(m => m.id === 'pm-0002').expired === true);
    check('After the clock moves, a passed cut-off refuses a report', Date.parse(day.days[0].absence_cutoff_at) < Date.parse('2026-12-01T00:00:00-08:00') &&
      (await agent.call('bellnote.absences.report', {id: 'child-theo', kind: 'absent', start: '2026-11-30', reason: 'x', request_id: 'late-1', expected_version: after.version})).status === 'too_late');
    check('Time wrote no notification and no activity row', (await snap()).snapshot.data.notifications.length === s.snapshot.data.notifications.length &&
      (await snap()).snapshot.data.activity.length === s.snapshot.data.activity.length);
    check('Clock replay is duplicate', (await infra.call('env.advance_time', {expected_version: s.version, request_id: 'clock-1', virtual_now: '2026-12-01T00:00:00-08:00'})).duplicate === true);
    check('Moving the clock backwards is invalid_time', (await infra.call('env.advance_time', {expected_version: after.version, request_id: 'clock-2', virtual_now: '2026-11-20T00:00:00-08:00'})).status === 'invalid_time');
    // Reset restores the loaded seed and the loaded time, and clears receipts.
    s = await snap();
    check('Reset returns ready', (await infra.call('env.reset', {expected_version: s.version})).status === 'ready');
    after = await snap();
    check('Reset restores the loaded seed', JSON.stringify(after.snapshot.data) === JSON.stringify(baseline.snapshot.data));
    check('Reset restores the loaded time', after.snapshot.virtual_now === '2026-11-17T07:10:00-08:00');
    check('Reset advances the epoch', after.version.epoch > s.version.epoch);
    const fresh = await agent.call('bellnote.absences.report', {...args, expected_version: after.version});
    check('After reset the same request_id is a new write in the new epoch', fresh.status === 'committed' && !fresh.duplicate);
    // Another run is separate.
    const other = await open('infra', 'bellnote-other');
    check('A separate run keeps the package seed', (await other.call('env.snapshot')).snapshot.data.account_id === 'bellnote-maya' &&
      (await other.call('env.snapshot')).snapshot.data.absence_reports.length === 6);
    return {schema: 'bellnote.real-mcp.v1', passed: true, runtime_version: JSON.parse(fs.readFileSync(path.join(runtime, 'package.json'), 'utf8')).version,
      core_api_version: prepared.model.registry.api, node: process.version, checks};
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    prepared.cleanup();
  }
}
module.exports = {run};
if (require.main === module) {
  run().then(report => {
    const text = JSON.stringify(report, null, 2) + '\n', out = locate.option('output');
    if (out) { fs.mkdirSync(path.dirname(out), {recursive: true}); fs.writeFileSync(out, text); }
    console.log(text); console.log('PASS: ' + report.checks.length + ' Bellnote real-MCP checks.');
  }).catch(e => { console.error(e); process.exitCode = 1; });
}
