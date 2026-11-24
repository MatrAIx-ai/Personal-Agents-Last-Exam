'use strict';
// Two deduplication keys: MCP request ID and CloudEvents (source, id).
// In-memory indexes are deliberately not advertised as a crash-recovery queue.
const fs=require('node:fs'),path=require('node:path'),{digest}=require('./contracts.cjs');
const cloudEvents=require('../../core/cloud-events.cjs');
function create(directory){
 const requests=new Map(),events=new Map();let seq=0;
 const eventKey=message=>JSON.stringify([message.source,message.id]);
 return {
  lookup(request,message){
   const fingerprint=digest(message),a=requests.get(request),b=events.get(eventKey(message));
   if([a,b].some(x=>x&&x.fingerprint!==fingerprint))return {conflict:true};
   return {prior:a||b,fingerprint};
  },
  commit(request,message,result){const value={fingerprint:digest(message),result};requests.set(request,value);events.set(eventKey(message),value);},
  audit(request,message,result,{run_id,received_at}){
   // Metadata only: no message body, credentials or full mailbox snapshot.
   fs.appendFileSync(path.join(directory,'messaging.receipts.jsonl'),JSON.stringify({seq:++seq,run_id,received_at,wall_time:new Date().toISOString(),request_id:request,cloud_event:cloudEvents.metadata(message),result})+'\n',{mode:0o600});
  }
 };
}
module.exports={create};
