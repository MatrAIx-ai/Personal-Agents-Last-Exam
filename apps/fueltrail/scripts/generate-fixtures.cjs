#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const c=require('../src/common.cjs'),rules=require('../src/rules.cjs');
const at='2026-11-23T08:00:00-08:00',root=path.resolve(__dirname,'..');
const isoHoursAgo=h=>new Date(Date.parse(at)-h*3600000).toISOString();
const places=[
 {id:'place-harbor',name:'Harbor District',metro:'Northport'},
 {id:'place-cascade',name:'Cascade Center',metro:'Pinehaven'},
 {id:'place-sunfield',name:'Sunfield Commons',metro:'Lakeview'}
];
const brands=['Northstar Fuel','Blue Finch','Evergreen Pump','Cinder Road','Harbor Lantern'],grades=['regular','midgrade','premium','diesel','e85','unleaded88'];
const amenities=['restroom','air','car_wash','convenience_store','accessible','truck_access'];
const stations=[];
for(let area=0;area<3;area++)for(let i=0;i<10;i++){
 const n=area*10+i+1,secondary=grades[(n-1)%grades.length];
 stations.push({id:`station-${String(n).padStart(2,'0')}`,name:`${brands[n%brands.length]} ${i+1}`,brand:brands[n%brands.length],area_id:places[area].id,address:`${100+n} Example Way, ${places[area].metro}`,status:n%11===0?'closed':'open',open_24h:n%3===0,amenities:[amenities[n%amenities.length],amenities[(n+2)%amenities.length]].filter((x,j,a)=>a.indexOf(x)===j),grades:[...new Set(['regular',secondary])],distances:places.map((p,j)=>({place_id:p.id,distance_milli:j===area?700+i*620:18000+Math.abs(j-area)*9000+i*300})),updated_at:isoHoursAgo(12+n%5)});
}
const price_observations=[];
for(let i=0;i<stations.length;i++){
 const station=stations[i],grade=station.grades.at(-1),base=3050+i*19;
 const hours=i<8?[20,14,7,2]:[72,50,30,26];
 for(let j=0;j<4;j++)price_observations.push({id:`observation-${String(i+1).padStart(2,'0')}-${j+1}`,station_id:station.id,grade,price_type:j%2?'credit':'cash',price_mills:base+j*25+(j%2?90:0),observed_at:isoHoursAgo(hours[j]),source:'fixture'});
}
const vehicles=[
 {id:'vehicle-river',label:'River hatchback',year:2022,make:'Aster',model:'River',fuel_grade:'regular',tank_capacity_thousandths:13200,distance_unit:'mile',volume_unit:'gallon',economy_baseline_milli:31500,preferred_radius_milli:9000,price_type:'credit',preferred_brands:[],required_amenities:['air'],status:'active',selected:true,version:1,created_at:'2026-01-10T18:00:00Z',updated_at:'2026-09-01T18:00:00Z'},
 {id:'vehicle-summit',label:'Summit coupe',year:2021,make:'Morrow',model:'Summit',fuel_grade:'premium',tank_capacity_thousandths:15800,distance_unit:'mile',volume_unit:'gallon',economy_baseline_milli:27400,preferred_radius_milli:12000,price_type:'cash',preferred_brands:['Northstar Fuel'],required_amenities:[],status:'active',selected:false,version:1,created_at:'2026-02-12T18:00:00Z',updated_at:'2026-08-11T18:00:00Z'},
 {id:'vehicle-trail',label:'Trail van',year:2020,make:'Juniper',model:'Trail',fuel_grade:'diesel',tank_capacity_thousandths:24400,distance_unit:'mile',volume_unit:'gallon',economy_baseline_milli:22800,preferred_radius_milli:15000,price_type:'credit',preferred_brands:[],required_amenities:['truck_access'],status:'active',selected:false,version:1,created_at:'2026-03-08T18:00:00Z',updated_at:'2026-07-15T18:00:00Z'}
];
const price_alerts=[];
for(let i=0;i<8;i++)price_alerts.push({id:`alert-${i+1}`,area_id:places[i%3].id,radius_milli:12000,grade:i%3===1?'premium':i%3===2?'diesel':'regular',price_type:i%2?'credit':'cash',condition:i%2?'price_rise':'below_price',threshold_mills:i%2?80:i===0?3000:3500+i*20,status:i===7?'paused':'active',condition_met:false,matched_station_id:null,version:1,created_at:`2026-0${(i%8)+1}-05T17:00:00Z`,updated_at:'2026-11-20T17:00:00Z'});
const notifications=[
 {id:'notification-history-1',alert_id:'alert-1',station_id:'station-01',observed_price_mills:3175,prior_price_mills:null,triggered_at:'2026-05-10T16:00:00Z',title:'Fuel price crossed your threshold',body:'A synthetic historical price alert for Harbor District.',email_status:'not_prepared',email_request_id:null,email_receipt_id:null,email_message:null,delivery_attempts:0,reconciliation_required:false},
 {id:'notification-history-2',alert_id:'alert-2',station_id:'station-03',observed_price_mills:3360,prior_price_mills:3240,triggered_at:'2026-06-11T16:00:00Z',title:'Fuel price rose',body:'A synthetic historical price-rise alert for Cascade Center.',email_status:'not_prepared',email_request_id:null,email_receipt_id:null,email_message:null,delivery_attempts:0,reconciliation_required:false}
];
const fuel_logs=[];
for(let v=0;v<vehicles.length;v++){
 const vehicle=vehicles[v],compatible=stations.filter(s=>s.grades.includes(vehicle.fuel_grade));let odometer=24000000+v*12000000;
 for(let i=0;i<8;i++){
  odometer+=260000+(i%3)*31000;const station=compatible[i%compatible.length],volume=8500+(i%4)*700,price=3150+v*280+i*17,total=c.totalCents(price,volume),id=`fuel-log-${v+1}-${i+1}`,occurred=`2026-${String(i+4).padStart(2,'0')}-${String(3+v).padStart(2,'0')}T16:00:00Z`,fill=i===2?'partial':i===5?'missed':'full';
  const fields={vehicle_id:vehicle.id,occurred_at:occurred,station_id:station.id,odometer_milli:odometer,volume_thousandths:volume,unit_price_mills:price,total_cost_cents:total,grade:vehicle.fuel_grade,price_type:i%2?'credit':'cash',fill_status:fill,note:i===4?'Corrected synthetic entry':'Synthetic fixture fill'};
  const created={revision_id:`${id}:v1`,version:1,action:'created',at:occurred,snapshot:{...fields,note:i===4?'Original synthetic entry':fields.note}};
  const revisions=[created];let version=1,updated=occurred;if(i===4){version=2;updated=new Date(Date.parse(occurred)+3600000).toISOString();revisions.push({revision_id:`${id}:v2`,version:2,action:'updated',at:updated,snapshot:{...fields}});}
  fuel_logs.push({id,...fields,version,created_at:occurred,updated_at:updated,deleted_at:null,revisions});
 }
}
const data={account_id:'fueltrail-maya',owner_person_id:'person-maya',settings:{email_alerts_enabled:true,mail_account_id:'mail-maya'},places,stations,price_observations,vehicles,price_alerts,notifications,fuel_logs,previews:[],processed_event_ids:[]};
for(const alert of price_alerts)if(alert.status==='active')rules.armAlert(data,alert,at);
fs.writeFileSync(path.join(root,'fixtures/minimal.json'),JSON.stringify(data,null,2)+'\n');
const objectIds=[places,stations,price_observations,vehicles,price_alerts,notifications,fuel_logs].flat().map(x=>x.id);
const binding={people:[{person_id:'person-maya',name:'Maya Chen'}],accounts:[{app_id:'fueltrail',account_id:'fueltrail-maya',owner_person_id:'person-maya'},{app_id:'mail',account_id:'mail-maya',owner_person_id:'person-maya'}],objects:{fueltrail:objectIds}};
fs.writeFileSync(path.join(root,'fixtures/binding.json'),JSON.stringify(binding,null,2)+'\n');
console.log(`Generated ${stations.length} stations, ${price_observations.length} observations, ${fuel_logs.length} logs and ${price_alerts.length} alerts.`);
