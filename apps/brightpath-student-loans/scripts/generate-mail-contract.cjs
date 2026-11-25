'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),repo=path.resolve(root,'../..');
function build(){
  const envelope=JSON.parse(fs.readFileSync(path.join(repo,'runtime/contracts/schemas/cloudevent.schema.json'),'utf8')),payload=JSON.parse(fs.readFileSync(path.join(repo,'examples/apps/mail/schemas/email-payload.schema.json'),'utf8'));
  return {...envelope,$id:'urn:pale:email-message:2',title:'CloudEvents 1.0 + Mail Email payload v1',description:'Generated from the PALE CloudEvents JSON profile and Mail-owned email-payload.schema.json. Do not hand-edit copies.',properties:{...envelope.properties,type:{const:'org.pale.mail.notification.v1'},dataschema:{const:payload.$id},data:payload}};
}
function text(){return JSON.stringify(build(),null,2)+'\n';}
function run({check=false}={}){const file=path.join(root,'schemas/router-message.schema.json'),expected=text();if(check){if(!fs.existsSync(file)||fs.readFileSync(file,'utf8')!==expected)throw Error('Generated Mail wire schema drift');}else fs.writeFileSync(file,expected);}
module.exports={build,text,run};if(require.main===module){run({check:process.argv.includes('--check')});console.log('Brightpath Mail contract '+(process.argv.includes('--check')?'matches':'generated')+'.');}
