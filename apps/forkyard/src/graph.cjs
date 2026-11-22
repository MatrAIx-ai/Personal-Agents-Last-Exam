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

function editScript(before, after) {
  const height = before.length;
  const width = after.length;
  if (height * width > 400000) {
    return before.map(line => ({op: '-', line})).concat(after.map(line => ({op: '+', line})));
  }
  const scores = Array.from({length: height + 1}, () => new Array(width + 1).fill(0));
  for (let row = height - 1; row >= 0; row -= 1) {
    for (let column = width - 1; column >= 0; column -= 1) {
      scores[row][column] = before[row] === after[column]
        ? scores[row + 1][column + 1] + 1
        : Math.max(scores[row + 1][column], scores[row][column + 1]);
    }
  }
  const ops = [];
  let row = 0;
  let column = 0;
  while (row < height && column < width) {
    if (before[row] === after[column]) {
      ops.push({op: ' ', line: before[row]});
      row += 1;
      column += 1;
    } else if (scores[row + 1][column] >= scores[row][column + 1]) {
      ops.push({op: '-', line: before[row]});
      row += 1;
    } else {
      ops.push({op: '+', line: after[column]});
      column += 1;
    }
  }
  while (row < height) {
    ops.push({op: '-', line: before[row]});
    row += 1;
  }
  while (column < width) {
    ops.push({op: '+', line: after[column]});
    column += 1;
  }
  return ops;
}

function contentLines(text) {
  const value = String(text);
  if (!value.length) return {lines: [], newline: false};
  const newline = value.endsWith('\n');
  const body = newline ? value.slice(0, -1) : value;
  return {lines: body.split('\n'), newline};
}

function hunkHeader(oldCount, newCount) {
  const oldRange = oldCount ? '1,' + oldCount : '0,0';
  const newRange = newCount ? '1,' + newCount : '0,0';
  return '@@ -' + oldRange + ' +' + newRange + ' @@';
}

function emptyFilePatch(path, created) {
  return [
    'diff --git a/' + path + ' b/' + path,
    created ? 'new file mode 100644' : 'deleted file mode 100644',
    created ? 'index 0000000..e69de29' : 'index e69de29..0000000',
    created ? '--- /dev/null' : '--- a/' + path,
    created ? '+++ b/' + path : '+++ /dev/null'
  ].join('\n') + '\n';
}

function unified(path, beforeText, afterText) {
  const created = beforeText == null;
  const deleted = afterText == null;
  const before = contentLines(created ? '' : beforeText);
  const after = contentLines(deleted ? '' : afterText);
  if (created && !after.lines.length) return emptyFilePatch(path, true);
  if (deleted && !before.lines.length) return emptyFilePatch(path, false);
  const ops = editScript(before.lines, after.lines);
  if (!created && !deleted && before.newline !== after.newline && before.lines.length && after.lines.length) {
    const last = before.lines[before.lines.length - 1];
    if (last === after.lines[after.lines.length - 1]) {
      let seenOld = 0;
      let seenNew = 0;
      let shared = -1;
      ops.forEach((item, index) => {
        if (item.op !== '+') seenOld += 1;
        if (item.op !== '-') seenNew += 1;
        if (seenOld === before.lines.length && seenNew === after.lines.length) shared = index;
      });
      if (shared >= 0 && ops[shared].op === ' ') ops.splice(shared, 1, {op: '-', line: last}, {op: '+', line: last});
    }
  }
  const body = [];
  let seenOld = 0;
  let seenNew = 0;
  for (const item of ops) {
    body.push(item.op + item.line);
    if (item.op !== '+') seenOld += 1;
    if (item.op !== '-') seenNew += 1;
    if (item.op !== '+' && seenOld === before.lines.length && before.lines.length && !before.newline) body.push('\\ No newline at end of file');
    if (item.op !== '-' && seenNew === after.lines.length && after.lines.length && !after.newline) body.push('\\ No newline at end of file');
  }
  const headerOld = created ? '--- /dev/null' : '--- a/' + path;
  const headerNew = deleted ? '+++ /dev/null' : '+++ b/' + path;
  const mode = created ? ['new file mode 100644'] : deleted ? ['deleted file mode 100644'] : [];
  return ['diff --git a/' + path + ' b/' + path, ...mode, headerOld, headerNew, hunkHeader(before.lines.length, after.lines.length), ...body].join('\n') + '\n';
}

function sameFile(left, right) {
  return JSON.stringify(left || null) === JSON.stringify(right || null);
}

function mergeTrees(ancestor, base, head) {
  const paths = [...new Set([...Object.keys(ancestor), ...Object.keys(base), ...Object.keys(head)])].sort();
  const tree = {};
  for (const path of paths) {
    const left = ancestor[path] || null;
    const current = base[path] || null;
    const incoming = head[path] || null;
    const baseChanged = !sameFile(left, current);
    const headChanged = !sameFile(left, incoming);
    if (baseChanged && headChanged && !sameFile(current, incoming)) return {conflict: path};
    const chosen = headChanged ? incoming : current;
    if (chosen) tree[path] = chosen;
  }
  const files = [];
  for (const path of [...new Set([...Object.keys(base), ...Object.keys(tree)])].sort()) {
    if (sameFile(base[path], tree[path])) continue;
    const file = tree[path];
    files.push(file ? {path, content: file.binary ? '' : file.content, binary: !!file.binary} : {path, content: null, binary: false});
  }
  return {conflict: null, tree, files};
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
    parts.push(unified(path, left ? leftText : null, right ? rightText : null));
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
  diffTrees, commitStat, compareShas, resolveRef, mergeBase, mergeTrees, unified
};
