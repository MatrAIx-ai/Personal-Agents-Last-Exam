'use strict';
// Record consistency for the catalog, the family account and its history. validateSeed runs on every
// loaded seed and after every committed call, so it holds only invariants that every write and event
// preserves; it never compares record dates with the run clock (Core validates package fixtures at
// registration under its own clock). Tools show only records dated at or before the clock
// (src/visible.cjs), so a multi-period seed can load at any point in its window.
const {fail, text, references, instant} = require('./domain-utils.cjs');
const {index, itemBytes} = require('./catalog.cjs');
const billing = require('./billing.cjs');

const TOLERANCE_S = 60;

function unique(list, key, label, code = 'invalid_seed') {
  const seen = new Set();
  for (const item of list) {
    const k = typeof key === 'function' ? key(item) : item[key];
    if (seen.has(k)) fail(code, 'Duplicate ' + label + ': ' + k + '.');
    seen.add(k);
  }
}

// Shared by seed validation ('invalid_seed') and listening.record ('invalid_event').
function checkSession(idx, s, code) {
  const member = idx.members.get(s.member_id), device = idx.devices.get(s.device_id);
  if (!member) fail(code, 'Session ' + s.session_id + ' names an unknown member.');
  if (!device) fail(code, 'Session ' + s.session_id + ' names an unknown device.');
  if (device.member_id !== s.member_id) fail(code, 'Session ' + s.session_id + ' is not under the account signed in on ' + device.device_id + '.');
  const item = s.item_type === 'track' ? idx.tracks.get(s.item_id) : idx.episodes.get(s.item_id);
  if (!item) fail(code, 'Session ' + s.session_id + ' names an unknown ' + s.item_type + '.');
  if (s.start_position_s > s.end_position_s || s.end_position_s > item.duration_s) {
    fail(code, 'Session ' + s.session_id + ' positions must run forward within the item\'s ' + item.duration_s + ' seconds.');
  }
  const elapsed = (instant(s.ended_at) - instant(s.started_at)) / 1000;
  if (!(elapsed > 0)) fail(code, 'Session ' + s.session_id + ' must end after it starts.');
  if ((s.end_position_s - s.start_position_s) / s.speed > elapsed + TOLERANCE_S) {
    fail(code, 'Session ' + s.session_id + ' covers more audio than its duration allows at speed ' + s.speed + '.');
  }
  if (s.speaker_hint !== null && s.speaker_hint !== undefined && !text(s.speaker_hint, 100)) fail(code, 'speaker_hint cannot be blank.');
  return item;
}
// Shared by seed validation and episode.publish.
function checkEpisode(idx, e, code) {
  if (!idx.shows.get(e.show_id)) fail(code, 'Episode ' + e.episode_id + ' names an unknown show.');
  if (e.end_of_content_s > e.duration_s) fail(code, 'Episode ' + e.episode_id + ' end-of-content marker is past its duration.');
  let last = -1;
  for (const c of e.chapters) {
    if (c.start_s <= last || c.start_s >= e.duration_s) fail(code, 'Episode ' + e.episode_id + ' chapters must start in order within the episode.');
    last = c.start_s;
  }
  if (!text(e.title, 200) || !text(e.notes, 2000)) fail(code, 'Episode title and notes cannot be blank.');
}
// Shared by seed validation and catalog.update: a clean version is a non-explicit track with the
// same title and artist as the explicit track that points to it.
function checkTrack(idx, t, code) {
  const album = idx.albums.get(t.album_id);
  if (!album || !idx.artists.get(t.artist_id)) fail(code, 'Track ' + t.track_id + ' names an unknown album or artist.');
  if (album.artist_id !== t.artist_id) fail(code, 'Track ' + t.track_id + ' artist differs from its album artist.');
  if (t.clean_version_id !== null) {
    const clean = idx.tracks.get(t.clean_version_id);
    if (!t.explicit) fail(code, 'Only an explicit track can name a clean version (' + t.track_id + ').');
    if (!clean || clean.explicit || clean.clean_version_id !== null) fail(code, 'Clean version of ' + t.track_id + ' must be an existing non-explicit track.');
    if (clean.title !== t.title || clean.artist_id !== t.artist_id) fail(code, 'Clean version of ' + t.track_id + ' must match its title and artist.');
  }
}

function validateSeed(ctx, data) {
  references(ctx, data);
  const idx = index(data);
  const people = new Set(ctx.binding.people.map(p => p.person_id));
  // Catalog IDs share one space so catalog.get_item and downloads resolve an ID to one item.
  unique([...data.artists.map(x => x.artist_id), ...data.albums.map(x => x.album_id), ...data.tracks.map(x => x.track_id),
    ...data.shows.map(x => x.show_id), ...data.episodes.map(x => x.episode_id)].map(id => ({id})), 'id', 'catalog ID');
  for (const [list, key] of [[data.members, 'member_id'], [data.invitations, 'invitation_id'], [data.devices, 'device_id'],
    [data.sessions, 'session_id'], [data.downloads, 'download_id'], [data.playlists, 'playlist_id'], [data.notifications, 'notice_id'],
    [data.billing.adjustments, 'adjustment_id'], [data.plans, 'plan_id']]) unique(list, key, key.replace(/_id$/, '') + ' ID');

  // Plans: the three tiers, ordered by rank and member limit.
  const ranked = [...data.plans].sort((a, b) => a.rank - b.rank);
  if (ranked.map(p => p.plan_id).join() !== 'individual,duo,family' || ranked.some((p, i) => i && p.max_members <= ranked[i - 1].max_members)) {
    fail('invalid_seed', 'Plans must be individual, duo and family in increasing rank and member limit.');
  }

  // Members and invitations come from the run binding; the bound person is an active member.
  unique(data.members, 'person_id', 'member person');
  for (const m of data.members) {
    if (!people.has(m.person_id)) fail('invalid_seed', 'Member ' + m.member_id + ' is not a person in the binding.');
    if ((m.status === 'removed') !== (m.removed_at !== null)) fail('invalid_seed', 'Member ' + m.member_id + ' removed_at must match its status.');
  }
  const managers = data.members.filter(m => m.role === 'manager');
  if (managers.length !== 1 || managers[0].status !== 'active') fail('invalid_seed', 'A family has exactly one active plan manager.');
  if (!data.members.some(m => m.person_id === data.owner_person_id && m.status === 'active')) {
    fail('invalid_seed', 'The bound account owner must be an active family member.');
  }
  const open = new Set();
  for (const inv of data.invitations) {
    if (!people.has(inv.person_id)) fail('invalid_seed', 'Invitation ' + inv.invitation_id + ' is for a person not in the binding.');
    if (!idx.members.has(inv.invited_by)) fail('invalid_seed', 'Invitation ' + inv.invitation_id + ' names an unknown inviter.');
    if ((inv.status === 'open') !== (inv.responded_at === null)) fail('invalid_seed', 'Invitation ' + inv.invitation_id + ' responded_at must match its status.');
    if (inv.status !== 'open') continue;
    if (open.has(inv.person_id)) fail('invalid_seed', 'A person can have at most one open invitation.');
    if (data.members.some(m => m.person_id === inv.person_id && m.status === 'active')) fail('invalid_seed', 'An active member cannot have an open invitation.');
    open.add(inv.person_id);
  }

  // Billing: a non-decreasing plan timeline, invoices on the anchor's monthly calendar, and no more
  // members (plus open invitations) than the last plan on the timeline allows. A scheduled downgrade
  // is always the last entry, and upgrades start at once, so that plan is the smallest one ahead.
  const b = data.billing;
  if (instant(b.timeline[0].from) > instant(b.anchor)) fail('invalid_seed', 'The plan timeline must start by the billing anchor.');
  b.timeline.forEach((e, i) => {
    if (i && instant(e.from) < instant(b.timeline[i - 1].from)) fail('invalid_seed', 'Plan timeline entries must be in order.');
    if (instant(e.set_at) > instant(e.from) && e.change !== 'start') fail('invalid_seed', 'A plan change cannot be set after it takes effect.');
  });
  for (const x of [...b.adjustments, ...b.payments]) {
    if (billing.invoiceIndex(data, x.invoice_id) < 0) fail('invalid_seed', 'Unknown invoice ' + x.invoice_id + ' for this billing calendar.');
  }
  const last = billing.plan(data, b.timeline[b.timeline.length - 1].plan_id);
  if (billing.counted(data) > last.max_members) fail('invalid_seed', 'The family has more members and open invitations than the ' + last.name + ' plan allows.');

  // Catalog.
  for (const a of data.albums) {
    if (!idx.artists.has(a.artist_id)) fail('invalid_seed', 'Album ' + a.album_id + ' names an unknown artist.');
    for (const id of a.track_ids) {
      if (idx.tracks.get(id)?.album_id !== a.album_id) fail('invalid_seed', 'Album ' + a.album_id + ' lists a track that is not on it.');
    }
  }
  for (const t of data.tracks) checkTrack(idx, t, 'invalid_seed');
  for (const e of data.episodes) checkEpisode(idx, e, 'invalid_seed');

  // Devices, sessions and progress.
  for (const d of data.devices) if (!idx.members.has(d.member_id)) fail('invalid_seed', 'Device ' + d.device_id + ' names an unknown member.');
  for (const s of data.sessions) checkSession(idx, s, 'invalid_seed');
  unique(data.progress, p => p.member_id + '/' + p.episode_id, 'progress entry');
  for (const p of data.progress) {
    const e = idx.episodes.get(p.episode_id);
    if (!idx.members.has(p.member_id) || !e) fail('invalid_seed', 'Progress names an unknown member or episode.');
    if (p.position_s > e.duration_s) fail('invalid_seed', 'Progress on ' + p.episode_id + ' is past the episode duration.');
    if ((p.state === 'played') !== (p.played_at !== null)) fail('invalid_seed', 'Progress on ' + p.episode_id + ' played_at must match its state.');
    if ((p.set_by === 'agent') !== (p.replaced !== null)) fail('invalid_seed', 'Agent progress changes record the replaced value.');
  }
  unique(data.plays, p => p.member_id + '/' + p.track_id, 'play count');
  for (const p of data.plays) if (!idx.members.has(p.member_id) || !idx.tracks.has(p.track_id)) fail('invalid_seed', 'Play count names an unknown member or track.');

  // Follows, Up Next, library.
  unique(data.follows, f => f.member_id + '/' + f.show_id, 'follow');
  for (const f of data.follows) if (!idx.members.has(f.member_id) || !idx.shows.has(f.show_id)) fail('invalid_seed', 'Follow names an unknown member or show.');
  unique(data.upnext, 'member_id', 'Up Next list');
  for (const u of data.upnext) {
    if (!idx.members.has(u.member_id) || u.episode_ids.some(id => !idx.episodes.has(id))) fail('invalid_seed', 'Up Next names an unknown member or episode.');
  }
  unique(data.library, l => l.member_id + '/' + l.item_type + '/' + l.item_id, 'saved item');
  for (const l of data.library) {
    if (!idx.members.has(l.member_id) || !idx[l.item_type + 's'].has(l.item_id)) fail('invalid_seed', 'Library entry names an unknown member or item.');
  }

  // Downloads: on the owner's own device, the item's size, and within each device's cap. Downloads
  // without removed_at count against the cap, so a seed must already fit at every clock.
  unique(data.downloads.filter(d => !d.removed_at), d => d.device_id + '/' + d.item_type + '/' + d.item_id, 'active download');
  const used = new Map();
  for (const d of data.downloads) {
    const device = idx.devices.get(d.device_id), item = idx[d.item_type + 's'].get(d.item_id);
    if (!device || !idx.members.has(d.member_id) || !item) fail('invalid_seed', 'Download ' + d.download_id + ' names an unknown member, device or item.');
    if (device.member_id !== d.member_id) fail('invalid_seed', 'Download ' + d.download_id + ' is on another member\'s device.');
    if (d.bytes !== itemBytes(idx, d.item_type, item)) fail('invalid_seed', 'Download ' + d.download_id + ' size differs from its item.');
    if (instant(d.completes_at) < instant(d.requested_at)) fail('invalid_seed', 'Download ' + d.download_id + ' completes before it was requested.');
    if ((d.removed_at === null) !== (d.removed_reason === null)) fail('invalid_seed', 'Download ' + d.download_id + ' removed_reason must match removed_at.');
    if (!d.removed_at) used.set(d.device_id, (used.get(d.device_id) || 0) + d.bytes);
  }
  for (const [id, bytes] of used) {
    if (bytes > idx.devices.get(id).storage_cap_bytes) fail('invalid_seed', 'Downloads on ' + id + ' exceed its storage cap.');
  }

  // Playlists.
  for (const p of data.playlists) {
    if (!idx.members.has(p.owner_member_id)) fail('invalid_seed', 'Playlist ' + p.playlist_id + ' names an unknown owner.');
    if (p.collaborators.some(id => !idx.members.has(id) || id === p.owner_member_id)) fail('invalid_seed', 'Playlist ' + p.playlist_id + ' collaborators must be other members.');
    unique(p.tracks, 'track_id', 'track in playlist ' + p.playlist_id);
    for (const t of p.tracks) {
      if (!idx.tracks.has(t.track_id) || !idx.members.has(t.added_by)) fail('invalid_seed', 'Playlist ' + p.playlist_id + ' names an unknown track or author.');
    }
    if (!text(p.name, 100)) fail('invalid_seed', 'Playlist names cannot be blank.');
  }
  for (const n of data.notifications) if (!idx.members.has(n.member_id)) fail('invalid_seed', 'Notice ' + n.notice_id + ' names an unknown member.');

  // Removed members. members.remove ends the member's downloads and their collaborator places on others'
  // playlists, and from then on nothing is recorded for them: tools act only as the active caller, and events
  // refuse an inactive member, notify and auto-download only for active followers, and let only an active
  // owner or collaborator edit a playlist. So nothing of theirs is dated after removed_at, none of their
  // downloads was still on a device then, and they hold no collaborator place. (A device check-in is not
  // the member's record and is not checked.) Writes and events keep this; one at an earlier clock that
  // later seeded records contradict drops the later family records instead (src/visible.cjs).
  const DATED = [['devices', 'registered_at', 'a device registered'], ['sessions', 'ended_at', 'a listening session ended'],
    ['progress', 'updated_at', 'episode progress updated'], ['plays', 'last_played_at', 'a track play count last played'],
    ['follows', 'followed_at', 'a follow started'], ['upnext', 'updated_at', 'an Up Next list updated'],
    ['downloads', 'requested_at', 'a download requested'], ['library', 'saved_at', 'a library save'], ['notifications', 'created_at', 'a notice created']];
  for (const m of data.members) {
    if (m.status !== 'removed') continue;
    const t = instant(m.removed_at), after = ts => ts !== null && ts !== undefined && instant(ts) > t;
    const has = what => fail('invalid_seed', m.display_name + ' (' + m.member_id + ') was removed at ' + m.removed_at + ' but has ' + what + '.');
    for (const [family, key, what] of DATED) {
      const x = data[family].find(r => r.member_id === m.member_id && after(r[key]));
      if (x) has(what + ' at ' + x[key]);
    }
    for (const d of data.downloads) {
      if (d.member_id !== m.member_id) continue;
      const gone = d.removed_at ? !after(d.removed_at) : Boolean(d.auto_delete_at) && !after(d.auto_delete_at);
      if (!gone) has('download ' + d.download_id + ' still on a device at the removal');
    }
    for (const p of data.playlists) {
      if (p.owner_member_id === m.member_id && after(p.created_at)) has('playlist ' + p.playlist_id + ' created at ' + p.created_at);
      const x = p.tracks.find(e => e.added_by === m.member_id && after(e.added_at));
      if (x) has('a track added to playlist ' + p.playlist_id + ' at ' + x.added_at);
      if (p.owner_member_id !== m.member_id && p.collaborators.includes(m.member_id)) has('a collaborator place on playlist ' + p.playlist_id);
    }
  }
  data.activity.forEach((a, i) => {if (i && a.seq <= data.activity[i - 1].seq) fail('invalid_seed', 'Activity rows must be in sequence order.');});
}

// Records counted by contribution/dataset.json: catalog items, listening sessions and playlists.
const records = data => [...data.artists, ...data.albums, ...data.tracks, ...data.shows, ...data.episodes, ...data.sessions, ...data.playlists];
const objects = data => [...data.artists.map(x => x.artist_id), ...data.albums.map(x => x.album_id), ...data.tracks.map(x => x.track_id),
  ...data.shows.map(x => x.show_id), ...data.episodes.map(x => x.episode_id), ...data.members.map(x => x.member_id),
  ...data.devices.map(x => x.device_id), ...data.sessions.map(x => x.session_id), ...data.playlists.map(x => x.playlist_id),
  ...data.downloads.map(x => x.download_id), ...data.invitations.map(x => x.invitation_id)];

module.exports = {validateSeed, checkSession, checkEpisode, checkTrack, records, objects, references: () => []};
