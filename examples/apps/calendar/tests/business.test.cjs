'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./harness.cjs'),plugin=require('../plugin.cjs');
const args={title:'Local review',start:'2026-11-16T15:00:00-08:00',end:'2026-11-16T16:00:00-08:00',timezone:'America/Los_Angeles'};
test('free/busy identifies an occupied range and leaves records unchanged',()=>{const f=fixture(),before=f.data;assert.equal(f.call('calendar.freebusy',{start:'2026-11-16T10:30:00-08:00',end:'2026-11-16T11:30:00-08:00'}).busy.length,1);assert.deepEqual(f.data,before);});
test('conflicting reschedule is rejected without altering the event',()=>{const f=fixture(),before=f.data;assert.throws(()=>f.call('calendar.update',{id:'evt-review',patch:{start:'2026-11-16T13:30:00-08:00',end:'2026-11-16T14:30:00-08:00'}}),{code:'calendar_overlap'});assert.deepEqual(f.data,before);});
test('create, update, export and cancel a calendar event',()=>{const f=fixture(),id=f.call('calendar.create',args).id;f.call('calendar.update',{id,patch:{title:'Updated'}});assert.equal(f.call('calendar.get',{id}).event.sequence,1);assert.match(f.call('calendar.export_ics',{id}).text,/DTSTART:20261116T230000Z/);f.call('calendar.cancel',{id});assert.equal(f.call('calendar.list').events.some(e=>e.id===id),false);assert.ok(f.call('calendar.list',{include_cancelled:true}).events.some(e=>e.id===id));assert.throws(()=>f.call('calendar.update',{id,patch:{title:'Too late'}}),{code:'invalid_state'});});
test('invalid time range and timezone fail domain validation',()=>{const f=fixture(),before=f.data;assert.throws(()=>f.call('calendar.create',{...args,end:args.start}),{code:'invalid_event'});assert.throws(()=>f.call('calendar.create',{...args,timezone:'Not/A_Zone'}),{code:'invalid_event'});assert.deepEqual(f.data,before);});
test('adjacent events do not overlap',()=>{const f=fixture();const id=f.call('calendar.create',{...args,start:'2026-11-16T11:00:00-08:00',end:'2026-11-16T12:00:00-08:00'}).id;assert.ok(f.data.events.some(e=>e.id===id));});
test('upsert changes the matching event without creating a duplicate',()=>{const f=fixture(),event=structuredClone(require('../examples/scenario.json'));f.event(event);const n=f.data.events.length;event.payload.title='Changed by scenario';f.event(event);assert.equal(f.data.events.length,n);assert.equal(f.data.events.find(e=>e.id===event.payload.id).title,'Changed by scenario');});
test('event from another account and unknown organizer are rejected',()=>{const f=fixture(),event=structuredClone(require('../examples/scenario.json'));event.payload.account_id='other';assert.throws(()=>f.event(event),{code:'invalid_event'});const data=f.data;data.events[0].organizer_person_id='unknown';assert.throws(()=>plugin.validateSeed(f.ctx,data),{code:'invalid_event'});});
test('unknown events are rejected and messaging capability is empty',()=>{const f=fixture();assert.throws(()=>f.event({operation:'calendar.unknown'}),{code:'invalid_event'});const messaging=require('../contribution/contribution.json').messaging;assert.deepEqual(messaging.publishes,[]);assert.deepEqual(messaging.receives,[]);});

test('optional logging preserves Calendar results and state, including older contexts',()=>{
 const a=fixture(),b=fixture({logging:false}),ra=a.call('calendar.create',args),rb=b.call('calendar.create',args);
 assert.deepEqual(ra,rb);assert.deepEqual(a.data,b.data);
 assert.deepEqual(a.logs.map(x=>x.step),['calendar.create.started','calendar.create.conflict_checked','calendar.create.prepared']);
 assert.doesNotMatch(JSON.stringify(a.logs),/Local review|2026-11-16/);assert.deepEqual(b.logs,[]);
});
test('conflict diagnostics survive rejection and contain no prepared change',()=>{
 const f=fixture(),before=f.data;assert.throws(()=>f.call('calendar.update',{id:'evt-review',patch:{start:'2026-11-16T13:30:00-08:00',end:'2026-11-16T14:30:00-08:00'}}),{code:'calendar_overlap'});
 assert.deepEqual(f.data,before);assert.deepEqual(f.logs.map(x=>x.step),['calendar.update.started','calendar.record.found','calendar.update.conflict_checked']);assert.equal(f.logs.at(-1).details.conflict,true);
});
test('Calendar events report preparation; later validation can still reject the change',()=>{
 const f=fixture(),event=structuredClone(require('../examples/scenario.json'));f.event(event);
 assert.deepEqual(f.logs.map(x=>x.step),['calendar.event.started','calendar.upsert.matched','calendar.upsert.prepared']);
 const before=f.data;event.payload.account_id='wrong';assert.throws(()=>f.event(event),{code:'invalid_event'});assert.deepEqual(f.data,before);
 assert.equal(f.logs.at(-1).step,'calendar.upsert.prepared');assert.ok(f.logs.every(x=>!x.step.endsWith('.committed')));
});
test('unavailable logging never changes a Calendar result or domain error',()=>{
 const a=fixture(),b=fixture({logging:false});a.ctx.log=()=>{throw Error('Sink unavailable');};
 assert.deepEqual(a.call('calendar.list'),b.call('calendar.list'));assert.deepEqual(a.data,b.data);
 assert.throws(()=>a.call('calendar.update',{id:'missing',patch:{title:'X'}}),{code:'not_found'});
});

const {ical}=require('../src/formats/ical.cjs');
function importText(overrides={}){return ical({uid:'import@example.com',title:'Review, \u4e2d\u6587',start:'2026-11-20T09:00:00Z',end:'2026-11-20T10:00:00Z',location:'Room; A',sequence:0,status:'confirmed',...overrides},'2026-11-17T10:00:00Z');}
test('ICS imports, round trips escaped text and deduplicates by UID/sequence',()=>{const f=fixture(),text=importText(),id=f.call('calendar.import_ics',{text}).id,n=f.data.events.length;assert.equal(f.call('calendar.import_ics',{text}).id,id);assert.equal(f.data.events.length,n);const e=f.data.events.find(x=>x.id===id);assert.equal(e.title,'Review, \u4e2d\u6587');assert.equal(e.location,'Room; A');assert.match(f.call('calendar.export_ics',{id}).text,/DTSTAMP:20261115T170000Z/);});
test('ICS higher sequence updates, stale or equal conflicting versions reject',()=>{const f=fixture(),id=f.call('calendar.import_ics',{text:importText()}).id;f.call('calendar.import_ics',{text:importText({title:'Moved',sequence:1})});const before=f.data;assert.throws(()=>f.call('calendar.import_ics',{text:importText()}),{code:'stale_event'});assert.throws(()=>f.call('calendar.import_ics',{text:importText({title:'Other',sequence:1})}),{code:'sequence_conflict'});assert.deepEqual(f.data,before);assert.equal(f.data.events.find(e=>e.id===id).title,'Moved');});
test('ICS conflict, invalid date and unsupported recurrence reject without partial events',()=>{const f=fixture(),before=f.data;assert.throws(()=>f.call('calendar.import_ics',{text:importText({start:'2026-11-16T18:30:00Z',end:'2026-11-16T19:30:00Z'})}),{code:'calendar_overlap'});assert.throws(()=>f.call('calendar.import_ics',{text:importText().replace('20261120T090000Z','20260230T090000Z')}),{code:'invalid_ics'});assert.throws(()=>f.call('calendar.import_ics',{text:importText().replace('END:VEVENT','RRULE:FREQ=DAILY\r\nEND:VEVENT')}),{code:'unsupported_ics'});assert.deepEqual(f.data,before);});
test('Calendar attachment add/remove respect cancelled state',()=>{const f=fixture(),id=f.call('calendar.create',args).id;f.call('calendar.attachment.add',{id,files:[{filename:'agenda.pdf'}]});const asset=f.data.events.find(e=>e.id===id).attachments[0];f.call('calendar.attachment.remove',{id,asset_id:asset});assert.deepEqual(f.data.events.find(e=>e.id===id).attachments,[]);f.call('calendar.cancel',{id});assert.throws(()=>f.call('calendar.attachment.add',{id,files:[{}]}),{code:'invalid_state'});});
test('scenario cannot replace a newer event or change its UID',()=>{const f=fixture(),e=structuredClone(require('../examples/scenario.json'));e.payload.sequence=2;f.event(e);const before=f.data;e.payload.sequence=1;assert.throws(()=>f.event(e),{code:'stale_event'});assert.deepEqual(f.data,before);e.payload.sequence=3;e.payload.uid='another@example.com';assert.throws(()=>f.event(e),{code:'invalid_event'});});
test('ICS import logging remains optional and fail-safe',()=>{const f=fixture();f.ctx.log=()=>{throw Error('offline')};assert.ok(f.call('calendar.import_ics',{text:importText()}).id);});
