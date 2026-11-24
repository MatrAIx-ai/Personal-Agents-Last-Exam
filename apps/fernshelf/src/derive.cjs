'use strict';
// Everything time-based is stored as a due time and derived here from the environment clock:
// an item reads `purged` once its purge_at has passed, a link reads `expired` once its
// expires_at has passed, and bytes used leave out purged items. Reads, writes and events all
// use these functions, so a change made by time alone needs no App code to run.
// `visibility` is the single visibility rule behind exposure.get, the warnings and
// removals.respond; it is also exported for graders (plugin.visibility).
const c = require('./common.cjs');
const {ms} = c;

const now = ctx => ms(ctx.virtual_now);
const itemState = (item, t) => (item.state === 'trashed' && ms(item.purge_at) <= t ? 'purged' : item.state);
const purgedAt = (item, t) => (itemState(item, t) === 'purged' ? item.purged_at || item.purge_at : null);
const linkState = (link, t) => (link.revoked_at ? 'revoked' : link.expires_at && ms(link.expires_at) <= t ? 'expired' : 'active');
const OPEN = new Set(['invited', 'joined']);
const albumState = album => (album.deleted_at ? 'deleted' : album.members.some(m => OPEN.has(m.status)) ? 'shared' : 'private');

// Lookups built once per call.
function index(data) {
  const items = new Map(data.items.map(i => [i.id, i]));
  const contributions = new Map();
  for (const album of data.albums) for (const c of album.contributions) contributions.set(c.id, {album, contribution: c});
  const stackOf = new Map();
  for (const s of data.stacks) for (const id of s.item_ids) stackOf.set(id, s);
  const albums = new Map(data.albums.map(a => [a.id, a]));
  const links = new Map(data.links.map(l => [l.id, l]));
  return {items, contributions, stackOf, albums, links};
}
const activeLinks = (data, albumId, t) => data.links.filter(l => l.album_id === albumId && linkState(l, t) === 'active');
// An album "has an audience" when it has an invited or joined member or an active link.
const hasAudience = (data, album, t) => !album.deleted_at && (album.members.some(m => OPEN.has(m.status)) || activeLinks(data, album.id, t).length > 0);

// What an album (and every link to it) shows at time t: my active items and present contributions, in album order.
function albumShows(album, idx, t) {
  if (album.deleted_at) return [];
  return album.item_ids.filter(id => {
    const item = idx.items.get(id);
    if (item) return itemState(item, t) === 'active';
    const k = idx.contributions.get(id);
    return !!k && k.album === album && !k.contribution.removed_at;
  });
}

// The visibility rule. An item is visible to a person when it is active and (a) it is in an album
// where that person is joined, or (b) it is in an album that an active link shows, to anyone who
// holds the link. Returns one row per visible item (my items and members' contributions).
function visibility(data, at) {
  const t = typeof at === 'number' ? at : ms(at), idx = index(data), rows = new Map();
  for (const album of data.albums) {
    if (album.deleted_at) continue;
    const joined = album.members.filter(m => m.status === 'joined').map(m => m.person_id);
    const links = activeLinks(data, album.id, t).map(l => l.id);
    if (!joined.length && !links.length) continue;
    for (const id of albumShows(album, idx, t)) {
      if (!rows.has(id)) rows.set(id, {item_id: id, mine: idx.items.has(id), people: [], albums: [], links: []});
      const row = rows.get(id);
      row.albums.push({album_id: album.id, person_ids: joined});
      for (const p of joined) if (!row.people.includes(p)) row.people.push(p);
      for (const l of links) row.links.push({link_id: l, album_id: album.id});
    }
  }
  return [...rows.values()];
}

// Storage derived from records and the clock. used_bytes: my backed-up items that are active or
// trashed (not purged). pending_bytes: active items still waiting to be backed up.
function storage(data, t) {
  const counted = [], waiting = [];
  for (const item of data.items) {
    const state = itemState(item, t);
    if (state === 'purged') continue;
    if (item.backed_up) counted.push({item, state});
    else if (state === 'active') waiting.push(item);
  }
  const sum = list => list.reduce((n, x) => n + (x.item || x).declared_bytes, 0);
  const used = sum(counted), trash = sum(counted.filter(x => x.state === 'trashed'));
  const byKind = {photo: 0, video: 0}, bySource = {camera: 0, screenshot: 0, download: 0, saved_from_share: 0};
  for (const {item} of counted) { byKind[item.kind] += item.declared_bytes; bySource[item.source] += item.declared_bytes; }
  const active = counted.filter(x => x.state === 'active').map(x => x.item), activeIds = new Set(active.map(i => i.id));
  const fromStacks = new Set(), fromHashes = new Set();
  for (const s of data.stacks) if (s.kind === 'duplicate') for (const id of s.item_ids) if (id !== s.cover_id && activeIds.has(id)) fromStacks.add(id);
  const groups = new Map();
  for (const item of active) if (item.content_hash) {
    if (!groups.has(item.content_hash)) groups.set(item.content_hash, []);
    groups.get(item.content_hash).push(item);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => ms(a.added_at) - ms(b.added_at) || (a.id < b.id ? -1 : 1));
    for (const item of group.slice(1)) fromHashes.add(item.id);
  }
  const bytesOf = ids => [...ids].reduce((n, id) => n + data.items.find(i => i.id === id).declared_bytes, 0);
  const union = new Set([...fromStacks, ...fromHashes]);
  const largest = active.slice().sort((a, b) => b.declared_bytes - a.declared_bytes || (a.id < b.id ? -1 : 1)).slice(0, 10)
    .map(i => ({id: i.id, kind: i.kind, declared_bytes: i.declared_bytes, taken_at: i.taken_at, source: i.source}));
  return {quota_bytes: data.account.quota_bytes, used_bytes: used, free_bytes: Math.max(0, data.account.quota_bytes - used),
    used_percent: Math.round((used / data.account.quota_bytes) * 10000) / 100, trash_bytes: trash, pending_bytes: sum(waiting),
    pending_items: waiting.length, by_kind: byKind, by_source: bySource,
    duplicate_bytes: bytesOf(union), duplicate_bytes_from_stacks: bytesOf(fromStacks), duplicate_bytes_from_hashes: bytesOf(fromHashes),
    duplicate_item_ids: [...union].sort(), largest_items: largest};
}
// Waiting items in backup order: oldest added_at first.
function waitingQueue(data, t) {
  return data.items.filter(i => !i.backed_up && itemState(i, t) === 'active')
    .sort((a, b) => ms(a.added_at) - ms(b.added_at) || (a.id < b.id ? -1 : 1));
}
const usedBytes = (data, t) => data.items.reduce((n, i) => n + (i.backed_up && itemState(i, t) !== 'purged' ? i.declared_bytes : 0), 0);

// The newest active version of a stack (by taken_at, then ID), or null.
function newestActive(stack, idx, t) {
  let best = null;
  for (const id of stack.item_ids) {
    const item = idx.items.get(id);
    if (!item || itemState(item, t) !== 'active') continue;
    if (!best || ms(item.taken_at) > ms(best.taken_at) || (ms(item.taken_at) === ms(best.taken_at) && item.id < best.id)) best = item;
  }
  return best;
}

// One `removal_honored` warning per person and item, for each item with an honoured request.
function removalWarnings(data, itemIds) {
  const out = [], idx = new Map(data.items.map(i => [i.id, i]));
  for (const id of itemIds) {
    const item = idx.get(id);
    if (!item) continue;
    const seen = new Set();
    for (let k = item.removal_history.length - 1; k >= 0; k--) {
      const row = item.removal_history[k];
      if (seen.has(row.person_id)) continue;
      seen.add(row.person_id);
      out.push({code: 'removal_honored', item_id: id, person_id: row.person_id, removal_id: row.removal_id, honored_at: row.at,
        message: c.nameOf(data, row.person_id) + ' asked for ' + id + ' to be taken down and that request was honoured on ' + row.at + '; this write shows it to someone again.'});
    }
  }
  return out;
}

// Drop what the clock has already made unreachable: an item whose purge_at has passed becomes a
// stored `purged` record without its file reference and leaves album records. Run only when a
// write or event commits; nothing a read returns changes because reads derive the same state.
function settle(ctx, data) {
  const t = now(ctx);
  const gone = new Set();
  for (const item of data.items) {
    if (item.state === 'trashed' && ms(item.purge_at) <= t) {
      item.state = 'purged';
      item.purged_at = item.purge_at;
      item.file = null;
      gone.add(item.id);
    }
  }
  if (gone.size) for (const album of data.albums) album.item_ids = album.item_ids.filter(id => !gone.has(id));
}

module.exports = {now, itemState, purgedAt, linkState, albumState, index, activeLinks, hasAudience, albumShows, visibility, storage,
  waitingQueue, usedBytes, newestActive, removalWarnings, settle, OPEN};
