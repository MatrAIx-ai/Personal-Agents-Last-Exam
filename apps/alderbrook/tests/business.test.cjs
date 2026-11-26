'use strict';
// Business tests T01 to T19 of the approved plan (section 4, "Acceptance plan"). DATA tests check the evaluation dataset in data/evaluation/.
// A test name starts with its plan ID and its workflow. A letter after the ID marks one more test for that ID.
// PKG tests check the package itself. No test reads a file outside the package.
// In a copy of the package alone exactly two tests are skipped: T19 and T19b. They need the real runtime.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {builtinModules} = require('node:module');
const {spawnSync} = require('node:child_process');
const crypto = require('node:crypto');
const plugin = require('../plugin.cjs');
const tools = require('../tools.json');
const {createSender} = require('../infra/sender.cjs');
const {fixture} = require('./harness.cjs');
const {compile} = require('./schema-validator.cjs');
const SEED = require('../examples/task-data/seed.json');

const ROOT = path.resolve(__dirname, '..');
const seedSchema = compile(require('../schemas/seed.schema.json'), path.join(ROOT, 'schemas'));
const wireSchema = compile(require('../schemas/router-message.schema.json'), path.join(ROOT, 'schemas'));
const READS = ['policies.list', 'policies.get', 'coverage.check', 'claims.list', 'claims.get', 'estimates.get', 'payments.list', 'notifications.list', 'preferences.get'];
const EVENTS = ['request.issued', 'estimate.submitted', 'determination.issued', 'dispute.decided', 'offer.issued', 'payment.issued', 'repair.completed', 'claim.closed'];
const WRITES = ['claims.file', 'claims.update', 'claims.add_evidence', 'claims.withdraw', 'requests.respond', 'estimates.submit', 'determinations.dispute',
  'payee.set', 'offers.accept', 'offers.reject', 'rental.start', 'rental.end', 'preferences.update'];

// The small seed: its clock, its two policies and its three open claims.
const NOW = '2026-12-02T09:00:00-05:00';
const AUTO = 'pol-auto-01', RENTERS = 'pol-rent-01', CAR = 'veh-01', LOAN_CAR = 'veh-02', HOME = 'addr-01';
const CAR_CLAIM = 'clm-0007';   // collision on veh-01, which has no lienholder
const HOME_CLAIM = 'clm-0008';  // renters claim with a denied line and the open dispute dsp-0003
const LOAN_CLAIM = 'clm-0009';  // collision on veh-02, which has a lienholder
const SHOP = 'Corner Auto Body', ADJUSTER = 'Adjuster R. Imani';
const TO_SHOP = {kind: 'shop', name: SHOP}, TO_ME = {kind: 'policyholder'}, PAYOFF = {lienholder_payoff: 15100};
const LOSS = {id: AUTO, coverage: 'collision', subject_id: CAR, loss_at: '2026-12-01T08:00:00-05:00'};
const FILING = {...LOSS, description: 'Backed into a post in a parking garage.'};
const SCHEMA = 'Input schema';

// An instant of December 2026 in New York.
const dec = (day, time = '09:00:00') => '2026-12-' + String(day).padStart(2, '0') + 'T' + time + '-05:00';
const edit = (value, change) => { const next = structuredClone(value); change(next); return next; };
const pick = (object, ...keys) => keys.map(key => object[key]);
const start = (options = {}) => fixture({seed: SEED, now: NOW, ...options});
const claimOf = (f, id) => f.call('claims.get', {id}).claim;
const money = (f, id) => claimOf(f, id).summary;
const lineOf = (f, claim, id) => claimOf(f, claim).estimates.flatMap(e => e.lines).find(line => line.id === id);
const photo = description => ({kind: 'photo', dated: dec(1, '18:00:00'), description});
const REASON = 'The photo shows that the damage is new.';
const disputing = f => (id, claim = CAR_CLAIM, more = {}) => () => f.call('determinations.dispute', {id, claim_id: claim, reason: REASON, ...more});
// The whole money summary of a claim on the repair path. An amount that a test does not name is zero.
const repairSummary = amounts => ({approved_total: 0, insurer_owes: 0, over_limit: 0, paid: 0, still_due: 0, overpaid: 0, my_share: 0, not_approved_total: 0,
  settlement: null, ...amounts});

// A refused call gives the error code of the plan and leaves the data as it was. `text` is a part of the message of the rule that refuses it.
// SCHEMA stands for a call that breaks its input schema: Core answers `invalid_arguments` before the App runs.
function unchanged(f, fn, code, label = code, text = '') {
  const before = f.data;
  assert.throws(fn, error => {
    assert.equal(error.message.startsWith(SCHEMA) ? SCHEMA : error.code, code, label + ': ' + error.message);
    assert.ok(error.message.includes(text), label + ': ' + error.message);
    return true;
  }, label);
  assert.deepEqual(f.data, before, label);
}

// The eight events, as the insurer, the shop and the lender send them.
const event = (name, at, payload, id) => ({event_id: 'ev-' + id, at, operation: 'alderbrook.' + name, payload});
const request = (at, id, claim, keys, due_at) => event('request.issued', at, {info_request_id: id, claim_id: claim,
  asks: keys.map(key => ({key, text: 'Please send: ' + key + '.'})), ...(due_at ? {due_at} : {}), issued_by: ADJUSTER}, id);
const estimate = (at, id, claim, lines, more = {}) => event('estimate.submitted', at, {estimate_id: id, claim_id: claim, kind: 'initial', source: 'shop', shop_name: SHOP,
  lines: Object.entries(lines).map(([line_id, amount]) => ({line_id, text: 'Repair line ' + line_id, amount})), ...more}, id);
// A number approves the line for that amount. A string denies it with that reason.
const determination = (at, id, claim, lines) => event('determination.issued', at, {determination_id: id, claim_id: claim, issued_by: ADJUSTER,
  lines: Object.entries(lines).map(([line_id, given]) => typeof given === 'number' ? {line_id, status: 'approved', amount: given} : {line_id, status: 'denied', reason: given})}, id);
const decided = (at, dispute, decision, line) => event('dispute.decided', at,
  {dispute_id: dispute, decision, ...(line ? {line} : {}), decided_by: 'Claims supervisor'}, 'decided-' + dispute);
const offer = (at, id, claim, valuation, more = {}) => event('offer.issued', at, {offer_id: id, claim_id: claim, valuation, ...more, issued_by: ADJUSTER}, id);
const payment = (at, id, claim, kind, amount, payee) => event('payment.issued', at, {payment_id: id, claim_id: claim, kind, amount, ...(payee ? {payee} : {})}, id);
const completed = (at, claim, total) => event('repair.completed', at,
  {claim_id: claim, reported_by: SHOP, ...(total === undefined ? {} : {final_invoice_total: total})}, 'done-' + claim);
const closed = (at, claim, outcome) => event('claim.closed', at, {claim_id: claim, outcome}, 'closed-' + claim);

// The main paths of W3 and W4 in the plan, step by step. `walk` returns the claim as it reads after each step.
const THREE_LINES = {'ln-01': 900, 'ln-02': 350, 'ln-03': 750}, TWO_MORE = {'ln-04': 1000, 'ln-05': 500};
const REPAIR_PATH = {
  estimate: f => f.event(estimate(dec(4, '10:00:00'), 'est-0031', CAR_CLAIM, THREE_LINES)),
  approval: f => f.event(determination(dec(4, '15:30:00'), 'det-0044', CAR_CLAIM, THREE_LINES)),
  payee: f => f.call('payee.set', {id: CAR_CLAIM, payee: TO_SHOP}),
  payment: f => f.event(payment(dec(7, '12:00:00'), 'pay-0021', CAR_CLAIM, 'repair', 1500)),
  supplement: f => f.event(estimate(dec(9, '11:20:00'), 'est-0032', CAR_CLAIM, TWO_MORE, {kind: 'supplement'})),
  secondApproval: f => f.event(determination(dec(10, '10:00:00'), 'det-0045', CAR_CLAIM, TWO_MORE)),
  secondPayment: f => f.event(payment(dec(11, '12:00:00'), 'pay-0022', CAR_CLAIM, 'repair', 1500))
};
const TOTAL_LOSS_PATH = {
  rental: f => { f.advance(dec(3, '10:00:00')); f.call('rental.start', {id: LOAN_CLAIM, start_at: dec(3, '10:00:00'), daily_rate: 45}); },
  offer: f => f.event(offer(dec(10, '09:00:00'), 'off-0005', LOAN_CLAIM, 14200, {...PAYOFF, respond_by: dec(17, '17:00:00')})),
  rejection: f => {
    const items = [{kind: 'report', dated: dec(8), description: 'Dealer quote for the same model and year.'}, {kind: 'other', dated: dec(8), description: 'Loan payoff letter.'}];
    const {evidence_ids} = f.call('claims.add_evidence', {id: LOAN_CLAIM, items});
    f.call('offers.reject', {id: 'off-0005', reason: 'The offer is below the loan payoff.', evidence_ids});
  },
  secondOffer: f => f.event(offer(dec(12, '09:00:00'), 'off-0006', LOAN_CLAIM, 15900, PAYOFF)),
  acceptance: f => f.call('offers.accept', {id: 'off-0006'}),
  day18: f => f.advance(dec(18, '12:00:00'))
};
function walk(f, steps, claim, last) {
  const seen = {};
  for (const [name, step] of Object.entries(steps)) {
    step(f);
    seen[name] = claimOf(f, claim);
    if (name === last) break;
  }
  return seen;
}
const repair = (f, last) => walk(f, REPAIR_PATH, CAR_CLAIM, last);
const totalLoss = (f, last) => walk(f, TOTAL_LOSS_PATH, LOAN_CLAIM, last);

// Each of the nine reads, for every policy, claim and estimate of the data. `loss_at` is the loss that coverage.check asks about.
function everyRead(f, loss_at = f.ctx.virtual_now) {
  const data = f.data, results = [], read = (name, args) => results.push([name, f.call(name, args)]);
  for (const name of ['policies.list', 'claims.list', 'payments.list', 'notifications.list', 'preferences.get']) read(name);
  for (const policy of data.policies) {
    read('policies.get', {id: policy.id});
    const subjects = policy.insured_address ? [policy.insured_address.id] : policy.vehicles.map(v => v.id);
    const check = {id: policy.id, loss_at, estimated_amount: 420};
    for (const {type} of policy.coverages) for (const subject_id of subjects) read('coverage.check', {...check, coverage: type, subject_id});
  }
  for (const claim of data.claims) {
    read('claims.get', {id: claim.id});
    for (const {id} of claim.estimates) read('estimates.get', {id});
  }
  return results;
}

// The examples of the plan, one on each line of a helper file. `dev/check-plan-examples.cjs` compares them with the plan, byte for byte.
const verbatim = file => fs.readFileSync(path.join(__dirname, file), 'utf8').split('\n').filter(line => line.startsWith('{')).map(line => line.replace(/,$/, ''));
const PLAN_EVENTS = verbatim('proposal-events.json'), PLAN_WIRE = verbatim('proposal-wire-message.json')[0];

// A script that needs the real runtime. Without PALE_RUNTIME_ROOT the test is skipped. With it the script runs:
// exit code 0 is a pass, exit code 77 is a skip with the reason that the script printed, and anything else is a failure.
function withRuntime(script) {
  const runtime = process.env.PALE_RUNTIME_ROOT;
  const skip = !runtime ? 'Set PALE_RUNTIME_ROOT to the runtime folder of a PALE checkout to run ' + script + '.'
    : !fs.existsSync(path.join(ROOT, script)) ? script + ' is not in this copy of the package.' : false;
  return [{skip}, t => {
    const result = spawnSync(process.execPath, [script, '--runtime', path.resolve(runtime)], {cwd: ROOT, encoding: 'utf8', timeout: 300000});
    const reason = /^SKIP: (.+)$/m.exec(result.stdout || '');
    if (result.status === 77 && reason) return t.skip(reason[1]);
    assert.equal(result.status, 0, script + ' failed:\n' + result.stdout + result.stderr);
  }];
}

// The Mail sender with fake connections: plain objects with `call`. The fake router remembers each identity, like the real one:
// the same message again is a duplicate, and another message under a known identity is a conflict. `answers` replaces its next answers.
function senderWorld(snapshot, answers = []) {
  const w = {snapshot, answers, reads: [], published: []}, known = new Map();
  w.infra = {call: async name => {
    assert.equal(name, 'env.snapshot', 'The sender only reads Alderbrook.');
    w.reads.push(name);
    return w.snapshot ? {status: 'ok', snapshot: structuredClone(w.snapshot)} : {status: 'permission_denied'};
  }};
  w.router = {call: async (name, {request_id, message}) => {
    assert.equal(name, 'router.publish');
    w.published.push({request_id, message});
    const answer = w.answers.shift(), first = known.get(request_id);
    if (answer instanceof Error) throw answer;
    if (answer) return answer;
    if (first) return JSON.stringify(first.message) === JSON.stringify(message) ? {...first.receipt, duplicate: true} : {status: 'rejected', code: 'idempotency_conflict'};
    known.set(request_id, {message, receipt: {status: 'committed', event_id: 'mail-' + (known.size + 1)}});
    return known.get(request_id).receipt;
  }};
  w.sender = firstEpoch => createSender({infra: w.infra, router: w.router, firstEpoch});
  return w;
}
// One lifecycle of the App as `env.snapshot` shows it: its epoch, the loaded seed and the current data.
const lifecycle = (epoch, seed, data) => ({epoch, initial_data: seed, data});
// The rows that `publishPending` returns: a delivery with the number of its Mail record, and an answer that delivered nothing.
const delivered = (id, request_id, n) => ({notification_id: id, request_id, status: 'committed', code: null, event_id: 'mail-' + n, duplicate: false});
const undelivered = (id, {status, code}) => ({notification_id: id, request_id: id, status, code, event_id: null, duplicate: false});

test('T01 [W1] policies: list and get show the coverages, people, vehicles or address, rental benefit and lienholder', () => {
  const f = start(), get = id => f.call('policies.get', {id}).policy, auto = get(AUTO), renters = get(RENTERS);
  assert.deepEqual(f.call('policies.list').items, [auto, renters]);
  assert.deepEqual(auto, {...SEED.policies[0], in_force: true});
  assert.deepEqual(auto.coverages, [{type: 'collision', deductible: 500, limit: null}, {type: 'comprehensive', deductible: 250, limit: null}]);
  assert.deepEqual(auto.vehicles.map(v => [v.id, v.lienholder]), [[CAR, null], [LOAN_CAR, {name: 'Harbor Credit Union'}]]);
  assert.deepEqual(auto.rental_benefit, {daily_cap: 40, max_days: 30});
  assert.deepEqual([auto.named_insured.person_id, auto.listed_people.map(p => p.role)], ['person-jordan', ['named_insured', 'driver', 'driver']]);
  assert.deepEqual([renters.kind, renters.insured_address.id, renters.vehicles, renters.rental_benefit], ['renters', HOME, [], null]);
  assert.deepEqual(renters.coverages, [{type: 'personal_property', deductible: 250, limit: 15000}]);
  // `in_force` follows the clock. The renters term ends on 1 March 2027.
  f.advance('2027-02-28T23:59:59-05:00');
  assert.equal(get(RENTERS).in_force, true);
  f.advance('2027-03-01T00:00:00-05:00');
  assert.deepEqual([get(RENTERS).in_force, get(AUTO).in_force], [false, true]);
  unchanged(f, () => get('pol-none'), 'not_found');
});

test('T02 [W1] coverage.check: a loss on 1 December is covered, with a deductible of 500 and 31 December as the last day to file', () => {
  const f = start(), before = f.data, check = change => f.call('coverage.check', {...LOSS, ...change});
  assert.equal(SEED.insurer.rules.notice_days, 30);
  assert.deepEqual(check(), {covered: true, coverage: {type: 'collision', deductible: 500, limit: null}, failures: [], last_day_to_file: '2026-12-31',
    expected_payment: null, flags: [], now: NOW});
  // With an estimated amount it returns the payment to expect, which is `insurer_owes` for that amount.
  assert.deepEqual(pick(check({estimated_amount: 420}), 'covered', 'expected_payment', 'flags'), [true, 0, ['under_deductible']]);
  assert.deepEqual(pick(check({estimated_amount: 2000}), 'expected_payment', 'flags'), [1500, []]);
  assert.equal(check({id: RENTERS, coverage: 'personal_property', subject_id: HOME, estimated_amount: 20000}).expected_payment, 15000);
  // Control: a loss on 15 June, before the term began on 1 July.
  assert.deepEqual(pick(check({loss_at: '2026-06-15T10:00:00-04:00'}), 'covered', 'failures'), [false, ['not_in_force', 'too_late']]);
  // Control: a loss on 20 October, checked 43 days later.
  assert.deepEqual(pick(check({loss_at: '2026-10-20T10:00:00-04:00'}), 'covered', 'failures', 'last_day_to_file'), [false, ['too_late'], '2026-11-19']);
  assert.deepEqual(pick(check({coverage: 'personal_property'}), 'covered', 'coverage', 'failures'), [false, null, ['not_covered']]);
  assert.deepEqual(f.data, before);
});

test('T03 [W1] claim reads: the list uses the filing time for its window and its order, and one claim shows all its parts', () => {
  const f = start(), ids = args => f.call('claims.list', args).items.map(row => row.id);
  // This claim is filed last, and its loss is older than the losses of the two other auto claims.
  const late = f.call('claims.file', {...FILING, coverage: 'comprehensive', loss_at: '2026-11-20T10:00:00-05:00'}).id;
  assert.deepEqual(ids(), [HOME_CLAIM, CAR_CLAIM, LOAN_CLAIM, late]);
  assert.deepEqual(ids({start: '2026-11-30T00:00:00-05:00', end: '2026-12-01T23:59:59-05:00'}), [CAR_CLAIM, LOAN_CLAIM]);
  assert.deepEqual(ids({start: '2026-11-28T00:00:00-05:00', end: '2026-11-29T23:59:59-05:00'}), []);
  assert.deepEqual(ids({id: RENTERS}), [HOME_CLAIM]);
  assert.deepEqual(ids({coverage: 'collision'}), [CAR_CLAIM, LOAN_CLAIM]);
  assert.deepEqual(ids({id: AUTO, coverage: 'comprehensive', state: 'open', start: NOW, end: NOW}), [late]);
  f.call('claims.withdraw', {id: late});
  assert.deepEqual([ids({state: 'withdrawn'}), ids({state: 'closed'}), ids({state: 'open'})], [[late], [], [HOME_CLAIM, CAR_CLAIM, LOAN_CLAIM]]);
  assert.deepEqual(f.call('claims.list', {id: RENTERS}).items[0], {id: HOME_CLAIM, policy_id: RENTERS, coverage: 'personal_property', subject_id: HOME,
    loss_at: '2026-11-10T19:30:00-05:00', filed_at: '2026-11-12T08:05:00-05:00', state: 'open', path: 'repair', outcome: null, flags: ['lines_denied']});

  const claim = claimOf(f, HOME_CLAIM), parts = ['history', 'evidence', 'requests', 'estimates', 'determinations', 'disputes', 'offers', 'rentals', 'payments'];
  assert.deepEqual(parts.map(part => claim[part].length), [1, 2, 0, 1, 1, 1, 0, 0, 0]);
  assert.deepEqual(pick(claim, 'payee', 'deductible', 'limit', 'lienholder', 'driver', 'repair_completed_at'), [null, 250, 15000, null, null, null]);
  assert.deepEqual(claim.summary, repairSummary({approved_total: 1150, insurer_owes: 900, still_due: 900, my_share: 250, not_approved_total: 420}));
  assert.deepEqual(claim.flags, ['lines_denied']);
  const estimateRead = f.call('estimates.get', {id: 'est-0029'}).estimate;
  assert.deepEqual(estimateRead, claim.estimates[0]);
  assert.equal(estimateRead.claim_id, HOME_CLAIM);
  assert.deepEqual(estimateRead.lines.map(line => [line.id, line.amount, ...pick(line.standing, 'status', 'approved_amount', 'reason')]),
    [['ln-01', 1150, 'approved', 1150, null], ['ln-02', 420, 'denied', null, 'No proof of ownership.']]);

  for (const name of ['claims.list', 'payments.list', 'notifications.list']) unchanged(f, () => f.call(name, {start: dec(2), end: dec(1)}), 'invalid_window', name);
  const unknown = [['claims.get', {id: 'clm-9999'}], ['estimates.get', {id: 'est-9999'}], ['claims.list', {id: 'pol-none'}],
    ['payments.list', {id: 'clm-9999'}], ['notifications.list', {id: 'clm-9999'}]];
  for (const [name, args] of unknown) unchanged(f, () => f.call(name, args), 'not_found', name);
  // Both errors fit these calls. `not_found` is the earlier one in the table.
  for (const [name, args] of unknown.slice(2)) unchanged(f, () => f.call(name, {...args, start: dec(2), end: dec(1)}), 'not_found', name);
});

test('T03b [W1] claim reads: every read returns now with the UTC offset of the insurer and leaves the data byte-identical', () => {
  const f = start();
  repair(f);
  const before = JSON.stringify(f.data), results = everyRead(f);
  assert.equal(JSON.stringify(f.data), before);
  assert.deepEqual([...new Set(results.map(([name]) => name))].sort(), [...READS].sort());
  for (const [name, result] of results) assert.equal(result.now, dec(11, '12:00:00'), name);
  f.advance('2026-12-25T17:00:00Z');
  assert.equal(f.call('preferences.get').now, dec(25, '12:00:00'));
});

test('T03c [W1] claim reads: the package fixture has the counts of the plan, and every read leaves it byte-identical', () => {
  const f = fixture(), data = f.data, before = JSON.stringify(data);
  everyRead(f);
  assert.equal(JSON.stringify(f.data), before);
  const all = part => data.claims.flatMap(claim => claim[part]), kinds = values => [...new Set(values)].sort();
  const auto = data.policies.find(policy => policy.kind === 'auto');
  assert.deepEqual({
    rules: Object.keys(data.insurer.rules).sort(), policies: data.policies.map(policy => policy.kind).sort(),
    vehicles: auto.vehicles.length, lienholders: auto.vehicles.filter(v => v.lienholder).length, rental_benefit: auto.rental_benefit !== null,
    listed_people: kinds(data.policies.flatMap(policy => policy.listed_people.map(person => person.person_id))).length,
    claims: data.claims.length, states: kinds(data.claims.map(claim => claim.state)),
    outcomes: kinds(data.claims.filter(claim => claim.state === 'closed').map(claim => claim.outcome)),
    paths: kinds(data.claims.map(claim => claim.path)), coverages: kinds(data.claims.map(claim => claim.coverage)),
    requests: all('requests').length, estimates: all('estimates').length, lines: all('estimates').flatMap(e => e.lines).length,
    determinations: all('determinations').length, disputes: all('disputes').length, offers: all('offers').length,
    payments: all('payments').length, payment_kinds: kinds(all('payments').map(p => p.kind)), rentals: all('rentals').length,
    evidence: all('evidence').length, notifications: data.notifications.length
  }, {
    rules: ['dispute_window_days', 'notice_days', 'offer_response_days', 'rental_grace_days', 'request_response_days'], policies: ['auto', 'renters'],
    vehicles: 2, lienholders: 1, rental_benefit: true, listed_people: 4,
    claims: 9, states: ['closed', 'open', 'withdrawn'], outcomes: ['denied', 'no_response', 'paid'],
    paths: ['repair', 'total_loss'], coverages: ['collision', 'comprehensive', 'personal_property'],
    requests: 14, estimates: 12, lines: 46, determinations: 15, disputes: 5, offers: 4,
    payments: 11, payment_kinds: ['rental', 'repair', 'settlement'], rentals: 3, evidence: 60, notifications: 22
  });
});

test('T04 [W1] repair summary: three lines approved for 2,000 read approved_total 2,000, insurer_owes 1,500, my_share 500 and still_due 1,500', () => {
  const f = start(), claim = repair(f, 'approval').approval;
  assert.deepEqual(claim.estimates[0].lines.map(line => [line.amount, line.standing.status, line.standing.approved_amount]),
    [[900, 'approved', 900], [350, 'approved', 350], [750, 'approved', 750]]);
  assert.deepEqual(claim.summary, repairSummary({approved_total: 2000, insurer_owes: 1500, still_due: 1500, my_share: 500}));
  assert.deepEqual(claim.flags, []);
  // The summary and the flags are computed when they are read. The stored claim has neither.
  const kept = f.data.claims.find(c => c.id === CAR_CLAIM);
  assert.ok(!('summary' in kept) && !('flags' in kept));
});

test('T04b [W1] repair summary: a limit, a line approved for less, an approved total under the deductible, and cents', () => {
  const f = start();
  // The renters coverage has a deductible of 250 and a limit of 15,000. The seed has 1,150 approved and 420 denied.
  f.event(estimate(dec(3), 'est-0040', HOME_CLAIM, {'ln-03': 16000}));
  f.event(determination(dec(3, '12:00:00'), 'det-0050', HOME_CLAIM, {'ln-03': 16000}));
  assert.deepEqual(money(f, HOME_CLAIM),
    repairSummary({approved_total: 17150, insurer_owes: 15000, over_limit: 1900, still_due: 15000, my_share: 250, not_approved_total: 420}));
  // A pending line, and a line approved for 600 of 750.
  f.event(estimate(dec(4, '10:00:00'), 'est-0031', CAR_CLAIM, THREE_LINES));
  f.event(determination(dec(4, '15:30:00'), 'det-0044', CAR_CLAIM, {'ln-01': 900, 'ln-03': 600}));
  assert.deepEqual(pick(money(f, CAR_CLAIM), 'approved_total', 'insurer_owes', 'my_share', 'not_approved_total'), [1500, 1000, 500, 500]);
  assert.deepEqual(claimOf(f, CAR_CLAIM).flags, ['lines_pending']);
  f.event(determination(dec(5), 'det-0045', CAR_CLAIM, {'ln-02': 'Wear from before the loss.'}));
  assert.deepEqual([money(f, CAR_CLAIM).not_approved_total, claimOf(f, CAR_CLAIM).flags], [500, ['lines_denied']]);
  // One line of 420 is approved under a deductible of 500.
  f.event(estimate(dec(6), 'est-0033', LOAN_CLAIM, {'ln-01': 420}));
  f.event(determination(dec(6, '12:00:00'), 'det-0046', LOAN_CLAIM, {'ln-01': 420}));
  assert.deepEqual(money(f, LOAN_CLAIM), repairSummary({approved_total: 420, my_share: 420}));
  assert.deepEqual(claimOf(f, LOAN_CLAIM).flags, ['under_deductible']);

  // Cents: the sums are exact. A payment of the exact amount leaves nothing due, and one cent more is one cent overpaid.
  const g = start(), cents = {'ln-01': 1234.56, 'ln-02': 0.1, 'ln-03': 0.2, 'ln-04': 0.57, 'ln-05': 8.2};
  g.event(estimate(dec(3), 'est-0031', CAR_CLAIM, cents));
  g.event(determination(dec(3, '12:00:00'), 'det-0044', CAR_CLAIM, cents));
  g.event(payment(dec(4), 'pay-0021', CAR_CLAIM, 'repair', 743.63));
  assert.deepEqual(money(g, CAR_CLAIM), repairSummary({approved_total: 1243.63, insurer_owes: 743.63, paid: 743.63, my_share: 500}));
  assert.deepEqual(claimOf(g, CAR_CLAIM).flags, []);
  g.event(payment(dec(5), 'pay-0022', CAR_CLAIM, 'repair', 0.01));
  assert.deepEqual([...pick(money(g, CAR_CLAIM), 'paid', 'still_due', 'overpaid'), claimOf(g, CAR_CLAIM).flags], [743.64, 0, 0.01, ['overpaid']]);
  // A third decimal is refused: `invalid_event` in an event and `invalid_arguments` in each call that takes an amount. T18b has the seed.
  unchanged(g, () => g.event(payment(dec(6), 'pay-0023', CAR_CLAIM, 'repair', 10.005)), 'invalid_event');
  unchanged(g, () => g.call('estimates.submit', {id: CAR_CLAIM, kind: 'supplement', shop_name: SHOP, lines: [{text: 'Clip', amount: 10.005}]}), 'invalid_arguments');
  unchanged(g, () => g.call('coverage.check', {...LOSS, estimated_amount: 420.005}), 'invalid_arguments');
  unchanged(g, () => g.call('rental.start', {id: CAR_CLAIM, start_at: dec(5), daily_rate: 45.005}), 'invalid_arguments');
});

test('T04c [W1] money summary: a sum above the largest single amount is still read', () => {
  const f = start(), BIG = 60000000, LIEN = {kind: 'lienholder'};
  // The schemas allow one amount up to 100,000,000. The sums that the App computes have no upper bound.
  f.call('estimates.submit', {id: CAR_CLAIM, kind: 'initial', shop_name: SHOP, lines: [{text: 'Frame', amount: BIG}, {text: 'Body', amount: BIG}]});
  assert.deepEqual(money(f, CAR_CLAIM), repairSummary({not_approved_total: 120000000}));
  f.event(determination(dec(3), 'det-0044', CAR_CLAIM, {'ln-p01': BIG, 'ln-p02': BIG}));
  assert.deepEqual(money(f, CAR_CLAIM), repairSummary({approved_total: 120000000, insurer_owes: 119999500, still_due: 119999500, my_share: 500}));
  for (const id of ['pay-0021', 'pay-0022', 'pay-0023']) f.event(payment(dec(4), id, CAR_CLAIM, 'repair', BIG));
  assert.deepEqual(money(f, CAR_CLAIM), repairSummary({approved_total: 120000000, insurer_owes: 119999500, paid: 180000000, overpaid: 60000500, my_share: 500}));
  // The renters coverage has a limit of 15,000. The seed has 1,150 approved, and the deductible is 250.
  f.event(estimate(dec(5), 'est-0040', HOME_CLAIM, {'ln-03': BIG, 'ln-04': BIG}));
  f.event(determination(dec(5, '12:00:00'), 'det-0050', HOME_CLAIM, {'ln-03': BIG, 'ln-04': BIG}));
  assert.deepEqual(pick(money(f, HOME_CLAIM), 'approved_total', 'insurer_owes', 'over_limit'), [120001150, 15000, 119985900]);
  // Two rental days at 60,000,000 a day, under a cap of 40.
  f.call('rental.start', {id: LOAN_CLAIM, start_at: dec(5), daily_rate: BIG});
  f.advance(dec(7));
  assert.deepEqual(pick(claimOf(f, LOAN_CLAIM).rentals[0], 'covered_days', 'my_cost'), [2, 119999920]);
  // Settlement payments before an offer is accepted are all overpaid.
  f.event(offer(dec(8), 'off-0005', LOAN_CLAIM, 15900, PAYOFF));
  for (const [id, payee] of [['pay-0031', LIEN], ['pay-0032', LIEN], ['pay-0033', TO_ME], ['pay-0034', TO_ME]]) f.event(payment(dec(9), id, LOAN_CLAIM, 'settlement', BIG, payee));
  const total = money(f, LOAN_CLAIM);
  assert.deepEqual([total.overpaid, ...pick(total.settlement, 'paid_to_lienholder', 'paid_to_me')], [240000000, 120000000, 120000000]);
  assert.equal(f.call('claims.list').items.length, 3);
});

test('T04d [W1] amounts: 10.001 and 10.000000001 are refused in a call, in an event and in a seed, a payment of 0.000000001 is refused, and 1234.56 is returned exactly', () => {
  const f = start(), T = dec(3), DECIMALS = 'An amount has more than two decimals', TINY = 0.000000001;
  const submit = amount => f.call('estimates.submit', {id: CAR_CLAIM, kind: 'initial', shop_name: SHOP, lines: [{text: 'Door', amount}]});
  for (const amount of [10.001, 10.000000001]) {
    // The three calls that take an amount.
    const calls = [() => submit(amount), () => f.call('rental.start', {id: CAR_CLAIM, start_at: dec(1), daily_rate: amount}), () => f.call('coverage.check', {...LOSS, estimated_amount: amount})];
    for (const call of calls) unchanged(f, call, 'invalid_arguments', 'a call with ' + amount, 'An amount has at most two decimals');
    // Every amount that an event gives. HOME_CLAIM has the line ln-02 and the open dispute dsp-0003.
    const events = [estimate(T, 'est-0090', CAR_CLAIM, {'ln-09': amount}), determination(T, 'det-0090', HOME_CLAIM, {'ln-02': amount}), decided(T, 'dsp-0003', 'changed', {status: 'approved', amount}),
      offer(T, 'off-0090', LOAN_CLAIM, amount, PAYOFF), offer(T, 'off-0090', LOAN_CLAIM, 15900, {lienholder_payoff: amount}), payment(T, 'pay-0090', CAR_CLAIM, 'repair', amount), completed(T, CAR_CLAIM, amount)];
    for (const e of events) unchanged(f, () => f.event(e), 'invalid_event', e.operation + ' with ' + amount, DECIMALS);
    // T18b has every amount that a seed stores.
    assert.throws(() => plugin.validateSeed(f.ctx, edit(SEED, seed => { seed.policies[0].coverages[0].deductible = amount; })), {code: 'invalid_seed', message: DECIMALS + '.'}, 'a seed with ' + amount);
  }
  // A payment of a billionth is not a payment of zero cents. It is refused, so the claim has no payment.
  unchanged(f, () => f.event(payment(T, 'pay-0090', CAR_CLAIM, 'repair', TINY)), 'invalid_event', 'a payment of ' + TINY, DECIMALS);

  // An exact two-decimal amount is taken as given: a line, its decision, a rental rate, a payment, an invoice total, a valuation and a payoff.
  const A = 1234.56, returned = [];
  submit(A);
  f.call('rental.start', {id: CAR_CLAIM, start_at: dec(1), daily_rate: A});
  for (const e of [determination(T, 'det-0044', CAR_CLAIM, {'ln-p01': A}), payment(dec(4), 'pay-0021', CAR_CLAIM, 'repair', A), completed(dec(5), CAR_CLAIM, A),
    offer(dec(6), 'off-0005', LOAN_CLAIM, A, {lienholder_payoff: A})]) f.event(e);
  // The nine reads return it in 16 places: the seven stored amounts in each read that shows them, and the sums `approved_total` and `paid`. Each one is exactly 1234.56.
  JSON.stringify(everyRead(f, LOSS.loss_at), (key, value) => { if (typeof value === 'number' && Math.abs(value - A) < 0.01) returned.push(value); return value; });
  assert.deepEqual(returned, Array(16).fill(A));
  assert.deepEqual([...pick(money(f, CAR_CLAIM), 'approved_total', 'insurer_owes', 'paid', 'overpaid', 'my_share'), f.call('coverage.check', {...LOSS, estimated_amount: 1734.56}).expected_payment],
    [A, 734.56, A, 500, 500, A]);
});

test('T05 [W2] filing: a claim filed on 2 December is open on the repair path, with a deductible of 500 and no driver', () => {
  const f = start(), id = f.call('claims.file', FILING).id, claim = claimOf(f, id);
  assert.equal(id, 'clm-0010');
  assert.deepEqual(pick(claim, 'state', 'path', 'deductible', 'driver', 'police_report_number', 'filed_at', 'loss_at'), ['open', 'repair', 500, null, null, NOW, LOSS.loss_at]);
  assert.deepEqual([claim.summary.insurer_owes, claim.flags, claim.history.map(row => row.action)], [0, [], ['claims.file']]);
  // Control: the same policy, coverage, vehicle and loss day, at another hour.
  unchanged(f, () => f.call('claims.file', {...FILING, loss_at: dec(1, '21:15:00')}), 'duplicate_claim');
  // The same loss day is accepted on the other vehicle, and for another coverage.
  assert.equal(f.call('claims.file', {...FILING, subject_id: LOAN_CAR}).id, 'clm-0011');
  assert.equal(f.call('claims.file', {...FILING, coverage: 'comprehensive'}).id, 'clm-0012');
  assert.deepEqual(pick(claimOf(f, 'clm-0012'), 'state', 'deductible'), ['open', 250]);
  // The driver is a listed person, a named person who is not on the policy, or nobody yet.
  const drivers = [{kind: 'listed', person_id: 'person-priya'}, {kind: 'other', name: 'Dana Ortiz'}, null];
  drivers.forEach((driver, index) => {
    const filed = f.call('claims.file', {...FILING, loss_at: '2026-11-2' + index + 'T10:00:00-05:00', driver, police_report_number: 'RPD-26-12000' + index}).id;
    assert.deepEqual(pick(claimOf(f, filed), 'driver', 'police_report_number'), [driver, 'RPD-26-12000' + index]);
  });
});

test('T05b [W2] filing: claims.file returns the first error of the table, and coverage.check lists every one that fits', () => {
  const JUNE = '2026-06-15T10:00:00-04:00', OCTOBER = '2026-10-20T10:00:00-04:00';
  // [what is wrong, the changed arguments, every failure in the order of the table, the clock]
  const cases = [
    ['a loss in the future', {loss_at: dec(2, '09:00:01')}, ['invalid_window']],
    ['a loss in the future, after the end of the term', {loss_at: '2027-08-01T10:00:00-04:00'}, ['invalid_window', 'not_in_force']],
    ['a loss on 15 June, before the term began on 1 July', {loss_at: JUNE}, ['not_in_force', 'too_late']],
    ['the same loss, for a coverage that the policy does not have', {loss_at: JUNE, coverage: 'personal_property'}, ['not_in_force', 'not_covered', 'too_late']],
    ['a loss one day after the end of the term', {loss_at: '2027-07-02T10:00:00-04:00'}, ['not_in_force'], '2027-07-05T09:00:00-04:00'],
    ['a coverage that the policy does not have', {coverage: 'personal_property'}, ['not_covered']],
    ['the same coverage, for a loss on 20 October', {loss_at: OCTOBER, coverage: 'personal_property'}, ['not_covered', 'too_late']],
    ['a loss on 20 October, 43 days before', {loss_at: OCTOBER}, ['too_late']],
    ['the loss day of an open claim, 31 days later', {id: RENTERS, coverage: 'personal_property', subject_id: HOME, loss_at: '2026-11-10T08:00:00-05:00'},
      ['too_late', 'duplicate_claim'], dec(11, '00:00:00')],
    ['the loss day of an open claim', {loss_at: '2026-11-28T08:00:00-05:00'}, ['duplicate_claim']]
  ];
  for (const [label, change, failures, clock = NOW] of cases) {
    const f = start({now: clock}), check = f.call('coverage.check', {...LOSS, ...change});
    assert.deepEqual([check.covered, check.failures], [false, failures], label);
    unchanged(f, () => f.call('claims.file', {...FILING, ...change}), failures[0], label);
  }
  // An unknown policy, vehicle, address or listed person is `not_found`, before every other error.
  const f = start();
  for (const change of [{id: 'pol-none'}, {subject_id: 'veh-99'}, {subject_id: HOME}]) {
    unchanged(f, () => f.call('coverage.check', {...LOSS, ...change, loss_at: JUNE}), 'not_found');
    unchanged(f, () => f.call('claims.file', {...FILING, ...change, loss_at: JUNE}), 'not_found');
  }
  unchanged(f, () => f.call('claims.file', {...FILING, loss_at: JUNE, driver: {kind: 'listed', person_id: 'person-noor'}}), 'not_found');
});

test('T05c [W2] filing: the loss time can be the current instant, and the term of a policy has its first instant and not its last', () => {
  const term = SEED.policies[0].term, failures = (f, loss_at) => f.call('coverage.check', {...LOSS, loss_at}).failures;
  const refuse = (f, loss_at, code) => unchanged(f, () => f.call('claims.file', {...FILING, loss_at}), code, code + ' for a loss at ' + loss_at);
  const file = (f, loss_at) => claimOf(f, f.call('claims.file', {...FILING, loss_at}).id).loss_at;
  // A loss at the current instant is not in the future. One millisecond later it is.
  const f = start(), later = dec(2, '09:00:00.001');
  assert.deepEqual([failures(f, NOW), failures(f, later)], [[], ['invalid_window']]);
  refuse(f, later, 'invalid_window');
  assert.equal(file(f, NOW), NOW);
  // The policy is in force at the first instant of its term, and not one millisecond before it.
  const first = start({now: term.start}), before = '2026-06-30T23:59:59.999-04:00';
  assert.deepEqual([failures(first, term.start), failures(first, before)], [[], ['not_in_force']]);
  refuse(first, before, 'not_in_force');
  assert.equal(file(first, term.start), term.start);
  // The policy is in force one millisecond before the end of its term, and not at the end itself.
  const last = start({now: term.end}), final = '2027-06-30T23:59:59.999-04:00';
  assert.deepEqual([failures(last, final), failures(last, term.end)], [[], ['not_in_force']]);
  refuse(last, term.end, 'not_in_force');
  assert.equal(file(last, final), final);
});

test('T06 [W2] updates: an open claim takes a new description, police report number, driver and evidence items', () => {
  const f = start(), update = change => f.call('claims.update', {id: LOAN_CLAIM, ...change});
  assert.equal(update({description: 'Slid on ice into a guard rail. The car was towed.', police_report_number: 'NYSP-26-004417'}).id, LOAN_CLAIM);
  update({driver: {kind: 'other', name: 'Dana Ortiz'}});
  assert.deepEqual(pick(claimOf(f, LOAN_CLAIM), 'description', 'police_report_number', 'driver'),
    ['Slid on ice into a guard rail. The car was towed.', 'NYSP-26-004417', {kind: 'other', name: 'Dana Ortiz'}]);
  update({driver: null, police_report_number: null});
  assert.deepEqual(pick(claimOf(f, LOAN_CLAIM), 'police_report_number', 'driver'), [null, null]);
  update({driver: {kind: 'listed', person_id: 'person-sam'}});
  const receipt = {kind: 'receipt', dated: dec(1, '12:00:00'), description: 'Tow receipt, 180.00.', reference: 'files:obj-tow-receipt'};
  const added = f.call('claims.add_evidence', {id: LOAN_CLAIM, items: [photo('Front, left side'), receipt]}), claim = claimOf(f, LOAN_CLAIM);
  assert.deepEqual(added, {id: LOAN_CLAIM, evidence_ids: ['evd-0005', 'evd-0006']});
  assert.deepEqual(claim.evidence.map(item => pick(item, 'id', 'kind', 'reference', 'added_at')),
    [['evd-0005', 'photo', null, NOW], ['evd-0006', 'receipt', 'files:obj-tow-receipt', NOW]]);
  assert.deepEqual([claim.driver, claim.state], [{kind: 'listed', person_id: 'person-sam'}, 'open']);
  // An evidence item has one of five kinds: the four of the plan, and `other`.
  const kinds = ['report', 'statement', 'other'], more = kinds.map(kind => ({kind, dated: dec(1), description: 'A record of the kind ' + kind + '.'}));
  f.call('claims.add_evidence', {id: LOAN_CLAIM, items: more});
  assert.deepEqual(claimOf(f, LOAN_CLAIM).evidence.map(item => item.kind), ['photo', 'receipt', ...kinds]);
  unchanged(f, () => f.call('claims.add_evidence', {id: LOAN_CLAIM, items: [{...more[0], kind: 'video'}]}), SCHEMA);
  // The policy, the coverage, the vehicle and the loss time cannot change.
  const fixed = [{policy_id: RENTERS}, {coverage: 'comprehensive'}, {subject_id: CAR}, {loss_at: dec(1)}];
  for (const change of fixed) unchanged(f, () => update({description: 'Other.', ...change}), SCHEMA);
  unchanged(f, () => update({}), 'invalid_arguments');
  unchanged(f, () => update({driver: {kind: 'listed', person_id: 'person-noor'}}), 'not_found');
  unchanged(f, () => f.call('claims.update', {id: 'clm-9999', description: 'Other.'}), 'not_found');
  unchanged(f, () => f.call('claims.add_evidence', {id: 'clm-9999', items: [photo('Front')]}), 'not_found');
  unchanged(f, () => f.call('claims.add_evidence', {id: LOAN_CLAIM, items: []}), SCHEMA);
});

test('T06b [W2] argument checks: a third decimal, a call with no field and the same ask twice are refused with invalid_arguments before any App error', () => {
  const f = start(), [one, same] = [{key: 'photos', text: 'One photo.'}, {key: 'photos', text: 'The same photo.'}];
  // Each call has one fault of its own: a third decimal, or no field to change.
  const faulty = id => [['estimates.submit', {id, kind: 'initial', shop_name: SHOP, lines: [{text: 'Clip', amount: 10.005}]}],
    ['rental.start', {id, start_at: dec(1), daily_rate: 45.005}], ['claims.update', {id}]];
  // req-0012 is void on the withdrawn HOME_CLAIM. req-0013 is answered on the open CAR_CLAIM.
  f.event(request(dec(2, '14:00:00'), 'req-0012', HOME_CLAIM, ['photos']));
  f.event(request(dec(2, '15:00:00'), 'req-0013', CAR_CLAIM, ['photos']));
  f.call('requests.respond', {id: 'req-0013', answers: [one]});
  f.call('claims.withdraw', {id: HOME_CLAIM});
  // `not_found` also fits the calls on the unknown claim, and `invalid_state` fits the calls on the withdrawn claim.
  for (const id of ['clm-9999', HOME_CLAIM]) for (const [name, args] of faulty(id)) unchanged(f, () => f.call(name, args), 'invalid_arguments', name + ' on ' + id);
  unchanged(f, () => f.call('coverage.check', {...LOSS, id: 'pol-none', estimated_amount: 420.005}), 'invalid_arguments', 'coverage.check on an unknown policy');
  // One call that answers the same ask twice: on an unknown request, on a claim that is not open and on a request that is not open.
  for (const id of ['req-9999', 'req-0012', 'req-0013']) unchanged(f, () => f.call('requests.respond', {id, answers: [one, same]}), 'invalid_arguments', 'requests.respond on ' + id);
  // The same calls with one answer return the App error.
  for (const [id, code] of [['req-9999', 'not_found'], ['req-0012', 'invalid_state'], ['req-0013', 'invalid_state']]) {
    unchanged(f, () => f.call('requests.respond', {id, answers: [same]}), code, 'requests.respond on ' + id);
  }
});

test('T07 [W2] requests: the request stays open after the ask photos and is answered after the ask driver', () => {
  const f = start(), id = f.call('claims.file', FILING).id, asked = () => claimOf(f, id).requests[0];
  const respond = answer => f.call('requests.respond', {id: 'req-0012', answers: [answer]});
  f.event(request(dec(2, '14:00:00'), 'req-0012', id, ['photos', 'driver'], dec(12, '17:00:00')));
  assert.deepEqual(pick(asked(), 'id', 'state', 'due_at', 'overdue'), ['req-0012', 'open', dec(12, '17:00:00'), false]);
  const first = f.call('claims.add_evidence', {id, items: [photo('Rear bumper')]}).evidence_ids;
  const second = f.call('claims.add_evidence', {id, items: [photo('Left side')]}).evidence_ids;
  assert.equal(respond({key: 'photos', text: 'Two photos are attached.', evidence_ids: [...first, ...second]}).id, 'req-0012');
  assert.equal(asked().state, 'open');
  // An answer is given once and is not edited.
  unchanged(f, () => respond({key: 'photos', text: 'Other photos.'}), 'invalid_state');
  f.call('claims.update', {id, driver: {kind: 'listed', person_id: 'person-sam'}});
  respond({key: 'driver', text: 'Sam Ellis was driving. He is listed on the policy.'});
  assert.equal(asked().state, 'answered');
  assert.deepEqual(asked().asks.map(ask => [ask.key, ask.answer.evidence_ids, ask.answer.answered_at]),
    [['photos', [...first, ...second], dec(2, '14:00:00')], ['driver', [], dec(2, '14:00:00')]]);
  assert.deepEqual(claimOf(f, id).driver, {kind: 'listed', person_id: 'person-sam'});
  // An answered request takes no more answers.
  unchanged(f, () => respond({key: 'driver', text: 'It was Jordan.'}), 'invalid_state', 'an answered request', 'The information request is not open');
});

test('T07b [W2] requests: an unanswered request reads request_overdue at its due time, with no App event, and can still be answered', () => {
  const f = start(), respond = (answers, id = 'req-0012') => f.call('requests.respond', {id, answers});
  const overdue = () => { const claim = claimOf(f, CAR_CLAIM); return [claim.flags, claim.requests[0].overdue, claim.requests[0].state]; };
  f.event(request(dec(2, '14:00:00'), 'req-0012', CAR_CLAIM, ['photos', 'driver'], dec(12, '17:00:00')));
  const kept = f.data;
  f.advance(dec(12, '16:59:59.999'));
  assert.deepEqual(overdue(), [[], false, 'open']);
  f.advance(dec(12, '17:00:00'));
  assert.deepEqual(overdue(), [['request_overdue'], true, 'open']);
  assert.deepEqual(f.call('claims.list', {id: AUTO}).items.map(row => row.flags), [['request_overdue'], []]);
  assert.deepEqual(f.data, kept);

  // The request, the key of an ask and an evidence item of the claim must exist.
  unchanged(f, () => respond([{key: 'plate', text: 'ABC-1234'}]), 'not_found');
  unchanged(f, () => respond([{key: 'photos', text: 'See the photo.'}], 'req-9999'), 'not_found');
  unchanged(f, () => respond([{key: 'photos', text: 'See the photo.', evidence_ids: ['evd-0003']}]), 'not_found');
  // An answer that names no ask breaks the input schema.
  unchanged(f, () => respond([]), SCHEMA);
  unchanged(f, () => respond([{text: 'Jordan was driving.'}]), SCHEMA);
  respond([{key: 'photos', text: 'The photos are late. Here they are.'}]);
  assert.deepEqual(overdue(), [['request_overdue'], true, 'open']);
  // Both errors fit this call: the ask photos has its answer, and the ask plate is unknown. `not_found` is the earlier one.
  unchanged(f, () => respond([{key: 'photos', text: 'More.'}, {key: 'plate', text: 'ABC-1234'}]), 'not_found');
  // One call answers each ask once. Two answers to the open ask driver in one call are `invalid_arguments`.
  unchanged(f, () => respond([{key: 'driver', text: 'Jordan was driving.'}, {key: 'driver', text: 'Sam was driving.'}]), 'invalid_arguments');
  respond([{key: 'driver', text: 'Jordan was driving.'}]);
  assert.deepEqual(overdue(), [[], false, 'answered']);
  unchanged(f, () => respond([{key: 'driver', text: 'It was Sam.'}]), 'invalid_state');

  // An event that names no due time: `request_response_days` is 10, so the request is due at the end of 12 December.
  const g = start();
  g.event(request(dec(2, '14:00:00'), 'req-0013', CAR_CLAIM, ['statement']));
  assert.deepEqual([SEED.insurer.rules.request_response_days, claimOf(g, CAR_CLAIM).requests[0].due_at], [10, dec(13, '00:00:00')]);
});

test('T08 [W2] withdrawal: it ends the open request, dispute, offer and rental period of the claim, and no write follows it', () => {
  const f = start({now: dec(3)}), at = dec(6, '08:30:00');
  // HOME_CLAIM has the open dispute dsp-0003. LOAN_CLAIM gets a line, a rental period, a request and an open offer.
  f.event(request(dec(3, '10:00:00'), 'req-0012', HOME_CLAIM, ['receipt']));
  f.event(estimate(dec(3, '11:00:00'), 'est-0031', LOAN_CLAIM, {'ln-01': 4000}));
  f.event(determination(dec(3, '12:00:00'), 'det-0044', LOAN_CLAIM, {'ln-01': 'The vehicle will not be repaired.'}));
  f.call('rental.start', {id: LOAN_CLAIM, start_at: dec(3), daily_rate: 45});
  f.event(request(dec(4), 'req-0013', LOAN_CLAIM, ['title']));
  f.event(offer(dec(5), 'off-0005', LOAN_CLAIM, 14200, PAYOFF));
  f.advance(at);
  assert.equal(f.call('claims.withdraw', {id: HOME_CLAIM}).id, HOME_CLAIM);
  f.call('claims.withdraw', {id: LOAN_CLAIM});
  const home = claimOf(f, HOME_CLAIM), loan = claimOf(f, LOAN_CLAIM);
  assert.deepEqual([home.state, home.withdrawn_at, home.requests[0].state, home.disputes[0].state], ['withdrawn', at, 'void', 'void']);
  assert.deepEqual([loan.state, loan.withdrawn_at, loan.requests[0].state, loan.offers[0].state], ['withdrawn', at, 'void', 'superseded']);
  assert.deepEqual(loan.rentals.map(rental => pick(rental, 'state', 'end_at', 'ended_by')), [['ended', at, 'claim_withdrawn']]);
  // The rental benefit stops on the day of the withdrawal. The offer of 5 December alone would stop it five days later, on 10 December.
  assert.equal(loan.rental_stops_on, '2026-12-06');
  // A write on a claim that is not open.
  const refused = [
    ['claims.update', {id: LOAN_CLAIM, description: 'New text.'}], ['claims.add_evidence', {id: LOAN_CLAIM, items: [photo('Front')]}],
    ['claims.withdraw', {id: LOAN_CLAIM}], ['requests.respond', {id: 'req-0013', answers: [{key: 'title', text: 'Sent by post.'}]}],
    ['estimates.submit', {id: LOAN_CLAIM, kind: 'initial', shop_name: SHOP, lines: [{text: 'Hood', amount: 800}]}],
    ['determinations.dispute', {id: 'ln-01', claim_id: LOAN_CLAIM, reason: 'The shop can repair it.'}], ['payee.set', {id: LOAN_CLAIM, payee: TO_SHOP}],
    ['offers.accept', {id: 'off-0005'}], ['offers.reject', {id: 'off-0005', reason: 'Too low.'}],
    ['rental.start', {id: LOAN_CLAIM, start_at: dec(5), daily_rate: 45}], ['rental.end', {id: 'rnt-0001', end_at: dec(5)}]
  ];
  for (const [name, args] of refused) unchanged(f, () => f.call(name, args), 'invalid_state', name);
  // LOAN_CLAIM is also on the total_loss path, which refuses an estimate and a dispute by itself. HOME_CLAIM is withdrawn on the repair path.
  assert.deepEqual(pick(home, 'path', 'state'), ['repair', 'withdrawn']);
  const notOpen = [['estimates.submit', {id: HOME_CLAIM, kind: 'supplement', shop_name: SHOP, lines: [{text: 'Bicycle lock', amount: 60}]}],
    ['determinations.dispute', {id: 'ln-02', claim_id: HOME_CLAIM, reason: 'The receipt shows the bicycle.'}]];
  for (const [name, args] of notOpen) unchanged(f, () => f.call(name, args), 'invalid_state', name + ' on the repair path');
  unchanged(f, () => f.event(request(dec(7), 'req-0014', LOAN_CLAIM, ['title'])), 'invalid_event');
  // The agent withdraws the claim and files again: the same loss is not a duplicate of a withdrawn claim.
  const again = f.call('claims.file', {...FILING, subject_id: LOAN_CAR, loss_at: '2026-11-29T07:50:00-05:00'}).id;
  assert.deepEqual(pick(claimOf(f, again), 'id', 'state'), ['clm-0010', 'open']);
});

test('T08b [W2] withdrawal: a claim with a payment or an accepted offer cannot be withdrawn', () => {
  const paid = start(), sold = start();
  repair(paid, 'payment');
  unchanged(paid, () => paid.call('claims.withdraw', {id: CAR_CLAIM}), 'invalid_state');
  totalLoss(sold, 'acceptance');
  unchanged(sold, () => sold.call('claims.withdraw', {id: LOAN_CLAIM}), 'invalid_state');
  unchanged(sold, () => sold.call('claims.withdraw', {id: 'clm-9999'}), 'not_found');
  assert.deepEqual([claimOf(paid, CAR_CLAIM).state, claimOf(sold, LOAN_CLAIM).state], ['open', 'open']);
});

test('T08c [W2] preferences: the time zone of notification text, and email_notices', () => {
  const f = start(), preferences = () => f.call('preferences.get').preferences;
  assert.deepEqual(preferences(), {timezone: 'America/New_York', email_notices: true});
  f.event(request(dec(2, '14:00:00'), 'req-0012', CAR_CLAIM, ['photos'], dec(12, '17:00:00')));
  assert.equal(f.call('preferences.update', {timezone: 'America/Los_Angeles', email_notices: false}).id, SEED.account_id);
  f.event(request(dec(2, '15:00:00'), 'req-0013', CAR_CLAIM, ['driver'], dec(12, '17:00:00')));
  const [first, second] = f.data.notifications;
  assert.match(first.text, /12 December 2026, 17:00/);
  assert.match(second.text, /12 December 2026, 14:00/);
  assert.deepEqual([first.email !== null, second.email], [true, null]);
  assert.deepEqual(f.call('notifications.list').items.map(item => item.emailed), [true, false]);
  // The preference changes the text only. `now` keeps the offset of the insurer.
  assert.equal(f.call('preferences.get').now, dec(2, '15:00:00'));
  f.call('preferences.update', {email_notices: true});
  assert.deepEqual(preferences(), {timezone: 'America/Los_Angeles', email_notices: true});
  unchanged(f, () => f.call('preferences.update', {timezone: 'Mars/Olympus_Mons'}), 'invalid_timezone');
  unchanged(f, () => f.call('preferences.update', {}), 'invalid_arguments');
});

test('T08d [W2] preferences: a time zone is an IANA name, so a bare offset such as +05:00 is refused on every Node version', () => {
  const f = start(), zone = timezone => f.call('preferences.update', {timezone}), due = dec(12, '17:00:00');
  for (const timezone of ['+05:00', '-05:00', '+0530']) unchanged(f, () => zone(timezone), 'invalid_timezone', timezone);
  // UTC and Etc/GMT+5 are IANA names. Etc/GMT+5 is five hours behind UTC, like New York in December.
  const texts = ['UTC', 'Etc/GMT+5'].map((timezone, index) => {
    zone(timezone);
    assert.equal(f.call('preferences.get').preferences.timezone, timezone);
    f.event(request(dec(3 + index), 'req-001' + index, CAR_CLAIM, ['photos'], due));
    return /Please answer by (.*)\.$/.exec(f.data.notifications[index].text)[1];
  });
  assert.deepEqual(texts, ['12 December 2026, 22:00', '12 December 2026, 17:00']);
  // The two time zones of a seed follow the same rule.
  for (const part of ['insurer', 'preferences']) {
    assert.throws(() => plugin.validateSeed(f.ctx, edit(SEED, seed => { seed[part].timezone = '+05:00'; })), {code: 'invalid_seed'}, part);
    plugin.validateSeed(f.ctx, edit(SEED, seed => { seed[part].timezone = 'Etc/GMT+5'; }));
  }
});

test('T09 [W3] estimates: three lines of 2,000, a supplement of 1,500 and two payments of 1,500 end with still_due 0 and my_share 500', () => {
  const f = start(), after = repair(f), states = claim => claim.estimates.flatMap(e => e.lines.map(line => line.id + ' ' + line.standing.status));
  assert.deepEqual(states(after.estimate), ['ln-01 pending', 'ln-02 pending', 'ln-03 pending']);
  assert.deepEqual([after.estimate.summary.not_approved_total, after.estimate.summary.insurer_owes, after.estimate.flags], [2000, 0, ['lines_pending']]);
  assert.deepEqual([after.approval.summary.insurer_owes, after.approval.deductible], [1500, 500]);
  assert.deepEqual(after.payee.payee, TO_SHOP);
  assert.deepEqual([after.payment.payments[0].payee, after.payment.payments[0].amount, after.payment.summary.still_due], [TO_SHOP, 1500, 0]);
  assert.deepEqual(states(after.supplement).slice(3), ['ln-04 pending', 'ln-05 pending']);
  assert.deepEqual([after.supplement.flags, ...pick(after.supplement.summary, 'not_approved_total', 'insurer_owes')], [['lines_pending'], 1500, 1500]);
  assert.deepEqual(pick(after.secondApproval.summary, 'approved_total', 'insurer_owes', 'still_due'), [3500, 3000, 1500]);
  assert.deepEqual(after.secondPayment.summary, repairSummary({approved_total: 3500, insurer_owes: 3000, paid: 3000, still_due: 0, my_share: 500}));
  assert.deepEqual(after.secondPayment.estimates.map(e => [e.id, e.kind, e.source, e.shop_name, e.lines.length]),
    [['est-0031', 'initial', 'shop', SHOP, 3], ['est-0032', 'supplement', 'shop', SHOP, 2]]);

  // The agent submits an estimate that a shop gave the policyholder. No decision and no payment changes.
  const id = f.call('estimates.submit', {id: CAR_CLAIM, kind: 'supplement', shop_name: 'Lakeside Glass', lines: [{text: 'Rear glass', amount: 310.5}]}).id;
  const submitted = f.call('estimates.get', {id}).estimate;
  assert.deepEqual(pick(submitted, 'id', 'claim_id', 'kind', 'source', 'shop_name', 'submitted_at'),
    ['est-p0001', CAR_CLAIM, 'supplement', 'policyholder', 'Lakeside Glass', dec(11, '12:00:00')]);
  assert.deepEqual(submitted.lines.map(line => [line.id, line.amount, line.standing.status, line.standing.approved_amount]), [['ln-p01', 310.5, 'pending', null]]);
  assert.deepEqual([claimOf(f, CAR_CLAIM).flags, ...pick(money(f, CAR_CLAIM), 'approved_total', 'paid', 'not_approved_total')], [['lines_pending'], 3500, 3000, 310.5]);
  // The input schema refuses an estimate with no lines and a line amount of zero or less.
  const submit = lines => () => f.call('estimates.submit', {id: CAR_CLAIM, kind: 'supplement', shop_name: SHOP, lines});
  for (const lines of [[], [{text: 'Clip', amount: 0}], [{text: 'Clip', amount: -5}]]) unchanged(f, submit(lines), SCHEMA);
  unchanged(f, () => f.call('estimates.submit', {id: 'clm-9999', kind: 'initial', shop_name: SHOP, lines: [{text: 'Clip', amount: 5}]}), 'not_found');
});

test('T09b [W3] estimates: the Agent submits an estimate first, then the task\'s scripted estimate arrives, and both are kept under their own IDs', () => {
  const f = start(), planEvent = id => JSON.parse(PLAN_EVENTS.find(line => line.includes('"event_id":"' + id + '"')));
  const submit = (id, ...amounts) => f.call('estimates.submit', {id, kind: 'supplement', shop_name: 'Lakeside Glass', lines: amounts.map(amount => ({text: 'Glass', amount}))}).id;
  const estimates = id => claimOf(f, id).estimates.map(e => [e.id, e.source, e.lines.map(line => line.id)]);
  // An estimate of the policyholder gets `est-p` and `ln-p` with the next free number. So it takes no ID that a later event of the task gives.
  assert.equal(submit(CAR_CLAIM, 310.5, 95), 'est-p0001');
  // The example event of the plan gives the estimate est-0031 with the lines ln-01 to ln-03, on the same claim.
  f.event(planEvent('ev-ab-110'));
  assert.deepEqual(estimates(CAR_CLAIM), [['est-p0001', 'policyholder', ['ln-p01', 'ln-p02']], ['est-0031', 'shop', ['ln-01', 'ln-02', 'ln-03']]]);
  // The next estimates of the policyholder get the next numbers. The line numbers start again in another claim.
  assert.deepEqual([submit(CAR_CLAIM, 40), submit(LOAN_CLAIM, 800)], ['est-p0002', 'est-p0003']);
  assert.deepEqual([estimates(CAR_CLAIM)[2], estimates(LOAN_CLAIM)], [['est-p0002', 'policyholder', ['ln-p03']], [['est-p0003', 'policyholder', ['ln-p01']]]]);
  // The next example event of the plan decides the three scripted lines. The lines of the policyholder stay pending.
  f.event(planEvent('ev-ab-111'));
  assert.deepEqual(pick(money(f, CAR_CLAIM), 'approved_total', 'insurer_owes', 'not_approved_total'), [2000, 1500, 445.5]);
});

test('T10 [W3] determinations: each named line takes the decision, and the standing decision of a line is its latest one', () => {
  const f = start(), standing = id => lineOf(f, CAR_CLAIM, id).standing, first = dec(4, '15:30:00'), second = dec(6);
  f.event(estimate(dec(4, '10:00:00'), 'est-0031', CAR_CLAIM, THREE_LINES));
  f.event(determination(first, 'det-0044', CAR_CLAIM, {'ln-01': 900, 'ln-02': 'Wear from before the loss.'}));
  assert.deepEqual(standing('ln-01'), {status: 'approved', approved_amount: 900, reason: null, decided_at: first, dispute_by: '2027-01-03', disputable: false});
  assert.deepEqual(standing('ln-02'),
    {status: 'denied', approved_amount: null, reason: 'Wear from before the loss.', decided_at: first, dispute_by: '2027-01-03', disputable: true});
  assert.deepEqual(standing('ln-03'), {status: 'pending', approved_amount: null, reason: null, decided_at: null, dispute_by: null, disputable: false});
  assert.deepEqual(pick(money(f, CAR_CLAIM), 'approved_total', 'insurer_owes', 'my_share', 'not_approved_total'), [900, 400, 500, 1100]);
  assert.deepEqual(claimOf(f, CAR_CLAIM).flags, ['lines_pending', 'lines_denied']);
  // A newer determination names two lines. The line that it does not name is unchanged.
  f.event(determination(second, 'det-0045', CAR_CLAIM, {'ln-02': 300, 'ln-03': 750}));
  assert.deepEqual(standing('ln-02'), {status: 'approved', approved_amount: 300, reason: null, decided_at: second, dispute_by: '2027-01-05', disputable: true});
  assert.deepEqual(pick(standing('ln-01'), 'approved_amount', 'decided_at'), [900, first]);
  assert.deepEqual(lineOf(f, CAR_CLAIM, 'ln-02').decisions.map(d => pick(d, 'status', 'amount', 'decided_at', 'source', 'source_id')),
    [['denied', null, first, 'determination', 'det-0044'], ['approved', 300, second, 'determination', 'det-0045']]);
  const claim = claimOf(f, CAR_CLAIM);
  assert.deepEqual(pick(claim.summary, 'approved_total', 'insurer_owes', 'my_share', 'not_approved_total'), [1950, 1450, 500, 50]);
  assert.deepEqual(claim.flags, []);
  assert.deepEqual(claim.determinations.map(d => pick(d, 'id', 'issued_at', 'issued_by', 'line_ids')),
    [['det-0044', first, ADJUSTER, ['ln-01', 'ln-02']], ['det-0045', second, ADJUSTER, ['ln-02', 'ln-03']]]);
  assert.deepEqual(claim.history.slice(1).map(row => pick(row, 'at', 'action', 'actor', 'ref')), [[dec(4, '10:00:00'), 'estimate.submitted', 'event', 'ev-est-0031'],
    [first, 'determination.issued', 'event', 'ev-det-0044'], [second, 'determination.issued', 'event', 'ev-det-0045']]);
});

test('T11 [W3] disputes: a line that is denied, or approved for less, is disputed once for each decision', () => {
  const f = start(), dispute = disputing(f), states = () => claimOf(f, CAR_CLAIM).disputes.map(d => d.id + ' ' + d.state);
  f.event(estimate(dec(4, '10:00:00'), 'est-0031', CAR_CLAIM, THREE_LINES));
  f.event(determination(dec(4, '15:30:00'), 'det-0044', CAR_CLAIM, {'ln-01': 900, 'ln-02': 'Wear from before the loss.', 'ln-03': 600}));
  f.event(estimate(dec(5), 'est-0032', CAR_CLAIM, {'ln-04': 80}, {kind: 'supplement'}));
  // Control: a line approved in full, and a line that is still pending.
  unchanged(f, dispute('ln-01'), 'nothing_to_dispute');
  unchanged(f, dispute('ln-04'), 'nothing_to_dispute');
  const evidence_ids = f.call('claims.add_evidence', {id: CAR_CLAIM, items: [photo('Tail lamp, cracked')]}).evidence_ids;
  assert.equal(dispute('ln-02', CAR_CLAIM, {evidence_ids})().id, 'dsp-0004');
  assert.deepEqual(claimOf(f, CAR_CLAIM).disputes, [{id: 'dsp-0004', line_id: 'ln-02', decision_index: 0, reason: REASON, evidence_ids, opened_at: dec(5),
    state: 'open', decided_at: null, decided_by: null, note: null}]);
  // Control: a line with an open dispute. The second call names the line of dsp-0003, the open dispute of the seed.
  unchanged(f, dispute('ln-02'), 'already_disputed');
  unchanged(f, dispute('ln-02', HOME_CLAIM), 'already_disputed');
  assert.equal(dispute('ln-03')().id, 'dsp-0005');
  // `upheld` leaves the line unchanged. `changed` gives the line the new decision and its time.
  f.event(decided(dec(8), 'dsp-0004', 'upheld'));
  f.event(decided(dec(9), 'dsp-0005', 'changed', {status: 'approved', amount: 700}));
  assert.deepEqual(states(), ['dsp-0004 upheld', 'dsp-0005 changed']);
  assert.deepEqual(pick(claimOf(f, CAR_CLAIM).disputes[0], 'decided_at', 'decided_by'), [dec(8), 'Claims supervisor']);
  assert.deepEqual([lineOf(f, CAR_CLAIM, 'ln-02').decisions.length, lineOf(f, CAR_CLAIM, 'ln-02').standing.status], [1, 'denied']);
  assert.deepEqual(lineOf(f, CAR_CLAIM, 'ln-03').decisions.map(d => pick(d, 'status', 'amount', 'decided_at', 'source', 'source_id')),
    [['approved', 600, dec(4, '15:30:00'), 'determination', 'det-0044'], ['approved', 700, dec(9), 'dispute', 'dsp-0005']]);
  assert.equal(money(f, CAR_CLAIM).approved_total, 1600);
  // A decided dispute, and a decision that a dispute produced, cannot be disputed again.
  unchanged(f, dispute('ln-02'), 'already_disputed');
  unchanged(f, dispute('ln-03'), 'already_disputed');
  // A decision from a newer determination can be disputed in its turn. The next determination on the line voids that open dispute.
  f.event(determination(dec(10), 'det-0045', CAR_CLAIM, {'ln-02': 'Still wear from before the loss.'}));
  assert.equal(dispute('ln-02')().id, 'dsp-0006');
  assert.equal(claimOf(f, CAR_CLAIM).disputes[2].decision_index, 1);
  f.event(determination(dec(11), 'det-0046', CAR_CLAIM, {'ln-02': 200}));
  assert.deepEqual(states(), ['dsp-0004 upheld', 'dsp-0005 changed', 'dsp-0006 void']);
  assert.equal(dispute('ln-02')().id, 'dsp-0007');
});

test('T11b [W3] disputes: the window ends with the 30th day after the decision, and the first error of the table wins', () => {
  const f = start(), dispute = disputing(f);
  f.event(estimate(dec(4, '10:00:00'), 'est-0031', CAR_CLAIM, THREE_LINES));
  f.event(determination(dec(4, '15:30:00'), 'det-0044', CAR_CLAIM, {'ln-01': 'Old damage.', 'ln-02': 'Old damage.', 'ln-03': 750}));
  assert.deepEqual([SEED.insurer.rules.dispute_window_days, lineOf(f, CAR_CLAIM, 'ln-01').standing.dispute_by], [30, '2027-01-03']);
  f.advance('2027-01-03T23:59:59.999-05:00');
  assert.equal(lineOf(f, CAR_CLAIM, 'ln-02').standing.disputable, true);
  assert.equal(dispute('ln-01')().id, 'dsp-0004');
  f.advance('2027-01-04T00:00:00-05:00');
  assert.equal(lineOf(f, CAR_CLAIM, 'ln-02').standing.disputable, false);
  unchanged(f, dispute('ln-02'), 'too_late');
  // Control: a denied line, 31 days after its decision.
  f.advance('2027-01-04T15:30:00-05:00');
  unchanged(f, dispute('ln-02'), 'too_late');
  // `too_late` also fits each of the next three calls. The earlier error in the table is returned.
  unchanged(f, dispute('ln-01'), 'already_disputed');
  unchanged(f, dispute('ln-03'), 'nothing_to_dispute');
  unchanged(f, dispute('ln-02', CAR_CLAIM, {evidence_ids: ['evd-0003']}), 'not_found');
  unchanged(f, dispute('ln-99'), 'not_found');
  unchanged(f, dispute('ln-02', 'clm-9999'), 'not_found');
  // A dispute changed this line to a full approval: `nothing_to_dispute` comes before `already_disputed`.
  f.event(decided('2027-01-05T09:00:00-05:00', 'dsp-0003', 'changed', {status: 'approved', amount: 420}));
  unchanged(f, dispute('ln-02', HOME_CLAIM), 'nothing_to_dispute');
  // On the total_loss path the lines are history: `invalid_state` comes before the three dispute errors.
  f.event(offer('2027-01-06T09:00:00-05:00', 'off-0005', CAR_CLAIM, 9000));
  assert.equal(claimOf(f, CAR_CLAIM).disputes[0].state, 'void');
  for (const line of ['ln-01', 'ln-02', 'ln-03']) unchanged(f, dispute(line), 'invalid_state', line);
});

test('T11c [W3] disputes: a line reads disputable only while determinations.dispute can still be made on its decision', () => {
  const f = start(), dispute = disputing(f), OLD = 'Old damage.';
  const disputable = claim => claimOf(f, claim).estimates.flatMap(e => e.lines).map(line => line.standing.disputable);
  // CAR_CLAIM has two denied lines and a line approved for 600 of 750. LOAN_CLAIM has one denied line.
  f.event(estimate(dec(4, '10:00:00'), 'est-0031', CAR_CLAIM, THREE_LINES));
  f.event(determination(dec(4, '15:30:00'), 'det-0044', CAR_CLAIM, {'ln-01': OLD, 'ln-02': OLD, 'ln-03': 600}));
  f.event(estimate(dec(5), 'est-0032', LOAN_CLAIM, {'ln-01': 4000}));
  f.event(determination(dec(5, '12:00:00'), 'det-0045', LOAN_CLAIM, {'ln-01': OLD}));
  assert.deepEqual([disputable(CAR_CLAIM), disputable(LOAN_CLAIM)], [[true, true, true], [true]]);
  // A decision is disputed once: not while its dispute is open, not after it is upheld, and not when a dispute produced it.
  dispute('ln-01')();
  dispute('ln-03')();
  assert.deepEqual(disputable(CAR_CLAIM), [false, true, false]);
  f.event(decided(dec(6), 'dsp-0004', 'upheld'));
  f.event(decided(dec(7), 'dsp-0005', 'changed', {status: 'approved', amount: 700}));
  assert.deepEqual(disputable(CAR_CLAIM), [false, true, false]);
  // A claim that is not open.
  f.call('claims.withdraw', {id: LOAN_CLAIM});
  assert.deepEqual(disputable(LOAN_CLAIM), [false]);
  unchanged(f, dispute('ln-01', LOAN_CLAIM), 'invalid_state');
  // On the total_loss path the lines are history.
  f.event(offer(dec(8), 'off-0005', CAR_CLAIM, 9000));
  assert.deepEqual(disputable(CAR_CLAIM), [false, false, false]);
  unchanged(f, dispute('ln-02'), 'invalid_state');
});

test('T12 [W3] the payee: a repair payment that names no payee goes to the direction on file at that moment', () => {
  const f = start(), set = payee => f.call('payee.set', {id: CAR_CLAIM, payee}), me = {kind: 'policyholder', name: null};
  repair(f, 'approval');
  f.event(payment(dec(5), 'pay-0021', CAR_CLAIM, 'repair', 300));
  assert.equal(set(TO_SHOP).id, CAR_CLAIM);
  f.event(payment(dec(6), 'pay-0022', CAR_CLAIM, 'repair', 400));
  set(TO_ME);
  f.event(payment(dec(7), 'pay-0023', CAR_CLAIM, 'repair', 500));
  set(TO_SHOP);
  f.event(payment(dec(8), 'pay-0024', CAR_CLAIM, 'rental', 120));
  const claim = claimOf(f, CAR_CLAIM);
  // No direction on file pays the policyholder. A new direction applies to later payments only. A rental payment goes to the policyholder.
  assert.deepEqual(claim.payments.map(p => pick(p, 'id', 'payee', 'direction_on_file', 'payee_named')), [['pay-0021', me, null, false],
    ['pay-0022', TO_SHOP, TO_SHOP, false], ['pay-0023', me, TO_ME, false], ['pay-0024', me, null, false]]);
  assert.deepEqual([claim.payee, claim.flags, claim.summary.paid], [TO_SHOP, [], 1200]);
  f.event(payment(dec(9), 'pay-0025', CAR_CLAIM, 'repair', 50, {kind: 'shop', name: 'Lakeside Glass'}));
  assert.deepEqual(claimOf(f, CAR_CLAIM).flags, ['payee_mismatch']);
  // A settlement payment names its payee. `payee.set` has no effect on it.
  const g = start();
  g.call('payee.set', {id: LOAN_CLAIM, payee: TO_SHOP});
  g.event(offer(dec(5), 'off-0005', LOAN_CLAIM, 15900, PAYOFF));
  g.event(payment(dec(6), 'pay-0021', LOAN_CLAIM, 'settlement', 15100, {kind: 'lienholder'}));
  g.event(payment(dec(7), 'pay-0022', LOAN_CLAIM, 'settlement', 300, TO_ME));
  assert.deepEqual(claimOf(g, LOAN_CLAIM).payments.map(p => pick(p, 'payee', 'direction_on_file')), [[{kind: 'lienholder', name: null}, null], [me, null]]);
  assert.ok(!claimOf(g, LOAN_CLAIM).flags.includes('payee_mismatch'));
  // The input schema refuses a shop payee with no name.
  unchanged(f, () => set({kind: 'shop'}), SCHEMA);
  unchanged(f, () => f.call('payee.set', {id: 'clm-9999', payee: TO_ME}), 'not_found');
});

test('T13 [W3] payments: a third payment of 200 that names the policyholder is applied and reads payee_mismatch and overpaid 200', () => {
  const f = start(), ids = args => f.call('payments.list', args).items.map(p => p.id);
  repair(f);
  f.event(payment(dec(12), 'pay-0023', CAR_CLAIM, 'repair', 200, TO_ME));
  const claim = claimOf(f, CAR_CLAIM), third = {id: 'pay-0023', kind: 'repair', amount: 200, payee: {kind: 'policyholder', name: null}, direction_on_file: TO_SHOP,
    payee_named: true, reference: null, issued_at: dec(12), state: 'issued'};
  assert.deepEqual(claim.summary, repairSummary({approved_total: 3500, insurer_owes: 3000, paid: 3200, still_due: 0, overpaid: 200, my_share: 500}));
  assert.deepEqual([claim.flags, claim.payments[2]], [['overpaid', 'payee_mismatch'], third]);
  // The list uses the issue time. A rental payment is a record of its own kind and is not paid for repairs.
  f.event(payment(dec(13), 'pay-0024', CAR_CLAIM, 'rental', 80));
  assert.deepEqual(ids(), ['pay-0021', 'pay-0022', 'pay-0023', 'pay-0024']);
  assert.deepEqual(ids({start: dec(11), end: dec(12)}), ['pay-0022', 'pay-0023']);
  assert.deepEqual([ids({kind: 'rental'}), ids({kind: 'settlement'}), ids({id: LOAN_CLAIM})], [['pay-0024'], [], []]);
  assert.deepEqual(ids({id: CAR_CLAIM, kind: 'repair', start: dec(12)}), ['pay-0023']);
  assert.deepEqual(f.call('payments.list', {start: dec(12), end: dec(12)}).items, [{...third, claim_id: CAR_CLAIM}]);
  assert.equal(money(f, CAR_CLAIM).paid, 3200);
});

test('T14 [W4] offers: an offer of 14,200 against a payoff of 15,100 reads net 13,700 and shortfall 1,400, and the next offer of 15,900 is accepted', () => {
  const f = start(), after = totalLoss(f), settlement = step => after[step].summary.settlement;
  assert.deepEqual(pick(after.offer, 'path', 'state', 'deductible', 'lienholder'), ['total_loss', 'open', 500, {name: 'Harbor Credit Union'}]);
  assert.deepEqual(settlement('offer'), {offer_id: 'off-0005', offer_state: 'open', valuation: 14200, lienholder_payoff: 15100, net: 13700, to_lienholder: 13700,
    to_me: 0, shortfall: 1400, paid_to_lienholder: 0, paid_to_me: 0, still_due_to_lienholder: 0, still_due_to_me: 0});
  assert.deepEqual([after.offer.offers[0].state, after.offer.flags], ['open', ['below_payoff']]);
  assert.deepEqual(pick(after.rejection.offers[0], 'state', 'reason', 'evidence_ids', 'answered_at'),
    ['rejected', 'The offer is below the loan payoff.', ['evd-0005', 'evd-0006'], dec(10, '09:00:00')]);
  assert.deepEqual(pick(settlement('rejection'), 'offer_id', 'offer_state'), ['off-0005', 'rejected']);
  // The insurer answers the rejection with a new offer. The rejected offer keeps its state.
  assert.deepEqual(pick(settlement('secondOffer'), 'offer_id', 'offer_state', 'net', 'to_lienholder', 'to_me', 'shortfall'),
    ['off-0006', 'open', 15400, 15100, 300, 0]);
  assert.deepEqual([after.secondOffer.offers.map(o => o.state), after.secondOffer.flags], [['rejected', 'open'], []]);
  assert.deepEqual(after.acceptance.offers.map(o => o.state), ['rejected', 'accepted']);
  assert.deepEqual(pick(settlement('acceptance'), 'offer_state', 'still_due_to_lienholder', 'still_due_to_me'), ['accepted', 15100, 300]);
  assert.deepEqual(pick(after.acceptance.offers[1], 'answered_at', 'reason'), [dec(12, '09:00:00'), null]);
  // The two settlement payments of the accepted offer.
  f.event(payment(dec(19), 'pay-0021', LOAN_CLAIM, 'settlement', 15100, {kind: 'lienholder'}));
  f.event(payment(dec(20), 'pay-0022', LOAN_CLAIM, 'settlement', 300, TO_ME));
  const paid = money(f, LOAN_CLAIM);
  assert.deepEqual([...pick(paid.settlement, 'paid_to_lienholder', 'paid_to_me', 'still_due_to_lienholder', 'still_due_to_me'), paid.overpaid], [15100, 300, 0, 0, 0]);
});

test('T15 [W4] offers: an offer that is not open keeps its state, and nothing replaces an accepted offer', () => {
  const f = start(), refuse = (name, args, code) => unchanged(f, () => f.call(name, args), code, name);
  totalLoss(f);
  // Control: the rejected offer, and an estimate after the first offer.
  refuse('offers.accept', {id: 'off-0005'}, 'invalid_state');
  refuse('offers.reject', {id: 'off-0005', reason: 'Still too low.'}, 'invalid_state');
  refuse('estimates.submit', {id: LOAN_CLAIM, kind: 'initial', shop_name: SHOP, lines: [{text: 'Hood', amount: 800}]}, 'invalid_state');
  // An acceptance is final for the amount of the claim.
  refuse('offers.accept', {id: 'off-0006'}, 'invalid_state');
  refuse('offers.reject', {id: 'off-0006', reason: 'I changed my mind.'}, 'invalid_state');
  unchanged(f, () => f.event(offer(dec(19), 'off-0007', LOAN_CLAIM, 16500, PAYOFF)), 'invalid_event');
  refuse('offers.accept', {id: 'off-9999'}, 'not_found');
  // Both errors fit this call: the evidence item is unknown and the offer is rejected. `not_found` is the earlier one.
  refuse('offers.reject', {id: 'off-0005', reason: 'Still too low.', evidence_ids: ['evd-9999']}, 'not_found');

  // A new offer supersedes an offer that is still open.
  const g = start();
  g.event(offer(dec(3), 'off-0005', LOAN_CLAIM, 14200, PAYOFF));
  g.event(offer(dec(4), 'off-0006', LOAN_CLAIM, 15000, PAYOFF));
  assert.deepEqual(claimOf(g, LOAN_CLAIM).offers.map(o => o.state), ['superseded', 'open']);
  unchanged(g, () => g.call('offers.accept', {id: 'off-0005'}), 'invalid_state');
  // An expired offer on a withdrawn claim keeps `expired`. Both errors fit the call, and `invalid_state` comes before `too_late`.
  const h = start();
  h.event(offer(dec(3), 'off-0005', LOAN_CLAIM, 14200, {...PAYOFF, respond_by: dec(5)}));
  h.advance(dec(6));
  h.call('claims.withdraw', {id: LOAN_CLAIM});
  assert.equal(claimOf(h, LOAN_CLAIM).offers[0].state, 'expired');
  unchanged(h, () => h.call('offers.accept', {id: 'off-0005'}), 'invalid_state');
});

test('T15b [W4] total_loss summary: the repair fields are null, paid is kept, and only an accepted offer is owed', () => {
  const f = start();
  repair(f, 'payment');
  // The vehicle of this claim has no lienholder, so its offer has no payoff and no shortfall.
  f.event(offer(dec(8), 'off-0005', CAR_CLAIM, 9000));
  const claim = claimOf(f, CAR_CLAIM), open = {offer_id: 'off-0005', offer_state: 'open', valuation: 9000, lienholder_payoff: null, net: 8500, to_lienholder: 0, to_me: 8500,
    shortfall: null, paid_to_lienholder: 0, paid_to_me: 0, still_due_to_lienholder: 0, still_due_to_me: 0};
  assert.deepEqual(claim.summary, {approved_total: null, insurer_owes: null, over_limit: null, paid: 1500, still_due: null, overpaid: 0, my_share: null,
    not_approved_total: null, settlement: open});
  assert.deepEqual(pick(claim, 'path', 'lienholder', 'flags'), ['total_loss', null, []]);
  // The lines stay as history.
  assert.deepEqual(claim.estimates[0].lines.map(line => [line.id, line.standing.status, line.standing.disputable]),
    [['ln-01', 'approved', false], ['ln-02', 'approved', false], ['ln-03', 'approved', false]]);
  // While no offer is accepted, nothing is owed and every settlement payment is overpaid.
  f.event(payment(dec(9), 'pay-0022', CAR_CLAIM, 'settlement', 1000, TO_ME));
  const read = (...keys) => { const now = claimOf(f, CAR_CLAIM); return [now.summary.paid, now.summary.overpaid, ...pick(now.summary.settlement, ...keys), now.flags]; };
  assert.deepEqual(read('offer_state', 'paid_to_me', 'still_due_to_me'), [1500, 1000, 'open', 1000, 0, ['overpaid']]);
  f.call('offers.accept', {id: 'off-0005'});
  assert.deepEqual(read('offer_state', 'paid_to_me', 'still_due_to_me'), [1500, 0, 'accepted', 1000, 7500, []]);
  f.event(payment(dec(10), 'pay-0023', CAR_CLAIM, 'settlement', 7600, TO_ME));
  assert.deepEqual(read('offer_state', 'paid_to_me', 'still_due_to_me'), [1500, 100, 'accepted', 8600, 0, ['overpaid']]);
  // `net` is never below zero, and the whole payoff is then a shortfall.
  const g = start();
  g.event(offer(dec(3), 'off-0005', LOAN_CLAIM, 400, PAYOFF));
  assert.deepEqual(pick(money(g, LOAN_CLAIM).settlement, 'net', 'to_lienholder', 'to_me', 'shortfall'), [0, 0, 0, 15100]);
});

test('T15c [W4] total_loss path: the flags lines_pending and lines_denied are still read after the first offer', () => {
  const f = start(), read = () => { const claim = claimOf(f, LOAN_CLAIM); return [claim.path, claim.estimates[0].lines.map(line => line.standing.status), claim.flags]; };
  const listed = () => f.call('claims.list', {id: AUTO}).items.find(row => row.id === LOAN_CLAIM).flags;
  f.event(estimate(dec(4, '10:00:00'), 'est-0031', LOAN_CLAIM, THREE_LINES));
  f.event(determination(dec(4, '15:30:00'), 'det-0044', LOAN_CLAIM, {'ln-01': 900, 'ln-02': 'Wear from before the loss.'}));
  assert.deepEqual([read(), listed()], [['repair', ['approved', 'denied', 'pending'], ['lines_pending', 'lines_denied']], ['lines_pending', 'lines_denied']]);
  // The lines stay as history on the total_loss path, and the two flags still say what that history holds.
  f.event(offer(dec(10), 'off-0005', LOAN_CLAIM, 15900, PAYOFF));
  assert.deepEqual([read(), listed()], [['total_loss', ['approved', 'denied', 'pending'], ['lines_pending', 'lines_denied']], ['lines_pending', 'lines_denied']]);
  // The package fixture has such a claim: clm-0003 has pending lines and a denied line.
  assert.deepEqual(pick(claimOf(fixture(), 'clm-0003'), 'path', 'flags'), ['total_loss', ['lines_pending', 'lines_denied', 'rental_uncovered']]);
});

test('T16 [W4] rental benefit: a rental from 3 December at 45 a day reads 12 covered days, 3 uncovered days and my_cost 195 on 18 December', () => {
  const f = start(), claim = totalLoss(f).day18, benefit = SEED.policies[0].rental_benefit;
  assert.deepEqual([benefit.daily_cap, benefit.max_days, SEED.insurer.rules.rental_grace_days], [40, 30, 5]);
  assert.deepEqual(claim.rentals, [{id: 'rnt-0001', start_at: dec(3, '10:00:00'), daily_rate: 45, state: 'active', end_at: null, ended_by: null,
    rental_days: 15, covered_days: 12, uncovered_days: 3, my_cost: 195}]);
  // The benefit stops 5 days after the day of the first offer, which arrived on 10 December.
  assert.deepEqual([claim.rental_stops_on, claim.flags], ['2026-12-15', ['rental_uncovered']]);
  // Control: a second rental while one is active.
  unchanged(f, () => f.call('rental.start', {id: LOAN_CLAIM, start_at: dec(17), daily_rate: 30}), 'already_active');
  // A rental period is corrected by ending it and starting another.
  assert.equal(f.call('rental.end', {id: 'rnt-0001', end_at: dec(18, '10:00:00')}).id, 'rnt-0001');
  assert.equal(f.call('rental.start', {id: LOAN_CLAIM, start_at: dec(18, '10:00:00'), daily_rate: 38}).id, 'rnt-0002');
  assert.deepEqual(claimOf(f, LOAN_CLAIM).rentals.map(r => pick(r, 'state', 'end_at', 'ended_by', 'rental_days', 'covered_days', 'uncovered_days', 'my_cost')),
    [['ended', dec(18, '10:00:00'), 'agent', 15, 12, 3, 195], ['active', null, null, 0, 0, 0, 0]]);
  unchanged(f, () => f.call('rental.end', {id: 'rnt-0001', end_at: dec(18, '11:00:00')}), 'invalid_state');
});

test('T16b [W4] rental benefit: an active period, the repair completion day, and the limit of 30 days across two periods', () => {
  const days = (f, claim) => claimOf(f, claim).rentals.map(r => pick(r, 'rental_days', 'covered_days', 'uncovered_days', 'my_cost'));
  // For an active period, the count stops before the current day.
  const f = start({now: dec(3, '10:00:00')});
  f.call('rental.start', {id: CAR_CLAIM, start_at: dec(3, '10:00:00'), daily_rate: 45});
  f.advance(dec(3, '23:59:59.999'));
  assert.deepEqual(days(f, CAR_CLAIM), [[0, 0, 0, 0]]);
  f.advance(dec(4, '00:00:00'));
  assert.deepEqual([days(f, CAR_CLAIM), claimOf(f, CAR_CLAIM).rental_stops_on], [[[1, 1, 0, 5]], null]);
  // The benefit stops at the start of the day the repair is reported complete: 10 covered days, then 3 at the full rate.
  f.event(completed(dec(13, '15:00:00'), CAR_CLAIM, 3500));
  f.advance(dec(16, '08:00:00'));
  assert.deepEqual(days(f, CAR_CLAIM), [[13, 10, 3, 185]]);
  assert.deepEqual(pick(claimOf(f, CAR_CLAIM), 'rental_stops_on', 'flags'), ['2026-12-13', ['rental_uncovered']]);

  // Two periods of 20 and 15 days use the 30 days of the policy in order of start. The rate of 35 is under the cap of 40.
  const g = start(), january = '2027-01-04T10:00:00-05:00';
  g.call('rental.start', {id: LOAN_CLAIM, start_at: '2026-11-30T10:00:00-05:00', daily_rate: 35});
  g.advance(dec(20, '10:00:00'));
  g.call('rental.end', {id: 'rnt-0001', end_at: dec(20, '10:00:00')});
  g.call('rental.start', {id: LOAN_CLAIM, start_at: dec(20, '10:00:00'), daily_rate: 45});
  g.advance('2027-01-04T09:00:00-05:00');
  assert.deepEqual(days(g, LOAN_CLAIM), [[20, 20, 0, 0], [15, 10, 5, 275]]);
  assert.deepEqual(pick(claimOf(g, LOAN_CLAIM), 'rental_stops_on', 'flags'), [null, ['rental_uncovered']]);
  // A closure ends the active period at the time of the event.
  g.event(closed(january, LOAN_CLAIM, 'denied'));
  assert.deepEqual(claimOf(g, LOAN_CLAIM).rentals.map(r => pick(r, 'state', 'end_at', 'ended_by')),
    [['ended', dec(20, '10:00:00'), 'agent'], ['ended', january, 'claim_closed']]);
  assert.deepEqual([days(g, LOAN_CLAIM), claimOf(g, LOAN_CLAIM).rental_stops_on], [[[20, 20, 0, 0], [15, 10, 5, 275]], '2027-01-04']);
  // A seed can store the two periods in the other order. The 30 days are still used in order of start.
  const stored = edit(g.data, seed => { seed.claims.find(claim => claim.id === LOAN_CLAIM).rentals.reverse(); }), h = fixture({seed: stored, now: january});
  assert.deepEqual([h.data.claims.find(claim => claim.id === LOAN_CLAIM).rentals.map(r => r.id), days(h, LOAN_CLAIM)], [['rnt-0002', 'rnt-0001'], [[15, 10, 5, 275], [20, 20, 0, 0]]]);
});

test('T16c [W4] rental benefit: the times of a rental period are checked, and the first error of the table wins', () => {
  const f = start(), begin = (id, start_at, daily_rate = 45) => () => f.call('rental.start', {id, start_at, daily_rate});
  const end = (end_at, id = 'rnt-0001') => () => f.call('rental.end', {id, end_at});
  unchanged(f, begin(LOAN_CLAIM, '2026-11-29T07:00:00-05:00'), 'invalid_window', 'a start before the loss');
  unchanged(f, begin(LOAN_CLAIM, dec(2, '09:00:01')), 'invalid_window', 'a start after the current time');
  unchanged(f, begin(HOME_CLAIM, dec(1)), 'not_covered', 'a policy with no rental benefit');
  unchanged(f, begin(HOME_CLAIM, dec(3)), 'invalid_window', 'invalid_window comes before not_covered');
  unchanged(f, begin('clm-9999', dec(1)), 'not_found');
  for (const rate of [0, -45]) unchanged(f, begin(LOAN_CLAIM, dec(1), rate), SCHEMA);
  assert.equal(begin(LOAN_CLAIM, dec(1))().id, 'rnt-0001');
  unchanged(f, begin(LOAN_CLAIM, dec(2)), 'already_active');
  unchanged(f, begin(LOAN_CLAIM, '2026-11-29T07:00:00-05:00'), 'invalid_window', 'invalid_window comes before already_active');
  unchanged(f, end('2026-11-30T09:00:00-05:00'), 'invalid_window', 'an end before the start');
  unchanged(f, end(dec(2, '09:00:01')), 'invalid_window', 'an end after the current time');
  unchanged(f, end(dec(2), 'rnt-9999'), 'not_found');
  end(dec(2))();
  unchanged(f, end(dec(2)), 'invalid_state');
  unchanged(f, end(dec(3)), 'invalid_state', 'invalid_state comes before invalid_window');
  unchanged(f, begin(LOAN_CLAIM, dec(1, '12:00:00')), 'invalid_window', 'a start before the end of an earlier period');
  assert.equal(begin(LOAN_CLAIM, dec(2))().id, 'rnt-0002');
  f.call('claims.withdraw', {id: HOME_CLAIM});
  unchanged(f, begin(HOME_CLAIM, dec(3)), 'invalid_state', 'invalid_state comes before invalid_window');
});

test('T16d [W4] rental benefit: a claim takes a 31st rental period, because a stored list that a call can grow has no upper bound', () => {
  const f = start({now: dec(3)}), minute = n => dec(3, '09:' + String(n).padStart(2, '0') + ':00');
  // Thirty periods of one minute. Each one is ended before the next one starts.
  for (let n = 1; n <= 30; n++) {
    f.advance(minute(n));
    f.call('rental.end', {id: f.call('rental.start', {id: LOAN_CLAIM, start_at: minute(n - 1), daily_rate: 45}).id, end_at: minute(n)});
  }
  assert.equal(f.call('rental.start', {id: LOAN_CLAIM, start_at: minute(30), daily_rate: 45}).id, 'rnt-0031');
  const {rentals} = claimOf(f, LOAN_CLAIM);
  assert.deepEqual([rentals.length, rentals.filter(r => r.state === 'ended').length, rentals[30].state], [31, 30, 'active']);
});

test('T17 [W4] platform clock: an offer reads expired once the clock reaches its respond_by, with no App event', () => {
  const first = offer(dec(10, '09:00:00'), 'off-0005', LOAN_CLAIM, 14200, {...PAYOFF, respond_by: dec(17, '17:00:00')});
  const read = f => { const claim = claimOf(f, LOAN_CLAIM); return [claim.offers[0].state, claim.summary.settlement.offer_state, claim.flags]; };
  const f = start();
  f.event(first);
  const kept = f.data;
  f.advance(dec(17, '16:59:59.999'));
  assert.deepEqual(read(f), ['open', 'open', ['below_payoff']]);
  f.advance(dec(17, '17:00:00'));
  assert.deepEqual(read(f), ['expired', 'expired', ['offer_expired', 'below_payoff']]);
  // Nothing was rewritten when the time passed: no state, no notification and no activity row.
  assert.deepEqual(f.data, kept);
  unchanged(f, () => f.call('offers.accept', {id: 'off-0005'}), 'too_late');
  unchanged(f, () => f.call('offers.reject', {id: 'off-0005', reason: 'Too low.'}), 'too_late');
  // A new offer supersedes an earlier one only if that one is still open. With no `respond_by`, `offer_response_days` is 7.
  f.event(offer(dec(18), 'off-0006', LOAN_CLAIM, 15900, PAYOFF));
  const claim = claimOf(f, LOAN_CLAIM);
  assert.deepEqual([claim.offers.map(o => o.state), claim.offers[1].respond_by, claim.flags], [['expired', 'open'], dec(26, '00:00:00'), []]);
  assert.ok(!f.data.activity.some(row => row.action === 'offer.superseded'));
  // A task can load this history later: the offers read by the new clock.
  const later = fixture({seed: f.data, now: dec(26, '00:00:00')});
  assert.deepEqual([claimOf(later, LOAN_CLAIM).offers.map(o => o.state), claimOf(later, LOAN_CLAIM).flags], [['expired', 'expired'], ['offer_expired']]);

  // One instant before its `respond_by`, the offer can still be accepted.
  const g = start();
  g.event(first);
  g.advance(dec(17, '16:59:59.999'));
  g.call('offers.accept', {id: 'off-0005'});
  assert.deepEqual(pick(claimOf(g, LOAN_CLAIM).offers[0], 'state', 'answered_at'), ['accepted', dec(17, '16:59:59.999')]);
});

test('T17b [W4] platform clock: a claim can be filed until the end of its last day, and not one instant later', () => {
  const f = start(), g = start();
  f.advance(dec(31, '23:59:59.999'));
  assert.deepEqual(pick(f.call('coverage.check', LOSS), 'covered', 'last_day_to_file', 'now'), [true, '2026-12-31', dec(31, '23:59:59.999')]);
  assert.equal(claimOf(f, f.call('claims.file', FILING).id).filed_at, dec(31, '23:59:59.999'));
  g.advance('2027-01-01T00:00:00-05:00');
  assert.deepEqual(pick(g.call('coverage.check', LOSS), 'covered', 'failures', 'last_day_to_file'), [false, ['too_late'], '2026-12-31']);
  unchanged(g, () => g.call('claims.file', FILING), 'too_late');
});

test('T17c [W4] platform clock: a day is a calendar day in the time zone of the insurer', () => {
  const east = start(), west = start({seed: edit(SEED, seed => { seed.insurer.timezone = 'America/Los_Angeles'; })});
  assert.deepEqual([east.call('policies.list').now, west.call('policies.list').now], [NOW, '2026-12-02T06:00:00-08:00']);
  // 01:30 on 1 December in New York is 22:30 on 30 November in Los Angeles.
  const night = {...FILING, loss_at: dec(1, '01:30:00')}, evening = {...FILING, loss_at: '2026-11-30T23:00:00-05:00'};
  const lastDay = f => f.call('coverage.check', {...LOSS, loss_at: night.loss_at}).last_day_to_file;
  assert.deepEqual([lastDay(east), lastDay(west)], ['2026-12-31', '2026-12-30']);
  // The two losses are on two days in New York and on one day in Los Angeles.
  east.call('claims.file', evening);
  west.call('claims.file', evening);
  assert.equal(east.call('claims.file', night).id, 'clm-0011');
  unchanged(west, () => west.call('claims.file', night), 'duplicate_claim');
  // In Los Angeles the last day to file ends at midnight there, which is 03:00 in New York.
  const other = {...LOSS, subject_id: LOAN_CAR, loss_at: night.loss_at};
  west.advance(dec(31, '02:59:59.999'));
  assert.deepEqual(pick(west.call('coverage.check', other), 'covered', 'now'), [true, '2026-12-30T23:59:59.999-08:00']);
  west.advance(dec(31, '03:00:00'));
  east.advance(dec(31, '03:00:00'));
  assert.deepEqual([west.call('coverage.check', other).failures, east.call('coverage.check', other).failures], [['too_late'], []]);
});

test('T17d [W4] platform clock: day limits follow the calendar across the end of daylight saving time on 1 November 2026', () => {
  // A copy of the seed with no claims, loaded on 20 October, when New York is at UTC-4.
  const f = fixture({seed: edit(SEED, seed => { seed.claims = []; }), now: '2026-10-20T12:00:00-04:00'}), now = () => f.call('preferences.get').now;
  const loss = {...LOSS, loss_at: '2026-10-20T08:00:00-04:00'}, other = {...loss, subject_id: LOAN_CAR};
  assert.deepEqual(pick(f.call('coverage.check', loss), 'covered', 'last_day_to_file', 'now'), [true, '2026-11-19', '2026-10-20T12:00:00-04:00']);
  const id = f.call('claims.file', {...loss, description: FILING.description}).id;
  // Ten days after 25 October end with 4 November. That midnight is at UTC-5.
  f.event(request('2026-10-25T10:00:00-04:00', 'req-0001', id, ['photos']));
  assert.equal(claimOf(f, id).requests[0].due_at, '2026-11-05T00:00:00-05:00');
  f.call('rental.start', {id, start_at: '2026-10-25T10:00:00-04:00', daily_rate: 40});
  // The hour from 01:00 to 02:00 happens twice on 1 November.
  f.advance('2026-11-01T01:30:00-04:00');
  assert.equal(now(), '2026-11-01T01:30:00-04:00');
  f.advance('2026-11-01T01:30:00-05:00');
  assert.equal(now(), '2026-11-01T01:30:00-05:00');
  // 1 November has 25 hours and is one rental day.
  f.advance('2026-11-02T00:00:00-05:00');
  assert.equal(claimOf(f, id).rentals[0].rental_days, 8);
  // A count in days of 24 hours would end one hour too early.
  f.advance('2026-11-04T23:30:00-05:00');
  assert.deepEqual(claimOf(f, id).flags, []);
  f.advance('2026-11-05T00:00:00-05:00');
  assert.deepEqual(claimOf(f, id).flags, ['request_overdue']);
  f.advance('2026-11-19T23:30:00-05:00');
  assert.equal(f.call('coverage.check', other).covered, true);
  f.advance('2026-11-20T00:00:00-05:00');
  assert.deepEqual(f.call('coverage.check', other).failures, ['too_late']);
});

test('T17e [W4] platform clock: a day limit ends with its last day where the clocks change at midnight (America/Havana, 8 March 2026)', () => {
  // In Havana 8 March 2026 has no 00:00. The day starts at 01:00, at UTC-4. The rules give two days to file and two days to answer.
  const havana = edit(SEED, seed => { seed.claims = []; seed.insurer.timezone = 'America/Havana'; Object.assign(seed.insurer.rules, {notice_days: 2, request_response_days: 2}); });
  const LAST = '2026-03-07T23:30:00-05:00', NEXT = '2026-03-08T01:00:00-04:00', at = now => fixture({seed: havana, now});
  const loss = {id: RENTERS, coverage: 'personal_property', subject_id: HOME, loss_at: '2026-03-05T09:00:00-05:00'}, filing = {...loss, description: 'A water pipe broke in the kitchen.'};
  const check = f => pick(f.call('coverage.check', loss), 'covered', 'failures', 'last_day_to_file', 'now');
  // A loss on 5 March can be filed until the end of 7 March, and not at the first instant of 8 March.
  const late = at(LAST), tooLate = at(NEXT);
  assert.deepEqual(check(late), [true, [], '2026-03-07', LAST]);
  assert.equal(claimOf(late, late.call('claims.file', filing).id).filed_at, LAST);
  assert.deepEqual(check(tooLate), [false, ['too_late'], '2026-03-07', NEXT]);
  unchanged(tooLate, () => tooLate.call('claims.file', filing), 'too_late');
  // A request of 5 March that names no due time is due at that same instant.
  const f = at('2026-03-05T12:00:00-05:00'), id = f.call('claims.file', filing).id, flags = () => claimOf(f, id).flags;
  f.event(request('2026-03-05T13:00:00-05:00', 'req-0001', id, ['receipt']));
  assert.equal(claimOf(f, id).requests[0].due_at, NEXT);
  f.advance('2026-03-07T23:59:59.999-05:00');
  assert.deepEqual(flags(), []);
  f.advance(NEXT);
  assert.deepEqual(flags(), ['request_overdue']);
});

test('T17f [W4] platform clock: a timestamp has a year from 1970 to 2999, and the schemas refuse every other year', () => {
  const f = start(), check = loss_at => f.call('coverage.check', {...LOSS, loss_at}), before = f.data;
  for (const loss_at of ['9999-12-31T23:59:59Z', '0099-06-01T00:00:00Z', '1969-12-31T23:59:59Z', '3000-01-01T00:00:00Z']) {
    unchanged(f, () => check(loss_at), SCHEMA, 'coverage.check ' + loss_at);
    unchanged(f, () => f.call('claims.file', {...FILING, loss_at}), SCHEMA, 'claims.file ' + loss_at);
    assert.throws(() => f.event(request(loss_at, 'req-0090', CAR_CLAIM, ['photos'])), /Event schema/, 'an event at ' + loss_at);
    assert.ok(!seedSchema(edit(SEED, seed => { seed.claims[0].loss_at = loss_at; })), 'a seed with ' + loss_at);
  }
  assert.deepEqual(f.data, before);
  // The first and the last year are accepted, and their days are right. 05:00 UTC is midnight in New York.
  assert.deepEqual([check('1970-01-01T05:00:00Z').last_day_to_file, check('2999-12-31T23:59:59Z').last_day_to_file], ['1970-01-31', '3000-01-30']);
});

test('T17g [W4] platform clock: day limits in a time zone east of UTC, across the end of daylight saving time (Australia/Sydney, 4 April 2027)', () => {
  // In Sydney the clocks go back from 03:00 to 02:00 on 4 April 2027, from UTC+11 to UTC+10. The rules give one day to file and two days to answer.
  const sydney = edit(SEED, seed => { seed.claims = []; seed.insurer.timezone = 'Australia/Sydney'; Object.assign(seed.insurer.rules, {notice_days: 1, request_response_days: 2}); });
  const loss = {...LOSS, loss_at: '2027-04-02T18:00:00+11:00'}, at = now => fixture({seed: sydney, now});
  const check = f => pick(f.call('coverage.check', loss), 'covered', 'failures', 'last_day_to_file', 'now');
  // A loss on 2 April can be filed until the end of 3 April. The next day starts at 13:00 UTC.
  assert.deepEqual(check(at('2027-04-03T12:59:59.999Z')), [true, [], '2027-04-03', '2027-04-03T23:59:59.999+11:00']);
  assert.deepEqual(check(at('2027-04-03T13:00:00Z')), [false, ['too_late'], '2027-04-03', '2027-04-04T00:00:00+11:00']);
  // A request of 2 April is due at the end of 4 April, which has 25 hours. That midnight is at UTC+10.
  const f = at('2027-04-02T19:00:00+11:00'), id = f.call('claims.file', {...loss, description: FILING.description}).id;
  f.event(request('2027-04-02T20:00:00+11:00', 'req-0001', id, ['photos']));
  assert.equal(claimOf(f, id).requests[0].due_at, '2027-04-05T00:00:00+10:00');
  f.call('rental.start', {id, start_at: '2027-04-02T20:00:00+11:00', daily_rate: 40});
  // The hour from 02:00 to 03:00 happens twice on 4 April, and that day is one rental day.
  const steps = [['2027-04-04T02:30:00+11:00', [], 2], ['2027-04-04T02:30:00+10:00', [], 2], ['2027-04-04T23:59:59.999+10:00', [], 2], ['2027-04-05T00:00:00+10:00', ['request_overdue'], 3]];
  for (const [now, flags, days] of steps) {
    f.advance(now);
    const out = f.call('claims.get', {id});
    assert.deepEqual([out.now, out.claim.flags, out.claim.rentals[0].rental_days], [now, flags, days]);
  }
});

test('T17h [W4] platform clock: a day limit ends at the first midnight of a day that has two (Asia/Amman, 29 October 2021)', () => {
  // In Amman the clocks went back from 01:00 to 00:00 on 29 October 2021. So that day has 00:00 twice: at UTC+3, and one hour later at UTC+2.
  const amman = edit(SEED, seed => { seed.claims = []; seed.insurer.timezone = 'Asia/Amman'; seed.policies[0].term = {start: '2021-01-01T00:00:00+02:00', end: '2022-01-01T00:00:00+02:00'}; });
  const loss = {...LOSS, loss_at: '2021-09-28T10:00:00+03:00'}, at = now => fixture({seed: amman, now});
  const check = f => pick(f.call('coverage.check', loss), 'covered', 'failures', 'last_day_to_file', 'now');
  // With 30 days to file, a loss on 28 September can be filed until the end of 28 October.
  const LAST = '2021-10-28T23:30:00+03:00', FIRST = '2021-10-29T00:00:00+03:00', SECOND = '2021-10-29T00:00:00+02:00', late = at(LAST);
  assert.equal(amman.insurer.rules.notice_days, 30);
  assert.deepEqual(check(late), [true, [], '2021-10-28', LAST]);
  assert.equal(claimOf(late, late.call('claims.file', {...loss, description: FILING.description}).id).filed_at, LAST);
  for (const now of [FIRST, SECOND]) {
    const tooLate = at(now);
    assert.deepEqual(check(tooLate), [false, ['too_late'], '2021-10-28', now]);
    unchanged(tooLate, () => tooLate.call('claims.file', {...loss, description: FILING.description}), 'too_late', 'claims.file at ' + now);
  }
});

test('T17i [W4] platform clock: every read works at the default clock of Core, and now and a default due time are written in UTC where the UTC offset of the insurer has seconds', () => {
  // Core starts a registry with no initial_time at 1970-01-01T00:00:00Z. In New York that instant is in 1969, so `now` has no year bound.
  const f = start({now: '1970-01-01T00:00:00Z'}), results = everyRead(f);
  assert.deepEqual([...new Set(results.map(([name]) => name))].sort(), [...READS].sort());
  for (const [name, result] of results) assert.equal(result.now, '1969-12-31T19:00:00-05:00', name);
  // Until 1972 Monrovia was 44 minutes and 30 seconds behind UTC. Such an offset has no ISO form, so `now` is written in UTC.
  const g = start({seed: edit(SEED, seed => { seed.insurer.timezone = 'Africa/Monrovia'; }), now: '1971-06-01T12:00:00Z'});
  for (const [name, result] of everyRead(g)) assert.equal(result.now, '1971-06-01T12:00:00.000Z', name);
  // A default due time is written in the same way. A day starts there at 00:44:30 UTC: ten days to answer end where 12 June starts, and seven days where 9 June starts.
  g.event(request('1971-06-01T12:00:00Z', 'req-0012', CAR_CLAIM, ['photos']));
  g.event(offer('1971-06-01T12:00:00Z', 'off-0005', LOAN_CLAIM, 14200, PAYOFF));
  assert.deepEqual([claimOf(g, CAR_CLAIM).requests[0].due_at, claimOf(g, LOAN_CLAIM).offers[0].respond_by], ['1971-06-12T00:44:30.000Z', '1971-06-09T00:44:30.000Z']);
  // The request is overdue from that instant, and not one millisecond before it.
  g.advance('1971-06-12T00:44:29.999Z');
  assert.deepEqual(claimOf(g, CAR_CLAIM).flags, []);
  g.advance('1971-06-12T00:44:30Z');
  assert.deepEqual(claimOf(g, CAR_CLAIM).flags, ['request_overdue']);
});

test('T17j [W4] platform clock: at a clock outside the years 1970 to 2999 every read works, and a write is refused and changes nothing (the real host answers invalid_event, from the seed schema check of Core)', () => {
  // A write stores the clock, for example in its activity row, and the seed schema refuses that year. In this harness the refusal is the assertion error "Seed schema".
  const writes = [['claims.update', {id: CAR_CLAIM, description: 'New text.'}], ['claims.add_evidence', {id: CAR_CLAIM, items: [photo('Rear bumper')]}],
    ['estimates.submit', {id: CAR_CLAIM, kind: 'initial', shop_name: SHOP, lines: [{text: 'Door', amount: 800}]}], ['payee.set', {id: CAR_CLAIM, payee: TO_SHOP}],
    ['preferences.update', {email_notices: false}], ['claims.withdraw', {id: CAR_CLAIM}]];
  for (const [clock, now] of [['3000-01-01T00:00:00Z', '2999-12-31T19:00:00-05:00'], ['1969-12-31T23:59:59Z', '1969-12-31T18:59:59-05:00']]) {
    const f = start({now: clock}), results = everyRead(f, LOSS.loss_at), before = f.data;
    assert.deepEqual([...new Set(results.map(([name]) => name))].sort(), [...READS].sort());
    for (const [name, result] of results) assert.equal(result.now, now, name + ' at ' + clock);
    for (const [name, args] of writes) assert.throws(() => f.call(name, args), {name: 'AssertionError', message: 'Seed schema'}, name + ' at ' + clock);
    assert.deepEqual(f.data, before, clock);
  }
  // The same writes are applied at the first and at the last instant of the supported years.
  for (const clock of ['1970-01-01T00:00:00Z', '2999-12-31T23:59:59.999Z']) {
    const f = start({now: clock});
    for (const [name, args] of writes) f.call(name, args);
    assert.deepEqual(f.data.activity.filter(row => !row.effect).map(row => [row.action, row.at]), writes.map(([name]) => [name, clock]));
  }
});

test('T17k [W4] platform clock: a day limit ends at the exact first instant of the next day where the clocks change by an amount that is not a multiple of 15 minutes (Africa/Monrovia 1972, Pacific/Kiritimati 1979)', () => {
  // A copy of the seed with no claims, in another time zone, with an auto policy for that year and the next one.
  const zoned = (timezone, year, rules = {}) => edit(SEED, seed => {
    seed.claims = [];
    seed.insurer.timezone = timezone;
    Object.assign(seed.insurer.rules, rules);
    seed.policies[0].term = {start: year + '-01-01T00:00:00Z', end: (year + 2) + '-01-01T00:00:00Z'};
  });
  // Monrovia: 7 January 1972 starts at 00:44:30 UTC, where the offset goes from -00:44:30 to +00:00.
  // Kiritimati: 1 October 1979 starts at 10:40:00 UTC, where the offset goes from -10:40 to -10:00.
  // [the zone, the loss time, its last day to file, the last instant of that day and how `now` reads it, the first instant of the next day and how `now` reads it]
  const cases = [
    ['Africa/Monrovia', '1971-12-07T12:00:00Z', '1972-01-06', '1972-01-07T00:44:29.999Z', '1972-01-07T00:44:29.999Z', '1972-01-07T00:44:30Z', '1972-01-07T00:44:30+00:00'],
    ['Pacific/Kiritimati', '1979-08-31T22:00:00Z', '1979-09-30', '1979-10-01T10:39:59.999Z', '1979-09-30T23:59:59.999-10:40', '1979-10-01T10:40:00Z', '1979-10-01T00:40:00-10:00']];
  assert.equal(SEED.insurer.rules.notice_days, 30);
  for (const [zone, loss_at, lastDay, LAST, lastNow, NEXT, nextNow] of cases) {
    const loss = {...LOSS, loss_at}, filing = {...loss, description: FILING.description}, at = now => fixture({seed: zoned(zone, Number(loss_at.slice(0, 4))), now});
    const check = f => pick(f.call('coverage.check', loss), 'covered', 'failures', 'last_day_to_file', 'now'), late = at(LAST), tooLate = at(NEXT);
    assert.deepEqual(check(late), [true, [], lastDay, lastNow], zone);
    assert.equal(claimOf(late, late.call('claims.file', filing).id).filed_at, LAST, zone);
    assert.deepEqual(check(tooLate), [false, ['too_late'], lastDay, nextNow], zone);
    unchanged(tooLate, () => tooLate.call('claims.file', filing), 'too_late', zone);
  }
  // README, "Plan and implementation": "A calendar date that a zone skipped, such as 30 December 2011 in `Pacific/Apia`, still counts as a day."
  // Apia went from 29 December to 31 December. With one day to file, a loss on 29 December reads 30 December as its last day, and a rental from 29 December has two rental days on 31 December.
  const f = fixture({seed: zoned('Pacific/Apia', 2011, {notice_days: 1}), now: '2011-12-29T22:00:00Z'}), loss = {...LOSS, loss_at: '2011-12-29T21:00:00Z'};
  const id = f.call('claims.file', {...loss, description: FILING.description}).id;
  f.call('rental.start', {id, start_at: '2011-12-29T21:30:00Z', daily_rate: 40});
  f.advance('2011-12-30T22:00:00Z');
  const read = f.call('claims.get', {id});
  assert.deepEqual([read.now, f.call('coverage.check', {...loss, subject_id: LOAN_CAR}).last_day_to_file, read.claim.rentals[0].rental_days], ['2011-12-31T12:00:00+14:00', '2011-12-30', 2]);
});

test('T17l [W4] platform clock: at the default clock of Core, before all its history, the package fixture reads no open offer beside an accepted one or on a claim that is not open', () => {
  const f = fixture({now: '1970-01-01T00:00:00Z'}), third = f.data.claims.find(claim => claim.id === 'clm-0003');
  // Only the last offer of an open claim can read open, and only when no offer of the claim is accepted.
  for (const {id} of f.data.claims) {
    const claim = claimOf(f, id), states = claim.offers.map(o => o.state);
    assert.ok(!states.includes('open') || claim.state === 'open' && !states.includes('accepted') && states.indexOf('open') === states.length - 1, id + ' reads ' + states);
  }
  // clm-0003 is closed. Its second offer is stored as open, because its respond_by passed with no answer.
  assert.deepEqual([third.state, third.offers.map(o => o.state), claimOf(f, 'clm-0003').offers.map(o => o.state)],
    ['closed', ['superseded', 'open', 'rejected', 'accepted'], ['superseded', 'expired', 'rejected', 'accepted']]);
});

test('T18 [All] invalid events: each event of the plan\'s list that can occur is rejected with invalid_event, and the data does not change', () => {
  const f = start(), T = dec(20), ENDED = 'The claim is withdrawn or closed', NO_PAYEE = 'A settlement payment names its payee';
  // CAR_CLAIM is on the repair path with a decided dispute and the pending line ln-04. LOAN_CLAIM is on the total_loss path with an accepted offer.
  f.event(estimate(dec(3), 'est-0031', CAR_CLAIM, THREE_LINES));
  f.event(determination(dec(3, '12:00:00'), 'det-0044', CAR_CLAIM, {'ln-01': 900, 'ln-02': 350, 'ln-03': 'Old damage.'}));
  f.call('determinations.dispute', {id: 'ln-03', claim_id: CAR_CLAIM, reason: 'The damage is new.'});
  f.event(decided(dec(4), 'dsp-0004', 'upheld'));
  f.event(estimate(dec(4, '12:00:00'), 'est-0033', CAR_CLAIM, {'ln-04': 80}, {kind: 'supplement'}));
  f.event(estimate(dec(5), 'est-0032', LOAN_CLAIM, {'ln-01': 4000}));
  f.event(offer(dec(6), 'off-0005', LOAN_CLAIM, 15900, PAYOFF));
  f.call('offers.accept', {id: 'off-0005'});
  // HOME_CLAIM is withdrawn. Two claims are new: an open renters claim, and an auto claim that is closed.
  f.call('claims.withdraw', {id: HOME_CLAIM});
  const renters = f.call('claims.file', {...FILING, id: RENTERS, coverage: 'personal_property', subject_id: HOME}).id;
  const shut = f.call('claims.file', FILING).id;
  f.event(closed(dec(7), shut, 'denied'));
  // [the case of the plan, the event, a part of the message of the rule that rejects it]
  // The plan's cases "an unknown estimate" and "an unknown offer" cannot occur, because no event names an existing estimate or offer.
  const cases = [
    ['a seed rule: an offer on a claim that is not an auto claim', offer(T, 'off-0090', renters, 900), 'not an auto claim'],
    ['a seed rule: a payment with an amount of zero', payment(T, 'pay-0090', CAR_CLAIM, 'repair', 0), 'an amount of zero or less'],
    ['a seed rule: a settlement payment to a shop', payment(T, 'pay-0090', LOAN_CLAIM, 'settlement', 100, TO_SHOP), NO_PAYEE],
    ['a seed rule: a settlement payment on a claim on the repair path', payment(T, 'pay-0090', CAR_CLAIM, 'settlement', 100, TO_ME), 'A settlement payment is on a claim on the repair path'],
    ['a seed rule: a request with no asks', request(T, 'req-0090', CAR_CLAIM, []), 'An information request has no asks'],
    ['a duplicate ID: the ID of another estimate', estimate(T, 'est-0029', CAR_CLAIM, {'ln-09': 10}), 'The ID est-0029 already exists'],
    ['a duplicate ID: the ID of another offer', offer(T, 'off-0005', CAR_CLAIM, 9000), 'The ID off-0005 already exists'],
    ['a duplicate ID: a pending line that the claim already has', estimate(T, 'est-0090', CAR_CLAIM, {'ln-04': 10}), 'The line ln-04 already exists in this claim'],
    ['an unknown claim', request(T, 'req-0090', 'clm-9999', ['photos']), 'names a claim that does not exist'],
    ['an unknown line', determination(T, 'det-0090', CAR_CLAIM, {'ln-99': 10}), 'names a line that the claim does not have'],
    ['an unknown dispute', decided(T, 'dsp-9999', 'upheld'), 'names a dispute that does not exist'],
    ['an estimate with no lines', estimate(T, 'est-0090', CAR_CLAIM, {}), 'An estimate has no lines'],
    ['a decision on a dispute that is not open', decided(T, 'dsp-0004', 'changed', {status: 'approved', amount: 750}), 'The dispute is not open'],
    ['an offer on a claim that already has an accepted offer', offer(T, 'off-0090', LOAN_CLAIM, 16500, PAYOFF), 'already has an accepted offer'],
    ['an estimate on a claim on the total_loss path', estimate(T, 'est-0090', LOAN_CLAIM, {'ln-02': 10}), 'It takes no more estimates'],
    ['a determination on a claim on the total_loss path', determination(T, 'det-0090', LOAN_CLAIM, {'ln-01': 4000}), 'It takes no more determinations'],
    ['a completed repair on a claim on the total_loss path', completed(T, LOAN_CLAIM), 'It has no repair to complete'],
    ['a payment with a payee that is not the policyholder, a shop or the lienholder', payment(T, 'pay-0090', CAR_CLAIM, 'repair', 100, {kind: 'adjuster'}),
      'A payment goes to the policyholder, a named shop or the lienholder'],
    ['a settlement payment that names no payee', payment(T, 'pay-0090', LOAN_CLAIM, 'settlement', 100), NO_PAYEE],
    ['a repair payment on a claim on the total_loss path', payment(T, 'pay-0090', LOAN_CLAIM, 'repair', 100), 'A repair payment is on a claim on the total_loss path'],
    ['dispute.decided on a withdrawn claim', decided(T, 'dsp-0003', 'upheld'), ENDED]
  ];
  // Any event on a claim that is withdrawn or closed.
  for (const [state, claim] of [['withdrawn', HOME_CLAIM], ['closed', shut]]) {
    const after = [request(T, 'req-0090', claim, ['photos']), estimate(T, 'est-0090', claim, {'ln-09': 10}), determination(T, 'det-0090', claim, {'ln-01': 10}),
      offer(T, 'off-0090', claim, 900), payment(T, 'pay-0090', claim, 'repair', 10), completed(T, claim), closed(T, claim, 'paid')];
    for (const e of after) cases.push([e.operation + ' on a ' + state + ' claim', e, ENDED]);
  }
  // Core refuses an event dated before the clock. tests/mcp.integration.cjs checks that on the real Core.
  assert.equal(cases.length, 35);
  for (const [label, e, text] of cases) unchanged(f, () => f.event(e), 'invalid_event', label, text);
  // Only the event that creates an estimate or an offer has its ID, so no event names an existing one.
  const events = require('../schemas/events.schema.json').oneOf, having = key => events.filter(e => key in e.properties.payload.properties).map(e => e.properties.operation.const);
  assert.deepEqual([events.length, having('estimate_id'), having('offer_id')], [8, ['alderbrook.estimate.submitted'], ['alderbrook.offer.issued']]);
});

test('T18b [All] seed rules: validateSeed rejects each seed of the plan\'s list, and each seed that breaks a rule that the package adds, with invalid_seed', () => {
  const f = start({now: dec(3)}), of = (seed, id) => seed.claims.find(claim => claim.id === id);
  // A valid history with every kind of record. Each bad seed is one small change to it.
  f.event(request(dec(3, '10:00:00'), 'req-0012', CAR_CLAIM, ['photos', 'driver']));
  repair(f, 'approval');
  f.event(payment(dec(5), 'pay-0021', CAR_CLAIM, 'repair', 1500));
  f.call('rental.start', {id: LOAN_CLAIM, start_at: dec(3), daily_rate: 45});
  f.call('rental.end', {id: 'rnt-0001', end_at: dec(5)});
  f.call('rental.start', {id: LOAN_CLAIM, start_at: dec(5), daily_rate: 45});
  // LOAN_CLAIM gets a denied line and a dispute on it. The offer then moves the claim to the total_loss path and makes the dispute void.
  f.event(estimate(dec(6), 'est-0032', LOAN_CLAIM, {'ln-01': 4000}));
  f.event(determination(dec(6, '12:00:00'), 'det-0045', LOAN_CLAIM, {'ln-01': 'The vehicle will not be repaired.'}));
  f.call('determinations.dispute', {id: 'ln-01', claim_id: LOAN_CLAIM, reason: 'The shop can repair it.'});
  f.event(offer(dec(8), 'off-0005', LOAN_CLAIM, 15900, PAYOFF));
  f.event(payment(dec(9), 'pay-0022', LOAN_CLAIM, 'settlement', 100, {kind: 'lienholder'}));
  const base = f.data;
  plugin.validateSeed(f.ctx, base);
  const bare = (claim, id, loss_at) => ({...claim, id, loss_at, evidence: [], requests: [], estimates: [], determinations: [], disputes: [], offers: [], rentals: [],
    payments: [], history: []});
  // One more claim with no parts, for an older loss on the first vehicle: withdrawn, or closed with the outcome paid.
  const extra = (seed, fields) => seed.claims.push({...bare(of(seed, CAR_CLAIM), 'clm-0099', '2026-11-20T10:00:00-05:00'), ...fields});
  const gone = (seed, fields) => extra(seed, {state: 'withdrawn', withdrawn_at: dec(9), ...fields});
  const shut = (seed, fields) => extra(seed, {state: 'closed', outcome: 'paid', closed_at: dec(9), ...fields});
  const answer = {text: 'See the report.', evidence_ids: [], answered_at: dec(4)}, address = {id: 'addr-99', line: '9 Elm Street, Rochester, NY 14607'};
  const CLOSING = 'does not fit its closing fields', KIND = 'insured items that do not fit its kind', APPROVED = 'An approved line needs an amount, and a denied line has none';
  const OTHER_CLAIM = 'An evidence item of another claim, or an unknown one, is named', NO_LINE = 'names a line or a decision that does not exist', DECIMALS = 'An amount has more than two decimals';
  // One more determination on the first line of CAR_CLAIM, which det-0044 approved on 4 December at 15:30.
  const again = (seed, at) => {
    const claim = of(seed, CAR_CLAIM), decision = {status: 'denied', amount: null, reason: 'Old damage.', decided_at: at, source: 'determination', source_id: 'det-0099'};
    claim.determinations.push({id: 'det-0099', issued_at: at, issued_by: ADJUSTER, note: null, line_ids: ['ln-01']});
    claim.estimates[0].lines[0].decisions.push(decision);
  };
  // [the rule, the change that breaks only this rule, a part of the message of the rule, true when the seed schema refuses the seed too]
  const rules = [
    ['duplicate IDs', seed => { const items = of(seed, HOME_CLAIM).evidence; items.push({...items[0]}); }, 'The ID evd-0003 is used twice'],
    ['a reference to a policy that does not exist', seed => { of(seed, CAR_CLAIM).policy_id = 'pol-none'; }, 'A claim names a policy that does not exist'],
    ['a reference to an evidence item that does not exist', seed => { of(seed, HOME_CLAIM).disputes[0].evidence_ids = ['evd-9999']; }, OTHER_CLAIM],
    ['a reference to a claim that does not exist', seed => { seed.notifications[0].claim_id = 'clm-9999'; }, 'A notification names a claim that does not exist'],
    ['a timestamp without a UTC offset', seed => { of(seed, CAR_CLAIM).filed_at = '2026-11-30T09:15:00'; }, 'A timestamp has no UTC offset', true],
    ['an account that the binding does not declare', seed => { seed.account_id = 'alderbrook-nobody'; }, 'Account and owner must exist in the supplied binding'],
    ['a claim whose loss time is outside the term of its policy', seed => { of(seed, CAR_CLAIM).loss_at = '2026-06-30T23:59:59-04:00'; }, 'outside the term of its policy'],
    ['a claim whose coverage its policy does not have', seed => { of(seed, CAR_CLAIM).coverage = seed.policies[0].coverages.pop().type; }, 'a coverage that its policy does not have'],
    ['two open claims on one policy for the same coverage, vehicle and loss day', seed => { seed.claims.push(bare(of(seed, CAR_CLAIM), 'clm-0099', '2026-11-28T08:00:00-05:00')); },
      'Two open claims on one policy'],
    ['a determination that names a line of another claim', seed => { of(seed, HOME_CLAIM).determinations[0].line_ids.push('ln-03'); }, 'A determination names a line of another claim'],
    ['two open disputes on one line', seed => { const disputes = of(seed, HOME_CLAIM).disputes; disputes.push({...disputes[0], id: 'dsp-0099'}); }, 'One line has two open disputes'],
    ['a request with no asks', seed => { Object.assign(of(seed, CAR_CLAIM).requests[0], {state: 'void', asks: []}); }, 'An information request has no asks'],
    ['two open offers on one claim', seed => { const offers = of(seed, LOAN_CLAIM).offers; offers.push({...offers[0], id: 'off-0099', issued_at: dec(9)}); }, 'One claim has two open offers'],
    ['an open offer beside an accepted one', seed => {
      const offers = of(seed, LOAN_CLAIM).offers;
      offers.unshift({...offers[0], id: 'off-0099', issued_at: dec(7), state: 'accepted', answered_at: dec(7, '12:00:00')});
    }, 'An offer follows an accepted offer'],
    ['an offer on a claim that is not an auto claim', seed => {
      const one = {...of(seed, LOAN_CLAIM).offers[0], id: 'off-0099', lienholder_payoff: null};
      seed.claims.push({...bare(of(seed, HOME_CLAIM), 'clm-0099', '2026-11-05T10:00:00-05:00'), path: 'total_loss', offers: [one]});
    }, 'An offer is on a claim that is not an auto claim'],
    ['two active rental periods on one claim', seed => { Object.assign(of(seed, LOAN_CLAIM).rentals[0], {state: 'active', end_at: null, ended_by: null}); }, 'One claim has two active rental periods'],
    ['two rental periods of one claim that overlap', seed => { of(seed, LOAN_CLAIM).rentals[1].start_at = dec(4); }, 'Two rental periods of one claim overlap'],
    ['a payment with an amount of zero', seed => { of(seed, CAR_CLAIM).payments[0].amount = 0; }, 'A payment has an amount of zero or less'],
    ['a payment with an amount below zero', seed => { of(seed, CAR_CLAIM).payments[0].amount = -20; }, 'A payment has an amount of zero or less'],
    ['a settlement payment whose payee is not the lienholder or the policyholder', seed => { of(seed, LOAN_CLAIM).payments[0].payee = {kind: 'shop', name: SHOP}; },
      'A settlement payment goes to the lienholder or to the policyholder'],
    ['a settlement payment on a claim that is on the repair path', seed => { of(seed, CAR_CLAIM).payments[0].kind = 'settlement'; }, 'A settlement payment is on a claim on the repair path'],
    // More references to an object that does not exist.
    ['a claim whose vehicle is not on its policy', seed => { of(seed, CAR_CLAIM).subject_id = 'veh-99'; }, 'a vehicle or an address that its policy does not have'],
    ['a claim whose address is not on its policy', seed => { of(seed, HOME_CLAIM).subject_id = 'addr-99'; }, 'a vehicle or an address that its policy does not have'],
    ['a listed driver who is not on the policy', seed => { of(seed, CAR_CLAIM).driver = {kind: 'listed', person_id: 'person-noor'}; }, 'A listed driver is not on the policy'],
    ['an activity row that names an object that does not exist', seed => { seed.activity[0].object_id = 'clm-9999'; }, 'An activity row names an object that does not exist'],
    ['an answer that names an evidence item of another claim', seed => { of(seed, CAR_CLAIM).requests[0].asks[0].answer = {...answer, evidence_ids: ['evd-0003']}; }, OTHER_CLAIM],
    ['an offer that names an evidence item of another claim', seed => { of(seed, LOAN_CLAIM).offers[0].evidence_ids = ['evd-0003']; }, OTHER_CLAIM],
    // The rules that the package adds to the plan's list (README, "Plan and implementation"). First the account and its policies.
    ['an amount with a third decimal', seed => { of(seed, CAR_CLAIM).payments[0].amount = 1500.005; }, DECIMALS],
    ['an amount with a billionth more', seed => { of(seed, CAR_CLAIM).payments[0].amount = 1500.000000001; }, DECIMALS],
    ['a payment of a billionth, which is zero cents', seed => { of(seed, CAR_CLAIM).payments[0].amount = 0.000000001; }, DECIMALS],
    ['an unknown time zone', seed => { seed.insurer.timezone = 'Mars/Olympus_Mons'; }, 'A time zone is unknown'],
    ['a policy term that ends before it starts', seed => { seed.policies.push({...seed.policies[1], id: 'pol-rent-99', insured_address: address, term: {start: dec(2), end: dec(1)}}); },
      'A policy term ends before it starts'],
    ['a policy with one coverage twice', seed => { const coverages = seed.policies[0].coverages; coverages.push({...coverages[0]}); }, 'a coverage that does not fit its kind'],
    ['a renters policy with a collision coverage', seed => { seed.policies[1].coverages.push({...seed.policies[0].coverages[0]}); }, 'a coverage that does not fit its kind'],
    ['an auto policy with an insured address', seed => { seed.policies[0].insured_address = address; }, KIND],
    ['an auto policy with no vehicle', seed => { seed.policies.push({...seed.policies[0], id: 'pol-auto-99', vehicles: []}); }, KIND],
    ['a renters policy with a vehicle', seed => { seed.policies[1].vehicles.push({...seed.policies[0].vehicles[0], id: 'veh-99'}); }, KIND],
    ['a renters policy with no insured address', seed => { seed.policies.push({...seed.policies[1], id: 'pol-rent-99', insured_address: null}); }, KIND],
    ['a renters policy with a rental benefit', seed => { seed.policies[1].rental_benefit = {...seed.policies[0].rental_benefit}; }, KIND],
    // A claim and its closing fields.
    ['a claim whose loss time is the end of the term of its policy', seed => { const {end} = seed.policies[0].term; Object.assign(of(seed, CAR_CLAIM), {loss_at: end, filed_at: end}); },
      'outside the term of its policy'],
    ['a claim filed before its loss', seed => { of(seed, CAR_CLAIM).filed_at = '2026-11-28T16:39:59-05:00'; }, 'A claim is filed before its loss'],
    ['an open claim with an outcome', seed => { of(seed, CAR_CLAIM).outcome = 'paid'; }, CLOSING],
    ['an open claim with a closing time', seed => { of(seed, CAR_CLAIM).closed_at = dec(9); }, CLOSING],
    ['an open claim with a withdrawal time', seed => { of(seed, CAR_CLAIM).withdrawn_at = dec(9); }, CLOSING],
    ['a withdrawn claim with an outcome', seed => gone(seed, {outcome: 'denied'}), CLOSING],
    ['a withdrawn claim with no withdrawal time', seed => gone(seed, {withdrawn_at: null}), CLOSING],
    ['a closed claim with no outcome', seed => shut(seed, {outcome: null}), CLOSING],
    ['a closed claim with no closing time', seed => shut(seed, {closed_at: null}), CLOSING],
    ['a claim with a repair completion time and no reporter', seed => { of(seed, CAR_CLAIM).repair_completed_at = dec(9); }, 'The repair completion fields of a claim do not agree'],
    // Requests.
    ['a request with two asks with one key', seed => { const asks = of(seed, CAR_CLAIM).requests[0].asks; asks[1].key = asks[0].key; }, 'An information request has two asks with one key'],
    ['an answered request with an ask that has no answer', seed => { of(seed, CAR_CLAIM).requests[0].state = 'answered'; }, 'does not fit its answers'],
    ['an open request whose asks all have an answer', seed => { for (const ask of of(seed, CAR_CLAIM).requests[0].asks) ask.answer = {...answer}; }, 'does not fit its answers'],
    ['an open request on a claim that is not open', seed => gone(seed, {requests: [{...of(seed, CAR_CLAIM).requests[0], id: 'req-0099'}]}), 'A claim that is not open has an open information request'],
    // Estimates, lines and their decisions.
    ['an estimate with no lines', seed => { const estimates = of(seed, CAR_CLAIM).estimates; estimates.push({...estimates[0], id: 'est-0099', lines: []}); }, 'An estimate has no lines'],
    ['one line ID twice in one claim', seed => {
      const estimates = of(seed, CAR_CLAIM).estimates, line = {id: 'ln-09', text: 'Clip', amount: 5, decisions: []};
      estimates.push({...estimates[0], id: 'est-0099', lines: [line, {...line}]});
    }, 'The line ln-09 is used twice in one claim'],
    ['an approved decision with no amount', seed => { of(seed, CAR_CLAIM).estimates[0].lines[0].decisions[0].amount = null; }, APPROVED],
    ['an approved decision with an amount of zero', seed => { of(seed, CAR_CLAIM).estimates[0].lines[0].decisions[0].amount = 0; }, APPROVED],
    ['a denied decision with an amount', seed => { of(seed, HOME_CLAIM).estimates[0].lines[1].decisions[0].amount = 420; }, APPROVED],
    ['a determination that names no line', seed => { of(seed, HOME_CLAIM).determinations.push({id: 'det-0099', issued_at: dec(2), issued_by: ADJUSTER, note: null, line_ids: []}); },
      'A determination names no line'],
    ['a determination with no decision on a line that it names', seed => { of(seed, CAR_CLAIM).estimates[0].lines[0].decisions = []; }, 'A determination and the decisions of its lines do not agree'],
    ['a decision from a determination that does not exist', seed => { const decisions = of(seed, HOME_CLAIM).estimates[0].lines[0].decisions; decisions.push({...decisions[0], source_id: 'det-9999'}); },
      'A decision names a determination or a dispute that does not exist'],
    ['two decisions of one line that are not in order of time', seed => again(seed, dec(4, '15:29:59')), 'The decisions of a line are not in order of time'],
    // Disputes.
    ['a dispute on a line that does not exist', seed => { of(seed, HOME_CLAIM).disputes[0].line_id = 'ln-99'; }, NO_LINE],
    ['a dispute on a decision that does not exist', seed => { Object.assign(of(seed, HOME_CLAIM).disputes[0], {state: 'void', decision_index: 5}); }, NO_LINE],
    ['an open dispute on a decision that a newer decision replaced', seed => {
      const claim = of(seed, HOME_CLAIM), decision = {status: 'denied', amount: null, reason: 'Still no proof of ownership.', decided_at: dec(2), source: 'determination', source_id: 'det-0099'};
      claim.determinations.push({id: 'det-0099', issued_at: dec(2), issued_by: ADJUSTER, note: null, line_ids: ['ln-02']});
      claim.estimates[0].lines[1].decisions.push(decision);
    }, 'An open dispute is on a decision that a newer decision replaced'],
    ['an open dispute on a claim that is not open', seed => { Object.assign(of(seed, HOME_CLAIM), {state: 'withdrawn', withdrawn_at: dec(9)}); }, 'not open on the repair path has an open dispute'],
    ['an open dispute on a claim on the total_loss path', seed => { of(seed, LOAN_CLAIM).disputes[0].state = 'open'; }, 'not open on the repair path has an open dispute'],
    ['an open dispute with a decision time', seed => { of(seed, HOME_CLAIM).disputes[0].decided_at = dec(2); }, 'The state of a dispute does not fit its decision time'],
    ['an upheld dispute with no decision time', seed => { of(seed, HOME_CLAIM).disputes[0].state = 'upheld'; }, 'The state of a dispute does not fit its decision time'],
    ['a changed dispute with no decision on its line', seed => { Object.assign(of(seed, HOME_CLAIM).disputes[0], {state: 'changed', decided_at: dec(2)}); }, 'A dispute and the decision of its line do not agree'],
    // Offers.
    ['a claim on the total_loss path with no offer', seed => { of(seed, CAR_CLAIM).path = 'total_loss'; }, 'on the total_loss path only when it has an offer'],
    ['an offer on a claim on the repair path', seed => { of(seed, CAR_CLAIM).offers.push({...of(seed, LOAN_CLAIM).offers[0], id: 'off-0099', lienholder_payoff: null}); },
      'on the total_loss path only when it has an offer'],
    ['an offer with no payoff on a vehicle with a lienholder', seed => { of(seed, LOAN_CLAIM).offers[0].lienholder_payoff = null; }, 'An offer has a payoff only when the vehicle has a lienholder'],
    ['an offer with a payoff on a vehicle with no lienholder', seed => { Object.assign(of(seed, CAR_CLAIM), {path: 'total_loss', offers: [{...of(seed, LOAN_CLAIM).offers[0], id: 'off-0099'}]}); },
      'An offer has a payoff only when the vehicle has a lienholder'],
    ['an open offer with an answer time', seed => { of(seed, LOAN_CLAIM).offers[0].answered_at = dec(9); }, 'The state of an offer does not fit its answer time'],
    ['an accepted offer with no answer time', seed => { of(seed, LOAN_CLAIM).offers[0].state = 'accepted'; }, 'The state of an offer does not fit its answer time'],
    ['offers that are not in order of time', seed => {
      const offers = of(seed, LOAN_CLAIM).offers;
      offers.push({...offers[0], id: 'off-0099', issued_at: dec(7)});
      Object.assign(offers[0], {state: 'rejected', answered_at: dec(8, '12:00:00')});
    }, 'The offers of a claim are not in order of time'],
    ['an open offer on a claim that is not open', seed => gone(seed, {path: 'total_loss', offers: [{...of(seed, LOAN_CLAIM).offers[0], id: 'off-0099', lienholder_payoff: null}]}),
      'A claim that is not open has an open offer'],
    // Rental periods, payments and activity rows.
    ['a rental period on a policy with no rental benefit', seed => { of(seed, HOME_CLAIM).rentals.push({...of(seed, LOAN_CLAIM).rentals[0], id: 'rnt-0099'}); },
      'A rental period is on a policy with no rental benefit'],
    ['an ended rental period with no end time', seed => { of(seed, LOAN_CLAIM).rentals[0].end_at = null; }, 'The state of a rental period does not fit its end time'],
    ['an active rental period with an end time', seed => { of(seed, LOAN_CLAIM).rentals[1].end_at = dec(6); }, 'The state of a rental period does not fit its end time'],
    ['a rental period that ends before it starts', seed => { of(seed, LOAN_CLAIM).rentals[0].end_at = dec(2); }, 'The state of a rental period does not fit its end time'],
    ['an active rental period on a claim that is not open', seed => gone(seed, {rentals: [{...of(seed, LOAN_CLAIM).rentals[1], id: 'rnt-0099'}]}), 'A claim that is not open has an active rental period'],
    ['a payment to a shop with no name', seed => { of(seed, CAR_CLAIM).payments[0].payee = {kind: 'shop', name: null}; }, 'A payment to a shop needs the name of the shop'],
    ['activity rows that are not in order', seed => { seed.activity[1].seq = seed.activity[0].seq; }, 'The activity rows are not in order']
  ];
  // A third decimal, or a billionth more, is refused in every amount that a seed stores. The payment amount is in the list above.
  const amounts = [['deductible', seed => seed.policies[0].coverages[0]], ['limit', seed => seed.policies[1].coverages[0]], ['daily_cap', seed => seed.policies[0].rental_benefit],
    ['final_invoice_total', seed => of(seed, CAR_CLAIM)], ['amount', seed => of(seed, CAR_CLAIM).estimates[0].lines[0]], ['amount', seed => of(seed, CAR_CLAIM).estimates[0].lines[0].decisions[0]],
    ['valuation', seed => of(seed, LOAN_CLAIM).offers[0]], ['lienholder_payoff', seed => of(seed, LOAN_CLAIM).offers[0]], ['daily_rate', seed => of(seed, LOAN_CLAIM).rentals[0]]];
  for (const value of [10.005, 10.000000001]) for (const [field, holder] of amounts) rules.push([value + ' in ' + field, seed => { holder(seed)[field] = value; }, DECIMALS]);
  // Every kind of record takes part in the rule for duplicate IDs: a notification cannot have the ID of another record.
  const taken = [AUTO, CAR, HOME, CAR_CLAIM, 'evd-0003', 'req-0012', 'est-0031', 'det-0044', 'dsp-0003', 'off-0005', 'rnt-0001', 'pay-0021', base.notifications[1].id];
  for (const id of taken) rules.push(['a notification with the ID ' + id, seed => { seed.notifications[0].id = id; }, 'The ID ' + id + ' is used twice']);
  assert.equal(rules.length, 116);
  for (const [rule, change, text, schemaToo = false] of rules) {
    const bad = edit(base, change);
    assert.equal(seedSchema(bad), !schemaToo, rule);
    assert.throws(() => plugin.validateSeed(f.ctx, bad), error => {
      assert.deepEqual([error.code, error.message.includes(text)], ['invalid_seed', true], rule + ': ' + error.message);
      return true;
    }, rule);
  }
  // The same two claims are fine when one of them is withdrawn. A withdrawn claim and a closed claim with no parts are valid too.
  const withdrawn = seed => ({...bare(of(seed, CAR_CLAIM), 'clm-0099', '2026-11-28T08:00:00-05:00'), state: 'withdrawn', withdrawn_at: dec(1)});
  plugin.validateSeed(f.ctx, edit(base, seed => { seed.claims.push(withdrawn(seed)); }));
  for (const valid of [gone, shut]) plugin.validateSeed(f.ctx, edit(base, seed => valid(seed, {})));
  // Two decisions of one line are in order when the second one is later, or at the same time.
  for (const at of [dec(4, '15:30:00'), dec(5)]) plugin.validateSeed(f.ctx, edit(base, seed => again(seed, at)));
  // A seed can hold history that the App itself would refuse to write: this claim is filed 48 days after its loss, and `claims.file` allows 30.
  plugin.validateSeed(f.ctx, edit(base, seed => { of(seed, CAR_CLAIM).filed_at = '2027-01-15T09:00:00-05:00'; }));
});

test('T18c [All] notifications: one for each applied event, and none for a write of the policyholder or for a change of time', () => {
  const f = start(), list = args => f.call('notifications.list', args).items.map(item => item.id);
  // The policyholder's own writes and a change of time write no notification.
  f.call('claims.update', {id: CAR_CLAIM, description: 'Rear-ended at a stop light.'});
  f.call('claims.add_evidence', {id: CAR_CLAIM, items: [photo('Rear bumper')]});
  f.advance(dec(2, '12:00:00'));
  assert.deepEqual(f.data.notifications, []);
  const events = [request(dec(2, '14:00:00'), 'req-0012', CAR_CLAIM, ['photos'], dec(12, '17:00:00')), estimate(dec(4, '10:00:00'), 'est-0031', CAR_CLAIM, THREE_LINES),
    determination(dec(4, '15:30:00'), 'det-0044', CAR_CLAIM, THREE_LINES), payment(dec(7), 'pay-0021', CAR_CLAIM, 'repair', 1500), completed(dec(8), CAR_CLAIM, 2000),
    decided(dec(9), 'dsp-0003', 'upheld'), offer(dec(10), 'off-0005', LOAN_CLAIM, 14200, PAYOFF), closed(dec(11), CAR_CLAIM, 'paid')];
  for (const e of events) f.event(e);
  f.call('offers.reject', {id: 'off-0005', reason: 'The offer is below the loan payoff.'});
  f.advance(dec(30));
  const written = f.data.notifications;
  assert.deepEqual(written.map(n => pick(n, 'id', 'kind', 'claim_id', 'event_id')), [
    ['ntf-0001', 'request.issued', CAR_CLAIM, 'ev-req-0012'], ['ntf-0002', 'estimate.submitted', CAR_CLAIM, 'ev-est-0031'],
    ['ntf-0003', 'determination.issued', CAR_CLAIM, 'ev-det-0044'], ['ntf-0004', 'payment.issued', CAR_CLAIM, 'ev-pay-0021'],
    ['ntf-0005', 'repair.completed', CAR_CLAIM, 'ev-done-' + CAR_CLAIM], ['ntf-0006', 'dispute.decided', HOME_CLAIM, 'ev-decided-dsp-0003'],
    ['ntf-0007', 'offer.issued', LOAN_CLAIM, 'ev-off-0005'], ['ntf-0008', 'claim.closed', CAR_CLAIM, 'ev-closed-' + CAR_CLAIM]]);
  assert.deepEqual(written.map(n => n.at), events.map(e => e.at));
  // `email_notices` is on: each notification has the full wire message for Mail, to the owner of the account as a `person_ref`.
  for (const n of written) {
    assert.ok(wireSchema(n.email), n.kind);
    assert.deepEqual([n.email.id, n.email.time, n.email.data.recipient, n.email.data.source_object.object_id, n.email.data.content.title, n.email.data.content.body.text],
      [n.id, n.at, {kind: 'person_ref', id: SEED.owner_person_id}, n.claim_id, n.title, n.text], n.kind);
  }
  assert.ok(!wireSchema({...written[0].email, type: 'org.pale.mail.other'}));
  // A notification is listed from the moment it is written. The list shows whether it has a wire message, and not the message.
  assert.deepEqual([list(), list({start: dec(9), end: dec(10)}), list({id: LOAN_CLAIM}), list({start: dec(12)})],
    [written.map(n => n.id), ['ntf-0006', 'ntf-0007'], ['ntf-0007'], []]);
  const {event_id, email, ...row} = written[6];
  assert.deepEqual(f.call('notifications.list', {id: LOAN_CLAIM}).items[0], {...row, emailed: true});
  // With `email_notices` off the notification has no wire message. A rejected event writes no notification.
  f.call('preferences.update', {email_notices: false});
  f.event(request(dec(30, '10:00:00'), 'req-0013', LOAN_CLAIM, ['title']));
  assert.deepEqual(pick(f.data.notifications[8], 'id', 'kind', 'email'), ['ntf-0009', 'request.issued', null]);
  unchanged(f, () => f.event(payment(dec(31), 'pay-0090', LOAN_CLAIM, 'repair', 10)), 'invalid_event');
  assert.equal(f.data.notifications.length, 9);
});

test('T18d [All] notifications: a supplement of 2 lines and 1,500.00 from Corner Auto Body is the example wire message of the plan', () => {
  const f = start(), example = JSON.parse(PLAN_WIRE);
  repair(f, 'supplement');
  const notice = f.data.notifications[f.data.notifications.length - 1];
  assert.deepEqual(pick(notice, 'kind', 'claim_id', 'at'), ['estimate.submitted', CAR_CLAIM, dec(9, '11:20:00')]);
  assert.equal(notice.title, 'A supplement of 2 repair lines was added to claim clm-0007');
  assert.equal(notice.title, example.data.content.title);
  assert.equal(notice.text, example.data.content.body.text);
  assert.match(notice.text, /^Corner Auto Body sent a supplement for claim clm-0007: 2 new repair lines, 1,500\.00 in total\. /);
  // The whole stored message is the example, except for the `id` and the `time` of this notification.
  assert.deepEqual({...notice.email, id: example.id, time: example.time}, example);
  assert.deepEqual([notice.email.id, notice.email.time], [notice.id, notice.at]);
  assert.ok(wireSchema(notice.email) && wireSchema(example));
});

test('T18e [All] activity rows: one for each committed write, each applied event and each effect, and none for a refused call. One notification for each applied event, and none for any of the 13 writes', () => {
  const f = start(), expected = [], applied = [], EFFECT = true;
  const rows = (actor, ref, list) => list.forEach(([action, object_id, effect = false]) => expected.push({seq: expected.length + 1, at: f.ctx.virtual_now,
    actor, action, object_id, request_id: actor === 'agent' ? ref : null, event_id: actor === 'event' ? ref : null, effect}));
  // Each step names the rows that it must write: its own row first, then one row for each effect.
  const write = (name, args, ...list) => {
    const request_id = 'rq-' + (expected.length + 1), out = f.call(name, {...args, request_id});
    rows('agent', request_id, list);
    return out;
  };
  const apply = (e, ...list) => { f.event(e); applied.push(e.event_id); rows('event', e.event_id, list); };

  write('claims.update', {id: CAR_CLAIM, description: 'Rear-ended at a stop light.'}, ['claims.update', CAR_CLAIM]);
  const evidence_ids = write('claims.add_evidence', {id: CAR_CLAIM, items: [photo('Rear bumper')]}, ['claims.add_evidence', CAR_CLAIM]).evidence_ids;
  apply(request(dec(2, '14:00:00'), 'req-0012', CAR_CLAIM, ['photos']), ['request.issued', 'req-0012']);
  write('requests.respond', {id: 'req-0012', answers: [{key: 'photos', text: 'One photo.', evidence_ids}]}, ['requests.respond', 'req-0012'], ['request.answered', 'req-0012', EFFECT]);
  write('estimates.submit', {id: CAR_CLAIM, kind: 'initial', shop_name: SHOP, lines: [{text: 'Rear bumper', amount: 900}]}, ['estimates.submit', 'est-p0001']);
  apply(determination(dec(4), 'det-0044', CAR_CLAIM, {'ln-p01': 'Not from this loss.'}), ['determination.issued', 'det-0044']);
  write('determinations.dispute', {id: 'ln-p01', claim_id: CAR_CLAIM, reason: 'The photo shows the damage.', evidence_ids}, ['determinations.dispute', 'dsp-0004']);
  apply(determination(dec(5), 'det-0045', CAR_CLAIM, {'ln-p01': 500}), ['determination.issued', 'det-0045'], ['dispute.void', 'dsp-0004', EFFECT]);
  write('determinations.dispute', {id: 'ln-p01', claim_id: CAR_CLAIM, reason: 'The bumper costs 900.'}, ['determinations.dispute', 'dsp-0005']);
  write('payee.set', {id: CAR_CLAIM, payee: TO_SHOP}, ['payee.set', CAR_CLAIM]);
  apply(payment(dec(6), 'pay-0021', CAR_CLAIM, 'repair', 100), ['payment.issued', 'pay-0021']);
  apply(completed(dec(7), CAR_CLAIM, 900), ['repair.completed', CAR_CLAIM]);
  write('rental.start', {id: CAR_CLAIM, start_at: dec(7), daily_rate: 45}, ['rental.start', 'rnt-0001']);
  apply(request(dec(8), 'req-0013', CAR_CLAIM, ['invoice']), ['request.issued', 'req-0013']);
  apply(closed(dec(9), CAR_CLAIM, 'paid'), ['claim.closed', CAR_CLAIM],
    ['request.void', 'req-0013', EFFECT], ['dispute.void', 'dsp-0005', EFFECT], ['rental.ended', 'rnt-0001', EFFECT]);

  write('rental.start', {id: LOAN_CLAIM, start_at: dec(8), daily_rate: 45}, ['rental.start', 'rnt-0002']);
  write('rental.end', {id: 'rnt-0002', end_at: dec(9)}, ['rental.end', 'rnt-0002']);
  apply(estimate(dec(10), 'est-0031', LOAN_CLAIM, {'ln-01': 4000}), ['estimate.submitted', 'est-0031']);
  apply(determination(dec(10, '12:00:00'), 'det-0046', LOAN_CLAIM, {'ln-01': 'The vehicle will not be repaired.'}), ['determination.issued', 'det-0046']);
  write('determinations.dispute', {id: 'ln-01', claim_id: LOAN_CLAIM, reason: 'The shop can repair it.'}, ['determinations.dispute', 'dsp-0006']);
  apply(offer(dec(11), 'off-0005', LOAN_CLAIM, 14200, PAYOFF), ['offer.issued', 'off-0005'], ['claim.total_loss', LOAN_CLAIM, EFFECT], ['dispute.void', 'dsp-0006', EFFECT]);
  write('offers.reject', {id: 'off-0005', reason: 'Below the loan payoff.'}, ['offers.reject', 'off-0005']);
  apply(offer(dec(12), 'off-0006', LOAN_CLAIM, 15000, PAYOFF), ['offer.issued', 'off-0006']);
  apply(offer(dec(13), 'off-0007', LOAN_CLAIM, 15900, PAYOFF), ['offer.issued', 'off-0007'], ['offer.superseded', 'off-0006', EFFECT]);
  write('offers.accept', {id: 'off-0007'}, ['offers.accept', 'off-0007']);
  apply(decided(dec(14), 'dsp-0003', 'upheld'), ['dispute.decided', 'dsp-0003']);

  // A new claim is withdrawn with an open request, an open offer and an active rental period.
  const id = write('claims.file', {...FILING, loss_at: dec(13, '08:00:00')}, ['claims.file', 'clm-0010']).id;
  write('rental.start', {id, start_at: dec(14), daily_rate: 30}, ['rental.start', 'rnt-0003']);
  apply(request(dec(15), 'req-0014', id, ['photos']), ['request.issued', 'req-0014']);
  apply(offer(dec(16), 'off-0008', id, 9000), ['offer.issued', 'off-0008'], ['claim.total_loss', id, EFFECT]);
  write('claims.withdraw', {id}, ['claims.withdraw', id],
    ['request.void', 'req-0014', EFFECT], ['offer.superseded', 'off-0008', EFFECT], ['rental.ended', 'rnt-0003', EFFECT]);
  write('preferences.update', {email_notices: false}, ['preferences.update', SEED.account_id]);
  // A refused write and a rejected event write no row.
  unchanged(f, () => f.call('offers.accept', {id: 'off-0005'}), 'invalid_state');
  unchanged(f, () => f.event(payment(dec(17), 'pay-0090', CAR_CLAIM, 'repair', 10)), 'invalid_event');

  assert.deepEqual(f.data.activity, expected);
  const actions = actor => [...new Set(expected.filter(row => row.actor === actor && !row.effect).map(row => row.action))].sort();
  assert.deepEqual(actions('agent'), [...WRITES].sort());
  assert.deepEqual(actions('event'), [...EVENTS].sort());
  assert.deepEqual([...new Set(expected.filter(row => row.effect).map(row => row.action))].sort(),
    ['claim.total_loss', 'dispute.void', 'offer.superseded', 'rental.ended', 'request.answered', 'request.void']);
  // The run made all 13 writes and all 8 events. There is one notification for each applied event, with its `event_id`, and no other one.
  assert.deepEqual(f.data.notifications.map(n => n.event_id), applied);
  // The history of the new claim has the same nine rows.
  const history = f.data.claims.find(claim => claim.id === id).history, about = expected.slice(-10, -1);
  assert.deepEqual(history, about.map(row => ({at: row.at, action: row.action, actor: row.actor, ref: row.request_id || row.event_id})));
});

test('T18f [All] the eight example events of the plan apply to the small seed in time order', () => {
  const f = start(), examples = PLAN_EVENTS.map(line => JSON.parse(line)), ordered = [...examples].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  assert.deepEqual(require('./proposal-events.json'), examples);
  assert.deepEqual(examples.map(e => e.operation), EVENTS.map(name => 'alderbrook.' + name));
  assert.deepEqual(ordered.map(e => e.event_id), ['ev-ab-101', 'ev-ab-110', 'ev-ab-111', 'ev-ab-140', 'ev-ab-130', 'ev-ab-150', 'ev-ab-160', 'ev-ab-120']);
  for (const e of ordered) f.event(e);
  const car = claimOf(f, CAR_CLAIM), home = claimOf(f, HOME_CLAIM), loan = claimOf(f, LOAN_CLAIM);
  assert.deepEqual(pick(car, 'state', 'outcome', 'closed_at', 'repair_completed_at', 'repair_reported_by', 'final_invoice_total'),
    ['closed', 'paid', dec(15, '10:00:00'), dec(13, '15:00:00'), SHOP, 3500]);
  assert.deepEqual([...pick(car.requests[0], 'id', 'due_at', 'state'), car.requests[0].asks.map(ask => ask.key)], ['req-0012', dec(12, '17:00:00'), 'void', ['photos', 'driver']]);
  assert.deepEqual(car.summary, repairSummary({approved_total: 2000, insurer_owes: 1500, paid: 1500, my_share: 500}));
  assert.deepEqual(pick(car.payments[0], 'id', 'payee', 'reference', 'issued_at'), ['pay-0021', {kind: 'policyholder', name: null}, 'EFT 88213', dec(7, '12:00:00')]);
  assert.deepEqual([loan.path, ...pick(loan.summary.settlement, 'offer_id', 'offer_state', 'net', 'to_lienholder', 'to_me', 'shortfall'), loan.flags],
    ['total_loss', 'off-0005', 'expired', 13700, 13700, 0, 1400, ['offer_expired', 'below_payoff']]);
  assert.deepEqual(pick(home.disputes[0], 'state', 'decided_at', 'decided_by', 'note'), ['changed', dec(20, '11:00:00'), 'Claims supervisor', 'Receipt accepted.']);
  assert.deepEqual([home.estimates[0].lines[1].standing.approved_amount, home.flags], [420, []]);
  assert.deepEqual(pick(home.summary, 'approved_total', 'insurer_owes', 'not_approved_total'), [1570, 1320, 0]);
  assert.deepEqual(f.data.notifications.map(n => [n.event_id, 'alderbrook.' + n.kind]), ordered.map(e => [e.event_id, e.operation]));
});

test('T18g [All] invalid events: each event check that the package adds to the plan\'s list is rejected with invalid_event, and the data does not change', () => {
  const f = start(), T = dec(20);
  // CAR_CLAIM has three pending lines and a completed repair. Its vehicle has no lienholder, and the vehicle of LOAN_CLAIM has one.
  // HOME_CLAIM has the open dispute dsp-0003.
  f.event(estimate(dec(3), 'est-0031', CAR_CLAIM, THREE_LINES));
  f.event(completed(dec(5), CAR_CLAIM, 2000));
  const decide = (...lines) => event('determination.issued', T, {determination_id: 'det-0090', claim_id: CAR_CLAIM, issued_by: ADJUSTER, lines}, 'det-0090');
  const approved = {line_id: 'ln-01', status: 'approved', amount: 900};
  const VALUE = 'A valuation is above zero, and a payoff is not below zero', PAYOFF_FITS = 'An offer has a payoff only when the vehicle has a lienholder';
  const LINES = 'A determination names each of its lines once, and at least one line', CHANGED = 'A changed decision gives the new decision of the line';
  // The list of the README, "Plan and implementation": [the case, the event, a part of the message of the rule that rejects it].
  const cases = [
    ['a second repair.completed on one claim', {...completed(T, CAR_CLAIM, 2100), event_id: 'ev-done-again'}, 'The repair is already reported complete'],
    ['an offer with a valuation of zero', offer(T, 'off-0090', LOAN_CLAIM, 0, PAYOFF), VALUE],
    ['an offer with a valuation below zero', offer(T, 'off-0090', LOAN_CLAIM, -100, PAYOFF), VALUE],
    ['an offer with a payoff below zero', offer(T, 'off-0090', LOAN_CLAIM, 15900, {lienholder_payoff: -1}), VALUE],
    ['an offer with a payoff on a vehicle with no lienholder', offer(T, 'off-0090', CAR_CLAIM, 9000, PAYOFF), PAYOFF_FITS],
    ['an offer with no payoff on a vehicle with a lienholder', offer(T, 'off-0090', LOAN_CLAIM, 15900), PAYOFF_FITS],
    ['an estimate line with an amount of zero', estimate(T, 'est-0090', CAR_CLAIM, {'ln-09': 0}), 'A line amount is zero or less'],
    ['an estimate line with an amount below zero', estimate(T, 'est-0090', CAR_CLAIM, {'ln-09': -5}), 'A line amount is zero or less'],
    ['a determination that names no line', decide(), LINES],
    ['a determination that names one line twice', decide(approved, {...approved, amount: 800}), LINES],
    ['a dispute.decided that is changed with no line decision', decided(T, 'dsp-0003', 'changed'), CHANGED],
    ['a dispute.decided that is upheld with a line decision', decided(T, 'dsp-0003', 'upheld', {status: 'approved', amount: 420}), CHANGED],
    ['a payment to a shop with no name', payment(T, 'pay-0090', CAR_CLAIM, 'repair', 100, {kind: 'shop'}), 'A payment goes to the policyholder, a named shop or the lienholder'],
    ['a request with two asks with one key', request(T, 'req-0090', CAR_CLAIM, ['photos', 'photos']), 'An information request has two asks with one key']
  ];
  // A line decision comes from a determination or from a changed dispute. The same five shapes are refused in both.
  const decisions = [['approved with no amount', {status: 'approved'}], ['approved with an amount of zero', {status: 'approved', amount: 0}],
    ['approved with an amount below zero', {status: 'approved', amount: -5}], ['denied with no reason', {status: 'denied'}],
    ['denied with an amount', {status: 'denied', reason: 'Old damage.', amount: 100}]];
  for (const [label, decision] of decisions) {
    cases.push(['a determination with a line decision that is ' + label, decide({line_id: 'ln-01', ...decision}), 'An approved line needs an amount above zero']);
    cases.push(['a changed dispute with a line decision that is ' + label, decided(T, 'dsp-0003', 'changed', decision), 'An approved line needs an amount above zero']);
  }
  assert.equal(cases.length, 24);
  for (const [label, e, text] of cases) unchanged(f, () => f.event(e), 'invalid_event', label, text);
  // The same events with the one fault removed are applied.
  for (const e of [decide(approved), decided(T, 'dsp-0003', 'changed', {status: 'approved', amount: 420}), offer(T, 'off-0090', LOAN_CLAIM, 15900, PAYOFF)]) f.event(e);
});

test('T18h [All] closure: claim.closed gives the outcome paid, denied or no_response and ends what is open on the claim', () => {
  const f = start({now: dec(3)}), outcomes = [[HOME_CLAIM, 'denied'], [CAR_CLAIM, 'paid'], [LOAN_CLAIM, 'no_response']];
  // CAR_CLAIM has an open request and an active rental period. HOME_CLAIM has the open dispute dsp-0003. LOAN_CLAIM has an open offer.
  f.event(request(dec(3, '10:00:00'), 'req-0012', CAR_CLAIM, ['photos']));
  f.call('rental.start', {id: CAR_CLAIM, start_at: dec(3), daily_rate: 45});
  f.event(offer(dec(4), 'off-0005', LOAN_CLAIM, 14200, PAYOFF));
  outcomes.forEach(([claim, outcome], index) => f.event(closed(dec(8 + index), claim, outcome)));
  assert.deepEqual(f.call('claims.list', {state: 'closed'}).items.map(row => pick(row, 'id', 'state', 'outcome')),
    outcomes.map(([claim, outcome]) => [claim, 'closed', outcome]));
  assert.deepEqual(outcomes.map(([claim]) => claimOf(f, claim).closed_at), [dec(8), dec(9), dec(10)]);
  const car = claimOf(f, CAR_CLAIM);
  assert.deepEqual([car.requests[0].state, ...pick(car.rentals[0], 'state', 'end_at', 'ended_by')], ['void', 'ended', dec(9), 'claim_closed']);
  assert.deepEqual([claimOf(f, HOME_CLAIM).disputes[0].state, claimOf(f, LOAN_CLAIM).offers[0].state], ['void', 'superseded']);
  // A closed claim takes no write.
  unchanged(f, () => f.call('claims.update', {id: CAR_CLAIM, description: 'New text.'}), 'invalid_state');
  unchanged(f, () => f.call('claims.withdraw', {id: CAR_CLAIM}), 'invalid_state');
});

test('T18i [All] IDs: a new claim ID and a new notification ID never collide with an ID of another kind', () => {
  const f = start(), ids = () => f.data.notifications.map(n => n.id);
  // The insurer names its estimate clm-0010, which is the next claim number.
  f.event(estimate(dec(3), 'clm-0010', CAR_CLAIM, {'ln-01': 100}));
  const filed = f.call('claims.file', FILING).id;
  assert.deepEqual([filed, f.call('estimates.get', {id: 'clm-0010'}).estimate.claim_id, claimOf(f, filed).state], ['clm-0011', CAR_CLAIM, 'open']);
  // The insurer names its payment ntf-0002, which is the next notification number. The notification of that event is ntf-0003.
  assert.deepEqual(ids(), ['ntf-0001']);
  f.event(payment(dec(4), 'ntf-0002', CAR_CLAIM, 'repair', 50));
  const notice = f.data.notifications[1];
  assert.deepEqual([ids(), notice.kind, notice.email.id, f.call('payments.list').items.map(p => p.id)], [['ntf-0001', 'ntf-0003'], 'payment.issued', 'ntf-0003', ['ntf-0002']]);
  f.event(payment(dec(5), 'pay-0021', CAR_CLAIM, 'repair', 50));
  assert.deepEqual([ids(), f.call('claims.file', {...FILING, subject_id: LOAN_CAR}).id], [['ntf-0001', 'ntf-0003', 'ntf-0004'], 'clm-0012']);
});

test('T18j [All] notification text: an estimate with no shop name says who sent it, and a long text is cut to the limits of the schema', () => {
  const f = start(), unnamed = (source, n) => edit(estimate(dec(3), 'est-003' + n, CAR_CLAIM, {['ln-0' + n]: 100}, {source}), e => { delete e.payload.shop_name; });
  ['shop', 'adjuster'].forEach((source, index) => f.event(unnamed(source, index + 1)));
  assert.deepEqual(f.data.notifications.map(n => n.text.split(' for claim ')[0]), ['The shop sent an estimate', 'The adjuster sent an estimate']);
  assert.deepEqual(f.data.claims.find(claim => claim.id === CAR_CLAIM).estimates.map(e => [e.source, e.shop_name]), [['shop', null], ['adjuster', null]]);

  // The longest insurer name and 6,000 characters of asks. A title holds 200 characters and a text 4,000.
  const name = 'Alderbrook Mutual ' + 'x'.repeat(182), g = start({seed: edit(SEED, seed => { seed.insurer.name = name; })});
  const long = edit(request(dec(3), 'req-0012', CAR_CLAIM, ['photos', 'driver', 'statement']), e => { for (const ask of e.payload.asks) ask.text = 'y'.repeat(2000); });
  g.event(long);
  g.event(closed(dec(4), CAR_CLAIM, 'paid'));
  const [asked, shut] = g.data.notifications, title = name + ' asks for information on claim ' + CAR_CLAIM;
  assert.deepEqual([name.length, title.length > 200, asked.title, asked.text.length], [200, true, title.slice(0, 200), 4000]);
  assert.ok(asked.text.startsWith(ADJUSTER + ' asks for 3 answers on claim ' + CAR_CLAIM + ': yyy') && shut.text.startsWith(name + ' closed claim ' + CAR_CLAIM));
  // The wire message carries the same cut title and text, and the list shows them.
  assert.deepEqual([asked.email.data.content.title, asked.email.data.content.body.text, wireSchema(asked.email)], [asked.title, asked.text, true]);
  assert.deepEqual(g.call('notifications.list').items.map(item => [item.title, item.text]), [[asked.title, asked.text], [shut.title, shut.text]]);
});

test('T18k [All] seed history: a claim with an active rental period that starts after the clock can be withdrawn or closed, and the period ends at its own start', () => {
  // The seed rules do not compare a stored time with the clock. This period starts on 10 December, and the clock stands at 2 December.
  const later = dec(10), period = {id: 'rnt-0001', start_at: later, daily_rate: 45, state: 'active', end_at: null, ended_by: null};
  const seed = edit(SEED, s => { s.claims.find(claim => claim.id === LOAN_CLAIM).rentals.push(period); }), none = {rental_days: 0, covered_days: 0, uncovered_days: 0, my_cost: 0};
  const f = start({seed}), g = start({seed});
  assert.deepEqual(claimOf(f, LOAN_CLAIM).rentals, [{...period, ...none}]);
  f.call('claims.withdraw', {id: LOAN_CLAIM});
  g.event(closed(dec(3), LOAN_CLAIM, 'denied'));
  for (const [h, state, ended_by, stops] of [[f, 'withdrawn', 'claim_withdrawn', '2026-12-02'], [g, 'closed', 'claim_closed', '2026-12-03']]) {
    // The period has no rental day, also when the clock has passed its start.
    for (const now of [h.ctx.virtual_now, dec(20)]) {
      h.advance(now);
      const claim = claimOf(h, LOAN_CLAIM);
      assert.deepEqual([claim.state, claim.rental_stops_on, claim.flags, claim.rentals], [state, stops, [], [{...period, state: 'ended', end_at: later, ended_by, ...none}]], state + ' at ' + now);
    }
  }
});

test('T18l [All] seed history: in a seed that is loaded before its own offer times, an offer stored as open reads expired when its claim has a later offer or is not open, and offers.accept on it returns too_late', () => {
  const stored = (id, issued_at, respond_by, more = {}) => ({id, issued_at, valuation: 14200, lienholder_payoff: 15100, respond_by, issued_by: ADJUSTER, basis: null,
    state: 'open', answered_at: null, reason: null, evidence_ids: [], ...more});
  const loaded = (offers, more = {}) => start({seed: edit(SEED, seed => { Object.assign(seed.claims.find(claim => claim.id === LOAN_CLAIM), {path: 'total_loss', offers, ...more}); })});
  const read = f => { const claim = claimOf(f, LOAN_CLAIM); return [claim.offers.map(o => o.state), ...pick(claim.summary.settlement, 'offer_id', 'offer_state'), claim.flags]; };
  // off-a is from 5 December, to answer by 10 December. off-b is from 12 December. Both are stored as open, and the clock stands at 2 December.
  const A = stored('off-a', dec(5), dec(10)), B = stored('off-b', dec(12), dec(20)), f = loaded([A, B]);
  assert.deepEqual([f.ctx.virtual_now, f.data.claims.find(claim => claim.id === LOAN_CLAIM).offers.map(o => o.state)], [NOW, ['open', 'open']]);
  assert.deepEqual(read(f), [['expired', 'open'], 'off-b', 'open', ['below_payoff']]);
  unchanged(f, () => f.call('offers.accept', {id: 'off-a'}), 'too_late');
  unchanged(f, () => f.call('offers.reject', {id: 'off-a', reason: 'Too low.'}), 'too_late');
  // The later offer can be answered, and the data still passes the seed schema and the seed rules.
  assert.equal(f.call('offers.accept', {id: 'off-b'}).id, 'off-b');
  assert.ok(seedSchema(f.data));
  plugin.validateSeed(f.ctx, f.data);
  assert.deepEqual(read(f), [['expired', 'accepted'], 'off-b', 'accepted', ['below_payoff']]);
  // A seed that stores the later offer as accepted reads the earlier one as expired too.
  const g = loaded([A, {...B, state: 'accepted', answered_at: dec(13)}]);
  assert.deepEqual(read(g), [['expired', 'accepted'], 'off-b', 'accepted', ['below_payoff']]);
  unchanged(g, () => g.call('offers.accept', {id: 'off-a'}), 'too_late');
  // A claim that is withdrawn on 11 December, after the respond_by of its open offer. `invalid_state` comes before `too_late`.
  const h = loaded([A], {state: 'withdrawn', withdrawn_at: dec(11)});
  assert.deepEqual(read(h), [['expired'], 'off-a', 'expired', ['offer_expired', 'below_payoff']]);
  unchanged(h, () => h.call('offers.accept', {id: 'off-a'}), 'invalid_state');
});

test('T18m [All] IDs: a new ID has the number after the highest one in use with that form, also when a lower number is free or when another kind of object has that number', () => {
  const f = start(), ids = part => f.data.claims.flatMap(claim => claim[part].map(item => item.id));
  // The small seed uses clm-0007 to clm-0009, evd-0003, evd-0004 and dsp-0003. The lower numbers are free, and no new ID takes one.
  assert.deepEqual([f.data.claims.map(claim => claim.id), ids('evidence'), ids('disputes')], [[CAR_CLAIM, HOME_CLAIM, LOAN_CLAIM], ['evd-0003', 'evd-0004'], ['dsp-0003']]);
  const filed = f.call('claims.file', FILING).id;
  assert.deepEqual([filed, f.call('claims.add_evidence', {id: filed, items: [photo('Front'), photo('Rear')]}).evidence_ids], ['clm-0010', ['evd-0005', 'evd-0006']]);
  // An ID that an event gives counts when it has a form of the App. The insurer names an estimate est-p0007 with the line ln-p05, a payment rnt-0004 and a request clm-0020.
  f.event(estimate(dec(3), 'est-p0007', filed, {'ln-p05': 100}));
  f.event(determination(dec(3, '12:00:00'), 'det-0044', filed, {'ln-p05': 'Old damage.'}));
  f.event(payment(dec(4), 'rnt-0004', filed, 'rental', 50));
  f.event(request(dec(4, '12:00:00'), 'clm-0020', filed, ['photos']));
  const submitted = f.call('estimates.submit', {id: filed, kind: 'supplement', shop_name: SHOP, lines: [{text: 'Clip', amount: 5}, {text: 'Seal', amount: 7}]}).id;
  assert.deepEqual([submitted, f.call('estimates.get', {id: submitted}).estimate.lines.map(line => line.id)], ['est-p0008', ['ln-p06', 'ln-p07']]);
  assert.equal(f.call('rental.start', {id: filed, start_at: dec(4), daily_rate: 40}).id, 'rnt-0005');
  // dsp-0003 is on another claim: the number runs across the account. A line number runs inside its claim, so another claim starts at ln-p01.
  assert.equal(f.call('determinations.dispute', {id: 'ln-p05', claim_id: filed, reason: REASON}).id, 'dsp-0004');
  const other = f.call('estimates.submit', {id: CAR_CLAIM, kind: 'initial', shop_name: SHOP, lines: [{text: 'Door', amount: 800}]}).id;
  assert.deepEqual([other, f.call('estimates.get', {id: other}).estimate.lines.map(line => line.id)], ['est-p0009', ['ln-p01']]);
  // The next claim follows the request clm-0020, and clm-0011 to clm-0019 stay free. Each of the four events wrote one notification.
  assert.deepEqual([f.call('claims.file', {...FILING, subject_id: LOAN_CAR}).id, f.data.notifications.map(n => n.id)], ['clm-0021', ['ntf-0001', 'ntf-0002', 'ntf-0003', 'ntf-0004']]);
});

test('T18n [All] lists: a line takes a 51st decision, because no stored list that calls can grow has an upper bound, and one call is limited by its input schema', () => {
  const f = start({now: dec(3)}), minute = n => dec(3, '09:' + String(n).padStart(2, '0') + ':00');
  // Fifty-one determinations on one line. Each one approves it for one more.
  f.event(estimate(minute(0), 'est-0031', CAR_CLAIM, {'ln-01': 900}));
  for (let n = 1; n <= 51; n++) f.event(determination(minute(n), 'det-' + (1000 + n), CAR_CLAIM, {'ln-01': n}));
  const line = lineOf(f, CAR_CLAIM, 'ln-01');
  assert.deepEqual([line.decisions.length, line.standing.approved_amount, line.standing.decided_at, claimOf(f, CAR_CLAIM).determinations.length], [51, 51, minute(51), 51]);
  // In the seed schema no list of a claim has `maxItems`, and neither have the decisions of a line, the claims, the notifications and the activity rows.
  const schema = require('../schemas/seed.schema.json').properties, claim = schema.claims.items.properties;
  const lists = {...claim, decisions: claim.estimates.items.properties.lines.items.properties.decisions, claims: schema.claims, notifications: schema.notifications, activity: schema.activity};
  for (const name of ['evidence', 'requests', 'estimates', 'determinations', 'disputes', 'offers', 'rentals', 'payments', 'history', 'decisions', 'claims', 'notifications', 'activity']) {
    assert.deepEqual([lists[name].type, 'maxItems' in lists[name]], ['array', false], name);
  }
  // One call is limited by its input schema: it takes 20 evidence items or 60 estimate lines, and one more breaks the schema.
  const items = n => Array.from({length: n}, (_, i) => photo('Photo ' + (i + 1))), lines = n => Array.from({length: n}, (_, i) => ({text: 'Line ' + (i + 1), amount: 1}));
  const add = n => f.call('claims.add_evidence', {id: CAR_CLAIM, items: items(n)}), submit = n => f.call('estimates.submit', {id: CAR_CLAIM, kind: 'supplement', shop_name: SHOP, lines: lines(n)});
  unchanged(f, () => add(21), SCHEMA);
  unchanged(f, () => submit(61), SCHEMA);
  // Two calls of 20 make a list of 40.
  add(20);
  assert.deepEqual([add(20).evidence_ids.length, f.call('estimates.get', {id: submit(60).id}).estimate.lines.length, claimOf(f, CAR_CLAIM).evidence.length], [20, 60, 40]);
});

test('T19 [All] Core contracts: tests/mcp.integration.cjs passes on the real runtime (replay, idempotency_conflict, stale_version, permission_denied, reset)',
  ...withRuntime('tests/mcp.integration.cjs'));

test('T19b [All] Mail delivery: tests/mail.integration.cjs passes on the real runtime', ...withRuntime('tests/mail.integration.cjs'));

test('T19c [All] Mail sender: a notification is delivered once, under its ID in the first lifecycle and as <id>.e<epoch> after a reset', async () => {
  const f = start(), g = start();
  f.event(request(dec(2, '14:00:00'), 'req-0012', CAR_CLAIM, ['photos']));
  const w = senderWorld(lifecycle(2, SEED, f.data)), sender = w.sender(), [first] = f.data.notifications;
  assert.deepEqual(await sender.publishPending(), {epoch: 2, firstEpoch: 2, lifecycle: 'first', results: [delivered('ntf-0001', 'ntf-0001', 1)], stopped: false});
  assert.deepEqual(w.published, [{request_id: 'ntf-0001', message: first.email}]);
  // A delivery is final. A later call sends only what is new.
  assert.deepEqual((await sender.publishPending()).results, []);
  f.event(estimate(dec(4), 'est-0031', CAR_CLAIM, THREE_LINES));
  w.snapshot = lifecycle(2, SEED, f.data);
  assert.deepEqual((await sender.publishPending()).results, [delivered('ntf-0002', 'ntf-0002', 2)]);
  // After `env.reset` the App has a new epoch, and its next notification is ntf-0001 again, with other content.
  g.event(payment(dec(3), 'pay-0021', CAR_CLAIM, 'rental', 80));
  w.snapshot = lifecycle(3, SEED, g.data);
  const [renewed] = g.data.notifications, identity = 'ntf-0001.e3';
  assert.deepEqual(await sender.publishPending(), {epoch: 3, firstEpoch: 2, lifecycle: 'later', results: [delivered('ntf-0001', identity, 3)], stopped: false});
  assert.deepEqual(w.published[2], {request_id: identity, message: {...renewed.email, id: identity}});
  assert.ok(wireSchema(w.published[2].message) && renewed.email.id === 'ntf-0001' && renewed.title !== first.title);
  assert.deepEqual([(await sender.publishPending()).results, w.published.length], [[], 3]);
  // The sender read Alderbrook once for each call, and it did nothing else there.
  assert.deepEqual(w.reads, Array(5).fill('env.snapshot'));
});

test('T19d [All] Mail sender: what the loaded seed held is never sent, and a notification with no wire message is skipped', async () => {
  // The first seed of the run holds ntf-0001 as history, with a wire message. ntf-0002 is written while email_notices is off.
  const old = start();
  old.event(request(dec(2, '14:00:00'), 'req-0012', CAR_CLAIM, ['photos']));
  const f = fixture({seed: old.data, now: dec(3)});
  f.call('preferences.update', {email_notices: false});
  f.event(estimate(dec(4), 'est-0031', CAR_CLAIM, THREE_LINES));
  f.call('preferences.update', {email_notices: true});
  f.event(payment(dec(5), 'pay-0021', CAR_CLAIM, 'rental', 80));
  assert.deepEqual(f.data.notifications.map(n => [n.id, n.email !== null]), [['ntf-0001', true], ['ntf-0002', false], ['ntf-0003', true]]);
  const w = senderWorld(lifecycle(2, old.data, f.data)), sender = w.sender(), sent = async () => (await sender.publishPending()).results.map(row => row.request_id);
  assert.deepEqual(await sent(), ['ntf-0003']);
  // The history is read from each snapshot. A second seed in the run holds ntf-0001 to ntf-0003, so only ntf-0004 is new.
  const g = fixture({seed: f.data, now: dec(6)});
  g.event(closed(dec(7), CAR_CLAIM, 'paid'));
  w.snapshot = lifecycle(3, f.data, g.data);
  assert.deepEqual(await sent(), ['ntf-0004.e3']);
  // A third seed holds no notification. Its first one is ntf-0001, which was history in the first seed, and it is sent.
  const h = start();
  h.event(request(dec(2, '14:00:00'), 'req-0012', CAR_CLAIM, ['photos']));
  w.snapshot = lifecycle(4, SEED, h.data);
  assert.deepEqual(await sent(), ['ntf-0001.e4']);
});

test('T19e [All] Mail sender: a refusal for lack of a route is final, and the sender goes on to the next notification', async () => {
  const f = start();
  f.event(request(dec(2, '14:00:00'), 'req-0012', CAR_CLAIM, ['photos']));
  f.event(estimate(dec(4), 'est-0031', CAR_CLAIM, THREE_LINES));
  for (const code of ['recipient_not_authorized', 'recipient_unavailable', 'ambiguous_recipient', 'unsupported_recipient']) {
    const w = senderWorld(lifecycle(2, SEED, f.data), [{status: 'rejected', code}]), sender = w.sender(), out = await sender.publishPending();
    assert.deepEqual([out.stopped, out.results], [false, [undelivered('ntf-0001', {status: 'rejected', code}), delivered('ntf-0002', 'ntf-0002', 1)]], code);
    // The refused notification is not tried again.
    assert.deepEqual([(await sender.publishPending()).results, w.published.map(p => p.request_id)], [[], ['ntf-0001', 'ntf-0002']], code);
  }
});

test('T19f [All] Mail sender: every other answer stops the sender, nothing more is published, and the next call tries that notification again', async () => {
  const f = start();
  f.event(request(dec(2, '14:00:00'), 'req-0012', CAR_CLAIM, ['photos']));
  f.event(estimate(dec(4), 'est-0031', CAR_CLAIM, THREE_LINES));
  // [the answer of the router, or the error that it throws, and what the sender reports for it]
  const answers = [
    ['idempotency_conflict', {status: 'rejected', code: 'idempotency_conflict'}],
    ['an identity that the router refuses', {status: 'rejected', code: 'source_identity_mismatch'}],
    ['a contract that the router refuses', {status: 'rejected', code: 'incompatible_contract'}],
    ['an unexpected status', {status: 'permission_denied', code: 'operation_unavailable'}],
    ['a refusal with stop_run', {status: 'rejected', code: 'receiver_rejected', stop_run: true}],
    ['a refusal for lack of a route with stop_run', {status: 'rejected', code: 'recipient_unavailable', stop_run: true}],
    ['unknown', {status: 'unknown', code: 'receiver_unconfirmed', stop_run: true}],
    ['halted', {status: 'halted', code: 'run_halted'}],
    ['a router that throws', new Error('The router does not answer.'), {status: 'unknown', code: 'router_unreachable'}],
    ['a router that returns no receipt', 'no receipt', {status: 'unknown', code: 'router_unreachable'}]
  ];
  for (const [label, answer, shown = answer] of answers) {
    const w = senderWorld(lifecycle(2, SEED, f.data), [answer]), sender = w.sender(), out = await sender.publishPending();
    assert.deepEqual([out.stopped, out.results], [true, [undelivered('ntf-0001', shown)]], label);
    assert.equal(w.published.length, 1, label);
    const again = await sender.publishPending();
    assert.deepEqual([again.stopped, again.results, w.published.map(p => p.request_id)],
      [false, [delivered('ntf-0001', 'ntf-0001', 1), delivered('ntf-0002', 'ntf-0002', 2)], ['ntf-0001', 'ntf-0001', 'ntf-0002']], label);
  }
});

test('T19g [All] Mail sender: it throws when it cannot read Alderbrook, and it publishes nothing', async () => {
  const w = senderWorld(null);
  await assert.rejects(w.sender().publishPending(), /env\.snapshot returned permission_denied/);
  assert.deepEqual([w.reads, w.published], [['env.snapshot'], []]);
});

test('T19h [All] Mail sender: after a reset a second sender publishes as <id>.e<epoch> only when it gets the first epoch, so Infra keeps one sender for the run', async () => {
  const f = start(), g = start();
  f.event(request(dec(2, '14:00:00'), 'req-0012', CAR_CLAIM, ['photos']));
  g.event(payment(dec(3), 'pay-0021', CAR_CLAIM, 'rental', 80));
  const w = senderWorld(lifecycle(2, SEED, f.data)), first = await w.sender().publishPending();
  const read = out => [out.firstEpoch, out.lifecycle, out.stopped, out.results.map(row => [row.request_id, row.status, row.code])];
  assert.deepEqual(read(first), [2, 'first', false, [['ntf-0001', 'committed', null]]]);
  // `env.reset`: the epoch is 3, and the new notification is ntf-0001 again, with other content.
  w.snapshot = lifecycle(3, SEED, g.data);
  // A new sender that does not know the first epoch takes epoch 3 for the first lifecycle and reuses the plain ID.
  // The router knows that identity with other content, so the sender stops and the notice is not delivered.
  assert.deepEqual(read(await w.sender().publishPending()), [3, 'first', true, [['ntf-0001', 'rejected', 'idempotency_conflict']]]);
  // A new sender that gets the first epoch publishes the notice under the qualified identity.
  assert.deepEqual(read(await w.sender(first.firstEpoch).publishPending()), [2, 'later', false, [['ntf-0001.e3', 'committed', null]]]);
  assert.deepEqual(w.published[2], {request_id: 'ntf-0001.e3', message: {...g.data.notifications[0].email, id: 'ntf-0001.e3'}});
});

// The evaluation dataset in data/evaluation/. The real MCP load of every seed is tests/evaluation.integration.cjs.
const EVALUATION = path.join(ROOT, 'data/evaluation');
const evaluation = () => JSON.parse(fs.readFileSync(path.join(EVALUATION, 'manifest.json'), 'utf8'));
const readEvaluation = file => JSON.parse(fs.readFileSync(path.join(EVALUATION, file), 'utf8'));
const records = require('../dev/evaluation-records.cjs');
const devScript = (...args) => spawnSync(process.execPath, args, {cwd: ROOT, encoding: 'utf8', timeout: 60000});

test('DATA01 [All] Evaluation data: every account seed passes the seed schema and the App seed rules with its own binding and clock, is synthetic, and matches its hash in manifest.json', () => {
  const manifest = evaluation();
  assert.equal(manifest.provenance, 'synthetic');
  assert.ok(manifest.accounts.length >= 30);
  for (const entry of manifest.accounts) {
    const text = fs.readFileSync(path.join(EVALUATION, entry.seed), 'utf8'), seed = JSON.parse(text), binding = readEvaluation(entry.binding);
    assert.equal(entry.provenance, 'synthetic', entry.account_id);
    assert.equal(crypto.createHash('sha256').update(text).digest('hex'), entry.seed_sha256, entry.seed);
    assert.ok(seedSchema(seed), entry.seed);
    const f = fixture({seed, now: entry.virtual_now, binding, logging: false});
    assert.equal(f.call('claims.list').items.length, seed.claims.length, entry.account_id);
    // No timestamp of the seed is at or after its clock, except deadlines and policy term ends. Every evidence item is dated at or before it was added.
    assert.deepEqual(records.after(seed, entry.virtual_now), [], entry.account_id);
    for (const claim of seed.claims) for (const item of claim.evidence) assert.ok(Date.parse(item.dated) <= Date.parse(item.added_at), item.id);
    // Every account has activity inside the window.
    const inside = records.lifecycle(seed.account_id, seed.claims).filter(row => row.day >= records.WINDOW.start && row.day <= records.WINDOW.end);
    assert.ok(inside.length > 0, entry.account_id + ' has no activity in the window');
  }
});

test('DATA02 [All] Evaluation data: the generator with its fixed seed gives the committed files byte for byte (--check)', () => {
  const result = devScript('dev/generate-evaluation-data.cjs', '--check');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Checked \d+ files in data\/evaluation/);
});

test('DATA03 [All] Evaluation data: the coverage report is up to date with the seeds (--check), and the cross-record checks pass on every seed', () => {
  const coverage = devScript('dev/coverage.cjs', '--check');
  assert.equal(coverage.status, 0, coverage.stderr);
  const report = readEvaluation('coverage.json');
  assert.deepEqual([report.time_zone, report.window, report.hash_errors, report.provenance.real], ['America/New_York', {start: '2025-01-01', end: '2026-12-31'}, [], 0]);
  assert.ok(report.authoritative_fields.every(f => !/term/.test(f.field)), 'Policy terms are not counted');
  const consistency = devScript('dev/check-fixture.cjs', '--evaluation');
  assert.equal(consistency.status, 0, consistency.stdout);
  assert.match(consistency.stdout, /(\d+) of \1 evaluation seeds pass all 4 checks, and \d+ claims have 0 problems with the \d+ story rules\./);
});

test('DATA04 [All] Evaluation data: a seed selected as of a time holds only the steps before it, each record in its state then, and at the seed clock it is the delivered seed', () => {
  const {select} = require('../dev/select-evaluation-seed.cjs');
  const entry = evaluation().accounts.find(a => a.claims >= 3), delivered = readEvaluation(entry.seed);
  assert.equal(JSON.stringify(select(entry.account_id, entry.virtual_now).data), JSON.stringify(delivered));
  const claim = delivered.claims[1], asOf = new Date(Date.parse(claim.filed_at) + 60000).toISOString();
  const early = select(entry.account_id, asOf).data;
  // Every timestamp of a selected seed is before the as-of time, except deadlines and policy term ends, for every account every 90 days.
  assert.deepEqual(records.after(early, asOf), []);
  for (const account of evaluation().accounts) {
    for (let t = Date.parse('2025-01-01T12:00:00Z'); t < Date.parse(entry.virtual_now); t += 90 * 86400000) assert.deepEqual(records.after(select(account.account_id, new Date(t).toISOString()).data, new Date(t).toISOString()), []);
  }
  // The check finds a planted evidence date after the as-of time.
  const planted = structuredClone(early);
  planted.claims[0].evidence[0].dated = new Date(Date.parse(asOf) + 3600000).toISOString();
  assert.deepEqual(records.after(planted, asOf).map(s => s.path), ['.claims[0].evidence[0].dated']);
  assert.deepEqual(early.claims.map(c => c.id), delivered.claims.slice(0, 2).map(c => c.id));
  assert.ok(early.policies.every(p => Date.parse(p.term.start) <= Date.parse(asOf)));
  // The second claim was just filed: it is open, with no decision and no payment yet.
  assert.deepEqual([early.claims[1].state, early.claims[1].determinations.length, early.claims[1].payments.length], ['open', 0, 0]);
  fixture({seed: early, now: asOf, binding: readEvaluation(entry.binding), logging: false});
});

test('DATA05 [All] Evaluation data: the story rules find a claim that does not hold together', () => {
  const {problems} = require('../dev/check-evaluation.cjs'), entries = evaluation().accounts.map(entry => ({seed: readEvaluation(entry.seed), scenarios: entry.claim_scenarios}));
  assert.deepEqual(problems(entries), []);
  const find = test => { for (const entry of entries) for (const claim of entry.seed.claims) if (test(claim)) return {entry, claim}; return assert.fail('No claim for the test'); };
  const broken = (test, change) => {
    const copy = structuredClone(entries), {entry, claim} = find(test), seed = copy[entries.indexOf(entry)].seed, target = seed.claims.find(c => c.id === claim.id);
    change(target, seed);
    return [...new Set(problems(copy).map(row => row.rule))];
  };
  // An invoice below the approved total, a dispute that answers another decision, an overnight loss at noon, and a line from another scenario.
  assert.deepEqual(broken(c => c.repair_completed_at, c => { c.final_invoice_total = 1; }), ['invoice']);
  assert.deepEqual(broken(c => c.disputes.length, c => { c.disputes[0].reason = 'The shop needed this time.'; }), ['disputes']);
  assert.deepEqual(broken(c => /overnight/.test(c.description), c => { c.loss_at = c.loss_at.slice(0, 11) + '12:00:00' + c.loss_at.slice(19); }), ['loss time']);
  assert.deepEqual(broken(c => c.estimates.length && c.estimates[0].source === 'shop' && c.coverage === 'comprehensive', c => { c.estimates[0].lines[0].text = 'A/C condenser: replace'; }), ['lines']);
  // Evidence dated after it was added, and a receipt for a cleaning line.
  assert.deepEqual(broken(c => c.evidence.length, c => { c.evidence[0].dated = c.evidence[0].added_at.slice(0, 11) + '23:59:00' + c.evidence[0].added_at.slice(19); }), ['evidence times']);
  assert.ok(broken(c => c.estimates.some(e => e.lines.some(l => /clean/.test(l.text))), c => {
    const line = c.estimates.flatMap(e => e.lines).find(l => /clean/.test(l.text));
    c.evidence.push({...c.evidence[0], id: 'evd-9999', kind: 'receipt', dated: c.loss_at, description: 'Receipt for ' + line.text.toLowerCase() + '.'});
  }).includes('receipts'));
  // A supplement with no part in front of it, a shared surname, a policyholder estimate under a company name, and an item approved with no proof.
  assert.ok(broken(c => c.estimates.some(e => e.kind === 'supplement' && e.lines.some(l => /^Coolant/.test(l.text) || /reinforcement bar/.test(l.text))), c => {
    for (const e of c.estimates.filter(x => x.kind === 'initial')) for (const l of e.lines) l.text = 'Paint materials';
  }).includes('supplements'));
  assert.deepEqual(broken(c => c.determinations.length, (c, seed) => { c.determinations[0].issued_by = 'Adjuster Q. ' + seed.policies[0].named_insured.name.split(' ').pop(); }), ['names']);
  assert.deepEqual(broken(c => c.estimates.some(e => e.source === 'policyholder'), c => { c.estimates.find(e => e.source === 'policyholder').shop_name = 'Flower City Restoration'; }), ['estimate source']);
  assert.ok(broken(c => c.estimates.some(e => e.lines.some(l => l.decisions.some(d => /No receipt or photo/.test(d.reason || '')))), c => {
    const line = c.estimates.flatMap(e => e.lines).find(l => l.decisions.some(d => /No receipt or photo/.test(d.reason || '')));
    line.decisions = [{...line.decisions[0], status: 'approved', amount: line.amount, reason: null}];
  }).includes('proof'));
});

test('PKG diagnostics on, off and broken give the same data', () => {
  const on = start(), off = start({logging: false}), broken = start();
  broken.ctx.log = () => { throw new Error('logger offline'); };
  for (const f of [on, off, broken]) repair(f);
  assert.deepEqual(on.data, off.data);
  assert.deepEqual(broken.data, off.data);
  assert.ok(on.logs.length);
  assert.equal(off.logs.length, 0);
});

// The code of the App and of its sender, and the files that run with the business tests, each with the host modules that it needs.
// Not in these lists: tests/mcp.integration.cjs and tests/mail.integration.cjs load the runtime from the path they are given, and dev/ reads the plan.
const sources = dir => fs.readdirSync(path.join(ROOT, dir)).filter(file => file.endsWith('.cjs')).map(file => dir + '/' + file);
const APP_CODE = [...sources('src'), ...sources('infra'), 'plugin.cjs'];
const TEST_CODE = {'tests/business.test.cjs': ['fs', 'child_process'], 'tests/schema-validator.cjs': ['fs'], 'tests/harness.cjs': [], 'examples/run.cjs': []};
const HOST_MODULE = /^(?:node:)?(fs|child_process|net|http|https|os)$/;
// Every module that a file loads. A target that is not a plain string cannot be checked, so it fails.
function loads(file) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  assert.ok(!/\b(require|import)\s*\((?!\s*['"][^'"]+['"]\s*\))/.test(text), file + ' loads a module that a plain string does not name');
  return {text, targets: [...text.matchAll(/\b(?:require|import)\s*\(\s*['"]([^'"]+)['"]/g)].map(match => match[1])};
}

test('PKG the text of src, infra and plugin.cjs has no host clock, timer or random source, no process, fetch, performance or crypto, and no require of a Node module', () => {
  // `Date(` with no `new` gives the host time as text. `new Date(value)`, `Date.UTC` and `Date.parse` read no clock.
  const banned = [/Date\.now\s*\(/, /new\s+Date\s*\(\s*\)/, /(?<!new\s+)\bDate\s*\(/, /Math\.random/, /\b(fetch|process|performance|setTimeout|setInterval|crypto)\b/];
  assert.ok(APP_CODE.includes('src/operations.cjs') && APP_CODE.includes('src/time.cjs') && APP_CODE.includes('infra/sender.cjs') && APP_CODE.includes('plugin.cjs'));
  for (const file of APP_CODE) {
    const {text, targets} = loads(file);
    for (const pattern of banned) assert.ok(!pattern.test(text), file + ' matches ' + pattern);
    for (const target of targets) assert.ok(!HOST_MODULE.test(target) && target.startsWith('.'), file + ' requires ' + target);
  }
  // The patterns find each banned form, and they let the three allowed uses of `Date` pass.
  const found = text => banned.some(pattern => pattern.test(text));
  for (const text of ['Date.now()', 'new Date()', 'x = Date()', 'Math.random()', 'fetch(url)', 'process.env', 'performance.now()', 'setTimeout(f, 1)', 'setInterval(f, 1)', 'crypto.randomUUID()']) assert.ok(found(text), text);
  for (const text of ['new Date(instant)', 'Date.UTC(2026, 11, 2)', 'Date.parse(value)', 'processed', 'refetch']) assert.ok(!found(text), text);
});

test('PKG no require in src, infra, plugin.cjs, tests/business.test.cjs, tests/harness.cjs, tests/schema-validator.cjs or examples/run.cjs leaves the package, and the last four load only the host modules that they need', () => {
  for (const file of [...APP_CODE, ...Object.keys(TEST_CODE)]) {
    for (const target of loads(file).targets) {
      const builtin = target.startsWith('node:') || builtinModules.includes(target), host = HOST_MODULE.exec(target);
      const inside = target.startsWith('.') && path.resolve(ROOT, path.dirname(file), target).startsWith(ROOT + path.sep);
      assert.ok(builtin || inside, file + ' requires ' + target);
      assert.ok(!host || (TEST_CODE[file] || []).includes(host[1]), file + ' requires ' + target);
    }
  }
});

test('PKG contribution.json declares one publish entry for channel.email, no receiver and no required App, so Mail is optional and send-only', () => {
  const {messaging, dependencies} = require('../contribution/contribution.json');
  assert.deepEqual(messaging.publishes.map(entry => pick(entry, 'channel', 'schema_id', 'event_type', 'payload_schema_id', 'schema_ref')),
    [['channel.email', 'urn:pale:email-message:2', 'org.pale.mail.notification.v1', 'urn:pale:email-payload:1', 'schemas/router-message.schema.json']]);
  assert.deepEqual([messaging.receives, dependencies.required_apps, require('../app.json').dependencies], [[], [], []]);
});

test('PKG tools.json has exactly the 9 read and 13 write operations of the plan, and app.json declares the eight events', () => {
  const names = readOnly => tools.filter(tool => tool.read_only === readOnly).map(tool => tool.name).sort();
  const full = list => list.map(name => 'alderbrook.' + name).sort();
  assert.deepEqual([names(true), names(false), tools.length], [full(READS), full(WRITES), 22]);
  assert.deepEqual([...require('../app.json').event_types].sort(), full(EVENTS));
  // Every write takes Core's `request_id` and `expected_version` and returns an `id`. Every read returns `now`.
  for (const tool of tools) {
    const needs = tool.read_only ? [] : ['request_id', 'expected_version'], gives = tool.read_only ? 'now' : 'id';
    assert.ok(needs.every(key => tool.inputSchema.required.includes(key)) && tool.outputSchema.required.includes(gives), tool.name);
  }
});
