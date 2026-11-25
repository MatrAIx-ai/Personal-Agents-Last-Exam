#!/usr/bin/env node
'use strict';
// Single source for the generated VisaSlot schemas and tools.json.
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
const list = (items, maxItems, extra = {}) => ({type:'array', items, maxItems, ...extra});
const VERSION = object({epoch:{type:'integer', minimum:1}, revision:{type:'integer', minimum:0}});
const DATE = {type:'string', pattern:'^[0-9]{4}-[0-9]{2}-[0-9]{2}$', description:'Calendar date YYYY-MM-DD.'};
const COUNTRY = {type:'string', pattern:'^[A-Z]{2}$', description:'ISO 3166-1 alpha-2 country code, e.g. DE or FR.'};
const RECORD_VERSION = {type:'integer', minimum:1, maximum:1000000};

const RULES = ['file_submitted', 'consulate_competent', 'name_matches_passport', 'letter_issued_by_appointment',
  'signature_valid_through_return', 'covers_every_night'];
const ITEMS = ['visa_file', 'appointment', 'invitation_letter', 'travel_signature', 'accommodation', 'travel'];

// ---- Visa file documents ----
const SOURCE = {...object({app_id:ID, object_type:text(1, 80), object_id:LONG_ID}),
  description:'The record the agent read these facts from. VisaSlot stores it for grading; it never reads that App.'};
const LETTER = object({source:SOURCE, name_on_letter:text(1, 200),
  issued_on:{...DATE, description:'Date the letter was issued. Must not be after the submission date at the consulate.'}});
const SIGNATURE = object({source:SOURCE, signed_on:{...DATE, description:'Date of the travel signature. Must not be after the submission date at the consulate.'},
  valid_until:{...DATE, description:'Lapse date, exclusive: the signature is valid before this date and lapsed on it. After signed_on.'}});
const STAY = object({country:COUNTRY, check_in:DATE, check_out:{...DATE, description:'After check_in. Nights are check_in up to the day before check_out.'}, source:SOURCE});
const TRAVEL = object({enter_on:{...DATE, description:'Date of entry into the Schengen area.'},
  leave_on:{...DATE, description:'Date of the return departure; after enter_on. Nights are enter_on up to the day before leave_on.'}, source:SOURCE},
  ['enter_on', 'leave_on']);
const DOCUMENTS = object({invitation_letter:LETTER, travel_signature:SIGNATURE,
  accommodation:list(STAY, 60, {minItems:1, description:'Stays in any order; no two stays may share a night.'}), travel:TRAVEL});
const FILE = object({version:RECORD_VERSION, submitted_at:DT, documents:DOCUMENTS,
  locked_at:{...NULLABLE_DT, description:'Set when the appointment is held; a locked file cannot change.'}});
const FILE_HISTORY = object({version:RECORD_VERSION, submitted_at:DT, documents:DOCUMENTS, replaced_at:DT});

// ---- Appointment check ----
const MISSING = {anyOf:[
  object({item:{enum:ITEMS}, rule:{enum:RULES.filter(r => r !== 'covers_every_night')}, expected:text(1, 200), found:nullable(text(1, 200))}),
  object({item:{const:'accommodation'}, rule:{const:'covers_every_night'}, nights:list(DATE, 400, {minItems:1})})
], description:'One entry per failed rule, in rule order.'};
const MISSING_LIST = list(MISSING, RULES.length);
const CHECK = object({appointment_id:ID, held_at:DT, result:{enum:['complete', 'refused']}, missing:MISSING_LIST});
const HELD = object({event_id:ID, consulate_id:ID, slot_at:DT, held_at:DT, appointment_id:nullable(ID),
  result:{enum:['complete', 'refused', 'no_appointment']}, missing:MISSING_LIST});

// ---- Records ----
const STATUS = {enum:['booked', 'cancelled', 'held']};
const HISTORY_ENTRY = object({at:DT, status:STATUS, slot_at:{...DT, description:'The slot the appointment held after this step.'},
  action:{enum:['booked', 'rescheduled', 'cancelled', 'cancelled_by_consulate', 'held']}});
const CONSULATE = object({id:ID, name:text(1, 120), country:COUNTRY, city:text(1, 80),
  timezone:{...text(1, 64), description:'IANA time zone; slot times carry its UTC offset and dates are local dates there.'}});
const SLOT = object({consulate_id:ID, slot_at:{...DT, description:'Start of the slot, written with the consulate\'s local UTC offset.'},
  status:{enum:['open', 'taken', 'booked', 'closed'], description:'open: bookable; taken: by another applicant; booked: by this applicant\'s appointment; closed: withdrawn by the consulate.'},
  version:{...RECORD_VERSION, description:'Increases each time the slot changes status.'}, appointment_id:nullable(ID)});
const APPOINTMENT = object({
  id:ID, consulate_id:ID, country:COUNTRY, slot_at:DT, status:STATUS,
  version:{...RECORD_VERSION, description:'Increases on booking, reschedule, cancellation and hold. A file submission does not change it.'},
  created_at:DT, updated_at:DT,
  history:list(HISTORY_ENTRY, 200, {minItems:1, description:'Every booking, reschedule, cancellation and hold, with the slot held after it.'}),
  cancellation:nullable(object({by:{enum:['applicant', 'consulate']}, at:DT, reason:nullable(text(1, 500))})),
  file:nullable(FILE), file_history:list(FILE_HISTORY, 200, {description:'Earlier files, oldest first, each with the time it was replaced.'}),
  check:nullable(CHECK)
});
// What the scheduling tools return: the appointment without its file documents (read those with visaslot.file.get).
const APPOINTMENT_VIEW = object({...Object.fromEntries(Object.entries(APPOINTMENT.properties).filter(([k]) => !['file', 'file_history'].includes(k))),
  file_version:{...nullable(RECORD_VERSION), description:'Version of the registered visa file, or null when none is registered.'}});
const CHECKLIST_ITEM = object({item:{type:'string', pattern:'^[a-z][a-z0-9_]{0,59}$'}, label:text(1, 120), description:text(1, 1000),
  checked_by:{...list({enum:RULES}, RULES.length, {uniqueItems:true}), description:'Rules VisaSlot applies to this item at the appointment; empty when the consulate checks it in person.'}});
const CHECKLIST = object({category:{type:'string', pattern:'^[a-z][a-z0-9_]{0,59}$'}, title:text(1, 120), items:list(CHECKLIST_ITEM, 40, {minItems:1})});

const SEED = {$schema:'https://json-schema.org/draft/2020-12/schema', $id:'urn:pale:visaslot:seed:1', ...object({
  account_id:ID, owner_person_id:ID,
  passport_name:{...text(1, 200), description:'Name as printed in the applicant\'s passport; the name-match rule compares the letter against it.'},
  consulates:list(CONSULATE, 50, {minItems:1}),
  slots:list(SLOT, 2000),
  appointments:list(APPOINTMENT, 500),
  checks:{...list(HELD, 1000), description:'Every applied visaslot.appointment.held event and its result, in order.'},
  checklists:list(CHECKLIST, 20)
})};

const event = (operation, payload) => object({event_id:ID, at:DT, operation:{const:operation}, payload});
const SLOT_REF = {consulate_id:ID, slot_at:DT};
const EVENTS = {$schema:'https://json-schema.org/draft/2020-12/schema', $id:'urn:pale:visaslot:events:1', oneOf:[
  event('visaslot.slot.released', object(SLOT_REF)),
  event('visaslot.slot.taken', object(SLOT_REF)),
  event('visaslot.appointment.cancelled_by_consulate', object({...SLOT_REF, reason:text(1, 500)}, ['consulate_id', 'slot_at'])),
  event('visaslot.appointment.held', object(SLOT_REF))
]};

// ---- Agent tools ----
const WRITE = {expected_version:VERSION, request_id:ID};
const read = (properties, required = []) => object(properties, required);
const ok = (extra, optional = []) => object({status:{const:'ok'}, app_id:{const:'visaslot'}, version:VERSION, ...extra},
  ['status', 'app_id', 'version', ...Object.keys(extra).filter(k => !optional.includes(k))]);
const committed = extra => object({status:{const:'committed'}, app_id:{const:'visaslot'}, version:VERSION, ...extra});
const OPEN_SLOT = object({consulate_id:ID, slot_at:DT, version:RECORD_VERSION});
const tool = (name, description, readOnly, inputSchema, outputSchema) => ({name, description, read_only:readOnly,
  scope:name, resource_target:'current account', inputSchema, outputSchema});
const TOOLS = [
  tool('visaslot.competence', 'Find the competent consulate for a trip. Give every stay in the Schengen area with its country and dates; nights are counted per country. The main destination is the country with the most nights; on a tie, the tied country entered first (earliest check-in). Returns the night counts, the main country, which rule decided it and the consulates of that country. Reading changes nothing.',
    true, read({trip:object({stays:list(object({country:COUNTRY, check_in:DATE, check_out:DATE}), 60, {minItems:1})})}, ['trip']),
    ok({nights_by_country:list(object({country:COUNTRY, nights:{type:'integer', minimum:1}, first_night:DATE}), 60),
      total_nights:{type:'integer', minimum:1}, main_country:COUNTRY, rule:{enum:['most_nights', 'tie_first_entry']},
      consulates:list(CONSULATE, 50)})),
  tool('visaslot.slots', 'List the open appointment slots at a consulate between two local dates (inclusive), earliest first. Slots in the past and slots taken, booked or closed are not listed; availability changes over time. Each slot carries its version: book with it. Reading changes nothing.',
    true, read({consulate_id:ID, from:DATE, to:DATE}, ['consulate_id', 'from', 'to']),
    ok({consulate:CONSULATE, from:DATE, to:DATE, as_of:DT, slots:list(OPEN_SLOT, 2000)})),
  tool('visaslot.book', 'Book an open slot. Give the slot time and the slot version from visaslot.slots. A slot taken since the search fails with slot_unavailable; a slot whose version changed fails with stale_version. Booking is free.',
    false, object({consulate_id:ID, slot_at:DT, slot_version:RECORD_VERSION, ...WRITE}),
    committed({appointment:APPOINTMENT_VIEW})),
  tool('visaslot.reschedule', 'Move a booked appointment to another open slot at the same consulate before the current slot starts. Give the appointment version and the new slot version you read; stale versions fail with stale_version. The old slot is released. A registered visa file stays on the appointment.',
    false, object({appointment_id:ID, appointment_version:RECORD_VERSION, slot_at:DT, slot_version:RECORD_VERSION, ...WRITE}),
    committed({appointment:APPOINTMENT_VIEW, released_slot:OPEN_SLOT})),
  tool('visaslot.cancel', 'Cancel a booked appointment before its slot starts. Give the appointment version you read; a stale version fails with stale_version. The slot is released.',
    false, object({appointment_id:ID, appointment_version:RECORD_VERSION, ...WRITE}),
    committed({appointment:APPOINTMENT_VIEW, released_slot:OPEN_SLOT})),
  tool('visaslot.appointments', 'List this applicant\'s appointments in slot order, with their status, version, history (every booking, reschedule, cancellation and hold with the slot held), visa file version and check result (read the file with visaslot.file.get); give id to read one (also returned as item). Reading changes nothing.',
    true, read({id:ID}), ok({items:list(APPOINTMENT_VIEW, 500), item:APPOINTMENT_VIEW}, ['item'])),
  tool('visaslot.checklist', 'Read the required-document checklist for a visa category, e.g. business. Each item says which VisaSlot rules check it at the appointment. Reading changes nothing.',
    true, read({category:{type:'string', pattern:'^[a-z][a-z0-9_]{0,59}$'}}, ['category']),
    ok({category:{type:'string'}, title:text(1, 120), items:list(CHECKLIST_ITEM, 40), rules:list({enum:RULES}, RULES.length)})),
  tool('visaslot.file.submit', 'Register the visa file on a booked appointment, replacing any earlier file, until the appointment starts. Give the invitation letter, travel signature, every accommodation stay and the travel dates, each with the source record you read it from. A letter or signature dated after today at the consulate is rejected. Returns the file and the items that would be missing if the appointment were held now.',
    false, object({appointment_id:ID, documents:DOCUMENTS, ...WRITE}),
    committed({appointment_id:ID, file:FILE, replaced_version:nullable(RECORD_VERSION), missing_if_held_now:MISSING_LIST})),
  tool('visaslot.file.get', 'Read the visa file registered on an appointment, its earlier versions, and the items that would be missing if the appointment were held now (null once it is held or cancelled; a held appointment shows its check). Reading changes nothing.',
    true, read({appointment_id:ID}, ['appointment_id']),
    ok({appointment_id:ID, appointment_status:STATUS, file:nullable(FILE), history:list(FILE_HISTORY, 200),
      missing_if_held_now:nullable(MISSING_LIST), check:nullable(CHECK)}))
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
  if (drift.length) throw new Error('Generated visaslot schema drift: ' + drift.join(', '));
}
module.exports = {build, RULES};
if (require.main === module) { build({check:process.argv.includes('--check')}); console.log('visaslot schemas and tools.json are current.'); }
