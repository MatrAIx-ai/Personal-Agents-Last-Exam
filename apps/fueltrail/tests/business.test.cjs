'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./harness.cjs'),plugin=require('../plugin.cjs');
function unchanged(f,fn,pattern){const before=f.data;assert.throws(fn,pattern);assert.deepEqual(f.data,before);}
const event=(id,at,operation,payload)=>({event_id:id,at,operation,payload});
test('fixture has approved scale, valid references and deterministic station search',()=>{
 const f=fixture(),data=f.data;assert.equal(data.stations.length,30);assert.equal(data.price_observations.length,120);assert.equal(data.vehicles.length,3);assert.equal(data.price_alerts.length,8);assert.equal(data.fuel_logs.length,24);
 const first=f.call('fueltrail.station.search',{place_id:'place-harbor',grade:'regular',price_type:'credit',radius_milli:10000,open_only:true,sort:'price'});
 const second=f.call('fueltrail.station.search',{place_id:'place-harbor',grade:'regular',price_type:'credit',radius_milli:10000,open_only:true,sort:'price'});
 assert.deepEqual(first,second);assert.ok(first.results.length);assert.ok(first.results.every(x=>x.distance_milli<=10000&&x.status==='open'));assert.ok(first.results.some(x=>x.price_status==='missing'||x.price_status==='stale'));
 unchanged(f,()=>f.call('fueltrail.station.search',{place_id:'missing',grade:'regular'}),/Place/);
 unchanged(f,()=>f.call('fueltrail.station.search',{place_id:'place-harbor',vehicle_id:'vehicle-river',grade:'diesel'}),/compatible/);
});
test('below-price alerts notify only on a fresh false-to-true transition and rearm after clearing',()=>{
 const f=fixture(),created=f.call('fueltrail.price_alert.create',{area_id:'place-harbor',radius_milli:10000,grade:'regular',price_type:'credit',condition:'below_price',threshold_mills:3200});
 assert.equal(created.alert.condition_met,false);const count=()=>f.data.notifications.filter(x=>x.alert_id===created.id).length;
 f.event(event('low-1','2026-11-23T09:00:00-08:00','fuel.price_observed',{station_id:'station-01',grade:'regular',price_type:'credit',price_mills:3190,reason:'threshold test'}));
 assert.equal(count(),1);const first=f.data.notifications.find(x=>x.alert_id===created.id);
 f.event(event('low-1','2026-11-23T09:00:00-08:00','fuel.price_observed',{station_id:'station-01',grade:'regular',price_type:'credit',price_mills:3190,reason:'threshold test'}));
 assert.equal(count(),1,'replayed event duplicated notification');
 f.event(event('high-1','2026-11-23T10:00:00-08:00','fuel.price_observed',{station_id:'station-01',grade:'regular',price_type:'credit',price_mills:3500,reason:'condition cleared'}));
 f.event(event('low-2','2026-11-23T11:00:00-08:00','fuel.price_observed',{station_id:'station-01',grade:'regular',price_type:'credit',price_mills:3180,reason:'condition met again'}));
 assert.equal(count(),2);assert.notEqual(f.data.notifications.filter(x=>x.alert_id===created.id).at(-1).id,first.id);
});
test('create and resume arm an already-met alert without immediate notification',()=>{
 const f=fixture(),before=f.data.notifications.length;
 const made=f.call('fueltrail.price_alert.create',{area_id:'place-harbor',radius_milli:10000,grade:'regular',price_type:'credit',condition:'below_price',threshold_mills:5000});
 assert.equal(made.alert.condition_met,true);assert.equal(f.data.notifications.length,before);
 let a=f.call('fueltrail.price_alert.pause',{id:made.id,alert_version:made.alert.version}).alert;assert.equal(a.condition_met,false);
 a=f.call('fueltrail.price_alert.resume',{id:made.id,alert_version:a.version}).alert;assert.equal(a.condition_met,true);assert.equal(f.data.notifications.length,before);
});
test('price-rise baseline is the previous fresh observation; closed and stale stations do not trigger',()=>{
 const f=fixture(),made=f.call('fueltrail.price_alert.create',{area_id:'place-harbor',radius_milli:1000,grade:'regular',price_type:'cash',condition:'price_rise',threshold_mills:100});
 f.event(event('rise-1','2026-11-23T09:00:00-08:00','fuel.price_observed',{station_id:'station-01',grade:'regular',price_type:'cash',price_mills:3300,reason:'fresh rise'}));
 const rise=f.data.notifications.find(x=>x.alert_id===made.id);assert.ok(rise);assert.equal(rise.prior_price_mills,3100);
 const g=fixture(),baseline=g.data.notifications.length;
 g.call('fueltrail.price_alert.create',{area_id:'place-harbor',radius_milli:1000,grade:'regular',price_type:'credit',condition:'below_price',threshold_mills:3000});
 g.event(event('close-1','2026-11-23T08:30:00-08:00','fuel.station_status_changed',{station_id:'station-01',status:'closed',reason:'synthetic closure'}));
 g.event(event('closed-low','2026-11-23T09:00:00-08:00','fuel.price_observed',{station_id:'station-01',grade:'regular',price_type:'credit',price_mills:2500,reason:'closed station price'}));
 assert.equal(g.data.notifications.length,baseline);
 const stale=g.call('fueltrail.price_alert.create',{area_id:'place-sunfield',radius_milli:10000,grade:'regular',price_type:'cash',condition:'below_price',threshold_mills:10000});
 assert.equal(stale.alert.condition_met,false);
});
test('alert updates are record-versioned and station events are idempotent',()=>{
 const f=fixture(),a=f.data.price_alerts[0];
 unchanged(f,()=>f.call('fueltrail.price_alert.update',{id:a.id,alert_version:a.version+1,patch:{threshold_mills:3200}}),/changed/);
 const updated=f.call('fueltrail.price_alert.update',{id:a.id,alert_version:a.version,patch:{threshold_mills:3200}}).alert;assert.equal(updated.threshold_mills,3200);
 f.event(event('details-1','2026-11-23T09:00:00-08:00','fuel.station_details_changed',{station_id:'station-01',patch:{open_24h:true,amenities:['air','restroom']},reason:'fixture correction'}));
 const once=f.data;f.event(event('details-1','2026-11-23T09:00:00-08:00','fuel.station_details_changed',{station_id:'station-01',patch:{open_24h:true,amenities:['air','restroom']},reason:'fixture correction'}));assert.deepEqual(f.data,once);
});
test('vehicle preferences can be created, selected and archived with guards',()=>{
 const f=fixture(),created=f.call('fueltrail.vehicle.create',{label:'Weekend wagon',year:2024,make:'Linden',model:'Field',fuel_grade:'regular',tank_capacity_thousandths:14000,economy_baseline_milli:30000,preferred_radius_milli:10000,price_type:'credit',preferred_brands:[],required_amenities:['accessible']}).vehicle;
 const selected=f.call('fueltrail.vehicle.select',{id:created.id,vehicle_version:created.version}).vehicle;assert.equal(selected.selected,true);
 const old=f.data.vehicles.find(x=>x.id==='vehicle-river');assert.equal(old.selected,false);assert.equal(old.version,2);
 const archived=f.call('fueltrail.vehicle.archive',{id:'vehicle-river',vehicle_version:old.version}).vehicle;assert.equal(archived.status,'archived');
 unchanged(f,()=>f.call('fueltrail.vehicle.update',{id:'vehicle-summit',vehicle_version:1,patch:{fuel_grade:'regular'}}),/history/);
});
test('fuel-log preview binds validated data and create/update/delete retain revisions',()=>{
 const f=fixture(),fields={vehicle_id:'vehicle-river',occurred_at:'2026-11-20T18:00:00Z',station_id:'station-01',odometer_milli:30000000,volume_thousandths:10000,unit_price_mills:3000,total_cost_cents:3000,grade:'regular',price_type:'credit',fill_status:'full',note:'New synthetic fill'};
 const preview=f.call('fueltrail.fuel_log.preview',{mode:'create',fields}).preview;
 const created=f.call('fueltrail.fuel_log.create',{preview_id:preview.id}).fuel_log;assert.equal(created.revisions.length,1);
 unchanged(f,()=>f.call('fueltrail.fuel_log.create',{preview_id:preview.id}),/already used/);
 const changed={...fields,note:'Corrected note'};
 const updatePreview=f.call('fueltrail.fuel_log.preview',{mode:'update',id:created.id,log_version:created.version,fields:changed}).preview;
 const updated=f.call('fueltrail.fuel_log.update',{preview_id:updatePreview.id}).fuel_log;assert.equal(updated.version,2);assert.equal(updated.revisions.length,2);
 const removed=f.call('fueltrail.fuel_log.delete',{id:updated.id,log_version:updated.version}).fuel_log;assert.ok(removed.deleted_at);assert.equal(removed.revisions.at(-1).action,'deleted');
});
test('fuel-log failures are atomic and economy excludes partial/missed chains',()=>{
 const f=fixture(),bad={vehicle_id:'vehicle-river',occurred_at:'2026-11-20T18:00:00Z',station_id:'station-01',odometer_milli:30000000,volume_thousandths:10000,unit_price_mills:3000,total_cost_cents:2500,grade:'regular',price_type:'credit',fill_status:'full',note:''};
 unchanged(f,()=>f.call('fueltrail.fuel_log.preview',{mode:'create',fields:bad}),/within one cent/);
 unchanged(f,()=>f.call('fueltrail.fuel_log.preview',{mode:'create',fields:{...bad,total_cost_cents:3000,grade:'diesel'}}),/incompatible/);
 const economy=f.call('fueltrail.fuel_economy.get',{vehicle_id:'vehicle-river'});
 assert.ok(economy.segments.length);assert.ok(economy.segments.every(x=>!['fuel-log-1-3','fuel-log-1-6'].includes(x.from_log_id)&&!['fuel-log-1-3','fuel-log-1-6'].includes(x.to_log_id)));
});
test('editing or deleting a middle fill recalculates the complete-fill chain',()=>{
 const f=fixture(),before=f.call('fueltrail.fuel_economy.get',{vehicle_id:'vehicle-river'});assert.equal(before.segments.length,3);
 const middle=f.data.fuel_logs.find(x=>x.id==='fuel-log-1-5'),fields={...Object.fromEntries(['vehicle_id','occurred_at','station_id','odometer_milli','volume_thousandths','unit_price_mills','total_cost_cents','grade','price_type','fill_status','note'].map(k=>[k,middle[k]])),fill_status:'partial'};
 const preview=f.call('fueltrail.fuel_log.preview',{mode:'update',id:middle.id,log_version:middle.version,fields});
 const changed=f.call('fueltrail.fuel_log.update',{preview_id:preview.id});assert.equal(changed.economy.segments.length,2);
 const later=f.data.fuel_logs.find(x=>x.id==='fuel-log-1-7'),removed=f.call('fueltrail.fuel_log.delete',{id:later.id,log_version:later.version});assert.equal(removed.economy.segments.length,1);
});
test('Mail is price-alert-only and unknown delivery blocks redelivery until same-request reconciliation',()=>{
 const f=fixture();f.call('fueltrail.price_alert.create',{area_id:'place-harbor',radius_milli:1000,grade:'regular',price_type:'credit',condition:'below_price',threshold_mills:3200});
 f.event(event('mail-low','2026-11-23T09:00:00-08:00','fuel.price_observed',{station_id:'station-01',grade:'regular',price_type:'credit',price_mills:3190,reason:'mail test'}));
 const n=f.data.notifications.at(-1),prepared=f.call('fueltrail.notification.email.prepare',{id:n.id,router_request_id:'router-mail-1'});
 assert.equal(prepared.message.data.source_object.object_type,'price_alert');assert.equal(prepared.message.data.channel,'channel.email');
 let recorded=f.call('fueltrail.notification.email.record',{id:n.id,router_request_id:'router-mail-1',delivery_status:'unknown',receipt_id:null,reconciled:false}).notification;
 assert.equal(recorded.reconciliation_required,true);
 unchanged(f,()=>f.call('fueltrail.notification.email.prepare',{id:n.id,router_request_id:'router-mail-2'}),/reconciled/);
 recorded=f.call('fueltrail.notification.email.record',{id:n.id,router_request_id:'router-mail-1',delivery_status:'delivered',receipt_id:'receipt-1',reconciled:true}).notification;
 assert.equal(recorded.email_status,'delivered');assert.equal(recorded.reconciliation_required,false);
 assert.ok(!require('../tools.json').some(t=>/fuel_log.*email|email.*fuel_log/.test(t.name)),'Fuel-log correction email leaked into v1');
});
test('optional diagnostics do not change outcomes and renderer escapes content',()=>{
 const on=fixture(),off=fixture({logging:false}),scenario=require('../examples/scenario.json');on.event(scenario);off.event(scenario);assert.deepEqual(on.data,off.data);assert.ok(on.logs.length);
 const broken=fixture();broken.ctx.log=()=>{throw Error('offline')};broken.event(scenario);assert.deepEqual(broken.data,off.data);
 const html=require('../gui/src/view.js').render([{id:'x',name:'<img src=x>',body:'<script>bad</script>'}]);assert.ok(!html.includes('<img'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;'));
});
test('invalid seed references and accounting are rejected',()=>{
 const f=fixture(),bad=f.data;bad.price_observations[0].station_id='missing';assert.throws(()=>plugin.validateSeed(f.ctx,bad),/observation/);
 const total=f.data;total.fuel_logs[0].total_cost_cents+=10;assert.throws(()=>plugin.validateSeed(f.ctx,total),/reconcile/);
});
