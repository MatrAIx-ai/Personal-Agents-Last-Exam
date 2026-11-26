'use strict';
const c = require('./common.cjs');
const {ms, cents, time} = c;
// The text of a notification and, when the account wants email, the full wire message for Mail's receive contract.
const amount = value => (cents(value) / 100).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const count = (n, one, many = one + 's') => n + ' ' + (n === 1 ? one : many);
const total = lines => lines.reduce((sum, line) => sum + cents(line.amount), 0) / 100;

const writers = {
  'request.issued'({insurer, claim, payload, when, request}) {
    return {title: insurer + ' asks for information on claim ' + claim.id,
      text: payload.issued_by + ' asks for ' + count(request.asks.length, 'answer') + ' on claim ' + claim.id + ': ' +
        request.asks.map(a => a.text).join(' ') + ' Please answer by ' + when(request.due_at) + '.'};
  },
  'estimate.submitted'({insurer, claim, payload}) {
    const n = payload.lines.length, supplement = payload.kind === 'supplement', sender = payload.shop_name || (payload.source === 'shop' ? 'The shop' : 'The adjuster');
    return {title: (supplement ? 'A supplement of ' : 'An estimate of ') + count(n, 'repair line') + ' was added to claim ' + claim.id,
      text: sender + ' sent ' + (supplement ? 'a supplement' : 'an estimate') + ' for claim ' + claim.id + ': ' + n + (supplement ? ' new' : '') +
        ' repair ' + (n === 1 ? 'line' : 'lines') + ', ' + amount(total(payload.lines)) + ' in total. ' + insurer + ' has received it and has not decided on ' +
        (n === 1 ? 'this line' : 'these lines') + ' yet. Open your claim to see each line and its written decision.'};
  },
  'determination.issued'({claim, payload}) {
    const approved = payload.lines.filter(l => l.status === 'approved'), denied = payload.lines.length - approved.length;
    return {title: 'A written decision on ' + count(payload.lines.length, 'repair line') + ' of claim ' + claim.id,
      text: payload.issued_by + ' decided ' + count(payload.lines.length, 'repair line') + ' of claim ' + claim.id + ': ' + approved.length + ' approved for ' +
        amount(total(approved)) + ' in total, and ' + denied + ' denied. Open your claim to see the decision on each line and the last day to dispute it.'};
  },
  'dispute.decided'({claim, payload, dispute}) {
    const changed = payload.decision === 'changed';
    return {title: 'Your dispute on line ' + dispute.line_id + ' of claim ' + claim.id + ' was decided',
      text: payload.decided_by + ' decided dispute ' + dispute.id + ' on line ' + dispute.line_id + ' of claim ' + claim.id + '. ' +
        (!changed ? 'The earlier decision stands.' : payload.line.status === 'approved' ? 'The line is now approved for ' + amount(payload.line.amount) + '.' : 'The line is now denied.')};
  },
  'offer.issued'({claim, when, offer}) {
    return {title: 'A settlement offer was made on claim ' + claim.id,
      text: offer.issued_by + ' made settlement offer ' + offer.id + ' on claim ' + claim.id + ' with a valuation of ' + amount(offer.valuation) + '.' +
        (offer.lienholder_payoff === null ? '' : ' The lender reports a payoff of ' + amount(offer.lienholder_payoff) + '.') +
        ' Please accept or reject it by ' + when(offer.respond_by) + '. Open your claim to see what the offer pays to you and to the lender.'};
  },
  'payment.issued'({claim, payment}) {
    const payee = payment.payee.kind === 'shop' ? payment.payee.name : payment.payee.kind === 'lienholder' ? 'the lienholder' : 'you';
    return {title: 'A payment of ' + amount(payment.amount) + ' was issued on claim ' + claim.id,
      text: 'A ' + payment.kind + ' payment of ' + amount(payment.amount) + ' was issued to ' + payee + ' on claim ' + claim.id + '.' +
        (payment.reference === null ? '' : ' Reference: ' + payment.reference + '.') + ' Open your claim to see what is still due.'};
  },
  'repair.completed'({claim, payload}) {
    return {title: 'The repair on claim ' + claim.id + ' was reported complete',
      text: payload.reported_by + ' reported that the repair on claim ' + claim.id + ' is complete.' +
        (payload.final_invoice_total === undefined ? '' : ' The final invoice total that it reported is ' + amount(payload.final_invoice_total) + '.')};
  },
  'claim.closed'({insurer, claim, payload}) {
    const outcome = {paid: 'paid', denied: 'denied', no_response: 'no response'}[payload.outcome];
    return {title: 'Claim ' + claim.id + ' was closed',
      text: insurer + ' closed claim ' + claim.id + ' with the outcome "' + outcome + '".' + (payload.note === undefined ? '' : ' Note: ' + payload.note)};
  }
};
function wire(data, notification, at) {
  return {specversion: '1.0', id: notification.id, source: 'urn:pale:app:' + encodeURIComponent(c.APP) + ':account:' + encodeURIComponent(data.account_id),
    type: 'org.pale.mail.notification.v1', time: at, datacontenttype: 'application/json', dataschema: 'urn:pale:email-payload:1',
    data: {channel: 'channel.email', recipient: {kind: 'person_ref', id: data.owner_person_id},
      source_object: {app_id: c.APP, account_id: data.account_id, object_type: 'claim', object_id: notification.claim_id},
      content: {title: notification.title, body: {format: 'text/plain', text: notification.text}, asset_ids: []},
      subscription_ref: data.account_id + ':claim-updates', extensions: []}};
}
// One notification for one applied event. Times in the text use the time zone of the preferences.
function write(t, data, claim, kind, details) {
  const when = value => time.describe(ms(value), data.preferences.timezone);
  const {title, text} = writers[kind]({insurer: data.insurer.name, claim, when, ...details});
  const notification = {id: c.nextId(c.allIds(data), 'ntf-'), at: t.at, kind, claim_id: claim.id, event_id: t.ref,
    title: title.slice(0, 200), text: text.slice(0, 4000), email: null};
  if (data.preferences.email_notices) notification.email = wire(data, notification, t.at);
  data.notifications.push(notification);
  return notification;
}
module.exports = {write, wire, amount};
