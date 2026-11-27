'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const root=process.env.PALE_RUNTIME_ROOT||path.resolve(__dirname,'../../../runtime'),{prepare}=require(path.join(root,'prepare.cjs'));
function setup(t){const p=prepare(path.resolve(__dirname,'..'));t.after(()=>p.cleanup());let state=p.model.create('tablewise','test','sandbox');let n=0;return {get state(){return state;},call(role,name,a={}){const out=p.model.execute(state,role,name,a);state=out.state;return out.result;},write(name,a={},request){return this.call('agent','tablewise.'+name,{...a,request_id:request||'test-'+ ++n,expected_version:{epoch:state.epoch,revision:state.revision}});},event(operation,payload,event_id='event-'+ ++n){return this.call('infra','env.apply_event',{expected_version:{epoch:state.epoch,revision:state.revision},event:{event_id,at:state.virtual_now,operation:'dining.'+operation,payload}});},clock(to){return this.call('infra','env.advance_time',{expected_version:{epoch:state.epoch,revision:state.revision},virtual_now:to,request_id:'clock-'+ ++n});}};}
function committed(r){assert.equal(r.status,'committed',JSON.stringify(r));return r;}
function preview(f,slot='slot-1-28-19',party=2){const hold=committed(f.write('holds.create',{slot_id:slot,party_size:party,grant_id:'grant-1'})).hold;return committed(f.write('reservations.preview',{hold_id:hold.id,grant_id:'grant-1'})).preview;}
function book(f,slot,party){return committed(f.write('reservations.confirm',{preview_id:preview(f,slot,party).id}));}

module.exports={setup,committed,preview,book};
