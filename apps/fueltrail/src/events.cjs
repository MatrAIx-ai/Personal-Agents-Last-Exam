'use strict';
const c=require('./common.cjs'),rules=require('./rules.cjs');
function applyEvent(ctx,data,event){
 if(data.processed_event_ids.includes(event.event_id)){c.log(ctx,'fueltrail.event_duplicate',{event_id:event.event_id});return data;}
 if(Date.parse(event.at)!==Date.parse(ctx.virtual_now))c.fail('invalid_time','Event context must use the event virtual time.');
 const station=c.find(data.stations,event.payload.station_id,'Station');let made=[];
 if(event.operation==='fuel.price_observed'){
  if(!station.grades.includes(event.payload.grade))c.fail('incompatible_fuel','Station does not carry the observed grade.');
  const latest=rules.latestPair(data,station.id,event.payload.grade,event.payload.price_type,event.at).latest;
  if(latest&&Date.parse(event.at)<=Date.parse(latest.observed_at))c.fail('invalid_time','Price observations must move forward for a station/grade/payment series.');
  data.price_observations.push({id:c.id('observation',event.event_id),station_id:station.id,grade:event.payload.grade,price_type:event.payload.price_type,price_mills:event.payload.price_mills,observed_at:event.at,source:'task_event'});
  made=rules.evaluateAlerts(data,event.at,{notify:true,eventId:event.event_id});
 }else if(event.operation==='fuel.station_status_changed'){
  station.status=event.payload.status;station.updated_at=event.at;rules.evaluateAlerts(data,event.at);
 }else if(event.operation==='fuel.station_details_changed'){
  if(!Object.keys(event.payload.patch).length)c.fail('invalid_event','Station detail patch cannot be empty.');Object.assign(station,c.copy(event.payload.patch),{updated_at:event.at});rules.evaluateAlerts(data,event.at);
 }else c.fail('invalid_event','Unsupported Fueltrail event.');
 data.processed_event_ids.push(event.event_id);c.log(ctx,'fueltrail.event_prepared',{event_id:event.event_id,operation:event.operation,notification_count:made.length});return data;
}
module.exports={applyEvent};
