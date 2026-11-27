'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const {compile}=require('./schema-validator.cjs'),plugin=require('../plugin.cjs'),tools=require('../tools.json');
const root=path.resolve(__dirname,'..'),schemaDir=path.join(root,'schemas');
const seedValid=compile(require('../schemas/seed.schema.json'),schemaDir),eventValid=compile(require('../schemas/events.schema.json'),schemaDir);
const input=new Map(tools.map(t=>[t.name,compile(t.inputSchema,root)])),output=new Map(tools.map(t=>[t.name,compile(t.outputSchema,root)]));
function fixture({logging=true}={}){
 let data=structuredClone(require('../fixtures/minimal.json')),seq=0;const logs=[];
 const ctx={app_id:'fueltrail',role:'agent',virtual_now:require('../fixtures/clock.json').initial_time,binding:structuredClone(require('../fixtures/binding.json'))};
 if(logging)ctx.log=(step,details={})=>logs.push({step,details:structuredClone(details)});
 function validate(value){assert.ok(seedValid(value),'Seed schema');plugin.validateSeed(ctx,value);}
 validate(data);
 return {ctx,get data(){return structuredClone(data);},get logs(){return structuredClone(logs);},
  call(name,args={}){
   const tool=tools.find(t=>t.name===name);assert.ok(tool,'Known tool '+name);
   const full=tool.read_only?args:{...args,expected_version:{epoch:1,revision:seq},request_id:args.request_id||'local-'+(++seq)};
   assert.ok(input.get(name)(full),'Input schema: '+name);
   const before=JSON.stringify(data),out=plugin.handleTool(ctx,structuredClone(data),name,structuredClone(full));
   validate(out.data);if(tool.read_only)assert.equal(JSON.stringify(out.data),before,'Read changed state');
   const envelope={...out.result,status:tool.read_only?'ok':'committed',app_id:'fueltrail',version:{epoch:1,revision:seq}};
   assert.ok(output.get(name)(envelope),'Output schema: '+name);data=out.data;return structuredClone(envelope);
  },
  event(event){
   assert.ok(eventValid(event),'Event schema');const eventCtx={...ctx,role:'infra',virtual_now:event.at};
   const out=plugin.applyEvent(eventCtx,structuredClone(data),structuredClone(event));ctx.virtual_now=event.at;validate(out);data=out;return structuredClone(data);
  }
 };
}
module.exports={fixture};
