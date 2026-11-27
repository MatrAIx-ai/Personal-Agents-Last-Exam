'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../plugin.cjs');
const seed = require('../fixtures/minimal.json');
const grinder = 'post-draft-grinder-reel';
const at = '2026-11-20T20:00:00Z';
function harness() {
  let data = structuredClone(seed);
  const ctx = { virtual_now: require('../fixtures/clock.json').initial_time, binding: require('../fixtures/binding.json') };
  app.validateSeed(ctx, data);
  return {
    ctx, get data() { return structuredClone(data); },
    call(name, args = {}) {
      const out = app.handleTool(ctx, structuredClone(data), 'reelpulse.' + name, args);
      app.validateSeed(ctx, out.data);
      data = out.data;
      return out.result;
    },
    event(operation, payload, stamp = ctx.virtual_now) {
      const next = { ...ctx, virtual_now: stamp, role: 'infra' };
      const out = app.applyEvent(next, structuredClone(data), { operation: 'reelpulse.' + operation, payload, at: stamp, event_id: 'test' });
      app.validateSeed(next, out);
      data = out;
      ctx.virtual_now = stamp;
    },
  };
}
function schedule(f) {
  f.call('posts.update_draft', { id: grinder, paid_partnership: true, tags: ['#ad'] });
  return f.call('posts.schedule', { id: grinder, audience: 'public', at }).item;
}
test('PNG preflight keeps sharing information in circles and leaves the draft untouched', () => {
  const f = harness(), before = f.data;
  const { item } = f.call('posts.get', { id: 'post-hike-carousel' });
  assert.equal(item.status, 'draft');
  assert.ok(item.asset_ids.includes('hike-slide-02'));
  assert.doesNotMatch(JSON.stringify(item), /Maya Lin|412/);
  assert.equal(f.call('circles.get').circles.members.find(m => m.badge_label === 'Maya Lin').sharing, 'close_friends_only');
  assert.deepEqual(f.data, before);
});
test('sponsorship failures do not alter state; clock and events share effective publication', () => {
  const f = harness();
  const args = { id: grinder, audience: 'public', at };
  const before = f.data;
  assert.throws(() => f.call('posts.schedule', args), { code: 'compliance_error', message: /paid_partnership/ });
  assert.deepEqual(f.data, before);
  f.call('posts.update_draft', { id: grinder, paid_partnership: true });
  const disclosed = f.data;
  assert.throws(() => f.call('posts.schedule', args), { code: 'compliance_error', message: /forbidden tags/ });
  assert.deepEqual(f.data, disclosed);
  assert.equal(schedule(f).status, 'scheduled');
  const pin = { post_id: grinder, comment_id: 'promo' };
  assert.throws(() => f.call('comments.pin', pin), { code: 'post_not_published' });
  f.ctx.virtual_now = at;
  const raw = f.data;
  assert.equal(f.call('posts.get', { id: grinder }).item.published_at, at);
  assert.equal(f.call('posts.list', { status: 'published' }).items.find(p => p.id === grinder).status, 'published');
  assert.deepEqual(f.data, raw);
  assert.throws(() => f.call('comments.pin', pin), { code: 'comment_not_found' });
  f.event('comment.create', { comment_id: 'promo', author: seed.owner_person_id, author_role: 'creator', text: 'Use code ROAST15.' });
  assert.equal(f.call('comments.pin', pin).comment.pinned, true);
  assert.equal(f.data.posts.find(p => p.id === grinder).status, 'scheduled');
});
test('an embargo change cancels a future schedule and invalid targets roll back', () => {
  const f = harness();
  schedule(f);
  const event = require('../examples/scenario.json');
  const before = f.data;
  assert.throws(() => f.event('sponsor.update', { ...event.payload, post_id: 'wrong' }, event.at), { code: 'invalid_event' });
  assert.deepEqual(f.data, before);
  f.event('sponsor.update', event.payload, event.at);
  const { item } = f.call('posts.get', { id: grinder });
  assert.equal(item.status, 'draft');
  assert.equal(item.schedule_reverted_reason, 'SPONSOR_EMBARGO');
});
test('ranking uses averaged rates and ties order by slot_id', () => {
  const f = harness();
  const picks = f.call('recommend.slots', { limit: 20 }).items;
  for (const [id, score] of [['slot-tue-grinder', .26], ['slot-thu-clean', .22], ['slot-sat-clickbait', .12]]) {
    assert.equal(picks.find(p => p.slot_id === id).slot_score, score);
  }
  const clean = structuredClone(seed);
  const a = clean.posts.find(p => p.slot_id === 'slot-mon-water');
  const b = clean.posts.find(p => p.slot_id === 'slot-wed-filter');
  clean.posts = [{ ...b, metrics: a.metrics }, a];
  assert.deepEqual(app.computeSlots(f.ctx, clean).map(p => p.slot_id), ['slot-mon-water','slot-wed-filter']);
});
test('an explicit event cannot target a post before its historical publication time', () => {
  const f = harness(), before = f.data;
  const post = before.posts.find(p => p.status === 'published');
  const earlier = new Date(Date.parse(post.published_at) - 1000).toISOString();
  assert.throws(() => f.event('comment.create', {
    post_id: post.id, comment_id: 'early-comment', author: 'Follower', text: 'Too early',
  }, earlier), { code: 'invalid_event' });
  assert.deepEqual(f.data, before);
});

test('both event types choose the lexically lower post ID at equal publication time', () => {
  const f = harness(), data = f.data;
  const p = data.posts.find(p => p.status === 'published');
  data.posts = ['post-a', 'post-Z'].map(id => ({ ...p, id, comments: [] }));
  const stamp = f.ctx.virtual_now;
  for (const [operation, payload] of [
    ['comment.create', { comment_id:'test-comment', author:'Follower', text:'Hello' }],
    ['engagement.snapshot', { views:3, saves:1, completions:2, unfollows:0, not_interested:0 }],
  ]) app.applyEvent(f.ctx, data, { operation:'reelpulse.' + operation, payload, at:stamp });
  assert.equal(data.posts[1].comments.length, 1);
  assert.equal(data.posts[1].metrics.views, 3);
  assert.equal(data.posts[0].comments.length, 0);
});
