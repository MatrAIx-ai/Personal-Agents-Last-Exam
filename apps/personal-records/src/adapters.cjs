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
      const getMsg = typeof mailClient.get === 'function' 
        ? mailClient.get.bind(mailClient) 
        : (mailClient['mail.get'] ? mailClient['mail.get'].bind(mailClient) : null);

      if (!getMsg) {
        throw new SourceUnavailableError('mail.get not found on mail client', 'SOURCE_UNAVAILABLE');
      }

      const msg = await getMsg({ id: messageId });
      if (!msg) {
        throw new SourceUnavailableError(`Message ${messageId} not found`, 'SOURCE_NOT_FOUND');
      }

      const getAttachment = 
        (mailClient.attachment && typeof mailClient.attachment.get === 'function')
          ? mailClient.attachment.get.bind(mailClient.attachment)
          : (typeof mailClient['mail.attachment.get'] === 'function')
            ? mailClient['mail.attachment.get'].bind(mailClient)
            : (typeof mailClient.attachment === 'function')
              ? mailClient.attachment.bind(mailClient)
              : null;

      if (!getAttachment) {
        throw new SourceUnavailableError('mail.attachment.get not found on mail client', 'SOURCE_UNAVAILABLE');
      }

      const attachment = await getAttachment({ id: messageId, asset_id: assetId });
      if (!attachment || !attachment.content_bytes) {
        throw new SourceUnavailableError(`Attachment asset ${assetId} not found`, 'SOURCE_NOT_FOUND');
      }

      return {
        bytes: Buffer.from(attachment.content_bytes, 'base64'),
        filename: attachment.filename || 'mail_attachment',
        mimeType: attachment.mime_type || 'application/octet-stream',
        sourceReference: { message_id: messageId, asset_id: assetId }
      };
    } catch (err) {
      if (err instanceof SourceUnavailableError) throw err;
      throw new SourceUnavailableError(`Mail read failed: ${err.message}`, 'SOURCE_UNAVAILABLE');
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
      const fileData = await filesClient.read({ id: fileId, number: versionNumber });
      if (!fileData || !fileData.content_bytes) {
        throw new SourceUnavailableError(`File ${fileId} not found`, 'SOURCE_NOT_FOUND');
      }

      return {
        bytes: Buffer.from(fileData.content_bytes, 'base64'),
        filename: fileData.name || 'imported_file',
        mimeType: fileData.mime_type || 'application/octet-stream',
        version: fileData.version_number || 1,
        sourceReference: { file_id: fileId, version: versionNumber }
      };
    } catch (err) {
      if (err instanceof SourceUnavailableError) throw err;
      throw new SourceUnavailableError(`Files read failed: ${err.message}`, 'SOURCE_UNAVAILABLE');
    }
  }

  /**
   * Reads contacts to map counterparty names via contacts.list({ query?, include_inactive? })
   */
  static async matchContact({ contactsClient, query }) {
    if (!contactsClient) return null;
    try {
      const list = await contactsClient.list({ query, include_inactive: false });
      if (list && list.contacts && list.contacts.length > 0) {
        return list.contacts[0];
      }
      return null;
    } catch {
      return null; // Degrades gracefully
    }
  }

  /**
   * Correlates renewal deadlines with calendar via calendar.list({ start?, end?, include_cancelled? })
   */
  static async listCalendarEvents({ calendarClient, start, end }) {
    if (!calendarClient) return [];
    try {
      const res = await calendarClient.list({ start, end, include_cancelled: false });
      return (res && res.events) || [];
    } catch {
      return []; // Degrades gracefully
    }
  }
}

module.exports = { AppAdapters, SourceUnavailableError };
