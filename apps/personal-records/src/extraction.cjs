class ExtractionService {
  constructor(fallbackManifest = {}) {
    this.fallbackManifest = fallbackManifest;
  }

  extract(rawBuffer, mimeType, sha256) {
    // 1. Fallback truth manifest check (for deterministic offline testing)
    if (this.fallbackManifest[sha256]) {
      const entry = this.fallbackManifest[sha256];
      return {
        rawText: entry.fallback_content || '',
        extractedFields: entry.fields || {},
        extractionSource: 'FALLBACK_TRUTH',
        extractionRevision: 'ext_rev_01'
      };
    }

    // 2. Plain text
    if (mimeType === 'text/plain') {
      return {
        rawText: rawBuffer.toString('utf-8'),
        extractedFields: {},
        extractionSource: 'PARSER',
        extractionRevision: 'ext_rev_01'
      };
    }

    // 3. Deferred / Raw attachment (PDF without OCR, images, etc.)
    return {
      rawText: '',
      extractedFields: {},
      extractionSource: 'DEFERRED_RAW',
      extractionRevision: 'ext_rev_01'
    };
  }
}

module.exports = { ExtractionService };
