'use strict';
// Checks that a seed is consistent. The sums are written here by hand and compared with what the App reads through `claims.get`.
// Run `node dev/check-fixture.cjs [seed.json]`. The default is fixtures/minimal.json, read at the time in fixtures/clock.json. Exits 1 on a failure.
const path = require('node:path');
const assert = require('node:assert/strict');
const {compile} = require('../tests/schema-validator.cjs');
const seedSchema = compile(require('../schemas/seed.schema.json'), path.resolve(__dirname, '../schemas'));
const ms = Date.parse, cents = amount => Math.round(amount * 100), money = value => value / 100;
const total = values => values.reduce((sum, value) => sum + value, 0);
const linesOf = claim => claim.estimates.flatMap(estimate => estimate.lines);

function counts(data) {
  const count = part => total(data.claims.map(claim => claim[part].length));
  return {policies: data.policies.length, vehicles: total(data.policies.map(policy => policy.vehicles.length)),
    listed_people: new Set(data.policies.flatMap(policy => policy.listed_people.map(person => person.person_id))).size,
    claims: data.claims.length, requests: count('requests'), estimates: count('estimates'), lines: total(data.claims.map(claim => linesOf(claim).length)),
    determinations: count('determinations'), disputes: count('disputes'), offers: count('offers'), payments: count('payments'), rentals: count('rentals'),
    evidence: count('evidence'), notifications: data.notifications.length, activity: data.activity.length};
}
// 1. The loss time of a claim is inside the term of its policy.
function lossInTerm(data, claim) {
  const policy = data.policies.find(p => p.id === claim.policy_id);
  assert.ok(policy && ms(claim.loss_at) >= ms(policy.term.start) && ms(claim.loss_at) < ms(policy.term.end), 'the loss time is outside the policy term');
}
// 2. The standing decision of a line is its latest one. Decisions are in time order, and each one matches its determination or its changed dispute.
function decisionOrder(data, claim) {
  const from = (line, source, id) => line.decisions.filter(d => d.source === source && d.source_id === id).length;
  for (const line of linesOf(claim)) {
    line.decisions.forEach((decision, index) => {
      assert.ok(!index || ms(decision.decided_at) >= ms(line.decisions[index - 1].decided_at), line.id + ': the decisions are not in time order');
      const source = decision.source === 'determination'
        ? claim.determinations.find(d => d.id === decision.source_id && d.line_ids.includes(line.id) && ms(d.issued_at) === ms(decision.decided_at))
        : claim.disputes.find(d => d.id === decision.source_id && d.line_id === line.id && d.state === 'changed' && ms(d.decided_at) === ms(decision.decided_at));
      assert.ok(source, line.id + ': a decision does not match ' + decision.source + ' ' + decision.source_id);
    });
    for (const dispute of claim.disputes.filter(d => d.line_id === line.id)) {
      assert.equal(from(line, 'dispute', dispute.id), dispute.state === 'changed' ? 1 : 0, dispute.id + ': the dispute and the decisions of ' + line.id + ' do not agree');
    }
  }
  for (const determination of claim.determinations) for (const id of determination.line_ids) {
    const line = linesOf(claim).find(row => row.id === id);
    assert.ok(line && from(line, 'determination', determination.id) === 1, determination.id + ': not exactly one decision on ' + id);
  }
}
function standingRead(data, claim, view) {
  const shown = new Map(view.estimates.flatMap(estimate => estimate.lines).map(line => [line.id, line.standing]));
  for (const line of linesOf(claim)) {
    const latest = line.decisions.reduce((best, decision) => !best || ms(decision.decided_at) >= ms(best.decided_at) ? decision : best, null);
    const expected = latest ? {status: latest.status, approved_amount: latest.amount, decided_at: latest.decided_at} : {status: 'pending', approved_amount: null, decided_at: null};
    const {status, approved_amount, decided_at} = shown.get(line.id);
    assert.deepEqual({status, approved_amount, decided_at}, expected, line.id + ': the standing decision is not the latest one');
  }
}
// 3. The money summary matches the lines, the offers and the payments. All sums run in integer cents.
function expectedSummary(data, claim, now) {
  const policy = data.policies.find(p => p.id === claim.policy_id), coverage = policy.coverages.find(c => c.type === claim.coverage);
  const deductible = cents(coverage.deductible), limit = coverage.limit, vehicle = policy.vehicles.find(v => v.id === claim.subject_id);
  const paidAs = (kind, payee) => total(claim.payments.filter(p => p.kind === kind && (!payee || p.payee.kind === payee)).map(p => cents(p.amount)));
  const repairPaid = paidAs('repair');
  if (claim.path === 'repair') {
    const approvedOf = line => { const last = line.decisions[line.decisions.length - 1]; return last && last.status === 'approved' ? cents(last.amount) : 0; };
    const approved = total(linesOf(claim).map(approvedOf)), afterDeductible = Math.max(0, approved - deductible);
    const owes = limit === null ? afterDeductible : Math.min(afterDeductible, cents(limit));
    return {approved_total: money(approved), insurer_owes: money(owes), over_limit: money(afterDeductible - owes), paid: money(repairPaid),
      still_due: money(Math.max(0, owes - repairPaid)), overpaid: money(Math.max(0, repairPaid - owes)), my_share: money(Math.min(deductible, approved)),
      not_approved_total: money(total(linesOf(claim).map(line => Math.max(0, cents(line.amount) - approvedOf(line))))), settlement: null};
  }
  const offer = claim.offers.find(o => o.state === 'accepted') || claim.offers[claim.offers.length - 1], accepted = offer.state === 'accepted';
  const net = Math.max(0, cents(offer.valuation) - deductible), payoff = vehicle.lienholder ? cents(offer.lienholder_payoff) : null;
  const toLender = payoff === null ? 0 : Math.min(net, payoff), toMe = net - toLender;
  const paidLender = paidAs('settlement', 'lienholder'), paidMe = paidAs('settlement', 'policyholder');
  return {approved_total: null, insurer_owes: null, over_limit: null, paid: money(repairPaid), still_due: null,
    overpaid: money(accepted ? Math.max(0, paidLender + paidMe - net) : paidLender + paidMe), my_share: null, not_approved_total: null,
    settlement: {offer_id: offer.id, offer_state: offer.state === 'open' && now >= ms(offer.respond_by) ? 'expired' : offer.state,
      valuation: offer.valuation, lienholder_payoff: offer.lienholder_payoff, net: money(net), to_lienholder: money(toLender), to_me: money(toMe),
      shortfall: payoff === null ? null : money(Math.max(0, payoff - net)), paid_to_lienholder: money(paidLender), paid_to_me: money(paidMe),
      still_due_to_lienholder: money(accepted ? Math.max(0, toLender - paidLender) : 0), still_due_to_me: money(accepted ? Math.max(0, toMe - paidMe) : 0)}};
}
function moneySummary(data, claim, view, now) {
  assert.deepEqual(view.summary, expectedSummary(data, claim, now), 'the money summary does not match the lines, the offers and the payments');
}
// 4. The state of an offer fits its times. A later offer or the end of the claim cuts an offer that is still open at that moment.
function offerTimes(data, claim) {
  const ended = claim.closed_at || claim.withdrawn_at;
  claim.offers.forEach((offer, index) => {
    const next = claim.offers[index + 1], issued = ms(offer.issued_at), by = ms(offer.respond_by);
    const cut = Math.min(next ? ms(next.issued_at) : Infinity, ended ? ms(ended) : Infinity), answered = offer.answered_at === null ? null : ms(offer.answered_at);
    const fits = {
      accepted: () => !next && answered !== null && answered >= issued && answered < by && answered <= cut,
      rejected: () => answered !== null && answered >= issued && answered < by && answered <= cut,
      superseded: () => answered === null && cut < by,
      open: () => answered === null && by <= cut
    }[offer.state];
    assert.ok(issued < by && issued <= cut && fits(), offer.id + ': the state ' + offer.state + ' does not fit the times of the offer');
  });
}
function offerRead(data, claim, view, now) {
  claim.offers.forEach((offer, index) => assert.equal(view.offers[index].state, offer.state === 'open' && now >= ms(offer.respond_by) ? 'expired' : offer.state,
    offer.id + ': the state that is read does not fit the clock'));
}
// `raw` reads the seed as it is, so it can report a seed that the App refuses. `read` compares with what the App reads through `claims.get`.
const CHECKS = [{title: 'Every loss time is inside its policy term', raw: lossInTerm},
  {title: 'Every standing decision is the latest one', raw: decisionOrder, read: standingRead},
  {title: 'Every money summary matches its lines, offers and payments', read: moneySummary},
  {title: 'Every offer state fits its times', raw: offerTimes, read: offerRead}];
const MONEY = CHECKS.findIndex(check => check.read === moneySummary);
function main(file) {
  const data = require(path.resolve(file)), clock = require('../fixtures/clock.json').initial_time, now = ms(clock), errors = CHECKS.map(() => []);
  const run = (index, label, check) => { try { check(); } catch (error) { errors[index].push(label + ': ' + error.message); } };
  console.log('Seed: ' + file + ', read at ' + clock);
  if (!seedSchema(data)) {
    console.log('FAIL  The seed does not match schemas/seed.schema.json. No check was run.');
    process.exitCode = 1;
    return;
  }
  console.log('Counts: ' + Object.entries(counts(data)).map(([name, value]) => name.replace('_', ' ') + ' ' + value).join(', '));
  CHECKS.forEach(({raw}, index) => { if (raw) for (const claim of data.claims) run(index, claim.id, () => raw(data, claim)); });
  // The money summary is read through the App. A seed that the App refuses fails this check with the reason.
  let f = null;
  run(MONEY, 'The App refuses the seed', () => { f = require('../tests/harness.cjs').fixture({seed: data, now: clock}); });
  for (const claim of f ? data.claims : []) {
    let view = null;
    run(MONEY, claim.id, () => { view = f.call('claims.get', {id: claim.id}).claim; });
    if (view) CHECKS.forEach(({read}, index) => { if (read) run(index, claim.id, () => read(data, claim, view, now)); });
  }
  errors.forEach((list, index) => console.log((list.length ? 'FAIL  ' : 'ok    ') + CHECKS[index].title + list.map(error => '\n      ' + error).join('')));
  const failed = errors.filter(list => list.length).length;
  console.log((CHECKS.length - failed) + ' of ' + CHECKS.length + ' checks passed.');
  process.exitCode = failed ? 1 : 0;
}
if (require.main === module) main(process.argv[2] || path.relative(process.cwd(), path.resolve(__dirname, '../fixtures/minimal.json')));
module.exports = {counts};
