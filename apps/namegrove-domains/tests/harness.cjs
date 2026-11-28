'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto');
const {compile}=require('./schema-validator.cjs'),plugin=require('../plugin.cjs'),tools=require('../tools.json');
const root=path.resolve(__dirname,'..'),schemaDir=path.join(root,'schemas'),seedValid=compile(require('../schemas/seed.schema.json'),schemaDir),eventValid=compile(require('../schemas/events.schema.json'),schemaDir);
const input=new Map(tools.map(t=>[t.name,compile(t.inputSchema,root)])),output=new Map(tools.map(t=>[t.name,compile(t.outputSchema,root)]));
function fixture({logging=true}={}){
 let data=structuredClone(require('../fixtures/minimal.json')),revision=0;const logs=[],receipts=new Map();
 const ctx={app_id:'namegrove-domains',role:'agent',virtual_now:require('../fixtures/clock.json').initial_time,binding:structuredClone(require('../fixtures/binding.json'))};if(logging)ctx.log=(step,details={})=>logs.push({step,details:structuredClone(details)});
 function validate(value){assert.ok(seedValid(value),'Seed schema');plugin.validateSeed(ctx,value);}validate(data);
 return {ctx,get data(){return structuredClone(data);},get logs(){return structuredClone(logs);},
  call(name,args={}){const tool=tools.find(t=>t.name===name);assert.ok(tool,'Known tool '+name);let full=structuredClone(args),providedFingerprint=crypto.createHash('sha256').update(JSON.stringify({name,args:full})).digest('hex');if(!tool.read_only){const requestId=full.request_id||`local-${revision+1}`,prior=receipts.get(requestId);if(prior){if(prior.fingerprint!==providedFingerprint)throw Object.assign(Error('request_id reused with different input'),{code:'request_conflict'});return structuredClone(prior.envelope);}full={...full,expected_version:full.expected_version||{epoch:1,revision},request_id:requestId};}
   assert.ok(input.get(name)(full),'Input schema: '+name);const before=JSON.stringify(data),out=plugin.handleTool(ctx,structuredClone(data),name,structuredClone(full));validate(out.data);if(tool.read_only)assert.equal(JSON.stringify(out.data),before,'Read changed state');else revision++;
   const envelope={...out.result,status:tool.read_only?'ok':'committed',app_id:'namegrove-domains',version:{epoch:1,revision}};assert.ok(output.get(name)(envelope),'Output schema: '+name);data=out.data;if(!tool.read_only)receipts.set(full.request_id,{fingerprint:providedFingerprint,envelope:structuredClone(envelope)});return structuredClone(envelope);},
  event(event){assert.ok(eventValid(event),'Event schema');const before=JSON.stringify(data),eventCtx={...ctx,role:'infra',virtual_now:event.at},out=plugin.applyEvent(eventCtx,structuredClone(data),structuredClone(event));ctx.virtual_now=event.at;validate(out);data=out;return {data:structuredClone(data),changed:JSON.stringify(data)!==before};}
 };
}
module.exports={fixture};
