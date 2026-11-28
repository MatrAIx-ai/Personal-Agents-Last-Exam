'use strict';
// In-memory unit-test fixture, not a platform runtime or security boundary.
const plugin=require('../plugin.cjs');
function fixture({logging=true}={}){
 const logs=[];let callIndex=0;
 let data=structuredClone(require('../fixtures/minimal.json'));
 const ctx={app_id:require('../app.json').app_id,virtual_now:'2026-11-15T09:00:00-08:00',binding:structuredClone(require('../fixtures/binding.json'))};
 ctx.assets={add:({object_id,files})=>files.map((f,i)=>'test-'+object_id+'-'+i)};
 if(logging)ctx.log=(step,details={})=>logs.push({call_index:callIndex,step,details:structuredClone(details)});
 plugin.validateSeed(ctx,data);
 return {ctx,get logs(){return structuredClone(logs);},get data(){return structuredClone(data);},
  call(name,args={}){callIndex++;const out=plugin.handleTool(ctx,structuredClone(data),name,args);plugin.validateSeed(ctx,out.data);data=out.data;return structuredClone(out.result);},
  event(event){callIndex++;const out=plugin.applyEvent(ctx,structuredClone(data),structuredClone(event));plugin.validateSeed(ctx,out);data=out;return structuredClone(data);}
 };
}
module.exports={fixture};
