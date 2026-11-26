'use strict';
// W1 Following: the account's follow rules. A rule only shapes notifications for revisions
// that arrive after it; nothing here writes or withdraws a notification.
const { fail, nextId } = require('./util.cjs');
const { LIMITS, index, sameFilters, usedIds } = require('./model.cjs');
const { record } = require('./activity.cjs');

const present = rule => ({
  id: rule.id, state: rule.paused ? 'paused' : 'active', source_ids: rule.source_ids, area_ids: rule.area_ids, topics: rule.topics,
  min_priority: rule.min_priority, delivery: rule.delivery, created_at: rule.created_at, updated_at: rule.updated_at ?? null,
});
function find(data, id) {
  const rule = data.follows.find(f => f.id === id);
  if (!rule) fail('not_found', 'Unknown follow rule ' + id + '.');
  return rule;
}
// The rules a new or changed rule must meet, in this order.
function check(data, rule) {
  const ix = index(data);
  if (!rule.source_ids.length && !rule.area_ids.length && !rule.topics.length) fail('invalid_arguments', 'A follow rule needs at least one source, area or topic.');
  const source = rule.source_ids.find(x => !ix.sources.has(x)), area = rule.area_ids.find(x => !ix.areas.has(x));
  if (source !== undefined) fail('not_found', 'Unknown source ' + source + '.');
  if (area !== undefined) fail('not_found', 'Unknown area ' + area + '.');
  const same = data.follows.find(other => other.id !== rule.id && sameFilters(other, rule));
  if (same) fail('already_following', 'Follow rule ' + same.id + ' already has these sources, areas, topics and minimum priority. Change it with follows.update.');
}

function list(ctx, data, args) {
  return { follows: data.follows.map(present).filter(f => args.state === undefined || f.state === args.state) };
}

function create(ctx, data, args) {
  const rule = {
    id: nextId(usedIds(data), 'fl-'), source_ids: args.source_ids ?? [], area_ids: args.area_ids ?? [], topics: args.topics ?? [],
    min_priority: args.min_priority ?? 'routine', delivery: args.delivery, paused: false, created_at: ctx.virtual_now,
  };
  check(data, rule);
  if (data.follows.length >= LIMITS.follows) fail('limit_exceeded', 'The account already has ' + LIMITS.follows + ' follow rules. Remove or change one first.');
  data.follows.push(rule);
  record(data, { at: ctx.virtual_now, actor: 'agent', action: 'follows.create', object_id: rule.id, request_id: args.request_id, details: { delivery: rule.delivery } });
  return { id: rule.id, follow: present(rule) };
}

function update(ctx, data, args) {
  const rule = find(data, args.id), patch = args.patch, fields = Object.keys(patch);
  if (!fields.length) fail('invalid_arguments', 'patch needs at least one field.');
  const next = { ...rule };
  for (const key of ['source_ids', 'area_ids', 'topics', 'min_priority', 'delivery', 'paused']) if (patch[key] !== undefined) next[key] = patch[key];
  check(data, next);
  Object.assign(rule, next, { updated_at: ctx.virtual_now });
  record(data, { at: ctx.virtual_now, actor: 'agent', action: 'follows.update', object_id: rule.id, request_id: args.request_id, details: { fields } });
  return { id: rule.id, follow: present(rule) };
}

function remove(ctx, data, args) {
  const rule = find(data, args.id);
  data.follows.splice(data.follows.indexOf(rule), 1);
  record(data, { at: ctx.virtual_now, actor: 'agent', action: 'follows.remove', object_id: rule.id, request_id: args.request_id });
  return { id: rule.id, remaining: data.follows.length };
}

module.exports = { list, create, update, remove, present };
