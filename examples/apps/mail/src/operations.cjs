'use strict';
const {log}=require('./diagnostics.cjs');
// Business operations receive a working copy; only Core may commit the result.
const {fail,text}=require('./domain-utils.cjs');
function handleTool(ctx,data,name,args){
 log(ctx,name+'.started',args.id?{object_id:args.id}:{});
 const records=data.messages,m=records.find(x=>x.id===args.id);let result;
 if(name==='mail.search'){
  const messages=records.filter(x=>(!args.folder||x.folder===args.folder)&&(!args.query||[x.subject,x.body,x.from,x.thread_id].join(' ').toLowerCase().includes(args.query.toLowerCase())));
  log(ctx,'mail.search.matched',{match_count:messages.length});return {data,result:{messages}};
 }
 if(name==='mail.attachment.get'){const record=data.messages.find(x=>x.id===args.id);if(!record||!(record.attachments||[]).includes(args.asset_id))fail('not_found','Attachment is not on this record');if(!ctx.assets?.read)fail('unsupported_capability','Attachment runtime required');return {data,result:{file:ctx.assets.read(args.asset_id)}};}
 if(name==='mail.get'){if(!m)fail('not_found','Message not found.');log(ctx,'mail.get.found',{message_id:m.id});return {data,result:{message:m}};}

 const address=v=>Array.isArray(v)&&v.length>0&&v.every(x=>typeof x==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
 if(name==='mail.draft.create'){
  if(!address(args.to)||!text(args.subject,200)||args.body.length>20000)fail('invalid_arguments','Invalid draft content.');
  log(ctx,'mail.draft.create.validated');
  let n=1;while(records.some(x=>x.id==='draft-'+n))n++;const id='draft-'+n;
  records.push({id,thread_id:id,account_id:data.account_id,from:data.address,to:args.to,subject:args.subject,body:args.body,received_at:ctx.virtual_now,folder:'drafts',read:true,attachments:[]});result={id};
 }else{
  if(!m)fail('not_found','Message not found.');
  log(ctx,'mail.record.found',{message_id:m.id});
  if(name==='mail.attachment.add'){
   if(m.folder!=='drafts')fail('invalid_state','Only drafts accept new attachments');
   const ids=require('./attachments.cjs').add(ctx,m,args.files);m.attachments=[...new Set([...m.attachments,...ids])];
  }else if(name==='mail.attachment.remove'){
   if(m.folder!=='drafts')fail('invalid_state','Only draft attachments can be removed');
   if(!m.attachments.includes(args.asset_id))fail('not_found','Attachment is not on this draft');m.attachments=m.attachments.filter(id=>id!==args.asset_id);
  }else if(name==='mail.draft.update'){
   if(m.folder!=='drafts')fail('invalid_state','Only drafts can be edited.');const next={...m,...args.patch};
   if(!address(next.to)||!text(next.subject,200)||next.body.length>20000)fail('invalid_arguments','Invalid draft content.');log(ctx,'mail.draft.update.validated',{message_id:m.id,changed_fields:Object.keys(args.patch)});Object.assign(m,args.patch);
  }else if(name==='mail.send'){if(m.folder!=='drafts')fail('invalid_state','Only drafts can be sent.');log(ctx,'mail.send.validated',{message_id:m.id});m.folder='sent';m.sent_at=ctx.virtual_now;}
  else if(name==='mail.flags.update')m.read=args.read;
  else if(name==='mail.move'){if(['drafts','sent'].includes(m.folder))fail('invalid_arguments','Drafts and sent messages cannot be moved with this operation.');m.folder=args.folder;}
  else if(name==='mail.trash')m.folder='trash';
  else fail('not_found','Unknown Mail operation.');
  result={id:m.id,simulated_delivery:name==='mail.send'};
 }
 log(ctx,name+'.prepared',{message_id:result.id});
 return {data,result};
}
module.exports={handleTool};
