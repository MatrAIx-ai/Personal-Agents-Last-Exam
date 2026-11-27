'use strict';
const assert=require('node:assert/strict'),{fixture}=require('../tests/harness.cjs');
const h=fixture();h.event(require('./scenario.json'));h.call('finalize',{id:'poll-team',slot_id:'slot-1'});
assert.equal(h.call('get',{id:'poll-team'}).item.effective_status,'finalized');
h.call('reopen',{id:'poll-team',deadline:'2026-11-21T17:00:00Z',reason:'Agenda changed'});
h.call('cancel',{id:'poll-team',reason:'Meeting postponed'});
assert.ok(h.data.polls[0].meetings.every(m=>m.status!=='active'));
console.log('Reference workflow: scenario reply change → confirmation → reopen → cancellation passed.');
