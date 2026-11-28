'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./harness.cjs');

test('weekend handheld offline search surfaces short backlog picks and MCP resource URIs', () => {
  const app = createHarness();
  const res = app.call('questshelf.catalog.search', {
    platform: 'handheld',
    shelf_status: 'backlog',
    offline_ok: true,
    max_hours: 8,
    exclude_muted: true,
  });
  const ids = res.items.map(g => g.id);
  assert.ok(ids.includes('game-clockwork-isle'));
  assert.ok(ids.includes('game-lantern-hollow'), 'unlabeled 1st-person horror candidate stays visible until visual PNG inspection');
  assert.ok(!ids.includes('game-iron-sovereign'), '45h RPG excluded by 8h budget');

  const detail = app.call('questshelf.game.get', { game_id: 'game-lantern-hollow' });
  assert.deepEqual(detail.resource_uris, ['pale://test-run/questshelf/assets/asset-preview-game-lantern-hollow']);

  const card = app.call('questshelf.asset.read', {
    game_id: 'game-lantern-hollow',
    asset_id: 'asset-preview-game-lantern-hollow',
  });
  assert.equal(card.file.mime_type, 'image/png');
  assert.ok(Buffer.from(card.file.data_base64, 'base64').subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));

  assert.throws(() => app.call('questshelf.asset.read', {
    game_id: 'game-clockwork-isle',
    asset_id: 'asset-preview-game-lantern-hollow',
  }), /does not belong/);
});

test('cross-play friend recommendation matches exactly two PC-PS5 co-op games with Alex', () => {
  const app = createHarness();
  const res = app.call('questshelf.recommend.rank', {
    pool: 'backlog',
    with_friend_id: 'friend-alex',
    max_session_minutes: 90,
    limit: 10,
  });
  const ids = res.recommendations.map(r => r.game_id).sort();
  assert.deepEqual(ids, ['game-ember-kitchen', 'game-orbit-relay']);
});

test('acceptance: dropping Ashen Depths shifts unplayed Top 3 deterministically while keeping visual trap intact', () => {
  const app = createHarness();
  const beforeTop3 = app.call('questshelf.recommend.rank', { pool: 'unplayed', limit: 3 }).recommendations.map(r => r.game_id);
  assert.deepEqual(beforeTop3, ['game-iron-sovereign', 'game-clockwork-isle', 'game-frost-protocol']);

  const drop = app.call('questshelf.shelf.upsert', {
    game_id: 'game-ashen-depths',
    status: 'dropped',
    drop_reasons: ['tiny_ui_text', 'excessive_grind'],
    note: 'Too grindy and tiny 7pt font on handheld.',
  });
  assert.equal(drop.entry.status, 'dropped');
  assert.ok(drop.avoid_reasons.includes('tiny_ui_text'));
  assert.ok(drop.avoid_reasons.includes('excessive_grind'));

  const afterTop3 = app.call('questshelf.recommend.rank', { pool: 'unplayed', limit: 3 }).recommendations.map(r => r.game_id);
  assert.deepEqual(afterTop3, ['game-clockwork-isle', 'game-moss-cartographer', 'game-velvet-cipher']);
});

test('acceptance: Agent-created poll receives prewritten friend_vote omitting poll_id, with rejected no-match controls', () => {
  const app = createHarness();
  // Cannot create second open poll while poll-friday-coop is open
  assert.throws(() => app.call('questshelf.poll.create', {
    title: 'Second Open Poll',
    candidate_game_ids: ['game-orbit-relay'],
    invited_friend_ids: ['friend-alex'],
  }), /open poll already exists/);

  // Close initial open poll -> no-match control when no open poll exists
  app.call('questshelf.poll.close', { poll_id: 'poll-friday-coop' });
  assert.throws(() => app.applyEvent({
    event_id: 'ev-no-open-poll',
    at: '2026-11-20T17:00:00-08:00',
    operation: 'questshelf.poll.friend_vote',
    payload: { friend_id: 'friend-alex', selected_game_ids: ['game-orbit-relay'] },
  }), /No open poll/);

  // Agent creates a new poll with auto-generated poll_id and updates candidates via poll.update
  const created = app.call('questshelf.poll.create', {
    title: 'Saturday Co-Op',
    candidate_game_ids: ['game-orbit-relay'],
    invited_friend_ids: ['friend-alex'],
    max_session_minutes: 90,
    closes_at: '2026-11-21T23:00:00-08:00',
  });
  const pid = created.poll.poll_id;
  assert.equal(created.poll.status, 'open');

  const updatedPoll = app.call('questshelf.poll.update', {
    poll_id: pid,
    candidate_game_ids: ['game-orbit-relay', 'game-ember-kitchen'],
  });
  assert.deepEqual(updatedPoll.poll.candidate_game_ids, ['game-orbit-relay', 'game-ember-kitchen']);

  // Duplicate user vote updates in place
  app.call('questshelf.poll.vote', { poll_id: pid, selected_game_ids: ['game-ember-kitchen'] });
  const revote = app.call('questshelf.poll.vote', {
    poll_id: pid,
    selected_game_ids: ['game-orbit-relay'],
    note: 'Switched vote to Orbit Relay',
  });
  assert.equal(revote.poll.votes.length, 1);

  // No-match controls: uninvited friend and non-candidate game fail atomically
  assert.throws(() => app.applyEvent({
    event_id: 'ev-uninvited-lin',
    at: '2026-11-20T17:30:00-08:00',
    operation: 'questshelf.poll.friend_vote',
    payload: { friend_id: 'friend-lin', selected_game_ids: ['game-orbit-relay'] },
  }), /not invited/);
  assert.throws(() => app.applyEvent({
    event_id: 'ev-bad-game',
    at: '2026-11-20T17:35:00-08:00',
    operation: 'questshelf.poll.friend_vote',
    payload: { friend_id: 'friend-alex', selected_game_ids: ['game-clockwork-isle'] },
  }), /not a poll candidate/);

  // Prewritten event omitting poll_id reaches the Agent-created open poll
  app.applyEvent({
    event_id: 'ev-alex-sat',
    at: '2026-11-20T18:00:00-08:00',
    operation: 'questshelf.poll.friend_vote',
    payload: {
      friend_id: 'friend-alex',
      selected_game_ids: ['game-orbit-relay'],
      note: 'In!',
    },
  });

  const closed = app.call('questshelf.poll.close', { poll_id: pid });
  assert.equal(closed.poll.status, 'closed');
  assert.deepEqual(closed.poll.winner_game_ids, ['game-orbit-relay']);

  // Voting on closed poll fails atomically
  assert.throws(() => app.call('questshelf.poll.vote', {
    poll_id: pid,
    selected_game_ids: ['game-ember-kitchen'],
  }), /closed poll/);
});

test('game.update_patch and friend.library_update events unlock new cross-play match', () => {
  const app = createHarness();
  app.applyEvent({
    event_id: 'ev-patch-boulder',
    at: '2026-11-20T18:10:00-08:00',
    operation: 'questshelf.game.update_patch',
    payload: {
      game_id: 'game-boulder-league',
      cross_play_platforms: ['pc', 'ps5'],
      add_tags: ['cross_play'],
    },
  });
  const res = app.call('questshelf.recommend.rank', {
    pool: 'backlog',
    with_friend_id: 'friend-alex',
    max_session_minutes: 90,
    limit: 10,
  });
  assert.ok(res.recommendations.some(r => r.game_id === 'game-boulder-league'));

  app.applyEvent({
    event_id: 'ev-alex-drop-boulder',
    at: '2026-11-20T18:15:00-08:00',
    operation: 'questshelf.friend.library_update',
    payload: {
      friend_id: 'friend-alex',
      game_id: 'game-boulder-league',
      platform: 'ps5',
      action: 'remove',
    },
  });
  const after = app.call('questshelf.recommend.rank', {
    pool: 'backlog',
    with_friend_id: 'friend-alex',
    max_session_minutes: 90,
    limit: 10,
  });
  assert.ok(!after.recommendations.some(r => r.game_id === 'game-boulder-league'));
});

test('preferences.update rejects unknown game IDs atomically without mutating state', () => {
  const app = createHarness();
  const before = app.call('questshelf.preferences.get').preferences;
  assert.throws(() => app.call('questshelf.preferences.update', {
    not_interested: ['game-does-not-exist'],
  }), /Game not found/);
  const after = app.call('questshelf.preferences.get').preferences;
  assert.deepEqual(after, before);
});

test('poll.list marks polls past closes_at as status=open + voting_expired=true while rejecting late votes', () => {
  const app = createHarness();
  const before = app.call('questshelf.poll.list', { status: 'open' }).polls[0];
  assert.equal(before.status, 'open');
  assert.equal(before.voting_expired, false);

  // Advance virtual_now past closes_at (2026-11-20T22:00:00-08:00) without calling poll.close
  app.advanceTime('2026-11-20T22:05:00-08:00');
  const after = app.call('questshelf.poll.list', { status: 'open' }).polls[0];
  assert.equal(after.status, 'open');
  assert.equal(after.voting_expired, true);

  // Late agent vote and late friend_vote event both reject atomically
  assert.throws(() => app.call('questshelf.poll.vote', {
    poll_id: 'poll-friday-coop',
    selected_game_ids: ['game-orbit-relay'],
  }), /closing time has passed/);
  assert.throws(() => app.applyEvent({
    event_id: 'ev-late-alex',
    at: '2026-11-20T22:10:00-08:00',
    operation: 'questshelf.poll.friend_vote',
    payload: { friend_id: 'friend-alex', selected_game_ids: ['game-orbit-relay'] },
  }), /closing time has passed/);

  // Explicit poll.close still finalizes and tallies existing votes cleanly
  const closed = app.call('questshelf.poll.close', { poll_id: 'poll-friday-coop' });
  assert.equal(closed.poll.status, 'closed');
  assert.deepEqual(closed.poll.winner_game_ids, ['game-ember-kitchen', 'game-orbit-relay']);
});

test('second seed fixture (seed-casual.json) and evaluation visual-cues manifest validate cleanly', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const plugin = require('../plugin.cjs');
  const { compile } = require('./schema-validator.cjs');
  const root = path.resolve(__dirname, '..');
  const seedValidator = compile(JSON.parse(fs.readFileSync(path.join(root, 'schemas/seed.schema.json'), 'utf8')), path.join(root, 'schemas'));
  const casual = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/seed-casual.json'), 'utf8'));
  const binding = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/binding.json'), 'utf8'));
  assert.equal(seedValidator(casual), true);
  plugin.validateSeed({ binding }, casual);

  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'contribution/assets.catalog.json'), 'utf8'));
  const cues = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/visual-cues.eval.json'), 'utf8'));
  const minimal = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/minimal.json'), 'utf8'));
  assert.equal(cues.cues.length, catalog.assets.length);
  for (const cue of cues.cues) {
    const cat = catalog.assets.find(a => a.asset_id === cue.asset_id);
    const game = minimal.games.find(g => g.id === cue.game_id);
    assert.equal(cue.sha256, cat.integrity.sha256);
    assert.equal(cue.hud_font_pt, game.hud_font_pt);
    assert.equal(cue.handheld_hud_readable, game.hud_font_pt >= 14);
    assert.ok(!game.summary.toLowerCase().includes('inspect preview card'), 'Summary must stay neutral');
  }
  const trap = cues.cues.find(c => c.game_id === 'game-lantern-hollow');
  assert.equal(trap.camera_perspective, 'first_person');
  assert.equal(trap.horror_visual_cues, true);
  assert.equal(trap.visual_trap, 'unlabeled_first_person_horror');

  // Full 2025-2026 evaluation dataset validates cleanly, covers all 24 months, and maintains poll/ownership consistency
  const evalSeed = JSON.parse(fs.readFileSync(path.join(root, 'datasets/eval-2025-2026/seed.json'), 'utf8'));
  assert.equal(seedValidator(evalSeed), true);
  plugin.validateSeed({ binding }, evalSeed);
  const { computeCoverage } = require('../scripts/coverage.cjs');
  const cov = computeCoverage('datasets/eval-2025-2026/seed.json');
  assert.equal(cov.user_activity_summary.months_covered, 24);
  assert.equal(cov.user_activity_summary.total_events, cov.user_activity_summary.unique_timestamps);
  assert.equal(cov.out_of_window_or_invalid_records, 0);

  const mayaOwnedAt = new Map(evalSeed.shelves.map(s => [s.game_id, Date.parse(s.play_history[0].at)]));
  const friendMap = new Map(evalSeed.friends.map(f => [f.friend_id, f]));
  for (const p of evalSeed.polls) {
    const cMs = Date.parse(p.created_at);
    for (const cid of p.candidate_game_ids) {
      assert.ok(mayaOwnedAt.get(cid) <= cMs, `Maya must own ${cid} before ${p.poll_id}`);
      for (const fid of p.invited_friend_ids) {
        const og = friendMap.get(fid).owned_games.find(x => x.game_id === cid);
        assert.ok(og && Date.parse(og.added_at) <= cMs, `${fid} must own ${cid} before ${p.poll_id}`);
      }
    }
  }
});

test('game.update_patch add_asset_id syncs game.get asset_ids, resource_uris, and plugin.assetReferences', () => {
  const plugin = require('../plugin.cjs');
  const app = createHarness();
  app.applyEvent({
    event_id: 'ev-patch-add-asset',
    at: '2026-11-20T18:20:00-08:00',
    operation: 'questshelf.game.update_patch',
    payload: {
      game_id: 'game-clockwork-isle',
      add_asset_id: 'asset-preview-game-clockwork-isle-hud-v2',
    },
  });
  const detail = app.call('questshelf.game.get', { game_id: 'game-clockwork-isle' });
  assert.ok(detail.game.asset_ids.includes('asset-preview-game-clockwork-isle-hud-v2'));
  assert.ok(detail.resource_uris.includes('pale://test-run/questshelf/assets/asset-preview-game-clockwork-isle-hud-v2'));
  const refs = plugin.assetReferences(app.getData());
  assert.ok(refs.some(r => r.object_id === 'game-clockwork-isle' && r.asset_id === 'asset-preview-game-clockwork-isle-hud-v2'));
});

test('undoing a drop restores active avoid_reasons and original Top-3 ranking', () => {
  const app = createHarness();
  const initialTop3 = app.call('questshelf.recommend.rank', { pool: 'unplayed', limit: 3 }).recommendations.map(r => r.game_id);
  assert.deepEqual(initialTop3, ['game-iron-sovereign', 'game-clockwork-isle', 'game-frost-protocol']);

  app.call('questshelf.shelf.upsert', {
    game_id: 'game-ashen-depths',
    status: 'dropped',
    drop_reasons: ['tiny_ui_text', 'excessive_grind'],
    note: 'Temporarily dropped.',
  });
  const droppedTop3 = app.call('questshelf.recommend.rank', { pool: 'unplayed', limit: 3 }).recommendations.map(r => r.game_id);
  assert.deepEqual(droppedTop3, ['game-clockwork-isle', 'game-moss-cartographer', 'game-velvet-cipher']);

  // Restore game-ashen-depths back to playing -> drop_reasons cleared -> Top-3 restored
  const restored = app.call('questshelf.shelf.upsert', {
    game_id: 'game-ashen-depths',
    status: 'playing',
    note: 'Giving it another shot after UI scaling patch.',
  });
  assert.deepEqual(restored.entry.drop_reasons, []);
  assert.ok(!restored.avoid_reasons.includes('tiny_ui_text'));
  assert.ok(!restored.avoid_reasons.includes('excessive_grind'));

  const restoredTop3 = app.call('questshelf.recommend.rank', { pool: 'unplayed', limit: 3 }).recommendations.map(r => r.game_id);
  assert.deepEqual(restoredTop3, initialTop3);
});

test('events reject unknown fields and out-of-range payload values atomically', () => {
  const plugin = require('../plugin.cjs');
  const app = createHarness();
  const beforeRev = app.version().revision;

  // Out-of-range hud_font_pt rejected by schema and handler
  assert.throws(() => app.applyEvent({
    event_id: 'ev-bad-hud',
    at: '2026-11-20T18:30:00-08:00',
    operation: 'questshelf.game.update_patch',
    payload: { game_id: 'game-clockwork-isle', hud_font_pt: 99 },
  }));

  // Misspelled field rejected by schema and handler
  assert.throws(() => app.applyEvent({
    event_id: 'ev-typo-field',
    at: '2026-11-20T18:31:00-08:00',
    operation: 'questshelf.game.update_patch',
    payload: { game_id: 'game-clockwork-isle', offline_okk: false },
  }));

  // Direct plugin.applyEvent also rejects unknown field & out-of-range hud_font_pt with invalid_event
  const snap = app.getData();
  assert.throws(() => plugin.applyEvent({ log: () => {} }, structuredClone(snap), {
    event_id: 'ev-direct-bad-hud',
    at: '2026-11-20T18:32:00-08:00',
    operation: 'questshelf.game.update_patch',
    payload: { game_id: 'game-clockwork-isle', hud_font_pt: 99 },
  }), err => err.code === 'invalid_event');
  assert.throws(() => plugin.applyEvent({ log: () => {} }, structuredClone(snap), {
    event_id: 'ev-direct-typo',
    at: '2026-11-20T18:33:00-08:00',
    operation: 'questshelf.game.update_patch',
    payload: { game_id: 'game-clockwork-isle', offline_okk: false },
  }), err => err.code === 'invalid_event');

  assert.equal(app.version().revision, beforeRev);
});

test('recommend.rank ignores unrated completed games for liked tags, honors too_long/no_offline_mode, and shelf.upsert rejects invalid completed->backlog transition', () => {
  const app = createHarness();
  // Invalid transition: completed -> backlog rejects atomically
  assert.throws(() => app.call('questshelf.shelf.upsert', {
    game_id: 'game-pebble-harbor',
    status: 'backlog',
  }), /Cannot transition a completed game back to backlog/);

  // Completed game with rating: null does NOT contribute liked tags
  app.call('questshelf.shelf.upsert', {
    game_id: 'game-starlight-tactics',
    status: 'completed',
    hours_logged: 12,
    rating: null,
    note: 'Finished without rating.',
  });
  const glyphRec = app.call('questshelf.recommend.rank', { pool: 'unplayed', limit: 20 })
    .recommendations.find(r => r.game_id === 'game-glyph-forge');
  assert.ok(!glyphRec.reasons.some(r => r.includes('turn_based') || r.includes('tactical')));

  // too_long and no_offline_mode avoid reasons filter out >20h and online-only games
  app.call('questshelf.preferences.update', {
    avoid_reasons: ['first_person_motion_sickness', 'horror', 'too_long', 'no_offline_mode'],
  });
  const filtered = app.call('questshelf.recommend.rank', { pool: 'unplayed', limit: 20 }).recommendations;
  assert.ok(filtered.every(r => r.main_hours <= 20 && r.offline_ok === true));
  assert.ok(!filtered.some(r => r.game_id === 'game-iron-sovereign' || r.game_id === 'game-orbit-relay'));
});

test('play_history enforces rolling 100-entry cap and blocks completed->playing->backlog bypass', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const plugin = require('../plugin.cjs');
  const { compile } = require('./schema-validator.cjs');
  const root = path.resolve(__dirname, '..');
  const seedValidator = compile(JSON.parse(fs.readFileSync(path.join(root, 'schemas/seed.schema.json'), 'utf8')), path.join(root, 'schemas'));
  const binding = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/binding.json'), 'utf8'));
  let data = JSON.parse(fs.readFileSync(path.join(root, 'datasets/eval-2025-2026/seed.json'), 'utf8'));

  // Completed game (game-pebble-harbor) can transition to playing for a replay,
  // but cannot bypass into backlog because play_history records prior completion
  const ctxReplay = { run_id: 'cap-test', app_id: 'questshelf', virtual_now: '2026-12-31T23:01:00-08:00', binding, log: () => {} };
  let out = plugin.handleTool(ctxReplay, data, 'questshelf.shelf.upsert', {
    game_id: 'game-pebble-harbor',
    status: 'playing',
    note: 'Starting replay.',
  });
  data = out.data;
  assert.throws(() => plugin.handleTool(
    { ...ctxReplay, virtual_now: '2026-12-31T23:02:00-08:00' },
    structuredClone(data),
    'questshelf.shelf.upsert',
    { game_id: 'game-pebble-harbor', status: 'backlog' }
  ), /Cannot transition a completed game back to backlog/);

  // 105 consecutive shelf.upsert updates stay valid under the 100-entry rolling play_history cap
  let hrs = 10.0;
  for (let i = 0; i < 105; i++) {
    hrs += 0.1;
    const sec = String(i % 60).padStart(2, '0');
    const min = String(Math.floor(i / 60)).padStart(2, '0');
    const c = { ...ctxReplay, virtual_now: `2027-01-01T00:${min}:${sec}-08:00` };
    out = plugin.handleTool(c, data, 'questshelf.shelf.upsert', {
      game_id: 'game-moss-cartographer',
      status: 'playing',
      hours_logged: Math.round(hrs * 10) / 10,
      note: `Session #${i + 1}`,
    });
    data = out.data;
  }
  const moss = data.shelves.find(s => s.game_id === 'game-moss-cartographer');
  assert.equal(moss.play_history.length, 100);
  assert.equal(moss.play_history[99].note, 'Session #105');
  assert.equal(seedValidator(data), true);
  plugin.validateSeed(ctxReplay, data);
});
