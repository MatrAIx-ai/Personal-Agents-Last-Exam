'use strict';
// W2 item edits and W5 trash, restore and purge. Every refusal is decided before the working copy
// changes, and each call on several items is all or nothing.
const c = require('./common.cjs');
const d = require('./derive.cjs');

// Resolve one of my items for a write, refusing what the plan refuses in a fixed order.
function writable(data, idx, id, t, {allowTrashed = false} = {}) {
  const item = idx.items.get(id);
  if (!item) {
    if (idx.contributions.has(id)) c.fail('not_yours', id + ' is a member\'s contribution, not an item of this library.');
    c.fail('not_found', 'No item ' + id + '.');
  }
  const state = d.itemState(item, t);
  if (state === 'purged') c.fail('gone', 'Item ' + id + ' has been purged.');
  if (state === 'trashed' && !allowTrashed) c.fail('in_trash', 'Item ' + id + ' is in the trash; restore it first.');
  return item;
}
function batch(ids) {
  if (ids.length > c.BATCH_LIMIT) c.fail('limit_exceeded', 'At most ' + c.BATCH_LIMIT + ' items per call.');
}

function update(ctx, data, args) {
  const t = d.now(ctx), idx = d.index(data), p = args.patch, keys = Object.keys(p);
  if (!keys.length) c.fail('invalid_arguments', 'The patch must change at least one field.');
  const item = writable(data, idx, args.id, t);
  const labels = new Set(data.labels.map(l => l.id));
  for (const l of [...(p.add_people || []), ...(p.remove_people || [])]) if (!labels.has(l)) c.fail('not_found', 'The account has no people label ' + l + '.');
  for (const l of p.add_people || []) {
    if (item.people.includes(l)) c.fail('invalid_arguments', 'Label ' + l + ' is already on ' + item.id + '.');
    if ((p.remove_people || []).includes(l)) c.fail('invalid_arguments', 'Label ' + l + ' is both added and removed.');
  }
  for (const l of p.remove_people || []) if (!item.people.includes(l)) c.fail('invalid_arguments', 'Label ' + l + ' is not on ' + item.id + '.');
  if (p.taken_at !== undefined && c.ms(p.taken_at) > c.ms(item.added_at)) c.fail('invalid_arguments', 'A capture time cannot be after the item was added (' + item.added_at + ').');
  const stack = idx.stackOf.get(item.id);
  if (p.make_cover && !stack) c.fail('not_stacked', 'Item ' + item.id + ' is not in a stack.');
  // Decided; now change.
  const changes = {};
  for (const k of ['caption', 'favorite', 'archived', 'taken_at']) if (k in p) { changes[k] = {from: item[k], to: p[k]}; item[k] = p[k]; }
  if (p.add_people || p.remove_people) {
    const before = item.people.slice();
    item.people = item.people.filter(l => !(p.remove_people || []).includes(l)).concat(p.add_people || []);
    changes.people = {from: before, to: item.people.slice()};
  }
  if (p.make_cover) { changes.cover = {from: stack.cover_id, to: item.id}; stack.cover_id = item.id; }
  c.history(ctx, item, 'updated', {request_id: args.request_id, changes});
  c.activity(ctx, data, {actor: 'agent', action: 'items.update', object_ids: [item.id, ...(stack && p.make_cover ? [stack.id] : [])], request_id: args.request_id,
    details: {fields: keys}});
  return {id: item.id, state: 'active', changed: keys, stack_id: stack ? stack.id : null, cover_id: stack ? stack.cover_id : null};
}

function trash(ctx, data, args) {
  const t = d.now(ctx), idx = d.index(data);
  batch(args.ids);
  const items = args.ids.map(id => {
    const item = writable(data, idx, id, t, {allowTrashed: true});
    if (item.state === 'trashed') c.fail('invalid_state', 'Item ' + id + ' is already in the trash.');
    return item;
  });
  const purgeAt = c.addDays(ctx.virtual_now, data.account.trash_retention_days), touched = new Set();
  for (const item of items) {
    item.state = 'trashed'; item.trashed_at = ctx.virtual_now; item.purge_at = purgeAt;
    c.history(ctx, item, 'trashed', {request_id: args.request_id});
    const stack = idx.stackOf.get(item.id);
    if (stack) touched.add(stack);
  }
  // A trashed cover hands over to the newest remaining active version (or none).
  const covers = [];
  for (const stack of touched) {
    if (stack.cover_id && idx.items.get(stack.cover_id).state === 'active') continue;
    const next = d.newestActive(stack, idx, t);
    covers.push({stack_id: stack.id, from: stack.cover_id, cover_id: next ? next.id : null});
    stack.cover_id = next ? next.id : null;
  }
  c.activity(ctx, data, {actor: 'agent', action: 'items.trash', object_ids: args.ids.slice(), request_id: args.request_id,
    details: {purge_at: purgeAt, covers_changed: covers}});
  return {ids: args.ids.slice(), items: items.map(i => ({id: i.id, state: 'trashed', purge_at: i.purge_at})),
    covers_changed: covers.map(x => ({stack_id: x.stack_id, cover_id: x.cover_id}))};
}

function restore(ctx, data, args) {
  const t = d.now(ctx), idx = d.index(data);
  batch(args.ids);
  const items = args.ids.map(id => {
    const item = writable(data, idx, id, t, {allowTrashed: true});
    if (item.state !== 'trashed') c.fail('invalid_state', 'Item ' + id + ' is not in the trash.');
    return item;
  });
  const touched = new Set();
  for (const item of items) {
    item.state = 'active'; item.trashed_at = null; item.purge_at = null;
    c.history(ctx, item, 'restored', {request_id: args.request_id});
    const stack = idx.stackOf.get(item.id);
    if (stack) touched.add(stack);
  }
  // A stack left without a cover takes the newest restored version; an existing cover stays.
  for (const stack of touched) if (!stack.cover_id) stack.cover_id = d.newestActive(stack, idx, t).id;
  // Restored items return to the albums whose records still hold them; warn where that shows
  // an item with an honoured removal request to someone again.
  const shown = items.filter(i => data.albums.some(a => a.item_ids.includes(i.id) && d.hasAudience(data, a, t))).map(i => i.id);
  const warnings = d.removalWarnings(data, shown);
  c.activity(ctx, data, {actor: 'agent', action: 'items.restore', object_ids: args.ids.slice(), request_id: args.request_id, warnings});
  return {ids: args.ids.slice(), items: items.map(i => ({id: i.id, state: 'active'})), warnings};
}

function purge(ctx, data, args) {
  const t = d.now(ctx), idx = d.index(data);
  batch(args.ids);
  if (args.confirm !== true) c.fail('confirm_required', 'Purging cannot be undone; repeat the call with confirm: true.');
  const items = args.ids.map(id => {
    const item = writable(data, idx, id, t, {allowTrashed: true});
    if (item.state !== 'trashed') c.fail('invalid_state', 'Item ' + id + ' is not in the trash; only trashed items can be purged.');
    return item;
  });
  let freed = 0;
  const ids = new Set(args.ids);
  for (const item of items) {
    if (item.backed_up) freed += item.declared_bytes;
    item.state = 'purged'; item.purged_at = ctx.virtual_now; item.file = null;
    c.history(ctx, item, 'purged', {request_id: args.request_id});
  }
  for (const album of data.albums) album.item_ids = album.item_ids.filter(id => !ids.has(id));
  c.activity(ctx, data, {actor: 'agent', action: 'items.purge', object_ids: args.ids.slice(), request_id: args.request_id, details: {freed_bytes: freed}});
  return {ids: args.ids.slice(), items: items.map(i => ({id: i.id, state: 'purged'})), freed_bytes: freed};
}

module.exports = {WRITES: {'fernshelf.items.update': update, 'fernshelf.items.trash': trash, 'fernshelf.items.restore': restore, 'fernshelf.items.purge': purge},
  writable, batch};
