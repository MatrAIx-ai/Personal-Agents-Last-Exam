'use strict';
// Infra-applied incoming event: post.publish. Core deduplicates event IDs and rolls back failures.
const {fail, copy} = require('./domain-utils.cjs');
const {log} = require('./diagnostics.cjs');
const {index} = require('./catalog.cjs');
const {checkPost, checkRepostOnce} = require('./model.cjs');

function applyEvent(ctx, data, event) {
  if (event.operation !== 'post.publish') fail('invalid_event', 'Unsupported operation.');
  const p = event.payload, idx = index(data);
  if (idx.posts.has(p.id)) fail('invalid_event', 'Post ' + p.id + ' is already published; posts are immutable.');
  const post = {id: p.id, kind: p.kind, author_id: p.author_id};
  for (const key of ['text', 'parent_id', 'quoted_id', 'source_id']) if (p[key] !== undefined) post[key] = p[key];
  // Public from the moment the event commits: its publication time is the event time.
  Object.assign(post, {links: copy(p.links || []), media: [], published_at: event.at});
  checkPost(idx, post, 'invalid_event');
  checkRepostOnce(data.posts, post, 'invalid_event');
  data.posts.push(post);
  log(ctx, 'wirewalk.post_published', {post_id: post.id, kind: post.kind});
  return data;
}

module.exports = {applyEvent};
