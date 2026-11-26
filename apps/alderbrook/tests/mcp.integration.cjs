#!/usr/bin/env node
'use strict';
// Real MCP checks for what the public verifier does not exercise. One Infra and one Agent process talk to the App over stdio.
// Usage: node tests/mcp.integration.cjs --runtime DIR [--report FILE]. PALE_RUNTIME_ROOT can replace --runtime.
const fs = require('node:fs'), path = require('node:path'), util = require('node:util');

const DIR = path.resolve(__dirname, '..'), APP = 'alderbrook.', RUN = 'alderbrook-mcp';
// Exit code 77 says that the script was skipped: it printed SKIP and ran no check.
const SKIPPED = 77;
const READS = ['policies.list', 'policies.get', 'coverage.check', 'claims.list', 'claims.get', 'estimates.get', 'payments.list', 'notifications.list', 'preferences.get'];
const WRITES = ['claims.file', 'claims.update', 'claims.add_evidence', 'claims.withdraw', 'requests.respond', 'estimates.submit', 'determinations.dispute',
  'payee.set', 'offers.accept', 'offers.reject', 'rental.start', 'rental.end', 'preferences.update'];
const ADMIN = ['env.apply_event', 'env.reset', 'env.advance_time', 'env.load_seed', 'env.snapshot'];
const SHOP = 'Corner Auto Body', ADJUSTER = 'Adjuster R. Imani';
// An instant of December 2026 in the insurer's time zone: at('04 15:30').
const at = text => '2026-12-' + text.slice(0, 2) + 'T' + text.slice(3) + ':00-05:00';
const START = at('02 09:00'), LOSS = at('01 08:00');
const read = file => JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
const names = list => list.map(name => APP + name).sort();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function options(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--runtime', '--report'].includes(argv[i]) || !argv[i + 1]) throw new Error('Usage: node tests/mcp.integration.cjs --runtime DIR [--report FILE]');
    out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}
const checks = [];
function check(name, condition, got) {
  checks.push({name, status: condition ? 'passed' : 'failed'});
  if (!condition) throw new Error(name + (got === undefined ? '' : '\n  got: ' + JSON.stringify(got)));
}
function equal(name, actual, expected) {
  check(name, util.isDeepStrictEqual(actual, expected), {expected, actual});
}

// The connections of one run, with the version that the last committed call returned.
async function connect(runtime, prepared, clients) {
  const {Client} = require(path.join(runtime, 'client.cjs'));
  const open = async (role, run = RUN, registry = prepared.registry) => {
    const client = new Client(prepared.app, role, run, path.join(prepared.root, 'state'), 'alderbrook-mcp-integration', {registry});
    clients.push(client);
    await client.initialize();
    return client;
  };
  const t = {infra: await open('infra'), agent: await open('agent'), peer: await open('infra', 'other-run'), version: null, seq: 0, writes: [], events: [], refusals: [], advances: [],
    open, registry: prepared.registry};
  t.snapshot = async (client = t.infra) => (await client.call('env.snapshot')).snapshot;
  t.read = (name, args = {}) => t.agent.call(APP + name, args);
  t.claim = async id => {
    const result = await t.read('claims.get', {id});
    if (result.status !== 'ok') throw new Error('claims.get failed: ' + JSON.stringify(result));
    return {...result.claim, now: result.now};
  };
  const committed = (label, result) => {
    if (result.status !== 'committed') throw new Error(label + ' was not committed: ' + JSON.stringify(result));
    t.version = result.version;
  };
  // An Agent write with the current version. `write` needs a commit, and `attempt` returns what the App or Core answered.
  t.attempt = async (name, args) => {
    const full = {...args, expected_version: t.version, request_id: 'mcp-w' + (++t.seq)};
    return {name, args: full, request_id: full.request_id, result: await t.agent.call(APP + name, full)};
  };
  t.refused = async (name, args) => {
    const call = await t.attempt(name, args);
    t.refusals.push(call);
    return call.result;
  };
  t.write = async (name, args) => {
    const call = await t.attempt(name, args);
    committed(name, call.result);
    t.writes.push(call);
    return call;
  };
  t.event = async (kind, when, payload) => {
    const args = {expected_version: t.version, event: {event_id: 'ev-mcp-' + (++t.seq), at: when, operation: APP + kind, payload}};
    const result = await t.infra.call('env.apply_event', args);
    committed(kind, result);
    t.events.push({args, result, event_id: args.event.event_id});
    return t.events[t.events.length - 1];
  };
  t.advance = async when => {
    const args = {expected_version: t.version, virtual_now: when, request_id: 'clock-' + (++t.seq)};
    const result = await t.infra.call('env.advance_time', args);
    committed('env.advance_time', result);
    t.advances.push({args, result});
    return t.advances[t.advances.length - 1];
  };
  return t;
}

async function loadTaskSeed(t) {
  t.peerBefore = await t.snapshot(t.peer);
  const fresh = await t.infra.call('env.snapshot');
  const moved = await t.infra.call('env.advance_time', {expected_version: fresh.version, virtual_now: '2027-01-05T09:00:00-05:00', request_id: 'before-load'});
  check('Before the load, the clock of the fresh instance stands at 5 January 2027', moved.status === 'committed' && moved.advanced === true, moved);
  t.seed = read('examples/task-data/seed.json');
  const policies = {...read('fixtures/policies.json'), scenario: {allow: read('tools.json').map(tool => tool.name), constraints: {}}};
  const loaded = await t.infra.call('env.load_seed', {expected_version: moved.version, request_id: 'task-seed', data: t.seed,
    binding: read('fixtures/binding.json'), policies, virtual_now: START});
  check('env.load_seed loads the task seed with its binding, its policies and its own virtual_now', loaded.status === 'ready' && loaded.loaded === t.seed.policies.length + t.seed.claims.length, loaded);
  t.version = loaded.version;
  const loadedState = await t.snapshot();
  equal('The snapshot holds the loaded seed', loadedState.data, t.seed);
  equal('The clock is the loaded virtual_now, not the time that the instance had before', loadedState.virtual_now, START);
  const auto = t.seed.policies.find(policy => policy.kind === 'auto');
  // The vehicle with no lender is the first vehicle of the plan. The other one has a lienholder.
  Object.assign(t, {policy: auto.id, vehicle: auto.vehicles.find(v => v.lienholder === null).id, financed: auto.vehicles.find(v => v.lienholder !== null).id,
    driver: auto.listed_people[auto.listed_people.length - 1].person_id});
  const estimate = t.seed.claims.flatMap(claim => claim.estimates)[0];
  check('The task seed has a claim and an estimate to read', t.seed.claims.length > 0 && estimate !== undefined);
  for (const [name, args] of nineReads(t, t.seed.claims[0].id, estimate.id)) {
    const result = await t.read(name, args);
    check(name + ' reads now as ' + START + ', with the -05:00 offset', result.status === 'ok' && result.now === START, result);
  }
}
const nineReads = (t, claim, estimate) => [['policies.list', {}], ['policies.get', {id: t.policy}],
  ['coverage.check', {id: t.policy, coverage: 'collision', subject_id: t.vehicle, loss_at: LOSS}], ['claims.list', {start: at('01 00:00'), end: at('31 00:00')}],
  ['claims.get', {id: claim}], ['estimates.get', {id: estimate}], ['payments.list', {}], ['notifications.list', {}], ['preferences.get', {}]];

async function discovery(t) {
  const listed = (await t.agent.request('tools/list')).result.tools;
  equal('The Agent connection lists exactly the 22 tools of the plan', listed.map(tool => tool.name).sort(), names([...READS, ...WRITES]));
  equal('9 of them are read tools', listed.filter(tool => tool.annotations.readOnlyHint).map(tool => tool.name).sort(), names(READS));
  equal('13 of them are write tools', listed.filter(tool => !tool.annotations.readOnlyHint).map(tool => tool.name).sort(), names(WRITES));
  check('The Agent connection lists no env.* operation', listed.every(tool => !tool.name.startsWith('env.')));
  for (const name of ADMIN) {
    const result = await t.agent.call(name, {});
    check('The Agent calling ' + name + ' gets permission_denied', result.status === 'permission_denied', result);
  }
  equal('The denied calls changed no business data', (await t.snapshot()).data, t.seed);
}

async function coverage(t) {
  const cover = args => t.read('coverage.check', {id: t.policy, coverage: 'collision', subject_id: t.vehicle, ...args});
  let result = await cover({loss_at: LOSS});
  equal('W1: on 2 December a loss on 1 December is covered, with a deductible of 500 and 31 December as the last day to file',
    [result.covered, result.coverage.deductible, result.last_day_to_file, result.failures], [true, 500, '2026-12-31', []]);
  result = await cover({loss_at: LOSS, estimated_amount: 420});
  equal('W1: with an estimated amount of 420 the expected payment is 0 and the flag is under_deductible', [result.expected_payment, result.flags], [0, ['under_deductible']]);
  result = await cover({loss_at: '2026-06-15T12:00:00-04:00'});
  equal('W1 control: a loss on 15 June, before the term began, is not covered and lists not_in_force and too_late', [result.covered, result.failures], [false, ['not_in_force', 'too_late']]);
  result = await cover({loss_at: '2026-10-20T12:00:00-04:00'});
  equal('W1 control: a loss on 20 October, checked 43 days later, lists too_late alone', [result.covered, result.failures], [false, ['too_late']]);
}

async function filing(t) {
  const loss = {id: t.policy, coverage: 'collision', subject_id: t.vehicle, loss_at: LOSS, description: 'Hit from behind at a stop sign. Damage to the rear bumper and the left tail lamp.'};
  t.filed = await t.write('claims.file', loss);
  t.A = t.filed.result.id;
  let claim = await t.claim(t.A);
  equal('W2: claims.file on 2 December with no driver named gives an open claim on the repair path, with a deductible of 500 and driver null',
    [claim.state, claim.path, claim.deductible, claim.driver, claim.filed_at], ['open', 'repair', 500, null, START]);

  const before = await t.snapshot();
  let result = await t.refused('claims.file', loss);
  check('W2 control: a second claim for the same policy, coverage, vehicle and loss day returns duplicate_claim', result.status === 'duplicate_claim' && result.applied === false, result);
  result = await t.refused('estimates.submit', {id: t.A, kind: 'initial', shop_name: SHOP, lines: []});
  check('Core returns invalid_arguments for an estimate with no lines, before any App error', result.status === 'invalid_arguments' && result.applied === false, result);
  const after = await t.snapshot();
  check('A failed call changes nothing: after one App error and one Core error the business data is byte-identical', same(after.data, before.data));
  equal('A failed call changes nothing: the version is the same', [after.epoch, after.revision], [before.epoch, before.revision]);
  equal('The audit has one deny row for each failed call', after.audit.slice(before.audit.length).map(row => [row.tool, row.decision, row.reason]),
    [[APP + 'claims.file', 'deny', 'duplicate_claim'], [APP + 'estimates.submit', 'deny', 'invalid_arguments']]);

  t.B = (await t.write('claims.file', {...loss, subject_id: t.financed, description: 'Slid on ice into a guard rail. Heavy damage to the front and the left side.'})).result.id;
  claim = await t.claim(t.B);
  equal('W2 control: the same loss day on the other vehicle of the policy is accepted', [claim.state, claim.subject_id, claim.lienholder !== null], ['open', t.financed, true]);
  t.C = (await t.write('claims.file', {...loss, loss_at: '2026-11-30T18:00:00-05:00', description: 'A tree branch fell on the hood in a storm.'})).result.id;
}

async function writeReplays(t) {
  const before = await t.snapshot();
  let result = await t.agent.call(APP + 'claims.file', t.filed.args);
  equal('Replay: the same request_id with the same input returns the stored result with duplicate true', result, {...t.filed.result, duplicate: true});
  let now = await t.snapshot();
  equal('Replay: it files no second claim, writes no audit row and keeps the version',
    [now.data.claims.length, now.audit.length, now.revision], [before.data.claims.length, before.audit.length, before.revision]);
  result = await t.agent.call(APP + 'claims.file', {...t.filed.args, description: 'Other words for the same request_id.'});
  check('Replay: the same request_id with changed input returns idempotency_conflict', result.status === 'idempotency_conflict' && result.applied === false, result);
  result = await t.agent.call(APP + 'claims.update', {id: t.A, description: 'A write that saw an old version.', expected_version: t.filed.args.expected_version, request_id: 'mcp-stale'});
  check('Replay: a write with a stale expected_version returns stale_version and names the current version',
    result.status === 'stale_version' && same(result.current_version, t.version), result);
  now = await t.snapshot();
  check('Replay: the conflict and the stale write changed no business data', same(now.data, before.data));
}

async function requests(t) {
  const issued = await t.event('request.issued', at('02 14:00'), {info_request_id: 'req-9101', claim_id: t.A, due_at: at('12 17:00'), issued_by: ADJUSTER,
    asks: [{key: 'photos', text: 'Photos of the damage from four sides.'}, {key: 'driver', text: 'Who was driving, and is that person listed on the policy?'}]});
  let claim = await t.claim(t.A);
  equal('W2: request.issued asks for photos and for the driver, due on 12 December, and the request is open',
    claim.requests.map(r => [r.id, r.state, r.due_at, r.asks.map(ask => ask.key)]), [['req-9101', 'open', at('12 17:00'), ['photos', 'driver']]]);
  const before = await t.snapshot();
  equal('Replay: an identical event_id returns the stored receipt with duplicate true', await t.infra.call('env.apply_event', issued.args), {...issued.result, duplicate: true});
  const now = await t.snapshot();
  check('Replay: the repeated event adds no request, no notification and no audit row', same(now.data, before.data) && now.audit.length === before.audit.length && now.revision === before.revision);

  const photo = n => ({kind: 'photo', dated: at('01 08:30'), description: 'Photo ' + n + ' of the rear of the car.'});
  const first = (await t.write('claims.add_evidence', {id: t.A, items: [photo(1), photo(2)]})).result.evidence_ids;
  const second = (await t.write('claims.add_evidence', {id: t.A, items: [photo(3), photo(4)]})).result.evidence_ids;
  await t.write('requests.respond', {id: 'req-9101', answers: [{key: 'photos', text: 'Four photos are attached.', evidence_ids: [...first, ...second]}]});
  claim = await t.claim(t.A);
  equal('W2: after claims.add_evidence twice and an answer to the ask photos the request is still open', [claim.evidence.length, claim.requests[0].state], [4, 'open']);
  await t.write('claims.update', {id: t.A, driver: {kind: 'listed', person_id: t.driver}});
  await t.write('requests.respond', {id: 'req-9101', answers: [{key: 'driver', text: 'A listed driver of the policy was driving.'}]});
  claim = await t.claim(t.A);
  equal('W2: claims.update sets the driver, and the answer to the ask driver makes the request answered',
    [claim.driver, claim.requests[0].state], [{kind: 'listed', person_id: t.driver}, 'answered']);
}

async function rental(t) {
  const moved = await t.advance(at('03 10:00'));
  const before = await t.snapshot();
  equal('Replay: a replayed env.advance_time returns the stored receipt with duplicate true', await t.infra.call('env.advance_time', moved.args), {...moved.result, duplicate: true});
  const now = await t.snapshot();
  equal('Replay: the replayed env.advance_time adds no audit row and moves nothing', [now.audit.length, now.virtual_now, now.revision], [before.audit.length, at('03 10:00'), before.revision]);
  t.rental = (await t.write('rental.start', {id: t.B, start_at: at('03 09:00'), daily_rate: 45})).result.id;
  const result = await t.refused('rental.start', {id: t.B, start_at: at('03 09:30'), daily_rate: 45});
  check('W4 control: a second rental while one is active returns already_active', result.status === 'already_active', result);
}

const line = (line_id, text, amount) => ({line_id, text, amount});
const approve = lines => lines.map(([line_id, amount]) => ({line_id, status: 'approved', amount}));

async function estimate(t) {
  await t.event('estimate.submitted', at('04 10:00'), {estimate_id: 'est-9101', claim_id: t.A, kind: 'initial', source: 'shop', shop_name: SHOP,
    lines: [line('ln-01', 'Rear bumper cover, replace', 900), line('ln-02', 'Tail lamp, left', 350), line('ln-03', 'Paint and labor', 750)]});
  await t.event('determination.issued', at('04 15:30'), {determination_id: 'det-9101', claim_id: t.A, issued_by: ADJUSTER, note: 'Approved as estimated.',
    lines: approve([['ln-01', 900], ['ln-02', 350], ['ln-03', 750]])});
  const {summary} = await t.claim(t.A);
  equal('W3: three lines of 2,000 in total, all approved: approved_total 2,000, insurer_owes 1,500, my_share 500 and still_due 1,500',
    [summary.approved_total, summary.insurer_owes, summary.my_share, summary.still_due], [2000, 1500, 500, 1500]);
  await t.write('payee.set', {id: t.A, payee: {kind: 'shop', name: SHOP}});
}

async function overdueRequest(t) {
  await t.event('request.issued', at('05 09:00'), {info_request_id: 'req-9102', claim_id: t.A, due_at: at('06 12:00'), issued_by: ADJUSTER,
    asks: [{key: 'invoice', text: 'The invoice of the shop for the work done so far.'}]});
  const early = await t.claim(t.A), before = await t.snapshot();
  await t.advance(at('06 12:00'));
  let claim = await t.claim(t.A);
  equal('Time alone: once env.advance_time reaches the due time, the open request reads request_overdue',
    [early.flags.includes('request_overdue'), claim.flags.includes('request_overdue'), claim.requests[1].overdue, claim.requests[1].state, claim.now], [false, true, true, 'open', at('06 12:00')]);
  check('Time alone: the move ran no App code, so the business data is byte-identical', same((await t.snapshot()).data, before.data));
  await t.write('requests.respond', {id: 'req-9102', answers: [{key: 'invoice', text: 'The shop sends the invoice when the repair is done.'}]});
  claim = await t.claim(t.A);
  equal('W2 control: the overdue request can still be answered', [claim.requests[1].state, claim.flags.includes('request_overdue')], ['answered', false]);
}

async function payments(t) {
  const money = async () => (await t.claim(t.A)).summary;
  await t.event('payment.issued', at('07 12:00'), {payment_id: 'pay-9101', claim_id: t.A, kind: 'repair', amount: 1500, reference: 'EFT 88213'});
  let claim = await t.claim(t.A);
  equal('W3: payee.set to the shop, then a payment of 1,500 with no payee named, is paid to the shop and leaves still_due 0',
    [claim.payments[0].payee, claim.summary.paid, claim.summary.still_due], [{kind: 'shop', name: SHOP}, 1500, 0]);
  await t.event('estimate.submitted', at('08 10:00'), {estimate_id: 'est-9102', claim_id: t.A, kind: 'supplement', source: 'shop', shop_name: SHOP,
    lines: [line('ln-04', 'Rear body panel, repair', 1100), line('ln-05', 'Trunk floor, straighten', 400)]});
  claim = await t.claim(t.A);
  equal('W3: a supplement of two lines and 1,500: both pending, flag lines_pending, not_approved_total 1,500 and insurer_owes still 1,500',
    [claim.estimates[1].lines.map(l => l.standing.status), claim.flags.includes('lines_pending'), claim.summary.not_approved_total, claim.summary.insurer_owes],
    [['pending', 'pending'], true, 1500, 1500]);
  await t.event('determination.issued', at('08 15:00'), {determination_id: 'det-9102', claim_id: t.A, issued_by: ADJUSTER, lines: approve([['ln-04', 1100], ['ln-05', 400]])});
  let summary = await money();
  equal('W3: a second determination approves both: approved_total 3,500, insurer_owes 3,000 and still_due 1,500',
    [summary.approved_total, summary.insurer_owes, summary.still_due], [3500, 3000, 1500]);
  await t.event('payment.issued', at('09 12:00'), {payment_id: 'pay-9102', claim_id: t.A, kind: 'repair', amount: 1500});
  summary = await money();
  equal('W3: a second payment of 1,500 leaves still_due 0 and my_share 500', [summary.still_due, summary.my_share, summary.paid], [0, 500, 3000]);
  claim = await t.claim(t.A);
  equal('W3: both payments went to the shop, and each one stores the shop as the direction on file at that moment, so the claim does not read payee_mismatch',
    [claim.flags.includes('payee_mismatch'), claim.payments.map(p => p.direction_on_file)], [false, [{kind: 'shop', name: SHOP}, {kind: 'shop', name: SHOP}]]);

  let result = await t.refused('determinations.dispute', {id: 'ln-01', claim_id: t.A, reason: 'The bumper cost more.'});
  check('W3 control: determinations.dispute on a line approved in full returns nothing_to_dispute', result.status === 'nothing_to_dispute', result);
  await t.event('payment.issued', at('09 13:00'), {payment_id: 'pay-9103', claim_id: t.A, kind: 'repair', amount: 200, payee: {kind: 'policyholder'}});
  claim = await t.claim(t.A);
  equal('W3 control: a third payment of 200 that names the policyholder is applied and reads payee_mismatch and overpaid 200',
    [claim.flags.includes('payee_mismatch'), claim.flags.includes('overpaid'), claim.summary.overpaid], [true, true, 200]);
  result = await t.refused('claims.withdraw', {id: t.A});
  check('W2 control: claims.withdraw after a payment returns invalid_state', result.status === 'invalid_state', result);
}

async function offers(t) {
  const settlement = async () => { const claim = await t.claim(t.B); return {claim, s: claim.summary.settlement}; };
  await t.event('offer.issued', at('10 09:00'), {offer_id: 'off-9101', claim_id: t.B, valuation: 14200, lienholder_payoff: 15100, respond_by: at('17 17:00'),
    issued_by: ADJUSTER, basis: 'Three comparable vehicles within 100 miles.'});
  let {claim, s} = await settlement();
  equal('W4: an offer of 14,200 with a payoff of 15,100 and a deductible of 500: open, total_loss path, net 13,700, to_lienholder 13,700, to_me 0, shortfall 1,400, flag below_payoff',
    [claim.offers[0].state, claim.path, claim.deductible, s.net, s.to_lienholder, s.to_me, s.shortfall, claim.flags.includes('below_payoff')],
    ['open', 'total_loss', 500, 13700, 13700, 0, 1400, true]);
  const listing = n => ({kind: 'other', dated: at('09 18:00'), description: 'Listing ' + n + ' of a comparable vehicle at a higher price.'});
  const proof = (await t.write('claims.add_evidence', {id: t.B, items: [listing(1), listing(2)]})).result.evidence_ids;
  await t.write('offers.reject', {id: 'off-9101', reason: 'The valuation is below the loan payoff. Two comparable listings are attached.', evidence_ids: proof});
  ({claim} = await settlement());
  equal('W4: offers.reject with a reason and two evidence items makes the offer rejected', [claim.offers[0].state, claim.offers[0].evidence_ids], ['rejected', proof]);
  let result = await t.refused('offers.accept', {id: 'off-9101'});
  check('W4 control: offers.accept on the rejected offer returns invalid_state', result.status === 'invalid_state', result);
  result = await t.refused('estimates.submit', {id: t.B, kind: 'initial', shop_name: SHOP, lines: [{text: 'Front bumper, replace', amount: 800}]});
  check('W4 control: estimates.submit after the first offer returns invalid_state', result.status === 'invalid_state', result);
  await t.event('offer.issued', at('11 09:00'), {offer_id: 'off-9102', claim_id: t.B, valuation: 15900, lienholder_payoff: 15100, respond_by: at('18 17:00'), issued_by: ADJUSTER});
  ({claim, s} = await settlement());
  equal('W4: a new offer with a valuation of 15,900: net 15,400, to_lienholder 15,100 and to_me 300', [s.offer_id, s.net, s.to_lienholder, s.to_me], ['off-9102', 15400, 15100, 300]);
  await t.write('offers.accept', {id: 'off-9102'});
  ({claim, s} = await settlement());
  equal('W4: offers.accept makes the offer accepted, and its two amounts are now owed',
    [claim.offers[1].state, s.offer_state, s.still_due_to_lienholder, s.still_due_to_me], ['accepted', 'accepted', 15100, 300]);
}

async function expiredOffer(t) {
  await t.event('offer.issued', at('12 09:00'), {offer_id: 'off-9103', claim_id: t.C, valuation: 9000, respond_by: at('16 17:00'), issued_by: ADJUSTER});
  await t.advance('2026-12-16T16:59:59-05:00');
  const early = await t.claim(t.C), before = await t.snapshot();
  await t.advance(at('16 17:00'));
  const claim = await t.claim(t.C), now = await t.snapshot();
  equal('Time alone: once env.advance_time reaches respond_by, the offer with no answer reads expired and the claim reads offer_expired',
    [early.offers[0].state, claim.offers[0].state, claim.flags.includes('offer_expired')], ['open', 'expired', true]);
  check('Time alone: nothing is rewritten when the due time passes, and the offer is still stored as open',
    same(now.data, before.data) && now.data.claims.find(k => k.id === t.C).offers[0].state === 'open');
  const result = await t.refused('offers.accept', {id: 'off-9103'});
  check('W4 control: offers.accept on the expired offer returns too_late', result.status === 'too_late', result);
}

async function rentalDays(t) {
  await t.advance(at('18 09:00'));
  const claim = await t.claim(t.B), period = claim.rentals.find(r => r.id === t.rental);
  equal('W4: a rental started on 3 December at 45 a day, read on 18 December: 12 covered days, 3 uncovered days, my_cost 195 and the flag rental_uncovered',
    [period.covered_days, period.uncovered_days, period.my_cost, claim.flags.includes('rental_uncovered')], [12, 3, 195, true]);
}

// Core refuses an event dated before the clock. The App refuses an event of the plan's list, here an estimate with no lines.
async function refusedEvents(t) {
  const asks = {info_request_id: 'req-9103', claim_id: t.A, issued_by: ADJUSTER, asks: [{key: 'tow_receipt', text: 'The receipt of the tow.'}]};
  const cases = [['an event dated before the clock', 'request.issued', at('17 09:00'), asks],
    ['an estimate with no lines', 'estimate.submitted', at('18 10:00'), {estimate_id: 'est-9103', claim_id: t.A, kind: 'supplement', source: 'shop', shop_name: SHOP, lines: []}]];
  for (const [label, kind, when, payload] of cases) {
    const before = await t.snapshot(), event_id = 'ev-mcp-' + (++t.seq);
    const result = await t.infra.call('env.apply_event', {expected_version: t.version, event: {event_id, at: when, operation: APP + kind, payload}});
    const now = await t.snapshot();
    check('Refused event: ' + label + ' returns invalid_event', result.status === 'invalid_event' && result.applied === false, result);
    check('Refused event: after ' + label + ' the business data is byte-identical', same(now.data, before.data));
    equal('Refused event: after ' + label + ' the version and the clock are the same', [now.epoch, now.revision, now.virtual_now], [before.epoch, before.revision, at('18 09:00')]);
    equal('Refused event: after ' + label + ' the audit has one deny row', now.audit.slice(before.audit.length).map(row => [row.tool, row.decision, row.reason, row.input.event_id, row.state_changed]),
      [['env.apply_event', 'deny', 'invalid_event', event_id, false]]);
  }
  await t.event('request.issued', at('18 10:00'), asks);
  equal('The same request is applied when its time is not before the clock', (await t.claim(t.A)).requests.map(r => [r.id, r.state]).pop(), ['req-9103', 'open']);
}

// Core checks the schemas of the package before the App runs. So Core answers invalid_arguments for data that breaks a schema, in an event and in a seed:
// a time with no UTC offset, a year outside 1970 to 2999, or an unknown field.
async function brokenSchemas(t) {
  const before = await t.snapshot(), seed = structuredClone(t.seed), extra = structuredClone(t.seed);
  const payload = {info_request_id: 'req-9104', claim_id: t.A, due_at: '2026-12-28T17:00:00', issued_by: ADJUSTER, asks: [{key: 'final_invoice', text: 'The final invoice of the shop.'}]};
  seed.claims[0].filed_at = seed.claims[0].filed_at.slice(0, 19);
  extra.claims[0].colour = 'red';
  const event = change => ({expected_version: t.version, event: {event_id: 'ev-mcp-' + (++t.seq), at: at('18 11:00'), operation: APP + 'request.issued', payload: {...payload, ...change}}});
  const calls = [['env.apply_event with a due_at that has no UTC offset', 'env.apply_event', event({})],
    ['env.load_seed with a filed_at that has no UTC offset', 'env.load_seed', {expected_version: t.version, request_id: 'seed-no-offset', data: seed, virtual_now: START}],
    ['env.apply_event with a due_at in the year 3000', 'env.apply_event', event({due_at: '3000-01-01T17:00:00-05:00'})],
    ['env.load_seed with an unknown field in a claim', 'env.load_seed', {expected_version: t.version, request_id: 'seed-unknown-field', data: extra, virtual_now: START}]];
  for (const [label, name, args] of calls) {
    const result = await t.infra.call(name, args), now = await t.snapshot();
    check(label + ' returns invalid_arguments', result.status === 'invalid_arguments' && result.applied === false, result);
    check(label + ': the business data is byte-identical', same(now.data, before.data));
    equal(label + ': the version and the clock are the same', [now.epoch, now.revision, now.virtual_now], [before.epoch, before.revision, before.virtual_now]);
  }
  await t.event('request.issued', at('18 11:00'), {...payload, due_at: at('28 17:00')});
  equal('The same request is applied when its due_at has the UTC offset', (await t.claim(t.A)).requests.map(r => [r.id, r.due_at]).pop(), ['req-9104', at('28 17:00')]);
}

async function records(t) {
  const before = await t.snapshot(), reads = nineReads(t, t.A, 'est-9101');
  for (const [name, args] of reads) {
    const result = await t.read(name, args);
    if (result.status !== 'ok') throw new Error(name + ' failed: ' + JSON.stringify(result));
  }
  const now = await t.snapshot(), rows = now.audit.slice(before.audit.length), row = name => rows.find(r => r.tool === APP + name);
  check('The business data in env.snapshot is byte-identical before and after all nine reads', same(now.data, before.data) && now.revision === before.revision);
  equal('Each of the nine reads has one allow row in the audit, with no state change', rows.map(r => [r.tool, r.actor, r.decision, r.state_changed]),
    reads.map(([name]) => [APP + name, 'agent', 'allow', false]));
  equal('The audit row of a read carries input.id', [row('claims.get').input, row('estimates.get').input, row('policies.get').input], [{id: t.A}, {id: 'est-9101'}, {id: t.policy}]);
  equal('The audit row of a windowed read carries input.start and input.end', row('claims.list').input, {start: at('01 00:00'), end: at('31 00:00')});
  const filedRow = now.audit.find(r => r.input.request_id === t.filed.request_id);
  equal('The audit row of a write carries input.id, the request_id, the observed version and the ID of the object it wrote',
    [filedRow.tool, filedRow.decision, filedRow.input, filedRow.result], [APP + 'claims.file', 'allow',
      {id: t.policy, request_id: t.filed.request_id, expected_version: t.filed.args.expected_version}, {status: 'committed', object_id: t.A}]);
  const dispute = t.refusals.find(call => call.name === 'determinations.dispute'), disputeRow = now.audit.find(r => r.input.request_id === dispute.request_id);
  equal('The audit row of the refused determinations.dispute shows the line as input.id. The claim_id of the call is in the trace of the Agent, not in the audit',
    [dispute.args.claim_id, disputeRow.decision, disputeRow.reason, disputeRow.input], [t.A, 'deny', 'nothing_to_dispute',
      {id: 'ln-01', request_id: dispute.request_id, expected_version: dispute.args.expected_version}]);

  // The rows and notifications that the seed already held are history. Only what this run added is counted.
  const main = now.data.activity.slice(t.seed.activity.length).filter(a => !a.effect);
  check('Every committed write has one activity row with its request_id (' + t.writes.length + ' writes)',
    t.writes.every(w => main.filter(a => a.request_id === w.request_id && a.actor === 'agent' && a.action === w.name).length === 1));
  check('Every applied event has one activity row with its event_id (' + t.events.length + ' events)',
    t.events.every(e => main.filter(a => a.event_id === e.event_id && a.actor === 'event').length === 1));
  equal('There is no other activity row, apart from the rows of effects', main.length, t.writes.length + t.events.length);
  equal('Each applied event wrote one notification', now.data.notifications.slice(t.seed.notifications.length).map(n => n.event_id), t.events.map(e => e.event_id));
  check('A refused call has a deny row in the audit and no activity row (' + t.refusals.length + ' refusals)', t.refusals.every(call =>
    now.audit.filter(r => r.input.request_id === call.request_id && r.decision === 'deny' && r.reason === call.result.status).length === 1 &&
    !now.data.activity.some(a => a.request_id === call.request_id)));
  equal('The audit has one row for each env.advance_time that is not a replay',
    now.audit.filter(r => r.tool === 'env.advance_time' && r.decision === 'allow').map(r => r.clock.to), t.advances.map(move => move.args.virtual_now));
}

// The optional filter of the three list reads is the argument `id`, so the audit shows the object.
async function listFilters(t) {
  const before = await t.snapshot(), filters = [['claims.list', {id: t.policy}], ['payments.list', {id: t.A}], ['notifications.list', {id: t.A}]], lists = [];
  for (const [name, args] of filters) lists.push(await t.read(name, args));
  const rows = (await t.snapshot()).audit.slice(before.audit.length);
  equal('The audit rows of claims.list, payments.list and notifications.list with their filter carry input.id',
    rows.map(r => [r.tool, r.decision, r.input]), filters.map(([name, args]) => [APP + name, 'allow', args]));
  equal('The filter selects the claims of that policy, and the payments and the notifications of that claim',
    [lists.map(list => list.status), lists[0].items.map(k => k.policy_id).every(id => id === t.policy) && lists[0].items.some(k => k.id === t.A),
      lists[1].items.map(p => [p.id, p.claim_id]), lists[2].items.length > 0 && lists[2].items.every(n => n.claim_id === t.A)],
    [['ok', 'ok', 'ok'], true, [['pay-9101', t.A], ['pay-9102', t.A], ['pay-9103', t.A]], true]);
}

async function reset(t) {
  const before = await t.snapshot();
  let result = await t.infra.call('env.reset', {expected_version: t.version});
  check('env.reset returns ready', result.status === 'ready', result);
  let now = await t.snapshot();
  equal('Reset restores the loaded seed', now.data, t.seed);
  equal('Reset restores the loaded virtual_now', [now.virtual_now, (await t.read('preferences.get')).now], [START, START]);
  equal('Reset clears the audit and the receipts: only the row of the reset itself is left', [now.audit.map(r => r.tool), Object.keys(now.receipts)], [['env.reset'], []]);
  equal('Reset advances the epoch', [now.epoch, now.revision], [before.epoch + 1, 0]);

  // The package clock is the same instant as the task seed above. This second seed starts at another time, spelled in UTC.
  result = await t.infra.call('env.load_seed', {expected_version: result.version, request_id: 'second-seed', data: t.seed, virtual_now: '2026-12-20T15:30:00Z'});
  check('A second seed with another virtual_now is loaded in the same run', result.status === 'ready', result);
  t.version = result.version;
  equal('A start time spelled in UTC is read with the -05:00 offset', (await t.read('preferences.get')).now, at('20 10:30'));
  await t.advance(at('21 09:00'));
  result = await t.infra.call('env.reset', {expected_version: t.version});
  now = await t.snapshot();
  equal('Reset goes back to the virtual_now of the loaded seed, not to the package clock',
    [result.status, now.virtual_now, (await t.read('preferences.get')).now], ['ready', '2026-12-20T15:30:00Z', at('20 10:30')]);
}

// A seed can be loaded before its own history. Both offers of this claim are stored as open, and the clock stands before both.
async function earlyOffers(t) {
  const seed = structuredClone(t.seed), claim = seed.claims.find(k => k.subject_id === t.financed && k.state === 'open');
  const stored = (id, issued_at, respond_by) => ({id, issued_at, valuation: 14200, lienholder_payoff: 15100, respond_by, issued_by: ADJUSTER, basis: null,
    state: 'open', answered_at: null, reason: null, evidence_ids: []});
  Object.assign(claim, {path: 'total_loss', offers: [stored('off-a', at('05 09:00'), at('10 09:00')), stored('off-b', at('12 09:00'), at('20 09:00'))]});
  const loaded = await t.infra.call('env.load_seed', {expected_version: (await t.infra.call('env.snapshot')).version, request_id: 'early-offers', data: seed, virtual_now: START});
  const offers = async () => (await t.claim(claim.id)).offers.map(o => [o.id, o.state]);
  t.version = loaded.version;
  equal('A seed with two offers stored as open is loaded on 2 December, before both: the earlier offer reads expired and the later one reads open',
    [loaded.status, (await t.snapshot()).virtual_now, await offers()], ['ready', START, [['off-a', 'expired'], ['off-b', 'open']]]);
  const before = await t.snapshot(), result = await t.refused('offers.accept', {id: 'off-a'}), now = await t.snapshot();
  check('offers.accept on the earlier offer returns too_late, not invalid_seed, and changes nothing',
    result.status === 'too_late' && result.applied === false && same(now.data, before.data) && now.revision === before.revision, result);
  await t.write('offers.accept', {id: 'off-b'});
  equal('offers.accept on the later offer is committed', await offers(), [['off-a', 'expired'], ['off-b', 'accepted']]);
}

// A clock outside the years 1970 to 2999. A read works. A write would store the clock, and the seed schema refuses that year, so Core answers invalid_event.
async function farClock(t) {
  const claim = t.seed.claims[0].id, reads = nineReads(t, claim, t.seed.claims.flatMap(k => k.estimates)[0].id);
  for (const [clock, local] of [['3000-01-01T00:00:00Z', '2999-12-31T19:00:00-05:00'], ['1969-12-31T23:59:59Z', '1969-12-31T18:59:59-05:00']]) {
    const loaded = await t.infra.call('env.load_seed', {expected_version: (await t.infra.call('env.snapshot')).version, request_id: 'clock-' + clock.slice(0, 4), data: t.seed, virtual_now: clock});
    const results = [];
    t.version = loaded.version;
    for (const [name, args] of reads) {
      const result = await t.read(name, args);
      results.push([name, result.status, result.now]);
    }
    equal('The task seed is loaded at the clock ' + clock + ', and all nine reads work and read now as ' + local, [loaded.status, results], ['ready', reads.map(([name]) => [name, 'ok', local])]);
    const before = await t.snapshot(), result = await t.refused('claims.update', {id: claim, description: 'A write at a clock outside the supported years.'}), now = await t.snapshot();
    check('At the clock ' + clock + ' a write is refused with invalid_event by the seed schema check of Core, and it changes nothing',
      result.status === 'invalid_event' && String(result.message).includes('schemas/seed.schema.json') && result.applied === false && same(now.data, before.data) && now.revision === before.revision, result);
  }
}

async function otherRun(t) {
  const now = await t.snapshot(t.peer);
  check('The second run other-run is not affected: its whole state is byte-identical', same(now, t.peerBefore));
  equal('The second run still holds the package fixture at the package clock, at its first version, with an empty audit',
    [now.data, now.virtual_now, now.epoch, now.revision, now.audit], [read(read('app.json').fixtures.seed), read('fixtures/clock.json').initial_time, 1, 0, []]);
}

// A registry with no initial_time: Core starts the App at 1970-01-01T00:00:00Z. In the insurer's time zone that instant is in 1969.
async function defaultClock(t) {
  const registry = JSON.parse(fs.readFileSync(t.registry, 'utf8')), file = path.join(path.dirname(t.registry), 'registry.no-clock.json');
  delete registry.initial_time;
  fs.writeFileSync(file, JSON.stringify(registry));
  // Infra starts the instance, and the Agent then reads the package fixture.
  const started = await (await t.open('infra', 'default-clock', file)).call('env.snapshot'), agent = await t.open('agent', 'default-clock', file);
  const fixture = read(read('app.json').fixtures.seed), auto = fixture.policies.find(policy => policy.kind === 'auto');
  const reads = nineReads({policy: auto.id, vehicle: auto.vehicles[0].id}, fixture.claims[0].id, fixture.claims.flatMap(claim => claim.estimates)[0].id), results = [];
  for (const [name, args] of reads) {
    const result = await agent.call(APP + name, args);
    results.push([name, result.status, result.now]);
  }
  equal('On a fresh instance of a registry with no initial_time, the clock is the default of Core, 1970-01-01T00:00:00Z, and all nine reads work and read now as 1969-12-31T19:00:00-05:00',
    [started.snapshot.virtual_now, results], ['1970-01-01T00:00:00Z', reads.map(([name]) => [name, 'ok', '1969-12-31T19:00:00-05:00'])]);
}

async function main() {
  const opts = options(process.argv.slice(2)), root = opts.runtime || process.env.PALE_RUNTIME_ROOT;
  if (!root) {
    console.log('SKIP: the real MCP checks need the public runtime. Give --runtime DIR or set PALE_RUNTIME_ROOT.');
    process.exitCode = SKIPPED;
    return;
  }
  const runtime = path.resolve(root), prepared = require(path.join(runtime, 'prepare.cjs')).prepare(DIR), clients = [];
  const report = {schema: 'alderbrook.mcp-integration.v1', runtime_version: require(path.join(runtime, 'package.json')).version,
    app_version: read('app.json').version, node: process.version, checks, passed: false};
  try {
    const t = await connect(runtime, prepared, clients);
    // The parts run in the order of the virtual time: 2 December to 18 December, then the reset, then the seeds that are loaded before their history or at a far clock.
    const parts = [loadTaskSeed, discovery, coverage, filing, writeReplays, requests, rental, estimate, overdueRequest, payments, offers, expiredOffer, rentalDays, refusedEvents, brokenSchemas,
      records, listFilters, reset, earlyOffers, farClock, otherRun, defaultClock];
    for (const part of parts) await part(t);
    report.passed = true;
    console.log('PASS: ' + checks.length + ' Alderbrook real MCP checks.');
  } catch (error) {
    report.error = error.message;
    console.error('FAIL: ' + error.message);
    process.exitCode = 1;
  } finally {
    await Promise.allSettled(clients.map(client => client.close()));
    prepared.cleanup();
  }
  if (opts.report) {
    fs.mkdirSync(path.dirname(path.resolve(opts.report)), {recursive: true});
    fs.writeFileSync(path.resolve(opts.report), JSON.stringify(report, null, 2) + '\n');
  }
}
main().catch(error => { console.error('FAIL: ' + error.message); process.exitCode = 1; });
