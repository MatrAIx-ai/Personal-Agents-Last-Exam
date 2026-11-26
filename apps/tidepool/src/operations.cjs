'use strict';
// Agent business tools. Reads and writes see the data as of the run clock (src/visible.cjs). Reads
// compute on a settled copy and return the data unchanged; each committed write changes only the bound
// family's records and appends one activity row.
const {fail, copy, instant, newestFirst, text, inOffsetOf} = require('./domain-utils.cjs');
const {log} = require('./diagnostics.cjs');
const c = require('./catalog.cjs');
const a = require('./account.cjs');
const billing = require('./billing.cjs');
const rules = require('./rules.cjs');
const cutoff = require('./visible.cjs');

const PREFIX = 'tidepool.';
const READS = new Set(['catalog.search', 'catalog.get_item', 'shows.get_episodes', 'family.get', 'members.list', 'devices.list',
  'history.list', 'progress.get', 'follows.list', 'upnext.get', 'downloads.list', 'library.list', 'playlists.list', 'playlists.get',
  'notifications.list', 'plan.preview_change']);

const personName = (ctx, personId) => ctx.binding.people.find(p => p.person_id === personId)?.name || personId;
const memberFields = (m, me) => ({member_id: m.member_id, person_id: m.person_id, display_name: m.display_name, role: m.role,
  age_group: m.age_group, status: m.status, explicit_filter: m.explicit_filter, joined_at: m.joined_at, is_you: m.member_id === me.member_id});
const invitationView = (ctx, i) => ({invitation_id: i.invitation_id, person_id: i.person_id, display_name: personName(ctx, i.person_id),
  status: i.status, invited_at: i.invited_at, responded_at: i.responded_at, explicit_filter: i.explicit_filter});
function planView(data, now) {
  const p = billing.planAt(data, now);
  return {plan_id: p.plan_id, name: p.name, max_members: p.max_members, monthly_price_cents: p.monthly_price_cents,
    scheduled_change: billing.scheduledChange(data, now)};
}
function upnextOf(data, memberId) {
  return data.upnext.find(u => u.member_id === memberId) || {member_id: memberId, list_version: 1, updated_at: null, episode_ids: []};
}
function progressRow(idx, data, memberId, e) {
  const p = c.progressOf(data, memberId, e.episode_id);
  return {episode_id: e.episode_id, show_id: e.show_id, title: e.title, duration_s: e.duration_s, state: p?.state ?? 'unplayed',
    position_s: p?.position_s ?? 0, played_at: p?.played_at ?? null, updated_at: p?.updated_at ?? null, set_by: p?.set_by ?? null,
    replaced: p?.replaced ? copy(p.replaced) : null};
}
function playlistSummary(data, p, me) {
  const owner = data.members.find(m => m.member_id === p.owner_member_id);
  return {playlist_id: p.playlist_id, name: p.name, description: p.description, owner_member_id: p.owner_member_id, owner_name: owner.display_name,
    visibility: p.visibility, your_role: a.playlistRole(data, p, me.member_id), collaborators: [...p.collaborators], track_count: p.tracks.length,
    track_version: p.track_version, updated_at: p.updated_at};
}
function visiblePlaylist(data, id, me) {
  const p = data.playlists.find(x => x.playlist_id === id);
  if (!p || !a.playlistRole(data, p, me.member_id)) fail('not_found', 'No playlist ' + id + ' visible to this member.');
  return p;
}
const scheduledFor = (data, idx, memberId, showId) => data.downloads.filter(d => d.member_id === memberId && d.item_type === 'episode' &&
  !d.removed_at && d.auto_delete_at && idx.episodes.get(d.item_id).show_id === showId).length;
function ownDevice(data, me, deviceId) {
  const d = data.devices.find(x => x.device_id === deviceId);
  if (!d) fail('not_found', 'No device ' + deviceId + '.');
  if (d.member_id !== me.member_id) fail('forbidden', 'Device ' + deviceId + ' is signed in to another member\'s account.');
  return d;
}

function read(ctx, data, name, args, now) {
  const idx = c.index(data), me = a.caller(data);
  switch (name) {
    case 'catalog.search':
      return c.search(idx, data, args, me);
    case 'catalog.get_item':
      return {item: c.full(idx, data, args.item_id, me)};
    case 'shows.get_episodes': {
      const show = c.get(idx, 'show', args.show_id);
      const list = c.episodesOf(data, show.show_id).sort((x, y) => instant(y.published_at) - instant(x.published_at) || y.number - x.number);
      return {show: c.showView(data, show, me.member_id), total: list.length, episodes: list.slice(0, args.limit ?? 30).map(e => c.episodeView(idx, data, e, me))};
    }
    case 'family.get': {
      const mgr = data.members.find(m => m.role === 'manager');
      return {family: {family_id: data.family.family_id, name: data.family.name}, you: me.member_id, manager_member_id: mgr.member_id,
        plan: planView(data, now), billing: billing.view(data, now), slots: billing.slots(data, now),
        // Per-member download counts and removal impact: the manager sees every member, others only themselves.
        members: data.members.map(m => {
          const visible = me.role === 'manager' || m.member_id === me.member_id;
          return {...memberFields(m, me), downloads: visible ? a.downloadCounts(data, m.member_id, now) : null,
            if_removed: me.role === 'manager' && m.status === 'active' && m.role !== 'manager' ? a.removalImpact(data, m.member_id, now) : null};
        }),
        invitations: data.invitations.filter(i => i.status === 'open').map(i => invitationView(ctx, i))};
    }
    case 'members.list':
      return {members: data.members.map(m => memberFields(m, me)), invitations: data.invitations.map(i => invitationView(ctx, i))};
    case 'devices.list':
      a.own(data, args.id);
      return {devices: data.devices.filter(d => d.member_id === me.member_id).map(d => {
        const space = a.deviceSpace(data, d, now), due = a.offlineDue(d);
        return {device_id: d.device_id, name: d.name, kind: d.kind, storage_cap_bytes: d.storage_cap_bytes, used_bytes: space.used_bytes,
          free_bytes: space.free_bytes, offline_capable: a.offlineCapable(d), auto_download: d.auto_download, last_checkin_at: d.last_checkin_at,
          // Shown in the current clock's offset, so a due time across a DST change reads as local time.
          offline_check_due_at: inOffsetOf(due, now), offline_check_overdue: instant(now) >= instant(due)};
      })};
    case 'history.list': {
      a.own(data, args.id);
      const list = newestFirst(data.sessions.filter(s => s.member_id === me.member_id &&
        (args.device_id === undefined || s.device_id === args.device_id) && (args.item_type === undefined || s.item_type === args.item_type) &&
        (args.since === undefined || instant(s.started_at) >= instant(args.since)) && (args.until === undefined || instant(s.started_at) <= instant(args.until))), 'started_at');
      return {total: list.length, sessions: list.slice(0, args.limit ?? 50).map(s => ({session_id: s.session_id, device_id: s.device_id,
        device_name: idx.devices.get(s.device_id).name, item_type: s.item_type, item_id: s.item_id, title: c.title(idx, s.item_type, s.item_id),
        context_title: c.contextTitle(idx, s.item_type, s.item_id), started_at: s.started_at, ended_at: s.ended_at, start_reason: s.start_reason,
        speed: s.speed, start_position_s: s.start_position_s, end_position_s: s.end_position_s, end_reason: s.end_reason, speaker_hint: s.speaker_hint}))};
    }
    case 'progress.get': {
      a.own(data, args.id);
      let episodes;
      if (args.episode_ids) episodes = args.episode_ids.map(id => c.get(idx, 'episode', id));
      else if (args.show_id) {
        c.get(idx, 'show', args.show_id);
        episodes = c.episodesOf(data, args.show_id).sort((x, y) => instant(y.published_at) - instant(x.published_at));
      } else {
        episodes = newestFirst(data.progress.filter(p => p.member_id === me.member_id), 'updated_at').map(p => idx.episodes.get(p.episode_id));
      }
      return {progress: episodes.map(e => progressRow(idx, data, me.member_id, e))};
    }
    case 'follows.list':
      a.own(data, args.id);
      return {follows: data.follows.filter(f => f.member_id === me.member_id).map(f => {
        const show = idx.shows.get(f.show_id), view = c.showView(data, show, me.member_id);
        const unplayed = c.episodesOf(data, f.show_id).filter(e => c.progressOf(data, me.member_id, e.episode_id)?.state !== 'played').length;
        return {show_id: f.show_id, title: show.title, followed_at: f.followed_at, auto_download_count: f.auto_download_count,
          auto_delete_days: f.auto_delete_days, latest_episode_id: view.latest_episode_id, unplayed_count: unplayed};
      })};
    case 'upnext.get': {
      a.own(data, args.id);
      const u = upnextOf(data, me.member_id);
      const entries = u.episode_ids.map((id, i) => {
        const e = idx.episodes.get(id), row = progressRow(idx, data, me.member_id, e);
        const remaining = row.state === 'in_progress' ? e.duration_s - row.position_s : e.duration_s;
        const downloads = data.downloads.filter(d => d.member_id === me.member_id && d.item_type === 'episode' && d.item_id === id)
          .map(d => ({device_id: d.device_id, download_id: d.download_id, status: a.downloadState(data, d, now).status})).filter(d => d.status !== 'removed');
        return {position: i + 1, episode_id: id, show_title: idx.shows.get(e.show_id).title, title: e.title, duration_s: e.duration_s,
          state: row.state, position_s: row.position_s, remaining_s: remaining, availability: e.availability, downloads};
      });
      return {list_version: u.list_version, updated_at: u.updated_at, total_remaining_s: entries.reduce((s, x) => s + x.remaining_s, 0), entries};
    }
    case 'downloads.list': {
      a.own(data, args.id);
      if (args.device_id !== undefined) ownDevice(data, me, args.device_id);
      const rows = newestFirst(data.downloads.filter(d => d.member_id === me.member_id && (args.device_id === undefined || d.device_id === args.device_id)), 'requested_at')
        .map(d => {
          const s = a.downloadState(data, d, now);
          return {download_id: d.download_id, device_id: d.device_id, item_type: d.item_type, item_id: d.item_id,
            title: c.title(idx, d.item_type, d.item_id), context_title: c.contextTitle(idx, d.item_type, d.item_id), bytes: d.bytes, source: d.source,
            status: s.status, status_reasons: s.reasons, requested_at: d.requested_at, completes_at: d.completes_at, auto_delete_at: d.auto_delete_at,
            removed_at: s.removed_at, played: d.item_type === 'episode' ? c.progressOf(data, me.member_id, d.item_id)?.state === 'played' : null};
        })
        .filter(d => args.status !== undefined ? d.status === args.status : (args.include_removed === true || d.status !== 'removed'));
      return {downloads: rows, devices: data.devices.filter(d => d.member_id === me.member_id).map(d => a.deviceSpace(data, d, now))};
    }
    case 'library.list':
      a.own(data, args.id);
      return {items: newestFirst(data.library.filter(l => l.member_id === me.member_id && (args.item_type === undefined || l.item_type === args.item_type)), 'saved_at')
        .map(l => {
          const item = idx[l.item_type + 's'].get(l.item_id);
          const explicit = l.item_type === 'track' ? item.explicit : c.albumTracks(idx, item).some(t => t.explicit);
          return {item_type: l.item_type, item_id: l.item_id, title: item.title, artist_name: idx.artists.get(item.artist_id).name, saved_at: l.saved_at,
            availability: item.availability, explicit, filtered: explicit && me.explicit_filter, bytes: c.itemBytes(idx, l.item_type, item)};
        })};
    case 'playlists.list':
      a.own(data, args.id);
      return {playlists: data.playlists.filter(p => a.playlistRole(data, p, me.member_id)).map(p => playlistSummary(data, p, me))};
    case 'playlists.get': {
      a.own(data, args.id);
      const p = visiblePlaylist(data, args.playlist_id, me);
      return {playlist: {...playlistSummary(data, p, me), created_at: p.created_at, tracks: p.tracks.map((entry, i) => {
        const t = idx.tracks.get(entry.track_id);
        return {position: i + 1, track_id: t.track_id, title: t.title, artist_name: idx.artists.get(t.artist_id).name, duration_s: t.duration_s,
          explicit: t.explicit, clean_version_id: t.clean_version_id, availability: t.availability, added_by: entry.added_by,
          added_by_name: idx.members.get(entry.added_by).display_name, added_at: entry.added_at, skipped_for_you: t.explicit && me.explicit_filter};
      })}};
    }
    case 'notifications.list':
      a.own(data, args.id);
      return {notifications: newestFirst(data.notifications.filter(n => n.member_id === me.member_id), 'created_at').slice(0, args.limit ?? 50)
        .map(n => ({notice_id: n.notice_id, kind: n.kind, created_at: n.created_at, text: n.text, object_type: n.object_type, object_id: n.object_id, event_id: n.event_id}))};
    case 'plan.preview_change':
      return {quote: billing.quote(data, now, args.plan_id)};
  }
  return null;
}

// Each write returns {result, row}: the business result and its activity row (object, member, replaced).
function write(ctx, data, name, args, now) {
  const idx = c.index(data);
  switch (name) {
    case 'progress.set': {
      const me = a.own(data, args.id), e = c.get(idx, 'episode', args.episode_id);
      if (args.position_s !== undefined && args.position_s > e.duration_s) fail('invalid_position', 'Position ' + args.position_s + ' s is beyond the episode\'s ' + e.duration_s + ' s.');
      if (args.state === 'in_progress' && !(args.position_s >= 1)) fail('invalid_position', 'in_progress needs a position_s from 1 to the episode duration.');
      let p = c.progressOf(data, me.member_id, e.episode_id);
      const replaced = p ? {state: p.state, position_s: p.position_s} : {state: 'unplayed', position_s: 0};
      if (!p) {p = {member_id: me.member_id, episode_id: e.episode_id}; data.progress.push(p);}
      const playedAt = args.state === 'played' ? (p.state === 'played' && p.played_at ? p.played_at : now) : null;
      Object.assign(p, {state: args.state, position_s: args.state === 'in_progress' ? args.position_s : 0, updated_at: now, played_at: playedAt,
        set_by: 'agent', replaced});
      a.scheduleAutoDelete(data, me.member_id, e.episode_id, now);
      const due = data.downloads.filter(d => d.member_id === me.member_id && d.item_type === 'episode' && d.item_id === e.episode_id && !d.removed_at && d.auto_delete_at)
        .map(d => d.auto_delete_at).sort((x, y) => instant(x) - instant(y))[0] ?? null;
      return {result: {member_id: me.member_id, episode_id: e.episode_id, state: p.state, position_s: p.position_s, set_by: 'agent', replaced, auto_delete_at: due},
        row: {object_type: 'episode', object_id: e.episode_id, member_id: me.member_id, replaced}};
    }
    case 'follows.add': {
      const me = a.own(data, args.id), show = c.usable(idx, 'show', args.show_id);
      const existing = a.followOf(data, me.member_id, show.show_id);
      if (existing) {
        // Settings that differ from the existing follow are refused rather than silently ignored.
        for (const key of ['auto_download_count', 'auto_delete_days']) {
          if (args[key] !== undefined && args[key] !== existing[key]) fail('invalid_arguments', me.display_name + ' already follows ' + show.title + '; change its settings with follows.update_settings.');
        }
      } else {
        data.follows.push({member_id: me.member_id, show_id: show.show_id, followed_at: now, auto_download_count: args.auto_download_count ?? 0,
          auto_delete_days: args.auto_delete_days ?? null});
        // Auto-delete applies to downloads of episodes already played, as with follows.update_settings.
        for (const e of c.episodesOf(data, show.show_id)) a.scheduleAutoDelete(data, me.member_id, e.episode_id, now);
      }
      return {result: {member_id: me.member_id, show_id: show.show_id, following: true, changed: !existing,
        downloads_scheduled_for_auto_delete: scheduledFor(data, idx, me.member_id, show.show_id)},
        row: {object_type: 'show', object_id: show.show_id, member_id: me.member_id, replaced: existing ? copy(existing) : null}};
    }
    case 'follows.remove': {
      const me = a.own(data, args.id), show = c.get(idx, 'show', args.show_id);
      const follow = a.followOf(data, me.member_id, show.show_id);
      if (!follow) fail('not_found', me.display_name + ' does not follow ' + show.title + '.');
      data.follows = data.follows.filter(f => f !== follow);
      let kept = 0;
      for (const d of data.downloads) {
        if (d.member_id !== me.member_id || d.item_type !== 'episode' || d.removed_at || idx.episodes.get(d.item_id).show_id !== show.show_id) continue;
        d.auto_delete_at = null; kept++;
      }
      return {result: {member_id: me.member_id, show_id: show.show_id, following: false, downloads_kept: kept},
        row: {object_type: 'show', object_id: show.show_id, member_id: me.member_id, replaced: copy(follow)}};
    }
    case 'follows.update_settings': {
      const me = a.own(data, args.id), show = c.get(idx, 'show', args.show_id);
      const follow = a.followOf(data, me.member_id, show.show_id);
      if (!follow) fail('not_found', me.display_name + ' does not follow ' + show.title + '.');
      const replaced = {auto_download_count: follow.auto_download_count, auto_delete_days: follow.auto_delete_days};
      for (const key of Object.keys(args.patch)) follow[key] = args.patch[key];
      for (const e of c.episodesOf(data, show.show_id)) a.scheduleAutoDelete(data, me.member_id, e.episode_id, now);
      return {result: {member_id: me.member_id, show_id: show.show_id, auto_download_count: follow.auto_download_count,
        auto_delete_days: follow.auto_delete_days, replaced, downloads_scheduled_for_auto_delete: scheduledFor(data, idx, me.member_id, show.show_id)},
        row: {object_type: 'show', object_id: show.show_id, member_id: me.member_id, replaced}};
    }
    case 'upnext.set': {
      const me = a.own(data, args.id), current = upnextOf(data, me.member_id);
      if (args.expected_list_version !== current.list_version) {
        fail('list_version_mismatch', 'Up Next is at list version ' + current.list_version + '; read it again with upnext.get before replacing it.');
      }
      for (const id of args.episode_ids) c.usable(idx, 'episode', id);
      const replaced = [...current.episode_ids];
      let u = data.upnext.find(x => x.member_id === me.member_id);
      if (!u) {u = {member_id: me.member_id, list_version: 1}; data.upnext.push(u);}
      Object.assign(u, {list_version: current.list_version + 1, updated_at: now, episode_ids: [...args.episode_ids]});
      return {result: {member_id: me.member_id, list_version: u.list_version, episode_ids: [...u.episode_ids], replaced},
        row: {object_type: 'upnext', object_id: me.member_id, member_id: me.member_id, replaced}};
    }
    case 'downloads.add': {
      const me = a.own(data, args.id), device = ownDevice(data, me, args.device_id);
      const item = c.usable(idx, args.item_type, args.item_id);
      if (!a.offlineCapable(device)) fail('unavailable', device.name + ' has no offline storage for downloads.');
      if (billing.graceExpired(data, now)) fail('payment_due', 'A declined payment is past its grace period; new downloads wait until it is paid.');
      const existing = rules.activeDownload(data, device.device_id, args.item_type, args.item_id, now);
      const d = existing || rules.reserve(data, idx, device, args.item_type, item, 'manual', now);
      return {result: {member_id: me.member_id, download_id: d.download_id, device_id: d.device_id, item_type: d.item_type, item_id: d.item_id,
        bytes: d.bytes, download_status: a.downloadState(data, d, now).status, completes_at: d.completes_at,
        free_bytes_after: a.deviceSpace(data, device, now).free_bytes, changed: !existing},
        row: {object_type: 'download', object_id: d.download_id, member_id: me.member_id, replaced: null}};
    }
    case 'downloads.remove': {
      const me = a.own(data, args.id);
      const d = data.downloads.find(x => x.download_id === args.download_id && x.member_id === me.member_id);
      if (!d) fail('not_found', 'No download ' + args.download_id + ' for ' + me.display_name + '.');
      const state = a.downloadState(data, d, now);
      if (state.status === 'removed') fail('not_found', 'Download ' + d.download_id + ' was already removed.');
      d.removed_at = now; d.removed_reason = state.status === 'queued' ? 'cancelled' : 'removed_by_agent';
      const device = idx.devices.get(d.device_id);
      return {result: {member_id: me.member_id, download_id: d.download_id, previous_status: state.status, bytes_freed: d.bytes,
        free_bytes_after: a.deviceSpace(data, device, now).free_bytes},
        row: {object_type: 'download', object_id: d.download_id, member_id: me.member_id, replaced: {status: state.status}}};
    }
    case 'library.save': {
      const me = a.own(data, args.id);
      c.usable(idx, args.item_type, args.item_id);
      const existing = data.library.find(l => l.member_id === me.member_id && l.item_type === args.item_type && l.item_id === args.item_id);
      if (!existing) data.library.push({member_id: me.member_id, item_type: args.item_type, item_id: args.item_id, saved_at: now});
      return {result: {member_id: me.member_id, item_type: args.item_type, item_id: args.item_id, saved: true, changed: !existing},
        row: {object_type: args.item_type, object_id: args.item_id, member_id: me.member_id, replaced: existing ? copy(existing) : null}};
    }
    case 'library.unsave': {
      const me = a.own(data, args.id);
      const existing = data.library.find(l => l.member_id === me.member_id && l.item_type === args.item_type && l.item_id === args.item_id);
      if (!existing) fail('not_found', 'That ' + args.item_type + ' is not saved in ' + me.display_name + '\'s library.');
      data.library = data.library.filter(l => l !== existing);
      return {result: {member_id: me.member_id, item_type: args.item_type, item_id: args.item_id, saved: false},
        row: {object_type: args.item_type, object_id: args.item_id, member_id: me.member_id, replaced: copy(existing)}};
    }
    case 'playlists.create': {
      const me = a.own(data, args.id);
      if (!text(args.name, 100)) fail('invalid_arguments', 'Playlist names cannot be blank.');
      const collaborators = args.collaborators ?? [];
      rules.checkCollaborators(data, me.member_id, collaborators);
      const trackIds = args.track_ids ?? [];
      for (const id of trackIds) c.usable(idx, 'track', id);
      const p = {playlist_id: a.newId(data, 'pl', x => data.playlists.some(y => y.playlist_id === x)), owner_member_id: me.member_id, name: args.name,
        description: args.description ?? '', visibility: args.visibility, collaborators: [...collaborators],
        tracks: trackIds.map(id => ({track_id: id, added_by: me.member_id, added_at: now})), track_version: 1, created_at: now, updated_at: now,
        origin: 'agent'};
      data.playlists.push(p);
      return {result: {playlist_id: p.playlist_id, owner_member_id: p.owner_member_id, name: p.name, visibility: p.visibility,
        collaborators: [...p.collaborators], track_count: p.tracks.length, track_version: 1},
        row: {object_type: 'playlist', object_id: p.playlist_id, member_id: me.member_id, replaced: null}};
    }
    case 'playlists.update_tracks': {
      const me = a.own(data, args.id), p = visiblePlaylist(data, args.playlist_id, me);
      if (!['owner', 'collaborator'].includes(a.playlistRole(data, p, me.member_id))) fail('forbidden', 'Only the owner or a collaborator can edit this playlist\'s tracks.');
      if (args.expected_track_version !== undefined && args.expected_track_version !== p.track_version) {
        fail('list_version_mismatch', 'The playlist is at track version ' + p.track_version + '; read it again with playlists.get before editing.');
      }
      const replaced = p.tracks.map(t => t.track_id);
      rules.applyTrackOps(idx, p, args.operations, me.member_id, now, 'tool');
      return {result: {playlist_id: p.playlist_id, track_version: p.track_version, track_count: p.tracks.length, track_ids: p.tracks.map(t => t.track_id)},
        row: {object_type: 'playlist', object_id: p.playlist_id, member_id: me.member_id, replaced}};
    }
    case 'playlists.update_settings': {
      const me = a.own(data, args.id), p = visiblePlaylist(data, args.playlist_id, me);
      if (p.owner_member_id !== me.member_id) fail('forbidden', 'Only the playlist owner can change its name, visibility or collaborators.');
      const patch = args.patch, replaced = {};
      if (patch.name !== undefined && !text(patch.name, 100)) fail('invalid_arguments', 'Playlist names cannot be blank.');
      if (patch.collaborators !== undefined) rules.checkCollaborators(data, me.member_id, patch.collaborators);
      for (const key of Object.keys(patch)) {replaced[key] = copy(p[key]); p[key] = copy(patch[key]);}
      p.updated_at = now;
      return {result: {playlist_id: p.playlist_id, name: p.name, visibility: p.visibility, collaborators: [...p.collaborators], replaced},
        row: {object_type: 'playlist', object_id: p.playlist_id, member_id: me.member_id, replaced}};
    }
    case 'members.invite': {
      const me = a.manager(data), personId = args.id;
      if (!ctx.binding.people.some(p => p.person_id === personId)) fail('not_found', 'Person ' + personId + ' is not in this run\'s binding.');
      if (data.members.some(m => m.person_id === personId && m.status === 'active')) fail('already_member', personName(ctx, personId) + ' is already a family member.');
      if (data.invitations.some(i => i.person_id === personId && i.status === 'open')) fail('already_invited', personName(ctx, personId) + ' already has an open invitation.');
      if (billing.slots(data, now).available < 1) fail('too_many_members', 'No member slot is free on the plan (open invitations and any scheduled downgrade count).');
      const inv = {invitation_id: a.newId(data, 'invite', x => data.invitations.some(y => y.invitation_id === x)), person_id: personId,
        invited_by: me.member_id, invited_at: now, explicit_filter: args.explicit_filter ?? false, status: 'open', responded_at: null};
      data.invitations.push(inv);
      return {result: {invitation_id: inv.invitation_id, person_id: personId, invitation_status: 'open', slots: billing.slots(data, now)},
        row: {object_type: 'invitation', object_id: inv.invitation_id, member_id: null, replaced: null}};
    }
    case 'members.remove': {
      a.manager(data);
      const m = a.member(data, args.id);
      if (m.status !== 'active') fail('not_found', m.display_name + ' is not an active member.');
      if (m.role === 'manager') fail('forbidden', 'The plan manager cannot remove themself.');
      const impact = a.removalImpact(data, m.member_id, now);
      m.status = 'removed'; m.removed_at = now;
      for (const d of data.downloads) {
        if (d.member_id === m.member_id && a.occupying(data, d, now)) {d.removed_at = now; d.removed_reason = 'member_removed';}
      }
      for (const p of data.playlists) if (p.owner_member_id !== m.member_id) p.collaborators = p.collaborators.filter(id => id !== m.member_id);
      return {result: {member_id: m.member_id, member_status: 'removed', ...impact},
        row: {object_type: 'member', object_id: m.member_id, member_id: m.member_id, replaced: {status: 'active'}}};
    }
    case 'filters.update': {
      a.manager(data);
      const m = a.member(data, args.id);
      if (m.status !== 'active') fail('not_found', m.display_name + ' is not an active member.');
      const replaced = {explicit_filter: m.explicit_filter};
      m.explicit_filter = args.patch.explicit_filter;
      return {result: {member_id: m.member_id, explicit_filter: m.explicit_filter, replaced, changed: replaced.explicit_filter !== m.explicit_filter},
        row: {object_type: 'member', object_id: m.member_id, member_id: m.member_id, replaced}};
    }
    case 'plan.confirm_change': {
      a.own(data, args.id); a.manager(data);
      const before = {plan_id: billing.planAt(data, now).plan_id, scheduled_change: billing.scheduledChange(data, now)};
      const out = billing.confirm(data, now, args.plan_id, prefix => a.newId(data, prefix, x => data.billing.adjustments.some(y => y.adjustment_id === x)));
      return {result: out.result, row: {object_type: 'plan', object_id: data.family.family_id, member_id: null, replaced: before}};
    }
    case 'plan.revoke_change': {
      a.own(data, args.id); a.manager(data);
      const out = billing.revoke(data, now);
      return {result: out, row: {object_type: 'plan', object_id: data.family.family_id, member_id: null, replaced: {scheduled_change: out.revoked}}};
    }
  }
  fail('unknown_tool', 'Unknown Tidepool operation.');
}

// Before the bound member has joined (for example, a seed loaded before the account starts), no tool has a caller.
function signedIn(data, account, now) {
  if (!a.caller(data)) fail('not_found', 'Tidepool account ' + account + ' has no family membership at ' + now + '.');
}

function handleTool(ctx, data, name, args) {
  const op = name.startsWith(PREFIX) ? name.slice(PREFIX.length) : name, now = ctx.virtual_now;
  if (READS.has(op)) {
    const seen = cutoff.view(data, now).data;
    signedIn(seen, data.account_id, now);
    return {data, result: read(ctx, a.settle(seen, now), op, args, now)};
  }
  const out = cutoff.commit(ctx, data, now, view => {
    signedIn(view, data.account_id, now);
    a.settle(view, now);
    const done = write(ctx, view, op, args, now);
    a.activity(view, {...done.row, at: now, actor: 'agent', action: name, request_id: args.request_id});
    return done;
  });
  log(ctx, name, {object_id: out.result.row.object_id, member_id: out.result.row.member_id});
  return {data: out.data, result: out.result.result};
}

module.exports = {handleTool};
