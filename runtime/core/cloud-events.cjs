'use strict';
// CloudEvents 1.0 JSON object profile. Transport remains MCP; no broker required.
const path=require('node:path'),{compile}=require('./schema.cjs');
const profile=require('../contracts/schemas/cloudevent.schema.json');
const valid=compile(profile,path.resolve(__dirname,'../contracts/schemas'));
const sourceURI=(app,account)=>'urn:pale:app:'+encodeURIComponent(app)+':account:'+encodeURIComponent(account);
function create({id,app,account,type,dataschema,data,time,subject}){
 const event={specversion:'1.0',id,source:sourceURI(app,account),type,datacontenttype:'application/json',dataschema,data};
 if(time!==undefined)event.time=time;if(subject!==undefined)event.subject=subject;
 if(!valid(event))throw Error('Invalid PALE CloudEvents JSON profile');return event;
}
// Audit only validated envelope metadata. Never copy business data or credentials.
// Preserve the producer's exact time string; absence must not become a made-up time.
function metadata(event){
 if(!valid(event))return null;
 return {source:event.source,id:event.id,type:event.type,...(event.time===undefined?{}:{time:event.time})};
}
module.exports={create,valid,sourceURI,metadata};
