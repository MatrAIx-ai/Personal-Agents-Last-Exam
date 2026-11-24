'use strict';
// Platform-owned, best-effort diagnostics. Never part of App state or MCP results.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const token=v=>typeof v==='string'&&v.length<=128&&/^[A-Za-z0-9_.:/-]+$/.test(v);
function details(input){
 const out={};
 if(!input||typeof input!=='object'||Array.isArray(input))return out;
 for(const [key,value] of Object.entries(input).slice(0,16)){
  if(['run_id','app_id','call_id','request_id','connection_id'].includes(key))continue;
  if((/^[a-z][a-z0-9_]*_id$/.test(key)||key==='operation')&&token(value))out[key]=value;
  else if(/^[a-z][a-z0-9_]*_count$/.test(key)&&Number.isSafeInteger(value)&&value>=0)out[key]=value;
  else if(['found','conflict'].includes(key)&&typeof value==='boolean')out[key]=value;
  else if(key==='changed_fields'&&Array.isArray(value))out[key]=value.slice(0,16).filter(x=>typeof x==='string'&&/^[a-z][a-z0-9_]{0,63}$/.test(x));
 }
 return out;
}
function createCall({state,role,tool,args={},connection_id,rpc_id}){
 const before={epoch:state.epoch,revision:state.revision};
 const base={schema:'pale.app-debug.v1',call_id:crypto.randomUUID(),run_id:state.run_id,app_id:state.app_id,actor:role,tool:String(tool).slice(0,128),connection_id,
  request_id:token(args.request_id)?args.request_id:null,event_id:token(args.event?.event_id)?args.event.event_id:null,
  rpc_id:typeof rpc_id==='number'||token(rpc_id)?rpc_id:null,epoch:state.epoch,virtual_time:state.virtual_now};
 const rows=[];let dropped=0,closed=false,decision;
 function add(origin,step,extra={}){rows.push({...base,seq:rows.length+1,wall_time:new Date().toISOString(),origin,step,...extra});}
 add('core','core.call.started',{version:before});
 return {
  log(step,input={}){
   try{
    if(closed)return;
    if(rows.length>=65){dropped++;return;}
    if(typeof step!=='string'||step.length>96||!step.startsWith(state.app_id+'.')||!/^\w+(?:\.\w+)*$/.test(step.slice(state.app_id.length+1))){dropped++;return;}
    add('app',step,{details:details(input)});
   }catch{dropped++;}
  },
  decided(out){decision={status:out.result.status,duplicate:out.result.duplicate===true,version:{epoch:out.state.epoch,revision:out.state.revision},virtual_time:out.state.virtual_now};},
  finish(persisted){
   if(closed)return [];closed=true;
   let step='core.call.persistence_unconfirmed';
   if(persisted&&decision)step=decision.duplicate?'core.call.duplicate':!['ok','ready','committed'].includes(decision.status)?'core.call.rejected':decision.status==='ok'?'core.call.completed':'core.call.committed';
   add('core',step,{status:persisted?(decision?.status||'unconfirmed'):'unconfirmed',persistence:persisted?'confirmed':'unconfirmed',version:decision?.version||before,virtual_time:decision?.virtual_time||state.virtual_now,dropped_steps:dropped});
   return rows;
  }
 };
}
function append(directory,app,rows,{warn=()=>process.stderr.write('PALE diagnostic log write failed; business result unchanged.\n')}={}){
 try{
  if(!rows.length)return true;
  if(!/^[-a-zA-Z0-9_]{1,80}$/.test(app))throw Error('Invalid app log name');
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const file=path.join(directory,app+'.debug.jsonl');
  // Do not follow a pre-existing symlink in a configured state directory.
  const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_APPEND|fs.constants.O_NOFOLLOW,0o600);
  try{fs.writeFileSync(fd,rows.map(row=>JSON.stringify(row)).join('\n')+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  return true;
 }catch{try{warn();}catch{}return false;}
}
module.exports={createCall,append};
