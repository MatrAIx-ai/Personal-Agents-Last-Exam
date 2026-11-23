'use strict';
const APP = 'plateway';
const CHANNEL = 'channel.email';
const sourceUri = account => 'urn:pale:app:' + encodeURIComponent(APP) + ':account:' + encodeURIComponent(account);

function message(snapshot, notice) {
  const { account_id, owner_person_id } = snapshot.data;
  return {
    specversion: '1.0',
    id: 'e' + snapshot.epoch + '-' + notice.id,
    source: sourceUri(account_id),
    type: 'org.pale.mail.notification.v1',
    time: notice.at,
    datacontenttype: 'application/json',
    dataschema: 'urn:pale:email-payload:1',
    data: {
      channel: CHANNEL,
      recipient: { kind: 'person_ref', id: owner_person_id },
      source_object: { app_id: APP, account_id, object_type: 'order', object_id: notice.order_id },
      content: { title: notice.title, body: { format: 'text/plain', text: notice.body }, asset_ids: [] },
      extensions: [],
    },
  };
}

function pending(snapshot) {
  const history = new Set(snapshot.initial_data.notices.map(n => n.id));
  return snapshot.data.notices.filter(n => !history.has(n.id));
}

const mailAccounts = snapshot => snapshot.binding.accounts.filter(a => a.app_id === 'mail' && a.owner_person_id === snapshot.data.owner_person_id);
const granted = (grants, account) => (grants || []).some(g => g.app_id === 'mail' && g.account_id === account.account_id && g.channel === CHANNEL);

async function send({ plateway, router, grants }) {
  const snapshot = (await plateway.call('env.snapshot', {})).snapshot;
  const waiting = pending(snapshot);
  const skipped = reason => ({ status: 'skipped', reason, pending: waiting.map(n => n.id), receipts: [] });
  const accounts = mailAccounts(snapshot);
  if (!router || !accounts.length) return skipped('no_mail_account');
  if (!accounts.some(a => granted(grants, a))) return skipped('no_email_grant');
  const capabilities = await router.call('router.capabilities', {});
  if (capabilities.status !== 'ok' || !capabilities.channels.some(c => c.channel === CHANNEL)) return skipped('no_email_channel');
  const receipts = [];
  for (const notice of waiting) {
    const wire = message(snapshot, notice);
    const receipt = await router.call('router.publish', { request_id: wire.id, message: wire });
    receipts.push({ notice_id: notice.id, message_id: wire.id, receipt });
    if (receipt.status !== 'committed') return { status: receipt.status, stopped_at: notice.id, event_id: receipt.event_id ?? null, receipts };
  }
  return { status: 'published', receipts };
}
async function receiverSetup(mail) {
  const snapshot = (await mail.call('env.snapshot', {})).snapshot;
  return { run_id: snapshot.run_id, account_id: snapshot.data.account_id, epoch: snapshot.epoch };
}

async function reconcile({ mail, setup, outcome }) {
  const indeterminate = reason => ({ status: 'indeterminate', reason, event_id: outcome.event_id ?? null });
  if (!outcome.event_id) return indeterminate('no_event_id');
  const snapshot = (await mail.call('env.snapshot', {})).snapshot;
  if (snapshot.run_id !== setup.run_id || snapshot.epoch !== setup.epoch || snapshot.data.account_id !== setup.account_id) return indeterminate('receiver_changed');
  const receipt = (await mail.call('env.event_status', { event_id: outcome.event_id })).receipt;
  const record = snapshot.data.messages.find(m => m.id === outcome.event_id);
  if (receipt && receipt.status === 'committed' && record) return { status: 'committed', event_id: outcome.event_id, record_id: record.id };
  return indeterminate(!receipt && !record ? 'not_found' : 'receipt_and_record_disagree');
}
module.exports = { message, pending, mailAccounts, send, receiverSetup, reconcile };
