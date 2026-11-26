'use strict';
// W3 Reading record and clippings. A read mark says which revision the person was shown; it
// exists only when reading.mark is called or the seed has it. A clipping holds one revision
// of an item, and every earlier version of the clipping stays in its history.
const { fail, ms, nextId, page } = require('./util.cjs');
const { LIMITS, index, latest, revisionOf, usedIds } = require('./model.cjs');
const { record } = require('./activity.cjs');

function item(data, id) {
  const found = index(data).items.get(id);
  if (!found) fail('not_found', 'Unknown item ' + id + '.');
  return found;
}

// ---- read marks -----------------------------------------------------------
const presentMark = (mark, it) => ({ item_id: mark.item_id, revision: mark.revision, read_at: mark.read_at, is_latest: mark.revision === latest(it).number, latest_revision: latest(it).number });

// Newest first; marks made at the same instant keep their order reversed.
function marks(ctx, data, args) {
  if (args.id !== undefined) item(data, args.id);
  const ix = index(data);
  const all = data.read_marks.map((m, order) => ({ m, order })).filter(({ m }) => args.id === undefined || m.item_id === args.id)
    .sort((a, b) => ms(b.m.read_at) - ms(a.m.read_at) || b.order - a.order);
  const { items, next_cursor } = page(args, all);
  return { marks: items.map(({ m }) => presentMark(m, ix.items.get(m.item_id))), next_cursor };
}

function mark(ctx, data, args) {
  const it = item(data, args.id), number = args.revision ?? latest(it).number;
  if (!revisionOf(it, number)) fail('not_found', 'Item ' + it.id + ' has no revision ' + number + '. Its latest revision is ' + latest(it).number + '.');
  if (data.read_marks.some(m => m.item_id === it.id && m.revision === number)) fail('already_read', 'Revision ' + number + ' of item ' + it.id + ' is already marked as read.');
  const made = { item_id: it.id, revision: number, read_at: ctx.virtual_now };
  data.read_marks.push(made);
  record(data, { at: ctx.virtual_now, actor: 'agent', action: 'reading.mark', object_id: it.id, request_id: args.request_id, details: { revision: number } });
  return { id: it.id, mark: presentMark(made, it) };
}

// ---- clippings ------------------------------------------------------------------
function presentClipping(data, clipping) {
  const last = latest(index(data).items.get(clipping.item_id)).number, current = clipping.revision === last;
  return {
    id: clipping.id, item_id: clipping.item_id, revision: clipping.revision, latest_revision: last, is_current: current, state: current ? 'current' : 'behind',
    note: clipping.note ?? null, linked_object: clipping.linked_object ?? null, watch: clipping.watch, created_at: clipping.created_at,
    updated_at: clipping.history.length ? clipping.history[clipping.history.length - 1].replaced_at : null, history: clipping.history,
  };
}
function findClipping(data, id) {
  const clipping = data.clippings.find(c => c.id === id);
  if (!clipping) fail('not_found', 'Unknown clipping ' + id + '.');
  return clipping;
}

// Newest first; clippings made at the same instant keep their order reversed.
function clippings(ctx, data, args) {
  if (args.id !== undefined) item(data, args.id);
  const all = data.clippings.map((c, order) => ({ c, order })).filter(({ c }) => args.id === undefined || c.item_id === args.id)
    .sort((a, b) => ms(b.c.created_at) - ms(a.c.created_at) || b.order - a.order)
    .map(({ c }) => presentClipping(data, c));
  return { clippings: all.filter(c => args.state === undefined || c.state === args.state) };
}

function add(ctx, data, args) {
  const it = item(data, args.id), existing = data.clippings.find(c => c.item_id === it.id);
  if (existing) fail('already_clipped', 'Item ' + it.id + ' already has clipping ' + existing.id + '. Change it with clippings.update.');
  if (data.clippings.length >= LIMITS.clippings) fail('limit_exceeded', 'The account already has ' + LIMITS.clippings + ' clippings. Remove one first.');
  const clipping = {
    id: nextId(usedIds(data), 'clp-'), item_id: it.id, revision: latest(it).number,
    ...(args.note !== undefined ? { note: args.note } : {}), ...(args.linked_object !== undefined ? { linked_object: args.linked_object } : {}),
    watch: args.watch ?? false, created_at: ctx.virtual_now, history: [],
  };
  data.clippings.push(clipping);
  record(data, { at: ctx.virtual_now, actor: 'agent', action: 'clippings.add', object_id: clipping.id, request_id: args.request_id, details: { item_id: it.id, revision: clipping.revision, watch: clipping.watch } });
  return { id: clipping.id, clipping: presentClipping(data, clipping) };
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
function update(ctx, data, args) {
  const clipping = findClipping(data, args.id), patch = args.patch, fields = Object.keys(patch);
  if (!fields.length) fail('invalid_arguments', 'patch needs at least one field.');
  const it = index(data).items.get(clipping.item_id);
  if (patch.revision !== undefined) {
    if (!revisionOf(it, patch.revision)) fail('not_found', 'Item ' + it.id + ' has no revision ' + patch.revision + '. Its latest revision is ' + latest(it).number + '.');
    if (patch.revision <= clipping.revision) fail('invalid_revision', 'The clipping holds revision ' + clipping.revision + '; it can only move to a newer one.');
  }
  // The version the clipping held until now, kept only when the patch changes something.
  const before = { replaced_at: ctx.virtual_now, revision: clipping.revision, ...(clipping.note !== undefined ? { note: clipping.note } : {}), ...(clipping.linked_object !== undefined ? { linked_object: clipping.linked_object } : {}), watch: clipping.watch, request_id: args.request_id };
  const changed = fields.filter(key => !same(clipping[key], patch[key]));
  if (changed.length) {
    const next = { ...clipping };
    for (const key of changed) { if (patch[key] === null) delete next[key]; else next[key] = patch[key]; }
    // Rewritten field by field so that a stored clipping always lists its fields in the same order.
    for (const key of Object.keys(clipping)) delete clipping[key];
    for (const key of ['id', 'item_id', 'revision', 'note', 'linked_object', 'watch', 'created_at', 'history']) if (next[key] !== undefined) clipping[key] = next[key];
    clipping.history.push(before);
  }
  record(data, { at: ctx.virtual_now, actor: 'agent', action: 'clippings.update', object_id: clipping.id, request_id: args.request_id, details: { fields, changed, revision: clipping.revision } });
  return { id: clipping.id, clipping: presentClipping(data, clipping) };
}

function remove(ctx, data, args) {
  const clipping = findClipping(data, args.id);
  data.clippings.splice(data.clippings.indexOf(clipping), 1);
  record(data, { at: ctx.virtual_now, actor: 'agent', action: 'clippings.remove', object_id: clipping.id, request_id: args.request_id, details: { item_id: clipping.item_id } });
  return { id: clipping.id, remaining: data.clippings.length };
}

module.exports = { marks, mark, clippings, add, update, remove, presentClipping };
