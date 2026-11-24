'use strict';
// Seven incoming events, applied at their own time T (ctx.virtual_now inside the handler). Each
// handler resolves and checks everything first and refuses with invalid_event before it changes
// anything; then it writes one activity row for the event and one for each effect.
//
// Naming albums and links: an event names an album by album_id or by album_match ({person_id,
// contains_item_ids, title}), resolved at T over albums that are not deleted; when several match,
// the most recently created one is taken. The album and link a match resolved to are stored in
// the event's activity row (and on the records it changed), so a replay of the same event_id,
// which Core answers from its stored receipt without running this code, keeps the first resolution.
const c = require('./common.cjs');
const d = require('./derive.cjs');
const {notify, plural, itemWord} = require('./notify.cjs');
const {dropContributions} = require('./albums.cjs');

const reject = message => c.fail('invalid_event', message);
const fold = s => s.normalize('NFC').trim().toLowerCase();

function matches(album, m) {
  return (!m.person_id || album.members.some(x => x.person_id === m.person_id && d.OPEN.has(x.status))) &&
    (!m.contains_item_ids || m.contains_item_ids.every(id => album.item_ids.includes(id))) &&
    (!m.title || fold(album.title) === fold(m.title));
}
// Resolve the album an event names. `accept(album)` is the extra condition the event needs
// (e.g. the event's person invited there); with a match it is part of the match.
function resolveAlbum(data, ref, accept = () => true, {allowEmptyMatch = false, why = 'the event does not apply to it'} = {}) {
  if (ref.album_id !== undefined) {
    const album = data.albums.find(a => a.id === ref.album_id);
    if (!album) reject('Unknown album ' + ref.album_id + '.');
    if (album.deleted_at) reject('Album ' + ref.album_id + ' was deleted.');
    if (!accept(album)) reject('Album ' + ref.album_id + ': ' + why + '.');
    return {album, by_match: false};
  }
  if (!allowEmptyMatch && !Object.keys(ref.album_match).length) reject('album_match needs person_id, contains_item_ids or title.');
  let found = null;
  data.albums.forEach(album => {
    if (album.deleted_at || !matches(album, ref.album_match) || !accept(album)) return;
    if (!found || c.ms(album.created_at) >= c.ms(found.created_at)) found = album;
  });
  if (!found) reject('album_match found no album.');
  return {album: found, by_match: true};
}
const member = (album, personId) => album.members.find(m => m.person_id === personId);
function checkNewIds(data, ids) {
  const idx = d.index(data), seen = new Set();
  for (const id of ids) {
    if (idx.items.has(id) || idx.contributions.has(id) || seen.has(id)) reject('Duplicate item ID ' + id + '.');
    seen.add(id);
  }
}
function checkLabels(data, labels) {
  for (const l of labels || []) if (!data.labels.some(x => x.id === l)) reject('Unknown people label ' + l + '.');
}
const place = p => (p ? {label: p.label, lat: p.lat ?? null, lon: p.lon ?? null} : null);
const base = (ctx, data, event, object_ids, details) =>
  c.activity(ctx, data, {actor: 'event', action: 'event.' + event.operation.slice('fernshelf.'.length), object_ids, event_id: event.event_id, details});
const effect = (ctx, data, event, cause_seq, action, object_ids, details) =>
  c.activity(ctx, data, {actor: 'event', action, object_ids, event_id: event.event_id, cause_seq, details});

// Backing up happens only inside an event: take waiting items oldest first while each fits.
function backupPass(ctx, data, event, cause) {
  const t = d.now(ctx), quota = data.account.quota_bytes;
  let used = d.usedBytes(data, t);
  const queue = d.waitingQueue(data, t);
  let k = 0;
  for (; k < queue.length && used + queue[k].declared_bytes <= quota; k++) {
    const item = queue[k];
    item.backed_up = true;
    used += item.declared_bytes;
    c.history(ctx, item, 'backed_up', {event_id: event.event_id});
    effect(ctx, data, event, cause, 'effect.item.backed_up', [item.id], {declared_bytes: item.declared_bytes});
  }
  return {used, waiting: queue.length - k};
}
// storage.threshold: once when an event takes used_bytes from below to at or above 80% of the
// quota, and once when it leaves an item waiting while none was waiting before it.
function thresholds(ctx, data, event, cause, before) {
  const t = d.now(ctx), quota = data.account.quota_bytes, used = d.usedBytes(data, t), waiting = d.waitingQueue(data, t);
  if (before.used < 0.8 * quota && used >= 0.8 * quota) {
    notify(ctx, data, {kind: 'storage.threshold', level: 80, object_type: 'account', object_id: data.account_id, event_id: event.event_id, cause_seq: cause,
      title: 'Your Fernshelf storage is 80% full',
      body: 'You are using ' + (used / c.GB).toFixed(2) + ' GB of your ' + (quota / c.GB).toFixed(2) + ' GB. When it is full, new photos and videos wait on your device until there is space. Open Fernshelf to review storage and the trash.'});
  }
  if (before.waiting === 0 && waiting.length > 0) {
    const bytes = waiting.reduce((n, i) => n + i.declared_bytes, 0);
    notify(ctx, data, {kind: 'storage.threshold', level: 'full', object_type: 'account', object_id: data.account_id, event_id: event.event_id, cause_seq: cause,
      title: 'Your Fernshelf storage is full',
      body: plural(waiting.length, 'item') + ' (' + (bytes / c.GB).toFixed(2) + ' GB) could not be backed up and are still only on your device. Free space in Fernshelf and they will be backed up at the next sync.'});
  }
}
const snapshotStorage = (data, t) => ({used: d.usedBytes(data, t), waiting: d.waitingQueue(data, t).length});

function itemAdded(ctx, data, event) {
  const p = event.payload, t = d.now(ctx);
  checkNewIds(data, [p.item_id]);
  checkLabels(data, p.people);
  if (c.ms(p.taken_at) > t) reject('An item cannot be taken after it is added.');
  const stack = p.stack ? data.stacks.find(s => s.id === p.stack.stack_id) : null;
  if (stack && stack.kind !== p.stack.kind) reject('Stack ' + stack.id + ' is a ' + stack.kind + ' stack.');
  if (p.kind === 'photo' && p.duration_ms !== undefined) reject('A photo has no duration.');
  const before = snapshotStorage(data, t);
  const cause = base(ctx, data, event, [p.item_id, ...(p.stack ? [p.stack.stack_id] : [])], {declared_bytes: p.declared_bytes});
  const pass = backupPass(ctx, data, event, cause);
  const fits = pass.waiting === 0 && pass.used + p.declared_bytes <= data.account.quota_bytes;
  const item = {id: p.item_id, kind: p.kind, taken_at: p.taken_at, added_at: ctx.virtual_now, place: place(p.place), people: (p.people || []).slice(),
    caption: p.caption ?? null, source: p.source, favorite: false, archived: false, backed_up: fits, declared_bytes: p.declared_bytes,
    content_hash: p.content_hash ?? null, width: p.width ?? null, height: p.height ?? null, duration_ms: p.duration_ms ?? null, file: null, state: 'active',
    trashed_at: null, purge_at: null, purged_at: null, saved_from: null, removal_history: [], history: []};
  c.history(ctx, item, fits ? 'added' : 'added_waiting', {event_id: event.event_id});
  data.items.push(item);
  effect(ctx, data, event, cause, fits ? 'effect.item.backed_up' : 'effect.item.waiting', [item.id], {declared_bytes: item.declared_bytes});
  if (p.stack) {
    if (stack) {
      stack.item_ids.push(item.id);
      if (!stack.cover_id) stack.cover_id = item.id;
      effect(ctx, data, event, cause, 'effect.stack.joined', [stack.id, item.id], {cover_id: stack.cover_id});
    } else {
      data.stacks.push({id: p.stack.stack_id, kind: p.stack.kind, cover_id: item.id, item_ids: [item.id], created_at: ctx.virtual_now});
      effect(ctx, data, event, cause, 'effect.stack.created', [p.stack.stack_id, item.id], {kind: p.stack.kind});
    }
  }
  thresholds(ctx, data, event, cause, before);
}

function backupResumed(ctx, data, event) {
  const t = d.now(ctx), before = snapshotStorage(data, t);
  const cause = base(ctx, data, event, [], {waiting_before: before.waiting});
  backupPass(ctx, data, event, cause);
  thresholds(ctx, data, event, cause, before);
}

const NEEDS = {join: ['invited'], decline: ['invited'], leave: ['invited', 'joined']};
function memberChanged(ctx, data, event) {
  const p = event.payload;
  // With a match the event's own person in the needed status is part of the match (joined for a leave).
  const needed = p.album_match ? (p.change === 'leave' ? ['joined'] : ['invited']) : NEEDS[p.change];
  const {album, by_match} = resolveAlbum(data, p, a => { const m = member(a, p.person_id); return !!m && needed.includes(m.status); },
    {allowEmptyMatch: true, why: p.person_id + ' is not ' + needed.join(' or ') + ' there'});
  const m = member(album, p.person_id);
  const status = {join: 'joined', decline: 'declined', leave: 'left'}[p.change];
  const cause = base(ctx, data, event, [album.id, p.person_id], {change: p.change, album_id: album.id, resolved_by_match: by_match});
  m.status = status;
  if (status === 'joined') m.joined_at = ctx.virtual_now; else m.ended_at = ctx.virtual_now;
  m.history.push({at: ctx.virtual_now, action: status, actor: 'event', request_id: null, event_id: event.event_id});
  effect(ctx, data, event, cause, 'effect.member.' + status, [album.id, p.person_id]);
  const dropped = status === 'left' ? dropContributions(ctx, album, p.person_id, 'member_left') : [];
  if (dropped.length) effect(ctx, data, event, cause, 'effect.contributions.removed', [album.id, ...dropped], {reason: 'member_left'});
  const who = c.nameOf(data, p.person_id);
  const text = {joined: [who + ' joined ' + album.title, who + ' accepted your invitation and can now see the ' + plural(d.albumShows(album, d.index(data), d.now(ctx)).length, 'item') + ' in the shared album ' + album.title + '.'],
    declined: [who + ' declined your invitation to ' + album.title, who + ' declined your invitation to the album ' + album.title + '.'],
    left: [who + ' left ' + album.title, who + ' left the shared album ' + album.title + '.' + (dropped.length ? ' The ' + plural(dropped.length, 'item') + ' they added left the album with them; anything you saved stays in your library.' : '')]}[status];
  notify(ctx, data, {kind: 'album.activity', object_type: 'album', object_id: album.id, event_id: event.event_id, cause_seq: cause, title: text[0], body: text[1]});
}

function contributionChanged(ctx, data, event) {
  const p = event.payload, t = d.now(ctx), add = p.add || [], remove = p.remove || [];
  if (!add.length && !remove.length) reject('A contribution change needs items to add or remove.');
  const {album, by_match} = resolveAlbum(data, p, a => { const m = member(a, p.person_id); return !!m && m.status === 'joined' && m.role === 'contributor'; },
    {allowEmptyMatch: true, why: p.person_id + ' is not a joined contributor there'});
  checkNewIds(data, add.map(x => x.item_id));
  for (const x of add) { checkLabels(data, x.people); if (c.ms(x.taken_at) > t) reject('A contribution cannot be taken after it is added.'); }
  for (const id of remove) {
    const k = album.contributions.find(x => x.id === id);
    if (!k || k.person_id !== p.person_id || k.removed_at) reject(id + ' is not a present contribution of ' + p.person_id + ' in ' + album.id + '.');
  }
  const cause = base(ctx, data, event, [album.id, p.person_id, ...add.map(x => x.item_id), ...remove],
    {album_id: album.id, resolved_by_match: by_match, added: add.map(x => x.item_id), removed: remove});
  for (const x of add) {
    album.contributions.push({id: x.item_id, person_id: p.person_id, kind: x.kind, taken_at: x.taken_at, place: place(x.place), people: (x.people || []).slice(),
      caption: x.caption ?? null, declared_bytes: x.declared_bytes, content_hash: x.content_hash ?? null, width: x.width ?? null, height: x.height ?? null,
      added_at: ctx.virtual_now, removed_at: null, removed_reason: null, event_id: event.event_id});
    album.item_ids.push(x.item_id);
  }
  for (const id of remove) Object.assign(album.contributions.find(x => x.id === id), {removed_at: ctx.virtual_now, removed_reason: 'withdrawn'});
  album.item_ids = album.item_ids.filter(id => !remove.includes(id));
  if (add.length) effect(ctx, data, event, cause, 'effect.contributions.added', [album.id, ...add.map(x => x.item_id)]);
  if (remove.length) effect(ctx, data, event, cause, 'effect.contributions.removed', [album.id, ...remove], {reason: 'withdrawn'});
  const who = c.nameOf(data, p.person_id), parts = [];
  if (add.length) parts.push('added ' + itemWord(add.map(x => x.kind), add.length));
  if (remove.length) parts.push('removed ' + plural(remove.length, 'item'));
  notify(ctx, data, {kind: 'album.activity', object_type: 'album', object_id: album.id, event_id: event.event_id, cause_seq: cause,
    title: who + ' ' + parts.join(' and ') + ' in ' + album.title,
    body: who + ' ' + parts.join(' and ') + ' in the shared album ' + album.title + '. Contributions are not in your library until you save them.'});
}

function shareViewed(ctx, data, event) {
  const p = event.payload, t = d.now(ctx), s = p.surface;
  if (data.views.some(v => v.id === p.view_id)) reject('Duplicate view ID ' + p.view_id + '.');
  const viewer = p.viewer.anonymous ? {person_id: null, anonymous: true} : {person_id: p.viewer.person_id, anonymous: false};
  if (viewer.person_id === data.owner_person_id) reject('A view is by someone other than the account holder.');
  if (viewer.person_id && !c.person(data, viewer.person_id)) reject('Unknown viewer ' + viewer.person_id + '.');
  let album, link = null, byMatch = false;
  if (s.type === 'link' && s.id !== undefined) {
    link = data.links.find(l => l.id === s.id);
    if (!link) reject('Unknown link ' + s.id + '.');
    album = data.albums.find(a => a.id === link.album_id);
  } else {
    ({album, by_match: byMatch} = resolveAlbum(data, s));
    if (s.type === 'link') {
      const active = d.activeLinks(data, album.id, t);
      if (!active.length) reject('Album ' + album.id + ' has no active link.');
      link = active.reduce((best, l) => (c.ms(l.created_at) >= c.ms(best.created_at) ? l : best));
    }
  }
  if (link) {
    const state = d.linkState(link, t);
    if (state !== 'active') reject('Link ' + link.id + ' is ' + state + '.');
  } else {
    if (viewer.anonymous) reject('An album is viewed by its joined members, not anonymously.');
    const m = member(album, viewer.person_id);
    if (!m || m.status !== 'joined') reject(viewer.person_id + ' is not a joined member of ' + album.id + '.');
  }
  const shows = d.albumShows(album, d.index(data), t);
  const pick = (list, what) => {
    if (list === undefined) return [];
    if (list === 'all') return shows.slice();
    for (const id of list) if (!shows.includes(id)) reject(what + ' item ' + id + ' is not shown by this surface now.');
    return list.slice();
  };
  const viewed = pick(p.viewed_item_ids, 'Viewed'), saved = pick(p.saved_item_ids, 'Saved');
  for (const id of saved) if (!viewed.includes(id)) reject('Saved item ' + id + ' was not viewed.');
  const view = {id: p.view_id, at: ctx.virtual_now, surface: {type: s.type, album_id: album.id, link_id: link ? link.id : null}, viewer,
    viewed_item_ids: viewed, saved_item_ids: saved, event_id: event.event_id, resolved_by_match: byMatch};
  data.views.push(view);
  base(ctx, data, event, [p.view_id, ...(link ? [link.id] : []), album.id, ...viewed],
    {surface: c.copy(view.surface), resolved_by_match: byMatch, viewed: viewed.length, saved: saved.slice()});
}

function removalRequested(ctx, data, event) {
  const p = event.payload, idx = d.index(data);
  if (data.removals.some(r => r.id === p.removal_id)) reject('Duplicate removal request ID ' + p.removal_id + '.');
  if (!c.person(data, p.from_person_id)) reject('Unknown person ' + p.from_person_id + '.');
  for (const id of p.item_ids) if (!idx.items.has(id) && !idx.contributions.has(id)) reject('Unknown item ' + id + '.');
  const notMine = p.item_ids.filter(id => !idx.items.has(id));
  if (notMine.length === p.item_ids.length) reject('The request names no item of this account.');
  let scope = {type: 'everywhere', album_id: null}, byMatch = false, album = null;
  if (p.scope.type === 'album') {
    ({album, by_match: byMatch} = resolveAlbum(data, p.scope));
    scope = {type: 'album', album_id: album.id};
  }
  const r = {id: p.removal_id, from_person_id: p.from_person_id, item_ids: p.item_ids.slice(), not_removable: notMine, scope, message: p.message ?? null,
    requested_at: ctx.virtual_now, event_id: event.event_id, state: 'pending', answers: [], cleared: null, honored_at: null, withdrawn_at: null, withdraw_message: null};
  data.removals.push(r);
  const cause = base(ctx, data, event, [r.id, ...r.item_ids, ...(album ? [album.id] : [])], {scope: c.copy(scope), resolved_by_match: byMatch, not_removable: notMine});
  const who = c.nameOf(data, p.from_person_id), n = p.item_ids.length;
  const where = album ? 'the shared album ' + album.title : 'everywhere they are shared';
  notify(ctx, data, {kind: 'removal.requested', object_type: 'removal_request', object_id: r.id, event_id: event.event_id, cause_seq: cause,
    title: who + ' asked you to take down ' + plural(n, 'photo'),
    body: who + ' asked that ' + plural(n, 'photo') + ' showing them be removed from ' + where + '.' + (p.message ? ' Their note: ' + p.message : '') +
      ' Open Fernshelf to see where each photo is visible and to answer the request.'});
}

function removalWithdrawn(ctx, data, event) {
  const p = event.payload, r = data.removals.find(x => x.id === p.removal_id);
  if (!r) reject('Unknown removal request ' + p.removal_id + '.');
  if (r.state !== 'pending') reject('Removal request ' + r.id + ' is ' + r.state + '; only a pending request can be withdrawn.');
  Object.assign(r, {state: 'withdrawn', withdrawn_at: ctx.virtual_now, withdraw_message: p.message ?? null});
  const cause = base(ctx, data, event, [r.id], {});
  const who = c.nameOf(data, r.from_person_id);
  notify(ctx, data, {kind: 'removal.withdrawn', object_type: 'removal_request', object_id: r.id, event_id: event.event_id, cause_seq: cause,
    title: who + ' withdrew a removal request', body: who + ' withdrew their request to take down ' + plural(r.item_ids.length, 'photo') + '.' +
      (p.message ? ' Their note: ' + p.message : '') + ' Nothing in your albums was changed.'});
}

const HANDLERS = {
  'fernshelf.item.added': itemAdded, 'fernshelf.backup.resumed': backupResumed, 'fernshelf.member.changed': memberChanged,
  'fernshelf.contribution.changed': contributionChanged, 'fernshelf.share.viewed': shareViewed,
  'fernshelf.removal.requested': removalRequested, 'fernshelf.removal.withdrawn': removalWithdrawn
};
function applyEvent(ctx, data, event) {
  const handler = HANDLERS[event.operation];
  if (!handler) reject('Fernshelf does not accept ' + event.operation + '.');
  handler(ctx, data, event);
  d.settle(ctx, data);
  return data;
}
module.exports = {applyEvent};
