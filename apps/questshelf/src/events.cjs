'use strict';
const { fail, copy } = require('./model.cjs');
const { log } = require('./diagnostics.cjs');

function applyEvent(ctx, data, event) {
  const { operation, payload, at } = event;

  if (operation === 'questshelf.game.update_patch') {
    const game = data.games.find(g => g.id === payload.game_id);
    if (!game) fail('not_found', 'Unknown game_id in patch event: ' + payload.game_id);
    if (Array.isArray(payload.cross_play_platforms)) {
      for (const cp of payload.cross_play_platforms) {
        if (!game.platforms.includes(cp)) fail('invalid_arguments', 'Cross-play platform not supported by game: ' + cp);
      }
      game.cross_play_platforms = copy(payload.cross_play_platforms);
    }
    if (typeof payload.offline_ok === 'boolean') game.offline_ok = payload.offline_ok;
    if (Number.isInteger(payload.hud_font_pt) && payload.hud_font_pt >= 6 && payload.hud_font_pt <= 36) {
      game.hud_font_pt = payload.hud_font_pt;
    }
    if (Array.isArray(payload.add_tags)) {
      game.tags = [...new Set([...game.tags, ...payload.add_tags])];
    }
    if (typeof payload.add_asset_id === 'string' && payload.add_asset_id.length > 0) {
      game.asset_ids = [...new Set([...game.asset_ids, payload.add_asset_id])];
    }
    game.updated_at = at;
    log(ctx, 'event.game.update_patch', { game_id: game.id });
    return data;
  }

  if (operation === 'questshelf.friend.library_update') {
    const friend = data.friends.find(f => f.friend_id === payload.friend_id);
    if (!friend) fail('not_found', 'Unknown friend_id: ' + payload.friend_id);
    const game = data.games.find(g => g.id === payload.game_id);
    if (!game) fail('not_found', 'Unknown game_id: ' + payload.game_id);
    if (!friend.platforms.includes(payload.platform) || !game.platforms.includes(payload.platform)) {
      fail('invalid_arguments', 'Invalid platform for friend or game.');
    }
    const idx = friend.owned_games.findIndex(og => og.game_id === payload.game_id && og.platform === payload.platform);
    if (payload.action === 'add') {
      if (idx < 0) friend.owned_games.push({ game_id: payload.game_id, platform: payload.platform });
    } else if (payload.action === 'remove') {
      if (idx >= 0) friend.owned_games.splice(idx, 1);
    } else {
      fail('invalid_arguments', 'action must be add or remove.');
    }
    log(ctx, 'event.friend.library_update', { friend_id: friend.friend_id, game_id: payload.game_id, action: payload.action });
    return data;
  }

  if (operation === 'questshelf.poll.friend_vote') {
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
    if (!Array.isArray(payload.selected_game_ids)) fail('invalid_event', 'selected_game_ids array required.');
    for (const gid of payload.selected_game_ids) {
      if (!poll.candidate_game_ids.includes(gid)) fail('invalid_event', 'Selected game is not a poll candidate: ' + gid);
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
