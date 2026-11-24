'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process'),readline=require('node:readline');
const {Client}=require('../client.cjs');

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(check,message,timeout=5000){
 const until=Date.now()+timeout;
 while(Date.now()<until){if(check())return;await delay(10);}
 throw new Error(message);
}
async function stop(child){
 if(child.exitCode!==null||child.signalCode!==null)return;
 await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGKILL');});
}

(async()=>{
 const app='mail',run='lost-ack',dir=fs.mkdtempSync(path.join(os.tmpdir(),'pale-lost-ack-'));
 const stateFile=path.join(dir,run,app+'.json'),clients=[];
 let lostAckProcess;
 try{
  const infra=new Client(app,'infra',run,dir);clients.push(infra);await infra.initialize();
  const initial=await infra.call('env.snapshot');
  assert.equal(initial.snapshot.data.messages.find(message=>message.id==='materials').read,false);
  const requestArgs={id:'materials',read:true,expected_version:initial.version,request_id:'lost-ack-write'};
  await infra.close();

  lostAckProcess=spawn(process.execPath,[path.join(__dirname,'../mcp-server.cjs'),'--app',app,'--role','agent','--run',run,'--state-dir',dir],{stdio:['pipe','pipe','pipe']});
  const lines=readline.createInterface({input:lostAckProcess.stdout});
  let responseWasDropped=false,serverErrors='';
  lostAckProcess.stderr.on('data',chunk=>{serverErrors+=chunk;});
  const initialized=new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('Agent MCP initialize timed out: '+serverErrors)),5000);
   lines.on('line',line=>{
    const message=JSON.parse(line);
    if(message.id===1){clearTimeout(timer);if(message.error)reject(new Error(JSON.stringify(message.error)));else resolve();}
    else if(message.id===2)responseWasDropped=true;
   });
   lostAckProcess.once('exit',code=>{clearTimeout(timer);reject(new Error(`Agent MCP exited before initialize (${code}): ${serverErrors}`));});
  });
  lostAckProcess.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'lost-ack-test',version:'1.0.0'}}})+'\n');
  await initialized;
  lostAckProcess.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized',params:{}})+'\n');
  lostAckProcess.stdin.write(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'mail.flags.update',arguments:requestArgs}})+'\n');

  let committed;
  await waitFor(()=>{
   if(!fs.existsSync(stateFile))return false;
   committed=JSON.parse(fs.readFileSync(stateFile,'utf8'));
   return committed.revision===initial.version.revision+1
    &&committed.data.messages.find(message=>message.id==='materials').read===true
    &&responseWasDropped;
  },'Agent write did not commit with its response dropped: '+serverErrors);
  const originalResult=committed.receipts['request:'+requestArgs.request_id].result;
  await stop(lostAckProcess);
  lostAckProcess=null;

  const restarted=new Client(app,'agent',run,dir);clients.push(restarted);await restarted.initialize();
  const retry=await restarted.call('mail.flags.update',requestArgs);
  assert.equal(retry.status,'committed');
  assert.equal(retry.duplicate,true);
  const {duplicate,...replayedResult}=retry;
  assert.deepEqual(replayedResult,originalResult,'retry returns the original committed result');
  const afterRetry=JSON.parse(fs.readFileSync(stateFile,'utf8'));
  assert.equal(afterRetry.revision,committed.revision,'retry does not commit a second write');
  assert.equal((await restarted.call('mail.get',{id:'materials'})).message.read,true,'committed business state survives MCP restart');

  const conflict=await restarted.call('mail.flags.update',{...requestArgs,read:false});
  assert.equal(conflict.status,'idempotency_conflict','changed arguments with the same request ID are rejected');
  assert.equal(JSON.parse(fs.readFileSync(stateFile,'utf8')).revision,committed.revision,'conflict leaves business state unchanged');
  console.log('PASS: lost acknowledgment retry survives MCP restart, returns the original result, and commits once.');
 }finally{
  if(lostAckProcess)await stop(lostAckProcess);
  await Promise.all(clients.map(client=>client.close()));
  fs.rmSync(dir,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
