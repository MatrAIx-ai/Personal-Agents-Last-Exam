'use strict';
// One-hop, synchronous bridge. App contracts own channels and receiver operations.
const fs=require('node:fs'),path=require('node:path');
const {Client}=require('../../client.cjs'),{createRuntime}=require('../../core/runtime.cjs');
const {inside}=require('../../core/registry.cjs'),{compile}=require('../../core/schema.cjs');
const {extensions}=require('../../core/contribution.cjs');
const contracts=require('./contracts.cjs'),configuration=require('./config.cjs');
const bindings=require('./bindings.cjs'),authorization=require('./authorization.cjs'),cloudEvents=require('../../core/cloud-events.cjs');
const {packagePath,digest}=contracts,root=path.resolve(__dirname,'../../..');
function insist(ok,message){if(!ok)throw new Error(message);}
async function create({config=path.join(root,'examples/workflows/delivery-to-mail/config.json'),publisher,run,stateDir}){
 insist(/^[-a-zA-Z0-9_]{1,80}$/.test(run),'Invalid fixed run');
 const c=configuration.load(config);
 const namespace=c.receiver_state_namespace;insist(namespace===undefined||typeof namespace==='string'&&/^[-a-zA-Z0-9_]{1,80}$/.test(namespace),'Invalid receiver state namespace');
 const receiverStateDir=namespace?path.join(path.resolve(stateDir),namespace):stateDir;
 const sources=c.publishers.filter(p=>p.app_id===publisher);insist(sources.length===1,'Publisher must be uniquely approved by Infra');
 // Infra approves a package root relative to the runtime repository. Both the
 // contribution and its schema refs are relative to that package, like App refs.
 const source=sources[0],sourceRoot=packagePath(root,source.package_root,'Publisher package_root');
 const sourceContract=contracts.load({packageRoot:sourceRoot,contributionRef:source.contribution_ref,appId:publisher});
 const outgoing=sourceContract.publishes;
 // Reject invalid publisher paths/contracts before opening receiver clients or
 // creating run/session files, so a corrected config can use the same fresh run.
 const registry=inside(root,c.registry),model=createRuntime({registryFile:registry}),clients=[],receivers=[];
 const directory=path.join(path.resolve(stateDir),run);fs.mkdirSync(directory,{recursive:true,mode:0o700});
 const receipts=require('./receipts.cjs').create(directory);
 const stopFile=path.join(directory,'router.halted.json'),lock=path.join(directory,'router.lock');
 // A source identity may not reconnect to an old run: in-memory acknowledgements do not survive a crash.
 const session=path.join(directory,'router-'+digest(source).slice(0,16)+'.session');
 const fd=fs.openSync(session,'wx',0o600);fs.writeFileSync(fd,JSON.stringify({run,publisher}));fs.closeSync(fd);
 try{
  for(const id of model.configs.keys()){
   const pkg=model.get(id),contract=contracts.load({packageRoot:pkg.dir,contributionRef:pkg.manifest.contribution,appId:id}),incoming=contract.receives;if(!incoming.length)continue;
   const client=new Client(id,'infra',run,receiverStateDir,'pale-router-receiver',{registry});clients.push(client);await client.initialize();
   const s=(await client.call('env.snapshot')).snapshot;
   for(const entry of incoming)receivers.push(bindings.bind({entry,appId:id,snapshot:s,client,run}));
  }
 }catch(e){await Promise.all(clients.map(c=>c.close()));throw e;}
 const input={type:'object',properties:{request_id:{type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,149}$'},message:outgoing.length?{anyOf:outgoing.map(e=>e.schema)}:{type:'object',enum:[]}},required:['request_id','message'],additionalProperties:false};
 const validInput=outgoing.length?compile(input,root):()=>false;
 const definitions=[{name:'router.capabilities',description:'Channels this fixed publisher may use; no admin or receiver credentials.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true}}];
 if(outgoing.length)definitions.push({name:'router.publish',description:'Infra messaging: publish one CloudEvents 1.0 JSON event under the fixed source/run identity. Await committed before Infra advances.',inputSchema:input,annotations:{readOnlyHint:false}});
 const halted=(status,code,extra={})=>{const result={status,code,run_id:run,stop_run:true,...extra};fs.writeFileSync(stopFile,JSON.stringify(result),{mode:0o600});return result;};
 async function publish(args,receivedAt){
  if(fs.existsSync(stopFile))return {status:'halted',code:'run_halted',stop_run:true};
  if(!validInput(args)||!cloudEvents.valid(args.message))return {status:'rejected',code:'invalid_arguments'};
  const message=args.message,entry=outgoing.find(e=>e.channel===message.data.channel&&e.event_type===message.type&&e.payload_schema_id===message.dataschema);
  if(!entry)return {status:'rejected',code:'incompatible_contract'};
  try{extensions(message);}catch{return {status:'rejected',code:'required_extension_unsupported'};}
  if(!authorization.sourceMatches(source,message))return {status:'rejected',code:'source_identity_mismatch'};
  const previous=receipts.lookup(args.request_id,message);
  if(previous.conflict)return {status:'rejected',code:'idempotency_conflict'};
  const {prior}=previous,resolved=bindings.resolve(receivers,entry.channel,message.data.recipient);
  if(resolved.error)return {status:'rejected',code:resolved.error};
  const target=resolved.target;
  if(!authorization.allows(source,target,entry.channel))return {status:'rejected',code:'recipient_not_authorized'};
  if(target.schema_id!==entry.schema_id||target.event_type!==entry.event_type||target.payload_schema_id!==entry.payload_schema_id||target.hash!==entry.hash||!target.valid(message))return {status:'rejected',code:'incompatible_contract'};
  try{fs.mkdirSync(lock,{mode:0o700});}catch(e){if(e.code==='EEXIST')return halted('rejected','concurrent_dispatch');throw e;}
  let event_id;
  try{
   const snap=await target.client.call('env.snapshot'),s=snap.snapshot;
   if(!bindings.unchanged(target,s,run))return halted('rejected','receiver_lifecycle_changed');
   if(prior){receipts.commit(args.request_id,message,prior.result);return {...prior.result,duplicate:true};}
   event_id='router-'+digest({run,source:message.source,id:message.id,target:target.app_id,account:target.account_id,epoch:target.epoch}).slice(0,32);
   const event={event_id,at:s.virtual_now,operation:target.operation,payload:{recipient_account_id:target.account_id,message}};
   const receipt=await target.client.call(target.mcp_tool,{expected_version:snap.version,event});
   if(receipt.status!=='committed')return halted('rejected','receiver_rejected',{event_id,reason:receipt.status,receiver_trace:receipt.trace||null});
   const result={status:'committed',run_id:run,source_app:source.app_id,channel:entry.channel,target:{app_id:target.app_id,account_id:target.account_id},cloud_event:cloudEvents.metadata(message),event_id,version:receipt.version,received_at:receivedAt,applied_at:s.virtual_now,committed_at:new Date().toISOString(),receiver_trace:receipt.trace||null};
   receipts.commit(args.request_id,message,result);return result;
  }catch{return halted('unknown','receiver_unconfirmed',event_id?{event_id}:{});}
  finally{fs.rmdirSync(lock);}
 }
 return {definitions,async call(name,args={}){
  if(name==='router.capabilities'&&args&&typeof args==='object'&&!Array.isArray(args)&&!Object.keys(args).length)return {status:'ok',module:'infra/messaging',run_id:run,publisher:source.app_id,envelope:'cloudevents/1.0',media_type:'application/cloudevents+json',app_messaging:sourceContract.summary,authentication:{mode:'trusted-stdio',identity_source:'trusted-launcher',remote_oauth:'not_implemented'},channels:outgoing.map(e=>({channel:e.channel,schema_id:e.schema_id,event_type:e.event_type,payload_schema_id:e.payload_schema_id})),halted:fs.existsSync(stopFile)};
  if(name==='router.publish'&&outgoing.length){
   const receivedAt=new Date().toISOString(),result={received_at:receivedAt,...await publish(args,receivedAt)};
   // Retries retain the original successful receipt; the log records each new attempt.
   try{receipts.audit(validInput(args)?args.request_id:null,validInput(args)?args.message:null,result,{run_id:run,received_at:receivedAt});}catch{return halted('unknown','receipt_audit_failed',{received_at:receivedAt,...(result.event_id?{event_id:result.event_id}:{})});}return result;
  }
  return {status:'permission_denied',code:'operation_unavailable'};
 },close:()=>Promise.all(clients.map(c=>c.close()))};
}
module.exports={create};
