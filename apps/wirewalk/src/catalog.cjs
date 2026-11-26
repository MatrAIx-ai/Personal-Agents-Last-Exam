'use strict';
// Read-side helpers: visibility at the run clock, agent-facing post shapes, search, stable paging
// and conversations. No business mutations here.
const {fail, copy} = require('./domain-utils.cjs');

const SITE = 'https://wirewalk.example/';
const instant = value => Date.parse(value);
// Case- and accent-insensitive words: "Fennick St." finds "fennick" and an accented letter matches its plain form.
const fold = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const words = value => fold(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
// Newest publication first; equal timestamps fall back to the post ID, highest first. Code-unit
// comparison keeps the order independent of the host locale.
const byIdDesc = (a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
const newestFirst = (a, b) => instant(b.published_at) - instant(a.published_at) || byIdDesc(a, b);
const oldestFirst = (a, b) => newestFirst(b, a);

function index(data) {
  return {
    accounts: new Map(data.accounts.map(a => [a.id, a])),
    posts: new Map(data.posts.map(p => [p.id, p])),
    bookmarks: new Map(data.bookmarks.map(b => [b.post_id, b])),
  };
}

// Everything a read needs at one clock reading. A post is public from its publication time onward,
// an account from its join date and a bookmark from its saved_at; relationship lists and counts only
// include posts that are already public. Nothing is stored for this: later records appear as the clock
// reaches them. index() stays unfiltered for seed validation and events.
function view(data, now) {
  const idx = index(data), t = instant(now);
  const isVisible = p => Boolean(p) && instant(p.published_at) <= t;
  const shown = data.posts.filter(isVisible);
  // Validation keeps saved_at at or after the post's publication, so a shown bookmark's post is public.
  const marks = data.bookmarks.filter(b => instant(b.saved_at) <= t);
  idx.bookmarks = new Map(marks.map(b => [b.post_id, b]));
  const rel = {replies: new Map(), quotes: new Map(), reposts: new Map()};
  const add = (map, key, p) => {if (!map.has(key)) map.set(key, []); map.get(key).push(p);};
  for (const p of shown) {
    if (p.parent_id !== undefined) add(rel.replies, p.parent_id, p);
    if (p.quoted_id !== undefined) add(rel.quotes, p.quoted_id, p);
    if (p.source_id !== undefined) add(rel.reposts, p.source_id, p);
  }
  for (const map of Object.values(rel)) for (const list of map.values()) list.sort(oldestFirst);
  return {data, idx, now, t, shown, marks, rel, isVisible};
}

// An unknown ID and a post that is not public yet get the same answer.
function post(v, id) {
  const p = v.idx.posts.get(id);
  if (!v.isVisible(p)) fail('not_found', 'Post is not available in Wirewalk.');
  return p;
}
function account(v, id) {
  const a = v.idx.accounts.get(id);
  if (!a || instant(a.joined_at) > v.t) fail('not_found', 'Account is not available in Wirewalk.');
  return a;
}

const postLink = p => SITE + '@' + p.author_id + '/posts/' + p.id;
const profileLink = a => SITE + '@' + a.id;

function ref(v, p) {
  return {id: p.id, kind: p.kind, author_id: p.author_id, author_name: v.idx.accounts.get(p.author_id).display_name,
    published_at: p.published_at, link: postLink(p), text: p.text ?? null};
}
const related = (v, id) => (id === undefined ? null : ref(v, v.idx.posts.get(id)));
const count = (map, id) => (map.get(id) || []).length;

function summary(v, p) {
  const author = v.idx.accounts.get(p.author_id);
  return {
    id: p.id, kind: p.kind, author: {id: author.id, display_name: author.display_name, kind: author.kind},
    published_at: p.published_at, link: postLink(p), text: p.text ?? null,
    parent: related(v, p.parent_id), quoted: related(v, p.quoted_id), source: related(v, p.source_id),
    links: copy(p.links), media: copy(p.media),
    counts: {replies: count(v.rel.replies, p.id), quotes: count(v.rel.quotes, p.id), reposts: count(v.rel.reposts, p.id)},
    bookmarked: v.idx.bookmarks.has(p.id),
  };
}

function full(v, p) {
  return {
    ...summary(v, p),
    replies: (v.rel.replies.get(p.id) || []).map(r => ref(v, r)),
    quotes: (v.rel.quotes.get(p.id) || []).map(r => ref(v, r)),
    reposted_by: (v.rel.reposts.get(p.id) || []).map(r => ({repost_id: r.id, account_id: r.author_id,
      display_name: v.idx.accounts.get(r.author_id).display_name, published_at: r.published_at})),
    saved_at: v.idx.bookmarks.get(p.id)?.saved_at ?? null,
  };
}

// Normalized filters. A cursor carries them, so it cannot be reused for a different query.
function filters(args) {
  const query = words(args.query || '').join(' ');
  if (!query && (args.query || '').trim()) fail('invalid_arguments', 'The query has no letters or digits to search for.');
  if (args.since !== undefined && args.until !== undefined && instant(args.since) > instant(args.until)) {
    fail('invalid_arguments', 'since is later than until.');
  }
  return {query, author_id: args.author_id ?? null, kind: args.kind ?? null, since: args.since ?? null, until: args.until ?? null};
}
function matches(p, f) {
  if (f.author_id !== null && p.author_id !== f.author_id) return false;
  if (f.kind !== null && p.kind !== f.kind) return false;
  if (f.since !== null && instant(p.published_at) < instant(f.since)) return false;
  if (f.until !== null && instant(p.published_at) > instant(f.until)) return false;
  if (!f.query) return true;
  const own = words([p.text || '', ...p.media.map(m => m.alt_text), ...p.links.map(l => l.title + ' ' + l.description)].join(' '));
  // Each query word must match the start of a word, so "cancel" finds "canceled" but "line" misses "online".
  return f.query.split(' ').every(term => own.some(word => word.startsWith(term)));
}

// Cursor: the first page's publication boundary (as_of), how many posts were public then (n), the ID of
// the n-th of them (b) and the last row returned. Events append posts, so the first n posts in storage
// order published by as_of are exactly the first page's set; a later post, even one sharing a timestamp
// with the first page, falls outside it and is only seen by a fresh call. b pins that set: a forged n or
// a feed reset and refilled differently no longer matches. n and b only ever describe public posts, so
// the cursor reveals nothing else. Reads stay stateless.
const encode = value => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
function decode(v, op, f, cursor) {
  let c = null;
  try {c = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));} catch {}
  const ok = c && typeof c === 'object' && c.v === 1 && c.op === op && JSON.stringify(c.f) === JSON.stringify(f) &&
    Number.isInteger(c.n) && c.n >= 0 && (c.b === null || typeof c.b === 'string') &&
    typeof c.t === 'string' && Number.isFinite(instant(c.t)) && instant(c.t) <= v.t &&
    Array.isArray(c.k) && c.k.length === 2 && typeof c.k[0] === 'string' && Number.isFinite(instant(c.k[0])) && typeof c.k[1] === 'string';
  if (!ok) fail('invalid_arguments', 'This cursor does not belong to this query or feed state; start again without a cursor.');
  return {boundary: c.n, last: c.b, asOf: c.t, after: {published_at: c.k[0], id: c.k[1]}};
}

function page(v, op, args, f) {
  const first = args.cursor === undefined;
  const {boundary, last: pinned, asOf, after} = first ? {boundary: v.shown.length, asOf: v.now, after: null} : decode(v, op, f, args.cursor);
  const pool = v.data.posts.filter(p => instant(p.published_at) <= instant(asOf));
  if (!first && (boundary > pool.length || (boundary ? pool[boundary - 1].id : null) !== pinned)) {
    fail('invalid_arguments', 'This cursor does not belong to this query or feed state; start again without a cursor.');
  }
  const set = pool.slice(0, boundary).filter(p => matches(p, f)).sort(newestFirst);
  const rest = after ? set.filter(p => newestFirst(after, p) < 0) : set;
  const limit = args.limit ?? 20, rows = rest.slice(0, limit), last = rows[rows.length - 1];
  return {
    as_of: asOf, total: set.length, posts: rows.map(p => summary(v, p)),
    next_cursor: rest.length > limit ? encode({v: 1, op, f, n: boundary, b: boundary ? pool[boundary - 1].id : null, t: asOf, k: [last.published_at, last.id]}) : null,
  };
}

// Conversation order: ancestors root first, the focus post, then replies depth-first, oldest first.
function thread(v, id) {
  let focus = post(v, id);
  if (focus.kind === 'repost') focus = post(v, focus.source_id);
  const ancestors = [];
  for (let p = focus; p.parent_id !== undefined;) {p = v.idx.posts.get(p.parent_id); ancestors.unshift(p);}
  const rows = ancestors.map((p, depth) => ({...summary(v, p), depth, relation: 'ancestor'}));
  rows.push({...summary(v, focus), depth: ancestors.length, relation: 'focus'});
  const walk = (p, depth) => {
    for (const r of v.rel.replies.get(p.id) || []) {rows.push({...summary(v, r), depth, relation: 'reply'}); walk(r, depth + 1);}
  };
  walk(focus, ancestors.length + 1);
  return {root_id: (ancestors[0] || focus).id, focus_id: focus.id, posts: rows};
}

module.exports = {index, view, post, account, postLink, profileLink, ref, summary, full, filters, matches, page, thread,
  instant, fold, words, newestFirst, oldestFirst};
