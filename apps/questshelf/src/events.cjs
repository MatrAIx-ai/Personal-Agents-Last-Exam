'use strict';
const { fail, copy } = require('./model.cjs');
const { log } = require('./diagnostics.cjs');

const UPDATE_PATCH_KEYS = new Set(['game_id', 'cross_play_platforms', 'offline_ok', 'hud_font_pt', 'add_tags', 'add_asset_id']);
const FRIEND_LIB_KEYS = new Set(['friend_id', 'game_id', 'platform', 'action']);
const FRIEND_VOTE_KEYS = new Set(['poll_id', 'friend_id', 'selected_game_ids', 'note']);

function assertAllowedKeys(payload, allowed, op) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    fail('invalid_event', `Event payload must be an object for ${op}.`);
  }
  for (const key of Object.keys(payload)) {
    if (!allowed.has(key)) {
      fail('invalid_event', `Unknown field "${key}" in ${op} payload.`);
    }
  }
}

function applyEvent(ctx, data, event) {
  const { operation, payload, at } = event;

  if (operation === 'questshelf.game.update_patch') {
    assertAllowedKeys(payload, UPDATE_PATCH_KEYS, operation);
    if (typeof payload.game_id !== 'string' || payload.game_id.length === 0) {
      fail('invalid_event', 'game_id is required for questshelf.game.update_patch.');
    }
    const game = data.games.find(g => g.id === payload.game_id);
    if (!game) fail('not_found', 'Unknown game_id in patch event: ' + payload.game_id);

    const hasPatchField = ['cross_play_platforms', 'offline_ok', 'hud_font_pt', 'add_tags', 'add_asset_id']
      .some(k => Object.hasOwn(payload, k));
    if (!hasPatchField) {
      fail('invalid_event', 'questshelf.game.update_patch requires at least one patch field.');
    }

    if (Object.hasOwn(payload, 'cross_play_platforms')) {
      if (!Array.isArray(payload.cross_play_platforms)) {
        fail('invalid_event', 'cross_play_platforms must be an array.');
      }
      for (const cp of payload.cross_play_platforms) {
        if (!game.platforms.includes(cp)) fail('invalid_event', 'Cross-play platform not supported by game: ' + cp);
      }
      game.cross_play_platforms = copy(payload.cross_play_platforms);
    }
    if (Object.hasOwn(payload, 'offline_ok')) {
      if (typeof payload.offline_ok !== 'boolean') {
        fail('invalid_event', 'offline_ok must be a boolean.');
      }
      game.offline_ok = payload.offline_ok;
    }
    if (Object.hasOwn(payload, 'hud_font_pt')) {
      if (!Number.isInteger(payload.hud_font_pt) || payload.hud_font_pt < 6 || payload.hud_font_pt > 36) {
        fail('invalid_event', 'hud_font_pt must be an integer between 6 and 36.');
      }
      game.hud_font_pt = payload.hud_font_pt;
    }
    if (Object.hasOwn(payload, 'add_tags')) {
      if (!Array.isArray(payload.add_tags) || !payload.add_tags.every(t => typeof t === 'string' && t.length > 0 && t.length <= 60)) {
        fail('invalid_event', 'add_tags must be an array of non-empty strings.');
      }
      game.tags = [...new Set([...game.tags, ...payload.add_tags])];
    }
    if (Object.hasOwn(payload, 'add_asset_id')) {
      if (typeof payload.add_asset_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(payload.add_asset_id)) {
        fail('invalid_event', 'add_asset_id must match the asset ID pattern.');
      }
      game.asset_ids = [...new Set([...game.asset_ids, payload.add_asset_id])];
    }
    game.updated_at = at;
    log(ctx, 'event.game.update_patch', { game_id: game.id });
    return data;
  }

  if (operation === 'questshelf.friend.library_update') {
    assertAllowedKeys(payload, FRIEND_LIB_KEYS, operation);
    const friend = data.friends.find(f => f.friend_id === payload.friend_id);
    if (!friend) fail('not_found', 'Unknown friend_id: ' + payload.friend_id);
    const game = data.games.find(g => g.id === payload.game_id);
    if (!game) fail('not_found', 'Unknown game_id: ' + payload.game_id);
    if (!friend.platforms.includes(payload.platform) || !game.platforms.includes(payload.platform)) {
      fail('invalid_event', 'Invalid platform for friend or game.');
    }
    const idx = friend.owned_games.findIndex(og => og.game_id === payload.game_id && og.platform === payload.platform);
    if (payload.action === 'add') {
      if (idx < 0) friend.owned_games.push({ game_id: payload.game_id, platform: payload.platform, added_at: at });
    } else if (payload.action === 'remove') {
      if (idx >= 0) friend.owned_games.splice(idx, 1);
    } else {
      fail('invalid_event', 'action must be add or remove.');
    }
    log(ctx, 'event.friend.library_update', { friend_id: friend.friend_id, game_id: payload.game_id, action: payload.action });
    return data;
  }

  if (operation === 'questshelf.poll.friend_vote') {
    assertAllowedKeys(payload, FRIEND_VOTE_KEYS, operation);
    const friend = data.friends.find(f => f.friend_id === payload.friend_id);
    if (!friend) fail('invalid_event', 'Unknown friend_id: ' + payload.friend_id);
    let poll;
    if (payload.poll_id) {
      poll = data.polls.find(p => p.poll_id === payload.poll_id);
      if (!poll) fail('invalid_event', 'Unknown poll_id: ' + payload.poll_id);
    } else {
      poll = data.polls.find(p => p.status === 'open');
      if (!poll) fail('invalid_event', 'No open poll found for account.');
    }
    if (poll.status !== 'open') fail('invalid_event', 'Cannot record friend vote on closed poll.');
    if (poll.closes_at && Date.parse(at) > Date.parse(poll.closes_at)) {
      fail('invalid_event', 'Poll closing time has passed.');
    }
    if (!poll.invited_friend_ids.includes(friend.friend_id)) {
      fail('invalid_event', 'Friend is not invited to this poll: ' + friend.friend_id);
    }
    if (!Array.isArray(payload.selected_game_ids) || payload.selected_game_ids.length === 0) {
      fail('invalid_event', 'selected_game_ids non-empty array required.');
    }
    for (const gid of payload.selected_game_ids) {
      if (!poll.candidate_game_ids.includes(gid)) fail('invalid_event', 'Selected game is not a poll candidate: ' + gid);
    }
    if (Object.hasOwn(payload, 'note') && typeof payload.note !== 'string') {
      fail('invalid_event', 'note must be a string.');
    }
    const existing = poll.votes.find(v => v.voter_id === friend.friend_id);
    if (existing) {
      existing.selected_game_ids = copy(payload.selected_game_ids);
      existing.note = payload.note || '';
      existing.voted_at = at;
    } else {
      poll.votes.push({
        voter_id: friend.friend_id,
        selected_game_ids: copy(payload.selected_game_ids),
        note: payload.note || '',
        voted_at: at,
      });
    }
    log(ctx, 'event.poll.friend_vote', { poll_id: poll.poll_id, friend_id: friend.friend_id });
    return data;
  }

  fail('invalid_event', 'Unsupported QuestShelf event operation: ' + operation);
}

module.exports = { applyEvent };
