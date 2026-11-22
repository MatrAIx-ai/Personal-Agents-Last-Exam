'use strict';
const {fail, copy} = require('./domain-utils.cjs');
const {log} = require('./diagnostics.cjs');
const text = require('./text.cjs');
const graph = require('./graph.cjs');

const FILE_MAX = 64 * 1024;
const REPO_MAX = 400 * 1024;
const COMMENT_MAX = 65536;

function account(data, id) {
  const found = data.accounts.find(item => item.account_id === id);
  if (!found) fail('not_found', 'not_found: Account ' + id + ' does not exist.');
  return found;
}

function accountByHandle(data, handle) {
  return data.accounts.find(item => item.handle === handle) || null;
}

function repoOf(data, name) {
  const found = data.repositories.find(item => item.repo === name);
  if (!found) fail('not_found', 'not_found: Repository ' + name + ' does not exist.');
  return found;
}

function roleOf(data, repo, accountId) {
  const row = repo.roles.find(item => item.account_id === accountId);
  return row ? row.role : 'outside';
}

function canPush(role) {
  return role === 'owner' || role === 'maintainer' || role === 'collaborator';
}

function isMaintainer(role) {
  return role === 'owner' || role === 'maintainer';
}

function assertActive(repo) {
  if (repo.status === 'archived') fail('repo_archived', 'repo_archived: Repository ' + repo.repo + ' is archived.');
}

function assertPush(data, repo, accountId) {
  assertActive(repo);
  if (!canPush(roleOf(data, repo, accountId))) fail('no_push_access', 'no_push_access: ' + accountId + ' cannot push to ' + repo.repo + '.');
  assertNotBlocked(repo, accountId);
}

function assertNotBlocked(repo, accountId) {
  if (repo.blocked_accounts.includes(accountId)) fail('blocked_by_maintainer', 'blocked_by_maintainer: ' + accountId + ' is blocked on ' + repo.repo + '.');
}

function assertMaintainer(data, repo, accountId, code = 'invalid_event') {
  if (!isMaintainer(roleOf(data, repo, accountId))) fail(code, code + ': ' + accountId + ' is not a maintainer of ' + repo.repo + '.');
}

function pullOf(data, repo, number) {
  const found = data.pulls.find(item => item.repo === repo && item.number === number);
  if (!found) fail('not_found', 'not_found: Pull request ' + repo + '#' + number + ' does not exist.');
  return found;
}

function issueOf(data, repo, number) {
  const found = data.issues.find(item => item.repo === repo && item.number === number);
  if (!found) fail('not_found', 'not_found: Issue ' + repo + '#' + number + ' does not exist.');
  return found;
}

function commentOf(data, id) {
  const found = data.comments.find(item => item.comment_id === id);
  if (!found) fail('not_found', 'not_found: Comment ' + id + ' does not exist.');
  return found;
}

function releaseOf(data, id) {
  const found = data.releases.find(item => item.release_id === id);
  if (!found) fail('not_found', 'not_found: Release ' + id + ' does not exist.');
  return found;
}

function branchOf(data, repo, name) {
  const found = data.branches.find(item => item.repo === repo && item.name === name);
  if (!found) fail('branch_not_found', 'branch_not_found: Branch ' + name + ' is not in ' + repo + '.');
  return found;
}

function publicUrl(kind, repo, number, handle) {
  if (kind === 'profile') return 'https://forkyard.example/' + handle;
  if (kind === 'repo') return 'https://forkyard.example/' + repo;
  if (kind === 'pull') return 'https://forkyard.example/' + repo + '/pull/' + number;
  if (kind === 'issue') return 'https://forkyard.example/' + repo + '/issues/' + number;
  if (kind === 'release') return 'https://forkyard.example/' + repo + '/releases/' + number;
  return 'https://forkyard.example/' + repo;
}

function objectId(repo, number) {
  return repo.replaceAll('/', '.') + '.' + number;
}

function bump(data, key) {
  const value = data.counters[key];
  data.counters[key] = value + 1;
  return value;
}

function nextTopic(data, kind, repo) {
  const table = data.counters[kind];
  const number = table[repo];
  if (!Number.isInteger(number)) fail('invalid_seed', 'invalid_seed: Missing ' + kind + ' counter for ' + repo + '.');
  table[repo] = number + 1;
  return number;
}

function touch(ctx, record) {
  if (Date.parse(ctx.virtual_now) < Date.parse(record.updated_at || record.created_at)) {
    fail('invalid_time', 'invalid_time: The run clock must not precede the last record update.');
  }
  record.updated_at = ctx.virtual_now;
}

function addTimeline(ctx, data, entry) {
  data.timeline.push({
    entry_id: 'tl-' + bump(data, 'timeline'),
    repo: entry.repo,
    number: entry.number ?? null,
    at: ctx.virtual_now,
    actor_account_id: entry.actor_account_id,
    kind: entry.kind,
    text: text.nfc(entry.text || '')
  });
}

function addNotification(ctx, data, note) {
  if (!data.accounts.some(item => item.account_id === note.account_id)) return null;
  const row = {
    notification_id: 'ntf-' + bump(data, 'notification'),
    account_id: note.account_id,
    kind: note.kind,
    repo: note.repo,
    number: note.number ?? null,
    unread: true,
    text: text.nfc(note.text),
    created_at: ctx.virtual_now,
    read_at: null
  };
  data.notifications.push(row);
  if (note.account_id === data.account_id && data.settings.email_notifications && note.mail) {
    const person = account(data, note.account_id);
    if (person.person_id) {
      data.notices.push({
        notice_id: 'notice-' + bump(data, 'notice'),
        account_id: note.account_id,
        person_id: person.person_id,
        status: 'pending_delivery',
        publish_request_id: null,
        messaging_event_id: null,
        object_type: note.mail.object_type,
        object_id: note.mail.object_id,
        title: text.nfc(note.mail.title),
        text: text.nfc(note.mail.text),
        created_at: ctx.virtual_now
      });
    }
  }
  return row;
}

function rateLimit(ctx, data, repo, accountId) {
  const limit = repo.interaction_limit;
  if (!limit || roleOf(data, repo, accountId) !== 'outside') return;
  const now = Date.parse(ctx.virtual_now);
  const windowMs = limit.window_minutes * 60 * 1000;
  const recent = data.comments.filter(item => item.repo === repo.repo && item.author_account_id === accountId && (now - Date.parse(item.created_at)) >= 0 && (now - Date.parse(item.created_at)) < windowMs);
  if (recent.length < limit.max_comments) return;
  const oldest = Math.min(...recent.map(item => Date.parse(item.created_at)));
  const retryAfter = Math.max(1, Math.ceil((windowMs - (now - oldest)) / 60000));
  fail('rate_limited', 'rate_limited: retry_after ' + retryAfter + ' minutes.');
}

function assertCommentLength(body, code) {
  if (typeof body !== 'string' || body.length > COMMENT_MAX) fail(code, code + ': Comment exceeds 65536 characters.');
}

function storedRevision(body, revision, at, requestId, eventId) {
  return {revision, body: text.nfc(body), at, request_id: requestId || null, event_id: eventId || null};
}

function addComment(ctx, data, spec) {
  const repo = repoOf(data, spec.repo);
  assertActive(repo);
  const author = spec.author_account_id;
  account(data, author);
  assertCommentLength(spec.body, spec.from_event ? 'invalid_event' : 'comment_too_long');
  if (!spec.from_event) {
    assertNotBlocked(repo, author);
    rateLimit(ctx, data, repo, author);
    if (spec.target === 'pull') {
      const pull = pullOf(data, spec.repo, spec.number);
      if (pull.locked && roleOf(data, repo, author) === 'outside') {
        fail('conversation_locked', 'conversation_locked: The conversation on ' + spec.repo + '#' + spec.number + ' is locked.');
      }
      if (pull.state === 'merged' && spec.block_merged) fail('already_merged', 'already_merged: Pull request is merged.');
    }
  }
  if (spec.target === 'pull') pullOf(data, spec.repo, spec.number);
  if (spec.target === 'issue') issueOf(data, spec.repo, spec.number);
  if (spec.in_reply_to && !data.comments.some(item => item.comment_id === spec.in_reply_to)) {
    fail(spec.from_event ? 'invalid_event' : 'not_found', 'not_found: Reply target does not exist.');
  }
  const comment = {
    comment_id: 'cmt-' + bump(data, 'comment'),
    repo: spec.repo,
    target: spec.target,
    number: spec.number,
    author_account_id: author,
    body: text.nfc(spec.body),
    revision: 1,
    deleted: false,
    in_reply_to: spec.in_reply_to || null,
    path: spec.path || null,
    line: Number.isInteger(spec.line) ? spec.line : null,
    review_id: spec.review_id || null,
    created_at: ctx.virtual_now,
    updated_at: ctx.virtual_now,
    revisions: [storedRevision(spec.body, 1, ctx.virtual_now, spec.request_id, spec.event_id)]
  };
  data.comments.push(comment);
  addTimeline(ctx, data, {
    repo: spec.repo,
    number: spec.number,
    actor_account_id: author,
    kind: 'comment',
    text: comment.body.slice(0, 240)
  });
  const handle = account(data, author).handle;
  for (const name of text.mentions(comment.body)) {
    const mentioned = accountByHandle(data, name);
    if (!mentioned || mentioned.account_id === author) continue;
    addNotification(ctx, data, {
      account_id: mentioned.account_id,
      kind: 'mention',
      repo: spec.repo,
      number: spec.number,
      text: '@' + handle + ' mentioned you on ' + spec.repo + '#' + spec.number + '.',
      mail: {
        object_type: spec.target === 'issue' ? 'issue' : 'pull_request',
        object_id: objectId(spec.repo, spec.number),
        title: '[' + spec.repo + '] Mentioned by @' + handle,
        text: '@' + handle + ' mentioned you on ' + spec.repo + '#' + spec.number + '.\n\n' + comment.body
      }
    });
  }
  log(ctx, 'forkyard.comment', {record_id: comment.comment_id});
  return comment;
}

function notifyAuthor(ctx, data, pull, kind, actorId, text, mailText) {
  if (pull.author_account_id === actorId) return;
  const actor = account(data, actorId);
  const titles = {
    pull_closed: '[' + pull.repo + '] PR #' + pull.number + ' closed by @' + actor.handle,
    pull_merged: '[' + pull.repo + '] PR #' + pull.number + ' merged by @' + actor.handle,
    pull_reviewed: '[' + pull.repo + '] PR #' + pull.number + ' reviewed by @' + actor.handle
  };
  addNotification(ctx, data, {
    account_id: pull.author_account_id,
    kind,
    repo: pull.repo,
    number: pull.number,
    text,
    mail: {
      object_type: 'pull_request',
      object_id: objectId(pull.repo, pull.number),
      title: titles[kind] || ('[' + pull.repo + '] PR #' + pull.number + ' update by @' + actor.handle),
      text: mailText
    }
  });
}

function closePull(ctx, data, pull, actorId, comment, requestId, eventId) {
  if (pull.state === 'merged') fail(eventId ? 'invalid_event' : 'already_merged', 'already_merged: Pull request is already merged.');
  if (pull.state === 'closed') fail(eventId ? 'invalid_event' : 'invalid_state', 'invalid_state: Pull request is already closed.');
  pull.state = 'closed';
  pull.closed_at = ctx.virtual_now;
  touch(ctx, pull);
  let stored = null;
  if (comment) {
    stored = addComment(ctx, data, {
      repo: pull.repo,
      target: 'pull',
      number: pull.number,
      body: comment,
      author_account_id: actorId,
      request_id: requestId,
      event_id: eventId,
      from_event: !!eventId
    });
  }
  addTimeline(ctx, data, {repo: pull.repo, number: pull.number, actor_account_id: actorId, kind: 'closed', text: comment || 'Closed.'});
  const actor = account(data, actorId);
  const hm = text.clockHm(ctx.virtual_now);
  const body = '@' + actor.handle + ' closed your pull request "' + pull.title + '" at ' + hm + '.' + (comment ? '\n\n' + comment : '');
  notifyAuthor(ctx, data, pull, 'pull_closed', actorId, body, body);
  return stored;
}

function fileBytes(files) {
  return files.reduce((sum, file) => sum + (file.binary ? 0 : Buffer.byteLength(file.content || '', 'utf8')), 0);
}

function assertTreeSize(tree) {
  let total = 0;
  for (const file of Object.values(tree)) {
    if (file.binary) continue;
    const size = Buffer.byteLength(file.content || '', 'utf8');
    if (size > FILE_MAX) fail('file_too_large', 'file_too_large: ' + file.path + ' exceeds 64 KB.');
    total += size;
  }
  if (total > REPO_MAX) fail('file_too_large', 'file_too_large: Repository text exceeds 400 KB.');
}

function pathsOverlap(left, right) {
  if (!left.length || !right.length) return false;
  const other = new Set(right);
  let shared = 0;
  for (const path of left) if (other.has(path)) shared += 1;
  return shared / left.length >= 0.5;
}

module.exports = {
  FILE_MAX, REPO_MAX, COMMENT_MAX, copy, fail, log, account, accountByHandle, repoOf, roleOf,
  canPush, isMaintainer, assertActive, assertPush, assertNotBlocked, assertMaintainer, pullOf,
  issueOf, commentOf, releaseOf, branchOf, publicUrl, objectId, bump, nextTopic, touch,
  addTimeline, addNotification, rateLimit, addComment, notifyAuthor, closePull, assertCommentLength, fileBytes,
  assertTreeSize, pathsOverlap, storedRevision, text, graph
};
