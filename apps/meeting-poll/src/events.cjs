'use strict';
const {fail}=require('./time.cjs');
const {action,effective,stamp,notify}=require('./operations.cjs');
function applyEvent(ctx,data,event){
 const context={...ctx,virtual_now:event.at};
 if(event.operation==='meeting-poll.action')return action(context,data,event.payload.actor_id,event.payload.action,event.payload.arguments).data;
 if(event.operation==='meeting-poll.close_due'){
  for(const p of data.polls)if(p.status==='open'&&effective(context,p)==='closed'){p.status='closed';stamp(context,p,p.organizer_id,'close');notify(context,data,p,'poll_closed',[p.organizer_id]);}return data;
 }
 fail('invalid_event','Unknown meeting event.');
}
module.exports={applyEvent};
