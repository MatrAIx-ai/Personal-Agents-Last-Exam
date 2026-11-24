'use strict';
const c=require('./common.cjs');
const FRESH_HOURS=24;
function byTime(a,b){return Date.parse(a.observed_at)-Date.parse(b.observed_at)||a.id.localeCompare(b.id);}
function stationDistance(station,placeId){return station.distances.find(x=>x.place_id===placeId)?.distance_milli??null;}
function observationsFor(data,stationId,grade,priceType,at){return data.price_observations.filter(o=>o.station_id===stationId&&o.grade===grade&&o.price_type===priceType&&Date.parse(o.observed_at)<=Date.parse(at)).sort(byTime);}
function latestPair(data,stationId,grade,priceType,at){const rows=observationsFor(data,stationId,grade,priceType,at);return {latest:rows.at(-1)||null,prior:rows.at(-2)||null};}
function isFresh(observation,at,hours=FRESH_HOURS){return !!observation&&c.hoursBetween(at,observation.observed_at)>=0&&c.hoursBetween(at,observation.observed_at)<=hours;}
function selectedVehicle(data){return data.vehicles.find(v=>v.selected&&v.status==='active')||null;}
function search(data,args,at){
 const vehicle=args.vehicle_id?c.activeVehicle(data,args.vehicle_id):selectedVehicle(data);
 const placeId=args.place_id,place=c.find(data.places,placeId,'Place');
 const grade=args.grade||vehicle?.fuel_grade;if(!grade)c.fail('invalid_arguments','Choose a fuel grade or active vehicle.');
 if(vehicle&&grade!==vehicle.fuel_grade)c.fail('incompatible_fuel','The selected vehicle is not compatible with that fuel grade.');
 const priceType=args.price_type||vehicle?.price_type||'credit';
 const radius=args.radius_milli??vehicle?.preferred_radius_milli??10000;
 const amenities=args.amenities??vehicle?.required_amenities??[];
 const brands=args.brands??vehicle?.preferred_brands??[];
 const freshness=args.freshness_hours??FRESH_HOURS,openOnly=args.open_only!==false;
 let results=[];
 for(const station of data.stations){
  const distance=stationDistance(station,placeId);if(distance===null||distance>radius||!station.grades.includes(grade))continue;
  if(openOnly&&station.status!=='open'||brands.length&&!brands.includes(station.brand)||amenities.some(a=>!station.amenities.includes(a)))continue;
  const {latest}=latestPair(data,station.id,grade,priceType,at),fresh=isFresh(latest,at,freshness);
  const priceStatus=!latest?'missing':fresh?'fresh':'stale';
  const base=vehicle?.economy_baseline_milli;
  const trip=latest&&base?Math.round(latest.price_mills*(2*distance/base)/10):null;
  results.push({id:station.id,name:station.name,brand:station.brand,address:station.address,status:station.status,open_24h:station.open_24h,amenities:[...station.amenities],grade,price_type:priceType,price_mills:latest?.price_mills??null,observed_at:latest?.observed_at??null,price_status:priceStatus,distance_milli:distance,estimated_trip_cost_cents:trip});
 }
 const sort=args.sort||'price';
 const numeric=(v)=>v===null?Number.MAX_SAFE_INTEGER:v;
 results.sort((a,b)=>sort==='distance'?a.distance_milli-b.distance_milli:sort==='trip_cost'?numeric(a.estimated_trip_cost_cents)-numeric(b.estimated_trip_cost_cents)||numeric(a.price_mills)-numeric(b.price_mills):numeric(a.price_mills)-numeric(b.price_mills)||a.distance_milli-b.distance_milli||a.id.localeCompare(b.id));
 return {place,vehicle_id:vehicle?.id??null,grade,price_type:priceType,radius_milli:radius,freshness_hours:freshness,results};
}
function alertMatch(data,alert,at){
 const candidates=[];
 for(const station of data.stations){
  const distance=stationDistance(station,alert.area_id);if(distance===null||distance>alert.radius_milli||station.status!=='open'||!station.grades.includes(alert.grade))continue;
  const {latest,prior}=latestPair(data,station.id,alert.grade,alert.price_type,at);
  if(!isFresh(latest,at)||alert.condition==='price_rise'&&!isFresh(prior,at))continue;
  const met=alert.condition==='below_price'?latest.price_mills<=alert.threshold_mills:latest.price_mills-prior.price_mills>=alert.threshold_mills;
  if(met)candidates.push({station,latest,prior:prior||null,distance});
 }
 candidates.sort((a,b)=>alert.condition==='below_price'?a.latest.price_mills-b.latest.price_mills||a.distance-b.distance:(b.latest.price_mills-b.prior.price_mills)-(a.latest.price_mills-a.prior.price_mills)||a.distance-b.distance);
 return candidates[0]||null;
}
function armAlert(data,alert,at){const match=alert.status==='active'?alertMatch(data,alert,at):null;alert.condition_met=!!match;alert.matched_station_id=match?.station.id??null;return match;}
function notificationFor(data,alert,match,at,eventId){
 const place=c.find(data.places,alert.area_id,'Place'),delta=match.prior?match.latest.price_mills-match.prior.price_mills:null;
 const title=alert.condition==='below_price'?`Fuel price is below $${(alert.threshold_mills/1000).toFixed(3)}`:`Fuel price rose $${(alert.threshold_mills/1000).toFixed(3)} or more`;
 const body=alert.condition==='below_price'?`${match.station.name} in ${place.name} reported ${alert.price_type} ${alert.grade} at $${(match.latest.price_mills/1000).toFixed(3)} per gallon.`:`${match.station.name} in ${place.name} reported ${alert.price_type} ${alert.grade} at $${(match.latest.price_mills/1000).toFixed(3)} per gallon, up $${(delta/1000).toFixed(3)} from its previous fresh observation.`;
 return {id:c.id('notification',eventId+':'+alert.id),alert_id:alert.id,station_id:match.station.id,observed_price_mills:match.latest.price_mills,prior_price_mills:match.prior?.price_mills??null,triggered_at:at,title,body,email_status:data.settings.email_alerts_enabled?'not_prepared':'disabled',email_request_id:null,email_receipt_id:null,email_message:null,delivery_attempts:0,reconciliation_required:false};
}
function evaluateAlerts(data,at,{notify=false,eventId='event'}={}){
 const made=[];
 for(const alert of data.price_alerts){
  if(alert.status!=='active')continue;const was=alert.condition_met,match=alertMatch(data,alert,at),met=!!match;
  if(was!==met||alert.matched_station_id!==(match?.station.id??null)){alert.condition_met=met;alert.matched_station_id=match?.station.id??null;alert.updated_at=at;alert.version++;}
  if(notify&&!was&&met){const n=notificationFor(data,alert,match,at,eventId);if(!data.notifications.some(x=>x.id===n.id)){data.notifications.push(n);made.push(n);}}
 }
 return made;
}
function logFields(log){const out={};for(const key of ['vehicle_id','occurred_at','station_id','odometer_milli','volume_thousandths','unit_price_mills','total_cost_cents','grade','price_type','fill_status','note'])out[key]=log[key];return out;}
function validateLogFields(data,fields,at,{excludeId=null}={}){
 const vehicle=c.activeVehicle(data,fields.vehicle_id);if(fields.grade!==vehicle.fuel_grade)c.fail('incompatible_fuel','Fuel grade is incompatible with the vehicle.');
 if(Date.parse(fields.occurred_at)>Date.parse(at))c.fail('invalid_time','Fuel logs cannot be dated after the current virtual time.');
 if(fields.station_id){const station=c.find(data.stations,fields.station_id,'Station');if(!station.grades.includes(fields.grade))c.fail('incompatible_fuel','The station does not carry that fuel grade.');}
 const computed=c.totalCents(fields.unit_price_mills,fields.volume_thousandths);if(Math.abs(computed-fields.total_cost_cents)>1)c.fail('inconsistent_total',`Total must be within one cent of ${computed} cents.`);
 const peers=data.fuel_logs.filter(x=>!x.deleted_at&&x.id!==excludeId&&x.vehicle_id===fields.vehicle_id).sort((a,b)=>Date.parse(a.occurred_at)-Date.parse(b.occurred_at));
 if(peers.some(x=>Date.parse(x.occurred_at)===Date.parse(fields.occurred_at)))c.fail('duplicate_log','Another fuel log exists at that time.');
 const before=peers.filter(x=>Date.parse(x.occurred_at)<Date.parse(fields.occurred_at)).at(-1),after=peers.find(x=>Date.parse(x.occurred_at)>Date.parse(fields.occurred_at));
 if(before&&fields.odometer_milli<=before.odometer_milli||after&&fields.odometer_milli>=after.odometer_milli)c.fail('invalid_odometer','Odometers must increase with log time.');
 return {vehicle,computed_total_cents:computed};
}
function economy(data,vehicleId){
 c.find(data.vehicles,vehicleId,'Vehicle');const logs=data.fuel_logs.filter(x=>x.vehicle_id===vehicleId&&!x.deleted_at).sort((a,b)=>Date.parse(a.occurred_at)-Date.parse(b.occurred_at));
 const segments=[];for(let i=1;i<logs.length;i++){const previous=logs[i-1],current=logs[i];if(previous.fill_status!=='full'||current.fill_status!=='full')continue;const distance=current.odometer_milli-previous.odometer_milli;if(distance<=0)continue;segments.push({from_log_id:previous.id,to_log_id:current.id,distance_milli:distance,volume_thousandths:current.volume_thousandths,economy_milli:Math.round(distance*1000/current.volume_thousandths)});}
 return {vehicle_id:vehicleId,segments,average_economy_milli:segments.length?Math.round(segments.reduce((sum,x)=>sum+x.economy_milli,0)/segments.length):null};
}
module.exports={FRESH_HOURS,stationDistance,latestPair,isFresh,search,alertMatch,armAlert,evaluateAlerts,logFields,validateLogFields,economy};
