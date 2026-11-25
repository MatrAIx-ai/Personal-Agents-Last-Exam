'use strict';
function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  throw err;
}

function copy(v) { return structuredClone(v); }

function shelfMap(data) {
  const m = new Map();
  for (const s of data.shelves) m.set(s.game_id, s);
  return m;
}

function activeAvoidReasons(data) {
  const set = new Set(data.preferences.avoid_reasons || []);
  for (const s of data.shelves) {
    if (s.status === 'dropped') {
      for (const r of (s.drop_reasons || [])) set.add(r);
    }
  }
  return set;
}

function canCrossPlayWithFriend(game, userPlatforms, friendOwnedPlatforms) {
  if ((game.coop_max_players || 1) < 2) return false;
  for (const up of userPlatforms) {
    for (const fp of friendOwnedPlatforms) {
      if (up === fp) return true;
      if (game.cross_play_platforms.includes(up) && game.cross_play_platforms.includes(fp)) return true;
    }
  }
  return false;
}

function validateSeed(ctx, data) {
  const accOk = ctx.binding.accounts.some(a => a.app_id === 'questshelf' && a.account_id === data.account_id && a.owner_person_id === data.owner_person_id);
  if (!accOk) fail('invalid_seed', 'Account or owner_person_id not bound in task binding.');

  const gameIds = new Set();
  for (const g of data.games) {
    if (gameIds.has(g.id)) fail('invalid_seed', 'Duplicate game ID: ' + g.id);
    gameIds.add(g.id);
    if (g.playtime_hours.main > g.playtime_hours.main_extra || g.playtime_hours.main_extra > g.playtime_hours.completionist) {
      fail('invalid_seed', 'Invalid playtime ordering for ' + g.id);
    }
    for (const cp of g.cross_play_platforms) {
      if (!g.platforms.includes(cp)) fail('invalid_seed', 'Cross-play platform not in game platforms for ' + g.id);
    }
  }

  const shelfIds = new Set();
  for (const s of data.shelves) {
    if (!gameIds.has(s.game_id) || shelfIds.has(s.game_id)) fail('invalid_seed', 'Invalid or duplicate shelf game_id: ' + s.game_id);
    shelfIds.add(s.game_id);
  }

  for (const nid of data.preferences.not_interested) {
    if (!gameIds.has(nid)) fail('invalid_seed', 'Unknown not_interested game_id: ' + nid);
  }

  const friendIds = new Set();
  for (const f of data.friends) {
    if (friendIds.has(f.friend_id)) fail('invalid_seed', 'Duplicate friend_id: ' + f.friend_id);
    friendIds.add(f.friend_id);
    for (const og of f.owned_games) {
      if (!gameIds.has(og.game_id)) fail('invalid_seed', 'Friend owns unknown game_id: ' + og.game_id);
      if (!f.platforms.includes(og.platform)) fail('invalid_seed', 'Friend game platform mismatch: ' + f.friend_id);
    }
  }

  const pollIds = new Set();
  let openPolls = 0;
  for (const p of data.polls) {
    if (pollIds.has(p.poll_id)) fail('invalid_seed', 'Duplicate poll_id: ' + p.poll_id);
    pollIds.add(p.poll_id);
    if (p.status === 'open') openPolls += 1;
    for (const cid of p.candidate_game_ids) {
      if (!gameIds.has(cid)) fail('invalid_seed', 'Poll references unknown game_id: ' + cid);
    }
    for (const fid of p.invited_friend_ids) {
      if (!friendIds.has(fid)) fail('invalid_seed', 'Poll references unknown friend_id: ' + fid);
    }
  }
  if (openPolls > 1) fail('invalid_seed', 'At most one open poll is allowed per account.');
}

function assetReferences(data) {
  return data.games.flatMap(g =>
    [...new Set(g.asset_ids || [])].map(asset_id => ({ asset_id, object_id: g.id, object_type: 'game' }))
  );
}

module.exports = {
  fail,
  copy,
  shelfMap,
  activeAvoidReasons,
  canCrossPlayWithFriend,
  validateSeed,
  records: data => data.games,
  objects: data => data.games.map(g => g.id),
  references: () => [],
  assetReferences,
};
