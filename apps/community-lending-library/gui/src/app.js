import {el} from '/shared/client.js';
const app='community-lending-library.', root=document.querySelector('#app');
const nav=el('nav',{'aria-label':'Lending views'}),status=el('p',{id:'status',role:'status','aria-live':'polite'},'Connecting…'),stage=el('article',{'aria-label':'Lending workspace'});
const signedIn=el('p',{},'Fictional account');
const brand=el('div',{class:'brand'},el('span',{class:'brand-mark','aria-hidden':'true'},'L'),el('h1',{},'Lending Library'));
root.replaceChildren(el('aside',{class:'sidebar'},brand,nav,el('div',{class:'sidebar-foot'},signedIn)),el('main',{class:'app-main'},status,el('div',{class:'detail'},stage)));
const pages=['Catalog','Item','Holds and queue','Current loans','Activity and receipts'];
let csrf, tools=new Set(), page='Catalog', selection=null, serial=0;
const say=text=>{status.textContent=text;};
const supported=n=>tools.has(app+n);
const p=text=>el('p',{},text);
const button=(label,fn,t)=>el('button',{type:'button',onclick:()=>Promise.resolve().then(fn).catch(e=>{if(t==null||t===serial)say(e.message);})},label);
const panel=(heading,...children)=>el('section',{},el('h3',{},heading),...children);
const rows=(items,empty)=>items.length?el('div',{class:'fields'},...items):el('p',{class:'empty'},empty);
const badge=text=>el('strong',{},text);
const card=(...nodes)=>el('div',{class:'record fields'},...nodes);
const desc=text=>el('small',{'data-supporting-text':''},text);
const dateFmt=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Shanghai',dateStyle:'medium',timeStyle:'short'});
const when=t=>dateFmt.format(new Date(t))+' (library time)';
const newest=key=>(a,b)=>Date.parse(b[key])-Date.parse(a[key])||b.id.localeCompare(a.id,undefined,{numeric:true});
const nice=s=>({on_loan:'On loan',available:'Available',held:'Held',maintenance:'Maintenance',checked_out:'Checked out',cancelled:'Cancelled',expired:'Expired',open:'Open',pending:'Pending',accepted:'Accepted',rejected:'Desk rejected',member_waiting:'another member is waiting',overdue:'a loan is overdue',return_pending:'a return is pending',already_renewed:'already renewed',loan_closed:'this loan is closed'})[s]||s;
const titleRow=(name,label)=>el('div',{class:'row-top'},el('h3',{},name),badge(label));
async function catalog(){
 const {items}=await call('search_items');
 const details=await Promise.all(items.map(x=>call('get_item',{item_id:x.id})));
 return {byItem:new Map(items.map(i=>[i.id,i.name])),byCopy:new Map(details.flatMap(d=>d.copies.map((c,i)=>[c.id,{name:d.item.name,label:'Copy '+(i+1)}])))};
}
const identity=(catalog,id)=>catalog.byCopy.get(id)||{name:'Catalog copy',label:'Copy'};
async function request(path,body){
 const post=body!==undefined;
 const response=await fetch(path,{method:post?'POST':'GET',headers:post?{'Content-Type':'application/json','X-Pale-CSRF':csrf}:{},...(post?{body:JSON.stringify(body)}:{})});
 const data=await response.json();
 if(!response.ok)throw Object.assign(Error(data.error||'Request failed'),{code:'http_error'});
 return data;
}
async function call(name,args={}){
 if(!supported(name))throw Object.assign(Error('Not permitted by this profile.'),{code:'unavailable'});
 const r=await request('/api/call',{name:app+name,arguments:args});
 if(!['ok','committed'].includes(r.status))throw Object.assign(Error(r.message||r.status),{code:r.status});
 return r;
}
function action(target,label,name,args,version,t,message){
 if(!supported(name))return;
 let sending=false,done=false,attempt;
 const error=el('p',{class:'form-error',role:'alert'});
 const go=button(label,async()=>{
  if(t!==serial||!target.isConnected||sending||done)return;
  attempt??={...args,expected_version:version,request_id:crypto.randomUUID()};
  sending=true;
  const locks=[...stage.querySelectorAll('button')].filter(b=>!b.disabled||b.dataset.locked==='yes');
  for(const b of locks){b.disabled=true;b.dataset.locked='yes';}
  let uncertain=false;
  try{
   await call(name,attempt);done=true;
   if(t===serial&&target.isConnected)await show(page,message);
  }catch(e){
   if(e.code){done=true;if(t===serial){error.textContent=e.code==='stale_version'?'State changed since this preview. Refresh and make a new selection.':e.message;say('Action not completed.');}}
   else if(t===serial){uncertain=true;go.textContent='Retry '+label;say('No receipt received. Retry the same request or refresh and verify before sending a new one.');}
  }finally{
   sending=false;
   if(uncertain)go.disabled=false;
   else for(const b of locks){b.disabled=false;delete b.dataset.locked;}
   if(done)go.disabled=true;
  }
 },t);target.append(go,error);
}
function planned(target,start,label,explain,name,args,version,t,message){
 if(!supported(name))return;
 target.append(button(start,()=>{
  const review=el('div',{class:'actions'},p(explain));
  action(review,label,name,args,version,t,message);
  review.append(button('Discard preview',()=>{review.remove();say('Preview discarded; nothing was submitted.');},t));
  target.querySelector('[data-preview]')?.remove();review.dataset.preview='';target.append(review);
 },t));
}
function itemLine(i){return i.name+' · '+i.available+' available · '+i.queue_length+' waiting'+(i.your_position==null?'':' · your position '+i.your_position);}
const pick=id=>{selection=id;return show('Item');};
let query='',facet='all';
async function show(next=page,message){
 page=next;const t=++serial;
 for(const b of nav.querySelectorAll('[data-page]')){
  if(b.dataset.page===next)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');
 }
 const title=el('h2',{},page);stage.replaceChildren(title);say('Reading current lending state…');
 const mount=(...nodes)=>{if(t===serial){stage.replaceChildren(el('div',{class:'fields'},title,...nodes));say(message||'Lending state loaded.');}};
 try{
  if(page==='Catalog'){
   const data=await call('search_items',query.trim()?{query:query.trim()}:{});if(t!==serial)return;
   const search=el('input',{type:'search','aria-label':'Search catalog',placeholder:'Search by item name',maxlength:160,value:query});
   const filter=el('select',{'aria-label':'Availability'},...['all','available','unavailable'].map((v,i)=>el('option',{value:v},['All items','Available now','Not available now'][i])));filter.value=facet;
   const form=el('form',{class:'fields'},search,filter,el('div',{class:'actions'},el('button',{type:'submit',class:'primary'},'Search')));
   form.addEventListener('submit',e=>{e.preventDefault();query=search.value;facet=filter.value;show('Catalog');});
   const items=data.items.filter(i=>facet==='all'||(facet==='available'?i.available>0:i.available===0));
   mount(p('Search the cooperative catalog. No fees, delivery or real handovers.'),form,items.length?el('div',{class:'attachment-grid'},...items.map(i=>card(titleRow(i.name,i.available?'Available now':'Check availability'),desc(i.available+' available · '+i.queue_length+' waiting'),button('Open '+i.name,()=>pick(i.id),t)))):p('No matching items.'));
  } else if(page==='Item'){
   if(!selection){mount(p('Open an item from Catalog.'));return;}
   const [d,member]=await Promise.all([call('get_item',{item_id:selection}),call('list_holds')]);if(t!==serial)return;
   const i=d.item, operations=el('div',{class:'actions'});
   const hasHold=member.holds.some(h=>h.status==='open'&&d.copies.some(c=>c.id===h.copy_id));
   if(!i.available&&i.your_position==null&&!hasHold&&!i.your_active_loan&&i.has_circulating_copy)action(operations,'Join waitlist','join_queue',{item_id:i.id},d.version,t,'Your queue entry was recorded.');
   if(i.your_position!==null)action(operations,'Leave waitlist','leave_queue',{item_id:i.id},d.version,t,'You left this item’s waitlist.');
   const copies=d.copies.map((c,idx)=>{
    const view=card(titleRow('Copy '+(idx+1),nice(c.status)),desc('Catalog ID '+c.id));
    if(c.your_due_at)view.append(p('You borrowed this copy · due '+when(c.your_due_at)));
    if(c.status==='available')planned(view,'Preview hold for Copy '+(idx+1),'Confirm hold','Hold only '+i.name+' · Copy '+(idx+1)+' for one simulated day.','confirm_hold',{item_id:i.id,copy_id:c.id},d.version,t,'Hold confirmed. Checkout still needs a simulated desk receipt.');
    return view;
   });
   mount(panel(i.name,p(itemLine(i)),p(i.description),p('At most two copies; one-day holds; seven-day loans; one three-day renewal if eligible and nobody else is waiting.'),rows(copies,'There are no copies of this item.'),operations));
  } else if(page==='Holds and queue'){
   const [d,names]=await Promise.all([call('list_holds'),catalog()]);if(t!==serial)return;
   const showHold=h=>{
    const {name,label}=identity(names,h.copy_id);
    const view=card(titleRow(name,nice(h.status)),p(label+' · Created '+when(h.created_at)),desc('Hold '+h.id+' · Catalog ID '+h.copy_id));
    if(h.status==='open'){
      view.append(p('Expires '+when(h.expires_at)));
      if(h.checkout_pending)view.append(p('Checkout request pending.'));
      else action(view,'Request checkout for '+name+' · '+label,'request_checkout',{hold_id:h.id},d.version,t,'Checkout requested. Custody is unchanged until an accepted desk receipt.');
      planned(view,'Cancel hold for '+name+' · '+label,'Confirm cancellation','Cancel this hold and its pending checkout.','cancel_hold',{hold_id:h.id},d.version,t,'Hold cancelled; pending checkout cannot be accepted.');
    }
    return view;
   };
   const holds=(open)=>d.holds.filter(h=>(h.status==='open')===open).sort(newest('created_at')).map(showHold);
   const queues=d.queue.map(q=>{const name=names.byItem.get(q.item_id)||'Catalog item';const view=card(titleRow(name,'Waiting'),p('Position '+q.position+' of '+q.length),desc('Item '+q.item_id));action(view,'Leave waitlist for '+name,'leave_queue',{item_id:q.item_id},d.version,t,'You left this item’s waitlist.');return view;});
   mount(panel('Open holds',rows(holds(true),'No open holds.')),panel('Past holds',rows(holds(false),'No past holds.')),panel('Your queue positions',rows(queues,'You are not waiting for any item.')));
  } else if(page==='Current loans'){
   const [d,names]=await Promise.all([call('list_loans'),catalog()]);if(t!==serial)return;
   const showLoan=l=>{
    const {name,label}=identity(names,l.copy_id);
    const view=card(titleRow(name,l.returned_at?'Returned':l.overdue?'Overdue':'On loan'),p(label+' · '+(l.returned_at?'returned '+when(l.returned_at):'due '+when(l.due_at))),p('Checked out '+when(l.checked_out_at)),desc('Loan '+l.id+' · Catalog ID '+l.copy_id));
    if(!l.returned_at){
     const rev=el('div',{});view.append(rev);
     rev.append(button('Preview renewal for '+name+' · '+label,async()=>{
      const r=await call('preview_renewal',{loan_id:l.id});if(t!==serial||!rev.isConnected)return;
      const review=el('div',{class:'actions'},p(r.eligible?'Proposed due: '+when(r.proposed_due_at):'Renewal unavailable: '+nice(r.reason)+'. Due date remains '+when(r.due_at)));
      if(r.eligible)action(review,'Confirm renewal','confirm_renewal',{loan_id:l.id},r.version,t,'Renewal confirmed; current due date refreshed.');
      review.append(button('Discard preview',()=>{review.remove();say('Preview discarded; the due date was not changed.');},t));
      rev.querySelector('[data-preview]')?.remove();review.dataset.preview='';rev.append(review);
     },t));
     action(view,'Request return for '+name+' · '+label,'request_return',{loan_id:l.id},d.version,t,'Return requested. Loan remains open until the desk accepts.');
    }
    return view;
   };
   const newest=(a,b)=>Date.parse(b.checked_out_at)-Date.parse(a.checked_out_at);
   mount(panel('On loan now',rows(d.loans.filter(l=>!l.returned_at).sort(newest).map(showLoan),'No current loans.')),panel('Returned loans',rows(d.loans.filter(l=>l.returned_at).sort(newest).map(showLoan),'No returned loans.')));
  } else {
   const [d,names]=await Promise.all([call('list_activity'),catalog()]);if(t!==serial)return;
   const showAttempt=r=>{
    const {name,label}=identity(names,r.copy_id);
    const view=card(titleRow(name,nice(r.status)),p(label+' · '+(r.operation==='checkout'?'Checkout':'Return')),p('Requested '+when(r.requested_at)),desc('Request '+r.id+' · Attempt '+r.attempt+' · Catalog ID '+r.copy_id+(r.event_id?' · Desk receipt '+r.event_id:'')));
    if(r.status==='pending')planned(view,'Cancel '+(r.operation==='checkout'?'checkout':'return')+' request for '+name+' · '+label,'Confirm cancellation','Invalidate this request before desk acceptance.','cancel_request',{attempt_id:r.id},d.version,t,'Request cancelled; no custody change.');
    return view;
   };
   const attempts=(pending)=>d.attempts.filter(r=>(r.status==='pending')===pending).sort(newest('requested_at')).map(showAttempt);
   mount(panel('Pending requests',rows(attempts(true),'No pending requests.')),panel('Past requests and receipts',rows(attempts(false),'No past requests or receipts.')));
  }
 }catch(e){if(t===serial)say(e.message);}
}
async function init(){
 // Web Host serves a fixed asset allowlist. Keep application styling scoped
 // without relaxing its CSP or modifying the shared style sheet on disk.
 const sheet=[...document.styleSheets].find(s=>s.href?.endsWith('/shared/style.css'));
 if(sheet)for(const custom of [
  '#app #status {font-size: 12px; color: #445268; height: auto; min-height: 30px;}',
  '#app .sidebar-foot {display: flex;}',
  '#app .sidebar-foot p, #app [data-supporting-text], #app .empty {font-size: 12px; color: #445268;}',
  '#app .row-top strong {font-size: 12px; font-weight: 600; color: #33445c;}',
 ])sheet.insertRule(custom,sheet.cssRules.length);

 const token=new URLSearchParams(location.hash.slice(1)).get('access');
 if(token){history.replaceState(null,'',location.pathname);({csrf}=await request('/session',{token}));}
 else ({csrf}=await request('/session'));
 tools=new Set((await request('/api/tools')).tools.map(t=>t.name));
 nav.replaceChildren(...pages.map(label=>{const b=button(label,()=>show(label));b.dataset.page=label;return b;}),button('Refresh',()=>show()));
 if(supported('list_holds')){const {member_name}=await call('list_holds');signedIn.textContent='Signed in as '+member_name+' · fictional account';}
 await show();
}
init().catch(e=>say(e.message));
