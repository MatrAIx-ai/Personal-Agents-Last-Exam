'use strict';
// App-only transactional test double, NOT Core policy/version/persistence evidence.
const assert=require('node:assert/strict'),path=require('node:path');
const {compile}=require('./schema-validator.cjs'),plugin=require('../plugin.cjs');
const root=path.resolve(__dirname,'..'),schemas=path.join(root,'schemas');
const seedValid=compile(require('../schemas/seed.schema.json'),schemas),eventValid=compile(require('../schemas/events.schema.json'),schemas);
const tools=require('../tools.json'),inputs=new Map(tools.map(t=>[t.name,compile(t.inputSchema,root)])),outputs=new Map(tools.map(t=>[t.name,compile(t.outputSchema,root)]));
function fixture(variant='minimal'){
 let data=structuredClone(require('../fixtures/'+variant+'.json')),revision=0;
 const ctx={app_id:'meeting-poll',role:'agent',virtual_now:require('../fixtures/clock.json').initial_time,binding:structuredClone(require('../fixtures/binding.json'))};
 const validate=value=>{assert.ok(seedValid(value),'Seed schema');plugin.validateSeed(ctx,value);};validate(data);
 return {ctx,get data(){return structuredClone(data)},validate,
  call(n,args={}){const name=n.startsWith('meeting-poll.')?n:'meeting-poll.'+n,tool=tools.find(t=>t.name===name);assert.ok(tool);const full=tool.read_only?args:{expected_version:{epoch:1,revision},request_id:'local-'+revision,...args};assert.ok(inputs.get(name)(full),'Input schema '+name);const before=JSON.stringify(data),out=plugin.handleTool(ctx,structuredClone(data),name,full);validate(out.data);if(tool.read_only)assert.equal(JSON.stringify(out.data),before);const result={...out.result,status:tool.read_only?'ok':'committed',app_id:'meeting-poll',version:{epoch:1,revision}};assert.ok(outputs.get(name)(result),'Output schema '+name);data=out.data;revision++;return structuredClone(out.result);},
  event(e){assert.ok(eventValid(e),'Event schema');const old=ctx.virtual_now;try{const out=plugin.applyEvent(ctx,structuredClone(data),e);ctx.virtual_now=e.at;validate(out);data=out;}catch(error){ctx.virtual_now=old;throw error;}},
  at(time){ctx.virtual_now=time;}
 };
}
module.exports={fixture};
