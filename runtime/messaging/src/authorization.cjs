'use strict';
// Trusted local launch identity today. OAuth verification belongs to Infra's
// shared transport layer; payload source fields never authenticate a caller.
const {sourceURI}=require('../../core/cloud-events.cjs');
function sourceMatches(source,event){
 const object=event.data.source_object;
 return event.source===sourceURI(source.app_id,source.account_id)&&object.app_id===source.app_id&&object.account_id===source.account_id;
}
function allows(source,target,channel){
 return source.allowed_recipients.some(g=>g.app_id===target.app_id&&g.account_id===target.account_id&&g.channel===channel);
}
module.exports={sourceMatches,allows};
