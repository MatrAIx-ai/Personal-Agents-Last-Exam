#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
function options(args){const out={dependencies:[]};for(let i=0;i<args.length;i+=2){const key=args[i],value=args[i+1];if(!['--app','--with','--output','--role','--run','--state-dir'].includes(key)||!value)throw Error('Unknown or missing option: '+key);if(key==='--with')out.dependencies.push(path.resolve(value));else out[key.slice(2)]=value;}if(!out.app)throw Error('--app PATH is required');out.app=path.resolve(out.app);return out;}
async function main(){
 const [action,...args]=process.argv.slice(2),o=options(args);
 if(action==='verify'){
  const report=await require('./verify.cjs').verify(o.app,{dependencies:o.dependencies});
  const text=JSON.stringify(report,null,2)+'\n';
  if(o.output){fs.mkdirSync(path.dirname(path.resolve(o.output)),{recursive:true});fs.writeFileSync(path.resolve(o.output),text);}
  process.stdout.write(text);if(!report.passed)process.exitCode=1;return;
 }
 if(action==='serve'){
  if(!['agent','infra'].includes(o.role))throw Error('--role agent|infra is required');
  const prepared=require('./prepare.cjs').prepare(o.app,o.dependencies);
  const child=spawn(process.execPath,[path.join(__dirname,'mcp-server.cjs'),'--app',prepared.app,'--role',o.role,'--registry',prepared.registry,'--run',o.run||'demo','--state-dir',path.resolve(o['state-dir']||'.state')],{stdio:'inherit'});
  child.on('error',e=>{prepared.cleanup();console.error(e.message);process.exitCode=1;});
  child.on('exit',(code,signal)=>{prepared.cleanup();process.exitCode=signal?1:code||0;});
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal));return;
 }
 throw Error('Usage: node runtime/cli.cjs verify|serve --app PATH [--with DEPENDENCY_PATH] [--output REPORT] [--role agent|infra --run RUN --state-dir DIR]');
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={options};
