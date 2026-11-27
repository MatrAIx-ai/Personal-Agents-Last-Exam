'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const { prepare } = require('../../../runtime/prepare.cjs');
const { Client } = require('../../../runtime/client.cjs');

test('real MCP verifies scheduling, parent authorization and PNG integrity', async () => {
  const prepared = prepare(path.resolve(__dirname, '..'));
  const clients = [];
  const run = 'reelpulse-evidence';
  async function connect(role) {
    const client = new Client('reelpulse', role, run, path.join(prepared.root, 'state'),
      'reelpulse-evidence', { registry: prepared.registry });
    clients.push(client);
    await client.initialize();
    return client;
  }
  try {
    const agent = await connect('agent');
    const infra = await connect('infra');
    const snapshot = () => infra.call('env.snapshot');
    const hike = 'post-hike-carousel';
    const coffee = 'post-draft-grinder-reel';
    const uri = `pale://${run}/reelpulse/assets/hike-slide-02`;
    const before = await snapshot();
    const list = (await agent.request('resources/list')).result.resources;
    assert.equal(list.length, 20);
    const png = (await agent.request('resources/read', { uri })).result.contents[0];
    assert.equal(png.mimeType, 'image/png');
    const bytes = Buffer.from(png.blob, 'base64');
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),
      before.snapshot.resources.bundle.catalog.assets.find(a => a.asset_id === 'hike-slide-02').integrity.sha256);
    assert.ok((await agent.request('resources/read', { uri: uri.replace(run, 'other-run') })).error);

    let seq = 0;
    async function write(name, args) {
      return agent.call('reelpulse.' + name, {
        ...args, request_id: `write-${++seq}`, expected_version: (await snapshot()).version,
      });
    }
    const at = '2026-11-20T20:00:00Z';
    const schedule = { id: coffee, audience: 'public', at };
    assert.equal((await write('posts.schedule', schedule)).status, 'compliance_error');
    assert.deepEqual((await snapshot()).version, before.version);
    assert.deepEqual((await snapshot()).snapshot.data, before.snapshot.data);
    assert.equal((await write('posts.update_draft', { id: coffee, paid_partnership: true, tags: ['#ad'] })).status, 'committed');
    assert.equal((await write('posts.schedule', schedule)).item.status, 'scheduled');
    const scheduled = await snapshot();
    assert.equal((await infra.call('env.advance_time', {
      expected_version: scheduled.version, request_id: 'clock', virtual_now: at,
    })).status, 'committed');
    assert.equal((await agent.call('reelpulse.posts.get', { id: coffee })).item.published_at, at);
    assert.deepEqual((await snapshot()).snapshot.data, scheduled.snapshot.data);
    assert.equal((await write('posts.publish', { id: coffee, audience: 'public' })).item.published_at, at);
    assert.deepEqual((await snapshot()).snapshot.data, scheduled.snapshot.data);
    assert.equal((await infra.call('env.apply_event', {
      expected_version: (await snapshot()).version,
      event: { event_id: 'promo', operation: 'reelpulse.comment.create', at,
        payload: { comment_id: 'promo', author: 'person-creator', author_role: 'creator', text: 'Use code ROAST15.' } },
    })).status, 'committed');
    assert.equal((await write('comments.pin', { post_id: coffee, comment_id: 'promo' })).comment.pinned, true);

    const baseline = before.snapshot;
    baseline.policies.scenario.constraints['reelpulse.posts.get'] = { ids: [coffee] };
    assert.equal((await infra.call('env.load_seed', {
      request_id: 'restrict', expected_version: (await snapshot()).version,
      data: baseline.data, bundle: baseline.resources.bundle, policies: baseline.policies,
    })).status, 'ready');
    assert.equal((await agent.call('reelpulse.posts.get', { id: hike })).status, 'permission_denied');
    const listedHike = (await agent.call('reelpulse.posts.list')).items.find(p => p.id === hike);
    assert.deepEqual(listedHike.asset_ids, []);
    assert.deepEqual(listedHike.resource_uris, []);
    assert.ok(!(await agent.request('resources/list')).result.resources.some(r => r.uri === uri));
    assert.ok((await agent.request('resources/read', { uri })).error);
    assert.equal((await agent.call('reelpulse.asset.read', { post_id: hike, asset_id: 'hike-slide-02' })).status, 'not_available');
  } finally {
    await Promise.allSettled(clients.map(c => c.close()));
    prepared.cleanup();
  }
});
