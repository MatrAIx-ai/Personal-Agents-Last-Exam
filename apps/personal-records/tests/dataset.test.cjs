const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const TRUTH_PATH = path.join(__dirname, '../fixtures/truth.json');
const CORPUS_PATH = path.join(__dirname, '../fixtures/corpus.json');

const REQUIRED_CATEGORIES = [
  'employment',
  'tax',
  'insurance',
  'property',
  'utilities',
  'healthcare',
  'banking',
  'legal'
];

test('Milestone 4: Full Corpus Scale & Domain Coverage', () => {
  assert.ok(fs.existsSync(CORPUS_PATH), 'fixtures/corpus.json must exist');
  const corpus = JSON.parse(fs.readFileSync(CORPUS_PATH, 'utf-8'));

  // Assert corpus count is within the 150-250 range
  assert.ok(
    corpus.documents.length >= 150 && corpus.documents.length <= 250,
    `Corpus documents count (${corpus.documents.length}) must be between 150 and 250`
  );

  // Assert all 8 domains are represented
  const presentCategories = new Set(corpus.documents.map((d) => d.category));
  for (const cat of REQUIRED_CATEGORIES) {
    assert.ok(presentCategories.has(cat), `Corpus must contain category '${cat}'`);
  }

  // Assert links exist and have valid endpoints
  assert.ok(corpus.links.length > 20, 'Corpus must contain directed relationship links');
  const docIds = new Set(corpus.documents.map((d) => d.fixture_id));
  for (const link of corpus.links) {
    assert.ok(docIds.has(link.source_ref), `Missing source_ref: ${link.source_ref}`);
    assert.ok(docIds.has(link.target_ref), `Missing target_ref: ${link.target_ref}`);
    assert.ok(link.relationship_type, 'Link must define relationship_type');
  }
});

test('Milestone 4: Reference Run Payload Budget & Host Limits', () => {
  assert.ok(fs.existsSync(TRUTH_PATH), 'fixtures/truth.json must exist');
  const rawContent = fs.readFileSync(TRUTH_PATH);
  const truth = JSON.parse(rawContent.toString('utf-8'));

  // Assert document count conforms to active scenario budget (<= 64 assets limit)
  assert.ok(
    truth.documents.length <= 64,
    `Reference slice documents (${truth.documents.length}) must not exceed the 64-asset host ceiling`
  );
  assert.ok(
    truth.documents.length >= 15,
    `Reference slice documents (${truth.documents.length}) must provide a realistic subset (>= 15)`
  );

  // Assert decoded payload is strictly under the 1 MiB limit
  const payloadBytes = Buffer.byteLength(rawContent);
  assert.ok(
    payloadBytes <= 1024 * 1024,
    `Reference slice size (${payloadBytes} bytes) exceeds 1 MiB reference host budget`
  );
});

test('Milestone 4: Verified Passage Citations & Character Span Integrity', () => {
  const corpus = JSON.parse(fs.readFileSync(CORPUS_PATH, 'utf-8'));

  let verifiedSpans = 0;
  for (const doc of corpus.documents) {
    if (Array.isArray(doc.evidence_spans) && doc.evidence_spans.length > 0) {
      for (const span of doc.evidence_spans) {
        // Assert bounds
        assert.ok(span.start >= 0, `Span start must be >= 0 in ${doc.fixture_id}`);
        assert.ok(span.end <= doc.content_text.length, `Span end exceeds text length in ${doc.fixture_id}`);
        assert.ok(span.start < span.end, `Span start must precede end in ${doc.fixture_id}`);

        // Byte/character exact slice verification
        const textSlice = doc.content_text.slice(span.start, span.end);
        assert.strictEqual(
          textSlice,
          span.text,
          `Character offset mismatch in ${doc.fixture_id} for '${span.label}'`
        );
        verifiedSpans++;
      }
    }
  }

  assert.ok(verifiedSpans >= 15, `Dataset must contain verified evidence citations (found ${verifiedSpans})`);
});
