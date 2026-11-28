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
    assert.equal(totalHistory, 71);

    const friends = await agent.call('questshelf.friends.list');
    assert.equal(friends.friends.length, 3);
    assert.ok(friends.friends.every(f => f.owned_games.every(og => typeof og.added_at === 'string')));

    const polls = await agent.call('questshelf.poll.list');
    assert.equal(polls.polls.length, 19);
    assert.equal(polls.polls.filter(p => p.status === 'open').length, 1);
    assert.equal(polls.polls.filter(p => p.status === 'closed').length, 18);
  } finally {
    await agent.close();
    await infra.close();
    prep.cleanup();
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('real MCP: unsliced eval seed rejects at earlier clocks, while slice-dataset slices load and accept writes at 2025-06-15 and 2026-11-20', async () => {
  const { sliceSeed } = require(path.join(APP_ROOT, 'scripts', 'slice-dataset.cjs'));
  const evalSeed = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'datasets', 'eval-2025-2026', 'seed.json'), 'utf8'));

  const prep = prepare(APP_ROOT);
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'questshelf-mcp-slice-'));
  const infra = new Client('questshelf', 'infra', 'mcp-slice-run', stateDir, 'questshelf-slice-infra', { registry: prep.registry });
  const agent = new Client('questshelf', 'agent', 'mcp-slice-run', stateDir, 'questshelf-slice-agent', { registry: prep.registry });

  try {
    await infra.initialize();
    await agent.initialize();

    // 1. Unsliced full 2025-2026 seed is rejected at an earlier clock (no future leakage)
    const snap0 = await infra.call('env.snapshot');
    const badLoad = await infra.request('tools/call', {
      name: 'env.load_seed',
      arguments: {
        expected_version: snap0.version,
        request_id: 'bad-unsliced-nov20',
        data: evalSeed,
        virtual_now: '2026-11-20T09:00:00-08:00',
      },
    });
    assert.ok(badLoad.error || badLoad.result?.isError, 'Expected unsliced Dec 2026 seed to reject at 2026-11-20');

    // 2. Sliced 2025-06-15 seed loads cleanly in sandbox profile and supports poll.create, poll.vote, and shelf.upsert
    const cutoff2025 = '2025-06-15T12:00:00-07:00';
    const slice2025 = sliceSeed(evalSeed, cutoff2025);
    const snap1 = await infra.call('env.snapshot');
    const load2025 = await infra.call('env.load_seed', {
      expected_version: snap1.version,
      request_id: 'load-slice-2025-06',
      data: slice2025,
      virtual_now: cutoff2025,
    });
    assert.equal(load2025.status, 'ready');
    await infra.call('env.reset', { expected_version: load2025.version, profile: 'sandbox' });

    const pList2025 = await agent.call('questshelf.poll.list');
    assert.equal(pList2025.polls.length, 5);
    assert.equal(pList2025.polls.filter(p => p.status === 'open').length, 0);

    const created = await agent.call('questshelf.poll.create', {
      expected_version: pList2025.version,
      request_id: 'slice2025-poll-create',
      title: 'Mid-June Co-Op Night',
      candidate_game_ids: ['game-orbit-relay', 'game-ember-kitchen'],
      invited_friend_ids: ['friend-alex', 'friend-sam'],
      closes_at: '2025-06-16T22:00:00-07:00',
    });
    const voted = await agent.call('questshelf.poll.vote', {
      expected_version: created.version,
      request_id: 'slice2025-poll-vote',
      poll_id: created.poll.poll_id,
      selected_game_ids: ['game-orbit-relay'],
      note: 'Voting at 2025-06-15 clock.',
    });
    assert.equal(voted.poll.votes.length, 1);

    // Adding a brand-new shelf entry initializes play_history
    const newShelf = await agent.call('questshelf.shelf.upsert', {
      expected_version: voted.version,
      request_id: 'slice2025-new-shelf',
      game_id: 'game-rift-runners',
      status: 'backlog',
      owned_platforms: ['pc'],
      note: 'New shelf entry test.',
    });
    assert.equal(newShelf.entry.play_history.length, 1);

    // 3. Sliced 2026-11-20 seed loads cleanly, accepts poll.create + shelf.upsert, and rejects lower hours_logged with invalid_arguments
    const cutoff2026 = '2026-11-20T09:00:00-08:00';
    const slice2026 = sliceSeed(evalSeed, cutoff2026);
    const load2026 = await infra.call('env.load_seed', {
      expected_version: newShelf.version,
      request_id: 'load-slice-2026-11',
      data: slice2026,
      virtual_now: cutoff2026,
    });
    assert.equal(load2026.status, 'ready');
    const s2026 = await agent.call('questshelf.shelf.list');
    assert.equal(s2026.shelves.length, 19);
    assert.ok(s2026.shelves.every(s => Date.parse(s.updated_at) <= Date.parse(cutoff2026)));

    const badHours = await agent.request('tools/call', {
      name: 'questshelf.shelf.upsert',
      arguments: {
        expected_version: s2026.version,
        request_id: 'slice2026-lower-hours',
        game_id: 'game-orbit-relay',
        status: 'playing',
        hours_logged: 1.0,
      },
    });
    assert.ok(badHours.error || badHours.result?.isError, 'Expected decreasing hours_logged to fail');
    const errText = JSON.stringify(badHours);
    assert.ok(errText.includes('invalid_arguments'), 'Expected invalid_arguments error code, got: ' + errText);
    assert.ok(!errText.includes('invalid_seed'), 'Must not leak invalid_seed on Agent write');
  } finally {
    await agent.close();
    await infra.close();
    prep.cleanup();
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});
