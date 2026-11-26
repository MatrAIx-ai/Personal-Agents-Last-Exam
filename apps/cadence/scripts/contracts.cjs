'use strict';
// Single source of truth for the Cadence data model and tool contracts. scripts/build.cjs renders
// schemas/seed.schema.json, schemas/events.schema.json, schemas/state.schema.json, tools.json, fixtures/policies.json
// and the event_types in app.json from here so the generated files cannot drift. Edit this file, then run the build.
const APP = 'cadence';
const PREFIX = APP + '.';

// ---- primitive shapes -------------------------------------------------------
const ID = {type:'string', pattern:'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$'};
const DATE = {type:'string', format:'date-time'};
const DAY = {type:'string', pattern:'^\\d{4}-\\d{2}-\\d{2}$'};
const CENTS = {type:'integer', minimum:0, maximum:100000000};
const BOOL = {type:'boolean'};
const INT = (min = 0, max = 1000000) => ({type:'integer', minimum:min, maximum:max});
const NUM = (min, max) => ({type:'number', minimum:min, maximum:max});
const TEXT = (max = 2000, min = 1) => ({type:'string', minLength:min, maxLength:max});
const ENUM = (...values) => ({enum:values});
const NULLABLE = schema => ({anyOf:[schema, {type:'null'}]});
const obj = (properties, required = Object.keys(properties)) => ({type:'object', properties, required, additionalProperties:false});
const arr = (items, extra = {}) => ({type:'array', items, ...extra});
const VERSION = obj({epoch:INT(1), revision:INT(0)});
const FILE_OUT = obj({filename:{type:'string', minLength:1, maxLength:160, pattern:'^[^\\\\/\\u0000-\\u001f\\u007f]+$'}, mime_type:ENUM('image/png'), base64:{type:'string', maxLength:1398104}, sha256:{type:'string', pattern:'^[a-f0-9]{64}$'}});

// ---- record shapes (seed / state) -------------------------------------------
const HISTORY = arr(obj({at:DATE, action:TEXT(80), detail:NULLABLE(TEXT(1000, 0))}, ['at', 'action']), {maxItems:1000});
const SETTINGS = obj({require_user_confirmation:BOOL, preview_ttl_minutes:INT(1, 1440), timezone:TEXT(60), booking_horizon_days:INT(1, 90), late_cancel_hours:INT(0, 72), late_cancel_fee_cents:CENTS, checkin_opens_minutes:INT(0, 240)});
const PLAN_KIND = ENUM('trial', 'credits');
const PLAN = obj({plan_id:ID, name:TEXT(100), kind:PLAN_KIND, credits_per_period:INT(0, 500), period_days:INT(1, 366), price_cents:CENTS, premium_allowed:BOOL, rules:arr(TEXT(300), {maxItems:10})});
const PAYMENT_METHOD = obj({payment_method_id:ID, brand:TEXT(40), last4:TEXT(4, 4), status:ENUM('ok', 'declined')});
const PENDING_CHANGE = NULLABLE(obj({action:ENUM('change', 'cancel'), plan_id:NULLABLE(ID), effective_on:DAY, requested_at:DATE}));
const MEMBER = obj({name:TEXT(200), email:TEXT(200), home_neighborhood:TEXT(100)});
const ACCOUNT_STATUS = ENUM('trial', 'active', 'cancel_at_period_end', 'cancelled');
const ACCOUNT = obj({member:MEMBER, plan_id:ID, status:ACCOUNT_STATUS, credits_remaining:INT(0, 500), period_start:DAY, renewal_date:DAY, trial_end:NULLABLE(DAY),
  pending_change:PENDING_CHANGE, payment_method_id:NULLABLE(ID), trial_reminder_sent_at:NULLABLE(DATE), signed_out:BOOL, updated_at:DATE, history:HISTORY});
const STUDIO = obj({studio_id:ID, name:TEXT(120), neighborhood:TEXT(100), address:TEXT(200), distance_km:NUM(0, 100), rating:NULLABLE(NUM(0, 5)), review_count:INT(0), amenities:arr(TEXT(40), {maxItems:12}),
  rooms:arr(TEXT(40), {minItems:1, maxItems:10}), image_asset_id:NULLABLE(ID), description:TEXT(600, 0)});
const INSTRUCTOR = obj({instructor_id:ID, name:TEXT(120), studio_id:ID, specialties:arr(TEXT(40), {maxItems:6})});
const CLASS_TYPE = ENUM('yoga', 'pilates', 'hiit', 'strength', 'cycling', 'barre', 'boxing', 'dance', 'sauna', 'meditation', 'run_club');
const CLASS_STATUS = ENUM('scheduled', 'cancelled');
const CLASS_INSTANCE = obj({class_instance_id:ID, studio_id:ID, room:TEXT(40), title:TEXT(120), type:CLASS_TYPE, instructor_id:NULLABLE(ID), start:DATE, end:DATE, capacity:INT(1, 500), external_bookings:INT(0, 500),
  premium:BOOL, credit_cost:INT(0, 50), rating:NULLABLE(NUM(0, 5)), review_count:INT(0), status:CLASS_STATUS, cancellation_reason:NULLABLE(TEXT(200)), time_changed_from:NULLABLE(DATE), created_at:DATE, updated_at:DATE, history:HISTORY});
const PRICE_REASON = ENUM('premium_excluded', 'repeat_visit', 'plan_cancelled');
const PRICE = obj({kind:ENUM('included', 'credits', 'not_available'), credits:INT(0, 50), reason:NULLABLE(PRICE_REASON)});
const RESERVATION_STATUS = ENUM('booked', 'attended', 'no_show', 'cancelled', 'late_cancelled', 'cancelled_by_studio', 'rescheduled');
const RESERVATION = obj({reservation_id:ID, class_instance_id:ID, status:RESERVATION_STATUS, price:PRICE, credits_charged:INT(0, 50), fee_cents:CENTS, time_changed:BOOL, booked_at:DATE, updated_at:DATE,
  checked_in_at:NULLABLE(DATE), rating:NULLABLE(INT(1, 5)), review:NULLABLE(TEXT(1000)), replaced_by:NULLABLE(ID), replaces:NULLABLE(ID), cancellation_reason:NULLABLE(TEXT(200)), history:HISTORY});
const OFFER = NULLABLE(obj({offer_id:ID, offered_at:DATE, offer_expires_at:DATE, approved:BOOL}));
const WAITLIST_STATUS = ENUM('waiting', 'offered', 'booked', 'declined', 'expired', 'left');
const WAITLIST_ENTRY = obj({waitlist_entry_id:ID, class_instance_id:ID, status:WAITLIST_STATUS, offer:OFFER, reservation_id:NULLABLE(ID), created_at:DATE, updated_at:DATE, history:HISTORY});
const BOOKING_PREVIEW = obj({class_instance_id:ID, price:PRICE, cancel_by:DATE, spots_left:INT(0, 500)});
const CANCEL_PREVIEW = obj({reservation_id:ID, late:BOOL, fee_cents:CENTS, credits_returned:INT(0, 50), cancel_by:DATE});
const PLAN_PREVIEW = obj({action:ENUM('change', 'cancel'), plan_id:NULLABLE(ID), effective_on:DAY, charge_cents:CENTS, credit_change:INT(-500, 500), note:TEXT(300, 0)});
const PREVIEW = obj({preview_id:ID, kind:ENUM('booking', 'cancel', 'plan'), created_at:DATE, expires_at:DATE, approved:BOOL, fingerprint:TEXT(200), payload:{anyOf:[BOOKING_PREVIEW, CANCEL_PREVIEW, PLAN_PREVIEW]}});
const RECEIPT = obj({receipt_id:ID, at:DATE, kind:ENUM('renewal', 'late_fee', 'plan_change', 'trial_start'), amount_cents:CENTS, description:TEXT(300), payment_method_id:NULLABLE(ID)});

const SEED = {
  ...obj({
    account_id:ID, owner_person_id:ID, settings:SETTINGS, plans:arr(PLAN, {minItems:1, maxItems:10}), payment_methods:arr(PAYMENT_METHOD, {maxItems:5}), account:ACCOUNT,
    studios:arr(STUDIO, {maxItems:100}), instructors:arr(INSTRUCTOR, {maxItems:300}), class_instances:arr(CLASS_INSTANCE, {maxItems:5000}),
    reservations:arr(RESERVATION, {maxItems:2000}), waitlist:arr(WAITLIST_ENTRY, {maxItems:100}), previews:arr(PREVIEW, {maxItems:100}), receipts:arr(RECEIPT, {maxItems:500})
  }),
  $schema:'https://json-schema.org/draft/2020-12/schema', $id:'urn:pale:' + APP + ':seed:1'
};

// ---- events (applied by Infra through env.apply_event) ----------------------
const EVENTS = [
  ['classes.cancelled_by_studio', obj({class_instance_id:ID, reason:TEXT(200)})],
  ['classes.schedule_changed', obj({class_instance_id:ID, new_start:NULLABLE(DATE), new_instructor_id:NULLABLE(ID)})],
  ['classes.capacity_changed', obj({class_instance_id:ID, capacity:INT(1, 500)})],
  ['waitlist.promoted', obj({waitlist_entry_id:ID, offer_expires_at:DATE})],
  ['plan.renewed', obj({account_id:ID, plan_id:ID, renewal_date:DAY})],
  ['plan.trial_ending', obj({account_id:ID, trial_end:DAY})],
  ['account.session_expired', obj({account_id:ID})],
  ['account.session_restored', obj({account_id:ID})],
  ['user.confirmed', {anyOf:[obj({preview_id:ID}), obj({offer_id:ID})]}]
];
const EVENT_SCHEMA = {$schema:'https://json-schema.org/draft/2020-12/schema', oneOf:EVENTS.map(([operation, payload]) => obj({event_id:ID, at:DATE, operation:{const:operation}, payload}))};

// ---- tool contracts (every view carries `id`, the value the matching `id` argument expects) ----
const STUDIO_SUMMARY = obj({studio_id:ID, name:TEXT(120), neighborhood:TEXT(100), distance_km:NUM(0, 100), rating:NULLABLE(NUM(0, 5)), review_count:INT(0), rating_label:TEXT(80), image_asset_id:NULLABLE(ID)});
const INSTRUCTOR_SUMMARY = NULLABLE(obj({instructor_id:ID, name:TEXT(120)}));
const CLASS_VIEW = obj({id:ID, ...CLASS_INSTANCE.properties, studio:STUDIO_SUMMARY, instructor:INSTRUCTOR_SUMMARY, price:PRICE, spots_left:INT(0, 500), rating_label:TEXT(80), cancel_by:DATE,
  my_reservation_id:NULLABLE(ID), my_waitlist_entry_id:NULLABLE(ID), visited_studio:BOOL});
const CLASS_SUMMARY = obj({class_instance_id:ID, title:TEXT(120), type:CLASS_TYPE, start:DATE, end:DATE, status:CLASS_STATUS, studio_id:ID, studio_name:TEXT(120), neighborhood:TEXT(100), instructor_name:NULLABLE(TEXT(120))});
const STUDIO_VIEW = obj({id:ID, ...STUDIO.properties, rating_label:TEXT(80), visited:BOOL, upcoming:arr(CLASS_VIEW, {maxItems:500}), instructors:arr(INSTRUCTOR, {maxItems:50})});
const PAYMENT_VIEW = obj({id:ID, ...PAYMENT_METHOD.properties, is_default:BOOL});
const PLAN_VIEW = obj({id:ID, ...PLAN.properties, status:ACCOUNT_STATUS, credits_remaining:INT(0, 500), period_start:DAY, renewal_date:DAY, trial_end:NULLABLE(DAY), trial_days_left:NULLABLE(INT(0, 366)),
  pending_change:PENDING_CHANGE, payment_method:NULLABLE(PAYMENT_VIEW), trial_reminder_sent_at:NULLABLE(DATE), renews_to:NULLABLE(obj({plan_id:ID, name:TEXT(100), price_cents:CENTS}))});
const RESERVATION_VIEW = obj({id:ID, ...RESERVATION.properties, class:CLASS_SUMMARY, conflict:BOOL, conflict_with:NULLABLE(ID), cancel_by:DATE, would_be_late:BOOL, can_check_in:BOOL});
const WAITLIST_VIEW = obj({id:ID, ...WAITLIST_ENTRY.properties, class:CLASS_SUMMARY, position:INT(0, 500)});
const SUMMARY = obj({credits_remaining:INT(0, 500), upcoming_reservations:INT(0), waitlist_entries:INT(0), trial_days_left:NULLABLE(INT(0, 366)), signed_out:BOOL});

const read = (name, description, input, output) => ({name:PREFIX + name, description, read_only:true, input, output});
const write = (name, description, input, output) => ({name:PREFIX + name, description, read_only:false, input, output});
const TIME_OF_DAY = ENUM('morning', 'afternoon', 'evening');

const TOOLS = [
  read('account.get', 'Read the member on file, the plan summary, credits, trial status, upcoming reservation and waitlist counts, and the confirmation setting. Returns signed_out while the session is expired, like every other operation.',
    obj({}), obj({account:obj({member:MEMBER, plan:PLAN_VIEW, summary:SUMMARY, settings:SETTINGS})})),
  read('plan.get', 'Read the plan: type, credits, free-trial status and end date, trial rules, renewal date, what renews, any scheduled change, the masked payment method and the receipts on file.',
    obj({}), obj({plan:PLAN_VIEW, receipts:arr(RECEIPT, {maxItems:500})})),
  read('payment_methods.list', 'List payment methods on file, masked, with their status (ok or declined).',
    obj({}), obj({payment_methods:arr(PAYMENT_VIEW, {maxItems:5})})),
  read('classes.search', 'Browse upcoming classes by type, studio, neighborhood, day, time window and text. Each class carries its price under the member\'s plan (included, a credit cost, or not available with the reason), spots left, rating and whether the member already holds a reservation or waitlist place. Full classes are listed when include_full is true.',
    obj({query:TEXT(200, 0), type:CLASS_TYPE, studio_id:ID, neighborhood:TEXT(100, 0), date:DAY, from:DATE, to:DATE, time_of_day:TIME_OF_DAY, included_only:BOOL, include_full:BOOL, include_premium:BOOL}, []),
    obj({classes:arr(CLASS_VIEW, {maxItems:500})})),
  read('classes.get', 'Read one class instance with its studio, instructor, price under the plan, spots left, cancellation deadline and the member\'s reservation or waitlist place on it.',
    obj({id:ID}), obj({class:CLASS_VIEW})),
  read('studios.get', 'Read one studio: location, distance, ratings, amenities, instructors, whether the member has visited, and its upcoming classes priced under the plan.',
    obj({id:ID}), obj({studio:STUDIO_VIEW})),
  read('studios.image', 'Read the bytes of a studio\'s image (PNG) by studio ID. A studio without an image returns no_image.',
    obj({id:ID}), obj({studio_id:ID, file:FILE_OUT})),
  read('reservations.list', 'List reservations with class and studio details. Upcoming booked reservations flag an overlap with another reservation as conflict; a reservation whose class time was moved is marked time_changed.',
    obj({status:ENUM('all', 'upcoming', 'past', 'booked', 'attended', 'cancelled')}, []), obj({reservations:arr(RESERVATION_VIEW, {maxItems:2000})})),
  read('reservations.get', 'Read one reservation with its history, cancellation deadline and whether cancelling now would be late.',
    obj({id:ID}), obj({reservation:RESERVATION_VIEW})),
  read('waitlist.list', 'List waitlist entries with their position, status and any open offer.',
    obj({}), obj({entries:arr(WAITLIST_VIEW, {maxItems:100})})),

  write('reservations.preview', 'Prepare a booking: the price under the plan, the cancellation deadline and an expiry. Errors: class_full (join the waitlist instead), overlap (names the conflicting reservation), not_included (with the reason), insufficient_credits, outside_horizon, invalid_state. Nothing is booked.',
    obj({class_instance_id:ID}), obj({id:ID, class_instance_id:ID, price:PRICE, cancel_by:DATE, spots_left:INT(0, 500), expires_at:DATE, approval_required:BOOL})),
  write('reservations.confirm', 'Book the class prepared by reservations.preview (id is the preview ID) and charge credits under the plan, or record that it was included. Errors: preview_stale with the current price when the preview expired or the class changed (and a waitlist hint when it is now full), approval_required while user confirmation is required and not yet given.',
    obj({id:ID}), obj({id:ID, preview_id:ID, class_instance_id:ID, price:PRICE, credits_charged:INT(0, 50), cancel_by:DATE, outcome:{const:'booked'}})),
  write('reservations.cancel_preview', 'Prepare a cancellation (id is the reservation ID): whether it is inside the free window, the late fee or forfeited credits otherwise, and an expiry. A cancellation inside the window needs no preview.',
    obj({id:ID}), obj({id:ID, reservation_id:ID, late:BOOL, fee_cents:CENTS, credits_returned:INT(0, 50), cancel_by:DATE, expires_at:DATE, approval_required:BOOL})),
  write('reservations.cancel', 'Cancel a booked reservation (id is the reservation ID). Inside the free window credits are returned at once. After the deadline the call must name a live cancel preview in preview_id, the late fee is charged to the payment method or the credits are forfeited, and user confirmation applies when required.',
    obj({id:ID, preview_id:ID, reason:TEXT(200)}, ['id']), obj({id:ID, outcome:ENUM('cancelled', 'late_cancelled'), fee_cents:CENTS, credits_returned:INT(0, 50)})),
  write('reservations.reschedule', 'Move a booked reservation (id is the reservation ID) to another scheduled instance at the same studio with the same price under the plan. Errors: class_full, overlap, not_included, price_changed, outside_horizon.',
    obj({id:ID, class_instance_id:ID}), obj({id:ID, replaces:ID, class_instance_id:ID, outcome:{const:'booked'}})),
  write('reservations.checkin', 'Check in to a booked class (id is the reservation ID) from checkin_opens_minutes before the start until its end. Error: checkin_window.',
    obj({id:ID}), obj({id:ID, outcome:{const:'attended'}, checked_in_at:DATE})),
  write('reservations.rate', 'Rate an attended class (id is the reservation ID) from 1 to 5 with an optional review, once the class has ended. Errors: not_attended, too_early, already_rated.',
    obj({id:ID, rating:INT(1, 5), review:TEXT(1000)}, ['id', 'rating']), obj({id:ID, outcome:{const:'rated'}})),
  write('waitlist.join', 'Join the waitlist of a full class. The same price and overlap checks as a booking apply. Errors: not_full, overlap, not_included, insufficient_credits, invalid_state.',
    obj({class_instance_id:ID}), obj({id:ID, outcome:{const:'waiting'}, position:INT(0, 500)})),
  write('waitlist.leave', 'Leave the waitlist (id is the waitlist entry ID).', obj({id:ID}), obj({id:ID, outcome:{const:'left'}})),
  write('waitlist.accept', 'Accept an open offer (id is the waitlist entry ID) and book the class under the plan. Errors: offer_expired, class_full, overlap, insufficient_credits, approval_required when credits are charged and user confirmation is required.',
    obj({id:ID}), obj({id:ID, reservation_id:ID, outcome:{const:'booked'}})),
  write('waitlist.decline', 'Decline an open offer (id is the waitlist entry ID).', obj({id:ID}), obj({id:ID, outcome:{const:'declined'}})),
  write('plan.preview', 'Prepare a plan change (action change with plan_id) or a cancellation (action cancel): the effective date, the charge and credit difference, and an expiry. Changes take effect at the next renewal; a trial can only be cancelled at its end, and the preview shows that date. Errors: change_pending, payment_declined, same_plan, unknown_plan, invalid_state.',
    obj({action:ENUM('change', 'cancel'), plan_id:ID}, ['action']), obj({id:ID, action:ENUM('change', 'cancel'), plan_id:NULLABLE(ID), effective_on:DAY, charge_cents:CENTS, credit_change:INT(-500, 500), note:TEXT(300, 0), expires_at:DATE, approval_required:BOOL})),
  write('plan.change', 'Schedule the plan change prepared by plan.preview (id is the preview ID) for its effective date. Errors: preview_stale, change_pending, approval_required.',
    obj({id:ID}), obj({id:ID, preview_id:ID, plan_id:ID, effective_on:DAY, outcome:{const:'scheduled'}})),
  write('plan.cancel', 'Cancel the plan as prepared by plan.preview (id is the preview ID): the account keeps its access until the effective date and does not renew. Errors: preview_stale, change_pending, approval_required.',
    obj({id:ID}), obj({id:ID, preview_id:ID, effective_on:DAY, outcome:{const:'cancel_at_period_end'}}))
];

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

// Profiles a task can start from. Scenario withholds the plan money writes; sandbox allows everything.
const WITHHELD = ['plan.change', 'plan.cancel'].map(n => PREFIX + n);
const POLICIES = {
  scenario:{allow:TOOLS.map(t => t.name).filter(n => !WITHHELD.includes(n)), constraints:{}},
  sandbox:{allow:TOOLS.map(t => t.name), constraints:{}}
};

module.exports = {APP, PREFIX, SEED, EVENTS, EVENT_SCHEMA, TOOLS, toolEntry, POLICIES, shapes:{ID, DATE, DAY, CENTS, FILE_OUT}};
