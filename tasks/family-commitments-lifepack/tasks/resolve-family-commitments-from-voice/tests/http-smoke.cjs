'use strict';
const {spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {once}=require('node:events');
const root=path.resolve(__dirname,'..');
const run=(program,args,env)=>new Promise((resolve,reject)=>{
  const p=spawn(program,args,{env,stdio:['ignore','pipe','pipe']});let logs='';
  p.stdout.on('data',x=>logs+=x);p.stderr.on('data',x=>logs+=x);
  p.on('error',reject);p.on('exit',code=>code?reject(Error(logs)):resolve(logs));
});
async function main(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'family-http-'));
  const env={...process.env,PRIVATE_LOGS:path.join(dir,'private'),RESULT_DIR:path.join(dir,'result'),PORT:'0',VARIANT:'restricted',REPLY:'answered',HINT_MODE:'hinted'};
  const child=spawn(process.execPath,[path.join(root,'environment/service.cjs')],{env,stdio:['ignore','pipe','inherit']});
  const exit=once(child,'exit');
  try{
    const [info]=await Promise.race([once(child.stdout,'data'),exit.then(()=>{throw Error('Controller stopped before becoming ready');})]);
    const port=String(info).match(/listening (\d+)/)[1];env.FAMILY_ENDPOINT='http://127.0.0.1:'+port+'/action';
    const request=async action=>(await fetch(env.FAMILY_ENDPOINT,{method:'POST',body:JSON.stringify(action)})).json();
    assert.equal((await request({op:'folder',name:'Bakery order card'})).result,null);
    const text=await run(path.join(root,'solution/solve.sh'),[],env);
    assert.equal(text,'');
    assert.equal((await request({op:'observe'})).error,'trial has ended');
    env.FAMILY_SCORE=path.join(env.RESULT_DIR,'score.json');env.VERIFIER_DIR=path.join(dir,'verifier');
    await run(path.join(root,'tests/test.sh'),[],env);
    const score=JSON.parse(fs.readFileSync(path.join(env.VERIFIER_DIR,'score.json')));
    assert.equal(score.points,100);assert.equal(fs.readFileSync(path.join(env.VERIFIER_DIR,'reward.txt'),'utf8'),'1\n');
    const trace=JSON.parse(fs.readFileSync(path.join(env.PRIVATE_LOGS,'trace.json')));
    assert.deepEqual(trace.trace.filter(e=>e.hint).map(e=>e.stage),['discussion','withdrawal']);
    console.log(JSON.stringify({mode:'separate processes, localhost HTTP',scope:'restricted/answered, same oracle and verifier entry points as Compose',score,terminal_lock:true,early_asset_hidden:true}));
  }finally{child.kill('SIGTERM');await exit;fs.rmSync(dir,{force:true,recursive:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
