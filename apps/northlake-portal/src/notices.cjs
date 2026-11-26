'use strict';
// Notices to Mail 1.3.0. They are built from records already committed in the portal by the host-run
// publisher (src/publisher.cjs), never from inside a tool or event handler, and the portal records no
// notice status. Each builder takes the public tool views the publisher read over the Agent connection,
// so a notice can only carry what an authorized reader could already see.
const APP = require('../app.json').app_id;
const TYPE = 'org.pale.mail.notification.v1', PAYLOAD = 'urn:pale:email-payload:1', CHANNEL = 'channel.email';

const money = cents => '$' + Math.floor(Math.abs(cents) / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + String(Math.abs(cents) % 100).padStart(2, '0');
const when = (value, tz) => new Intl.DateTimeFormat('en-US', {timeZone:tz, weekday:'long', month:'long', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit', timeZoneName:'short'}).format(new Date(value));
const monthLabel = day => new Intl.DateTimeFormat('en-US', {timeZone:'UTC', month:'long', year:'numeric'}).format(Date.parse(day + 'T00:00:00Z'));
const dayLabel = day => new Intl.DateTimeFormat('en-US', {timeZone:'UTC', month:'long', day:'numeric', year:'numeric'}).format(Date.parse(day + 'T00:00:00Z'));
const place = a => a.clinic_name + ', ' + a.clinic_address.line1 + (a.clinic_address.line2 ? ', ' + a.clinic_address.line2 : '') + ', ' + a.clinic_address.city;
const need = (value, what) => {if (value === undefined || value === null) throw new Error('A ' + what + ' view is required to build this notice.'); return value;};

const KINDS = {
  // portal.staff_reply: a staff member wrote in a thread. The body is not included; the notice points to the portal.
  new_message({account, thread, message_id}) {
    const t = need(thread, 'thread'), m = t.messages.find(x => x.message_id === message_id);
    if (!m) throw new Error('Message ' + message_id + ' is not in thread ' + t.thread_id + '.');
    return {object_type:'message', object_id:m.message_id, route_id:'inbox', route_object:t.thread_id, at:m.at,
      title:'New message from ' + m.author.display_name + ' in ' + account.health_system.portal_name,
      text:m.author.display_name + ' wrote in "' + t.subject + '" on ' + when(m.at, account.settings.timezone) + '. Sign in to ' + account.health_system.portal_name + ' to read and reply; message content is not included in this notice.'};
  },
  // portal.billing.statement_ready
  statement_ready({account, statement}) {
    const s = need(statement, 'statement'), hs = account.health_system;
    return {object_type:'statement', object_id:s.statement_id, route_id:'billing', at:s.generated_at,
      title:'Your ' + hs.name + ' statement for ' + monthLabel(s.period_start) + ' is ready',
      text:'Your statement for ' + dayLabel(s.period_start) + ' to ' + dayLabel(s.period_end) + ' is ready in the ' + hs.portal_name + '. Balance due: ' + money(s.balance_due_cents) +
        (s.past_due_cents > 0 ? ', of which ' + money(s.past_due_cents) + ' is past due.' : '.') +
        (s.past_due_note ? ' Balances more than ' + hs.past_due_after_days + ' days past due may be referred to collections.' : '') +
        ' Open Billing to view or download the itemized statement.'};
  },
  // portal.billing.request_decided
  request_decided({account, request}) {
    const r = need(request, 'request'), kind = r.kind === 'fee_waiver' ? 'fee waiver' : 'refund';
    return {object_type:'billing_request', object_id:r.request_id, route_id:'billing', at:r.updated_at,
      title:'Your ' + kind + ' request was ' + r.status,
      text:'The ' + account.health_system.name + ' billing office ' + r.status + ' your ' + kind + ' request ' + r.request_id + ' on claim ' + r.claim_id +
        (r.decision_note ? ': ' + r.decision_note : '.') + ' Open Billing in the ' + account.health_system.portal_name + ' to see the updated balance.'};
  },
  // appointments.confirm, waitlist.accept and reschedules: the booked visit.
  appointment_confirmation({account, appointment}) {
    const a = need(appointment, 'appointment'), tz = account.settings.timezone;
    return {object_type:'appointment', object_id:a.appointment_id, route_id:'appointments', at:a.updated_at,
      title:'Appointment confirmed: ' + when(a.start, tz),
      text:'Your ' + a.visit_type.replace('_', ' ') + ' visit with ' + a.provider_name + ' (' + a.specialty + ') is confirmed for ' + when(a.start, tz) + ' at ' + place(a) + '. ' + account.health_system.cancellation_policy};
  },
  // portal.appointment.update: the clinic cancelled or moved a visit.
  appointment_changed({account, appointment, replacement = null}) {
    const a = need(appointment, 'appointment'), tz = account.settings.timezone;
    if (a.status === 'cancelled_by_clinic') return {object_type:'appointment', object_id:a.appointment_id, route_id:'appointments', at:a.updated_at,
      title:'Your appointment on ' + when(a.start, tz) + ' was cancelled by the clinic',
      text:account.health_system.name + ' cancelled your visit with ' + a.provider_name + ' on ' + when(a.start, tz) + (a.cancellation_reason ? ' (' + a.cancellation_reason.replace(/_/g, ' ') + ')' : '') + '. Open Appointments in the ' + account.health_system.portal_name + ' to book another time.'};
    if (a.status !== 'rescheduled' || !a.replaced_by) throw new Error('Appointment ' + a.appointment_id + ' was not changed by the clinic.');
    return {object_type:'appointment', object_id:a.appointment_id, route_id:'appointments', route_object:a.replaced_by, at:a.updated_at,
      title:'Your appointment on ' + when(a.start, tz) + ' was moved',
      text:account.health_system.name + ' moved your visit with ' + a.provider_name + ' from ' + when(a.start, tz) + (replacement ? ' to ' + when(replacement.start, tz) + ' at ' + place(replacement) : ' to a new time (' + a.replaced_by + ')') + '. Reply in the portal if the new time does not work.'};
  },
  // portal.waitlist.offer
  waitlist_offer({account, entry}) {
    const e = need(entry, 'waitlist entry'), tz = account.settings.timezone;
    if (!e.offer || !e.offer_slot) throw new Error('Waitlist entry ' + e.waitlist_entry_id + ' has no open offer.');
    return {object_type:'waitlist_entry', object_id:e.waitlist_entry_id, route_id:'appointments', at:e.offer.offered_at,
      title:'An earlier appointment is available with ' + e.provider_name,
      text:'A slot opened with ' + e.provider_name + ' on ' + when(e.offer_slot.start, tz) + '. Accept or decline it in the ' + account.health_system.portal_name + ' before ' + when(e.offer.offer_expires_at, tz) + '; after that the offer goes to the next person on the waitlist.'};
  },
  // portal.appointment.reminder
  appointment_reminder({account, appointment}) {
    const a = need(appointment, 'appointment'), tz = account.settings.timezone;
    if (!a.reminder_sent_at) throw new Error('Appointment ' + a.appointment_id + ' has no reminder on record.');
    return {object_type:'appointment', object_id:a.appointment_id, route_id:'appointments', at:a.reminder_sent_at,
      title:'Reminder: ' + a.provider_name + ' on ' + when(a.start, tz),
      text:'You have a ' + a.visit_type.replace('_', ' ') + ' visit with ' + a.provider_name + ' on ' + when(a.start, tz) + ' at ' + place(a) + '. Please arrive 10 minutes early. ' + account.health_system.cancellation_policy};
  }
};

// A full CloudEvents 1.0 envelope in Mail's wire profile (urn:pale:email-message:2). The recipient is the logical
// person reference Infra binds to the user's Mail account; the (source, id) pair makes a repeated notice deduplicate.
function build(kind, views, {account, person}) {
  const make = KINDS[kind];
  if (!make) throw new Error('Unknown notice kind ' + kind + '. Kinds: ' + Object.keys(KINDS).join(', ') + '.');
  if (!views || !views.account) throw new Error('The account view (account.get) is required to build a notice.');
  const n = make(views);
  return {specversion:'1.0', id:APP + '-notice-' + kind.replace(/_/g, '-') + '-' + n.object_id, source:'urn:pale:app:' + APP + ':account:' + account,
    type:TYPE, datacontenttype:'application/json', dataschema:PAYLOAD, time:n.at, subject:n.object_id,
    data:{channel:CHANNEL, recipient:{kind:'person_ref', id:person}, source_object:{app_id:APP, account_id:account, object_type:n.object_type, object_id:n.object_id},
      content:{title:n.title.slice(0, 200), body:{format:'text/plain', text:n.text}, asset_ids:[], deep_link:{app_id:APP, route_id:n.route_id, object_id:n.route_object || n.object_id}}, extensions:[]}};
}
module.exports = {build, KINDS:Object.keys(KINDS), TYPE, PAYLOAD, CHANNEL};
