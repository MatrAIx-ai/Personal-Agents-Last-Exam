import {mount,el,date,time,tag,textBlock,metadata,download} from '/shared/client.js';
// Northlake Patient Portal: App-owned pages served by the shared Web Host over the fixed Agent MCP connection.
// This version ships the inbox and thread pages (secure messaging), the billing ledger, the claim page and the
// statement page. Provider search, booking and appointment pages are the next milestone. Every control calls the
// same northlake-portal.* tools an agent would, under the same policy; nothing here touches Infra operations.
const T='northlake-portal.';
const money=c=>(c<0?'-':'')+'$'+Math.floor(Math.abs(c)/100).toLocaleString('en-US')+'.'+String(Math.abs(c)%100).padStart(2,'0');
const toBytes=f=>Uint8Array.from(atob(f.base64),ch=>ch.charCodeAt(0));
const STATUS={in_adjudication:'With insurer',paid:'Insurer decided',denied:'Denied',reprocessing:'Resubmitted'};
const pane=()=>document.querySelector('.detail');
const mark=id=>{for(const b of document.querySelectorAll('#records [data-record-id]'))b.setAttribute('aria-pressed',String(b.dataset.recordId===id));};
let uiRef=null;
// A write in the billing pages triggers a refresh that resets the detail pane; the renderer queued here runs after it.
let pendingDetail=null;
const scheduleDetail=fn=>{pendingDetail=fn;};
// Deep links travel in the fragment, next to the Host's access token: /#page=billing&claim=<id>, /#page=statements&statement=<id>.
const params=new URLSearchParams(location.hash.slice(1));
// The Host's Content-Security-Policy allows no inline styles, so the App's own presentation rules are a constructed stylesheet.
const sheet=new CSSStyleSheet();
sheet.replaceSync(`
body[data-app=northlake-portal]{--accent:#1f6f8b;--soft:#e9f3f7}
body[data-app=northlake-portal] .record{display:block}
body[data-page=billing] .collection-count,body[data-page=statements] .collection-count{display:none}
.page .notice{background:#fff7e6;border:1px solid #f0d9a8;border-radius:10px;padding:10px 14px;margin:0 0 12px;font-size:13px;line-height:1.5}
.page .notice button{margin-left:8px}
.thread-row,.claim-row,.statement-row{display:flex;flex-direction:column;gap:4px;width:100%;text-align:left}
.thread-row.unread .record-title{font-weight:700}
.tag.warn{background:#fdecec;color:#9b2c2c}
.ledger-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:0 0 14px}
.stat{background:var(--soft);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:2px}.stat strong{font-size:20px}.stat small{color:#6e7c91;font-size:11px}.stat.actions{justify-content:center;align-items:flex-start}
.group-title{margin:14px 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6e7c91}
.plain{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:6px;font-size:13px}
.claim-paper,.thread-paper{padding:28px 36px;display:flex;flex-direction:column;gap:14px}
.amounts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 24px}
.history{padding-left:18px;font-size:13px;line-height:1.6;margin:0}.history time{color:#6e7c91;font-size:12px}
.message{border-top:1px solid #e6eaf0;padding-top:10px}.message.mine{background:var(--soft);border-radius:10px;padding:10px 14px;border-top:0}.message .note-date{font-size:12px;color:#6e7c91;margin-bottom:4px}
.pay-panel .field{display:flex;flex-direction:column;gap:6px;max-width:320px}.pay-panel input{padding:8px 10px;border:1px solid #dce1e9;border-radius:8px}.pay-result h3{margin:12px 0 4px}
button.link{background:none;border:0;color:var(--accent);text-decoration:underline;padding:0;font-size:12px}
.form-error:empty{display:none}
`);
document.adoptedStyleSheets=[...document.adoptedStyleSheets,sheet];

export const config={
 id:'northlake-portal',title:'Northlake Patient Portal',description:'Secure messages, billing and statements for one patient.',
 list:T+'messages.list',collection:'threads',queryField:'query',listArgs:{status:'all'},get:T+'messages.get',item:'thread',
 heading:t=>t.subject,subtitle:t=>t.recipient.display_name+' · '+(t.status==='closed'?'Closed':t.awaiting==='patient'?'Reply needed':'Awaiting staff'),
 labels:{recipient_category:'Send to',subject:'Subject',body:'Message',attachments:'Documents (PDF, PNG, JPEG or text; up to 2, 512 KiB each)',kind:'Request type',reason:'Reason',amount_cents:'Amount in cents','patch.read':'Mark as read'},
 actions:[
  {label:'New message',tool:T+'messages.send',primary:true,submit:'Send'},
  {label:'Reply',tool:T+'messages.reply',selected:true,submit:'Send reply',available:t=>t.status==='open',prefill:t=>({id:t.id})},
  {label:'Mark read / unread',tool:T+'messages.flags',selected:true,available:t=>t.messages.length>0,prefill:t=>{const m=t.messages[t.messages.length-1];return {id:m.message_id,patch:{read:!m.read}};}},
  {label:'Export thread',tool:T+'messages.export',selected:true,prefill:t=>({id:t.id})},
  {label:'Ask the billing office',tool:T+'billing.question',hidden:true,submit:'Send question'},
  {label:'Request a refund or fee waiver',tool:T+'billing.requests.create',hidden:true,submit:'Submit request'}
 ],
 symbol:'✚',searchLabel:'Search your messages',initialSection:['inbox','unread','billing-office','closed','billing','statements'].includes(params.get('page'))?params.get('page'):'inbox',
 empty:'No message threads here.',
 field:name=>name==='kind'?{options:[{value:'refund',label:'Refund of a payment'},{value:'fee_waiver',label:'Waiver of a fee'}]}
  :name==='recipient_category'?{options:[{value:'clinic',label:'Clinic'},{value:'nurse_line',label:'Nurse line'},{value:'billing_office',label:'Billing office'}]}
  :name==='amount_cents'?{help:'Whole cents: 4000 means $40.00. Leave empty to refund the full amount paid.'}:{},
 load:async ui=>{
  uiRef=ui;
  const aux={account:null,billing:null,accountError:null,billingError:null};
  try{aux.account=(await ui.call(T+'account.get',{})).account;}catch(e){aux.accountError=e.message;}
  try{aux.billing=await ui.call(T+'billing.list',{});}catch(e){aux.billingError=e.message;}
  return aux;
 },
 sections:()=>[
  {id:'inbox',label:'Inbox',symbol:'▤',filter:t=>t.status==='open'},
  {id:'unread',label:'Unread',symbol:'●',filter:t=>t.unread_count>0},
  {id:'billing-office',label:'Billing office',symbol:'$',filter:t=>t.recipient.category==='billing_office'},
  {id:'closed',label:'Closed',symbol:'▣',filter:t=>t.status==='closed'},
  {id:'billing',label:'Billing',symbol:'≡',filter:()=>false,count:false},
  {id:'statements',label:'Statements',symbol:'▦',filter:()=>false,count:false}
 ],
 sort:(a,b)=>Date.parse(b.updated_at)-Date.parse(a.updated_at),
 renderList:(shown,ui)=>{document.body.dataset.page=ui.section;if(pendingDetail){const f=pendingDetail;pendingDetail=null;setTimeout(()=>f().catch(ui.error),0);}return el('div',{class:'page'},interstitial(ui),ui.section==='billing'?ledger(ui):ui.section==='statements'?statements(ui):threads(shown,ui));},
 emptyView:ui=>ui.section==='billing'?el('div',{class:'empty'},el('h3',{},'Select a charge'),el('p',{},'Each charge shows the insurer’s arithmetic, the payments applied to it and its history.'))
  :ui.section==='statements'?el('div',{class:'empty'},el('h3',{},'Select a statement'),el('p',{},'Statements are generated from the ledger as text-based PDFs you can download.'))
  :el('div',{class:'empty'},el('h3',{},'A little space for what’s next'),el('p',{},'Select a thread or start a new message.')),
 view:(t,ui)=>thread(t,ui),
 sectionAfter:(tool,args,result,item,ui)=>{if(tool===T+'billing.question'){scheduleDetail(()=>showClaim(ui,args.id,'Your question was sent to the billing office as thread '+result.id+'.'));return 'billing';}
  if(tool===T+'billing.requests.create'){scheduleDetail(()=>showClaim(ui,args.id,'Your '+args.kind.replace('_',' ')+' request '+result.id+' was submitted; the billing office decides it later.'));return 'billing';}
  return tool===T+'messages.send'?'inbox':null;}
};

// ---- interstitial pages: the portal refuses every other call while one is pending ----
function interstitial(ui){
 const a=ui.aux.account,i=a&&a.interstitial;
 if(ui.aux.accountError)return el('div',{class:'notice',role:'alert'},el('strong',{},'The portal is not reachable right now. '),ui.aux.accountError);
 if(!i||i.status!=='pending')return null;
 return el('div',{class:'notice',role:'alert'},el('strong',{},i.kind==='privacy_notice'?'Privacy notice. ':'Session check. '),i.text+' ',
  i.clearable_by==='agent'&&ui.has(T+'interstitial.acknowledge')?el('button',{type:'button',class:'primary',onclick:()=>ui.perform(T+'interstitial.acknowledge',{id:i.interstitial_id}).catch(ui.error)},'Review and acknowledge'):el('em',{},'Only you can clear this page in the portal; your agent cannot.'));
}

// ---- messaging ----
function threads(shown,ui){
 if(!shown.length)return el('div',{class:'empty'},el('h3',{},'Nothing here yet'),el('p',{},config.empty));
 return el('div',{},shown.map(t=>ui.record(t,el('div',{class:'thread-row '+(t.unread_count?'unread':'')},
  el('div',{class:'row-top'},el('strong',{},t.recipient.display_name),el('time',{},date(t.updated_at))),
  el('span',{class:'record-title'},t.unread_count?el('span',{class:'pin','aria-label':'Unread'},'● '):null,t.subject),
  el('span',{class:'snippet'},t.last_message_preview||'No messages yet'),
  el('div',{class:'row-bottom'},tag(t.status==='closed'?'Closed':t.awaiting==='patient'?'Reply needed':'Awaiting staff'),t.related.claim_id?tag('Claim '+t.related.claim_id):null,el('small',{},t.message_count+' message'+(t.message_count===1?'':'s')))))));
}
function thread(t,ui){
 return el('article',{class:'thread-paper'},
  el('div',{class:'reader-heading'},el('span',{class:'kicker'},t.recipient.display_name),el('h2',{},t.subject)),
  el('div',{class:'tags'},tag(t.status==='closed'?'Closed'+(t.closed_reason?': '+t.closed_reason:''):'Awaiting '+t.awaiting),el('span',{class:'tag'},'Opened '+date(t.opened_at)),
   t.related.claim_id?el('button',{type:'button',class:'link',onclick:()=>openClaim(ui,t.related.claim_id).catch(ui.error)},'View claim '+t.related.claim_id):null),
  ...t.messages.map(m=>el('section',{class:'message '+(m.author.role==='patient'?'mine':'theirs')+(m.read?'':' unread')},
   el('div',{class:'note-date'},el('strong',{},m.author.display_name),' · '+m.author.role.replace('_',' ')+' · '+time(m.at)+(m.read?'':' · unread')),
   textBlock(m.body),m.attachments.length?ui.attachments({id:m.message_id,attachments:m.attachments},T+'messages.attachment.get'):null)),
  t.status==='closed'?el('p',{class:'note-foot'},'This thread is closed; replies are not delivered. Start a new message instead.'):null);
}

// ---- billing ledger ----
function ledger(ui){
 const b=ui.aux.billing;
 if(!b)return el('div',{class:'empty'},el('h3',{},'Billing is not available'),el('p',{},ui.aux.billingError||'Loading…'));
 const s=b.summary;
 const card=(label,value,extra)=>el('div',{class:'stat'},el('small',{},label),el('strong',{},value),extra?el('small',{},extra):null);
 const open=b.claims.filter(c=>c.open_balance_cents>0);
 return el('div',{},
  el('div',{class:'ledger-summary'},card('Balance due',money(s.balance_due_cents),s.past_due_cents?money(s.past_due_cents)+' past due':'Nothing past due'),card('With your insurer',money(s.pending_insurance_cents),s.open_claims+' open charge'+(s.open_claims===1?'':'s')),
   el('div',{class:'stat actions'},open.length&&ui.has(T+'billing.pay.preview')?el('button',{type:'button',class:'primary',onclick:()=>showPayment(ui,open.map(c=>c.id),s.balance_due_cents,'Pay your balance')},'Pay balance'):el('small',{},open.length?'Payments are not allowed for this account.':'No balance to pay.'))),
  el('h3',{class:'group-title'},'Charges'),
  ...b.claims.map(c=>el('button',{type:'button',class:'record claim-row','data-record-id':c.id,'aria-pressed':'false',onclick:()=>showClaim(ui,c.id).catch(ui.error)},
   el('div',{class:'row-top'},el('strong',{},c.description),el('time',{},c.service_date)),
   el('div',{class:'row-bottom'},tag(STATUS[c.status]||c.status),...c.flags.map(f=>el('span',{class:'tag warn'},f==='past_due'?'Past due':'Not on a statement yet')),el('small',{},c.status==='in_adjudication'?'Billed '+money(c.billed_cents):'You owe '+money(c.patient_responsibility_cents)+' · open '+money(c.open_balance_cents))))),
  el('h3',{class:'group-title'},'Payments and refunds'),
  b.payments.length?el('ul',{class:'plain'},b.payments.map(p=>el('li',{},el('strong',{},(p.kind==='refund'?'Refund ':'Payment ')+money(p.amount_cents)),' · '+date(p.at)+' · '+p.method.replace(/_/g,' ')+(p.last4?' ending '+p.last4:'')+' · '+p.confirmation_number))):el('p',{class:'snippet'},'No payments yet.'));
}
async function openClaim(ui,id){await ui.navigate('billing');await showClaim(ui,id);}
async function showClaim(ui,id,notice=null){
 const r=await ui.call(T+'billing.get_claim',{id}),c=r.claim,b=ui.aux.billing;
 mark(id);
 const actions=el('div',{class:'actions'});
 if(ui.has(T+'billing.question'))actions.append(el('button',{type:'button',onclick:()=>ui.action(T+'billing.question',{id})},'Ask the billing office'));
 if(ui.has(T+'billing.requests.create'))actions.append(el('button',{type:'button',onclick:()=>ui.action(T+'billing.requests.create',{id,kind:c.kind==='fee'?'fee_waiver':'refund'})},c.kind==='fee'?'Request a fee waiver':'Request a refund'));
 if(c.open_balance_cents>0&&ui.has(T+'billing.pay.preview'))actions.append(el('button',{type:'button',class:'primary',onclick:()=>showPayment(ui,[id],c.open_balance_cents,'Pay this charge')},'Pay '+money(c.open_balance_cents)));
 const row=(label,value)=>metadata(label,value);
 const p=pane();p.dataset.selectedId=id;
 p.replaceChildren(el('div',{class:'detail-actions'},actions),el('article',{class:'claim-paper'},
  notice?el('p',{class:'notice',role:'status'},notice):null,
  el('div',{class:'reader-heading'},el('span',{class:'kicker'},'Claim '+c.id+' · '+c.kind+' · service date '+c.service_date),el('h2',{},c.description)),
  el('div',{class:'tags'},tag(STATUS[c.status]||c.status),...c.flags.map(f=>el('span',{class:'tag warn'},f==='past_due'?'Past due':'Not on a statement yet')),c.statement_id?tag('Statement '+c.statement_id):null,c.reason_code?el('span',{class:'tag warn'},'Reason: '+c.reason_code):null),
  el('div',{class:'amounts'},row('Billed',money(c.billed_cents)),row('Insurance adjustment',c.status==='in_adjudication'?'pending':money(c.insurance_adjustment_cents)),row('Insurance paid',c.status==='in_adjudication'?'pending':money(c.insurance_paid_cents)),
   row('Your responsibility',c.status==='in_adjudication'?'pending':money(c.patient_responsibility_cents)),row('Paid by you',money(c.paid_by_patient_cents)),row('Open balance',money(c.open_balance_cents))),
  el('h3',{},'History'),el('ol',{class:'history'},c.history.map(h=>el('li',{},el('time',{},time(h.at)),' ',el('strong',{},h.action.replace(/_/g,' ')),h.detail?' — '+h.detail:''))),
  r.allocations.length?el('div',{},el('h3',{},'Payments applied'),el('ul',{class:'plain'},r.allocations.map(a=>el('li',{},(a.kind==='refund'?'Refund ':'Payment ')+money(a.amount_cents)+' · '+date(a.at)+' · '+a.payment_id)))):null,
  r.thread_ids.length?el('div',{},el('h3',{},'Messages about this charge'),el('div',{class:'actions'},r.thread_ids.map(tid=>el('button',{type:'button',onclick:async()=>{await ui.navigate('inbox');await ui.select(tid);}},tid)))):null,
  b&&b.summary?el('p',{class:'note-foot'},'Account balance due '+money(b.summary.balance_due_cents)+(b.summary.past_due_cents?', '+money(b.summary.past_due_cents)+' past due':'')+'.'):null));
}
// Two-step payment: preview (nothing is charged) then confirm; the confirm is withheld under restricted policies and
// waits for the user's confirmation when the account requires it, so both refusals are shown rather than retried.
function showPayment(ui,claimIds,maxCents,title){
 const p=pane(),amount=el('input',{type:'number',min:1,max:maxCents,step:1,value:String(maxCents),'aria-label':'Amount in cents','data-field':'amount_cents'});
 const result=el('div',{class:'pay-result'}),alert=el('p',{role:'alert',class:'form-error'});
 const prepare=el('button',{type:'button',class:'primary'},'Prepare payment');
 prepare.onclick=async()=>{alert.textContent='';result.replaceChildren();try{
  const pv=await ui.perform(T+'billing.pay.preview',{amount_cents:Number(amount.value),claim_ids:claimIds},{refreshAfter:false});
  const confirm=el('button',{type:'button',class:'primary'},'Confirm payment of '+money(pv.amount_cents));
  confirm.onclick=async()=>{alert.textContent='';try{
   // The preview's receipt carries the version the confirm must observe; a fresh request ID makes each attempt its own write.
   const r=await ui.call(T+'billing.pay.confirm',{id:pv.id,expected_version:pv.version,request_id:'web-'+crypto.randomUUID()});
   const receipt='Payment posted. Confirmation '+r.confirmation_number+' · '+money(r.amount_cents)+' · balance now '+money(r.balance_cents)+'.';
   scheduleDetail(()=>claimIds.length===1?showClaim(ui,claimIds[0],receipt):showReceipt(ui,receipt,r));
   await ui.refresh();
  }catch(e){alert.textContent=e.message;}};
  result.replaceChildren(el('div',{},el('h3',{},'Payment preview '+pv.id),el('ul',{class:'plain'},pv.allocations.map(a=>el('li',{},a.claim_id+': '+money(a.amount_cents)))),
   el('p',{},'Balance '+money(pv.balance_before_cents)+' → '+money(pv.balance_after_cents)+'. The preview expires at '+time(pv.expires_at)+'. Nothing has been charged yet.'),
   pv.approval_required?el('p',{class:'notice'},'This account requires your confirmation in the portal before a payment posts; the confirm step reports approval_required until then.'):null,
   ui.has(T+'billing.pay.confirm')?confirm:el('p',{class:'notice'},'Confirming payments is withheld for this account and policy.')));
 }catch(e){alert.textContent=e.message;}};
 p.dataset.selectedId='payment';
 p.replaceChildren(el('article',{class:'claim-paper pay-panel'},el('div',{class:'reader-heading'},el('span',{class:'kicker'},claimIds.length===1?'Claim '+claimIds[0]:claimIds.length+' open charges'),el('h2',{},title)),
  el('label',{class:'field'},el('span',{},'Amount in cents (up to '+money(maxCents)+')'),amount),el('div',{class:'form-actions'},prepare),alert,result));
}

async function showReceipt(ui,receipt,r){
 const p=pane();p.dataset.selectedId=r.id;
 p.replaceChildren(el('article',{class:'claim-paper'},el('p',{class:'notice',role:'status'},receipt),el('div',{class:'reader-heading'},el('span',{class:'kicker'},'Payment '+r.id+' · '+time(r.paid_at)),el('h2',{},'Thank you, your payment was posted')),el('p',{},'The charges it covered now show the payment in their history. Select a charge to see it.')));
}

// ---- statements ----
function statements(ui){
 const b=ui.aux.billing;
 if(!b)return el('div',{class:'empty'},el('h3',{},'Statements are not available'),el('p',{},ui.aux.billingError||'Loading…'));
 if(!b.statements.length)return el('div',{class:'empty'},el('h3',{},'No statements yet'));
 return el('div',{},b.statements.map(s=>el('button',{type:'button',class:'record statement-row','data-record-id':s.id,'aria-pressed':'false',onclick:()=>showStatement(ui,s).catch(ui.error)},
  el('div',{class:'row-top'},el('strong',{},'Statement '+s.period_start+' to '+s.period_end),el('time',{},date(s.generated_at))),
  el('div',{class:'row-bottom'},tag('Balance due '+money(s.balance_due_cents)),s.past_due_cents?el('span',{class:'tag warn'},money(s.past_due_cents)+' past due'):null,el('small',{},s.claim_ids.length+' charge'+(s.claim_ids.length===1?'':'s'))))));
}
async function showStatement(ui,s){
 mark(s.id);
 const p=pane();p.dataset.selectedId=s.id;
 const actions=el('div',{class:'actions'},el('button',{type:'button',class:'primary',onclick:async()=>{try{const r=await ui.call(T+'billing.statement',{id:s.id});download(r.file.filename,r.file.mime_type,toBytes(r.file));}catch(e){ui.error(e);}}},'Download PDF'));
 p.replaceChildren(el('div',{class:'detail-actions'},actions),el('article',{class:'claim-paper'},
  el('div',{class:'reader-heading'},el('span',{class:'kicker'},'Statement '+s.id+' · generated '+time(s.generated_at)),el('h2',{},'Statement for '+s.period_start+' to '+s.period_end)),
  el('div',{class:'amounts'},metadata('Balance due',money(s.balance_due_cents)),metadata('Past due',money(s.past_due_cents)),metadata('Charges',String(s.claim_ids.length)),metadata('Payments this period',String(s.payment_ids.length)),metadata('File',s.filename)),
  s.past_due_note?el('p',{class:'notice'},'This statement carries the past-due note: balances more than '+(ui.aux.account?ui.aux.account.health_system.past_due_after_days:30)+' days past due may be referred to collections.'):null,
  el('h3',{},'Charges on this statement'),el('div',{class:'actions'},s.claim_ids.map(id=>el('button',{type:'button',onclick:()=>showClaim(ui,id).catch(ui.error)},id)))));
}

await mount(config);
// Deep links from notices: /?page=billing&claim=<id> or /?page=statements&statement=<id>.
if(uiRef&&params.get('claim'))showClaim(uiRef,params.get('claim')).catch(uiRef.error);
if(uiRef&&params.get('statement')&&uiRef.aux.billing){const s=uiRef.aux.billing.statements.find(x=>x.id===params.get('statement'));if(s)showStatement(uiRef,s).catch(uiRef.error);}
