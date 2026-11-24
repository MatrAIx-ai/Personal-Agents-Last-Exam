'use strict';
const c=require('./common.cjs'),rules=require('./rules.cjs');
function validateSeed(ctx,data){
 const groups=[data.places,data.stations,data.price_observations,data.vehicles,data.price_alerts,data.notifications,data.fuel_logs,data.previews],seen=new Set();
 for(const group of groups)for(const item of group){if(seen.has(item.id))c.fail('invalid_seed','Business IDs must be globally unique.');seen.add(item.id);}
 if(data.account_id!==ctx.binding.accounts.find(x=>x.app_id==='fueltrail')?.account_id)c.fail('invalid_seed','Fueltrail account does not match its binding.');
 const places=new Set(data.places.map(x=>x.id)),stations=new Map(data.stations.map(x=>[x.id,x])),vehicles=new Map(data.vehicles.map(x=>[x.id,x])),alerts=new Map(data.price_alerts.map(x=>[x.id,x]));
 for(const s of data.stations){if(!places.has(s.area_id)||s.distances.some(d=>!places.has(d.place_id))||new Set(s.distances.map(d=>d.place_id)).size!==s.distances.length)c.fail('invalid_seed','Station place references are invalid.');}
 for(const o of data.price_observations){const s=stations.get(o.station_id);if(!s||!s.grades.includes(o.grade))c.fail('invalid_seed','Price observation references an incompatible station.');}
 if(data.vehicles.filter(v=>v.selected&&v.status==='active').length!==1)c.fail('invalid_seed','Exactly one active vehicle must be selected.');
 for(const a of data.price_alerts){if(!places.has(a.area_id)||a.matched_station_id&&!stations.has(a.matched_station_id))c.fail('invalid_seed','Alert references are invalid.');if(a.status!=='active'&&(a.condition_met||a.matched_station_id))c.fail('invalid_seed','Inactive alerts cannot retain a met condition.');}
 for(const n of data.notifications){if(!alerts.has(n.alert_id)||!stations.has(n.station_id))c.fail('invalid_seed','Notification references are invalid.');if(n.email_status==='unknown'&&!n.reconciliation_required)c.fail('invalid_seed','Unknown Mail delivery requires reconciliation.');if(n.reconciliation_required&&n.email_status!=='unknown')c.fail('invalid_seed','Only unknown delivery can require reconciliation.');}
 for(const log of data.fuel_logs){if(!vehicles.has(log.vehicle_id)||log.station_id&&!stations.has(log.station_id))c.fail('invalid_seed','Fuel-log references are invalid.');if(Math.abs(c.totalCents(log.unit_price_mills,log.volume_thousandths)-log.total_cost_cents)>1)c.fail('invalid_seed','Fuel-log total does not reconcile.');if(!log.revisions.length||log.revisions.at(-1).version!==log.version)c.fail('invalid_seed','Fuel-log revision history is incomplete.');}
 for(const vehicle of data.vehicles){const rows=data.fuel_logs.filter(x=>x.vehicle_id===vehicle.id&&!x.deleted_at).sort((a,b)=>Date.parse(a.occurred_at)-Date.parse(b.occurred_at));for(let i=1;i<rows.length;i++)if(rows[i].odometer_milli<=rows[i-1].odometer_milli)c.fail('invalid_seed','Fuel-log odometers must increase.');}
 for(const p of data.previews){if(!vehicles.has(p.fields.vehicle_id)||p.fuel_log_id&&!data.fuel_logs.some(x=>x.id===p.fuel_log_id))c.fail('invalid_seed','Preview references are invalid.');}
 if(new Set(data.processed_event_ids).size!==data.processed_event_ids.length)c.fail('invalid_seed','Processed event IDs must be unique.');
}
function records(data){return [data.places,data.stations,data.price_observations,data.vehicles,data.price_alerts,data.notifications,data.fuel_logs,data.previews].flat();}
module.exports={validateSeed,records,objects:data=>records(data).map(x=>x.id),references:()=>[],assetReferences:()=>[]};
