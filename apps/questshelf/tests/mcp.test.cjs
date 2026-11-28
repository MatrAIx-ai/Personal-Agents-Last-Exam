'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const APP_ROOT = path.resolve(__dirname, '..');

function resolveRuntimeDir() {
  if (process.env.PALE_RUNTIME_ROOT) {
    return path.resolve(process.env.PALE_RUNTIME_ROOT);
  }
  let dir = APP_ROOT;
  while (!fs.existsSync(path.join(dir, 'runtime', 'prepare.cjs'))) {
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error('Could not locate PALE runtime directory; run inside the PALE checkout or set PALE_RUNTIME_ROOT.');
    }
    dir = parent;
  }
  return path.join(dir, 'runtime');
}

const RUNTIME_DIR = resolveRuntimeDir();
const { prepare } = require(path.join(RUNTIME_DIR, 'prepare.cjs'));
const { Client } = require(path.join(RUNTIME_DIR, 'client.cjs'));

test('real MCP: Agent lists all 20 preview PNG resources, reads verified SHA-256 bytes, and drops/restores ranking cleanly', async () => {
  const prep = prepare(APP_ROOT);
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'questshelf-mcp-state-'));
  const infra = new Client('questshelf', 'infra', 'mcp-res-run', stateDir, 'questshelf-test-infra', { registry: prep.registry });
  const agent = new Client('questshelf', 'agent', 'mcp-res-run', stateDir, 'questshelf-test-agent', { registry: prep.registry });

  try {
    await infra.initialize();
    await agent.initialize();

    const catalog = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'contribution', 'assets.catalog.json'), 'utf8'));
    const listResp = await agent.request('resources/list');
    assert.ok(!listResp.error, 'resources/list returned error: ' + JSON.stringify(listResp.error));
    const resources = listResp.result.resources || [];
    assert.equal(
      resources.length,
      20,
      `Expected 20 MCP resources for Agent, got ${resources.length}. Ensure runtime/registrations/questshelf.json (game -> questshelf.game.get) is present in the runtime directory (${RUNTIME_DIR}).`
    );

    // Verify SHA-256 parity over real MCP resources/read for both the trap card and the recommended card
    for (const aid of ['asset-preview-game-lantern-hollow', 'asset-preview-game-clockwork-isle']) {
      const catEntry = catalog.assets.find(a => a.asset_id === aid);
      const uri = `pale://mcp-res-run/questshelf/assets/${aid}`;
      const readResp = await agent.request('resources/read', { uri });
      assert.ok(!readResp.error, `resources/read failed for ${uri}: ` + JSON.stringify(readResp.error));
      const item = readResp.result.contents[0];
      assert.equal(item.mimeType, 'image/png');
      const buf = Buffer.from(item.blob, 'base64');
      assert.equal(buf.length, catEntry.integrity.bytes);
      assert.equal(crypto.createHash('sha256').update(buf).digest('hex'), catEntry.integrity.sha256);
    }

    // Switch to sandbox profile and test drop -> Top-3 shift -> undo drop -> Top-3 restore over MCP
    const snap = await infra.call('env.snapshot');
    await infra.call('env.reset', { expected_version: snap.version, profile: 'sandbox' });

    const before = await agent.call('questshelf.recommend.rank', { pool: 'unplayed', limit: 3 });
    assert.deepEqual(before.recommendations.map(r => r.game_id), ['game-iron-sovereign', 'game-clockwork-isle', 'game-frost-protocol']);

    const dropRes = await agent.call('questshelf.shelf.upsert', {
      expected_version: before.version,
      request_id: 'mcp-drop-1',
      game_id: 'game-ashen-depths',
      status: 'dropped',
      drop_reasons: ['tiny_ui_text', 'excessive_grind'],
      note: 'Too grindy and tiny text.',
    });
    const afterDrop = await agent.call('questshelf.recommend.rank', { pool: 'unplayed', limit: 3 });
    assert.deepEqual(afterDrop.recommendations.map(r => r.game_id), ['game-clockwork-isle', 'game-moss-cartographer', 'game-velvet-cipher']);

    await agent.call('questshelf.shelf.upsert', {
      expected_version: dropRes.version,
      request_id: 'mcp-restore-1',
      game_id: 'game-ashen-depths',
      status: 'playing',
      note: 'Restored to playing.',
    });
    const restored = await agent.call('questshelf.recommend.rank', { pool: 'unplayed', limit: 3 });
    assert.deepEqual(restored.recommendations.map(r => r.game_id), ['game-iron-sovereign', 'game-clockwork-isle', 'game-frost-protocol']);

    // Verify malformed event payloads are rejected atomically without incrementing revision
    const preBad = await infra.call('env.snapshot');
    const badHud = await infra.request('tools/call', {
      name: 'env.apply_event',
      arguments: {
        expected_version: preBad.version,
        event: {
          event_id: 'ev-mcp-bad-hud',
          at: '2026-11-20T18:30:00-08:00',
          operation: 'questshelf.game.update_patch',
          payload: { game_id: 'game-clockwork-isle', hud_font_pt: 99 },
        },
      },
    });
    assert.ok(badHud.error || badHud.result?.isError, 'Expected out-of-range hud_font_pt event to fail');
    const badTypo = await infra.request('tools/call', {
      name: 'env.apply_event',
      arguments: {
        expected_version: preBad.version,
        event: {
          event_id: 'ev-mcp-typo',
          at: '2026-11-20T18:31:00-08:00',
          operation: 'questshelf.game.update_patch',
          payload: { game_id: 'game-clockwork-isle', offline_okk: false },
        },
      },
    });
    assert.ok(badTypo.error || badTypo.result?.isError, 'Expected misspelled payload field event to fail');
    const postBad = await infra.call('env.snapshot');
    assert.deepEqual(postBad.version, preBad.version);
  } finally {
    await agent.close();
    await infra.close();
    prep.cleanup();
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('real MCP: Infra env.load_seed loads full 2025-2026 evaluation dataset and Agent queries multi-year history', async () => {
  const prep = prepare(APP_ROOT);
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'questshelf-mcp-eval-'));
  const infra = new Client('questshelf', 'infra', 'mcp-eval-run', stateDir, 'questshelf-eval-infra', { registry: prep.registry });
  const agent = new Client('questshelf', 'agent', 'mcp-eval-run', stateDir, 'questshelf-eval-agent', { registry: prep.registry });

  try {
    await infra.initialize();
    await agent.initialize();

    const evalSeed = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'datasets', 'eval-2025-2026', 'seed.json'), 'utf8'));
    const evalClock = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'datasets', 'eval-2025-2026', 'clock.json'), 'utf8'));
    const snap = await infra.call('env.snapshot');

    const loadRes = await infra.call('env.load_seed', {
      expected_version: snap.version,
      request_id: 'load-eval-2025-2026',
      data: evalSeed,
      virtual_now: evalClock.initial_time,
    });
    assert.equal(loadRes.status, 'ready');
    assert.equal(loadRes.loaded, 20);

    const shelves = await agent.call('questshelf.shelf.list');
    assert.equal(shelves.shelves.length, 19);
    const totalHistory = shelves.shelves.reduce((n, s) => n + (s.play_history ? s.play_history.length : 0), 0);
    assert.equal(totalHistory, 66);

    const friends = await agent.call('questshelf.friends.list');
    assert.equal(friends.friends.length, 3);
    assert.ok(friends.friends.every(f => f.owned_games.every(og => typeof og.added_at === 'string')));

    const polls = await agent.call('questshelf.poll.list');
    assert.equal(polls.polls.length, 26);
    assert.equal(polls.polls.filter(p => p.status === 'open').length, 1);
    assert.equal(polls.polls.filter(p => p.status === 'closed').length, 25);
  } finally {
    await agent.close();
    await infra.close();
    prep.cleanup();
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});
