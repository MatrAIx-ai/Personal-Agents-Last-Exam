import {mount,el,date,tag,textBlock,metadata} from '/shared/client.js';
// Cadence: App-owned pages served by the shared Web Host over the fixed Agent MCP connection. This version ships class
// search, the class page with the two-step booking and the waitlist, reservations (cancel, late-cancel after a fee
// preview, check in, rate), the waitlist and the plan page. Studio and account pages are the next milestone. Every
// control calls the same cadence.* tools an agent would, under the same policy; nothing here touches Infra operations.
const T='cadence.';
const money=c=>'$'+Math.floor(Math.abs(c)/100).toLocaleString('en-US')+'.'+String(Math.abs(c)%100).padStart(2,'0');
const credits=n=>n+' credit'+(n===1?'':'s');
const priceLabel=p=>p.kind==='included'?'Included in your plan':p.kind==='credits'?credits(p.credits):'Not available on your plan';
const REASON={premium_excluded:'premium classes are not included',repeat_visit:'your trial covers the first visit at each studio',plan_cancelled:'the plan is cancelled'};
const STATUS={booked:'Booked',attended:'Attended',no_show:'No show',cancelled:'Cancelled',late_cancelled:'Late cancelled',cancelled_by_studio:'Cancelled by studio',rescheduled:'Rescheduled'};
// Times are shown in the member's time zone (account.settings.timezone), not the browser's.
const tz=()=>uiRef&&uiRef.aux&&uiRef.aux.account?uiRef.aux.account.settings.timezone:undefined;
const when=v=>new Intl.DateTimeFormat('en-US',{timeZone:tz(),weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(v));
const clock=v=>new Intl.DateTimeFormat('en-US',{timeZone:tz(),hour:'numeric',minute:'2-digit'}).format(new Date(v));
const pane=()=>document.querySelector('.detail');
const mark=id=>{for(const b of document.querySelectorAll('#records [data-record-id]'))b.setAttribute('aria-pressed',String(b.dataset.recordId===id));};
let uiRef=null,pendingDetail=null;
const scheduleDetail=fn=>{pendingDetail=fn;};
const params=new URLSearchParams(location.hash.slice(1));
const sheet=new CSSStyleSheet();
sheet.replaceSync(`
body[data-app=cadence]{--accent:#2f7d5b;--soft:#e8f4ee}
body[data-app=cadence] .record{display:block}
body[data-page=reservations] .collection-count,body[data-page=waitlist] .collection-count,body[data-page=plan] .collection-count{display:none}
.page .notice{background:#fff7e6;border:1px solid #f0d9a8;border-radius:10px;padding:10px 14px;margin:0 0 12px;font-size:13px;line-height:1.5}
.class-row,.rsv-row,.wl-row{display:flex;flex-direction:column;gap:4px;width:100%;text-align:left}
.tag.warn{background:#fdecec;color:#9b2c2c}.tag.good{background:#e3f6ea;color:#1f6b45}
.group-title{margin:14px 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6e7c91}
.plain{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:6px;font-size:13px}
.paper{padding:28px 36px;display:flex;flex-direction:column;gap:14px}
.facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 24px}
.history{padding-left:18px;font-size:13px;line-height:1.6;margin:0}.history time{color:#6e7c91;font-size:12px}
.flow .field{display:flex;flex-direction:column;gap:6px;max-width:320px}.flow select,.flow input{padding:8px 10px;border:1px solid #dce1e9;border-radius:8px}.flow h3{margin:12px 0 4px}
.form-error:empty{display:none}
.studio-mark{width:160px;height:100px;border-radius:10px;background:var(--soft);display:block}
`);
document.adoptedStyleSheets=[...document.adoptedStyleSheets,sheet];

export const config={
 id:'cadence',title:'Cadence',description:'Studio classes, reservations and your plan.',
 list:T+'classes.search',collection:'classes',queryField:'query',listArgs:{include_full:true},get:T+'classes.get',item:'class',
 heading:x=>x.title,subtitle:x=>x.studio.name+' · '+when(x.start),
 labels:{rating:'Rating (1 to 5)',review:'Review (optional)',reason:'Reason (optional)'},
 actions:[
  {label:'Rate this class',tool:T+'reservations.rate',hidden:true,submit:'Save rating'}
 ],
 symbol:'◍',searchLabel:'Search classes, studios, instructors',initialSection:['all','included','reservations','waitlist','plan'].includes(params.get('page'))?params.get('page'):'all',
 empty:'No classes match.',
 load:async ui=>{
  uiRef=ui;
  const aux={account:null,reservations:null,waitlist:null,plan:null,error:null};
  try{aux.account=(await ui.call(T+'account.get',{})).account;aux.reservations=(await ui.call(T+'reservations.list',{})).reservations;aux.waitlist=(await ui.call(T+'waitlist.list',{})).entries;aux.plan=await ui.call(T+'plan.get',{});}
  catch(e){aux.error=e.message;}
  return aux;
 },
 sections:()=>[
  {id:'all',label:'Classes',symbol:'▤',filter:()=>true},
  {id:'included',label:'Included',symbol:'✓',filter:x=>x.price.kind==='included'},
  {id:'reservations',label:'Reservations',symbol:'▣',filter:()=>false,count:false},
  {id:'waitlist',label:'Waitlist',symbol:'…',filter:()=>false,count:false},
  {id:'plan',label:'Plan',symbol:'★',filter:()=>false,count:false}
 ],
 sort:(a,b)=>Date.parse(a.start)-Date.parse(b.start),
 renderList:(shown,ui)=>{document.body.dataset.page=ui.section;if(pendingDetail){const f=pendingDetail;pendingDetail=null;setTimeout(()=>f().catch(ui.error),0);}
  return el('div',{class:'page'},banner(ui),ui.section==='reservations'?reservations(ui):ui.section==='waitlist'?waitlist(ui):ui.section==='plan'?planList(ui):classes(shown,ui));},
 emptyView:ui=>ui.section==='reservations'?el('div',{class:'empty'},el('h3',{},'Select a reservation'),el('p',{},'Each reservation shows its class, cancellation deadline and history.'))
  :ui.section==='waitlist'?el('div',{class:'empty'},el('h3',{},'Select a waitlist entry'))
  :ui.section==='plan'?el('div',{class:'empty'},el('h3',{},'Your plan'),el('p',{},'Open the plan page from the list.'))
  :el('div',{class:'empty'},el('h3',{},'Pick a class'),el('p',{},'Every class shows its price under your plan before you book.')),
 view:(x,ui)=>classView(x,ui),
 sectionAfter:(tool,args,result,item,ui)=>{if(tool===T+'reservations.rate'){scheduleDetail(()=>showReservation(ui,args.id,'Thanks, your rating was saved.'));return 'reservations';}return null;}
};

function banner(ui){
 if(ui.aux.error)return el('div',{class:'notice',role:'alert'},el('strong',{},'Cadence is not available right now. '),ui.aux.error);
 const a=ui.aux.account;if(!a)return null;
 return el('div',{class:'notice',role:'status'},el('strong',{},a.plan.name+'. '),a.plan.status==='trial'?'Trial ends '+a.plan.trial_end+' ('+a.plan.trial_days_left+' days left); your first visit at each studio is included.':credits(a.plan.credits_remaining)+' until '+a.plan.renewal_date+'.');
}

// ---- classes ----
function classes(shown,ui){
 if(!shown.length)return el('div',{class:'empty'},el('h3',{},'No classes match'),el('p',{},config.empty));
 return el('div',{},shown.map(x=>ui.record(x,el('div',{class:'class-row'},
  el('div',{class:'row-top'},el('strong',{},x.studio.name+' · '+x.studio.neighborhood),el('time',{},when(x.start))),
  el('span',{class:'record-title'},x.title+(x.premium?' · Premium':'')),
  el('div',{class:'row-bottom'},x.price.kind==='included'?el('span',{class:'tag good'},'Included in trial'):x.price.kind==='credits'?tag(credits(x.price.credits)):el('span',{class:'tag warn'},'Not on your plan'),
   x.my_reservation_id?tag('Booked'):x.my_waitlist_entry_id?tag('On waitlist'):x.spots_left===0?el('span',{class:'tag warn'},'Full'):el('small',{},x.spots_left+' spots'),el('small',{},x.rating_label))))));
}
function classView(x,ui){
 const a=ui.aux.account;
 const body=el('article',{class:'paper'},
  el('div',{class:'reader-heading'},el('span',{class:'kicker'},x.studio.name+' · '+x.studio.neighborhood+' · '+x.studio.distance_km+' km'),el('h2',{},x.title+(x.premium?' (premium)':''))),
  el('div',{class:'tags'},tag(when(x.start)+' to '+clock(x.end)),tag(x.type.replace('_',' ')),x.instructor?tag('with '+x.instructor.name):null,tag(x.rating_label)),
  el('div',{class:'facts'},metadata('Price under your plan',priceLabel(x.price)+(x.price.reason?' ('+REASON[x.price.reason]+')':'')),metadata('Spots left',String(x.spots_left)+' of '+x.capacity),metadata('Cancel free until',when(x.cancel_by)),metadata('Studio visited this period',x.visited_studio?'Yes':'No')),
  x.my_reservation_id?el('p',{class:'notice'},'You are booked: reservation '+x.my_reservation_id+'. ',el('button',{type:'button',onclick:()=>openReservation(ui,x.my_reservation_id).catch(ui.error)},'Open reservation')):null,
  x.my_waitlist_entry_id?el('p',{class:'notice'},'You are on the waitlist: entry '+x.my_waitlist_entry_id+'.'):null,
  !x.my_reservation_id&&!x.my_waitlist_entry_id&&x.price.kind!=='not_available'&&x.spots_left>0&&ui.has(T+'reservations.preview')?bookingFlow(x,ui):null,
  !x.my_reservation_id&&!x.my_waitlist_entry_id&&x.price.kind!=='not_available'&&x.spots_left===0&&ui.has(T+'waitlist.join')?el('div',{class:'flow'},el('p',{},'This class is full. Join the waitlist; an offer arrives when a spot opens.'),el('button',{type:'button',class:'primary',onclick:()=>ui.perform(T+'waitlist.join',{class_instance_id:x.id}).catch(ui.error)},'Join waitlist')):null,
  x.price.kind==='not_available'?el('p',{class:'notice'},'Not available on your plan: '+REASON[x.price.reason]+'. Change your plan under Plan to book it.'):null,
  el('p',{class:'note-foot'},x.studio.rating_label+' · '+(a?a.plan.name:'')));
 return body;
}
// Two-step booking: preview (nothing booked) then confirm with the version the preview observed.
function bookingFlow(x,ui){
 const result=el('div',{class:'book-result'}),alert=el('p',{role:'alert',class:'form-error'});
 const prepare=el('button',{type:'button',class:'primary'},'Book this class');
 prepare.onclick=async()=>{alert.textContent='';result.replaceChildren();try{
  const pv=await ui.perform(T+'reservations.preview',{class_instance_id:x.id},{refreshAfter:false});
  const confirm=el('button',{type:'button',class:'primary'},'Confirm booking');
  confirm.onclick=async()=>{alert.textContent='';try{
   const r=await ui.call(T+'reservations.confirm',{id:pv.id,expected_version:pv.version,request_id:'web-'+crypto.randomUUID()});
   // Switch to the reservations page first, then queue the detail and refresh so the list and the detail both show the new booking.
   await ui.navigate('reservations');
   scheduleDetail(()=>showReservation(ui,r.id,'Booked. '+priceLabel(r.price)+'; cancel free until '+when(r.cancel_by)+'.'));
   await ui.refresh();
  }catch(e){alert.textContent=e.message;}};
  result.replaceChildren(el('div',{},el('h3',{},'Booking preview '+pv.id),el('ul',{class:'plain'},el('li',{},'Price: '+priceLabel(pv.price)),el('li',{},'Cancel free until '+when(pv.cancel_by)),el('li',{},pv.spots_left+' spots left · preview expires '+when(pv.expires_at))),
   pv.approval_required?el('p',{class:'notice'},'This account requires your confirmation in Cadence before a booking is made; the confirm step reports approval_required until then.'):null,
   ui.has(T+'reservations.confirm')?confirm:el('p',{class:'notice'},'Confirming bookings is withheld for this account and policy.')));
 }catch(e){alert.textContent=e.message;}};
 return el('div',{class:'flow'},el('div',{class:'form-actions'},prepare),alert,result);
}

// ---- reservations ----
function reservations(ui){
 const list=ui.aux.reservations;
 if(!list)return el('div',{class:'empty'},el('h3',{},'Reservations are not available'),el('p',{},ui.aux.error||'Loading…'));
 const upcoming=list.filter(r=>r.status==='booked'&&Date.parse(r.class.end)>Date.now()-1e13),past=list.filter(r=>!upcoming.includes(r)).slice().reverse();
 const row=r=>el('button',{type:'button',class:'record rsv-row','data-record-id':r.id,'aria-pressed':'false',onclick:()=>showReservation(ui,r.id).catch(ui.error)},
  el('div',{class:'row-top'},el('strong',{},r.class.studio_name),el('time',{},when(r.class.start))),
  el('span',{class:'record-title'},r.class.title),
  el('div',{class:'row-bottom'},tag(STATUS[r.status]||r.status),r.conflict?el('span',{class:'tag warn'},'Overlaps '+r.conflict_with):null,r.time_changed?el('span',{class:'tag warn'},'Time changed'):null,el('small',{},priceLabel(r.price))));
 return el('div',{},el('h3',{class:'group-title'},'Upcoming'),...(upcoming.length?upcoming.map(row):[el('p',{class:'snippet'},'Nothing booked.')]),el('h3',{class:'group-title'},'Past and cancelled'),...past.slice(0,30).map(row));
}
async function openReservation(ui,id){await ui.navigate('reservations');await showReservation(ui,id);}
async function showReservation(ui,id,notice=null){
 const r=(await ui.call(T+'reservations.get',{id})).reservation;
 mark(id);
 const actions=el('div',{class:'actions'});
 if(r.status==='booked'&&ui.has(T+'reservations.cancel'))actions.append(el('button',{type:'button',onclick:()=>cancelFlow(ui,r)},r.would_be_late?'Cancel (late)':'Cancel'));
 if(r.can_check_in&&ui.has(T+'reservations.checkin'))actions.append(el('button',{type:'button',class:'primary',onclick:async()=>{try{await ui.perform(T+'reservations.checkin',{id:r.id},{refreshAfter:false});scheduleDetail(()=>showReservation(ui,r.id,'Checked in. Enjoy the class.'));await ui.refresh();}catch(e){ui.error(e);}}},'Check in'));
 if(r.status==='attended'&&r.rating===null&&ui.has(T+'reservations.rate'))actions.append(el('button',{type:'button',onclick:()=>ui.action(T+'reservations.rate',{id:r.id})},'Rate this class'));
 const p=pane();p.dataset.selectedId=id;
 p.replaceChildren(el('div',{class:'detail-actions'},actions),el('article',{class:'paper'},
  notice?el('p',{class:'notice',role:'status'},notice):null,
  el('div',{class:'reader-heading'},el('span',{class:'kicker'},'Reservation '+r.id+' · '+r.class.studio_name),el('h2',{},r.class.title)),
  el('div',{class:'tags'},tag(STATUS[r.status]||r.status),tag(when(r.class.start)+' to '+clock(r.class.end)),r.conflict?el('span',{class:'tag warn'},'Overlaps '+r.conflict_with):null,r.time_changed?el('span',{class:'tag warn'},'Time changed by the studio'):null),
  el('div',{class:'facts'},metadata('Price',priceLabel(r.price)),metadata('Credits charged',String(r.credits_charged)),metadata('Cancel free until',when(r.cancel_by)),metadata('Late fee',r.fee_cents?money(r.fee_cents):'None'),metadata('Checked in',r.checked_in_at?when(r.checked_in_at):'—'),metadata('Rating',r.rating?r.rating+' of 5':'—')),
  r.would_be_late&&r.status==='booked'?el('p',{class:'notice'},'The free cancellation window has closed. Cancelling now '+(r.credits_charged?'forfeits '+credits(r.credits_charged):'charges the late fee')+'.'):null,
  el('h3',{},'History'),el('ol',{class:'history'},r.history.map(h=>el('li',{},el('time',{},when(h.at)),' ',el('strong',{},h.action.replace(/_/g,' ')),h.detail?' — '+h.detail:'')))));
}
// Cancel: free inside the window, otherwise a fee preview followed by a confirmation.
function cancelFlow(ui,r){
 const p=pane(),alert=el('p',{role:'alert',class:'form-error'}),result=el('div',{});
 const panel=el('article',{class:'paper flow'},el('div',{class:'reader-heading'},el('span',{class:'kicker'},'Reservation '+r.id),el('h2',{},'Cancel '+r.class.title+'?')),alert,result);
 p.replaceChildren(panel);
 const finish=async(args,text)=>{const out=await ui.call(T+'reservations.cancel',{id:r.id,...args});scheduleDetail(()=>showReservation(ui,r.id,text(out)));await ui.refresh();};
 if(!r.would_be_late){
  result.append(el('p',{},'You are inside the free window (until '+when(r.cancel_by)+'). '+(r.credits_charged?credits(r.credits_charged)+' will be returned.':'Nothing is charged.')),
   el('div',{class:'form-actions'},el('button',{type:'button',class:'primary',onclick:async()=>{alert.textContent='';try{const v=(await ui.call(T+'reservations.get',{id:r.id})).version;await finish({expected_version:v,request_id:'web-'+crypto.randomUUID()},o=>'Cancelled. '+(o.credits_returned?credits(o.credits_returned)+' returned.':'Nothing was charged.'));}catch(e){alert.textContent=e.message;}}},'Confirm cancellation')));
  return;
 }
 const prepare=el('button',{type:'button',class:'primary'},'Prepare late cancellation');
 prepare.onclick=async()=>{alert.textContent='';try{
  const pv=await ui.perform(T+'reservations.cancel_preview',{id:r.id},{refreshAfter:false});
  const confirm=el('button',{type:'button',class:'primary'},'Confirm late cancellation');
  confirm.onclick=async()=>{alert.textContent='';try{await finish({preview_id:pv.id,expected_version:pv.version,request_id:'web-'+crypto.randomUUID()},o=>'Late cancellation recorded. '+(o.fee_cents?money(o.fee_cents)+' late fee charged.':'Credits forfeited.'));}catch(e){alert.textContent=e.message;}};
  result.replaceChildren(el('div',{},el('h3',{},'Cancellation preview '+pv.id),el('ul',{class:'plain'},el('li',{},pv.fee_cents?'Late fee: '+money(pv.fee_cents)+' to your card on file':'Credits forfeited: '+r.credits_charged),el('li',{},'The free window closed at '+when(pv.cancel_by)+' · preview expires '+when(pv.expires_at))),
   pv.approval_required?el('p',{class:'notice'},'This account requires your confirmation in Cadence before a late cancellation; the confirm step reports approval_required until then.'):null,confirm));
 }catch(e){alert.textContent=e.message;}};
 result.append(el('p',{},'The free window closed at '+when(r.cancel_by)+'. A late cancellation '+(r.credits_charged?'forfeits '+credits(r.credits_charged):'charges the late fee')+'.'),el('div',{class:'form-actions'},prepare));
}

// ---- waitlist ----
function waitlist(ui){
 const list=ui.aux.waitlist;
 if(!list)return el('div',{class:'empty'},el('h3',{},'The waitlist is not available'),el('p',{},ui.aux.error||'Loading…'));
 if(!list.length)return el('div',{class:'empty'},el('h3',{},'No waitlist entries'),el('p',{},'Join a full class from its page.'));
 return el('div',{},list.map(e=>el('button',{type:'button',class:'record wl-row','data-record-id':e.id,'aria-pressed':'false',onclick:()=>showWaitlist(ui,e.id).catch(ui.error)},
  el('div',{class:'row-top'},el('strong',{},e.class.studio_name),el('time',{},when(e.class.start))),el('span',{class:'record-title'},e.class.title),
  el('div',{class:'row-bottom'},e.status==='offered'?el('span',{class:'tag good'},'Offer until '+when(e.offer.offer_expires_at)):tag(e.status),e.reservation_id?el('small',{},'Booked as '+e.reservation_id):null))));
}
async function showWaitlist(ui,id){
 const e=ui.aux.waitlist.find(x=>x.id===id);if(!e)return;
 mark(id);
 const act=(label,tool,text,primary=false)=>ui.has(tool)?el('button',{type:'button',class:primary?'primary':'',onclick:async()=>{try{const out=await ui.perform(tool,{id:e.id},{refreshAfter:false});if(out.reservation_id)await ui.navigate('reservations');scheduleDetail(()=>out.reservation_id?showReservation(ui,out.reservation_id,text):showWaitlist(ui,e.id));await ui.refresh();}catch(err){ui.error(err);}}},label):null;
 const actions=el('div',{class:'actions'});
 if(e.status==='offered'){actions.append(act('Accept offer',T+'waitlist.accept','Booked from the waitlist.',true),act('Decline offer',T+'waitlist.decline',''));}
 if(['waiting','offered'].includes(e.status))actions.append(act('Leave waitlist',T+'waitlist.leave',''));
 const p=pane();p.dataset.selectedId=id;
 p.replaceChildren(el('div',{class:'detail-actions'},actions),el('article',{class:'paper'},el('div',{class:'reader-heading'},el('span',{class:'kicker'},'Waitlist entry '+e.id+' · '+e.class.studio_name),el('h2',{},e.class.title)),
  el('div',{class:'tags'},tag(e.status),tag(when(e.class.start))),
  e.status==='offered'?el('p',{class:'notice'},'A spot opened. Accept before '+when(e.offer.offer_expires_at)+' or the offer passes on.'):null,
  el('h3',{},'History'),el('ol',{class:'history'},e.history.map(h=>el('li',{},el('time',{},when(h.at)),' ',el('strong',{},h.action.replace(/_/g,' ')),h.detail?' — '+h.detail:'')))));
}

// ---- plan ----
function planList(ui){
 const plan=ui.aux.plan;
 if(!plan)return el('div',{class:'empty'},el('h3',{},'The plan is not available'),el('p',{},ui.aux.error||'Loading…'));
 setTimeout(()=>showPlan(ui).catch(ui.error),0);
 return el('div',{},el('button',{type:'button',class:'record','data-record-id':'plan','aria-pressed':'true',onclick:()=>showPlan(ui).catch(ui.error)},el('div',{class:'rsv-row'},el('span',{class:'record-title'},plan.plan.name),el('small',{},plan.plan.status.replace(/_/g,' ')+' · renews '+plan.plan.renewal_date))),
  el('h3',{class:'group-title'},'Receipts'),el('ul',{class:'plain'},plan.receipts.slice().reverse().slice(0,8).map(r=>el('li',{},el('strong',{},money(r.amount_cents)),' · '+date(r.at)+' · '+r.description))));
}
async function showPlan(ui,notice=null){
 const {plan,receipts}=await ui.call(T+'plan.get',{});
 const p=pane();p.dataset.selectedId='plan';
 const flow=el('div',{class:'flow'}),alert=el('p',{role:'alert',class:'form-error'}),result=el('div',{});
 const choices=(ui.aux.account?[]:[]);
 const select=el('select',{'data-field':'plan_id','aria-label':'New plan'});
 for(const id of ['plan-8-credits','plan-20-credits'])if(id!==plan.id)select.append(el('option',{value:id},id==='plan-8-credits'?'8 Credits · $59.00 / 30 days':'20 Credits · $129.00 / 30 days'));
 const prepare=(action)=>async()=>{alert.textContent='';result.replaceChildren();try{
  const pv=await ui.perform(T+'plan.preview',action==='change'?{action,plan_id:select.value}:{action},{refreshAfter:false});
  const tool=T+(action==='change'?'plan.change':'plan.cancel');
  const confirm=el('button',{type:'button',class:'primary'},action==='change'?'Confirm plan change':'Confirm cancellation');
  confirm.onclick=async()=>{alert.textContent='';try{const out=await ui.call(tool,{id:pv.id,expected_version:pv.version,request_id:'web-'+crypto.randomUUID()});scheduleDetail(()=>showPlan(ui,action==='change'?'Plan change scheduled for '+out.effective_on+'.':'Cancellation scheduled: your plan ends on '+out.effective_on+'.'));await ui.refresh();}catch(e){alert.textContent=e.message;}};
  result.replaceChildren(el('div',{},el('h3',{},'Preview '+pv.id),el('p',{},pv.note),el('ul',{class:'plain'},el('li',{},'Effective on '+pv.effective_on),el('li',{},'Charge then: '+money(pv.charge_cents)+' · credit change '+(pv.credit_change>=0?'+':'')+pv.credit_change),el('li',{},'Preview expires '+when(pv.expires_at))),
   pv.approval_required?el('p',{class:'notice'},'This account requires your confirmation in Cadence before a plan change; the confirm step reports approval_required until then.'):null,
   ui.has(tool)?confirm:el('p',{class:'notice'},(action==='change'?'Changing':'Cancelling')+' the plan is withheld for this account and policy.')));
 }catch(e){alert.textContent=e.message;}};
 if(ui.has(T+'plan.preview')&&!plan.pending_change&&plan.status!=='cancelled')flow.append(el('label',{class:'field'},el('span',{},'Switch to'),select),el('div',{class:'form-actions'},el('button',{type:'button',class:'primary',onclick:prepare('change')},'Preview plan change'),el('button',{type:'button',onclick:prepare('cancel')},'Preview cancellation')),alert,result);
 p.replaceChildren(el('article',{class:'paper'},notice?el('p',{class:'notice',role:'status'},notice):null,
  el('div',{class:'reader-heading'},el('span',{class:'kicker'},plan.status.replace(/_/g,' ')+(plan.trial_end?' · ends '+plan.trial_end:'')),el('h2',{},plan.name)),
  el('div',{class:'facts'},metadata('Credits',String(plan.credits_remaining)+(plan.kind==='credits'?' of '+plan.credits_per_period:'')),metadata(plan.trial_end?'Trial ends':'Renews on',plan.trial_end||plan.renewal_date),metadata('Then',plan.renews_to?plan.renews_to.name+' at '+money(plan.renews_to.price_cents):'Does not renew'),metadata('Payment method',plan.payment_method?plan.payment_method.brand+' ending '+plan.payment_method.last4+(plan.payment_method.status==='declined'?' (declined)':''):'None on file'),metadata('Scheduled change',plan.pending_change?(plan.pending_change.action==='cancel'?'Ends ':'Switch to '+plan.pending_change.plan_id+' on ')+plan.pending_change.effective_on:'None')),
  el('h3',{},'Plan rules'),el('ul',{class:'plain'},plan.rules.map(r=>el('li',{},r))),flow));
}

await mount(config);
if(uiRef&&params.get('reservation'))showReservation(uiRef,params.get('reservation')).catch(uiRef.error);
