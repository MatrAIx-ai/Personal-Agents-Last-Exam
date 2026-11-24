const crypto = require('crypto');

class EvidenceService {
  constructor(db) {
    this.db = db;
  }

  linkDocuments({ accountId, sourceId, targetId, relationshipType, metadata = {} }) {
    // 1. Verify both documents exist and belong to this account
    const source = this.db.prepare(
      'SELECT document_id FROM documents WHERE document_id = ? AND account_id = ?'
    ).get(sourceId, accountId);

    if (!source) {
      const err = new Error(`Source document ${sourceId} not found`);
      err.code = 'NOT_FOUND';
      throw err;
    }

    const target = this.db.prepare(
      'SELECT document_id FROM documents WHERE document_id = ? AND account_id = ?'
    ).get(targetId, accountId);

    if (!target) {
      const err = new Error(`Target document ${targetId} not found`);
      err.code = 'LINK_TARGET_NOT_FOUND';
      throw err;
    }

    const linkId = `lnk_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

    this.db.prepare(`
      INSERT INTO document_links (link_id, account_id, source_id, target_id, relationship_type, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id, target_id, relationship_type) DO UPDATE SET
        metadata = excluded.metadata
    `).run(linkId, accountId, sourceId, targetId, relationshipType, JSON.stringify(metadata));

    return {
      link_id: linkId,
      source_id: sourceId,
      target_id: targetId,
      relationship_type: relationshipType
    };
  }

  createEvidenceClaim({
    accountId,
    documentId,
    versionNumber,
    extractionRevision,
    startOffset,
    endOffset,
    citedText,
    claimText
  }) {
    // 1. Retrieve the exact extraction record
    const ext = this.db.prepare(`
      SELECT e.raw_text, d.account_id
      FROM extractions e
      JOIN documents d ON e.document_id = d.document_id
      WHERE e.document_id = ? AND e.version_number = ? AND e.extraction_revision = ?
    `).get(documentId, versionNumber, extractionRevision);

    if (!ext || ext.account_id !== accountId) {
      const err = new Error(`Extraction revision not found for document ${documentId}`);
      err.code = 'NOT_FOUND';
      throw err;
    }

    // 2. Validate span bounds
    if (startOffset < 0 || endOffset > ext.raw_text.length || startOffset >= endOffset) {
      const err = new Error(`Invalid passage offset bounds: [${startOffset}, ${endOffset}]`);
      err.code = 'INVALID_PASSAGE_REFERENCE';
      throw err;
    }

    // 3. Strict verification: slice must match cited_text exactly
    const actualSlice = ext.raw_text.slice(startOffset, endOffset);
    if (actualSlice !== citedText) {
      const err = new Error(
        `Cited text mismatch at [${startOffset}, ${endOffset}]. Expected: '${citedText}', Found: '${actualSlice}'`
      );
      err.code = 'INVALID_PASSAGE_REFERENCE';
      throw err;
    }

    const claimId = `clm_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

    this.db.prepare(`
      INSERT INTO evidence_claims (
        claim_id, account_id, document_id, version_number, extraction_revision,
        start_offset, end_offset, cited_text, claim_text, verification_state
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'INFERRED')
    `).run(
      claimId,
      accountId,
      documentId,
      versionNumber,
      extractionRevision,
      startOffset,
      endOffset,
      citedText,
      claimText
    );

    return {
      claim_id: claimId,
      document_id: documentId,
      version_number: versionNumber,
      verification_state: 'INFERRED'
    };
  }

  proposeUpdate({
    accountId,
    callerRole = 'agent',
    targetType,
    targetId,
    expectedVersion,
    proposedChanges,
    rationale
  }) {
    // Verify target exists
    if (targetType === 'document_metadata' || targetType === 'document_version') {
      const doc = this.db.prepare(
        'SELECT document_id FROM documents WHERE document_id = ? AND account_id = ?'
      ).get(targetId, accountId);
      if (!doc) {
        const err = new Error(`Target document ${targetId} not found`);
        err.code = 'NOT_FOUND';
        throw err;
      }
    }

    const proposalId = `prop_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

    this.db.prepare(`
      INSERT INTO proposals (
        proposal_id, account_id, caller_role, target_type, target_id,
        expected_version, proposed_changes, rationale, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')
    `).run(
      proposalId,
      accountId,
      callerRole,
      targetType,
      targetId,
      expectedVersion || null,
      JSON.stringify(proposedChanges),
      rationale
    );

    return {
      proposal_id: proposalId,
      status: 'PENDING'
    };
  }

  confirmUpdate({ accountId, callerRole = 'user', proposalId, decision, rejectionReason }) {
    // Security check: only trusted user session can confirm
    if (callerRole === 'agent') {
      const err = new Error('Permission denied: Agent cannot approve its own proposal');
      err.code = 'PERMISSION_DENIED';
      throw err;
    }

    const proposal = this.db.prepare(`
      SELECT proposal_id, target_type, target_id, expected_version, proposed_changes, status
      FROM proposals
      WHERE proposal_id = ? AND account_id = ?
    `).get(proposalId, accountId);

    if (!proposal) {
      const err = new Error(`Proposal ${proposalId} not found`);
      err.code = 'NOT_FOUND';
      throw err;
    }

    if (proposal.status !== 'PENDING') {
      const err = new Error(`Proposal is not pending (current status: ${proposal.status})`);
      err.code = 'INVALID_PROPOSAL_STATUS';
      throw err;
    }

    // Handle rejection
    if (decision === 'CANCEL' || decision === 'REJECT') {
      const targetStatus = decision === 'CANCEL' ? 'CANCELLED' : 'REJECTED';
      this.db.prepare(`
        UPDATE proposals
        SET status = ?, decision_reason = ?, resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE proposal_id = ?
      `).run(targetStatus, rejectionReason || `User ${decision.toLowerCase()}ed`, proposalId);

      return {
        proposal_id: proposalId,
        status: targetStatus
      };
    }

    // Optimistic concurrency check for documents
    if (proposal.target_type === 'document_metadata' || proposal.target_type === 'document_version') {
      const doc = this.db.prepare(
        'SELECT current_version_number FROM documents WHERE document_id = ?'
      ).get(proposal.target_id);

      if (proposal.expected_version && doc && doc.current_version_number !== proposal.expected_version) {
        this.db.prepare(`
          UPDATE proposals
          SET status = 'STALE', decision_reason = 'Target version changed while proposal was pending',
              resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE proposal_id = ?
        `).run(proposalId);

        const err = new Error(`Stale proposal: current version is ${doc.current_version_number}`);
        err.code = 'STALE_PROPOSAL_VERSION';
        throw err;
      }
    } else if (proposal.target_type === 'claim') {
      this.db.prepare(`
        UPDATE evidence_claims
        SET verification_state = 'USER_CONFIRMED'
        WHERE claim_id = ?
      `).run(proposal.target_id);
    } else if (proposal.target_type === 'link') {
      const linkData = JSON.parse(proposal.proposed_changes);
      this.linkDocuments({
        accountId,
        sourceId: linkData.source_id,
        targetId: linkData.target_id,
        relationshipType: linkData.relationship_type,
        metadata: linkData.metadata || {}
      });
    }

    // Apply approved mutation atomically
    const changes = JSON.parse(proposal.proposed_changes);

    this.db.exec('BEGIN TRANSACTION;');
    try {
      if (proposal.target_type === 'document_metadata') {
        const updates = ['verification_state = ?', "updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"];
        const params = ['USER_CONFIRMED'];

        if (changes.title) {
          updates.push('title = ?');
          params.push(changes.title);
        }
        if (changes.category) {
          updates.push('category = ?');
          params.push(changes.category);
        }
        if (changes.valid_until !== undefined) {
          updates.push('valid_until = ?');
          params.push(changes.valid_until);
        }

        params.push(proposal.target_id);
        this.db.prepare(`UPDATE documents SET ${updates.join(', ')} WHERE document_id = ?`).run(...params);
      }

      this.db.prepare(`
        UPDATE proposals
        SET status = 'APPROVED', resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE proposal_id = ?
      `).run(proposalId);

      this.db.exec('COMMIT;');
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }

    return {
      proposal_id: proposalId,
      status: 'APPROVED'
    };
  }
}

module.exports = { EvidenceService };
