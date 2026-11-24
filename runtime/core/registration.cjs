'use strict';
const fs=require('node:fs'),path=require('node:path');
// Maintainer-reviewed registration, never a grant supplied by an App or Agent.
function load(appId,tools,directory=path.join(__dirname,'../registrations')){
 if(!/^[a-z][a-z0-9-]*$/.test(appId))throw Error('Invalid registration App ID');
 const file=path.join(directory,appId+'.json');
 if(!fs.existsSync(file))return {};
 const r=JSON.parse(fs.readFileSync(file,'utf8'));
 if(r.app_id!==appId||!r.resource_access||typeof r.resource_access!=='object'||Array.isArray(r.resource_access)||Object.keys(r).some(k=>!['app_id','resource_access'].includes(k)))throw Error('Invalid platform registration: '+appId);
 for(const [object,tool] of Object.entries(r.resource_access)){
  if(!/^[a-z][a-z0-9_-]*$/.test(object)||typeof tool!=='string'||!tool.startsWith(appId+'.')||!tools.some(t=>t.name===tool&&t.read_only))throw Error('Resource registration must name a declared read tool: '+appId);
 }
 return Object.freeze({...r.resource_access});
}
module.exports={load};
