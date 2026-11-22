'use strict';
const {fail} = require('./domain-utils.cjs');

function commitsFor(data, repo) {
  return data.commits.filter(commit => commit.repo === repo);
}

function commitBySha(data, repo, sha) {
  return commitsFor(data, repo).find(commit => commit.sha === sha) || null;
}

function requireCommit(data, repo, sha) {
  const commit = commitBySha(data, repo, sha);
  if (!commit) fail('commit_not_found', 'commit_not_found: Commit ' + sha + ' is not in ' + repo + '.');
  return commit;
}

function reachable(data, repo, sha) {
  const seen = new Set();
  const pending = [sha];
  while (pending.length) {
    const current = pending.pop();
    if (!current || seen.has(current)) continue;
    const commit = commitBySha(data, repo, current);
    if (!commit) continue;
    seen.add(current);
    for (const parent of commit.parents) pending.push(parent);
  }
  return seen;
}

function treeAt(data, repo, sha, guard = new Set()) {
  if (!sha) return {};
  if (guard.has(sha)) fail('invalid_seed', 'invalid_seed: Commit parents cycle at ' + sha + '.');
  const commit = requireCommit(data, repo, sha);
  guard.add(sha);
  const files = commit.parents[0] ? treeAt(data, repo, commit.parents[0], guard) : {};
  guard.delete(sha);
  const next = {...files};
  for (const file of commit.files) {
    if (file.content === null && !file.binary) delete next[file.path];
    else next[file.path] = {path: file.path, content: file.binary ? '' : file.content, binary: !!file.binary};
  }
  return next;
}

function lineChangeCount(beforeText, afterText) {
  const before = String(beforeText).split('\n');
  const after = String(afterText).split('\n');
  const width = after.length;
  if (before.length * width > 400000) return before.length + after.length;
  let previous = new Array(width + 1).fill(0);
  for (let row = 1; row <= before.length; row += 1) {
    const current = new Array(width + 1).fill(0);
    for (let column = 1; column <= width; column += 1) {
      current[column] = before[row - 1] === after[column - 1]
        ? previous[column - 1] + 1
        : Math.max(previous[column], current[column - 1]);
    }
    previous = current;
  }
  const shared = previous[width];
  return (before.length - shared) + (after.length - shared);
}

function unified(path, beforeText, afterText) {
  const before = String(beforeText).split('\n');
  const after = String(afterText).split('\n');
  const lines = ['--- a/' + path, '+++ b/' + path];
  for (const line of before) if (!after.includes(line)) lines.push('-' + line);
  for (const line of after) if (!before.includes(line)) lines.push('+' + line);
  return lines.join('\n');
}

function diffTrees(before, after) {
  const paths = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  let changed = 0;
  const changedPaths = [];
  const parts = [];
  for (const path of paths) {
    const left = before[path];
    const right = after[path];
    if (JSON.stringify(left || null) === JSON.stringify(right || null)) continue;
    changedPaths.push(path);
    if ((left && left.binary) || (right && right.binary)) {
      changed += 1;
      parts.push('Binary file ' + path);
      continue;
    }
    const leftText = left ? left.content : '';
    const rightText = right ? right.content : '';
    changed += lineChangeCount(leftText, rightText);
    parts.push(unified(path, leftText, rightText));
  }
  return {changed_lines: changed, paths: changedPaths, text: parts.join('\n')};
}

function commitStat(data, commit) {
  const parentSha = commit.parents[0] || null;
  const parent = parentSha ? treeAt(data, commit.repo, parentSha) : {};
  const own = treeAt(data, commit.repo, commit.sha);
  return diffTrees(parent, own);
}

function mergeBase(data, repo, left, right) {
  const fromLeft = reachable(data, repo, left);
  const fromRight = reachable(data, repo, right);
  const common = [...fromLeft].filter(sha => fromRight.has(sha));
  const best = common.filter(sha => !common.some(other => other !== sha && reachable(data, repo, other).has(sha)));
  best.sort();
  return best[0] || null;
}

function compareShas(data, repo, base, head) {
  const fromBase = reachable(data, repo, base);
  const fromHead = reachable(data, repo, head);
  if (!fromBase.size || !fromHead.size) fail('commit_not_found', 'commit_not_found: Base or head is not in ' + repo + '.');
  let ahead = 0;
  for (const sha of fromHead) if (!fromBase.has(sha)) ahead += 1;
  let behind = 0;
  for (const sha of fromBase) if (!fromHead.has(sha)) behind += 1;
  return {
    ahead_by: ahead,
    behind_by: behind,
    merge_base: mergeBase(data, repo, base, head),
    base_is_ancestor: fromHead.has(base)
  };
}

function resolveRef(data, repo, ref) {
  if (!ref) fail('not_found', 'not_found: Missing ref.');
  const branch = data.branches.find(item => item.repo === repo && item.name === ref);
  if (branch) return branch.sha;
  const tag = data.tags.find(item => item.repo === repo && item.name === ref);
  if (tag) return tag.target_sha;
  if (commitBySha(data, repo, ref)) return ref;
  fail('not_found', 'not_found: Ref ' + ref + ' is not a branch, tag or commit in ' + repo + '.');
}

module.exports = {
  commitsFor, commitBySha, requireCommit, reachable, treeAt, lineChangeCount,
  diffTrees, commitStat, compareShas, resolveRef, mergeBase
};
