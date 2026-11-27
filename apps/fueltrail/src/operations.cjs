'use strict';
const c=require('./common.cjs'),rules=require('./rules.cjs'),mail=require('./mail.cjs');
function ensureVersion(actual,expected,label){if(actual!==expected)c.fail('stale_record',`${label} changed; inspect it and retry.`);}
function snapshot(log){return rules.logFields(log);}
function revision(log,action,at){return {revision_id:`${log.id}:v${log.version}`,version:log.version,action,at,snapshot:snapshot(log)};}
function read(ctx,data,name,args){
 if(name==='place.list')return {places:c.copy(data.places)};
 if(name==='station.search')return rules.search(data,args,c.now(ctx));
 if(name==='station.get'){const station=c.find(data.stations,args.id,'Station'),prices=data.price_observations.filter(x=>x.station_id===station.id&&Date.parse(x.observed_at)<=Date.parse(c.now(ctx))).sort((a,b)=>Date.parse(b.observed_at)-Date.parse(a.observed_at));return {station:c.copy(station),recent_prices:c.copy(prices.slice(0,24))};}
 if(name==='price_alert.list'){const alerts=data.price_alerts.filter(x=>args.include_deleted||x.status!=='deleted');return {alerts:c.copy(alerts),notifications:c.copy(data.notifications),email_config:{enabled:data.settings.email_alerts_enabled,mail_account_id:data.settings.mail_account_id}};}
 if(name==='vehicle.list')return {vehicles:c.copy(data.vehicles)};
 if(name==='fuel_log.list'){let logs=data.fuel_logs.filter(x=>args.include_deleted||!x.deleted_at);if(args.vehicle_id)logs=logs.filter(x=>x.vehicle_id===args.vehicle_id);return {fuel_logs:c.copy(logs.sort((a,b)=>Date.parse(b.occurred_at)-Date.parse(a.occurred_at)))};}
 if(name==='fuel_economy.get')return rules.economy(data,args.vehicle_id);
 return null;
}
function alertWrite(ctx,data,name,args){
 if(!name.startsWith('price_alert.'))return null;
 const at=c.now(ctx);let alert;
 if(name==='price_alert.create'){
  c.find(data.places,args.area_id,'Place');alert={id:c.id('alert',args.request_id),area_id:args.area_id,radius_milli:args.radius_milli,grade:args.grade,price_type:args.price_type,condition:args.condition,threshold_mills:args.threshold_mills,status:'active',condition_met:false,matched_station_id:null,version:1,created_at:at,updated_at:at};rules.armAlert(data,alert,at);data.price_alerts.push(alert);
 }else{
  alert=c.find(data.price_alerts,args.id,'Alert');ensureVersion(alert.version,args.alert_version,'Alert');if(alert.status==='deleted')c.fail('invalid_state','Deleted alerts cannot be changed.');
  if(name==='price_alert.update'){if(!Object.keys(args.patch).length)c.fail('invalid_arguments','Alert patch cannot be empty.');for(const [key,value]of Object.entries(args.patch))alert[key]=c.copy(value);alert.version++;alert.updated_at=at;rules.armAlert(data,alert,at);}
  else if(name==='price_alert.pause'){if(alert.status!=='active')c.fail('invalid_state','Only active alerts can be paused.');alert.status='paused';alert.condition_met=false;alert.matched_station_id=null;alert.version++;alert.updated_at=at;}
  else if(name==='price_alert.resume'){if(alert.status!=='paused')c.fail('invalid_state','Only paused alerts can be resumed.');alert.status='active';alert.version++;alert.updated_at=at;rules.armAlert(data,alert,at);}
  else if(name==='price_alert.delete'){alert.status='deleted';alert.condition_met=false;alert.matched_station_id=null;alert.version++;alert.updated_at=at;}
  else return null;
 }
 c.log(ctx,'fueltrail.alert_prepared',{alert_id:alert.id,operation:name,status:alert.status});return {id:alert.id,alert:c.copy(alert)};
}
function emailWrite(ctx,data,name,args){
 if(!name.startsWith('notification.email.'))return null;
 const notification=c.find(data.notifications,args.id,'Notification');
 if(name==='notification.email.prepare'){
  if(notification.email_status==='delivered')c.fail('invalid_state','This notification was already delivered.');if(notification.email_status==='unknown')c.fail('reconciliation_required','Unknown delivery must be reconciled before any redelivery.');
  if(notification.email_status==='pending'){
   if(notification.email_request_id!==args.router_request_id)c.fail('invalid_state','A different delivery is already pending.');return {id:notification.id,notification:c.copy(notification),message:c.copy(notification.email_message)};
  }
  const message=mail.message(data,notification,args.router_request_id);notification.email_status='pending';notification.email_request_id=args.router_request_id;notification.email_receipt_id=null;notification.email_message=message;notification.delivery_attempts++;notification.reconciliation_required=false;c.log(ctx,'fueltrail.email_prepared',{notification_id:notification.id,attempt:notification.delivery_attempts});return {id:notification.id,notification:c.copy(notification),message:c.copy(message)};
 }
 if(name==='notification.email.record'){
  if(notification.email_request_id!==args.router_request_id)c.fail('invalid_state','Delivery request does not match the prepared message.');
  if(notification.email_status==='unknown'){if(!args.reconciled||args.delivery_status==='unknown')c.fail('reconciliation_required','Retry the same router request and record its confirmed outcome.');}
  else if(notification.email_status!=='pending'||args.reconciled)c.fail('invalid_state','Only a pending delivery can receive an initial outcome.');
  notification.email_status=args.delivery_status;notification.email_receipt_id=args.receipt_id;notification.reconciliation_required=args.delivery_status==='unknown';c.log(ctx,'fueltrail.email_outcome_prepared',{notification_id:notification.id,status:args.delivery_status,reconciled:args.reconciled});return {id:notification.id,notification:c.copy(notification)};
 }
 return null;
}
function vehicleWrite(ctx,data,name,args){
 if(!name.startsWith('vehicle.'))return null;
 const at=c.now(ctx);let vehicle;
 if(name==='vehicle.create'){
  vehicle={id:c.id('vehicle',args.request_id),label:args.label,year:args.year,make:args.make,model:args.model,fuel_grade:args.fuel_grade,tank_capacity_thousandths:args.tank_capacity_thousandths,distance_unit:'mile',volume_unit:'gallon',economy_baseline_milli:args.economy_baseline_milli,preferred_radius_milli:args.preferred_radius_milli,price_type:args.price_type,preferred_brands:args.preferred_brands,required_amenities:args.required_amenities,status:'active',selected:false,version:1,created_at:at,updated_at:at};data.vehicles.push(vehicle);
 }else{
  vehicle=c.find(data.vehicles,args.id,'Vehicle');ensureVersion(vehicle.version,args.vehicle_version,'Vehicle');if(vehicle.status==='archived')c.fail('invalid_state','Archived vehicles cannot be changed.');
  if(name==='vehicle.update'){if(!Object.keys(args.patch).length)c.fail('invalid_arguments','Vehicle patch cannot be empty.');if(args.patch.fuel_grade&&args.patch.fuel_grade!==vehicle.fuel_grade&&data.fuel_logs.some(x=>x.vehicle_id===vehicle.id))c.fail('invalid_state','A vehicle with fuel-log history cannot change fuel grade.');Object.assign(vehicle,c.copy(args.patch));vehicle.version++;vehicle.updated_at=at;}
  else if(name==='vehicle.archive'){if(vehicle.selected)c.fail('invalid_state','Select another vehicle before archiving this one.');vehicle.status='archived';vehicle.version++;vehicle.updated_at=at;}
  else if(name==='vehicle.select'){if(vehicle.selected)c.fail('invalid_state','Vehicle is already selected.');for(const other of data.vehicles)if(other.selected){other.selected=false;other.version++;other.updated_at=at;}vehicle.selected=true;vehicle.version++;vehicle.updated_at=at;}
  else return null;
 }
 c.log(ctx,'fueltrail.vehicle_prepared',{vehicle_id:vehicle.id,operation:name});return {id:vehicle.id,vehicle:c.copy(vehicle)};
}
function logWrite(ctx,data,name,args){
 if(!name.startsWith('fuel_log.'))return null;
 const at=c.now(ctx);
 if(name==='fuel_log.preview'){
  if(args.mode==='create'&&(args.id!==undefined||args.log_version!==undefined)||args.mode==='update'&&(args.id===undefined||args.log_version===undefined))c.fail('invalid_arguments','Update previews require an id and log_version; create previews do not.');
  let log=null;if(args.mode==='update'){log=c.find(data.fuel_logs,args.id,'Fuel log');if(log.deleted_at)c.fail('invalid_state','Deleted fuel logs cannot be edited.');ensureVersion(log.version,args.log_version,'Fuel log');}
  const checked=rules.validateLogFields(data,args.fields,at,{excludeId:log?.id||null}),preview={id:c.id('preview',args.request_id),mode:args.mode,fuel_log_id:log?.id||null,expected_log_version:log?.version||null,fields:c.copy(args.fields),computed_total_cents:checked.computed_total_cents,created_at:at,expires_at:new Date(Date.parse(at)+30*60000).toISOString(),used_at:null};data.previews.push(preview);return {id:preview.id,preview:c.copy(preview)};
 }
 if(name==='fuel_log.create'||name==='fuel_log.update'){
  const preview=c.find(data.previews,args.preview_id,'Preview');if(preview.used_at)c.fail('invalid_state','Preview was already used.');if(Date.parse(at)>Date.parse(preview.expires_at))c.fail('expired_preview','Fuel-log preview expired.');if(name==='fuel_log.create'&&preview.mode!=='create'||name==='fuel_log.update'&&preview.mode!=='update')c.fail('invalid_state','Preview mode does not match the operation.');
  let log;
  if(name==='fuel_log.create'){rules.validateLogFields(data,preview.fields,at);log={id:c.id('fuel-log',args.request_id),...c.copy(preview.fields),version:1,created_at:at,updated_at:at,deleted_at:null,revisions:[]};log.revisions.push(revision(log,'created',at));data.fuel_logs.push(log);}
  else{log=c.find(data.fuel_logs,preview.fuel_log_id,'Fuel log');ensureVersion(log.version,preview.expected_log_version,'Fuel log');rules.validateLogFields(data,preview.fields,at,{excludeId:log.id});Object.assign(log,c.copy(preview.fields));log.version++;log.updated_at=at;log.revisions.push(revision(log,'updated',at));}
  preview.used_at=at;c.log(ctx,'fueltrail.log_prepared',{fuel_log_id:log.id,operation:name,preview_id:preview.id});return {id:log.id,fuel_log:c.copy(log),economy:rules.economy(data,log.vehicle_id)};
 }
 if(name==='fuel_log.delete'){
  const log=c.find(data.fuel_logs,args.id,'Fuel log');if(log.deleted_at)c.fail('invalid_state','Fuel log was already deleted.');ensureVersion(log.version,args.log_version,'Fuel log');c.activeVehicle(data,log.vehicle_id);log.version++;log.updated_at=at;log.deleted_at=at;log.revisions.push(revision(log,'deleted',at));return {id:log.id,fuel_log:c.copy(log),economy:rules.economy(data,log.vehicle_id)};
 }
 return null;
}
function handleTool(ctx,data,name,args){
 if(!name.startsWith('fueltrail.'))c.fail('unknown_tool','Unknown Fueltrail operation.');
 name=name.slice('fueltrail.'.length);
 const result=read(ctx,data,name,args);if(result)return {data,result};
 for(const fn of [alertWrite,emailWrite,vehicleWrite,logWrite]){const out=fn(ctx,data,name,args);if(out)return {data,result:out};}
 c.fail('unknown_tool','Unknown Fueltrail operation.');
}
module.exports={handleTool};
