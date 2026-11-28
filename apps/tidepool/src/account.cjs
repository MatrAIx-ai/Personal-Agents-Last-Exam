'use strict';
// Account-side helpers: who is calling, member authority, time-derived download state, activity rows
// and notices. Derived states are functions of stored due times and the instant passed in.
const {fail, instant, shift, DAY, hiddenIds} = require('./domain-utils.cjs');
const billing = require('./billing.cjs');

const OFFLINE_DAYS = 30;

// The caller is the bound account's owner: data.account_id / owner_person_id are checked against the
// run binding by validateSeed, and that person maps to exactly one active member.
const caller = data => data.members.find(m => m.person_id === data.owner_person_id && m.status === 'active');
function member(data, id) {
  const m = data.members.find(x => x.member_id === id);
  if (!m) fail('not_found', 'No family member ' + id + '.');
  return m;
}
// Member-scoped tools name the member in id; only the signed-in member's own records are reachable.
function own(data, id) {
  const m = member(data, id), me = caller(data);
  if (m.member_id !== me.member_id) fail('forbidden', 'Only ' + m.display_name + '\'s own account can read or change their ' + 'listening, library and playlists.');
  return me;
}
function manager(data) {
  const me = caller(data);
  if (me.role !== 'manager') fail('forbidden', 'Only the plan manager can manage members, filters and plans.');
  return me;
}

const offlineDue = device => shift(device.last_checkin_at, OFFLINE_DAYS * DAY);
const offlineCapable = device => device.storage_cap_bytes > 0;
function downloadState(data, d, now) {
  if (d.removed_at) return {status: 'removed', reasons: [d.removed_reason], removed_at: d.removed_at};
  if (d.auto_delete_at && instant(now) >= instant(d.auto_delete_at)) return {status: 'removed', reasons: ['auto_delete'], removed_at: d.auto_delete_at};
  if (instant(now) < instant(d.completes_at)) return {status: 'queued', reasons: [], removed_at: null};
  const reasons = [];
  const device = data.devices.find(x => x.device_id === d.device_id);
  if (instant(now) >= instant(offlineDue(device))) reasons.push('offline_check_overdue');
  if (billing.graceExpired(data, now)) reasons.push('payment_grace_expired');
  return {status: reasons.length ? 'needs_check' : 'downloaded', reasons, removed_at: null};
}
const occupying = (data, d, now) => downloadState(data, d, now).status !== 'removed';
const usedBytes = (data, deviceId, now) => data.downloads.filter(d => d.device_id === deviceId && occupying(data, d, now)).reduce((s, d) => s + d.bytes, 0);
function deviceSpace(data, device, now) {
  const used = usedBytes(data, device.device_id, now);
  return {device_id: device.device_id, storage_cap_bytes: device.storage_cap_bytes, used_bytes: used, free_bytes: Math.max(0, device.storage_cap_bytes - used)};
}
// Auto-delete is the one time-derived state whose inputs a later write can change (progress, follow
// settings), so writes and events first record deletions that are already due. The derived view is
// identical before and after; no activity row is written for it.
function settle(data, now) {
  for (const d of data.downloads) {
    if (!d.removed_at && d.auto_delete_at && instant(now) >= instant(d.auto_delete_at)) {
      d.removed_at = d.auto_delete_at; d.removed_reason = 'auto_delete';
    }
  }
  return data;
}
function followOf(data, memberId, showId) {
  return data.follows.find(f => f.member_id === memberId && f.show_id === showId) || null;
}
// When an episode is played under a follow with auto-delete, its downloads get a due time: d days
// after it was played or downloaded, whichever is later, so a fresh download of an old episode keeps
// its full window. A shortened window that has already passed falls due now. Due times already
// reached are never moved (settle has recorded them); later ones follow the new settings.
function scheduleAutoDelete(data, memberId, episodeId, now) {
  const episode = data.episodes.find(e => e.episode_id === episodeId);
  const progress = data.progress.find(p => p.member_id === memberId && p.episode_id === episodeId);
  const follow = followOf(data, memberId, episode.show_id);
  let changed = 0;
  for (const d of data.downloads) {
    if (d.member_id !== memberId || d.item_type !== 'episode' || d.item_id !== episodeId || d.removed_at) continue;
    let due = null;
    if (progress && progress.state === 'played' && follow && follow.auto_delete_days) {
      const base = instant(d.requested_at) > instant(progress.played_at) ? d.requested_at : progress.played_at;
      const target = shift(base, follow.auto_delete_days * DAY);
      due = instant(target) < instant(now) ? now : target;
    }
    if (d.auto_delete_at !== due) {d.auto_delete_at = due; changed++;}
  }
  return changed;
}
function downloadCounts(data, memberId, now) {
  const counts = {queued: 0, downloaded: 0, needs_check: 0, bytes: 0};
  for (const d of data.downloads) {
    if (d.member_id !== memberId) continue;
    const s = downloadState(data, d, now).status;
    if (s === 'removed') continue;
    counts[s]++; counts.bytes += d.bytes;
  }
  return counts;
}
// What members.remove would end; family.get shows the same object beforehand. Playlist access that ends:
// the member's edit access to other active members' collaborative playlists, and the family's access to
// the member's own shared and collaborative playlists, which leave the family view.
function removalImpact(data, memberId, now) {
  const counts = downloadCounts(data, memberId, now);
  const collaborations = data.playlists.filter(p => p.owner_member_id !== memberId && playlistRole(data, p, memberId) === 'collaborator')
    .map(p => p.playlist_id);
  const owned = data.playlists.filter(p => p.owner_member_id === memberId && p.visibility !== 'private').map(p => p.playlist_id);
  return {downloads_removed: counts.queued + counts.downloaded + counts.needs_check, bytes_freed: counts.bytes,
    collaborations_ended: collaborations.length, playlist_ids: collaborations, owned_playlists_hidden: owned.length, owned_playlist_ids: owned};
}

// Playlist access: owners always; other active members see shared and collaborative playlists of active
// owners; collaborators edit while the playlist is collaborative.
function playlistRole(data, p, memberId) {
  if (p.owner_member_id === memberId) return 'owner';
  const owner = data.members.find(m => m.member_id === p.owner_member_id);
  if (!owner || owner.status !== 'active' || p.visibility === 'private') return null;
  return p.visibility === 'collaborative' && p.collaborators.includes(memberId) ? 'collaborator' : 'viewer';
}

function newId(data, prefix, taken) {
  let id;
  do {id = prefix + '-' + data.next_seq; data.next_seq++;} while (taken(id) || hiddenIds(data).has(id));
  return id;
}
// One activity row per committed write or applied event; none for replays, rejections or time passing.
function activity(data, row) {
  const last = data.activity.length ? data.activity[data.activity.length - 1].seq : 0;
  data.activity.push({seq: last + 1, at: row.at, actor: row.actor, action: row.action, object_type: row.object_type, object_id: row.object_id,
    member_id: row.member_id ?? null, replaced: row.replaced === undefined ? null : row.replaced, request_id: row.request_id ?? null, event_id: row.event_id ?? null,
    later_history_removed: null});
}
function notice(data, n) {
  const id = newId(data, 'notice', x => data.notifications.some(y => y.notice_id === x));
  data.notifications.push({notice_id: id, member_id: n.member_id, created_at: n.created_at, kind: n.kind, text: n.text,
    object_type: n.object_type, object_id: n.object_id, event_id: n.event_id});
}

module.exports = {OFFLINE_DAYS, caller, member, own, manager, offlineDue, offlineCapable, downloadState, occupying, usedBytes, deviceSpace,
  settle, followOf, scheduleAutoDelete, downloadCounts, removalImpact, playlistRole, newId, activity, notice};
