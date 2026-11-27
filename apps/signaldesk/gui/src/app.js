import {el} from '/shared/client.js';
const pages={account:'Account & usage',catalog:'Compare plans',plan:'Manage plan',passes:'Roaming passes',statement:'Statements & notices'};
const money=c=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(c/100);
const content=document.querySelector('#content'),status=document.querySelector('#status');
let page='account',csrf,version,allowed,locked=false,preview=null,retry=null;
async function request(url,body){
  const response=await fetch(url,body?{method:'POST',headers:{'Content-Type':'application/json','X-Pale-CSRF':csrf||''},body:JSON.stringify(body)}:{});
  const result=await response.json();
  if(!response.ok) throw Error(result.error||'Request failed.');
  return result;
}
async function call(name,args={}){
  const result=await request('/api/call',{name:'signaldesk.'+name,arguments:args});
  if(!['ok','committed'].includes(result.status))throw Error(result.message||result.status);
  version=result.version;
  return result.details;
}
async function write(name,args){
  const key=JSON.stringify([name,args,version]);
  if(retry?.key!==key)retry={key,id:crypto.randomUUID()};
  const result=await call(name,{...args,request_id:retry.id,expected_version:version});retry=null;return result;
}
async function run(fn){
  if(locked)return;
  locked=true;
  const shell=document.querySelector('.app-shell');
  shell.inert=true;
  shell.setAttribute('aria-busy','true');
  status.textContent='';
  try{await fn();}catch(e){status.textContent=e.message;}
  finally{shell.inert=false;shell.setAttribute('aria-busy','false');locked=false;}
}
const button=(label,fn)=>el('button',{type:'button',onclick:()=>run(fn)},label);
const line=(label,value)=>el('p',{},el('strong',{},label+' '),String(value));
function table(headers,rows){
  return el('table',{},el('thead',{},el('tr',{},...headers.map(h=>el('th',{},h)))),el('tbody',{},...rows.map(r=>el('tr',{},...r.map(v=>el('td',{},String(v??'—')))))));
}
function select(label,values){
  const input=el('select',{'aria-label':label},...values.map(v=>el('option',{value:v},v)));
  content.append(el('label',{},label+' ',input));return input;
}
function timeInput(){
  const input=el('input',{'aria-label':'Start (UTC)',type:'datetime-local'});
  content.append(el('label',{},'Start (UTC) ',input));
  return ()=>{if(!input.value)throw Error('Choose a UTC start time.');return new Date(input.value+'Z').toISOString();};
}
async function propose(args){
  preview=await write('preview',args);await show();
}
function previewControls(){
  const t=preview.terms;
  content.append(el('h3',{},'Review change'),table(['Term','Value'],Object.entries(t).map(([key,v])=>[key.replaceAll('_',' '),key.endsWith('cents')?money(v):v])),
    button('Confirm change',async()=>{const receipt=await write('confirm',{preview_id:preview.id});preview=null;await show();status.textContent='Confirmed · '+receipt.id;}),
    button('Discard preview',async()=>{await write('abandon',{preview_id:preview.id});preview=null;await show();}));
}
async function show(){
  const d=await call(page);
  document.querySelector('#heading').textContent=pages[page];content.replaceChildren();
  const canEdit=allowed.includes('signaldesk.preview');
  if(page==='account'){
    content.append(line('Billing month',d.cycle),line('Current plan',d.plan_id),table(['Line','Person','Domestic MB left (shared)','Hotspot MB left','Roaming MB left'],d.lines.map(l=>[l.id,l.person_id,l.domestic_remaining_mb,l.hotspot_remaining_mb,l.roaming_remaining_mb])),
      el('h3',{},'Usage history'),table(['Date','Line','Type','MB','Uncovered MB'],d.usage.slice().reverse().map(u=>[u.occurred_at,u.line_id,u.kind,u.amount_mb,u.uncovered_mb||0])));
  } else if(page==='catalog'){
    content.append(table(['Plan','Monthly','Shared MB','Hotspot MB per line','Roaming MB per line','Destinations'],d.plans.map(p=>[p.id,money(p.price),p.domestic_mb,p.hotspot_mb,p.roaming_mb,p.coverage.join(', ')||'None'])),
      el('h3',{},'Pass products'),table(['Pass','Fee','Days','MB','Coverage'],d.products.map(p=>[p.id,money(p.price),p.days,p.data_mb,p.coverage.join(', ')])));
  } else if(page==='plan'){
    content.append(line('Current plan',d.active.id),line('Monthly price',money(d.active.price)),line('Next cycle',d.effective),line('Pending change',d.pending?.plan_id||'None'));
    if(canEdit){const catalog=await call('catalog');const choice=select('New plan',catalog.plans.filter(p=>p.id!==d.active.id).map(p=>p.id));
      content.append(button('Preview plan change',()=>propose({action:'change_plan',plan_id:choice.value})));
      if(d.pending)content.append(button('Preview plan cancellation',()=>propose({action:'cancel_plan',target_id:d.pending.id})));
    }
  } else if(page==='passes'){
    content.append(table(['Pass','Line','Product','Coverage','From','Until','MB left','Status'],d.passes.map(p=>[p.id,p.line_id,p.product_id,p.coverage.join(', '),p.start,p.end,p.remaining_mb,p.status])));
    if(canEdit){const account=await call('account'),catalog=await call('catalog');
      const l=select('Mobile line',account.lines.map(x=>x.id)),product=select('Pass product',catalog.products.map(x=>x.id)),dest=select('Destination',[...new Set(catalog.products.flatMap(p=>p.coverage))]),start=timeInput();
      content.append(button('Preview new pass',()=>propose({action:'buy_pass',line_id:l.value,product_id:product.value,destination:dest.value,start:start()})));
      const scheduled=d.passes.filter(p=>p.status==='scheduled');
      if(scheduled.length){const target=select('Scheduled pass',scheduled.map(p=>p.id));
        content.append(button('Preview reschedule',()=>propose({action:'reschedule_pass',target_id:target.value,start:start()})),button('Preview pass cancellation',()=>propose({action:'cancel_pass',target_id:target.value})));}
    }
  }else{
    content.append(table(['Month','Total'],Object.entries(d.monthly_totals_cents).map(([m,c])=>[m,money(c)])),el('h3',{},'Itemized charges'),table(['Charge','Effective','Source','Amount'],d.charges.map(c=>[c.id,c.at,c.source,money(c.cents)])),
      el('h3',{},'Notices'),table(['Time','Notice','Source'],d.notices.map(n=>[n.at,n.text,n.source])),el('h3',{},'Service receipts'),table(['Receipt','Effective','Change','Source'],d.receipts.map(r=>[r.id,r.at,r.terms.action,r.source])));
  }
  preview=d.preview||null;
  if(preview && canEdit)previewControls();
}
document.querySelector('#refresh').onclick=()=>run(show);
run(async()=>{
  const token=new URLSearchParams(location.hash.slice(1)).get('access');
  if(token)history.replaceState(null,'',location.pathname);
  csrf=(await request('/session',token?{token}:undefined)).csrf;
  allowed=(await request('/api/tools')).tools.map(t=>t.name);
  for(const [id,label] of Object.entries(pages))document.querySelector('nav').append(button(label,async()=>{page=id;await show();}));
  await show();
});
