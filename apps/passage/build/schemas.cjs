#!/usr/bin/env node
'use strict';
// Single source for the generated passage schemas and tools.json.
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
const VERSION = object({epoch:{type:'integer', minimum:1}, revision:{type:'integer', minimum:0}});
const HISTORY = {type:'array', items:object({at:DT, action:text(1, 80)}), maxItems:1000};
const DATE = {type:'string', pattern:'^[0-9]{4}-[0-9]{2}-[0-9]{2}$', description:'Calendar date YYYY-MM-DD in the office\'s time zone.'};
const BUSINESS_DAYS = {type:'integer', minimum:1, maximum:30};
const REQUEST_ID = {type:'string', pattern:'^req-[0-9]{4,8}$'};
const SIGNATURE_ID = {type:'string', pattern:'^sig-[0-9]{4,8}$', description:'Shares the number of the request that produced it (req-0142 → sig-0142).'};

// ---- Passage business records ----
const OFFICE = object({name:text(1, 120), timezone:{...text(1, 64), description:'IANA time zone of the office; business days, signing dates and lapse dates are dates there.'}});
const RULES = object({
  processing_business_days:{...BUSINESS_DAYS, description:'A travel-signature request is processed on the Nth business day after the date it was submitted.'},
  signature_validity_months:{type:'integer', minimum:1, maximum:60, description:'valid_until is signed_on plus this many calendar months (day clamped to the month end).'}
});
const HOLIDAY = object({date:DATE, name:text(1, 80)});
const DOCUMENT = object({id:ID, kind:{const:'i20'}, holder_name:text(1, 120), school:text(1, 160)});
const STATUS = {enum:['submitted','processed']};
const REQUEST = object({
  id:REQUEST_ID, kind:{const:'travel_signature'}, document_id:ID,
  submitted_at:DT, submitted_on:{...DATE, description:'Office date of submitted_at; day 0 of the business-day count.'},
  business_days:{...BUSINESS_DAYS, description:'The processing rule in force when the request was submitted.'},
  due_on:{...DATE, description:'The business_days-th business day after submitted_on (weekends and listed holidays skipped). Processing is not accepted before this date.'},
  status:STATUS, processed_at:NULLABLE_DT, processed_event_id:nullable(ID), signature_id:nullable(SIGNATURE_ID),
  created_at:DT, updated_at:DT, history:HISTORY
});
const SIGNATURE = object({
  id:SIGNATURE_ID, request_id:REQUEST_ID, document_id:ID,
  issued_at:{...DT, description:'When the signed I-20 reached the student (the processing event time).'},
  signed_on:{...DATE, description:'Office date of issued_at.'},
  valid_until:{...DATE, description:'Lapse date: the signature is valid on dates before valid_until and lapsed from 00:00 office time on valid_until.'}
});
const NOTICE_KIND = {enum:['request_received','signature_issued']};
const NOTICE_REF = object({object_type:{enum:['travel_signature_request','travel_signature']}, object_id:ID});
function notice(email) {
  return object({id:ID, kind:NOTICE_KIND, created_at:DT, title:text(1, 200), body:text(1, 4000), ref:NOTICE_REF,
    message:{anyOf:[email, {type:'null'}], description:'The Mail CloudEvent built when the notice was written, or null when the account has no Mail account. Infra reads it from env.snapshot and publishes it with router.publish.'}});
}
function seed(email) {
  return {$schema:'https://json-schema.org/draft/2020-12/schema', $id:'urn:pale:passage:seed:1', ...object({
    account_id:ID, owner_person_id:ID, mail_account_id:nullable(ID),
    office:OFFICE, rules:RULES,
    holidays:{type:'array', items:HOLIDAY, maxItems:400,
      description:'Optional office closure dates that are not business days. Absent: the built-in default table (2026-2028). An empty array: Monday to Friday with no holidays.'},
    documents:{type:'array', items:DOCUMENT, minItems:1, maxItems:1},
    requests:{type:'array', items:REQUEST, maxItems:500},
    signatures:{type:'array', items:SIGNATURE, maxItems:500},
    notices:{type:'array', items:notice(email), maxItems:2000}
  }, ['account_id','owner_person_id','mail_account_id','office','rules','documents','requests','signatures','notices'])};
}

const PROCESSED = object({
  request_id:REQUEST_ID,
  submitted_on:DATE,
  business_days:BUSINESS_DAYS,
  counted_days:{type:'array', items:DATE, minItems:1, maxItems:30, description:'The business days counted, in order, after submitted_on.'},
  skipped_holidays:{type:'array', items:DATE, maxItems:60, description:'Weekday holidays skipped between submitted_on and due_on.'},
  due_on:DATE
});
const event = (operation, payload) => object({event_id:ID, at:DT, operation:{const:operation}, payload});
const EVENTS = {$schema:'https://json-schema.org/draft/2020-12/schema', $id:'urn:pale:passage:events:1', oneOf:[
  event('passage.request.processed', PROCESSED)
]};

// ---- Agent tools ----
const WRITE = {expected_version:VERSION, request_id:ID};
const ok = extra => object({status:{const:'ok'}, app_id:{const:'passage'}, version:VERSION, ...extra});
const committed = extra => object({status:{const:'committed'}, app_id:{const:'passage'}, version:VERSION, ...extra});
const SIGNATURE_STATUS = object({...SIGNATURE.properties, status:{enum:['valid','lapsed']},
  days_until_lapse:{type:'integer', minimum:0, maximum:100000, description:'Days from today to valid_until; 0 once lapsed.'}});
const DOCUMENT_STATUS = object({...DOCUMENT.properties,
  travel_signature_status:{enum:['valid','lapsed','none'], description:'Status of current_signature today in the office time zone.'},
  current_signature:{...nullable(SIGNATURE_STATUS), description:'The most recently issued travel signature.'},
  signatures:{type:'array', items:SIGNATURE_STATUS, maxItems:500},
  pending_request_id:nullable(REQUEST_ID)});
const tool = (name, description, readOnly, inputSchema, outputSchema) => ({name, description, read_only:readOnly,
  scope:name, resource_target:'current account', inputSchema, outputSchema});
const TOOLS = [
  tool('passage.travel_signature.request', 'Submit the ISSO "Travel Signature Request" e-form for the student\'s I-20. It is processed on the Nth business day after today\'s office date (rules.processing_business_days; weekends and office holidays do not count); due_on gives that date. The office emails a receipt and, once processed, the signed I-20. While a request is still being processed, submitting again returns that request with created=false and changes nothing.',
    false, object(WRITE), committed({request:REQUEST, created:{type:'boolean'}, notice_id:nullable(ID)})),
  tool('passage.requests.list', 'List the student\'s ISSO e-form requests, newest first, with submission time, due date, status and the signature each produced. Reading changes nothing.',
    true, object({}), ok({items:{type:'array', items:REQUEST, maxItems:500}})),
  tool('passage.documents.status', 'Read the student\'s I-20 and its travel signatures: signing date, valid_until (the lapse date), and whether each is valid or lapsed today in the office time zone, plus any request still being processed. Reading changes nothing.',
    true, object({}), ok({as_of:DT, today:DATE, timezone:text(1, 64), documents:{type:'array', items:DOCUMENT_STATUS, maxItems:1}}))
];

function outputs() {
  const mailFile = path.resolve(root, '../../examples/apps/mail/schemas/router-message.schema.json');
  // Mail owns the email wire schema; this package keeps a verbatim copy.
  let email;
  const files = {};
  if (fs.existsSync(mailFile)) {
    email = JSON.parse(fs.readFileSync(mailFile, 'utf8'));
    files['schemas/email-message.schema.json'] = email;
  } else {
    email = JSON.parse(fs.readFileSync(path.join(root, 'schemas/email-message.schema.json'), 'utf8'));
  }
  const strip = ({$schema, ...inline}) => inline;
  files['schemas/seed.schema.json'] = seed(strip(email));
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
  if (drift.length) throw new Error('Generated passage schema drift: ' + drift.join(', '));
}
module.exports = {build};
if (require.main === module) { build({check:process.argv.includes('--check')}); console.log('passage schemas and tools.json are current.'); }
