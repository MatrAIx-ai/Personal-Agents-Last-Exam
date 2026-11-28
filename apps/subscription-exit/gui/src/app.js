import {el} from '/shared/client.js';
const root=document.querySelector('#app'),area=el('section',{class:'detail','aria-label':'Subscription workspace'}),message=el('p',{role:'status','aria-live':'polite'}),nav=el('nav',{class:'actions','aria-label':'Navigation'});
root.replaceChildren(el('header',{class:'contact-hero'},el('div',{},el('p',{class:'kicker'},'ECHO ARBOR'),el('h1',{},'Subscription Exit'),el('p',{class:'muted'},'Manage a fictional plan. No payments or live subscriptions.'))),nav,area);
Object.assign(root.style,{width:'min(100%, 62rem)',margin:'0 auto',padding:'clamp(1rem, 4vw, 2.5rem)'});
const prefix='subscription-exit.', names={paid_active:'Paid · active',cancellation_scheduled:'Paid until scheduled end',free:'Free · paid access ended'};
const labels={cancel:'Cancellation scheduled',revoke:'Cancellation withdrawn'};
const fmt=new Intl.DateTimeFormat('en-US',{dateStyle:'long',timeStyle:'short',timeZone:'UTC'});
const dateFmt=new Intl.DateTimeFormat('en-US',{dateStyle:'long',timeZone:'UTC'});
const date=t=>dateFmt.format(new Date(t)), time=t=>fmt.format(new Date(t));
let csrf,allowed=new Set(),selected=null,receiptId=null,view='Overview',generation=0,writing=false;
const say=s=>{message.textContent=s;},button=(label,fn)=>el('button',{type:'button',onclick:()=>Promise.resolve().then(fn).catch(e=>say(friendly(e)))},label);
const possible=n=>allowed.has(prefix+n);
const friendly=e=>({
 stale_version:'The workspace changed. Refresh and review the current subscription.',
 stale_preview:'That preview is out of date. Refresh and start a new preview if needed.',
 period_outside_scenario:'The final billing date has passed. No further changes are available here.',
 cancellation_already_scheduled:'A cancellation is already scheduled for this plan.',
 no_pending_cancellation:'There is no scheduled cancellation to withdraw.',
 free_account:'Paid access already ended. There is no subscription to cancel.',
 not_found:'This subscription item is no longer available.',
 permission_denied:'This account view does not allow that action.',
 not_open:'This preview was already closed.',
 already_confirmed:'This change was already confirmed. Check Status and receipts.'
}[e.code]||'The change could not be completed. Refresh to check your subscription before trying again.');
async function http(url,data){
 const r=await fetch(url,data?{method:'POST',headers:{'Content-Type':'application/json','X-Pale-CSRF':csrf||''},body:JSON.stringify(data)}:{});
 if(!r.ok)throw Error('The Web Host did not acknowledge this operation.');
 return r.json();
}
async function call(op,args={}){
 if(!possible(op))throw Object.assign(Error(),{code:'permission_denied',confirmedError:true});
 const r=await http('/api/call',{name:prefix+op,arguments:args});
 if(!['ok','committed'].includes(r.status))throw Object.assign(Error(r.message||r.status),{confirmedError:true,code:r.status});
 return r;
}
const mutedStyle={color:'#344057',fontSize:'14px'};
const paint=(tag,props,...kids)=>{const n=el(tag,props,...kids);Object.assign(n.style,mutedStyle);return n;};
Object.assign(root.querySelector('.kicker').style,mutedStyle);
function card(label,...content){
 const node=el('article',{},paint('p',{class:'kicker'},label),...content);
 Object.assign(node.style,{padding:'1.35rem',marginBlock:'0.85rem',border:'1px solid var(--line)',borderRadius:'0.85rem',background:'#f9fbff'});
 return node;
}
function available(x){
 const e=x.entitlement;
 return e.access==='paid'&&(!e.transition_consumed||Date.parse(x.virtual_now)<Date.parse(e.period_end));
}
const money=plan=>new Intl.NumberFormat('en-US',{style:'currency',currency:plan.currency,currencyDisplay:'code'}).format(plan.renewal_minor/100);
const eventNames={subscription_started:'Paid subscription started',period_started:'New billing period started',cancellation_scheduled:'Cancellation scheduled',cancellation_revoked:'Cancellation withdrawn',paid_access_ended:'Paid access ended',plan_reviewed:'Reviewed account and billing'};
function statusBlock(x,plan){
 const e=x.entitlement;
 const title=el('h3',{},plan?(e.access==='paid'?plan.name+' plan':'Free plan'):'Plan status');
 const detail=e.entitlement==='free'?(e.effective_end?'Paid access ended on '+date(e.effective_end)+'.':'This account has not started a paid subscription.'):e.entitlement==='cancellation_scheduled'?'Your paid access continues until '+date(e.effective_end)+'.':'Current billing period ends '+date(e.period_end)+'.';
 const badge=el('p',{class:'tag'},e.entitlement==='free'&&!e.effective_end?'Free plan':names[e.entitlement]);
 badge.style.fontSize='13px';
 const cardNodes=[title,badge,el('p',{},detail)];
 if(plan&&e.access==='paid'){
   cardNodes.push(el('p',{class:'muted'},money(plan)+' per month (simulated; no charge)'));
 }
 if(e.entitlement==='paid_active'&&e.transition_consumed&&!available(x))cardNodes.push(el('p',{class:'muted'},'This simulation ends at the last billing date. No further subscription changes are available.'));
 const saved=card('YOUR LIBRARY',el('h3',{},'Saved entries'),el('ul',{},e.saved.map(v=>el('li',{},el('span',{},v.title),paint('small',{},' · Saved '+date(v.saved_at)+' (UTC)')))));
 return [card('YOUR PLAN',...cardNodes),saved];
}
function write(bar,label,op,args,version,token,done,style='primary'){
 if(!possible(op))return;
 let pending;const b=button(label,async()=>{
  if(writing||token!==generation)return;
  pending??={...args,expected_version:version,request_id:crypto.randomUUID()};
  writing=true;for(const node of bar.querySelectorAll('button'))node.disabled=true;
  try{const out=await call(op,pending);if(generation===token)await done(out);}
  catch(e){
   if(generation!==token)return;
   if(e.confirmedError){say(friendly(e));return;}
   for(const node of bar.querySelectorAll('button'))node.disabled=false;
   b.textContent='Retry '+label;say('No acknowledgement. Retry the same request, or refresh to check its result.');
  }finally{writing=false;}
 });
 if(style!=='secondary')b.classList.add('primary');
 if(style==='destructive')Object.assign(b.style,{color:'#fff',background:'#a31930',borderColor:'#a31930'});
 bar.append(b);
}
async function display(target=view,notice=''){
 view=target;const token=++generation;
 for(const b of nav.querySelectorAll('[data-view]')){
   if(b.dataset.view===target)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');
 }
 area.replaceChildren(el('h2',{},target),message);say('');
 try{
  const x=await call(target==='Overview'?'read_plan':'read_status');if(token!==generation)return;
  const bar=el('div',{class:'actions'});
  area.append(paint('p',{class:'account-clock'},'Account holder: '+x.account_name+' · Simulated date: '+time(x.virtual_now)+' UTC. All dates and billing cutoffs use UTC.'));
  if(target==='Overview'){
   area.append(...statusBlock(x,x.plan));
   const action=x.entitlement.entitlement==='cancellation_scheduled'?'revocation':'cancellation';
   if(available(x))write(bar,action==='revocation'?'Prepare withdrawal':'Prepare cancellation','prepare_'+action,{},x.version,token,async r=>{selected=r.preview.id;await display('Preview','Preview prepared. No entitlement change.');});
  }else if(target==='Preview'){
   const p=x.open_previews.find(p=>p.id===selected);
   if(p){
    area.append(card('REVIEW CHANGE',el('h3',{},p.action==='cancel'?'Review cancellation':'Review withdrawal'),el('p',{},p.action==='cancel'?'Your paid access will continue until '+date(x.entitlement.period_end)+'. Your saved entries will stay in your library.':'Withdraw the scheduled cancellation to keep paid access after '+date(x.entitlement.period_end)+' (UTC). Your plan is '+money(x.plan)+' per month (simulated; no charge).')));
    write(bar,p.action==='cancel'?'Confirm cancellation':'Confirm withdrawal','confirm',{preview_id:p.id},x.version,token,async r=>{receiptId=r.receipt.id;await display('Status and receipts','Confirmation recorded.');},p.action==='cancel'?'destructive':'primary');
    write(bar,'Abandon preview','abandon',{preview_id:p.id},x.version,token,async()=>{selected=null;await display('Status and receipts','Preview abandoned. No entitlement change.');},'secondary');
   }else{
    area.append(...statusBlock(x),el('p',{},selected?'That preview is no longer current. Start again from Overview.':'No current preview selected.'));
    for(const [index,p] of x.open_previews.entries())bar.append(button((p.action==='cancel'?'Open cancellation preview':'Open withdrawal preview')+' · '+time(p.created_at)+' · '+(index+1),()=>{selected=p.id;return display('Preview');}));
   }
  }else{
   area.append(...statusBlock(x,x.plan));
   const history=x.history.slice().reverse();
   area.append(card('ACCOUNT HISTORY',el('h3',{},'Subscription history'),history.length?el('ul',{},history.map(r=>el('li',{},eventNames[r.kind]+' · '+time(r.at)+' UTC'))):el('p',{},'No subscription history at this date.')));
   if(receiptId){
    const r=await call('read_receipt',{receipt_id:receiptId});if(token!==generation)return;
    area.append(card('CONFIRMATION',el('h3',{},labels[r.receipt.action]),el('p',{},'Confirmed '+time(r.receipt.confirmed_at)+'.'),el('p',{},'Billing boundary: '+date(r.receipt.effective_at)),el('p',{class:'muted'},'Receipt reference '+r.receipt.id)));
   }
   for(const [index,receipt] of x.receipts.entries())bar.append(button('View '+(receipt.action==='cancel'?'cancellation':'withdrawal')+' receipt · '+time(receipt.confirmed_at)+' · '+(index+1),()=>{receiptId=receipt.id;return display('Status and receipts');}));
  }
  area.append(bar,message);if(notice)say(notice);
 } catch(e){if(token===generation)say(friendly(e));}
}
async function init(){
 const token=new URLSearchParams(location.hash.slice(1)).get('access');if(token)history.replaceState(null,'',location.pathname);
 ({csrf}=await http('/session',token?{token}:undefined));
 allowed=new Set((await http('/api/tools')).tools.map(t=>t.name));
 for(const page of ['Overview','Preview','Status and receipts']){
  const b=button(page,()=>display(page));b.dataset.view=page;nav.append(b);
 }
 nav.append(button('Refresh view',()=>display()));await display();
}
init().catch(e=>{area.append(message);say(friendly(e));});
