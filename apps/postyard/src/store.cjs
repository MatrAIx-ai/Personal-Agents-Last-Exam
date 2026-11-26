'use strict';
const {
  fail, nfc, instant, accountById, accountByHandle, self, confirms, followersOf, publicUrl, noteUrl,
  nextSerial, nextReceipt, tagsOf, requireText, requireSlug
} = require('./common.cjs');
const {subjectHits, parseLinks} = require('./subjects.cjs');

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

function slugFree(data, accountId, slug, exceptId) {
  return !data.posts.some(post => post.account_id === accountId && post.id !== exceptId && post.slug === slug);
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

function currentFields(post) {
  const row = head(post);
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
    event_id: fields.event_id || null
  };
  data.receipts.push(receipt);
  return receipt;
}

function hoursBetween(start, end) {
  const ms = instant(end, 'invalid_time') - instant(start, 'invalid_time');
  return ms > 0 ? ms / 3600000 : 0;
}

function repostReach(data, objectType, objectId, end) {
  let sum = 0;
  const endMs = instant(end, 'invalid_time');
  for (const note of data.notes) {
    if (note.kind !== 'repost' || note.status !== 'posted' || !note.repost_of) continue;
    if (note.repost_of.object_type !== objectType || note.repost_of.object_id !== objectId) continue;
    if (!note.published_at || instant(note.published_at, 'invalid_time') > endMs) continue;
    sum += note.followers_at_publish || 0;
  }
  return sum;
}

function reachOf(data, now, item, objectType) {
  if (!item.published_at || item.followers_at_publish === null || item.followers_at_publish === undefined) return 0;
  const end = item.unpublished_at || item.deleted_at || now;
  const hours = hoursBetween(item.published_at, end);
  const extra = repostReach(data, objectType, item.id, end);
  const grown = item.followers_at_publish + extra + Math.floor(data.settings.audience_rate_per_hour * hours);
  return Math.min(data.settings.audience_cap, grown);
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
  post.public_revision = number;
  post.status = 'published';
  post.pending = null;
  post.publish_at = null;
  if (!post.published_at) {
    post.published_at = ctx.virtual_now;
    post.followers_at_publish = followersOf(data, post.account_id);
  }
  post.unpublished_at = null;
  touch(ctx, post);
  const account = accountById(data, post.account_id);
  return addReceipt(data, {
    object_type: 'post', object_id: post.id, revision: number,
    published_at: ctx.virtual_now, public_url: publicUrl(account, row.slug),
    request_id: requestId, event_id: eventId
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
    request_id: requestId, event_id: eventId
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
    created_at: now, updated_at: now
  };
  data.posts.push(post);
  return {id, revision: 1, record_status: 'draft'};
}

function updateDraft(data, ctx, args) {
  const post = ownPost(data, args.post_id);
  const pendingEdit = post.status === 'published' && post.pending && post.pending.kind === 'edit';
  const waiting = post.status === 'pending_owner_confirmation';
  if (post.status !== 'draft' && !waiting && !pendingEdit) {
    fail('already_published', 'A published post is changed with blog.edit_published.');
  }
  const fields = currentFields(post);
  if (args.title !== undefined) fields.title = requireText(args.title, 200, 'Title');
  if (args.body !== undefined) fields.body = requireText(args.body, 20000, 'Body');
  if (args.slug !== undefined) fields.slug = requireSlug(args.slug);
  if (args.tags !== undefined) fields.tags = tagsOf(args.tags);
  if (!slugFree(data, data.account_id, fields.slug, post.id)) fail('slug_taken', 'That slug is already used on this account.');
  if (post.pending) {
    const held = revision(post, post.pending.revision);
    if (held && held.visibility === 'pending') held.visibility = 'withheld';
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
  const post = ownPost(data, args.post_id);
  if (post.public_revision || post.status === 'published' || post.status === 'unpublished') {
    fail('already_published', 'A public post is removed with blog.unpublish.');
  }
  if (post.status === 'scheduled') fail('invalid_arguments', 'Unschedule the post before deleting it.');
  data.posts = data.posts.filter(item => item.id !== post.id);
  return {id: post.id, record_status: 'deleted'};
}

function assertHead(post, number) {
  if (!Number.isInteger(number) || number !== post.head_revision || !revision(post, number)) {
    fail('revision_mismatch', 'That revision is not the current revision.');
  }
}

function publish(data, ctx, args) {
  const post = ownPost(data, args.post_id);
  assertHead(post, args.revision);
  if (post.status === 'published' && post.public_revision === args.revision && !post.pending) {
    fail('already_published', 'That revision is already public.');
  }
  if (post.status === 'scheduled') fail('invalid_arguments', 'Unschedule the post before publishing it directly.');
  if (post.pending) fail('invalid_arguments', 'Resolve the pending revision before publishing again.');
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
  const post = ownPost(data, args.post_id);
  if (post.status !== 'published' || !post.public_revision) fail('not_published', 'That post is not public.');
  if (!Number.isInteger(args.base_revision) || args.base_revision !== post.public_revision) {
    fail('revision_mismatch', 'base_revision is not the current public revision.');
  }
  if (post.pending) fail('invalid_arguments', 'Resolve the pending revision before editing again.');
  const fields = currentFields(post);
  if (args.title !== undefined) fields.title = requireText(args.title, 200, 'Title');
  if (args.body !== undefined) fields.body = requireText(args.body, 20000, 'Body');
  if (args.slug !== undefined) fields.slug = requireSlug(args.slug);
  if (args.tags !== undefined) fields.tags = tagsOf(args.tags);
  if (args.correction_note !== undefined && args.correction_note !== null) {
    if (typeof args.correction_note !== 'string' || args.correction_note.length > 500) fail('invalid_arguments', 'correction_note is too long.');
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
  const post = ownPost(data, args.post_id);
  if (post.status !== 'published') fail('not_published', 'That post is not public.');
  if (post.pending) {
    const held = revision(post, post.pending.revision);
    if (held && held.visibility === 'pending') held.visibility = 'withheld';
    post.pending = null;
  }
  post.status = 'unpublished';
  post.unpublished_at = ctx.virtual_now;
  touch(ctx, post);
  return {id: post.id, record_status: 'unpublished', unpublished_at: post.unpublished_at};
}

function postText(post, number) {
  const row = revision(post, number) || head(post);
  return row.title + '\n\n' + row.body;
}

function viewPost(data, ctx, post, audience) {
  const number = post.public_revision || post.head_revision;
  const row = revision(post, audience === 'public' ? post.public_revision : number);
  const shown = row || head(post);
  const account = accountById(data, post.account_id);
  return {
    id: post.id,
    account_id: post.account_id,
    handle: account ? account.handle : null,
    slug: shown.slug,
    title: shown.title,
    body: shown.body,
    tags: [...shown.tags],
    correction_note: shown.correction_note,
    status: post.status,
    revision: shown.revision,
    public_revision: post.public_revision,
    head_revision: post.head_revision,
    publish_at: post.publish_at,
    scheduled_for: post.scheduled_for,
    published_at: post.published_at,
    unpublished_at: post.unpublished_at,
    release_lag_seconds: post.release_lag_seconds,
    followers_at_publish: post.followers_at_publish,
    due: dueOf(post, ctx.virtual_now),
    reach: reachOf(data, ctx.virtual_now, post, 'post'),
    public_url: account ? publicUrl(account, shown.slug) : null,
    owner_note: post.owner_note,
    pending: post.pending ? copyPending(post.pending) : null,
    created_at: post.created_at,
    updated_at: post.updated_at
  };
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
  const post = data.posts.find(item => item.id === args.post_id);
  if (!post) fail('not_found', 'Post does not exist.');
  const owner = post.account_id === data.account_id;
  if (!owner && post.status !== 'published') fail('not_found', 'Post does not exist.');
  const view = viewPost(data, ctx, post, owner ? 'owner' : 'public');
  const text = postText(post, view.revision);
  const receipts = data.receipts.filter(item => item.object_type === 'post' && item.object_id === post.id);
  return {
    post: view,
    revisions: post.revisions.map(item => ({
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
  if (value.length > 500) fail(code, code === 'invalid_event' ? 'Note text is longer than 500 characters.' : 'A note can be at most 500 characters.');
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
    created_at: now, updated_at: now
  };
  data.notes.push(note);
  return note;
}

function postNote(data, ctx, args) {
  const text = noteText(args.text, 'note_too_long');
  if (confirms(data)) {
    const note = createNote(data, ctx, {
      account_id: data.account_id, kind: 'note', text, status: 'pending_owner_confirmation',
      pending_kind: 'post', request_id: args.request_id
    });
    return {id: note.id, record_status: note.status, revision: 1};
  }
  const note = createNote(data, ctx, {
    account_id: data.account_id, kind: 'note', text, status: 'posted', request_id: args.request_id
  });
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
  const note = ownNote(data, args.note_id);
  if (note.status === 'deleted' || note.status === 'withdrawn') fail('not_found', 'That note is already withdrawn.');
  if (note.status === 'declined') fail('invalid_arguments', 'A declined note stays in history.');
  if (note.status === 'pending_owner_confirmation') {
    note.status = 'withdrawn';
    note.pending_kind = null;
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
  return {
    id: note.id, account_id: note.account_id, handle: account ? account.handle : null,
    kind: note.kind, text: note.text, status: note.status, revision: 1,
    reply_to: note.reply_to, repost_of: note.repost_of, publish_at: note.publish_at,
    scheduled_for: note.scheduled_for, published_at: note.published_at, deleted_at: note.deleted_at,
    release_lag_seconds: note.release_lag_seconds, followers_at_publish: note.followers_at_publish,
    due: dueOf(note, ctx.virtual_now), reach: reachOf(data, ctx.virtual_now, note, 'note'),
    public_url: account ? noteUrl(account, note.id) : null, owner_note: note.owner_note,
    created_at: note.created_at, updated_at: note.updated_at
  };
}

function threadOf(data, ctx, note) {
  const rootId = note.reply_to && findNote(data, note.reply_to) ? note.reply_to : note.id;
  const rows = data.notes.filter(item => item.id === rootId || item.reply_to === rootId || item.id === note.id);
  const visible = rows.filter(item => item.account_id === data.account_id || item.status === 'posted' || item.id === note.id);
  visible.sort((a, b) => instant(a.created_at, 'invalid_seed') - instant(b.created_at, 'invalid_seed'));
  return visible.map(item => viewNote(data, ctx, item));
}

function getNote(data, ctx, args) {
  const note = findNote(data, args.note_id);
  if (!note) fail('not_found', 'Note does not exist.');
  if (note.account_id !== data.account_id && note.status !== 'posted') fail('not_found', 'Note does not exist.');
  const surface = note.kind === 'reply' ? 'reply_to_subject' : 'note';
  return {note: viewNote(data, ctx, note), thread: threadOf(data, ctx, note), subjects: subjectHits(data, note.text, surface), links: parseLinks(note.text)};
}

function followedIds(data) {
  const ids = new Set([data.account_id]);
  for (const edge of data.follows) if (edge.follower_account_id === data.account_id) ids.add(edge.target_account_id);
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
  return data.posts.filter(post => post.account_id === data.account_id && (post.status === 'pending_owner_confirmation' || post.pending));
}
function pendingNotes(data) {
  return data.notes.filter(note => note.account_id === data.account_id && note.status === 'pending_owner_confirmation');
}

function selectPending(data, payload) {
  const type = payload.object_type;
  if (type !== 'post' && type !== 'note' && type !== 'profile') fail('invalid_event', 'object_type is not supported.');
  if (payload.select === 'only_pending') {
    const rows = type === 'post' ? pendingPosts(data) : type === 'note' ? pendingNotes(data) : [];
    if (rows.length === 0) fail('not_pending', 'No pending item of that type.');
    if (rows.length > 1) fail('ambiguous_target', 'More than one pending item of that type.');
    return rows[0];
  }
  if (!payload.object_id) fail('invalid_event', 'An object id or only_pending is required.');
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
  fail('not_pending', 'No pending profile revision.');
}

function confirmPost(data, ctx, post, payload, event) {
  if (payload.revision !== undefined && (!post.pending || payload.revision !== post.pending.revision)) {
    fail('revision_mismatch', 'Confirmation names a revision other than the pending one.');
  }
  if (!post.pending) fail('not_pending', 'That post is not waiting for confirmation.');
  const chosen = post.pending.revision;
  const requestId = post.pending.request_id;
  if (post.pending.kind === 'schedule') {
    const row = revision(post, chosen);
    if (row) row.visibility = 'private';
    post.pending = null;
    post.status = 'scheduled';
    touch(ctx, post);
    return;
  }
  makePostPublic(data, ctx, post, chosen, requestId, event.event_id);
}

function declinePost(data, ctx, post, payload) {
  if (!post.pending) fail('not_pending', 'That post is not waiting for confirmation.');
  if (payload.revision !== undefined && payload.revision !== post.pending.revision) {
    fail('revision_mismatch', 'Decline names a revision other than the pending one.');
  }
  const held = revision(post, post.pending.revision);
  const edit = post.pending.kind === 'edit' && post.public_revision;
  if (held) held.visibility = edit ? 'withheld' : 'private';
  post.pending = null;
  post.owner_note = payload.note ? nfc(payload.note) : null;
  if (edit) post.status = 'published';
  else {
    post.status = 'draft';
    post.publish_at = null;
    post.schedule_request_id = null;
  }
  touch(ctx, post);
}

function confirmNote(data, ctx, note, payload, event) {
  if (note.status !== 'pending_owner_confirmation') fail('not_pending', 'That note is not waiting for confirmation.');
  if (payload.revision !== undefined && payload.revision !== 1) fail('revision_mismatch', 'Notes have a single revision.');
  if (note.kind === 'reply') assertReplyTarget(data, note.reply_to);
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

function postByOther(data, ctx, event) {
  const payload = event.payload || {};
  const actor = accountById(data, payload.actor_account_id);
  if (!actor || actor.account_id === data.account_id) fail('invalid_event', 'The actor account is not valid.');
  const text = noteText(payload.text, 'invalid_event');
  const note = createNote(data, ctx, {
    account_id: actor.account_id, kind: 'note', text, status: 'posted', event_id: event.event_id
  });
  publishNote(data, ctx, note, null, event.event_id);
  const owner = self(data);
  if (text.includes('@' + owner.handle)) {
    data.notifications.push({
      id: 'nt-' + event.event_id, account_id: data.account_id, actor_account_id: actor.account_id,
      kind: 'mention', object_id: note.id, at: ctx.virtual_now, read: false
    });
  }
}

module.exports = {
  createDraft, updateDraft, deleteDraft, publish, schedule, unschedule, editPublished, unpublish,
  listPosts, getPost, postNote, replyNote, deleteNote, getNote, feed, peopleGet, peoplePosts,
  selectPending, confirmPost, declinePost, confirmNote, declineNote, releaseDue, postByOther,
  reachOf, dueOf, viewPost, subjectHits
};
