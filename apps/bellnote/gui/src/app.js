import {mount,el,textBlock} from '/shared/client.js';
// Bellnote's guardian portal. The App owns these views, labels and forms; the shared Host supplies
// only a fixed Agent MCP connection. Every value shown here comes from a Bellnote read made through
// that connection during the last refresh; navigation and unsent form input are the only page state.

// ---------- presentation helpers ----------
const STYLE=`
body[data-app=bellnote]{--accent:#2f6b5a;--soft:#e8f2ee}
body[data-app=bellnote] .toolbar input[type=search],body[data-app=bellnote] .collection-count{display:none}
body[data-app=bellnote] .toolbar{gap:12px}
.bn-today{display:flex;flex-direction:column;min-width:0}.bn-today strong{font-size:15px;letter-spacing:-.01em}.bn-today small{font-size:11px}
.bn-list{padding:0 14px 18px;display:grid;gap:8px}.bn-earlier>summary{cursor:pointer;list-style-position:inside}.bn-earlier[open]>summary{margin-bottom:8px}.bn-card .bn-earlier>summary{font-size:13px;color:var(--muted);margin-top:10px}.bn-list>h3,.bn-group{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:14px 8px 2px}
.bn-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:12px;align-items:center;width:100%;text-align:left;border:1px solid var(--line);border-radius:12px;background:#fff;padding:12px 14px}
.bn-row[aria-pressed=true]{border-color:var(--accent);background:var(--soft);box-shadow:inset 3px 0 var(--accent)}
.bn-row strong{display:block;font-size:13px}.bn-row small{font-size:11px}.bn-row .bn-right{text-align:right;font-size:12px;font-weight:600}
.bn-avatar{display:inline-grid;place-items:center;width:36px;height:36px;border-radius:50%;background:var(--soft);color:var(--accent);font-weight:700;font-size:12px;flex-shrink:0}
.bn-avatar.c1{background:#fdf0e1;color:#9a5b12}.bn-avatar.c2{background:#ece9fb;color:#5a47b0}
.bn-page{padding:28px 32px 48px;max-width:980px}
.bn-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:14px;margin-bottom:22px}
.bn-head h2{font-size:24px}.bn-head p{color:var(--muted);font-size:13px;margin-top:4px}
.bn-buttons{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.bn-buttons button{font-size:12px}
.bn-card{border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin:0 0 16px;background:#fff}
.bn-card>h3{font-size:14px;margin-bottom:12px;display:flex;justify-content:space-between;gap:8px;align-items:center}.bn-card>h3 button{font-size:11px;font-weight:500;padding:4px 10px}.bn-card>h3 small{font-weight:500}
.bn-card .body-text{margin:0 0 14px}.bn-day.marked{grid-template-columns:minmax(0,1fr) auto;align-items:center}.bn-day.marked small{grid-column:1/-1}
body[data-app=bellnote] .sidebar nav button[aria-current=page]{background:#dcebe5}
.bn-note{font-size:12px;color:var(--muted);background:#f6f7fa;border-radius:10px;padding:10px 12px;margin:10px 0}
.bn-badge{display:inline-block;border-radius:999px;padding:2px 9px;font-size:11px;font-weight:600;white-space:nowrap;background:#eef1f5;color:#4f5d71}
.bn-badge.good{background:#e3f4ea;color:#1f7a45}.bn-badge.warn{background:#fff3d9;color:#8a5a00}.bn-badge.bad{background:#fde8e6;color:#b2382b}.bn-badge.info{background:#e7effc;color:#2f5ea8}
.bn-items{display:grid;gap:0}.bn-item{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 14px;align-items:center;padding:11px 0;border-bottom:1px solid #f0f2f6}
.bn-item:last-child{border-bottom:0}.bn-item strong{font-size:13px}.bn-item small{font-size:11px}.bn-item .bn-buttons{justify-content:flex-end}
.bn-item .bn-sub{grid-column:1/-1;font-size:12px;color:#5b687b}.bn-item>.bn-badge{justify-self:end}
.bn-days{display:grid;grid-template-columns:repeat(auto-fill,minmax(158px,1fr));gap:8px}
.bn-day{border:1px solid var(--line);border-radius:10px;padding:9px 10px;font-size:11px;display:grid;gap:3px;align-content:start}.bn-day strong{font-size:12px}.bn-day.off{background:#f6f7fa;color:var(--muted)}
.bn-balance{font-size:34px;font-weight:700;letter-spacing:-.03em}.bn-balance.low{color:#b2382b}
.bn-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:6px 0 4px}
.bn-stat{background:#f6f8fa;border-radius:10px;padding:10px 12px}.bn-stat small{font-size:11px}.bn-stat strong{font-size:14px}
.bn-amount{font-variant-numeric:tabular-nums;font-weight:600;font-size:13px}.bn-amount.credit{color:#1f7a45}
.bn-menu{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}
.bn-menu .bn-day ul{margin:4px 0 0;padding-left:16px}.bn-menu li{margin:3px 0}.bn-menu li.excluded{color:#b2382b}
.bn-question{padding:8px 0;border-bottom:1px solid #f0f2f6;font-size:13px}.bn-question:last-child{border:0}
.bn-answers{font-size:12px;color:#5b687b;margin-top:4px}
.bn-filter{margin:12px 14px 0;width:calc(100% - 28px)}
.bn-attention{display:grid;gap:8px}.bn-attention .bn-item{border:1px solid var(--line);border-radius:12px;padding:12px 14px}
.bn-kids{display:grid;gap:10px;padding:4px 14px 18px}
.bn-kid{border:1px solid var(--line);border-radius:14px;padding:14px;display:grid;gap:8px;background:#fff}
.bn-kid header{display:flex;gap:10px;align-items:center}.bn-kid header strong{font-size:14px}
.bn-kid dl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 12px;margin:0;font-size:12px}.bn-kid dt{color:var(--muted)}.bn-kid dd{margin:0}
.bn-kid .bn-buttons button{padding:5px 10px;font-size:11px}
.bn-dialog p.bn-lead{font-size:13px;color:#4f5d71;margin:-12px 0 18px}
.bn-choice{display:flex;gap:16px;font-size:13px}.bn-choice label{display:flex;gap:6px;align-items:center}.bn-choice input{width:auto}
.bn-history{font-size:12px;color:#5b687b;margin:6px 0 0;padding-left:18px}
@media(max-width:760px){body[data-app=bellnote] #records{max-height:none}.bn-item>.bn-badge{justify-self:start}.bn-page{padding:20px 16px 36px}.bn-head h2{font-size:21px}.bn-card{padding:14px}.bn-item{grid-template-columns:minmax(0,1fr)}.bn-item .bn-buttons{justify-content:flex-start}.bn-today small{display:none}}
`;
try{const sheet=new CSSStyleSheet();sheet.replaceSync(STYLE);document.adoptedStyleSheets=[...document.adoptedStyleSheets,sheet];}catch{/* shared styles still apply */}

const money=c=>(c<0?'−':'')+'$'+(Math.abs(c)/100).toFixed(2);
const parseDay=d=>{const [y,m,x]=d.split('-').map(Number);return new Date(Date.UTC(y,m-1,x,12));};
const day=(d,o={weekday:'short',month:'short',day:'numeric'})=>new Intl.DateTimeFormat('en-US',{timeZone:'UTC',...o}).format(parseDay(d));
const longDay=d=>day(d,{weekday:'long',month:'long',day:'numeric'});
const addDays=(d,n)=>{const t=parseDay(d);t.setUTCDate(t.getUTCDate()+n);return t.toISOString().slice(0,10);};
let zone='UTC';
const when=(iso,o={})=>iso?new Intl.DateTimeFormat('en-US',{timeZone:zone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit',...o}).format(new Date(iso)):'—';
const zoneName=()=>{try{return new Intl.DateTimeFormat('en-US',{timeZone:zone,timeZoneName:'longGeneric'}).formatToParts(new Date()).find(p=>p.type==='timeZoneName')?.value||zone;}catch{return zone;}};
const clock=t=>{if(!t)return '';const [h,m]=t.split(':').map(Number);return (h%12||12)+':'+String(m).padStart(2,'0')+' '+(h<12?'AM':'PM');};
const words=s=>String(s).replace(/_/g,' ').replace(/^./,c=>c.toUpperCase());
const initials=n=>String(n).split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase();
const first=n=>String(n).split(' ')[0];
const badge=(text,tone='')=>el('span',{class:'bn-badge '+tone},text);
const WAY={guardian_pickup:'Picked up by a guardian',bus:'School bus',after_care:'After-care',walker:'Walks home',pickup:'Picked up'};
const ATT={present:['Present','good'],absent:['Absent','bad'],late:['Late','warn'],left_early:['Left early','warn']};
const TX={purchase:'Purchase',refund:'Refund',adjustment:'Adjustment',topup:'Top-up'};
const REPORT={absent:'Absence',late:'Late arrival',early_leave:'Early leave'};
const REPORT_STATE={submitted:'info',excused:'good',unexcused:'bad',cancelled:'',moot:''};
const FORM_KIND={permission_slip:'Permission slip',medication:'Medication',medical_consent:'Medical consent',information:'Information'};
const ANSWER={signed:['Signed','good'],declined:['Declined',''],withdrawn:['Withdrawn',''],needs_review:['Needs review','warn']};
const PERSON={approved:['Approved','good'],pending_review:['Waiting for the office','warn'],denied:['Denied by the office','bad'],removed:['Removed','']};
const NOTICE={'attendance.unexplained':'Attendance','absence.reviewed':'Absence review','form.published':'New form','form.changed':'Form changed','form.answered':'Form answered',
 'pickup.person_reviewed':'Pickup list','dismissal.recorded':'Dismissal change','dismissal.void':'Dismissal change','lunch.low_balance':'Lunch balance','lunch.refund':'Lunch refund','school.day_changed':'School calendar'};
const store={get:k=>{try{return sessionStorage.getItem('bellnote-'+k);}catch{return null;}},set:(k,v)=>{try{if(v==null)sessionStorage.removeItem('bellnote-'+k);else sessionStorage.setItem('bellnote-'+k,v);}catch{/* navigation is not persisted */}}};

// ---------- navigation state (not business data) ----------
const nav={child:store.get('child'),form:store.get('form'),notice:null,formFilter:'',noticeKind:''};
const keyOf=ui=>[ui.section,nav.child||'',ui.section==='forms'?nav.form||'':''].join('|');
const mine=k=>k.guardians.find(g=>g.is_me)||{};
const can=(k,right)=>Boolean(mine(k)[right]);
const kidName=(a,id)=>a.kids.find(k=>k.id===id)?.display_name||'Child';
const personName=(a,id)=>{for(const k of a.kids){const g=k.guardians.find(x=>x.person_id===id);if(g)return g.display_name;}return /^staff[-_]/.test(id||'')?'the school office':'someone the school holds';};
const collector=(a,p,id)=>p.pickup_people.find(x=>x.person_id===id)?.display_name||personName(a,id);
const avatarFor=(a,k)=>el('span',{class:'bn-avatar c'+(a.kids.indexOf(k)%3),'aria-hidden':'true'},initials(k.display_name));
function go(ui,section,patch={}){
 if(section===ui.section&&ui.aux.key)return reselect(ui,patch);
 Object.assign(nav,patch,{scroll:true});if(patch.child)store.set('child',patch.child);if(patch.form)store.set('form',patch.form);
 return ui.navigate(section).catch(ui.error);
}
function pickChild(ui,id){return reselect(ui,{child:id});}

// ---------- writes ----------
// Shared schema forms (from the live Agent tool schema) carry the version seen when they open and
// reuse their request ID on an unchanged retry. Confirmations and the form-answer sheet use the
// shared versioned write (ui.perform) with the same retry rule.
let formContext={tool:null,a:null};
const LABELS={
 'bellnote.absences.report':{kind:'What to report',start:'Day (or first day)',end:'Last day',time_local:'Arrival or leaving time',reason:'Reason for the school'},
 'bellnote.pickup.person_add':{name:'Full name',relationship:'Relationship to the child',phone:'Phone number'},
 'bellnote.dismissal.set':{date:'School day',mode:'Way home',person_id:'Collected by',note:'Note for the office'},
 'bellnote.lunch.topup':{amount_cents:'Amount',payment_method_id:'Pay with'},
 'bellnote.lunch.settings_update':{low_balance_threshold_cents:'Low-balance alert',daily_limit_cents:'Daily spending limit'},
 'bellnote.preferences.update':{email_notices:'Email me a copy of each notification',default_payment_method_id:'Default payment method'}
};
const labels={};
function act(ui,a,tool,defaults){
 formContext={tool,a};for(const k of Object.keys(labels))delete labels[k];Object.assign(labels,LABELS[tool]||{});
 if(tool==='bellnote.preferences.update')kept.delete('bellnote.preferences.get{}');
 ui.action(tool,defaults);
 // The shared form is built from the tool schema; adjust it for a guardian before it is used.
 const d=document.querySelector('dialog[open]');if(!d)return;
 const input=name=>d.querySelector('[data-field="'+name+'"]');
 // The school matches people by phone number; a school-held person ID is not something a guardian types.
 if(tool==='bellnote.pickup.person_add')input('person_id')?.closest('label')?.remove();
 const phone=input('phone');if(phone)Object.assign(phone,{type:'tel',autocomplete:'tel',pattern:'[0-9+\\(\\) .\\-]{7,20}',title:'Digits with spaces, dots, dashes, brackets or a leading +, 7 to 20 characters, for example 555-0123.'});
 const t=input('time_local');if(t)Object.assign(t,{pattern:'([01][0-9]|2[0-3]):[0-5][0-9]',title:'A 24-hour time, for example 10:15.'});
 for(const [name,need] of [['amount_cents',true],['low_balance_threshold_cents',true],['daily_limit_cents',false]])moneyField(input(name),need);
}
// Amounts are typed in dollars; the hidden schema field carries whole cents.
function moneyField(cents,required){
 if(!cents)return;
 const dollars=el('input',{type:'number',step:'0.01',min:'0',inputmode:'decimal',required,'data-money-for':cents.dataset.field,placeholder:cents.placeholder||'0.00'});
 if(cents.value!=='')dollars.value=(Number(cents.value)/100).toFixed(2);
 const sync=()=>{cents.value=dollars.value===''?'':String(Math.round(Number(dollars.value)*100));};
 dollars.addEventListener('input',sync);
 cents.type='hidden';cents.removeAttribute('required');cents.before(dollars);
}
// Core's own refusals carry protocol wording; the page says what happened instead.
const PLAIN={invalid_arguments:'Some details are not in the expected format. Check each field and try again.',
 idempotency_conflict:'This form was already sent with different details. Close it, refresh and try again.',
 request_failed:'Bellnote did not answer. Your request may not have arrived; send it again and it is applied only once.'};
new MutationObserver(()=>{for(const e of document.querySelectorAll('dialog .form-error[data-code]')){const plain=PLAIN[e.dataset.code];if(plain&&e.textContent!==plain)e.textContent=plain;}})
 .observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['data-code']});
const monthText=m=>{const [y,mo]=m.split('-').map(Number);return new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'short',year:'numeric'}).format(new Date(Date.UTC(y,mo-1,15)));};
function methodOptions(a){return (a.prefs?.payment_methods||[]).filter(m=>m.usable).map(m=>({value:m.id,label:m.label+(m.expiry_month?' · expires '+monthText(m.expiry_month):'')}));}
function pickupOptions(a){
 const k=a.child,p=a.pickup;if(!p)return [];
 return [...k.guardians.filter(g=>g.can_pickup).map(g=>({value:g.person_id,label:g.display_name+' ('+g.relationship+')'})),
  ...p.pickup_people.filter(x=>x.status==='approved').map(x=>({value:x.person_id,label:x.display_name+' ('+x.relationship+')'}))];
}
function field(name){
 const {tool,a}=formContext;if(!a)return {};
 if(tool==='bellnote.absences.report'){
  const days=(a.school?.days||[]).filter(d=>d.school_day).map(d=>({value:d.date,label:day(d.date)+' · report by '+when(d.absence_cutoff_at,{month:undefined,day:undefined})}));
  if(name==='start')return {options:days};
  if(name==='end')return {options:days,emptyLabel:'Same day only',help:'Only for an absence over several school days (up to 10).'};
  if(name==='time_local')return {placeholder:'HH:MM, e.g. 10:15',help:'Late arrival: when '+first(a.child.display_name)+' will arrive. Early leave: when they will leave. School hours '+clock(a.school.school.bell.start_local)+'–'+clock(a.school.school.bell.dismissal_local)+'.'};
  if(name==='reason')return {help:'The office sees this reason.'};
 }
 if(tool==='bellnote.dismissal.set'){
  if(name==='date')return {options:(a.pickup?.days||[]).filter(d=>d.plan).map(d=>({value:d.date,label:day(d.date)+' · change by '+when(d.cutoff_at,{month:undefined,day:undefined})}))};
  if(name==='person_id')return {options:pickupOptions(a),emptyLabel:'Nobody (bus, after-care or walking)',help:'Only for “Pickup”: a guardian or an approved pickup person.'};
 }
 if(tool==='bellnote.pickup.person_add'&&name==='phone')return {placeholder:'555-0123',help:'The school recognizes people by phone number.'};
 if(tool==='bellnote.lunch.topup'){
  const pol=a.school?.school.policy;
  if(name==='amount_cents')return {placeholder:'20.00',help:pol?'Between '+money(pol.topup_min_cents)+' and '+money(pol.topup_max_cents)+' at '+a.school.school.name+'.':''};
  if(name==='payment_method_id')return {options:methodOptions(a),emptyLabel:'Default payment method'};
 }
 if(tool==='bellnote.lunch.settings_update'&&name==='daily_limit_cents')return {help:'Leave empty for no daily limit.'};
 if(tool==='bellnote.lunch.settings_update'&&name==='low_balance_threshold_cents')return {help:'You get a notification when a purchase takes the balance under this amount.'};
 if(tool==='bellnote.preferences.update'&&name==='default_payment_method_id')return {options:(a.prefs?.payment_methods||[]).map(m=>({value:m.id,label:m.label})),emptyLabel:'No default'};
 return {};
}
function sheet(title,lead,content,submitLabel,submit){
 const err=el('p',{role:'alert',class:'form-error'}),button=el('button',{type:'submit',class:'primary'},submitLabel);
 const d=el('dialog',{class:'bn-dialog','aria-label':title});
 const form=el('form',{},el('h2',{},title),lead?el('p',{class:'bn-lead'},lead):null,content,err,el('div',{class:'form-actions'},el('button',{type:'button',onclick:()=>d.close()},'Close'),button));
 form.addEventListener('submit',async e=>{e.preventDefault();button.disabled=true;err.textContent='';delete err.dataset.code;
  try{await submit();d.close();}catch(x){err.textContent=x.message;err.dataset.code=x.code||'request_failed';}finally{button.disabled=false;}});
 d.append(form);d.addEventListener('close',()=>d.remove());document.body.append(d);d.showModal();return d;
}
function confirmWrite(ui,{title,lead,tool,args,submit,operation}){
 const d=sheet(title,lead,null,submit,()=>ui.perform(tool,args));d.dataset.operation=operation||tool;
}
function answerSheet(ui,a,form,kid,existing){
 const prefill=existing?.answers||{},inputs=[];
 const choice=el('div',{class:'bn-choice',role:'radiogroup','aria-label':'Your answer'});
 const radio=(value,label,checked)=>el('label',{},el('input',{type:'radio',name:'bn-action',value,checked}),label);
 choice.append(radio('sign','Sign',true),radio('decline','Decline',false));
 const qs=el('div',{class:'fields'});
 for(const q of form.questions){
  let input;
  if(q.type==='choice'){input=el('select',{'data-question':q.id});input.append(el('option',{value:''},'Choose…'));for(const o of q.options)input.append(el('option',{value:o},words(o)));}
  else if(q.type==='boolean'){input=el('select',{'data-question':q.id});input.append(el('option',{value:''},'Choose…'),el('option',{value:'true'},'Yes'),el('option',{value:'false'},'No'));}
  else input=el('input',{type:q.type==='number'?'number':'text','data-question':q.id,maxlength:q.type==='text'?2000:null});
  if(prefill[q.id]!==undefined)input.value=String(prefill[q.id]);
  inputs.push([q,input]);qs.append(el('label',{class:'field'},el('span',{},q.label+(q.required?' *':'')),input));
 }
 let pay=null;
 if(form.fee_cents>0){
  pay=el('select',{'data-field':'payment_method_id'});
  for(const o of methodOptions(a))pay.append(el('option',{value:o.value},o.label));
  if(a.prefs?.preferences.default_payment_method_id)pay.value=a.prefs.preferences.default_payment_method_id;
  qs.append(el('label',{class:'field'},el('span',{},'Pay the '+money(form.fee_cents)+' fee with'),pay,el('small',{},'Charged once when you sign; refunded if you withdraw while the form is open.')));
 }
 const sync=()=>{const signing=choice.querySelector('input:checked').value==='sign';for(const [q,input]of inputs){input.required=signing&&q.required;input.disabled=!signing;}if(pay)pay.disabled=!signing;};
 choice.addEventListener('change',sync);
 const lead='Version '+form.version+' of “'+form.title+'” for '+kid.display_name+'. Your answer covers exactly this version.';
 const d=sheet('Answer for '+first(kid.display_name),lead,el('div',{class:'fields'},choice,qs),'Send answer',()=>{
  const action=choice.querySelector('input:checked').value,args={id:form.id,child_id:kid.id,action,form_version:form.version};
  if(action==='sign'){
   const answers={};
   for(const [q,input]of inputs){if(input.value==='')continue;answers[q.id]=q.type==='number'?Number(input.value):q.type==='boolean'?input.value==='true':input.value;}
   args.answers=answers;if(pay&&pay.value)args.payment_method_id=pay.value;
  }
  return ui.perform('bellnote.forms.respond',args);
 });
 d.dataset.operation='bellnote.forms.respond';sync();
}
const button=(label,onclick,primary=false)=>el('button',{type:'button',class:primary?'primary':'',onclick},label);

// ---------- loading per view ----------
// Every Bellnote call is a full Core round trip (Core reads and validates the whole account state on
// each call), so a view makes only the reads it shows. Two reads are kept for the page load: the
// school (calendar, cut-offs and policy; also the district's "today") and the account preferences.
// They change only through Infra (time, calendar events, a new seed) or the preferences form, so the
// toolbar's Refresh and a page reload read them again, and saving preferences drops the kept copy.
const kept=new Map();
function keep(ui,name,args){const key=name+JSON.stringify(args);if(!kept.has(key))kept.set(key,ui.call(name,args).catch(e=>{kept.delete(key);throw e;}));return kept.get(key);}
document.addEventListener('click',e=>{if(e.target.closest?.('.toolbar button'))kept.clear();},true);
const schoolOf=(ui,k)=>keep(ui,'bellnote.schools.get',{id:k.school_id});
const prefsOf=ui=>keep(ui,'bellnote.preferences.get',{});
async function load(ui){
 const kids=ui.records;
 if(!kids.length)return {key:keyOf(ui),kids};
 const child=kids.find(k=>k.id===nav.child)||kids[0];nav.child=child.id;store.set('child',child.id);
 const a={kids,me:mine(kids[0]),writes:WRITES.filter(t=>ui.has(t))};
 await viewData(ui,a,child);
 a.key=keyOf(ui);return a;
}
// The reads of the current view for one child. Reads that need the school's "today" wait for it;
// the others are sent at the same time.
async function viewData(ui,a,child){
 const s=ui.section,call=(n,args)=>ui.call(n,args),schoolP=schoolOf(ui,child);
 const early={forms:()=>[call('bellnote.forms.list',{}),prefsOf(ui),nav.form?call('bellnote.forms.get',{id:nav.form}).catch(()=>null):null],
  attendance:()=>[call('bellnote.absences.list',{child_id:child.id})],
  pickup:()=>[can(child,'custodial')?call('bellnote.pickup.get',{id:child.id}):null],
  lunch:()=>[call('bellnote.menu.list',{id:child.school_id}),prefsOf(ui)],
  account:()=>[prefsOf(ui)],home:()=>[call('bellnote.forms.list',{}),call('bellnote.notifications.list',{})]}[s]?.()||[];
 const school=await schoolP;zone=school.school.time_zone;
 Object.assign(a,{child,school,today:school.start});
 const today=a.today,kids=a.kids;
 if(s==='home'){
  const [att,lunch,pickup,forms,notes]=await Promise.all([call('bellnote.attendance.list',{start:today,end:today}),
   Promise.all(kids.map(k=>k.lunch_account_id?call('bellnote.lunch.account_get',{id:k.lunch_account_id,start:today,end:today}):null)),
   Promise.all(kids.map(k=>can(k,'custodial')?call('bellnote.pickup.get',{id:k.id,start:today,end:addDays(today,6)}):null)),...early]);
  Object.assign(a,{attendance:att.records,forms:forms.forms,notices:notes.notifications,lunch:lunch.map(x=>x?.account||null),pickups:pickup});
 }else if(s==='attendance'){
  const [att,reports]=await Promise.all([call('bellnote.attendance.list',{id:child.id,start:addDays(today,-27),end:today}),...early]);
  Object.assign(a,{attendance:att.records,reports:reports.reports});
 }else if(s==='forms'){
  const [forms,prefs,guess]=await Promise.all(early);
  a.forms=forms.forms;a.prefs=prefs;
  const focus=a.forms.find(f=>f.id===nav.form)||formGroups(a).flatMap(g=>g.items)[0];
  if(focus){nav.form=focus.id;store.set('form',focus.id);a.form=guess?.form?.id===focus.id?guess.form:(await call('bellnote.forms.get',{id:focus.id})).form;}else a.form=null;
 }else if(s==='pickup'){
  a.pickup=(await early[0])||null;
 }else if(s==='lunch'){
  const [acct,menu,prefs]=await Promise.all([child.lunch_account_id?call('bellnote.lunch.account_get',{id:child.lunch_account_id,start:addDays(today,-13),end:today}):null,...early]);
  Object.assign(a,{lunch:acct,menu:menu.days,prefs});
 }else if(s==='notices'){
  a.notices=(await call('bellnote.notifications.list',{start:addDays(today,-60),end:today})).notifications;
 }else if(s==='account'){
  const [pays,prefs]=await Promise.all([call('bellnote.payments.list',{start:school.school.term.start_date,end:today}),...early]);
  Object.assign(a,{prefs,payments:pays.payments});
 }
}
// Choosing another child or another form re-reads only what that choice shows; the Host's refresh
// (account version, tool list, children) runs on navigation between views, after every write and on
// Refresh, so every write still carries the version observed at the last refresh.
let pickTicket=0;
async function reselect(ui,patch){
 const ticket=++pickTicket,a=ui.aux,root=document.querySelector('#app');
 Object.assign(nav,patch,{scroll:true});if(patch.child)store.set('child',patch.child);if(patch.form)store.set('form',patch.form);
 root.setAttribute('aria-busy','true');
 try{
  const next={...a};
  if(ui.section==='forms'&&patch.form&&a.forms){next.form=(await ui.call('bellnote.forms.get',{id:patch.form})).form;}
  else{const child=a.kids.find(k=>k.id===nav.child)||a.kids[0];await viewData(ui,next,child);}
  if(ticket!==pickTicket)return;
  next.key=keyOf(ui);Object.keys(a).forEach(k=>delete a[k]);Object.assign(a,next);
  await ui.navigate(ui.section);
 }catch(e){ui.error(e);}finally{if(ticket===pickTicket)root.setAttribute('aria-busy','false');}
}
const WRITES=['bellnote.absences.report','bellnote.absences.cancel','bellnote.forms.respond','bellnote.forms.withdraw','bellnote.pickup.person_add','bellnote.pickup.person_remove',
 'bellnote.dismissal.set','bellnote.dismissal.cancel','bellnote.lunch.topup','bellnote.lunch.settings_update','bellnote.preferences.update'];
const stale=ui=>ui.aux.key!==keyOf(ui);
let reloading=false;
function reloadSoon(ui){if(reloading)return;reloading=true;queueMicrotask(()=>ui.refresh().catch(ui.error).finally(()=>{reloading=false;}));}

// ---------- child picker (list column of child views) ----------
function childList(ui,summary){
 const a=ui.aux,box=el('div',{class:'bn-list'},el('h3',{},'Children'));
 for(const k of a.kids)box.append(el('button',{type:'button',class:'bn-row','aria-pressed':String(k.id===a.child.id),'data-child-id':k.id,onclick:()=>pickChild(ui,k.id)},
  avatarFor(a,k),el('span',{},el('strong',{},k.display_name),el('small',{},'Grade '+k.grade+' · '+k.school_name)),el('span',{class:'bn-right'},summary?.(k)||'')));
 return box;
}
function childHead(a,kicker,...buttons){
 const k=a.child;
 return el('header',{class:'bn-head'},el('div',{},el('span',{class:'kicker'},kicker),el('h2',{},k.display_name),el('p',{},'Grade '+k.grade+' · '+k.homeroom+' · '+k.school_name)),el('div',{class:'bn-buttons'},...buttons.filter(Boolean)));
}
const rightsNote=(text)=>el('p',{class:'bn-note'},text);

// ---------- Home ----------
function homeList(ui){
 const a=ui.aux,box=el('div',{class:'bn-kids'});
 a.kids.forEach((k,i)=>{
  const att=a.attendance.find(r=>r.child_id===k.id),acct=a.lunch[i],p=a.pickups[i];
  const plan=p?.days.find(d=>d.date===a.today)?.plan;
  const way=!can(k,'custodial')?'Shared with custodial guardians only':!plan?'No school today':plan.mode==='pickup'?'Picked up by '+collector(a,p,plan.person_id):WAY[plan.mode];
  box.append(el('article',{class:'bn-kid','data-child-id':k.id},
   el('header',{},avatarFor(a,k),el('div',{},el('strong',{},k.display_name),el('small',{},'Grade '+k.grade+' · '+k.homeroom+' · '+k.school_name))),
   el('dl',{},el('dt',{},'Today'),el('dd',{},att?ATT[att.status][0]+(att.time_local?' at '+clock(att.time_local):''):'Not marked yet'),
    el('dt',{},'Way home'),el('dd',{},way),
    el('dt',{},'Lunch'),el('dd',{},acct?money(acct.balance_cents)+(acct.below_threshold?' · below '+money(acct.low_balance_threshold_cents):''):'No lunch account')),
   el('div',{class:'bn-buttons'},button('Attendance',()=>go(ui,'attendance',{child:k.id})),can(k,'custodial')?button('Pickup',()=>go(ui,'pickup',{child:k.id})):null,button('Lunch',()=>go(ui,'lunch',{child:k.id})))));
 });
 return box;
}
function attentionItems(ui){
 const a=ui.aux,items=[];
 for(const f of a.forms.filter(f=>f.accepting_answers)){
  for(const id of f.child_ids){
   const k=a.kids.find(x=>x.id===id),r=f.responses.find(x=>x.child_id===id&&x.effective_state!=='withdrawn');
   if(!k||!can(k,'can_sign'))continue;
   if(!r||r.effective_state==='needs_review'&&r.mine)items.push(el('div',{class:'bn-item'},el('div',{},el('strong',{},f.title+' · '+first(k.display_name)),el('small',{},(r?'Changed after you signed: review version '+f.version:'Not answered yet')+' · due '+when(f.due_at))),
    el('div',{class:'bn-buttons'},button('Open form',()=>go(ui,'forms',{form:f.id})))));
  }
 }
 a.kids.forEach((k,i)=>{const acct=a.lunch[i];if(acct?.below_threshold)items.push(el('div',{class:'bn-item'},el('div',{},el('strong',{},first(k.display_name)+'’s lunch balance is '+money(acct.balance_cents)),el('small',{},'Under your alert of '+money(acct.low_balance_threshold_cents))),
  el('div',{class:'bn-buttons'},button('Open lunch account',()=>go(ui,'lunch',{child:k.id})))));});
 for(const r of a.attendance.filter(r=>r.explanation==='unexplained'))items.push(el('div',{class:'bn-item'},el('div',{},el('strong',{},kidName(a,r.child_id)+' marked '+ATT[r.status][0].toLowerCase()+' today'),el('small',{},'The school has no report from a guardian.')),
  el('div',{class:'bn-buttons'},button('Open attendance',()=>go(ui,'attendance',{child:r.child_id})))));
 return items;
}
function homeView(ui){
 const a=ui.aux,items=attentionItems(ui),changes=[];
 a.kids.forEach((k,i)=>{for(const d of a.pickups[i]?.days||[])if(d.plan?.source==='dismissal_change')changes.push(el('div',{class:'bn-item'},el('div',{},el('strong',{},day(d.date)+' · '+k.display_name),
  el('small',{},d.plan.mode==='pickup'?'Picked up by '+collector(a,a.pickups[i],d.plan.person_id):WAY[d.plan.mode])),badge('Changed','info')));});
 const notes=[...a.notices].reverse().slice(0,4);
 return el('article',{class:'bn-page'},el('header',{class:'bn-head'},el('div',{},el('span',{class:'kicker'},longDay(a.today)),el('h2',{},'Hello, '+first(a.me.display_name||'there')),el('p',{},'What needs you today across '+a.kids.length+' children.'))),
  el('section',{class:'bn-card'},el('h3',{},'Needs your attention',badge(String(items.length),items.length?'warn':'good')),items.length?el('div',{class:'bn-attention'},items):el('p',{class:'bn-note'},'Nothing is waiting for you.')),
  el('section',{class:'bn-card'},el('h3',{},'Changed ways home this week'),changes.length?el('div',{class:'bn-items'},changes):el('p',{class:'bn-note'},'Every child goes home the usual way this week.')),
  el('section',{class:'bn-card'},el('h3',{},'Latest from school',button('All notifications',()=>go(ui,'notices'))),notes.length?el('div',{class:'bn-items'},notes.map(n=>el('div',{class:'bn-item'},el('div',{},el('strong',{},n.title),el('small',{},when(n.at)+' · '+NOTICE[n.kind]))))):el('p',{class:'bn-note'},'No notifications in the last 30 days.')));
}

// ---------- Attendance ----------
function attendanceView(ui){
 const a=ui.aux,k=a.child,canReport=can(k,'custodial')&&ui.has('bellnote.absences.report');
 const head=childHead(a,'Attendance',canReport?button('Report absence or late arrival',()=>act(ui,a,'bellnote.absences.report',{id:k.id,kind:'absent'}),true):null);
 const days=a.school.days.filter(d=>d.school_day).slice(0,5);
 const upcoming=el('section',{class:'bn-card'},el('h3',{},'Coming school days at '+a.school.school.name),el('div',{class:'bn-days'},days.map(d=>el('div',{class:'bn-day'},el('strong',{},day(d.date)),
  el('span',{},clock(d.start_local)+'–'+clock(d.dismissal_local)+(d.kind==='early_dismissal'?' (early dismissal)':'')),el('small',{},'Report absences by '+when(d.absence_cutoff_at,{month:undefined,day:undefined}))))),
  a.school.days.some(d=>d.kind==='closed')?el('p',{class:'bn-note'},'No school: '+a.school.days.filter(d=>d.kind==='closed').map(d=>day(d.date)+(d.reason?' ('+d.reason+')':'')).join(', ')):null);
 // Reports of earlier school years (every day before the current term) are folded under the current ones.
 const since=a.school.school.term.start_date,past=r=>[...r.dates,...r.cancelled_dates].every(d=>d<since);
 const sorted=[...a.reports].sort((x,y)=>Date.parse(y.submitted_at)-Date.parse(x.submitted_at)),reports=sorted.filter(r=>!past(r)),earlier=sorted.filter(past);
 const reportRow=r=>{
  const open=r.state==='submitted'&&r.days.some(d=>d.state==='reported'&&!d.cutoff_passed),dd=d=>d<since?day(d,{year:'numeric',month:'short',day:'numeric'}):day(d);
  return el('div',{class:'bn-item','data-report-id':r.id},el('div',{},el('strong',{},REPORT[r.kind]+' · '+r.dates.map(dd).join(', ')+(r.time_local?' at '+clock(r.time_local):'')),
   el('small',{},'Sent by '+personName(a,r.submitted_by)+' · '+when(r.submitted_at))),
   el('div',{class:'bn-buttons'},badge(words(r.state),REPORT_STATE[r.state]),open&&ui.has('bellnote.absences.cancel')&&can(k,'custodial')?button('Cancel report',()=>confirmWrite(ui,{title:'Cancel this report?',
    lead:REPORT[r.kind]+' for '+k.display_name+' on '+r.dates.map(d=>day(d)).join(', ')+'. Days already past their cut-off stay reported.',tool:'bellnote.absences.cancel',args:{id:r.id},submit:'Cancel report'})):null),
   el('div',{class:'bn-sub'},'“'+r.reason+'”'+(r.review_note?' · Office: '+r.review_note:'')+(r.cancelled_dates.length?' · Cancelled: '+r.cancelled_dates.map(d=>day(d)).join(', '):'')+(r.moot_dates?.length?' · No school on '+r.moot_dates.map(d=>day(d)).join(', '):'')));
 };
 const reportCard=el('section',{class:'bn-card'},el('h3',{},'Reports to the school'),reports.length?el('div',{class:'bn-items'},reports.map(reportRow)):el('p',{class:'bn-note'},'No reports for '+first(k.display_name)+' this school year.'),
  earlier.length?el('details',{class:'bn-earlier','data-group':'earlier-reports'},el('summary',{},'Earlier school years · '+earlier.length),el('div',{class:'bn-items'},earlier.map(reportRow))):null);
 const recs=[...a.attendance].sort((x,y)=>y.date.localeCompare(x.date));
 const missed=recs.filter(r=>r.status!=='present').length;
 const record=el('section',{class:'bn-card'},el('h3',{},'Last four weeks',el('small',{},missed?missed+(missed===1?' day':' days')+' not fully present':'Present every marked day')),recs.length?el('div',{class:'bn-days'},recs.map(r=>el('div',{class:'bn-day marked','data-attendance-id':r.id},
  el('strong',{},day(r.date)),badge(ATT[r.status][0],ATT[r.status][1]),r.status==='present'&&!r.office_review?null:el('small',{},[r.time_local?clock(r.time_local):null,r.explanation?words(r.explanation):null,r.office_review?'Office: '+r.office_review:null].filter(Boolean).join(' · '))))):el('p',{class:'bn-note'},'No attendance marks yet.'));
 return el('article',{class:'bn-page'},head,can(k,'custodial')?null:rightsNote('You can see '+first(k.display_name)+'’s attendance. Reporting an absence needs custodial rights, which the school holds for '+k.guardians.filter(g=>g.custodial).map(g=>g.display_name).join(' and ')+'.'),upcoming,reportCard,record);
}

// ---------- Forms ----------
function formStatus(a,f){
 const todo=f.accepting_answers&&f.child_ids.some(id=>{const k=a.kids.find(x=>x.id===id),r=f.responses.find(x=>x.child_id===id&&x.effective_state!=='withdrawn');return k&&can(k,'can_sign')&&(!r||r.effective_state==='needs_review'&&r.mine);});
 return todo?'todo':f.accepting_answers?'answered':'closed';
}
// Closed forms of earlier school years (due before the current term) form their own group, folded by default.
function formGroups(a){
 const q=nav.formFilter.toLowerCase(),forms=a.forms.filter(f=>!q||(f.title+' '+FORM_KIND[f.kind]+' '+f.child_ids.map(id=>kidName(a,id)).join(' ')).toLowerCase().includes(q));
 const status=f=>{const s=formStatus(a,f);return s==='closed'&&f.due_at.slice(0,10)<a.school.school.term.start_date?'earlier':s;};
 return [['todo','To do'],['answered','Open, answered'],['closed','Closed'],['earlier','Earlier school years']].map(([id,label])=>({id,label,items:forms.filter(f=>status(f)===id).sort((x,y)=>(Date.parse(x.due_at)-Date.parse(y.due_at))*(id==='closed'||id==='earlier'?-1:1))}));
}
function formsList(ui){
 const a=ui.aux,box=el('div',{});
 const filter=el('input',{type:'search',class:'bn-filter',placeholder:'Filter forms','aria-label':'Filter forms',value:nav.formFilter});
 filter.addEventListener('input',()=>{nav.formFilter=filter.value;box.replaceChildren(filter,groups());filter.focus();});
 const groups=()=>{const list=el('div',{class:'bn-list'});for(const g of formGroups(a)){if(!g.items.length)continue;
  const rows=g.items.map(f=>el('button',{type:'button',class:'bn-row','aria-pressed':String(f.id===a.form?.id),'data-form-id':f.id,onclick:()=>go(ui,'forms',{form:f.id})},
   el('span',{class:'bn-avatar','aria-hidden':'true'},f.fee_cents?'$':'✎'),el('span',{},el('strong',{},f.title),el('small',{},FORM_KIND[f.kind]+' · '+f.child_ids.map(id=>first(kidName(a,id))).join(', '))),
   el('span',{class:'bn-right'},g.id==='closed'||g.id==='earlier'?'Closed':'Due '+when(f.due_at,{hour:undefined,minute:undefined}))));
  if(g.id==='earlier')list.append(el('details',{class:'bn-earlier','data-group':'earlier',open:!!nav.formFilter||g.items.some(f=>f.id===a.form?.id)},el('summary',{class:'bn-group'},g.label+' · '+g.items.length),...rows));
  else list.append(el('h3',{class:'bn-group'},g.label+' · '+g.items.length),...rows);}
  if(!list.children.length)list.append(el('p',{class:'bn-note'},'No forms match.'));return list;};
 box.append(filter,groups());return box;
}
function formView(ui){
 const a=ui.aux,f=a.form;
 if(!f)return el('div',{class:'empty'},el('h3',{},'No forms'),el('p',{},'Forms from school will appear here.'));
 const last=f.versions.at(-1);
 const kids=f.child_ids.map(id=>a.kids.find(k=>k.id===id)).filter(Boolean);
 const answers=el('div',{class:'bn-items'},kids.map(k=>{
  const r=f.responses.find(x=>x.child_id===k.id),state=r?.effective_state;
  const label=!r?['Not answered','warn']:ANSWER[state];
  const who=r?(r.mine?'You':r.by_display_name)+' · '+when(r.answered_at)+(r.form_version!==f.version?' · version '+r.form_version:''):'';
  const canAnswer=f.accepting_answers&&can(k,'can_sign')&&ui.has('bellnote.forms.respond')&&(!r||state==='withdrawn'||state==='needs_review'&&r.mine);
  const canWithdraw=f.accepting_answers&&r?.mine&&['signed','declined','needs_review'].includes(state)&&ui.has('bellnote.forms.withdraw');
  const note=!can(k,'can_sign')?'Signing for '+first(k.display_name)+' is with '+k.guardians.filter(g=>g.can_sign&&!g.is_me).map(g=>g.display_name).join(' and ')+'.':r&&!r.mine&&state!=='withdrawn'?'Answered by '+r.by_display_name+'; only they can withdraw it.':null;
  const shown=r&&Object.keys(r.answers).length?f.questions.filter(q=>r.answers[q.id]!==undefined).map(q=>q.label+': '+(typeof r.answers[q.id]==='boolean'?(r.answers[q.id]?'Yes':'No'):words(r.answers[q.id]))).join(' · '):'';
  return el('div',{class:'bn-item','data-child-id':k.id},el('div',{},el('strong',{},k.display_name),el('small',{},who||'Waiting for an answer')),
   el('div',{class:'bn-buttons'},badge(label[0],label[1]),canAnswer?button(state==='needs_review'?'Review and sign again':'Answer',()=>answerSheet(ui,a,f,k,r),true):null,
    canWithdraw?button('Withdraw answer',()=>confirmWrite(ui,{title:'Withdraw your answer?',lead:'Your answer for '+k.display_name+' on “'+f.title+'” will no longer count'+(r.paid_cents?' and the '+money(r.paid_cents)+' fee is refunded':'')+'. You can answer again while the form is open.',tool:'bellnote.forms.withdraw',args:{id:r.id},submit:'Withdraw answer'})):null),
   shown||r?.paid_cents||note?el('div',{class:'bn-sub'},[shown,r?.paid_cents?'Paid '+money(r.paid_cents):null,note].filter(Boolean).join(' · ')):null);
 }));
 return el('article',{class:'bn-page','data-form-id':f.id},el('header',{class:'bn-head'},el('div',{},el('span',{class:'kicker'},FORM_KIND[f.kind]+' · '+(a.kids.find(k=>k.school_id===f.school_id)?.school_name||'School')),el('h2',{},f.title),
   el('p',{},(f.accepting_answers?'Open until '+when(f.due_at):'Closed '+when(f.due_at))+' · version '+f.version)),badge(f.accepting_answers?'Open':'Closed',f.accepting_answers?'info':'')),
  el('div',{class:'bn-stats'},el('div',{class:'bn-stat'},el('small',{},'Event date'),el('strong',{},f.event_date?longDay(f.event_date):'None')),el('div',{class:'bn-stat'},el('small',{},'Fee'),el('strong',{},f.fee_cents?money(f.fee_cents)+' per child':'No fee')),el('div',{class:'bn-stat'},el('small',{},'Due'),el('strong',{},when(f.due_at)))),
  f.versions.length>1?el('p',{class:'bn-note'},'Changed by the school on '+when(last.at)+(last.reason?': '+last.reason:'')+'. A signature on an earlier version no longer counts.'):null,
  el('section',{class:'bn-card'},el('h3',{},'From the school'),textBlock(f.text),f.questions.length?el('div',{},f.questions.map(q=>el('div',{class:'bn-question'},el('strong',{},q.label),' ',el('small',{},words(q.type)+(q.options?': '+q.options.map(words).join(', '):'')+(q.required?' · required':' · optional'))))):null),
  el('section',{class:'bn-card'},el('h3',{},'Answers'),answers),
  f.versions.length>1?el('section',{class:'bn-card'},el('h3',{},'Version history'),el('ul',{class:'bn-history'},f.versions.map(v=>el('li',{},'Version '+v.version+' · '+when(v.at)+(v.reason?' · '+v.reason:'')+(v.event_date?' · event '+day(v.event_date):'')+' · '+(v.fee_cents?money(v.fee_cents):'no fee'))))):null);
}

// ---------- Pickup & dismissal ----------
function pickupView(ui){
 const a=ui.aux,k=a.child,p=a.pickup;
 if(!p)return el('article',{class:'bn-page'},childHead(a,'Pickup & dismissal'),rightsNote('Pickup lists and ways home for '+first(k.display_name)+' are shared only with custodial guardians ('+k.guardians.filter(g=>g.custodial).map(g=>g.display_name).join(', ')+'). You can still see attendance, forms and lunch.'));
 const manage=ui.has('bellnote.dismissal.set'),name=id=>collector(a,p,id);
 const days=el('div',{class:'bn-items'},p.days.map(d=>{
  const ch=d.plan?.change_id?p.dismissal_changes.find(c=>c.id===d.plan.change_id):null;
  if(!d.plan)return el('div',{class:'bn-item'},el('div',{},el('strong',{},day(d.date)),el('small',{},'No school')),badge('Closed'));
  const text=d.plan.mode==='pickup'?'Picked up by '+name(d.plan.person_id):WAY[d.plan.mode];
  const open=!ch||!ch.cutoff_passed;
  return el('div',{class:'bn-item','data-date':d.date},el('div',{},el('strong',{},day(d.date)+' · '+text),el('small',{},(d.plan.source==='default'?'Usual way home':'Changed by '+personName(a,ch?.recorded_by)+(ch?.note?' · “'+ch.note+'”':''))+' · dismissal '+clock(d.dismissal_local)+(d.kind==='early_dismissal'?' (early)':'')+' · changes until '+when(d.cutoff_at,{month:undefined,day:undefined}))),
   el('div',{class:'bn-buttons'},d.plan.source==='default'?null:badge('Changed','info'),manage&&open?button('Change',()=>act(ui,a,'bellnote.dismissal.set',{id:k.id,date:d.date,mode:d.plan.mode,person_id:d.plan.person_id||undefined})):null,
    ch&&!ch.cutoff_passed&&ch.phase==='upcoming'&&ui.has('bellnote.dismissal.cancel')?button('Cancel change',()=>confirmWrite(ui,{title:'Cancel this change?',lead:day(d.date)+': '+first(k.display_name)+' goes back to the usual way home ('+(WAY[p.default_dismissal]||'default')+').',tool:'bellnote.dismissal.cancel',args:{id:ch.id},submit:'Cancel change'})):null));
 }));
 const people=el('div',{class:'bn-items'},
  ...k.guardians.filter(g=>g.can_pickup).map(g=>el('div',{class:'bn-item'},el('div',{},el('strong',{},g.display_name+(g.is_me?' (you)':'')),el('small',{},words(g.relationship)+' · guardian')),badge('Guardian','good'))),
  ...p.pickup_people.map(x=>el('div',{class:'bn-item','data-person-id':x.id},el('div',{},el('strong',{},x.display_name),el('small',{},words(x.relationship)+' · '+x.phone+' · added by '+personName(a,x.added_by))),
   el('div',{class:'bn-buttons'},badge(PERSON[x.status][0],PERSON[x.status][1]),['approved','pending_review'].includes(x.status)&&ui.has('bellnote.pickup.person_remove')?button('Remove',()=>confirmWrite(ui,{title:'Remove '+x.display_name+'?',lead:x.display_name+' will no longer be able to collect '+k.display_name+'. A change still ahead that names them must be cancelled first.',tool:'bellnote.pickup.person_remove',args:{id:x.id},submit:'Remove'})):null))));
 const history=p.dismissal_changes.filter(c=>c.status!=='active');
 return el('article',{class:'bn-page'},childHead(a,'Pickup & dismissal',ui.has('bellnote.pickup.person_add')?button('Add pickup person',()=>act(ui,a,'bellnote.pickup.person_add',{id:k.id})):null),
  el('div',{class:'bn-stats'},el('div',{class:'bn-stat'},el('small',{},'Usual way home'),el('strong',{},WAY[p.default_dismissal])),el('div',{class:'bn-stat'},el('small',{},'People who may collect'),el('strong',{},String(k.guardians.filter(g=>g.can_pickup).length+p.pickup_people.filter(x=>x.status==='approved').length)))),
  el('section',{class:'bn-card'},el('h3',{},'Way home, next two weeks'),days),
  el('section',{class:'bn-card'},el('h3',{},'Who may collect '+first(k.display_name)),people,p.restrictions.length?el('div',{},el('h3',{},'Restrictions'),p.restrictions.map(r=>el('div',{class:'bn-item','data-restriction-id':r.id},el('div',{},el('strong',{},r.display_name),el('small',{},words(r.note))),badge('Not allowed','bad')))):null),
  history.length?el('section',{class:'bn-card'},el('h3',{},'Earlier changes'),el('ul',{class:'bn-history'},history.map(c=>el('li',{},day(c.date)+' · '+(c.mode==='pickup'?'Picked up by '+(c.person_display_name||name(c.person_id)):WAY[c.mode])+' · '+words(c.status)+' · by '+personName(a,c.recorded_by))))):null);
}

// ---------- Lunch ----------
function lunchView(ui){
 const a=ui.aux,k=a.child,acct=a.lunch?.account;
 if(!acct)return el('article',{class:'bn-page'},childHead(a,'Lunch'),rightsNote(first(k.display_name)+' has no lunch account.'));
 const pay=can(k,'can_pay');
 const head=childHead(a,'Lunch account',pay&&ui.has('bellnote.lunch.topup')?button('Add money',()=>act(ui,a,'bellnote.lunch.topup',{id:acct.id}),true):null,
  pay&&ui.has('bellnote.lunch.settings_update')?button('Alerts and limits',()=>act(ui,a,'bellnote.lunch.settings_update',{id:acct.id,low_balance_threshold_cents:acct.low_balance_threshold_cents,daily_limit_cents:acct.daily_limit_cents})):null);
 const tx=[...a.lunch.transactions].reverse();
 const menu=a.menu.filter(d=>d.school_id===k.school_id);
 return el('article',{class:'bn-page'},head,pay?null:rightsNote('Paying for '+first(k.display_name)+'’s lunch is with another guardian.'),
  el('section',{class:'bn-card'},el('div',{class:'bn-balance'+(acct.below_threshold?' low':''),'data-balance':String(acct.balance_cents)},money(acct.balance_cents)),
   el('div',{class:'bn-stats'},el('div',{class:'bn-stat'},el('small',{},'Low-balance alert'),el('strong',{},money(acct.low_balance_threshold_cents))),el('div',{class:'bn-stat'},el('small',{},'Daily limit'),el('strong',{},acct.daily_limit_cents==null?'No limit':money(acct.daily_limit_cents))),
    el('div',{class:'bn-stat'},el('small',{},'Meal restrictions'),el('strong',{},acct.meal_restrictions.length?acct.meal_restrictions.map(words).join(', '):'None'))),
   acct.below_threshold?el('p',{class:'bn-note'},'The balance is under your alert amount.'):null),
  el('section',{class:'bn-card'},el('h3',{},'Last two weeks'),tx.length?el('div',{class:'bn-items'},tx.map(t=>el('div',{class:'bn-item','data-transaction-id':t.id},
   el('div',{},el('strong',{},t.item||TX[t.kind]),el('small',{},when(t.at)+(t.allergens.length?' · contains '+t.allergens.map(words).join(', '):'')+(t.note?' · '+t.note:''))),
   el('div',{class:'bn-buttons'},t.restricted_item?badge('Restricted for '+first(k.display_name),'bad'):null,t.over_daily_limit?badge('Over daily limit','warn'):null,el('span',{class:'bn-amount'+(t.amount_cents>0?' credit':'')},(t.amount_cents>0?'+':'')+money(t.amount_cents)))))):el('p',{class:'bn-note'},'No purchases or top-ups in the last two weeks.')),
  el('section',{class:'bn-card'},el('h3',{},'Menu this week at '+k.school_name),el('div',{class:'bn-menu'},menu.map(d=>el('div',{class:'bn-day'+(d.menu_published?'':' off')},el('strong',{},day(d.date)),
   d.menu_published?el('ul',{},d.items.map(i=>el('li',{class:i.excluded_for.includes(k.id)?'excluded':''},i.name+(i.allergens.length?' ('+i.allergens.map(words).join(', ')+')':'')+(i.excluded_for.includes(k.id)?' · not for '+first(k.display_name):'')))):el('small',{},'Menu not published'))))));
}

// ---------- Notifications ----------
function noticesList(ui){
 const a=ui.aux,kinds=[...new Set(a.notices.map(n=>n.kind))];
 const pick=el('select',{class:'bn-filter','aria-label':'Show notifications about'},el('option',{value:''},'All notifications'),kinds.map(k=>el('option',{value:k},NOTICE[k]||words(k))));
 pick.value=nav.noticeKind;pick.addEventListener('change',()=>{nav.noticeKind=pick.value;ui.navigate(ui.section).catch(ui.error);});
 const list=el('div',{class:'bn-list'});
 for(const n of [...a.notices].reverse().filter(n=>!nav.noticeKind||n.kind===nav.noticeKind))list.append(el('button',{type:'button',class:'bn-row','aria-pressed':String(n.id===currentNotice(a)?.id),'data-notice-id':n.id,onclick:()=>{nav.notice=n.id;nav.scroll=true;ui.navigate(ui.section).catch(ui.error);}},
  el('span',{class:'bn-avatar','aria-hidden':'true'},(NOTICE[n.kind]||'N')[0]),el('span',{},el('strong',{},n.title),el('small',{},when(n.at)+' · '+(NOTICE[n.kind]||words(n.kind)))),el('span',{})));
 if(!list.children.length)list.append(el('p',{class:'bn-note'},'No notifications in the last 60 days.'));
 return el('div',{},pick,list);
}
const currentNotice=a=>{const shown=[...a.notices].reverse().filter(n=>!nav.noticeKind||n.kind===nav.noticeKind);return shown.find(n=>n.id===nav.notice)||shown[0];};
function noticeView(ui){
 const a=ui.aux,n=currentNotice(a);
 if(!n)return el('div',{class:'empty'},el('h3',{},'No notifications'),el('p',{},'The school, the cafeteria and the other guardian’s actions appear here.'));
 const target={absence_report:'attendance',attendance_record:'attendance',form:'forms',form_response:'forms',pickup_person:'pickup',dismissal_change:'pickup',lunch_account:'lunch',lunch_transaction:'lunch',school:'attendance'}[n.object_type];
 const kid=a.kids.find(k=>k.id===n.child_id);
 const open=target&&!(target==='pickup'&&kid&&!can(kid,'custodial'))?button('Open in '+({attendance:'Attendance',forms:'Forms',pickup:'Pickup & dismissal',lunch:'Lunch'}[target]),()=>go(ui,target,{...(kid?{child:kid.id}:{}),...(n.object_type==='form'?{form:n.object_id}:{})})):null;
 return el('article',{class:'bn-page','data-notice-id':n.id},el('header',{class:'bn-head'},el('div',{},el('span',{class:'kicker'},(NOTICE[n.kind]||words(n.kind))+(kid?' · '+kid.display_name:'')),el('h2',{},n.title),el('p',{},when(n.at,{weekday:'long'}))),el('div',{class:'bn-buttons'},open)),
  el('section',{class:'bn-card'},textBlock(n.body),n.email_message_stored?el('p',{class:'bn-note'},'An email copy of this notification was stored for delivery.'):null));
}

// ---------- Account ----------
function accountList(ui){
 const a=ui.aux,p=a.prefs;
 return el('div',{class:'bn-list'},el('h3',{},'Notifications'),el('div',{class:'bn-row'},el('span',{class:'bn-avatar','aria-hidden':'true'},'@'),el('span',{},el('strong',{},p.preferences.email_notices?'Email copies on':'Email copies off'),el('small',{},'In-app notifications are always kept.')),
   ui.has('bellnote.preferences.update')?button('Edit',()=>act(ui,a,'bellnote.preferences.update',{email_notices:p.preferences.email_notices,default_payment_method_id:p.preferences.default_payment_method_id})):el('span',{})),
  el('h3',{},'Payment methods'),...p.payment_methods.map(m=>el('div',{class:'bn-row','data-method-id':m.id},el('span',{class:'bn-avatar','aria-hidden':'true'},m.kind==='card'?'▭':'⌂'),el('span',{},el('strong',{},m.label),el('small',{},(m.expiry_month?(m.expired?'Expired ':'Expires ')+monthText(m.expiry_month):'No expiry')+(m.id===p.preferences.default_payment_method_id?' · default':''))),
   badge(m.usable?'Usable':m.expired?'Expired':'Declined',m.usable?'good':'bad'))));
}
function accountView(ui){
 const a=ui.aux,methods=new Map(a.prefs.payment_methods.map(m=>[m.id,m.label]));
 const pays=[...a.payments].sort((x,y)=>Date.parse(y.paid_at)-Date.parse(x.paid_at));
 return el('article',{class:'bn-page'},el('header',{class:'bn-head'},el('div',{},el('span',{class:'kicker'},'Account'),el('h2',{},a.me.display_name||'Your account'),el('p',{},'Family, rights and payments this school year'))),
  el('section',{class:'bn-card'},el('h3',{},'Family and rights'),el('div',{class:'bn-items'},a.kids.map(k=>el('div',{class:'bn-item'},el('div',{},el('strong',{},k.display_name),el('small',{},k.guardians.map(g=>g.display_name+(g.is_me?' (you)':'')+': '+['custodial','can_pickup','can_sign','can_pay'].filter(r=>g[r]).map(r=>({custodial:'custodial',can_pickup:'pickup',can_sign:'sign',can_pay:'pay'}[r])).join(', ')).join(' · '))))))),
  el('section',{class:'bn-card'},el('h3',{},'Payments'),pays.length?el('div',{class:'bn-items'},pays.map(x=>el('div',{class:'bn-item','data-payment-id':x.id},el('div',{},el('strong',{},(x.kind==='form_fee'?'Form fee':'Lunch top-up')+' · '+kidName(a,x.child_id)),
   el('small',{},when(x.paid_at)+' · '+(methods.get(x.payment_method_id)||'a payment method no longer on file')+(x.refunded_at?' · refunded '+when(x.refunded_at)+(x.refund_reason?' ('+words(x.refund_reason)+')':''):''))),
   el('div',{class:'bn-buttons'},badge(words(x.status),x.status==='paid'?'good':''),el('span',{class:'bn-amount'},money(x.amount_cents)))))):el('p',{class:'bn-note'},'No payments this school year.')));
}

// ---------- assembly ----------
const VIEWS={home:[homeList,homeView],attendance:[ui=>childList(ui),attendanceView],forms:[formsList,formView],pickup:[ui=>childList(ui,k=>can(k,'custodial')?'':'Not shared'),pickupView],
 lunch:[ui=>childList(ui),lunchView],notices:[noticesList,noticeView],account:[accountList,accountView]};
function toolbarContext(ui){
 const a=ui.aux,box=document.querySelector('.bn-today')||el('div',{class:'bn-today'});
 if(!box.isConnected)document.querySelector('.toolbar')?.prepend(box);
 box.replaceChildren(el('strong',{},a.today?longDay(a.today):'Bellnote'),el('small',{},(a.writes?.length?'Signed in as '+(a.me?.display_name||'guardian'):'View only: this session cannot change anything')+' · times in '+zoneName()));
}
export const config={
 id:'bellnote',title:'Bellnote',description:'School–family portal: attendance, forms, pickup and lunch.',symbol:'B',
 list:'bellnote.children.list',collection:'children',
 labels,field,initialSection:'home',
 actions:[
  {label:'Report absence or late arrival',tool:'bellnote.absences.report',hidden:true,submit:'Send report',success:'Report sent to the school.'},
  {label:'Add a pickup person',tool:'bellnote.pickup.person_add',hidden:true,submit:'Add person',success:'Pickup person added.'},
  {label:'Change the way home',tool:'bellnote.dismissal.set',hidden:true,submit:'Save change',success:'Way home changed.'},
  {label:'Add money to lunch account',tool:'bellnote.lunch.topup',hidden:true,submit:'Pay',success:'Lunch account topped up.'},
  {label:'Lunch alerts and limits',tool:'bellnote.lunch.settings_update',hidden:true,submit:'Save',success:'Lunch settings saved.'},
  {label:'Notification preferences',tool:'bellnote.preferences.update',hidden:true,submit:'Save',success:'Preferences saved.'}
 ],
 sections:()=>[['home','Home','⌂'],['attendance','Attendance','◷'],['forms','Forms','✎'],['pickup','Pickup & dismissal','⇆'],['lunch','Lunch','¤'],['notices','Notifications','◉'],['account','Account','⚙']]
  .map(([id,label,symbol])=>({id,label,symbol,count:false,filter:()=>false})),
 load,
 renderList:(shown,ui)=>{
  if(!ui.aux.key||stale(ui)){reloadSoon(ui);return el('p',{class:'bn-note'},'Loading…');}
  toolbarContext(ui);
  if(!ui.aux.kids.length)return el('p',{class:'bn-note'},'No children on this account.');
  return VIEWS[ui.section][0](ui);
 },
 emptyView:ui=>{
  if(!ui.aux.key||stale(ui)||!ui.aux.kids.length)return el('div',{class:'empty'},el('p',{},ui.aux.kids?.length===0?'Nothing to show.':'Loading…'));
  // On a phone the list sits above the detail: bring a chosen item into view.
  if(nav.scroll&&matchMedia('(max-width:760px)').matches)requestAnimationFrame(()=>document.querySelector('.detail')?.scrollIntoView({block:'start'}));
  nav.scroll=false;
  return VIEWS[ui.section][1](ui);
 }
};
mount(config);
