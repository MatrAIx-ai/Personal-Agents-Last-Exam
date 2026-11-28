'use strict';
const plugin=require('../plugin.cjs'),seed=require('../fixtures/minimal.json'),binding=require('../fixtures/binding.json');
function fixture({now='2026-11-18T09:00:00-08:00',logger=true}={}){
  let data=structuredClone(seed);const logs=[];const ctx={app_id:'brightpath-student-loans',run_id:'app-test',role:'agent',virtual_now:now,binding:structuredClone(binding),policy:{allow:[],constraints:{}},...(logger?{log:(step,details)=>logs.push({step,details})}:{})};
  return {ctx,logs,get data(){return data;},setTime(value){ctx.virtual_now=value;},read(name,args={}){return plugin.handleTool(ctx,structuredClone(data),name,structuredClone(args)).result;},commit(name,args={}){const out=plugin.handleTool(ctx,structuredClone(data),name,structuredClone(args));data=out.data;return out.result;},event(event){const next=plugin.applyEvent({...ctx,role:'infra',virtual_now:event.at},structuredClone(data),structuredClone(event));data=next;ctx.virtual_now=event.at;return data;},snapshot(){return structuredClone(data);}};
}
module.exports={fixture,plugin};
