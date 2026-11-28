'use strict';
const { fail, copy, shelfMap, activeAvoidReasons, canCrossPlayWithFriend } = require('./model.cjs');
const { log } = require('./diagnostics.cjs');

function findGame(data, gameId) {
  const g = data.games.find(x => x.id === gameId);
  if (!g) fail('not_found', 'Game not found: ' + gameId);
  return g;
}

function findPoll(data, pollId) {
  const p = data.polls.find(x => x.poll_id === pollId);
  if (!p) fail('not_found', 'Poll not found: ' + pollId);
  return p;
}

function handleTool(ctx, data, name, args) {
  if (name === 'questshelf.catalog.search') {
    const sMap = shelfMap(data);
    const muted = new Set(data.preferences.muted_tags || []);
    const notInterested = new Set(data.preferences.not_interested || []);
    const q = (args.query || '').toLocaleLowerCase();

    const items = data.games.filter(g => {
      const shelf = sMap.get(g.id);
      if (args.owned_only && !shelf) return false;
      if (args.shelf_status && (!shelf || shelf.status !== args.shelf_status)) return false;
      if (args.platform) {
        if (args.owned_only || args.shelf_status) {
          if (!shelf || !shelf.owned_platforms.includes(args.platform)) return false;
        } else if (!g.platforms.includes(args.platform)) {
          return false;
        }
      }
      if (args.genre && g.genre !== args.genre) return false;
      if (args.tag && !g.tags.includes(args.tag)) return false;
      if (args.max_hours !== undefined && g.playtime_hours.main > args.max_hours) return false;
      if (args.max_session_minutes !== undefined && g.typical_session_minutes > args.max_session_minutes) return false;
      if (args.offline_ok !== undefined && g.offline_ok !== args.offline_ok) return false;
      if (args.min_coop_players !== undefined && g.coop_max_players < args.min_coop_players) return false;
      if (args.cross_play_platforms) {
        if (!args.cross_play_platforms.every(p => g.cross_play_platforms.includes(p))) return false;
      }
      if (args.exclude_muted) {
        if (notInterested.has(g.id)) return false;
        if (g.tags.some(t => muted.has(t))) return false;
      }
      if (q) {
        const hay = `${g.id} ${g.title} ${g.genre} ${g.summary} ${g.tags.join(' ')}`.toLocaleLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }).map(g => ({
      ...copy(g),
      shelf_status: sMap.has(g.id) ? sMap.get(g.id).status : null,
      owned_platforms: sMap.has(g.id) ? copy(sMap.get(g.id).owned_platforms) : [],
    })).sort((a, b) => b.critic_rating - a.critic_rating || a.id.localeCompare(b.id));

    log(ctx, 'questshelf.catalog.search', { count: items.length });
    return { data, result: { items } };
  }

  if (name === 'questshelf.game.get') {
    const g = findGame(data, args.game_id);
    const shelf = data.shelves.find(s => s.game_id === g.id) || null;
    const runId = ctx.run_id || 'demo';
    const resource_uris = (g.asset_ids || []).map(aid => `pale://${runId}/questshelf/assets/${aid}`);
    return { data, result: { game: copy(g), shelf_entry: shelf ? copy(shelf) : null, resource_uris } };
  }

  if (name === 'questshelf.asset.read') {
    const g = findGame(data, args.game_id);
    if (!g.asset_ids.includes(args.asset_id)) fail('not_available', 'Asset does not belong to this game.');
    if (!ctx.assets?.read) fail('unsupported_capability', 'Asset reader is required.');
    return { data, result: { file: ctx.assets.read(args.asset_id) } };
  }

  if (name === 'questshelf.shelf.list') {
    let list = data.shelves.map(copy);
    if (args.status) list = list.filter(s => s.status === args.status);
    list.sort((a, b) => a.game_id.localeCompare(b.game_id));
    return { data, result: { shelves: list } };
  }

  if (name === 'questshelf.preferences.get') {
    return { data, result: { preferences: copy(data.preferences) } };
  }

  if (name === 'questshelf.recommend.rank') {
    const pool = args.pool || 'unplayed';
    const limit = args.limit || 5;
    const sMap = shelfMap(data);
    const muted = new Set(data.preferences.muted_tags || []);
    const notInterested = new Set(data.preferences.not_interested || []);
    const avoid = activeAvoidReasons(data);
    const minHud = data.preferences.min_hud_font_pt;

    let friend = null;
    const friendGamePlatforms = new Map();
    if (args.with_friend_id) {
      friend = data.friends.find(f => f.friend_id === args.with_friend_id);
      if (!friend) fail('not_found', 'Friend not found: ' + args.with_friend_id);
      for (const og of friend.owned_games) {
        if (!friendGamePlatforms.has(og.game_id)) friendGamePlatforms.set(og.game_id, []);
        friendGamePlatforms.get(og.game_id).push(og.platform);
      }
    }

    // Positive tag signals from completed games rated >= 8.0
    const likedTags = new Set();
    for (const s of data.shelves) {
      if (s.status === 'completed' && typeof s.rating === 'number' && s.rating >= 8) {
        const g = data.games.find(x => x.id === s.game_id);
        if (g) for (const t of g.tags) likedTags.add(t);
      }
    }

    const candidates = [];
    for (const g of data.games) {
      const shelf = sMap.get(g.id);
      if (notInterested.has(g.id)) continue;
      if (shelf && (shelf.status === 'dropped' || shelf.status === 'completed')) continue;

      if (pool === 'backlog' && (!shelf || shelf.status !== 'backlog')) continue;
      if (pool === 'unplayed' && shelf && shelf.status === 'playing') continue;

      if (args.platform) {
        if (pool === 'backlog' || args.with_friend_id) {
          if (!shelf || !shelf.owned_platforms.includes(args.platform)) continue;
        } else if (!g.platforms.includes(args.platform)) {
          continue;
        }
      }
      if (args.max_hours !== undefined && g.playtime_hours.main > args.max_hours) continue;
      if (args.max_session_minutes !== undefined && g.typical_session_minutes > args.max_session_minutes) continue;
      if (args.offline_ok !== undefined && g.offline_ok !== args.offline_ok) continue;

      if (friend) {
        if (!shelf) continue;
        const fPlats = friendGamePlatforms.get(g.id);
        if (!fPlats || !canCrossPlayWithFriend(g, shelf.owned_platforms, fPlats)) continue;
      }

      // Hard negative filters from muted tags & active drop reasons
      if (g.tags.some(t => muted.has(t))) continue;
      if (avoid.has('first_person_motion_sickness') && g.tags.includes('first_person')) continue;
      if (avoid.has('horror') && g.tags.includes('horror')) continue;
      if (avoid.has('excessive_grind') && g.tags.includes('excessive_grind')) continue;
      if (avoid.has('tiny_ui_text') && (g.tags.includes('tiny_ui_text') || g.hud_font_pt < 12)) continue;
      if (avoid.has('too_long') && g.playtime_hours.main > 20) continue;
      if (avoid.has('no_offline_mode') && !g.offline_ok) continue;

      let score = g.critic_rating;
      const reasons = [];
      const matchedLiked = g.tags.filter(t => likedTags.has(t));
      if (matchedLiked.length > 0) {
        score += Math.min(0.6, matchedLiked.length * 0.2);
        reasons.push('matches_liked_tags:' + matchedLiked.join(','));
      }
      if (minHud !== null && minHud !== undefined && g.hud_font_pt >= minHud) {
        score += 0.35;
        reasons.push('readable_hud');
      } else if (minHud !== null && minHud !== undefined && g.hud_font_pt < minHud) {
        score -= 1.2;
        reasons.push('below_hud_pref');
      }
      if (shelf && shelf.status === 'backlog') {
        score += 0.25;
        reasons.push('already_owned_backlog');
      }
      if (friend) {
        reasons.push('cross_play_with:' + friend.friend_id);
      }

      candidates.push({
        game_id: g.id,
        title: g.title,
        genre: g.genre,
        score: Math.round(score * 100) / 100,
        main_hours: g.playtime_hours.main,
        typical_session_minutes: g.typical_session_minutes,
        hud_font_pt: g.hud_font_pt,
        offline_ok: g.offline_ok,
        asset_ids: copy(g.asset_ids),
        shelf_status: shelf ? shelf.status : null,
        reasons,
      });
    }

    candidates.sort((a, b) => b.score - a.score || a.game_id.localeCompare(b.game_id));
    log(ctx, 'questshelf.recommend.rank', { pool, returned: Math.min(limit, candidates.length) });
    return { data, result: { recommendations: candidates.slice(0, limit) } };
  }

  if (name === 'questshelf.friends.list') {
    return { data, result: { friends: data.friends.map(copy) } };
  }

  if (name === 'questshelf.poll.list') {
    const nowMs = Date.parse(ctx.virtual_now);
    let list = data.polls.map(p => ({
      ...copy(p),
      voting_expired: p.status === 'open' && p.closes_at !== null && Number.isFinite(nowMs) && nowMs > Date.parse(p.closes_at),
    }));
    if (args.status) list = list.filter(p => p.status === args.status);
    return { data, result: { polls: list } };
  }

  if (name === 'questshelf.shelf.upsert') {
    const g = findGame(data, args.game_id);
    const existing = data.shelves.find(s => s.game_id === args.game_id);
    const owned = args.owned_platforms || (existing ? existing.owned_platforms : [g.platforms[0]]);
    for (const p of owned) {
      if (!g.platforms.includes(p)) fail('invalid_arguments', `Game ${g.id} is not available on platform ${p}.`);
    }
    const dropReasons = args.drop_reasons !== undefined ? copy(args.drop_reasons) : (existing ? copy(existing.drop_reasons) : []);
    if (args.status !== 'dropped' && args.drop_reasons && args.drop_reasons.length > 0) {
      fail('invalid_arguments', 'drop_reasons may only be supplied when status is dropped.');
    }
    const everCompleted = existing && (
      existing.status === 'completed' ||
      (Array.isArray(existing.play_history) && existing.play_history.some(h => h.status === 'completed'))
    );
    if (everCompleted && args.status === 'backlog') {
      fail('invalid_state', 'Cannot transition a completed game back to backlog.');
    }
    if (args.status === 'backlog' && args.rating !== undefined && args.rating !== null) {
      fail('invalid_arguments', 'Cannot set a rating on a backlog entry.');
    }

    const MAX_PLAY_HISTORY = 100;
    let entry;
    if (existing) {
      existing.status = args.status;
      existing.owned_platforms = copy(owned);
      if (args.hours_logged !== undefined) existing.hours_logged = args.hours_logged;
      if (args.rating !== undefined) existing.rating = args.rating;
      else if (args.status === 'backlog') existing.rating = null;
      existing.drop_reasons = args.status === 'dropped' ? dropReasons : [];
      if (args.note !== undefined) existing.note = args.note;
      existing.updated_at = ctx.virtual_now;
      if (Array.isArray(existing.play_history)) {
        if (existing.play_history.length >= MAX_PLAY_HISTORY) {
          existing.play_history = existing.play_history.slice(-(MAX_PLAY_HISTORY - 1));
        }
        existing.play_history.push({
          at: ctx.virtual_now,
          status: existing.status,
          hours_logged: existing.hours_logged,
          rating: existing.rating,
          drop_reasons: copy(existing.drop_reasons),
          note: existing.note,
        });
      }
      entry = existing;
    } else {
      entry = {
        game_id: args.game_id,
        status: args.status,
        owned_platforms: copy(owned),
        hours_logged: args.hours_logged !== undefined ? args.hours_logged : 0,
        rating: args.rating !== undefined ? args.rating : null,
        drop_reasons: args.status === 'dropped' ? dropReasons : [],
        note: args.note || '',
        updated_at: ctx.virtual_now,
      };
      data.shelves.push(entry);
    }

    log(ctx, 'questshelf.shelf.upsert', { game_id: args.game_id, status: args.status });
    return { data, result: { entry: copy(entry), avoid_reasons: [...activeAvoidReasons(data)] } };
  }

  if (name === 'questshelf.preferences.update') {
    const hasAny = ['preferred_platforms', 'muted_tags', 'not_interested', 'avoid_reasons', 'min_hud_font_pt']
      .some(k => Object.hasOwn(args, k));
    if (!hasAny) fail('invalid_arguments', 'Provide at least one preference field to update.');
    if (args.not_interested) {
      for (const gid of args.not_interested) findGame(data, gid);
      data.preferences.not_interested = copy(args.not_interested);
    }
    if (args.preferred_platforms) data.preferences.preferred_platforms = copy(args.preferred_platforms);
    if (args.muted_tags) data.preferences.muted_tags = copy(args.muted_tags);
    if (args.avoid_reasons) data.preferences.avoid_reasons = copy(args.avoid_reasons);
    if (Object.hasOwn(args, 'min_hud_font_pt')) data.preferences.min_hud_font_pt = args.min_hud_font_pt;
    data.preferences.updated_at = ctx.virtual_now;
    log(ctx, 'questshelf.preferences.update', { updated: true });
    return { data, result: { preferences: copy(data.preferences) } };
  }

  if (name === 'questshelf.poll.create') {
    if (data.polls.some(p => p.status === 'open')) {
      fail('conflict', 'An open poll already exists for this account; update or close it before creating another.');
    }
    let pollId = args.poll_id;
    if (!pollId) {
      let n = data.polls.length + 1;
      while (data.polls.some(p => p.poll_id === `poll-${n}`)) n += 1;
      pollId = `poll-${n}`;
    }
    if (data.polls.some(p => p.poll_id === pollId)) fail('conflict', 'Poll ID already exists: ' + pollId);
    for (const gid of args.candidate_game_ids) findGame(data, gid);
    const invited = args.invited_friend_ids || [];
    for (const fid of invited) {
      if (!data.friends.some(f => f.friend_id === fid)) fail('not_found', 'Invited friend not found: ' + fid);
    }
    const poll = {
      poll_id: pollId,
      title: args.title,
      status: 'open',
      candidate_game_ids: copy(args.candidate_game_ids),
      invited_friend_ids: copy(invited),
      max_session_minutes: args.max_session_minutes !== undefined ? args.max_session_minutes : null,
      votes: [],
      winner_game_ids: [],
      created_at: ctx.virtual_now,
      closes_at: args.closes_at !== undefined ? args.closes_at : null,
      closed_at: null,
    };
    data.polls.push(poll);
    log(ctx, 'questshelf.poll.create', { poll_id: pollId });
    return { data, result: { poll: copy(poll) } };
  }

  if (name === 'questshelf.poll.update') {
    const poll = findPoll(data, args.poll_id);
    if (poll.status !== 'open') fail('invalid_state', 'Cannot update a closed poll.');
    const hasField = ['title', 'candidate_game_ids', 'invited_friend_ids', 'max_session_minutes', 'closes_at']
      .some(k => Object.hasOwn(args, k));
    if (!hasField) fail('invalid_arguments', 'Provide at least one poll field to update.');
    if (args.candidate_game_ids) {
      for (const gid of args.candidate_game_ids) findGame(data, gid);
      poll.candidate_game_ids = copy(args.candidate_game_ids);
      const allowed = new Set(poll.candidate_game_ids);
      for (const v of poll.votes) {
        v.selected_game_ids = v.selected_game_ids.filter(gid => allowed.has(gid));
      }
    }
    if (args.invited_friend_ids) {
      for (const fid of args.invited_friend_ids) {
        if (!data.friends.some(f => f.friend_id === fid)) fail('not_found', 'Invited friend not found: ' + fid);
      }
      poll.invited_friend_ids = copy(args.invited_friend_ids);
    }
    if (args.title !== undefined) poll.title = args.title;
    if (Object.hasOwn(args, 'max_session_minutes')) poll.max_session_minutes = args.max_session_minutes;
    if (Object.hasOwn(args, 'closes_at')) poll.closes_at = args.closes_at;
    log(ctx, 'questshelf.poll.update', { poll_id: poll.poll_id });
    return { data, result: { poll: copy(poll) } };
  }

  if (name === 'questshelf.poll.vote') {
    const poll = findPoll(data, args.poll_id);
    if (poll.status !== 'open') fail('invalid_state', 'Cannot vote on a closed poll.');
    if (poll.closes_at && Date.parse(ctx.virtual_now) > Date.parse(poll.closes_at)) {
      fail('invalid_state', 'Poll closing time has passed; call questshelf.poll.close to finalize.');
    }
    for (const gid of args.selected_game_ids) {
      if (!poll.candidate_game_ids.includes(gid)) fail('invalid_arguments', 'Game is not a candidate in this poll: ' + gid);
    }
    const voterId = data.account_id;
    const existing = poll.votes.find(v => v.voter_id === voterId);
    if (existing) {
      existing.selected_game_ids = copy(args.selected_game_ids);
      existing.note = args.note !== undefined ? args.note : existing.note;
      existing.voted_at = ctx.virtual_now;
    } else {
      poll.votes.push({
        voter_id: voterId,
        selected_game_ids: copy(args.selected_game_ids),
        note: args.note || '',
        voted_at: ctx.virtual_now,
      });
    }
    log(ctx, 'questshelf.poll.vote', { poll_id: poll.poll_id, voter_id: voterId });
    return { data, result: { poll: copy(poll) } };
  }

  if (name === 'questshelf.poll.close') {
    const poll = findPoll(data, args.poll_id);
    if (poll.status !== 'open') fail('invalid_state', 'Poll is already closed.');
    const counts = new Map(poll.candidate_game_ids.map(id => [id, 0]));
    for (const v of poll.votes) {
      for (const gid of v.selected_game_ids) {
        if (counts.has(gid)) counts.set(gid, counts.get(gid) + 1);
      }
    }
    const maxVotes = Math.max(0, ...counts.values());
    poll.winner_game_ids = maxVotes > 0
      ? [...counts.entries()].filter(([, c]) => c === maxVotes).map(([id]) => id).sort()
      : [];
    poll.status = 'closed';
    poll.closed_at = ctx.virtual_now;
    log(ctx, 'questshelf.poll.close', { poll_id: poll.poll_id, winners: poll.winner_game_ids });
    return { data, result: { poll: copy(poll) } };
  }

  fail('unsupported_capability', 'Unknown QuestShelf tool: ' + name);
}

module.exports = { handleTool };
