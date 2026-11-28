import {el} from '/shared/client.js';
const root=document.querySelector('#app'), live=el('p',{role:'status','aria-live':'polite'}),
 nav=el('nav',{'aria-label':'Workspace navigation'}),out=el('article',{});
root.replaceChildren(el('div',{class:'app-shell'},
 el('aside',{class:'sidebar'},el('header',{class:'brand'},el('h1',{},'NYC 311 Watch'),el('p',{},'PALE sandbox')),nav,
 el('p',{class:'sidebar-foot'},'Public case data. Private local watches. Not a city service.')),
 el('div',{class:'detail'},el('article',{},el('p',{class:'eyebrow'},'Street condition workspace'),live),out)));
const label={'in_progress':'In progress',open:'Open',closed:'Agency closed',unknown:'Status not yet observed',resolved:'Agency closure',reopened:'Reopened',agency_changed:'Agency changed',admin_update:'Administrative update'};
const choices=['resolved','reopened','agency_changed','admin_update'];
const boroughs=['BRONX','BROOKLYN','MANHATTAN','QUEENS','STATEN ISLAND'];
const when=new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'America/New_York'});
const date=at=>at?when.format(new Date(at))+' (New York time)':'Not observed';
let csrf,allowed=new Set(),page='Lookup',id=null,step=0,busy=false,offset=0,filters={};
const has=n=>allowed.has('civic311.'+n);
const say=t=>{live.textContent=t};
const btn=(title,cb)=>el('button',{type:'button',onclick:()=>{if(!busy)Promise.resolve().then(cb).catch(e=>say(e.message));}},title);
async function req(url,body){
 const res=await fetch(url,body?{method:'POST',headers:{'Content-Type':'application/json','X-Pale-CSRF':csrf??''},body:JSON.stringify(body)}:{});
 const j=await res.json();if(!res.ok)throw Object.assign(Error(j.error||'Cannot read sandbox.'),{known:true});return j;
}
async function call(n,args={}){
 if(!has(n))throw Object.assign(Error('This action is unavailable in the current access policy.'),{known:true});
 const j=await req('/api/call',{name:'civic311.'+n,arguments:args});
 if(!['ok','committed'].includes(j.status))throw Object.assign(Error(j.message||j.status),{known:true});
 return j;
}
function section(...items){const row=el('div',{class:'actions'},...items);return row}
function confirmation(panel,caption,operation,params,version,done,token){
 let args,finished=false;
 const error=el('p',{role:'alert',class:'form-error'});
 const action=btn(caption,async()=>{
  if(finished||token!==step||!panel.isConnected)return;
  args??={...params,expected_version:version,request_id:crypto.randomUUID()};
  busy=true;action.disabled=true;
  try{
   await call(operation,args);finished=true;busy=false;await done();
  }catch(e){
   error.textContent=e.known?e.message:'No confirmation received. Retry the same request or refresh to verify the result.';
   finished=!!e.known;
  }finally{busy=false;action.disabled=finished;}
 });
 action.className='primary';panel.append(action,error);
}
const open=caseId=>{id=caseId;return show('Case')};
const select=(title,values,selected)=>el('select',{'aria-label':title},el('option',{value:''},'Any'),...values.map(v=>el('option',{value:v,...(v===selected?{selected:true}:{})},label[v]??v)));
async function lookup(token){
 const r=await call('search_cases',{...filters,offset,limit:15});if(token!==step)return;
 const field=el('input',{type:'text','aria-label':'Local case ID',value:filters.case_id??'',placeholder:'e.g. C17'});
 const borough=select('Borough',boroughs,filters.borough),status=select('Status',['open','in_progress','closed','unknown'],filters.status);
 const form=el('form',{class:'fields'},el('label',{},'Local case ID',field),el('label',{},'Borough',borough),el('label',{},'Status',status),el('button',{type:'submit',class:'primary'},'Search cases'));
 form.addEventListener('submit',e=>{e.preventDefault();if(busy)return;
  filters=Object.fromEntries(Object.entries({case_id:field.value.trim(),borough:borough.value,status:status.value}).filter(([,v])=>v));offset=0;void show('Lookup');});
 const paging=section();
 if(offset>0)paging.append(btn('Previous cases',()=>{offset-=15;return show('Lookup')}));
 if(r.next_offset!==null)paging.append(btn('Next cases',()=>{offset=r.next_offset;return show('Lookup')}));
 out.append(form,el('p',{},r.total+' visible case(s)'),
  r.items.length?el('ul',{},r.items.map(c=>el('li',{},btn('Open '+c.case_id,()=>open(c.case_id)),
   ' '+c.borough+' · '+(label[c.status]??c.status)))):el('p',{},'No matching case.'),paging);
}
async function caseView(token){
 if(!id){out.append(el('p',{},'Select a case from Lookup.'));return;}
 const r=await call('read_case',{case_id:id}),w=await call('list_watches');if(token!==step)return;
 const c=r.item,current=w.items.find(x=>x.case_id===id);
 out.append(el('h3',{},c.case_id+' · '+c.category),el('p',{},c.borough+' · '+label[c.status]),
  el('p',{},'Agency: '+(c.agency??'Not observed')),el('p',{},'Created: '+date(c.created_at)),
  el('p',{},'Last observed or updated: '+date(c.last_updated_at)),
  el('p',{},'Administrative update: '+(c.admin_update_code?.replaceAll('_',' ')??'None visible')));
 if(c.status==='closed')out.append(el('p',{},'Agency closure does not establish that the street was repaired.'));
 if(current)out.append(el('p',{},'Watching: '+current.change_types.map(x=>label[x]).join(', ')));
 if(has('save_watch'))out.append(btn(current?'Edit watch':'New watch',()=>edit(c,current,w.version,token)));
 if(current&&has('remove_watch'))out.append(btn('Remove watch',()=>{
  const panel=el('section',{},el('h3',{},'Remove watch for '+id+'?'),el('p',{},'Existing local activity will stay visible.'),btn('Keep watch',()=>show('Case')));
  out.replaceChildren(panel);
  confirmation(panel,'Confirm removal','remove_watch',{watch_id:current.watch_id},w.version,()=>show('Case','Watch removed.'),token);
 }));
}
function edit(c,w,version,token){
 const checks=choices.map(x=>el('input',{type:'checkbox',value:x,...(w?.change_types.includes(x)?{checked:true}:{})}));
 const err=el('p',{role:'alert',class:'form-error'});
 const card=el('section',{},el('h3',{},'Watch settings for '+c.case_id),
  el('fieldset',{},el('legend',{},'Changes to watch'),...checks.map(x=>el('label',{},x,' '+label[x.value]))),
  btn('Discard preview',()=>show('Case','Nothing saved.')),err);
 card.append(btn('Preview watch',()=>{
  const changes=checks.filter(x=>x.checked).map(x=>x.value);
  if(!changes.length){err.textContent='Select at least one change.';return;}
  const preview=el('section',{},el('h3',{},'Review watch for '+c.case_id),
    el('p',{},changes.map(x=>label[x]).join(', ')),el('p',{},'Local activity only. No message will be sent.'),
    btn('Back to watch settings',()=>{out.replaceChildren(card)}),btn('Discard preview',()=>show('Case','Nothing saved.')));
  out.replaceChildren(el('h2',{},'Watch preview'),preview);
  confirmation(preview,'Confirm watch','save_watch',{case_id:c.case_id,change_types:changes,...(w?{watch_id:w.watch_id}:{})},
   version,()=>show('Case','Watch saved.'),token);
 }));
 out.replaceChildren(el('h2',{},'Watch settings'),card);
}
async function dashboard(token){
 const w=await call('list_watches'),a=await call('list_activity');if(token!==step)return;
 out.append(el('h3',{},'Your watches'));
 if(!w.items.length)out.append(el('p',{},'No active watches.'));
 else out.append(el('ul',{},w.items.map(x=>el('li',{},btn('Open '+x.case_id,()=>open(x.case_id)), ' '+x.change_types.map(y=>label[y]).join(', ')))));
 out.append(el('h3',{},'Local reminders'));
 if(!a.items.length)out.append(el('p',{},'No local reminders.'));
 else for(const x of a.items){
  const card=el('section',{},el('h4',{},x.case_id+' · '+label[x.change_type]),el('p',{},x.message),el('p',{},date(x.at)));
  if(x.acknowledged_at)card.append(el('p',{},'Acknowledged'));
  else if(has('ack_activity'))confirmation(card,'Acknowledge '+x.case_id,'ack_activity',{activity_id:x.activity_id},a.version,()=>show('Watches and activity','Reminder acknowledged.'),token);
  out.append(card);
 }
}
async function show(next=page,message){
 page=next;const token=++step;
 for(const b of nav.querySelectorAll('[data-page]')){if(b.dataset.page===page)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}
 out.replaceChildren(el('h2',{},page));say('Reading local state…');
 try{await (next==='Lookup'?lookup(token):next==='Case'?caseView(token):dashboard(token));if(token===step)say(message??'Workspace state loaded.');}
 catch(e){if(token===step){say(e.message);out.append(el('p',{role:'alert'},e.message));}}
}
async function init(){
 const access=new URLSearchParams(location.hash.slice(1)).get('access');
 if(access){history.replaceState(null,'',location.pathname);({csrf}=await req('/session',{token:access}));}
 else ({csrf}=await req('/session'));
 allowed=new Set((await req('/api/tools')).tools.map(x=>x.name));
 nav.replaceChildren(...['Lookup','Case','Watches and activity'].map(n=>{const b=btn(n,()=>show(n));b.dataset.page=n;return b}),btn('Refresh',()=>show()));
 await show();
}
init().catch(e=>say(e.message));
