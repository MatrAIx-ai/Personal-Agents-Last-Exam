'use strict';
const a=require('node:assert/strict'),p=require('../plugin.cjs'),d=structuredClone(require('../fixtures/minimal.json')),binding=require('../fixtures/binding.json');
a.throws(()=>p.handleTool({binding,virtual_now:'2026-01-10T10:00:01Z'},d,'refund-only-returns.confirm_request',{refund_request_id:'request-1'}),{code:'return_expired'});
a.equal(d.requests[0].status,'draft');
console.log('PASS: expired confirmation does not submit the draft.');
