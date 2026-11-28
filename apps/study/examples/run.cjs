'use strict';
// Standalone deterministic business illustration; tests/core.cjs exercises real Core.
const {handleTool,validateSeed}=require('../plugin.cjs');
const s=structuredClone(require('../fixtures/minimal.json'));
const ctx={virtual_now:'2027-01-08T00:00:00+08:00'};
validateSeed(ctx,s);
const q=handleTool(ctx,s,'study.get_queue',{}).result;
console.log(JSON.stringify({example:'business-only read',day:q.day,cards:q.cards.map(c=>c.id),incoming_events:'deferred'},null,2));
