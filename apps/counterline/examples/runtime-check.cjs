'use strict';
// Real-MCP runtime check through the public runtime (approved plan, validation row). Run from a full checkout:
//   node apps/counterline/examples/runtime-check.cjs
// Separate Agent and Infra connections on one run: a task seed loaded with virtual_now; env.advance_time
// across an offer's expiry and a commitment's perform_by (derived states change, business records do not);
// a failed call that changes nothing; a confirmation-token replay; a rejected report; a request_id retry;
// and reset restoring the seed and the loaded time.
const assert = require('node:assert/strict');
const {openRun} = require('./lib/run.cjs');
const seed = require('../fixtures/retention-neutral.json'), binding = require('../fixtures/binding.json');
const LOADED = '2026-12-02T09:00:00-05:00';

async function main() {
  const r = await openRun('runtime-check'), {infra, agent, snap, data} = r;
  const out = {};
  let n = 0;
  const write = async (name, args, request_id = 'rc-' + (++n)) => {
    const s = await snap();
    return agent.call('counterline.' + name, {...args, expected_version: s.version, request_id});
  };
  try {
    // 1. Load a task seed with its own virtual time.
    const loaded = await r.load(seed, binding, LOADED);
    let s = await snap();
    assert.equal(s.snapshot.virtual_now, LOADED);
    out.load = {status: loaded.status, virtual_now: s.snapshot.virtual_now, version: s.version};

    // 2. Agent steps; step one of an acceptance; then the clock passes the offer's expiry.
    const opened = await write('cases.open', {topic_id: 'annual_fee', account_ref: 'brindle:acct-jordan-1234', message: 'My annual fee posted.'});
    const case_id = opened.case_id;
    await write('identity.provide', {case_id, fields: {last_four: '1234', billing_zip: '02139'}});
    const offer = (await data()).offers.find(o => o.case_id === case_id);
    const step1 = await write('offers.accept', {offer_id: offer.offer_id});
    assert.equal(step1.step, 'confirm');
    s = await snap();
    const adv = await infra.call('env.advance_time', {expected_version: s.version, request_id: 'clock-1', virtual_now: '2026-12-05T09:00:00-05:00'});
    assert.equal(adv.status, 'committed', JSON.stringify(adv));
    const read = await agent.call('counterline.offers.get', {offer_id: offer.offer_id});
    assert.equal(read.offer.state, 'expired');
    const before = await snap();
    const late = await write('offers.accept', {offer_id: offer.offer_id, confirmation_token: step1.confirmation_token});
    const after = await snap();
    assert.notEqual(late.status, 'committed');
    assert.deepEqual(after.version, before.version, 'a failed call changes nothing');
    assert.equal(after.snapshot.data.commitments.length, before.snapshot.data.commitments.length);
    out.expiry = {offer_state_after_advance: read.offer.state, late_accept: late.status, version_unchanged: true};

    // 3. A quick action the chat does not offer now fails and changes nothing: the only offer in the case
    //    has expired, so there are no terms to explain.
    const b2 = await snap();
    const denied = await write('cases.take_action', {case_id, action: 'explain_terms'});
    assert.equal(denied.status, 'action_unavailable', JSON.stringify(denied));
    assert.deepEqual((await snap()).version, b2.version);
    out.failed_call = {status: denied.status, version_unchanged: true};

    // 4. A fresh offer, accepted with confirmation; replaying the token returns the same commitment.
    const c2 = (await write('cases.open', {topic_id: 'annual_fee', account_ref: 'brindle:acct-jordan-1234', message: 'Second look at the fee.'})).case_id;
    await write('identity.provide', {case_id: c2, fields: {last_four: '1234', billing_zip: '02139'}});
    const o2 = (await data()).offers.find(o => o.case_id === c2 && o.state === 'presented');
    const t = (await write('offers.accept', {offer_id: o2.offer_id})).confirmation_token;
    const done = await write('offers.accept', {offer_id: o2.offer_id, confirmation_token: t});
    const again = await write('offers.accept', {offer_id: o2.offer_id, confirmation_token: t});
    assert.equal(again.commitment_id, done.commitment_id);
    assert.equal((await data()).commitments.filter(m => m.offer_id === o2.offer_id).length, 1);
    out.token_replay = {commitment_id: done.commitment_id, replay_commitment_id: again.commitment_id, commitments_for_offer: 1};

    // 5. The same request_id retried returns the original result once.
    // A retry resends the identical request: same arguments, same expected_version, same request_id.
    const same = {case_id: c2, text: 'Thanks. Can you explain the terms?', expected_version: (await snap()).version, request_id: 'retry-1'};
    const r1 = await agent.call('counterline.cases.send_message', same);
    const turns = (await data()).cases.find(c => c.case_id === c2).transcript.length;
    const r2 = await agent.call('counterline.cases.send_message', same);
    assert.equal(r2.status, 'committed');
    assert.equal(r2.duplicate, true);
    assert.equal((await data()).cases.find(c => c.case_id === c2).transcript.length, turns, 'a retried request_id has one effect');
    out.request_retry = {first: r1.status, retry: r2.status, duplicate: r2.duplicate === true, single_effect: true};

    // 6. The clock passes perform_by: the commitment reads overdue; its stored status is unchanged.
    s = await snap();
    await infra.call('env.advance_time', {expected_version: s.version, request_id: 'clock-2', virtual_now: '2026-12-20T09:00:00-05:00'});
    const m = (await agent.call('counterline.commitments.get', {commitment_id: done.commitment_id})).commitment;
    assert.deepEqual([m.status, m.overdue], ['pending', true]);
    out.perform_by = {status: m.status, overdue: m.overdue};

    // 7. A report above the committed amount is rejected and changes nothing.
    s = await snap();
    const rejected = await infra.call('env.apply_event', {expected_version: s.version, event: {event_id: 'ev-rc-1', at: '2026-12-20T10:00:00-05:00',
      operation: 'counterline.commitment.performance_reported', payload: {commitment_id: done.commitment_id, provider_id: 'issuer-larchmont', reference_id: 'POST-999', amount_minor: 999999, currency: 'USD', status: 'reported'}}});
    assert.notEqual(rejected.status, 'committed');
    assert.deepEqual((await snap()).version, s.version);
    out.rejected_report = {status: rejected.status, version_unchanged: true};

    // 8. Reset restores the loaded seed and time.
    s = await snap();
    const reset = await infra.call('env.reset', {expected_version: s.version});
    assert.ok(['committed', 'ready'].includes(reset.status), JSON.stringify(reset).slice(0, 300));
    s = await snap();
    assert.equal(s.snapshot.data.cases.length, seed.cases.length);
    assert.equal(s.snapshot.virtual_now, LOADED);
    out.reset = {status: reset.status, cases: s.snapshot.data.cases.length, virtual_now: s.snapshot.virtual_now, epoch: s.version.epoch};
    return out;
  } finally { await r.close(); }
}
module.exports = {main};
if (require.main === module) main().then(r => { console.log(JSON.stringify(r, null, 2)); console.log('PASS: Counterline runtime check, 8 steps.'); })
  .catch(e => { console.error(e); process.exit(1); });
