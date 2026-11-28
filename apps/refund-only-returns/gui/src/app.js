import {el} from '/shared/client.js';
// Web Host serves the App controller and the shared baseline CSS; declare the scoped layout here.
const layout=new CSSStyleSheet();
layout.replaceSync(`
#app { width:min(calc(100% - 32px),1120px); margin:0 auto; color:#22233b; font-size:16px; }
#app .toolbar { padding:22px 0; }
#app .brand small { color:#514c66; font-size:14px; }
#app article { padding:clamp(14px,3vw,28px); }
#app nav.actions { gap:8px; display:flex; justify-content:flex-start; margin:0 0 24px; }
#app button { font-size:14px; min-height:44px; }
#app button[aria-current] { box-shadow:inset 0 -3px #614bd6; font-weight:700; }
#app button:focus-visible,#app input:focus-visible { outline:3px solid #583dd2; outline-offset:3px; }
#app input { font-size:16px; min-height:44px; }
#app h2 { font-size:clamp(1.5rem,3vw,2rem); margin:0 0 18px; }
#app h2:focus { outline:none; }
#app h3 { font-size:18px; margin:0 0 12px; }
#app p,#app small { line-height:1.55; }
#app .quiet,#app .metadata-line span,#app small { color:#514c66; font-size:14px; }
#app .metadata-line { font-size:14px; flex-wrap:wrap; gap:4px 16px; }
#app .tag { background:#ede8ff; color:#3d2b85; min-height:28px; font-size:13px; }
#app .form-error { color:#9a2638; font-size:14px; }
#app .form-error:empty { display:none; }
#app .result { padding:12px 16px; border:1px solid #68a688; border-radius:8px; background:#eef8f1; color:#12593b; font-weight:650; font-size:16px; margin:0 0 18px; }
#app .result[hidden] { display:none; }
#app .lookup-panel { max-width:32rem; }
#app .portal-grid { display:grid; grid-template-columns:minmax(0,1.35fr) minmax(0,1fr); align-items:start; gap:clamp(12px,2vw,22px); }
#app .portal-card { background:white; min-width:0; border:1px solid #dfdbea; border-radius:12px; padding:clamp(14px,2vw,24px); }
#app .portal-summary { background:#f7f4ff; }
#app .portal-summary .amount { margin:4px 0 12px; color:#312064; font-size:clamp(1.75rem,4vw,2.5rem); font-weight:750; line-height:1.1; }
#app .portal-actions { display:grid; gap:10px; margin-top:16px; }
#app .portal-actions button { width:100%; }
#app .next { background:#f6f3fe; border-radius:8px; padding:14px; margin-top:18px; }
#app .next h3 { margin:0 0 6px; }
#app .next p { margin:0; }
@media (max-width:620px) { #app .portal-grid { grid-template-columns:minmax(0,1fr); } #app .toolbar { padding:16px 0; } }
`);
document.adoptedStyleSheets=[...document.adoptedStyleSheets,layout];
const root=document.querySelector('#app'),stage=el('section',{'aria-label':'Refund request workspace'}),status=el('p',{role:'status','aria-live':'polite',class:'result'}),nav=el('nav',{class:'actions','aria-label':'Navigation'});
status.hidden=true;
root.replaceChildren(
 el('header',{class:'toolbar'},el('div',{class:'brand'},el('span',{class:'brand-mark','aria-hidden':'true'},'↶'),el('div',{},el('h1',{},'Refund-only Returns'),el('small',{},'Paperfield Goods · fictional storefront')))),
 el('section',{class:'detail'},el('article',{},nav,status,stage)));
let csrf,tools=new Set(),orderId=null,orderNumberValue='',requestId=null,view='Order lookup',generation=0;
const app='refund-only-returns.';
const say=s=>{status.textContent=s;status.hidden=!s;};
const can=n=>tools.has(app+n);
const btn=(label,action,kind='')=>el('button',{type:'button',class:kind,onclick:()=>Promise.resolve().then(action).catch(()=>say('Could not open this view. Please refresh.'))},label);
async function http(path,body){
 const r=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json','X-Pale-CSRF':csrf||''},body:JSON.stringify(body)}:{});
 const d=await r.json();if(!r.ok)throw Object.assign(Error(d.error||'Host request failed.'),{known:true});return d;
}
async function call(op,args){
 if(!can(op))throw Object.assign(Error('Operation is unavailable in this session.'),{known:true});
 const r=await http('/api/call',{name:app+op,arguments:args});
 if(!['ok','committed'].includes(r.status))throw Object.assign(Error(r.message||r.status),{known:true,code:r.status});
 return r;
}
const eligibility=(o,requests)=>requests.some(q=>q.status==='dispatched')?'Request already dispatched':({eligible:'Eligible for refund request',expired:'Return deadline passed',ineligible:'Not eligible',already_requested:'An active request already exists'})[o.eligibility];
const fmtTime=new Intl.DateTimeFormat(navigator.languages,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
const date=x=>fmtTime.format(new Date(x));
const money=o=>new Intl.NumberFormat(navigator.languages,{style:'currency',currency:o.currency,currencyDisplay:'narrowSymbol'}).format(o.refund_minor/100);
const orderNumber=o=>o.order_number?'#'+o.order_number:o.id;
const requestName=q=>q.attempt?'Request '+q.attempt:'Refund request';
const statusName=s=>({draft:'Preview',confirmed:'Confirmed',cancelled:'Cancelled',discarded:'Discarded preview',dispatched:'Dispatched'})[s];
const field=(k,v)=>el('div',{class:'metadata-line'},el('span',{},k),el('strong',{},v));
const guidance=o=>!o.refundable?'This item is excluded by the store’s return policy. Check your order confirmation or look up a different order.':o.deadline_passed?'The refund request window for this item has closed. Check your order confirmation or look up another order.':'';
const details=(o,requests=[])=>el('section',{class:'portal-card','aria-label':'Order summary'},
 el('h3',{},o.item_name),
 el('div',{class:'tags'},el('span',{class:'tag'},eligibility(o,requests))),
 field('Order number',orderNumber(o)),field('Ordered',date(o.ordered_at)),field('Return deadline',date(o.return_deadline)),
 guidance(o)&&el('p',{class:'quiet'},guidance(o))||null);
const amount=o=>[el('div',{class:'quiet'},'Fixed refund amount'),el('div',{class:'amount'},money(o))];
const nextBlock=message=>el('div',{class:'next'},el('h3',{},'What happens next'),el('p',{},message));
function enterView(target){
 view=target;document.title=target+' · Refund-only Returns';
 for(const n of nav.querySelectorAll('button[data-view]')){
  if(n.dataset.view===target)n.setAttribute('aria-current','page');else n.removeAttribute('aria-current');
 }
 const h=el('h2',{tabindex:'-1'},target);stage.replaceChildren(h);return h;
}
const permittedErrors=new Set(['preview_exists','return_expired','ineligible','already_requested','already_dispatched','not_draft','not_confirmed','capacity_reached','not_found','permission_denied']);
const explain=e=>e.code==='stale_version'?'The workspace changed. Refresh and review before retrying.':permittedErrors.has(e.code)?e.message:'Could not complete that action. Refresh and check the current request.';

function write(area,label,n,args,version,token,done){
 if(!can(n))return;
 let pending,busy=false,finished=false;
 const error=el('p',{class:'form-error','aria-live':'polite'});
 const b=btn(label,async()=>{
  if(busy||finished||token!==generation||!area.isConnected)return;
  pending??={...args,expected_version:version,request_id:crypto.randomUUID()};
  error.textContent='';
  busy=true;const neighbors=[...area.querySelectorAll('button')].filter(x=>x!==b);for(const x of [b,...neighbors])x.disabled=true;
  try{const r=await call(n,pending);finished=true;if(token===generation)await done(r);}
  catch(e){
   if(token!==generation)return;
   if(e.known){finished=true;error.textContent=explain(e);}
   else{b.textContent='Retry '+label;error.textContent='No acknowledgement. Retry the same action or refresh to verify the current request.';}
  }finally{busy=false;b.disabled=finished;for(const x of neighbors)x.disabled=false;}
 },/^(Confirm|Prepare)/.test(label)?'primary':'');
 area.append(b,error);
}
async function render(target=view,notice='',moveFocus=true){
 const token=++generation;let h=enterView(target);say('');
 if(target==='Order lookup'){
  const input=el('input',{id:'order-id',type:'text',autocomplete:'off','aria-describedby':'order-help order-error'});input.value=orderNumberValue||'';
  const error=el('p',{id:'order-error',class:'form-error','aria-live':'polite'});
  const invalid=s=>{input.setAttribute('aria-invalid','true');error.textContent=s;};
  input.addEventListener('input',()=>{input.removeAttribute('aria-invalid');error.textContent='';});
  const form=el('form',{class:'fields lookup-panel'},el('div',{class:'field'},el('label',{for:'order-id'},'Order number'),input,el('small',{id:'order-help'},'Use the number from your order confirmation or Task instructions. A leading # is optional.'),error),el('div',{class:'actions'},el('button',{type:'submit',class:'primary'},'Find order')));
  form.addEventListener('submit',async e=>{
   e.preventDefault();const id=input.value.trim().replace(/^#\s*/,'');
   if(!/^(?:[0-9]{5,12}|[A-Za-z][A-Za-z0-9_-]{0,79})$/.test(id)){invalid('Enter a valid order number without internal spaces.');return;}
   input.removeAttribute('aria-invalid');error.textContent='';
   const op=++generation,button=form.querySelector('button');button.disabled=true;
   try{const r=await call('lookup_order',{order_id:id});if(op!==generation)return;orderId=r.order.id;orderNumberValue=orderNumber(r.order);requestId=null;await render('Order detail');}
   catch(e){if(op===generation)invalid(e.code==='not_found'?'No order matched that number in this account. Check it and try again.':explain(e));}
   finally{button.disabled=false;}
  });
  stage.append(form);if(notice)say(notice);if(moveFocus)h.focus();return;
 }
 if(!orderId)return render('Order lookup','Find an order first.');
 try{
  const bar=el('div',{class:'portal-actions'});
  if(target==='Order detail'){
   const r=await call('read_order',{order_id:orderId});if(token!==generation)return;
   const draft=r.requests.find(x=>x.status==='draft');
   if(draft)bar.append(btn('Review preview',()=>{requestId=draft.id;return render('Request review');}));
   else if(r.order.eligibility==='eligible')write(bar,'Prepare refund preview','prepare_preview',{order_id:orderId},r.version,token,async x=>{requestId=x.request.id;await render('Request review','Preview prepared. Nothing has been submitted.');});
   bar.append(...r.requests.filter(x=>x.status!=='draft').map(x=>btn('View '+requestName(x).toLowerCase()+' · '+statusName(x.status).toLowerCase(),()=>{requestId=x.id;return render('Request status');})));
   stage.append(el('div',{class:'portal-grid'},details(r.order,r.requests),el('section',{class:'portal-card portal-summary','aria-label':'Refund summary'},el('h3',{},'Refund summary'),amount(r.order),el('p',{class:'quiet'},r.policy.summary),bar)));
  }else{
   if(!requestId)return render('Order detail','Open a preview or request first.');
   const r=await call('read_request',{refund_request_id:requestId});if(token!==generation)return;
   const q=r.request,args={refund_request_id:q.id};
   if(target==='Request review'&&q.status!=='draft'){
    target='Request status';h=enterView(target);
   }
   if(q.status==='draft'&&target==='Request review'){
    if(r.order.eligibility==='eligible')write(bar,'Confirm refund request','confirm_request',args,r.version,token,()=>render('Request status','Refund request recorded. No payment was issued.'));
    write(bar,'Discard preview','discard_preview',args,r.version,token,()=>render('Order detail','Preview discarded. No refund request was submitted.'));
   }
   if(q.status==='confirmed'&&target==='Request status'&&can('cancel_request'))bar.append(btn('Cancel request…',()=>{
    const prompt=el('p',{tabindex:'-1'},'Cancel this refund request?');
    const confirm=el('div',{class:'portal-actions'},prompt,btn('Keep request',()=>render('Request status')));
    bar.replaceChildren(confirm);prompt.focus();write(confirm,'Confirm cancellation','cancel_request',args,r.version,token,()=>render('Request status','Refund request cancelled.'));
   }));
   const next={
    confirmed:'You can cancel this request before dispatch. No payment was issued.',
    cancelled:'No action is needed. If this order is still eligible, you can start a new request.',
    discarded:'This preview was never submitted. Open Order detail to start again.',
    dispatched:'Dispatched requests cannot be cancelled.'
   };
   const review=target==='Request review';
   const left=review?details(r.order):el('section',{class:'portal-card','aria-label':'Request progress'},
    el('h3',{},r.order.item_name),
    el('div',{class:'tags'},el('span',{class:'tag'},statusName(q.status))),
    field('Order number',orderNumber(r.order)),field('Return deadline',date(r.order.return_deadline)),
    field(q.submitted_at?'Submitted':'Request opened',date(q.submitted_at??q.created_at)),
    nextBlock(next[q.status]??'Open the preview to continue.'));
   const right=el('section',{class:'portal-card portal-summary','aria-label':'Refund summary'},
    el('h3',{},review?'Return summary':'Refund summary'),amount(r.order),
    review?el('p',{class:'quiet'},r.order.eligibility==='eligible'?'Confirming records this refund request. It does not issue a payment.':'This preview can be discarded, but it cannot be submitted.'):null,
    bar);
   stage.append(el('div',{class:'portal-grid'},left,right));
  }
  if(notice)say(notice);if(moveFocus)h.focus();
 }catch(e){if(token===generation){stage.append(el('p',{class:'form-error'},explain(e)));if(moveFocus)h.focus();}}
}
async function start(){
 const access=new URLSearchParams(location.hash.slice(1)).get('access');
 if(access)history.replaceState(null,'',location.pathname);
 ({csrf}=await http('/session',access?{token:access}:undefined));
 tools=new Set((await http('/api/tools')).tools.map(t=>t.name));
 for(const label of ['Order lookup','Order detail','Request review','Request status']){
  const b=btn(label,()=>render(label));b.dataset.view=label;nav.append(b);
 }
 nav.append(btn('Refresh view',()=>render(view,'',false)));
 await render(view,'',false);
}
start().catch(()=>say('Could not open this session. Use the access link from the Web Host.'));
