import {mount,el,tag,metadata} from '/shared/client.js';

const T={
 people:'mendwell-pharmacy.household.list',grants:'mendwell-pharmacy.grants.list',cards:'mendwell-pharmacy.cards.list',stores:'mendwell-pharmacy.stores.list',
 rxs:'mendwell-pharmacy.rx.list',rx:'mendwell-pharmacy.rx.get',fills:'mendwell-pharmacy.fills.list',fill:'mendwell-pharmacy.fills.get',
 grantPreview:'mendwell-pharmacy.grants.change.preview',grantConfirm:'mendwell-pharmacy.grants.change.confirm',
 cashPreview:'mendwell-pharmacy.fills.choose_cash.preview',cashConfirm:'mendwell-pharmacy.fills.choose_cash.confirm',
 prepayPreview:'mendwell-pharmacy.fills.prepay.preview',prepayConfirm:'mendwell-pharmacy.fills.prepay.confirm',
 cancelPreview:'mendwell-pharmacy.fills.cancel.preview',cancelConfirm:'mendwell-pharmacy.fills.cancel.confirm',
 request:'mendwell-pharmacy.fills.request',quantity:'mendwell-pharmacy.fills.change_quantity',store:'mendwell-pharmacy.fills.change_store',
 wait:'mendwell-pharmacy.fills.wait',collector:'mendwell-pharmacy.fills.set_collector',
 planCreate:'mendwell-pharmacy.plan_requests.create',planWithdraw:'mendwell-pharmacy.plan_requests.withdraw',
 renew:'mendwell-pharmacy.renewals.create',renewWithdraw:'mendwell-pharmacy.renewals.withdraw'
};
const FLOW={grant:{preview:T.grantPreview,confirm:T.grantConfirm,approval:true,button:'Confirm access change'},revoke:{preview:T.grantPreview,confirm:T.grantConfirm,approval:true,button:'Confirm revocation'},
 prepay:{preview:T.prepayPreview,confirm:T.prepayConfirm,approval:true,button:'Confirm prepayment'},cash:{preview:T.cashPreview,confirm:T.cashConfirm,approval:false,button:'Confirm cash price'},
 cancel:{preview:T.cancelPreview,confirm:T.cancelConfirm,approval:false,button:'Confirm cancellation'}};
const TZ='America/New_York',NOTE_MAX=500;
const STATE={requested:'In pharmacist review',waiting_stock:'Waiting for stock',claim_rejected:'Rejected by the drug plan',pending_plan_decision:'Waiting for the plan’s decision',ready:'Ready for pickup',collected:'Picked up',returned_to_stock:'Returned to stock',cancelled:'Cancelled'};
const REASON={refill_too_soon:'too soon to refill',prior_auth_required:'prior authorization required',not_covered:'not covered by the drug plan',quantity_limit:'over the plan’s quantity limit'};
const ASK={refill_too_soon:'an early-refill override',prior_auth_required:'prior authorization'};
const REFUSAL={on_hold:'the fill was on hold',not_ready:'the fill was not ready',store_closed:'the store was closed',collector_not_authorized:'the person collecting was not authorized to collect it',payment_failed:'the payment did not go through'};
const CANCEL={agent:'cancelled at your request',rx_expired:'the prescription expired before the fill was made',rx_superseded:'the prescription was replaced before the fill was made'};
const TIMER={expiry:'Nothing more happens to it when the prescription expires.',review:'The pharmacist stops reviewing it.',resubmission:'It is not sent to the drug plan again.',warning:'You will not get a pickup reminder for it.',return:'It is not put back on the shelf later; it is cancelled now instead.'};
const AUTH={live:'authorized on the card and charged when the fill is collected',captured:'charged',voided:'released, not charged'};
const HOST_REFUSED={'Business operation not permitted':'not_permitted','Invalid business request':'invalid_request','Invalid request token':'session','Access link required':'session','Open the access link printed by the Host':'session','Same-origin JSON required':'session','Origin not allowed':'session','Invalid Host':'session','Not found':'invalid_request'};
const SCOPE={view:'View',refill:'Refill',pickup:'Pickup'};
const SCOPE_TEXT={view:'see prescriptions, fills, pharmacist notes, claims and payments',refill:'everything in View, plus request and change fills, pay cash, ask the plan, ask for renewals, cancel and name a collector',pickup:'see pickup details (store, status, amount due and dates) and collect at the counter'};
const POWER={self:'You',guardian:'You are a guardian',view:'You have view access',refill:'You have refill access',pickup:'You have pickup access'};
const RELATION={self:'Account holder',spouse:'Spouse',child:'Child',parent:'Parent',in_law:'In-law',other:'Other'};
const REQ_STATE={pending:'pending',approved:'approved',denied:'denied',withdrawn:'withdrawn'};
const APPROVAL={active:'Confirmed, ready to use',used:'Used',expired:'Expired'};
const ACTIVE=['requested','waiting_stock','claim_rejected','pending_plan_decision','ready'];
const DAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],WEEK=[1,2,3,4,5,6,0];
const FRIENDLY={
 stale_version:'Mendwell changed since this page last read it. Check the refreshed details, then try again.',
 on_hold:'This fill is on hold for a pharmacist check, so the pharmacy will not change it until the pharmacist releases it.',
 no_fills_remaining:'This prescription has no fills left, so the pharmacy cannot fill it again. Ask the prescriber to renew it.',
 rx_expired:'This prescription has expired, so the pharmacy cannot fill it. Ask the prescriber to renew it.',
 rx_superseded:'This prescription was replaced by a newer one; request the fill on the new prescription.',
 store_unavailable:'That store does not have this medicine in stock, so the fill was not moved.',
 request_pending:'A plan request is pending for this fill. Withdraw it or wait for the decision first.',
 stale_preview:'The details behind this preview changed, so nothing was done. Preview again.',
 permission_denied:'This operation is not allowed for the current account and policy.',
 not_permitted:'Mendwell’s current policy does not allow this operation, so nothing was sent. Press Refresh to see what you can do now.',
 session:'This page’s session is no longer valid, so nothing was sent. Open the access link printed by the Host again.',
 invalid_request:'The Host refused this request before it reached Mendwell, so nothing was done.',
 invalid_state:'The pharmacy cannot do that for this record in its current state, so nothing was changed. Check the details below.',
 not_authorized:'This account is not allowed to do that for this person, so nothing was changed.',
 not_found:'Mendwell no longer has that record, so nothing was changed.',
 invalid_arguments:'Mendwell did not accept those details, so nothing was changed. Check the form and try again.',
 request_not_pending:'That request is no longer pending, so nothing was changed.',
 quantity_not_allowed:'That quantity is not one this medicine comes in, so nothing was changed.',
 duplicate_request:'Mendwell already has the same request in progress, so nothing new was sent.',
 invalid_event:'Mendwell did not accept that update, so nothing was changed.',
 invalid_seed:'Mendwell’s records could not be loaded, so nothing was changed.',
 unknown_tool:'Mendwell does not offer that operation, so nothing was sent.',
 payment_failed:'The card was declined or has expired, so nothing was authorized.',
 confirmation_required:'This change still needs its confirmation.',
 confirmation_invalid:'The confirmation for this preview is no longer usable, so nothing was changed.'
};
const plainError=(code,plain,raw)=>{const v=plain?.[code];return (typeof v==='function'?v(raw||''):v)||FRIENDLY[code]||'Mendwell refused this, so nothing was changed.';};
const allowedQuantities=raw=>{const m=/quantities ([\d, ]+)/.exec(raw);return 'That quantity is not one this medicine comes in'+(m?'; it comes in '+m[1].trim().replace(/, (\d+)$/,' or $1'):'')+'. Nothing was changed.';};
const GRANT_REFUSALS=[
 [/is not after the current time/,'That end time has already passed, so nothing was changed. Choose a later end, or leave it empty for no end date.'],
 [/already gives this access with this expiry/,'This person already has exactly this access with the same end, so there is nothing to change.'],
 [/after the last supported time/,'That end date is later than Mendwell supports (the end of 2199), so nothing was changed. Choose an earlier date.'],
 [/belongs to another patient/,'That fill belongs to someone else, so it cannot be part of this access. Nothing was changed.'],
 [/has already ended/,'This access has already ended, so there is nothing to revoke. Press Refresh to see the current list.']
];
const grantRefusal=(kind,e)=>(kind==='grant'||kind==='revoke')&&e.code==='invalid_state'?coded('invalid_state',(GRANT_REFUSALS.find(([re])=>re.test(e.message||''))||[null,'Mendwell cannot make this access change in the current state of these records, so nothing was changed.'])[1]):e;
const NO_PERSON='No person with that ID is known to Mendwell, so nothing was done. Check the ID.';
const READS=new Set(['household.list','grants.list','cards.list','stores.list','rx.list','rx.get','fills.list','fills.get'].map(x=>'mendwell-pharmacy.'+x));
const nativeFetch=window.fetch.bind(window);
window.fetch=async(url,init)=>{
 const r=await nativeFetch(url,init);
 if(url!=='/api/call'||!r)return r;
 let body=null;
 try{body=typeof r.clone==='function'?await r.clone().json():typeof r.json==='function'?await r.json():null;}catch{body=null;}
 if(body?.version)seeEpoch(body.version.epoch);
 if(r.ok&&body?.status==='ok')observe(init,body);
 if(!r.ok||typeof r.clone!=='function'||typeof Response!=='function'||!body?.status||['ok','committed','ready','stale_version','permission_denied'].includes(body.status))return r;
 if(!READS.has(JSON.parse(init?.body||'{}').name))return r;
 const message=['not_authorized','not_found'].includes(body.status)?'This record is not visible to this account.':'Mendwell refused to show its current state, so the page still shows what it last read. Press Refresh to try again.';
 return new Response(JSON.stringify({...body,message}),{status:r.status,statusText:r.statusText,headers:r.headers});
};
let UI=null;
function observe(init,body){
 let req;try{req=JSON.parse(init?.body||'{}');}catch{return;}
 const args=req.arguments||{};
 if(req.name===T.people&&!Object.keys(args).length&&Array.isArray(body.people))dropLost(body.people);
 else if(req.name===T.grants&&args.patient_id===undefined&&Array.isArray(body.grants))dropPickups(body.grants);
}
function seeEpoch(e){
 if(typeof e!=='number')return;
 if(S.epoch==null||e<S.epoch){if(S.epoch==null)S.epoch=e;return;}
 if(e===S.epoch)return;
 S.epoch=e;
 const old=S.flow&&S.flow.epoch!==e,had=Object.keys(S.drafts).length||S.open||old||S.ask;
 S.drafts={};S.notes={};S.open=null;S.ask=null;if(old)S.flow=null;
 if(S.unknown&&S.unknown.request.expected_version.epoch!==e)S.unknown.reset=true;
 if(had)S.lost='Mendwell was reset or reloaded, so the forms and previews you had open were closed. Nothing from before was sent.';
}
const S={version:null,me:null,people:[],grants:[],approvals:[],cards:[],stores:[],rxs:[],fills:[],rx:null,fill:null,rxStock:null,fillStock:null,
 section:null,personId:null,rxId:null,fillId:null,planId:null,drafts:{},notes:{},open:null,epoch:null,selectFailed:false,ask:null,flow:null,flowRev:0,unknown:null,lost:null,error:null,flash:null,flashSection:null,busy:false,stale:false,wrote:false,intent:0,goto:null};
let loads=0;
const css=(node,style)=>{Object.assign(node.style,style);return node;};
const fmt=(iso,o)=>iso?new Intl.DateTimeFormat('en-US',{timeZone:TZ,...o}).format(new Date(iso)):'—';
const when=iso=>fmt(iso,{weekday:'short',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
const zoned=when;
const clock=iso=>fmt(iso,{hour:'numeric',minute:'2-digit',timeZoneName:'short'});
const day=d=>d?new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'short',month:'short',day:'numeric',year:'numeric'}).format(new Date(d+'T00:00:00Z')):'—';
const money=c=>c==null?'—':(c<0?'−':'')+'$'+(Math.abs(c)/100).toFixed(2);
const span=ms=>{const m=Math.round(ms/60000),d=Math.floor(m/1440),h=Math.floor(m%1440/60),r=m%60;return [d?d+' d':'',h?h+' h':'',r||(!d&&!h)?r+' min':''].filter(Boolean).join(' ');};
const twelve=t=>{const [h,m]=t.split(':').map(Number);return (h%12||12)+':'+String(m).padStart(2,'0')+' '+(h<12?'AM':'PM');};
const zoneName=()=>new Intl.DateTimeFormat('en-US',{timeZone:TZ,timeZoneName:'longGeneric'}).formatToParts(new Date()).find(p=>p.type==='timeZoneName')?.value||TZ;
const searchText=()=>(document.querySelector('.toolbar input[type=search]')?.value||'').trim().toLowerCase().slice(0,80);
const transport=e=>e instanceof TypeError&&/fetch|network|load failed/i.test(e.message);
const coded=(code,message)=>Object.assign(Error(message),{code,plainMessage:message});
const same=(a,b)=>!!a&&!!b&&a.epoch===b.epoch&&a.revision===b.revision;
const unavailable=text=>el('div',{class:'empty','data-unavailable':'true'},el('h3',{},'Not available'),el('p',{},text+' is not allowed by the current policy.'));

function parts(t){return Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:TZ,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(new Date(t)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));}
function offset(t){const p=parts(t);return Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second)-Math.floor(t/1000)*1000;}
function zonedIso(date,time){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||!/^\d{2}:\d{2}$/.test(time||''))return {error:'Enter both a date and a time for the end of access.'};
 const [y,m,d]=date.split('-').map(Number),[h,mi]=time.split(':').map(Number),want=Date.UTC(y,m-1,d,h,mi);
 const found=[...new Set([-1,0,1].map(k=>offset(want+k*86400000)))].map(o=>want-o).filter(t=>{const p=parts(t);return +p.year===y&&+p.month===m&&+p.day===d&&+p.hour===h&&+p.minute===mi;}).sort((a,b)=>a-b);
 if(!found.length)return {error:'There is no '+time+' on '+date+' in Eastern Time (the clocks change that night). Choose another time.'};
 const o=offset(found[0])/60000,a=Math.abs(o),pad=n=>String(n).padStart(2,'0');
 return {iso:date+'T'+time+':00'+(o<0?'-':'+')+pad(Math.floor(a/60))+':'+pad(a%60)};
}

const person=id=>S.people.find(p=>p.person_id===id);
const nameOf=id=>id==null?'—':person(id)?.name||'a family member you do not have access to';
const optionName=id=>person(id)?.name||'Another family member (reference '+id+')';
const cap=t=>t?t[0].toUpperCase()+t.slice(1):t;
const powers=id=>person(id)?.powers||[];
const full=id=>powers(id).some(p=>p==='self'||p==='guardian');
const canRefill=id=>full(id)||powers(id).includes('refill');
const store=id=>S.stores.find(s=>s.store_id===id);
const storeName=id=>store(id)?.name||id;
const rxOf=id=>S.rxs.find(r=>r.rx_id===id)||(S.rx?.rx_id===id?S.rx:null);
const drugText=d=>d?d.generic_name+' '+d.strength+' '+d.form:'';
const fillDrug=f=>{const r=f.rx_id&&rxOf(f.rx_id);return r?r.drug.generic_name+' '+r.drug.strength:f.drug_id?String(f.drug_id).replace(/^d-/,'').replace(/-/g,' '):'Prescription pickup';};
const patientOf=f=>{
 if(f.patient_id)return f.patient_id;
 const mine=S.grants.filter(g=>g.grantee_id===S.me&&g.scope==='pickup'&&g.state==='active');
 const exact=mine.find(g=>g.fill_id===f.fill_id);if(exact)return exact.patient_id;
 const all=[...new Set(mine.filter(g=>g.fill_id===null&&!canSee(g.patient_id)).map(g=>g.patient_id))];
 return all.length===1?all[0]:null;
};
const canSee=id=>full(id)||powers(id).includes('view');
const last=f=>f.timeline?.length?f.timeline[f.timeline.length-1].at:f.ready_at||null;
const fillTitle=f=>fillDrug(f)+(patientOf(f)?' · '+nameOf(patientOf(f)):'');
const activeFillOf=rx=>S.fills.find(f=>f.rx_id===rx.rx_id&&ACTIVE.includes(f.state));
const viewScope=()=>S.section==='household'?'person:'+S.personId:S.fill?'fill:'+S.fill.fill_id:null;
const FILL_FORMS=['quantity','store','plan','prepay','collector'],RX_FORMS=['request','renew'],BOUND=['quantity','store','plan','collector','request','renew'];
const FORM_NAME={grant:'grant',request:'request',renew:'renewal',quantity:'quantity',store:'store',plan:'plan',prepay:'prepay',collector:'collector'};
const kindOf=k=>k.slice(0,k.indexOf(':'));
const liveAuth=f=>f.authorization?.state==='live'||f.own_authorization?.state==='live';
function fillOffers(ui,f){
 const o=new Set();if(!f||!ACTIVE.includes(f.state))return o;
 const write=f.view!=='logistics'&&canRefill(f.patient_id),reason=f.claim?.reason,held=!!f.hold;
 if(write&&!held&&(f.state==='requested'||(f.state==='claim_rejected'&&reason==='quantity_limit'))&&ui.has(T.quantity))o.add('quantity');
 if(write&&f.state==='claim_rejected'&&reason==='refill_too_soon'&&!f.resubmission_due_at&&ui.has(T.wait))o.add('wait');
 if(write&&f.state==='claim_rejected'&&ASK[reason]&&ui.has(T.planCreate))o.add('plan');
 if(write&&f.state==='pending_plan_decision'&&f.plan_request?.state==='pending'&&ui.has(T.planWithdraw))o.add('withdraw-plan');
 if(write&&!held&&f.state==='claim_rejected'&&ui.has(T.cashPreview))o.add('cash');
 if(write&&!held&&['requested','waiting_stock','claim_rejected','pending_plan_decision'].includes(f.state)&&ui.has(T.store))o.add('store');
 if(!held&&f.state==='ready'&&f.amount_due_cents>0&&!liveAuth(f)&&ui.has(T.prepayPreview)&&S.cards.length)o.add('prepay');
 if(write&&f.state==='ready'&&ui.has(T.collector))o.add('collector');
 if(write&&ui.has(T.cancelPreview))o.add('cancel');
 return o;
}
function rxOffers(ui,r){
 const o=new Set();if(!r||!canRefill(r.patient_id))return o;
 const pending=r.renewals.some(x=>x.state==='pending');
 if(r.state==='active'&&r.fills_remaining>0&&!activeFillOf(r)&&ui.has(T.request))o.add('request');
 if(r.state!=='superseded'&&(r.fills_remaining===0||r.state==='expired')&&!pending&&ui.has(T.renew))o.add('renew');
 if(pending&&ui.has(T.renewWithdraw))o.add('withdraw-renewal');
 return o;
}
function formAllowed(ui,key){
 const kind=kindOf(key),id=keyId(key);
 if(FILL_FORMS.includes(kind))return fillOffers(ui,S.fills.find(x=>x.fill_id===id)).has(kind);
 if(RX_FORMS.includes(kind))return rxOffers(ui,S.rxs.find(x=>x.rx_id===id)).has(kind);
 if(kind==='grant')return full(id)&&!!S.grantsAllowed&&ui.has(T.grantPreview);
 return false;
}
function stampOf(key){
 const kind=kindOf(key),id=keyId(key);
 if(FILL_FORMS.includes(kind)){const f=S.fills.find(x=>x.fill_id===id);return f?JSON.stringify({...f,approvals:null}):'';}
 if(RX_FORMS.includes(kind)){const r=S.rxs.find(x=>x.rx_id===id);return r?JSON.stringify(r):'';}
 return '';
}
function visibleTarget(t){
 if(t.fillId){const f=S.fills.find(x=>x.fill_id===t.fillId);return !!f&&(t.need==='pickup'||(f.view==='full'&&canRefill(f.patient_id)));}
 if(t.rxId){const r=S.rxs.find(x=>x.rx_id===t.rxId);return !!r&&canRefill(r.patient_id);}
 return t.personId?full(t.personId):true;
}
function guardUnknown(){
 const u=S.unknown;if(!u||u.hidden||!u.target)return;
 if(!visibleTarget(u.target)){u.hidden=true;u.label='records this account can no longer see or change';if(S.error?.scope==='unknown')S.error=null;}
}

async function read(ui,name,args){
 if(!ui.has(name))return {value:null,version:null,denied:'policy'};
 try{const r=await ui.call(name,args);return {value:r,version:r.version};}
 catch(e){if(['not_authorized','not_found'].includes(e.code))return {value:null,version:null,denied:e.code,message:e.message};throw e;}
}
const keyId=k=>k.slice(k.indexOf(':')+1);
function forget(ui,kind,id,message){
 const record=kind==='fill'?(S.fill?.fill_id===id?S.fill:S.fills.find(f=>f.fill_id===id)):(S.rx?.rx_id===id?S.rx:S.rxs.find(r=>r.rx_id===id));
 const pid=record?(record.patient_id||patientOf(record)):null,keep=pid&&full(pid);
 const gone=x=>(kind==='fill'?x.fill_id===id:x.rx_id===id)||(!keep&&pid&&patientOf(x)===pid);
 const ids=new Set([id,...S.fills.filter(gone).map(f=>f.fill_id),...S.rxs.filter(gone).map(r=>r.rx_id),...(pid&&!keep?[pid]:[])]);
 S.fills=S.fills.filter(f=>!gone(f));S.rxs=S.rxs.filter(r=>!gone(r));
 if(!keep&&pid)S.people=S.people.filter(p=>p.person_id!==pid);
 if(S.fill&&gone(S.fill)){S.fill=null;S.fillId=null;S.fillStock=null;}
 if(S.rx&&gone(S.rx)){S.rx=null;S.rxId=null;S.rxStock=null;}
 if(kind==='fill'&&S.fillId===id){S.fillId=null;S.fill=null;}
 if(S.planId&&ids.has(S.planId))S.planId=null;
 if(S.ask&&ids.has(keyId(S.ask.scope)))S.ask=null;
 if(kind==='rx'&&S.rxId===id){S.rxId=null;S.rx=null;}
 for(const k of Object.keys(S.drafts))if(ids.has(keyId(k)))delete S.drafts[k];
 if(S.flow&&(ids.has(S.flow.fillId)||(!keep&&pid&&S.flow.patientId===pid)))S.flow=null;
 if(S.open&&ids.has(keyId(S.open)))S.open=null;
 for(const k of Object.keys(S.notes))if(ids.has(keyId(k)))delete S.notes[k];
 if(pid&&!keep){S.flash=null;S.error=null;}
 guardUnknown();
 S.lost=(kind==='fill'?'That fill':'That prescription')+' is no longer visible to this account, so the page removed it'+(pid&&!keep?' together with the other records of the person who shared it':'')+'.';
 S.intent++;
 ui.navigate(ui.section).catch(ui.error);
}
function dropLost(roster){
 const now=new Set(roster.filter(p=>p.powers.some(x=>x!=='pickup')).map(p=>p.person_id));
 purge(S.people.filter(p=>p.powers.some(x=>x!=='pickup')&&!now.has(p.person_id)).map(p=>p.person_id),[]);
}
function dropPickups(grants){
 if(!S.me)return;
 const live=list=>list.filter(g=>g.grantee_id===S.me&&g.scope==='pickup'&&g.state==='active'),mine=live(grants);
 const wideEnded=live(S.grants).some(g=>g.fill_id===null&&!mine.some(x=>x.grant_id===g.grant_id));
 const covered=f=>{const pid=patientOf(f);return mine.some(g=>g.fill_id===f.fill_id||(g.fill_id===null&&(pid===null?!wideEnded:g.patient_id===pid)));};
 purge([],[...S.fills,...(S.fill?[S.fill]:[])].filter(f=>f.view==='logistics'&&!covered(f)).map(f=>f.fill_id));
}
function purge(lost,pickups){
 if(!lost.length&&!pickups.length)return;
 const gone=x=>lost.includes(patientOf(x))||pickups.includes(x.fill_id),ids=new Set([...lost,...pickups,...S.fills.filter(gone).map(f=>f.fill_id),...S.rxs.filter(gone).map(r=>r.rx_id)]);
 S.fills=S.fills.filter(f=>!gone(f));S.rxs=S.rxs.filter(r=>!gone(r));S.people=S.people.filter(p=>!lost.includes(p.person_id));
 if(S.fill&&ids.has(S.fill.fill_id)){S.fill=null;S.fillStock=null;}
 if(S.rx&&ids.has(S.rx.rx_id)){S.rx=null;S.rxStock=null;}
 if(S.planId&&ids.has(S.planId))S.planId=null;
 for(const k of Object.keys(S.drafts))if(ids.has(keyId(k)))delete S.drafts[k];
 for(const k of Object.keys(S.notes))if(ids.has(keyId(k)))delete S.notes[k];
 if(S.open&&ids.has(keyId(S.open)))S.open=null;
 if(S.ask&&ids.has(keyId(S.ask.scope)))S.ask=null;
 if(S.flow&&(ids.has(S.flow.fillId)||lost.includes(S.flow.patientId)))S.flow=null;
 S.flash=null;S.error=null;
 if(S.unknown&&S.unknown.target?.need!=='pickup')guardUnknown();
 S.lost='Access to another person’s records ended, so the page removed what it showed of them.';
 if(UI)UI.navigate(UI.section).catch(()=>{});
}
async function readOnce(ui){
 const N={versions:[]},take=r=>{if(r.version)N.versions.push(r.version);return r.value;};
 const people=await ui.call(T.people,{});N.versions.push(people.version);N.people=people.people;
 dropLost(N.people);
 const g=take(await read(ui,T.grants,{}));N.grants=g?.grants||[];N.approvals=g?.approvals||[];N.grantsAllowed=!!g;
 if(g)dropPickups(N.grants);
 N.cards=take(await read(ui,T.cards,{}))?.cards||[];
 N.stores=take(await read(ui,T.stores,{}))?.stores||[];
 N.rxs=take(await read(ui,T.rxs,{}))?.prescriptions||[];
 N.fills=take(await read(ui,T.fills,{}))?.fills||[];
 N.rxId=S.rxId&&N.rxs.some(r=>r.rx_id===S.rxId)?S.rxId:null;
 if(S.rxId&&!N.rxId&&S.rxs.some(r=>r.rx_id===S.rxId))forget(ui,'rx',S.rxId,null);
 N.rxId=N.rxId||N.rxs.find(r=>r.state==='active')?.rx_id||N.rxs[0]?.rx_id||null;
 N.fillId=S.fillId&&N.fills.some(f=>f.fill_id===S.fillId)?S.fillId:null;
 if(S.fillId&&!N.fillId&&S.fills.some(f=>f.fill_id===S.fillId))forget(ui,'fill',S.fillId,null);
 N.fillId=N.fillId||N.fills.find(f=>f.state==='claim_rejected')?.fill_id||N.fills.find(f=>ACTIVE.includes(f.state))?.fill_id||N.fills[0]?.fill_id||null;
 N.planId=S.planId&&N.fills.some(f=>f.fill_id===S.planId&&f.plan_request)?S.planId:null;
 if(S.planId&&!N.planId&&!N.fills.some(f=>f.fill_id===S.planId)&&S.fills.some(f=>f.fill_id===S.planId))forget(ui,'fill',S.planId,null);
 N.rx=null;N.fill=null;N.rxStock=null;N.fillStock=null;
 const want=S.section==='plan'?N.planId:N.fillId;
 if(N.rxId){const r=await read(ui,T.rx,{rx_id:N.rxId});if(r.denied&&r.denied!=='policy'){forget(ui,'rx',N.rxId,r.message);N.denied=true;return N;}N.rx=take(r)?.prescription||N.rxs.find(x=>x.rx_id===N.rxId)||null;}
 if(want){const r=await read(ui,T.fill,{fill_id:want});if(r.denied&&r.denied!=='policy'){forget(ui,'fill',want,r.message);N.denied=true;return N;}N.fill=take(r)?.fill||N.fills.find(x=>x.fill_id===want)||null;}
 if(N.rx&&N.rx.state==='active'){const s=take(await read(ui,T.stores,{drug_id:N.rx.drug.drug_id}));N.rxStock=s?.stores||null;}
 if(N.fill?.view==='full'&&['requested','waiting_stock','claim_rejected','pending_plan_decision'].includes(N.fill.state)){const s=take(await read(ui,T.stores,{drug_id:N.fill.drug_id}));N.fillStock=s?.stores||null;}
 return N;
}
async function load(ui){
 UI=ui;
 const seq=++loads,intent=S.intent;S.section=ui.section;
 for(let attempt=0;attempt<3;attempt++){
  const N=await readOnce(ui);
  if(seq!==loads)return {};
  if(N.denied||!N.versions.every(v=>same(v,N.versions[0])))continue;
  if(intent!==S.intent&&!S.lost)return {};
  apply(N,ui);return {};
 }
 throw coded('inconsistent','Mendwell kept changing while the page was reading it. Press Refresh to see one consistent view.');
}
function apply(N,ui){
 const version=N.versions[0],before=new Set(S.people.filter(p=>p.powers.some(x=>x!=='pickup')).map(p=>p.person_id));
 const reset=S.version&&S.version.epoch!==version.epoch;
 for(const k of ['people','grants','approvals','cards','stores','rxs','fills','rx','fill','rxStock','fillStock','rxId','fillId','planId','grantsAllowed'])S[k]=N[k];
 seeEpoch(version.epoch);
 if(reset&&S.unknown&&S.unknown.request.expected_version.epoch!==version.epoch)S.unknown.reset=true;
 if(['refresh_needed','selection_failed','preview_open','unanswered'].includes(S.error?.code))S.error=null;
 S.version=version;S.stale=false;S.selectFailed=false;
 S.me=S.people.find(p=>p.powers.includes('self'))?.person_id||null;
 if(!S.people.some(p=>p.person_id===S.personId))S.personId=S.me;
 if(S.planId&&!S.fills.some(f=>f.fill_id===S.planId))S.planId=null;
 if([...before].some(id=>!S.people.some(p=>p.person_id===id&&p.powers.some(x=>x!=='pickup')))){S.flash=null;S.error=null;}
 for(const k of Object.keys(S.drafts)){
  if(!formAllowed(ui,k)){delete S.drafts[k];delete S.notes[k];continue;}
  const d=S.drafts[k];
  if(BOUND.includes(kindOf(k))){const now=stampOf(k);if(now!==d.stamp){if(d.dirty){d.conflict=true;d.stamp=now;}else{delete S.drafts[k];S.notes[k]=true;}}}
 }
 for(const k of Object.keys(S.notes))if(!formAllowed(ui,k))delete S.notes[k];
 if(S.open&&!formAllowed(ui,S.open))S.open=null;
 const f=S.flow;
 if(f){
  if(f.fillId){const x=S.fills.find(y=>y.fill_id===f.fillId);if(!x||!fillOffers(ui,x).has(f.kind))S.flow=null;}
  else if(!full(f.patientId)||!S.grantsAllowed||!ui.has(T.grantPreview))S.flow=null;
  if(S.flow&&f.epoch!==version.epoch)f.reset=true;
 }
 if(S.ask&&!askAllowed(ui,S.ask))S.ask=null;
 guardUnknown();
}

function askRef(scope,offer){
 const id=keyId(scope);
 if(scope.startsWith('fill:')){const f=S.fills.find(x=>x.fill_id===id);return offer==='withdraw-plan'?f?.plan_request?.plan_request_id:f?.claim?.claim_id;}
 return S.rxs.find(x=>x.rx_id===id)?.renewals.find(x=>x.state==='pending')?.renewal_id;
}
function askAllowed(ui,q){
 const id=keyId(q.scope);
 const offered=q.scope.startsWith('fill:')?fillOffers(ui,S.fills.find(x=>x.fill_id===id)).has(q.offer):rxOffers(ui,S.rxs.find(x=>x.rx_id===id)).has(q.offer);
 return offered&&askRef(q.scope,q.offer)===q.ref;
}
const labelOf=x=>typeof x==='function'?x():x;
function applied(r){if(r.version)S.version=r.version;S.wrote=true;}
const hostRefusal=e=>!e.code&&HOST_REFUSED[e.message]?Object.assign(Error(e.message),{code:HOST_REFUSED[e.message]}):null;
async function commit(ui,name,args,label,done,version=null,target=null,plain=null){
 const request={expected_version:version||S.version,request_id:'web-'+crypto.randomUUID()};let r;
 try{r=await ui.call(name,{...args,...request});}
 catch(e){if(e.code&&plain)e.plain=plain;const refused=hostRefusal(e);if(refused)throw refused;if(!e.code)S.unknown={name,args,request,label,done,target,hidden:false,reason:transport(e)?'the connection dropped':e.message};throw e;}
 if(!r.version||r.version.epoch!==request.expected_version.epoch){S.unknown={name,args,request,label,done,target,hidden:false,reset:true,reason:'Mendwell answered from a different run'};throw coded('unconfirmed','Mendwell answered from a different run than the one this change was made for, so whether it took effect cannot be confirmed. Check the records before trying again.');}
 applied(r);done(r);return r;
}
async function retryUnknown(ui){
 const u=S.unknown;let r;
 const now=(await ui.call(T.people,{})).version;
 if(u.reset||now.epoch!==u.request.expected_version.epoch){S.unknown=null;throw coded('unconfirmed','Mendwell was reset or reloaded after the earlier request to '+labelOf(u.label)+', so whether it took effect cannot be confirmed, and it was not sent again. Check the records before trying again.');}
 try{r=await ui.call(u.name,{...u.args,...u.request});}
 catch(e){
  if(!e.code||e.code==='permission_denied')throw e;
  const now=(await ui.call(T.people,{}).catch(()=>null))?.version;
  if(!now)throw coded('unconfirmed_pending','Mendwell answered, but the page could not read its current state to tell whether the earlier request took effect. Retry again.');
  S.unknown=null;
  const sameEpoch=now.epoch===u.request.expected_version.epoch;
  throw coded(sameEpoch?'not_applied':'unconfirmed',sameEpoch?'Mendwell did not apply the earlier request to '+labelOf(u.label)+'; nothing was done. Start it again if you still want it.':'Mendwell was reset or reloaded after the earlier request to '+labelOf(u.label)+', so whether it took effect cannot be confirmed. Check the records before trying again.');
 }
 if(!r.version||r.version.epoch!==u.request.expected_version.epoch||r.version.epoch!==S.epoch){S.unknown=null;throw coded('unconfirmed','Mendwell answered the earlier request to '+labelOf(u.label)+' from a different run than the one it was made for, so whether it took effect cannot be confirmed. Check the records before trying again.');}
 S.unknown=null;applied(r);u.done(r);
}
const said=(r,text,label)=>r.duplicate?'Your earlier request to '+labelOf(label)+' had already gone through; it was not applied twice.':text;
function lock(){
 for(const b of document.querySelectorAll('#records button,.detail button,.detail input,.detail select,.detail textarea'))b.disabled=true;
 const status=document.getElementById('status');if(status){status.textContent='Working…';delete status.dataset.error;}
}
async function act(ui,scope,run,resolving=false){
 if(S.busy)return;
 if(S.selectFailed&&!resolving){S.flash=null;S.error={scope,code:'selection_failed',message:'The page could not open what you chose. Press Refresh before changing anything.'};ui.navigate(ui.section).catch(ui.error);return;}
 if(S.stale&&!resolving){S.flash=null;S.error={scope,code:'refresh_needed',message:'The page could not load Mendwell’s latest state after the last change. Press Refresh before changing anything else.'};ui.navigate(ui.section).catch(ui.error);return;}
 const origin=ui.section;S.wrote=false;
 if(S.unknown&&!resolving){S.flash=null;S.error={scope,code:'unanswered',message:'Mendwell has not answered the earlier request to '+labelOf(S.unknown.label)+'. Retry or dismiss it first.'};ui.navigate(ui.section).catch(ui.error);return;}
 S.busy=true;S.error=null;S.flash=null;S.lost=null;lock();const pendingBefore=S.unknown;
 try{await run();}
 catch(e){
  const refused=hostRefusal(e)||e;
  S.error=refused.code?{scope,code:refused.code,message:refused.plainMessage||plainError(refused.code,refused.plain,refused.message)}:transport(e)?{scope,code:'connection_lost',message:'The connection dropped before Mendwell answered.'}:{scope,code:/not permitted/i.test(e.message)?'not_permitted':'request_failed',message:e.message};
  if(S.unknown&&S.unknown!==pendingBefore)S.error.message='Mendwell did not confirm this request; see “Waiting for Mendwell”.';
 }
 finally{S.busy=false;S.intent++;S.flashSection=S.goto||origin;}
 const wrote=S.wrote,status=document.getElementById('status');
 if(status){status.textContent=wrote?'Saved. Loading the latest state…':'Checking Mendwell…';delete status.dataset.error;}
 try{await ui.navigate(ui.section);}catch(e){ui.error(e);}
 try{await ui.refresh();if(S.goto){const target=S.goto;S.goto=null;await ui.navigate(target);}if(outcome()&&status){status.textContent=outcome();status.dataset.error='true';}}
 catch(e){if(wrote){S.stale=true;await ui.navigate(ui.section).catch(()=>{});ui.error(Error('Your change was saved, but the page could not load Mendwell’s latest state. Press Refresh.'));}else ui.error(e);}
 document.querySelector('.detail [role=alert]:not(:empty),.detail [data-flash],.detail [data-flow]')?.scrollIntoView({block:'nearest'});
}
let picks=0;
const fillTarget=()=>S.section==='plan'?S.planId:S.fillId;
let syncing=false,picking=false;
async function sync(ui){
 if(syncing||picking||S.selectFailed||pageBusy())return;syncing=true;const seq=picks;
 try{const got=await pickRead(ui);if(seq!==picks)return;if(got)Object.assign(S,got);else await ui.refresh();}
 catch(e){S.selectFailed=true;ui.error(e);}
 finally{syncing=false;}
 await ui.navigate(ui.section).catch(()=>{});
}
async function choose(ui,changes,section,openKey=null){
 if(pageBusy())return;
 const seq=++picks;
 Object.assign(S,changes);S.intent++;S.flowRev++;S.error=null;S.flash=null;S.lost=null;S.open=openKey;S.selectFailed=false;S.ask=null;
 if(section)S.section=section;
 picking=true;
 try{
  await ui.navigate(section||ui.section);
  if(matchMedia('(max-width: 760px)').matches)document.querySelector('.detail')?.scrollIntoView({block:'start'});
  const got=await pickRead(ui);
  if(seq!==picks)return;
  if(got){Object.assign(S,got);await ui.navigate(ui.section);}
  else await ui.refresh();
 }
 catch(e){if(seq!==picks)return;S.selectFailed=true;await ui.navigate(ui.section).catch(()=>{});ui.error(e);}
 finally{if(seq===picks)picking=false;}
}
async function pickRead(ui){
 const out={},versions=[];
 const one=async(name,args,kind,id)=>{const r=await read(ui,name,args);if(r.denied&&r.denied!=='policy'){if(kind)forget(ui,kind,id,null);return null;}if(r.version)versions.push(r.version);return r.value;};
 if(S.rxId&&S.rx?.rx_id!==S.rxId){const id=S.rxId,r=await one(T.rx,{rx_id:id},'rx',id);if(!r)return null;out.rx=r.prescription;out.rxStock=null;if(out.rx.state==='active'){const st=await one(T.stores,{drug_id:out.rx.drug.drug_id});out.rxStock=st?.stores||null;}}
 const want=fillTarget();
 if(want&&S.fill?.fill_id!==want){const r=await one(T.fill,{fill_id:want},'fill',want);if(!r)return null;out.fill=r.fill;out.fillStock=null;if(out.fill.view==='full'&&['requested','waiting_stock','claim_rejected','pending_plan_decision'].includes(out.fill.state)){const st=await one(T.stores,{drug_id:out.fill.drug_id});out.fillStock=st?.stores||null;}}
 return versions.every(v=>same(v,S.version))?out:null;
}
const pageBusy=()=>S.busy||document.querySelector('#app')?.getAttribute('aria-busy')==='true';
function edited(){S.flowRev++;}
const ALERT={background:'#fff4f1',padding:'8px 10px',borderRadius:'8px',marginTop:'12px'};
const NOTE={background:'#f3f7ff',padding:'10px 12px',borderRadius:'8px',marginTop:'12px'};
function local(code){return css(el('p',{role:'alert',class:'form-error','data-code':code}),ALERT);}
function alertFor(scope){return S.error?.scope===scope?css(el('p',{role:'alert',class:'form-error','data-code':S.error.code},S.error.message),ALERT):null;}
const muted=(text,attrs={})=>css(el('p',attrs,text),{color:'var(--muted)',fontSize:'12px',margin:'6px 0'});
function button(label,onclick,attrs={}){return el('button',{type:'button',disabled:pageBusy()?'':false,...attrs,onclick},label);}
function row(attrs,onclick,title,...lines){return el(onclick?'button':'div',{...(onclick?{type:'button',onclick,disabled:pageBusy()?'':false}:{}),class:'record',...attrs},el('span',{class:'record-title'},title),...lines.filter(Boolean).map(l=>el('span',{class:'record-subtitle'},l)));}
function panel(label,attrs,...children){return css(el('section',{class:'query-result','aria-label':label,...attrs},el('h3',{},label),...children.flat().filter(Boolean)),{margin:'18px 0 0'});}
function heading(text){return css(el('h3',{},text),{margin:'24px 0 4px'});}
function kicker(text){return css(el('h3',{class:'kicker'},text),{padding:'12px 22px 0',margin:'0',fontWeight:'500'});}
function field(label,input,...hints){return el('label',{class:'field'},el('span',{},label),input,...hints.filter(Boolean).map(h=>typeof h==='string'?el('small',{},h):h));}
function choiceLabel(input,...text){css(input,{width:'18px',height:'18px',flex:'0 0 18px',margin:'2px 0 0',padding:'0'});return css(el('label',{},input,el('span',{},...text)),{display:'flex',gap:'8px',alignItems:'flex-start',padding:'4px 0'});}
function group(legendText){const legend=css(el('legend',{},legendText),{display:'block',fontWeight:'600',marginBottom:'4px'});return css(el('fieldset',{},legend),{gap:'2px'});}
function actions(...buttons){return el('div',{class:'form-actions'},...buttons.filter(Boolean));}
function draft(key,base){if(!S.drafts[key])S.drafts[key]={...base,stamp:stampOf(key),dirty:false,conflict:false};return S.drafts[key];}
function touch(key){const d=S.drafts[key];if(d){d.dirty=true;d.conflict=false;}delete S.notes[key];}
function settle(key){delete S.drafts[key];delete S.notes[key];}
function toggle(ui,key){
 if(S.busy)return;const opening=S.open!==key;S.open=opening?key:null;delete S.notes[key];S.error=null;S.flash=null;edited();
 ui.navigate(ui.section).then(()=>focusForm(key,opening)).catch(ui.error);
}
function focusForm(key,opening){
 const kind=kindOf(key);
 if(opening)document.querySelector('[data-form="'+FORM_NAME[kind]+'"]')?.querySelector('select,textarea,input:not([type=radio]),input')?.focus();
 else document.querySelector('[data-action="open-'+FORM_NAME[kind]+'"]')?.focus();
}
function changedNote(key,noun){
 if(S.drafts[key]?.conflict)return css(el('p',{role:'status','data-conflict':'true'},'This '+noun+' changed since you opened this form. Your entry is kept; check it against the current details before saving.'),NOTE);
 if(S.notes[key])return css(el('p',{role:'status','data-refreshed':'true'},'This '+noun+' changed since you opened this form, so the form now shows its current details.'),NOTE);
 return null;
}
const saveLabel=(key,text)=>S.drafts[key]?.conflict?'Save anyway':text;
function hoursText(s){return WEEK.map(d=>{const h=s.hours.filter(x=>x.day===d);return DAYS[d]+' '+(h.length?h.map(x=>twelve(x.open)+'–'+twelve(x.close)).join(', '):'closed');});}
function cardText(c){return c.label+' •••• '+c.last4+' · expiry '+String(c.exp_month).padStart(2,'0')+'/'+c.exp_year;}

function approvalsFor(token){return [...S.approvals,...(S.fill?.approvals||[])].filter(a=>a.token===token).sort((a,b)=>({active:0,used:1,expired:2}[a.state]-{active:0,used:1,expired:2}[b.state])||Date.parse(b.confirmed_at)-Date.parse(a.confirmed_at));}
function flowMeta(kind,args){
 if(kind==='grant'){
  const pid=args.patient_id,id=args.grantee_id,sc=SCOPE[args.scope].toLowerCase(),whose=pid===S.me?'your':nameOf(pid)+'’s';
  return {scope:'person:'+pid,target:{personId:pid},patientId:pid,granteeId:id,title:'Give '+nameOf(id)+' '+sc+' access to '+whose+' records',label:()=>'give '+nameOf(id)+' '+sc+' access',done:r=>{settle('grant:'+pid);return 'Gave '+nameOf(id)+' '+sc+' access. Reference '+r.grant.grant_id+'.';}};
 }
 if(kind==='revoke'){
  const g=S.grants.find(x=>x.grant_id===args.grant_id);if(!g)return null;
  const who=g.grantee_id===S.me?'you':nameOf(g.grantee_id),sc=SCOPE[g.scope].toLowerCase();
  return {scope:'person:'+g.patient_id,target:{personId:g.patient_id},patientId:g.patient_id,granteeId:g.grantee_id,title:'Revoke '+sc+' access for '+who,label:()=>'revoke '+sc+' access for '+(g.grantee_id===S.me?'you':nameOf(g.grantee_id)),done:r=>'Revoked '+sc+' access for '+(g.grantee_id===S.me?'you':nameOf(g.grantee_id))+'. Reference '+r.grant.grant_id+'.'};
 }
 const f=S.fills.find(x=>x.fill_id===args.fill_id);if(!f)return null;
 const what=()=>{const cur=S.fills.find(x=>x.fill_id===f.fill_id);return cur&&cur.view!=='logistics'?'the '+fillDrug(cur)+' fill':'a pickup';};
 const base={scope:'fill:'+f.fill_id,target:{fillId:f.fill_id},fillId:f.fill_id,patientId:patientOf(f)};
 if(kind==='prepay'){const c=S.cards.find(k=>k.card_id===args.card_id),card=c?c.label+' •••• '+c.last4:'the chosen card';
  return {...base,target:{fillId:f.fill_id,need:'pickup'},title:'Prepay '+money(f.amount_due_cents)+' with '+card,label:()=>'prepay '+what(),done:()=>{settle('prepay:'+f.fill_id);return 'Prepaid '+money(f.amount_due_cents)+' with '+card+'; it is charged when the fill is collected.';}};}
 if(kind==='cash')return {...base,title:'Pay the cash price instead of the plan',label:()=>'switch '+what()+' to the cash price',done:r=>'Switched to the cash price; '+STATE[r.fill.state].toLowerCase()+'.'};
 return {...base,title:'Cancel this fill?',label:()=>'cancel '+what(),done:()=>'Fill cancelled.'};
}
function startFlow(ui,kind,args){
 const meta=flowMeta(kind,args);if(!meta)return;
 const rev=S.flowRev,scope=meta.scope,epoch=S.version?.epoch;
 if(scope!==viewScope())return;
 if(S.flow&&S.flow.scope!==scope){S.flash=null;S.error={scope,code:'preview_open',message:'Another preview is still open ('+(flowMeta(S.flow.kind,S.flow.args)?.title||S.flow.title)+'). Confirm or discard it there before starting a new one.'};ui.navigate(ui.section).catch(ui.error);return;}
 act(ui,scope,async()=>{
  let r;
  try{r=await ui.call(FLOW[kind].preview,args);}
  catch(e){if(kind==='grant'&&e.code==='not_found')throw coded('not_found',NO_PERSON);if(grantRefusal(kind,e)!==e)throw grantRefusal(kind,e);if(e.code==='quantity_not_allowed')throw coded(e.code,allowedQuantities(e.message));throw e;}
  if(r.version.epoch!==epoch||r.version.epoch!==S.epoch){if(S.flow&&S.flow.epoch!==S.epoch)S.flow=null;throw coded('reset','Mendwell was reset or reloaded while this preview was being prepared, so it was not kept and cannot be confirmed. Preview the change again.');}
  if(rev!==S.flowRev||scope!==viewScope())throw coded('details_changed','The details changed while the preview was being prepared. Preview again.');
  S.flow={kind,args,scope,...meta,token:r.preview.token,changes:r.preview.changes,confirmer:r.preview.required_confirmer||null,epoch:r.version.epoch,waiting:false,changed:false,reset:false};
  S.open=null;
 });
}
function confirmFlow(ui){
 const f=S.flow,rev=S.flowRev;if(!f)return;
 act(ui,f.scope,async()=>{
  if(f.reset){S.flow=null;throw coded('reset','Mendwell was reset after this preview, so it no longer applies. Preview the change again.');}
  let r;
  try{r=await ui.call(FLOW[f.kind].preview,f.args);}
  catch(e){if(S.flow===f)S.flow=null;throw grantRefusal(f.kind,e);}
  if(r.version.epoch!==f.epoch||r.version.epoch!==S.epoch){S.flow=null;throw coded('reset','Mendwell was reset after this preview, so it no longer applies. Preview the change again.');}
  if(rev!==S.flowRev||S.flow!==f||f.scope!==viewScope())throw coded('details_changed','The details changed while the change was being checked, so nothing was sent. Review the preview and confirm again.');
  if(r.preview.token!==f.token||JSON.stringify(r.preview.changes)!==JSON.stringify(f.changes)){
   S.flow={...f,token:r.preview.token,changes:r.preview.changes,confirmer:r.preview.required_confirmer||null,epoch:r.version.epoch,waiting:false,changed:true};
   throw coded('preview_changed','The details behind this preview changed since it was shown, so nothing was sent. Check the updated preview'+(FLOW[f.kind].approval?' (it needs a new confirmation)':'')+' and confirm again.');
  }
  try{await commit(ui,FLOW[f.kind].confirm,{...f.args,token:f.token},f.label,res=>{S.flow=null;S.flash=said(res,f.done(res),f.label);},r.version,f.target);}
  catch(e){
   if(e.code==='confirmation_required'){if(S.flow===f){f.waiting=true;f.changed=false;}return;}
   if(S.flow===f)f.waiting=false;
   if(e.code==='confirmation_invalid')throw Object.assign(coded(e.code,''),{plainMessage:'The confirmation for this preview has expired, was already used, or came from someone other than '+(f.confirmer===S.me?'you':nameOf(f.confirmer))+', so nothing was changed. '+(f.confirmer===S.me?'Confirm it again':cap(nameOf(f.confirmer))+' needs to confirm it again')+' outside this app, then press Refresh.'});
   if(['stale_preview','payment_failed','invalid_state','not_authorized','not_found','on_hold'].includes(e.code)&&S.flow===f)S.flow=null;
   throw grantRefusal(f.kind,e);
  }
 });
}
function effects(f){
 const c=f.changes,rows=[];
 if(f.kind==='grant'||f.kind==='revoke'){
  const shape=x=>x?SCOPE[x.scope]+' access'+(x.fill_id?' for one fill ('+fillRef(x.fill_id)+')':' to all records')+(x.expires_at?', until '+zoned(x.expires_at):', no end date')+' · '+x.state:'No grant';
  rows.push(metadata('Patient',cap(nameOf(f.patientId))),metadata('Person',cap(nameOf(f.granteeId))),el('div',{class:'metadata-line','data-before':''},el('span',{},'Before'),el('strong',{},shape(c.before))),el('div',{class:'metadata-line','data-after':''},el('span',{},'After'),el('strong',{},shape(c.after))));
 }
 if(f.kind==='prepay'){const card=S.cards.find(k=>k.card_id===c.card_id);rows.push(metadata('Card',card?cardText(card):'one of your cards'),el('div',{class:'metadata-line','data-amount':String(c.amount_cents)},el('span',{},'Amount'),el('strong',{},money(c.amount_cents)+' held on the card now and charged when the fill is collected')));}
 if(f.kind==='cash'){rows.push(el('div',{class:'metadata-line','data-price':String(c.price_cents)},el('span',{},'Cash price'),el('strong',{},money(c.price_cents))),metadata('Store',storeName(c.store_id)),el('div',{class:'metadata-line','data-result':c.resulting_state},el('span',{},'Fill becomes'),el('strong',{},STATE[c.resulting_state]||c.resulting_state)),
  el('div',{class:'metadata-line','data-cleared':c.cleared_resubmission?c.cleared_resubmission.due_at:''},el('span',{},'Resubmission'),el('strong',{},c.cleared_resubmission?'The resubmission scheduled for '+zoned(c.cleared_resubmission.due_at)+' is cleared':'None scheduled')));}
 if(f.kind==='cancel'){
  const paused=c.cancelled_timers.some(t=>!t.due_at);
  rows.push(metadata('Drug plan',c.claim_reversal?'The plan’s payment for this fill is reversed':'Nothing to reverse: the plan has not paid for this fill'),
   el('div',{class:'metadata-line','data-void':c.authorization_void?String(c.authorization_void.amount_cents):''},el('span',{},'Prepayment'),el('strong',{},c.authorization_void?'The '+money(c.authorization_void.amount_cents)+' prepayment is released; nothing is charged':'No prepayment to release')),
   metadata('Plan request',c.plan_request_withdrawal?'The pending plan request is withdrawn':'None pending'),
   el('div',{class:'metadata-line','data-timers':String(c.cancelled_timers.length)},el('span',{},'Afterwards'),el('strong',{},c.cancelled_timers.length?c.cancelled_timers.map(t=>TIMER[t.kind]||'').filter(Boolean).join(' ')+(paused?' (The fill is on hold, so these were already paused.)':''):'Nothing else was planned for this fill.')),
   muted('Fills left on the prescription stay as they are.'));
 }
 return rows;
}
function flowPanel(ui){
 const f=S.flow;if(!f||f.scope!==viewScope()||(f.fillId&&f.args.fill_id!==S.fill?.fill_id))return null;
 const spec=FLOW[f.kind],found=spec.approval?approvalsFor(f.token):[],best=found[0];
 const self=f.confirmer===S.me,who=self?'You ('+nameOf(f.confirmer)+')':cap(nameOf(f.confirmer)),what=f.kind==='prepay'?'prepayment':'change';
 const approval=spec.approval?el('div',{'data-approval':best?best.state:'none'},
  el('p',{'data-confirm-help':'true'},who+' '+(self?'confirm':'confirms')+' this '+what+' outside this app, the same way as answering a code sent to '+(self?'you':'them')+'. Once it is confirmed, press Refresh: the confirmation shows here, and then '+spec.button+' makes the '+what+'. A confirmation stays valid for 30 minutes and works once.'),
  muted('In this local preview no code is sent to anyone: the confirmation is given as described in the Mendwell GUI README.',{'data-local-preview':'true'}),
  muted('After a reload this preview is gone: preview the same change again. It gets the same reference code, so a confirmation already given still applies.',{'data-reload-help':'true'}),
  css(el('p',{},'Reference code: ',css(el('span',{'data-token':f.token},f.token),{fontFamily:'ui-monospace,monospace'})),{fontSize:'11px',color:'var(--muted)',overflowWrap:'anywhere',margin:'6px 0 8px'}),
  el('div',{class:'metadata-line','data-approval-state':best?best.state:'none'},el('span',{},'Confirmation'),el('strong',{},!best?'Not confirmed yet':best.state==='active'?'Confirmed at '+clock(best.confirmed_at)+', valid until '+clock(best.expires_at):best.state==='expired'?'Expired at '+clock(best.expires_at)+' (confirmed at '+clock(best.confirmed_at)+')':'Already used (confirmed at '+clock(best.confirmed_at)+')'))):null;
 const waiting=f.waiting&&!best?css(el('p',{role:'status','data-waiting':'true'},(self?'Waiting for your confirmation':'Waiting for '+nameOf(f.confirmer)+' to confirm')+'. Nothing has changed yet. Once '+(self?'you have':'they have')+' confirmed outside this app, press Refresh and then '+spec.button+'.'),NOTE):null;
 const changed=f.changed?css(el('p',{'data-changed':'true'},'Updated preview: the details changed since the first preview.'),NOTE):null;
 const reset=f.reset?css(el('p',{'data-reset':'true'},'Mendwell was reset after this preview. Discard it and preview again.'),NOTE):null;
 return panel(flowMeta(f.kind,f.args)?.title||f.title,{'data-flow':f.kind},changed,reset,effects(f),approval,waiting,
  actions(button(f.kind==='cancel'?'Keep fill':'Discard',()=>{if(S.busy)return;S.flow=null;S.error=null;edited();ui.navigate(ui.section).catch(ui.error);},{'data-action':'discard-flow'}),
   f.epoch!==S.epoch?muted('This preview belongs to Mendwell before it was reset or reloaded, so it cannot be confirmed. Discard it and preview again.'):ui.has(spec.confirm)?button(spec.button,()=>confirmFlow(ui),{class:'primary','data-action':'confirm-flow'}):muted('Confirming is not allowed by the current policy.')));
}
function unknownBanner(ui){
 const u=S.unknown;
 if(u.hidden||u.reset)return css(panel('Waiting for Mendwell',{'data-unknown':u.hidden?'hidden':'reset'},el('p',{},u.hidden?'Mendwell did not confirm an earlier request about records this account can no longer see or change, so it may or may not have taken effect. It cannot be retried from this page. Dismiss it to continue; other changes wait until then.':'Mendwell was reset or reloaded after an earlier request that it did not confirm, so whether that request took effect cannot be confirmed. It is not sent again. Check the records, then dismiss it; other changes wait until then.'),
  alertFor('unknown'),actions(button('Dismiss',()=>{if(S.busy)return;S.unknown=null;S.error=null;ui.navigate(ui.section).catch(ui.error);},{'data-action':'dismiss-unknown'}))),{margin:'18px 24px 0'});
 return css(panel('Waiting for Mendwell',{},el('p',{},'Mendwell did not confirm the request to '+labelOf(u.label)+' ('+u.reason+'), so it may or may not have taken effect. Retry sends exactly the same request again: it takes effect at most once, and the page then says which happened. Other changes wait until this is settled.'),u.target?.fillId||u.target?.rxId?css(el('small',{'data-ref':u.target.fillId||u.target.rxId},'Reference '+(u.target.fillId||u.target.rxId)+'.'),{fontSize:'10px',color:'var(--muted)'}):null,
  alertFor('unknown'),actions(button('Dismiss',()=>{if(S.busy)return;S.unknown=null;S.error=null;ui.navigate(ui.section).catch(ui.error);},{'data-action':'dismiss-unknown'}),
   ui.has(u.name)?button('Retry',()=>act(ui,'unknown',()=>retryUnknown(ui),true),{class:'primary','data-action':'retry-unknown'}):el('p',{},'This operation is no longer allowed by the current policy; check the records, then dismiss.'))),{margin:'18px 24px 0'});
}

function householdList(ui){
 const box=el('div',{'data-list':'people'},kicker('People you act for'));
 for(const p of S.people)box.append(row({'data-person-id':p.person_id,'aria-pressed':String(p.person_id===S.personId)},()=>choose(ui,{personId:p.person_id}),p.name+(p.person_id===S.me?' (you)':''),
  (RELATION[p.relation]||p.relation)+(p.is_minor?' · minor':''),p.powers.map(x=>POWER[x]||x).join(' · ')));
 const limited=S.grants.filter(g=>g.grantee_id===S.me&&g.state==='active'&&!S.people.some(p=>p.person_id===g.patient_id));
 if(limited.length){box.append(kicker('Pickup access from others'));for(const g of limited)box.append(row({'data-grant-id':g.grant_id,'data-ref':g.patient_id},null,cap(nameOf(g.patient_id)),SCOPE[g.scope]+' access'+(g.fill_id?' for one fill ('+fillRef(g.fill_id)+')':' to all of their fills')+(g.expires_at?' until '+when(g.expires_at):''),'Their name is not shown because you can only see their pickup details. Reference '+g.patient_id+'.'));}
 return box;
}
function grantLine(ui,g,canChange,viewer){
 const who=g.grantee_id===S.me?'You':cap(nameOf(g.grantee_id));
 const text=who+' · '+SCOPE[g.scope]+' access'+(g.fill_id?' for one fill ('+fillRef(g.fill_id)+')':' to all of '+(g.patient_id===S.me?'your':nameOf(g.patient_id)+'’s')+' records'),sub=(g.expires_at?(g.state==='active'?'Until ':'Ended ')+zoned(g.expires_at):'No end date')+' · granted by '+(g.grantor_id===S.me?'you':nameOf(g.grantor_id))+' · '+g.state;
 const revoke=canChange&&g.state==='active'&&ui.has(T.grantPreview)?button('Revoke',()=>startFlow(ui,'revoke',{action:'revoke',grant_id:g.grant_id}),{'data-action':'revoke','data-grant-id':g.grant_id,'aria-label':'Revoke '+who+'’s '+SCOPE[g.scope].toLowerCase()+' access'}):null;
 return css(el('div',{class:'record','data-grant':g.grant_id,'data-state':g.state},el('span',{class:'record-title'},text),el('span',{class:'record-subtitle'},sub),[g.grantee_id,g.grantor_id,g.patient_id].some(x=>x&&!person(x))?css(el('small',{},'Reference '+[...new Set([g.grantee_id,g.grantor_id,g.patient_id].filter(x=>x&&!person(x)))].join(', ')),{fontSize:'10px',color:'var(--muted)',marginTop:'4px'}):null,revoke?css(el('div',{class:'actions'},revoke),{marginTop:'8px'}):null),{cursor:'default',padding:'12px 0'});
}
function grantForm(ui,p){
 const d=draft('grant:'+p.person_id,{grantee:'',other:'',scope:'pickup',fill:'',date:'',time:''}),check=local('invalid_arguments');
 const known=[...new Set([...S.people.map(x=>x.person_id),...S.grants.flatMap(g=>[g.grantee_id,g.grantor_id,g.patient_id])])].filter(id=>id!==p.person_id);
 const grantee=el('select',{'aria-label':'Person','data-field':'grantee'},el('option',{value:''},'Choose a person'),...known.map(id=>el('option',{value:id},optionName(id))),el('option',{value:'other'},'Someone else (enter their ID)'));
 grantee.value=d.grantee;const other=el('input',{type:'text','aria-label':'Person ID','data-field':'grantee-other',maxlength:'80',placeholder:'For example p-4'});other.value=d.other;
 const otherField=css(field('Person ID',other),{display:d.grantee==='other'?'':'none'});
 grantee.addEventListener('change',()=>{d.grantee=grantee.value;touch('grant:'+p.person_id);css(otherField,{display:d.grantee==='other'?'':'none'});edited();});other.addEventListener('input',()=>{d.other=other.value;touch('grant:'+p.person_id);edited();});
 const scopes=group('Access');
 for(const s of ['view','refill','pickup']){const input=el('input',{type:'radio',name:'scope-'+p.person_id,value:s,'data-scope':s,'aria-label':SCOPE[s]});input.checked=d.scope===s;input.addEventListener('change',()=>{d.scope=s;css(fillField,{display:s==='pickup'?'':'none'});sync();edited();});scopes.append(choiceLabel(input,el('strong',{},SCOPE[s]),' — '+SCOPE_TEXT[s]));}
 const fills=S.fills.filter(f=>f.patient_id===p.person_id&&ACTIVE.includes(f.state));
 if(d.fill&&!fills.some(f=>f.fill_id===d.fill)){d.fill='';d.fillGone=true;}
 const unchosen=d.fillGone?el('option',{value:'unchosen',disabled:''},'Choose again'):null;
 const fill=el('select',{'aria-label':'Fill','data-field':'grant-fill'},unchosen,el('option',{value:''},'All of '+p.name+'’s fills'),...fills.map(f=>el('option',{value:f.fill_id},fillDrug(f)+' · '+STATE[f.state]+' ('+f.fill_id+')')));fill.value=d.fillGone?'unchosen':d.fill;
 fill.addEventListener('change',()=>{if(fill.value==='unchosen')return;d.fill=fill.value;d.fillGone=false;gone.remove();unchosen?.remove();check.textContent='';sync();edited();});
 const gone=d.fillGone?css(el('p',{'data-fill-gone':'true'},'The fill this access was limited to is no longer open, so the limit was cleared. Choose another fill, or all of '+p.name+'’s fills, before previewing.'),NOTE):el('span');
 const fillField=css(el('div',{},field('Pickup covers',fill,'A pickup grant can be limited to one fill.'),gone),{display:d.scope==='pickup'?'':'none'});
 const date=css(el('input',{type:'date','aria-label':'End date','data-field':'grant-date'}),{height:'42px'}),time=css(el('input',{type:'time','aria-label':'End time','data-field':'grant-time'}),{height:'42px'});date.value=d.date;time.value=d.time;
 date.addEventListener('input',()=>{d.date=date.value;edited();});time.addEventListener('input',()=>{d.time=time.value;edited();});
 const blocked=()=>d.scope==='pickup'&&!!d.fillGone;
 const preview=button('Preview change',()=>{
  if(blocked()){check.textContent='Choose which fills the pickup access covers first.';return;}
  const id=d.grantee==='other'?d.other.trim():d.grantee;
  let problem=!id?'Choose who gets access.':id===p.person_id?p.name+' already has full access to their own records.':null,expires=null;
  if(!problem&&d.date){const z=zonedIso(d.date,d.time||'23:59');if(z.error)problem=z.error;else expires=z.iso;}
  check.textContent=problem||'';if(problem)return;
  const args={action:'grant',patient_id:p.person_id,grantee_id:id,scope:d.scope,fill_id:d.scope==='pickup'&&d.fill?d.fill:null,expires_at:expires};
  startFlow(ui,'grant',args);
 },{class:'primary','data-action':'preview-grant'});
 const sync=()=>{preview.setAttribute('aria-disabled',String(blocked()));css(preview,{opacity:blocked()?'0.55':'',cursor:blocked()?'not-allowed':''});};
 sync();
 return panel('Give access to '+(p.person_id===S.me?'your':p.name+'’s')+' records',{'data-form':'grant'},css(el('div',{class:'fields'},field('Person',grantee),otherField,scopes,fillField,
  css(el('div',{class:'fields'},field('Access ends (optional)',date,'Eastern Time; leave empty for no end date.'),field('At (optional)',time,'Empty means the end of that day (11:59 PM).')),{gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))'})),{marginTop:'10px'}),
  check,actions(button('Close',()=>toggle(ui,'grant:'+p.person_id)),preview));
}
function approvalList(){
 if(!S.approvals.length)return muted('No confirmations yet. A confirmation is given outside this page for one preview and is valid for 30 minutes.');
 return el('div',{'data-list':'approvals'},...S.approvals.map(a=>el('div',{class:'metadata-line','data-approval-token':a.token,'data-state':a.state},el('span',{},APPROVAL[a.state]),
  el('strong',{},'Confirmed '+zoned(a.confirmed_at)+' · '+(a.state==='expired'?'expired ':'valid until ')+clock(a.expires_at),css(el('small',{},'Code '+a.token),{fontFamily:'ui-monospace,monospace',fontSize:'10px',overflowWrap:'anywhere'})))));
}
function personView(ui){
 const p=person(S.personId);if(!p)return el('div',{class:'empty'},el('h3',{},'Household'),el('p',{},'Choose a person.'));
 if(!S.grantsAllowed)return el('article',{},el('h2',{},p.name),unavailable('Access grants'));
 const mine=full(p.person_id),given=S.grants.filter(g=>g.patient_id===p.person_id).sort((a,b)=>(a.state==='active'?0:1)-(b.state==='active'?0:1));
 const received=p.person_id===S.me?S.grants.filter(g=>g.grantee_id===S.me&&g.patient_id!==S.me):[];
 const formKey='grant:'+p.person_id,open=S.open===formKey;
 return el('article',{'data-person':p.person_id},css(el('span',{class:'kicker'},RELATION[p.relation]||p.relation),{marginBottom:'6px'}),el('h2',{},p.name),
  el('div',{class:'tags'},...p.powers.map(x=>tag(POWER[x]||x)),p.is_minor?tag('Minor'):null),
  mine?muted(p.person_id===S.me?'You decide who can see, refill or pick up your prescriptions. Every change needs your confirmation.':'As a guardian you decide who can see, refill or pick up '+p.name+'’s prescriptions. Every change needs your confirmation.'):muted(p.name+' decides who has access to their records; changes they make arrive from outside this page.'),
  alertFor('person:'+p.person_id),flowPanel(ui),
  mine&&ui.has(T.grantPreview)&&S.flow?.scope!=='person:'+p.person_id?(open?grantForm(ui,p):actions(button('Give access',()=>toggle(ui,formKey),{class:'primary','data-action':'open-grant'}))):null,
  heading('Access to '+(p.person_id===S.me?'your':p.name+'’s')+' records'),given.length?given.map(g=>grantLine(ui,g,mine,p.person_id)):muted('Nobody else has access.'),
  received.length?[heading('Access you have to others’ records'),...received.map(g=>grantLine(ui,g,false,p.person_id))]:null,
  p.person_id===S.me?[heading('Your confirmations'),approvalList()]:null);
}

function rxList(ui){
 if(!ui.has(T.rxs))return unavailable('Prescriptions');
 const text=searchText(),box=el('div',{'data-list':'prescriptions'});
 const shown=S.rxs.filter(matchRx);
 const order=[...S.people.map(p=>p.person_id),...new Set(shown.map(r=>r.patient_id))];
 for(const pid of [...new Set(order)]){
  const mine=shown.filter(r=>r.patient_id===pid).sort((a,b)=>(a.state==='active'?0:1)-(b.state==='active'?0:1)||a.drug.generic_name.localeCompare(b.drug.generic_name));
  if(!mine.length)continue;box.append(kicker(nameOf(pid)));
  for(const r of mine){const f=activeFillOf(r),pending=r.renewals.find(x=>x.state==='pending');
   box.append(row({'data-rx-id':r.rx_id,'data-state':r.state,'aria-pressed':String(r.rx_id===S.rxId)},()=>choose(ui,{rxId:r.rx_id}),r.drug.generic_name+' '+r.drug.strength,
    (r.state==='active'?r.fills_remaining+' of '+r.fills_authorized+' fills left · expires '+day(r.expires_at.slice(0,10)):r.state==='superseded'?'Replaced by a newer prescription':'Expired '+day(r.expires_at.slice(0,10))),
    [f?'Fill '+STATE[f.state].toLowerCase():'',pending?'Renewal requested':''].filter(Boolean).join(' · ')||null));}
 }
 if(!shown.length)box.append(el('div',{class:'empty'},el('h3',{},'No prescriptions'),el('p',{},text?'Try a different search.':'Prescriptions you can see appear here.')));
 return box;
}
function requestForm(ui,r){
 const key='request:'+r.rx_id,d=draft(key,{store:'',quantity:String(r.quantity)}),check=local('invalid_arguments');
 const stock=S.rxStock||S.stores.map(s=>({...s,in_stock:null}));
 const sel=el('select',{'aria-label':'Store','data-field':'request-store'},el('option',{value:''},'Choose a store'),...stock.map(s=>el('option',{value:s.store_id},s.name+' — '+s.address+(s.in_stock===true?' · in stock':s.in_stock===false?' · not in stock now':'')+(s.open_now?'':' · closed now'))));
 sel.value=d.store;sel.addEventListener('change',()=>{d.store=sel.value;touch(key);edited();});
 const q=el('input',{type:'number',min:'1',step:'1',inputmode:'numeric','aria-label':'Quantity','data-field':'request-quantity'});q.value=d.quantity;q.addEventListener('input',()=>{d.quantity=q.value;touch(key);edited();});
 const submit=button(saveLabel(key,'Request fill'),()=>{
  const quantity=Number(d.quantity),problem=!d.store?'Choose a store.':!Number.isInteger(quantity)||quantity<1?'Enter a whole quantity.':null;check.textContent=problem||'';if(problem)return;
  act(ui,'rx:'+r.rx_id,()=>commit(ui,T.request,{rx_id:r.rx_id,store_id:d.store,quantity},()=>'request '+r.drug.generic_name+' for '+nameOf(r.patient_id),res=>{
   settle(key);S.open=null;S.fillId=res.fill.fill_id;S.goto='fills';
   S.flash=said(res,'Requested '+r.drug.generic_name+' '+r.drug.strength+' for '+nameOf(r.patient_id)+' at '+storeName(d.store)+'.'+(res.fill.review_due_at?' The pharmacist review is due '+zoned(res.fill.review_due_at)+'.':''),'request '+r.drug.generic_name+' for '+nameOf(r.patient_id));},null,{rxId:r.rx_id},{duplicate_request:'This prescription already has a fill in progress, so no new fill was requested.',no_fills_remaining:FRIENDLY.no_fills_remaining,quantity_not_allowed:allowedQuantities}));
 },{class:'primary','data-action':'request-fill'});
 return panel('Request a fill',{'data-form':'request'},changedNote(key,'prescription'),css(el('div',{class:'fields'},field('Store',sel,'Stock and opening are as of now; the review completes 2 hours after the request, or 2 hours after the store next opens.'),field('Quantity',q,'The prescription is written for '+r.quantity+'.')),{marginTop:'10px'}),
  r.fills_remaining===0?muted('This prescription has no fills left, so the pharmacy will refuse a new fill until the prescriber renews it.'):null,check,actions(button('Close',()=>toggle(ui,'request:'+r.rx_id)),submit));
}
function renewalForm(ui,r){
 const key='renew:'+r.rx_id,d=draft(key,{note:''}),note=el('textarea',{rows:'3','aria-label':'Note for the prescriber','data-field':'renewal-note',maxlength:String(NOTE_MAX)});note.value=d.note;note.addEventListener('input',()=>{d.note=note.value;touch(key);});
 const send=button(saveLabel(key,'Send renewal request'),()=>act(ui,'rx:'+r.rx_id,()=>commit(ui,T.renew,{rx_id:r.rx_id,...(d.note.trim()?{note:d.note.trim()}:{})},'ask for a renewal of '+r.drug.generic_name,res=>{settle(key);S.open=null;S.flash=said(res,'Asked '+r.prescriber.name+' to renew '+r.drug.generic_name+'. The reply will arrive later. Reference '+res.renewal.renewal_id+'.','ask for a renewal of '+r.drug.generic_name);},null,{rxId:r.rx_id},{duplicate_request:'A renewal request is already pending for this prescription, so no new one was sent.'})),{class:'primary','data-action':'send-renewal'});
 return panel('Ask the prescriber to renew',{'data-form':'renewal'},changedNote(key,'prescription'),field('Note (optional)',note),actions(button('Close',()=>toggle(ui,'renew:'+r.rx_id)),send));
}
function rxView(ui){
 if(!ui.has(T.rxs))return el('article',{},unavailable('Prescriptions'));
 const r=S.rx;if(!r)return el('div',{class:'empty'},el('h3',{},'No prescription selected'),el('p',{},'Choose a prescription.'));
 if(S.rxId&&r.rx_id!==S.rxId)return el('div',{class:'empty','data-loading':'true'},el('h3',{},'Loading…'));
 if(searchText()&&!S.rxs.some(x=>x.rx_id===r.rx_id&&matchRx(x)))return el('div',{class:'empty','data-search-empty':'true'},el('h3',{},'Not in the search results'),el('p',{},'The prescription you had open does not match the search. Choose one from the list.'));
 const f=activeFillOf(r),pending=r.renewals.find(x=>x.state==='pending'),write=canRefill(r.patient_id),fills=S.fills.filter(x=>x.rx_id===r.rx_id).sort((a,b)=>Date.parse(last(b)||0)-Date.parse(last(a)||0));
 const offers=rxOffers(ui,S.rxs.find(x=>x.rx_id===r.rx_id)||r);
 const tools=css(el('div',{class:'actions'}),{marginTop:'14px'});
 if(offers.has('request'))tools.append(button('Request a fill',()=>toggle(ui,'request:'+r.rx_id),{class:S.open==='request:'+r.rx_id?'':'primary','data-action':'open-request','aria-expanded':String(S.open==='request:'+r.rx_id)}));
 if(offers.has('renew'))tools.append(button('Ask for a renewal',()=>toggle(ui,'renew:'+r.rx_id),{'data-action':'open-renewal','aria-expanded':String(S.open==='renew:'+r.rx_id)}));
 if(offers.has('withdraw-renewal'))tools.append(button('Withdraw renewal request',()=>ask(ui,'rx:'+r.rx_id,'withdraw-renewal','Withdraw the renewal request?','The prescriber is no longer asked to renew this prescription, and a reply that arrives later is ignored.','Withdraw renewal request',()=>commit(ui,T.renewWithdraw,{renewal_id:pending.renewal_id},'withdraw the renewal request',res=>{S.flash=said(res,'Withdrew the renewal request; a later reply will be ignored. Reference '+res.renewal.renewal_id+'.','withdraw the renewal request');},null,{rxId:r.rx_id})),{'data-action':'withdraw-renewal'}));
 const status=r.state==='superseded'?'Replaced by '+(rxOf(r.superseded_by)?rxOf(r.superseded_by).drug.generic_name+' prescription '+r.superseded_by:r.superseded_by):r.state==='expired'?'Expired':'Active';
 return el('article',{'data-rx':r.rx_id,'data-state':r.state},css(el('span',{class:'kicker'},'Prescription for '+nameOf(r.patient_id)),{marginBottom:'6px'}),el('h2',{},r.drug.generic_name+' '+r.drug.strength),
  el('div',{class:'tags'},el('span',{class:'tag','data-rx-state':r.state},status),pending?tag('Renewal requested'):null,f?tag('Fill '+STATE[f.state].toLowerCase()):null),
  write?null:muted('You can see this prescription but not request or change fills for it.'),
  write&&r.state==='active'&&r.fills_remaining===0?muted('No fills are left on this prescription, so a new fill cannot be requested. Ask the prescriber for a renewal.',{'data-no-fills':'true'}):null,
  S.ask?.scope==='rx:'+r.rx_id?askPanel(ui,'rx:'+r.rx_id):tools,alertFor('rx:'+r.rx_id),S.open==='request:'+r.rx_id&&offers.has('request')?requestForm(ui,r):null,S.open==='renew:'+r.rx_id&&offers.has('renew')?renewalForm(ui,r):null,
  metadata('Form',r.drug.form),metadata('Quantity',String(r.quantity)),el('div',{class:'metadata-line','data-fills-left':String(r.fills_remaining)},el('span',{},'Fills left'),el('strong',{},r.fills_remaining+' of '+r.fills_authorized)),
  metadata('Prescriber',r.prescriber.name),metadata('Written',day(r.written_on)),metadata('Valid until',zoned(r.expires_at)),
  r.superseded_by?metadata('Replaced by',(rxOf(r.superseded_by)?'the newer '+rxOf(r.superseded_by).drug.generic_name+' prescription':'a newer prescription')+' (reference '+r.superseded_by+')'):null,
  r.renewals.length?[heading('Renewal requests'),...r.renewals.map((x,i)=>el('div',{class:'metadata-line','data-renewal':x.renewal_id,'data-state':x.state},el('span',{},'Request '+(i+1)),el('strong',{},cap(REQ_STATE[x.state]||x.state)+' · reference '+x.renewal_id)))]:null,
  r.facts?.length?[heading('From the drug label'),...r.facts.map(x=>css(el('div',{'data-fact':''},el('p',{},x.text),el('small',{},x.source.publisher+', '+x.source.section+', version '+x.source.version+' · ',/^https:\/\/[^\s]+$/.test(x.source.url)?el('a',{href:x.source.url,target:'_blank',rel:'noopener noreferrer'},'label source'):x.source.url)),{padding:'8px 0',borderBottom:'1px solid var(--line)'})),muted('Facts are paraphrased from the cited public label; the pharmacy gives no clinical advice here.')]:null,
  heading('Fills'),fills.length?fills.map(x=>row({'data-rx-fill':x.fill_id},()=>choose(ui,{fillId:x.fill_id},'fills'),STATE[x.state]+' · '+storeName(x.store_id),(last(x)?when(last(x)):'')+(x.amount_due_cents!=null?' · '+money(x.amount_due_cents):''))):muted('No fills yet.'));
}

const matchFill=f=>{const text=searchText();return !text||[fillDrug(f),nameOf(patientOf(f)),storeName(f.store_id),STATE[f.state],f.fill_id].join(' ').toLowerCase().includes(text);};
const matchRx=r=>{const text=searchText();return !text||[r.drug.generic_name,nameOf(r.patient_id),r.prescriber.name].join(' ').toLowerCase().includes(text);};
function readyText(f){
 const auth=f.authorization||f.own_authorization,prepaid=auth?.state==='live'&&auth.amount_cents>=(f.amount_due_cents||0);
 return (f.view==='logistics'?'Ready, as reported':f.hold?'On hold, cannot be collected yet':'Can be collected')+' · '+(prepaid?'prepaid '+money(auth.amount_cents):f.amount_due_cents?money(f.amount_due_cents)+' to pay':'nothing to pay');
}
function fillList(ui){
 if(!ui.has(T.fills))return unavailable('Fills');
 const text=searchText(),shown=S.fills.filter(matchFill);
 const box=el('div',{'data-list':'fills'});
 const line=f=>row({'data-fill-id':f.fill_id,'data-state':f.state,'aria-pressed':String(f.fill_id===S.fillId)},()=>choose(ui,{fillId:f.fill_id}),fillTitle(f),
  (f.state==='ready'?'Ready for pickup':STATE[f.state]+(f.hold?' · on hold':''))+' · '+storeName(f.store_id),
  f.state==='claim_rejected'&&f.claim?'Plan: '+REASON[f.claim.reason]:f.state==='ready'?readyText(f):last(f)?when(last(f)):null);
 for(const [label,test] of [['Needs attention',f=>f.state==='claim_rejected'],['In progress',f=>['requested','waiting_stock','pending_plan_decision'].includes(f.state)],['Ready for pickup',f=>f.state==='ready']]){
  const items=shown.filter(test);if(!items.length)continue;box.append(kicker(label));for(const f of items)box.append(line(f));
 }
 const past=shown.filter(f=>!ACTIVE.includes(f.state)).sort((a,b)=>Date.parse(last(b)||0)-Date.parse(last(a)||0));
 if(past.length){const d=el('details',{'data-past':String(past.length)},css(el('summary',{},'Past fills ('+past.length+')'),{cursor:'pointer',padding:'12px 22px',fontSize:'12px',fontWeight:'600'}),...past.map(line));if(text||past.some(f=>f.fill_id===S.fillId))d.open=true;box.append(d);}
 if(!shown.length)box.append(el('div',{class:'empty'},el('h3',{},'No fills'),el('p',{},text?'Try a different search.':'Fills you request appear here.')));
 return box;
}
function planDates(f){
 const i=f.timeline.map(x=>x.state).lastIndexOf('pending_plan_decision');if(i<0)return '';
 const next=f.timeline[i+1];
 return 'Sent '+when(f.timeline[i].at)+(next&&f.plan_request.state!=='pending'?' · '+(f.plan_request.state==='withdrawn'?'withdrawn ':f.plan_request.state==='denied'?'denied ':'decided ')+when(next.at):'');
}
function planList(ui){
 if(!ui.has(T.fills))return unavailable('Plan requests');
 const items=S.fills.filter(f=>f.plan_request&&matchFill(f)),box=el('div',{'data-list':'plan'});
 for(const [label,test] of [['Pending',f=>f.plan_request.state==='pending'],['Decided or withdrawn',f=>f.plan_request.state!=='pending']]){
  const xs=items.filter(test).sort((a,b)=>Date.parse(last(b)||0)-Date.parse(last(a)||0));if(!xs.length)continue;box.append(kicker(label));
  for(const f of xs)box.append(row({'data-plan-id':f.plan_request.plan_request_id,'data-fill-id':f.fill_id,'aria-pressed':String(f.fill_id===S.planId)},()=>choose(ui,{planId:f.fill_id}),fillTitle(f),
   (f.plan_request.reason==='prior_auth_required'?'Prior authorization':'Early-refill override')+' · '+REQ_STATE[f.plan_request.state]+' · '+STATE[f.state].toLowerCase(),planDates(f)));
 }
 if(!items.length)box.append(el('div',{class:'empty'},el('h3',{},'No plan requests'),el('p',{},searchText()?'Try a different search.':'When a plan rejects a claim as too soon or needing prior authorization, you can ask the pharmacy to request a decision.')));
 box.append(css(muted('Each fill shows its latest plan request. Mendwell does not return earlier requests for the same fill, the note sent with a request or the plan’s reasons for a decision.'),{padding:'10px 22px'}));
 return box;
}
function planView(ui){
 if(!ui.has(T.fills))return el('article',{},unavailable('Plan requests'));
 const listed=S.planId&&S.fills.some(x=>x.fill_id===S.planId&&x.plan_request&&matchFill(x));
 if(!listed)return el('div',{class:'empty','data-plan-empty':'true'},el('h3',{},'No plan request selected'),el('p',{},'Choose a plan request to see its fill.'));
 return fillView(ui);
}
function quantityForm(ui,f){
 const key='quantity:'+f.fill_id,d=draft(key,{quantity:String(f.quantity)}),q=el('input',{type:'number',min:'1',step:'1','aria-label':'New quantity','data-field':'new-quantity'});q.value=d.quantity;q.addEventListener('input',()=>{d.quantity=q.value;touch(key);});
 const check=local('invalid_arguments');
 return panel('Change the quantity',{'data-form':'quantity'},changedNote(key,'fill'),field('Quantity',q,f.claim?.reason==='quantity_limit'?'The plan rejected '+f.quantity+'; a quantity the plan allows is resubmitted to the plan.':'The fill is now for '+f.quantity+'; the quantity must be one the medicine comes in.'),check,
  actions(button('Close',()=>toggle(ui,key)),button(saveLabel(key,'Save quantity'),()=>{const n=Number(d.quantity);if(!Number.isInteger(n)||n<1){check.textContent='Enter a whole quantity.';return;}
   act(ui,'fill:'+f.fill_id,()=>commit(ui,T.quantity,{fill_id:f.fill_id,quantity:n},'change the quantity to '+n,res=>{settle(key);S.open=null;S.flash=said(res,'Quantity changed to '+n+'. '+STATE[res.fill.state]+'.','change the quantity to '+n);},null,{fillId:f.fill_id},{quantity_not_allowed:allowedQuantities}));},{class:'primary','data-action':'save-quantity'})));
}
function storeForm(ui,f){
 const key='store:'+f.fill_id,d=draft(key,{store:''}),stock=S.fillStock||S.stores.map(s=>({...s,in_stock:null}));
 const sel=el('select',{'aria-label':'New store','data-field':'new-store'},el('option',{value:''},'Choose a store'),...stock.filter(s=>s.store_id!==f.store_id).map(s=>el('option',{value:s.store_id},s.name+(s.in_stock===true?' · in stock':s.in_stock===false?' · not in stock':'')+(s.open_now?'':' · closed now'))));
 sel.value=d.store;sel.addEventListener('change',()=>{d.store=sel.value;touch(key);});const check=local('invalid_arguments');
 return panel('Move to another store',{'data-form':'store'},changedNote(key,'fill'),field('Store',sel,'The plan claim, any plan request and due times stay with the fill.'),check,
  actions(button('Close',()=>toggle(ui,key)),button(saveLabel(key,'Move fill'),()=>{if(!d.store){check.textContent='Choose a store.';return;}
   act(ui,'fill:'+f.fill_id,()=>commit(ui,T.store,{fill_id:f.fill_id,store_id:d.store},'move the fill to '+storeName(d.store),res=>{settle(key);S.open=null;S.flash=said(res,'Moved to '+storeName(d.store)+'. '+STATE[res.fill.state]+'.','move the fill to '+storeName(d.store));},null,{fillId:f.fill_id}));},{class:'primary','data-action':'save-store'})));
}
function planForm(ui,f){
 const key='plan:'+f.fill_id,ask=ASK[f.claim.reason],d=draft(key,{note:''}),note=el('textarea',{rows:'3','aria-label':'Note for the plan request','data-field':'plan-note',maxlength:String(NOTE_MAX)});note.value=d.note;note.addEventListener('input',()=>{d.note=note.value;touch(key);});
 return panel('Ask the plan for '+ask,{'data-form':'plan'},changedNote(key,'fill'),muted('The pharmacy asks the prescriber and the plan. The decision arrives later; approval waives this reason and resubmits the claim once.'),field('Note (optional)',note),
  actions(button('Close',()=>toggle(ui,key)),button(saveLabel(key,'Send plan request'),()=>act(ui,'fill:'+f.fill_id,()=>commit(ui,T.planCreate,{fill_id:f.fill_id,...(d.note.trim()?{note:d.note.trim()}:{})},'ask the plan for '+ask,res=>{settle(key);S.open=null;S.flash=said(res,'Plan request sent; the fill now waits for the plan’s decision. Reference '+res.plan_request.plan_request_id+'.','ask the plan for '+ask);},null,{fillId:f.fill_id})),{class:'primary','data-action':'send-plan-request'})));
}
function prepayForm(ui,f){
 const key='prepay:'+f.fill_id,d=draft(key,{card:''}),check=local('invalid_arguments');
 const sel=el('select',{'aria-label':'Card','data-field':'prepay-card'},el('option',{value:''},'Choose one of your cards'),...S.cards.map(c=>el('option',{value:c.card_id},cardText(c))));sel.value=d.card;sel.addEventListener('change',()=>{d.card=sel.value;touch(key);edited();});
 return panel('Prepay this fill',{'data-form':'prepay'},muted('The card is authorized for exactly the amount due now and charged when the fill is collected; it is voided if the fill is cancelled or returned to stock. Whether a card is accepted is known only when it is used.'),field('Card',sel),check,
  actions(button('Close',()=>toggle(ui,key)),button('Preview prepayment',()=>{if(!d.card){check.textContent='Choose a card.';return;}const c=S.cards.find(k=>k.card_id===d.card);
   startFlow(ui,'prepay',{fill_id:f.fill_id,card_id:d.card});},{class:'primary','data-action':'preview-prepay'})));
}
function collectorForm(ui,f){
 const key='collector:'+f.fill_id,pid=f.patient_id;
 const known=[...new Set([pid,...S.people.map(p=>p.person_id),...S.grants.filter(g=>g.patient_id===pid&&g.scope==='pickup').map(g=>g.grantee_id)])].filter(Boolean);
 const d=draft(key,{who:f.collector_id&&!known.includes(f.collector_id)?'other':f.collector_id||'',other:f.collector_id&&!known.includes(f.collector_id)?f.collector_id:''});
 const covers=id=>S.grants.some(g=>g.patient_id===pid&&g.grantee_id===id&&g.scope==='pickup'&&g.state==='active'&&(!g.fill_id||g.fill_id===f.fill_id));
 const note=id=>id===pid?' (patient)':id===S.me&&full(pid)?' (you, '+(pid===S.me?'patient':'guardian')+')':covers(id)?' (has pickup access)':id===S.me?' (you)':'';
 const sel=el('select',{'aria-label':'Who will collect','data-field':'collector'},el('option',{value:''},'Nobody named'),...known.map(id=>el('option',{value:id},optionName(id)+note(id))),el('option',{value:'other'},'Someone else (enter their ID)'));
 const other=el('input',{type:'text','aria-label':'Person ID','data-field':'collector-other',maxlength:'80',placeholder:'For example p-4'});other.value=d.other;
 const otherField=css(field('Person ID',other),{display:d.who==='other'?'':'none'});
 sel.value=d.who;sel.addEventListener('change',()=>{d.who=sel.value;touch(key);css(otherField,{display:d.who==='other'?'':'none'});});other.addEventListener('input',()=>{d.other=other.value;touch(key);});
 const check=local('invalid_arguments');
 const household=full(pid)&&ui.has(T.grantPreview)?button('Give pickup access in Household',()=>{
  const chosen=d.who==='other'?d.other.trim():d.who,gkey='grant:'+pid;
  S.drafts[gkey]={grantee:chosen&&chosen!==pid?(known.includes(chosen)?chosen:'other'):'',other:chosen&&chosen!==pid&&!known.includes(chosen)?chosen:'',scope:'pickup',fill:f.fill_id,date:'',time:'',stamp:'',dirty:true,conflict:false};
  choose(ui,{personId:pid},'household',gkey).then(()=>focusForm(gkey,true));
 },{'data-action':'goto-household'}):null;
 return panel('Who will collect',{'data-form':'collector'},changedNote(key,'fill'),muted('The pharmacy accepts the patient, a guardian of a minor patient, or someone whose pickup access covers this fill, and says so if the person you name cannot collect. The counter checks again at pickup.'),
  css(el('p',{'data-collector-hint':'true'},'Anyone else needs pickup access first: give it in Household, then name them here.',household?' ':null,household),{fontSize:'12px',margin:'6px 0 10px'}),field('Person',sel),otherField,check,
  actions(button('Close',()=>toggle(ui,key)),button(saveLabel(key,'Save'),()=>{
   const who=d.who==='other'?d.other.trim():d.who;if(d.who==='other'&&!who){check.textContent='Enter the person’s ID.';return;}
   const label=()=>who?'name '+nameOf(who)+' as collector':'clear the collector';
   act(ui,'fill:'+f.fill_id,()=>commit(ui,T.collector,{fill_id:f.fill_id,collector_id:who||null},label,res=>{settle(key);S.open=null;S.flash=said(res,who?nameOf(who)+' is recorded as the person collecting.':'No collector is recorded now.',label);},null,{fillId:f.fill_id},{not_authorized:who?cap(nameOf(who))+' cannot collect this fill: they are not the patient or a guardian and have no pickup access that covers it, so nobody new was named. Give them pickup access in Household first.':FRIENDLY.not_authorized,not_found:NO_PERSON,invalid_state:'This fill can no longer be collected, so nobody new was named.'}));
  },{class:'primary','data-action':'save-collector'})));
}
function ask(ui,scope,offer,title,text,yes,run){
 if(pageBusy())return;S.error=null;S.flash=null;S.ask={scope,offer,ref:askRef(scope,offer),title,text,yes,run};ui.navigate(ui.section).then(()=>document.querySelector('[data-ask] [data-action=ask-no]')?.focus()).catch(ui.error);
}
function askPanel(ui,scope){
 const q=S.ask;if(!q||q.scope!==scope)return null;
 return panel(q.title,{'data-ask':'true'},el('p',{},q.text),actions(button('Not now',()=>{S.ask=null;ui.navigate(ui.section).catch(ui.error);},{'data-action':'ask-no'}),button(q.yes,()=>{S.ask=null;act(ui,scope,q.run);},{class:'primary','data-action':'ask-yes'})));
}
function fillTools(ui,f){
 const o=fillOffers(ui,f),key=k=>k+':'+f.fill_id,box=css(el('div',{class:'actions'}),{marginTop:'14px',alignItems:'center'});
 const t=(label,k,attrs={})=>button(label,()=>toggle(ui,key(k)),{'data-action':'open-'+k,'aria-expanded':String(S.open===key(k)),...attrs});
 const target={fillId:f.fill_id},flow=kind=>()=>startFlow(ui,kind,{fill_id:f.fill_id});
 if(S.flow?.scope==='fill:'+f.fill_id||S.ask?.scope==='fill:'+f.fill_id)return askPanel(ui,'fill:'+f.fill_id);
 if(o.has('quantity'))box.append(t('Change quantity','quantity'));
 const scope='fill:'+f.fill_id;
 if(o.has('wait'))box.append(button('Resubmit to the plan on '+day(f.claim.eligible_on),()=>ask(ui,scope,'wait','Resubmit to the plan on '+day(f.claim.eligible_on)+'?','The pharmacy sends the claim to the plan again at the start of '+day(f.claim.eligible_on)+', the first day the plan allows a refill. Until then the fill waits; nothing is charged now.','Schedule resubmission',()=>commit(ui,T.wait,{fill_id:f.fill_id},'schedule the resubmission',res=>{S.flash=said(res,res.fill.resubmission_due_at?'The claim will be resubmitted '+zoned(res.fill.resubmission_due_at)+'.':STATE[res.fill.state]+'.','schedule the resubmission');},null,target)),{'data-action':'wait'}));
 if(o.has('plan'))box.append(t('Ask the plan','plan'));
 if(o.has('withdraw-plan'))box.append(button('Withdraw plan request',()=>ask(ui,scope,'withdraw-plan','Withdraw the plan request?','The fill goes back to “rejected by the drug plan”, and a decision that arrives later is ignored. You can then pay the cash price, wait or ask again.','Withdraw request',()=>commit(ui,T.planWithdraw,{plan_request_id:f.plan_request.plan_request_id},'withdraw the plan request',res=>{S.flash=said(res,'Withdrew the plan request; a later decision will be ignored. Reference '+res.plan_request.plan_request_id+'.','withdraw the plan request');},null,target)),{'data-action':'withdraw-plan'}));
 if(o.has('cash'))box.append(button('Pay the cash price',flow('cash'),{'data-action':'preview-cash'}));
 if(o.has('store'))box.append(t('Change store','store'));
 if(o.has('prepay'))box.append(t('Prepay','prepay',{class:'primary'}));
 if(o.has('collector'))box.append(t('Who will collect','collector'));
 if(o.has('cancel'))box.append(button('Cancel fill',flow('cancel'),{'data-action':'preview-cancel'}));
 if(f.hold&&f.view!=='logistics')box.append(muted('On hold for a pharmacist check: until the pharmacist releases it, the pharmacy does not change its quantity, store or payment, and it cannot be collected.',{'data-hold-hint':'true'}));
 if(f.state==='pending_plan_decision'&&f.view!=='logistics'&&canRefill(f.patient_id))box.append(muted('To pay the cash price instead, withdraw the plan request first; while it is pending, the pharmacy waits for the plan’s decision.',{'data-cash-hint':'true'}));
 return box.children.length?box:null;
}
const fillRef=id=>{const f=S.fills.find(x=>x.fill_id===id);return (f&&f.view!=='logistics'?fillDrug(f)+', ':'')+'reference '+id;};
function pickupLines(f,auth){
 const prepaid=auth?.state==='live'&&f.amount_due_cents!=null&&auth.amount_cents>=f.amount_due_cents;
 const can=f.state!=='ready'?null:f.view==='logistics'?'Ready, as the pharmacy reports it. Pickup access does not show pharmacist holds, so the counter confirms at pickup whether it can be handed over.':f.hold?'Not yet: on hold for a pharmacist check':'Yes, at '+storeName(f.store_id);
 if(['cancelled','returned_to_stock','collected'].includes(f.state))return [el('div',{class:'metadata-line','data-due':'0'},el('span',{},'Outstanding'),el('strong',{},'Nothing'+(f.state==='collected'?'':' (the fill is '+STATE[f.state].toLowerCase()+')'))),
  f.amount_due_cents!=null?el('div',{class:'metadata-line','data-original-price':String(f.amount_due_cents)},el('span',{},'Original price'),el('strong',{},money(f.amount_due_cents))):null];
 const owed=f.amount_due_cents==null?'Set when the fill is ready':prepaid?'Nothing more: '+money(auth.amount_cents)+' is prepaid and charged when collected':f.amount_due_cents===0?'Nothing':money(f.amount_due_cents)+(f.state==='ready'?' at pickup':'');
 return [can?el('div',{class:'metadata-line','data-collectable':f.view==='logistics'?'unknown':f.hold?'false':'true'},el('span',{},f.view==='logistics'?'Pickup':'Can be collected'),el('strong',{},can)):null,
  el('div',{class:'metadata-line','data-due':String(f.amount_due_cents??'')},el('span',{},f.state==='ready'?'To pay':'Amount due'),el('strong',{},owed))];
}
function stepLabel(f,i){
 const x=f.timeline[i],prev=f.timeline[i-1]?.state,later=f.timeline.slice(i+1).some(y=>y.state==='pending_plan_decision');
 if(x.state==='requested')return i===0?'Requested; pharmacist review':'In pharmacist review';
 if(x.state==='pending_plan_decision')return 'Plan request sent; waiting for the plan’s decision';
 if(prev==='pending_plan_decision'){
  const pr=later?null:f.plan_request?.state,then=(STATE[x.state]||x.state).toLowerCase();
  if(x.state==='cancelled')return 'Cancelled'+(pr==='withdrawn'?'; its pending plan request was withdrawn with it':pr?'; the plan request was '+pr:'; Mendwell does not report what happened to its plan request');
  if(pr==='withdrawn')return 'Plan request withdrawn; the plan’s rejection stands';
  if(pr==='denied')return 'The plan denied the request';
  if(pr==='approved')return x.state==='claim_rejected'?'The plan approved the request, but the claim sent again was rejected':'The plan approved the request; '+then;
  return 'The plan request ended; '+then+' (Mendwell does not report how this earlier request ended)';
 }
 return STATE[x.state]||x.state;
}
function timeline(f){
 return css(el('ol',{'data-timeline':'true'},...f.timeline.map((x,i)=>css(el('li',{'data-step':x.state},css(el('span',{},when(x.at)),{color:'var(--muted)',display:'block',fontSize:'11px'}),el('strong',{},stepLabel(f,i))),{padding:'8px 0',borderBottom:'1px solid #f1f3f7',fontSize:'12px'}))),{margin:'6px 0 0',paddingLeft:'22px'});
}
function fillView(ui){
 if(!ui.has(T.fills))return el('article',{},unavailable('Fills'));
 const f=S.fill;if(!f)return el('div',{class:'empty'},el('h3',{},'No fill selected'),el('p',{},'Choose a fill.'));
 if(fillTarget()&&f.fill_id!==fillTarget())return el('div',{class:'empty','data-loading':'true'},el('h3',{},'Loading…'));
 if(searchText()&&!S.fills.some(x=>x.fill_id===f.fill_id&&matchFill(x)))return el('div',{class:'empty','data-search-empty':'true'},el('h3',{},'Not in the search results'),el('p',{},'The fill you had open does not match the search. Choose one from the list.'));
 const forms=S.open&&keyId(S.open)===f.fill_id?kindOf(S.open):null,auth=f.authorization||f.own_authorization;
 const open=forms&&fillOffers(ui,f).has(forms)?{quantity:quantityForm,store:storeForm,plan:planForm,prepay:prepayForm,collector:collectorForm}[forms]:null;
 const scope='fill:'+f.fill_id,pid=patientOf(f);
 if(f.view==='logistics')return el('article',{'data-fill':f.fill_id,'data-state':f.state,'data-view':'logistics'},css(el('span',{class:'kicker'},pid?'Pickup for '+nameOf(pid):'Pickup access'),{marginBottom:'6px'}),el('h2',{},'Prescription pickup'),
  el('div',{class:'tags'},el('span',{class:'tag','data-fill-state':f.state},STATE[f.state])),muted('Your pickup access shows pickup details only.'),alertFor(scope),flowPanel(ui),fillTools(ui,f),open?open(ui,f):null,
  metadata('Store',storeName(f.store_id)+(store(f.store_id)?' — '+store(f.store_id).address:'')),...pickupLines(f,auth),
  metadata('Ready since',f.ready_at?zoned(f.ready_at):'Not ready yet'),f.return_at?metadata(f.state==='returned_to_stock'?'Returned':'Returned to stock if not collected by',zoned(f.return_at)):null,
  auth?el('div',{class:'metadata-line','data-authorization':auth.state},el('span',{},'Your prepayment'),el('strong',{},money(auth.amount_cents)+' on card •••• '+auth.card_last4+', '+(AUTH[auth.state]||auth.state))):null,
  f.approvals?.length?[heading('Your confirmations for this fill'),...f.approvals.map(a=>metadata(APPROVAL[a.state],'Confirmed '+clock(a.confirmed_at)+' · '+(a.state==='expired'?'expired ':'valid until ')+clock(a.expires_at)+' · code '+a.token))]:null,
  metadata('Reference',f.fill_id));
 const r=rxOf(f.rx_id),claim=f.claim;
 const claimText=!claim?'Not sent to the plan yet':claim.result==='paid'?'Paid by the plan'+(claim.reversed_at?' · reversed '+when(claim.reversed_at):''):'Rejected: '+REASON[claim.reason]+(claim.eligible_on?' · eligible on '+day(claim.eligible_on):'');
 const due=[['review_due_at','Pharmacist review due'],['resubmission_due_at','Resubmission to the plan'],['warning_at',f.state==='ready'?'Pickup reminder':'Pickup reminder sent'],['return_at',f.state==='returned_to_stock'?'Returned to stock':'Returned to stock if not collected by']].filter(([k])=>f[k]);
 return el('article',{'data-fill':f.fill_id,'data-state':f.state},css(el('span',{class:'kicker'},'Fill for '+nameOf(f.patient_id)),{marginBottom:'6px'}),el('h2',{},r?r.drug.generic_name+' '+r.drug.strength:fillDrug(f)),
  el('div',{class:'tags'},el('span',{class:'tag','data-fill-state':f.state},STATE[f.state]),f.hold?el('span',{class:'tag','data-hold':'true'},'On hold'):null,claim?.waived?.length?tag('Waived: '+claim.waived.map(x=>REASON[x]).join(', ')):null),
  f.hold?css(el('div',{'data-hold-note':''},el('strong',{},'Pharmacist hold since '+zoned(f.hold.placed_at)),el('p',{},f.hold.note)),NOTE):null,
  alertFor(scope),flowPanel(ui),fillTools(ui,f),open?open(ui,f):null,
  ...pickupLines(f,auth),
  metadata('Store',storeName(f.store_id)+(store(f.store_id)?' — '+store(f.store_id).address:'')),metadata('Quantity',String(f.quantity)),
  el('div',{class:'metadata-line','data-claim':claim?claim.result+':'+(claim.reason||''):'none'},el('span',{},'Drug plan'),el('strong',{},claimText)),
  f.cash?el('div',{class:'metadata-line','data-cash':String(f.cash.price_cents)},el('span',{},'Cash price'),el('strong',{},money(f.cash.price_cents)+' (instead of the plan)')):null,
  f.plan_request?el('div',{class:'metadata-line','data-plan-request':f.plan_request.state},el('span',{},'Plan request'),el('strong',{},(f.plan_request.reason==='prior_auth_required'?'Prior authorization':'Early-refill override')+' · '+REQ_STATE[f.plan_request.state]+' (reference '+f.plan_request.plan_request_id+')')):null,
  auth?el('div',{class:'metadata-line','data-authorization':auth.state},el('span',{},'Prepayment'),el('strong',{},money(auth.amount_cents)+' on card •••• '+auth.card_last4+', '+(AUTH[auth.state]||auth.state))):null,
  f.charge?el('div',{class:'metadata-line','data-charge':String(f.charge.amount_cents)},el('span',{},'Charged'),el('strong',{},money(f.charge.amount_cents)+' '+(f.charge.method==='capture'?'(prepayment captured)':'at the counter')+' · paid by '+nameOf(f.charge.payer_id)+' · '+when(f.charge.at))):null,
  f.state==='ready'||f.collector_id?el('div',{class:'metadata-line','data-collector':f.collector_id||''},el('span',{},'Collecting'),el('strong',{},f.collector_id?cap(nameOf(f.collector_id)):'Nobody named')):null,
  ...due.map(([k,l])=>el('div',{class:'metadata-line','data-time':k},el('span',{},l),el('strong',{},zoned(f[k])))),
  f.cancellation?el('div',{class:'metadata-line','data-cancellation':f.cancellation.reason},el('span',{},'Cancelled'),el('strong',{},when(f.cancellation.at)+' · '+(CANCEL[f.cancellation.reason]||f.cancellation.reason))):null,
  f.refusals.length?[heading('Refused at the counter'),...f.refusals.map(x=>el('div',{class:'metadata-line','data-refusal':x.reason},el('span',{},when(x.at)),el('strong',{},'Not collected: '+(REFUSAL[x.reason]||x.reason))))]:null,
  f.notes.length?[heading('Pharmacist notes'),...f.notes.map(n=>metadata(when(n.at),n.text))]:null,
  f.approvals?.length?[heading('Your confirmations for this fill'),...f.approvals.map(a=>metadata(APPROVAL[a.state],'Confirmed '+clock(a.confirmed_at)+' · '+(a.state==='expired'?'expired ':'valid until ')+clock(a.expires_at)+' · code '+a.token))]:null,
  heading('Timeline'),timeline(f),metadata('Reference',f.fill_id));
}

function accountList(){
 const me=person(S.me);
 return el('div',{'data-list':'account'},css(el('div',{},el('span',{class:'record-title'},me?me.name:'Account holder'),el('span',{class:'record-subtitle'},'Times shown in '+zoneName()+' ('+TZ+')')),{padding:'0 22px 14px'}),
  kicker('Your cards'),...S.cards.map(c=>el('div',{class:'record','data-card-id':c.card_id},el('span',{class:'record-title'},c.label+' •••• '+c.last4),el('span',{class:'record-subtitle'},'Expiry '+String(c.exp_month).padStart(2,'0')+'/'+c.exp_year))),
  css(muted('Card numbers are masked; whether a card is accepted is known only when it is used.'),{padding:'10px 22px'}));
}
function accountView(){
 return el('article',{'data-view':'stores'},el('h2',{},'Stores'),muted('Opening hours in Eastern Time.'),...S.stores.map(s=>css(el('div',{'data-store':s.store_id},el('h3',{},s.name),el('p',{},s.address),el('div',{class:'tags'},tag(s.open_now?'Open now':'Closed now')),...hoursText(s).map(h=>el('small',{},h))),{padding:'14px 0',borderBottom:'1px solid var(--line)'})));
}

function shell(){
 const badge=document.querySelector('.collection-count');if(badge)css(badge,{display:'none'});const nav=document.querySelector('.sidebar nav');if(nav)css(nav,{flexWrap:'wrap'});
 const records=document.getElementById('records');if(records)css(records,{maxHeight:'none'});
 const me=person(S.me),foot=document.querySelector('.sidebar-foot');
 if(me&&foot){const strong=foot.querySelector('strong'),small=foot.querySelector('small'),mark=foot.querySelector('.avatar');if(strong)strong.textContent=me.name;if(small)small.textContent='Signed in · account holder';if(mark)mark.textContent=me.name.split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase();}
 const narrow=matchMedia('(max-width: 760px)').matches;
 for(const b of document.querySelectorAll('#app button,#app summary,#app select,#app input:not([type=radio]):not([type=checkbox])'))b.style.minHeight=narrow?'44px':'';
}
function list(shown,ui){
 shell();
 if(!S.version)return el('div');
 S.section=ui.section;
 return ui.section==='household'?householdList(ui):ui.section==='prescriptions'?rxList(ui):ui.section==='plan'?planList(ui):ui.section==='account'?accountList():fillList(ui);
}
function detail(ui){
 if(!S.version)return el('div',{class:'empty'},el('h3',{},'Loading…'));
 S.section=ui.section;
 const view=S.selectFailed?el('div',{class:'empty','data-selection-failed':'true'},el('h3',{},'Could not open your choice'),el('p',{},'The page could not read Mendwell to open what you chose, so nothing is shown here and changes are paused. Press Refresh to try again.'))
  :ui.section==='household'?personView(ui):ui.section==='prescriptions'?rxView(ui):ui.section==='account'?accountView():ui.section==='plan'?planView(ui):fillView(ui);
 const lost=S.lost?css(el('p',{role:'status','data-lost':'true'},S.lost),{...NOTE,margin:'18px 24px 0'}):null;
 const flash=S.flash&&S.flashSection===ui.section?css(el('p',{role:'status','data-flash':'true'},S.flash),{color:'var(--accent)',fontWeight:'600',fontSize:'13px',margin:'18px 24px 0'}):null;
 const stale=S.stale?css(el('p',{role:'status','data-stale':'true'},'Your last change was saved, but the page could not load Mendwell’s latest state. Press Refresh before changing anything else.'),{...NOTE,margin:'18px 24px 0'}):null;
 queueMicrotask(shell);
 if(['fills','plan'].includes(ui.section)&&fillTarget()&&S.fill?.fill_id!==fillTarget()&&!S.selectFailed)queueMicrotask(()=>sync(ui));
 return el('div',{},S.unknown?unknownBanner(ui):null,!S.unknown&&S.error?.scope==='unknown'?css(alertFor('unknown'),{margin:'18px 24px 0'}):null,stale,lost,flash,view);
}
mount({
 id:'mendwell-pharmacy',title:'Mendwell Pharmacy',symbol:'℞',searchLabel:'Search prescriptions and fills',initialSection:'fills',
 list:T.people,collection:'none',get:T.people,item:'people',heading:()=>'Mendwell Pharmacy',actions:[],load,
 sections:()=>{const ready=S.fills.filter(f=>f.state==='ready').length,attention=S.fills.filter(f=>f.state==='claim_rejected').length,pending=S.fills.filter(f=>f.plan_request?.state==='pending').length;
  return [{id:'fills',label:'Fills'+(ready||attention?' ('+[ready?ready+' ready':'',attention?attention+' rejected':''].filter(Boolean).join(', ')+')':''),symbol:'▤',count:false},{id:'prescriptions',label:'Prescriptions',symbol:'℞',count:false},
   {id:'plan',label:'Plan requests'+(pending?' ('+pending+' pending)':''),symbol:'⚖',count:false},{id:'household',label:'Household',symbol:'◉',count:false},{id:'account',label:'Account',symbol:'▣',count:false}];},
 renderList:list,emptyView:detail
});
const status=document.getElementById('status');
const outcome=()=>S.unknown||['unconfirmed','unconfirmed_pending','connection_lost'].includes(S.error?.code)?'Whether your last change took effect cannot be confirmed. See the message on the page.':S.error?'Nothing was changed. See the message on the page.':null;
if(status)new MutationObserver(()=>{
 if(S.busy&&status.textContent!=='Working…')queueMicrotask(lock);
 else if(status.textContent==='All changes saved'&&outcome()){status.textContent=outcome();status.dataset.error='true';}
}).observe(status,{childList:true,characterData:true,subtree:true});
