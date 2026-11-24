'use strict';
const path=require('node:path'),readline=require('node:readline'),{create}=require('./src/router.cjs');
(async()=>{
 const o={};for(let i=2;i<process.argv.length;i+=2){const k=process.argv[i],v=process.argv[i+1];if(!['--config','--publisher','--run','--state-dir'].includes(k)||!v)throw new Error('Invalid trusted Router launcher options');o[k.slice(2)]=v;}
 const router=await create({config:o.config,publisher:o.publisher,run:o.run,stateDir:o['state-dir']||path.resolve(__dirname,'../../.state')});
 let initialized=false,ready=false,queue=Promise.resolve();
 const send=(id,result)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\n');
 const error=(id,code,message)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,error:{code,message}})+'\n');
 async function handle(m){
  if(!m||Array.isArray(m)||m.jsonrpc!=='2.0'||typeof m.method!=='string')return error(m?.id??null,-32600,'Invalid request');
  if(m.id===undefined){if(m.method==='notifications/initialized'&&initialized)ready=true;return;}
  if(m.method==='initialize'){
   if(initialized||typeof m.params?.protocolVersion!=='string'||!m.params.clientInfo||!m.params.capabilities)return error(m.id,-32602,'Invalid initialize');
   initialized=true;return send(m.id,{protocolVersion:'2025-11-25',capabilities:{tools:{listChanged:false}},serverInfo:{name:'pale-message-router',version:'1.2.0'},instructions:'App publisher connection. Source/run fixed by Infra. Never pass this connection to the target Agent.'});
  }
  if(m.method==='ping')return send(m.id,{});
  if(!ready)return error(m.id,-32002,'Initialize first');
  if(m.method==='tools/list')return send(m.id,{tools:router.definitions});
  if(m.method==='tools/call'){
   if(typeof m.params?.name!=='string')return error(m.id,-32602,'Missing tool name');
   const result=await router.call(m.params.name,m.params.arguments||{});
   return send(m.id,{content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result,isError:!['ok','committed'].includes(result.status)});
  }
  error(m.id,-32601,'Method unavailable');
 }
 const input=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
 input.on('line',line=>{let m;try{if(Buffer.byteLength(line)>2*1024*1024)throw Error();m=JSON.parse(line);}catch{error(null,-32700,'Invalid / oversized JSON');return;}queue=queue.then(()=>handle(m)).catch(()=>error(m.id??null,-32603,'Router failure'));});
 input.on('close',()=>queue.finally(()=>router.close()));
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>router.close().finally(()=>process.exit(0)));
})().catch(e=>{process.stderr.write(e.message+'\n');process.exitCode=1;});
