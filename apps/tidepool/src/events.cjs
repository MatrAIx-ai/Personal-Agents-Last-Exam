'use strict';
// Infra-applied incoming events. Core deduplicates event IDs, sets ctx.virtual_now to event.at and
// rolls back any failure. Each applied event appends one activity row with actor "event". Handlers see
// the data as of event.at (src/visible.cjs): lookups, "newest n" and positions count visible records.
const {fail, copy, instant, hiddenIds} = require('./domain-utils.cjs');
const cutoff = require('./visible.cjs');
const {log} = require('./diagnostics.cjs');
const c = require('./catalog.cjs');
const a = require('./account.cjs');
const billing = require('./billing.cjs');
const rules = require('./rules.cjs');
const {checkSession, checkEpisode, checkTrack} = require('./model.cjs');

const name = value => value.trim().toLowerCase();
const activeMember = (data, id, label) => {
  const m = data.members.find(x => x.member_id === id);
  if (!m || m.status !== 'active') fail('invalid_event', 'Unknown or inactive ' + label + ' ' + id + '.');
  return m;
};
const cap = value => value[0].toUpperCase() + value.slice(1);
const money = cents => '$' + (cents / 100).toFixed(2);

// listening.record: append the session and update only that member's progress or play count. An
// episode counts as played when the session ends at or past its end-of-content marker.
function listening(ctx, data, event) {
  const p = event.payload, now = event.at, idx = c.index(data);
  if (data.sessions.some(s => s.session_id === p.session_id) || hiddenIds(data).has(p.session_id)) fail('invalid_event', 'Session ' + p.session_id + ' is already recorded.');
  activeMember(data, p.member_id, 'member');
  const session = {...copy(p), ended_at: now, speaker_hint: p.speaker_hint ?? null};
  const item = checkSession(idx, session, 'invalid_event');
  const show = p.item_type === 'episode' ? idx.shows.get(item.show_id) : null;
  if (item.availability !== 'available' || (show && show.availability !== 'available')) {
    fail('invalid_event', 'The ' + p.item_type + ' ' + p.item_id + (show && show.availability !== 'available' ? ' belongs to a removed show' : ' has been removed') + ' and cannot be played.');
  }
  data.sessions.push(session);
  if (p.item_type === 'track') {
    let play = data.plays.find(x => x.member_id === p.member_id && x.track_id === p.item_id);
    const replaced = {count: play ? play.count : 0};
    if (!play) {play = {member_id: p.member_id, track_id: p.item_id, count: 0}; data.plays.push(play);}
    play.count++; play.last_played_at = now;
    return {object_type: 'session', object_id: p.session_id, member_id: p.member_id, replaced};
  }
  let progress = c.progressOf(data, p.member_id, p.item_id);
  const replaced = progress ? {state: progress.state, position_s: progress.position_s} : {state: 'unplayed', position_s: 0};
  if (!progress) {progress = {member_id: p.member_id, episode_id: p.item_id}; data.progress.push(progress);}
  const played = p.end_position_s >= item.end_of_content_s;
  Object.assign(progress, {state: played ? 'played' : 'in_progress', position_s: played ? 0 : p.end_position_s, updated_at: now,
    played_at: played ? now : null, set_by: 'session', replaced: null});
  a.scheduleAutoDelete(data, p.member_id, p.item_id, now);
  return {object_type: 'session', object_id: p.session_id, member_id: p.member_id, replaced};
}

// episode.publish: add the episode, then for each active follower with auto-download on, queue it on
// each of their auto-download devices. Auto-downloads of the show that fall outside the newest n are
// released to make room; if it still does not fit, the device records storage_full in the notice.
function publish(ctx, data, event) {
  const p = event.payload, now = event.at, idx = c.index(data);
  // A seeded episode dated later still owns its ID, as in Dayline: publishing it again is refused.
  if (c.find(idx, p.episode_id) || hiddenIds(data).has(p.episode_id)) fail('invalid_event', 'Catalog ID ' + p.episode_id + ' already exists.');
  const show = idx.shows.get(p.show_id);
  checkEpisode(idx, p, 'invalid_event');
  if (show.availability !== 'available') fail('invalid_event', 'Show ' + p.show_id + ' has been removed.');
  if (instant(p.published_at) > instant(now)) fail('invalid_event', 'Episode ' + p.episode_id + ' is dated after the event that publishes it.');
  const episode = {...copy(p), availability: 'available'};
  data.episodes.push(episode); idx.episodes.set(episode.episode_id, episode);
  const outcomes = [];
  for (const follow of data.follows.filter(f => f.show_id === p.show_id)) {
    const m = idx.members.get(follow.member_id);
    if (m.status !== 'active') continue;
    const parts = [];
    if (follow.auto_download_count > 0) {
      const newest = new Set(c.episodesOf(data, p.show_id).sort((x, y) => instant(y.published_at) - instant(x.published_at) || y.number - x.number)
        .slice(0, follow.auto_download_count).map(e => e.episode_id));
      for (const device of data.devices.filter(d => d.member_id === m.member_id && d.auto_download && a.offlineCapable(d))) {
        if (billing.graceExpired(data, now)) {parts.push('not downloaded to ' + device.name + ' (payment due)'); outcomes.push({device_id: device.device_id, outcome: 'payment_due'}); continue;}
        const release = data.downloads.filter(d => d.device_id === device.device_id && d.source === 'auto' && d.item_type === 'episode' &&
          a.occupying(data, d, now) && idx.episodes.get(d.item_id).show_id === p.show_id && !newest.has(d.item_id));
        const free = device.storage_cap_bytes - a.usedBytes(data, device.device_id, now) + release.reduce((s, d) => s + d.bytes, 0);
        if (episode.bytes > free) {parts.push('not downloaded to ' + device.name + ' (storage full)'); outcomes.push({device_id: device.device_id, outcome: 'storage_full'}); continue;}
        for (const d of release) {d.removed_at = now; d.removed_reason = 'auto_download_limit';}
        const d = rules.reserve(data, idx, device, 'episode', episode, 'auto', now);
        parts.push('downloading to ' + device.name);
        outcomes.push({device_id: device.device_id, outcome: 'queued', download_id: d.download_id});
      }
    }
    a.notice(data, {member_id: m.member_id, created_at: now, kind: 'episode_published', object_type: 'episode', object_id: p.episode_id,
      event_id: event.event_id, text: 'New episode of ' + show.title + ': ' + p.title + '.' + (parts.length ? ' ' + cap(parts.join('; ')) + '.' : '')});
  }
  log(ctx, 'tidepool.episode_published', {episode_id: p.episode_id, auto_downloads: outcomes.length});
  return {object_type: 'episode', object_id: p.episode_id, member_id: null, replaced: null};
}

// catalog.update: remove an item (its downloads end) or change its explicit flag.
function catalogUpdate(ctx, data, event) {
  const p = event.payload, now = event.at, idx = c.index(data);
  const item = idx[p.item_type + 's'].get(p.item_id);
  if (!item) fail('invalid_event', 'Unknown ' + p.item_type + ' ' + p.item_id + '.');
  if (p.availability === undefined && p.explicit === undefined) fail('invalid_event', 'catalog.update needs availability or explicit.');
  if (p.explicit !== undefined && p.item_type === 'album') fail('invalid_event', 'Albums have no explicit flag; update their tracks.');
  const replaced = {availability: item.availability, ...(p.explicit !== undefined ? {explicit: item.explicit} : {})};
  if (p.explicit !== undefined) item.explicit = p.explicit;
  if (p.availability === 'removed') {
    item.availability = 'removed';
    const gone = new Set([p.item_id, ...(p.item_type === 'show' ? c.episodesOf(data, p.item_id).map(e => e.episode_id) : [])]);
    for (const d of data.downloads) {
      if (gone.has(d.item_id) && a.occupying(data, d, now)) {d.removed_at = now; d.removed_reason = 'item_removed';}
    }
  }
  for (const t of data.tracks) checkTrack(idx, t, 'invalid_event');
  return {object_type: p.item_type, object_id: p.item_id, member_id: null, replaced};
}

// playlist.edit: find the playlist by seeded ID or by {owner_member_id, name} (case and surrounding
// spaces ignored), check the author may edit it at this moment, then apply the operations in order.
function playlistEdit(ctx, data, event) {
  const p = event.payload, now = event.at, idx = c.index(data);
  const author = data.members.find(m => m.member_id === p.author_member_id);
  if (!author) fail('invalid_event', 'Unknown author ' + p.author_member_id + '.');
  let playlist;
  if (p.playlist_id !== undefined) {
    // playlist_id names seeded playlists only; playlists created during the run are named by playlist_ref.
    playlist = idx.playlists.get(p.playlist_id);
    if (!playlist || playlist.origin !== 'seed') fail('target_not_found', 'No seeded playlist ' + p.playlist_id + '; name playlists created during the run by playlist_ref.');
  } else {
    if (!idx.members.has(p.playlist_ref.owner_member_id)) fail('invalid_event', 'Unknown playlist owner ' + p.playlist_ref.owner_member_id + '.');
    const matches = data.playlists.filter(x => x.owner_member_id === p.playlist_ref.owner_member_id && name(x.name) === name(p.playlist_ref.name));
    if (!matches.length) fail('target_not_found', 'No playlist named "' + p.playlist_ref.name.trim() + '" owned by ' + p.playlist_ref.owner_member_id + '.');
    if (matches.length > 1) fail('ambiguous_target', matches.length + ' playlists owned by ' + p.playlist_ref.owner_member_id + ' are named "' + p.playlist_ref.name.trim() + '".');
    playlist = matches[0];
  }
  const role = author.status === 'active' ? a.playlistRole(data, playlist, author.member_id) : null;
  if (role !== 'owner' && role !== 'collaborator') fail('not_collaborator', author.display_name + ' is not the owner or a collaborator of "' + playlist.name + '".');
  const replaced = playlist.tracks.map(t => t.track_id);
  rules.applyTrackOps(idx, playlist, p.operations, author.member_id, now, 'event');
  if (author.member_id !== playlist.owner_member_id) {
    const counts = ['add', 'remove', 'move'].map(op => [op, p.operations.filter(x => x.op === op).length]).filter(([, n]) => n);
    const verbs = {add: 'added', remove: 'removed', move: 'moved'};
    a.notice(data, {member_id: playlist.owner_member_id, created_at: now, kind: 'playlist_edited', object_type: 'playlist', object_id: playlist.playlist_id,
      event_id: event.event_id, text: author.display_name + ' ' + counts.map(([op, n]) => verbs[op] + ' ' + n + (n === 1 ? ' track' : ' tracks')).join(', ') +
        ' in "' + playlist.name + '": ' + p.operations.map(x => x.op + ' ' + idx.tracks.get(x.track_id).title).join('; ') + '.'});
  }
  return {object_type: 'playlist', object_id: playlist.playlist_id, member_id: author.member_id, replaced};
}

function checkin(ctx, data, event) {
  const device = data.devices.find(d => d.device_id === event.payload.device_id);
  if (!device) fail('invalid_event', 'Unknown device ' + event.payload.device_id + '.');
  const replaced = {last_checkin_at: device.last_checkin_at};
  device.last_checkin_at = event.at;
  return {object_type: 'device', object_id: device.device_id, member_id: device.member_id, replaced};
}

// billing.payment_result: record a paid or declined charge for an invoice whose period has started.
function payment(ctx, data, event) {
  const p = event.payload, now = event.at, k = billing.invoiceIndex(data, p.invoice_id);
  if (k < 0) fail('invalid_event', 'Unknown invoice ' + p.invoice_id + ' for this billing calendar.');
  const inv = billing.invoice(data, k, now);
  if (inv.status === 'upcoming') fail('invalid_event', 'Invoice ' + p.invoice_id + ' is for a period that has not started.');
  if (inv.status === 'paid') fail('invalid_event', 'Invoice ' + p.invoice_id + ' is already paid.');
  data.billing.payments.push({invoice_id: p.invoice_id, outcome: p.outcome, at: now, amount_cents: inv.amount_cents});
  if (p.outcome === 'declined') {
    const due = billing.paymentDue(data, now);
    a.notice(data, {member_id: data.members.find(m => m.role === 'manager').member_id, created_at: now, kind: 'payment_declined', object_type: 'invoice',
      object_id: p.invoice_id, event_id: event.event_id, text: 'Payment of ' + money(inv.amount_cents) + ' for the period starting ' +
        inv.period_start.slice(0, 10) + ' was declined. Pay by ' + due.grace_ends_at + ' to keep downloads available offline.'});
  }
  return {object_type: 'invoice', object_id: p.invoice_id, member_id: null, replaced: {status: inv.status}};
}

// family.invite_response: match the invitee's one open invitation by person_id.
function inviteResponse(ctx, data, event) {
  const p = event.payload, now = event.at;
  const inv = data.invitations.find(i => i.person_id === p.invitee_person_id && i.status === 'open');
  if (!inv) fail('target_not_found', 'No open invitation for ' + p.invitee_person_id + '.');
  inv.status = p.response; inv.responded_at = now;
  let memberId = null;
  if (p.response === 'accepted') {
    let m = data.members.find(x => x.person_id === inv.person_id);
    if (m) Object.assign(m, {status: 'active', removed_at: null, joined_at: now, explicit_filter: inv.explicit_filter});
    else {
      const base = 'mem-' + inv.person_id.replace(/^person-/, '');
      let id = base, n = 2;
      while (data.members.some(x => x.member_id === id)) id = base + '-' + n++;
      m = {member_id: id, person_id: inv.person_id, display_name: ctx.binding.people.find(x => x.person_id === inv.person_id)?.name || inv.person_id,
        role: 'member', age_group: 'adult', status: 'active', explicit_filter: inv.explicit_filter, joined_at: now, removed_at: null};
      data.members.push(m);
    }
    memberId = m.member_id;
  }
  return {object_type: 'invitation', object_id: inv.invitation_id, member_id: memberId, replaced: {status: 'open'}};
}

const HANDLERS = {'listening.record': listening, 'episode.publish': publish, 'catalog.update': catalogUpdate, 'playlist.edit': playlistEdit,
  'device.checkin': checkin, 'billing.payment_result': payment, 'family.invite_response': inviteResponse};

const CATALOG_EVENTS = new Set(['episode.publish', 'catalog.update']);

function applyEvent(ctx, stored, event) {
  const handler = HANDLERS[event.operation];
  if (!handler) fail('invalid_event', 'Unsupported operation.');
  const out = cutoff.commit(ctx, stored, event.at, data => {
    if (!CATALOG_EVENTS.has(event.operation) && !data.members.some(m => m.role === 'manager')) {
      fail('invalid_event', 'The family account does not exist yet at ' + event.at + '.');
    }
    a.settle(data, event.at);
    const row = handler(ctx, data, event);
    a.activity(data, {...row, at: event.at, actor: 'event', action: event.operation, event_id: event.event_id});
    return row;
  });
  log(ctx, 'tidepool.event_applied', {operation: event.operation, object_id: out.result.object_id});
  return out.data;
}

module.exports = {applyEvent};
