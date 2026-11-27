'use strict';
const {log}=require('./diagnostics.cjs');
// Business operations receive a working copy; only Core may commit the result.
const {fail,range,overlap}=require('./domain-utils.cjs');
const {ical}=require('./formats/ical.cjs');
function handleTool(ctx,data,name,args){
 log(ctx,name+'.started',args.id?{object_id:args.id}:{});
 const records=data.events,e=records.find(x=>x.id===args.id);
 if(name==='calendar.list'){
  if((args.start||args.end)&&!range(args))fail('invalid_arguments','A valid start and end are required.');
  const events=records.filter(x=>(args.include_cancelled||x.status!=='cancelled')&&(!args.start||overlap(x,args)));log(ctx,'calendar.list.matched',{match_count:events.length});return {data,result:{events}};
 }
 if(name==='calendar.attachment.get'){const record=data.events.find(x=>x.id===args.id);if(!record||!(record.attachments||[]).includes(args.asset_id))fail('not_found','Attachment is not on this record');if(!ctx.assets?.read)fail('unsupported_capability','Attachment runtime required');return {data,result:{file:ctx.assets.read(args.asset_id)}};}
 if(name==='calendar.freebusy'){if(!range(args))fail('invalid_arguments','Start must precede end.');const busy=records.filter(x=>x.id!==args.exclude_id&&x.status!=='cancelled'&&overlap(x,args)).map(x=>({id:x.id,start:x.start,end:x.end}));log(ctx,'calendar.freebusy.checked',{busy_count:busy.length});return {data,result:{busy}};}
 if(name==='calendar.import_ics')return require('./formats/import-ical.cjs').importCalendar(ctx,data,args);
 if(name==='calendar.create'){
  let n=1;while(records.some(x=>x.id==='evt-local-'+n))n++;const id='evt-local-'+n;
  const next={id,uid:id+'@pale.example',account_id:data.account_id,calendar_id:data.calendar_id,title:args.title,start:args.start,end:args.end,timezone:args.timezone,location:args.location||'',organizer_person_id:data.owner_person_id,attendees:[data.owner_person_id],status:'confirmed',sequence:0};
  const conflict=records.some(x=>x.status!=='cancelled'&&overlap(x,next));log(ctx,'calendar.create.conflict_checked',{conflict});if(conflict)fail('calendar_overlap','An event already occupies this time range.');records.push(next);log(ctx,'calendar.create.prepared',{object_id:id});return {data,result:{id}};
 }
 if(!e)fail('not_found','Event not found.');
 log(ctx,'calendar.record.found',{object_id:e.id});
 if(name==='calendar.get')return {data,result:{event:e}};
 if(name==='calendar.export_ics')return {data,result:{mime_type:'text/calendar',text:ical(e,ctx.virtual_now)}};
 if(name==='calendar.attachment.add'){
  if(e.status==='cancelled')fail('invalid_state','Cancelled events cannot accept attachments');const ids=require('./attachments.cjs').add(ctx,e,args.files);e.attachments=[...new Set([...(e.attachments||[]),...ids])];e.sequence++;
 }else if(name==='calendar.attachment.remove'){
  if(e.status==='cancelled')fail('invalid_state','Cancelled events cannot be edited');if(!(e.attachments||[]).includes(args.asset_id))fail('not_found','Attachment is not on this event');e.attachments=e.attachments.filter(id=>id!==args.asset_id);e.sequence++;
 }else if(name==='calendar.update'){
  if(!Object.keys(args.patch).length)fail('invalid_arguments','No update fields were supplied.');
  if(e.status==='cancelled')fail('invalid_state','Cancelled events cannot be updated.');const next={...e,...args.patch,sequence:e.sequence+1};
  const conflict=records.some(x=>x.id!==e.id&&x.status!=='cancelled'&&overlap(x,next));log(ctx,'calendar.update.conflict_checked',{conflict});if(conflict)fail('calendar_overlap','An event already occupies this time range.');Object.assign(e,next);
 }else if(name==='calendar.cancel'){e.status='cancelled';e.sequence++;}
 else fail('not_found','Unknown Calendar operation.');
 log(ctx,name+'.prepared',{object_id:e.id});
 return {data,result:{id:e.id}};
}
module.exports={handleTool};
