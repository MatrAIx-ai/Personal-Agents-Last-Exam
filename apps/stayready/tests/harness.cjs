'use strict';
// App-only business-function harness. It does not emulate Core permissions,
// persistence, epochs or transport deduplication; real MCP tests cover those.
const plugin=require('../plugin.cjs');
function fixture({data,now='2026-12-01T18:00:00Z',binding,logging=false}={}){
 let state=structuredClone(data||require('../fixtures/minimal.json')),calls=0;
 const initial=structuredClone(state),ctx={app_id:'stayready',role:'agent',run_id:'business-test',virtual_now:now,binding:structuredClone(binding||require('../fixtures/binding.json'))};
 const logs=[];if(logging)ctx.log=(step,details)=>logs.push({step,details});
 plugin.validateSeed(ctx,state);
 return {ctx,get data(){return structuredClone(state);},get logs(){return structuredClone(logs);},
 call(name,args={}){calls++;const tool=require('../tools.json').find(t=>t.name===name);const input=tool&&!tool.read_only?{request_id:'business-'+calls,expected_version:{epoch:1,revision:calls-1},...args}:args;const out=plugin.handleTool(ctx,structuredClone(state),name,input);plugin.validateSeed(ctx,out.data);state=out.data;return structuredClone(out.result);},
 event(event){const out=plugin.applyEvent({...ctx,role:'infra',virtual_now:event.at},structuredClone(state),structuredClone(event));plugin.validateSeed({...ctx,virtual_now:event.at},out);state=out;ctx.virtual_now=event.at;return structuredClone(state);},
 advance(time){if(Date.parse(time)<Date.parse(ctx.virtual_now))throw Error('Business harness cannot rewind time');ctx.virtual_now=time;},
 reset(){state=structuredClone(initial);ctx.virtual_now=now;}
 };
}
module.exports={fixture};
