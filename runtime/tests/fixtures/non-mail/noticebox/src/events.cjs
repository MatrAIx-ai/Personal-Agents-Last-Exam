'use strict';
function applyEvent(ctx,data,event){
 const p=event.payload;
 if(event.operation!=='noticebox.receive'||p.recipient_account_id!==data.account_id||p.message.data.recipient.id!==data.account_id)throw Object.assign(Error('Wrong receiver'),{code:'invalid_event'});
 if(data.items.some(x=>x.id===event.event_id))throw Object.assign(Error('Duplicate item'),{code:'already_exists'});
 data.items.push({id:event.event_id,text:p.message.data.content.text,timestamp:event.at});return data;
}
module.exports={applyEvent};
