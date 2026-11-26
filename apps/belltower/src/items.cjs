'use strict';
// W2 Evidence (read-only): sources, areas, items and their revisions. A read returns records
// and the links their publishers declared; it never labels a copy as outdated, never merges
// copies into one story and never ranks sources. Reading an item does not mark it as read.
const { fail, ms, page } = require('./util.cjs');
const { RANK, index, overlap, latest, revisionOf, contentOf, itemStatus, effectOf, lastRead } = require('./model.cjs');

// One revision as a read returns it. A retraction has no text of its own: it shows the
// headline, topics, areas and priority of the revision before it, and no effective period.
function presentRevision(item, revision, now) {
  const c = contentOf(item, revision);
  return {
    revision: revision.number, type: revision.type, headline: c.headline, topics: c.topics, area_ids: c.area_ids, priority: c.priority,
    note: revision.note ?? null, published_at: revision.published_at, received_at: revision.received_at,
    effective: revision.effective ?? null, effect: effectOf(revision, now), based_on: revision.based_on ?? null,
  };
}
// What the account's own records say about an item: the newest revision marked as read and the clipping, if any.
const view = (item, read, clippingId) => ({ last_read_revision: read, changed_since_read: read !== null && read < latest(item).number, clipping_id: clippingId });
function accountView(data, item) {
  const clipping = data.clippings.find(c => c.item_id === item.id);
  return view(item, lastRead(data, item.id), clipping ? clipping.id : null);
}

// Plain word matching: letters and digits form words, everything else separates them.
const words = text => String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];

function sources(ctx, data, args) {
  const counts = new Map();
  for (const item of data.items) counts.set(item.source_id, (counts.get(item.source_id) || 0) + 1);
  return { sources: data.sources.filter(s => args.kind === undefined || s.kind === args.kind).map(s => ({ ...s, items: counts.get(s.id) || 0 })) };
}

function areas(ctx, data, args) {
  const ix = index(data);
  if (args.id !== undefined && !ix.areas.has(args.id)) fail('not_found', 'Unknown area ' + args.id + '.');
  return { areas: data.areas.filter(a => args.id === undefined || ix.paths.get(a.id).includes(args.id)).map(a => ({ ...a, path: ix.paths.get(a.id) })) };
}

// Newest first, by the time the newest matching revision was received.
function list(ctx, data, args) {
  const ix = index(data), now = ms(ctx.virtual_now);
  if (args.source_id !== undefined && !ix.sources.has(args.source_id)) fail('not_found', 'Unknown source ' + args.source_id + '.');
  if (args.area_id !== undefined && !ix.areas.has(args.area_id)) fail('not_found', 'Unknown area ' + args.area_id + '.');
  const start = args.start === undefined ? -Infinity : ms(args.start), end = args.end === undefined ? Infinity : ms(args.end);
  if (!(end > start)) fail('invalid_window', 'end must be after start.');
  const query = args.query === undefined ? null : words(args.query);
  if (query && !query.length) fail('invalid_arguments', 'query needs at least one word.');

  const passes = (item, r) => {
    const received = ms(r.received_at), c = contentOf(item, r);
    if (received < start || received >= end) return false;
    if (args.area_id !== undefined && !c.area_ids.some(a => overlap(ix, a, args.area_id))) return false;
    if (args.topic !== undefined && !c.topics.includes(args.topic)) return false;
    if (args.min_priority !== undefined && RANK[c.priority] < RANK[args.min_priority]) return false;
    if (query) {
      // A retraction has no headline or body of its own, so no word can be found in it.
      const found = new Set(words((r.headline ?? '') + ' ' + (r.body ?? '')));
      if (!query.every(w => found.has(w))) return false;
    }
    return true;
  };
  // The account's records are gathered once, so a long list stays one pass over them.
  const read = new Map(), clipped = new Map(data.clippings.map(c => [c.item_id, c.id]));
  for (const m of data.read_marks) if (m.revision > (read.get(m.item_id) || 0)) read.set(m.item_id, m.revision);
  const all = [];
  for (const item of data.items) {
    if (args.source_id !== undefined && item.source_id !== args.source_id) continue;
    if (args.kind !== undefined && item.kind !== args.kind) continue;
    if (args.status !== undefined && itemStatus(item) !== args.status) continue;
    const mine = view(item, read.get(item.id) ?? null, clipped.get(item.id) ?? null);
    if (args.changed_since_read !== undefined && mine.changed_since_read !== args.changed_since_read) continue;
    const matched = item.revisions.filter(r => passes(item, r));
    if (matched.length) all.push({ item, mine, matched, newest: ms(matched[matched.length - 1].received_at) });
  }
  all.sort((a, b) => b.newest - a.newest || (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0));
  const { items, next_cursor } = page(args, all);
  return {
    items: items.map(({ item, mine, matched }) => ({
      id: item.id, source_id: item.source_id, kind: item.kind, status: itemStatus(item), ...presentRevision(item, latest(item), now),
      matched_revisions: matched.map(r => r.number), ...mine,
    })),
    next_cursor,
  };
}

// Every revision of another item that names this item as its basis, in the order received.
function referencedBy(data, item) {
  const out = [];
  for (const other of data.items) {
    for (const r of other.revisions) {
      if (r.based_on && r.based_on.item_id === item.id) {
        out.push({ item_id: other.id, source_id: other.source_id, revision: r.number, relation: r.based_on.relation, used_revision: r.based_on.revision, published_at: r.published_at, received_at: r.received_at });
      }
    }
  }
  return out.sort((a, b) => ms(a.received_at) - ms(b.received_at) || (a.item_id < b.item_id ? -1 : a.item_id > b.item_id ? 1 : a.revision - b.revision));
}

function get(ctx, data, args) {
  const ix = index(data), now = ms(ctx.virtual_now), item = ix.items.get(args.id);
  if (!item) fail('not_found', 'Unknown item ' + args.id + '.');
  const last = latest(item).number, number = args.revision ?? last, revision = revisionOf(item, number);
  if (!revision) fail('not_found', 'Item ' + item.id + ' has no revision ' + number + '. Its latest revision is ' + last + '.');
  const source = ix.sources.get(item.source_id);
  return {
    item: {
      id: item.id, source_id: item.source_id, source_name: source.name, source_kind: source.kind, kind: item.kind, status: itemStatus(item), latest_revision: last,
      ...presentRevision(item, revision, now), is_latest: number === last, body: revision.body ?? null,
      revisions: item.revisions.map(r => ({ revision: r.number, type: r.type, published_at: r.published_at, received_at: r.received_at, note: r.note ?? null, effective: r.effective ?? null })),
      referenced_by: referencedBy(data, item),
      read_revisions: data.read_marks.filter(m => m.item_id === item.id).map(m => m.revision).sort((a, b) => a - b),
      ...accountView(data, item),
    },
  };
}

module.exports = { sources, areas, list, get, presentRevision, accountView, words };
