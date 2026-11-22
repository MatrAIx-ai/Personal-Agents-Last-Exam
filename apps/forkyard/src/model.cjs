'use strict';
const {references, fail} = require('./domain-utils.cjs');
const store = require('./store.cjs');

function validateSeed(ctx, data) {
  references(ctx, data);
  if (!data.accounts.some(item => item.account_id === data.account_id && item.person_id === data.owner_person_id)) {
    fail('invalid_seed', 'invalid_seed: The bound account must exist and carry the owner person id.');
  }
  const accounts = new Set(data.accounts.map(item => item.account_id));
  const handles = new Set();
  for (const item of data.accounts) {
    if (handles.has(item.handle)) fail('invalid_seed', 'invalid_seed: Duplicate handle ' + item.handle + '.');
    handles.add(item.handle);
    if (!Number.isInteger(item.revision) || item.revision < 1) fail('invalid_seed', 'invalid_seed: Account revision must start at 1.');
  }
  const repos = new Set();
  for (const repo of data.repositories) {
    if (repos.has(repo.repo)) fail('invalid_seed', 'invalid_seed: Duplicate repository ' + repo.repo + '.');
    repos.add(repo.repo);
    if (!repo.roles.some(role => role.role === 'owner')) fail('invalid_seed', 'invalid_seed: ' + repo.repo + ' needs an owner.');
    for (const role of repo.roles) if (!accounts.has(role.account_id)) fail('invalid_seed', 'invalid_seed: Role account missing on ' + repo.repo + '.');
    for (const blocked of repo.blocked_accounts) if (!accounts.has(blocked)) fail('invalid_seed', 'invalid_seed: Blocked account missing on ' + repo.repo + '.');
    if (!Number.isInteger(data.counters.pull[repo.repo]) || !Number.isInteger(data.counters.issue[repo.repo])) {
      fail('invalid_seed', 'invalid_seed: Missing number counters for ' + repo.repo + '.');
    }
  }
  const shas = new Set();
  for (const commit of data.commits) {
    if (!repos.has(commit.repo)) fail('invalid_seed', 'invalid_seed: Commit repo missing.');
    if (!accounts.has(commit.author_account_id)) fail('invalid_seed', 'invalid_seed: Commit author missing.');
    const key = commit.repo + '@' + commit.sha;
    if (shas.has(key)) fail('invalid_seed', 'invalid_seed: Duplicate commit ' + key + '.');
    shas.add(key);
  }
  for (const commit of data.commits) {
    for (const parent of commit.parents) {
      if (!data.commits.some(item => item.repo === commit.repo && item.sha === parent)) {
        fail('invalid_seed', 'invalid_seed: Missing parent ' + parent + ' in ' + commit.repo + '.');
      }
    }
    const stat = store.graph.commitStat(data, commit);
    if (stat.changed_lines !== commit.changed_lines) {
      fail('invalid_seed', 'invalid_seed: changed_lines for ' + commit.sha + ' is ' + commit.changed_lines + ' and the tree diff is ' + stat.changed_lines + '.');
    }
  }
  for (const branch of data.branches) {
    if (!data.commits.some(item => item.repo === branch.repo && item.sha === branch.sha)) fail('invalid_seed', 'invalid_seed: Branch ' + branch.name + ' points nowhere.');
  }
  for (const tag of data.tags) {
    if (!accounts.has(tag.tagger_account_id)) fail('invalid_seed', 'invalid_seed: Tagger missing.');
    if (!data.commits.some(item => item.repo === tag.repo && item.sha === tag.target_sha)) fail('invalid_seed', 'invalid_seed: Tag target missing.');
  }
  for (const release of data.releases) {
    if (!data.tags.some(tag => tag.repo === release.repo && tag.name === release.tag)) fail('invalid_seed', 'invalid_seed: Release tag missing.');
    if (!release.revisions.length || release.revisions[release.revisions.length - 1].revision !== release.revision) {
      fail('invalid_seed', 'invalid_seed: Release revisions must end at the current revision.');
    }
    if (release.status === 'published' && !release.published_at) fail('invalid_seed', 'invalid_seed: A published release needs published_at.');
    if (release.status === 'draft' && release.published_at) fail('invalid_seed', 'invalid_seed: A draft has no published_at.');
  }
  for (const check of data.checks) {
    if (!data.commits.some(item => item.repo === check.repo && item.sha === check.sha)) fail('invalid_seed', 'invalid_seed: Check commit missing.');
    if (check.status === 'completed' && !check.conclusion) fail('invalid_seed', 'invalid_seed: Completed checks need a conclusion.');
    if (check.status !== 'completed' && check.conclusion) fail('invalid_seed', 'invalid_seed: An open check has no conclusion.');
  }
  const repoNames = new Set(data.repositories.map(item => item.repo));
  for (const issue of data.issues) {
    if (!repoNames.has(issue.repo)) fail('invalid_seed', 'invalid_seed: Issue ' + issue.repo + '#' + issue.number + ' has no repository.');
    if (!accounts.has(issue.author_account_id)) fail('invalid_seed', 'invalid_seed: Issue author missing.');
    if (issue.number >= data.counters.issue[issue.repo]) fail('invalid_seed', 'invalid_seed: Issue number is not below the counter.');
    if ((issue.state === 'closed') !== (issue.closed_at !== null)) fail('invalid_seed', 'invalid_seed: Issue closed time must agree with state.');
  }
  for (const pull of data.pulls) {
    if (!repoNames.has(pull.repo)) fail('invalid_seed', 'invalid_seed: Pull request ' + pull.repo + '#' + pull.number + ' has no repository.');
    if (!repoNames.has(pull.head_repo)) fail('invalid_seed', 'invalid_seed: Pull request ' + pull.repo + '#' + pull.number + ' has no head repository.');
    if (!accounts.has(pull.author_account_id)) fail('invalid_seed', 'invalid_seed: Pull author missing.');
    if (pull.number >= data.counters.pull[pull.repo]) fail('invalid_seed', 'invalid_seed: Pull number is not below the counter.');
    if (!data.commits.some(item => item.repo === pull.head_repo && item.sha === pull.head_sha)) fail('invalid_seed', 'invalid_seed: Pull head commit missing.');
    if (!data.commits.some(item => item.repo === pull.repo && item.sha === pull.base_sha)) fail('invalid_seed', 'invalid_seed: Pull base commit missing.');
    if (!pull.revisions.length || pull.revisions[pull.revisions.length - 1].body !== pull.body) fail('invalid_seed', 'invalid_seed: Pull revisions must retain the current body.');
    if ((pull.state === 'closed') !== (pull.closed_at !== null)) fail('invalid_seed', 'invalid_seed: Closed time must agree with pull state.');
    if ((pull.state === 'merged') !== (pull.merged_at !== null)) fail('invalid_seed', 'invalid_seed: Merge time must agree with pull state.');
  }
  const seenIds = new Set();
  function claim(kind, value) {
    const key = kind + ':' + value;
    if (seenIds.has(key)) fail('invalid_seed', 'invalid_seed: Duplicate ' + kind + ' ' + value + '.');
    seenIds.add(key);
  }
  for (const item of data.accounts) claim('account', item.account_id);
  for (const item of data.branches) {
    if (!repoNames.has(item.repo)) fail('invalid_seed', 'invalid_seed: Branch ' + item.name + ' has no repository ' + item.repo + '.');
    if (!data.commits.some(commit => commit.repo === item.repo && commit.sha === item.sha)) {
      fail('invalid_seed', 'invalid_seed: Branch ' + item.repo + ':' + item.name + ' points at a missing commit.');
    }
    claim('branch', item.repo + '#' + item.name);
  }
  for (const item of data.tags) {
    if (!repoNames.has(item.repo)) fail('invalid_seed', 'invalid_seed: Tag ' + item.name + ' has no repository ' + item.repo + '.');
    claim('tag', item.repo + '#' + item.name);
  }
  for (const item of data.checks) claim('check', item.repo + '#' + item.sha + '#' + item.name);
  for (const item of data.issues) claim('issue', item.repo + '#' + item.number);
  for (const item of data.pulls) claim('pull', item.repo + '#' + item.number);
  for (const item of data.releases) claim('release', item.release_id);
  for (const item of data.reviews) claim('review', item.review_id);
  for (const item of data.notices) claim('notice', item.notice_id);
  for (const item of data.notifications) claim('notification', item.notification_id);
  for (const item of data.comments) claim('comment', item.comment_id);
  for (const comment of data.comments) {
    if (!accounts.has(comment.author_account_id)) fail('invalid_seed', 'invalid_seed: Comment author missing.');
    if (comment.target === 'pull' && !data.pulls.some(item => item.repo === comment.repo && item.number === comment.number)) {
      fail('invalid_seed', 'invalid_seed: Comment ' + comment.comment_id + ' has no pull request ' + comment.repo + '#' + comment.number + '.');
    }
    if (comment.target === 'issue' && !data.issues.some(item => item.repo === comment.repo && item.number === comment.number)) {
      fail('invalid_seed', 'invalid_seed: Comment ' + comment.comment_id + ' has no issue ' + comment.repo + '#' + comment.number + '.');
    }
    const last = comment.revisions[comment.revisions.length - 1];
    if (!last || last.body !== comment.body || last.revision !== comment.revision) fail('invalid_seed', 'invalid_seed: Comment revisions must retain the current text.');
  }
  for (const review of data.reviews) {
    if (!data.pulls.some(item => item.repo === review.repo && item.number === review.number)) {
      fail('invalid_seed', 'invalid_seed: Review ' + review.review_id + ' has no pull request ' + review.repo + '#' + review.number + '.');
    }
  }
  for (const reaction of data.reactions) {
    if (!data.comments.some(item => item.comment_id === reaction.comment_id)) {
      fail('invalid_seed', 'invalid_seed: Reaction ' + reaction.reaction_id + ' has no comment ' + reaction.comment_id + '.');
    }
  }
  if (ctx && ctx.virtual_now) {
    const limit = Date.parse(ctx.virtual_now);
    const visit = (value, label, seen = new Set()) => {
      if (!value || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      if (Array.isArray(value)) {
        value.forEach((item, index) => visit(item, label + '[' + index + ']', seen));
        return;
      }
      for (const [key, item] of Object.entries(value)) {
        if ((key === 'at' || key.endsWith('_at')) && typeof item === 'string' && Date.parse(item) > limit) {
          fail('invalid_seed', 'invalid_seed: ' + label + '.' + key + ' is after the load clock.');
        } else if (item && typeof item === 'object') visit(item, label + '.' + key, seen);
      }
    };
    visit(data, 'seed');
  }
  for (const subject of data.protected_subjects) {
    if (!accounts.has(subject.account_id)) fail('invalid_seed', 'invalid_seed: Protected subject account missing.');
  }
  let bytes = 0;
  for (const repo of data.repositories) {
    const branch = data.branches.find(item => item.repo === repo.repo && item.name === repo.default_branch);
    if (!branch) fail('invalid_seed', 'invalid_seed: Default branch missing on ' + repo.repo + '.');
    bytes += store.fileBytes(Object.values(store.graph.treeAt(data, repo.repo, branch.sha)));
  }
  if (bytes > 1024 * 1024) fail('invalid_seed', 'invalid_seed: Seed text exceeds 1 MiB.');
}

function records(data) {
  return data.repositories;
}

function objects(data) {
  return data.repositories.map(item => item.repo);
}

function assetReferences() {
  return [];
}

module.exports = {validateSeed, records, objects, references: () => [], assetReferences};
