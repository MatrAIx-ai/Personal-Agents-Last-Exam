const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

class BlobStore {
  constructor(rootDir) {
    this.rootDir = path.resolve(rootDir);
    fs.mkdirSync(this.rootDir, { recursive: true });
  }

  _accountPath(accountId) {
    const accDir = path.join(this.rootDir, accountId);
    fs.mkdirSync(accDir, { recursive: true });
    return accDir;
  }

  saveBytes(accountId, rawBuffer, filenameHint) {
    const byteSize = rawBuffer.length;
    if (byteSize > MAX_FILE_BYTES) {
      throw new Error(`File size (${byteSize} bytes) exceeds limit of ${MAX_FILE_BYTES} bytes`);
    }

    const sha256 = crypto.createHash('sha256').update(rawBuffer).digest('hex');
    const accDir = this._accountPath(accountId);
    const safeName = `${sha256.slice(0, 12)}_${filenameHint.replace(/\s+/g, '_')}`;
    const destPath = path.join(accDir, safeName);

    fs.writeFileSync(destPath, rawBuffer);
    return {
      relPath: `${accountId}/${safeName}`,
      sha256,
      byteSize
    };
  }

  readBytes(relPath) {
    const fullPath = path.join(this.rootDir, relPath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Blob not found at ${relPath}`);
    }
    return fs.readFileSync(fullPath);
  }

  deleteBlob(relPath) {
    const fullPath = path.join(this.rootDir, relPath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      return true;
    }
    return false;
  }
}

module.exports = { BlobStore, MAX_FILE_BYTES };
