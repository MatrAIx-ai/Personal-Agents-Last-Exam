'use strict';
const crypto = require('node:crypto');
const { copy, money, clockLabel, DECLINE_PHRASES, nextSerial } = require('./domain-utils.cjs');
const { log } = require('./diagnostics.cjs');

function pushNotice(ctx, data, notice) {
  const notice_id = notice.notice_id || nextSerial(data.notices, 'notice_id', 'notice-');
  const publication = crypto.randomBytes(4).toString('hex');
  const row = {
    notice_id,
    kind: notice.kind,
    status: 'pending_delivery',
    cloud_event_id: 'keelcard-' + data.account_id + '-' + notice_id + '-' + publication,
    publish_request_id: 'pub-' + notice_id + '-' + publication,
    title: notice.title,
    body: notice.body,
    created_at: ctx.virtual_now,
    source_object: notice.source_object,
    related_id: notice.related_id || null,
    delivery: null
  };
  data.notices.push(row);
  log(ctx, 'keelcard.notice_prepared', { notice_id, kind: row.kind });
  return row;
}

function maybe(ctx, data, enabled, notice) {
  if (!enabled) return null;
  return pushNotice(ctx, data, notice);
}

function codeBody(data, card, request, code) {
  const when = clockLabel(request.expires_at, data.time_zone);
  const last = card.last_four;
  if (request.field === 'unpause') {
    return 'Code ' + code + ' confirms unpausing card ' + last + '. It expires at ' + when + '. If you did not ask for this change, ignore this email.';
  }
  if (request.field === 'merchant_unblock') {
    return 'Code ' + code + ' confirms removing the block on merchant ' + request.merchant_id + ' for card ' + last + '. It expires at ' + when + '. If you did not ask for this change, ignore this email.';
  }
  if (request.field === 'category_unblock') {
    return 'Code ' + code + ' confirms allowing category ' + request.category + ' on card ' + last + '. It expires at ' + when + '. If you did not ask for this change, ignore this email.';
  }
  if (request.field === 'alert_disable') {
    return 'Code ' + code + ' confirms turning off ' + request.alert + ' alerts. It expires at ' + when + '. If you did not ask for this change, ignore this email.';
  }
  if (request.field === 'alert_threshold') {
    const from = request.from_cents === null || request.from_cents === undefined ? 'any amount' : money(request.from_cents);
    return 'Code ' + code + ' confirms raising the decline alert threshold on card ' + last + ' from ' + from + ' to ' + money(request.to_cents) + '. It expires at ' + when + '. If you did not ask for this change, ignore this email.';
  }
  const labels = { per_transaction: 'per-transaction', per_day: 'daily', per_month: 'monthly', lifetime: 'lifetime' };
  return 'Code ' + code + ' confirms raising the ' + labels[request.field] + ' limit on card ' + last + ' from ' + money(request.from_cents) + ' to ' + money(request.to_cents) + '. It expires at ' + when + '. If you did not ask for this change, ignore this email.';
}

function declineBody(merchantName, amountCents, code) {
  const phrase = DECLINE_PHRASES[code] || code;
  return merchantName + ' charge of ' + money(amountCents) + ' was declined (' + phrase + '). Manage limits in Keelcard.';
}

function payloadFor(data, notice) {
  return {
    channel: 'channel.email',
    recipient: { kind: 'person_ref', id: data.owner_person_id },
    source_object: {
      app_id: 'keelcard',
      account_id: data.account_id,
      object_type: notice.source_object.object_type,
      object_id: notice.source_object.object_id
    },
    content: {
      title: notice.title,
      body: { format: 'text/plain', text: notice.body },
      asset_ids: []
    },
    extensions: []
  };
}

function wireFor(data, notice) {
  return {
    specversion: '1.0',
    id: notice.cloud_event_id,
    source: 'urn:pale:app:keelcard:account:' + data.account_id,
    type: 'org.pale.mail.notification.v1',
    time: notice.created_at,
    subject: notice.source_object.object_type + '/' + notice.source_object.object_id,
    datacontenttype: 'application/json',
    dataschema: 'urn:pale:email-payload:1',
    data: payloadFor(data, notice)
  };
}

function publicNotice(notice) {
  const view = copy(notice);
  delete view.body;
  return view;
}

module.exports = { pushNotice, maybe, codeBody, declineBody, payloadFor, wireFor, publicNotice };
