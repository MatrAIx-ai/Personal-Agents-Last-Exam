'use strict';
// Mail owns the payload. Public/publisher copies are generated, never hand-edited.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
function build({check=false}={}){
 require('./sdk/sync.cjs').sync({check});
 const envelope=read('runtime/contracts/schemas/cloudevent.schema.json'),payload=read('examples/apps/mail/schemas/email-payload.schema.json');
 const wire={...envelope,$id:'urn:pale:email-message:2',title:'CloudEvents 1.0 + Mail Email payload v1',description:'Generated from the PALE CloudEvents JSON profile and Mail-owned email-payload.schema.json. Do not hand-edit copies.',properties:{...envelope.properties,type:{const:'org.pale.mail.notification.v1'},dataschema:{const:payload.$id},data:payload}};
 const copies=['examples/apps/mail/schemas/router-message.schema.json','runtime/contracts/schemas/router-message.schema.json','runtime/contracts/schemas/notification.schema.json','examples/workflows/delivery-to-mail/delivery/schemas/router-message.schema.json'];
 for(const ref of copies){const expected=JSON.stringify(wire,null,2)+'\n';if(check){if(fs.readFileSync(path.join(root,ref),'utf8')!==expected)throw Error('Generated contract drift: '+ref);}else fs.writeFileSync(path.join(root,ref),expected);}
 const attached=read('examples/apps/mail/schemas/email-attachments-payload.schema.json');
 const attachmentWire={...envelope,$id:'urn:pale:email-attachments-message:1',title:'CloudEvents + Mail attachment payload',properties:{...envelope.properties,type:{const:'org.pale.mail.attachments.v1'},dataschema:{const:attached.$id},data:attached}};
 for(const ref of ['examples/apps/mail/schemas/router-attachments.schema.json','examples/workflows/delivery-to-mail/delivery/schemas/router-attachments.schema.json']){const expected=JSON.stringify(attachmentWire,null,2)+'\n';if(check){if(fs.readFileSync(path.join(root,ref),'utf8')!==expected)throw Error('Attachment contract drift: '+ref);}else fs.writeFileSync(path.join(root,ref),expected);}
 return {envelope,payload,wire,copies};
}
module.exports={build};if(require.main===module){build({check:process.argv.includes('--check')});console.log('CloudEvents + receiver-owned payload copies match.');}
