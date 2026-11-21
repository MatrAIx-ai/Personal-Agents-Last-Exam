'use strict';
// Isolated real MCP experiment. Two Mail instances, one run, separate state roots.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {Client}=require('../../../runtime/client.cjs'),publisher=require('../../apps/mail/src/publisher.cjs');
const root=path.resolve(__dirname,'../../..'),read=p=>JSON.parse(fs.readFileSync(path.join(root,p))),copy=x=>structuredClone(x);
const CASES=['allowed','readonly','no_grant','spoof_source','cross_run','admin','invalid_event'];
function input(options={}){
 if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['case','subject','body'].includes(k)))throw new Error('Unsupported experiment fields');
 const value={case:options.case||'allowed',subject:options.subject??'Mail → Mail · 评审材料',body:options.body??'Alex，这是一个通过真实本地 MCP 和 Router 投递的合成消息。'};
 if(!CASES.includes(value.case)||typeof value.subject!=='string'||!value.subject.trim()||value.subject.length>200||typeof value.body!=='string'||value.body.length>20000)throw new Error('Invalid experiment input');return value;
}
function seed(account,owner,messages){return {account_id:account,owner_person_id:owner,address:account+'@pale.example',messages};}
function bundle(records){const dataset=read('examples/apps/mail/contribution/dataset.json');dataset.dataset_id='mail-to-mail-fixture';dataset.description='Synthetic two-mailbox authorization experiment';dataset.expected_counts={records,assets:0};return {dataset,catalog:{schema_version:'pale.asset-catalog.v1',catalog_id:'mail-to-mail-empty',app_id:'mail',dataset_ref:'dataset.json',assets:[],extensions:[]},blobs:{}};}
async function run(options={}){
 const spec=input(options),run_id='m2m-'+crypto.randomUUID().slice(0,12),dir=fs.mkdtempSync(path.join(os.tmpdir(),'pale-mail-to-mail-')),clients=[];
 const make=async(role,instance)=>{const c=new Client('mail',role,run_id,path.join(dir,instance),'tab7-'+instance+'-'+role,{registry:path.join(root,'examples/registry.mail.json')});clients.push(c);await c.initialize();return c;};
 try{
  const ia=await make('infra','mail-a'),ib=await make('infra','mail-b');
  const binding={people:[{person_id:'person-maya',name:'Maya'},{person_id:'person-alex',name:'Alex'}],accounts:[{app_id:'mail',account_id:'mail-a',owner_person_id:'person-maya'},{app_id:'mail',account_id:'mail-b',owner_person_id:'person-alex'}],objects:{}};
  const draft={id:'draft-lab',thread_id:'tab7',account_id:'mail-a',from:'mail-a@pale.example',to:['mail-b@pale.example'],subject:spec.subject,body:spec.body,received_at:'2026-11-15T09:00:00-08:00',folder:'drafts',read:true,attachments:[]};
  const policy=allow=>({scenario:{allow,constraints:allow.includes('mail.send')?{'mail.send':{ids:['draft-lab']}}:{}},sandbox:{allow:['mail.search','mail.get'],constraints:{}}});
  for(const [client,data,policies] of [[ia,seed('mail-a','person-maya',[draft]),policy(['mail.search','mail.get',...(spec.case==='readonly'?[]:['mail.send'])])],[ib,seed('mail-b','person-alex',[]),policy(['mail.search','mail.get'])]]){
   const before=await client.call('env.snapshot'),loaded=await client.call('env.load_seed',{expected_version:before.version,request_id:'initialize',data,binding,policies,bundle:bundle(data.messages.length)});
   if(loaded.status!=='ready')throw new Error('Experiment fixture failed to load: '+JSON.stringify(loaded));
  }
  const a=await make('agent','mail-a'),b=await make('agent','mail-b'),beforeA=await ia.call('env.snapshot'),beforeB=await ib.call('env.snapshot');
  const config=read('examples/workflows/mail-to-mail/router.json');if(spec.case==='no_grant')config.publishers[0].allowed_recipients=[];
  const configFile=path.join(dir,'router.json');fs.writeFileSync(configFile,JSON.stringify(config));
  const router=new Client(null,null,null,null,'tab7-mail-publisher',{commandArgs:[path.join(root,'runtime/messaging/service.cjs'),'--config',configFile,'--publisher','mail','--run',run_id,'--state-dir',dir]});clients.push(router);await router.initialize();
  const agentTools=(await a.request('tools/list')).result.tools.map(t=>t.name),routerTools=(await router.request('tools/list')).result.tools.map(t=>t.name);
  let execution,wire=null,duplicate=null,changedRetry=null,eventDuplicate=null,observed=null,adminProbe=null;
  if(spec.case==='admin'){
   adminProbe={agent:await a.call('env.reset',{expected_version:beforeA.version}),publisher:await router.call('env.reset',{})};execution={stage:'admin_authorization',result:adminProbe.publisher};
  }else{
   const instrumented={call:async(name,args)=>{wire=copy(args);if(spec.case==='spoof_source')wire.message.source='urn:pale:app:mail:account:mail-victim';if(spec.case==='cross_run')wire.run_id='another-run';if(spec.case==='invalid_event')wire.message.specversion='1.0.2';return router.call(name,wire);}};
   execution=await publisher.send({agent:a,router:instrumented,messageId:'draft-lab',requestId:'tab7-send',sourceAccount:'mail-a',recipient:{account_id:'mail-b',address:'mail-b@pale.example'}});
   if(execution.result.status==='committed'){
    observed=await b.call('mail.get',{id:execution.result.event_id});duplicate=await router.call('router.publish',wire);
    eventDuplicate=await router.call('router.publish',{...copy(wire),request_id:'another-request-same-event'});
    const changed=copy(wire);changed.message.data.content.body.text+=' changed';changedRetry=await router.call('router.publish',changed);
   }
  }
  const afterA=await ia.call('env.snapshot'),afterB=await ib.call('env.snapshot');
  const expected={allowed:'committed',readonly:'permission_denied',no_grant:'recipient_not_authorized',spoof_source:'source_identity_mismatch',cross_run:'invalid_arguments',admin:'operation_unavailable',invalid_event:'invalid_arguments'}[spec.case];
  const code=execution.result.code||execution.result.status,delivered=execution.result.status==='committed';
  const checks=[
   {label:'两个 Mail 实例使用同一 run、独立状态目录',passed:afterA.snapshot.run_id===afterB.snapshot.run_id&&afterA.snapshot.data.account_id!==afterB.snapshot.data.account_id},
   {label:'实际权限结果符合所选实验',passed:code===expected},
   {label:'拒绝投递时 B 的业务状态与版本不变',passed:delivered||JSON.stringify(beforeB.snapshot.data)===JSON.stringify(afterB.snapshot.data)&&JSON.stringify(beforeB.version)===JSON.stringify(afterB.version)},
   {label:'Agent 和发布连接均看不到管理工具',passed:!agentTools.some(n=>n.startsWith('env.'))&&!routerTools.some(n=>n.startsWith('env.'))},
   {label:'允许投递时仅生成一封未读邮件；内容来自 A',passed:!delivered||afterB.snapshot.data.messages.length===1&&observed?.message?.subject===spec.subject&&observed.message.body===spec.body&&observed.message.from==='mail-a@pale.example'&&!observed.message.read},
   {label:'重复请求去重；同 ID 改内容被拒绝',passed:!delivered||duplicate?.duplicate===true&&changedRetry?.code==='idempotency_conflict'},
   {label:'更换 request_id，仍按 CloudEvents source + id 去重',passed:!delivered||eventDuplicate?.duplicate===true&&eventDuplicate.event_id===execution.result.event_id},
   {label:'只读或管理越权测试不改变 A 的业务数据',passed:!['readonly','admin'].includes(spec.case)||JSON.stringify(beforeA.snapshot.data)===JSON.stringify(afterA.snapshot.data)}
  ];
  const receiptFile=path.join(dir,run_id,'messaging.receipts.jsonl'),receipts=fs.existsSync(receiptFile)?fs.readFileSync(receiptFile,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
  return {schema:'pale.mail-to-mail-trace.v2',module:'infra/messaging',protocols:{transport:'MCP stdio',envelope:'CloudEvents 1.0 JSON profile',asyncapi:false,remote_oauth:false},case:spec.case,run_id,passed:checks.every(c=>c.passed),execution:{stage:execution.stage,local:execution.local||null,result:execution.result},wire,duplicate,event_duplicate:eventDuplicate,receipts,changed_retry:changedRetry,admin_probe:adminProbe,observed,source:{instance:'mail-a',owner:'Maya',account_id:'mail-a',address:'mail-a@pale.example',state_path:'mail-a/'+run_id+'/mail.json',before_version:beforeA.version,version:afterA.version,messages:afterA.snapshot.data.messages,tools:agentTools},target:{instance:'mail-b',owner:'Alex',account_id:'mail-b',address:'mail-b@pale.example',state_path:'mail-b/'+run_id+'/mail.json',before_version:beforeB.version,version:afterB.version,messages:afterB.snapshot.data.messages},authorization:{mode:'trusted-local-stdio',run_binding:'launcher-fixed',agent_policy:beforeA.snapshot.policies.scenario,router_tools:routerTools,recipient_grants:config.publishers[0].allowed_recipients,receiver_connection:'trusted Infra MCP; restricted delivery role not yet implemented',tokens:'No token is issued or validated in this local example'},checks};
 }finally{await Promise.allSettled(clients.map(c=>c.close()));fs.rmSync(dir,{recursive:true,force:true});}
}
module.exports={run,input,CASES};
if(require.main===module)run({case:process.argv[2]||'allowed'}).then(trace=>{if(!trace.passed)throw new Error(JSON.stringify(trace));if(process.argv[3])fs.writeFileSync(path.resolve(process.argv[3]),JSON.stringify(trace,null,2)+'\n');console.log(JSON.stringify(trace,null,2));console.log('PASS: '+trace.checks.length+' Mail-to-Mail real MCP checks.');}).catch(e=>{console.error(e);process.exitCode=1;});
