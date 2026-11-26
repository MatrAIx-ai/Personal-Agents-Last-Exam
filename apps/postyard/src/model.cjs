'use strict';
const {fail, ID, instant, accountById, chars, serialNumber} = require('./common.cjs');
const {imageSize} = require('./images.cjs');
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
    if (chars(account.bio) > 500) fail('invalid_seed', 'A profile bio is longer than 500 characters.');
    const publishedProfile = account.profile_revision || 1;
    const pendingProfile = account.pending_profile ? account.pending_profile.revision : null;
    const retiredProfile = account.retired_profile_revisions || [];
    if (pendingProfile !== null) {
      if (chars(account.pending_profile.bio) > 500) fail('invalid_seed', 'A pending profile bio is longer than 500 characters.');
      if (!Number.isInteger(pendingProfile) || pendingProfile <= publishedProfile) fail('invalid_seed', 'A pending profile revision is not above the public one.');
      if (retiredProfile.includes(pendingProfile)) fail('invalid_seed', 'A pending profile revision is also retired.');
    }
    for (const number of retiredProfile) {
      if (!Number.isInteger(number) || number === publishedProfile) fail('invalid_seed', 'A retired profile revision repeats the public one.');
    }
    if (account.profile_revision_high !== undefined && account.profile_revision_high !== null) {
      const ceiling = Math.max(publishedProfile, pendingProfile || 0, ...retiredProfile);
      if (account.profile_revision_high < ceiling) fail('invalid_seed', 'The profile high-water mark is below a stored revision.');
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
      if (row.correction_note && chars(row.correction_note) > 500) fail('invalid_seed', 'A correction note is longer than 500 characters.');
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
  const retiredPost = retiredSerials(data, 'p');
  for (const accountId of new Set([...Object.keys(maxPost), ...Object.keys(retiredPost), ...Object.keys(data.counters)])) {
    if (!data.counters[accountId]) continue;
    const explained = Math.max(maxPost[accountId] || 0, retiredPost[accountId] || 0);
    if (data.counters[accountId].post !== explained) fail('invalid_seed', 'The post counter does not match the stored and retired ids.');
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
  const retiredNote = retiredSerials(data, 'n');
  for (const accountId of new Set([...Object.keys(maxNote), ...Object.keys(retiredNote), ...Object.keys(data.counters)])) {
    if (!data.counters[accountId]) continue;
    const explained = Math.max(maxNote[accountId] || 0, retiredNote[accountId] || 0);
    if (data.counters[accountId].note !== explained) fail('invalid_seed', 'The note counter does not match the stored and retired ids.');
  }
  for (const edge of data.follows) {
    if (!accountIds.has(edge.follower_account_id) || !accountIds.has(edge.target_account_id)) fail('invalid_seed', 'A follow edge names a missing account.');
    if (edge.follower_account_id === edge.target_account_id) fail('invalid_seed', 'An account cannot follow itself.');
  }
  for (const block of data.blocks) {
    if (!accountIds.has(block.account_id) || !accountIds.has(block.target_account_id)) fail('invalid_seed', 'A block names a missing account.');
  }
  const receiptIds = new Set();
  const published = new Set();
  for (const receipt of data.receipts) {
    if (receiptIds.has(receipt.receipt_id) || !/^pr-\d+$/.test(receipt.receipt_id)) fail('invalid_seed', 'Receipt ids must be unique.');
    receiptIds.add(receipt.receipt_id);
    const key = receipt.object_type + '\0' + receipt.object_id + '\0' + receipt.revision;
    if (published.has(key)) fail('invalid_seed', 'Two receipts name the same publication.');
    published.add(key);
    if (receipt.object_type === 'post') {
      const post = data.posts.find(item => item.id === receipt.object_id);
      const row = post && post.revisions.find(item => item.revision === receipt.revision);
      if (!row || row.visibility !== 'public') fail('invalid_seed', 'A receipt names a revision that is not public.');
    } else if (receipt.object_type === 'note') {
      const note = data.notes.find(item => item.id === receipt.object_id);
      if (!note || receipt.revision !== note.revision || (note.status !== 'posted' && note.status !== 'deleted')) {
        fail('invalid_seed', 'A receipt names a note that is not public.');
      }
    } else fail('invalid_seed', 'A receipt names an unknown object type.');
    instant(receipt.published_at, 'invalid_seed');
  }
  for (const post of data.posts) {
    if (post.status === 'published' || post.status === 'unpublished') {
      const row = post.revisions.find(item => item.revision === post.public_revision);
      if (!post.public_revision || !row || row.visibility !== 'public') fail('invalid_seed', 'The public revision is not public.');
    }
    for (const row of post.revisions) {
      if (row.visibility !== 'public') continue;
      if (!published.has('post\0' + post.id + '\0' + row.revision)) fail('invalid_seed', 'A public revision has no receipt.');
    }
  }
  for (const note of data.notes) {
    if (note.status !== 'posted' && note.status !== 'deleted') continue;
    if (!published.has('note\0' + note.id + '\0' + note.revision)) fail('invalid_seed', 'A public note has no receipt.');
  }
  const media = data.media || [];
  const counts = {avatar: 0, cover: 0, note: 0};
  for (const asset of media) {
    const limit = MEDIA_LIMITS[asset.role];
    if (!limit) fail('invalid_seed', 'Media role is invalid.');
    counts[asset.role] += 1;
    if (counts[asset.role] > limit.count) fail('invalid_seed', 'Too many ' + asset.role + ' images.');
    if (asset.mime !== limit.mime || asset.byte_length < 1) fail('invalid_seed', 'A media file does not match its role.');
    if (asset.bytes_base64) {
      const bytes = Buffer.from(asset.bytes_base64, 'base64');
      const info = imageSize(bytes);
      if (!info || info.mime !== asset.mime || bytes.length !== asset.byte_length || info.width !== asset.width || info.height !== asset.height) {
        fail('invalid_seed', 'A media file does not match its bytes.');
      }
    } else if (asset.byte_length) fail('invalid_seed', 'A media descriptor has no bytes.');
    if (limit.width && (asset.width !== limit.width || asset.height !== limit.height)) fail('invalid_seed', 'An avatar must be 128 by 128.');
  }
  if (data.minimum_load_clock) {
    const minimum = instant(data.minimum_load_clock, 'invalid_seed');
    const loaded = instant(ctx.virtual_now || data.seed_clock, 'invalid_seed');
    if (loaded < minimum) fail('invalid_seed', 'The load clock is before the documented minimum.');
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

function retiredSerials(data, mark) {
  const high = {};
  for (const id of data.retired_ids || []) {
    const accountId = data.accounts.map(item => item.account_id).find(item => serialNumber(id, item, mark) !== null);
    if (!accountId) continue;
    const number = serialNumber(id, accountId, mark);
    if (mark === 'p' && data.posts.some(item => item.id === id)) fail('invalid_seed', 'A retired id is still stored.');
    if (mark === 'n' && data.notes.some(item => item.id === id)) fail('invalid_seed', 'A retired id is still stored.');
    high[accountId] = Math.max(high[accountId] || 0, number);
  }
  return high;
}

function rows(data) { return [...data.posts, ...data.notes]; }

function assetReferences(data) {
  const refs = [];
  for (const post of data.posts || []) {
    if (post.cover_asset_id) refs.push({asset_id: post.cover_asset_id, object_id: post.id, object_type: 'post'});
  }
  for (const note of data.notes || []) {
    if (note.image_asset_id) refs.push({asset_id: note.image_asset_id, object_id: note.id, object_type: 'note'});
  }
  return refs;
}

module.exports = {
  validateSeed,
  records: data => rows(data),
  objects: data => rows(data).map(item => item.id),
  references: () => [],
  assetReferences
};
