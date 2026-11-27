#!/usr/bin/env node
'use strict';
// Single source for the generated notify schemas and tools.json.
// Run `node build/schemas.cjs` after editing; `--check` fails on drift.
// The generated files are self-contained (no $ref), like the other personal Apps.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

const ID = {type:'string', pattern:'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$'};
const LONG_ID = {type:'string', pattern:'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,149}$'};
// Calendar owns its account and event IDs: any nonempty string up to 100 characters (Calendar seed schema).
// Notify keeps them exactly as calendar.get returns them; ID stays the rule for Notify-owned IDs.
const CALENDAR_ID = {type:'string', minLength:1, maxLength:100};
const DT = {type:'string', format:'date-time'};
const NULLABLE_DT = {anyOf:[DT, {type:'null'}]};
const text = (min, max) => ({type:'string', minLength:min, maxLength:max});
const object = (properties, required = Object.keys(properties)) => ({type:'object', properties, required, additionalProperties:false});
const VERSION = object({epoch:{type:'integer', minimum:1}, revision:{type:'integer', minimum:0}});
const HISTORY = {type:'array', items:object({at:DT, action:text(1, 80)}), maxItems:1000};
const CLOCK = {type:'string', pattern:'^([01][0-9]|2[0-3]):[0-5][0-9]$', description:'Local wall-clock time HH:MM in the device time zone.'};
const DAYS = {type:'array', items:{enum:['mon','tue','wed','thu','fri','sat','sun']}, minItems:1, maxItems:7, uniqueItems:true,
  description:'Days on which the window starts. A window whose end is not after its start runs past midnight into the next day.'};
const FOCUS_WINDOW = object({id:ID, label:text(1, 80), days:DAYS, start:CLOCK, end:CLOCK});
const FOCUS_LIST = {type:'array', items:FOCUS_WINDOW, maxItems:20};
const DEEP_LINK = {anyOf:[{type:'string', minLength:1, maxLength:512, pattern:'^[A-Za-z][A-Za-z0-9+.-]*:[^\\s]+$'}, {type:'null'}]};
const CALENDAR_REF = object({app_id:{const:'calendar'}, account_id:CALENDAR_ID, event_id:CALENDAR_ID},['app_id','account_id','event_id']);
const ANCHOR = {anyOf:[object({
  calendar_event_ref:CALENDAR_REF,
  event_start:{...DT, description:'Event start as read with calendar.get when the reminder was set. Notify does not read Calendar itself.'},
  minutes_before:{type:'integer', minimum:0, maximum:10080}
}), {type:'null'}]};

const REMINDER_STATUS = {enum:['scheduled','delivered','silenced','cancelled']};
const REMINDER = object({
  id:ID, account_id:ID, created_at:DT, updated_at:DT, history:HISTORY,
  title:text(1, 200), body:text(0, 1000), fire_at:DT, anchor:ANCHOR, actionable:{type:'boolean'},
  status:REMINDER_STATUS, fired_at:NULLABLE_DT, feed_item_id:{anyOf:[ID, {type:'null'}]}
});
const SOURCE_OBJECT = object({app_id:LONG_ID, account_id:LONG_ID, object_type:text(1, 80), object_id:LONG_ID},
  ['app_id','object_type','object_id','account_id']);
const FEED_SOURCE = {anyOf:[
  object({kind:{const:'reminder'}, reminder_id:ID}),
  object({kind:{const:'push'}, app_id:LONG_ID, account_id:LONG_ID, object_type:text(1, 80), object_id:LONG_ID, message_id:text(1, 150)})
]};
const FEED_ITEM = object({
  id:ID, account_id:ID, created_at:DT, updated_at:DT, history:HISTORY,
  source:FEED_SOURCE, title:text(1, 200), body:text(0, 2000), actionable:{type:'boolean'}, deep_link:DEEP_LINK,
  sent_at:NULLABLE_DT, arrived_at:DT, delivery:{enum:['delivered','silenced']}, read_at:NULLABLE_DT, dismissed_at:NULLABLE_DT
});
const DEVICE = object({
  timezone:{...text(1, 64), description:'IANA time zone used to evaluate focus windows, for example America/Chicago.'},
  focus:FOCUS_LIST, silence_until:NULLABLE_DT, updated_at:DT, history:HISTORY
});
const SEED = {$schema:'https://json-schema.org/draft/2020-12/schema', $id:'urn:pale:notify:seed:1', ...object({
  account_id:ID, owner_person_id:ID, device:DEVICE,
  reminders:{type:'array', items:REMINDER, maxItems:1000},
  feed:{type:'array', items:FEED_ITEM, maxItems:2000}
})};

const PUSH_PAYLOAD = {$schema:'https://json-schema.org/draft/2020-12/schema', $id:'urn:pale:push-payload:1',
  title:'Notify-owned phone push payload', ...object({
    channel:{const:'channel.push'},
    recipient:object({kind:{const:'app_account_ref'}, app_id:{const:'notify'}, id:ID}),
    source_object:SOURCE_OBJECT,
    content:object({title:text(1, 200), body:text(0, 2000), actionable:{type:'boolean'}, deep_link:DEEP_LINK}),
    extensions:{type:'array', items:object({namespace:{type:'string', pattern:'^[a-z][a-z0-9_-]*(\\.[a-z][a-z0-9_-]*)+$'},
      version:{type:'string', minLength:1}, required:{type:'boolean'}, data:{type:'object'}}), maxItems:0}
  })};

function wire(envelope) {
  const {$id, ...payload} = PUSH_PAYLOAD;
  delete payload.$schema;
  return {...envelope, $id:'urn:pale:push-message:1', title:'CloudEvents with Notify push payload v1',
    properties:{...envelope.properties, type:{const:'org.pale.notify.push.v1'}, dataschema:{const:$id}, data:{$id, ...payload}}};
}

const event = (operation, payload) => object({event_id:ID, at:DT, operation:{const:operation}, payload});
function events(message) {
  return {$schema:'https://json-schema.org/draft/2020-12/schema', $id:'urn:pale:notify:events:1', oneOf:[
    event('notify.reminder.fire', object({reminder_id:ID})),
    event('notify.receive', object({recipient_account_id:ID, message})),
    event('notify.focus.set', object({focus:FOCUS_LIST})),
    event('notify.device.silence', object({until:NULLABLE_DT})),
    event('notify.feed.dismiss', object({feed_item_id:ID}))
  ]};
}

const WRITE = {expected_version:VERSION, request_id:ID};
// Calendar anchor as flat optional inputs: give all four or none.
const ANCHOR_INPUT = {
  calendar_account_id:{...CALENDAR_ID, description:'Calendar account of the event, exactly as calendar.get returns it.'},
  calendar_event_id:{...CALENDAR_ID, description:'Calendar event ID to anchor to, exactly as calendar.get returns it.'},
  event_start:{...DT, description:'The event start as read with calendar.get. Notify does not read Calendar itself.'},
  minutes_before:{type:'integer', minimum:0, maximum:10080}
};
const read = (properties, required = []) => object(properties, required);
const ok = extra => object({status:{const:'ok'}, app_id:{const:'notify'}, version:VERSION, ...extra});
const committed = extra => object({status:{const:'committed'}, app_id:{const:'notify'}, version:VERSION, id:ID, ...extra});
const PATCH = object({title:text(1, 200), body:text(0, 1000), fire_at:DT, actionable:{type:'boolean'}, ...ANCHOR_INPUT}, []);
const tool = (name, description, readOnly, inputSchema, outputSchema) => ({name, description, read_only:readOnly,
  scope:name, resource_target:'current account', inputSchema, outputSchema});
const TOOLS = [
  tool('notify.reminder.create',
    'Schedule a reminder on the user\'s phone. Give either fire_at, or all of calendar_account_id, calendar_event_id, event_start (read with calendar.get) and minutes_before to fire that long before a Calendar event. The time must be in the future. The reminder reaches the phone only when Infra delivers it at that time.',
    false, object({title:text(1, 200), body:text(0, 1000), fire_at:DT, ...ANCHOR_INPUT, actionable:{type:'boolean'}, ...WRITE},
      ['title','expected_version','request_id']),
    committed({fire_at:DT})),
  tool('notify.reminder.list', 'List reminders, optionally by status and by fire time in [from, to). Reading changes nothing.',
    true, read({from:DT, to:DT, status:REMINDER_STATUS}), ok({items:{type:'array', items:REMINDER, maxItems:1000}})),
  tool('notify.reminder.get', 'Read one reminder, including its status and delivery time.',
    true, read({id:ID}, ['id']), ok({item:REMINDER})),
  tool('notify.reminder.update', 'Change a reminder that has not fired yet. A new fire_at detaches it from its Calendar event; the four calendar fields together re-anchor it. Delivered, silenced and cancelled reminders cannot be changed.',
    false, object({id:ID, patch:PATCH, ...WRITE}), committed({fire_at:DT})),
  tool('notify.reminder.cancel', 'Cancel a reminder that has not fired yet.',
    false, object({id:ID, ...WRITE}), committed({})),
  tool('notify.feed.list', 'List notifications that reached the phone, newest first. Dismissed items are hidden unless requested. Reading does not mark items read.',
    true, read({since:DT, unread_only:{type:'boolean'}, include_dismissed:{type:'boolean'}}),
    ok({items:{type:'array', items:FEED_ITEM, maxItems:2000}})),
  tool('notify.feed.mark_read', 'Mark one notification read.',
    false, object({id:ID, ...WRITE}), committed({})),
  tool('notify.focus.get', 'Read the device focus schedule and silence state, and whether the phone is quiet right now. Only the user changes these.',
    true, read({}), ok({device:DEVICE, quiet_now:{type:'boolean'}, quiet_reason:{enum:['none','focus','silence']},
      focus_id:{anyOf:[ID, {type:'null'}]}}))
];

function outputs() {
  const envelopeFile = path.resolve(root, '../../runtime/contracts/schemas/cloudevent.schema.json');
  const files = {
    'schemas/seed.schema.json':SEED,
    'schemas/push-payload.schema.json':PUSH_PAYLOAD,
    'tools.json':TOOLS
  };
  let message;
  if (fs.existsSync(envelopeFile)) {
    message = wire(JSON.parse(fs.readFileSync(envelopeFile, 'utf8')));
    files['schemas/router-message.schema.json'] = message;
  } else {
    message = JSON.parse(fs.readFileSync(path.join(root, 'schemas/router-message.schema.json'), 'utf8'));
  }
  const {$schema, ...inline} = message;
  files['schemas/events.schema.json'] = events(inline);
  return files;
}

function build({check = false} = {}) {
  const drift = [];
  for (const [ref, value] of Object.entries(outputs())) {
    const file = path.join(root, ref), expected = JSON.stringify(value, null, 2) + '\n';
    if (check) { if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== expected) drift.push(ref); }
    else fs.writeFileSync(file, expected);
  }
  if (drift.length) throw new Error('Generated notify schema drift: ' + drift.join(', '));
}
module.exports = {build};
if (require.main === module) { build({check:process.argv.includes('--check')}); console.log('notify schemas and tools.json are current.'); }
