'use strict';
// Clock cutoff. Tools and events see the family and catalog as they were at the run clock: a record
// exists in Tidepool from the moment it happened (an album from its release day, an episode from
// published_at, a session from ended_at, a download from requested_at, ...), and state that a record
// gained later is shown as it was before that change when the stored data determines it. Nothing is stored for this; later records
// appear when env.advance_time or an event moves the clock. Writes and events run on this view and are
// merged back record by record (see commit).
const {copy, instant, offsetOf, MINUTE, HIDDEN} = require('./domain-utils.cjs');
const {validateSeed} = require('./model.cjs');

const KEYS = {
  members: m => m.member_id, invitations: i => i.invitation_id, devices: d => d.device_id, sessions: s => s.session_id,
  progress: p => p.member_id + '/' + p.episode_id, plays: p => p.member_id + '/' + p.track_id, follows: f => f.member_id + '/' + f.show_id,
  upnext: u => u.member_id, downloads: d => d.download_id, library: l => l.member_id + '/' + l.item_type + '/' + l.item_id,
  playlists: p => p.playlist_id, notifications: n => n.notice_id,
  artists: x => x.artist_id, albums: x => x.album_id, tracks: x => x.track_id, shows: x => x.show_id, episodes: x => x.episode_id,
};
const BILLING_KEYS = {adjustments: a => a.adjustment_id, payments: p => p.invoice_id + '|' + p.outcome + '|' + p.at};

const latest = (...times) => times.filter(Boolean).reduce((a, b) => (instant(b) > instant(a) ? b : a));

// The data as of `now`, as a fresh copy. `cut` is true when anything was hidden or shown as earlier state.
function view(stored, now) {
  const t = instant(now), happened = ts => ts !== null && ts !== undefined && instant(ts) <= t;
  const data = copy(stored), hidden = new Set();
  let masked = 0;
  const keep = (list, ok, id) => list.filter(x => {
    if (ok(x)) return true;
    hidden.add(id(x));
    return false;
  });

  // Catalog: an episode exists from published_at; an album, with its tracks, from the start of its
  // release day (a date) in the family's calendar offset, the billing anchor's. Artists and shows carry
  // no date of their own, and availability changes are not dated.
  data.episodes = keep(data.episodes, e => happened(e.published_at), KEYS.episodes);
  const episodes = new Map(data.episodes.map(e => [e.episode_id, e]));
  const releasedAt = day => Date.parse(day + 'T00:00:00Z') - offsetOf(stored.billing.anchor) * MINUTE;
  data.albums = keep(data.albums, a => releasedAt(a.released) <= t, KEYS.albums);
  const albums = new Set(data.albums.map(a => a.album_id));
  data.tracks = keep(data.tracks, x => albums.has(x.album_id), KEYS.tracks);
  const tracks = new Set(data.tracks.map(x => x.track_id));
  const item = (type, id) => type === 'episode' ? episodes.has(id) : type === 'album' ? albums.has(id) : tracks.has(id);

  // Family: members from joined_at, invitations from invited_at; a later removal or response is undone.
  data.members = keep(data.members, m => happened(m.joined_at), KEYS.members);
  for (const m of data.members) if (m.removed_at && !happened(m.removed_at)) {m.status = 'active'; m.removed_at = null; masked++;}
  data.invitations = keep(data.invitations, i => happened(i.invited_at), KEYS.invitations);
  for (const i of data.invitations) if (i.responded_at && !happened(i.responded_at)) {i.status = 'open'; i.responded_at = null; masked++;}
  const members = new Set(data.members.map(m => m.member_id));

  // Billing: plan decisions from set_at (the first entry starts the account and always stays),
  // proration from created_at, payment results from at.
  const b = data.billing, timeline = b.timeline.filter(e => happened(e.set_at));
  if (timeline.length < b.timeline.length) masked++;
  b.timeline = timeline.length ? timeline : b.timeline.slice(0, 1);
  b.adjustments = keep(b.adjustments, x => happened(x.created_at), BILLING_KEYS.adjustments);
  b.payments = keep(b.payments, x => happened(x.at), BILLING_KEYS.payments);

  // Devices from registered_at; sessions exist once recorded, at ended_at.
  data.devices = keep(data.devices, d => happened(d.registered_at) && members.has(d.member_id), KEYS.devices);
  const devices = new Set(data.devices.map(d => d.device_id));
  data.sessions = keep(data.sessions, s => happened(s.ended_at) && devices.has(s.device_id) && item(s.item_type, s.item_id), KEYS.sessions);
  const lastSession = new Map(), lastPlayed = new Map();
  for (const s of data.sessions) {
    const k = s.member_id + '/' + s.item_id, prev = lastSession.get(k);
    if (!prev || instant(s.ended_at) >= instant(prev.ended_at)) lastSession.set(k, s);
    lastPlayed.set(s.device_id, latest(lastPlayed.get(s.device_id), s.ended_at));
  }
  // Only the latest check-in is stored. When it is after the clock, the device's last check-in reads
  // as the end of its latest visible session (a device checks in when it plays), or its registration.
  for (const d of data.devices) if (!happened(d.last_checkin_at)) {d.last_checkin_at = latest(d.registered_at, lastPlayed.get(d.device_id)); masked++;}
  // Progress changed after the clock reads as the latest visible session left it (none: unplayed).
  data.progress = data.progress.flatMap(p => {
    if (happened(p.updated_at) && episodes.has(p.episode_id)) return [p];
    masked++;
    const s = lastSession.get(p.member_id + '/' + p.episode_id), e = episodes.get(p.episode_id);
    if (!s || !e) return [];
    const played = s.end_position_s >= e.end_of_content_s;
    return [{member_id: p.member_id, episode_id: p.episode_id, state: played ? 'played' : 'in_progress', position_s: played ? 0 : s.end_position_s,
      updated_at: s.ended_at, played_at: played ? s.ended_at : null, set_by: 'session', replaced: null}];
  });
  // A play count last changed after the clock loses the plays recorded after it.
  const laterPlays = new Map();
  for (const s of stored.sessions) {
    if (s.item_type === 'track' && !happened(s.ended_at)) laterPlays.set(s.member_id + '/' + s.item_id, (laterPlays.get(s.member_id + '/' + s.item_id) || 0) + 1);
  }
  data.plays = data.plays.flatMap(p => {
    if (happened(p.last_played_at)) return [p];
    masked++;
    const k = p.member_id + '/' + p.track_id, count = p.count - (laterPlays.get(k) || 0), s = lastSession.get(k);
    return count > 0 && s ? [{...p, count, last_played_at: s.ended_at}] : [];
  }).filter(p => tracks.has(p.track_id));

  data.follows = keep(data.follows, f => happened(f.followed_at) && members.has(f.member_id), KEYS.follows);
  // Up Next set after the clock: the earlier list is not stored, so the member has none yet.
  data.upnext = keep(data.upnext, u => happened(u.updated_at), KEYS.upnext);
  for (const u of data.upnext) u.episode_ids = u.episode_ids.filter(id => episodes.has(id));

  // Downloads from requested_at; a later removal is undone, and an auto-delete time is shown only
  // once the episode it follows from has been played.
  const progress = new Map(data.progress.map(p => [p.member_id + '/' + p.episode_id, p]));
  data.downloads = keep(data.downloads, d => happened(d.requested_at) && devices.has(d.device_id) && item(d.item_type, d.item_id), KEYS.downloads);
  for (const d of data.downloads) {
    if (d.removed_at && !happened(d.removed_at)) {d.removed_at = null; d.removed_reason = null; masked++;}
    if (d.auto_delete_at && !d.removed_at && progress.get(d.member_id + '/' + d.item_id)?.state !== 'played') {d.auto_delete_at = null; masked++;}
  }
  data.library = keep(data.library, l => happened(l.saved_at) && item(l.item_type, l.item_id), KEYS.library);

  // Playlists from created_at, their tracks from added_at. track_version is not dated and stays as stored.
  data.playlists = keep(data.playlists, p => happened(p.created_at) && members.has(p.owner_member_id), KEYS.playlists);
  for (const p of data.playlists) {
    const entries = p.tracks.filter(x => happened(x.added_at) && tracks.has(x.track_id));
    if (entries.length < p.tracks.length || !happened(p.updated_at)) {
      masked++;
      p.tracks = entries;
      p.updated_at = latest(p.created_at, ...entries.map(x => x.added_at), happened(p.updated_at) ? p.updated_at : null);
    }
  }
  data.notifications = keep(data.notifications, n => happened(n.created_at), KEYS.notifications);
  // activity is written by the App and read by no tool; it is left as stored so new rows follow it.
  data[HIDDEN] = hidden;
  return {data, cut: hidden.size > 0 || masked > 0};
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Whole-record merge. A record the call changed replaces its stored form (also a later stored record
// with the same key); a record it removed is removed; untouched and hidden records keep their stored form.
function mergeList(stored, base, mine, key) {
  const before = new Map(base.map(x => [key(x), x])), after = new Map(mine.map(x => [key(x), x])), seen = new Set(), out = [];
  for (const s of stored) {
    const k = key(s);
    seen.add(k);
    if (before.has(k)) {
      if (after.has(k)) out.push(same(after.get(k), before.get(k)) ? s : after.get(k));
    } else out.push(after.has(k) ? after.get(k) : s);
  }
  for (const m of mine) {
    const k = key(m);
    if (!seen.has(k) && !(before.has(k) && same(m, before.get(k)))) out.push(m);
  }
  return out;
}
// Two unique keys are not record IDs: one active download per device and item, and one open
// invitation per person. A new record replaces a later stored one with the same key.
function replaceLater(list, base, mine, idKey, uniqueKey, active) {
  const before = new Set(base.map(idKey)), created = mine.filter(x => !before.has(idKey(x)));
  const createdIds = new Set(created.map(idKey)), taken = new Set(created.filter(active).map(uniqueKey));
  return list.filter(x => before.has(idKey(x)) || createdIds.has(idKey(x)) || !active(x) || !taken.has(uniqueKey(x)));
}
function merge(stored, base, mine) {
  const out = {...mine};
  for (const [name, key] of Object.entries(KEYS)) out[name] = mergeList(stored[name], base[name], mine[name], key);
  out.downloads = replaceLater(out.downloads, base.downloads, mine.downloads, KEYS.downloads, d => d.device_id + '/' + d.item_type + '/' + d.item_id, d => !d.removed_at);
  out.invitations = replaceLater(out.invitations, base.invitations, mine.invitations, KEYS.invitations, i => i.person_id, i => i.status === 'open');
  out.billing = {...mine.billing, timeline: same(mine.billing.timeline, base.billing.timeline) ? stored.billing.timeline : mine.billing.timeline};
  for (const [name, key] of Object.entries(BILLING_KEYS)) out.billing[name] = mergeList(stored.billing[name], base.billing[name], mine.billing[name], key);
  return out;
}

// Stored records that the view hid or showed in an earlier state, and that the data to store no longer
// keeps as they were: the later history a change removed or replaced. Records shown exactly as stored
// are the call's own business, reported by the tool itself. Returns null, or the IDs and the stored
// records by family (billing lists as billing.<name>, plan decisions by set_at).
function laterRemoved(stored, base, out) {
  const ids = {}, records = {};
  const note = (name, lost, key) => {if (lost.length) {ids[name] = lost.map(key); records[name] = copy(lost);}};
  const lists = [...Object.entries(KEYS).map(([name, key]) => [name, stored[name], base[name], out[name], key]),
    ...Object.entries(BILLING_KEYS).map(([name, key]) => ['billing.' + name, stored.billing[name], base.billing[name], out.billing[name], key])];
  for (const [name, list, shown, kept, key] of lists) {
    const before = new Map(shown.map(x => [key(x), x])), after = new Map(kept.map(x => [key(x), x]));
    note(name, list.filter(x => !same(before.get(key(x)), x) && !same(after.get(key(x)), x)), key);
  }
  const decisions = list => new Set(list.map(e => JSON.stringify(e))), earlier = decisions(base.billing.timeline), now = decisions(out.billing.timeline);
  note('billing.timeline', stored.billing.timeline.filter(e => !earlier.has(JSON.stringify(e)) && !now.has(JSON.stringify(e))), e => e.set_at);
  return Object.keys(ids).length ? {ids, records} : null;
}

// Runs a write or event on the view at `now` and returns the data to store. Later records the view
// hid stay stored. If keeping them would leave the family inconsistent with the change (storage
// caps, member limits, one open invitation or active download per key, a removed member's later records),
// the later family records are dropped instead: they described a future without this change. Later albums, tracks and episodes stay.
// Whatever later history is dropped or replaced is reported: the stored records in the change's activity
// row, and their IDs by family in `removed` (the caller counts them for the receipt and the log).
function commit(ctx, stored, now, change) {
  const {data: base, cut} = view(stored, now), mine = copy(base);
  mine[HIDDEN] = base[HIDDEN];
  const result = change(mine);
  delete mine[HIDDEN];
  if (!cut) return {data: mine, result, removed: null};
  let data = merge(stored, base, mine);
  try {
    validateSeed(ctx, data);
  } catch (error) {
    if (error.code !== 'invalid_seed') throw error;
    const later = {};
    for (const name of ['albums', 'tracks', 'episodes']) later[name] = mergeList(stored[name], base[name], mine[name], KEYS[name]);
    data = {...mine, ...later};
  }
  const lost = laterRemoved(stored, base, data);
  if (lost) data.activity[data.activity.length - 1].later_history_removed = lost.records;
  return {data, result, removed: lost && lost.ids};
}

module.exports = {view, commit, merge};
