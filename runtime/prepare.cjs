'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createRuntime}=require('./core/runtime.cjs');
// Copy the exact packages into a disposable registry. This is reproducibility,
// not an operating-system security boundary for untrusted App code.
function prepare(appDirectory,dependencies=[]){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'pale-app-check-'));
 try{
  const entries=[];
  for(const input of [appDirectory,...dependencies]){
   const source=fs.realpathSync(input),manifest=JSON.parse(fs.readFileSync(path.join(source,'app.json'),'utf8'));
   if(!/^[a-z][a-z0-9-]*$/.test(manifest.app_id)||entries.some(x=>x.app_id===manifest.app_id))throw Error('Invalid or duplicate App ID');
   const ref='apps/'+manifest.app_id;fs.cpSync(source,path.join(root,ref),{recursive:true});
   entries.push({app_id:manifest.app_id,version:manifest.version,path:ref});
  }
  const clockFile=path.join(fs.realpathSync(appDirectory),'fixtures/clock.json');
  const initial_time=fs.existsSync(clockFile)?JSON.parse(fs.readFileSync(clockFile,'utf8')).initial_time:'1970-01-01T00:00:00Z';
  const registry=path.join(root,'registry.json');fs.writeFileSync(registry,JSON.stringify({schema_version:1,initial_time,apps:entries}));
  const model=createRuntime({registryFile:registry});
  return {root,registry,app:entries[0].app_id,model,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
 }catch(e){fs.rmSync(root,{recursive:true,force:true});throw e;}
}
module.exports={prepare};
