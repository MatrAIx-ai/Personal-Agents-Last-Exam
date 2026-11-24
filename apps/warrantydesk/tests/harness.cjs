'use strict';
// Domain-only fixture, not a persistence layer or substitute Core.
const plugin=require('../plugin.cjs');
function fixture(seed){let data=structuredClone(seed||require('../fixtures/minimal.json')),seq=0;const ctx={app_id:'warrantydesk',virtual_now:require('../fixtures/clock.json').initial_time,binding:structuredClone(require('../fixtures/binding.json'))};plugin.validateSeed(ctx,data);return {ctx,get data(){return structuredClone(data);},call(name,args={}){const out=plugin.handleTool(ctx,structuredClone(data),'warrantydesk.'+name,{request_id:'business-'+(++seq),...args});plugin.validateSeed(ctx,out.data);data=out.data;return structuredClone(out.result.value);},event(operation,payload,at=ctx.virtual_now){const next={...ctx,virtual_now:at},out=plugin.applyEvent(next,structuredClone(data),{event_id:'business-event-'+(++seq),at,operation,payload});plugin.validateSeed(next,out);data=out;ctx.virtual_now=at;return structuredClone(data);},advance(at){if(Date.parse(at)<Date.parse(ctx.virtual_now))throw Error('Test clock cannot go backward');ctx.virtual_now=at;plugin.validateSeed(ctx,data);}};}
function accept(h){const q=h.call('remedy.preview',{case_id:'case-1',action:'accept'}).quote;return h.call('remedy.accept',{case_id:'case-1',quote_digest:q.digest}).item;}
function withdraw(h){const q=h.call('remedy.preview',{case_id:'case-1',action:'withdraw'}).quote;return h.call('remedy.withdraw',{case_id:'case-1',quote_digest:q.digest}).item;}
function dispatch(h,at=h.ctx.virtual_now){return h.event('replacement.dispatched',{case_id:'case-1',replacement_serial:'NEW-42',source_actor_id:'person-manufacturer'},at);}
function deliver(h,at=h.ctx.virtual_now){return h.event('replacement.delivered',{case_id:'case-1',replacement_serial:'NEW-42',source_actor_id:'person-courier'},at);}
function request(h,kind='independent_work_login',serial='NEW-42'){return h.call('verification.request',{case_id:'case-1',device_serial:serial,kind}).item;}
function reply(h,q,success=true,used=false){return h.event('verification.reply',{selector:q.selector,source_actor_id:q.source_actor_id,status:'performed',result:{success,used_old_device:used}});}
function pickup(h,slot='slot-26',serial='OLD-17'){return h.call('pickup.schedule',{case_id:'case-1',device_serial:serial,slot_id:slot}).item;}
function collect(h,p,at='2027-02-26T15:30:00-06:00'){return h.event('pickup.collected',{selector:p.selector,source_actor_id:'person-courier'},at);}
function receive(h,p,at='2027-03-01T09:00:00-06:00'){return h.event('return.received',{selector:p.selector,source_actor_id:'person-manufacturer'},at);}
function release(h,mode='original_return',serial='OLD-17',at=h.ctx.virtual_now){return h.event('hold.released',{case_id:'case-1',return_mode:mode,device_serial:serial,source_actor_id:'person-manufacturer'},at);}
module.exports={fixture,accept,withdraw,dispatch,deliver,request,reply,pickup,collect,receive,release};
