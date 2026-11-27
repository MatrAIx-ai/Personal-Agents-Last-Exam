'use strict';
const assert=require('node:assert/strict'),{handleTool}=require('../src/operations.cjs'),m=require('../src/model.cjs');
let data=structuredClone(require('../fixtures/minimal.json'));const ctx={virtual_now:'2026-11-24T09:00:00-08:00',binding:require('../fixtures/binding.json')};
function call(name,args){const out=handleTool(ctx,data,'tablewise.'+name,args);data=out.data;return out.result;}
const h=call('holds.create',{slot_id:'slot-1-28-19',party_size:2,grant_id:'grant-1'}).hold,p=call('reservations.preview',{hold_id:h.id,grant_id:'grant-1'}).preview,r=call('reservations.confirm',{preview_id:p.id}).reservation;
assert.equal(r.snapshot.cost.total_cents,52000);assert.equal(r.deposit_paid_cents,10000);m.validateSeed(ctx,data);console.log(JSON.stringify({passed:true,reservation:r.id,estimate_cents:52000,deposit_cents:10000}));
