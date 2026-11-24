'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../..'),{Client}=require('../../client.cjs');
const contracts=require('../src/contracts.cjs'),configuration=require('../src/config.cjs');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p))),copy=x=>structuredClone(x);
let count=0;const check=(v,m)=>{assert.ok(v,m);count++;};
(async()=>{
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'pale-router-package-'));
 const fixture=fs.mkdtempSync(path.join(root,'examples/workflows/delivery-to-mail/.package-contract-')),clients=[];
 try{
  fs.mkdirSync(path.join(fixture,'contribution'));fs.mkdirSync(path.join(fixture,'schemas'));
  const declaration=read('examples/apps/mail/contribution/contribution.json');
  for(const name of ['router-message','router-attachments'])fs.writeFileSync(path.join(fixture,'schemas/'+name+'.schema.json'),JSON.stringify(read('examples/apps/mail/schemas/'+name+'.schema.json')));
  const declarationFile=path.join(fixture,'contribution/contribution.json'),configFile=path.join(data,'config.json');
  // Same config for all four directions. Only the App's declaration changes.
  const config={schema_version:2,registry:'examples/registry.calendar.json',authentication:{mode:'trusted-stdio'},publishers:[{app_id:'mail',account_id:'mail-a',owner_person_id:'person-maya',package_root:path.relative(root,fixture),contribution_ref:'contribution/contribution.json',allowed_recipients:[]}]};
  fs.writeFileSync(configFile,JSON.stringify(config));
  for(const [send,receive,direction] of [[true,false,'publish-only'],[false,true,'receive-only'],[true,true,'bidirectional'],[false,false,'none']]){
   const d=copy(declaration);d.messaging={envelope:"cloudevents/1.0",publishes:send?declaration.messaging.publishes:[],receives:receive?declaration.messaging.receives:[]};fs.writeFileSync(declarationFile,JSON.stringify(d));
   const c=new Client(null,null,null,null,'router-contract-test',{commandArgs:[path.join(root,'runtime/messaging/service.cjs'),'--config',configFile,'--publisher','mail','--run',direction,'--state-dir',data]});clients.push(c);await c.initialize();
   const names=(await c.request('tools/list')).result.tools.map(x=>x.name),cap=await c.call('router.capabilities');
   check(cap.app_messaging.direction===direction,'MCP direction comes only from App: '+direction);
   check(cap.app_messaging.publishes.length===(send?declaration.messaging.publishes.length:0)&&cap.app_messaging.receives.length===(receive?declaration.messaging.receives.length:0),'directions are independent');
   check(names.includes('router.publish')===send,'only implemented publishing enables tools/call');
   check(cap.authentication.mode==='trusted-stdio'&&!names.some(n=>n.startsWith('env.')),'fixed identity without management tools');
   if(!send)check((await c.call('router.publish',{})).status==='permission_denied','guessing publish cannot bypass an empty declaration');
   check(!fs.existsSync(path.join(data,direction,'calendar.json')),'Calendar without receives is never connected as receiver');
   await c.close();
  }
  for(const status of ['declared','unsupported']){
   const d=copy(declaration);for(const items of [d.messaging.publishes,d.messaging.receives])for(const entry of items)entry.status=status;fs.writeFileSync(declarationFile,JSON.stringify(d));
   const contract=contracts.load({packageRoot:fixture,contributionRef:'contribution/contribution.json',appId:'mail'});
   check(contract.summary.direction==='none','non-implemented capabilities are not activated: '+status);
  }
  // Runtime config must not become a second source of capability declarations.
  for(const [key,value] of [['messaging',declaration.messaging],['publishes',declaration.messaging.publishes],['receives',declaration.messaging.receives],['direction','bidirectional'],['mcp_tool','env.reset']]){
   const d=copy(config);d.publishers[0][key]=value;fs.writeFileSync(configFile,JSON.stringify(d));
   assert.throws(()=>configuration.load(configFile),/Invalid Router config/);count++;
  }
  for(const mutate of [c=>c.messaging=declaration.messaging,c=>c.authentication.mode='anonymous',c=>c.authentication.mode='oauth',c=>c.publishers[0].token='not-a-credential',c=>c.publishers[0].allowed_recipients[0]={app_id:'mail',account_id:'b',channel:'channel.email',role:'infra'},c=>c.receiver_state_namespace='../outside']){
   const d=copy(config);mutate(d);fs.writeFileSync(configFile,JSON.stringify(d));assert.throws(()=>configuration.load(configFile),/Invalid Router config/);count++;
  }
  const duplicate=copy(config);duplicate.publishers.push(copy(duplicate.publishers[0]));fs.writeFileSync(configFile,JSON.stringify(duplicate));assert.throws(()=>configuration.load(configFile),/uniquely approved/);count++;
  for(const file of ['examples/workflows/delivery-to-mail/config.json','examples/workflows/mail-to-mail/router.json'])check(configuration.valid(read(file)),'shipped runtime config conforms: '+file);
  const mail=contracts.load({packageRoot:path.join(root,'examples/apps/mail'),contributionRef:'contribution/contribution.json',appId:'mail'});
  const calendar=contracts.load({packageRoot:path.join(root,'examples/apps/calendar'),contributionRef:'contribution/contribution.json',appId:'calendar'});
  check(mail.summary.direction==='bidirectional'&&calendar.summary.direction==='none','real App packages drive current capabilities');
  console.log('PASS: '+count+' Router package, single App declaration, four directions and trusted-config checks.');
 }finally{await Promise.allSettled(clients.map(c=>c.close()));fs.rmSync(data,{recursive:true,force:true});fs.rmSync(fixture,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
