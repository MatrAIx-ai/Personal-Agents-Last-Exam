'use strict';
// W2 albums and W3 sharing: members, saving a contribution, links. Every write that would show
// items to someone returns one removal_honored warning per person and item with an honoured
// removal request; the write itself is accepted (Fernshelf records consent, it does not judge it).
const c = require('./common.cjs');
const d = require('./derive.cjs');
const {writable, batch} = require('./library.cjs');

function liveAlbum(data, id) {
  const a = data.albums.find(x => x.id === id);
  if (!a) c.fail('not_found', 'No album ' + id + '.');
  if (a.deleted_at) c.fail('not_found', 'Album ' + id + ' was deleted.');
  return a;
}
// My items that an album shows now (contributions never carry removal history).
const shownMine = (album, idx, t) => d.albumShows(album, idx, t).filter(id => idx.items.has(id));

function create(ctx, data, args) {
  const title = args.title.trim();
  if (!title) c.fail('invalid_arguments', 'An album needs a title.');
  const id = c.nextId(data.albums.map(a => a.id), 'al-n');
  data.albums.push({id, title, created_at: ctx.virtual_now, created_by: 'agent', request_id: args.request_id, item_ids: [], members: [], contributions: [], deleted_at: null});
  c.activity(ctx, data, {actor: 'agent', action: 'albums.create', object_ids: [id], request_id: args.request_id});
  return {id, title, state: 'private'};
}

function update(ctx, data, args) {
  const t = d.now(ctx), idx = d.index(data), album = liveAlbum(data, args.id);
  const add = args.add_ids || [], remove = args.remove_ids || [], order = args.order || [];
  if (args.title === undefined && !add.length && !remove.length && !order.length) c.fail('invalid_arguments', 'Nothing to change: give title, add_ids, remove_ids or order.');
  if (add.some(id => remove.includes(id))) c.fail('invalid_arguments', 'The same item cannot be added and removed in one call.');
  batch([...add, ...remove]);
  const title = args.title === undefined ? undefined : args.title.trim();
  if (title === '') c.fail('invalid_arguments', 'An album needs a title.');
  for (const id of remove) {
    if (!album.item_ids.includes(id)) {
      if (!idx.items.has(id) && !idx.contributions.has(id)) c.fail('not_found', 'No item ' + id + '.');
      c.fail('not_in_album', id + ' is not in album ' + album.id + '.');
    }
    if (!idx.items.has(id)) c.fail('not_yours', id + ' is a member\'s contribution; it leaves the album only when its contributor removes it or leaves.');
  }
  for (const id of add) {
    const item = writable(data, idx, id, t);
    if (!item.backed_up) c.fail('not_backed_up', id + ' is not backed up yet; its original is still on the device.');
    if (album.item_ids.includes(id)) c.fail('already_in_album', id + ' is already in album ' + album.id + '.');
  }
  const after = album.item_ids.filter(id => !remove.includes(id)).concat(add);
  for (const id of order) if (!after.includes(id)) c.fail('not_in_album', id + ' is not in album ' + album.id + ' after this change.');
  // Warnings: added items that become visible to someone through this album or its links.
  const audience = d.hasAudience(data, album, t);
  const warnings = audience ? d.removalWarnings(data, add) : [];
  album.item_ids = order.concat(after.filter(id => !order.includes(id)));
  if (title !== undefined) album.title = title;
  c.activity(ctx, data, {actor: 'agent', action: 'albums.update', object_ids: [album.id, ...remove, ...add], request_id: args.request_id, warnings,
    details: {added: add, removed: remove, ...(order.length ? {order} : {}), ...(title !== undefined ? {title} : {})}});
  return {id: album.id, state: d.albumState(album), title: album.title, item_ids: album.item_ids.slice(), added: add.slice(), removed: remove.slice(), warnings};
}

function remove(ctx, data, args) {
  const t = d.now(ctx), album = liveAlbum(data, args.id);
  if (d.hasAudience(data, album, t) && args.confirm !== true) c.fail('confirm_required', 'Album ' + album.id + ' still has members or an active link; repeat with confirm: true to delete it.');
  const revoked = d.activeLinks(data, album.id, t).map(l => l.id);
  for (const l of data.links) if (l.album_id === album.id && !l.revoked_at) { l.revoked_at = ctx.virtual_now; l.revoke_reason = 'album_deleted'; }
  album.deleted_at = ctx.virtual_now;
  c.activity(ctx, data, {actor: 'agent', action: 'albums.delete', object_ids: [album.id, ...revoked], request_id: args.request_id});
  return {id: album.id, state: 'deleted', revoked_link_ids: revoked};
}

function invite(ctx, data, args) {
  const t = d.now(ctx), idx = d.index(data), album = liveAlbum(data, args.id);
  if (args.person_id === data.owner_person_id) c.fail('invalid_arguments', 'You cannot invite yourself to your own album.');
  if (!c.person(data, args.person_id)) c.fail('not_found', 'No person ' + args.person_id + ' is known to this library.');
  const m = album.members.find(x => x.person_id === args.person_id);
  if (m && d.OPEN.has(m.status)) c.fail('already_invited', c.nameOf(data, args.person_id) + ' is already ' + m.status + ' in album ' + album.id + '.');
  const warnings = d.removalWarnings(data, shownMine(album, idx, t));
  const row = {at: ctx.virtual_now, action: 'invited', actor: 'agent', request_id: args.request_id, event_id: null, changes: {role: args.role}};
  if (m) Object.assign(m, {role: args.role, status: 'invited', invited_at: ctx.virtual_now, joined_at: null, ended_at: null}).history.push(row);
  else album.members.push({person_id: args.person_id, role: args.role, status: 'invited', invited_at: ctx.virtual_now, joined_at: null, ended_at: null, history: [row]});
  c.activity(ctx, data, {actor: 'agent', action: 'albums.members.invite', object_ids: [album.id, args.person_id], request_id: args.request_id, warnings,
    details: {role: args.role}});
  return {id: album.id, person_id: args.person_id, member_status: 'invited', state: d.albumState(album), warnings};
}

// A member's present contributions leave the album when they leave or are removed.
function dropContributions(ctx, album, personId, reason) {
  const gone = [];
  for (const k of album.contributions) if (k.person_id === personId && !k.removed_at) {
    k.removed_at = ctx.virtual_now; k.removed_reason = reason; gone.push(k.id);
  }
  album.item_ids = album.item_ids.filter(id => !gone.includes(id));
  return gone;
}
function memberUpdate(ctx, data, args) {
  const album = liveAlbum(data, args.id);
  if ((args.role === undefined) === (args.remove === undefined)) c.fail('invalid_arguments', 'Give either role or remove: true.');
  const m = album.members.find(x => x.person_id === args.person_id);
  if (!m) c.fail('not_member', c.nameOf(data, args.person_id) + ' is not a member of album ' + album.id + '.');
  if (!d.OPEN.has(m.status)) c.fail('invalid_state', c.nameOf(data, args.person_id) + ' has already ' + m.status + '; invite them again instead.');
  let removed = [];
  if (args.remove) {
    m.status = 'removed'; m.ended_at = ctx.virtual_now;
    removed = dropContributions(ctx, album, m.person_id, 'member_removed');
  } else m.role = args.role;
  m.history.push({at: ctx.virtual_now, action: args.remove ? 'removed' : 'role_changed', actor: 'agent', request_id: args.request_id, event_id: null,
    ...(args.remove ? {} : {changes: {role: args.role}})});
  c.activity(ctx, data, {actor: 'agent', action: 'albums.members.update', object_ids: [album.id, m.person_id, ...removed], request_id: args.request_id,
    details: args.remove ? {removed: true, contributions_removed: removed} : {role: args.role}});
  return {id: album.id, person_id: m.person_id, member_status: m.status, role: m.role, state: d.albumState(album), contributions_removed: removed};
}

function saveItem(ctx, data, args) {
  const t = d.now(ctx), idx = d.index(data), album = liveAlbum(data, args.id);
  const k = album.contributions.find(x => x.id === args.item_id);
  if (!k) {
    if (idx.items.has(args.item_id) || idx.contributions.has(args.item_id)) c.fail('not_shared', args.item_id + ' is not a member\'s contribution in album ' + album.id + '.');
    c.fail('not_found', 'No item ' + args.item_id + '.');
  }
  if (k.removed_at) c.fail('not_shared', args.item_id + ' is no longer in album ' + album.id + '.');
  const copy = data.items.find(i => i.saved_from && i.saved_from.contribution_id === k.id && d.itemState(i, t) !== 'purged');
  if (copy) c.fail('invalid_state', args.item_id + ' is already saved in your library as ' + copy.id + '.');
  const used = d.usedBytes(data, t);
  if (used + k.declared_bytes > data.account.quota_bytes) c.fail('over_quota', 'Saving ' + k.id + ' needs ' + k.declared_bytes + ' bytes; ' + Math.max(0, data.account.quota_bytes - used) + ' are free.');
  const id = c.nextId(data.items.map(i => i.id), 'it-s');
  const item = {id, kind: k.kind, taken_at: k.taken_at, added_at: ctx.virtual_now, place: c.copy(k.place), people: k.people.slice(), caption: k.caption,
    source: 'saved_from_share', favorite: false, archived: false, backed_up: true, declared_bytes: k.declared_bytes, content_hash: k.content_hash,
    width: k.width, height: k.height, duration_ms: null, file: null, state: 'active', trashed_at: null, purge_at: null, purged_at: null,
    saved_from: {album_id: album.id, contribution_id: k.id, person_id: k.person_id}, removal_history: [], history: []};
  c.history(ctx, item, 'saved_from_share', {request_id: args.request_id});
  data.items.push(item);
  c.activity(ctx, data, {actor: 'agent', action: 'albums.save_item', object_ids: [id, album.id, k.id], request_id: args.request_id});
  return {id, item_id: k.id, state: 'active', source: 'saved_from_share', declared_bytes: k.declared_bytes, used_bytes: used + k.declared_bytes};
}

function linkCreate(ctx, data, args) {
  const t = d.now(ctx), idx = d.index(data), album = liveAlbum(data, args.id);
  if (args.expires_at !== undefined && c.ms(args.expires_at) <= t) c.fail('invalid_window', 'A link expiry must be in the future.');
  const warnings = d.removalWarnings(data, shownMine(album, idx, t));
  const id = c.nextId(data.links.map(l => l.id), 'ln-n');
  data.links.push({id, album_id: album.id, created_at: ctx.virtual_now, expires_at: args.expires_at ?? null, revoked_at: null, revoke_reason: null, request_id: args.request_id});
  c.activity(ctx, data, {actor: 'agent', action: 'links.create', object_ids: [id, album.id], request_id: args.request_id, warnings});
  return {id, album_id: album.id, state: 'active', expires_at: args.expires_at ?? null, warnings};
}
function linkRevoke(ctx, data, args) {
  const t = d.now(ctx), link = data.links.find(l => l.id === args.id);
  if (!link) c.fail('not_found', 'No link ' + args.id + '.');
  const state = d.linkState(link, t);
  if (state !== 'active') c.fail('invalid_state', 'Link ' + link.id + ' is already ' + state + '.');
  link.revoked_at = ctx.virtual_now; link.revoke_reason = 'revoked';
  c.activity(ctx, data, {actor: 'agent', action: 'links.revoke', object_ids: [link.id, link.album_id], request_id: args.request_id});
  return {id: link.id, album_id: link.album_id, state: 'revoked'};
}

module.exports = {WRITES: {'fernshelf.albums.create': create, 'fernshelf.albums.update': update, 'fernshelf.albums.delete': remove,
  'fernshelf.albums.members.invite': invite, 'fernshelf.albums.members.update': memberUpdate, 'fernshelf.albums.save_item': saveItem,
  'fernshelf.links.create': linkCreate, 'fernshelf.links.revoke': linkRevoke}, dropContributions};
