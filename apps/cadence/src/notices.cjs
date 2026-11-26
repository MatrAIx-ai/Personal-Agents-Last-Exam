'use strict';
// Notices to Mail 1.3.0, built from public tool views by the host-run publisher (src/publisher.cjs), never from a
// handler. Cadence records no notice status. Kinds: booking confirmation, studio cancellation, schedule change,
// waitlist offer, trial-ending reminder and renewal receipt.
const APP = require('../app.json').app_id;
const TYPE = 'org.pale.mail.notification.v1', PAYLOAD = 'urn:pale:email-payload:1', CHANNEL = 'channel.email';
const money = cents => '$' + Math.floor(cents / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + String(cents % 100).padStart(2, '0');
const when = (value, tz) => new Intl.DateTimeFormat('en-US', {timeZone:tz, weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit'}).format(new Date(value));
const longWhen = (value, tz) => new Intl.DateTimeFormat('en-US', {timeZone:tz, weekday:'long', month:'long', day:'numeric', hour:'numeric', minute:'2-digit'}).format(new Date(value));
const dayLabel = day => new Intl.DateTimeFormat('en-US', {timeZone:'UTC', weekday:'long', month:'long', day:'numeric'}).format(Date.parse(day + 'T00:00:00Z'));
const need = (value, what) => {if (value === undefined || value === null) throw new Error('A ' + what + ' view is required to build this notice.'); return value;};
const priced = r => r.price.kind === 'included' ? 'the class was included in your plan' : r.price.kind === 'credits' ? r.credits_charged + ' credit' + (r.credits_charged === 1 ? '' : 's') + (r.status === 'cancelled_by_studio' ? ' were returned' : ' were charged') : 'nothing was charged';

const KINDS = {
  booking_confirmed({account, reservation}) {
    const r = need(reservation, 'reservation'), tz = account.settings.timezone, k = r.class;
    if (r.status !== 'booked') throw new Error('Reservation ' + r.id + ' is not booked.');
    return {object_type:'reservation', object_id:r.id, route_id:'reservations', at:r.booked_at,
      title:'Booked: ' + k.title + ' at ' + k.studio_name + ', ' + when(k.start, tz),
      text:'You are booked for ' + k.title + ' at ' + k.studio_name + ' on ' + longWhen(k.start, tz) + (k.instructor_name ? ' with ' + k.instructor_name : '') + '; ' + priced(r) + '. Cancel free until ' + when(r.cancel_by, tz) + '. Your reservation is ' + r.id + '.'};
  },
  cancelled_by_studio({account, reservation}) {
    const r = need(reservation, 'reservation'), tz = account.settings.timezone, k = r.class;
    if (r.status !== 'cancelled_by_studio') throw new Error('Reservation ' + r.id + ' was not cancelled by the studio.');
    return {object_type:'reservation', object_id:r.id, route_id:'reservations', at:r.updated_at,
      title:'Cancelled by the studio: ' + k.title + ' at ' + k.studio_name + ', ' + when(k.start, tz),
      text:k.studio_name + ' cancelled ' + k.title + ' on ' + longWhen(k.start, tz) + (r.cancellation_reason ? ' (' + r.cancellation_reason.replace(/_/g, ' ') + ')' : '') + '. Your reservation ' + r.id + ' is cancelled and ' + priced(r) + '. Open Cadence to book a replacement.'};
  },
  schedule_changed({account, reservation}) {
    const r = need(reservation, 'reservation'), tz = account.settings.timezone, k = r.class;
    if (!r.time_changed) throw new Error('Reservation ' + r.id + ' has no time change.');
    return {object_type:'reservation', object_id:r.id, route_id:'reservations', at:r.updated_at,
      title:'Time changed: ' + k.title + ' at ' + k.studio_name + ' now ' + when(k.start, tz),
      text:k.studio_name + ' moved ' + k.title + ' to ' + longWhen(k.start, tz) + '. Your reservation ' + r.id + ' moved with it' + (r.conflict ? ' and now overlaps another reservation of yours' : '') + '. A cancellation after this change carries no fee.'};
  },
  waitlist_offer({account, entry}) {
    const e = need(entry, 'waitlist entry'), tz = account.settings.timezone, k = e.class;
    if (!e.offer || e.status !== 'offered') throw new Error('Waitlist entry ' + e.id + ' has no open offer.');
    return {object_type:'waitlist_entry', object_id:e.id, route_id:'waitlist', at:e.offer.offered_at,
      title:'A spot opened: ' + k.title + ' at ' + k.studio_name + ', ' + when(k.start, tz),
      text:'A spot opened in ' + k.title + ' at ' + k.studio_name + ' on ' + longWhen(k.start, tz) + '. Accept or decline it in Cadence before ' + when(e.offer.offer_expires_at, tz) + '; after that the offer passes to the next person.'};
  },
  trial_ending({account, plan}) {
    const p = need(plan, 'plan');
    if (p.status !== 'trial' || !p.trial_end) throw new Error('The account is not on a trial.');
    return {object_type:'plan', object_id:p.id, route_id:'plan', at:p.trial_reminder_sent_at || account.plan.trial_reminder_sent_at || new Date(0).toISOString(),
      title:'Your Cadence trial ends ' + dayLabel(p.trial_end),
      text:'Your free trial ends on ' + dayLabel(p.trial_end) + '. ' + (p.renews_to ? 'It then renews into ' + p.renews_to.name + ' at ' + money(p.renews_to.price_cents) + ' unless you cancel before then in Cadence under Plan.' : 'It will not renew.')};
  },
  renewal_receipt({account, plan, receipt}) {
    const p = need(plan, 'plan'), r = need(receipt, 'receipt');
    return {object_type:'receipt', object_id:r.receipt_id, route_id:'plan', at:r.at,
      title:'Receipt: ' + p.name + ' renewed for ' + money(r.amount_cents),
      text:'Cadence charged ' + money(r.amount_cents) + (p.payment_method ? ' to ' + p.payment_method.brand + ' ending ' + p.payment_method.last4 : '') + ' for ' + r.description + '. You have ' + p.credits_remaining + ' credits until ' + dayLabel(p.renewal_date) + '.'};
  }
};
function build(kind, views, {account, person}) {
  const make = KINDS[kind];
  if (!make) throw new Error('Unknown notice kind ' + kind + '. Kinds: ' + Object.keys(KINDS).join(', ') + '.');
  if (!views || !views.account) throw new Error('The account view (account.get) is required to build a notice.');
  const n = make(views);
  return {specversion:'1.0', id:APP + '-notice-' + kind.replace(/_/g, '-') + '-' + n.object_id, source:'urn:pale:app:' + APP + ':account:' + account,
    type:TYPE, datacontenttype:'application/json', dataschema:PAYLOAD, time:n.at, subject:n.object_id,
    data:{channel:CHANNEL, recipient:{kind:'person_ref', id:person}, source_object:{app_id:APP, account_id:account, object_type:n.object_type, object_id:n.object_id},
      content:{title:n.title.slice(0, 200), body:{format:'text/plain', text:n.text}, asset_ids:[], deep_link:{app_id:APP, route_id:n.route_id, object_id:n.object_id}}, extensions:[]}};
}
module.exports = {build, KINDS:Object.keys(KINDS), TYPE, PAYLOAD, CHANNEL};
