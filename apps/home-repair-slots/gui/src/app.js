import {el} from '/shared/client.js';
const root=document.querySelector('#app'),nav=el('nav',{'aria-label':'Home Repair navigation'});
const live=el('p',{role:'status','aria-live':'polite'},'Opening synthetic workspace…');
const stage=el('article',{'aria-label':'Synthetic booking workspace'});
live.id='status';
const count=el('small',{},'');
root.className='app-shell';
root.replaceChildren(
 el('aside',{class:'sidebar'},el('div',{class:'brand'},el('h1',{},'Home Repair Slots')),nav,
  el('div',{class:'sidebar-foot'},el('small',{},'Fictional service · No payment or provider contact'))),
 el('section',{class:'app-main','aria-label':'Booking workspace'},live,el('div',{class:'detail'},stage)));
let csrf,tools=new Set(),screen='Slots',selectedReservation=null,selectedBooking=null,turn=0;
const msg=t=>{live.textContent=t;};
const can=n=>tools.has('home-repair-slots.'+n);
const field=(label,value)=>el('div',{class:'metadata-line'},el('dt',{},label),el('dd',{},value));
const badge=text=>el('span',{class:'tag'},text);
const record=(label,fields)=>el('section',{'aria-label':label},el('h3',{class:'section-title'},label),el('dl',{class:'fields'},fields));
const actions=(...children)=>el('div',{class:'actions'},...children);
const button=(label,act,token)=>el('button',{type:'button',onclick:()=>Promise.resolve().then(act).catch(e=>{if(token==null||token===turn)msg(e.message);})},label);
async function request(route,method='GET',payload){
 const r=await fetch(route,{method,headers:method==='POST'?{'Content-Type':'application/json','X-Pale-CSRF':csrf}:{},...(method==='POST'?{body:JSON.stringify(payload)}:{})});
 const d=await r.json();if(!r.ok)throw Object.assign(Error(d.error||'Request failed'),{code:'http_error'});return d;
}
async function call(name,args={}){
 if(!can(name))throw Object.assign(Error('This operation is not allowed by the current policy.'),{code:'unavailable'});
 const r=await request('/api/call','POST',{name:'home-repair-slots.'+name,arguments:args});
 if(!['ok','committed'].includes(r.status))throw Object.assign(Error(r.message||r.status),{code:r.status});
 return r;
}
const end=(token,title,...nodes)=>{if(token===turn){stage.replaceChildren(title,...nodes.filter(node=>node!=null));msg('Workspace state loaded.');}};
function write(area,label,tool,args,version,token,done){
 if(!can(tool))return;
 let sending=false,complete=false,pending;
 const go=button(label,async()=>{
  if(sending||complete||token!==turn||!area.isConnected)return;
  sending=true;pending??={...args,expected_version:version,request_id:crypto.randomUUID()};
  const locks=[...stage.querySelectorAll('button')].filter(x=>!x.disabled||x.dataset.writeLocked==='yes');
  for(const b of locks){b.disabled=true;b.dataset.writeLocked='yes';}
  let uncertain=false;
  try{
   const r=await call(tool,pending);complete=true;
   if(token===turn&&area.isConnected)await done(r);
  }catch(e){
   if(e.code){complete=true;if(token===turn)msg(e.message);}
   else if(token===turn){uncertain=true;go.textContent='Retry '+label;msg('No confirmation received. Retry the same request or refresh and verify the workspace.');}
  }finally{
   sending=false;
   if(uncertain)go.disabled=false;
   else for(const b of locks){b.disabled=false;delete b.dataset.writeLocked;}
   if(complete)go.disabled=true;
  }
 },token);
 area.append(go);
}
const amount=(s,c)=>new Intl.NumberFormat('en',{style:'currency',currency:c.currency,currencyDisplay:'code'}).format(s/100);
const provider=(s,state)=>state.providers.find(x=>x.id===s.provider_id)?.name??'Synthetic provider';
function time(instant,state,format={dateStyle:'medium',timeStyle:'short'}){
 return new Intl.DateTimeFormat('en',{timeZone:state.constraints.timezone,...format}).format(new Date(instant));
}
const windowText=(s,state)=>time(s.start,state)+' to '+time(s.end,state,{timeStyle:'short'});
const slotFields=(s,state)=>[field('Provider',provider(s,state)),field('Appointment window',windowText(s,state)),field('All-inclusive estimate',amount(s.estimate_minor,state.constraints))];
const historyLabels={confirm_reservation:'Confirmed',reschedule_booking:'Rescheduled',cancel_booking:'Cancelled'};
function table(label,headers,rows){
 return el('table',{'aria-label':label},el('thead',{},el('tr',{},headers.map(h=>el('th',{scope:'col'},h)))),el('tbody',{},rows));
}
const saved=(next,label)=>show(next,label);
async function show(next=screen,outcome){
 screen=next;const token=++turn;
 for(const b of nav.querySelectorAll('[data-screen]')){
  if(b.dataset.screen===next)b.setAttribute('aria-current','page');
  else b.removeAttribute('aria-current');
 }
 stage.replaceChildren();msg('Reading local state…');
 const title=el('h2',{},next);
 try{
  const state=await call('list_slots');if(token!==turn)return;
  count.textContent=String(state.booking_ids.length);
  const notice=el('p',{class:'muted'},'Requested dates '+state.constraints.from_date+' through '+state.constraints.through_date+' · '+state.constraints.timezone+' · Budget '+amount(state.constraints.budget_minor,state.constraints));
  if(next==='Slots'){
   selectedReservation=state.reservation_id;
   const rows=state.slots.map(s=>{
    const bar=actions();
    write(bar,'Select '+s.id,'select_slot',{slot_id:s.id},state.version,token,r=>{
     selectedReservation=r.reservation.id;return saved('Review reservation','Temporary preview saved. This slot is not held.');
    });
    return el('tr',{},el('th',{scope:'row'},provider(s,state)),el('td',{},windowText(s,state)),el('td',{},amount(s.estimate_minor,state.constraints)),el('td',{},bar));
   });
   end(token,title,notice,rows.length?table('Available appointment offers',['Provider','Appointment window','Price','Action'],rows):el('p',{},'No suitable available slots within the requested dates and budget.'));
  }else if(next==='Review reservation'){
   selectedReservation=state.reservation_id||selectedReservation;
   if(!selectedReservation){end(token,title,notice,el('p',{},'No temporary reservation. Choose a suitable slot first.'));return;}
   const r=await call('get_reservation',{reservation_id:selectedReservation});if(token!==turn)return;
   const bar=actions(),status=r.reservation.status;
   if(status==='open')write(bar,'Confirm reservation','confirm_reservation',{reservation_id:selectedReservation},r.version,token,c=>{
    selectedBooking=c.booking.id;return saved('Bookings','Synthetic booking confirmed: '+c.booking.id);
   });
   if(['open','invalidated'].includes(status))write(bar,'Discard reservation','discard_reservation',{reservation_id:selectedReservation},r.version,token,()=>{
    return saved('Review reservation','Reservation discarded. No booking created.');
   });
   bar.append(button('Back to available slots',()=>show('Slots'),token));
   end(token,title,notice,record('Reservation '+r.reservation.id,[field('Status',badge(status)),...slotFields(r.slot,state)]),
    status==='invalidated'?el('p',{},'This slot was taken before confirmation. Check alternatives or discard the reservation.'):null,bar);
  }else{
   const links=actions(...state.booking_ids.map(id=>button('Open '+id,()=>{selectedBooking=id;return show(next);},token)));
   if(!state.booking_ids.includes(selectedBooking))selectedBooking=null;
   if(!selectedBooking){end(token,title,notice,links,el('p',{},'Choose a booking.'));return;}
   const r=await call('get_booking',{booking_id:selectedBooking});if(token!==turn)return;
   const info=record('Booking '+r.booking.id,[field('Status',badge(r.booking.status)),...slotFields(r.slot,state)]);
   const timeline=r.history.length?record('Booking activity',r.history.map(h=>field(historyLabels[h.operation],el('time',{datetime:h.at},time(h.at,state))))):null;
   const bar=actions();
   if(next==='Bookings'&&r.booking.status==='confirmed'){
    bar.append(button('Change or cancel '+r.booking.id,()=>show('Change or cancel'),token));
   }else if(next==='Change or cancel'&&r.booking.status==='confirmed'){
    if(can('reschedule_booking')){
     bar.append(el('p',{},'Changing a booking releases the old slot only if the new slot is acquired.'));
     for(const s of state.slots){
      bar.append(button('Reschedule to '+s.id,()=>{
       const confirm=actions(button('Keep existing booking',()=>show('Change or cancel'),token));
       write(confirm,'Confirm reschedule','reschedule_booking',{booking_id:r.booking.id,slot_id:s.id},r.version,token,()=>saved('Bookings','Booking '+r.booking.id+' rescheduled to '+s.id+'.'));
       bar.replaceChildren(record('Proposed new appointment',slotFields(s,state)),confirm);
      },token));
     }
    }
    if(can('cancel_booking'))bar.append(button('Cancel booking',()=>{
     const confirm=actions(button('Keep booking',()=>show('Change or cancel'),token));
     write(confirm,'Confirm cancellation','cancel_booking',{booking_id:r.booking.id},r.version,token,()=>saved('Bookings','Booking '+r.booking.id+' cancelled.'));
     bar.replaceChildren(el('p',{},'Cancel booking '+r.booking.id+'? No external message is sent.'),confirm);
    },token));
   }
   end(token,title,notice,links,info,timeline,bar);
  }
  if(token===turn&&outcome)msg(outcome);
 }catch(e){if(token===turn){stage.replaceChildren(title);msg(e.message);}}
}
async function init(){
 const access=new URLSearchParams(location.hash.slice(1)).get('access');
 if(access){history.replaceState(null,'',location.pathname);({csrf}=await request('/session','POST',{token:access}));}
 else ({csrf}=await request('/session'));
 tools=new Set((await request('/api/tools')).tools.map(t=>t.name));
 nav.replaceChildren(...['Slots','Review reservation','Bookings','Change or cancel'].map(n=>{
  const b=button(n,()=>show(n));b.dataset.screen=n;if(n==='Bookings')b.append(count);return b;
 }),button('Refresh',()=>show()));
 await show();
}
init().catch(e=>msg(e.message));
