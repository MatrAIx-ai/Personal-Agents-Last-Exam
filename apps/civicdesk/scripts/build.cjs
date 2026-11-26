'use strict';
// Renders the generated contract files from scripts/contracts.cjs. Run after editing contracts:
//   node apps/civicdesk/scripts/build.cjs            (write)
//   node apps/civicdesk/scripts/build.cjs --check    (fail on drift; used by the business tests)
const fs = require('node:fs'), path = require('node:path');
const c = require('./contracts.cjs');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
const render = value => JSON.stringify(value, null, 2) + '\n';
const ID = {type:'string'};
const stateSchema = {
  $schema:'https://json-schema.org/draft/2020-12/schema',
  type:'object',
  properties:{
    schema:{const:'pale.app-state.v1'}, schema_version:{const:1}, package_version:{const:manifest.version}, core_api_version:{const:manifest.core_api_version},
    app_id:{const:c.APP}, run_id:{type:'string', pattern:'^[-a-zA-Z0-9_]{1,80}$'}, epoch:{type:'integer', minimum:1}, revision:{type:'integer', minimum:0},
    profile:{type:'string'}, next_id:{type:'integer', minimum:1}, virtual_now:{type:'string', format:'date-time'},
    binding:{type:'object', properties:{
      people:{type:'array', items:{type:'object', properties:{person_id:ID, name:ID}, required:['person_id'], additionalProperties:false}},
      accounts:{type:'array', items:{type:'object', properties:{app_id:ID, account_id:ID, owner_person_id:ID}, required:['app_id', 'account_id', 'owner_person_id'], additionalProperties:false}},
      objects:{type:'object', additionalProperties:{type:'array', items:ID}}
    }, required:['people', 'accounts', 'objects'], additionalProperties:false},
    policies:{type:'object', additionalProperties:{type:'object', properties:{
      allow:{type:'array', items:ID, uniqueItems:true},
      constraints:{type:'object', additionalProperties:{type:'object', properties:{ids:{type:'array', items:ID}, fields:{type:'array', items:ID}}, required:[], additionalProperties:false}}
    }, required:['allow', 'constraints'], additionalProperties:false}},
    initial_data:{$ref:'seed.schema.json'}, data:{$ref:'seed.schema.json'}, receipts:{type:'object'}, audit:{type:'array', items:{type:'object'}},
    resources:{$ref:'resources.schema.json'}, initial_resources:{$ref:'resources.schema.json'}, initial_virtual_now:{type:'string', format:'date-time'}
  },
  required:['schema', 'schema_version', 'package_version', 'core_api_version', 'app_id', 'run_id', 'epoch', 'revision', 'profile', 'next_id', 'virtual_now',
    'binding', 'policies', 'initial_data', 'data', 'receipts', 'audit', 'resources', 'initial_resources'],
  additionalProperties:false
};
const outputs = {
  'schemas/seed.schema.json':render(c.SEED),
  'schemas/events.schema.json':render(c.EVENT_SCHEMA),
  'schemas/state.schema.json':render(stateSchema),
  'tools.json':render(c.TOOLS.map(c.toolEntry)),
  'fixtures/policies.json':render(c.POLICIES),
  'app.json':render({...manifest, event_types:c.EVENTS.map(([name]) => name)})
};
function build({check=false}={}) {
  const drift = [];
  for (const [rel, text] of Object.entries(outputs)) {
    const file = path.join(root, rel);
    if (check) {if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) drift.push(rel);}
    else fs.writeFileSync(file, text);
  }
  if (drift.length) throw new Error('Generated contract files are out of date: ' + drift.join(', ') + '. Run node apps/civicdesk/scripts/build.cjs');
  return Object.keys(outputs);
}
module.exports = {build};
if (require.main === module) {
  const files = build({check:process.argv.includes('--check')});
  console.log((process.argv.includes('--check') ? 'Contracts match: ' : 'Wrote: ') + files.join(', '));
}
