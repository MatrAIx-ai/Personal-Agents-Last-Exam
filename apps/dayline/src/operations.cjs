'use strict';
// Agent business tools. Reads return the unchanged working copy; writes touch only private reader state.
// Both see only records dated at or before the run clock (catalog.visible).
const {fail, copy} = require('./domain-utils.cjs');
const {log} = require('./diagnostics.cjs');
const c = require('./catalog.cjs');

// Agent writes in one session share the virtual time, so ties fall back to insertion order (latest first).
const recentFirst = (list, key) => list.map((entry, i) => [entry, i])
  .sort(([a, ia], [b, ib]) => c.instant(b[key]) - c.instant(a[key]) || ib - ia).map(([entry]) => entry);
const WRITES = new Set(['dayline.history.mark_read', 'dayline.saved.add', 'dayline.saved.remove']);

function read(ctx, stored, name, args) {
  const data = c.visible(stored, ctx.virtual_now), idx = c.index(data);
  switch (name) {
    case 'dayline.outlets.list':
      return {outlets: copy(data.outlets)};
    case 'dayline.front_pages.list':
      return {front_pages: data.front_pages.map(p => ({front_page_id: p.front_page_id, title: p.title, kind: p.kind,
        entry_count: p.entries.length}))};
    case 'dayline.front_page.get': {
      const page = idx.frontPages.get(args.front_page_id);
      if (!page) fail('not_found', 'Front page does not exist in Dayline.');
      return {front_page: {front_page_id: page.front_page_id, title: page.title, kind: page.kind},
        entries: page.entries.slice(0, args.limit ?? page.entries.length)
          .map((id, i) => ({position: i + 1, ...c.summary(idx, idx.editions.get(id))}))};
    }
    case 'dayline.search':
      return c.search(idx, data, args);
    case 'dayline.story.get': {
      const story = c.visibleStory(idx, data, args.story_id);
      return {story: {story_id: story.story_id, title: story.title},
        editions: data.editions.filter(e => e.story_id === story.story_id).sort(c.oldestFirst).map(e => c.summary(idx, e))};
    }
    case 'dayline.edition.get':
      return {edition: c.full(idx, c.edition(idx, args.edition_id))};
    case 'dayline.history.list':
      return {entries: recentFirst(data.reading_history, 'read_at').slice(0, args.limit ?? 50)
        .map(h => ({read_at: h.read_at, edition: c.summary(idx, idx.editions.get(h.edition_id))}))};
    case 'dayline.saved.list':
      return {entries: recentFirst(data.reading_list, 'saved_at')
        .map(s => ({saved_at: s.saved_at, edition: c.summary(idx, idx.editions.get(s.edition_id))}))};
    default:
      return null;
  }
}

function write(ctx, data, name, args) {
  if (!WRITES.has(name)) fail('unknown_tool', 'Unknown Dayline operation.');
  // An edition added after the run clock is not in Dayline yet, so it is not_found here too.
  const idx = c.index(c.visible(data, ctx.virtual_now));
  const e = c.edition(idx, args.edition_id), id = e.edition_id;
  if (name === 'dayline.history.mark_read') {
    const changed = !idx.read.has(id);
    // A seeded read dated after the clock is replaced: the reader has now read it.
    if (changed) data.reading_history = [...data.reading_history.filter(h => h.edition_id !== id), {edition_id: id, read_at: ctx.virtual_now}];
    log(ctx, 'dayline.history.mark_read', {edition_id: id, changed});
    return {edition_id: id, read: true, changed};
  }
  if (name === 'dayline.saved.add') {
    const changed = !idx.saved.has(id);
    if (changed) data.reading_list = [...data.reading_list.filter(s => s.edition_id !== id), {edition_id: id, saved_at: ctx.virtual_now}];
    log(ctx, 'dayline.saved.add', {edition_id: id, changed});
    return {edition_id: id, saved: true, changed};
  }
  if (name === 'dayline.saved.remove') {
    if (!idx.saved.has(id)) fail('not_found', 'Edition is not on the reading list.');
    data.reading_list = data.reading_list.filter(s => s.edition_id !== id);
    log(ctx, 'dayline.saved.remove', {edition_id: id, changed: true});
    return {edition_id: id, saved: false, changed: true};
  }
}

function handleTool(ctx, data, name, args) {
  const result = read(ctx, data, name, args);
  if (result) return {data, result};
  return {data, result: write(ctx, data, name, args)};
}

module.exports = {handleTool};
