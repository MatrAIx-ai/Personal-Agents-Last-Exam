'use strict';
const c = require('./common.cjs');
const views = require('./views.cjs');
const {ms, cents, time, amountText, pointsText} = c;
// The text of a notification and, when the account wants email, the full wire message for Mail's receive contract.
// The object type and the subscription topic of each kind of notification.
const ABOUT = {
  'transaction.posted': ['transaction', 'transaction-updates'], 'statement.issued': ['statement', 'statement-updates'], 'payment.returned': ['payment', 'payment-updates'],
  'dispute.updated': ['dispute', 'dispute-updates'], 'offer.issued': ['offer', 'offer-updates'], 'points.adjusted': ['points_entry', 'points-updates']
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const sentence = value => value ? ' ' + value + (/[.!?]$/.test(value) ? '' : '.') : '';
const from = tx => tx.merchant ? ' from ' + tx.merchant : '';
const LABEL = {refund: 'refund', fee: 'fee', interest: 'interest charge', credit: 'credit', reversal: 'reversal', provisional_credit: 'temporary credit'};

const writers = {
  'transaction.posted'({data, tx, say}) {
    const amount = amountText(cents(tx.amount)), purchase = tx.relates_to ? data.transactions.find(x => x.id === tx.relates_to) : null;
    const about = purchase && purchase.kind === 'purchase' ? ' It is for the charge of ' + amountText(cents(purchase.amount)) + from(purchase) + ' on ' + say.time(purchase.transaction_at) + '.' : '';
    if (tx.state === 'pending') return {title: 'A pending ' + LABEL[tx.kind] + ' of ' + amount + ' was added',
      text: 'Brindle Card added a pending ' + LABEL[tx.kind] + ' of ' + amount + from(tx) + '.' + about + ' It does not count in your balance until it posts.' + sentence(tx.note)};
    if (tx.kind === 'refund') return {title: 'A refund of ' + amount + (tx.merchant ? ' from ' + tx.merchant : '') + ' has posted',
      text: 'A refund of ' + amount + from(tx) + ' posted to your account.' + about + ' A refund from the merchant is final.' + sentence(tx.note)};
    if (tx.kind === 'fee' && tx.fee_type === 'annual') {
      const end = time.limitEnd(c.dayOf(data, tx.posted_at), data.issuer.rules.fee_refund_days, c.zone(data));
      return {title: 'Your annual fee of ' + amount + ' has posted',
        text: 'Your annual fee of ' + amount + ' posted to your account. If you close the account by ' + say.day(time.addDays(time.localDay(end, c.zone(data)), -1)) +
          ', the fee is refunded.' + sentence(tx.note)};
    }
    if (tx.kind === 'fee') return {title: 'A fee of ' + amount + ' has posted', text: 'A fee of ' + amount + ' posted to your account.' + sentence(tx.note)};
    if (tx.kind === 'interest') return {title: 'Interest of ' + amount + ' has posted', text: 'An interest charge of ' + amount + ' posted to your account.' + sentence(tx.note)};
    if (tx.kind === 'credit') {
      const offer = tx.offer_id ? data.offers.find(o => o.id === tx.offer_id) : null;
      return {title: 'A credit of ' + amount + ' has posted', text: 'A credit of ' + amount + ' posted to your account.' +
        (offer ? ' It pays your offer ' + offer.id + '.' : '') + about + sentence(tx.note)};
    }
    const dispute = data.disputes.find(d => d.id === tx.dispute_id);
    return {title: 'We took back the temporary credit of ' + amount,
      text: 'Brindle Card took back ' + amount + ' of the temporary credit for your dispute ' + dispute.id + '.' + about + ' The amount is part of your balance again.' + sentence(tx.note)};
  },
  'statement.issued'({data, statement, payment, say}) {
    const total = amountText(cents(statement.statement_balance)), due = say.time(statement.due_at);
    const auto = payment ? ' Autopay will pay ' + amountText(cents(payment.scheduled_amount)) + ' on ' + say.day(payment.pay_on) + ', less any payment you make toward this statement before that day.'
      : ' Autopay is off for this statement.';
    return {title: 'Your statement is ready: ' + total + ' is due on ' + due,
      text: 'Your statement ' + statement.id + ' closed on ' + say.time(statement.closing_at) + '. The statement balance is ' + total + ', and the minimum due is ' +
        amountText(cents(statement.minimum_due)) + '. Pay by ' + say.moment(statement.due_at) + '.' + auto};
  },
  'payment.returned'({payment, say, amount}) {
    return {title: 'Your payment of ' + amountText(amount) + ' was returned',
      text: 'Your payment ' + payment.id + ' of ' + amountText(amount) + ' from ' + payment.source + ' on ' + say.day(payment.pay_on) + ' was returned.' + sentence(payment.return_reason) +
        ' The amount is part of your balance again. Check your bill and schedule a new payment if you need one.'};
  },
  'dispute.updated'({data, dispute, credit, reversal, note, say}) {
    const purchase = data.transactions.find(tx => tx.id === dispute.transaction_id);
    const about = 'your dispute ' + dispute.id + ' about the charge of ' + amountText(cents(purchase.amount)) + from(purchase) + ' on ' + say.time(purchase.transaction_at);
    const parts = [];
    if (credit) parts.push('Brindle Card added a temporary credit of ' + amountText(cents(credit.amount)) + ' for ' + about + '. The credit is not final. If the merchant refunds you, ' +
      'or the review ends in the merchant\'s favor, we will take the temporary credit back.');
    if (reversal) parts.push('Brindle Card took back ' + amountText(cents(reversal.amount)) + ' of the temporary credit for ' + about + '.');
    const state = dispute.state;
    if (!credit && !reversal) parts.push('There is an update on ' + about + '.');
    parts.push({open: 'Your dispute is still open.', resolved_for_me: 'The dispute is resolved in your favor. Any temporary credit that is left is now final.',
      resolved_for_merchant: 'The dispute is resolved in the merchant\'s favor.', closed_matched: 'The dispute is closed because the merchant refunded you.'}[state]);
    if (note && !(credit && state === 'open')) parts.push(sentence(note).trim());
    const title = credit && state === 'open' ? 'We added a temporary credit of ' + amountText(cents(credit.amount)) + ' while we review your dispute'
      : {resolved_for_me: 'Your dispute was resolved in your favor', resolved_for_merchant: 'Your dispute was resolved in the merchant\'s favor',
        closed_matched: 'Your dispute was closed because the merchant refunded you'}[state] || 'We have an update on your dispute';
    return {title, text: parts.join(' ')};
  },
  'offer.issued'({offer, say}) {
    return {title: 'You have a new offer', text: 'Brindle Card has a new offer for you (' + offer.id + '): ' + sentence(offer.terms).trim() + ' Accept or decline it by ' +
      say.moment(offer.accept_by) + '. After that it ends.' + (offer.group ? ' You can accept only one offer of this group.' : '')};
  },
  'points.adjusted'({data, entry}) {
    const n = pointsText(Math.abs(entry.points)), offer = entry.offer_id ? ' It pays your offer ' + entry.offer_id + '.' : '';
    return {title: n + ' points were ' + (entry.points > 0 ? 'added' : 'taken off'),
      text: n + ' points were ' + (entry.points > 0 ? 'added to' : 'taken off') + ' your account ' + {earned: 'for your purchases', bonus: 'as a bonus', adjustment: 'as an adjustment'}[entry.reason] + '.' + offer + sentence(entry.note) +
        ' Your points balance is now ' + pointsText(views.pointsBalance(data)) + '.'};
  }
};
function wire(data, notification) {
  const [objectType, topic] = ABOUT[notification.kind];
  return {specversion: '1.0', id: notification.id, source: 'urn:pale:app:' + encodeURIComponent(c.APP) + ':account:' + encodeURIComponent(data.account_id),
    type: 'org.pale.mail.notification.v1', time: notification.at, datacontenttype: 'application/json', dataschema: 'urn:pale:email-payload:1',
    data: {channel: 'channel.email', recipient: {kind: 'person_ref', id: data.owner_person_id},
      source_object: {app_id: c.APP, account_id: data.account_id, object_type: objectType, object_id: notification.object_id},
      content: {title: notification.title, body: {format: 'text/plain', text: notification.text}, asset_ids: []},
      subscription_ref: data.account_id + ':' + topic, extensions: []}};
}
// "2 November", with the year only when it is not the year of the notification.
const dayText = (day, year) => Number(day.slice(8, 10)) + ' ' + MONTHS[Number(day.slice(5, 7)) - 1] + (day.slice(0, 4) === String(year) ? '' : ' ' + day.slice(0, 4));
// One notification for one applied event. Days and times in the text use the time zone of the preferences.
function write(t, data, kind, objectId, details) {
  const zone = data.preferences.timezone, year = Number(time.localDay(t.now, zone).slice(0, 4));
  const say = {day: day => dayText(day, year), time: value => dayText(time.localDay(ms(value), zone), year),
    moment: value => { const local = time.iso(ms(value), zone); return dayText(local.slice(0, 10), year) + ' at ' + local.slice(11, 16); }};
  const {title, text} = writers[kind]({data, say, now: t.now, ...details});
  const notification = {id: c.nextId(c.allIds(data), 'ntf-'), at: t.at, kind, event_id: t.ref, object_type: ABOUT[kind][0], object_id: objectId,
    title: title.slice(0, 200), text: text.slice(0, 4000), email: null};
  if (data.preferences.email_notices) notification.email = wire(data, notification);
  data.notifications.push(notification);
  c.record(t, data, 'notification.written', notification.id, true);
  return notification;
}
module.exports = {write, wire, ABOUT};
