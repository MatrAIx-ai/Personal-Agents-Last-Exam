/**
 * Personal Records Public Tool Adapters (Milestone 2)
 * Pinned source versions:
 * - Mail/Calendar 1.3.0
 * - Files/Contacts 1.0.0
 * at commit 61b637164e4abddf81536bb48935cdb688a69ff1
 */

const crypto = require('crypto');

class SourceUnavailableError extends Error {
  constructor(message, code = 'SOURCE_UNAVAILABLE') {
    super(message);
    this.code = code;
  }
}

class AppAdapters {
  /**
   * Imports an attachment from Mail via public contract:
   * 1. mail.get({ id })
   * 2. mail.attachment.get({ id, asset_id })
   */
  static async importMailAttachment({ mailClient, messageId, assetId }) {
    if (!mailClient) {
      throw new SourceUnavailableError('Mail client not bound', 'SOURCE_UNAVAILABLE');
    }

    try {
      // 1. Fetch message metadata
      const getMsg = typeof mailClient.get === 'function'
        ? mailClient.get.bind(mailClient)
        : (mailClient['mail.get'] ? mailClient['mail.get'].bind(mailClient) : null);

      if (!getMsg) {
        throw new SourceUnavailableError('mail.get interface not found', 'SOURCE_UNAVAILABLE');
      }

      const msg = await getMsg({ id: messageId });
      if (!msg) {
        throw new SourceUnavailableError(`Message ${messageId} not found`, 'SOURCE_NOT_FOUND');
      }

      // 2. Fetch raw attachment bytes
      const getAttachment =
        (mailClient.attachment && typeof mailClient.attachment.get === 'function')
          ? mailClient.attachment.get.bind(mailClient.attachment)
          : (typeof mailClient['mail.attachment.get'] === 'function')
            ? mailClient['mail.attachment.get'].bind(mailClient)
            : null;

      if (!getAttachment) {
        throw new SourceUnavailableError('mail.attachment.get interface not found', 'SOURCE_UNAVAILABLE');
      }

      const attachment = await getAttachment({ id: messageId, asset_id: assetId });
      if (!attachment || !attachment.content_bytes) {
        throw new SourceUnavailableError(`Attachment asset ${assetId} not found in message ${messageId}`, 'SOURCE_NOT_FOUND');
      }

      const bytes = Buffer.from(attachment.content_bytes, 'base64');
      const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');

      return {
        bytes,
        filename: attachment.filename || 'mail_attachment',
        mimeType: attachment.mime_type || 'application/octet-stream',
        byteSize: bytes.length,
        sha256,
        sourceReference: {
          source_app: 'mail',
          message_id: messageId,
          asset_id: assetId,
          subject: msg.subject,
          from: msg.from
        }
      };
    } catch (err) {
      if (err instanceof SourceUnavailableError) throw err;
      throw new SourceUnavailableError(`Mail integration error: ${err.message}`, 'SOURCE_UNAVAILABLE');
    }
  }

  /**
   * Ingests a file from Files via public contract:
   * files.read({ id, number? })
   */
  static async importFile({ filesClient, fileId, versionNumber }) {
    if (!filesClient) {
      throw new SourceUnavailableError('Files client not bound', 'SOURCE_UNAVAILABLE');
    }

    try {
      const readFn = typeof filesClient.read === 'function'
        ? filesClient.read.bind(filesClient)
        : (filesClient['files.read'] ? filesClient['files.read'].bind(filesClient) : null);

      if (!readFn) {
        throw new SourceUnavailableError('files.read interface not found', 'SOURCE_UNAVAILABLE');
      }

      const fileData = await readFn({ id: fileId, number: versionNumber });
      if (!fileData || !fileData.content_bytes) {
        throw new SourceUnavailableError(`File ${fileId} (version: ${versionNumber || 'latest'}) not found`, 'SOURCE_NOT_FOUND');
      }

      const bytes = Buffer.from(fileData.content_bytes, 'base64');
      const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');

      return {
        bytes,
        filename: fileData.name || 'imported_file',
        mimeType: fileData.mime_type || 'application/octet-stream',
        byteSize: bytes.length,
        sha256,
        version: fileData.version_number || 1,
        sourceReference: {
          source_app: 'files',
          file_id: fileId,
          version_number: fileData.version_number || versionNumber || 1
        }
      };
    } catch (err) {
      if (err instanceof SourceUnavailableError) throw err;
      throw new SourceUnavailableError(`Files integration error: ${err.message}`, 'SOURCE_UNAVAILABLE');
    }
  }

  /**
   * Entity matching against Contacts:
   * contacts.list({ query?, include_inactive? })
   * Returns matching contact if issuer or counterparty name matches an entity.
   */
  static async matchContact({ contactsClient, query }) {
    if (!contactsClient || !query) return null;
    try {
      const listFn = typeof contactsClient.list === 'function'
        ? contactsClient.list.bind(contactsClient)
        : (contactsClient['contacts.list'] ? contactsClient['contacts.list'].bind(contactsClient) : null);

      if (!listFn) return null;

      // 1. Query with title
      const res = await listFn({ query: query.trim(), include_inactive: false });
      let contacts = (res && res.contacts) || [];

      // 2. If title query yielded no results, fetch contacts to check name/org in title
      if (contacts.length === 0) {
        const allRes = await listFn({ include_inactive: false });
        contacts = (allRes && allRes.contacts) || [];
      }

      if (contacts.length === 0) return null;

      const normalized = query.toLowerCase().trim();

      // Match if contact name/org is contained in query, or query is contained in contact name/org
      const matched = contacts.find((c) => {
        const org = c.organization ? c.organization.toLowerCase() : '';
        const name = c.name ? c.name.toLowerCase() : '';
        return (org && (normalized.includes(org) || org.includes(normalized))) ||
               (name && (normalized.includes(name) || name.includes(normalized)));
      });

      return matched || null;
    } catch {
      return null;
    }
  }

  /**
   * Correlates renewal deadlines with Calendar:
   * calendar.list({ start?, end?, include_cancelled? })
   * Checks whether a reminder event is already scheduled within a +/- window around targetDate.
   */
  static async correlateCalendar({ calendarClient, targetDate, titleHint, windowDays = 7 }) {
    if (!calendarClient || !targetDate) {
      return { scheduled: false, matched_events: [] };
    }

    try {
      const targetTime = new Date(targetDate).getTime();
      const start = new Date(targetTime - windowDays * 24 * 60 * 60 * 1000).toISOString();
      const end = new Date(targetTime + windowDays * 24 * 60 * 60 * 1000).toISOString();

      const listFn = typeof calendarClient.list === 'function'
        ? calendarClient.list.bind(calendarClient)
        : (calendarClient['calendar.list'] ? calendarClient['calendar.list'].bind(calendarClient) : null);

      if (!listFn) return { scheduled: false, matched_events: [] };

      const res = await listFn({ start, end, include_cancelled: false });
      const events = (res && res.events) || [];

      if (!titleHint) {
        return { scheduled: events.length > 0, matched_events: events };
      }

      const hintLower = titleHint.toLowerCase();
      const matched = events.filter(
        (e) => (e.title && e.title.toLowerCase().includes(hintLower)) ||
               (e.description && e.description.toLowerCase().includes(hintLower))
      );

      return {
        scheduled: matched.length > 0,
        matched_events: matched
      };
    } catch {
      return { scheduled: false, matched_events: [] }; // Degrades gracefully
    }
  }

  /**
   * Dispatches outbound CloudEvent to Messaging receiver targeting Mail.
   * Format: urn:pale:email-message:2 with payload urn:pale:email-payload:1
   */
  static async dispatchNotification({ messagingRouter, recipient, subject, bodyText }) {
    if (!messagingRouter || typeof messagingRouter.applyEvent !== 'function') {
      return { status: 'DISPATCH_SKIPPED', reason: 'No messaging router bound' };
    }

    const cloudEvent = {
      specversion: '1.0',
      type: 'urn:pale:email-message:2',
      source: '/app/personal-records',
      id: `evt_mail_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
      time: new Date().toISOString(),
      datacontenttype: 'application/json',
      data: {
        recipient,
        subject,
        body_text: bodyText,
        asset_ids: []
      }
    };

    try {
      const receipt = await messagingRouter.applyEvent(cloudEvent);
      return { status: 'DISPATCHED', event_id: cloudEvent.id, receipt };
    } catch (err) {
      // Notification dispatch failure logs receipt without rolling back Records mutations
      return { status: 'DELIVERY_FAILED', error: err.message };
    }
  }
}

module.exports = { AppAdapters, SourceUnavailableError };
