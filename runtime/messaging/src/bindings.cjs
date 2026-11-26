'use strict';
// Infra resolves instances from its registry and verified App snapshots.
// No request may supply a connection URL, run identity or receive operation.
const {digest}=require('./contracts.cjs');
function bind({entry,appId,snapshot,client,run}){
 const accounts=snapshot.binding.accounts.filter(a=>a.app_id===appId&&a.account_id===snapshot.data.account_id);
 if(snapshot.run_id!==run||accounts.length!==1||snapshot.data.owner_person_id!==accounts[0].owner_person_id)throw Error('Receiver run/account binding missing or inconsistent');
 return {...entry,app_id:appId,...accounts[0],epoch:snapshot.epoch,bindingHash:digest(snapshot.binding),client};
}
function resolve(receivers,channel,recipient){
 if(recipient.kind==='device_ref')return {error:'unsupported_recipient'};
 const matches=receivers.filter(r=>r.channel===channel&&(recipient.kind==='person_ref'?r.owner_person_id===recipient.id:r.app_id===recipient.app_id&&r.account_id===recipient.id));
 return matches.length===1?{target:matches[0]}:{error:matches.length?'ambiguous_recipient':'recipient_unavailable'};
}
function unchanged(target,snapshot,run){return !!snapshot&&snapshot.run_id===run&&snapshot.epoch===target.epoch&&digest(snapshot.binding)===target.bindingHash&&snapshot.data.account_id===target.account_id;}
module.exports={bind,resolve,unchanged};
