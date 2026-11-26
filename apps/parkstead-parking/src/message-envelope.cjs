'use strict';
function create({id,app,account,type,dataschema,data,time,subject}){const event={specversion:'1.0',id,source:'urn:pale:app:'+encodeURIComponent(app)+':account:'+encodeURIComponent(account),type,datacontenttype:'application/json',dataschema,data};if(time!==undefined)event.time=time;if(subject!==undefined)event.subject=subject;return event;}
module.exports={create};
