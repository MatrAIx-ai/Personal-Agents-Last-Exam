'use strict';
const store = require('./store.cjs');
const {openPull, publishRelease} = require('./operations.cjs');
const {fail, log} = store;

function actor(data, id) {
  return store.account(data, id);
}

function applyEvent(ctx, data, event) {
  const payload = event.payload;
  const at = event.at;
  if (Date.parse(at) < Date.parse(ctx.virtual_now)) fail('invalid_event', 'invalid_event: Event time is behind the App clock.');
  ctx = {...ctx, virtual_now: at};
  if (event.operation === 'pull.closed') {
    const pull = store.pullOf(data, payload.repo, payload.number);
    store.assertMaintainer(data, store.repoOf(data, payload.repo), payload.actor_account_id);
    actor(data, payload.actor_account_id);
    if (pull.state === 'merged') fail('already_merged', 'already_merged: A merged pull request cannot be closed again.');
    store.closePull(ctx, data, pull, payload.actor_account_id, payload.comment || '', null, event.event_id);
  } else if (event.operation === 'pull.merged') {
    const pull = store.pullOf(data, payload.repo, payload.number);
    const repo = store.repoOf(data, payload.repo);
    store.assertMaintainer(data, repo, payload.actor_account_id);
    if (pull.state !== 'open' && pull.state !== 'draft') fail('not_open', 'not_open: Only an open pull request can be merged.');
    const branch = store.branchOf(data, payload.repo, pull.base_branch);
    const headCommits = [...store.graph.reachable(data, pull.head_repo, pull.head_sha)];
    for (const sha of headCommits) {
      if (!store.graph.commitBySha(data, payload.repo, sha)) {
        const source = store.graph.requireCommit(data, pull.head_repo, sha);
        data.commits.push({...store.copy(source), repo: payload.repo});
      }
    }
    const comparison = store.graph.compareShas(data, payload.repo, branch.sha, pull.head_sha);
    if (!comparison.base_is_ancestor) {
      const mergeSha = require('node:crypto').createHash('sha256').update(JSON.stringify({merge: pull.repo, number: pull.number, base: branch.sha, head: pull.head_sha})).digest('hex').slice(0, 12);
      if (!store.graph.commitBySha(data, payload.repo, mergeSha)) {
        const headTree = store.graph.treeAt(data, pull.head_repo, pull.head_sha);
        const baseTree = store.graph.treeAt(data, payload.repo, branch.sha);
        const files = Object.entries(headTree).map(([path, file]) => ({path, content: file.binary ? '' : file.content, binary: !!file.binary}));
        for (const path of Object.keys(baseTree)) if (!headTree[path]) files.push({path, content: null, binary: false});
        const commit = {
          sha: mergeSha,
          repo: payload.repo,
          parents: [branch.sha, pull.head_sha],
          author_account_id: payload.actor_account_id,
          message: 'Merge pull request #' + pull.number + ' from ' + pull.head_repo + ':' + pull.head_branch,
          committed_at: at,
          files,
          changed_lines: 0,
          paths: []
        };
        data.commits.push(commit);
        const stat = store.graph.commitStat(data, commit);
        commit.changed_lines = stat.changed_lines;
        commit.paths = stat.paths;
      }
      branch.sha = mergeSha;
    } else branch.sha = pull.head_sha;
    branch.updated_at = at;
    pull.state = 'merged';
    pull.merged_at = at;
    pull.base_sha = branch.sha;
    store.touch(ctx, pull);
    store.addTimeline(ctx, data, {repo: pull.repo, number: pull.number, actor_account_id: payload.actor_account_id, kind: 'merged', text: 'Merged.'});
    const who = actor(data, payload.actor_account_id);
    const body = '@' + who.handle + ' merged your pull request "' + pull.title + '" at ' + store.text.clockHm(at) + '.';
    store.notifyAuthor(ctx, data, pull, 'pull_merged', payload.actor_account_id, body, body);
  } else if (event.operation === 'pull.reopened') {
    const pull = store.pullOf(data, payload.repo, payload.number);
    store.assertMaintainer(data, store.repoOf(data, payload.repo), payload.actor_account_id);
    if (pull.state !== 'closed') fail('invalid_event', 'invalid_event: Only a closed pull request can be reopened.');
    if (!data.branches.some(item => item.repo === pull.head_repo && item.name === pull.head_branch)) {
      fail('head_branch_deleted', 'head_branch_deleted: The head branch is gone.');
    }
    pull.state = 'open';
    pull.closed_at = null;
    store.touch(ctx, pull);
    store.addTimeline(ctx, data, {repo: pull.repo, number: pull.number, actor_account_id: payload.actor_account_id, kind: 'reopened', text: payload.actor_account_id});
  } else if (event.operation === 'pull.review_submitted') {
    const pull = store.pullOf(data, payload.repo, payload.number);
    actor(data, payload.actor_account_id);
    const diff = store.graph.diffTrees(store.graph.treeAt(data, pull.repo, pull.base_sha), store.graph.treeAt(data, pull.head_repo, pull.head_sha));
    for (const line of payload.lines || []) {
      if (!diff.paths.includes(line.path)) fail('invalid_event', 'invalid_event: ' + line.path + ' is outside the diff.');
      const file = store.graph.treeAt(data, pull.head_repo, pull.head_sha)[line.path];
      const count = file && !file.binary ? file.content.split('\n').length : 0;
      if (!Number.isInteger(line.line) || line.line < 1 || line.line > count) fail('invalid_event', 'invalid_event: Line ' + line.line + ' is outside ' + line.path + '.');
    }
    const review = {
      review_id: 'rev-' + store.bump(data, 'review'),
      repo: payload.repo,
      number: payload.number,
      author_account_id: payload.actor_account_id,
      state: payload.state,
      body: store.text.nfc(payload.body),
      created_at: at
    };
    data.reviews.push(review);
    if (payload.body) {
      store.addComment(ctx, data, {repo: payload.repo, target: 'pull', number: payload.number, body: payload.body, author_account_id: payload.actor_account_id, event_id: event.event_id, from_event: true, review_id: review.review_id});
    }
    for (const line of payload.lines || []) {
      store.addComment(ctx, data, {repo: payload.repo, target: 'pull', number: payload.number, body: line.body, author_account_id: payload.actor_account_id, event_id: event.event_id, from_event: true, review_id: review.review_id, path: line.path, line: line.line});
    }
    store.addTimeline(ctx, data, {repo: payload.repo, number: payload.number, actor_account_id: payload.actor_account_id, kind: 'review_' + payload.state, text: payload.body});
    const who = actor(data, payload.actor_account_id);
    const body = '@' + who.handle + ' reviewed your pull request "' + pull.title + '" (' + payload.state + ').\n\n' + payload.body;
    store.notifyAuthor(ctx, data, pull, 'pull_reviewed', payload.actor_account_id, body, body);
  } else if (event.operation === 'pull.locked') {
    const pull = store.pullOf(data, payload.repo, payload.number);
    store.assertMaintainer(data, store.repoOf(data, payload.repo), payload.actor_account_id);
    pull.locked = payload.locked;
    pull.lock_reason = payload.reason || null;
    store.touch(ctx, pull);
    store.addTimeline(ctx, data, {repo: payload.repo, number: payload.number, actor_account_id: payload.actor_account_id, kind: payload.locked ? 'locked' : 'unlocked', text: payload.reason || ''});
  } else if (event.operation === 'pull.opened_by_other') {
    openPull(ctx, data, {repo: payload.repo, head: payload.head, base: payload.base || store.repoOf(data, payload.repo).default_branch, title: payload.title, body: payload.body, draft: !!payload.draft, author_account_id: payload.actor_account_id, event_id: event.event_id, from_event: true});
  } else if (event.operation === 'comment.post') {
    store.addComment(ctx, data, {repo: payload.repo, target: payload.target, number: payload.number, body: payload.text, author_account_id: payload.actor_account_id, event_id: event.event_id, from_event: true});
  } else if (event.operation === 'issue.opened') {
    const repo = store.repoOf(data, payload.repo);
    store.assertActive(repo);
    actor(data, payload.actor_account_id);
    const number = store.nextTopic(data, 'issue', payload.repo);
    data.issues.push({
      repo: payload.repo,
      number,
      title: store.text.nfc(payload.title),
      body: store.text.nfc(payload.body),
      state: 'open',
      author_account_id: payload.actor_account_id,
      created_at: at,
      updated_at: at,
      closed_at: null
    });
    store.addTimeline(ctx, data, {repo: payload.repo, number, actor_account_id: payload.actor_account_id, kind: 'issue_opened', text: payload.title});
  } else if (event.operation === 'repo.settings_changed') {
    const repo = store.repoOf(data, payload.repo);
    store.assertMaintainer(data, repo, payload.actor_account_id);
    if (payload.reopen_policy !== undefined && !['author_or_maintainer', 'maintainers_only'].includes(payload.reopen_policy)) {
      fail('invalid_event', 'invalid_event: Unknown reopen policy.');
    }
    if (payload.contributing_text !== undefined) repo.contributing_text = store.text.nfc(payload.contributing_text);
    if (payload.reopen_policy !== undefined) repo.reopen_policy = payload.reopen_policy;
    if (payload.interaction_limit !== undefined) repo.interaction_limit = payload.interaction_limit;
    repo.updated_at = at;
    store.addTimeline(ctx, data, {repo: payload.repo, number: null, actor_account_id: payload.actor_account_id, kind: 'settings_changed', text: 'Repository settings changed.'});
  } else if (event.operation === 'repo.block_account') {
    const repo = store.repoOf(data, payload.repo);
    store.assertMaintainer(data, repo, payload.actor_account_id);
    actor(data, payload.blocked_account_id);
    const owner = repo.roles.find(item => item.role === 'owner');
    if (owner && owner.account_id === payload.blocked_account_id && payload.blocked) fail('invalid_event', 'invalid_event: The owner cannot be blocked.');
    const has = repo.blocked_accounts.includes(payload.blocked_account_id);
    if (payload.blocked && !has) repo.blocked_accounts.push(payload.blocked_account_id);
    if (!payload.blocked) repo.blocked_accounts = repo.blocked_accounts.filter(id => id !== payload.blocked_account_id);
    repo.updated_at = at;
  } else if (event.operation === 'release.published') {
    const repo = store.repoOf(data, payload.repo);
    store.assertPush(data, repo, payload.actor_account_id);
    let release = payload.release_id ? store.releaseOf(data, payload.release_id) : null;
    if (release && release.status === 'published') fail('already_published', 'already_published: Release is already published.');
    if (!release) {
      const tag = data.tags.find(item => item.repo === payload.repo && item.name === payload.tag);
      if (!tag) fail('tag_not_found', 'tag_not_found: Tag ' + payload.tag + ' is not in ' + payload.repo + '.');
      release = {
        release_id: 'rel-' + store.bump(data, 'release'),
        repo: payload.repo,
        tag: payload.tag,
        title: store.text.nfc(payload.title),
        notes: store.text.nfc(payload.notes),
        revision: 1,
        status: 'draft',
        prerelease: !!payload.prerelease,
        latest: false,
        assets: store.copy(payload.assets || []),
        published_at: null,
        receipt: null,
        created_at: at,
        updated_at: at,
        revisions: [{revision: 1, notes: store.text.nfc(payload.notes), title: store.text.nfc(payload.title), at, request_id: event.event_id}]
      };
      data.releases.push(release);
    }
    publishRelease(ctx, data, release, payload.actor_account_id, null, event.event_id);
  } else if (event.operation === 'tag.created_by_other') {
    const repo = store.repoOf(data, payload.repo);
    store.assertPush(data, repo, payload.actor_account_id);
    if (data.tags.some(item => item.repo === payload.repo && item.name === payload.tag)) fail('tag_exists', 'tag_exists: Tag already exists.');
    store.graph.requireCommit(data, payload.repo, payload.target_sha);
    data.tags.push({repo: payload.repo, name: payload.tag, target_sha: payload.target_sha, message: store.text.nfc(payload.message || ''), tagger_account_id: payload.actor_account_id, created_at: at});
  } else if (event.operation === 'commits.pushed_by_other') {
    const repo = store.repoOf(data, payload.repo);
    store.assertPush(data, repo, payload.actor_account_id);
    const branch = store.branchOf(data, payload.repo, payload.branch);
    let parent = branch.sha;
    for (const item of payload.commits) {
      if (item.parents.some(sha => sha !== parent && !store.graph.commitBySha(data, payload.repo, sha) && !payload.commits.some(other => other.sha === sha))) {
        fail('invalid_event', 'invalid_event: Parent ' + item.parents.join(',') + ' is not in ' + payload.repo + '.');
      }
      if (!item.parents.includes(parent) && item.parents[0] !== parent) {
        // The first parent of a pushed commit is the previous tip, or a parent already stored.
      }
      if (store.graph.commitBySha(data, payload.repo, item.sha)) fail('invalid_event', 'invalid_event: Commit ' + item.sha + ' already exists.');
      data.commits.push({
        sha: item.sha,
        repo: payload.repo,
        parents: item.parents.slice(),
        author_account_id: payload.actor_account_id,
        message: store.text.nfc(item.message),
        committed_at: at,
        files: item.files.map(file => ({path: file.path, content: file.content === null ? null : store.text.nfc(file.content), binary: !!file.binary})),
        changed_lines: 0,
        paths: item.files.map(file => file.path)
      });
      const commit = data.commits[data.commits.length - 1];
      const stat = store.graph.commitStat(data, commit);
      commit.changed_lines = stat.changed_lines;
      commit.paths = stat.paths;
      parent = item.sha;
    }
    branch.sha = parent;
    branch.updated_at = at;
  } else if (event.operation === 'checks.update') {
    store.graph.requireCommit(data, payload.repo, payload.sha);
    if (payload.conclusion && payload.status !== 'completed') fail('invalid_event', 'invalid_event: conclusion requires status completed.');
    if (payload.status === 'completed' && !payload.conclusion) fail('invalid_event', 'invalid_event: A completed check needs a conclusion.');
    let check = data.checks.find(item => item.repo === payload.repo && item.sha === payload.sha && item.name === payload.name);
    if (!check) {
      check = {repo: payload.repo, sha: payload.sha, name: payload.name, status: payload.status, conclusion: payload.conclusion || null, completed_at: payload.completed_at || null};
      data.checks.push(check);
    }
    check.status = payload.status;
    check.conclusion = payload.status === 'completed' ? payload.conclusion : null;
    check.completed_at = payload.status === 'completed' ? (payload.completed_at || at) : null;
  } else if (event.operation === 'notice.delivery_result') {
    const notice = data.notices.find(item => item.notice_id === payload.notice_id);
    if (!notice) fail('notice_not_found', 'notice_not_found: Notice ' + payload.notice_id + ' does not exist.');
    if (notice.status === 'committed' && payload.status === 'rejected') fail('delivery_status_conflict', 'delivery_status_conflict: A committed notice cannot be marked rejected.');
    notice.status = payload.status;
    notice.publish_request_id = payload.publish_request_id;
    notice.messaging_event_id = payload.event_id || null;
  } else fail('invalid_event', 'invalid_event: Unsupported operation.');
  log(ctx, 'forkyard.' + event.operation, {event_id: event.event_id});
  return data;
}

module.exports = {applyEvent};
