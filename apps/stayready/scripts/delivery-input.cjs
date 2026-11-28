'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

// Generated reports cannot contain their own digest. All other package files,
// including review documentation and reference images, are verification inputs.
function inventory(root, excludeRuns = false) {
  const files = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      if (excludeRuns && relative === 'evidence/runs') continue;
      if (entry.isSymbolicLink()) throw new Error('Unexpected symbolic link: ' + relative);
      if (entry.isDirectory()) walk(absolute);
      else {
        const bytes = fs.readFileSync(absolute);
        files.push({ path: relative, bytes: bytes.length, sha256: sha256(bytes) });
      }
    }
  }
  walk(root);
  return files;
}

function inputDigest(root, files = inventory(root, true)) {
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    hash.update(file.path); hash.update('\0'); hash.update(fs.readFileSync(path.join(root, file.path)));
  }
  return hash.digest('hex');
}
module.exports = { inventory, inputDigest, sha256 };
