'use strict';
// App-only walkthrough. This is not MCP, a model rollout, or a Core simulator.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {fixture} = require('../tests/harness.cjs');
const {clone, later, blankWorkspace, filterCriteria, quoteEvent} = require('./fixture-data.cjs');

function run() {
  const seed = require('../fixtures/minimal.json');
  const f = fixture({seed: blankWorkspace(seed)});
  const criteria = filterCriteria(f.data);
  const firstAt = later(f.ctx.virtual_now, 60 * 60 * 1000);
  const first = quoteEvent(f.data, criteria, {at: firstAt});
  const created = f.call('pricewatch.watch.upsert', {watch_key: 'replacement-filter', criteria, state: 'active'});
  assert.equal(f.call('pricewatch.watch.get', {watch_id: created.watch_id}).candidates.length, 0);
  f.event(first);
  let view = f.call('pricewatch.watch.get', {watch_id: created.watch_id});
  assert.equal(view.watch.available_candidate_count, 1);
  assert.equal(view.candidates[0].total_minor, 2700);
  const originalCandidate = view.candidates[0].id;
  f.event(clone(first));
  assert.equal(f.call('pricewatch.watch.get', {watch_id: created.watch_id}).candidates.length, 1);
  f.call('pricewatch.watch.upsert', {watch_key: 'replacement-filter', criteria, state: 'paused'});
  const second = quoteEvent(f.data, criteria, {id: 'example-lower-price-event', episode: 'example-lower-price',
    at: later(firstAt, 10 * 60 * 1000), validUntil: first.payload.valid_until, total: 2400,
    supersedes: [first.payload.offer_episode_id]});
  f.event(second);
  view = f.call('pricewatch.watch.get', {watch_id: created.watch_id});
  assert.equal(view.watch.available_candidate_count, 0);
  assert.equal(view.candidates[0].status, 'withdrawn');
  f.call('pricewatch.watch.upsert', {watch_key: 'replacement-filter', criteria, state: 'active'});
  view = f.call('pricewatch.watch.get', {watch_id: created.watch_id});
  assert.equal(view.watch.available_candidate_count, 1);
  assert.notEqual(view.candidates.find(item => item.effective_status === 'available_in_app').id, originalCandidate);
  f.advanceTime(first.payload.valid_until);
  const beforeRead = f.data;
  view = f.call('pricewatch.watch.get', {watch_id: created.watch_id});
  assert.equal(view.watch.available_candidate_count, 0);
  assert.equal(view.candidates.find(item => item.status === 'available_in_app').effective_status, 'expired');
  assert.deepEqual(f.data, beforeRead);
  f.event({event_id: 'example-expire', at: f.ctx.virtual_now, operation: 'offer.expire_due', payload: {account_id: f.data.account_id}});
  view = f.call('pricewatch.watch.get', {watch_id: created.watch_id});
  assert.equal(view.candidates.filter(item => item.status === 'expired').length, 1);
  return {passed: true, mode: 'App-only business walkthrough', app_version: require('../app.json').version,
    watch_id: created.watch_id, checks: ['create without a quote', 'qualifying quote', 'episode replay',
      'pause and lower price remain unavailable', 'explicit resume creates a new candidate',
      'clock-only effective expiry is a pure read', 'explicit expiry records history'],
    final_watch: view.watch, candidates: view.candidates, transitions: view.transitions};
}

module.exports = {run};
if (require.main === module) {
  try {const report = run(); if (process.argv[2]) fs.writeFileSync(path.resolve(process.argv[2]), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));}
  catch (error) {console.error(error); process.exitCode = 1;}
}
