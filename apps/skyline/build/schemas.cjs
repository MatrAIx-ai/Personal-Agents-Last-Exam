#!/usr/bin/env node
'use strict';
// Single source for the generated skyline schemas and tools.json.
// Run `node build/schemas.cjs` after editing; `--check` fails on drift.
// The generated files are self-contained (no $ref), like the other personal Apps.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

const ID = {type:'string', pattern:'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$'};
const LONG_ID = {type:'string', pattern:'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,149}$'};
const DT = {type:'string', format:'date-time'};
const NULLABLE_DT = {anyOf:[DT, {type:'null'}]};
const DATE = {type:'string', pattern:'^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$', description:'Local calendar date YYYY-MM-DD.'};
const text = (min, max) => ({type:'string', minLength:min, maxLength:max});
const object = (properties, required = Object.keys(properties)) => ({type:'object', properties, required, additionalProperties:false});
const list = (items, max, extra = {}) => ({type:'array', items, maxItems:max, ...extra});
const VERSION = object({epoch:{type:'integer', minimum:1}, revision:{type:'integer', minimum:0}});
const HISTORY = {type:'array', items:object({at:DT, action:text(1, 80)}), maxItems:1000};

const CODE = {type:'string', pattern:'^[A-Z]{3}$', description:'Three-letter airport code.'};
const SEAT = {type:'string', pattern:'^[1-9][0-9]?[A-K]$'};
const PAIR = {type:'array', items:SEAT, minItems:2, maxItems:2};
const CABIN = {enum:['business','economy']};
const PAX = {type:'integer', minimum:1, maximum:9};
const POINTS = {type:'integer', minimum:0, maximum:100000000};
const SIGNED_POINTS = {type:'integer', minimum:-100000000, maximum:100000000};
const CENTS = {type:'integer', minimum:0, maximum:100000000};
const SIGNED_CENTS = {type:'integer', minimum:-100000000, maximum:100000000};
const LABEL = {...text(1, 80), description:'Opaque payment label, one of the account payment_labels.'};

const BOOKING_REF = object({booking_id:ID});
const TRANSFER_REF = object({app_id:{const:'waypoint'}, account_id:LONG_ID, object_type:{enum:['transfer','combine']},
  object_id:LONG_ID, message_id:text(1, 150), sent_at:NULLABLE_DT});
const LEDGER_ENTRY = object({id:ID, at:DT, kind:{enum:['opening','transfer_in','redeem','refund']}, points:SIGNED_POINTS,
  balance_after:POINTS, ref:{anyOf:[{type:'null'}, BOOKING_REF, TRANSFER_REF]}});
const CHARGE = object({id:ID, at:DT, label:LABEL, amount_cents:SIGNED_CENTS, currency:{const:'USD'}, description:text(1, 200),
  ref:{anyOf:[{type:'null'}, BOOKING_REF]}});
const NOTICE = object({id:ID, created_at:DT, updated_at:DT, history:HISTORY, kind:{enum:['booking_confirmed','schedule_change']},
  title:text(1, 200), body:text(1, 4000), ref:{anyOf:[{type:'null'}, object({booking_id:ID, change_id:{anyOf:[ID, {type:'null'}]}})]}});
const PASSENGER = object({id:ID, person_id:ID, name:{...text(1, 120), description:'Name as on the ticket.'}});
const AIRPORT = object({code:CODE, city:text(1, 80), timezone:{...text(1, 64), description:'IANA time zone of the airport.'}});
const CHART_ROW = object({origin:CODE, dest:CODE, cabin:CABIN, points:{type:'integer', minimum:1, maximum:10000000},
  partner_fee_cents:CENTS, taxes_cents:CENTS,
  operating_carrier:{...text(1, 80), description:'Optional. This row prices any itinerary with a segment operated by this carrier; otherwise the row without a carrier applies.'}},
  ['origin', 'dest', 'cabin', 'points', 'partner_fee_cents', 'taxes_cents']);
const RULES = object({min_connection_minutes:{type:'integer', minimum:0, maximum:1440}, max_connection_minutes:{type:'integer', minimum:1, maximum:2880}});
const CABIN_MAP = object({
  saver_seats:{type:'integer', minimum:0, maximum:500, description:'Award (saver) seats left for sale. Never more than the free seats.'},
  seats:{...list(SEAT, 120, {uniqueItems:true}), minItems:1, description:'Every seat in the cabin, in assignment order.'},
  adjacent_pairs:list(PAIR, 120),
  taken:list(SEAT, 120, {uniqueItems:true})
});
const FLIGHT = object({id:ID, flight_number:{type:'string', pattern:'^[A-Z0-9]{2}[0-9]{1,4}$'}, operating_carrier:text(1, 80),
  origin:CODE, dest:CODE, departs_at:{...DT, description:'Local time at the origin airport.'}, arrives_at:{...DT, description:'Local time at the destination airport.'},
  cabins:object({business:CABIN_MAP, economy:CABIN_MAP}, [])});
const ALTERNATIVE = object({id:ID, flight_ids:{...list(ID, 4, {uniqueItems:true}), minItems:1}});
const CHANGE = {anyOf:[{type:'null'}, object({
  change_id:ID, reason:{enum:['illegal_connection','time_change']}, flight_id:ID,
  replaces:{...list(ID, 4, {uniqueItems:true}), minItems:1, description:'Booked segments an accepted alternative replaces.'},
  alternatives:list(ALTERNATIVE, 5), deadline:DT, status:{enum:['open','accepted','expired']},
  accepted_alternative_id:{anyOf:[ID, {type:'null'}]}
})]};
const SEAT_ASSIGNMENT = object({flight_id:ID, passenger_id:ID, seat:SEAT});
const BOOKING_FIELDS = {
  id:ID, locator:{type:'string', pattern:'^[A-Z]{6}$'}, status:{enum:['ticketed','cancelled']}, cabin:CABIN,
  passenger_ids:{...list(ID, 9, {uniqueItems:true}), minItems:1}, segments:{...list(ID, 4, {uniqueItems:true}), minItems:1},
  saver_flight_ids:{...list(ID, 4, {uniqueItems:true}), description:'Segments on which this booking holds saver inventory.'},
  saver_reductions:{...list(object({flight_id:ID, seats:{type:'integer', minimum:1, maximum:9}}), 4),
    description:'Saver seats that this booking\'s non-saver seats (a free schedule-change alternative) pushed out of a flight\'s saver inventory. Owed by the flight and cabin: any seat release there gives saver seats back up to the free seats, paying the releasing booking\'s records first, then other bookings\' in booking order.'},
  seats:list(SEAT_ASSIGNMENT, 36), points:POINTS, partner_fee_cents:CENTS, taxes_cents:CENTS, payment_label:LABEL,
  charge_ids:list(ID, 10, {uniqueItems:true}), change:CHANGE, created_at:DT, updated_at:DT, history:HISTORY
};
const BOOKING = object(BOOKING_FIELDS);
const SEGMENT_VIEW = object({flight_id:ID, flight_number:FLIGHT.properties.flight_number, operating_carrier:text(1, 80),
  origin:CODE, dest:CODE, departs_at:DT, arrives_at:DT, cabin:CABIN, saver_seats:{type:'integer', minimum:0},
  free_seats:list(SEAT, 120), adjacent_pairs:{...list(PAIR, 120), description:'Adjacent pairs whose two seats are both free.'}});
const TRIP = object({...BOOKING_FIELDS, flights:list(SEGMENT_VIEW, 4)});
const PRICE = object({points:POINTS, partner_fee_cents:CENTS, taxes_cents:CENTS});
const OPTION = object({option_id:{type:'string', pattern:'^opt-[0-9a-f]{16}$'}, cabin:CABIN, pax:PAX, origin:CODE, dest:CODE,
  segments:{...list(SEGMENT_VIEW, 2), minItems:1}, connections:list(object({airport:CODE, minutes:{type:'number'}}), 1),
  seats_left:{type:'integer', minimum:0}, per_passenger:PRICE, total:PRICE, currency:{const:'USD'}});

const SEED = {$schema:'https://json-schema.org/draft/2020-12/schema', $id:'urn:pale:skyline:seed:1', ...object({
  account_id:ID, owner_person_id:ID, member_number:{type:'string', minLength:1, maxLength:40, description:'The program\'s member number, as printed on the account.'}, mail_account_id:{anyOf:[ID, {type:'null'}]},
  balance:POINTS, ledger:list(LEDGER_ENTRY, 5000), payment_labels:list(LABEL, 20, {uniqueItems:true}), charges:list(CHARGE, 2000),
  notices:list(NOTICE, 1000), passengers:{...list(PASSENGER, 9), minItems:1}, airports:{...list(AIRPORT, 50), minItems:2},
  award_chart:list(CHART_ROW, 500), rules:RULES, flights:list(FLIGHT, 1000), inventory_revision:{type:'integer', minimum:0},
  bookings:list(BOOKING, 500)
})};

// Shared loyalty-credit contract: identical in Waypoint, Skyline and Harbor.
const LOYALTY_ID = {type:'string', pattern:'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,149}$'};
const LOYALTY_PAYLOAD = {$schema:'https://json-schema.org/draft/2020-12/schema', $id:'urn:pale:loyalty-credit:1',
  title:'Loyalty points credit payload', ...object({
    channel:{const:'channel.loyalty-credit'},
    recipient:object({kind:{const:'app_account_ref'}, app_id:{enum:['waypoint','skyline','harbor']}, id:LOYALTY_ID}),
    source_object:object({app_id:{const:'waypoint'}, account_id:LOYALTY_ID, object_type:{enum:['transfer','combine']}, object_id:LOYALTY_ID},
      ['app_id','object_type','object_id','account_id']),
    content:object({
      kind:{enum:['partner_transfer','household_combine']},
      member_person_id:LOYALTY_ID,
      member_number:{anyOf:[{type:'string', minLength:1, maxLength:40}, {type:'null'}]},
      points:{type:'integer', minimum:1, maximum:10000000},
      base_points:{type:'integer', minimum:1, maximum:10000000},
      bonus_pct:{type:'integer', minimum:0, maximum:200}
    }),
    extensions:{type:'array', maxItems:0}
  })};

function wire(envelope) {
  const {$id, ...payload} = LOYALTY_PAYLOAD;
  delete payload.$schema;
  return {...envelope, $id:'urn:pale:loyalty-credit-message:1', title:'CloudEvents with loyalty credit payload v1',
    properties:{...envelope.properties, type:{const:'org.pale.loyalty.credit.v1'}, dataschema:{const:$id}, data:{$id, ...payload}}};
}

const event = (operation, payload) => object({event_id:ID, at:DT, operation:{const:operation}, payload});
function events(message) {
  return {$schema:'https://json-schema.org/draft/2020-12/schema', $id:'urn:pale:skyline:events:1', oneOf:[
    event('skyline.receive', object({recipient_account_id:ID, message})),
    event('skyline.inventory.sold', object({flight_id:ID, cabin:CABIN,
      seats:{anyOf:[{type:'integer', minimum:1, maximum:500}, {const:'all'}], description:'Saver seats sold elsewhere, or all of them.'}})),
    event('skyline.schedule.changed', object({change_id:ID, flight_id:ID, departs_at:DT, arrives_at:DT,
      alternatives:list(ALTERNATIVE, 5), deadline:DT})),
    event('skyline.alternative.expired', object({change_id:ID}))
  ]};
}

const WRITE = {expected_version:VERSION, request_id:ID};
const read = (properties, required = []) => object(properties, required);
const ok = (extra, required) => {
  const s = object({status:{const:'ok'}, app_id:{const:'skyline'}, version:VERSION, ...extra});
  if (required) s.required = ['status','app_id','version', ...required];
  return s;
};
const committed = extra => object({status:{const:'committed'}, app_id:{const:'skyline'}, version:VERSION, id:ID, ...extra});
const tool = (name, description, readOnly, inputSchema, outputSchema) => ({name, description, read_only:readOnly,
  scope:name, resource_target:'current account', inputSchema, outputSchema});
const CHANGED = object({flight_id:ID, passenger_id:ID, from:{anyOf:[SEAT, {type:'null'}]}, seat:SEAT});
const REASSIGNED = object({flight_id:ID, reason:{const:'adjacent_pair_unavailable'}, seats:list(SEAT_ASSIGNMENT, 9)});
const REFUND = {anyOf:[{type:'null'}, object({points:POINTS, taxes_cents:CENTS, partner_fee_cents:CENTS, fee_kept_cents:CENTS,
  charge_id:{anyOf:[ID, {type:'null'}]}})]};

function tools(email) {
  return [
    tool('skyline.balance', 'Read the member\'s points balance and ledger, the passengers who can be ticketed, the payment labels that can pay taxes and fees, and past charges. Reading changes nothing.',
      true, read({}), ok({member_number:SEED.properties.member_number, balance:POINTS, ledger:list(LEDGER_ENTRY, 5000),
        passengers:list(PASSENGER, 9), payment_labels:list(LABEL, 20), charges:list(CHARGE, 2000)})),
    tool('skyline.search', 'Search one-way award space for pax passengers in a cabin. date is the local date of the first departure. Returns nonstop and one-stop options (legal connection at the same airport) where every segment has at least pax saver seats, with points, partner booking fee and taxes per passenger and in total, and each segment\'s free seats. option_id is valid only until inventory changes.',
      true, read({origin:CODE, dest:CODE, date:DATE, cabin:CABIN, pax:PAX}, ['origin','dest','date','cabin','pax']),
      ok({inventory_revision:{type:'integer', minimum:0}, options:list(OPTION, 200)})),
    tool('skyline.book', 'Ticket an option from skyline.search for named passengers. Debits the points, charges partner fee plus taxes to payment_label, and assigns seats: requested seats (one per passenger per segment, each free) or the first free seats in order, which may not sit together. If inventory changed since the search, returns stale_version; search again.',
      false, object({option_id:OPTION.properties.option_id, passenger_ids:{...list(ID, 9, {uniqueItems:true}), minItems:1},
        payment_label:LABEL, seats:list(SEAT_ASSIGNMENT, 36), ...WRITE},
        ['option_id','passenger_ids','payment_label','expected_version','request_id']),
      committed({locator:BOOKING_FIELDS.locator, points:POINTS, charge_id:{anyOf:[ID, {type:'null'}]}, amount_cents:CENTS, seats:list(SEAT_ASSIGNMENT, 36)})),
    tool('skyline.trips', 'List bookings with their flights, seats, free seats in the booked cabin and any schedule change with its free alternatives and deadline. Give status to filter, or id to read one booking (also returned as trip). Reading changes nothing.',
      true, read({status:{enum:['ticketed','cancelled']}, id:ID}), ok({trips:list(TRIP, 500), trip:TRIP}, ['trips'])),
    tool('skyline.manage', 'Change a ticketed booking. change_seats: move passengers to free seats on segments that have not departed. accept_alternative: take a free alternative offered by a schedule change before its deadline; seats are reassigned, together when possible. cancel: before the first departure; points and taxes are refunded, the partner booking fee is kept unless the booking has an open schedule change.',
      false, object({booking_id:ID, action:{enum:['change_seats','accept_alternative','cancel']}, seats:list(SEAT_ASSIGNMENT, 36),
        alternative_id:ID, ...WRITE}, ['booking_id','action','expected_version','request_id']),
      committed({action:{enum:['change_seats','accept_alternative','cancel']}, booking_status:{enum:['ticketed','cancelled']},
        seats:list(SEAT_ASSIGNMENT, 36), changed:list(CHANGED, 36), reassigned:list(REASSIGNED, 4), refund:REFUND})),
    tool('skyline.notices.list', 'List the notices this program sends to the member\'s Mail account: booking confirmations and schedule changes. Reading changes nothing.',
      true, read({}), ok({notices:list(NOTICE, 1000)})),
    tool('skyline.notices.outbound', 'Build the Mail notification message for one notice, for Infra to publish on channel.email. The message ID is stable. Reading changes nothing.',
      true, read({id:ID}, ['id']), ok({message:email}))
  ];
}

function outputs() {
  const envelopeFile = path.resolve(root, '../../runtime/contracts/schemas/cloudevent.schema.json');
  const mailFile = path.resolve(root, '../../examples/apps/mail/schemas/router-message.schema.json');
  const files = {
    'schemas/seed.schema.json':SEED,
    'schemas/loyalty-credit-payload.schema.json':LOYALTY_PAYLOAD
  };
  let message;
  if (fs.existsSync(envelopeFile)) {
    message = wire(JSON.parse(fs.readFileSync(envelopeFile, 'utf8')));
    files['schemas/loyalty-credit-message.schema.json'] = message;
  } else {
    message = JSON.parse(fs.readFileSync(path.join(root, 'schemas/loyalty-credit-message.schema.json'), 'utf8'));
  }
  // Mail's receive contract, copied verbatim from Mail when it is present.
  let emailText;
  if (fs.existsSync(mailFile)) {
    emailText = fs.readFileSync(mailFile, 'utf8');
    files['schemas/email-message.schema.json'] = emailText;
  } else {
    emailText = fs.readFileSync(path.join(root, 'schemas/email-message.schema.json'), 'utf8');
  }
  const {$schema:ignoredEmail, ...email} = JSON.parse(emailText);
  const {$schema, ...inline} = message;
  files['schemas/events.schema.json'] = events(inline);
  files['tools.json'] = tools(email);
  return files;
}

function build({check = false} = {}) {
  const drift = [];
  for (const [ref, value] of Object.entries(outputs())) {
    const file = path.join(root, ref), expected = typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n';
    if (check) { if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== expected) drift.push(ref); }
    else fs.writeFileSync(file, expected);
  }
  if (drift.length) throw new Error('Generated skyline schema drift: ' + drift.join(', '));
}
module.exports = {build};
if (require.main === module) { build({check:process.argv.includes('--check')}); console.log('skyline schemas and tools.json are current.'); }
