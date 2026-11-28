'use strict';
// Execute this file from the maintainer-selected base runtime for App-only PRs.
const fs=require('node:fs'),path=require('node:path'),{verify}=require('../verify.cjs');
const {discover,selection}=require('./select-apps.cjs');
(async()=>{
 const candidate=path.resolve(process.argv[2]||'.'),out=path.resolve(process.argv[3]||'.artifacts/submissions'),apps=discover(candidate);
 const selected=selection(candidate,process.argv[4]);
 if(!apps.size)throw Error('No App packages found');fs.mkdirSync(out,{recursive:true});let passed=true;
 fs.writeFileSync(path.join(out,'selection.json'),JSON.stringify(selected,null,2)+'\n');
 for(const id of selected.ids){const app=apps.get(id),dependencies=new Set();function visit(manifest){for(const dep of manifest.dependencies){if(dependencies.has(dep.app_id))continue;const other=apps.get(dep.app_id);if(!other||other.manifest.version!==dep.version)throw Error('Missing pinned dependency: '+dep.app_id);dependencies.add(dep.app_id);visit(other.manifest);}}visit(app.manifest);dependencies.delete(id);
  const report=await verify(app.location,{dependencies:[...dependencies].map(x=>apps.get(x).location)});fs.writeFileSync(path.join(out,id+'.json'),JSON.stringify(report,null,2)+'\n');console.log(id+': '+(report.passed?'PASS':'FAIL'));passed=passed&&report.passed;
 }
 if(!passed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
