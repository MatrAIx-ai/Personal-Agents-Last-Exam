'use strict';
// Single source of truth for the Northlake Portal data model and tool contracts.
// scripts/build.cjs renders schemas/seed.schema.json, schemas/events.schema.json,
// schemas/state.schema.json, tools.json and fixtures/policies.json from here so the
// generated files cannot drift from each other. Edit this file, then run the build.
const APP = 'northlake-portal';
const PREFIX = APP + '.';

// ---- primitive shapes -------------------------------------------------------
const ID = {type:'string', pattern:'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$'};
const DATE = {type:'string', format:'date-time'};
const DAY = {type:'string', pattern:'^\\d{4}-\\d{2}-\\d{2}$'};
const CENTS = {type:'integer', minimum:0, maximum:100000000};
const SIGNED_CENTS = {type:'integer', minimum:-100000000, maximum:100000000};
const DOLLARS = {type:'number', minimum:0, maximum:1000000};
const BOOL = {type:'boolean'};
const INT = (min=0, max=1000000) => ({type:'integer', minimum:min, maximum:max});
const TEXT = (max=2000, min=1) => ({type:'string', minLength:min, maxLength:max});
const ENUM = (...values) => ({enum:values});
const NULLABLE = schema => ({anyOf:[schema, {type:'null'}]});
const obj = (properties, required=Object.keys(properties)) => ({type:'object', properties, required, additionalProperties:false});
const arr = (items, extra={}) => ({type:'array', items, ...extra});
const VERSION = obj({epoch:INT(1), revision:INT(0)});

// Attachments a patient adds to a message: PDF, PNG, JPEG or plain text, 512 KiB each.
const ATTACHMENT_MIME = ENUM('application/pdf', 'image/png', 'image/jpeg', 'text/plain');
// The handler checks format, size and hash itself so a bad document fails with attachment_invalid, not invalid_arguments.
const FILE_IN = obj({
  filename:{type:'string', minLength:1, maxLength:160, pattern:'^[^\\\\/\\u0000-\\u001f\\u007f]+$'},
  mime_type:TEXT(100),
  base64:{type:'string', maxLength:1398104},
  sha256:{type:'string', pattern:'^[a-f0-9]{64}$'}
});
// Bytes the portal returns (statements, exports, attachments) in the shape files.put and mail.attachment.add accept.
const FILE_OUT = obj({
  filename:{type:'string', minLength:1, maxLength:160, pattern:'^[^\\\\/\\u0000-\\u001f\\u007f]+$'},
  mime_type:ATTACHMENT_MIME,
  base64:{type:'string', maxLength:1398104},
  sha256:{type:'string', pattern:'^[a-f0-9]{64}$'}
});

// ---- record shapes (seed / state) -------------------------------------------
const HISTORY = arr(obj({at:DATE, action:TEXT(80), detail:NULLABLE(TEXT(1000, 0))}, ['at', 'action']), {maxItems:1000});
const ADDRESS = obj({line1:TEXT(200), line2:NULLABLE(TEXT(200)), city:TEXT(100), state:TEXT(2, 2), postal_code:TEXT(10)});
const INSURANCE = obj({plan_id:ID, plan_name:TEXT(200), payer:TEXT(200), member_id:TEXT(60), group_number:NULLABLE(TEXT(60)), effective_from:DAY});
const CARD = NULLABLE(obj({brand:TEXT(40), last4:TEXT(4, 4)}));
const PATIENT = obj({patient_id:ID, name:TEXT(200), date_of_birth:DAY, email:TEXT(200), phone:TEXT(40), address:ADDRESS, mrn:TEXT(40), insurance:INSURANCE, card_on_file:CARD});
const HEALTH_SYSTEM = obj({name:TEXT(200), portal_name:TEXT(200), phone:TEXT(40), billing_phone:TEXT(40), billing_hours:TEXT(200),
  cancellation_policy:TEXT(1000), cancellation_notice_hours:INT(0, 168), late_cancellation_fee_cents:CENTS, past_due_after_days:INT(1, 365)});
const SETTINGS = obj({require_user_confirmation:BOOL, preview_ttl_minutes:INT(1, 1440), timezone:TEXT(60)});
const INTERSTITIAL_KIND = ENUM('privacy_notice', 'session_check');
const CLEARABLE_BY = ENUM('agent', 'user');
const INTERSTITIAL = NULLABLE(obj({interstitial_id:ID, kind:INTERSTITIAL_KIND, clearable_by:CLEARABLE_BY, text:TEXT(2000), status:ENUM('pending', 'cleared'),
  set_at:DATE, cleared_at:NULLABLE(DATE), cleared_by:NULLABLE(CLEARABLE_BY)}));
const CLINIC = obj({clinic_id:ID, name:TEXT(200), address:ADDRESS, phone:TEXT(40), hours:TEXT(300), parking_note:NULLABLE(TEXT(300))});
const NETWORK_STATUS = ENUM('in_network', 'out_of_network');
const NETWORK = obj({plan_id:ID, status:NETWORK_STATUS});
const VISIT_TYPE = ENUM('new_patient', 'follow_up');
const PROVIDER = obj({provider_id:ID, name:TEXT(200), credentials:TEXT(40), specialty:TEXT(100), clinic_id:ID, networks:arr(NETWORK, {maxItems:20}),
  rating:NULLABLE({type:'number', minimum:0, maximum:5}), review_count:INT(0), accepting_new_patients:BOOL, languages:arr(TEXT(40), {maxItems:10}), bio:TEXT(1000, 0)});
const SLOT_STATUS = ENUM('open', 'taken', 'booked');
const SLOT = obj({slot_id:ID, provider_id:ID, clinic_id:ID, start:DATE, end:DATE, visit_types:arr(VISIT_TYPE, {minItems:1, maxItems:2, uniqueItems:true}), status:SLOT_STATUS});
const APPOINTMENT_STATUS = ENUM('booked', 'completed', 'cancelled_by_patient', 'cancelled_by_clinic', 'rescheduled');
const APPOINTMENT = obj({appointment_id:ID, provider_id:ID, clinic_id:ID, slot_id:ID, start:DATE, end:DATE, visit_type:VISIT_TYPE, reason:TEXT(500, 0),
  status:APPOINTMENT_STATUS, replaced_by:NULLABLE(ID), replaces:NULLABLE(ID), cancellation_reason:NULLABLE(TEXT(300)), reminder_sent_at:NULLABLE(DATE),
  created_at:DATE, updated_at:DATE, history:HISTORY});
const OFFER = NULLABLE(obj({offer_id:ID, slot_id:ID, offered_at:DATE, offer_expires_at:DATE, approved:BOOL, identity_verified:BOOL}));
const WAITLIST_STATUS = ENUM('waiting', 'offered', 'booked', 'declined', 'expired', 'left');
const WAITLIST_ENTRY = obj({waitlist_entry_id:ID, provider_id:ID, appointment_id:NULLABLE(ID), earliest:DATE, latest:DATE, status:WAITLIST_STATUS, offer:OFFER,
  booked_appointment_id:NULLABLE(ID), created_at:DATE, updated_at:DATE, history:HISTORY});
const AUTHOR = obj({role:ENUM('patient', 'clinic', 'nurse_line', 'billing_office', 'provider', 'system'), display_name:TEXT(120)});
const MESSAGE = obj({message_id:ID, at:DATE, author:AUTHOR, body:TEXT(20000, 0), read:BOOL, attachments:arr(ID, {maxItems:2, uniqueItems:true})});
const RECIPIENT_CATEGORY = ENUM('clinic', 'nurse_line', 'billing_office');
const RECIPIENT = obj({category:NULLABLE(RECIPIENT_CATEGORY), display_name:TEXT(120)});
const RELATED = obj({claim_id:NULLABLE(ID), appointment_id:NULLABLE(ID)});
const THREAD = obj({thread_id:ID, subject:TEXT(200), recipient:RECIPIENT, status:ENUM('open', 'closed'), awaiting:NULLABLE(ENUM('staff', 'patient')),
  closed_reason:NULLABLE(TEXT(200)), related:RELATED, opened_at:DATE, updated_at:DATE, history:HISTORY, messages:arr(MESSAGE, {maxItems:500})});
const CLAIM_STATUS = ENUM('in_adjudication', 'paid', 'denied', 'reprocessing');
const CLAIM_KIND = ENUM('visit', 'lab', 'fee');
const CLAIM_HISTORY = arr(obj({at:DATE, action:TEXT(80), status:CLAIM_STATUS, detail:NULLABLE(TEXT(1000, 0))}, ['at', 'action', 'status']), {maxItems:200});
const CLAIM = obj({claim_id:ID, kind:CLAIM_KIND, service_date:DAY, provider_id:NULLABLE(ID), clinic_id:ID, description:TEXT(300), status:CLAIM_STATUS,
  billed_cents:CENTS, insurance_adjustment_cents:CENTS, insurance_paid_cents:CENTS, patient_responsibility_cents:CENTS, reason_code:NULLABLE(TEXT(80)),
  statement_id:NULLABLE(ID), posted_at:DATE, updated_at:DATE, history:CLAIM_HISTORY});
const ALLOCATION = obj({claim_id:ID, amount_cents:CENTS});
const PAYMENT_METHOD = ENUM('card', 'bank', 'check', 'portal_card_on_file', 'portal_refund');
const PAYMENT = obj({payment_id:ID, at:DATE, kind:ENUM('payment', 'refund'), amount_cents:CENTS, method:PAYMENT_METHOD, last4:NULLABLE(TEXT(4, 4)),
  allocations:arr(ALLOCATION, {maxItems:50}), confirmation_number:TEXT(40), note:TEXT(300, 0)});
const REQUEST_KIND = ENUM('refund', 'fee_waiver');
const REQUEST_STATUS = ENUM('submitted', 'granted', 'declined');
const BILLING_REQUEST = obj({request_id:ID, kind:REQUEST_KIND, claim_id:ID, amount_cents:NULLABLE(CENTS), reason:TEXT(2000), status:REQUEST_STATUS,
  decision_note:NULLABLE(TEXT(1000)), created_at:DATE, updated_at:DATE, history:HISTORY});
const STATEMENT = obj({statement_id:ID, period_start:DAY, period_end:DAY, generated_at:DATE, past_due_note:BOOL, claim_ids:arr(ID, {uniqueItems:true, maxItems:200}),
  payment_ids:arr(ID, {uniqueItems:true, maxItems:200}), balance_due_cents:CENTS, past_due_cents:CENTS, filename:TEXT(160)});
const PAYMENT_PREVIEW = obj({amount_cents:CENTS, allocations:arr(ALLOCATION, {maxItems:50}), balance_before_cents:CENTS, balance_after_cents:CENTS});
const APPOINTMENT_PREVIEW = obj({provider_id:ID, slot_id:ID, clinic_id:ID, start:DATE, end:DATE, visit_type:VISIT_TYPE, reason:TEXT(500, 0), network_status:ENUM('in_network', 'out_of_network', 'unknown')});
const PREVIEW = obj({preview_id:ID, kind:ENUM('payment', 'appointment'), created_at:DATE, expires_at:DATE, approved:BOOL, identity_verified:BOOL,
  fingerprint:TEXT(200), payload:{anyOf:[PAYMENT_PREVIEW, APPOINTMENT_PREVIEW]}});
const APPROVAL = obj({target_id:ID, at:DATE});

const SEED = {
  ...obj({
    account_id:ID, owner_person_id:ID, settings:SETTINGS, health_system:HEALTH_SYSTEM, patient:PATIENT, interstitial:INTERSTITIAL,
    clinics:arr(CLINIC, {maxItems:20}), providers:arr(PROVIDER, {maxItems:100}), slots:arr(SLOT, {maxItems:5000}),
    appointments:arr(APPOINTMENT, {maxItems:500}), waitlist:arr(WAITLIST_ENTRY, {maxItems:50}), threads:arr(THREAD, {maxItems:200}),
    claims:arr(CLAIM, {maxItems:500}), payments:arr(PAYMENT, {maxItems:500}), billing_requests:arr(BILLING_REQUEST, {maxItems:100}),
    statements:arr(STATEMENT, {maxItems:100}), previews:arr(PREVIEW, {maxItems:100}), approvals:arr(APPROVAL, {maxItems:100})
  }),
  $schema:'https://json-schema.org/draft/2020-12/schema', $id:'urn:pale:' + APP + ':seed:1'
};

// ---- events (applied by Infra through env.apply_event) ----------------------
const MONEY_RESULT = {result:ENUM('paid', 'denied'), billed:DOLLARS, insurance_adjustment:DOLLARS, insurance_paid:DOLLARS, patient_responsibility:DOLLARS, reason_code:NULLABLE(TEXT(80))};
const EVENTS = [
  ['portal.staff_reply', obj({thread_id:ID, author:AUTHOR, body:TEXT(20000), attachments:arr(FILE_IN, {maxItems:2})}, ['thread_id', 'author', 'body'])],
  ['portal.thread_closed', obj({thread_id:ID, reason:TEXT(200)})],
  ['portal.billing.post', {anyOf:[
    obj({kind:{const:'claim_posted'}, claim_id:ID, claim_kind:CLAIM_KIND, service_date:DAY, provider_id:NULLABLE(ID), clinic_id:ID, description:TEXT(300), billed:DOLLARS}),
    obj({kind:{const:'adjudicated'}, claim_id:ID, ...MONEY_RESULT}),
    obj({kind:{const:'reprocessed'}, claim_id:ID, ...MONEY_RESULT})
  ]}],
  ['portal.billing.statement_ready', obj({statement_id:ID, period_start:DAY, period_end:DAY, past_due_note:BOOL})],
  ['portal.billing.request_decided', obj({request_id:ID, decision:ENUM('granted', 'declined'), note:TEXT(1000, 0)})],
  ['portal.appointment.update', obj({appointment_id:ID, kind:ENUM('cancelled', 'moved'), new_slot_id:NULLABLE(ID), reason:TEXT(200)}, ['appointment_id', 'kind', 'reason'])],
  ['portal.appointment.reminder', obj({appointment_id:ID})],
  ['portal.slot.taken', obj({slot_id:ID})],
  ['portal.waitlist.offer', obj({waitlist_entry_id:ID, slot_id:ID, offer_expires_at:DATE})],
  ['portal.page.interstitial', obj({interstitial_id:ID, kind:INTERSTITIAL_KIND, clearable_by:CLEARABLE_BY, text:TEXT(2000)})],
  ['user.confirmed', {anyOf:[obj({preview_id:ID}), obj({offer_id:ID}), obj({interstitial_id:ID}), obj({draft_id:ID})]}],
  ['user.identity_verified', {anyOf:[obj({preview_id:ID}), obj({offer_id:ID})]}]
];
const EVENT_SCHEMA = {
  $schema:'https://json-schema.org/draft/2020-12/schema',
  oneOf:EVENTS.map(([operation, payload]) => obj({event_id:ID, at:DATE, operation:{const:operation}, payload}))
};

// ---- tool contracts ---------------------------------------------------------
const CLINIC_SUMMARY = obj({clinic_id:ID, name:TEXT(200), address:ADDRESS, phone:TEXT(40), hours:TEXT(300), parking_note:NULLABLE(TEXT(300))});
const SLOT_VIEW = obj({slot_id:ID, provider_id:ID, clinic_id:ID, start:DATE, end:DATE, visit_types:arr(VISIT_TYPE), status:SLOT_STATUS});
const PROVIDER_VIEW = obj({...PROVIDER.properties, clinic:CLINIC_SUMMARY, network_status:ENUM('in_network', 'out_of_network', 'unknown'),
  rating_label:TEXT(80), next_available:NULLABLE(SLOT_VIEW)});
const APPOINTMENT_VIEW = obj({...APPOINTMENT.properties, provider_name:TEXT(200), specialty:TEXT(100), clinic_name:TEXT(200), clinic_address:ADDRESS});
const THREAD_SUMMARY = obj({thread_id:ID, subject:TEXT(200), recipient:RECIPIENT, status:ENUM('open', 'closed'), awaiting:NULLABLE(ENUM('staff', 'patient')),
  closed_reason:NULLABLE(TEXT(200)), related:RELATED, opened_at:DATE, updated_at:DATE, message_count:INT(0), unread_count:INT(0),
  last_message_at:NULLABLE(DATE), last_message_preview:TEXT(200, 0), last_author:NULLABLE(AUTHOR)});
const CLAIM_FLAGS = arr(ENUM('unstatemented', 'past_due'), {uniqueItems:true});
const CLAIM_SUMMARY = obj({...CLAIM.properties, paid_by_patient_cents:CENTS, open_balance_cents:CENTS, flags:CLAIM_FLAGS});
const BALANCE_SUMMARY = obj({balance_due_cents:CENTS, past_due_cents:CENTS, pending_insurance_cents:CENTS, open_claims:INT(0), unread_messages:INT(0), upcoming_appointments:INT(0)});
const STATEMENT_SUMMARY = obj({...STATEMENT.properties});
const WAITLIST_VIEW = obj({...WAITLIST_ENTRY.properties, provider_name:TEXT(200), offer_slot:NULLABLE(SLOT_VIEW)});
const PAYMENT_VIEW = obj({...PAYMENT.properties});

const read = (name, description, input, output) => ({name:PREFIX + name, description, read_only:true, input, output});
const write = (name, description, input, output) => ({name:PREFIX + name, description, read_only:false, input, output});

const TOOLS = [
  read('account.get', 'Read the patient on file, insurance, portal contact details, confirmation settings, any pending interstitial page and a balance summary. Always allowed, even while an interstitial is pending.',
    obj({}), obj({account:obj({patient:PATIENT, health_system:HEALTH_SYSTEM, settings:SETTINGS, interstitial:INTERSTITIAL, summary:BALANCE_SUMMARY})})),
  read('messages.list', 'List message threads grouped by recipient with unread counts and the latest message preview. Closed threads are included unless status is "open".',
    obj({category:ENUM('clinic', 'nurse_line', 'billing_office', 'all'), status:ENUM('open', 'closed', 'all'), query:TEXT(200, 0), unread_only:BOOL}, []),
    obj({threads:arr(THREAD_SUMMARY, {maxItems:200})})),
  read('messages.get', 'Read one thread with every message, author, read flag and attachment IDs. Reading does not mark messages read; use messages.flags.',
    obj({id:ID}), obj({thread:THREAD})),
  read('messages.export', 'Export one thread as UTF-8 plain text: filename, MIME type, base64 bytes and SHA-256, in the shape files.put and mail.attachment.add accept.',
    obj({id:ID}), obj({thread_id:ID, file:FILE_OUT})),
  read('messages.attachment.get', 'Read the bytes of one attachment on one message. id is the message ID; the asset must belong to that message.',
    obj({id:ID, asset_id:ID}), obj({message_id:ID, thread_id:ID, file:FILE_OUT})),
  read('billing.list', 'Read the ledger: claims with billed amount, insurance adjustment, insurance payment, patient responsibility, payments applied and open balance; posted payments; statements; and the balance summary. Amounts are integer cents.',
    obj({status:ENUM('all', 'open', 'in_adjudication', 'paid', 'denied', 'reprocessing')}, []),
    obj({summary:BALANCE_SUMMARY, claims:arr(CLAIM_SUMMARY, {maxItems:500}), payments:arr(PAYMENT_VIEW, {maxItems:500}), statements:arr(STATEMENT_SUMMARY, {maxItems:100})})),
  read('billing.get_claim', 'Read one claim with its full adjudication history, the payments applied to it and the billing threads that reference it.',
    obj({id:ID}), obj({claim:CLAIM_SUMMARY, allocations:arr(obj({payment_id:ID, at:DATE, kind:ENUM('payment', 'refund'), amount_cents:CENTS}), {maxItems:50}), thread_ids:arr(ID, {maxItems:50})})),
  read('billing.statement', 'Read one statement as a text-based PDF: filename, MIME type, base64 bytes and SHA-256. The bytes are deterministic for the same ledger state.',
    obj({id:ID}), obj({statement:STATEMENT_SUMMARY, file:FILE_OUT})),
  read('billing.requests.list', 'List refund and fee-waiver requests with their status and decision notes.',
    obj({status:ENUM('all', 'submitted', 'granted', 'declined')}, []), obj({requests:arr(BILLING_REQUEST, {maxItems:100})})),
  read('providers.search', 'Search the provider directory by specialty, clinic, network status for the insurance on file, rating and whether new patients are accepted. Each result carries the next open slot.',
    obj({query:TEXT(200, 0), specialty:TEXT(100, 0), clinic_id:ID, in_network_only:BOOL, accepting_new_patients:BOOL, min_rating:{type:'number', minimum:0, maximum:5}, visit_type:VISIT_TYPE}, []),
    obj({providers:arr(PROVIDER_VIEW, {maxItems:100})})),
  read('providers.get', 'Read one provider with clinic details, network status for the insurance on file and the next open slots.',
    obj({id:ID, visit_type:VISIT_TYPE}, ['id']), obj({provider:PROVIDER_VIEW, next_slots:arr(SLOT_VIEW, {maxItems:20})})),
  read('appointments.slots', 'List open slots for a provider in a time window, optionally for one visit type. Slots are not held by this call.',
    obj({provider_id:ID, from:DATE, to:DATE, visit_type:VISIT_TYPE}, ['provider_id']), obj({slots:arr(SLOT_VIEW, {maxItems:500})})),
  read('appointments.list', 'List appointments with provider and clinic details. A booked appointment whose end time has passed is shown as completed.',
    obj({status:ENUM('all', 'upcoming', 'past', 'booked', 'completed', 'cancelled', 'rescheduled')}, []), obj({appointments:arr(APPOINTMENT_VIEW, {maxItems:500})})),
  read('appointments.get', 'Read one appointment with its history, provider and clinic.',
    obj({id:ID}), obj({appointment:APPOINTMENT_VIEW, provider:PROVIDER_VIEW, clinic:CLINIC_SUMMARY})),
  read('waitlist.list', 'List waitlist entries with their status and any open offer.',
    obj({}), obj({entries:arr(WAITLIST_VIEW, {maxItems:50})})),

  write('messages.send', 'Start a new thread to the clinic, nurse line or billing office with an optional document attachment (PDF, PNG, JPEG or plain text, at most 2 files, 512 KiB each). With require_user_confirmation on, returns approval_required naming a draft ID until a user.confirmed event names it.',
    obj({recipient_category:RECIPIENT_CATEGORY, subject:TEXT(200), body:TEXT(20000), attachments:arr(FILE_IN, {maxItems:2, minItems:1}), related:RELATED}, ['recipient_category', 'subject', 'body']),
    obj({id:ID, message_id:ID})),
  write('messages.reply', 'Reply on an open thread (id is the thread ID) with an optional attachment. A closed thread returns thread_closed and changes nothing.',
    obj({id:ID, body:TEXT(20000), attachments:arr(FILE_IN, {maxItems:2, minItems:1})}, ['id', 'body']), obj({id:ID, message_id:ID})),
  write('messages.flags', 'Mark one message (id is the message ID) read or unread.',
    obj({id:ID, patch:obj({read:BOOL})}), obj({id:ID, thread_id:ID})),
  write('billing.pay.preview', 'Prepare a payment: amount in cents, optionally limited to named claims. Returns the allocation, balance after payment and an expiry. Errors: exceeds_balance, claim_not_final. Nothing is charged.',
    obj({amount_cents:{type:'integer', minimum:1, maximum:100000000}, claim_ids:arr(ID, {maxItems:50, uniqueItems:true})}, ['amount_cents']),
    obj({id:ID, amount_cents:CENTS, allocations:arr(ALLOCATION, {maxItems:50}), balance_before_cents:CENTS, balance_after_cents:CENTS, expires_at:DATE, approval_required:BOOL})),
  write('billing.pay.confirm', 'Post the payment prepared by billing.pay.preview (id is the preview ID) to the card on file and return the receipt. Errors: preview_stale when the preview expired or the ledger changed, approval_required while user confirmation is required and not yet given.',
    obj({id:ID}), obj({id:ID, preview_id:ID, confirmation_number:TEXT(40), amount_cents:CENTS, balance_cents:CENTS, paid_at:DATE})),
  write('billing.question', 'Ask the billing office about one charge (id is the claim ID). Opens a billing thread linked to the claim and returns the thread and message IDs.',
    obj({id:ID, body:TEXT(20000)}), obj({id:ID, message_id:ID})),
  write('billing.requests.create', 'Request a refund or a fee waiver on one claim (id is the claim ID). The request starts as submitted; the billing office decides it later through an event.',
    obj({id:ID, kind:REQUEST_KIND, amount_cents:CENTS, reason:TEXT(2000)}, ['id', 'kind', 'reason']), obj({id:ID, outcome:{const:'submitted'}})),
  write('appointments.preview', 'Prepare a booking on an open slot for a provider. Returns the slot, network status and an expiry, and says whether the identity step is still required. Nothing is booked.',
    obj({provider_id:ID, slot_id:ID, visit_type:VISIT_TYPE, reason:TEXT(500, 0)}, ['provider_id', 'slot_id', 'visit_type']),
    obj({id:ID, provider_id:ID, slot_id:ID, clinic_id:ID, start:DATE, end:DATE, visit_type:VISIT_TYPE, reason:TEXT(500, 0), network_status:ENUM('in_network', 'out_of_network', 'unknown'), expires_at:DATE, identity_required:BOOL, approval_required:BOOL})),
  write('appointments.confirm', 'Book the appointment prepared by appointments.preview (id is the preview ID). Errors: identity_required until a user.identity_verified event names the preview, slot_unavailable with the nearest alternatives when the slot was taken, preview_stale when the preview expired, approval_required while user confirmation is pending.',
    obj({id:ID}), obj({id:ID, preview_id:ID, provider_id:ID, clinic_id:ID, start:DATE, end:DATE, outcome:{const:'booked'}})),
  write('appointments.cancel', 'Cancel a booked appointment (id is the appointment ID). Inside the notice window the cancellation policy applies and a fee claim is posted.',
    obj({id:ID, reason:TEXT(300)}, ['id']), obj({id:ID, outcome:{const:'cancelled_by_patient'}, late_cancellation:BOOL, fee_claim_id:NULLABLE(ID)})),
  write('appointments.reschedule', 'Move a booked appointment (id is the appointment ID) to another open slot with the same provider. The old appointment becomes rescheduled and links to the new one. Error: slot_unavailable.',
    obj({id:ID, slot_id:ID}), obj({id:ID, replaces:ID, provider_id:ID, start:DATE, end:DATE})),
  write('waitlist.join', 'Join the waitlist for an earlier slot with a provider, optionally to move an existing booked appointment, within an earliest and latest time.',
    obj({provider_id:ID, appointment_id:ID, earliest:DATE, latest:DATE}, ['provider_id', 'earliest', 'latest']), obj({id:ID, outcome:{const:'waiting'}})),
  write('waitlist.leave', 'Leave the waitlist (id is the waitlist entry ID).', obj({id:ID}), obj({id:ID, outcome:{const:'left'}})),
  write('waitlist.accept', 'Accept an open waitlist offer (id is the waitlist entry ID) and book its slot. Errors: offer_expired, identity_required for a new visit until user.identity_verified names the offer, approval_required while user confirmation is pending.',
    obj({id:ID}), obj({id:ID, appointment_id:ID, outcome:{const:'booked'}})),
  write('waitlist.decline', 'Decline an open waitlist offer (id is the waitlist entry ID).', obj({id:ID}), obj({id:ID, outcome:{const:'declined'}})),
  write('interstitial.acknowledge', 'Clear a pending interstitial page that the agent may clear (id is the interstitial ID). A user-only interstitial returns user_action_required.',
    obj({id:ID}), obj({id:ID, outcome:{const:'cleared'}}))
];

// Core adds these to every result and owns the top-level status, so App outcomes are reported as `outcome`; the write contract requires the idempotency key and observed version.
function toolEntry(t) {
  const input = structuredClone(t.input);
  if (!t.read_only) {
    input.properties.expected_version = VERSION;
    input.properties.request_id = ID;
    input.required = [...input.required, 'expected_version', 'request_id'];
  }
  const output = structuredClone(t.output);
  output.properties = {status:{const:t.read_only ? 'ok' : 'committed'}, app_id:{const:APP}, version:VERSION, ...output.properties};
  output.required = ['status', 'app_id', 'version', ...output.required];
  return {name:t.name, description:t.description, read_only:t.read_only, scope:t.name, resource_target:'current account', inputSchema:input, outputSchema:output};
}

// Profiles a task can start from. Scenario withholds the money / identity confirms; sandbox allows everything.
const CONFIRMS = ['billing.pay.confirm', 'appointments.confirm', 'waitlist.accept'].map(n => PREFIX + n);
const POLICIES = {
  scenario:{allow:TOOLS.map(t => t.name).filter(n => !CONFIRMS.includes(n)), constraints:{}},
  sandbox:{allow:TOOLS.map(t => t.name), constraints:{}}
};

module.exports = {APP, PREFIX, SEED, EVENTS, EVENT_SCHEMA, TOOLS, toolEntry, POLICIES, shapes:{ID, DATE, DAY, CENTS, FILE_IN, FILE_OUT}};
