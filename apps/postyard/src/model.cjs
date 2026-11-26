'use strict';
const {fail, ID, instant, accountById, chars, serialNumber} = require('./common.cjs');
const EARLIEST = '2025-01-01T00:00:00-08:00';
const MEDIA_LIMITS = {
  avatar: {mime: 'image/png', width: 128, height: 128, bytes: 15 * 1024, count: 16},
  cover: {mime: 'image/jpeg', bytes: 80 * 1024, count: 6},
  note: {mime: 'image/jpeg', bytes: 60 * 1024, count: 4}
};

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
    const number = serialNumber(post.id, post.account_id, 'p');
    if (number === null) fail('invalid_seed', 'Post ids use account_id:pN.');
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
    const number = serialNumber(note.id, note.account_id, 'n');
    if (number === null) fail('invalid_seed', 'Note ids use account_id:nN.');
    maxNote[note.account_id] = Math.max(maxNote[note.account_id] || 0, number);
    if (!NOTE_STATUS.has(note.status) || !NOTE_KIND.has(note.kind) || note.revision !== 1) fail('invalid_seed', 'Note shape is invalid.');
    if (chars(note.text) > 500) fail('invalid_seed', 'A seeded note is longer than 500 characters.');
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
    if (receipt.object_type === 'post') {
      const post = data.posts.find(item => item.id === receipt.object_id);
      if (!post || !post.revisions.some(row => row.revision === receipt.revision)) fail('invalid_seed', 'A receipt names a missing post revision.');
    } else if (receipt.object_type === 'note') {
      const note = data.notes.find(item => item.id === receipt.object_id);
      if (!note || receipt.revision !== note.revision) fail('invalid_seed', 'A receipt names a missing note revision.');
    } else fail('invalid_seed', 'A receipt names an unknown object type.');
    instant(receipt.published_at, 'invalid_seed');
  }
  const media = data.media || [];
  const counts = {avatar: 0, cover: 0, note: 0};
  for (const asset of media) {
    const limit = MEDIA_LIMITS[asset.role];
    if (!limit) fail('invalid_seed', 'Media role is invalid.');
    counts[asset.role] += 1;
    if (counts[asset.role] > limit.count) fail('invalid_seed', 'Too many ' + asset.role + ' images.');
    if (asset.mime !== limit.mime || asset.byte_length > limit.bytes || asset.byte_length < 1) fail('invalid_seed', 'A media file exceeds its limit.');
    if (limit.width && (asset.width !== limit.width || asset.height !== limit.height)) fail('invalid_seed', 'An avatar must be 128 by 128.');
  }
  const clock = instant(ctx.virtual_now || data.seed_clock, 'invalid_seed');
  const earliest = instant(EARLIEST, 'invalid_seed');
  const dated = [];
  for (const account of data.accounts) dated.push(['account', account.created_at]);
  for (const post of data.posts) {
    dated.push(['post', post.created_at], ['post', post.updated_at]);
    if (post.published_at) dated.push(['publication', post.published_at]);
    if (post.unpublished_at) dated.push(['publication', post.unpublished_at]);
    if (post.publish_at && post.status !== 'scheduled' && post.status !== 'pending_owner_confirmation') dated.push(['schedule', post.publish_at]);
    for (const row of post.revisions) dated.push(['revision', row.created_at]);
  }
  for (const note of data.notes) {
    dated.push(['note', note.created_at], ['note', note.updated_at]);
    if (note.published_at) dated.push(['publication', note.published_at]);
    if (note.deleted_at) dated.push(['note', note.deleted_at]);
  }
  for (const edge of data.follows) dated.push(['follow', edge.at]);
  for (const block of data.blocks) dated.push(['block', block.at]);
  for (const receipt of data.receipts) dated.push(['receipt', receipt.published_at]);
  for (const item of data.notifications || []) dated.push(['notification', item.at]);
  for (const [label, value] of dated) {
    const at = instant(value, 'invalid_seed');
    if (at < earliest) fail('invalid_seed', 'History is before 2025-01-01.');
    if (at > clock) fail('invalid_seed', label + ' is dated after the load clock.');
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
