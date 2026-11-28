'use strict';
const {compile}=require('./schema-validator.cjs');
const path=require('node:path');
const {copy,fail,instant,propertyDate,sorted,window,same}=require('./common.cjs');
const validConditions=compile(require('../schemas/conditions.schema.json'),path.join(__dirname,'../schemas'));
const validTerms=compile(require('../schemas/terms.schema.json'),path.join(__dirname,'../schemas'));
function identity(data,value,need){
 if(value.stay_id!==data.stay.id||value.person_ids.some(p=>!data.people.some(x=>x.id===p)))fail('invalid_arguments','Unknown stay or traveler.');
 if(need&&value.service!==need.service)fail('invalid_arguments','A need slot cannot change service type.');
 // Personal slots retain their traveler even after companion replacement.
 // The shared arrival slot deliberately accepts historical traveler pairs.
 if(need&&value.service!=='late_arrival'&&!same(sorted(value.person_ids),sorted(need.person_ids)))fail('invalid_arguments','A personal need slot cannot target another traveler.');
 if(value.service!=='late_arrival'&&value.person_ids.length!==1)fail('invalid_arguments','This service is scoped to one traveler.');
 if(value.service==='late_arrival'&&value.person_ids.length!==2)fail('invalid_arguments','Arrival is scoped to the two booked travelers.');
}
function dates(data,values){
 const start=propertyDate(data,data.stay.check_in),end=propertyDate(data,data.stay.check_out);
 for(const day of values){if(!Number.isFinite(Date.parse(day+'T00:00:00Z'))||new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day||day<=start||day>end)fail('invalid_arguments','Breakfast dates must be mornings in the fixed stay.');}
 return sorted(values);
}
function withinStay(data,w){if(Date.parse(w.start)<Date.parse(data.stay.check_in)||Date.parse(w.end)>Date.parse(data.stay.check_out))fail('invalid_arguments','Access window must stay within the reservation.');}
function conditions(data,value,need){
 if(!validConditions(value))fail('invalid_arguments','Service conditions do not match the declared schema.');identity(data,value,need);
 const out={stay_id:value.stay_id,service:value.service,person_ids:sorted(value.person_ids)};
 if(value.service==='late_arrival'){out.arrival_at=instant(value.arrival_at);if(Date.parse(out.arrival_at)<Date.parse(data.stay.check_in)||Date.parse(out.arrival_at)>=Date.parse(data.stay.check_out))fail('invalid_arguments','Arrival must fall during this fixed stay.');}
 if(value.service==='step_free_access'){out.functional_need=value.functional_need;out.window=window(value.window);withinStay(data,out.window);}
 if(value.service==='breakfast'){out.morning_dates=dates(data,value.morning_dates);if(!value.meal_request.trim())fail('invalid_arguments','Meal request cannot be empty.');out.meal_request=value.meal_request.trim();}
 return out;
}
function terms(data,value,need){
 if(!validTerms(value))fail('invalid_arguments','Hotel terms do not match the declared service schema.');identity(data,value,need);
 const out={stay_id:value.stay_id,service:value.service,person_ids:sorted(value.person_ids)};
 if(value.service==='late_arrival'){
  out.arrival_window=window(value.arrival_window);const e=data.property.entrances.find(e=>e.id===value.entrance_id);
  if(!e||!e.access_methods.includes(value.access_method_id))fail('invalid_arguments','Unknown hotel entrance or access method.');
  out.entrance_id=value.entrance_id;out.access_method_id=value.access_method_id;
 }
 if(value.service==='step_free_access'){
  const route=data.property.routes.find(r=>r.id===value.route_id);
  if(!route||!route.step_free)fail('invalid_arguments','A step-free commitment requires a named step-free route.');
  out.route_id=value.route_id;out.window=window(value.window);
  if(Date.parse(out.window.start)<Date.parse(route.window.start)||Date.parse(out.window.end)>Date.parse(route.window.end))fail('invalid_arguments','Confirmed access must fit the route operating window.');
 }
 if(value.service==='breakfast'){out.morning_dates=dates(data,value.morning_dates);if(!value.meal_request.trim())fail('invalid_arguments','Meal terms cannot be empty.');out.meal_request=value.meal_request.trim();}
 return out;
}
function selectorWindow(value,at){
 if(!value||!Number.isFinite(Date.parse(value.from))||!Number.isFinite(Date.parse(value.until))||Date.parse(value.from)>=Date.parse(value.until)||Date.parse(value.until)>Date.parse(at))fail('invalid_event','Selection windows must satisfy from < until <= event.at.');
 return {from:instant(value.from),until:instant(value.until)};
}
const inside=(at,w)=>Date.parse(at)>=Date.parse(w.from)&&Date.parse(at)<Date.parse(w.until);
function sameIdentity(a,b){return a.stay_id===b.stay_id&&a.service===b.service&&same(sorted(a.person_ids),sorted(b.person_ids));}
function matchesConditions(data,a,b,need){return same(conditions(data,a,need),conditions(data,b,need));}
function matchesTerms(data,a,b,need){return same(terms(data,a,need),terms(data,b,need));}
module.exports={conditions,terms,selectorWindow,inside,sameIdentity,matchesConditions,matchesTerms};
