'use strict';
const {
  fail, nfc, instant, accountById, accountByHandle, self, confirms, followersOf, publicUrl, noteUrl,
  nextSerial, nextReceipt, tagsOf, requireText, requireSlug, chars, fold
} = require('./common.cjs');
const {subjectHits, parseLinks, mentions} = require('./subjects.cjs');
const {imageSize} = require('./images.cjs');
const MEDIA_LIMITS = {
  avatar: {mime: 'image/png', width: 128, height: 128, bytes: 15 * 1024},
  cover: {mime: 'image/jpeg', bytes: 80 * 1024},
  note: {mime: 'image/jpeg', bytes: 60 * 1024}
};

function touch(ctx, item) {
  if (instant(ctx.virtual_now) < instant(item.updated_at, 'invalid_time')) {
    fail('invalid_time', 'The run clock must not precede the last record update.');
  }
  item.updated_at = ctx.virtual_now;
}

function revision(post, number) {
  return post.revisions.find(item => item.revision === number) || null;
}

function head(post) { return revision(post, post.head_revision); }

function reservedSlug(post) {
  if (!post.pending) return null;
  const held = revision(post, post.pending.revision);
  return held && held.visibility === 'pending' ? held.slug : null;
}

function slugFree(data, accountId, slug, exceptId) {
  return !data.posts.some(post => {
    if (post.account_id !== accountId || post.id === exceptId) return false;
    return post.slug === slug || reservedSlug(post) === slug;
  });
}

function bindId(args, field) {
  if (args.id !== undefined && args[field] !== undefined && args.id !== args[field]) {
    fail('invalid_arguments', 'id must match ' + field + '.');
  }
  if (args[field] === undefined) args[field] = args.id;
  if (args[field] === undefined) fail('invalid_arguments', field + ' is required.');
}

function ownPost(data, id) {
  const post = data.posts.find(item => item.id === id);
  if (!post || post.account_id !== data.account_id) fail('not_found', 'Post does not exist in this account.');
  return post;
}

function findNote(data, id) { return data.notes.find(item => item.id === id) || null; }

function ownNote(data, id) {
  const note = findNote(data, id);
  if (!note || note.account_id !== data.account_id) fail('not_found', 'Note does not exist in this account.');
  return note;
}

function blankRevision(number, fields, now, requestId, visibility) {
  return {
    revision: number,
    title: fields.title,
    body: fields.body,
    tags: fields.tags,
    slug: fields.slug,
    correction_note: fields.correction_note || null,
    created_at: now,
    request_id: requestId || null,
    visibility
  };
}

function appendRevision(post, fields, now, requestId, visibility) {
  const number = post.head_revision + 1;
  post.revisions.push(blankRevision(number, fields, now, requestId, visibility));
  post.head_revision = number;
  return number;
}

function fieldsFrom(row) {
  return {title: row.title, body: row.body, tags: [...row.tags], slug: row.slug, correction_note: null};
}

function addReceipt(data, fields) {
  const receipt = {
    receipt_id: nextReceipt(data),
    object_type: fields.object_type,
    object_id: fields.object_id,
    revision: fields.revision,
    published_at: fields.published_at,
    public_url: fields.public_url,
    request_id: fields.request_id || null,
    event_id: fields.event_id || null,
    followers_at_publish: fields.followers_at_publish === undefined ? null : fields.followers_at_publish
  };
  data.receipts.push(receipt);
  return receipt;
}

function hoursBetween(start, end) {
  const ms = instant(end, 'invalid_time') - instant(start, 'invalid_time');
  return ms > 0 ? ms / 3600000 : 0;
}

function repostReach(data, objectType, objectId, end, start) {
  let sum = 0;
  const endMs = instant(end, 'invalid_time');
  const startMs = start ? instant(start, 'invalid_time') : null;
  for (const note of data.notes) {
    if (note.kind !== 'repost' || !note.repost_of || !note.published_at) continue;
    if (note.status !== 'posted' && note.status !== 'deleted') continue;
    if (note.repost_of.object_type !== objectType || note.repost_of.object_id !== objectId) continue;
    const published = instant(note.published_at, 'invalid_time');
    if (published > endMs) continue;
    if (startMs !== null && published < startMs) continue;
    if (note.deleted_at && instant(note.deleted_at, 'invalid_time') <= endMs) continue;
    sum += note.followers_at_publish || 0;
  }
  return sum;
}

function reachOf(data, now, item, objectType) {
  if (objectType === 'post' && item.exposures && item.exposures.length) {
    const open = [...item.exposures].reverse().find(row => row.end === null);
    if (open) return exposureReach(data, item, open, now);
    const closed = [...item.exposures].reverse().find(row => row.reach_at_end !== null && row.reach_at_end !== undefined);
    if (closed) return closed.reach_at_end;
  }
  if (!item.published_at || item.followers_at_publish === null || item.followers_at_publish === undefined) return 0;
  const end = item.unpublished_at || item.deleted_at || now;
  const hours = hoursBetween(item.published_at, end);
  const extra = repostReach(data, objectType, item.id, end);
  const grown = item.followers_at_publish + extra + Math.floor(data.settings.audience_rate_per_hour * hours);
  return Math.min(data.settings.audience_cap, grown);
}

function exposureReach(data, post, exposure, end) {
  const hours = hoursBetween(exposure.start, end);
  const extra = repostReach(data, 'post', post.id, end, exposure.start);
  const grown = exposure.followers_at_publish + extra + Math.floor(data.settings.audience_rate_per_hour * hours);
  return Math.min(data.settings.audience_cap, grown);
}

function revisionReach(data, now, post, revisionNumber) {
  const rows = (post.exposures || []).filter(item => item.revision === revisionNumber);
  if (rows.length) {
    const open = rows.find(item => item.end === null);
    if (open) return exposureReach(data, post, open, now);
    return rows[rows.length - 1].reach_at_end || 0;
  }
  const receipts = data.receipts.filter(item => item.object_type === 'post' && item.object_id === post.id);
  const receipt = receipts.find(item => item.revision === revisionNumber);
  if (!receipt) return 0;
  const start = receipt.published_at;
  let end = post.unpublished_at || now;
  for (const later of receipts) {
    if (later.revision <= revisionNumber) continue;
    const laterAt = instant(later.published_at, 'invalid_time');
    if (laterAt < instant(start, 'invalid_time')) continue;
    if (laterAt <= instant(end, 'invalid_time')) end = later.published_at;
  }
  const hours = hoursBetween(start, end);
  const extra = repostReach(data, 'post', post.id, end, start);
  const base = receipt.followers_at_publish === undefined || receipt.followers_at_publish === null
    ? (post.followers_at_publish || 0)
    : receipt.followers_at_publish;
  return Math.min(data.settings.audience_cap, base + extra + Math.floor(data.settings.audience_rate_per_hour * hours));
}

function viewFromBytes(id, role, bytes, declaredMime) {
  const info = imageSize(bytes);
  const limit = MEDIA_LIMITS[role];
  if (!info || !limit || (declaredMime && info.mime !== declaredMime) || info.mime !== limit.mime) return {asset_id: id, status: 'asset_missing'};
  const view = {asset_id: id, mime: info.mime, width: info.width, height: info.height, byte_length: bytes.length};
  if (bytes.length > limit.bytes || (limit.width && (info.width !== limit.width || info.height !== limit.height))) {
    return {...view, status: 'too_large'};
  }
  return {...view, status: 'ready'};
}

function mediaView(data, ctx, id, role) {
  if (!id) return null;
  if (ctx && ctx.assets && typeof ctx.assets.read === 'function') {
    try {
      const file = ctx.assets.read(id);
      return viewFromBytes(id, role, Buffer.from(file.base64, 'base64'), file.mime_type);
    } catch (error) {
      if (error && (error.code === 'not_available' || error.code === 'unavailable')) return {asset_id: id, status: 'asset_missing'};
      throw error;
    }
  }
  const asset = (data.media || []).find(item => item.asset_id === id && item.role === role);
  if (!asset || typeof asset.bytes_base64 !== 'string') return {asset_id: id, status: 'asset_missing'};
  const bytes = Buffer.from(asset.bytes_base64, 'base64');
  if (bytes.length !== asset.byte_length) return {asset_id: id, status: 'asset_missing'};
  return viewFromBytes(id, role, bytes, asset.mime);
}

function coverOf(data, ctx, post) {
  return mediaView(data, ctx, post.cover_asset_id, 'cover');
}

function closeExposures(data, post, end, endedBy) {
  post.exposures = post.exposures || [];
  for (const item of post.exposures) {
    if (item.end !== null) continue;
    item.end = end;
    item.ended_by = endedBy;
    item.reach_at_end = exposureReach(data, post, item, end);
  }
}

function openExposure(post, revisionNumber, start, followers) {
  post.exposures = post.exposures || [];
  post.exposures.push({
    revision: revisionNumber, start, end: null, followers_at_publish: followers, reach_at_end: null, ended_by: null
  });
}

function dueOf(item, now) {
  if (!item.publish_at || instant(item.publish_at, 'invalid_time') > instant(now, 'invalid_time')) return false;
  if (item.status === 'scheduled') return true;
  if (item.status === 'pending_owner_confirmation' && item.pending && item.pending.kind === 'schedule') return true;
  return item.status === 'pending_owner_confirmation' && item.pending_kind === 'schedule';
}

function makePostPublic(data, ctx, post, number, requestId, eventId) {
  const row = revision(post, number);
  if (!row) fail('revision_mismatch', 'That revision is not on this post.');
  row.visibility = 'public';
  post.slug = row.slug;
  if (!(post.exposures || []).some(item => item.revision === post.public_revision) && post.public_revision && post.public_revision !== number && post.published_at) {
    const prior = [...data.receipts].reverse().find(item => item.object_type === 'post' && item.object_id === post.id && item.revision === post.public_revision);
    const priorFollowers = prior && prior.followers_at_publish !== null && prior.followers_at_publish !== undefined
      ? prior.followers_at_publish
      : (post.followers_at_publish || 0);
    openExposure(post, post.public_revision, prior ? prior.published_at : post.published_at, priorFollowers);
  }
  closeExposures(data, post, ctx.virtual_now, 'revision');
  const followers = followersOf(data, post.account_id);
  post.public_revision = number;
  post.status = 'published';
  post.pending = null;
  post.publish_at = null;
  if (!post.published_at) {
    post.published_at = ctx.virtual_now;
    post.followers_at_publish = followers;
  }
  post.unpublished_at = null;
  openExposure(post, number, ctx.virtual_now, followers);
  touch(ctx, post);
  const account = accountById(data, post.account_id);
  return addReceipt(data, {
    object_type: 'post', object_id: post.id, revision: number,
    published_at: ctx.virtual_now, public_url: publicUrl(account, row.slug),
    request_id: requestId, event_id: eventId, followers_at_publish: followers
  });
}

function publishNote(data, ctx, note, requestId, eventId) {
  note.status = 'posted';
  note.pending_kind = null;
  if (!note.published_at) {
    note.published_at = ctx.virtual_now;
    note.followers_at_publish = followersOf(data, note.account_id);
  }
  note.deleted_at = null;
  touch(ctx, note);
  const account = accountById(data, note.account_id);
  return addReceipt(data, {
    object_type: 'note', object_id: note.id, revision: 1,
    published_at: ctx.virtual_now, public_url: noteUrl(account, note.id),
    request_id: requestId, event_id: eventId, followers_at_publish: note.followers_at_publish
  });
}

function releaseLag(scheduledFor, at) {
  return Math.round((instant(at, 'invalid_event') - instant(scheduledFor, 'invalid_event')) / 1000);
}

function releasePost(data, ctx, post, event) {
  const number = post.public_revision || post.head_revision;
  post.scheduled_for = post.publish_at;
  post.release_lag_seconds = releaseLag(post.scheduled_for, ctx.virtual_now);
  const requestId = post.schedule_request_id;
  return makePostPublic(data, ctx, post, number, requestId, event.event_id);
}

function releaseNote(data, ctx, note, event) {
  note.scheduled_for = note.publish_at;
  note.release_lag_seconds = releaseLag(note.scheduled_for, ctx.virtual_now);
  const requestId = note.schedule_request_id;
  note.publish_at = null;
  return publishNote(data, ctx, note, requestId, event.event_id);
}

function createDraft(data, ctx, args) {
  const title = requireText(args.title, 200, 'Title');
  const body = requireText(args.body, 20000, 'Body');
  const slug = requireSlug(args.slug);
  const tagList = tagsOf(args.tags);
  if (!slugFree(data, data.account_id, slug, null)) fail('slug_taken', 'That slug is already used on this account.');
  const now = ctx.virtual_now;
  const id = nextSerial(data, data.account_id, 'post');
  const post = {
    id, account_id: data.account_id, slug, status: 'draft',
    public_revision: null, head_revision: 1,
    revisions: [blankRevision(1, {title, body, tags: tagList, slug, correction_note: null}, now, args.request_id, 'private')],
    pending: null, publish_at: null, scheduled_for: null, published_at: null, unpublished_at: null,
    release_lag_seconds: null, followers_at_publish: null, owner_note: null, schedule_request_id: null,
    cover_asset_id: args.cover_asset_id || null, resolution_code: null,
    superseded: [], exposures: [],
    created_at: now, updated_at: now
  };
  data.posts.push(post);
  return {id, revision: 1, record_status: 'draft'};
}

function updateDraft(data, ctx, args) {
  bindId(args, 'post_id');
  const post = ownPost(data, args.post_id);
  const pendingEdit = post.status === 'published' && post.pending && post.pending.kind === 'edit';
  const waiting = post.status === 'pending_owner_confirmation';
  if (post.status !== 'draft' && !waiting && !pendingEdit) {
    fail('already_published', 'A published post is changed with blog.edit_published.');
  }
  const fields = fieldsFrom(head(post));
  if (args.title !== undefined) fields.title = requireText(args.title, 200, 'Title');
  if (args.body !== undefined) fields.body = requireText(args.body, 20000, 'Body');
  if (args.slug !== undefined) fields.slug = requireSlug(args.slug);
  if (args.tags !== undefined) fields.tags = tagsOf(args.tags);
  if (!slugFree(data, data.account_id, fields.slug, post.id)) fail('slug_taken', 'That slug is already used on this account.');
  if (post.pending) {
    const held = revision(post, post.pending.revision);
    if (held && held.visibility === 'pending') held.visibility = 'withheld';
    post.superseded = post.superseded || [];
    post.superseded.push(post.pending.revision);
    post.pending = null;
    post.publish_at = waiting ? null : post.publish_at;
    post.schedule_request_id = null;
  }
  const number = appendRevision(post, fields, ctx.virtual_now, args.request_id, 'private');
  if (waiting || post.status === 'draft') {
    post.status = 'draft';
    post.slug = fields.slug;
  }
  post.owner_note = null;
  touch(ctx, post);
  return {id: post.id, revision: number, record_status: post.status};
}

function deleteDraft(data, ctx, args) {
  bindId(args, 'post_id');
  const post = ownPost(data, args.post_id);
  if (post.public_revision || post.status === 'published' || post.status === 'unpublished') {
    fail('already_published', 'A public post is removed with blog.unpublish.');
  }
  if (post.status === 'scheduled') fail('invalid_arguments', 'Unschedule the post before deleting it.');
  data.retired_ids = data.retired_ids || [];
  data.retired_ids.push(post.id);
  data.posts = data.posts.filter(item => item.id !== post.id);
  return {id: post.id, record_status: 'deleted'};
}

function assertHead(post, number) {
  if (!Number.isInteger(number) || number !== post.head_revision || !revision(post, number)) {
    fail('revision_mismatch', 'That revision is not the current revision.');
  }
}

function publish(data, ctx, args) {
  bindId(args, 'post_id');
  const post = ownPost(data, args.post_id);
  if (post.status === 'published') fail('already_published', 'That post is already public. A correction uses blog.edit_published.');
  if (post.status === 'scheduled') fail('invalid_arguments', 'Unschedule the post before publishing it directly.');
  if (post.status !== 'draft' && post.status !== 'unpublished') fail('invalid_arguments', 'Publish starts from a draft or an unpublished post.');
  if (post.pending) fail('invalid_arguments', 'Resolve the pending revision before publishing again.');
  assertHead(post, args.revision);
  const row = revision(post, args.revision);
  if (row.visibility === 'public') fail('already_published', 'That revision is already public.');
  if (confirms(data)) {
    row.visibility = 'pending';
    post.status = 'pending_owner_confirmation';
    post.pending = {kind: 'publish', revision: args.revision, request_id: args.request_id, publish_at: null};
    post.schedule_request_id = null;
    touch(ctx, post);
    return {id: post.id, revision: args.revision, record_status: 'pending_owner_confirmation'};
  }
  const receipt = makePostPublic(data, ctx, post, args.revision, args.request_id, null);
  return {id: post.id, revision: args.revision, record_status: 'published', receipt_id: receipt.receipt_id};
}

function schedule(data, ctx, args) {
  bindId(args, 'post_id');
  const post = ownPost(data, args.post_id);
  assertHead(post, args.revision);
  if (typeof args.publish_at !== 'string') fail('invalid_arguments', 'publish_at is required.');
  if (instant(args.publish_at) <= instant(ctx.virtual_now)) fail('schedule_in_past', 'publish_at must be later than the current virtual time.');
  if (post.status === 'published') fail('already_published', 'That revision is already public.');
  if (post.status !== 'draft') fail('invalid_arguments', 'Only a draft can be scheduled.');
  if (post.pending) fail('invalid_arguments', 'Resolve the pending revision before scheduling again.');
  const row = revision(post, args.revision);
  post.publish_at = args.publish_at;
  post.schedule_request_id = args.request_id;
  if (confirms(data)) {
    row.visibility = 'pending';
    post.status = 'pending_owner_confirmation';
    post.pending = {kind: 'schedule', revision: args.revision, request_id: args.request_id, publish_at: args.publish_at};
    touch(ctx, post);
    return {id: post.id, revision: args.revision, record_status: 'pending_owner_confirmation', publish_at: args.publish_at};
  }
  row.visibility = 'private';
  post.status = 'scheduled';
  post.pending = null;
  touch(ctx, post);
  return {id: post.id, revision: args.revision, record_status: 'scheduled', publish_at: args.publish_at};
}

function unschedule(data, ctx, args) {
  bindId(args, 'post_id');
  const post = ownPost(data, args.post_id);
  const waitingSchedule = post.pending && post.pending.kind === 'schedule';
  if (post.status !== 'scheduled' && !waitingSchedule) fail('not_scheduled', 'That post is not scheduled.');
  if (post.pending) {
    const held = revision(post, post.pending.revision);
    if (held) held.visibility = 'private';
  }
  post.pending = null;
  post.publish_at = null;
  post.schedule_request_id = null;
  post.status = post.public_revision ? 'published' : 'draft';
  touch(ctx, post);
  return {id: post.id, record_status: post.status};
}

function editPublished(data, ctx, args) {
  bindId(args, 'post_id');
  const post = ownPost(data, args.post_id);
  if ((post.status !== 'published' && post.status !== 'unpublished') || !post.public_revision) fail('not_published', 'That post is not public.');
  if (!Number.isInteger(args.base_revision) || args.base_revision !== post.public_revision) {
    fail('revision_mismatch', 'base_revision is not the current public revision.');
  }
  if (post.pending) fail('invalid_arguments', 'Resolve the pending revision before editing again.');
  const base = revision(post, args.base_revision);
  if (!base || base.visibility !== 'public') fail('revision_mismatch', 'base_revision is not the current public revision.');
  const fields = fieldsFrom(base);
  if (args.title !== undefined) fields.title = requireText(args.title, 200, 'Title');
  if (args.body !== undefined) fields.body = requireText(args.body, 20000, 'Body');
  if (args.slug !== undefined) fields.slug = requireSlug(args.slug);
  if (args.tags !== undefined) fields.tags = tagsOf(args.tags);
  if (args.correction_note !== undefined && args.correction_note !== null) {
    if (typeof args.correction_note !== 'string' || chars(args.correction_note) > 500) fail('invalid_arguments', 'correction_note is too long.');
    fields.correction_note = args.correction_note ? nfc(args.correction_note) : null;
  }
  if (!slugFree(data, data.account_id, fields.slug, post.id)) fail('slug_taken', 'That slug is already used on this account.');
  const visibility = confirms(data) ? 'pending' : 'public';
  const number = appendRevision(post, fields, ctx.virtual_now, args.request_id, visibility);
  if (confirms(data)) {
    post.pending = {kind: 'edit', revision: number, request_id: args.request_id, publish_at: null};
    touch(ctx, post);
    return {id: post.id, revision: number, record_status: 'published', pending_revision: number};
  }
  const receipt = makePostPublic(data, ctx, post, number, args.request_id, null);
  return {id: post.id, revision: number, record_status: 'published', receipt_id: receipt.receipt_id};
}

function unpublish(data, ctx, args) {
  bindId(args, 'post_id');
  const post = ownPost(data, args.post_id);
  if (post.status !== 'published') fail('not_published', 'That post is not public.');
  if (post.pending) {
    const held = revision(post, post.pending.revision);
    if (held && held.visibility === 'pending') held.visibility = 'withheld';
    post.pending = null;
  }
  if (!(post.exposures || []).some(item => item.end === null) && post.public_revision && post.published_at) {
    const receipt = [...data.receipts].reverse().find(item => item.object_type === 'post' && item.object_id === post.id && item.revision === post.public_revision);
    const followers = receipt && receipt.followers_at_publish !== null && receipt.followers_at_publish !== undefined
      ? receipt.followers_at_publish
      : (post.followers_at_publish || 0);
    openExposure(post, post.public_revision, receipt ? receipt.published_at : post.published_at, followers);
  }
  closeExposures(data, post, ctx.virtual_now, 'unpublish');
  post.status = 'unpublished';
  post.unpublished_at = ctx.virtual_now;
  touch(ctx, post);
  return {id: post.id, record_status: 'unpublished', unpublished_at: post.unpublished_at};
}

function postText(post, number) {
  const row = revision(post, number) || head(post);
  const parts = [row.title, row.body];
  if (row.correction_note) parts.push(row.correction_note);
  if (row.tags && row.tags.length) parts.push(row.tags.join(' '));
  return parts.join('\n\n');
}

function publicUpdatedAt(data, post) {
  const row = revision(post, post.public_revision);
  if (!row) return post.created_at;
  const receipt = [...data.receipts].reverse().find(item => item.object_type === 'post' && item.object_id === post.id && item.revision === row.revision);
  return receipt ? receipt.published_at : row.created_at;
}

function viewPost(data, ctx, post, audience) {
  const owner = audience !== 'public';
  const shown = revision(post, owner ? (post.public_revision || post.head_revision) : post.public_revision) || (owner ? head(post) : null);
  if (!shown) fail('not_found', 'Post does not exist.');
  const account = accountById(data, post.account_id);
  const view = {
    id: post.id,
    account_id: post.account_id,
    handle: account ? account.handle : null,
    slug: shown.slug,
    title: shown.title,
    body: shown.body,
    tags: [...shown.tags],
    correction_note: shown.correction_note,
    status: owner ? post.status : 'published',
    revision: shown.revision,
    public_revision: post.public_revision,
    published_at: post.published_at,
    reach: reachOf(data, ctx.virtual_now, post, 'post'),
    revision_reach: revisionReach(data, ctx.virtual_now, post, shown.revision),
    public_url: account ? publicUrl(account, shown.slug) : null,
    cover: coverOf(data, ctx, post),
    created_at: post.created_at,
    updated_at: publicUpdatedAt(data, post)
  };
  if (owner) {
    view.head_revision = post.head_revision;
    view.publish_at = post.publish_at;
    view.scheduled_for = post.scheduled_for;
    view.published_at = post.published_at;
    view.unpublished_at = post.unpublished_at;
    view.release_lag_seconds = post.release_lag_seconds;
    view.followers_at_publish = post.followers_at_publish;
    view.due = dueOf(post, ctx.virtual_now);
    view.owner_note = post.owner_note;
    view.pending = post.pending ? copyPending(post.pending) : null;
    view.resolution_code = post.resolution_code || null;
  }
  return view;
}

function copyPending(pending) {
  return {kind: pending.kind, revision: pending.revision, request_id: pending.request_id, publish_at: pending.publish_at};
}

function listPosts(data, ctx, args) {
  let rows = data.posts.filter(post => post.account_id === data.account_id);
  if (args.status) rows = rows.filter(post => post.status === args.status);
  rows.sort((a, b) => instant(b.updated_at, 'invalid_seed') - instant(a.updated_at, 'invalid_seed') || (a.id < b.id ? 1 : -1));
  return page(rows.map(post => viewPost(data, ctx, post, 'owner')), args);
}

function getPost(data, ctx, args) {
  bindId(args, 'post_id');
  const post = data.posts.find(item => item.id === args.post_id);
  if (!post) fail('not_found', 'Post does not exist.');
  const owner = post.account_id === data.account_id;
  if (!owner && post.status !== 'published') fail('not_found', 'Post does not exist.');
  const view = viewPost(data, ctx, post, owner ? 'owner' : 'public');
  const text = postText(post, view.revision);
  const receipts = data.receipts.filter(item => item.object_type === 'post' && item.object_id === post.id);
  return {
    post: view,
    revisions: (owner ? post.revisions : post.revisions.filter(item => item.visibility === 'public')).map(item => ({
      revision: item.revision, title: item.title, body: item.body, tags: [...item.tags],
      slug: item.slug, correction_note: item.correction_note, created_at: item.created_at,
      visibility: item.visibility
    })),
    receipts,
    subjects: subjectHits(data, text, 'blog'),
    links: parseLinks(text)
  };
}

function blocked(data, authorId, actorId) {
  return data.blocks.some(row => row.account_id === authorId && row.target_account_id === actorId);
}

function targetRecord(data, id) {
  const note = findNote(data, id);
  if (note) return {kind: 'note', item: note, author: note.account_id};
  const post = data.posts.find(item => item.id === id);
  if (post) return {kind: 'post', item: post, author: post.account_id};
  return null;
}

function assertReplyTarget(data, id) {
  const target = targetRecord(data, id);
  if (!target) fail('reply_target_deleted', 'The reply target does not exist.');
  if (target.kind === 'note' && target.item.status !== 'posted') fail('reply_target_deleted', 'The reply target is not public.');
  if (target.kind === 'post' && target.item.status !== 'published') fail('not_published', 'The reply target is not public.');
  if (blocked(data, target.author, data.account_id)) fail('blocked_by_author', 'The author has blocked this account.');
  return target;
}

function noteText(value, code) {
  if (typeof value !== 'string' || !value.trim()) fail(code === 'invalid_event' ? 'invalid_event' : 'invalid_arguments', 'Note text is required.');
  if (chars(value) > 500) fail(code, code === 'invalid_event' ? 'Note text is longer than 500 characters.' : 'A note can be at most 500 characters.');
  return nfc(value);
}

function createNote(data, ctx, fields) {
  const id = nextSerial(data, fields.account_id, 'note');
  const now = ctx.virtual_now;
  const note = {
    id, account_id: fields.account_id, kind: fields.kind, text: fields.text, status: fields.status,
    revision: 1, reply_to: fields.reply_to || null, repost_of: fields.repost_of || null,
    publish_at: fields.publish_at || null, scheduled_for: null, published_at: null, deleted_at: null,
    release_lag_seconds: null, followers_at_publish: null, pending_kind: fields.pending_kind || null,
    request_id: fields.request_id || null, event_id: fields.event_id || null,
    schedule_request_id: fields.schedule_request_id || null, owner_note: null,
    links: fields.links || [], mentions: fields.mentions || [], image_asset_id: fields.image_asset_id || null,
    created_at: now, updated_at: now
  };
  data.notes.push(note);
  return note;
}

function noteImageId(data, ctx, note, assetId) {
  if (!assetId) return null;
  if (!ctx || !ctx.assets || typeof ctx.assets.add !== 'function') return assetId;
  const seeded = (data.media || []).find(item => item.asset_id === assetId && typeof item.bytes_base64 === 'string');
  let base64 = null;
  let mime = 'image/jpeg';
  let width = null;
  let height = null;
  if (seeded) {
    const bytes = Buffer.from(seeded.bytes_base64, 'base64');
    base64 = bytes.toString('base64');
    mime = seeded.mime || mime;
    width = seeded.width;
    height = seeded.height;
  } else {
    let file;
    try { file = ctx.assets.read(assetId); }
    catch (error) {
      if (error && (error.code === 'not_available' || error.code === 'unavailable')) fail('invalid_arguments', 'That image is not available for this note.');
      throw error;
    }
    const bytes = Buffer.from(file.base64, 'base64');
    base64 = bytes.toString('base64');
    mime = file.mime_type || mime;
    width = file.media && file.media.image && file.media.image.width;
    height = file.media && file.media.image && file.media.image.height;
  }
  const sha256 = require('node:crypto').createHash('sha256').update(Buffer.from(base64, 'base64')).digest('hex');
  const filename = String(assetId).replace(/[^A-Za-z0-9._-]/g, '') + '.jpg';
  const ids = ctx.assets.add({
    object_type: 'note', object_id: note.id,
    files: [{filename, mime_type: mime, base64, sha256, media: width ? {image: {width, height}} : {}}]
  });
  return ids[0];
}

function postNote(data, ctx, args) {
  const text = noteText(args.text, 'note_too_long');
  const image = args.image_asset_id || null;
  if (confirms(data)) {
    const note = createNote(data, ctx, {
      account_id: data.account_id, kind: 'note', text, status: 'pending_owner_confirmation',
      pending_kind: 'post', request_id: args.request_id, image_asset_id: image
    });
    note.image_asset_id = noteImageId(data, ctx, note, image);
    return {id: note.id, record_status: note.status, revision: 1};
  }
  const note = createNote(data, ctx, {
    account_id: data.account_id, kind: 'note', text, status: 'posted', request_id: args.request_id, image_asset_id: image
  });
  note.image_asset_id = noteImageId(data, ctx, note, image);
  const receipt = publishNote(data, ctx, note, args.request_id, null);
  return {id: note.id, record_status: 'posted', revision: 1, receipt_id: receipt.receipt_id};
}

function replyNote(data, ctx, args) {
  const text = noteText(args.text, 'note_too_long');
  if (typeof args.reply_to !== 'string' || !args.reply_to) fail('invalid_arguments', 'reply_to is required.');
  assertReplyTarget(data, args.reply_to);
  if (confirms(data)) {
    const note = createNote(data, ctx, {
      account_id: data.account_id, kind: 'reply', text, status: 'pending_owner_confirmation',
      reply_to: args.reply_to, pending_kind: 'reply', request_id: args.request_id
    });
    return {id: note.id, record_status: note.status, revision: 1, reply_to: args.reply_to};
  }
  const note = createNote(data, ctx, {
    account_id: data.account_id, kind: 'reply', text, status: 'posted',
    reply_to: args.reply_to, request_id: args.request_id
  });
  const receipt = publishNote(data, ctx, note, args.request_id, null);
  return {id: note.id, record_status: 'posted', revision: 1, reply_to: args.reply_to, receipt_id: receipt.receipt_id};
}

function deleteNote(data, ctx, args) {
  bindId(args, 'note_id');
  const note = ownNote(data, args.note_id);
  if (note.status === 'deleted' || note.status === 'withdrawn') fail('not_found', 'That note is already withdrawn.');
  if (note.status === 'declined') fail('invalid_arguments', 'A declined note stays in history.');
  if (note.status === 'pending_owner_confirmation' || note.status === 'scheduled') {
    note.status = 'withdrawn';
    note.pending_kind = null;
    note.publish_at = null;
    note.schedule_request_id = null;
    touch(ctx, note);
    return {id: note.id, record_status: 'withdrawn'};
  }
  note.status = 'deleted';
  note.deleted_at = ctx.virtual_now;
  note.pending_kind = null;
  touch(ctx, note);
  return {id: note.id, record_status: 'deleted', deleted_at: note.deleted_at};
}

function viewNote(data, ctx, note) {
  const account = accountById(data, note.account_id);
  const view = {
    id: note.id, account_id: note.account_id, handle: account ? account.handle : null,
    kind: note.kind, text: note.text, status: note.status, revision: 1,
    reply_to: note.reply_to, repost_of: note.repost_of, publish_at: note.publish_at,
    scheduled_for: note.scheduled_for, published_at: note.published_at, deleted_at: note.deleted_at,
    release_lag_seconds: note.release_lag_seconds, followers_at_publish: note.followers_at_publish,
    due: dueOf(note, ctx.virtual_now), reach: reachOf(data, ctx.virtual_now, note, 'note'),
    public_url: account ? noteUrl(account, note.id) : null,
    created_at: note.created_at, updated_at: note.updated_at
  };
  if (note.account_id === data.account_id) view.owner_note = note.owner_note;
  if (note.image_asset_id) view.image = mediaView(data, ctx, note.image_asset_id, 'note');
  return view;
}

function addressOf(data, id) {
  const target = targetRecord(data, id);
  return target ? {account_id: target.author, object_id: id, object_type: target.kind} : null;
}

function noteTextForEvidence(note) {
  return note.text;
}

function noteLinks(note) {
  const links = parseLinks(note.text);
  for (const url of note.links || []) {
    for (const link of parseLinks(url)) {
      if (!links.some(item => item.url === link.url)) links.push(link);
    }
  }
  return links;
}

function threadRoot(data, note) {
  let current = note;
  const seen = new Set();
  while (current && current.reply_to && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = findNote(data, current.reply_to);
    if (!parent) break;
    current = parent;
  }
  return current || note;
}

function threadOf(data, ctx, note) {
  const root = threadRoot(data, note);
  const rows = [root];
  let grew = true;
  while (grew) {
    grew = false;
    for (const item of data.notes) {
      if (rows.some(row => row.id === item.id)) continue;
      if (item.reply_to && rows.some(row => row.id === item.reply_to)) {
        rows.push(item);
        grew = true;
      }
    }
  }
  const visible = rows.filter(item => item.account_id === data.account_id || item.status === 'posted' || item.id === note.id);
  visible.sort((a, b) => instant(a.created_at, 'invalid_seed') - instant(b.created_at, 'invalid_seed'));
  return visible.map(item => viewNote(data, ctx, item));
}

function getNote(data, ctx, args) {
  bindId(args, 'note_id');
  const note = findNote(data, args.note_id);
  if (!note) fail('not_found', 'Note does not exist.');
  if (note.account_id !== data.account_id && note.status !== 'posted') fail('not_found', 'Note does not exist.');
  const surface = note.kind === 'reply' ? 'reply_to_subject' : 'note';
  const addressed = note.reply_to ? addressOf(data, note.reply_to) : null;
  const text = noteTextForEvidence(note);
  return {note: viewNote(data, ctx, note), thread: threadOf(data, ctx, note), subjects: subjectHits(data, text, surface, addressed, {links: note.links, mentions: note.mentions}), links: noteLinks(note)};
}

function followedIds(data) {
  const ids = new Set([data.account_id]);
  for (const edge of data.follows) {
    if (edge.ended_at) continue;
    if (edge.follower_account_id === data.account_id) ids.add(edge.target_account_id);
  }
  return ids;
}

function feed(data, ctx, args) {
  const ids = followedIds(data);
  const rows = data.notes.filter(note => note.status === 'posted' && ids.has(note.account_id));
  rows.sort((a, b) => instant(b.published_at || b.created_at, 'invalid_seed') - instant(a.published_at || a.created_at, 'invalid_seed'));
  return page(rows.map(note => viewNote(data, ctx, note)), args);
}

function page(rows, args) {
  const limit = args.limit === undefined ? 50 : args.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail('invalid_arguments', 'limit must be from 1 to 100.');
  const offset = args.cursor ? Number(args.cursor) : 0;
  if (!Number.isInteger(offset) || offset < 0) fail('invalid_arguments', 'cursor is not valid.');
  const items = rows.slice(offset, offset + limit);
  const next = offset + limit < rows.length ? String(offset + limit) : null;
  return {items, next_cursor: next};
}

function resolveAccount(data, args) {
  const account = args.account_id ? accountById(data, args.account_id) : accountByHandle(data, args.handle);
  if (!account) fail('not_found', 'Account does not exist.');
  return account;
}

function peopleGet(data, args) {
  if (!args.account_id && !args.handle) fail('invalid_arguments', 'account_id or handle is required.');
  const account = resolveAccount(data, args);
  return {
    account: {
      account_id: account.account_id, handle: account.handle, display_name: account.display_name,
      bio: account.bio, links: [...account.links], kind: account.kind, person_id: account.person_id,
      follower_count: account.follower_count, following_count: account.following_count
    }
  };
}

function peoplePosts(data, ctx, args) {
  if (!args.account_id && !args.handle) fail('invalid_arguments', 'account_id or handle is required.');
  const account = resolveAccount(data, args);
  const posts = data.posts.filter(post => post.account_id === account.account_id && post.status === 'published')
    .map(post => ({...viewPost(data, ctx, post, 'public'), record_type: 'post', sort_at: post.published_at}));
  const notes = data.notes.filter(note => note.account_id === account.account_id && note.status === 'posted')
    .map(note => ({...viewNote(data, ctx, note), record_type: 'note', sort_at: note.published_at || note.created_at}));
  const rows = [...posts, ...notes].sort((a, b) => instant(b.sort_at, 'invalid_seed') - instant(a.sort_at, 'invalid_seed'));
  return page(rows, args);
}

function pendingPosts(data) {
  return data.posts.filter(post => post.account_id === data.account_id && post.pending);
}
function pendingNotes(data) {
  return data.notes.filter(note => note.account_id === data.account_id && note.status === 'pending_owner_confirmation');
}
function pendingProfiles(data) {
  const account = self(data);
  return account && account.pending_profile ? [account] : [];
}

function assertTargetForm(payload) {
  const selected = payload.select !== undefined;
  const named = payload.object_id !== undefined;
  const numbered = payload.revision !== undefined;
  if (selected && payload.select !== 'only_pending') fail('invalid_event', 'select must be only_pending.');
  if (selected && named) fail('invalid_event', 'Use only_pending or an object id with a revision.');
  if (!selected && !(named && numbered)) fail('invalid_event', 'Name only_pending, or an object id with a revision.');
  if (numbered && !Number.isInteger(payload.revision)) fail('invalid_event', 'revision must be an integer.');
}

function selectPending(data, payload) {
  assertTargetForm(payload);
  const type = payload.object_type;
  if (type !== 'post' && type !== 'note' && type !== 'profile') fail('invalid_event', 'object_type is not supported.');
  if (payload.select === 'only_pending') {
    const rows = type === 'post' ? pendingPosts(data) : type === 'note' ? pendingNotes(data) : pendingProfiles(data);
    if (rows.length === 0) fail('not_pending', 'No pending item of that type.');
    if (rows.length > 1) fail('ambiguous_target', 'More than one pending item of that type.');
    if (payload.revision !== undefined) {
      const pendingRevision = type === 'note' ? 1 : type === 'profile' ? rows[0].pending_profile.revision : rows[0].pending.revision;
      if (payload.revision !== pendingRevision) fail('revision_mismatch', 'Confirmation names a revision other than the pending one.');
    }
    return rows[0];
  }
  if (type === 'post') {
    const post = data.posts.find(item => item.id === payload.object_id);
    if (!post || post.account_id !== data.account_id) fail('invalid_event', 'That post does not exist.');
    return post;
  }
  if (type === 'note') {
    const note = findNote(data, payload.object_id);
    if (!note || note.account_id !== data.account_id) fail('invalid_event', 'That note does not exist.');
    return note;
  }
  const account = self(data);
  if (!account || payload.object_id !== account.account_id) fail('invalid_event', 'That profile does not exist.');
  return account;
}

function supersededRevision(post, revisionNumber) {
  return revisionNumber !== undefined && (post.superseded || []).includes(revisionNumber);
}

function confirmPost(data, ctx, post, payload, event) {
  if (!post.pending) {
    if (supersededRevision(post, payload.revision)) fail('revision_mismatch', 'That revision was replaced before confirmation.');
    fail('not_pending', 'That post is not waiting for confirmation.');
  }
  if (payload.revision !== undefined && payload.revision !== post.pending.revision) {
    fail('revision_mismatch', 'Confirmation names a revision other than the pending one.');
  }
  const chosen = post.pending.revision;
  const requestId = post.pending.request_id;
  const kind = post.pending.kind;
  const row = revision(post, chosen);
  if (row && !slugFree(data, post.account_id, row.slug, post.id)) {
    row.visibility = 'withheld';
    post.pending = null;
    post.status = post.public_revision ? 'published' : 'draft';
    post.resolution_code = 'slug_taken';
    touch(ctx, post);
    return;
  }
  if (kind === 'schedule') {
    if (row) row.visibility = 'private';
    post.pending = null;
    post.status = 'scheduled';
    post.resolution_code = null;
    touch(ctx, post);
    return;
  }
  makePostPublic(data, ctx, post, chosen, requestId, event.event_id);
}

function declinePost(data, ctx, post, payload) {
  if (!post.pending) {
    if (supersededRevision(post, payload.revision)) fail('revision_mismatch', 'That revision was replaced before confirmation.');
    fail('not_pending', 'That post is not waiting for confirmation.');
  }
  if (payload.revision !== undefined && payload.revision !== post.pending.revision) {
    fail('revision_mismatch', 'Decline names a revision other than the pending one.');
  }
  const held = revision(post, post.pending.revision);
  const edit = post.pending.kind === 'edit' && post.public_revision;
  const priorStatus = post.status;
  if (held) held.visibility = edit ? 'withheld' : 'private';
  post.pending = null;
  post.owner_note = payload.note ? nfc(payload.note) : null;
  post.resolution_code = null;
  if (edit) post.status = priorStatus === 'unpublished' ? 'unpublished' : 'published';
  else {
    post.status = 'draft';
    post.publish_at = null;
    post.schedule_request_id = null;
  }
  touch(ctx, post);
}

function assertPublicObject(data, id) {
  const target = targetRecord(data, id);
  if (!target) fail('not_published', 'That object is not public.');
  if (target.kind === 'note' && target.item.status !== 'posted') fail('not_published', 'That note is not public.');
  if (target.kind === 'post' && target.item.status !== 'published') fail('not_published', 'That post is not public.');
  return target;
}

function confirmNote(data, ctx, note, payload, event) {
  if (note.status !== 'pending_owner_confirmation') fail('not_pending', 'That note is not waiting for confirmation.');
  if (payload.revision !== undefined && payload.revision !== 1) fail('revision_mismatch', 'Notes have a single revision.');
  if (note.kind === 'reply') assertReplyTarget(data, note.reply_to);
  if (note.kind === 'repost' && note.repost_of) assertPublicObject(data, note.repost_of.object_id);
  if (note.pending_kind === 'schedule') {
    note.status = 'scheduled';
    note.pending_kind = null;
    touch(ctx, note);
    return;
  }
  publishNote(data, ctx, note, note.request_id, event.event_id);
}

function declineNote(data, ctx, note, payload) {
  if (note.status !== 'pending_owner_confirmation') fail('not_pending', 'That note is not waiting for confirmation.');
  if (payload.revision !== undefined && payload.revision !== 1) fail('revision_mismatch', 'Notes have a single revision.');
  note.status = 'declined';
  note.pending_kind = null;
  note.owner_note = payload.note ? nfc(payload.note) : null;
  touch(ctx, note);
}

function releaseDue(data, ctx, event) {
  const rows = [];
  for (const post of data.posts) {
    if (post.status === 'scheduled' && post.publish_at && instant(post.publish_at, 'invalid_event') <= instant(ctx.virtual_now, 'invalid_event')) {
      rows.push({at: post.publish_at, id: post.id, kind: 'post', item: post});
    }
  }
  for (const note of data.notes) {
    if (note.status === 'scheduled' && note.publish_at && instant(note.publish_at, 'invalid_event') <= instant(ctx.virtual_now, 'invalid_event')) {
      rows.push({at: note.publish_at, id: note.id, kind: 'note', item: note});
    }
  }
  rows.sort((a, b) => instant(a.at, 'invalid_event') - instant(b.at, 'invalid_event') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const row of rows) {
    if (row.kind === 'post') releasePost(data, ctx, row.item, event);
    else releaseNote(data, ctx, row.item, event);
  }
}

function handleSet(text, extra) {
  const names = new Set(mentions(text).map(item => item.toLowerCase()));
  for (const name of extra || []) if (typeof name === 'string' && name) names.add(name.toLowerCase());
  return names;
}

function notifyMention(data, ctx, actorId, objectId, text, extra, eventId) {
  const owner = self(data);
  if (!owner || !handleSet(text, extra).has(owner.handle.toLowerCase())) return;
  data.notifications.push({
    id: 'nt-' + (eventId || objectId), account_id: data.account_id, actor_account_id: actorId,
    kind: 'mention', object_id: objectId, at: ctx.virtual_now, read: false
  });
}

function postByOther(data, ctx, event) {
  const payload = event.payload || {};
  const actor = accountById(data, payload.actor_account_id);
  if (!actor || actor.account_id === data.account_id) fail('invalid_event', 'The actor account is not valid.');
  const text = noteText(payload.text, 'invalid_event');
  const note = createNote(data, ctx, {
    account_id: actor.account_id, kind: 'note', text, status: 'posted', event_id: event.event_id,
    links: Array.isArray(payload.links) ? payload.links.filter(item => typeof item === 'string') : [],
    mentions: Array.isArray(payload.mentions) ? payload.mentions.filter(item => typeof item === 'string' && item) : []
  });
  publishNote(data, ctx, note, null, event.event_id);
  notifyMention(data, ctx, actor.account_id, note.id, text, payload.mentions, event.event_id);
}

function scheduleNote(data, ctx, args) {
  const text = noteText(args.text, 'note_too_long');
  if (typeof args.publish_at !== 'string') fail('invalid_arguments', 'publish_at is required.');
  if (instant(args.publish_at) <= instant(ctx.virtual_now)) fail('schedule_in_past', 'publish_at must be later than the current virtual time.');
  const note = createNote(data, ctx, {
    account_id: data.account_id, kind: 'note', text,
    status: confirms(data) ? 'pending_owner_confirmation' : 'scheduled',
    pending_kind: confirms(data) ? 'schedule' : null,
    publish_at: args.publish_at, request_id: args.request_id, schedule_request_id: args.request_id,
    image_asset_id: args.image_asset_id || null
  });
  note.image_asset_id = noteImageId(data, ctx, note, args.image_asset_id || null);
  return {id: note.id, record_status: note.status, revision: 1, publish_at: args.publish_at};
}

function repostNote(data, ctx, args) {
  const text = noteText(args.text, 'note_too_long');
  if (typeof args.object_id !== 'string' || !args.object_id) fail('invalid_arguments', 'object_id is required.');
  const target = targetRecord(data, args.object_id);
  if (!target) fail('not_found', 'That object does not exist.');
  if (target.kind === 'note' && target.item.status !== 'posted') fail('not_published', 'That note is not public.');
  if (target.kind === 'post' && target.item.status !== 'published') fail('not_published', 'That post is not public.');
  const repostOf = {object_type: target.kind, object_id: args.object_id};
  if (confirms(data)) {
    const note = createNote(data, ctx, {
      account_id: data.account_id, kind: 'repost', text, status: 'pending_owner_confirmation',
      repost_of: repostOf, pending_kind: 'repost', request_id: args.request_id
    });
    return {id: note.id, record_status: note.status, revision: 1, repost_of: repostOf};
  }
  const note = createNote(data, ctx, {
    account_id: data.account_id, kind: 'repost', text, status: 'posted',
    repost_of: repostOf, request_id: args.request_id
  });
  const receipt = publishNote(data, ctx, note, args.request_id, null);
  return {id: note.id, record_status: 'posted', revision: 1, repost_of: repostOf, receipt_id: receipt.receipt_id};
}

function searchNotes(data, ctx, args) {
  if (typeof args.query !== 'string' || !fold(args.query)) fail('invalid_arguments', 'query is required.');
  const needle = fold(args.query);
  const rows = data.notes.filter(note => {
    const visible = note.account_id === data.account_id || note.status === 'posted';
    return visible && note.status !== 'deleted' && note.status !== 'declined' && fold(note.text).includes(needle);
  });
  rows.sort((a, b) => instant(b.created_at, 'invalid_seed') - instant(a.created_at, 'invalid_seed'));
  return page(rows.map(note => viewNote(data, ctx, note)), args);
}

function publicAccount(account) {
  return {
    account_id: account.account_id, handle: account.handle, display_name: account.display_name,
    bio: account.bio, links: [...account.links], kind: account.kind, person_id: account.person_id,
    follower_count: account.follower_count, following_count: account.following_count
  };
}

function searchPeople(data, args) {
  if (typeof args.query !== 'string' || !fold(args.query)) fail('invalid_arguments', 'query is required.');
  const needle = fold(args.query);
  const accounts = data.accounts.filter(account => fold(account.handle).includes(needle) || fold(account.display_name).includes(needle));
  return {accounts: accounts.map(publicAccount)};
}

function activeFollow(data, follower, target) {
  return data.follows.find(edge => edge.follower_account_id === follower && edge.target_account_id === target && !edge.ended_at) || null;
}

function followAccount(data, ctx, args) {
  const account = resolveAccount(data, args);
  if (account.account_id === data.account_id) fail('cannot_follow_self', 'An account cannot follow itself.');
  if (activeFollow(data, data.account_id, account.account_id)) fail('already_following', 'That account is already followed.');
  data.follows.push({follower_account_id: data.account_id, target_account_id: account.account_id, at: ctx.virtual_now, request_id: args.request_id, ended_at: null, unfollow_request_id: null});
  account.follower_count += 1;
  self(data).following_count += 1;
  return {account_id: account.account_id, record_status: 'following'};
}

function unfollowAccount(data, ctx, args) {
  const account = resolveAccount(data, args);
  const edge = activeFollow(data, data.account_id, account.account_id);
  if (!edge) fail('not_following', 'That account is not followed.');
  edge.ended_at = ctx.virtual_now;
  edge.unfollow_request_id = args.request_id || null;
  account.follower_count = Math.max(0, account.follower_count - 1);
  self(data).following_count = Math.max(0, self(data).following_count - 1);
  return {account_id: account.account_id, record_status: 'unfollowed'};
}

function blockAccount(data, ctx, args) {
  const account = resolveAccount(data, args);
  if (account.account_id === data.account_id) fail('invalid_arguments', 'An account cannot block itself.');
  const exists = data.blocks.some(row => row.account_id === data.account_id && row.target_account_id === account.account_id);
  if (exists) fail('invalid_arguments', 'That account is already blocked.');
  data.blocks.push({account_id: data.account_id, target_account_id: account.account_id, at: ctx.virtual_now});
  return {account_id: account.account_id, record_status: 'blocked'};
}

function unblockAccount(data, args) {
  const account = resolveAccount(data, args);
  const exists = data.blocks.some(row => row.account_id === data.account_id && row.target_account_id === account.account_id);
  if (!exists) fail('not_found', 'That account is not blocked.');
  data.blocks = data.blocks.filter(row => !(row.account_id === data.account_id && row.target_account_id === account.account_id));
  return {account_id: account.account_id, record_status: 'unblocked'};
}

function updateSelf(data, ctx, args) {
  const account = self(data);
  const displayName = args.display_name === undefined ? account.display_name : requireText(args.display_name, 80, 'Name');
  const bio = args.bio === undefined ? account.bio : nfc(String(args.bio));
  if (chars(bio) > 500) fail('invalid_arguments', 'bio is too long.');
  const links = args.links === undefined ? [...account.links] : args.links;
  if (!Array.isArray(links) || links.length > 8 || links.some(item => typeof item !== 'string' || !item || chars(item) > 200)) {
    fail('invalid_arguments', 'links are invalid.');
  }
  if (confirms(data)) {
    const revision = profileCeiling(account) + 1;
    account.retired_profile_revisions = account.retired_profile_revisions || [];
    if (account.pending_profile) account.retired_profile_revisions.push(account.pending_profile.revision);
    account.profile_revision_high = revision;
    account.pending_profile = {revision, request_id: args.request_id, display_name: displayName, bio, links: [...links]};
    return {record_status: 'pending_owner_confirmation', revision};
  }
  account.display_name = displayName;
  account.bio = bio;
  account.links = [...links];
  account.profile_revision = profileCeiling(account) + 1;
  account.profile_revision_high = account.profile_revision;
  account.pending_profile = null;
  return {record_status: 'updated', revision: account.profile_revision};
}

function profileCeiling(account) {
  let high = account.profile_revision_high || 0;
  high = Math.max(high, account.profile_revision || 1);
  if (account.pending_profile) high = Math.max(high, account.pending_profile.revision || 0);
  for (const number of account.retired_profile_revisions || []) high = Math.max(high, number || 0);
  return high;
}

function profileWasPending(account, revisionNumber) {
  if (revisionNumber === undefined) return false;
  const retired = account.retired_profile_revisions || [];
  if (retired.includes(revisionNumber)) return true;
  const high = account.profile_revision_high || 0;
  const published = account.profile_revision || 1;
  return revisionNumber > published && revisionNumber <= high;
}

function confirmProfile(data, ctx, account, payload) {
  if (!account.pending_profile) {
    if (profileWasPending(account, payload.revision)) fail('revision_mismatch', 'That profile revision was replaced.');
    fail('not_pending', 'No pending profile revision.');
  }
  if (payload.revision !== undefined && payload.revision !== account.pending_profile.revision) {
    fail('revision_mismatch', 'Confirmation names a revision other than the pending one.');
  }
  const pending = account.pending_profile;
  account.display_name = pending.display_name;
  account.bio = pending.bio;
  account.links = [...pending.links];
  account.profile_revision = pending.revision;
  account.pending_profile = null;
}

function declineProfile(data, ctx, account, payload) {
  if (!account.pending_profile) {
    if (profileWasPending(account, payload.revision)) fail('revision_mismatch', 'That profile revision was replaced.');
    fail('not_pending', 'No pending profile revision.');
  }
  if (payload.revision !== undefined && payload.revision !== account.pending_profile.revision) {
    fail('revision_mismatch', 'Decline names a revision other than the pending one.');
  }
  account.retired_profile_revisions = account.retired_profile_revisions || [];
  account.retired_profile_revisions.push(account.pending_profile.revision);
  account.pending_profile = null;
  account.owner_note = payload.note ? nfc(payload.note) : null;
}

function listNotifications(data, args) {
  const rows = data.notifications.filter(item => item.account_id === data.account_id);
  rows.sort((a, b) => instant(b.at, 'invalid_seed') - instant(a.at, 'invalid_seed'));
  return page(rows, args);
}

function markRead(data, args) {
  bindId(args, 'notification_id');
  const item = data.notifications.find(row => row.id === args.notification_id && row.account_id === data.account_id);
  if (!item) fail('not_found', 'Notification does not exist.');
  item.read = true;
  return {id: item.id, read: true, record_status: 'read'};
}

function otherActor(data, payload) {
  const actor = accountById(data, payload.actor_account_id);
  if (!actor || actor.account_id === data.account_id) fail('invalid_event', 'The actor account is not valid.');
  return actor;
}

function replyByOther(data, ctx, event) {
  const payload = event.payload || {};
  const actor = otherActor(data, payload);
  const text = noteText(payload.text, 'invalid_event');
  if (typeof payload.reply_to !== 'string' || !payload.reply_to) fail('invalid_event', 'reply_to is required.');
  const target = targetRecord(data, payload.reply_to);
  if (!target) fail('invalid_event', 'The reply target does not exist.');
  if (target.kind === 'note' && target.item.status !== 'posted') fail('reply_target_deleted', 'The reply target is not public.');
  if (target.kind === 'post' && target.item.status !== 'published') fail('not_published', 'The reply target is not public.');
  const note = createNote(data, ctx, {
    account_id: actor.account_id, kind: 'reply', text, status: 'posted', reply_to: payload.reply_to,
    event_id: event.event_id, links: Array.isArray(payload.links) ? payload.links.filter(item => typeof item === 'string') : [],
    mentions: Array.isArray(payload.mentions) ? payload.mentions.filter(item => typeof item === 'string' && item) : []
  });
  publishNote(data, ctx, note, null, event.event_id);
  if (target.author === data.account_id) {
    data.notifications.push({
      id: 'nt-' + event.event_id, account_id: data.account_id, actor_account_id: actor.account_id,
      kind: 'reply', object_id: note.id, at: ctx.virtual_now, read: false
    });
  } else notifyMention(data, ctx, actor.account_id, note.id, text, payload.mentions, event.event_id);
}

function repostByOther(data, ctx, event) {
  const payload = event.payload || {};
  const actor = otherActor(data, payload);
  const text = noteText(payload.text || 'Repost.', 'invalid_event');
  if (payload.object_type !== 'post' && payload.object_type !== 'note') fail('invalid_event', 'object_type is not supported.');
  const target = targetRecord(data, payload.object_id);
  if (!target || target.kind !== payload.object_type) fail('invalid_event', 'The repost target does not exist.');
  if (target.kind === 'post' && target.item.status !== 'published') fail('not_published', 'The repost target is not public.');
  if (target.kind === 'note' && target.item.status !== 'posted') fail('not_published', 'The repost target is not public.');
  const note = createNote(data, ctx, {
    account_id: actor.account_id, kind: 'repost', text, status: 'posted',
    repost_of: {object_type: payload.object_type, object_id: payload.object_id}, event_id: event.event_id
  });
  publishNote(data, ctx, note, null, event.event_id);
}

function followerChanged(data, ctx, event) {
  const payload = event.payload || {};
  const actor = otherActor(data, payload);
  const owner = self(data);
  const edge = activeFollow(data, actor.account_id, owner.account_id);
  if (payload.follows === true) {
    if (edge) fail('invalid_event', 'That follow already exists.');
    data.follows.push({follower_account_id: actor.account_id, target_account_id: owner.account_id, at: ctx.virtual_now, request_id: null, ended_at: null, unfollow_request_id: null});
    owner.follower_count += 1;
    actor.following_count += 1;
    return;
  }
  if (payload.follows === false) {
    if (!edge) fail('invalid_event', 'That follow does not exist.');
    edge.ended_at = ctx.virtual_now;
    edge.unfollow_request_id = null;
    owner.follower_count = Math.max(0, owner.follower_count - 1);
    actor.following_count = Math.max(0, actor.following_count - 1);
    return;
  }
  fail('invalid_event', 'follows must be true or false.');
}

module.exports = {
  createDraft, updateDraft, deleteDraft, publish, schedule, unschedule, editPublished, unpublish,
  listPosts, getPost, postNote, replyNote, deleteNote, getNote, feed, peopleGet, peoplePosts,
  scheduleNote, repostNote, searchNotes, searchPeople, followAccount, unfollowAccount, blockAccount, unblockAccount,
  updateSelf, listNotifications, markRead,
  selectPending, confirmPost, declinePost, confirmNote, declineNote, confirmProfile, declineProfile,
  releaseDue, postByOther, replyByOther, repostByOther, followerChanged,
  reachOf, revisionReach, dueOf, viewPost, subjectHits
};
