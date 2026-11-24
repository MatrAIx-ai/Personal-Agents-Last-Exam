'use strict';
// Infra-applied events. Each handler observes the event's own `at` as ctx.virtual_now.
// The App never schedules itself: Infra decides when a category change is announced, when to
// warn about expiry and when to expire points; Messaging delivers loyalty credits.
const c = require('./common.cjs');
const d = require('./dates.cjs');
const p = require('./program.cjs');
const {notice} = require('./notices.cjs');

// Loyalty credit from Waypoint (receiver-owned contract urn:pale:loyalty-credit:1).
function receive(ctx, data, event) {
  const {recipient_account_id, message} = event.payload, credit = message.data;
  if (recipient_account_id !== data.account_id || credit.recipient.app_id !== 'harbor' || credit.recipient.id !== data.account_id) {
    c.fail('invalid_event', 'Wrong receiving account.');
  }
  const source = credit.source_object;
  const sender = ctx.binding.accounts.find(a => a.app_id === 'waypoint' && a.account_id === source.account_id);
  if (!sender) c.fail('permission_denied', 'The sending Waypoint account is not bound to this run.');
  if (credit.content.kind !== 'partner_transfer') c.fail('invalid_event', 'Harbor accepts only partner transfers.');
  if (sender.owner_person_id !== data.owner_person_id || credit.content.member_person_id !== data.owner_person_id ||
      (credit.content.member_number !== null && credit.content.member_number !== data.member_number)) {
    c.fail('permission_denied', 'Points move only between accounts of the same member.');
  }
  if (data.ledger.some(e => e.id === event.event_id)) c.fail('already_exists', 'This credit is already in the ledger.');
  data.balance += credit.content.points;
  data.ledger.push({id:event.event_id, at:event.at, kind:'transfer_in', points:credit.content.points, balance_after:data.balance,
    ref:{app_id:'waypoint', account_id:source.account_id, object_type:source.object_type, object_id:source.object_id,
      message_id:message.id, sent_at:message.time ?? null}});
  data.last_activity_at = event.at; // a transfer in is account activity
  c.log(ctx, 'harbor.transfer_in', {record_id:event.event_id, source_object_id:source.object_id});
  return data;
}

function categoryChange(ctx, data, event) {
  const {hotel_id, category, effective_at} = event.payload, hotel = c.find(data.hotels, hotel_id, 'Hotel');
  if (c.ms(effective_at) <= c.ms(event.at)) c.fail('invalid_event', 'A category change must take effect after it is announced.');
  const last = hotel.category_changes.at(-1);
  if (last && c.ms(effective_at) <= c.ms(last.effective_at)) c.fail('invalid_event', 'A new change must take effect after every change already announced.');
  const before = p.categoryAt(hotel, effective_at);
  if (category === before) c.fail('invalid_event', 'The hotel is already in category ' + category + ' at that time.');
  if (!data.award_chart.some(r => r.category === category)) c.fail('invalid_event', 'The award chart has no row for category ' + category + '.');
  hotel.category_changes.push({category, effective_at, announced_at:event.at});
  const n = notice(ctx, data, 'category_change', hotel.name + ' changes to Category ' + category,
    hotel.name + ' moves from Category ' + before + ' to Category ' + category + ' on ' + d.localDate(effective_at, hotel.timezone) +
    ' (' + effective_at + '). Award prices for bookings made from then on use the new category; existing reservations keep their price.',
    {object_type:'hotel', object_id:hotel.id});
  c.log(ctx, 'harbor.category_change', {record_id:hotel.id, notice_id:n.id});
  return data;
}

function expire(ctx, data) {
  const at = p.expiresAt(data);
  if (c.ms(ctx.virtual_now) < c.ms(at)) c.fail('not_due', 'Points do not expire until ' + at + '.');
  const forfeited = data.balance;
  // With a zero balance the run is still recorded, as a zero-point expire entry.
  data.ledger.push({id:c.nextId(data.ledger, 'ledger'), at:ctx.virtual_now, kind:'expire', points:forfeited ? -forfeited : 0, balance_after:0, ref:null});
  data.balance = 0;
  if (forfeited > 0) data.forfeited_at = ctx.virtual_now;
  c.log(ctx, 'harbor.points_expire', {record_id:data.ledger.at(-1).id, forfeited:forfeited > 0});
  return data;
}

function warn(ctx, data) {
  const at = p.expiresAt(data), opens = p.warningOpensAt(data);
  if (c.ms(ctx.virtual_now) < c.ms(opens) || c.ms(ctx.virtual_now) >= c.ms(at)) {
    c.fail('not_due', 'Expiry warnings are sent from ' + opens + ' until points expire at ' + at + '.');
  }
  notice(ctx, data, 'expiry_warning', 'Your Harbor points expire on ' + at.slice(0, 10),
    'Your ' + c.thousands(data.balance) + ' Harbor points expire at ' + at + ' unless the account has activity before then. ' +
    'A points or Points + Cash redemption, or points transferred in, counts as activity; a refund or a cash stay does not.',
    {object_type:'account', object_id:data.account_id});
  return data;
}

function applyEvent(ctx, data, event) {
  const op = event.operation;
  if (op === 'harbor.receive') return receive(ctx, data, event);
  if (op === 'harbor.category.change') return categoryChange(ctx, data, event);
  if (op === 'harbor.points.expire') return expire(ctx, data);
  if (op === 'harbor.expiry.warn') return warn(ctx, data);
  c.fail('invalid_event', 'Unsupported operation.');
}

module.exports = {applyEvent};
