#!/usr/bin/env node
'use strict';
// Single source for the generated roomline schemas and tools.json.
// Run `node build/schemas.cjs` after editing; `--check` fails on drift.
// The generated files are self-contained (no $ref), like the other personal Apps.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

const ID = {type:'string', pattern:'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$'};
const DT = {type:'string', format:'date-time'};
const NULLABLE_DT = {anyOf:[DT, {type:'null'}]};
const DATE = {type:'string', pattern:'^[0-9]{4}-[0-9]{2}-[0-9]{2}$', description:'Local date at the hotel, YYYY-MM-DD.'};
const NIGHTS = {type:'array', items:DATE, maxItems:366, uniqueItems:true};
const CLOCK = {type:'string', pattern:'^([01][0-9]|2[0-3]):[0-5][0-9]$', description:'Local wall-clock time HH:MM at the hotel.'};
const CENTS = {type:'integer', minimum:0, maximum:100000000, description:'Euro cents.'};
const POSITIVE_CENTS = {type:'integer', minimum:1, maximum:100000000, description:'Euro cents.'};
const SIGNED_CENTS = {type:'integer', minimum:-100000000, maximum:100000000, description:'Euro cents; refunds are negative.'};
const text = (min, max) => ({type:'string', minLength:min, maxLength:max});
const object = (properties, required = Object.keys(properties)) => ({type:'object', properties, required, additionalProperties:false});
const VERSION = object({epoch:{type:'integer', minimum:1}, revision:{type:'integer', minimum:0}});
const HISTORY = {type:'array', items:object({at:DT, action:text(1, 80)}), maxItems:1000};
const PLAN = {enum:['refundable','non_refundable']};

const HOTEL = object({
  id:ID, name:text(1, 120), city:text(1, 80), neighborhood:text(1, 120), distance_note:text(0, 200), room:text(1, 200),
  timezone:{...text(1, 64), description:'IANA time zone of the hotel, for example Europe/Paris.'},
  check_in_time:CLOCK, check_out_time:CLOCK,
  rates:object({
    refundable:object({nightly_cents:POSITIVE_CENTS, free_cancellation_hours:{type:'integer', minimum:1, maximum:720,
      description:'Full refund until this many hours before arrival (check-in date at check_in_time).'}}),
    non_refundable:object({nightly_cents:POSITIVE_CENTS})
  }),
  high_demand_nights:{...NIGHTS, description:'Nights on which a refundable booking comes back with an offer to switch to the non-refundable rate.'},
  sold_out_nights:{...NIGHTS, description:'Nights that cannot be booked in either plan.'},
  created_at:DT, updated_at:DT, history:HISTORY
});
const SWITCH_STATUS = {enum:['pending','accepted','declined','expired','withdrawn']};
const RATE_SWITCH = {anyOf:[object({
  status:SWITCH_STATUS, proposed_plan:{const:'non_refundable'}, proposed_nightly_cents:POSITIVE_CENTS, proposed_total_cents:POSITIVE_CENTS,
  high_demand_nights:{...NIGHTS, minItems:1}, offered_at:DT, expires_at:DT, resolved_at:NULLABLE_DT, message:text(1, 1000)
}), {type:'null'}]};
const CANCELLATION = {anyOf:[object({at:DT, rule:{enum:['free','late','non_refundable']}, refund_cents:CENTS, fee_cents:CENTS}), {type:'null'}]};
const RES_STATUS = {enum:['confirmed','pending_rate_switch','cancelled']};
const RESERVATION = object({
  id:ID, account_id:ID, confirmation:text(1, 20), hotel_id:ID, hotel_name:text(1, 120), city:text(1, 80),
  check_in:DATE, check_out:DATE, nights:{type:'integer', minimum:1, maximum:30}, plan:PLAN,
  nightly_cents:POSITIVE_CENTS, total_cents:POSITIVE_CENTS, paid_cents:CENTS, payment_label:text(1, 80),
  free_cancellation_until:{...NULLABLE_DT, description:'Full refund if cancelled at or before this instant; null on the non-refundable plan.'},
  status:RES_STATUS, rate_switch:RATE_SWITCH, cancellation:CANCELLATION, charge_ids:{type:'array', items:ID, maxItems:100},
  created_at:DT, updated_at:DT, history:HISTORY
});
const CHARGE = object({
  id:ID, account_id:ID, at:DT, reservation_id:ID, kind:{enum:['charge','refund']}, amount_cents:SIGNED_CENTS,
  payment_label:text(1, 80), description:text(1, 200)
});
const APPLIED = object({event_id:ID, at:DT, operation:text(1, 80), affected_ids:{type:'array', items:ID, maxItems:1000}});
const SEED = {$schema:'https://json-schema.org/draft/2020-12/schema', $id:'urn:pale:roomline:seed:1', ...object({
  account_id:ID, owner_person_id:ID,
  guest:object({name:text(1, 120), email:text(3, 200)}),
  currency:{const:'EUR'},
  payment_labels:{type:'array', items:text(1, 80), minItems:1, maxItems:10, uniqueItems:true},
  hotels:{type:'array', items:HOTEL, maxItems:200},
  reservations:{type:'array', items:RESERVATION, maxItems:500},
  charges:{type:'array', items:CHARGE, maxItems:2000},
  events_applied:{type:'array', items:APPLIED, maxItems:1000}
})};

const event = (operation, payload) => object({event_id:ID, at:DT, operation:{const:operation}, payload});
const EVENTS = {$schema:'https://json-schema.org/draft/2020-12/schema', $id:'urn:pale:roomline:events:1', oneOf:[
  event('roomline.rate_switch.expire', object({hotel_id:{anyOf:[ID, {type:'null'}], description:'One hotel, or null for all hotels.'}})),
  event('roomline.rate.change', object({hotel_id:ID, plan:PLAN, nightly_cents:POSITIVE_CENTS})),
  event('roomline.availability.sell_out', object({hotel_id:ID, nights:{...NIGHTS, minItems:1}}))
]};

const WRITE = {expected_version:VERSION, request_id:ID};
const read = (properties, required = []) => object(properties, required);
const ok = extra => object({status:{const:'ok'}, app_id:{const:'roomline'}, version:VERSION, ...extra});
const committed = extra => object({status:{const:'committed'}, app_id:{const:'roomline'}, version:VERSION, id:ID, ...extra});
const PLAN_QUOTE = object({plan:PLAN, label:text(1, 80), nightly_cents:POSITIVE_CENTS, total_cents:POSITIVE_CENTS, available:{type:'boolean'},
  free_cancellation_until:NULLABLE_DT, terms:text(1, 400)});
const HOTEL_RESULT = object({hotel_id:ID, name:text(1, 120), city:text(1, 80), neighborhood:text(1, 120), distance_note:text(0, 200),
  room:text(1, 200), timezone:text(1, 64), check_in_time:CLOCK, check_out_time:CLOCK, sold_out_nights:NIGHTS,
  plans:{type:'array', items:PLAN_QUOTE, minItems:2, maxItems:2}});
const tool = (name, description, readOnly, inputSchema, outputSchema) => ({name, description, read_only:readOnly,
  scope:name, resource_target:'current account', inputSchema, outputSchema});
const TOOLS = [
  tool('roomline.account', 'Read the guest profile, the saved payment labels and every charge and refund on this Roomline account.',
    true, read({}), ok({account_id:ID, guest:SEED.properties.guest, currency:{const:'EUR'},
      payment_labels:SEED.properties.payment_labels, charges:{type:'array', items:CHARGE, maxItems:2000}})),
  tool('roomline.search', 'Search hotels in a city for check_in to check_out (local dates at the hotel). Every hotel is listed with both rate plans, Free cancellation and Non-refundable, with nightly price, total, availability and terms. Prices are in euro cents. Reading changes nothing.',
    true, read({city:text(1, 80), check_in:DATE, check_out:DATE}, ['city','check_in','check_out']),
    ok({city:text(1, 80), check_in:DATE, check_out:DATE, nights:{type:'integer', minimum:1, maximum:30}, currency:{const:'EUR'},
      priced_at:DT, hotels:{type:'array', items:HOTEL_RESULT, maxItems:200}})),
  tool('roomline.book', 'Book one room at a hotel for check_in to check_out on a rate plan, paid with a saved payment label. Both plans are charged in full at booking. The result gives the reservation status: confirmed, or pending_rate_switch when the hotel asks to move the stay to its non-refundable rate (see roomline.rate_switch.confirm and .decline).',
    false, object({hotel_id:ID, check_in:DATE, check_out:DATE, plan:PLAN, payment_label:text(1, 80), ...WRITE}),
    committed({reservation:RESERVATION, message:text(1, 2000)})),
  tool('roomline.reservations.list', 'List reservations, optionally by status and city, ordered by check-in date.',
    true, read({status:RES_STATUS, city:text(1, 80)}), ok({items:{type:'array', items:RESERVATION, maxItems:500}})),
  tool('roomline.reservations.get', 'Read one reservation, including its plan, price, payments, cancellation terms and any rate-switch offer.',
    true, read({id:ID}, ['id']), ok({item:RESERVATION})),
  tool('roomline.cancel', 'Cancel a reservation. Refunds follow the plan at the current time: Free cancellation refunds in full until its deadline and keeps the first night after it; Non-refundable refunds nothing. Cancellation closes at arrival. A pending rate-switch offer is withdrawn.',
    false, object({reservation_id:ID, ...WRITE}), committed({refund_cents:CENTS, fee_cents:CENTS, reservation:RESERVATION})),
  tool('roomline.rate_switch.confirm', 'Accept a pending rate-switch offer before it expires. The reservation moves to the Non-refundable rate: the price difference is refunded, and the stay can no longer be refunded.',
    false, object({reservation_id:ID, ...WRITE}), committed({reservation:RESERVATION})),
  tool('roomline.rate_switch.decline', 'Decline a pending rate-switch offer. The reservation stays confirmed on its Free cancellation rate and nothing more is charged.',
    false, object({reservation_id:ID, ...WRITE}), committed({reservation:RESERVATION}))
];

function outputs() {
  return {'schemas/seed.schema.json':SEED, 'schemas/events.schema.json':EVENTS, 'tools.json':TOOLS};
}

function build({check = false} = {}) {
  const drift = [];
  for (const [ref, value] of Object.entries(outputs())) {
    const file = path.join(root, ref), expected = JSON.stringify(value, null, 2) + '\n';
    if (check) { if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== expected) drift.push(ref); }
    else fs.writeFileSync(file, expected);
  }
  if (drift.length) throw new Error('Generated roomline schema drift: ' + drift.join(', '));
}
module.exports = {build};
if (require.main === module) { build({check:process.argv.includes('--check')}); console.log('roomline schemas and tools.json are current.'); }
