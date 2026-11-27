'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),plugin=require('../plugin.cjs');
function fixture(){
  let data=structuredClone(require('../fixtures/minimal.json'));const files=new Map();
  for(const a of require('../contribution/assets.catalog.json').assets){const bytes=fs.readFileSync(path.join(__dirname,'..',a.storage.path));files.set(a.asset_id,{filename:path.basename(a.storage.path),mime_type:a.mime_type,base64:bytes.toString('base64'),sha256:a.integrity.sha256});}
  const ctx={app_id:'claimline',run_id:'unit',role:'agent',binding:require('../fixtures/binding.json'),virtual_now:'2026-11-09T09:00:00-08:00',assets:{read:id=>{if(!files.has(id))throw Error('Missing fixture asset');return structuredClone(files.get(id));},add:({object_id,files:incoming})=>incoming.map(file=>{if(crypto.createHash('sha256').update(Buffer.from(file.base64,'base64')).digest('hex')!==file.sha256)throw Error('Bad asset hash');const id='test-asset-'+object_id;files.set(id,structuredClone(file));return id;})}};
  return {ctx,get data(){return data;},set data(value){data=value;},tool(name,args={}){const out=plugin.handleTool(ctx,data,'claimline.'+name,args);data=out.data;return out.result;},event(operation,payload,at=ctx.virtual_now){ctx.virtual_now=at;data=plugin.applyEvent({...ctx,role:'infra'},data,{event_id:'unit-event',at,operation:'expense.'+operation,payload});return data;}};
}
function prepareReport(f){
  for(const source of f.data.receipt_sources){let receipt=f.data.receipts.find(r=>r.source_record_id===source.id);if(!receipt){const {file}=f.tool('receipts.download',{id:source.id});receipt=f.tool('receipts.register',{source_record_id:source.id,file}).receipt;}const line=f.data.lines.find(l=>l.merchant===source.merchant&&l.date===source.date&&l.amount_cents===source.amount_cents);if(!line.receipt_id)f.tool('matches.confirm',{line_id:line.id,receipt_id:receipt.id});}
  f.tool('lines.itemize',{id:'line-1',items:f.data.receipt_sources[0].items});f.tool('lines.update',{id:'line-3',patch:{explanation:'Conference team dinner; higher cost explained in employee trip brief.'}});
  return f.tool('reports.preview',{id:'report-1'}).preview;
}
function submit(f){prepareReport(f);return f.tool('reports.submit',{id:'report-1'}).report;}
function review(f,extra={}){f.event('review_recorded',{report_id:'report-1',report_revision:f.data.reports[0].revision,decision:'approved',reason:'Original evidence and business purpose checked.',source_ref:'reviewer-proof-1',...extra});}
module.exports={fixture,prepareReport,submit,review};
