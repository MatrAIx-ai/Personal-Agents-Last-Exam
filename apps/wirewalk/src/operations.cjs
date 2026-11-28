'use strict';
// Agent business tools. Reads return the unchanged working copy; writes touch only the reader's bookmarks.
// Both see only posts, accounts and bookmarks dated at or before the run clock (catalog.view).
const {fail} = require('./domain-utils.cjs');
const {log} = require('./diagnostics.cjs');
const c = require('./catalog.cjs');

// Agent writes in one session share the virtual time, so ties fall back to insertion order (latest first).
const recentFirst = list => list.map((entry, i) => [entry, i])
  .sort(([a, ia], [b, ib]) => c.instant(b.saved_at) - c.instant(a.saved_at) || ib - ia).map(([entry]) => entry);
const WRITES = new Set(['wirewalk.bookmarks.add', 'wirewalk.bookmarks.remove']);

function read(ctx, data, name, args) {
  const v = c.view(data, ctx.virtual_now);
  switch (name) {
    case 'wirewalk.feed.list':
      return c.page(v, 'feed', args, c.filters({}));
    case 'wirewalk.search':
      return c.page(v, 'search', args, c.filters(args));
    case 'wirewalk.post.get':
      return {post: c.full(v, c.post(v, args.id))};
    case 'wirewalk.thread.get':
      return c.thread(v, args.id);
    case 'wirewalk.account.get': {
      const a = c.account(v, args.id), own = v.shown.filter(p => p.author_id === a.id);
      return {account: {...a, link: c.profileLink(a), post_count: own.length},
        recent_posts: own.sort(c.newestFirst).slice(0, args.limit ?? 10).map(p => c.summary(v, p))};
    }
    case 'wirewalk.bookmarks.list':
      // Only bookmarks saved at or before the clock (catalog.view); their posts are public by then.
      return {bookmarks: recentFirst(v.marks).map(b => ({saved_at: b.saved_at, post: c.summary(v, v.idx.posts.get(b.post_id))}))};
    default:
      return null;
  }
}

function write(ctx, data, name, args) {
  if (!WRITES.has(name)) fail('unknown_tool', 'Unknown Wirewalk operation.');
  // A post published after the run clock is not public yet, so it is not_found here too.
  const v = c.view(data, ctx.virtual_now), id = c.post(v, args.id).id;
  if (name === 'wirewalk.bookmarks.add') {
    const changed = !v.idx.bookmarks.has(id);
    // A seeded bookmark saved after the clock is replaced: the reader has saved the post now. The receipt
    // counts it (it goes to the Agent) and the ID-only diagnostics log names the post; the stored bookmark
    // stays in the loaded seed, which Core's snapshot keeps as initial_data.
    const later = changed ? data.bookmarks.filter(b => b.post_id === id) : [];
    if (changed) data.bookmarks = [...data.bookmarks.filter(b => b.post_id !== id), {post_id: id, saved_at: ctx.virtual_now}];
    log(ctx, 'wirewalk.bookmarks.add', {post_id: id, changed, later_history_removed: later.length ? {bookmarks: later.map(b => b.post_id)} : null});
    return {post_id: id, bookmarked: true, changed, later_history_removed: later.length ? {bookmarks: later.length} : null};
  }
  // A bookmark saved after the clock does not exist yet: changed is false and the stored record stays.
  const changed = v.idx.bookmarks.has(id);
  if (changed) data.bookmarks = data.bookmarks.filter(b => b.post_id !== id);
  log(ctx, 'wirewalk.bookmarks.remove', {post_id: id, changed, later_history_removed: null});
  return {post_id: id, bookmarked: false, changed, later_history_removed: null};
}

function handleTool(ctx, data, name, args) {
  const result = read(ctx, data, name, args);
  if (result) return {data, result};
  return {data, result: write(ctx, data, name, args)};
}

module.exports = {handleTool};
