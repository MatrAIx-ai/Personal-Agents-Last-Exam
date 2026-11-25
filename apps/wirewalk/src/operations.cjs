'use strict';
// Agent business tools. Reads return the unchanged working copy; writes touch only the reader's bookmarks.
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
      // A seeded bookmark on a post that is not public yet stays hidden with the post.
      return {bookmarks: recentFirst(data.bookmarks).filter(b => v.isVisible(v.idx.posts.get(b.post_id)))
        .map(b => ({saved_at: b.saved_at, post: c.summary(v, v.idx.posts.get(b.post_id))}))};
    default:
      return null;
  }
}

function write(ctx, data, name, args) {
  if (!WRITES.has(name)) fail('unknown_tool', 'Unknown Wirewalk operation.');
  const v = c.view(data, ctx.virtual_now), id = c.post(v, args.id).id;
  if (name === 'wirewalk.bookmarks.add') {
    const changed = !v.idx.bookmarks.has(id);
    if (changed) data.bookmarks.push({post_id: id, saved_at: ctx.virtual_now});
    log(ctx, 'wirewalk.bookmarks.add', {post_id: id, changed});
    return {post_id: id, bookmarked: true, changed};
  }
  const changed = v.idx.bookmarks.has(id);
  if (changed) data.bookmarks = data.bookmarks.filter(b => b.post_id !== id);
  log(ctx, 'wirewalk.bookmarks.remove', {post_id: id, changed});
  return {post_id: id, bookmarked: false, changed};
}

function handleTool(ctx, data, name, args) {
  const result = read(ctx, data, name, args);
  if (result) return {data, result};
  return {data, result: write(ctx, data, name, args)};
}

module.exports = {handleTool};
