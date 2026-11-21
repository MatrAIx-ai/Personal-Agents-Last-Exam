'use strict';
const path=require('node:path');
const {read}=require('../../core/registry.cjs');
const {compile}=require('../../core/schema.cjs');
const schemaPath=path.join(__dirname,'../schemas/router-config.schema.json');
const schema=read(schemaPath),valid=compile(schema,path.dirname(schemaPath));
function load(file){
 const config=read(file);
 if(!valid(config))throw new Error('Invalid Router config: expected trusted identities, package refs and grants; capability overrides and unsupported authentication are not accepted');
 const ids=config.publishers.map(p=>p.app_id);
 if(new Set(ids).size!==ids.length)throw new Error('Publisher must be uniquely approved by Infra');
 return config;
}
module.exports={load,schema,valid};
