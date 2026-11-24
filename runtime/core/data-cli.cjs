#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {createRuntime}=require('./runtime.cjs'),{inside}=require('./registry.cjs'),assets=require('./assets.cjs');
function pack(app,input,runtime=createRuntime()){
 const root=fs.realpathSync(input),read=n=>JSON.parse(fs.readFileSync(inside(root,n),'utf8')),p=runtime.get(app);
 const data=read('seed.json'),dataset=read('dataset.json'),catalog=read('catalog.json');
 const bundle=assets.fromPackage({dir:root,dataset,resources:{catalog,directory:inside(root,'assets')}},inside);
 const binding=fs.existsSync(path.join(root,'binding.json'))?read('binding.json'):runtime.configs.get(app).binding;
 const policies=fs.existsSync(path.join(root,'policies.json'))?read('policies.json'):runtime.configs.get(app).policies;
 const s=runtime.create(app,'package-check'),out=runtime.execute(s,'infra','env.load_seed',{data,binding,policies,bundle,expected_version:runtime.version(s),request_id:'package-check'});
 if(out.result.status!=='ready')throw new Error(out.result.message||out.result.status);
 return {payload:{data,binding,policies,bundle},quality:out.result.quality};
}
function main(){
 const [action,app,input,output]=process.argv.slice(2),root=path.resolve(__dirname,'..'),runtime=createRuntime();
 if(action==='verify'){
  const reports={};for(const [id,p] of runtime.registry.apps){reports[id]=p.quality;fs.mkdirSync(path.join(p.dir,'datasets'),{recursive:true});fs.writeFileSync(path.join(p.dir,'datasets/quality-report.json'),JSON.stringify(p.quality,null,2)+'\n');console.log(id+': automatic checks PASS; human review '+p.quality.review.status);}
  return reports;
 }
 if(action==='pack'&&app&&input&&output){const {payload,quality}=pack(app,input,runtime);fs.writeFileSync(path.resolve(output),JSON.stringify(payload,null,2)+'\n');console.log('Packed '+app+': '+quality.counts.assets+' assets; '+quality.counts.total_bytes+' bytes; submission_ready='+quality.submission_ready);return;}
 throw new Error('Usage: node core/data-cli.cjs verify | pack APP INPUT_DIRECTORY OUTPUT_JSON');
}
module.exports={pack};if(require.main===module)try{main();}catch(e){console.error(e.message);process.exitCode=1;}
