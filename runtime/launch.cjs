'use strict';
const {prepare}=require('./prepare.cjs');
function main({appDirectory,fixedApp}){
 let prepared;
 if(!process.argv.includes('--registry')){
  prepared=prepare(appDirectory);
  if(prepared.app!==fixedApp){prepared.cleanup();throw Error('Launcher and manifest App ID differ');}
  process.argv.push('--registry',prepared.registry);
  process.once('exit',prepared.cleanup);
 }
 require('./core/mcp.cjs').main({fixedApp});
}
module.exports={main};
