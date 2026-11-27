#!/usr/bin/env node
'use strict';
// Single source for the generated waypoint schemas and tools.json.
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
const POINTS = {type:'integer', minimum:1, maximum:10000000};
const BALANCE = {type:'integer', minimum:0, maximum:100000000};

// Shared loyalty-credit contract: identical in waypoint, skyline and harbor.
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

const LEDGER_KIND = {enum:['opening','earn','transfer_out','combine_out','combine_in','refund','adjustment']};
const LEDGER_REF = nullable(object({kind:{enum:['transfer','combine','message']}, id:LOYALTY_ID,
  app_id:LOYALTY_ID, account_id:LOYALTY_ID, message_id:nullable(text(1, 150)), sent_at:NULLABLE_DT},
  ['kind','id']));
const LEDGER_ENTRY = object({id:ID, at:DT, kind:LEDGER_KIND, points:{type:'integer', minimum:-10000000, maximum:100000000},
  balance_after:BALANCE, description:text(0, 200), ref:LEDGER_REF});
const RATIO = object({from:{type:'integer', minimum:1, maximum:1000}, to:{type:'integer', minimum:1, maximum:1000}});
const PARTNER = object({
  id:ID, name:text(1, 80), app_id:{enum:['skyline','harbor']},
  recipient_account_id:{...ID, description:'The member\'s own account in the partner App; credits are routed only there.'},
  member_number:nullable(text(1, 40)),
  ratio:RATIO,
  increment:{type:'integer', minimum:1, maximum:100000}, minimum:{type:'integer', minimum:1, maximum:1000000},
  delay_minutes:{type:'integer', minimum:0, maximum:20160, description:'0 for an instant transfer; otherwise the credit is released this long after the transfer.'}
});
const HOUSEHOLD_MEMBER = object({person_id:ID, name:text(1, 120), waypoint_account_id:ID});
const BONUS = object({id:ID, partner_id:ID, percent:{type:'integer', minimum:1, maximum:200}, starts_at:DT, ends_at:DT,
  created_at:DT, updated_at:DT, history:HISTORY});
const TRANSFER_STATUS = {enum:['pending','completed','rejected']};
const TRANSFER = object({
  id:ID, kind:{enum:['partner_transfer','household_combine']},
  partner_id:nullable(ID), to_person_id:nullable(ID),
  recipient:object({app_id:{enum:['waypoint','skyline','harbor']}, account_id:ID}),
  member_number:nullable(text(1, 40)),
  ratio:{...RATIO, description:'The partner ratio when the transfer was made.'},
  base_points:POINTS, bonus_pct:{type:'integer', minimum:0, maximum:200}, points:POINTS,
  status:TRANSFER_STATUS, available_at:DT, debit_ledger_id:ID, refund_ledger_id:nullable(ID),
  receipt:nullable(object({event_id:LOYALTY_ID, target_app_id:LOYALTY_ID, target_account_id:LOYALTY_ID})),
  rejection:nullable(object({code:text(1, 80), reason:text(0, 300)})),
  settled_at:NULLABLE_DT, created_at:DT, updated_at:DT, history:HISTORY
});
const SEED = {$schema:'https://json-schema.org/draft/2020-12/schema', $id:'urn:pale:waypoint:seed:1', ...object({
  account_id:ID, owner_person_id:ID, member_name:text(1, 120),
  household:{type:'array', items:HOUSEHOLD_MEMBER, maxItems:8, description:'Other members of the household who may combine points with this member.'},
  balance:BALANCE, ledger:{type:'array', items:LEDGER_ENTRY, maxItems:5000},
  partners:{type:'array', items:PARTNER, maxItems:40},
  bonuses:{type:'array', items:BONUS, maxItems:200},
  transfers:{type:'array', items:TRANSFER, maxItems:2000}
})};

const event = (operation, payload) => object({event_id:ID, at:DT, operation:{const:operation}, payload});
function events(message) {
  return {$schema:'https://json-schema.org/draft/2020-12/schema', $id:'urn:pale:waypoint:events:1', oneOf:[
    event('waypoint.receive', object({recipient_account_id:ID, message})),
    event('waypoint.transfer.settle', object({transfer_id:ID, outcome:{enum:['credited','rejected']},
      receipt:object({event_id:LOYALTY_ID, target_app_id:LOYALTY_ID, target_account_id:LOYALTY_ID}),
      rejection:object({code:text(1, 80), reason:text(0, 300)})}, ['transfer_id','outcome'])),
    event('waypoint.bonus.start', object({bonus:object({id:ID, partner_id:ID, percent:{type:'integer', minimum:1, maximum:200}, starts_at:DT, ends_at:DT})})),
    event('waypoint.bonus.end', object({bonus_id:ID}))
  ]};
}

const WRITE = {expected_version:VERSION, request_id:ID};
const read = (properties, required = []) => object(properties, required);
const ok = extra => object({status:{const:'ok'}, app_id:{const:'waypoint'}, version:VERSION, ...extra});
const committed = extra => object({status:{const:'committed'}, app_id:{const:'waypoint'}, version:VERSION, id:ID, ...extra});
const tool = (name, description, readOnly, inputSchema, outputSchema) => ({name, description, read_only:readOnly,
  scope:name, resource_target:'current account', inputSchema, outputSchema});
const PARTNER_VIEW = object({...PARTNER.properties, bonus_pct_now:{type:'integer', minimum:0, maximum:200}, active_bonus_id:nullable(ID)});
const BONUS_VIEW = object({...BONUS.properties, state:{enum:['upcoming','active','ended']}});
const TRANSFER_RESULT = {transfer_status:TRANSFER_STATUS, points:POINTS, bonus_pct:{type:'integer', minimum:0, maximum:200}, available_at:DT};
const TOOLS = [
  tool('waypoint.balance', 'Read this member\'s points balance, the points held in pending transfers, the household members and the full points ledger.',
    true, read({}), ok({member_person_id:ID, balance:BALANCE, pending_points:{type:'integer', minimum:0},
      household:{type:'array', items:HOUSEHOLD_MEMBER}, ledger:{type:'array', items:LEDGER_ENTRY}})),
  tool('waypoint.partners', 'List transfer partners: ratio, increment, minimum, whether the transfer is instant or delayed, the member\'s partner account, and any bonus active right now.',
    true, read({}), ok({items:{type:'array', items:PARTNER_VIEW}})),
  tool('waypoint.bonuses', 'List transfer bonuses with their windows and whether each is upcoming, active or ended now. A bonus applies when the transfer is made inside its window.',
    true, read({}), ok({items:{type:'array', items:BONUS_VIEW}})),
  tool('waypoint.transfer', 'Transfer points to this member\'s own account in a partner program. Points must be a multiple of the partner increment and at least its minimum. Irreversible: there is no cancel. Points leave the balance now; the partner is credited when the transfer is delivered (instantly, or after the partner\'s delay).',
    false, object({partner_id:ID, points:POINTS, ...WRITE}), committed(TRANSFER_RESULT)),
  tool('waypoint.combine', 'Send points from this member to another household member\'s Waypoint account. Only the sending member can combine; there is no way to pull points from someone else. Irreversible.',
    false, object({to_person_id:ID, points:POINTS, ...WRITE}), committed(TRANSFER_RESULT)),
  tool('waypoint.transfers.list', 'List partner transfers and household combines, newest first, optionally by status or kind.',
    true, read({status:TRANSFER_STATUS, kind:{enum:['partner_transfer','household_combine']}}), ok({items:{type:'array', items:TRANSFER}})),
  tool('waypoint.transfers.get', 'Read one transfer or combine, including its delivery receipt or rejection.',
    true, read({id:ID}, ['id']), ok({item:TRANSFER})),
  tool('waypoint.transfer.outbound', 'Build the stable loyalty-credit message for a transfer that is due for delivery. Reading changes nothing; delivery happens only when the host publishes it through Messaging and records the outcome.',
    true, read({id:ID}, ['id']), ok({message:{type:'object'}}))
];

function outputs() {
  const envelopeFile = path.resolve(root, '../../runtime/contracts/schemas/cloudevent.schema.json');
  const files = {
    'schemas/seed.schema.json':SEED,
    'schemas/loyalty-credit-payload.schema.json':LOYALTY_PAYLOAD,
    'tools.json':TOOLS
  };
  let message;
  if (fs.existsSync(envelopeFile)) {
    message = wire(JSON.parse(fs.readFileSync(envelopeFile, 'utf8')));
    files['schemas/loyalty-credit-message.schema.json'] = message;
  } else {
    message = JSON.parse(fs.readFileSync(path.join(root, 'schemas/loyalty-credit-message.schema.json'), 'utf8'));
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
  if (drift.length) throw new Error('Generated waypoint schema drift: ' + drift.join(', '));
}
module.exports = {build};
if (require.main === module) { build({check:process.argv.includes('--check')}); console.log('waypoint schemas and tools.json are current.'); }
