const { DatabaseSync } = require('node:sqlite');

const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
    account_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS documents (
    document_id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    title TEXT NOT NULL,
    category TEXT CHECK(category IN ('tax', 'employment', 'insurance', 'property', 'utilities', 'healthcare', 'banking', 'legal', 'other')),
    tags TEXT DEFAULT '[]',
    current_version_number INTEGER NOT NULL DEFAULT 1,
    verification_state TEXT NOT NULL DEFAULT 'INFERRED' CHECK(verification_state IN ('INFERRED', 'USER_CONFIRMED', 'SUPERSEDED')),
    valid_until TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_documents_account_cat ON documents(account_id, category);
CREATE INDEX IF NOT EXISTS idx_documents_valid_until ON documents(account_id, valid_until);

CREATE TABLE IF NOT EXISTS document_versions (
    version_id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    blob_path TEXT NOT NULL,
    change_summary TEXT,
    source_type TEXT NOT NULL DEFAULT 'UPLOAD' CHECK(source_type IN ('UPLOAD', 'MAIL', 'FILES', 'INJECTED')),
    source_reference TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (document_id) REFERENCES documents(document_id) ON DELETE CASCADE,
    UNIQUE (document_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_versions_sha256 ON document_versions(sha256);

CREATE TABLE IF NOT EXISTS extractions (
    extraction_id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    extraction_revision TEXT NOT NULL,
    raw_text TEXT NOT NULL,
    extracted_fields TEXT DEFAULT '{}',
    extraction_source TEXT NOT NULL CHECK(extraction_source IN ('PARSER', 'FALLBACK_TRUTH', 'DEFERRED_RAW')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (document_id, version_number) REFERENCES document_versions(document_id, version_number) ON DELETE CASCADE,
    UNIQUE (document_id, version_number, extraction_revision)
);

CREATE VIRTUAL TABLE IF NOT EXISTS fts_documents USING fts5(
    document_id UNINDEXED,
    account_id UNINDEXED,
    title,
    category,
    tags,
    raw_text,
    tokenize = 'porter unicode61'
);

CREATE TABLE IF NOT EXISTS document_links (
    link_id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    relationship_type TEXT NOT NULL,
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE,
    FOREIGN KEY (source_id) REFERENCES documents(document_id) ON DELETE CASCADE,
    FOREIGN KEY (target_id) REFERENCES documents(document_id) ON DELETE CASCADE,
    UNIQUE (source_id, target_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS idx_links_target ON document_links(target_id);

CREATE TABLE IF NOT EXISTS evidence_claims (
    claim_id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    extraction_revision TEXT NOT NULL,
    start_offset INTEGER NOT NULL,
    end_offset INTEGER NOT NULL,
    cited_text TEXT NOT NULL,
    claim_text TEXT NOT NULL,
    verification_state TEXT NOT NULL DEFAULT 'INFERRED' CHECK(verification_state IN ('INFERRED', 'USER_CONFIRMED', 'REVIEW_REQUIRED', 'SUPERSEDED')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_claims_doc ON evidence_claims(document_id, version_number);

CREATE TABLE IF NOT EXISTS proposals (
    proposal_id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    caller_role TEXT NOT NULL DEFAULT 'agent',
    target_type TEXT NOT NULL CHECK(target_type IN ('document_metadata', 'link', 'claim', 'document_version')),
    target_id TEXT NOT NULL,
    expected_version INTEGER,
    proposed_changes TEXT NOT NULL,
    rationale TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'STALE')),
    decision_reason TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    resolved_at TEXT,
    FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS records_notifications (
    notification_id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    notification_type TEXT NOT NULL,
    document_id TEXT,
    subject TEXT NOT NULL,
    body_text TEXT NOT NULL,
    dispatched_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    suppressed_until TEXT,
    FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE,
    FOREIGN KEY (document_id) REFERENCES documents(document_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
    key TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    response_payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
`;

function createDatabase(dbPath = ':memory:') {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA_SQL);
  return db;
}

module.exports = { createDatabase, SCHEMA_SQL };
