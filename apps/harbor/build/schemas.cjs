#!/usr/bin/env node
'use strict';
// Single source for the generated harbor schemas and tools.json.
// Run `node build/schemas.cjs` after editing; `--check` fails on drift.
// The generated files are self-contained (no $ref), like the other personal Apps.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

const ID = {type:'string', pattern:'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$'};
const LONG_ID = {type:'string', pattern:'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,149}$'};
const DT = {type:'string', format:'date-time'};
const NULLABLE_DT = {anyOf:[DT, {type:'null'}]};
const text = (min, max) => ({type:'string', minLength:min, maxLength:max});
const object = (properties, required = Object.keys(properties)) => ({type:'object', properties, required, additionalProperties:false});
const nullable = schema => ({anyOf:[schema, {type:'null'}]});
const VERSION = object({epoch:{type:'integer', minimum:1}, revision:{type:'integer', minimum:0}});
const HISTORY = {type:'array', items:object({at:DT, action:text(1, 80)}), maxItems:1000};
const DATE = {type:'string', pattern:'^[0-9]{4}-[0-9]{2}-[0-9]{2}$', description:'Calendar date YYYY-MM-DD, read in the hotel\'s own time zone.'};
const POINTS = {type:'integer', minimum:0, maximum:100000000};
const SIGNED_POINTS = {type:'integer', minimum:-100000000, maximum:100000000};
const CENTS = {type:'integer', minimum:0, maximum:100000000};
const CATEGORY = {type:'integer', minimum:1, maximum:8};
const LABEL = {...text(1, 80), description:'Opaque payment label, one of the account\'s payment_labels.'};
const METHOD = {enum:['points','certificate','points_cash','cash']};

// ---- Shared loyalty-credit contract (receiver-owned; identical in Skyline, Harbor and Waypoint) ----
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

// ---- Harbor business records ----
const WAYPOINT_REF = object({app_id:{const:'waypoint'}, account_id:LONG_ID, object_type:{enum:['transfer','combine']},
  object_id:LONG_ID, message_id:text(1, 150), sent_at:NULLABLE_DT});
const LEDGER_ENTRY = object({
  id:ID, at:DT, kind:{enum:['opening','redeem','refund','transfer_in','expire']},
  points:SIGNED_POINTS, balance_after:POINTS,
  ref:{anyOf:[object({reservation_id:ID}), WAYPOINT_REF, {type:'null'}]}
});
const CHARGE = object({id:ID, at:DT, label:LABEL, amount_cents:{type:'integer', minimum:-100000000, maximum:100000000,
  description:'Signed amount; refunds are negative.'}, currency:{const:'USD'}, description:text(1, 200), ref:nullable(object({reservation_id:ID}))});
const NOTICE = object({
  id:ID, created_at:DT, updated_at:DT, history:HISTORY,
  kind:{enum:['booking_confirmed','category_change','expiry_warning']}, title:text(1, 200), body:text(1, 2000),
  ref:nullable(object({object_type:{enum:['reservation','hotel','account']}, object_id:ID}))
});
const CHART_ROW = object({category:CATEGORY, points_per_night:{type:'integer', minimum:1, maximum:1000000},
  points_cash:nullable(object({points:{type:'integer', minimum:1, maximum:1000000}, cash_cents:{type:'integer', minimum:1, maximum:10000000}}))});
const CATEGORY_CHANGE = object({category:CATEGORY, effective_at:DT, announced_at:DT});
const HOTEL = object({
  id:ID, name:text(1, 120), city:text(1, 80),
  timezone:{...text(1, 64), description:'IANA time zone of the hotel; check-in dates and blackout dates are local dates there.'},
  category:{...CATEGORY, description:'Category before any listed change takes effect.'},
  category_changes:{type:'array', items:CATEGORY_CHANGE, maxItems:20, description:'Announced changes in effective_at order.'},
  cash_rate_cents:{type:'integer', minimum:1, maximum:10000000},
  blackout_dates:{type:'array', items:DATE, uniqueItems:true, maxItems:366}
});
const CERTIFICATE = object({
  id:ID, category_cap:CATEGORY, expires_on:{...DATE, description:'Last allowed check-in date.'},
  status:{enum:['active','used','expired']}, reservation_id:nullable(ID), created_at:DT, updated_at:DT, history:HISTORY
});
const RESERVATION_STATUS = {enum:['confirmed','cancelled']};
const RESERVATION = object({
  id:ID, confirmation:{type:'string', pattern:'^HH[0-9A-F]{8}$'}, hotel_id:ID, check_in:DATE, check_out:DATE,
  nights:{type:'integer', minimum:1, maximum:30}, status:RESERVATION_STATUS,
  payment:object({method:METHOD, certificate_id:nullable(ID), payment_label:nullable(LABEL)}),
  category_locked:{...CATEGORY, description:'Category in effect when the reservation was booked; later changes do not reprice it.'},
  points:POINTS, cash_cents:CENTS, charge_ids:{type:'array', items:ID, maxItems:10},
  created_at:DT, updated_at:DT, history:HISTORY
});
const SEED = {$schema:'https://json-schema.org/draft/2020-12/schema', $id:'urn:pale:harbor:seed:1', ...object({
  account_id:ID, owner_person_id:ID, member_number:text(1, 40), mail_account_id:nullable(ID),
  balance:POINTS, ledger:{type:'array', items:LEDGER_ENTRY, maxItems:5000},
  payment_labels:{type:'array', items:LABEL, uniqueItems:true, maxItems:20},
  charges:{type:'array', items:CHARGE, maxItems:2000},
  notices:{type:'array', items:NOTICE, maxItems:2000},
  last_activity_at:DT, inactivity_months:{type:'integer', minimum:1, maximum:120}, forfeited_at:NULLABLE_DT,
  award_chart:{type:'array', items:CHART_ROW, minItems:1, maxItems:8},
  hotels:{type:'array', items:HOTEL, maxItems:200},
  certificates:{type:'array', items:CERTIFICATE, maxItems:200},
  reservations:{type:'array', items:RESERVATION, maxItems:1000}
})};

const event = (operation, payload) => object({event_id:ID, at:DT, operation:{const:operation}, payload});
function events(message) {
  return {$schema:'https://json-schema.org/draft/2020-12/schema', $id:'urn:pale:harbor:events:1', oneOf:[
    event('harbor.receive', object({recipient_account_id:ID, message})),
    event('harbor.category.change', object({hotel_id:ID, category:CATEGORY, effective_at:DT})),
    event('harbor.points.expire', object({})),
    event('harbor.expiry.warn', object({}))
  ]};
}

// ---- Agent tools ----
const WRITE = {expected_version:VERSION, request_id:ID};
const read = (properties, required = []) => object(properties, required);
const ok = (extra, optional = []) => object({status:{const:'ok'}, app_id:{const:'harbor'}, version:VERSION, ...extra},
  ['status','app_id','version', ...Object.keys(extra).filter(k => !optional.includes(k))]);
const committed = extra => object({status:{const:'committed'}, app_id:{const:'harbor'}, version:VERSION, ...extra});
const OFFER = object({
  hotel_id:ID, name:text(1, 120), city:text(1, 80), timezone:text(1, 64),
  category:{...CATEGORY, description:'Category in effect now; a booking now is priced and locked at this category.'},
  upcoming_category_change:nullable(CATEGORY_CHANGE),
  dates_open:{type:'boolean', description:'False when check-in is not after today\'s date at the hotel.'},
  award_available:{type:'boolean', description:'False when any night of the stay is a blackout date (points, certificate and Points + Cash).'},
  blackout_nights:{type:'array', items:DATE, maxItems:30},
  prices:object({points:object({points:POINTS}), points_cash:nullable(object({points:POINTS, cash_cents:CENTS})), cash:object({cash_cents:CENTS})}),
  eligible_certificate_ids:{type:'array', items:ID, maxItems:200}
});
const STAY = {check_in:{...DATE, description:'Local check-in date at the hotel.'}, check_out:{...DATE, description:'Local check-out date; after check_in, at most 30 nights.'}};
const tool = (name, description, readOnly, inputSchema, outputSchema) => ({name, description, read_only:readOnly,
  scope:name, resource_target:'current account', inputSchema, outputSchema});
function tools(email) {
  return [
    tool('harbor.account', 'Read the Harbor account: points balance, member number, last qualifying activity, when points expire after inactivity, any forfeiture, free-night certificates, payment labels, the points ledger and charges. Reading changes nothing.',
      true, read({}), ok({account_id:ID, member_number:text(1, 40), balance:POINTS, last_activity_at:DT, expires_at:DT,
        forfeited_at:NULLABLE_DT, inactivity_months:{type:'integer', minimum:1, maximum:120},
        payment_labels:{type:'array', items:LABEL, maxItems:20}, certificates:{type:'array', items:CERTIFICATE, maxItems:200},
        ledger:{type:'array', items:LEDGER_ENTRY, maxItems:5000}, charges:{type:'array', items:CHARGE, maxItems:2000}})),
    tool('harbor.search', 'Search hotels in a city for a stay. Each hotel shows the category in effect now and any announced future change, the price of the whole stay in points, Points + Cash (when offered) and cash, whether award nights are available (no blackout night), and which active certificates could pay for it (1 night, category within the cap, check-in on or before the certificate\'s last check-in date). Reading changes nothing.',
      true, read({city:text(1, 80), ...STAY}, ['city','check_in','check_out']),
      ok({city:text(1, 80), check_in:DATE, check_out:DATE, nights:{type:'integer', minimum:1, maximum:30}, priced_at:DT,
        hotels:{type:'array', items:OFFER, maxItems:200}})),
    tool('harbor.book', 'Book a stay. payment.method is points, certificate (give certificate_id; exactly 1 night), points_cash or cash (give payment_label for both). Check-in must be after today\'s date at the hotel. Award methods need every night free of blackout dates. The price uses the category in effect now and is locked on the reservation. Points and Points + Cash redemptions count as account activity; cash and certificate stays do not.',
      false, object({hotel_id:ID, ...STAY, payment:object({method:METHOD, certificate_id:ID, payment_label:LABEL}, ['method']), ...WRITE},
        ['hotel_id','check_in','check_out','payment','expected_version','request_id']),
      committed({id:ID, confirmation:{type:'string', pattern:'^HH[0-9A-F]{8}$'}, category_locked:CATEGORY,
        nights:{type:'integer', minimum:1, maximum:30}, points:POINTS, cash_cents:CENTS, charge_id:nullable(ID),
        certificate_id:nullable(ID), balance:POINTS, last_activity_at:DT, notice_id:ID})),
    tool('harbor.reservations', 'List reservations, optionally by status, in check-in order; give id to read one reservation (also returned as item). Reading changes nothing.',
      true, read({status:RESERVATION_STATUS, id:ID}),
      ok({items:{type:'array', items:RESERVATION, maxItems:1000}, item:RESERVATION}, ['item'])),
    tool('harbor.cancel', 'Cancel a confirmed reservation before its check-in date at the hotel. Points come back to the balance (a refund is not account activity), cash comes back as a negative charge to the same label, and a certificate becomes active again if today at the hotel is on or before its last check-in date, otherwise it expires.',
      false, object({reservation_id:ID, ...WRITE}),
      committed({id:ID, refunded_points:POINTS, refunded_cash_cents:CENTS, refund_charge_id:nullable(ID),
        certificate:nullable(object({id:ID, status:{enum:['active','expired']}})), balance:POINTS})),
    tool('harbor.notices.list', 'List notices the program has written for this member (booking confirmations, category changes, expiry warnings), newest first. Reading changes nothing.',
      true, read({}), ok({items:{type:'array', items:NOTICE, maxItems:2000}})),
    tool('harbor.notices.outbound', 'Build the Mail message for one notice: a stable CloudEvent for Mail\'s email receive contract (urn:pale:email-message:2) addressed to the member\'s Mail account. Building it changes nothing; Infra publishes it through Messaging.',
      true, read({id:ID}, ['id']), ok({message:email}))
  ];
}

function outputs() {
  const envelopeFile = path.resolve(root, '../../runtime/contracts/schemas/cloudevent.schema.json');
  const mailFile = path.resolve(root, '../../examples/apps/mail/schemas/router-message.schema.json');
  const files = {'schemas/seed.schema.json':SEED, 'schemas/loyalty-credit-payload.schema.json':LOYALTY_PAYLOAD};
  let message;
  if (fs.existsSync(envelopeFile)) {
    message = wire(JSON.parse(fs.readFileSync(envelopeFile, 'utf8')));
    files['schemas/loyalty-credit-message.schema.json'] = message;
  } else {
    message = JSON.parse(fs.readFileSync(path.join(root, 'schemas/loyalty-credit-message.schema.json'), 'utf8'));
  }
  // Mail owns the email wire schema; this package keeps a verbatim copy.
  let email;
  if (fs.existsSync(mailFile)) {
    email = JSON.parse(fs.readFileSync(mailFile, 'utf8'));
    files['schemas/email-message.schema.json'] = email;
  } else {
    email = JSON.parse(fs.readFileSync(path.join(root, 'schemas/email-message.schema.json'), 'utf8'));
  }
  const strip = ({$schema, ...inline}) => inline;
  files['schemas/events.schema.json'] = events(strip(message));
  files['tools.json'] = tools(strip(email));
  return files;
}

function build({check = false} = {}) {
  const drift = [];
  for (const [ref, value] of Object.entries(outputs())) {
    const file = path.join(root, ref), expected = JSON.stringify(value, null, 2) + '\n';
    if (check) { if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== expected) drift.push(ref); }
    else fs.writeFileSync(file, expected);
  }
  if (drift.length) throw new Error('Generated harbor schema drift: ' + drift.join(', '));
}
module.exports = {build, LOYALTY_PAYLOAD};
if (require.main === module) { build({check:process.argv.includes('--check')}); console.log('harbor schemas and tools.json are current.'); }
