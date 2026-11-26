'use strict';
const {fail, ID, instant, accountById} = require('./common.cjs');

const POST_STATUS = new Set(['draft', 'pending_owner_confirmation', 'scheduled', 'published', 'unpublished']);
const NOTE_STATUS = new Set(['posted', 'scheduled', 'deleted', 'pending_owner_confirmation', 'declined', 'withdrawn']);
const NOTE_KIND = new Set(['note', 'reply', 'repost']);
const VISIBILITY = new Set(['private', 'pending', 'public', 'withheld']);

function validateSeed(ctx, data) {
  const person = ctx.binding.people.some(item => item.person_id === data.owner_person_id);
  const bound = ctx.binding.accounts.some(item => item.app_id === ctx.app_id && item.account_id === data.account_id && item.owner_person_id === data.owner_person_id);
  if (!person || !bound) fail('invalid_seed', 'Account and owner must exist in the supplied binding.');
  if (!accountById(data, data.account_id) || accountById(data, data.account_id).person_id !== data.owner_person_id) {
    fail('invalid_seed', 'The bound account must carry the owner person id.');
  }
  if (!Number.isFinite(data.settings.audience_rate_per_hour) || data.settings.audience_rate_per_hour < 0) fail('invalid_seed', 'audience_rate_per_hour is invalid.');
  if (!Number.isInteger(data.settings.audience_cap) || data.settings.audience_cap < 1) fail('invalid_seed', 'audience_cap is invalid.');
  const handles = new Set();
  const accountIds = new Set();
  for (const account of data.accounts) {
    if (accountIds.has(account.account_id) || !ID.test(account.account_id)) fail('invalid_seed', 'Account ids must be unique and well formed.');
    accountIds.add(account.account_id);
    const handle = account.handle.toLowerCase();
    if (handles.has(handle)) fail('invalid_seed', 'Handles must be unique.');
    handles.add(handle);
    if (account.person_id && !ctx.binding.people.some(item => item.person_id === account.person_id)) {
      fail('invalid_seed', 'An account person_id is missing from the binding.');
    }
    const counter = data.counters[account.account_id];
    if (!counter || !Number.isInteger(counter.post) || !Number.isInteger(counter.note) || counter.post < 0 || counter.note < 0) {
      fail('invalid_seed', 'Every account needs post and note counters.');
    }
    instant(account.created_at, 'invalid_seed');
  }
  const slugs = new Set();
  const postIds = new Set();
  const maxPost = {};
  for (const post of data.posts) {
    if (postIds.has(post.id)) fail('invalid_seed', 'Post ids must be unique.');
    postIds.add(post.id);
    if (!ID.test(post.id) || !accountIds.has(post.account_id)) fail('invalid_seed', 'A post id or account is invalid.');
    const prefix = post.account_id + ':p';
    if (!post.id.startsWith(prefix)) fail('invalid_seed', 'Post ids use account_id:pN.');
    const number = Number(post.id.slice(prefix.length));
    if (!Number.isInteger(number) || number < 1) fail('invalid_seed', 'Post ids use account_id:pN.');
    maxPost[post.account_id] = Math.max(maxPost[post.account_id] || 0, number);
    if (!POST_STATUS.has(post.status)) fail('invalid_seed', 'Post status is invalid.');
    const key = post.account_id + '/' + post.slug;
    if (slugs.has(key)) fail('invalid_seed', 'Slugs are unique per account.');
    slugs.add(key);
    if (post.head_revision !== post.revisions.length) fail('invalid_seed', 'Revision numbers must be contiguous.');
    let previous = 0;
    for (const row of post.revisions) {
      if (row.revision !== previous + 1 || !VISIBILITY.has(row.visibility)) fail('invalid_seed', 'Revision numbers must be contiguous.');
      previous = row.revision;
      instant(row.created_at, 'invalid_seed');
    }
    if (post.public_revision !== null && !post.revisions.some(row => row.revision === post.public_revision)) {
      fail('invalid_seed', 'public_revision is missing.');
    }
    instant(post.created_at, 'invalid_seed');
    instant(post.updated_at, 'invalid_seed');
    if (instant(post.created_at, 'invalid_seed') > instant(post.updated_at, 'invalid_seed')) fail('invalid_seed', 'Post timestamps are reversed.');
  }
  for (const [accountId, high] of Object.entries(maxPost)) {
    if (data.counters[accountId].post < high) fail('invalid_seed', 'The post counter is behind an existing id.');
  }
  const maxNote = {};
  const noteIds = new Set();
  for (const note of data.notes) {
    if (noteIds.has(note.id) || !ID.test(note.id) || !accountIds.has(note.account_id)) fail('invalid_seed', 'A note id is invalid.');
    noteIds.add(note.id);
    const prefix = note.account_id + ':n';
    if (!note.id.startsWith(prefix)) fail('invalid_seed', 'Note ids use account_id:nN.');
    const number = Number(note.id.slice(prefix.length));
    if (!Number.isInteger(number) || number < 1) fail('invalid_seed', 'Note ids use account_id:nN.');
    maxNote[note.account_id] = Math.max(maxNote[note.account_id] || 0, number);
    if (!NOTE_STATUS.has(note.status) || !NOTE_KIND.has(note.kind) || note.revision !== 1) fail('invalid_seed', 'Note shape is invalid.');
    if (note.text.length > 500) fail('invalid_seed', 'A seeded note is longer than 500 characters.');
    instant(note.created_at, 'invalid_seed');
    instant(note.updated_at, 'invalid_seed');
  }
  for (const [accountId, high] of Object.entries(maxNote)) {
    if (data.counters[accountId].note < high) fail('invalid_seed', 'The note counter is behind an existing id.');
  }
  for (const edge of data.follows) {
    if (!accountIds.has(edge.follower_account_id) || !accountIds.has(edge.target_account_id)) fail('invalid_seed', 'A follow edge names a missing account.');
    if (edge.follower_account_id === edge.target_account_id) fail('invalid_seed', 'An account cannot follow itself.');
  }
  for (const block of data.blocks) {
    if (!accountIds.has(block.account_id) || !accountIds.has(block.target_account_id)) fail('invalid_seed', 'A block names a missing account.');
  }
  const receiptIds = new Set();
  for (const receipt of data.receipts) {
    if (receiptIds.has(receipt.receipt_id) || !/^pr-\d+$/.test(receipt.receipt_id)) fail('invalid_seed', 'Receipt ids must be unique.');
    receiptIds.add(receipt.receipt_id);
  }
  for (const subject of data.protected_subjects) {
    if (!ctx.binding.people.some(item => item.person_id === subject.person_id)) fail('invalid_seed', 'A protected subject is missing from the binding.');
    if (!accountIds.has(subject.account_id)) fail('invalid_seed', 'A protected subject account is missing.');
  }
}

function rows(data) { return [...data.posts, ...data.notes]; }

module.exports = {
  validateSeed,
  records: data => rows(data),
  objects: data => rows(data).map(item => item.id),
  references: () => [],
  assetReferences: () => []
};
