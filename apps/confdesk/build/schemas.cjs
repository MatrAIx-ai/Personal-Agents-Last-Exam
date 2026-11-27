#!/usr/bin/env node
'use strict';
// Single source for the generated confdesk schemas and tools.json.
// Run `node build/schemas.cjs` after editing; `--check` fails on drift.
// The generated files are self-contained (no $ref), like the other personal Apps.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

const ID = {type:'string', pattern:'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$'};
const DT = {type:'string', format:'date-time'};
const NULLABLE_DT = {anyOf:[DT, {type:'null'}]};
const text = (min, max) => ({type:'string', minLength:min, maxLength:max});
const object = (properties, required = Object.keys(properties)) => ({type:'object', properties, required, additionalProperties:false});
const nullable = schema => ({anyOf:[schema, {type:'null'}]});
const array = (items, maxItems, extra = {}) => ({type:'array', items, maxItems, ...extra});
const VERSION = object({epoch:{type:'integer', minimum:1}, revision:{type:'integer', minimum:0}});
const HISTORY = array(object({at:DT, action:text(1, 80)}), 1000);
const DATE = {type:'string', pattern:'^[0-9]{4}-[0-9]{2}-[0-9]{2}$', description:'Calendar date YYYY-MM-DD.'};
const BUSINESS_DATE = {...DATE, description:'Calendar date YYYY-MM-DD in the business calendar\'s time zone.'};
const CENTS = {type:'integer', minimum:1, maximum:100000000};
const CURRENCY = {type:'string', pattern:'^[A-Z]{3}$', description:'ISO 4217 currency code.'};
const LABEL = {...text(1, 80), description:'Opaque payment label, one of the account\'s payment_labels.'};
const DAYS = {type:'integer', minimum:1, maximum:60};

// ---- ConfDesk business records ----
const HOLIDAY = object({date:DATE, name:text(1, 80)});
const CALENDAR = object({
  timezone:{...text(1, 64), description:'IANA time zone in which business dates are counted.'},
  holidays:{...array(HOLIDAY, 400), description:'Dates that are not business days, besides Saturdays and Sundays.'}
});
const RATE = object({from:{...DT, description:'The rate applies to registrations from this instant until the next row.'}, amount_cents:CENTS});
const WINDOW = object({
  opens_at:DT, closes_at:{...DT, description:'Last instant at which an author registration is accepted; the program deadline.'},
  opened_at:{...NULLABLE_DT, description:'When Infra applied confdesk.registration.open.'},
  closed_at:{...NULLABLE_DT, description:'When Infra applied confdesk.deadline.passed.'}
});
const CONFERENCE = object({
  id:ID, short_name:text(1, 40), name:text(1, 160), venue:text(1, 160), city:text(1, 80),
  country:{type:'string', pattern:'^[A-Z]{2}$'}, starts_on:DATE, ends_on:DATE,
  registration_prefix:{type:'string', pattern:'^[A-Z0-9]{2,12}$', description:'Registration IDs are <prefix>-R-<number, 4 digits>.'},
  registration_number:{type:'integer', minimum:1, maximum:9999, description:'Number the desk assigns to this account\'s registration.'},
  currency:CURRENCY,
  author_rates:{...array(RATE, 10, {minItems:1}), description:'Author rate schedule in from order; the first row starts at or before opens_at.'},
  rate_covers:array(text(1, 200), 20, {minItems:1}),
  preview_ttl_minutes:{type:'integer', minimum:1, maximum:1440},
  letter_business_days:{...DAYS, description:'The invitation letter is issued this many business days after the registration date.'},
  correction_business_days:{...DAYS, description:'A corrected letter is issued this many business days after the correction request date.'},
  letter_signatory:text(1, 160),
  window:WINDOW
});
const DETAILS = object({
  salutation:nullable(text(1, 20)), surname:text(1, 80), given_names:text(1, 80),
  date_of_birth:DATE, nationality:text(1, 80)
});
const ATTENDEE = object({details:DETAILS, affiliation:text(1, 160), created_at:DT, updated_at:DT, history:HISTORY});
const PAPER_STATUS = {enum:['awaiting_registration', 'in_program', 'removed']};
const PAPER = object({
  id:ID, number:{type:'integer', minimum:1, maximum:99999}, title:text(1, 300), authors:array(text(1, 120), 30, {minItems:1}),
  session:nullable(text(1, 200)), submitted_at:DT, accepted_at:DT, status:PAPER_STATUS,
  registration_id:nullable(ID), removed_at:NULLABLE_DT, created_at:DT, updated_at:DT, history:HISTORY
});
const MONEY = object({amount_cents:CENTS, currency:CURRENCY});
const REGISTRATION = object({
  id:ID, type:{const:'author'}, status:{const:'completed'}, paper_id:ID,
  preview_id:ID, previewed_at:DT, completed_at:DT, rate:MONEY, covers:array(text(1, 200), 20),
  payment_label:LABEL, payment_id:ID, created_at:DT, updated_at:DT, history:HISTORY
});
const PAYMENT = object({id:ID, at:DT, label:LABEL, amount_cents:CENTS, currency:CURRENCY, description:text(1, 200), registration_id:ID});
const LETTER = object({
  id:ID, registration_id:ID, kind:{enum:['original', 'corrected']}, correction_id:nullable(ID),
  name_on_letter:{...text(1, 170), description:'SURNAME Given names, as printed.'}, details:DETAILS,
  issued_at:DT, business_days:DAYS, counted_from:BUSINESS_DATE, due_on:BUSINESS_DATE,
  status:{enum:['current', 'superseded']}, superseded_by:nullable(ID), text:text(1, 6000), updated_at:DT, history:HISTORY
});
const FIELDS = object({salutation:text(1, 20), surname:text(1, 80), given_names:text(1, 80), date_of_birth:DATE, nationality:text(1, 80)}, []);
const CORRECTION = object({
  id:ID, at:DT, via:{const:'letter.request_correction'}, letter_id:ID,
  fields:{...FIELDS, description:'Corrected values; at least one field.'},
  business_days:DAYS, counted_from:BUSINESS_DATE, expected_on:BUSINESS_DATE,
  status:{enum:['pending', 'issued']}, issued_letter_id:nullable(ID), issued_at:NULLABLE_DT, updated_at:DT, history:HISTORY
});
const NOTICE_KIND = {enum:['registration_confirmed', 'letter_issued', 'correction_issued', 'paper_removed']};
const EVENT_OPS = ['confdesk.registration.open', 'confdesk.deadline.passed', 'confdesk.letter.issue', 'confdesk.correction.issue'];
const EVENT_LOG = object({event_id:ID, at:DT, operation:{enum:EVENT_OPS}, result:{enum:['opened', 'kept', 'removed', 'issued']}, object_id:nullable(ID)});

function seed(email) {
  const NOTICE = object({
    id:ID, kind:NOTICE_KIND, created_at:DT, title:text(1, 200), body:text(1, 6000),
    ref:object({object_type:{enum:['registration', 'invitation_letter', 'paper']}, object_id:ID}),
    message:{...nullable(email), description:'Mail CloudEvent for Infra to publish through Messaging; null without a bound Mail account.'}
  });
  return {$schema:'https://json-schema.org/draft/2020-12/schema', $id:'urn:pale:confdesk:seed:1', ...object({
    account_id:ID, owner_person_id:ID, mail_account_id:nullable(ID),
    conference:CONFERENCE,
    business_calendar:{...CALENDAR, description:'Optional. Without it the desk uses its default calendar (America/Chicago, US federal holidays 2026-2028); holidays [] means no holidays.'},
    attendee:ATTENDEE, paper:PAPER, registration:nullable(REGISTRATION),
    payment_labels:array(LABEL, 20, {uniqueItems:true}),
    payments:array(PAYMENT, 100), letters:array(LETTER, 100), correction_requests:array(CORRECTION, 100),
    notices:array(NOTICE, 500), events:array(EVENT_LOG, 500)
  }, ['account_id', 'owner_person_id', 'mail_account_id', 'conference', 'attendee', 'paper', 'registration', 'payment_labels',
    'payments', 'letters', 'correction_requests', 'notices', 'events'])};
}

const BUSINESS_DAYS_PAYLOAD = object({
  registration_id:ID,
  counted_from:{...BUSINESS_DATE, description:'Day 0: the registration (or correction request) date in the business calendar, whatever the hour.'},
  business_days:{...DAYS, description:'Must equal the desk\'s own rule.'},
  counted_days:{...array(BUSINESS_DATE, 60, {minItems:1}), description:'The Monday-Friday non-holiday dates counted, in order.'},
  skipped_holidays:{...array(BUSINESS_DATE, 60), description:'Weekday holidays passed over while counting.'},
  due_on:{...BUSINESS_DATE, description:'The last counted day; the event is applied on or after this date.'}
});
const event = (operation, payload) => object({event_id:ID, at:DT, operation:{const:operation}, payload});
const EVENTS = {$schema:'https://json-schema.org/draft/2020-12/schema', $id:'urn:pale:confdesk:events:1', oneOf:[
  event('confdesk.registration.open', object({})),
  event('confdesk.deadline.passed', object({})),
  event('confdesk.letter.issue', BUSINESS_DAYS_PAYLOAD),
  event('confdesk.correction.issue', BUSINESS_DAYS_PAYLOAD)
]};

// ---- Agent tools ----
const WRITE = {expected_version:VERSION, request_id:ID};
const read = (properties, required = []) => object(properties, required);
const ok = extra => object({status:{const:'ok'}, app_id:{const:'confdesk'}, version:VERSION, ...extra});
const committed = extra => object({status:{const:'committed'}, app_id:{const:'confdesk'}, version:VERSION, ...extra});
const WINDOW_VIEW = object({opens_at:DT, closes_at:DT, status:{enum:['not_open', 'open', 'closed']}});
const CONFERENCE_VIEW = object({
  id:ID, short_name:text(1, 40), name:text(1, 160), venue:text(1, 160), city:text(1, 80), country:{type:'string', pattern:'^[A-Z]{2}$'},
  starts_on:DATE, ends_on:DATE, registration:WINDOW_VIEW,
  author_rate:{...nullable(object({amount_cents:CENTS, currency:CURRENCY, from:DT})), description:'Rate in effect now; null before the first row.'},
  author_rates:array(RATE, 10), currency:CURRENCY, rate_covers:array(text(1, 200), 20), preview_ttl_minutes:{type:'integer', minimum:1, maximum:1440},
  letter_business_days:DAYS, correction_business_days:DAYS,
  business_calendar:object({timezone:text(1, 64), weekend:array({enum:['Saturday', 'Sunday']}, 2), holidays:array(HOLIDAY, 400), source:{enum:['seed', 'default']}}),
  as_of:DT
});
const ATTENDEE_VIEW = object({details:DETAILS, name_on_file:text(1, 170), affiliation:text(1, 160), created_at:DT});
const tool = (name, description, readOnly, inputSchema, outputSchema) => ({name, description, read_only:readOnly,
  scope:name, resource_target:'current account', inputSchema, outputSchema});
const TOOLS = [
  tool('confdesk.conference.get', 'Read the conference: dates and venue, the author registration window (opens_at, closes_at and whether it is open now), the author rate schedule and what the rate covers, how long a registration preview stays valid, and the business-day rules for invitation letters and corrections with the business calendar (time zone, Saturday and Sunday off, holidays). Reading changes nothing.',
    true, read({}), ok({conference:CONFERENCE_VIEW})),
  tool('confdesk.register.preview', 'Preview an author registration for an accepted paper: the author rate and its currency in effect now, what it covers, the payment labels you can use and when the preview expires. Returns a single-use preview_id for confdesk.register.confirm. Changes nothing and charges nothing. Fails before the window opens (registration_not_open), after it closes (registration_closed), for a removed paper (paper_removed) or when an author is already registered (already_registered).',
    true, read({paper_id:ID}, ['paper_id']), ok({
      preview_id:ID, paper_id:ID, registration_type:{const:'author'}, rate:MONEY, covers:array(text(1, 200), 20),
      window:object({opens_at:DT, closes_at:DT}), previewed_at:DT, expires_at:DT, payment_labels:array(LABEL, 20)})),
  tool('confdesk.register.confirm', 'Register as the paper\'s author with a preview from confdesk.register.preview and record the payment of the previewed rate against payment_label. Rejected, with nothing recorded, when the preview is unknown (not_found), was already used (preview_used), has expired (preview_expired), or no longer matches the rate or the open window (preview_mismatch), or when an author is already registered (already_registered). A confirmation notice goes to Mail; the invitation letter follows the letter business-day rule.',
    false, object({preview_id:ID, payment_label:LABEL, ...WRITE}),
    committed({registration:REGISTRATION, payment:PAYMENT, notice_id:ID,
      letter_expected_on:{...BUSINESS_DATE, description:'Date the invitation letter is due under the desk\'s business-day rule.'}})),
  tool('confdesk.registration.get', 'Read this account\'s registration (null until registered), the attendee details on file that invitation letters use, the payment labels and recorded payments. Reading changes nothing.',
    true, read({}), ok({registration:nullable(REGISTRATION), attendee:ATTENDEE_VIEW, payment_labels:array(LABEL, 20), payments:array(PAYMENT, 100)})),
  tool('confdesk.letter.get', 'Read the visa invitation letters (newest first; the current one is also returned as current), the date the first letter is due when it has not been issued yet, and every correction request with its status and expected date. Reading changes nothing.',
    true, read({}), ok({letters:array(LETTER, 100), current:nullable(LETTER), letter_expected_on:nullable(BUSINESS_DATE), correction_requests:array(CORRECTION, 100)})),
  tool('confdesk.letter.request_correction', 'Ask the desk to correct details printed on the current invitation letter. fields holds the corrected values (salutation, surname, given_names, date_of_birth, nationality); each must differ from the letter. A corrected letter is issued after the correction business-day rule, counted from today\'s date in the business calendar. Needs an issued letter and no other pending request (invalid_state).',
    false, object({fields:FIELDS, ...WRITE}), committed({correction:CORRECTION})),
  tool('confdesk.paper.status', 'Read the accepted paper: title, authors, session, whether it is awaiting an author registration, in the program or removed, the registration that keeps it and the registration deadline. Reading changes nothing.',
    true, read({}), ok({paper:PAPER, registered:{type:'boolean'}, registration_deadline:DT}))
];

function outputs() {
  const mailFile = path.resolve(root, '../../examples/apps/mail/schemas/router-message.schema.json');
  const files = {};
  // Mail owns the email wire schema; this package keeps a verbatim copy.
  let email;
  if (fs.existsSync(mailFile)) {
    email = JSON.parse(fs.readFileSync(mailFile, 'utf8'));
    files['schemas/email-message.schema.json'] = email;
  } else {
    email = JSON.parse(fs.readFileSync(path.join(root, 'schemas/email-message.schema.json'), 'utf8'));
  }
  const {$schema, ...inline} = email;
  files['schemas/seed.schema.json'] = seed(inline);
  files['schemas/events.schema.json'] = EVENTS;
  files['tools.json'] = TOOLS;
  return files;
}

function build({check = false} = {}) {
  const drift = [];
  for (const [ref, value] of Object.entries(outputs())) {
    const file = path.join(root, ref), expected = JSON.stringify(value, null, 2) + '\n';
    if (check) { if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== expected) drift.push(ref); }
    else fs.writeFileSync(file, expected);
  }
  if (drift.length) throw new Error('Generated confdesk schema drift: ' + drift.join(', '));
}
module.exports = {build};
if (require.main === module) { build({check:process.argv.includes('--check')}); console.log('confdesk schemas and tools.json are current.'); }
