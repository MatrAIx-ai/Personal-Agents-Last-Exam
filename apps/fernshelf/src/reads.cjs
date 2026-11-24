'use strict';
// W1 reads. Every value that depends on time is derived from ctx.virtual_now; nothing here
// changes data, writes a notification or an activity row.
const c = require('./common.cjs');
const d = require('./derive.cjs');

const personView = (data, id) => ({person_id: id, display_name: c.nameOf(data, id)});
const placeLabel = item => (item.place ? item.place.label : null);

function mine(data, id) {
  const item = data.items.find(i => i.id === id);
  if (item) return item;
  if (data.albums.some(a => a.contributions.some(k => k.id === id))) c.fail('not_yours', id + ' is a member\'s contribution, not an item of this library; read it with albums.get or exposure.get.');
  c.fail('not_found', 'No item ' + id + '.');
}
function album(data, id) {
  const a = data.albums.find(x => x.id === id);
  if (!a) c.fail('not_found', 'No album ' + id + '.');
  return a;
}

function accountGet(ctx, data) {
  const t = d.now(ctx), active = data.items.filter(i => d.itemState(i, t) === 'active');
  return {account: {account_id: data.account_id, owner_person_id: data.owner_person_id, ...c.copy(data.account)},
    labels: data.labels.map(l => ({...c.copy(l), item_count: active.filter(i => i.people.includes(l.id)).length})),
    people: c.copy(data.people)};
}

function row(data, idx, item, t, zone, stackInfo) {
  return {id: item.id, kind: item.kind, taken_at: item.taken_at, local_date: c.localDate(item.taken_at, zone), added_at: item.added_at,
    place: placeLabel(item), people: item.people.slice(), caption: item.caption, source: item.source, favorite: item.favorite, archived: item.archived,
    backed_up: item.backed_up, declared_bytes: item.declared_bytes, state: d.itemState(item, t), has_file: item.file !== null && d.itemState(item, t) !== 'purged',
    width: item.width, height: item.height, ...stackInfo};
}
function search(ctx, data, args) {
  const t = d.now(ctx), zone = data.account.time_zone, idx = d.index(data);
  const {lo, hi} = c.windowBounds(args.start, args.end, zone);
  if (args.label_id && !data.labels.some(l => l.id === args.label_id)) c.fail('not_found', 'No people label ' + args.label_id + '.');
  const inAlbum = args.album_id ? new Set(album(data, args.album_id).item_ids) : null;
  const state = args.state || 'active', place = args.place?.toLowerCase(), text = args.text?.toLowerCase();
  const pool = data.items.filter(i => d.itemState(i, t) === state);
  const match = i => {
    const at = c.ms(i.taken_at);
    return at >= lo && at < hi && (!place || (i.place && i.place.label.toLowerCase().includes(place))) && (!args.label_id || i.people.includes(args.label_id)) &&
      (!inAlbum || inAlbum.has(i.id)) && (!args.kind || i.kind === args.kind) && (!args.source || i.source === args.source) &&
      (args.favorite === undefined || i.favorite === args.favorite) && (args.archived === undefined || i.archived === args.archived) &&
      (args.backed_up === undefined || i.backed_up === args.backed_up) && (args.min_bytes === undefined || i.declared_bytes >= args.min_bytes) &&
      (!text || (i.caption || '').toLowerCase().includes(text));
  };
  const matched = pool.filter(match), poolIds = new Set(pool.map(i => i.id));
  const collapse = args.collapse_stacks !== false, rows = [], grouped = new Map();
  for (const item of matched) {
    const stack = idx.stackOf.get(item.id);
    const info = stack ? {stack_id: stack.id, stack_kind: stack.kind, stack_size: stack.item_ids.filter(id => poolIds.has(id)).length, is_cover: stack.cover_id === item.id}
      : {stack_id: null, stack_kind: null, stack_size: null, is_cover: false};
    if (!stack || !collapse) { rows.push(row(data, idx, item, t, zone, info)); continue; }
    if (!grouped.has(stack.id)) grouped.set(stack.id, []);
    grouped.get(stack.id).push({item, info});
  }
  for (const versions of grouped.values()) {
    // The cover when it matches, otherwise the newest matching version.
    const pick = versions.find(v => v.info.is_cover) || versions.slice().sort((a, b) => c.ms(b.item.taken_at) - c.ms(a.item.taken_at) || (a.item.id < b.item.id ? -1 : 1))[0];
    rows.push({...row(data, idx, pick.item, t, zone, pick.info), matched_versions: versions.length});
  }
  rows.sort((a, b) => c.ms(b.taken_at) - c.ms(a.taken_at) || (a.id < b.id ? -1 : 1));
  const offset = args.cursor ? Number(args.cursor) : 0, limit = args.limit || 50;
  const page = rows.slice(offset, offset + limit);
  return {rows: page, total: rows.length, next_cursor: offset + limit < rows.length ? String(offset + limit) : null};
}

function versionView(item, stack, t) {
  return {id: item.id, kind: item.kind, state: d.itemState(item, t), taken_at: item.taken_at, declared_bytes: item.declared_bytes, backed_up: item.backed_up,
    width: item.width, height: item.height, is_cover: stack.cover_id === item.id};
}
function itemGet(ctx, data, args) {
  const t = d.now(ctx), item = mine(data, args.id), idx = d.index(data), state = d.itemState(item, t);
  const stack = idx.stackOf.get(item.id);
  const view = c.copy(item);
  Object.assign(view, {state, purged_at: d.purgedAt(item, t), file: state === 'purged' || item.file === null ? null : {asset_id: item.file}});
  view.albums = state === 'purged' ? [] : data.albums.filter(a => !a.deleted_at && a.item_ids.includes(item.id)).map(a => ({album_id: a.id, title: a.title,
    album_state: d.albumState(a), shows_item: state === 'active', has_audience: d.hasAudience(data, a, t)}));
  view.removal_requests = data.removals.filter(r => r.item_ids.includes(item.id)).map(r => ({id: r.id, from_person_id: r.from_person_id, state: r.state,
    scope: c.copy(r.scope), requested_at: r.requested_at}));
  view.stack = !stack || state === 'purged' ? null : {id: stack.id, kind: stack.kind, cover_id: stack.cover_id,
    versions: stack.item_ids.map(id => idx.items.get(id)).filter(v => d.itemState(v, t) !== 'purged').map(v => versionView(v, stack, t))};
  return {item: view};
}

function itemRead(ctx, data, args) {
  const t = d.now(ctx), item = mine(data, args.id);
  if (d.itemState(item, t) === 'purged') c.fail('gone', 'Item ' + item.id + ' has been purged; its file no longer exists.');
  if (item.file === null) c.fail('no_file', 'Item ' + item.id + (item.backed_up ? ' has no image file (videos and some items are metadata only).' : ' is not backed up; its original is still on the device.'));
  if (args.asset_id !== undefined && args.asset_id !== item.file) c.fail('not_found', 'Asset ' + args.asset_id + ' is not the file of item ' + item.id + '.');
  if (!ctx.assets?.read) c.fail('unsupported_capability', 'Reading image bytes needs the host asset reader.');
  return {item_id: item.id, asset_id: item.file, file: ctx.assets.read(item.file)};
}

function memberView(data, m) {
  return {...personView(data, m.person_id), role: m.role, status: m.status, invited_at: m.invited_at, joined_at: m.joined_at, ended_at: m.ended_at};
}
function viewView(data, v) {
  return {view_id: v.id, at: v.at, surface: c.copy(v.surface), viewer: v.viewer.anonymous ? {anonymous: true, person_id: null, display_name: null}
    : {anonymous: false, ...personView(data, v.viewer.person_id)}, viewed_item_ids: v.viewed_item_ids.slice(), saved_item_ids: v.saved_item_ids.slice()};
}
function albumsList(ctx, data, args) {
  const t = d.now(ctx), idx = d.index(data);
  const albums = data.albums.filter(a => args.include_deleted || !a.deleted_at).map(a => {
    const count = s => a.members.filter(m => m.status === s).length;
    return {id: a.id, title: a.title, state: d.albumState(a), created_at: a.created_at, item_count: d.albumShows(a, idx, t).length,
      contribution_count: a.contributions.filter(k => !k.removed_at).length,
      members: {invited: count('invited'), joined: count('joined')}, active_links: d.activeLinks(data, a.id, t).map(l => l.id), deleted_at: a.deleted_at};
  });
  return {albums};
}
function albumGet(ctx, data, args) {
  const t = d.now(ctx), a = album(data, args.id), idx = d.index(data);
  const entries = d.albumShows(a, idx, t).map(id => {
    const item = idx.items.get(id);
    if (item) return {id, mine: true, kind: item.kind, taken_at: item.taken_at, caption: item.caption, place: placeLabel(item), contributed_by: null};
    const k = idx.contributions.get(id).contribution;
    return {id, mine: false, kind: k.kind, taken_at: k.taken_at, caption: k.caption, place: placeLabel(k), contributed_by: k.person_id};
  });
  const links = data.links.filter(l => l.album_id === a.id).map(l => ({id: l.id, state: d.linkState(l, t), created_at: l.created_at, expires_at: l.expires_at,
    revoked_at: l.revoked_at, revoke_reason: l.revoke_reason, views: data.views.filter(v => v.surface.link_id === l.id).map(v => viewView(data, v))}));
  return {album: {id: a.id, title: a.title, state: d.albumState(a), created_at: a.created_at, created_by: a.created_by, deleted_at: a.deleted_at,
    entries, hidden_item_ids: a.item_ids.filter(id => idx.items.has(id) && d.itemState(idx.items.get(id), t) === 'trashed'),
    members: a.members.map(m => memberView(data, m)), contributions: a.contributions.map(k => ({...c.copy(k), state: k.removed_at ? 'removed' : 'present'})),
    links, member_views: data.views.filter(v => v.surface.type === 'album' && v.surface.album_id === a.id).map(v => viewView(data, v))}};
}

// One album entry of an exposure: who can see the item there and through which links.
function surfaceEntry(data, a, t) {
  const open = a.members.filter(m => d.OPEN.has(m.status));
  return {album_id: a.id, title: a.title, album_state: d.albumState(a), members: open.map(m => memberView(data, m)),
    visible_to: open.filter(m => m.status === 'joined').map(m => m.person_id),
    links: d.activeLinks(data, a.id, t).map(l => ({link_id: l.id, created_at: l.created_at, expires_at: l.expires_at}))};
}
function exposure(ctx, data, args) {
  const t = d.now(ctx), idx = d.index(data), item = idx.items.get(args.id), k = idx.contributions.get(args.id);
  if (!item && !k) c.fail('not_found', 'No item ' + args.id + '.');
  let state, albums = [], returns = [];
  if (item) {
    state = d.itemState(item, t);
    const holding = data.albums.filter(a => a.item_ids.includes(item.id) && d.hasAudience(data, a, t));
    if (state === 'active') albums = holding.map(a => surfaceEntry(data, a, t));
    if (state === 'trashed') returns = holding.map(a => surfaceEntry(data, a, t));
  } else {
    state = k.contribution.removed_at || k.album.deleted_at ? 'removed' : 'active';
    if (state === 'active' && d.hasAudience(data, k.album, t)) albums = [surfaceEntry(data, k.album, t)];
  }
  const visibleTo = [...new Set(albums.flatMap(a => a.visible_to))];
  const views = data.views.filter(v => v.viewed_item_ids.includes(args.id)).map(v => viewView(data, v));
  return {item_id: args.id, mine: !!item, state, visible: albums.some(a => a.visible_to.length || a.links.length), visible_to: visibleTo, albums,
    returns_on_restore: returns, views, saves: views.filter(v => v.saved_item_ids.includes(args.id)),
    removal_requests: data.removals.filter(r => r.item_ids.includes(args.id)).map(r => ({id: r.id, from_person_id: r.from_person_id, state: r.state,
      scope: c.copy(r.scope), requested_at: r.requested_at}))};
}

function removalsList(ctx, data, args) {
  const t = d.now(ctx), idx = d.index(data);
  return {removals: data.removals.filter(r => !args.state || r.state === args.state).map(r => ({...c.copy(r), from: personView(data, r.from_person_id),
    scope_album_title: r.scope.album_id ? idx.albums.get(r.scope.album_id).title : null,
    items: r.item_ids.map(id => ({id, mine: idx.items.has(id), state: idx.items.has(id) ? d.itemState(idx.items.get(id), t) : 'contribution'}))}))};
}
function notificationsList(ctx, data, args) {
  const {lo, hi} = c.windowBounds(args.start, args.end, data.account.time_zone);
  return {notifications: data.notifications.filter(n => (!args.kind || n.kind === args.kind) && c.ms(n.at) >= lo && c.ms(n.at) < hi).map(n => ({id: n.id,
    kind: n.kind, at: n.at, title: n.title, body: n.body, object_type: n.object_type, object_id: n.object_id, level: n.level, event_id: n.event_id,
    email_message_stored: n.wire !== null}))};
}

const READS = {
  'fernshelf.account.get': accountGet,
  'fernshelf.storage.summary': (ctx, data) => ({storage: d.storage(data, d.now(ctx))}),
  'fernshelf.items.search': search,
  'fernshelf.items.get': itemGet,
  'fernshelf.items.read': itemRead,
  'fernshelf.albums.list': albumsList,
  'fernshelf.albums.get': albumGet,
  'fernshelf.exposure.get': exposure,
  'fernshelf.removals.list': removalsList,
  'fernshelf.notifications.list': notificationsList
};
module.exports = {READS, mine, album, viewView};
