'use strict';
// Record consistency for the run's public post history and the bound reader's private bookmarks.
const {fail, text, references} = require('./domain-utils.cjs');
const {index, instant} = require('./catalog.cjs');

function unique(list, key, label) {
  const seen = new Set();
  for (const item of list) {
    if (seen.has(item[key])) fail('invalid_seed', 'Duplicate ' + label + ': ' + item[key] + '.');
    seen.add(item[key]);
  }
}

// The one relationship field each kind carries.
const LINK_FIELD = {original: null, reply: 'parent_id', quote: 'quoted_id', repost: 'source_id'};
const RELATIONS = ['parent_id', 'quoted_id', 'source_id'];

// Shared by seed validation ('invalid_seed') and post.publish ('invalid_event') so a bad event is
// reported as an event error rather than surfacing later from Core's re-validation.
function checkPost(idx, p, code) {
  const author = idx.accounts.get(p.author_id);
  if (!author) fail(code, 'Post ' + p.id + ' has an unknown author ' + p.author_id + '.');
  if (instant(p.published_at) < instant(author.joined_at)) fail(code, 'Post ' + p.id + ' is dated before its author joined Wirewalk.');
  const field = LINK_FIELD[p.kind];
  for (const key of RELATIONS) {
    if (key === field && p[key] === undefined) fail(code, 'A ' + p.kind + ' needs ' + key + '.');
    if (key !== field && p[key] !== undefined) fail(code, 'A ' + p.kind + ' cannot have ' + key + '.');
  }
  if (p.kind === 'repost') {
    if (p.text !== undefined || p.links.length || p.media.length) fail(code, 'A repost carries no text, links or media of its own.');
  } else if (!text(p.text, 1000)) fail(code, 'Post ' + p.id + ' needs text.');
  if (field) {
    const target = idx.posts.get(p[field]);
    if (!target || target.id === p.id) fail(code, 'Post ' + p.id + ' points to an unknown post ' + p[field] + '.');
    if (target.kind === 'repost') fail(code, 'Post ' + p.id + ' points to a repost; point to the original post instead.');
    if (instant(target.published_at) > instant(p.published_at)) fail(code, 'Post ' + p.id + ' points to a post published after it.');
  }
  if (new Set(p.links.map(l => l.url)).size !== p.links.length) fail(code, 'Post ' + p.id + ' repeats a link.');
  if (p.links.some(l => !text(l.title, 200))) fail(code, 'Link titles cannot be blank.');
  if (new Set(p.media.map(m => m.asset_id)).size !== p.media.length) fail(code, 'Post ' + p.id + ' repeats an image.');
  if (p.media.some(m => !text(m.alt_text, 1000))) fail(code, 'Every image needs alt text.');
}

// An account reposts a given post at most once. Used for one incoming event; seeds use one Set pass.
function checkRepostOnce(posts, p, code) {
  if (p.kind === 'repost' && posts.some(q => q !== p && q.kind === 'repost' && q.author_id === p.author_id && q.source_id === p.source_id)) {
    fail(code, 'Account ' + p.author_id + ' already reposted ' + p.source_id + '.');
  }
}

function validateSeed(ctx, data) {
  references(ctx, data);
  unique(data.accounts, 'id', 'account ID');
  unique(data.posts, 'id', 'post ID');
  // Seed dates are not compared with the run clock: Core validates the package fixture at registration,
  // possibly under an earlier clock. Posts dated after the clock simply stay hidden until it reaches them.
  const idx = index(data);
  for (const a of data.accounts) {
    if (!text(a.display_name, 100)) fail('invalid_seed', 'Account display names cannot be blank.');
  }
  const reposts = new Set();
  for (const p of data.posts) {
    checkPost(idx, p, 'invalid_seed');
    if (p.kind !== 'repost') continue;
    const key = p.author_id + '\n' + p.source_id;
    if (reposts.has(key)) fail('invalid_seed', 'Account ' + p.author_id + ' already reposted ' + p.source_id + '.');
    reposts.add(key);
  }
  // Relationships point back in time; reject cycles even when timestamps tie.
  const visiting = new Set(), done = new Set();
  function visit(id) {
    if (visiting.has(id)) fail('invalid_seed', 'Post relationships cannot form a cycle.');
    if (done.has(id)) return;
    visiting.add(id);
    const p = idx.posts.get(id), next = p[LINK_FIELD[p.kind]];
    if (next !== undefined) visit(next);
    visiting.delete(id); done.add(id);
  }
  for (const id of idx.posts.keys()) visit(id);
  // Each catalogued image belongs to exactly one post (Core binds an asset to one parent object).
  unique(data.posts.flatMap(p => p.media), 'asset_id', 'image asset');
  unique(data.bookmarks, 'post_id', 'bookmark for post');
  for (const b of data.bookmarks) {
    const p = idx.posts.get(b.post_id);
    if (!p) fail('invalid_seed', 'A bookmark references an unknown post ' + b.post_id + '.');
    if (instant(b.saved_at) < instant(p.published_at)) fail('invalid_seed', 'Bookmark on ' + b.post_id + ' precedes the post.');
  }
}

module.exports = {
  validateSeed,
  checkPost,
  checkRepostOnce,
  records: data => data.posts,
  objects: data => data.posts.map(p => p.id),
  references: () => [],
  assetReferences: data => data.posts.flatMap(p => p.media.map(m => ({asset_id: m.asset_id, object_id: p.id, object_type: 'post'}))),
};
