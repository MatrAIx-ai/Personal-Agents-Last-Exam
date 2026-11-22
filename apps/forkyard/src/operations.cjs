'use strict';
const store = require('./store.cjs');
const {fail, log} = store;

function readRepo(data, repo) {
  const record = store.repoOf(data, repo);
  return {
    ...store.copy(record),
    url: store.publicUrl('repo', repo)
  };
}

function page(items, args) {
  const start = args.cursor ? Number(args.cursor) : 0;
  if (!Number.isInteger(start) || start < 0) fail('invalid_arguments', 'invalid_arguments: Cursor is not a page offset.');
  const size = args.limit || 20;
  const slice = items.slice(start, start + size);
  return {items: store.copy(slice), next_cursor: start + size < items.length ? String(start + size) : null};
}

function activity(data) {
  const rows = [];
  for (const commit of data.commits) {
    rows.push({type: 'commit', repo: commit.repo, at: commit.committed_at, account_id: commit.author_account_id, sha: commit.sha, text: commit.message, number: null});
  }
  for (const pull of data.pulls) {
    rows.push({type: 'pull', repo: pull.repo, at: pull.created_at, account_id: pull.author_account_id, sha: pull.head_sha, text: pull.title, number: pull.number});
  }
  for (const review of data.reviews) {
    rows.push({type: 'review', repo: review.repo, at: review.created_at, account_id: review.author_account_id, sha: null, text: review.body, number: review.number});
  }
  for (const comment of data.comments) {
    if (comment.deleted) continue;
    rows.push({type: 'comment', repo: comment.repo, at: comment.created_at, account_id: comment.author_account_id, sha: null, text: comment.body, number: comment.number});
  }
  rows.sort((left, right) => Date.parse(right.at) - Date.parse(left.at) || left.text.localeCompare(right.text));
  return rows;
}

function changedPaths(data, pull) {
  const base = store.graph.treeAt(data, pull.repo, pull.base_sha);
  const head = store.graph.treeAt(data, pull.head_repo, pull.head_sha);
  return store.graph.diffTrees(base, head);
}

const read = {
  'forkyard.repos.get'(ctx, data, args) {
    return {repository: readRepo(data, args.repo)};
  },
  'forkyard.repos.search'(ctx, data, args) {
    const query = store.text.fold(args.query || '');
    const repositories = data.repositories.filter(item => store.text.fold(item.repo + ' ' + item.description).includes(query)).map(item => readRepo(data, item.repo));
    return {repositories};
  },
  'forkyard.repos.files.list'(ctx, data, args) {
    const sha = store.graph.resolveRef(data, args.repo, args.ref);
    const tree = store.graph.treeAt(data, args.repo, sha);
    const files = Object.values(tree).sort((left, right) => left.path.localeCompare(right.path)).map(file => ({path: file.path, binary: file.binary, size_bytes: file.binary ? null : Buffer.byteLength(file.content, 'utf8')}));
    return {ref: args.ref, sha, files};
  },
  'forkyard.repos.files.read'(ctx, data, args) {
    const sha = store.graph.resolveRef(data, args.repo, args.ref);
    const file = store.graph.treeAt(data, args.repo, sha)[args.path];
    if (!file) fail('not_found', 'not_found: File ' + args.path + ' is not at ' + args.ref + '.');
    if (file.binary) fail('binary_not_served', 'binary_not_served: ' + args.path + ' is not a UTF-8 text file.');
    return {ref: args.ref, sha, path: file.path, content: file.content};
  },
  'forkyard.issues.list'(ctx, data, args) {
    const issues = data.issues.filter(item => item.repo === args.repo && (!args.state || item.state === args.state));
    return {issues: store.copy(issues)};
  },
  'forkyard.issues.get'(ctx, data, args) {
    const issue = store.issueOf(data, args.repo, args.number);
    const comments = data.comments.filter(item => item.repo === args.repo && item.target === 'issue' && item.number === args.number);
    return {issue: store.copy(issue), comments: store.copy(comments), url: store.publicUrl('issue', args.repo, args.number)};
  },
  'forkyard.pulls.list'(ctx, data, args) {
    const pulls = data.pulls.filter(item => item.repo === args.repo && (!args.state || item.state === args.state));
    return {pulls: store.copy(pulls)};
  },
  'forkyard.pulls.get'(ctx, data, args) {
    const pull = store.pullOf(data, args.repo, args.number);
    const comments = data.comments.filter(item => item.repo === args.repo && item.target === 'pull' && item.number === args.number);
    const reviews = data.reviews.filter(item => item.repo === args.repo && item.number === args.number);
    return {pull: store.copy(pull), comments: store.copy(comments), reviews: store.copy(reviews), url: store.publicUrl('pull', args.repo, args.number)};
  },
  'forkyard.pulls.diff'(ctx, data, args) {
    const pull = store.pullOf(data, args.repo, args.number);
    const diff = changedPaths(data, pull);
    return {repo: pull.repo, number: pull.number, ...diff};
  },
  'forkyard.pulls.timeline'(ctx, data, args) {
    store.pullOf(data, args.repo, args.number);
    const entries = data.timeline.filter(item => item.repo === args.repo && item.number === args.number);
    return {entries: store.copy(entries)};
  },
  'forkyard.people.get'(ctx, data, args) {
    const person = args.account_id ? store.account(data, args.account_id) : store.accountByHandle(data, args.handle);
    if (!person) fail('not_found', 'not_found: No account matches that handle.');
    return {account: store.copy(person), url: store.publicUrl('profile', null, null, person.handle)};
  },
  'forkyard.people.activity'(ctx, data, args) {
    const person = store.account(data, args.account_id);
    let rows = activity(data).filter(item => item.account_id === person.account_id);
    if (args.repo) rows = rows.filter(item => item.repo === args.repo);
    if (args.type) rows = rows.filter(item => item.type === args.type);
    return page(rows, args);
  },
  'forkyard.people.search'(ctx, data, args) {
    const query = store.text.fold(args.query || '');
    const accounts = data.accounts.filter(item => store.text.fold([item.handle, item.display_name, item.bio, item.location].join(' ')).includes(query));
    return {accounts: store.copy(accounts)};
  },
  'forkyard.notifications.list'(ctx, data, args) {
    const notifications = data.notifications.filter(item => item.account_id === data.account_id && (!args.unread_only || item.unread));
    return {notifications: store.copy(notifications)};
  },
  'forkyard.commits.list'(ctx, data, args) {
    const sha = store.graph.resolveRef(data, args.repo, args.ref);
    const seen = store.graph.reachable(data, args.repo, sha);
    const commits = data.commits.filter(item => item.repo === args.repo && seen.has(item.sha)).sort((left, right) => Date.parse(right.committed_at) - Date.parse(left.committed_at));
    return {sha, ...page(commits, args)};
  },
  'forkyard.commits.get'(ctx, data, args) {
    return {commit: store.copy(store.graph.requireCommit(data, args.repo, args.sha))};
  },
  'forkyard.commits.compare'(ctx, data, args) {
    const base = store.graph.resolveRef(data, args.repo, args.base);
    const head = store.graph.resolveRef(data, args.repo, args.head);
    return {repo: args.repo, base, head, ...store.graph.compareShas(data, args.repo, base, head)};
  },
  'forkyard.tags.list'(ctx, data, args) {
    store.repoOf(data, args.repo);
    return {tags: store.copy(data.tags.filter(item => item.repo === args.repo))};
  },
  'forkyard.releases.list'(ctx, data, args) {
    store.repoOf(data, args.repo);
    return {releases: store.copy(data.releases.filter(item => item.repo === args.repo))};
  },
  'forkyard.releases.get'(ctx, data, args) {
    const release = store.releaseOf(data, args.release_id);
    return {release: store.copy(release), url: store.publicUrl('release', release.repo, release.tag)};
  },
  'forkyard.checks.list'(ctx, data, args) {
    store.graph.requireCommit(data, args.repo, args.sha);
    return {checks: store.copy(data.checks.filter(item => item.repo === args.repo && item.sha === args.sha))};
  }
};

function openPull(ctx, data, spec) {
  const baseRepo = store.repoOf(data, spec.repo);
  store.assertActive(baseRepo);
  const author = spec.author_account_id;
  store.account(data, author);
  if (!spec.from_event) store.assertNotBlocked(baseRepo, author);
  const head = parseHead(spec.head);
  const headBranch = store.branchOf(data, head.repo, head.branch);
  store.graph.requireCommit(data, head.repo, headBranch.sha);
  const baseBranch = store.branchOf(data, spec.repo, spec.base);
  const existing = data.pulls.find(item => item.repo === spec.repo && item.head_repo === head.repo && item.head_branch === head.branch && (item.state === 'open' || item.state === 'draft'));
  if (existing) fail('pr_already_exists', 'pr_already_exists: ' + head.repo + ':' + head.branch + ' already has pull request #' + existing.number + '.');
  const diff = store.graph.diffTrees(store.graph.treeAt(data, spec.repo, baseBranch.sha), store.graph.treeAt(data, head.repo, headBranch.sha));
  if (!diff.changed_lines) fail('no_diff', 'no_diff: The head branch has no changes against ' + spec.base + '.');
  const number = store.nextTopic(data, 'pull', spec.repo);
  const draft = !!spec.draft;
  const pull = {
    repo: spec.repo,
    number,
    title: store.text.nfc(spec.title),
    body: store.text.nfc(spec.body),
    revision: 1,
    state: draft ? 'draft' : 'open',
    head_repo: head.repo,
    head_branch: head.branch,
    head_sha: headBranch.sha,
    base_branch: spec.base,
    base_sha: baseBranch.sha,
    author_account_id: author,
    locked: false,
    lock_reason: null,
    merged_at: null,
    closed_at: null,
    created_at: ctx.virtual_now,
    updated_at: ctx.virtual_now,
    reviewers: [],
    paths: diff.paths,
    revisions: [store.storedRevision(spec.body, 1, ctx.virtual_now, spec.request_id, spec.event_id)]
  };
  pull.revisions[0].title = pull.title;
  pull.revisions[0].draft = draft;
  data.pulls.push(pull);
  store.addTimeline(ctx, data, {repo: spec.repo, number, actor_account_id: author, kind: 'opened', text: pull.title});
  const owner = baseRepo.roles.find(item => item.role === 'owner');
  if (owner && owner.account_id !== author) {
    const actor = store.account(data, author);
    store.addNotification(ctx, data, {
      account_id: owner.account_id,
      kind: 'pull_opened',
      repo: spec.repo,
      number,
      text: '@' + actor.handle + ' opened pull request #' + number + ' on ' + spec.repo + '.',
      mail: {
        object_type: 'pull_request',
        object_id: store.objectId(spec.repo, number),
        title: '[' + spec.repo + '] PR #' + number + ' opened by @' + actor.handle,
        text: '@' + actor.handle + ' opened "' + pull.title + '" on ' + spec.repo + '.'
      }
    });
  }
  log(ctx, 'forkyard.pull_opened', {record_id: spec.repo + '#' + number});
  return pull;
}

function parseHead(head) {
  const match = String(head).match(/^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+):([A-Za-z0-9_./-]{1,120})$/);
  if (!match) fail('invalid_arguments', 'invalid_arguments: Head must look like owner/name:branch.');
  return {repo: match[1], branch: match[2]};
}

function requireRevision(record, expected, code) {
  if (record.revision !== expected) fail(code, code + ': The record revision is ' + record.revision + '.');
}

const write = {
  'forkyard.forks.create'(ctx, data, args) {
    const upstream = store.repoOf(data, args.repo);
    const me = store.account(data, data.account_id);
    const name = upstream.repo.split('/')[1];
    const repo = me.handle + '/' + name;
    if (data.repositories.some(item => item.repo === repo)) fail('already_exists', 'already_exists: Fork ' + repo + ' already exists.');
    const tip = store.branchOf(data, upstream.repo, upstream.default_branch);
    const copied = [...store.graph.reachable(data, upstream.repo, tip.sha)];
    for (const sha of copied) {
      const source = store.graph.requireCommit(data, upstream.repo, sha);
      data.commits.push({...store.copy(source), repo});
    }
    data.repositories.push({
      repo,
      description: 'Fork of ' + upstream.repo + '. ' + upstream.description,
      status: 'active',
      default_branch: upstream.default_branch,
      contributing_text: upstream.contributing_text,
      reopen_policy: upstream.reopen_policy,
      interaction_limit: upstream.interaction_limit ? store.copy(upstream.interaction_limit) : null,
      blocked_accounts: [],
      roles: [{account_id: data.account_id, role: 'owner'}],
      created_at: ctx.virtual_now,
      updated_at: ctx.virtual_now
    });
    data.branches.push({repo, name: upstream.default_branch, sha: tip.sha, updated_at: ctx.virtual_now});
    data.counters.pull[repo] = 1;
    data.counters.issue[repo] = 1;
    log(ctx, 'forkyard.fork_created', {record_id: repo});
    return {repo, url: store.publicUrl('repo', repo), head_sha: tip.sha};
  },
  'forkyard.commits.push'(ctx, data, args) {
    const repo = store.repoOf(data, args.repo);
    store.assertPush(data, repo, data.account_id);
    let branch = data.branches.find(item => item.repo === args.repo && item.name === args.branch);
    if (!branch && args.create_branch) {
      const base = store.branchOf(data, args.repo, repo.default_branch);
      branch = {repo: args.repo, name: args.branch, sha: base.sha, updated_at: ctx.virtual_now};
      data.branches.push(branch);
    }
    if (!branch) fail('branch_not_found', 'branch_not_found: Branch ' + args.branch + ' is not in ' + args.repo + '.');
    const parentTree = store.graph.treeAt(data, args.repo, branch.sha);
    const files = [];
    for (const file of args.files) {
      if (file.content !== null && file.content.includes('\0')) fail('invalid_arguments', 'invalid_arguments: File content must be UTF-8 text.');
      if (file.content !== null && Buffer.byteLength(file.content, 'utf8') > store.FILE_MAX) fail('file_too_large', 'file_too_large: ' + file.path + ' exceeds 64 KB.');
      files.push({path: file.path, content: file.content === null ? null : store.text.nfc(file.content), binary: false});
    }
    const nextTree = {...parentTree};
    for (const file of files) {
      if (file.content === null) delete nextTree[file.path];
      else nextTree[file.path] = {path: file.path, content: file.content, binary: false};
    }
    store.assertTreeSize(nextTree);
    const stat = store.graph.diffTrees(parentTree, nextTree);
    const sha = require('node:crypto').createHash('sha256').update(JSON.stringify({repo: args.repo, parent: branch.sha, message: args.message, files})).digest('hex').slice(0, 12);
    if (store.graph.commitBySha(data, args.repo, sha)) fail('already_exists', 'already_exists: That commit is already stored.');
    const commit = {
      sha,
      repo: args.repo,
      parents: [branch.sha],
      author_account_id: data.account_id,
      message: store.text.nfc(args.message),
      committed_at: ctx.virtual_now,
      files,
      changed_lines: stat.changed_lines,
      paths: stat.paths
    };
    data.commits.push(commit);
    branch.sha = sha;
    branch.updated_at = ctx.virtual_now;
    for (const pull of data.pulls) {
      if (pull.head_repo === args.repo && pull.head_branch === args.branch && (pull.state === 'open' || pull.state === 'draft')) {
        pull.head_sha = sha;
        pull.paths = store.graph.diffTrees(store.graph.treeAt(data, pull.repo, pull.base_sha), nextTree).paths;
        store.touch(ctx, pull);
      }
    }
    log(ctx, 'forkyard.commit_pushed', {record_id: sha});
    return {sha, changed_lines: stat.changed_lines, paths: stat.paths, url: store.publicUrl('repo', args.repo)};
  },
  'forkyard.issues.comment'(ctx, data, args) {
    const comment = store.addComment(ctx, data, {repo: args.repo, target: 'issue', number: args.number, body: args.text, author_account_id: data.account_id, request_id: args.request_id});
    return {comment_id: comment.comment_id, revision: comment.revision, url: store.publicUrl('issue', args.repo, args.number)};
  },
  'forkyard.pulls.open'(ctx, data, args) {
    const pull = openPull(ctx, data, {...args, author_account_id: data.account_id, from_event: false});
    return {repo: pull.repo, number: pull.number, state: pull.state, revision: pull.revision, url: store.publicUrl('pull', pull.repo, pull.number)};
  },
  'forkyard.pulls.update'(ctx, data, args) {
    const pull = store.pullOf(data, args.repo, args.number);
    if (pull.author_account_id !== data.account_id) fail('no_push_access', 'no_push_access: Only the author updates this pull request.');
    requireRevision(pull, args.expected_revision, 'stale_version');
    if (pull.state === 'merged') fail('already_merged', 'already_merged: Merged pull requests keep their description history.');
    if (pull.state === 'closed') fail('invalid_state', 'invalid_state: Closed pull requests keep their description history.');
    if (args.title === undefined && args.body === undefined && args.draft === undefined) fail('invalid_arguments', 'invalid_arguments: Update needs a title, body or draft flag.');
    if (args.title !== undefined) pull.title = store.text.nfc(args.title);
    if (args.body !== undefined) pull.body = store.text.nfc(args.body);
    if (args.draft !== undefined) pull.state = args.draft ? 'draft' : 'open';
    pull.revision += 1;
    store.touch(ctx, pull);
    const revision = store.storedRevision(pull.body, pull.revision, ctx.virtual_now, args.request_id, null);
    revision.title = pull.title;
    revision.draft = pull.state === 'draft';
    pull.revisions.push(revision);
    return {repo: pull.repo, number: pull.number, revision: pull.revision, url: store.publicUrl('pull', pull.repo, pull.number)};
  },
  'forkyard.pulls.comment'(ctx, data, args) {
    const comment = store.addComment(ctx, data, {repo: args.repo, target: 'pull', number: args.number, body: args.text, author_account_id: data.account_id, request_id: args.request_id});
    return {comment_id: comment.comment_id, revision: comment.revision, url: store.publicUrl('pull', args.repo, args.number)};
  },
  'forkyard.pulls.review_reply'(ctx, data, args) {
    const parent = store.commentOf(data, args.in_reply_to);
    if (parent.repo !== args.repo || parent.number !== args.number) fail('not_found', 'not_found: That comment is on a different pull request.');
    const comment = store.addComment(ctx, data, {repo: args.repo, target: 'pull', number: args.number, body: args.text, author_account_id: data.account_id, request_id: args.request_id, in_reply_to: parent.comment_id, path: parent.path, line: parent.line, review_id: parent.review_id});
    return {comment_id: comment.comment_id, revision: comment.revision};
  },
  'forkyard.pulls.request_review'(ctx, data, args) {
    const pull = store.pullOf(data, args.repo, args.number);
    if (pull.author_account_id !== data.account_id && !store.canPush(store.roleOf(data, store.repoOf(data, args.repo), data.account_id))) {
      fail('no_push_access', 'no_push_access: You cannot request review on this pull request.');
    }
    store.account(data, args.reviewer);
    if (!pull.reviewers.includes(args.reviewer)) pull.reviewers.push(args.reviewer);
    store.touch(ctx, pull);
    store.addTimeline(ctx, data, {repo: args.repo, number: args.number, actor_account_id: data.account_id, kind: 'review_requested', text: args.reviewer});
    store.addNotification(ctx, data, {
      account_id: args.reviewer,
      kind: 'review_requested',
      repo: args.repo,
      number: args.number,
      text: 'Review requested on ' + args.repo + '#' + args.number + '.',
      mail: {
        object_type: 'pull_request',
        object_id: store.objectId(args.repo, args.number),
        title: '[' + args.repo + '] Review requested on PR #' + args.number,
        text: 'A review was requested from you on ' + args.repo + '#' + args.number + '.'
      }
    });
    return {repo: args.repo, number: args.number, reviewers: pull.reviewers.slice()};
  },
  'forkyard.pulls.reopen'(ctx, data, args) {
    const pull = store.pullOf(data, args.repo, args.number);
    const repo = store.repoOf(data, args.repo);
    if (pull.state === 'merged') fail('already_merged', 'already_merged: Merged pull requests stay merged.');
    if (pull.state !== 'closed') fail('reopen_not_allowed', 'reopen_not_allowed: Only a closed pull request can be reopened.');
    if (!data.branches.some(item => item.repo === pull.head_repo && item.name === pull.head_branch)) {
      fail('head_branch_deleted', 'head_branch_deleted: The head branch is gone.');
    }
    const role = store.roleOf(data, repo, data.account_id);
    const allowed = repo.reopen_policy === 'author_or_maintainer'
      ? (pull.author_account_id === data.account_id || store.isMaintainer(role))
      : store.isMaintainer(role);
    if (!allowed) fail('reopen_not_allowed', 'reopen_not_allowed: Reopen policy is ' + repo.reopen_policy + '.');
    pull.state = 'open';
    pull.closed_at = null;
    store.touch(ctx, pull);
    store.addTimeline(ctx, data, {repo: args.repo, number: args.number, actor_account_id: data.account_id, kind: 'reopened', text: data.account_id});
    return {repo: pull.repo, number: pull.number, state: pull.state};
  },
  'forkyard.pulls.close'(ctx, data, args) {
    const pull = store.pullOf(data, args.repo, args.number);
    if (pull.author_account_id !== data.account_id) fail('no_push_access', 'no_push_access: Only the author closes this pull request through the agent tool.');
    store.closePull(ctx, data, pull, data.account_id, args.comment || '', args.request_id, null);
    return {repo: pull.repo, number: pull.number, state: pull.state};
  },
  'forkyard.comments.edit'(ctx, data, args) {
    const comment = store.commentOf(data, args.comment_id);
    if (comment.author_account_id !== data.account_id) fail('no_push_access', 'no_push_access: Only the author edits this comment.');
    if (comment.deleted) fail('invalid_state', 'invalid_state: Deleted comments stay on record and are not edited.');
    requireRevision(comment, args.expected_revision, 'stale_version');
    store.assertCommentLength(args.text, 'comment_too_long');
    comment.body = store.text.nfc(args.text);
    comment.revision += 1;
    comment.updated_at = ctx.virtual_now;
    comment.revisions.push(store.storedRevision(comment.body, comment.revision, ctx.virtual_now, args.request_id, null));
    return {comment_id: comment.comment_id, revision: comment.revision};
  },
  'forkyard.comments.delete'(ctx, data, args) {
    const comment = store.commentOf(data, args.comment_id);
    if (comment.author_account_id !== data.account_id) fail('no_push_access', 'no_push_access: Only the author deletes this comment.');
    requireRevision(comment, args.expected_revision, 'stale_version');
    comment.deleted = true;
    comment.revision += 1;
    comment.updated_at = ctx.virtual_now;
    const revision = store.storedRevision(comment.body, comment.revision, ctx.virtual_now, args.request_id, null);
    revision.deleted = true;
    comment.revisions.push(revision);
    return {comment_id: comment.comment_id, revision: comment.revision, deleted: true};
  },
  'forkyard.reactions.set'(ctx, data, args) {
    const comment = store.commentOf(data, args.comment_id);
    const existing = data.reactions.find(item => item.comment_id === args.comment_id && item.actor_account_id === data.account_id && item.name === args.name);
    if (args.active && !existing) {
      data.reactions.push({reaction_id: 'rxn-' + store.bump(data, 'reaction'), comment_id: args.comment_id, actor_account_id: data.account_id, name: args.name, created_at: ctx.virtual_now});
    }
    if (!args.active && existing) data.reactions = data.reactions.filter(item => item !== existing);
    return {comment_id: comment.comment_id, name: args.name, active: !!args.active};
  },
  'forkyard.people.follow'(ctx, data, args) {
    const target = store.account(data, args.account_id);
    if (target.account_id === data.account_id) fail('cannot_follow_self', 'cannot_follow_self: An account does not follow itself.');
    if (data.follows.some(item => item.follower_account_id === data.account_id && item.target_account_id === target.account_id)) {
      fail('already_following', 'already_following: Already following ' + target.handle + '.');
    }
    data.follows.push({follower_account_id: data.account_id, target_account_id: target.account_id, created_at: ctx.virtual_now});
    return {account_id: target.account_id, following: true};
  },
  'forkyard.people.unfollow'(ctx, data, args) {
    store.account(data, args.account_id);
    const before = data.follows.length;
    data.follows = data.follows.filter(item => !(item.follower_account_id === data.account_id && item.target_account_id === args.account_id));
    if (data.follows.length === before) fail('not_found', 'not_found: Not following that account.');
    return {account_id: args.account_id, following: false};
  },
  'forkyard.people.block'(ctx, data, args) {
    const target = store.account(data, args.account_id);
    if (target.account_id === data.account_id) fail('invalid_arguments', 'invalid_arguments: An account does not block itself.');
    if (!data.blocks.some(item => item.blocker_account_id === data.account_id && item.target_account_id === target.account_id)) {
      data.blocks.push({blocker_account_id: data.account_id, target_account_id: target.account_id, created_at: ctx.virtual_now});
    }
    data.follows = data.follows.filter(item => !((item.follower_account_id === data.account_id && item.target_account_id === target.account_id) || (item.follower_account_id === target.account_id && item.target_account_id === data.account_id)));
    return {account_id: target.account_id, blocked: true};
  },
  'forkyard.people.unblock'(ctx, data, args) {
    store.account(data, args.account_id);
    data.blocks = data.blocks.filter(item => !(item.blocker_account_id === data.account_id && item.target_account_id === args.account_id));
    return {account_id: args.account_id, blocked: false};
  },
  'forkyard.profile.update_self'(ctx, data, args) {
    const me = store.account(data, data.account_id);
    requireRevision(me, args.expected_revision, 'stale_version');
    if (args.display_name !== undefined) me.display_name = store.text.nfc(args.display_name);
    if (args.bio !== undefined) me.bio = store.text.nfc(args.bio);
    if (args.location !== undefined) me.location = store.text.nfc(args.location);
    if (args.links !== undefined) me.links = args.links.map(link => store.text.nfc(link));
    me.revision += 1;
    return {account_id: me.account_id, revision: me.revision, url: store.publicUrl('profile', null, null, me.handle)};
  },
  'forkyard.notifications.mark_read'(ctx, data, args) {
    const note = data.notifications.find(item => item.notification_id === args.notification_id && item.account_id === data.account_id);
    if (!note) fail('not_found', 'not_found: Notification does not exist on this account.');
    note.unread = false;
    note.read_at = ctx.virtual_now;
    return {notification_id: note.notification_id, unread: false};
  },
  'forkyard.tags.create'(ctx, data, args) {
    const repo = store.repoOf(data, args.repo);
    store.assertPush(data, repo, data.account_id);
    if (data.tags.some(item => item.repo === args.repo && item.name === args.name)) fail('tag_exists', 'tag_exists: Tag ' + args.name + ' already exists.');
    store.graph.requireCommit(data, args.repo, args.sha);
    data.tags.push({repo: args.repo, name: args.name, target_sha: args.sha, message: store.text.nfc(args.message || ''), tagger_account_id: data.account_id, created_at: ctx.virtual_now});
    return {repo: args.repo, name: args.name, target_sha: args.sha};
  },
  'forkyard.releases.create_draft'(ctx, data, args) {
    const repo = store.repoOf(data, args.repo);
    store.assertPush(data, repo, data.account_id);
    if (!data.tags.some(item => item.repo === args.repo && item.name === args.tag)) fail('tag_not_found', 'tag_not_found: Tag ' + args.tag + ' is not in ' + args.repo + '.');
    const release = {
      release_id: 'rel-' + store.bump(data, 'release'),
      repo: args.repo,
      tag: args.tag,
      title: store.text.nfc(args.title),
      notes: store.text.nfc(args.notes),
      revision: 1,
      status: 'draft',
      prerelease: !!args.prerelease,
      latest: false,
      assets: (args.assets || []).map(asset => ({...asset})),
      published_at: null,
      receipt: null,
      created_at: ctx.virtual_now,
      updated_at: ctx.virtual_now,
      revisions: [{revision: 1, notes: store.text.nfc(args.notes), title: store.text.nfc(args.title), at: ctx.virtual_now, request_id: args.request_id}]
    };
    data.releases.push(release);
    return {release_id: release.release_id, revision: 1, status: 'draft'};
  },
  'forkyard.releases.update_draft'(ctx, data, args) {
    const release = store.releaseOf(data, args.release_id);
    store.assertPush(data, store.repoOf(data, release.repo), data.account_id);
    if (release.status !== 'draft') fail('not_a_draft', 'not_a_draft: Published releases are immutable.');
    requireRevision(release, args.expected_revision, 'revision_mismatch');
    if (args.title !== undefined) release.title = store.text.nfc(args.title);
    if (args.notes !== undefined) release.notes = store.text.nfc(args.notes);
    if (args.assets !== undefined) release.assets = args.assets.map(asset => ({...asset}));
    if (args.prerelease !== undefined) release.prerelease = args.prerelease;
    release.revision += 1;
    release.updated_at = ctx.virtual_now;
    release.revisions.push({revision: release.revision, notes: release.notes, title: release.title, at: ctx.virtual_now, request_id: args.request_id});
    return {release_id: release.release_id, revision: release.revision, status: 'draft'};
  },
  'forkyard.releases.publish'(ctx, data, args) {
    const release = store.releaseOf(data, args.release_id);
    store.assertPush(data, store.repoOf(data, release.repo), data.account_id);
    if (release.status === 'published') fail('already_published', 'already_published: Release ' + release.release_id + ' is already published.');
    requireRevision(release, args.expected_revision, 'revision_mismatch');
    publishRelease(ctx, data, release, data.account_id, args.request_id, null);
    return {release_id: release.release_id, status: 'published', published_at: release.published_at, receipt: store.copy(release.receipt), url: store.publicUrl('release', release.repo, release.tag)};
  },
  'forkyard.releases.delete_draft'(ctx, data, args) {
    const release = store.releaseOf(data, args.release_id);
    store.assertPush(data, store.repoOf(data, release.repo), data.account_id);
    if (release.status !== 'draft') fail('not_a_draft', 'not_a_draft: Only a draft can be deleted.');
    requireRevision(release, args.expected_revision, 'revision_mismatch');
    data.releases = data.releases.filter(item => item.release_id !== release.release_id);
    return {release_id: release.release_id, deleted: true};
  }
};

function publishRelease(ctx, data, release, actorId, requestId, eventId) {
  release.status = 'published';
  release.published_at = ctx.virtual_now;
  release.updated_at = ctx.virtual_now;
  if (!release.prerelease) {
    for (const other of data.releases) if (other.repo === release.repo && other.release_id !== release.release_id) other.latest = false;
    release.latest = true;
  }
  release.receipt = {request_id: requestId || eventId, revision: release.revision, published_at: release.published_at};
  store.addTimeline(ctx, data, {repo: release.repo, number: null, actor_account_id: actorId, kind: 'release_published', text: release.tag + ' ' + release.title});
  for (const role of store.repoOf(data, release.repo).roles) {
    store.addNotification(ctx, data, {
      account_id: role.account_id,
      kind: 'release_published',
      repo: release.repo,
      number: null,
      text: release.tag + ' was published on ' + release.repo + '.',
      mail: {
        object_type: 'release',
        object_id: release.release_id,
        title: '[' + release.repo + '] ' + release.tag + ' published',
        text: release.title + '\n\n' + release.notes
      }
    });
  }
}

function handleTool(ctx, data, name, args) {
  if (read[name]) {
    const result = read[name](ctx, data, args);
    log(ctx, name, {read: true});
    return {data, result};
  }
  if (!write[name]) fail('unknown_tool', 'unknown_tool: Unknown Forkyard operation.');
  const result = write[name](ctx, data, args);
  return {data, result};
}

module.exports = {handleTool, openPull, publishRelease, parseHead};
