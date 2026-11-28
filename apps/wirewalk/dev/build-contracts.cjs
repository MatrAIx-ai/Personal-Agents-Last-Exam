'use strict';
// Maintainer script (not run by tests or the verifier). Regenerates schemas/seed.schema.json,
// schemas/events.schema.json and tools.json from one set of field definitions.
// Usage, from the package directory: node dev/build-contracts.cjs
const fs = require('node:fs'), path = require('node:path');
const out = path.resolve(__dirname, '..');
const APP = 'wirewalk';

const ID = {type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$'};
const TIME = {type: 'string', format: 'date-time'};
const text = (max, min = 1) => ({type: 'string', minLength: min, maxLength: max});
const obj = (properties, required = Object.keys(properties)) => ({type: 'object', properties, required, additionalProperties: false});
const arr = (items, maxItems, extra = {}) => ({type: 'array', items, maxItems, ...extra});
const nullable = s => ({anyOf: [s, {type: 'null'}]});
const VERSION = obj({epoch: {type: 'integer', minimum: 1}, revision: {type: 'integer', minimum: 0}});
const COUNT = {type: 'integer', minimum: 0};

const KIND = {enum: ['original', 'reply', 'quote', 'repost']};
const ACCOUNT_KIND = {enum: ['person', 'organization']};
// Fixture links stay on the reserved .example domain, so no record points at a live site.
const URL = {type: 'string', pattern: '^https://([a-z0-9-]+\\.)+example(/[A-Za-z0-9._~%/?=&#@:-]*)?$', maxLength: 300};
const LINK = obj({url: URL, title: text(200), description: text(500, 0)});
const MEDIA = obj({asset_id: ID, alt_text: text(1000)});

const ACCOUNT = obj({id: ID, display_name: text(100), kind: ACCOUNT_KIND, bio: text(300, 0), location: nullable(text(100)), joined_at: TIME});
const relations = {parent_id: ID, quoted_id: ID, source_id: ID};
const POST = obj({id: ID, kind: KIND, author_id: ID, text: text(1000), ...relations,
  links: arr(LINK, 4), media: arr(MEDIA, 4), published_at: TIME},
['id', 'kind', 'author_id', 'links', 'media', 'published_at']);

const seed = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:pale:wirewalk:seed:1',
  ...obj({
    account_id: ID, owner_person_id: ID,
    accounts: arr(ACCOUNT, 500), posts: arr(POST, 5000),
    bookmarks: arr(obj({post_id: ID, saved_at: TIME}), 1000),
  }),
};

// post.publish: the publication time is the event's `at`. Media is seed-only (it needs a catalogued asset).
const publishPayload = obj({id: ID, kind: KIND, author_id: ID, text: text(1000), ...relations, links: arr(LINK, 4)},
  ['id', 'kind', 'author_id']);
const events = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:pale:wirewalk:events:1',
  ...obj({event_id: ID, at: TIME, operation: {const: 'post.publish'}, payload: publishPayload}),
};

const AUTHOR = obj({id: ID, display_name: text(100), kind: ACCOUNT_KIND});
const REF = obj({id: ID, kind: KIND, author_id: ID, author_name: text(100), published_at: TIME, link: URL, text: nullable(text(1000))});
const SUMMARY_FIELDS = {
  id: ID, kind: KIND, author: AUTHOR, published_at: TIME, link: URL, text: nullable(text(1000)),
  parent: nullable(REF), quoted: nullable(REF), source: nullable(REF),
  links: arr(LINK, 4), media: arr(MEDIA, 4),
  counts: obj({replies: COUNT, quotes: COUNT, reposts: COUNT}), bookmarked: {type: 'boolean'},
};
const SUMMARY = obj(SUMMARY_FIELDS);
const FULL = obj({...SUMMARY_FIELDS, replies: arr(REF, 5000), quotes: arr(REF, 5000),
  reposted_by: arr(obj({repost_id: ID, account_id: ID, display_name: text(100), published_at: TIME}), 5000),
  saved_at: nullable(TIME)});
const PAGE = {as_of: TIME, total: COUNT, posts: arr(SUMMARY, 50), next_cursor: nullable(text(2000))};
const LIMIT = max => ({type: 'integer', minimum: 1, maximum: max});
const CURSOR = text(2000);

// Every write receipt: null, or how many stored bookmarks dated after the clock the write replaced. Only a
// count, because the receipt goes to the Agent. This happens only when a seed that runs past its clock is
// loaded early.
const LATER = nullable({type: 'object', additionalProperties: {type: 'integer', minimum: 1}});
const LATER_NOTE = ' later_history_removed is null unless the loaded data holds a bookmark of this post dated after the clock, which this change replaced; it then counts it.';
function tool(name, description, readOnly, input, output, required = Object.keys(input)) {
  const inputSchema = readOnly ? obj(input, required)
    : obj({...input, expected_version: VERSION, request_id: ID}, [...required, 'expected_version', 'request_id']);
  const outputSchema = obj({status: {const: readOnly ? 'ok' : 'committed'}, app_id: {const: APP}, version: VERSION, ...output,
    ...(readOnly ? {} : {later_history_removed: LATER})});
  if (!readOnly) description += LATER_NOTE;
  return {name, description, read_only: readOnly, scope: name, resource_target: 'current account', inputSchema, outputSchema};
}

const POSTS_NOTE = 'Only posts published at or before the current time are visible; an unknown post and a post not yet published get the same not_found response.';
const tools = [
  tool('wirewalk.feed.list',
    'List the public Wirewalk feed, newest publication first (post ID breaks ties). Each post shows its author, publication time, stable link, text and its reply, quote or repost relationship. Returns up to limit posts (default 20) and a next_cursor. A cursor keeps the result set fixed at the first page: posts published later, even at the same timestamp, appear only in a fresh call. A cursor that no longer matches its query or the feed is rejected. ' + POSTS_NOTE,
    true, {limit: LIMIT(50), cursor: CURSOR}, PAGE, []),
  tool('wirewalk.search',
    'Search visible post text (the post\'s own text, image alt text and link titles and descriptions; case- and accent-insensitive, every query word must match the start of a word). Reposts carry no text of their own, so they match only filter-only searches; a query with no letters or digits is rejected. Optional exact author_id and kind filters and an inclusive since/until window (since must not be later than until). Newest publication first, with post ID breaking ties; paging works as in wirewalk.feed.list. ' + POSTS_NOTE,
    true, {query: text(200, 0), author_id: ID, kind: KIND, since: TIME, until: TIME, limit: LIMIT(50), cursor: CURSOR}, PAGE, []),
  tool('wirewalk.post.get',
    'Read one post with its author, publication time, stable link, the post it replies to, quotes or reposts, and the visible replies, quotes and reposts of it (oldest first). ' + POSTS_NOTE,
    true, {id: ID}, {post: FULL}),
  tool('wirewalk.thread.get',
    'Open the conversation around a post: the chain of posts it replies to (root first), the post itself and every visible reply below it, in conversation order with depth. Quotes start their own conversations. Opening a repost opens its source\'s conversation. ' + POSTS_NOTE,
    true, {id: ID}, {root_id: ID, focus_id: ID,
      posts: arr(obj({...SUMMARY_FIELDS, depth: COUNT, relation: {enum: ['ancestor', 'focus', 'reply']}}), 5000)}),
  tool('wirewalk.account.get',
    'Inspect a public account: display name, kind (person or organization), bio, location, join date, profile link, visible post count and its most recent visible posts (default 10).',
    true, {id: ID, limit: LIMIT(50)},
    {account: obj({...ACCOUNT.properties, link: URL, post_count: COUNT}), recent_posts: arr(SUMMARY, 50)}, ['id']),
  tool('wirewalk.bookmarks.list',
    'List this reader\'s private bookmarks, most recently saved first. Other accounts never see them.',
    true, {}, {bookmarks: arr(obj({saved_at: TIME, post: SUMMARY}), 1000)}),
  tool('wirewalk.bookmarks.add',
    'Bookmark a visible post for this reader. Bookmarking a post that is already bookmarked leaves one bookmark (changed: false). Returns only the post ID and bookmark status.',
    false, {id: ID}, {post_id: ID, bookmarked: {const: true}, changed: {type: 'boolean'}}),
  tool('wirewalk.bookmarks.remove',
    'Remove this reader\'s bookmark on a visible post. Removing a bookmark that does not exist changes nothing (changed: false).',
    false, {id: ID}, {post_id: ID, bookmarked: {const: false}, changed: {type: 'boolean'}}),
];

const write = (file, value) => fs.writeFileSync(path.join(out, file), JSON.stringify(value, null, 2) + '\n');
write('schemas/seed.schema.json', seed);
write('schemas/events.schema.json', events);
write('tools.json', tools);
console.log('wrote', tools.length, 'tools');
