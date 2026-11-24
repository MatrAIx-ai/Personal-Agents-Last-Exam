// Pegboard business pages: the team's posted schedule, my hours, handoffs (cover, trade, release,
// pick-up) and answers to coworkers, time off, availability, notifications and settings, all from
// one employee's account. This controller is the App's own: its navigation, forms and how shifts,
// eligibility and requests are shown. The shared Host serves it and forwards only the Agent's
// permitted tools. Every value shown comes from those tools; the page keeps no business data of
// its own and never uses the browser clock for a business decision.
import {mount,el,textBlock} from '/shared/client.js';

const TOOL={
  workplace:'pegboard.workplace.get',team:'pegboard.team.list',shifts:'pegboard.shifts.list',shift:'pegboard.shifts.get',
  hours:'pegboard.hours.summary',eligibility:'pegboard.eligibility.check',availability:'pegboard.availability.get',
  timeOff:'pegboard.time_off.list',handoffs:'pegboard.handoffs.list',handoff:'pegboard.handoffs.get',
  notifications:'pegboard.notifications.list',preferences:'pegboard.preferences.get',
  setAvailability:'pegboard.availability.update',requestTimeOff:'pegboard.time_off.request',cancelTimeOff:'pegboard.time_off.cancel',
  cover:'pegboard.handoffs.cover',trade:'pegboard.handoffs.trade',release:'pegboard.handoffs.release',pickup:'pegboard.handoffs.pickup',
  respond:'pegboard.handoffs.respond',cancelHandoff:'pegboard.handoffs.cancel',settings:'pegboard.preferences.update'
};

// ---- presentation ---------------------------------------------------------------------------
const sheet=new CSSStyleSheet();
sheet.replaceSync(`
.brand h1{font-size:1.3rem;letter-spacing:-.01em}
.detail-actions:has(.actions:empty){display:none}
[hidden]{display:none!important}
.pb-list{display:grid;gap:.45rem}
.pb-list-head{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.6rem;padding:.35rem 1.35rem .2rem}
.pb-list-head p{margin:0;color:var(--muted);font-size:.85rem;flex:1 1 12rem}
.pb-list-head select{flex:1 1 9rem;min-width:0}
.pb-list>.empty{padding:0 1.35rem}
.pb-week{display:flex;align-items:center;gap:.5rem;flex:1 1 14rem}
.pb-week strong{flex:1;text-align:center}
.pb-summary{margin:0 1.35rem;padding:.5rem .7rem;border:1px solid var(--line);border-radius:10px;font-size:.86rem;display:grid;gap:.15rem}
.pb-group{margin:.8rem 0 .1rem;padding:0 1.35rem;font-size:.72rem;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);font-weight:700}
.pb-row{display:grid;gap:.25rem;width:100%;text-align:left}
.pb-row-sub{color:var(--muted);font-size:.84rem}
.pb-chips{display:flex;flex-wrap:wrap;gap:.3rem}
.pb-chip{display:inline-flex;align-items:center;border-radius:999px;padding:.05rem .55rem;font-size:.74rem;font-weight:600;border:1px solid var(--line);background:var(--soft);white-space:nowrap}
.pb-chip[data-tone=good]{background:#ecfdf3;border-color:#abefc6;color:#067647}
.pb-chip[data-tone=warn]{background:#fffaeb;border-color:#fedf89;color:#b54708}
.pb-chip[data-tone=bad]{background:#fef3f2;border-color:#fecdca;color:#b42318}
.pb-chip[data-tone=quiet]{color:var(--muted)}
.pb-page{display:grid;gap:1rem;min-width:0}
.pb-head h2{margin:0;font-size:1.5rem}
.pb-head p{margin:.2rem 0 0;color:var(--muted)}
.pb-toolbar{display:flex;flex-wrap:wrap;gap:.45rem;align-items:center}
.pb-card{border:1px solid var(--line);border-radius:14px;padding:.9rem 1rem;min-width:0;display:grid;gap:.5rem}
.pb-card h3{margin:0;font-size:1rem}
.pb-banner{border-left:4px solid var(--accent);background:var(--soft);padding:.6rem .8rem;border-radius:8px;display:grid;gap:.35rem}
.pb-banner[data-tone=bad]{border-color:#d92d20;background:#fef3f2}
.pb-banner[data-tone=warn]{border-color:#f79009;background:#fffaeb}
.pb-banner[data-tone=good]{border-color:#17b26a;background:#ecfdf3}
.pb-banner p{margin:0}
.pb-muted{color:var(--muted);font-size:.85rem;margin:0}
.pb-dl{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:.3rem 1rem;margin:0}
.pb-dl dt{color:var(--muted)}
.pb-dl dd{margin:0;overflow-wrap:anywhere}
.pb-history{list-style:none;padding:0;margin:0;display:grid;gap:.4rem}
.pb-history li{border-left:3px solid var(--line);padding:.2rem .6rem;display:grid;gap:.1rem}
.pb-weeks{display:grid;gap:.8rem}
.pb-form{display:grid;gap:.75rem;width:min(640px,86vw)}
.pb-form h2{margin:0}
.pb-form fieldset,.pb-settings fieldset{border:1px solid var(--line);border-radius:10px;padding:.6rem .8rem .8rem;display:grid;gap:.55rem;margin:0;min-width:0}
.pb-form legend,.pb-settings legend{display:block;font-weight:700;padding:0 .3rem}
.pb-form label{display:grid;gap:.25rem}
label.pb-check{display:flex!important;justify-content:flex-start;grid-template-columns:none;gap:.45rem;align-items:center;text-align:left}
label.pb-check input{width:auto;flex:0 0 auto;margin:0}
.pb-pair{display:grid;grid-template-columns:1fr 1fr;gap:.6rem}
.pb-fields{display:grid;gap:.75rem}
.pb-error{color:#b42318;font-weight:600;margin:0;min-height:1.2em}
.pb-settings{display:grid;gap:.8rem;max-width:620px}
.pb-blocks{display:grid;gap:.5rem}
.pb-block{display:flex;flex-wrap:wrap;gap:.5rem;align-items:end;border-bottom:1px dashed var(--line);padding-bottom:.5rem}
.pb-block>*{flex:1 1 8rem;min-width:0}
.pb-block>button{flex:0 0 auto}
.pb-person{padding:.35rem 1.35rem;display:grid;gap:.1rem;font-size:.88rem}
dialog.pb-dialog{max-width:min(720px,94vw);max-height:90vh;overflow:auto}
@media(max-width:760px){.pb-pair{grid-template-columns:1fr}}
`);
document.adoptedStyleSheets=[...document.adoptedStyleSheets,sheet];

const fmts=new Map();
const formatter=(tz,options)=>{const key=tz+JSON.stringify(options);if(!fmts.has(key))fmts.set(key,new Intl.DateTimeFormat('en-US',{timeZone:tz,...options}));return fmts.get(key);};
// Shift times and days are the workplace's; notification times are the account's. Never the browser's.
let wpZone='UTC';
const when=(iso,tz)=>iso?formatter(tz,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(iso)):'—';
const clock=(iso,tz)=>formatter(tz,{hour:'numeric',minute:'2-digit'}).format(new Date(iso));
const dayOf=(iso,tz)=>formatter(tz,{weekday:'long',month:'short',day:'numeric'}).format(new Date(iso));
const shiftTime=(s,tz)=>formatter(tz,{weekday:'short',month:'short',day:'numeric'}).format(new Date(s.start))+', '+clock(s.start,tz)+' – '+clock(s.end,tz);
const dateLabel=d=>formatter('UTC',{weekday:'short',month:'short',day:'numeric'}).format(new Date(d+'T12:00:00Z'));
const addDays=(d,n)=>{const t=new Date(d+'T12:00:00Z');t.setUTCDate(t.getUTCDate()+n);return t.toISOString().slice(0,10);};
function wall(ms,tz){const o={};for(const p of formatter(tz,{hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(new Date(ms)))o[p.type]=p.value;return o;}
const offsetAt=(ms,tz)=>{const o=wall(ms,tz);return Date.UTC(+o.year,+o.month-1,+o.day,+o.hour,+o.minute,+o.second)-Math.floor(ms/1000)*1000;};
// A wall time of the workplace ('2026-11-23T00:00') as an ISO time with that zone's offset.
function wallToIso(local,tz){
  const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local||'');if(!m)return '';
  const guess=Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5]);let off=offsetAt(guess,tz);const second=offsetAt(guess-off,tz);if(second!==off)off=second;
  const a=Math.abs(off)/60000;return m[1]+'-'+m[2]+'-'+m[3]+'T'+m[4]+':'+m[5]+':00'+(off<0?'-':'+')+String(Math.floor(a/60)).padStart(2,'0')+':'+String(a%60).padStart(2,'0');
}

const KIND={cover:'Cover',trade:'Trade',release:'Release',pickup:'Pick-up'};
const STATE={awaiting_me:'Waiting for you',awaiting_coworker:'Waiting for the coworker',awaiting_manager:'Waiting for the manager'};
const FLAG={overlap:'Overlaps another of your shifts',short_rest:'Less rest than the minimum between working days',over_hours:'Takes your week past your cap',outside_availability:'Outside your availability',during_time_off:'During your time off'};
const BLOCK={not_qualified:'does not hold the position',overlap:'would work two shifts at once',short_rest:'would get less rest than the minimum',over_hours:'would pass the weekly cap'};
const toneOf={approved:'good',awaiting_me:'warn',awaiting_coworker:'warn',awaiting_manager:'warn',declined:'bad',denied:'bad',void:'quiet',cancelled:'quiet',expired:'quiet',withdrawn:'quiet',pending:'warn',held:'warn',released:'quiet',open:'warn',started:'good',ended:'quiet',
  overlap:'bad',short_rest:'bad',over_hours:'bad',outside_availability:'warn',during_time_off:'warn'};
const words=value=>String(value||'').replace(/[._]/g,' ').replace(/^./,c=>c.toUpperCase());
const chip=(text,tone,label)=>el('span',{class:'pb-chip','data-tone':tone||toneOf[text]||null},label||STATE[text]||words(text));
const button=(label,onclick,primary=false,extra={})=>el('button',{type:'button',class:primary?'primary':'',onclick,...extra},label);
const definition=pairs=>el('dl',{class:'pb-dl'},pairs.filter(Boolean).flatMap(([k,v])=>[el('dt',{},k),el('dd',{},v??'—')]));
const empty=(title,text,...more)=>el('div',{class:'empty'},el('h3',{},title),el('p',{},text),...more);
const say=text=>{const s=document.getElementById('status');if(s){s.textContent=text;delete s.dataset.error;}};
const searchText=()=>(document.querySelector('.toolbar input[type=search]')?.value||'').trim().toLowerCase();
const found=(q,...texts)=>!q||texts.join(' ').toLowerCase().includes(q);
const setCount=n=>{const c=document.querySelector('.collection-count');if(c)c.textContent=String(n);};
const loaded=node=>{node.dataset.loaded='true';return node;};
const fail=(message,code)=>{throw Object.assign(Error(message),{code});};
const money=(amount,currency)=>new Intl.NumberFormat('en-US',{style:'currency',currency:currency||'USD'}).format(amount);

// ---- UI state: what is selected and filtered. Business data is always read again. --------------
const state={week:null,firstWeek:null,focus:null,scope:'team',handoff:null,timeOff:null,notification:null,nKind:'',nState:''};
const aux=ui=>ui.aux||{};
const accountZone=ui=>aux(ui).preferences?.timezone||wpZone;
const person=(ui,id)=>aux(ui).team?.find(p=>p.id===id);
const personName=(ui,id)=>id?(person(ui,id)?.name||id):'—';
const positionName=(ui,id)=>aux(ui).workplace?.positions.find(p=>p.id===id)?.name||id;
const locationName=(ui,id)=>aux(ui).workplace?.locations.find(l=>l.id===id)?.name||id;
const shiftLabel=(ui,s)=>shiftTime(s,wpZone)+' · '+positionName(ui,s.position_id)+' · '+locationName(ui,s.location_id);
const weekWindow=(from=state.week,days=7)=>({start:wallToIso(from+'T00:00',wpZone),end:wallToIso(addDays(from,days)+'T00:00',wpZone)});
const notificationArgs=()=>({limit:50,...(state.nKind?{kind:state.nKind}:{}),...(state.nState?{state:state.nState}:{})});
const pending=h=>['awaiting_me','awaiting_coworker','awaiting_manager'].includes(h.state);

// Writes carry the version the form was opened on, so a concurrent change shows as a conflict
// instead of being overwritten; an unchanged resubmission reuses its request ID, so a retry after
// a lost response cannot repeat the effect.
function writer(ui,version){
  let pendingWrite=null;
  return async(name,args)=>{
    const payload={...args,expected_version:version},signature=name+JSON.stringify(payload);
    if(!pendingWrite||pendingWrite.signature!==signature)pendingWrite={signature,id:'web-'+crypto.randomUUID()};
    return ui.call(name,{...payload,request_id:pendingWrite.id});
  };
}
function dialog(title,submitLabel,onSubmit){
  const error=el('p',{role:'alert',class:'form-error pb-error'}),body=el('div',{class:'pb-fields'});
  const submit=el('button',{type:'submit',class:'primary'},submitLabel),cancel=el('button',{type:'button'},'Cancel');
  const form=el('form',{class:'pb-form','aria-label':title},el('h2',{},title),body,error,el('div',{class:'form-actions'},cancel,submit));
  const node=el('dialog',{class:'pb-dialog','aria-label':title},form);
  cancel.addEventListener('click',()=>node.close());
  node.addEventListener('close',()=>node.remove());
  let busy=false;
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;busy=true;submit.disabled=true;error.textContent='';delete error.dataset.code;
    try{if(await onSubmit()!==false)node.close();}
    catch(e){error.textContent=e.message;error.dataset.code=e.code||'request_failed';}
    finally{busy=false;submit.disabled=false;}
  });
  document.body.append(node);node.showModal();
  return {node,body};
}
const field=(label,input,help)=>el('label',{class:'field'},el('span',{},label),input,help?el('small',{},help):null);
const select=(name,options,value)=>{const s=el('select',{'data-field':name});for(const [v,l] of options)s.append(el('option',{value:v},l));if(value!==undefined&&value!==null)s.value=String(value);return s;};
const message=()=>el('textarea',{'data-field':'message',maxlength:'500',rows:'2'});
const withMessage=(args,box)=>box.value.trim()?{...args,message:box.value.trim()}:args;

// ---- data loaded with every refresh ------------------------------------------------------------
async function load(ui){
  const out={workplace:null,me:null,team:[],preferences:null,availability:[],timeOff:[],handoffs:[],notifications:[],notificationCursor:null,week:null,hours:null};
  if(ui.has(TOOL.workplace)){const r=await ui.call(TOOL.workplace,{});out.workplace=r.workplace;out.me=r.me;wpZone=r.workplace.timezone;}
  if(ui.has(TOOL.team))out.team=(await ui.call(TOOL.team,{})).people;
  if(ui.has(TOOL.preferences))out.preferences=(await ui.call(TOOL.preferences,{})).preferences;
  if(ui.has(TOOL.availability))out.availability=(await ui.call(TOOL.availability,{})).blocks;
  if(ui.has(TOOL.timeOff))out.timeOff=(await ui.call(TOOL.timeOff,{include_closed:true})).time_off;
  if(ui.has(TOOL.handoffs))out.handoffs=(await ui.call(TOOL.handoffs,{include_closed:true,limit:100})).handoffs;
  if(ui.has(TOOL.notifications)){const r=await ui.call(TOOL.notifications,notificationArgs());out.notifications=r.notifications;out.notificationCursor=r.next_cursor;}
  // The first view opens on the week of my next shift that has not ended, by the App's own clock.
  if(!state.week){
    const mine=ui.records,next=mine.find(s=>s.phase!=='ended')||mine.at(-1);
    state.week=state.firstWeek=next?.week_start||null;state.focus=next?.id||null;
    if(state.week)out.week=(await ui.call(TOOL.shifts,{...weekWindow(),limit:200})).shifts;
  }
  if(state.week&&ui.has(TOOL.hours))out.hours=(await ui.call(TOOL.hours,weekWindow())).weeks[0]||null;
  return out;
}

// ---- lists (middle column) ------------------------------------------------------------------------
function renderList(shown,ui){
  const q=searchText();
  if(ui.section==='requests')return handoffList(ui,q);
  if(ui.section==='timeoff')return timeOffList(ui,q);
  if(ui.section==='availability')return availabilityList(ui);
  if(ui.section==='hours'){setCount(4);return el('div',{class:'pb-list'},el('div',{class:'pb-list-head'},el('p',{},'Scheduled hours, your cap and an estimate of pay, week by week.')));}
  if(ui.section==='notifications')return notificationList(ui,q);
  if(ui.section==='settings')return teamList(ui);
  return scheduleList(shown,ui,q);
}
function row(attrs,selected,onclick,title,sub,chips){
  return el('button',{type:'button',class:'record',...attrs,'aria-pressed':String(selected),onclick},el('span',{class:'pb-row'},el('span',{class:'record-title'},title),sub?el('span',{class:'pb-row-sub'},sub):null,chips?el('span',{class:'pb-chips'},chips):null));
}
const shiftChips=s=>[s.is_mine?chip('Yours','good','Yours'):null,s.state==='open'?chip('open',null,'Open shift'):null,s.pending_handoff_id?chip('pending','warn','Handoff pending'):null,
  ...(s.flags||[]).map(f=>chip(f)),s.phase!=='upcoming'?chip(s.phase):null,s.state==='cancelled'?chip('cancelled'):null];
function scheduleList(shown,ui,q){
  const a=aux(ui),items=[...(a.week||shown)].sort((x,y)=>Date.parse(x.start)-Date.parse(y.start)).filter(s=>found(q,s.assignee_name||'open',positionName(ui,s.position_id),locationName(ui,s.location_id)));
  setCount(items.length);
  const scope=select('scope',[['team','Whole team'],['mine','My shifts'],['open','Open shifts']],state.scope);scope.setAttribute('aria-label','Shifts shown');
  scope.addEventListener('change',()=>{state.scope=scope.value;ui.refresh().catch(ui.error);});
  const move=n=>{state.week=addDays(state.week,7*n);ui.refresh().catch(ui.error);};
  const list=el('div',{class:'pb-list'});
  if(!state.week){list.append(empty('No shifts yet','Your schedule appears here once a week is posted.'));return list;}
  list.append(el('div',{class:'pb-list-head'},el('div',{class:'pb-week'},button('←',()=>move(-1),false,{'aria-label':'Previous week'}),
    el('strong',{'data-week':state.week},'Week of '+dateLabel(state.week)),button('→',()=>move(1),false,{'aria-label':'Next week'})),scope));
  const h=a.hours;
  if(h)list.append(el('div',{class:'pb-summary','aria-label':'My hours this week'},el('strong',{},'You: '+h.scheduled_hours+' of '+h.cap+' hours'+(h.over_cap?' (over your cap)':' ('+h.hours_left+' left)')),
    el('span',{class:'pb-muted'},h.days_worked+' day'+(h.days_worked===1?'':'s')+' · estimated pay '+money(h.estimated_pay.amount,h.estimated_pay.currency)+' (an estimate, not payroll)'+(h.posted_at?'':' · not posted yet'))));
  if(state.firstWeek&&state.week!==state.firstWeek)list.append(el('div',{class:'pb-list-head'},button('Back to the week of your next shift',()=>{state.week=state.firstWeek;ui.refresh().catch(ui.error);})));
  if(!items.length){list.append(empty('Nothing this week',state.scope==='open'?'No open shifts start this week.':'No shifts start this week.'));return list;}
  let day=null;
  for(const s of items){
    const d=dayOf(s.start,wpZone);
    if(d!==day){list.append(el('h3',{class:'pb-group'},d));day=d;}
    list.append(ui.record(s,el('span',{class:'pb-row'},el('span',{class:'record-title'},clock(s.start,wpZone)+' – '+clock(s.end,wpZone)+' · '+positionName(ui,s.position_id)),
      el('span',{class:'record-subtitle'},(s.assignee_name||'Open shift')+' · '+locationName(ui,s.location_id)+' · '+s.hours+' h'),el('span',{class:'pb-chips'},shiftChips(s)))));
  }
  return list;
}
function handoffTitle(ui,h){return KIND[h.kind]+': '+shiftTime(h.shift,wpZone);}
function handoffSub(ui,h){
  if(h.kind==='release')return 'You offer it to the open shifts';
  if(h.kind==='pickup')return 'You pick up an open shift';
  return h.asked_by_me?'You ask '+personName(ui,h.counterpart_id):personName(ui,h.requester_id)+' asks you';
}
function handoffList(ui,q){
  const items=(aux(ui).handoffs||[]).filter(h=>found(q,handoffTitle(ui,h),handoffSub(ui,h),h.message||'',h.state));
  setCount(items.length);
  const list=el('div',{class:'pb-list'},el('div',{class:'pb-list-head'},el('p',{},'Covers, trades, releases and pick-ups. A shift stays with its owner until a handoff is approved.')));
  if(!items.length){list.append(empty('No handoffs','Ask for cover, a trade or a release from one of your shifts in the schedule.'));return list;}
  const groups=[['Waiting for you',items.filter(h=>h.state==='awaiting_me')],['Waiting for others',items.filter(h=>pending(h)&&h.state!=='awaiting_me')],['Closed',items.filter(h=>!pending(h))]];
  if(!items.some(h=>h.id===state.handoff))state.handoff=(groups.find(g=>g[1].length)[1][0]).id;
  for(const [title,group] of groups){
    if(!group.length)continue;
    list.append(el('h3',{class:'pb-group'},title+' ('+group.length+')'));
    for(const h of group)list.append(row({'data-handoff-id':h.id},h.id===state.handoff,()=>{state.handoff=h.id;ui.navigate('requests').catch(ui.error);},handoffTitle(ui,h),handoffSub(ui,h),[chip(h.state)]));
  }
  return list;
}
const daysText=t=>(t.start_date===t.end_date?dateLabel(t.start_date):dateLabel(t.start_date)+' – '+dateLabel(t.end_date))+' ('+t.days+' day'+(t.days===1?'':'s')+')';
function timeOffList(ui,q){
  const items=(aux(ui).timeOff||[]).filter(t=>found(q,daysText(t),t.reason||'',t.state));
  setCount(items.length);
  const head=el('div',{class:'pb-list-head'},el('p',{},'Whole days in the workplace time zone. The manager decides.'));
  if(ui.has(TOOL.requestTimeOff))head.append(button('Request time off',()=>timeOffDialog(ui).catch(ui.error),true));
  const list=el('div',{class:'pb-list'},head);
  if(!items.length){list.append(empty('No time off','Request days off at least the notice the workplace asks for.'));return list;}
  if(!items.some(t=>t.id===state.timeOff))state.timeOff=items[0].id;
  for(const t of items)list.append(row({'data-time-off-id':t.id},t.id===state.timeOff,()=>{state.timeOff=t.id;ui.navigate('timeoff').catch(ui.error);},daysText(t),t.reason||'No reason given',[chip(t.state)]));
  return list;
}
const WEEKDAYS=[['mon','Monday'],['tue','Tuesday'],['wed','Wednesday'],['thu','Thursday'],['fri','Friday'],['sat','Saturday'],['sun','Sunday']];
function availabilityList(ui){
  const blocks=aux(ui).availability||[];setCount(blocks.length);
  const list=el('div',{class:'pb-list'},el('div',{class:'pb-list-head'},el('p',{},'The weekly times when you cannot work. Shifts in them are flagged; nothing is rescheduled.')));
  for(const [d,name] of WEEKDAYS){const own=blocks.filter(b=>b.weekday===d);if(own.length)list.append(el('div',{class:'pb-person','data-weekday':d},el('strong',{},name),el('span',{class:'pb-muted'},own.map(b=>b.start+'–'+b.end).join(', '))));}
  if(!blocks.length)list.append(empty('Always available','No blocked times.'));
  return list;
}
function notificationList(ui,q){
  const a=aux(ui),items=(a.notifications||[]).filter(n=>found(q,n.title,n.body,n.kind));
  setCount(items.length);
  const kind=select('kind',[['','All kinds'],['schedule.published','Schedule posted'],['shift.changed','Shift changed'],['open_shift.posted','Open shift'],['handoff.received','Handoff received'],['handoff.updated','Handoff updated'],['time_off.decided','Time off decided']],state.nKind);
  const st=select('state',[['','Any state'],['held','Held'],['released','Released']],state.nState);
  kind.setAttribute('aria-label','Notification kind');st.setAttribute('aria-label','Notification state');
  // The log is read again with the App's own filters; a reader who moved on is not pulled back.
  const refilter=async()=>{state.nKind=kind.value;state.nState=st.value;const r=await ui.call(TOOL.notifications,notificationArgs());a.notifications=r.notifications;a.notificationCursor=r.next_cursor;state.notification=null;if(ui.section==='notifications')await ui.navigate('notifications');};
  kind.addEventListener('change',()=>refilter().catch(ui.error));st.addEventListener('change',()=>refilter().catch(ui.error));
  const list=el('div',{class:'pb-list'},el('div',{class:'pb-list-head'},kind,st));
  if(!items.length){list.append(empty('No notifications','You are told what managers and coworkers do, never about your own changes.'));return list;}
  if(!items.some(n=>n.id===state.notification))state.notification=items[0].id;
  const tz=accountZone(ui);
  for(const n of items)list.append(row({'data-notification-id':n.id},n.id===state.notification,()=>{state.notification=n.id;ui.navigate('notifications').catch(ui.error);},n.title,when(n.created_at,tz),[chip(n.kind,'quiet'),chip(n.state)]));
  if(a.notificationCursor)list.append(button('Load older notifications',()=>(async()=>{const r=await ui.call(TOOL.notifications,{...notificationArgs(),cursor:a.notificationCursor});a.notifications.push(...r.notifications);a.notificationCursor=r.next_cursor;if(ui.section==='notifications')await ui.navigate('notifications');})().catch(ui.error)));
  return list;
}
function teamList(ui){
  const team=aux(ui).team||[];setCount(team.length);
  const list=el('div',{class:'pb-list'},el('div',{class:'pb-list-head'},el('p',{},'Your team and the positions each person holds.')));
  for(const p of team)list.append(el('div',{class:'pb-person','data-person-id':p.id},el('strong',{},p.name+(p.is_me?' (you)':'')),
    el('span',{class:'pb-muted'},p.position_ids.map(id=>positionName(ui,id)).join(', ')+' · up to '+p.cap+' h a week')));
  return list;
}

// ---- detail (right column) ---------------------------------------------------------------------------
function emptyView(ui){
  if(ui.section==='requests')return handoffDetail(ui);
  if(ui.section==='timeoff')return timeOffDetail(ui);
  if(ui.section==='availability')return availabilityView(ui);
  if(ui.section==='hours')return hoursView(ui);
  if(ui.section==='notifications')return notificationDetail(ui);
  if(ui.section==='settings')return settingsView(ui);
  return empty('No shift selected','Choose a shift.');
}
async function openShift(ui,id){
  const r=await ui.call(TOOL.shift,{id});
  if(r.shift.week_start!==state.week||ui.section!=='schedule'){state.week=r.shift.week_start;state.scope='team';if(ui.section!=='schedule')await ui.navigate('schedule');await ui.refresh(id);}
  else await ui.select(id);
}

// One shift: when, where, whose, what blocks it, and what I can do with it.
function shiftView(s,ui){
  const tz=wpZone,mine=s.is_mine,upcoming=s.phase==='upcoming';
  const page=el('article',{class:'pb-page','data-shift-id':s.id});
  const actions=el('div',{class:'pb-toolbar'});
  if(mine&&upcoming&&s.state==='assigned'&&!s.pending_handoff_id){
    if(ui.has(TOOL.cover))actions.append(button('Ask for cover',()=>coverDialog(ui,s).catch(ui.error),true));
    if(ui.has(TOOL.trade))actions.append(button('Offer a trade',()=>tradeDialog(ui,s).catch(ui.error)));
    if(ui.has(TOOL.release))actions.append(button('Release to open shifts',()=>releaseDialog(ui,s).catch(ui.error)));
  }
  if(s.state==='open'&&upcoming&&!s.pending_handoff_id&&ui.has(TOOL.pickup))actions.append(button('Pick up this shift',()=>pickupDialog(ui,s).catch(ui.error),true));
  if(s.pending_handoff_id&&ui.has(TOOL.handoff))actions.append(button('Open the pending handoff',()=>{state.handoff=s.pending_handoff_id;ui.navigate('requests').catch(ui.error);}));
  page.append(el('header',{class:'pb-head'},el('h2',{},s.position_name+' · '+s.location_name),el('p',{},shiftTime(s,tz)+' ('+s.hours+' hours)')),
    el('div',{class:'pb-chips'},shiftChips(s)),actions);
  for(const f of s.flags||[])page.append(el('section',{class:'pb-banner','data-tone':toneOf[f],'aria-label':'Flag '+f},el('p',{},el('strong',{},FLAG[f]||words(f)),'. The manager’s schedule stands; this only says where it breaks the policy or your own records.')));
  page.append(definition([['Assigned to',s.assignee_name||'Nobody: an open shift'],['Position',s.position_name+' (rate '+money(s.hourly_rate,aux(ui).workplace?.currency)+' an hour)'],
    ['Last moment to hand it over',when(s.cutoff_at,tz)],['Week',dateLabel(s.week_start)],s.cancelled_at?['Cancelled',when(s.cancelled_at,tz)]:null,['Shift ID',s.id]]));
  if(!mine&&s.state!=='cancelled'&&ui.has(TOOL.eligibility)){
    const card=el('section',{class:'pb-card','aria-label':'Could you take it'},el('h3',{},'Could you take it?'),el('p',{class:'pb-muted'},'Checking…'));
    page.append(card);
    ui.call(TOOL.eligibility,{id:s.id}).then(r=>{if(card.isConnected){card.replaceChildren(el('h3',{},'Could you take it?'),...eligibilityParts(ui,r,'You'));loaded(card);}}).catch(e=>{if(card.isConnected)card.replaceChildren(el('p',{role:'alert',class:'pb-error'},e.message));});
  }
  const history=el('ol',{class:'pb-history'});
  for(const h of s.history||[])history.append(el('li',{},el('strong',{},when(h.at,tz)+' · '+(h.by==='schedule'?'posted':h.by==='handoff'?'handed over':words(h.by))+(h.changed_by?' by '+personName(ui,h.changed_by):'')),
    el('span',{class:'pb-muted'},Object.entries(h.change||{}).map(([k,v])=>words(k)+': '+fieldValue(ui,k,v.from)+' → '+fieldValue(ui,k,v.to)).join('; '))));
  page.append(el('section',{class:'pb-card','aria-label':'History'},el('h3',{},'History'),history));
  return loaded(page);
}
function fieldValue(ui,key,value){
  if(value===null||value===undefined)return 'none';
  if(/^person-/.test(String(value)))return personName(ui,value);
  if(key==='start'||key==='end')return when(value,wpZone);
  return String(value);
}
function eligibilityParts(ui,r,who){
  const parts=[];
  parts.push(el('p',{'data-eligible':String(r.eligible)},el('strong',{},r.eligible?who+' can take it.':who+' cannot take it: '+r.blocks.map(b=>BLOCK[b]||b).join(', ')+'.')));
  parts.push(el('p',{class:'pb-muted'},'Week of '+dateLabel(r.hours.week_start)+': '+r.hours.before+' → '+r.hours.after+' of '+r.hours.cap+' hours. Rest before '+(r.rest.before_hours??'—')+' h, after '+(r.rest.after_hours??'—')+' h (minimum '+r.rest.minimum+' h).'));
  if(r.cutoff_passed)parts.push(el('p',{class:'pb-error'},'The cut-off has passed: it can no longer be handed over.'));
  if(r.other)parts.push(el('p',{},el('strong',{},r.other.eligible?personName(ui,r.other.person_id)+' can take your shift.':personName(ui,r.other.person_id)+' cannot take your shift: '+r.other.blocks.map(b=>BLOCK[b]||b).join(', ')+'.')));
  return parts;
}
async function coverDialog(ui,s){
  const base=await ui.call(TOOL.shift,{id:s.id}),write=writer(ui,base.version),team=(aux(ui).team||[]).filter(p=>!p.is_me);
  const who=select('to_person_id',[['','Choose a coworker'],...team.map(p=>[p.id,p.name+(p.position_ids.includes(s.position_id)?'':' (not a '+positionName(ui,s.position_id).toLowerCase()+')')])],'');
  const check=el('div',{'aria-label':'Eligibility','aria-live':'polite'}),note=message();
  who.addEventListener('change',()=>{check.replaceChildren();delete check.dataset.loaded;if(!who.value)return;ui.call(TOOL.eligibility,{id:s.id,person_id:who.value}).then(r=>{check.replaceChildren(...eligibilityParts(ui,r,personName(ui,who.value)));loaded(check);}).catch(e=>check.replaceChildren(el('p',{class:'pb-error'},e.message)));});
  dialog('Ask for cover','Send request',async()=>{
    if(!who.value)fail('Choose the coworker to ask.','invalid_input');
    const r=await write(TOOL.cover,withMessage({id:s.id,to_person_id:who.value},note));
    state.handoff=r.id;await ui.refresh(s.id);say('Cover request sent. The shift stays yours until it is approved.');
  }).body.append(el('p',{},shiftLabel(ui,s)),field('Coworker',who),check,field('Message (optional)',note),el('p',{class:'pb-muted'},'The shift stays yours until the coworker accepts and the manager approves.'));
}
async function tradeDialog(ui,s){
  const base=await ui.call(TOOL.shift,{id:s.id}),write=writer(ui,base.version);
  const r=await ui.call(TOOL.shifts,{...weekWindow(s.week_start,21),limit:200});
  const theirs=r.shifts.filter(x=>!x.is_mine&&x.state==='assigned'&&x.phase==='upcoming'&&!x.pending_handoff_id);
  const pick=select('their_shift_id',[['','Choose a coworker’s shift'],...theirs.map(x=>[x.id,shiftTime(x,wpZone)+' · '+positionName(ui,x.position_id)+' · '+x.assignee_name])],'');
  const check=el('div',{'aria-label':'Eligibility','aria-live':'polite'}),note=message();
  pick.addEventListener('change',()=>{check.replaceChildren();delete check.dataset.loaded;if(!pick.value)return;ui.call(TOOL.eligibility,{id:pick.value,give_shift_id:s.id}).then(x=>{check.replaceChildren(...eligibilityParts(ui,x,'You'));loaded(check);}).catch(e=>check.replaceChildren(el('p',{class:'pb-error'},e.message)));});
  dialog('Offer a trade','Send request',async()=>{
    if(!pick.value)fail('Choose the shift you want in exchange.','invalid_input');
    const out=await write(TOOL.trade,withMessage({id:s.id,their_shift_id:pick.value},note));
    state.handoff=out.id;await ui.refresh(s.id);say('Trade request sent. Nothing changes hands until it is approved.');
  }).body.append(el('p',{},'You give: '+shiftLabel(ui,s)),field('You take',pick,'Upcoming shifts of coworkers in the next three weeks.'),check,field('Message (optional)',note));
}
async function releaseDialog(ui,s){
  const base=await ui.call(TOOL.shift,{id:s.id}),write=writer(ui,base.version),note=message();
  dialog('Release to open shifts','Release shift',async()=>{
    const r=await write(TOOL.release,withMessage({id:s.id},note));state.handoff=r.id;await ui.refresh(s.id);say('Release requested. The shift stays yours until the manager approves.');
  }).body.append(el('p',{},shiftLabel(ui,s)),field('Message (optional)',note),el('p',{class:'pb-muted'},'A release always needs the manager. Until then the shift is yours.'));
}
async function pickupDialog(ui,s){
  const base=await ui.call(TOOL.shift,{id:s.id}),write=writer(ui,base.version),note=message(),check=el('div',{'aria-label':'Eligibility'});
  const r=await ui.call(TOOL.eligibility,{id:s.id});check.append(...eligibilityParts(ui,r,'You'));loaded(check);
  dialog('Pick up this shift','Ask to pick it up',async()=>{
    const out=await write(TOOL.pickup,withMessage({id:s.id},note));state.handoff=out.id;await ui.refresh(s.id);say('Pick-up requested.');
  }).body.append(el('p',{},shiftLabel(ui,s)),check,field('Message (optional)',note));
}

function handoffDetail(ui){
  const id=state.handoff,known=(aux(ui).handoffs||[]).find(h=>h.id===id);
  if(!known)return empty('No handoff selected','Choose a handoff.');
  const page=el('article',{class:'pb-page','data-handoff-id':id},el('p',{class:'pb-muted'},'Loading…'));
  (async()=>{
    const r=await ui.call(TOOL.handoff,{id}),h=r.handoff,tz=wpZone;
    if(state.handoff!==id||!page.isConnected)return;
    const actions=el('div',{class:'pb-toolbar'});
    if(h.state==='awaiting_me'&&ui.has(TOOL.respond)){
      actions.append(button('Accept',()=>respondDialog(ui,h,'accept',r.version).catch(ui.error),true));
      actions.append(button('Decline',()=>respondDialog(ui,h,'decline',r.version).catch(ui.error)));
    }
    if(h.asked_by_me&&pending(h)&&ui.has(TOOL.cancelHandoff))actions.append(button('Cancel request',()=>cancelHandoff(ui,h,r.version).catch(ui.error)));
    actions.append(button('Open the shift',()=>openShift(ui,h.shift.id).catch(ui.error)));
    if(h.other_shift)actions.append(button('Open the other shift',()=>openShift(ui,h.other_shift.id).catch(ui.error)));
    const history=el('ol',{class:'pb-history'});
    for(const x of h.history)history.append(el('li',{},el('strong',{},when(x.at,accountZone(ui))+' · '+words(x.action)+' by '+(x.actor==='me'?'you':x.person_id?personName(ui,x.person_id):x.actor)),
      el('span',{class:'pb-muted'},(STATE[x.state]||words(x.state))+(x.note?' · '+x.note:''))));
    page.replaceChildren(el('header',{class:'pb-head'},el('h2',{},handoffTitle(ui,h)),el('p',{},handoffSub(ui,h))),
      el('div',{class:'pb-chips'},chip(h.state),chip(h.kind,'quiet',KIND[h.kind])),actions,
      h.state==='approved'?el('section',{class:'pb-banner','data-tone':'good'},el('p',{},'Approved: the shift has changed hands.')):pending(h)?el('section',{class:'pb-banner'},el('p',{},'Nothing has changed hands yet. The shift stays with its owner until this is approved.')):null,
      definition([['Shift',shiftLabel(ui,h.shift)+' · '+personName(ui,h.shift.assignee)],h.other_shift?['In exchange for',shiftLabel(ui,h.other_shift)+' · '+personName(ui,h.other_shift.assignee)]:null,
        ['Asked by',h.asked_by_me?'You':personName(ui,h.requester_id)],h.counterpart_id&&h.kind!=='release'&&h.kind!=='pickup'?['Asked of',h.counterpart_id===aux(ui).me?.id?'You':personName(ui,h.counterpart_id)]:null,
        ['Message',h.message||'None'],['Cut-off',when(h.cutoff_at,tz)+' (the last moment to answer or decide)'],['Created',when(h.created_at,accountZone(ui))],
        h.decided_by?['Decided by',personName(ui,h.decided_by)+(h.note?': '+h.note:'')]:null,['Handoff ID',h.id]]),
      el('section',{class:'pb-card','aria-label':'History'},el('h3',{},'History'),history));
    loaded(page);
  })().catch(e=>{if(page.isConnected)page.replaceChildren(el('p',{role:'alert',class:'pb-error'},e.message));});
  return page;
}
async function respondDialog(ui,h,answer,version){
  const write=writer(ui,version),note=message(),check=el('div',{'aria-label':'Eligibility'});
  if(answer==='accept'&&ui.has(TOOL.eligibility)){const r=await ui.call(TOOL.eligibility,{id:h.shift.id,...(h.other_shift?{give_shift_id:h.other_shift.id}:{})});check.append(...eligibilityParts(ui,r,'You'));loaded(check);}
  dialog(answer==='accept'?'Accept this request':'Decline this request',answer==='accept'?'Accept':'Decline',async()=>{
    await write(TOOL.respond,withMessage({id:h.id,answer},note));await ui.refresh();say(answer==='accept'?'Accepted. It now waits for the manager where the workplace asks for one.':'Declined.');
  }).body.append(el('p',{},handoffTitle(ui,h)+' · '+handoffSub(ui,h)),check,field('Message (optional)',note),
    el('p',{class:'pb-muted'},answer==='accept'?'Accepting commits you to the shift once the manager approves.':'The request is closed and the shift stays with '+personName(ui,h.requester_id)+'.'));
}
async function cancelHandoff(ui,h,version){
  const write=writer(ui,version);
  dialog('Cancel this request?','Cancel request',async()=>{await write(TOOL.cancelHandoff,{id:h.id});await ui.refresh();say('Request cancelled.');})
    .body.append(el('p',{},handoffTitle(ui,h)),el('p',{class:'pb-muted'},'The shift stays yours.'));
}

function timeOffDetail(ui){
  const t=(aux(ui).timeOff||[]).find(x=>x.id===state.timeOff);
  if(!t)return empty('No entry selected','Choose a time-off entry.');
  const tz=accountZone(ui),actions=el('div',{class:'pb-toolbar'});
  if(['pending','approved'].includes(t.state)&&ui.has(TOOL.cancelTimeOff))actions.append(button('Cancel time off',()=>cancelTimeOff(ui,t).catch(ui.error)));
  const history=el('ol',{class:'pb-history'});
  for(const x of t.history)history.append(el('li',{},el('strong',{},when(x.at,tz)+' · '+words(x.action)+' by '+(x.actor==='me'?'you':x.person_id?personName(ui,x.person_id):x.actor)),x.note?el('span',{class:'pb-muted'},x.note):null));
  return loaded(el('article',{class:'pb-page','data-time-off-id':t.id},el('header',{class:'pb-head'},el('h2',{},daysText(t)),el('p',{},t.reason||'No reason given')),
    el('div',{class:'pb-chips'},chip(t.state)),actions,
    definition([['Requested',when(t.requested_at,tz)],['State',words(t.state)+(t.state==='pending'?' (expires when its first day begins, '+when(t.expires_at,wpZone)+')':'')],
      t.decided_by?['Decided by',personName(ui,t.decided_by)+' on '+when(t.decided_at,tz)+(t.note?': '+t.note:'')]:null,['Entry ID',t.id]]),
    el('section',{class:'pb-card','aria-label':'History'},el('h3',{},'History'),history)));
}
async function timeOffDialog(ui){
  const base=await ui.call(TOOL.timeOff,{}),write=writer(ui,base.version),policy=aux(ui).workplace?.policy;
  const start=el('input',{type:'date','data-field':'start'}),end=el('input',{type:'date','data-field':'end'}),reason=el('input',{type:'text','data-field':'reason',maxlength:'200'});
  start.addEventListener('change',()=>{if(!end.value||end.value<start.value)end.value=start.value;});
  dialog('Request time off','Send request',async()=>{
    if(!start.value||!end.value)fail('Give the first and the last day.','invalid_input');
    const r=await write(TOOL.requestTimeOff,{start:start.value,end:end.value,...(reason.value.trim()?{reason:reason.value.trim()}:{})});
    state.timeOff=r.id;await ui.refresh();say('Time off requested. The manager decides.');
  }).body.append(el('div',{class:'pb-pair'},field('First day',start),field('Last day',end)),field('Reason (optional)',reason),
    el('p',{class:'pb-muted'},'Whole days in the workplace time zone, at most 30.'+(policy?' The first day must be at least '+policy.time_off_notice_days+' days ahead, and no day may hold one of your shifts.':'')));
}
async function cancelTimeOff(ui,t){
  const base=await ui.call(TOOL.timeOff,{include_closed:true}),write=writer(ui,base.version);
  dialog('Cancel this time off?','Cancel time off',async()=>{await write(TOOL.cancelTimeOff,{id:t.id});await ui.refresh();say('Time off cancelled.');})
    .body.append(el('p',{},daysText(t)),el('p',{class:'pb-muted'},'An approved entry can be cancelled until its first day.'));
}

function availabilityView(ui){
  const page=el('article',{class:'pb-page','data-availability':''},el('p',{class:'pb-muted'},'Loading…'));
  (async()=>{
    const r=await ui.call(TOOL.availability,{}),write=writer(ui,r.version),editable=ui.has(TOOL.setAvailability);
    if(!page.isConnected)return;
    const rows=el('div',{class:'pb-blocks'});
    const addRow=(b={weekday:'mon',start:'09:00',end:'17:00'})=>{
      const day=select('weekday',WEEKDAYS,b.weekday),from=el('input',{type:'time','data-field':'start',value:b.start,step:'60'}),to=el('input',{type:'time','data-field':'end',value:b.end,step:'60'});
      const line=el('div',{class:'pb-block','data-block':''},field('Day',day),field('From',from),field('Until',to));
      if(editable)line.append(button('Remove',()=>line.remove()));else for(const x of [day,from,to])x.disabled=true;
      line.value=()=>({weekday:day.value,start:from.value,end:to.value});rows.append(line);
    };
    for(const b of r.blocks)addRow(b);
    const error=el('p',{role:'alert',class:'form-error pb-error'}),save=el('button',{type:'submit',class:'primary'},'Save availability');
    const form=el('form',{class:'pb-settings','aria-label':'Availability'},el('fieldset',{},el('legend',{},'Times you cannot work'),rows,editable?button('Add a time',()=>addRow()):null),
      error,editable?el('div',{class:'form-actions'},save):el('p',{class:'pb-muted'},'Changing availability is not allowed for this account and policy.'));
    form.addEventListener('submit',async event=>{
      event.preventDefault();save.disabled=true;error.textContent='';delete error.dataset.code;
      try{await write(TOOL.setAvailability,{blocks:[...rows.querySelectorAll('[data-block]')].map(x=>x.value())});await ui.refresh();say('Availability saved. Shifts are flagged at the next read; nobody is told.');}
      catch(e){error.textContent=e.message;error.dataset.code=e.code||'request_failed';save.disabled=false;}
    });
    page.replaceChildren(el('header',{class:'pb-head'},el('h2',{},'Availability'),el('p',{},'The weekly times when you cannot work, in the workplace time zone. Saving replaces the whole list.')),form);
    loaded(page);
  })().catch(e=>{if(page.isConnected)page.replaceChildren(el('p',{role:'alert',class:'pb-error'},e.message));});
  return page;
}
function hoursView(ui){
  const page=el('article',{class:'pb-page','data-hours':''},el('p',{class:'pb-muted'},'Loading…'));
  if(!state.week)return empty('No weeks yet','Your hours appear once a week is posted.');
  (async()=>{
    const r=await ui.call(TOOL.hours,weekWindow(state.week,28)),mine=ui.has(TOOL.shifts)?(await ui.call(TOOL.shifts,{...weekWindow(state.week,28),mine:true,limit:200})).shifts:[];
    if(!page.isConnected)return;
    const label=id=>{const x=mine.find(m=>m.id===id);return x?shiftTime(x,wpZone):id;};
    const weeks=el('div',{class:'pb-weeks'});
    for(const w of r.weeks)weeks.append(el('section',{class:'pb-card','data-week':w.week_start,'aria-label':'Week of '+dateLabel(w.week_start)},el('h3',{},'Week of '+dateLabel(w.week_start)+(w.posted_at?'':' (not posted yet)')),
      definition([['Scheduled',w.scheduled_hours+' of '+w.cap+' hours'+(w.over_cap?' (over your cap)':'')],['Left',w.hours_left+' hours'],['Days worked',String(w.days_worked)],
        ['Estimated pay',money(w.estimated_pay.amount,w.estimated_pay.currency)+' (scheduled hours × each position’s rate; an estimate, not payroll)']]),
      w.shift_ids.length?el('div',{class:'pb-toolbar'},w.shift_ids.map(id=>button(label(id),()=>openShift(ui,id).catch(ui.error),false,{'data-shift-id':id}))):el('p',{class:'pb-muted'},'No shifts.')));
    page.replaceChildren(el('header',{class:'pb-head'},el('h2',{},'Hours'),el('p',{},'Four weeks from the week of '+dateLabel(state.week)+'. A shift counts in the week it starts; cancelled shifts count nowhere.')),weeks);
    loaded(page);
  })().catch(e=>{if(page.isConnected)page.replaceChildren(el('p',{role:'alert',class:'pb-error'},e.message));});
  return page;
}
function notificationDetail(ui){
  const n=(aux(ui).notifications||[]).find(x=>x.id===state.notification);
  if(!n)return empty('No notification selected','Choose a notification to read it.');
  const tz=accountZone(ui),o=n.object;
  const open=o.type==='handoff'?button('Open the handoff',()=>{state.handoff=o.id;ui.navigate('requests').catch(ui.error);})
    :o.type==='time_off'?button('Open the time off',()=>{state.timeOff=o.id;ui.navigate('timeoff').catch(ui.error);})
    :o.type==='shift'?button('Open the shift',()=>openShift(ui,o.id).catch(ui.error)):null;
  return loaded(el('article',{class:'pb-page','data-notification-id':n.id},el('header',{class:'pb-head'},el('h2',{},n.title),el('p',{},'Written '+when(n.created_at,tz))),
    el('div',{class:'pb-chips'},chip(n.kind,'quiet'),chip(n.state)),textBlock(n.body),
    definition([['State',n.state==='held'?'Held until '+when(n.release_at,tz)+' (quiet hours)':'Released '+when(n.release_at,tz)],n.change?['Change',words(n.change)]:null,
      ['Email copy',n.email_copy?'Yes':'No'],['About',o.type.replace('_',' ')+' '+o.id],['Notification ID',n.id]]),
    open?el('div',{class:'pb-toolbar'},open):null));
}

// ---- settings ------------------------------------------------------------------------------------
function settingsView(ui){
  const page=el('article',{class:'pb-page','data-settings':''},el('header',{class:'pb-head'},el('h2',{},'Settings'),el('p',{},'Time zone, quiet hours and what you are told about.')),el('p',{class:'pb-muted'},'Loading…'));
  (async()=>{
    const r=await ui.call(TOOL.preferences,{}),p=r.preferences,write=writer(ui,r.version),wp=aux(ui).workplace;
    if(!page.isConnected)return;
    const editable=ui.has(TOOL.settings);
    const zone=el('input',{type:'text','data-field':'timezone',value:p.timezone,maxlength:'64'});
    const quiet=el('input',{type:'checkbox','data-field':'quiet_hours.enabled'});quiet.checked=p.quiet_hours.enabled;
    const from=el('input',{type:'time','data-field':'quiet_hours.start',value:p.quiet_hours.start,step:'60'}),to=el('input',{type:'time','data-field':'quiet_hours.end',value:p.quiet_hours.end,step:'60'});
    const email=el('input',{type:'checkbox','data-field':'email_notices'});email.checked=p.email_notices;
    const openShifts=el('input',{type:'checkbox','data-field':'open_shift_notices'});openShifts.checked=p.open_shift_notices;
    for(const input of [zone,quiet,from,to,email,openShifts])input.disabled=!editable;
    const error=el('p',{role:'alert',class:'form-error pb-error'}),save=el('button',{type:'submit',class:'primary'},'Save settings');
    const form=el('form',{class:'pb-settings','aria-label':'Settings'},
      el('fieldset',{},el('legend',{},'Time'),field('Time zone',zone,'An IANA zone. Quiet hours are taken in it; shift times are the workplace’s.')),
      el('fieldset',{},el('legend',{},'Quiet hours'),el('label',{class:'pb-check'},quiet,'Hold notifications during quiet hours (not those about a shift within 12 hours)'),el('div',{class:'pb-pair'},field('From',from),field('Until',to)),
        el('p',{class:'pb-muted'},p.in_quiet_hours?'Quiet hours are on now.':'Quiet hours are not on now.')),
      el('fieldset',{},el('legend',{},'What you are told'),el('label',{class:'pb-check'},openShifts,'Tell me about open shifts for my positions'),el('label',{class:'pb-check'},email,'Send an email copy of each notification')),
      error,editable?el('div',{class:'form-actions'},save):el('p',{class:'pb-muted'},'Changing settings is not allowed for this account and policy.'));
    form.addEventListener('submit',async event=>{
      event.preventDefault();save.disabled=true;error.textContent='';delete error.dataset.code;
      try{
        const patch={};
        if(zone.value.trim()!==p.timezone)patch.timezone=zone.value.trim();
        const q={};if(quiet.checked!==p.quiet_hours.enabled)q.enabled=quiet.checked;if(from.value!==p.quiet_hours.start)q.start=from.value;if(to.value!==p.quiet_hours.end)q.end=to.value;
        if(Object.keys(q).length)patch.quiet_hours=q;
        if(email.checked!==p.email_notices)patch.email_notices=email.checked;
        if(openShifts.checked!==p.open_shift_notices)patch.open_shift_notices=openShifts.checked;
        if(!Object.keys(patch).length)fail('No changes to save.','no_changes');
        await write(TOOL.settings,{patch});
        await ui.refresh();say('Settings saved.');
      }catch(e){error.textContent=e.message;error.dataset.code=e.code||'request_failed';save.disabled=false;}
    });
    const policy=wp?definition([['Workplace',wp.name+' ('+wp.timezone+')'],['Minimum rest',wp.policy.min_rest_hours+' hours between working days'],['Weekly cap',wp.policy.max_weekly_hours+' hours, or your own if lower'],
      ['Handoff cut-off',wp.policy.handoff_cutoff_hours+' hours before the shift'],['Time-off notice',wp.policy.time_off_notice_days+' days'],['Manager approval',wp.policy.manager_approval?'Needed for every handoff':'Only for releases']]):null;
    page.replaceChildren(page.firstChild,form,policy?el('section',{class:'pb-card','aria-label':'Workplace policy'},el('h3',{},'Workplace policy'),policy):null);loaded(page);
  })().catch(e=>{if(page.isConnected)page.replaceChildren(el('p',{role:'alert',class:'pb-error'},e.message));});
  return page;
}

export const config={
  id:'pegboard',title:'Pegboard',description:'Your shifts, the team’s schedule, handoffs and time off.',symbol:'▦',
  searchLabel:'Search shifts, handoffs, time off and notifications',initialSection:'schedule',
  list:TOOL.shifts,collection:'shifts',get:TOOL.shift,item:'shift',
  get listArgs(){
    if(!state.week)return {start:'2000-01-01T00:00:00Z',end:'2100-01-01T00:00:00Z',mine:true,limit:200};
    return {...weekWindow(),limit:200,...(state.scope==='mine'?{mine:true}:state.scope==='open'?{open:true}:{})};
  },
  // On the first refresh the list holds my shifts of every week: my next shift that has not ended
  // comes first, so it is the one selected. The schedule list itself is always in time order.
  sort:(a,b)=>{const rank=s=>s.id===state.focus?0:s.week_start===state.week?1:2;return rank(a)-rank(b);},
  heading:s=>s.id,subtitle:s=>s.start,actions:[],
  sections:ui=>{const a=aux(ui),waiting=(a.handoffs||[]).filter(h=>h.state==='awaiting_me').length,held=(a.notifications||[]).filter(n=>n.state==='held').length;
    return [{id:'schedule',label:'Schedule',symbol:'▦',count:false},
      {id:'requests',label:'Handoffs'+(waiting?' · '+waiting+' for you':''),symbol:'⇄',filter:()=>false,count:false},
      {id:'timeoff',label:'Time off',symbol:'☀',filter:()=>false,count:false},
      {id:'availability',label:'Availability',symbol:'◷',filter:()=>false,count:false},
      {id:'hours',label:'Hours',symbol:'Σ',filter:()=>false,count:false},
      {id:'notifications',label:'Notifications'+(held?' · '+held+' held':''),symbol:'✉',filter:()=>false,count:false},
      {id:'settings',label:'Settings',symbol:'⚙',filter:()=>false,count:false}];},
  load,renderList,emptyView,view:shiftView
};
mount(config);
