import {mount,el,tag,metadata} from '/shared/client.js';

const T={
 members:'larkfield-health.members.list',grants:'larkfield-health.grants.list',plan:'larkfield-health.plan.get',
 claims:'larkfield-health.claims.list',claim:'larkfield-health.claims.get',pas:'larkfield-health.pa.list',pa:'larkfield-health.pa.get',
 appeals:'larkfield-health.appeals.list',appeal:'larkfield-health.appeals.get',
 expedite:'larkfield-health.pa.request_expedite',statement:'larkfield-health.appeals.add_statement'
};
const FLOW={
 grant:{preview:'larkfield-health.grants.change.preview',confirm:'larkfield-health.grants.change.confirm'},
 cob:{preview:'larkfield-health.coverage.cob.preview',confirm:'larkfield-health.coverage.cob.confirm'},
 info:{preview:'larkfield-health.claims.info.preview',confirm:'larkfield-health.claims.info.confirm'},
 file:{preview:'larkfield-health.appeals.file.preview',confirm:'larkfield-health.appeals.file.confirm'},
 withdraw:{preview:'larkfield-health.appeals.withdraw.preview',confirm:'larkfield-health.appeals.withdraw.confirm'}
};
const ZONE='America/New_York',TEXT_MAX=2000;
const FRIENDLY={
 stale_version:'Larkfield changed since this page last read it, so nothing was changed. Check the refreshed details, then try again.',
 stale_preview:'The details behind this preview changed, so nothing was changed. Preview again.',
 not_authorized:'This account is not allowed to do that for this member, so nothing was changed.',
 not_found:'Larkfield no longer has that record, so nothing was changed.',
 invalid_state:'Larkfield cannot do that for this record in its current state, so nothing was changed. Check the details on the page.',
 info_not_requested:'The plan is no longer waiting for that answer, so nothing was changed.',
 expedite_not_allowed:'Larkfield does not allow an expedited review here, so nothing was changed.',
 duplicate_request:'Larkfield already has the same request open, so nothing new was sent.',
 not_appealable:'This decision cannot be appealed now: it is not a denial, or its appeal was already decided. Nothing was changed.',
 appeal_window_closed:'The time to appeal this decision has ended, so nothing was changed.',
 confirmation_required:'This change still needs its approval.',
 confirmation_invalid:'The approval for this preview has expired, was already used, or was not given by you, so nothing was changed. Approve the same code again outside this page, then press Refresh.',
 permission_denied:'This operation is not allowed for the current account and policy, so nothing was changed.',
 invalid_arguments:'Larkfield did not accept those details, so nothing was changed. Check the form and try again.',
 idempotency_conflict:'Larkfield had already used this request’s identifier for different details, so nothing was changed. Try again.',
 invalid_event:'Larkfield did not accept that update, so nothing was changed.',
 invalid_seed:'Larkfield’s records could not be loaded, so nothing was changed.',
 invalid_time:'Larkfield’s clock does not allow that now, so nothing was changed.',
 invalid_configuration:'Larkfield is not set up for that operation, so nothing was changed.',
 invalid_plugin_result:'Larkfield could not finish that operation, so nothing was changed.',
 unknown_tool:'Larkfield does not offer that operation, so nothing was sent.',
 not_permitted:'Larkfield’s current policy does not allow this operation, so nothing was sent. Press Refresh to see what you can do now.',
 session:'This page’s session is no longer valid, so nothing was sent. Open the access link printed by the Host again.',
 invalid_request:'The Host refused this request before it reached Larkfield, so nothing was sent.'
};
const HOST_REFUSED={'Business operation not permitted':'not_permitted','Invalid business request':'invalid_request','Invalid request token':'session','Access link required':'session','Open the access link printed by the Host':'session','Same-origin JSON required':'session','Origin not allowed':'session','Invalid Host':'session','Not found':'invalid_request','Request too large':'invalid_request'};
const NO_MEMBER='No member with that ID is known to Larkfield, so nothing was done. Check the ID.';
const S={version:null,epoch:null,members:[],grants:[],grantApprovals:[],plans:{},claims:[],pas:[],appeals:[],approvals:new Map(),
 sel:{claims:null,pas:null,appeals:null},member:'',year:null,flows:{},drafts:{},intents:{},pending:{},notes:{},
 unknown:null,error:null,flash:null,flashSection:null,notices:[],applied:null,refreshFailed:false,refreshNetwork:false,refreshText:null,closed:new Set(),justSaved:false,busy:false,stale:false,wrote:false,loaded:false,focus:null};
let loads=0,UI=null;
const KEYS=new Map();
const K=(...parts)=>{const key=parts.map(String).join(':');KEYS.set(key,parts.map(String));return key;};

const nativeFetch=window.fetch.bind(window);
window.fetch=async(url,init)=>{
 const r=await nativeFetch(url,init);
 if(url==='/api/call'&&r&&typeof r.clone==='function'){
  let b=null;try{b=await r.clone().json();}catch(e){b=null;}
  if(b&&b.version)seeEpoch(b.version.epoch);
  if(r.ok&&b&&b.status==='ok'&&b.version&&S.version&&b.version.epoch===S.epoch&&b.version.epoch>=S.version.epoch&&S.loaded&&UI&&!older(b.version))try{if(observe(init,b,b.version.epoch===S.version.epoch))rerender(UI);}catch(e){}
 }
 return r;
};
const cmpVersion=(a,b)=>a.epoch!==b.epoch?a.epoch-b.epoch:a.revision-b.revision;
const older=v=>!!S.applied&&!!v&&cmpVersion(v,S.applied)<0;
const seeApplied=v=>{if(v&&(!S.applied||cmpVersion(v,S.applied)>0))S.applied={epoch:v.epoch,revision:v.revision};};
const READ_NAMES=()=>[T.members,T.grants,T.claims,T.pas,T.appeals,T.claim,T.pa,T.appeal,T.plan];
function observe(init,b,sameRun){
 let req;try{req=JSON.parse(init?.body||'{}');}catch(e){return false;}
 const name=req.name,args=req.arguments||{},plain=!Object.keys(args).length;
 if(!READ_NAMES().includes(name))return false;
 seeApplied(b.version);
 if(name===T.members&&plain&&Array.isArray(b.members))return roster(UI,b.members);
 if(name===T.grants&&plain&&Array.isArray(b.grants)){const gone=shrink(UI,'grants','grant_id',b.grants);if(!sameRun)return gone;const before=S.grantApprovals.length;S.grantApprovals=S.grantApprovals.filter(a=>b.approvals.some(x=>x.token===a.token&&x.confirmed_at===a.confirmed_at));if(gone||before!==S.grantApprovals.length){S.approvals=index();return true;}return false;}
 const lists={[T.claims]:['claims','claim_id'],[T.pas]:['pas','pa_id'],[T.appeals]:['appeals','appeal_id']};
 if(lists[name]&&plain&&Array.isArray(b[lists[name][0]])){const [list,key]=lists[name];return shrink(UI,list,key,b[list])|(sameRun&&freshApprovals(list,key,b[list]));}
 const details={[T.claim]:['claims','claim_id','claim'],[T.pa]:['pas','pa_id','pa'],[T.appeal]:['appeals','appeal_id','appeal']};
 if(details[name]&&b[details[name][2]]){const [list,key,one]=details[name];return sameRun&&freshApprovals(list,key,[b[one]]);}
 if(name===T.plan&&Number.isInteger(args.plan_year)&&b.plan&&Array.isArray(b.members))return planShrink(UI,args.plan_year,b,sameRun);
 return false;
}
const approvalsIn=x=>[...(x.approvals||[]),...(x.info_requests||[]).flatMap(r=>r.approvals||[])];
function freshApprovals(list,key,fresh){
 let changed=false;
 for(const r of fresh){
  const c=S[list].find(x=>x[key]===r[key]);if(!c)continue;
  const now=approvalsIn(r),lost=approvalsIn(c).filter(a=>!now.some(x=>x.token===a.token&&x.confirmed_at===a.confirmed_at));
  c.approvals=r.approvals||[];if(c.info_requests&&r.info_requests)for(const q of c.info_requests){const n=r.info_requests.find(x=>x.info_request_id===q.info_request_id);if(n)q.approvals=n.approvals||[];}
  if(!lost.length)continue;
  changed=true;
  actLost(c.member_id);
 }
 if(changed)S.approvals=index();
 return changed;
}
function note(text,ref,member){if(!S.notices.some(n=>n.text===text&&n.ref===ref))S.notices.push({text,ref,member:member||null});}
function keepError(k){if(S.error?.scope===k)S.error={...S.error,scope:'notice'};}
function seeEpoch(e){
 if(typeof e!=='number')return;
 if(S.epoch==null){S.epoch=e;return;}
 if(e<=S.epoch)return;
 S.epoch=e;
 const keys=[...new Set([...Object.keys(S.flows),...Object.keys(S.drafts),...Object.keys(S.pending)])];
 for(const k of keys){keepError(k);bump(k);}
 S.flows={};S.drafts={};S.pending={};S.notes={};
 if(S.unknown&&S.unknown.request.expected_version.epoch!==e)S.unknown.reset=true;
 S.closed=new Set();
 note(keys.length?'Larkfield was reset or loaded with new data, so the forms and previews you had open were closed. Nothing from them was sent.':'Larkfield was reset or loaded with new data since this page last read it.');
 if(keys.length&&UI)queueMicrotask(()=>rerender(UI));
}

const css=(node,style)=>{Object.assign(node.style,style);return node;};
const points=text=>[...String(text||'')].length;
const money=cents=>cents==null?'—':(cents<0?'−':'')+'$'+(Math.abs(cents)/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const fmt=(iso,options)=>iso?new Intl.DateTimeFormat('en-US',{timeZone:ZONE,...options}).format(new Date(iso)):'—';
const at=iso=>fmt(iso,{weekday:'short',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
const dayOf=iso=>fmt(iso,{month:'short',day:'numeric',year:'numeric'});
const day=d=>d?new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'short',day:'numeric',year:'numeric'}).format(new Date(d+'T00:00:00Z')):'—';
const searchText=()=>(document.querySelector('.toolbar input[type=search]')?.value||'').trim().toLowerCase().slice(0,80);
const transport=e=>e instanceof TypeError&&/fetch|network|load failed/i.test(e.message);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const coded=(code,message)=>Object.assign(Error(message),{code,plainMessage:message});
const hostRefusal=e=>!e.code&&HOST_REFUSED[e.message]?coded(HOST_REFUSED[e.message],FRIENDLY[HOST_REFUSED[e.message]]):null;
const plainError=(code,plain,raw)=>{const v=plain?.[code];return (typeof v==='function'?v(raw||''):v)||FRIENDLY[code]||'Larkfield refused this, so nothing was changed.';};
const GRANT_PLAIN={invalid_state:raw=>/is not after the current time/.test(raw)?'That end is not later than Larkfield’s current time, so nothing was changed. Choose a later end, or untick “Access ends on a date”.':/already gives this access with this expiry/.test(raw)?'This person already has exactly this access with the same end, so nothing was changed.':null};
const labelOf=x=>typeof x==='function'?x():x;
const cap=t=>t?t[0].toUpperCase()+t.slice(1):t;
const unavailable=text=>el('div',{class:'empty','data-unavailable':'true'},el('h3',{},'Not available'),el('p',{},text+' is not allowed by the current policy.'));
const ref=(...ids)=>{const list=[...new Set(ids.filter(Boolean))];return list.length?css(el('small',{'data-ref':list.join(' ')},'Reference '+list.join(' · ')),{fontSize:'11px',color:'var(--muted)',marginTop:'2px'}):null;};

const member=id=>S.members.find(m=>m.member_id===id);
const person=id=>member(id)?.name||'another person';
const Person=id=>cap(person(id));
const firstName=id=>member(id)?.name.split(' ')[0]||'another person';
const powers=id=>member(id)?.powers||[];
const canAct=id=>powers(id).some(p=>['self','guardian','act'].includes(p));
const canGrant=id=>powers(id).some(p=>['self','guardian'].includes(p));
const me=()=>S.members.find(m=>m.powers.includes('self'))?.member_id||null;
const claimOf=id=>S.claims.find(c=>c.claim_id===id);
const paOf=id=>S.pas.find(p=>p.pa_id===id);
const appealOf=id=>S.appeals.find(a=>a.appeal_id===id);
const POWER={self:'you',guardian:'you are a guardian',view:'you can view',act:'you can act'};
const RELATION={self:'Subscriber',spouse:'Spouse',child:'Child',other:'Member'};
const CLAIM_STATUS={received:'In review',pending_info:'Waiting for answers',processed:'Processed'};
const PA_STATUS={pending:'Pending',info_requested:'Plan asked for information',approved:'Approved',denied:'Denied',withdrawn:'Withdrawn',expired:'Ended'};
const APPEAL_STATUS={under_review:'Under review',info_requested:'Plan asked for information',upheld:'Upheld: the denial stands',overturned:'Overturned: the plan reversed its denial',withdrawn:'Withdrawn'};
const REASON={out_of_network:'out of network',prior_auth_missing:'no prior authorization covered it',other_party_liable:'another party is responsible for it',missing_information:'the plan’s questions were not answered in time'};
const COB={unknown:'Not answered yet',none:'No other health coverage',other_secondary:'Other coverage that pays after Larkfield',other_primary:'Other coverage that pays before Larkfield'};
const INFO={not_accident:'Not related to an accident',accident:'An accident, not at work',work_related:'An injury at work'};
const DUE_RULE={claim_60_days:'60 days after filing',pa_30_days:'30 days after filing',pa_72_hours:'72 hours after filing'};
const SCOPE={view:'view',act:'view and act on'};
const OPEN_APPEAL=['under_review','info_requested'];
const claimLabel=c=>c?'the '+c.provider.name+' claim received '+dayOf(c.received_at):'a claim';
const paLabel=p=>p?'the prior authorization for '+p.service.description:'a prior authorization';
const targetText=a=>a.target.type==='claim'?claimLabel(claimOf(a.target.id)):paLabel(paOf(a.target.id));
const targetName=a=>'Appeal on '+targetText(a);
const targetShort=a=>{if(a.target.type==='claim'){const c=claimOf(a.target.id);return c?c.provider.name+' claim':'Claim';}const p=paOf(a.target.id);return p?p.service.description+' authorization':'Prior authorization';};

function index(){
 const m=new Map(),add=list=>{for(const a of list||[])if(approvalAllowed(a.token)){if(!m.has(a.token))m.set(a.token,[]);if(!m.get(a.token).some(x=>x.confirmed_at===a.confirmed_at))m.get(a.token).push(a);}};
 add(S.grantApprovals);for(const c of S.claims){add(c.approvals);for(const r of c.info_requests)add(r.approvals);}
 for(const p of S.pas)add(p.approvals);for(const a of S.appeals)add(a.approvals);for(const p of Object.values(S.plans))if(p)for(const x of p.members)add(x.approvals);
 return m;
}
function approvalOf(token){const list=S.approvals.get(token)||[];return list.find(a=>a.state==='active')||list[list.length-1]||null;}
const TOKEN=/^tok-(grant|revoke|cob|info|file|withdraw)-(pair|grant|coverage|request|claim|pa|appeal)-(.+)-[0-9a-f]{32}$/;
function tokenInfo(token){
 const m=TOKEN.exec(token);if(!m)return null;const [,action,kind,id]=m;
 if(kind==='coverage'){const cut=id.lastIndexOf(':');return {action,kind,id,member:id.slice(0,cut),year:Number(id.slice(cut+1))};}
 if(kind==='request'){const c=S.claims.find(x=>x.info_requests.some(r=>r.info_request_id===id));return {action,kind,id,claim:c?.claim_id};}
 return {action,kind,id};
}
function approvalMember(info){
 if(!info)return null;
 if(info.action==='cob')return info.member;
 if(info.kind==='request')return claimOf(info.claim)?.member_id||null;
 if(info.kind==='claim')return claimOf(info.id)?.member_id||null;
 if(info.kind==='pa')return paOf(info.id)?.member_id||null;
 if(info.kind==='appeal')return appealOf(info.id)?.member_id||null;
 if(info.kind==='pair')return info.id;
 if(info.kind==='grant')return S.grants.find(g=>g.grant_id===info.id)?.member_id||null;
 return null;
}
function approvalAllowed(token){const info=tokenInfo(token),id=approvalMember(info);if(!id)return false;return ['grant','revoke'].includes(info.action)?canGrant(id):canAct(id);}
function tokenText(info){
 if(!info)return 'an approved request';
 if(info.action==='cob')return 'answer the other-coverage question for '+person(info.member)+', '+info.year;
 if(info.action==='info')return 'answer an accident question on '+claimLabel(claimOf(info.claim));
 if(info.action==='file')return 'file an appeal on '+(info.kind==='claim'?claimLabel(claimOf(info.id)):paLabel(paOf(info.id)));
 if(info.action==='withdraw'){const a=appealOf(info.id);return 'withdraw '+(a?'the appeal on '+targetText(a):'an appeal');}
 if(info.action==='revoke')return 'remove an access grant';
 return info.kind==='pair'?'give someone access to '+person(info.id)+'’s records':'change an access grant';
}
function latestKnown(){
 let t=0;const see=iso=>{if(iso){const v=Date.parse(iso);if(v>t)t=v;}};
 for(const c of S.claims){see(c.received_at);for(const e of c.eobs)see(e.issued_at);for(const r of c.info_requests){see(r.answered_at);if(r.status!=='open')see(r.opened_at);}}
 for(const p of S.pas){see(p.submitted_at);see(p.decided_at);see(p.expired_at);if(p.expedite)see(p.expedite.decided_at||p.expedite.requested_at);for(const r of p.info_requests)see(r.at);}
 for(const a of S.appeals){see(a.filed_at);see(a.decided_at);see(a.withdrawn_at);for(const s of a.statements)see(s.at);}
 for(const g of S.grants){see(g.created_at);see(g.revoked_at);}
 for(const list of S.approvals.values())for(const a of list)see(a.confirmed_at);
 return t;
}
const currentEob=c=>c.eobs.reduce((a,e)=>!a||e.version>a.version?e:a,null);
const deniedLines=c=>(currentEob(c)?.lines||[]).filter(l=>l.status==='denied');
const openRequests=c=>c.info_requests.filter(r=>r.status==='open');
function openCob(owner,year){return S.claims.filter(c=>c.member_id===owner).flatMap(c=>c.info_requests.filter(r=>r.type==='other_coverage'&&r.status==='open'&&r.plan_year===year).map(r=>({claim:c,request:r})));}
function appealState(type,id){
 const list=S.appeals.filter(a=>a.target.type===type&&a.target.id===id);
 return {open:list.find(a=>OPEN_APPEAL.includes(a.status)),decided:list.find(a=>['upheld','overturned'].includes(a.status)),all:list};
}
const windowClosed=(type,id,w)=>!w||S.closed.has(type+':'+id)||Date.parse(w.ends_at)<=latestKnown();
function fileable(type,rec){
 const id=type==='claim'?rec.claim_id:rec.pa_id,s=appealState(type,id);
 if(s.open||s.decided||windowClosed(type,id,rec.appeal_window))return false;
 return type==='claim'?rec.status==='processed'&&deniedLines(rec).length>0:rec.status==='denied';
}
function offered(ui,key){
 const [kind,a,b]=KEYS.get(key)||[];
 if(kind==='info'){const c=S.claims.find(x=>x.info_requests.some(r=>r.info_request_id===a));return !!c&&canAct(c.member_id)&&c.info_requests.some(r=>r.info_request_id===a&&r.type==='accident'&&r.status==='open')&&ui.has(FLOW.info.preview);}
 if(kind==='cob')return canAct(a)&&openCob(a,Number(b)).length>0&&ui.has(FLOW.cob.preview);
 if(kind==='file'){const rec=a==='claim'?claimOf(b):paOf(b);return !!rec&&canAct(rec.member_id)&&fileable(a,rec)&&ui.has(FLOW.file.preview);}
 if(kind==='withdraw'||kind==='statement'){const x=appealOf(a);return !!x&&canAct(x.member_id)&&OPEN_APPEAL.includes(x.status)&&ui.has(kind==='withdraw'?FLOW.withdraw.preview:T.statement);}
 if(kind==='expedite'){const p=paOf(a);return !!p&&canAct(p.member_id)&&['pending','info_requested'].includes(p.status)&&!p.expedite&&ui.has(T.expedite);}
 if(kind==='give')return ui.has(FLOW.grant.preview)&&S.members.some(m=>canGrant(m.member_id));
 if(kind==='grant'||kind==='revoke'){
  if(!ui.has(FLOW.grant.preview))return false;
  const g=S.grants.find(x=>x.grant_id===a);return !!g&&g.state==='active'&&canGrant(g.member_id);
 }
 return false;
}
const targetAllowed=t=>t.need==='grant'?canGrant(t.member):canAct(t.member);
function guardError(){
 if(S.error?.target&&!targetAllowed(S.error.target))S.error={...S.error,target:null,message:'Larkfield answered an earlier request about records this account can no longer see or change. Nothing more can be done about it from this page.'};
}
function guardUnknown(){
 guardError();
 const u=S.unknown;if(!u||u.hidden||!u.target)return;
 const ok=u.target.need==='grant'?canGrant(u.target.member):canAct(u.target.member);
 if(!ok){u.hidden=true;if(S.error?.scope==='unknown')S.error=null;}
}

function intent(key){return S.intents[key]||0;}
function bump(key){S.intents[key]=intent(key)+1;return S.intents[key];}
function rerender(ui){
 const a=document.activeElement,key=a?.dataset?.focus,start=a?.selectionStart,end=a?.selectionEnd;
 return ui.navigate(ui.section).then(()=>{
  if(S.focus){const target=document.querySelector(S.focus);S.focus=null;if(target){target.focus();return;}}
  if(!key)return;const n=document.querySelector('[data-focus="'+key+'"]');if(!n)return;n.focus();try{if(start!=null)n.setSelectionRange(start,end);}catch(e){}
 }).catch(ui.error);
}
function edit(ui,key,owner,changes){
 S.drafts[key]={...(S.drafts[key]||{}),member:owner,...changes};bump(key);
 const had=S.flows[key]||S.pending[key]||S.error?.scope===key||S.notes[key];
 delete S.flows[key];delete S.pending[key];delete S.notes[key];if(S.error?.scope===key)S.error=null;
 if(had)rerender(ui);
}
function drop(ui,key){
 const trigger=S.flows[key]?.trigger;
 delete S.flows[key];delete S.pending[key];delete S.notes[key];bump(key);if(S.error?.scope===key)S.error=null;
 if(trigger)S.focus=trigger;rerender(ui);
}
function discard(key,keep){if(keep)keepError(key);else if(S.error?.scope===key)S.error=null;delete S.flows[key];delete S.drafts[key];delete S.pending[key];delete S.notes[key];bump(key);}
function keysOf(test){return [...new Set([...Object.keys(S.flows),...Object.keys(S.drafts),...Object.keys(S.pending)])].filter(k=>test(k,S.flows[k]||S.drafts[k]||S.pending[k]));}
function lose(ui,id){
 const m=member(id),years=m?.enrolled_years||Object.keys(S.plans).map(Number);
 for(const [s,list,k] of [['claims',S.claims,'claim_id'],['pas',S.pas,'pa_id'],['appeals',S.appeals,'appeal_id']])if(S.sel[s]&&list.some(x=>x[k]===S.sel[s]&&x.member_id===id))S.sel[s]=null;
 const ids=new Set([id,...S.claims.filter(c=>c.member_id===id).map(c=>c.claim_id),...S.pas.filter(p=>p.member_id===id).map(p=>p.pa_id),...S.appeals.filter(a=>a.member_id===id).map(a=>a.appeal_id)]);
 for(const k of keysOf((k,x)=>x.member===id||ids.has(x.record)))discard(k,false);
 S.members=S.members.filter(x=>x.member_id!==id);
 S.claims=S.claims.filter(c=>c.member_id!==id);S.pas=S.pas.filter(p=>p.member_id!==id);S.appeals=S.appeals.filter(a=>a.member_id!==id);
 const lostGrants=new Set(S.grants.filter(g=>g.member_id===id).map(g=>g.grant_id));
 S.grants=S.grants.filter(g=>g.member_id!==id);
 S.grantApprovals=S.grantApprovals.filter(a=>{const i=tokenInfo(a.token);return !i||!(i.kind==='pair'?i.id===id:lostGrants.has(i.id));});
 for(const [y,p] of Object.entries(S.plans)){p.members=p.members.filter(x=>x.member_id!==id);if(years.includes(Number(y)))p.family=null;}
 if(S.member===id)S.member='';
 S.approvals=index();
 S.flash=null;if(S.error?.target?.member===id)S.error=null;
 guardUnknown();
 S.notices=S.notices.filter(n=>n.member!==id);
 note('Access to some of the records this page showed has ended, so the page removed them. They stay hidden until Larkfield shows them to you again.');
}
function redact(id){
 for(const c of S.claims)if(c.member_id===id){c.approvals=[];for(const r of c.info_requests)r.approvals=[];}
 for(const x of [...S.pas,...S.appeals])if(x.member_id===id)x.approvals=[];
 for(const p of Object.values(S.plans))if(p)for(const m of p.members)if(m.member_id===id)m.approvals=[];
 S.approvals=index();
}
function restrict(ui,id){
 const closed=keysOf((k,x)=>(x.member===id||KEYS.get(k)?.includes(id))&&!offered(ui,k));
 for(const k of closed)discard(k,false);
 if(!canAct(id))redact(id);else S.approvals=index();
 guardUnknown();
 guardError();
 if(closed.length||S.unknown?.hidden){S.flash=null;note('Your access to '+person(id)+'’s records changed, so the forms and previews you can no longer use were closed.',null,id);}
}
function roster(ui,list){
 let changed=false;
 for(const m of [...S.members]){
  const n=list.find(x=>x.member_id===m.member_id);
  if(!n){lose(ui,m.member_id);changed=true;continue;}
  const kept=m.powers.filter(p=>n.powers.includes(p));
  if(kept.length!==m.powers.length){m.powers=kept;restrict(ui,m.member_id);changed=true;}
 }
 return changed;
}
function shrink(ui,list,key,fresh){
 const keep=new Set(fresh.map(x=>x[key])),gone=S[list].filter(x=>!keep.has(x[key]));if(!gone.length)return false;
 const ids=new Set(gone.map(x=>x[key])),owners=[...new Set(gone.map(x=>x.member_id))],owner=owners.length===1?owners[0]:null;
 const openOwner=id=>gone.find(x=>x[key]===id)?.member_id||null;
 S[list]=S[list].filter(x=>keep.has(x[key]));
 let open=null;
 for(const s of ['claims','pas','appeals'])if(ids.has(S.sel[s])){if(s===list)open=S.sel[s];S.sel[s]=null;}
 for(const k of keysOf((k,x)=>ids.has(x.record)||(KEYS.get(k)||[]).some(p=>ids.has(p))))discard(k,false);
 S.approvals=index();
 guardError();
 if(open)note('A '+(list==='claims'?'claim':list==='pas'?'prior authorization':'appeal')+' you had open is no longer in Larkfield or no longer visible to this account, so the page removed it.',open,openOwner(open));
 else if(list!=='grants')note('Some records this page showed are no longer visible to this account, so the page removed them.',null,owner);
 return true;
}
function planShrink(ui,y,r,sameRun=true){
 let changed=false;
 for(const m of [...S.members])if(!m.powers.includes('self')&&m.enrolled_years.includes(Number(y))&&!r.members.some(x=>x.member_id===m.member_id)){lose(ui,m.member_id);changed=true;}
 const old=S.plans[y];
 if(old){
  const kept=old.members.filter(x=>r.members.some(n=>n.member_id===x.member_id));
  if(kept.length!==old.members.length){old.members=kept;changed=true;}
  if(old.family&&!r.family){old.family=null;changed=true;}
  if(sameRun)for(const row of old.members){
   const n=r.members.find(x=>x.member_id===row.member_id);if(!n)continue;
   const lost=(row.approvals||[]).filter(a=>!(n.approvals||[]).some(x=>x.token===a.token&&x.confirmed_at===a.confirmed_at));
   row.approvals=n.approvals||[];
   if(!lost.length)continue;
   changed=true;actLost(row.member_id);
  }
  if(changed)S.approvals=index();
 }
 return changed;
}
function actLost(id){const m=member(id);if(m&&m.powers.includes('act')&&!m.powers.some(p=>p==='self'||p==='guardian')){m.powers=m.powers.filter(p=>p!=='act');restrict(UI,id);}}
function forget(ui,section,id){
 const list={claims:'claims',pas:'pas',appeals:'appeals'}[section],key={claims:'claim_id',pas:'pa_id',appeals:'appeal_id'}[section];
 const owner=S[list].find(x=>x[key]===id)?.member_id||null;
 S[list]=S[list].filter(x=>x[key]!==id);if(S.sel[section]===id)S.sel[section]=null;
 for(const k of keysOf((k,x)=>x.record===id||KEYS.get(k)?.includes(id)))discard(k,false);
 S.approvals=index();
 note('A '+(section==='claims'?'claim':section==='pas'?'prior authorization':'appeal')+' you had open is no longer in Larkfield, so the page removed it.',id,owner);
}
function prune(ui){
 for(const k of keysOf(()=>true)){
  const f=S.flows[k],d=S.drafts[k];
  let gone=!offered(ui,k)||(f&&f.epoch!==S.epoch);
  if(!gone&&d&&d.grantVersion!=null){const g=S.grants.find(x=>x.grant_id===d.record);if(!g||g.grant_version!==d.grantVersion){gone=true;note('An access grant you were changing was changed meanwhile, so the form was closed. Open it again to see its current details.');}}
  if(gone)discard(k,true);
 }
}

const SUPERSEDED=Error('superseded');
async function load(ui){
 UI=ui;const seq=++loads,section=ui.section;
 for(let attempt=0;attempt<3;attempt++){
  let v=null,mixed=false;
  const read=async(name,args={},fallback=null)=>{
   if(!ui.has(name))return fallback;
   const r=await ui.call(name,args);
   if(seq!==loads)throw SUPERSEDED;
   if(!v)v=r.version;else if(v.epoch!==r.version.epoch||v.revision!==r.version.revision)mixed=true;
   return r;
  };
  const N={};let years=[];
  try{
  N.members=(await read(T.members,{},{members:[]})).members;
  if(!S.loaded&&roster(ui,N.members))await rerender(ui);
  const g=await read(T.grants,{},null);N.grants=g?g.grants:[];N.grantApprovals=g?g.approvals:[];
  const lists=[[T.claims,'claims','claim_id'],[T.pas,'pas','pa_id'],[T.appeals,'appeals','appeal_id']];
  for(const [name,list,key] of lists){const r=await read(name,{},null);N[list]=r?r[list]:[];}
  const detail={claims:[T.claim,'claim_id','claim','claims'],pas:[T.pa,'pa_id','pa','pas'],appeals:[T.appeal,'appeal_id','appeal','appeals']}[section];
  const chosen=detail&&S.sel[section];
  if(chosen&&ui.has(detail[0])){
   try{const r=await read(detail[0],{[detail[1]]:chosen});const list=N[detail[3]],i=list.findIndex(x=>x[detail[1]]===chosen);if(i>=0)list[i]=r[detail[2]];else list.push(r[detail[2]]);}
   catch(e){
    if(e===SUPERSEDED||seq!==loads)throw SUPERSEDED;
    if(e.code==='not_authorized'){const owner=S[detail[3]].find(x=>x[detail[1]]===chosen)?.member_id;if(owner)lose(ui,owner);else forget(ui,section,chosen);mixed=true;await rerender(ui);}
    else if(e.code==='not_found'){forget(ui,section,chosen);N[detail[3]]=N[detail[3]].filter(x=>x[detail[1]]!==chosen);mixed=true;await rerender(ui);}
    else throw e;
   }
  }
  years=[...new Set(N.members.flatMap(m=>m.enrolled_years))].sort();N.plans={};
  if(ui.has(T.plan))for(const y of years){
   let r;try{r=await read(T.plan,{plan_year:y});}catch(e){if(e===SUPERSEDED||e.code!=='not_found')throw e;continue;}
   N.plans[y]=r;
  }
  }catch(e){if(e===SUPERSEDED)return {};throw e;}
  if(seq!==loads)return {};
  if(mixed||older(v))continue;
  for(const m of S.members)if(!N.members.some(x=>x.member_id===m.member_id)){S.notices=S.notices.filter(n=>n.member!==m.member_id);for(const k of keysOf((k,x)=>x.member===m.member_id))discard(k,false);}
  Object.assign(S,N);S.version=v||S.version;seeApplied(v);S.stale=false;S.loaded=true;
  if(['refresh_needed','reset_seen','unanswered'].includes(S.error?.code))S.error=null;
  S.approvals=index();
  prune(ui);
  guardUnknown();
  if(!S.year||!S.plans[S.year]){const y=planYearNow();S.year=S.plans[y]?y:years[years.length-1]||null;}
  if(S.member&&!member(S.member))S.member='';
  for(const s of ['claims','pas','appeals'])if(S.sel[s]&&!records(s).some(x=>idOf(s,x)===S.sel[s]))S.sel[s]=null;
  return {};
 }
 throw coded('inconsistent','Larkfield kept changing while the page read it. Press Refresh to see one consistent view.');
}
function planYearNow(){const known=latestKnown();return known?Number(fmt(new Date(known).toISOString(),{year:'numeric'})):null;}
function records(section){return section==='claims'?S.claims:section==='pas'?S.pas:S.appeals;}
function idOf(section,x){return section==='claims'?x.claim_id:section==='pas'?x.pa_id:x.appeal_id;}

async function commit(ui,name,args,label,done,version,target,plain){
 const request={expected_version:version||S.version,request_id:'web-'+crypto.randomUUID()};let r;
 try{r=await ui.call(name,{...args,...request});}
 catch(e){
  if(e.code){if(plain)e.plain=plain;throw e;}
  const refused=hostRefusal(e);if(refused)throw refused;
  S.unknown={name,args,request,label,done,target,plain,hidden:false,reset:false,reason:transport(e)?'the connection dropped':e.message};throw e;
 }
 if(!r.version||r.version.epoch!==request.expected_version.epoch){
  S.unknown={name,args,request,label,done,target,plain,hidden:false,reset:true,reason:'Larkfield answered from a different run'};
  throw coded('unconfirmed','Larkfield answered from a different run than the one this change was made for, so whether it took effect cannot be confirmed. Check the records before trying again.');
 }
 S.wrote=true;done(r);return r;
}
async function retryUnknown(ui){
 const u=S.unknown;
 try{await resend(ui,u);}catch(e){if(u.target)e.target=u.target;throw e;}
}
async function resend(ui,u){
 let r;
 const what=()=>u.hidden?' about records this account can no longer see or change':' to '+labelOf(u.label);
 const first=await ui.call(T.members,{}),now=first.version;
 if(roster(ui,first.members))await rerender(ui);
 if(u.reset||now.epoch!==u.request.expected_version.epoch){S.unknown=null;throw coded('unconfirmed','Larkfield was reset or reloaded after the earlier request'+what()+', so whether it took effect cannot be confirmed, and it was not sent again. Check the records before trying again.');}
 try{r=await ui.call(u.name,{...u.args,...u.request});}
 catch(e){
  if(!e.code){const refused=hostRefusal(e);if(refused)throw refused;throw e;}
  if(e.code==='permission_denied')throw e;
  const second=await ui.call(T.members,{}).catch(()=>null);
  if(!second)throw coded('unconfirmed_pending','Larkfield answered, but the page could not read its current state to tell whether the earlier request took effect. Retry again.');
  if(roster(ui,second.members))await rerender(ui);
  S.unknown=null;
  const sameEpoch=second.version.epoch===u.request.expected_version.epoch;
  if(sameEpoch&&u.name===T.statement){const d=S.drafts[K('statement',u.args.appeal_id)];if(d){delete d.uncertain;delete d.sentText;delete d.matches;delete d.sentAfter;}}
  throw coded(sameEpoch?'not_applied':'unconfirmed',sameEpoch?'Larkfield did not apply the earlier request'+what()+(u.hidden?'':': '+plainError(e.code,u.plain,e.message).replace(/[.]$/,''))+'. Start it again if you still want it.':'Larkfield was reset or reloaded after the earlier request'+what()+', so whether it took effect cannot be confirmed. Check the records before trying again.');
 }
 if(!r.version||r.version.epoch!==u.request.expected_version.epoch||r.version.epoch!==S.epoch){S.unknown=null;throw coded('unconfirmed','Larkfield answered the earlier request'+what()+' from a different run than the one it was made for, so whether it took effect cannot be confirmed. Check the records before trying again.');}
 S.unknown=null;S.wrote=true;
 if(u.hidden)S.flash='Larkfield confirmed an earlier request about records this account can no longer see or change.';
 else u.done(r);
}
const said=(r,text,label)=>r.duplicate?'Your earlier request to '+labelOf(label)+' had already gone through; it was not applied twice.':text;
function lock(){
 for(const b of document.querySelectorAll('#records button,.detail button'))b.disabled=true;
 const status=document.getElementById('status');if(status){status.textContent='Working…';delete status.dataset.error;}
}
function errorFor(scope,e,plain){
 const r=hostRefusal(e)||e;
 if(r.code)return {scope,code:r.code,message:r.plainMessage||plainError(r.code,plain||r.plain,r.message),target:e.target||null};
 if(transport(e))return {scope,code:'connection_lost',message:'The connection dropped before Larkfield answered.'};
 return {scope,code:'request_failed',message:'Larkfield did not answer as expected ('+e.message+').'};
}
const resetSeen=()=>!!S.version&&S.epoch!==S.version.epoch;
const RESET_SEEN='Larkfield was reset or loaded with new data since this page last read it, so nothing was sent. Press Refresh first.';
async function act(ui,scope,run,resolving=false){
 if(S.busy)return;
 if(S.stale&&!resolving){S.flash=null;S.error={scope,code:'refresh_needed',message:'The page could not load Larkfield’s latest state after the last change. Press Refresh before changing anything else.'};rerender(ui).then(showOutcome);return;}
 if(S.unknown&&!resolving){S.flash=null;S.error={scope,code:'unanswered',target:S.unknown.target||null,message:'Larkfield has not answered '+(S.unknown.hidden?'an earlier request':'the earlier request to '+labelOf(S.unknown.label))+'. Retry or dismiss it first.'};rerender(ui).then(showOutcome);return;}
 if(resetSeen()&&!resolving){S.flash=null;S.error={scope,code:'reset_seen',message:RESET_SEEN};rerender(ui).then(showOutcome);return;}
 const origin=ui.section,before=S.unknown;S.wrote=false;S.busy=true;S.error=null;S.flash=null;lock();
 try{await run();}
 catch(e){S.error=errorFor(e.scope||scope,e,e.plain);if(S.unknown&&S.unknown!==before)S.error.message='Larkfield did not confirm this request; see “Waiting for Larkfield”.';}
 finally{S.busy=false;S.flashSection=origin;}
 const wrote=S.wrote,status=document.getElementById('status');
 if(status){status.textContent=wrote?'Saved. Loading the latest state…':'Checking Larkfield…';delete status.dataset.error;}
 await rerender(ui);
 S.justSaved=wrote;
 try{await ui.refresh();}
 catch(e){if(wrote){S.stale=true;await rerender(ui);ui.error(Error('Your change was saved, but the page could not load Larkfield’s latest state. Press Refresh.'));}else ui.error(e);}
 finally{S.justSaved=false;}
 showOutcome();
}
const NEUTRAL=['All changes saved','Up to date','Saved'];
const CANNOT='Whether your last change took effect cannot be confirmed. See the message on the page.',NOTHING='Nothing was changed. See the message on the page.';
const UNREACH='The page could not reach Larkfield. Press Refresh to try again.',UNREACH_PENDING='The page could not reach Larkfield. Whether your last change took effect cannot be confirmed; see the message on the page.';
function failedStatus(){return outcome()===CANNOT?(S.refreshNetwork?UNREACH_PENDING:CANNOT):(S.refreshNetwork?UNREACH:S.refreshText);}
function showOutcome(){
 const st=document.getElementById('status');if(!st)return;const text=outcome(),now=st.textContent;
 if(S.refreshFailed&&[UNREACH,UNREACH_PENDING,CANNOT,NOTHING,S.refreshText].includes(now)){st.textContent=failedStatus();st.dataset.error='true';return;}
 if(text){if(NEUTRAL.includes(now)||[CANNOT,NOTHING].includes(now)){st.textContent=text;st.dataset.error='true';st.dataset.settled='true';}}
 else if([CANNOT,NOTHING].includes(now)){st.textContent='Up to date';delete st.dataset.error;st.dataset.settled='true';}
}

async function preview(ui,key,kind,owner,record,args,trigger,plain){
 if(!ui.has(FLOW[kind].preview)||S.busy)return;
 if(resetSeen()){S.flash=null;S.error={scope:key,code:'reset_seen',message:RESET_SEEN};rerender(ui).then(showOutcome);return;}
 const mine=bump(key),epoch=S.epoch;S.pending[key]={member:owner,record};delete S.flows[key];delete S.notes[key];if(S.error?.scope===key)S.error=null;S.flash=null;
 rerender(ui);
 let r;
 try{r=await ui.call(FLOW[kind].preview,args);}
 catch(e){
  if(intent(key)!==mine)return;delete S.pending[key];
  if(e.code==='not_authorized'){lose(ui,owner);S.error=errorFor('notice',e);}
  else if(e.code==='not_found'&&kind==='grant'&&args.action==='grant'&&!member(args.grantee_id))S.error={scope:key,code:'not_found',message:NO_MEMBER};
  else if(e.code==='appeal_window_closed'&&kind==='file'){S.closed.add(args.target_type+':'+args.target_id);discard(key,false);S.error=null;}
  else if(!e.code&&!hostRefusal(e))S.error={scope:key,code:'read_failed',message:'Larkfield did not answer this preview ('+(transport(e)?'the connection dropped':e.message)+'). Nothing was changed; preview again.'};
  else S.error=errorFor(key,e,plain);
  return rerender(ui).then(showOutcome);
 }
 if(intent(key)!==mine)return;
 delete S.pending[key];
 if(r.version.epoch!==epoch||r.version.epoch!==S.epoch||resetSeen()){S.error={scope:key,code:'reset',message:'Larkfield was reset or loaded with new data while this preview was being prepared, so it was not kept. Press Refresh, then preview again.'};return rerender(ui).then(showOutcome);}
 S.flows[key]={key,kind,member:owner,record,section:SELECTABLE.includes(ui.section)?ui.section:null,args,trigger,token:r.preview.token,confirmer:r.preview.required_confirmer,changes:r.preview.changes,epoch:r.version.epoch,version:r.version};
 S.approvals=index();S.focus='[data-flow="'+key+'"] h3';
 rerender(ui).then(showOutcome);
}
const SELECTABLE=['claims','pas','appeals'];
const RESET_FLOW='Larkfield was reset or loaded with new data after this preview, so it no longer applies and nothing was sent. Preview the change again.';
function confirm(ui,key,label,done,target,plain){
 const f=S.flows[key];if(!f)return;
 act(ui,key,async()=>{
  delete S.notes[key];
  if(f.epoch!==S.epoch){discard(key,false);throw coded('reset',RESET_FLOW);}
  if(f.section&&f.record&&S.sel[f.section]!==f.record){delete S.flows[key];bump(key);throw coded('details_changed','The record this preview was made for is no longer the one shown, so nothing was sent. Preview again.');}
  const ticket=intent(key);
  let r;
  try{r=await ui.call(FLOW[f.kind].preview,f.args);}
  catch(e){
   if(e.code==='not_authorized'){lose(ui,f.member);e.scope='notice';throw e;}
   if(e.code==='appeal_window_closed'&&f.kind==='file'){S.closed.add(f.args.target_type+':'+f.args.target_id);discard(key,false);e.scope='notice';throw e;}
   if(e.code&&S.flows[key]===f){delete S.flows[key];bump(key);}
   if(e.code)e.plain=plain;
   if(!e.code&&!hostRefusal(e))throw coded('read_failed','Larkfield did not answer while it was checking this change ('+(transport(e)?'the connection dropped':e.message)+'), so nothing was sent. Press Confirm again.');
   throw e;
  }
  if(r.version.epoch!==f.epoch||r.version.epoch!==S.epoch){if(S.flows[key]===f){delete S.flows[key];bump(key);}throw coded('reset',RESET_FLOW);}
  if(intent(key)!==ticket||S.flows[key]!==f||(f.section&&f.record&&S.sel[f.section]!==f.record))throw coded('details_changed','The details changed while Larkfield was checking them, so nothing was sent.');
  if(f.kind==='info'&&(r.preview.changes.info_request_id!==KEYS.get(key)?.[1]||r.preview.changes.claim_id!==f.args.claim_id||r.preview.changes.line_id!==f.args.line_id)){discard(key,false);throw coded('details_changed','This preview no longer matches the question it was made for, so nothing was sent. Preview again.');}
  if(r.preview.token!==f.token||!same(r.preview.changes,f.changes)){S.flows[key]={...f,token:r.preview.token,changes:r.preview.changes,version:r.version};S.notes[key]={text:'What this will do has changed since your preview. Check the details below and press Confirm again; nothing was sent.'};return;}
  try{await commit(ui,FLOW[f.kind].confirm,{...f.args,token:f.token},label,res=>{delete S.flows[key];delete S.drafts[key];delete S.notes[key];bump(key);done(res);},r.version,target,plain);}
  catch(e){
   if(e.code==='confirmation_required'){S.notes[key]={waiting:true,text:'Larkfield has no approval for this request yet, so nothing changed. It stays here waiting for your approval; press Refresh once it has been approved.'};return;}
   if(e.code==='not_authorized'){lose(ui,f.member);e.scope='notice';throw e;}
   if(e.code==='appeal_window_closed'&&f.kind==='file'){S.closed.add(f.args.target_type+':'+f.args.target_id);discard(key,false);e.scope='notice';throw e;}
   if(e.code&&!['confirmation_invalid','stale_version'].includes(e.code)&&S.flows[key]===f){delete S.flows[key];bump(key);}
   throw e;
  }
 });
}

const ALERT={background:'#fff4f1',padding:'8px 10px',borderRadius:'8px',marginTop:'12px'};
const NOTE={background:'var(--soft)',padding:'10px 12px',borderRadius:'8px'};
function local(code){return css(el('p',{role:'alert',class:'form-error','data-code':code}),ALERT);}
function alertFor(scope){return S.error?.scope===scope?css(el('p',{role:'alert',class:'form-error','data-code':S.error.code},S.error.message),ALERT):null;}
const muted=(text,attrs={})=>css(el('p',attrs,text),{color:'var(--muted)',fontSize:'12px',margin:'6px 0'});
function button(label,onclick,attrs={}){return el('button',{type:'button',disabled:S.busy?'':false,...attrs,onclick},label);}
function row(attrs,onclick,title,...lines){return el(onclick?'button':'div',{...(onclick?{type:'button',onclick,disabled:S.busy?'':false}:{}),class:'record',...attrs},el('span',{class:'record-title'},title),...lines.filter(Boolean).map(l=>l instanceof Node?l:el('span',{class:'record-subtitle'},l)));}
function panel(label,attrs,...children){return css(el('section',{class:'query-result','aria-label':label,...attrs},el('h3',{tabindex:'-1'},label),...children.flat().filter(Boolean)),{margin:'18px 0 0'});}
function heading(text){return css(el('h3',{},text),{margin:'24px 0 6px',fontSize:'14px'});}
function kicker(text){return css(el('h3',{class:'kicker'},text),{padding:'12px 22px 0',margin:'0',fontWeight:'500'});}
function choiceLabel(input,...text){css(input,{width:'18px',height:'18px',flex:'0 0 18px',margin:'2px 0 0',padding:'0'});return css(el('label',{'data-choice':'true'},input,el('span',{},...text)),{display:'flex',gap:'8px',alignItems:'center',padding:'4px 0'});}
function radios(key,owner,record,field,legend,options,value,ui){
 const set=css(el('fieldset',{'data-group':field}),{gap:'0',margin:'4px 0'});
 set.append(css(el('legend',{},legend),{display:'block',fontWeight:'600',fontSize:'13px',padding:'0',marginBottom:'2px'}));
 for(const [v,label] of Object.entries(options)){
  const input=el('input',{type:'radio',name:key+'-'+field,value:v,'data-field':field,'data-value':v,'data-focus':key+'-'+field+'-'+v});
  input.checked=value===v;input.addEventListener('change',()=>{if(input.checked)edit(ui,key,owner,{record,[field]:v});});
  set.append(choiceLabel(input,label));
 }
 return set;
}
function textField(ui,key,owner,record,field,label,value,hint){
 const count=el('small',{'data-counter':field}),area=el('textarea',{rows:'4','aria-label':label,'data-field':field,'data-focus':key+'-'+field,maxlength:'4000'});
 area.value=value||'';
 const show=()=>{count.textContent=points(area.value)+' / '+TEXT_MAX+' characters';count.dataset.over=String(points(area.value)>TEXT_MAX);};show();
 area.addEventListener('input',()=>{show();edit(ui,key,owner,{record,[field]:area.value});});
 return el('label',{class:'field'},el('span',{},label),area,hint?el('small',{},hint):null,count);
}
function textProblem(text,required){const t=String(text||'').trim();if(required&&!t)return 'Write a statement first.';if(points(t)>TEXT_MAX)return 'Texts are limited to '+TEXT_MAX+' characters.';return null;}
function previewButton(ui,key,label,build,kind,owner,record,plain){
 const check=local('invalid_input');
 const pending=!!S.pending[key],trigger='[data-action=preview][data-key="'+key+'"]';
 const b=button(pending?'Preparing preview…':label,()=>{const built=build();check.textContent=built.error||'';if(built.error)return;preview(ui,key,kind,owner,record,built.args,trigger,plain);},{class:'primary','data-action':'preview','data-key':key,disabled:pending||S.busy?'':false});
 return [check,el('div',{class:'form-actions'},b)];
}

function flowPanel(ui,key,title,summary,label,done,target,plain){
 const f=S.flows[key];if(!f)return null;
 const a=approvalOf(f.token),state=a?a.state:'waiting',name=FLOW[f.kind].confirm,self=f.confirmer===me();
 const status=state==='active'?css(el('p',{'data-approval':'active'},'Approved '+at(a.confirmed_at)+'. It can be used until '+at(a.expires_at)+'.'),{color:'var(--accent)',fontWeight:'600'})
  :state==='expired'?el('p',{'data-approval':'expired',class:'form-error'},'The approval given '+at(a.confirmed_at)+' expired at '+at(a.expires_at)+'. Approve the same code again outside this page, then press Refresh.')
  :state==='used'?el('p',{'data-approval':'used',class:'form-error'},'This approval was already used. Preview again for a current code.')
  :el('p',{'data-approval':'waiting'},(self?'Waiting for your approval':'Waiting for '+person(f.confirmer)+' to approve it')+'. Approval happens outside this page; when it is done, press Refresh, then Confirm.');
 const note=S.notes[key],showNote=note&&!(note.waiting&&a);
 const old=f.epoch!==S.epoch;
 return panel(title,{'data-flow':key,'data-state':state},summary(f),
  metadata('Approval needed from',self?'You ('+person(f.confirmer)+')':Person(f.confirmer)),
  muted('An approval can be used once, for 30 minutes after it is given. Nothing changes until you press Confirm.'),
  muted('In this local preview no code is sent to anyone: the approval is given as described in the Larkfield GUI README.',{'data-local-preview':'true'}),
  muted('After a reload this preview is gone: preview the same change again. It gets the same approval code, so an approval already given still applies.',{'data-reload-help':'true'}),
  showNote?css(el('p',{role:'status','data-note':note.waiting?'waiting':'changed'},note.text),{...NOTE,fontWeight:'600',marginTop:'8px'}):null,
  status,alertFor(key),
  css(el('p',{},'Approval code ',css(el('span',{'data-token':f.token},f.token),{fontFamily:'ui-monospace,monospace'})),{fontSize:'11px',color:'var(--muted)',overflowWrap:'anywhere',margin:'8px 0 0'}),
  el('div',{class:'form-actions'},button('Cancel',()=>drop(ui,key),{'data-action':'cancel-flow','data-key':key}),
   old?muted('This preview belongs to Larkfield before it was reset or loaded with new data, so it cannot be confirmed. Cancel it and preview again.'):ui.has(name)?button('Confirm',()=>confirm(ui,key,label,done,target,plain),{class:'primary','data-action':'confirm','data-key':key}):muted('Confirming is not allowed by the current policy.')));
}
function orphans(list){
 const tracked=new Set(Object.values(S.flows).map(f=>f.token));
 const seen=new Set(),out=[];
 for(const a of list||[])if(a.state==='active'&&approvalAllowed(a.token)&&!tracked.has(a.token)&&!seen.has(a.token)){seen.add(a.token);out.push(a);}
 return out;
}
function orphanNote(list){
 const items=orphans(list);if(!items.length)return null;
 return panel('An approval this page is not tracking',{'data-orphans':'true'},items.map(a=>{const info=tokenInfo(a.token);return css(el('div',{'data-orphan':a.token},el('p',{},'Approved '+at(a.confirmed_at)+', usable until '+at(a.expires_at)+': '+tokenText(info)+'.'),ref(info?.id)),{margin:'6px 0'});}),
  muted('This happens after a reload. To use the approval, preview the same request again with exactly the same details; the preview then shows it as approved.'));
}

function memberFilter(ui){
 const select=el('select',{'aria-label':'Member','data-field':'member-filter'},el('option',{value:''},'All members'),...S.members.map(m=>el('option',{value:m.member_id},m.name)));
 select.value=S.member;select.addEventListener('change',()=>{S.member=select.value;const s=ui.section,cur=records(s).find(x=>idOf(s,x)===S.sel[s]);if(SELECTABLE.includes(s)&&cur&&S.member&&cur.member_id!==S.member){leave(S.sel[s],null);S.sel[s]=null;}rerender(ui);});
 return css(el('label',{class:'field'},el('span',{},'Member'),select),{padding:'0 22px 12px'});
}
const mine=x=>!S.member||x.member_id===S.member;
function leave(old,next){
 if(old&&old!==next)for(const k of keysOf((k,x)=>x.record===old&&!!(S.flows[k]||S.pending[k]))){delete S.flows[k];delete S.pending[k];delete S.notes[k];bump(k);if(S.error?.scope===k)S.error=null;}
}
function select(ui,section,id){
 if(S.busy)return;
 leave(S.sel[section],id);
 S.sel[section]=id;S.error=null;S.flash=null;
 ui.refresh().then(()=>{showOutcome();const h=document.querySelector('.detail article h2');if(h){h.focus();if(matchMedia('(max-width: 760px)').matches)h.scrollIntoView({block:'start'});}}).catch(ui.error);
}
function claimMatches(c,text){if(!text)return true;return [c.claim_id,c.provider.name,person(c.member_id),...c.lines.map(l=>l.service.description)].some(x=>String(x).toLowerCase().includes(text));}

function claimList(ui){
 if(!ui.has(T.claims))return unavailable('Reading claims');
 const text=searchText(),shown=S.claims.filter(c=>mine(c)&&claimMatches(c,text));
 const box=el('div',{'data-list':'claims'},memberFilter(ui));
 const groups=[['Waiting for answers',c=>c.status==='pending_info'],['In review',c=>c.status==='received'],['Processed',c=>c.status==='processed']];
 for(const [label,test] of groups){
  const items=shown.filter(test).sort((a,b)=>Date.parse(b.received_at)-Date.parse(a.received_at));if(!items.length)continue;
  box.append(kicker(label+' · '+items.length));
  for(const c of items){
   const eob=currentEob(c),denied=deniedLines(c).length;
   box.append(row({'data-claim-id':c.claim_id,'aria-pressed':String(c.claim_id===S.sel.claims)},()=>select(ui,'claims',c.claim_id),c.provider.name+' · '+firstName(c.member_id),
    'Received '+dayOf(c.received_at)+' · '+c.lines.map(l=>l.service.description).join(', '),
    c.status==='pending_info'?openRequests(c).length+' question'+(openRequests(c).length===1?'':'s')+' open':c.status==='received'?'Review '+at(c.review_at):'You owe '+money(eob?.totals.member_cost_cents)+' · plan paid '+money(eob?.totals.plan_paid_cents)+(denied?' · '+denied+' line'+(denied===1?'':'s')+' denied':'')));
  }
 }
 if(!shown.length)box.append(el('div',{class:'empty'},el('h3',{},'No claims'),el('p',{},text||S.member?'Try a different search or member.':'Claims from your providers appear here.')));
 return box;
}
function lineName(c,lineId){const l=c?.lines.find(x=>x.line_id===lineId);return l?'line '+l.position+' ('+l.service.description+')':'a line';}
function outcomeText(o){
 if(!o)return 'Not processed yet';
 if(o.status==='denied')return 'Denied: '+(REASON[o.reason]||o.reason);
 return 'Paid · you owe '+money(o.member_cost_cents)+' · plan paid '+money(o.plan_paid_cents)+(o.pa_id?' · covered by a prior authorization ('+o.pa_units+' unit'+(o.pa_units===1?'':'s')+')':'');
}
function claimLines(c){
 return c.lines.map(l=>css(el('div',{'data-line':l.line_id},el('strong',{},'Line '+l.position+' · '+l.service.description),
  el('small',{},'Service date '+day(l.service_date)+' · '+l.units+' unit'+(l.units===1?'':'s')+' · billed '+money(l.billed_cents)+(l.emergency?' · emergency':'')+(l.possible_accident?' · may be accident-related':'')),
  el('small',{'data-outcome':l.outcome?l.outcome.status:'pending'},outcomeText(l.outcome))),{display:'grid',gap:'2px',padding:'8px 0',borderBottom:'1px solid var(--line)'}));
}
function eobChange(c,e){
 const prev=c.eobs.find(x=>x.version===e.version-1);if(!prev)return null;
 const changed=e.lines.filter(l=>JSON.stringify(l)!==JSON.stringify(prev.lines.find(x=>x.line_id===l.line_id)));
 return changed.length?'After an appeal, '+changed.map(l=>lineName(c,l.line_id)+(l.status==='paid'?' is now paid':' is now denied')).join(' and ')+'.':null;
}
function eobBlock(c,e,open){
 const newer=c.eobs.some(x=>x.version>e.version);
 const d=el('details',{'data-eob':e.eob_id,'data-eob-version':String(e.version)},css(el('summary',{},'Version '+e.version+' · issued '+at(e.issued_at)+(e.reason==='appeal'?' · after an appeal':' · first processing')+(newer?' · replaced by version '+(e.version+1):' · current')),{cursor:'pointer',fontWeight:'600',fontSize:'13px',padding:'6px 0'}));
 const change=eobChange(c,e);if(change)d.append(muted(change,{'data-eob-change':String(e.version)}));
 d.open=open;
 for(const l of e.lines){
  const line=c.lines.find(x=>x.line_id===l.line_id);
  d.append(css(el('div',{'data-eob-line':l.line_id},el('strong',{},'Line '+(line?.position??'')+' · '+(line?.service.description||'')+' · '+(l.status==='paid'?'paid':'denied')),
   l.status==='denied'?el('small',{},'Reason: '+(REASON[l.reason]||l.reason)+' · not allowed '+money(l.not_allowed_cents)):
   el('small',{},'Allowed '+money(l.allowed_cents)+' · copay '+money(l.copay_cents)+' · deductible '+money(l.deductible_cents)+' · coinsurance '+money(l.coinsurance_cents)+' · you owe '+money(l.member_cost_cents)+' · plan paid '+money(l.plan_paid_cents)+' · not allowed '+money(l.not_allowed_cents)),
   l.pa_id?el('small',{'data-pa-used':l.pa_id},'Covered by a prior authorization, '+l.pa_units+' unit'+(l.pa_units===1?'':'s')):null),{display:'grid',gap:'2px',padding:'6px 0',borderBottom:'1px solid var(--line)'}));
 }
 d.append(metadata('Billed',money(e.totals.billed_cents)),metadata('Allowed',money(e.totals.allowed_cents)),
  el('div',{class:'metadata-line','data-member-cost':String(e.totals.member_cost_cents)},el('span',{},'You owe'),el('strong',{},money(e.totals.member_cost_cents))),
  metadata('Plan paid',money(e.totals.plan_paid_cents)),metadata('Not allowed',money(e.totals.not_allowed_cents)),
  muted('Not allowed is the part of the billed amount the plan does not count: the amount above its allowed amount, or the whole line when the line is denied. Larkfield does not say whether the provider may bill you for it; ask the provider or the plan.',{'data-not-allowed-help':'true'}));
 return d;
}
function requestRow(ui,c,r){
 const title=(r.type==='accident'?'Accident question':'Other-coverage question for '+r.plan_year)+' · '+lineName(c,r.line_id);
 const state=r.status==='open'?'Open until '+at(r.expires_at):r.status==='answered'?'Answered '+at(r.answered_at)+': '+((r.type==='accident'?INFO[r.answer]:COB[r.answer])||r.answer):'Expired '+at(r.expires_at)+' without an answer';
 const box=css(el('div',{'data-request':r.info_request_id,'data-request-status':r.status},el('strong',{},title),el('small',{},'Asked '+at(r.opened_at)+' · '+state)),{display:'grid',gap:'4px',padding:'10px 0',borderBottom:'1px solid var(--line)'});
 if(r.status==='open'&&r.type==='accident')box.append(infoForm(ui,c,r));
 return box;
}
function infoForm(ui,c,r){
 const key=K('info',r.info_request_id),owner=c.member_id;
 if(!canAct(owner))return muted('Only someone who can act on '+person(owner)+'’s records can answer.');
 if(!ui.has(FLOW.info.preview)||!ui.has(FLOW.info.confirm))return muted('Answering is not allowed by the current policy.');
 const d=S.drafts[key]||{},f=S.flows[key],draft=()=>S.drafts[key]||{};
 const summary=f=>el('div',{},metadata('Question',cap(lineName(c,f.changes.line_id))+' of '+claimLabel(c)),metadata('Your answer',INFO[f.args.answer]),
  muted(f.changes.completes?'This is the claim’s last open question: confirming lets Larkfield process the claim.':'Other questions on this claim stay open after this answer.'));
 const label=()=>'answer the accident question on '+lineName(claimOf(c.claim_id),r.line_id)+' of '+claimLabel(claimOf(c.claim_id));
 const done=res=>{S.flash=said(res,'Answer recorded for '+lineName(c,r.line_id)+'.',label);};
 return el('div',{'data-form':key},radios(key,owner,c.claim_id,'answer','Your answer',INFO,f?f.args.answer:d.answer,ui),
  f?null:previewButton(ui,key,'Preview answer',()=>draft().answer?{args:{claim_id:c.claim_id,line_id:r.line_id,answer:draft().answer}}:{error:'Choose an answer first.'},'info',owner,c.claim_id),
  f?null:alertFor(key),flowPanel(ui,key,'Check and confirm your answer',summary,label,done,{member:owner,need:'act'}));
}
function cobForm(ui,owner,year,origin=null){
 const key=K('cob',owner,year),open=openCob(owner,year);
 if(!canAct(owner))return muted('Only someone who can act on '+person(owner)+'’s records can answer.');
 if(!ui.has(FLOW.cob.preview)||!ui.has(FLOW.cob.confirm))return muted('Answering is not allowed by the current policy.');
 const d=S.drafts[key]||{},f=S.flows[key],draft=()=>S.drafts[key]||{};
 const where=id=>{const x=open.find(o=>o.request.info_request_id===id);return x?lineName(x.claim,x.request.line_id)+' of '+claimLabel(x.claim):'a question opened since this page last read Larkfield';};
 const summary=f=>el('div',{},metadata('Member and year',person(owner)+', '+year),metadata('Your answer',COB[f.args.answer]),
  el('div',{class:'metadata-line','data-resolves':f.changes.resolves.join(' ')},el('span',{},'Answers'),el('strong',{},f.changes.resolves.length+' open question'+(f.changes.resolves.length===1?'':'s')+': '+f.changes.resolves.map(where).join('; '))),
  el('div',{class:'metadata-line','data-completes':f.changes.completes.join(' ')},el('span',{},'Then processed'),el('strong',{},f.changes.completes.length?f.changes.completes.map(id=>claimLabel(claimOf(id))).join('; '):'no claim yet (other questions stay open)')),
  muted('This answer applies to every other-coverage question for '+person(owner)+' in '+year+' that is still open when you confirm.'));
 const label=()=>'answer the other-coverage question for '+person(owner)+', '+year;
 const done=res=>{S.flash=said(res,'Other coverage for '+person(owner)+', '+year+': '+COB[res.coverage?.status]+'.',label);};
 return css(el('div',{'data-form':key},el('strong',{},'Other coverage for '+person(owner)+', '+year),muted(open.length+' open question'+(open.length===1?'':'s')+' for this member and year. One answer covers them all.'),
  radios(key,owner,origin,'answer','Your answer',{none:COB.none,other_secondary:COB.other_secondary,other_primary:COB.other_primary},f?f.args.answer:d.answer,ui),
  f?null:previewButton(ui,key,'Preview answer',()=>draft().answer?{args:{member_id:owner,plan_year:year,answer:draft().answer}}:{error:'Choose an answer first.'},'cob',owner,origin),
  f?null:alertFor(key),flowPanel(ui,key,'Check and confirm your answer',summary,label,done,{member:owner,need:'act'})),{display:'grid',gap:'4px',padding:'10px 0'});
}
const FILE_PLAIN={expedite_not_allowed:'An expedited appeal is possible only on a denied prior authorization, and only with your statement that waiting could seriously harm the member’s health. Nothing was changed.'};
function fileForm(ui,type,rec,owner,w,lines){
 const id=type==='claim'?rec.claim_id:rec.pa_id,key=K('file',type,id),what=type==='claim'?'claim':'authorization';
 const s=appealState(type,id);
 if(s.open)return muted('An appeal on this '+what+' is '+APPEAL_STATUS[s.open.status].toLowerCase()+'.');
 if(s.decided)return muted('The appeal on this '+what+' was '+(s.decided.status==='upheld'?'upheld, so the denial stands':'overturned, so the plan reversed its denial')+'. There is one appeal level, so it cannot be appealed again.');
 if(!w)return muted('Larkfield shows no appeal window for this '+what+', so it cannot be appealed from this page.');
 if(windowClosed(type,id,w))return muted('The time to appeal this '+what+' ended '+at(w.ends_at)+', so it can no longer be appealed.',{'data-window':'closed'});
 if(!canAct(owner))return muted('Only someone who can act on '+person(owner)+'’s records can file an appeal.');
 if(!ui.has(FLOW.file.preview)||!ui.has(FLOW.file.confirm))return muted('Filing appeals is not allowed by the current policy.');
 const d=S.drafts[key]||{},f=S.flows[key];
 const expedite=type==='pa'?(()=>{
  const box=el('div',{class:'fields'});
  for(const [field,label] of [['expedited','Ask for an expedited appeal (decision within 72 hours)'],['urgency_attested','I attest that waiting the standard 30 days could seriously harm the member’s health']]){
   const input=el('input',{type:'checkbox','data-field':field,'data-focus':key+'-'+field});input.checked=!!(f?f.args[field]:d[field]);
   input.addEventListener('change',()=>edit(ui,key,owner,{record:id,[field]:input.checked}));box.append(choiceLabel(input,label));
  }
  return box;})():null;
 const build=()=>{const x=S.drafts[key]||{},text=x.statement||'',problem=textProblem(text,true);if(problem)return {error:problem};return {args:{target_type:type,target_id:id,statement:text.trim(),...(type==='pa'?{expedited:!!x.expedited,urgency_attested:!!x.urgency_attested}:{})}};};
 const subject=()=>type==='claim'?claimLabel(claimOf(id)):paLabel(paOf(id));
 const summary=f=>el('div',{},metadata('Appeal on',cap(subject())+(f.changes.lines?' · '+f.changes.lines.map(l=>lineName(rec,l)).join(', '):'')),
  metadata('Expedited',f.changes.expedited?'Yes':'No'),
  el('div',{class:'metadata-line','data-due':f.changes.due_at_if_filed_now},el('span',{},'Decision due'),el('strong',{},at(f.changes.due_at_if_filed_now)+' if filed now ('+DUE_RULE[f.changes.due_rule]+')')),
  metadata('Window ends',at(f.changes.window_ends_at)),css(el('p',{'data-statement':'true'},'Statement: '+f.args.statement),{whiteSpace:'pre-wrap',fontSize:'12px',margin:'8px 0'}));
 const label=()=>'file an appeal on '+subject();
 const done=res=>{S.flash=said(res,'Appeal filed; decision due '+at(res.appeal.due_at)+'.',label);S.sel.appeals=res.appeal.appeal_id;};
 return css(el('div',{'data-form':key},el('strong',{},'File an appeal'),
  muted((type==='claim'?'The appeal covers the denied lines ('+lines.map(l=>lineName(rec,l.line_id)).join(', ')+').':'The appeal asks the plan to approve this authorization.')+' Filing window: until '+at(w.ends_at)+'.'),
  textField(ui,key,owner,id,'statement','Your statement',f?f.args.statement:d.statement,'What the plan should know. Up to 2,000 characters.'),expedite,
  f?null:previewButton(ui,key,'Preview appeal',build,'file',owner,id,FILE_PLAIN),f?null:alertFor(key),
  flowPanel(ui,key,'Check and confirm your appeal',summary,label,done,{member:owner,need:'act'},FILE_PLAIN)),{display:'grid',gap:'6px',marginTop:'8px'});
}
function appealLinks(ui,ids){
 return ids.map(id=>{const a=appealOf(id);return row({'data-appeal-link':id},a?()=>{S.sel.appeals=id;ui.navigate('appeals').then(()=>ui.refresh()).then(showOutcome).catch(ui.error);}:null,'Appeal'+(a?' · '+APPEAL_STATUS[a.status]:''),a?'Filed '+at(a.filed_at):null,ref(id));});
}
function claimView(ui){
 if(!ui.has(T.claims))return el('article',{},unavailable('Reading claims'));
 const c=claimOf(S.sel.claims);
 if(!c)return el('div',{class:'empty'},el('h3',{},'Choose a claim'),el('p',{},'Pick a claim to see its lines, questions, explanations of benefits and appeals.'));
 const eobs=[...c.eobs].sort((a,b)=>b.version-a.version),denied=deniedLines(c),w=c.appeal_window;
 const cobs=[...new Set(openRequests(c).filter(r=>r.type==='other_coverage').map(r=>r.plan_year))];
 return el('article',{'data-claim':c.claim_id,'data-status':c.status},muted('Claim'),el('h2',{tabindex:'-1'},c.provider.name),
  el('div',{class:'tags'},el('span',{class:'tag','data-claim-status':c.status},CLAIM_STATUS[c.status]),tag(c.provider.in_network?'In network':'Out of network'),denied.length?tag(denied.length+' denied line'+(denied.length===1?'':'s')):null),
  metadata('Member',person(c.member_id)),metadata('Received',at(c.received_at)),metadata(c.status==='received'?'Review due':c.status==='pending_info'?'Reviewed (waiting for answers)':'Reviewed',at(c.review_at)),
  orphanNote(c.approvals),
  heading('Lines'),claimLines(c),
  c.info_requests.length?heading('Questions from the plan'):null,c.info_requests.map(r=>requestRow(ui,c,r)),cobs.map(y=>cobForm(ui,c.member_id,y,c.claim_id)),
  eobs.length?heading('Explanation of benefits'):null,eobs.map((e,i)=>eobBlock(c,e,i===0)),
  w||c.appeal_ids.length||denied.length?heading('Appeals'):null,
  w?metadata('Denial notice',at(w.notice_at)):null,w?metadata('Filing window',(windowClosed('claim',c.claim_id,w)?'ended ':'until ')+at(w.ends_at)):null,w&&w.closing_notice_at?metadata('Closing reminder',at(w.closing_notice_at)):null,
  appealLinks(ui,c.appeal_ids),
  c.status==='processed'&&denied.length?fileForm(ui,'claim',c,c.member_id,w,denied):null,
  metadata('Reference',c.claim_id));
}

function paMatches(p,text){if(!text)return true;return [p.pa_id,p.service.description,p.provider.name,person(p.member_id)].some(x=>String(x).toLowerCase().includes(text));}
function paList(ui){
 if(!ui.has(T.pas))return unavailable('Reading prior authorizations');
 const text=searchText(),shown=S.pas.filter(p=>mine(p)&&paMatches(p,text));
 const box=el('div',{'data-list':'pas'},memberFilter(ui));
 for(const [label,test] of [['Open',p=>['pending','info_requested'].includes(p.status)],['Decided',p=>!['pending','info_requested'].includes(p.status)]]){
  const items=shown.filter(test).sort((a,b)=>Date.parse(b.submitted_at)-Date.parse(a.submitted_at));if(!items.length)continue;
  box.append(kicker(label+' · '+items.length));
  for(const p of items)box.append(row({'data-pa-id':p.pa_id,'aria-pressed':String(p.pa_id===S.sel.pas)},()=>select(ui,'pas',p.pa_id),p.service.description+' · '+firstName(p.member_id),
   PA_STATUS[p.status]+(p.overdue?' · decision overdue':''),['pending','info_requested'].includes(p.status)?'Decision due '+at(p.due_at):p.approved?p.approved.units+' units, '+day(p.approved.valid_from)+' to '+day(p.approved.valid_until):'Submitted '+dayOf(p.submitted_at)));
 }
 if(!shown.length)box.append(el('div',{class:'empty'},el('h3',{},'No prior authorizations'),el('p',{},text||S.member?'Try a different search or member.':'Requests your providers send to the plan appear here.')));
 return box;
}
const EXPEDITE_PLAIN={expedite_not_allowed:'Expedited review can be asked for only while the request is still undecided, so nothing was changed.',duplicate_request:'Expedited review was already asked for this request, so nothing new was sent.'};
function expediteForm(ui,p){
 const key=K('expedite',p.pa_id),d=S.drafts[key]||{};
 if(!canAct(p.member_id)||!ui.has(T.expedite))return null;
 const check=local('invalid_input');
 const label=()=>'ask for expedited review of '+paLabel(paOf(p.pa_id));
 const send=button('Ask for expedited review',()=>{
  const x=S.drafts[key]||{},problem=textProblem(x.reason,false);check.textContent=problem||'';if(problem)return;
  const reason=String(x.reason||'').trim();
  act(ui,key,()=>commit(ui,T.expedite,{pa_id:p.pa_id,...(reason?{reason}:{})},label,r=>{delete S.drafts[key];bump(key);S.flash=said(r,'Expedited review requested. The plan decides whether to grant it.',label);},null,{member:p.member_id,need:'act'},EXPEDITE_PLAIN));
 },{class:'primary','data-action':'expedite'});
 return css(el('div',{'data-form':key},el('strong',{},'Expedited review'),muted('You can ask once while the request is undecided. If the plan agrees, the decision is due within 72 hours of your request.'),
  textField(ui,key,p.member_id,p.pa_id,'reason','Reason (optional)',d.reason,null),check,alertFor(key),el('div',{class:'form-actions'},send)),{display:'grid',gap:'6px',marginTop:'8px'});
}
function paView(ui){
 if(!ui.has(T.pas))return el('article',{},unavailable('Reading prior authorizations'));
 const p=paOf(S.sel.pas);
 if(!p)return el('div',{class:'empty'},el('h3',{},'Choose a prior authorization'),el('p',{},'Pick one to see its dates, units, due date and appeals.'));
 const open=['pending','info_requested'].includes(p.status),w=p.appeal_window;
 return el('article',{'data-pa':p.pa_id,'data-status':p.status},muted('Prior authorization'),el('h2',{tabindex:'-1'},p.service.description),
  el('div',{class:'tags'},el('span',{class:'tag','data-pa-status':p.status},PA_STATUS[p.status]),p.overdue?el('span',{class:'tag','data-overdue':'true'},'Decision overdue'):null,p.expedite?tag('Expedite '+p.expedite.status):null),
  metadata('Member',person(p.member_id)),metadata('Provider',p.provider.name+(p.provider.in_network?'':' (out of network)')),metadata('Submitted',at(p.submitted_at)),
  metadata('Requested',p.requested.units+' unit'+(p.requested.units===1?'':'s')+', '+day(p.requested.valid_from)+' to '+day(p.requested.valid_until)),
  p.approved?el('div',{class:'metadata-line','data-approved':p.approved.units+' '+p.approved.valid_from+' '+p.approved.valid_until},el('span',{},'Approved'),el('strong',{},p.approved.units+' unit'+(p.approved.units===1?'':'s')+', '+day(p.approved.valid_from)+' to '+day(p.approved.valid_until)+' (ends 11:59 PM on the last day)')):null,
  p.approved?el('div',{class:'metadata-line','data-units-used':String(p.units_used)},el('span',{},'Units used'),el('strong',{},p.units_used+' of '+p.approved.units)):null,
  el('div',{class:'metadata-line','data-due':p.due_at},el('span',{},'Decision due'),el('strong',{},at(p.due_at)+(p.overdue?' · overdue since '+at(p.overdue_at):''))),
  p.decided_at?metadata('Decided',at(p.decided_at)):null,p.expired_at?metadata('Ended',at(p.expired_at)):null,
  orphanNote(p.approvals),
  p.info_requests.length?heading('Information the plan asked for'):null,p.info_requests.map(r=>metadata(at(r.at),r.text)),
  p.expedite?heading('Expedited review'):null,p.expedite?[metadata('Requested',at(p.expedite.requested_at)),p.expedite.reason?metadata('Reason',p.expedite.reason):null,metadata('Plan’s answer',p.expedite.status==='open'?'Waiting':p.expedite.status==='approved'?'Granted '+at(p.expedite.decided_at):'Not granted '+at(p.expedite.decided_at))]:null,
  open&&!p.expedite&&canAct(p.member_id)&&ui.has(T.expedite)?expediteForm(ui,p):muted('Expedited review can be asked for once per request, only while the plan has not yet decided it'+(p.expedite?'; it was already asked for this one.':open?(canAct(p.member_id)?'; the current policy does not allow it here.':'; only someone who can act on '+person(p.member_id)+'’s records can ask.'):'; this one is '+PA_STATUS[p.status].toLowerCase()+'.'),{'data-expedite-help':'true'}),
  p.covered_submissions.length?heading('Later requests this approval already covers'):null,p.covered_submissions.map(s=>el('div',{class:'metadata-line','data-covered':s.pa_id},el('span',{},at(s.at)),el('strong',{},s.units+' unit'+(s.units===1?'':'s')+', '+day(s.valid_from)+' to '+day(s.valid_until),ref(s.pa_id)))),
  w||p.appeal_ids.length?heading('Appeals'):null,w?metadata('Denial notice',at(w.notice_at)):null,w?metadata('Filing window',(windowClosed('pa',p.pa_id,w)?'ended ':'until ')+at(w.ends_at)):null,
  appealLinks(ui,p.appeal_ids),
  p.status==='denied'?fileForm(ui,'pa',p,p.member_id,w,[]):null,
  metadata('Reference',p.pa_id));
}

function appealList(ui){
 if(!ui.has(T.appeals))return unavailable('Reading appeals');
 const text=searchText(),shown=S.appeals.filter(a=>mine(a)&&(!text||[a.appeal_id,a.target.id,targetShort(a),person(a.member_id)].some(x=>x.toLowerCase().includes(text))));
 const box=el('div',{'data-list':'appeals'},memberFilter(ui));
 for(const [label,test] of [['Open',a=>OPEN_APPEAL.includes(a.status)],['Closed',a=>!OPEN_APPEAL.includes(a.status)]]){
  const items=shown.filter(test).sort((a,b)=>Date.parse(b.filed_at)-Date.parse(a.filed_at));if(!items.length)continue;
  box.append(kicker(label+' · '+items.length));
  for(const a of items)box.append(row({'data-appeal-id':a.appeal_id,'aria-pressed':String(a.appeal_id===S.sel.appeals)},()=>select(ui,'appeals',a.appeal_id),targetShort(a)+' · '+firstName(a.member_id),
   APPEAL_STATUS[a.status]+(a.expedited?' · expedited':'')+(a.overdue?' · decision overdue':''),OPEN_APPEAL.includes(a.status)?'Decision due '+at(a.due_at):'Filed '+dayOf(a.filed_at)));
 }
 if(!shown.length)box.append(el('div',{class:'empty'},el('h3',{},'No appeals'),el('p',{},text||S.member?'Try a different search or member.':'Appeals you file on denied claims or authorizations appear here.')));
 return box;
}
function statementSeen(a,d){const text=String(d.statement||'').trim();return text===d.sentText&&a.statements.filter(x=>x.text===text).length>d.matches&&a.statements.some(x=>x.text===text&&Date.parse(x.at)>=d.sentAfter);}
function statementForm(ui,a){
 const key=K('statement',a.appeal_id),d=S.drafts[key]||{};
 if(!canAct(a.member_id)||!ui.has(T.statement))return null;
 const check=local('invalid_input');
 const label=()=>{const ap=appealOf(a.appeal_id);return 'add a statement to '+(ap?'the appeal on '+targetText(ap):'an appeal');};
 const send=button(d.uncertain?'Send it again anyway':'Add statement',()=>{
  const x=S.drafts[key]||{},problem=textProblem(x.statement,true);check.textContent=problem||'';if(problem)return;
  const sentText=x.statement.trim(),cur=appealOf(a.appeal_id)||a,matches=cur.statements.filter(y=>y.text===sentText).length,sentAfter=cur.statements.reduce((m,y)=>Math.max(m,Date.parse(y.at)),0);
  act(ui,key,async()=>{try{await commit(ui,T.statement,{appeal_id:a.appeal_id,statement:x.statement.trim()},label,r=>{delete S.drafts[key];bump(key);S.flash=said(r,'Statement added'+(a.status==='info_requested'?'; the appeal is under review again.':'.'),label);},null,{member:a.member_id,need:'act'});}catch(e){if(S.unknown?.name===T.statement&&S.drafts[key]){Object.assign(S.drafts[key],{uncertain:true,sentText,matches,sentAfter});}throw e;}});
 },{class:'primary','data-action':'add-statement'});
 return css(el('div',{'data-form':key},el('strong',{},'Add a statement'),a.status==='info_requested'?muted('The plan asked for more information; adding a statement returns the appeal to review.'):null,
  textField(ui,key,a.member_id,a.appeal_id,'statement','Statement',d.statement,null),d.uncertain?css(el('p',{role:'status','data-uncertain':statementSeen(a,d)?'seen':'true'},statementSeen(a,d)?'A statement with this text was added to the appeal after you sent yours, so yours was probably stored, but Larkfield has not confirmed it. '+(S.unknown?.name===T.statement?'Press Retry in “Waiting for Larkfield” to find out; ':'')+'sending it again may add it twice.':'Larkfield did not confirm whether this statement was added. Check the statements above before sending it again: sending it again may add it twice.'),{...NOTE,marginTop:'6px'}):null,check,alertFor(key),el('div',{class:'form-actions'},send)),{display:'grid',gap:'6px',marginTop:'8px'});
}
function withdrawForm(ui,a){
 const key=K('withdraw',a.appeal_id);
 if(!canAct(a.member_id)||!ui.has(FLOW.withdraw.preview)||!ui.has(FLOW.withdraw.confirm))return null;
 const f=S.flows[key];
 const summary=f=>el('div',{},metadata('Appeal',cap(targetText(a))),el('div',{class:'metadata-line','data-window':f.changes.window_ends_at},el('span',{},'File again until'),el('strong',{},at(f.changes.window_ends_at))),
  muted('A withdrawn appeal is closed. You can file a new appeal on the same '+(a.target.type==='claim'?'claim':'authorization')+' until the original window ends.'));
 const label=()=>{const ap=appealOf(a.appeal_id);return 'withdraw '+(ap?'the appeal on '+targetText(ap):'an appeal');};
 const until=f?.changes.window_ends_at;
 const done=res=>{S.flash=said(res,'Appeal withdrawn.'+(until?' You can file again until '+at(until)+'.':''),label);};
 return css(el('div',{'data-form':key},f?null:previewButton(ui,key,'Withdraw appeal…',()=>({args:{appeal_id:a.appeal_id}}),'withdraw',a.member_id,a.appeal_id),f?null:alertFor(key),
  flowPanel(ui,key,'Check and confirm the withdrawal',summary,label,done,{member:a.member_id,need:'act'})),{marginTop:'8px'});
}
function appealView(ui){
 if(!ui.has(T.appeals))return el('article',{},unavailable('Reading appeals'));
 const a=appealOf(S.sel.appeals);
 if(!a)return el('div',{class:'empty'},el('h3',{},'Choose an appeal'),el('p',{},'Pick an appeal to see its statements, due date and decision.'));
 const open=OPEN_APPEAL.includes(a.status),target=a.target.type==='claim'?claimOf(a.target.id):null;
 return el('article',{'data-appeal':a.appeal_id,'data-status':a.status},muted('Appeal'),el('h2',{tabindex:'-1'},targetName(a)),
  el('div',{class:'tags'},el('span',{class:'tag','data-appeal-status':a.status},APPEAL_STATUS[a.status]),a.expedited?tag('Expedited'):null,a.overdue?el('span',{class:'tag','data-overdue':'true'},'Decision overdue'):null),
  metadata('Member',person(a.member_id)),a.lines?metadata('Lines',a.lines.map(l=>lineName(target,l)).join(', ')):null,metadata('Filed',at(a.filed_at)),
  el('div',{class:'metadata-line','data-due':a.due_at},el('span',{},'Decision due'),el('strong',{},at(a.due_at)+(a.overdue?' · overdue since '+at(a.overdue_at):''))),
  a.decided_at?metadata('Decided',at(a.decided_at)):null,a.withdrawn_at?metadata('Withdrawn',at(a.withdrawn_at)):null,
  a.outcome?metadata('Outcome',a.outcome.lines?'Lines repriced: '+a.outcome.lines.map(l=>lineName(target,l)).join(', '):'Approved '+a.outcome.units+' units until '+day(a.outcome.valid_until)):null,
  orphanNote(a.approvals),
  heading('Statements'),a.statements.map(s=>css(el('div',{'data-statement-at':s.at},el('small',{},at(s.at)+' · '+Person(s.by)),css(el('p',{},s.text),{whiteSpace:'pre-wrap',fontSize:'13px'})),{padding:'8px 0',borderBottom:'1px solid var(--line)'})),
  a.info_requests.length?heading('Information the plan asked for'):null,a.info_requests.map(r=>metadata(at(r.at),r.text)),
  open?statementForm(ui,a):null,open?withdrawForm(ui,a):muted('This appeal is closed; it can still be read.'),
  metadata('Reference',a.appeal_id+' · '+(a.target.type==='claim'?'claim ':'authorization ')+a.target.id));
}

function planList(ui){
 if(!ui.has(T.plan))return unavailable('Reading the plan');
 const box=el('div',{'data-list':'plan'});
 for(const y of Object.keys(S.plans).map(Number).sort((a,b)=>b-a)){
  const p=S.plans[y],open=S.members.reduce((n,m)=>n+openCob(m.member_id,y).length,0);
  box.append(row({'data-plan-year':String(y),'aria-pressed':String(y===S.year)},()=>{S.year=y;rerender(ui);},'Plan year '+y,p.plan.name,open?open+' other-coverage question'+(open===1?'':'s')+' open':null));
 }
 if(!box.children.length)box.append(el('div',{class:'empty'},el('h3',{},'No plan years'),el('p',{},'No plan years you can see.')));
 return box;
}
function planView(ui){
 if(!ui.has(T.plan))return el('article',{},unavailable('Reading the plan'));
 const r=S.plans[S.year];if(!r)return el('div',{class:'empty'},el('h3',{},'Choose a plan year'));
 const p=r.plan,services=new Map([...S.claims.flatMap(c=>c.lines.map(l=>l.service)),...S.pas.map(x=>x.service)].map(s=>[s.service_id,s.description]));
 const known=p.pa_services.filter(id=>services.has(id)).map(id=>services.get(id)),other=p.pa_services.filter(id=>!services.has(id));
 const used=(v,limit)=>money(v)+' of '+money(limit);
 return el('article',{'data-plan':String(p.plan_year)},muted('Plan year '+p.plan_year),el('h2',{},p.name),
  heading('Benefits'),metadata('Deductible',money(p.deductible.individual_cents)+' per person · '+money(p.deductible.family_cents)+' per family'),
  metadata('Out-of-pocket maximum',money(p.oop_max.individual_cents)+' per person · '+money(p.oop_max.family_cents)+' per family'),
  metadata('Coinsurance',p.coinsurance_pct+'% after the deductible'),
  metadata('Copays',p.copays.map(c=>c.category+' '+money(c.copay_cents)).join(' · ')+'; copays count toward the out-of-pocket maximum, not the deductible'),
  metadata('Network','In-network care only; emergency care out of network is covered at in-network cost sharing'),
  el('div',{class:'metadata-line','data-pa-services':p.pa_services.join(' ')},el('span',{},'Needs prior authorization'),el('strong',{},[...known,other.length?other.length+' other service'+(other.length===1?'':'s')+' that do not appear in the records you can see':null].filter(Boolean).join(' · '))),
  heading('Amounts used in '+p.plan_year),
  r.members.map(m=>css(el('div',{'data-accumulator':m.member_id},el('strong',{},person(m.member_id)),
   el('small',{'data-deductible':String(m.deductible_cents)},'Deductible '+used(m.deductible_cents,p.deductible.individual_cents)),
   el('small',{'data-oop':String(m.oop_cents)},'Out of pocket '+used(m.oop_cents,p.oop_max.individual_cents)),
   el('small',{'data-coverage':m.other_coverage.status},'Other coverage: '+COB[m.other_coverage.status]+(m.other_coverage.attested_at?' (answered '+at(m.other_coverage.attested_at)+')':'')),
   m.other_coverage.status==='unknown'&&!openCob(m.member_id,p.plan_year).length?el('small',{'data-coverage-help':'true'},'Larkfield asks this question when a claim for '+p.plan_year+' needs it; you can answer it then, on the claim or here.'):null,
   orphanNote(m.approvals),openCob(m.member_id,p.plan_year).length?cobForm(ui,m.member_id,p.plan_year):null),{display:'grid',gap:'3px',padding:'10px 0',borderBottom:'1px solid var(--line)'})),
  r.family?css(el('div',{'data-family':'true'},el('strong',{},'Family'),el('small',{'data-family-deductible':String(r.family.deductible_cents)},'Family deductible '+used(r.family.deductible_cents,p.deductible.family_cents)),
   el('small',{'data-family-oop':String(r.family.oop_cents)},'Family out of pocket '+used(r.family.oop_cents,p.oop_max.family_cents))),{display:'grid',gap:'3px',padding:'10px 0'})
   :muted('Family totals are shown only to someone who can see every member enrolled in '+p.plan_year+'. You can see '+r.members.map(m=>person(m.member_id)).join(' and ')+'; at least one other member enrolled that year is not visible to you.',{'data-family':'hidden'}));
}

const whose=id=>id===me()?'your':person(id)+'’s';
function grantLine(ui,g){
 const full=canGrant(g.member_id)&&g.state==='active'&&ui.has(FLOW.grant.preview)&&ui.has(FLOW.grant.confirm);
 const change=K('grant',g.grant_id),revoke=K('revoke',g.grant_id);
 const who=g.grantee_id===me()?'You':Person(g.grantee_id);
 const box=css(el('div',{'data-grant-id':g.grant_id,'data-grant-state':g.state},el('strong',{},who+' can '+SCOPE[g.scope]+' '+whose(g.member_id)+' records'),
  el('small',{},'Given '+at(g.created_at)+' by '+(g.grantor_id===me()?'you':person(g.grantor_id))+' · '+(g.state==='revoked'?'removed '+at(g.revoked_at):g.state==='expired'?'ended '+at(g.expires_at):g.expires_at?'until '+at(g.expires_at):'no end date')+' · '+g.state),
  [g.grantee_id,g.grantor_id].some(id=>!member(id))?ref(...[g.grantee_id,g.grantor_id].filter(id=>!member(id))):null,
  full?el('div',{class:'actions'},button('Change',()=>{edit(ui,change,g.member_id,{record:g.grant_id,open:true,grantVersion:g.grant_version,scope:g.scope,ends:!!g.expires_at,date:g.expires_at?fmt(g.expires_at,{year:'numeric',month:'2-digit',day:'2-digit'}).replace(/(\d+)\/(\d+)\/(\d+)/,'$3-$1-$2'):'',time:g.expires_at?fmt(g.expires_at,{hour:'2-digit',minute:'2-digit',hourCycle:'h23'}):'00:00'});S.focus='[data-form="'+change+'"] input';rerender(ui);},{'data-action':'change-grant','data-grant':g.grant_id}),
   button('Remove access…',()=>preview(ui,revoke,'grant',g.member_id,g.grant_id,{action:'revoke',grant_id:g.grant_id},'[data-action=revoke-grant][data-grant="'+g.grant_id+'"]'),{'data-action':'revoke-grant','data-grant':g.grant_id})):null),{display:'grid',gap:'4px',padding:'10px 0',borderBottom:'1px solid var(--line)'});
 const form=S.drafts[change]?.open||S.flows[change]?grantForm(ui,change,g):null;
 const label=()=>'remove '+(g.grantee_id===me()?'your':person(g.grantee_id)+'’s')+' access to '+whose(g.member_id)+' records';
 box.append(...[form,alertFor(revoke),flowPanel(ui,revoke,'Check and confirm removing access',grantSummary,label,res=>{S.flash=said(res,cap(g.grantee_id===me()?'you':person(g.grantee_id))+' no longer '+(g.grantee_id===me()?'have':'has')+' access to '+whose(g.member_id)+' records.',label);},{member:g.member_id,need:'grant'})].filter(Boolean));
 return box;
}
function grantSummary(f){
 const c=f.changes,state=x=>x?(x.state==='revoked'?'removed':SCOPE[x.scope]+(x.expires_at?' until '+at(x.expires_at):', no end date')):'no access';
 const g=S.grants.find(x=>x.grant_id===f.args.grant_id),owner=f.args.member_id||g?.member_id,grantee=f.args.grantee_id||g?.grantee_id;
 return el('div',{},metadata('Records of',owner===me()?'Your records':person(owner)),el('div',{class:'metadata-line'},el('span',{},'Person'),el('strong',{},member(grantee)?person(grantee):'A person whose records you cannot see',member(grantee)?null:ref(grantee))),
  el('div',{class:'metadata-line','data-before':JSON.stringify(c.before)},el('span',{},'Now'),el('strong',{},state(c.before))),
  el('div',{class:'metadata-line','data-after':JSON.stringify(c.after)},el('span',{},'After you confirm'),el('strong',{},state(c.after))));
}
function zonedIso(date,time){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||!/^\d{2}:\d{2}$/.test(time||''))return {error:'Choose an end date.'};
 const parts=t=>Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:ZONE,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(new Date(t)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
 const offset=t=>{const p=parts(t);return Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second)-Math.floor(t/1000)*1000;};
 const [y,m,d]=date.split('-').map(Number),[h,mi]=time.split(':').map(Number),want=Date.UTC(y,m-1,d,h,mi);
 const found=[...new Set([-1,0,1].map(k=>offset(want+k*86400000)))].map(o=>want-o).filter(t=>{const p=parts(t);return +p.year===y&&+p.month===m&&+p.day===d&&+p.hour===h&&+p.minute===mi;}).sort((a,b)=>a-b);
 if(!found.length)return {error:'There is no '+time+' on '+date+' in Eastern Time (the clocks change that night). Choose another time.'};
 const o=offset(found[0])/60000,abs=Math.abs(o),pad=n=>String(n).padStart(2,'0');
 return {iso:date+'T'+time+':00'+(o<0?'-':'+')+pad(Math.floor(abs/60))+':'+pad(abs%60)};
}
function people(memberId){
 const ids=new Set([...S.members.map(m=>m.member_id),...S.grants.flatMap(g=>[g.grantee_id,g.grantor_id])]);ids.delete(memberId);return [...ids].sort();
}
function grantForm(ui,key,existing){
 const d=S.drafts[key]||{},f=S.flows[key],owners=S.members.filter(m=>canGrant(m.member_id));
 const owner=existing?existing.member_id:(d.member_id&&owners.some(m=>m.member_id===d.member_id)?d.member_id:owners[0]?.member_id);
 const ownerSelect=existing?null:el('select',{'aria-label':'Whose records','data-field':'member_id','data-focus':key+'-member'},...owners.map(m=>el('option',{value:m.member_id},m.name+(m.powers.includes('self')?' (you)':''))));
 if(ownerSelect){ownerSelect.value=owner||'';ownerSelect.addEventListener('change',()=>{edit(ui,key,ownerSelect.value,{member_id:ownerSelect.value,grantee:'',other:''});rerender(ui);});}
 const choices=people(owner).filter(id=>id!==me()),grantee=existing?existing.grantee_id:d.grantee||'';
 const granteeSelect=existing?null:el('select',{'aria-label':'Person','data-field':'grantee','data-focus':key+'-grantee'},el('option',{value:''},'Choose a person'),...choices.map(id=>el('option',{value:id},member(id)?person(id):'A person whose records you cannot see (reference '+id+')')),el('option',{value:'other'},'Someone else (enter their member ID)'));
 const other=existing?null:el('input',{type:'text','aria-label':'Member ID','data-field':'other','data-focus':key+'-other',placeholder:'Member ID, for example m-4',maxlength:'80'});
 if(granteeSelect){granteeSelect.value=grantee;granteeSelect.addEventListener('change',()=>{edit(ui,key,owner,{member_id:owner,grantee:granteeSelect.value});rerender(ui);});other.value=d.other||'';other.addEventListener('input',()=>edit(ui,key,owner,{member_id:owner,other:other.value}));}
 const scope=f?f.args.scope:d.scope||existing?.scope||'view';
 const ends=d.ends??!!existing?.expires_at;
 const endBox=el('input',{type:'checkbox','data-field':'ends','data-focus':key+'-ends'});endBox.checked=!!ends;
 endBox.addEventListener('change',()=>{edit(ui,key,owner,{member_id:owner,ends:endBox.checked,endEdited:true});rerender(ui);});
 const date=el('input',{type:'date','aria-label':'End date','data-field':'end-date','data-focus':key+'-date'}),time=el('input',{type:'time','aria-label':'End time','data-field':'end-time','data-focus':key+'-time'});
 date.value=d.date||'';time.value=d.time||'';
 date.addEventListener('input',()=>edit(ui,key,owner,{member_id:owner,date:date.value,endEdited:true}));time.addEventListener('input',()=>edit(ui,key,owner,{member_id:owner,time:time.value,endEdited:true}));
 const build=()=>{
  const d=S.drafts[key]||{};
  if(!owner)return {error:'You can give access only to your own records or a child’s.'};
  const g=existing?existing.grantee_id:(grantee==='other'?String(d.other||'').trim():grantee);
  if(!g)return {error:'Choose who gets access.'};
  if(!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(g))return {error:'Enter a member ID such as m-4.'};
  if(g===owner)return {error:'Members already have full access to their own records.'};
  let expires=null;
  if(existing&&!d.endEdited)expires=existing.expires_at;
  else if(d.ends??!!existing?.expires_at){if(!d.date)return {error:'Choose an end date, or untick “Access ends on a date”.'};const z=zonedIso(d.date,d.time||'23:59');if(z.error)return {error:z.error};expires=z.iso;}
  return {args:{action:'grant',member_id:owner,grantee_id:g,scope:d.scope||existing?.scope||'view',...(expires?{expires_at:expires}:{})}};
 };
 const label=()=>'change access to '+whose(owner)+' records';
 const done=res=>{const g=res.grant;S.flash=said(res,(member(g.grantee_id)?Person(g.grantee_id):'The person you chose')+' can now '+SCOPE[g.scope]+' '+whose(g.member_id)+' records'+(g.expires_at?' until '+at(g.expires_at):'')+'.',label);};
 const closeTrigger=existing?'[data-action=change-grant][data-grant="'+existing.grant_id+'"]':null;
 return css(el('div',{'data-form':key},el('strong',{},existing?'Change '+(member(existing.grantee_id)?person(existing.grantee_id)+'’s':'this')+' access':'Give someone access'),
  existing?null:el('label',{class:'field'},el('span',{},'Whose records'),ownerSelect),
  existing?null:el('label',{class:'field'},el('span',{},'Person'),granteeSelect,grantee==='other'?other:null),
  radios(key,owner,existing?.grant_id||null,'scope','Access',{view:'View: read claims, explanations of benefits, authorizations, appeals and amounts',act:'Act: view, plus answer the plan’s questions, ask for expedited review and file, support or withdraw appeals'},scope,ui),
  choiceLabel(endBox,'Access ends on a date'),ends?css(el('div',{class:'fields'},el('label',{class:'field'},el('span',{},'End date'),date),el('label',{class:'field'},el('span',{},'End time (Eastern Time, optional)'),time,el('small',{},'Leave the time empty for the end of that day (11:59 PM).'))),{marginTop:'6px'}):null,
  f?null:previewButton(ui,key,'Preview access change',build,'grant',owner,existing?.grant_id||null,GRANT_PLAIN),f?null:alertFor(key),
  existing&&!f?el('div',{class:'form-actions'},button('Close',()=>{discard(key,false);S.focus=closeTrigger;rerender(ui);},{'data-action':'close-change'})):null,
  flowPanel(ui,key,'Check and confirm the access change',grantSummary,label,done,{member:owner,need:'grant'},GRANT_PLAIN)),{display:'grid',gap:'8px',marginTop:'10px'});
}
function householdList(ui){
 if(!ui.has(T.members))return unavailable('Reading members');
 const box=el('div',{'data-list':'members'});
 for(const m of S.members)box.append(row({'data-member-row':m.member_id},null,m.name,RELATION[m.relation]+(m.is_minor?' · minor':'')+' · '+m.powers.map(p=>POWER[p]).join(', '),'Enrolled '+m.enrolled_years.join(', ')));
 box.append(css(muted('You see the members whose records you may read: yourself, children you are a guardian of, and anyone who has given you access.'),{padding:'10px 22px'}));
 return box;
}
function householdView(ui){
 const all=[...S.approvals.values()].flat();
 const byMember=S.members.map(m=>({m,grants:S.grants.filter(g=>g.member_id===m.member_id)}));
 const others=S.grants.filter(g=>!member(g.member_id));
 const canGive=S.members.some(m=>canGrant(m.member_id))&&ui.has(FLOW.grant.preview)&&ui.has(FLOW.grant.confirm);
 return el('article',{'data-view':'household'},muted('Household'),el('h2',{},'Access to records'),
  muted('Each adult’s records are private. A view grant lets someone read them; an act grant also lets them answer the plan’s questions and handle appeals. Changes need your approval.'),
  orphanNote(all),
  ui.has(T.grants)?byMember.map(({m,grants})=>el('div',{'data-grants-of':m.member_id},heading(m.member_id===me()?'Your records':m.name+'’s records'),grants.length?grants.map(g=>grantLine(ui,g)):muted('Nobody else has been given access.'))):unavailable('Reading access grants'),
  others.length?[heading('Other grants you can see'),others.map(g=>grantLine(ui,g))]:null,
  canGive?css(el('div',{},heading('Give access'),grantForm(ui,K('give'),null)),{marginTop:'8px'}):null);
}

function unknownBanner(ui){
 const u=S.unknown;
 const dismiss=button('Dismiss',()=>{if(S.busy)return;S.unknown=null;S.error=null;rerender(ui).then(showOutcome);},{'data-action':'dismiss-unknown'});
 if(u.hidden||u.reset)return css(panel('Waiting for Larkfield',{'data-unknown':u.reset?'reset':'hidden'},el('p',{},!u.reset?'Larkfield did not confirm an earlier request about records this account can no longer see or change, so it may or may not have taken effect. It cannot be retried from this page. Dismiss it to continue; other changes wait until then.':'Larkfield was reset or reloaded after an earlier request that it did not confirm, so whether that request took effect cannot be confirmed. It is not sent again. Check the records, then dismiss it; other changes wait until then.'),
  alertFor('unknown'),el('div',{class:'form-actions'},dismiss)),{margin:'18px 24px 0'});
 return css(panel('Waiting for Larkfield',{'data-unknown':'open'},el('p',{},'Larkfield did not confirm the request to '+labelOf(u.label)+' ('+u.reason+'), so it may or may not have taken effect. Retry sends exactly the same request again: it takes effect at most once, and the page then says which happened. Other changes wait until this is settled.'),
  alertFor('unknown'),el('div',{class:'form-actions'},dismiss,
   ui.has(u.name)?button('Retry',()=>act(ui,'unknown',()=>retryUnknown(ui),true),{class:'primary','data-action':'retry-unknown'}):null)),{margin:'18px 24px 0'});
}
function banner(ui){
 const box=(content,attrs)=>css(el('div',attrs,...content),{...NOTE,margin:'18px 24px 0',display:'flex',gap:'12px',alignItems:'center',flexWrap:'wrap'});
 return el('div',{},S.unknown?unknownBanner(ui):null,!S.unknown&&S.error?.scope==='unknown'?css(el('div',{},alertFor('unknown'),el('div',{class:'form-actions'},button('Dismiss',()=>{S.error=null;rerender(ui).then(showOutcome);},{'data-action':'dismiss-error'}))),{margin:'18px 24px 0'}):null,
  S.stale?box([el('p',{},'Your last change was saved, but the page could not load Larkfield’s latest state. Press Refresh before changing anything else.')],{role:'status','data-stale':'true'}):null,
  S.notices.length?box([css(el('div',{},...S.notices.map(n=>el('p',{},n.text,n.ref?' ':'',ref(n.ref)))),{display:'grid',gap:'6px',flex:'1 1 240px'}),button('Dismiss',()=>{S.notices=[];rerender(ui);},{'data-action':'dismiss-notice'})],{role:'status','data-notice':'true'}):null,
  S.error?.scope==='notice'?css(el('div',{},alertFor('notice'),el('div',{class:'form-actions'},button('Dismiss',()=>{S.error=null;rerender(ui).then(showOutcome);},{'data-action':'dismiss-error'}))),{margin:'18px 24px 0'}):null,
  S.flash&&S.flashSection===ui.section?css(el('p',{role:'status','data-flash':'true'},S.flash),{margin:'18px 24px 0',color:'var(--accent)',fontWeight:'600',fontSize:'13px'}):null);
}
function shell(){
 const badge=document.querySelector('.collection-count');if(badge)css(badge,{display:'none'});
 const nav=document.querySelector('.sidebar nav');if(nav)css(nav,{flexWrap:'wrap'});
 const records=document.getElementById('records');if(records)css(records,{maxHeight:'none',overflow:'visible'});
 const narrow=matchMedia('(max-width: 760px)').matches;
 const side=document.querySelector('.sidebar');if(side)css(side,narrow?{position:'',top:'',height:'',overflowY:''}:{position:'sticky',top:'0',height:'100vh',overflowY:'auto',alignSelf:'start'});
 const search=document.querySelector('.toolbar input[type=search]');if(search)search.placeholder=narrow?'Search':'Search claims, authorizations and appeals';
 const who=member(me()),foot=document.querySelector('.sidebar-foot');
 if(who&&foot){const strong=foot.querySelector('strong'),small=foot.querySelector('small'),mark=foot.querySelector('.avatar');if(strong)strong.textContent=who.name;if(small)small.textContent='Signed in · account holder';if(mark)mark.textContent=who.name.split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase();}
 for(const b of document.querySelectorAll('#app button,#app summary,#app select,#app textarea,#app input:not([type=radio]):not([type=checkbox]),#app label[data-choice]'))b.style.minHeight=narrow?'44px':'';
}

mount({
 id:'larkfield-health',title:'Larkfield',symbol:'✚',searchLabel:'Search claims, authorizations and appeals',initialSection:'claims',
 list:T.members,collection:'none',get:T.members,item:'members',heading:()=>'Larkfield',actions:[],load,
 sections:()=>{const open=S.claims.filter(c=>c.status==='pending_info').length;return [{id:'claims',label:'Claims'+(open?' ('+open+' waiting)':''),symbol:'≡',count:false},{id:'pas',label:'Prior authorizations',symbol:'◇',count:false},{id:'appeals',label:'Appeals',symbol:'⚑',count:false},{id:'plan',label:'Plan & costs',symbol:'▤',count:false},{id:'household',label:'Household',symbol:'◉',count:false}];},
 renderList:(shown,ui)=>{shell();if(!S.loaded)return el('div');
  const s=ui.section;if(s==='claims'&&!S.sel.claims){const first=S.claims.filter(mine).sort((a,b)=>(a.status==='pending_info'?0:1)-(b.status==='pending_info'?0:1)||Date.parse(b.received_at)-Date.parse(a.received_at))[0];if(first)S.sel.claims=first.claim_id;}
  if(s==='pas'&&!S.sel.pas)S.sel.pas=[...S.pas].filter(mine).sort((a,b)=>Date.parse(b.submitted_at)-Date.parse(a.submitted_at))[0]?.pa_id||null;
  if(s==='appeals'&&!S.sel.appeals)S.sel.appeals=[...S.appeals].filter(mine).sort((a,b)=>Date.parse(b.filed_at)-Date.parse(a.filed_at))[0]?.appeal_id||null;
  return s==='pas'?paList(ui):s==='appeals'?appealList(ui):s==='plan'?planList(ui):s==='household'?householdList(ui):claimList(ui);},
 emptyView:ui=>{queueMicrotask(shell);if(!S.loaded)return el('div',{class:'empty'},el('h3',{},'Loading…'));const s=ui.section;
  return el('div',{},banner(ui),s==='pas'?paView(ui):s==='appeals'?appealView(ui):s==='plan'?planView(ui):s==='household'?householdView(ui):claimView(ui));}
});
const outcome=()=>S.unknown||['unconfirmed','unconfirmed_pending','connection_lost','request_failed'].includes(S.error?.code)?CANNOT:S.error?NOTHING:null;
matchMedia('(max-width: 760px)').addEventListener('change',shell);
const status=document.getElementById('status');
if(status)new MutationObserver(()=>{
 const now=status.textContent;
 if(S.busy&&now!=='Working…'){queueMicrotask(lock);return;}
 if(status.dataset.error==='true'&&![...NEUTRAL,CANNOT,NOTHING,UNREACH,UNREACH_PENDING,S.refreshText].includes(now)){
  S.refreshFailed=true;S.refreshNetwork=/failed to fetch|networkerror|load failed|network error/i.test(now);S.refreshText=S.refreshNetwork?UNREACH:now;
  const next=failedStatus();if(next!==now)status.textContent=next;return;
 }
 if(now==='All changes saved'){S.refreshFailed=false;S.refreshText=null;const o=outcome();status.textContent=o||(S.justSaved?'Saved':'Up to date');if(o)status.dataset.error='true';status.dataset.settled='true';}
 else if(![...NEUTRAL,CANNOT,NOTHING].includes(now))delete status.dataset.settled;
}).observe(status,{childList:true,characterData:true,subtree:true});
