const crypto = require('crypto');
const { AppAdapters } = require('./adapters.cjs');

class EventManager {
  constructor(db, docService, evidenceService) {
    this.db = db;
    this.docService = docService;
    this.evidenceService = evidenceService;
  }

  /**
   * Expiry rule:
   * Dispatches alerts for documents where valid_until <= virtualNow + thresholdDays.
   * Suppresses duplicate alerts if one was dispatched within suppressDays.
   */
  checkExpiries({ accountId, virtualNow, thresholdDays = 30, suppressDays = 7 }) {
    const vNow = new Date(virtualNow);
    const thresholdDate = new Date(vNow.getTime() + thresholdDays * 24 * 60 * 60 * 1000);
    const suppressHorizon = new Date(vNow.getTime() - suppressDays * 24 * 60 * 60 * 1000);

    const docs = this.db.prepare(`
      SELECT document_id, title, valid_until
      FROM documents
      WHERE account_id = ? AND valid_until IS NOT NULL AND valid_until <= ?
    `).all(accountId, thresholdDate.toISOString());

    const dispatched = [];

    for (const d of docs) {
      // Check suppression
      const recent = this.db.prepare(`
        SELECT notification_id FROM records_notifications
        WHERE account_id = ? AND document_id = ? AND notification_type = 'EXPIRY_ALERT'
          AND dispatched_at >= ?
        LIMIT 1
      `).get(accountId, d.document_id, suppressHorizon.toISOString());

      if (!recent) {
        const notifId = `notif_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
        const subject = `Document Expiry Notice: ${d.title}`;
        const bodyText = `Document '${d.title}' (ID: ${d.document_id}) expires on ${d.valid_until}. Please review renewal.`;

        this.db.prepare(`
          INSERT INTO records_notifications (
            notification_id, account_id, notification_type, document_id, subject, body_text, dispatched_at
          ) VALUES (?, ?, 'EXPIRY_ALERT', ?, ?, ?, ?)
        `).run(notifId, accountId, d.document_id, subject, bodyText, virtualNow);

        dispatched.push({
          notification_id: notifId,
          document_id: d.document_id,
          subject,
          bodyText
        });
      }
    }

    return dispatched;
  }

  /**
   * Discrepancy rule:
   * Compares successive documents linked via 'supersedes' or 'receipt_for'.
   * Flags variance if numerical fields (e.g. net_pay, gross_pay) change >0% without confirmation.
   */
  checkDiscrepancies({ accountId, newerDocId, olderDocId }) {
    const newerExt = this.db.prepare(`
      SELECT e.extracted_fields, d.verification_state
      FROM extractions e
      JOIN documents d ON e.document_id = d.document_id
      WHERE d.document_id = ? AND d.account_id = ?
      ORDER BY e.version_number DESC LIMIT 1
    `).get(newerDocId, accountId);

    const olderExt = this.db.prepare(`
      SELECT e.extracted_fields
      FROM extractions e
      JOIN documents d ON e.document_id = d.document_id
      WHERE d.document_id = ? AND d.account_id = ?
      ORDER BY e.version_number DESC LIMIT 1
    `).get(olderDocId, accountId);

    if (!newerExt || !olderExt) return null;

    const newerFields = JSON.parse(newerExt.extracted_fields || '{}');
    const olderFields = JSON.parse(olderExt.extracted_fields || '{}');

    const discrepancies = [];
    for (const key of Object.keys(newerFields)) {
      if (typeof newerFields[key] === 'number' && typeof olderFields[key] === 'number') {
        if (newerFields[key] !== olderFields[key]) {
          discrepancies.push({
            field: key,
            older_value: olderFields[key],
            newer_value: newerFields[key],
            delta: newerFields[key] - olderFields[key]
          });
        }
      }
    }

    if (discrepancies.length > 0 && newerExt.verification_state !== 'USER_CONFIRMED') {
      const notifId = `notif_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
      const subject = `Material Discrepancy Flag: Document ${newerDocId}`;
      const bodyText = `Unconfirmed numerical variance detected between ${newerDocId} and ${olderDocId}: ${JSON.stringify(discrepancies)}`;

      this.db.prepare(`
        INSERT INTO records_notifications (
          notification_id, account_id, notification_type, document_id, subject, body_text
        ) VALUES (?, ?, 'DISCREPANCY_FLAG', ?, ?, ?)
      `).run(notifId, accountId, newerDocId, subject, bodyText);

      return {
        flagged: true,
        notification_id: notifId,
        discrepancies
      };
    }

    return { flagged: false, discrepancies: [] };
  }

  /**
   * Builds an outbound CloudEvent adhering to urn:pale:email-message:2 with payload urn:pale:email-payload:1
   */
  buildOutboundCloudEvent({ id, time, recipient, subject, bodyText }) {
    return {
      specversion: '1.0',
      type: 'urn:pale:email-message:2',
      source: '/app/personal-records',
      id: id || `evt_mail_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
      time: time || new Date().toISOString(),
      datacontenttype: 'application/json',
      data: {
        recipient,
        subject,
        body_text: bodyText,
        asset_ids: []
      }
    };
  }

  /**
   * Processes injected scenario events via standard envelope
   */
  async handleInjectedEvent(envelope, adapters = {}) {
    const { operation, payload, at } = envelope;

    if (operation === 'records.inject_document') {
      const { source, source_account, message_id, asset_id, file_id, title } = payload;
      let fileData;

      if (source === 'mail_attachment') {
        fileData = await AppAdapters.importMailAttachment({
          mailClient: adapters.mailClient,
          messageId: message_id,
          assetId: asset_id
        });
      } else if (source === 'files') {
        fileData = await AppAdapters.importFile({
          filesClient: adapters.filesClient,
          fileId: file_id
        });
      } else {
        throw new Error(`Unsupported injection source: ${source}`);
      }

      return this.docService.uploadDocument({
        accountId: source_account,
        title: title || fileData.filename,
        contentBytes: fileData.bytes,
        mimeType: fileData.mimeType
      });
    }

    if (operation === 'records.check_expiries') {
      return this.checkExpiries({
        accountId: payload.account_id,
        virtualNow: at
      });
    }

    throw new Error(`Unknown injected operation: ${operation}`);
  }
}

module.exports = { EventManager };
