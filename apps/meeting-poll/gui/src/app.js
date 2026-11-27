import {el} from '/shared/client.js';
// App-owned business GUI. Only the public fixed-account Agent bridge is used.
let csrf='',version=null,items=[],selected=null,context=null,notices=[],allowed=new Set(),zone='America/Los_Angeles',filter='all';
const app=document.querySelector('#app'),status=el('p',{id:'status',role:'status','aria-live':'polite'}),records=el('div',{id:'records',class:'records'}),detail=el('section',{class:'detail','aria-label':'Meeting details'}),nav=el('nav',{'aria-label':'Meeting navigation'}),actions=el('div',{class:'actions'});
const search=el('input',{type:'search','aria-label':'Search meetings',placeholder:'Search meetings'});
const zones=['America/Los_Angeles','Europe/London','Asia/Shanghai','UTC'];
const displayZone=el('select',{'aria-label':'Display timezone'},zones.map(x=>el('option',{value:x},x)));displayZone.value=zone;
const button=(label,fn,attrs={})=>el('button',{type:'button',onclick:()=>Promise.resolve().then(fn).catch(error),...attrs},label);
const name=id=>context?.people.find(p=>p.person_id===id)?.name||id;
const fmt=s=>new Intl.DateTimeFormat('en-GB',{timeZone:zone,dateStyle:'medium',timeStyle:'short'}).format(new Date(s));
const period=s=>fmt(s.start)+' – '+fmt(s.end);
function error(e){status.textContent=e.message;status.dataset.error='true';}
async function request(url,method='GET',body){const r=await fetch(url,{method,headers:method==='POST'?{'Content-Type':'application/json','X-Pale-CSRF':csrf}:{},...(body?{body:JSON.stringify(body)}:{})});const value=await r.json();if(!r.ok)throw Error(value.error||'Request failed');return value;}
async function call(tool,args={}){const r=await request('/api/call','POST',{name:'meeting-poll.'+tool,arguments:args});if(!['ok','committed'].includes(r.status))throw Object.assign(Error(r.status==='stale_version'?'This meeting changed. Close this form and refresh before trying again.':r.message||r.status),{code:r.status});return r;}
function label(text,input){return el('label',{},el('span',{},text),input);}
function input(field,value='',type='text'){return el('input',{type,value,'data-field':field});}
function select(field,options,value){const out=el('select',{'data-field':field},options.map(x=>el('option',{value:typeof x==='string'?x:x.value},typeof x==='string'?x:x.label)));if(value!=null)out.value=value;return out;}
function latest(p,id){return p.responses.filter(r=>r.person_id===id).at(-1);}
function localParts(iso,tz){const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(iso)).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;}
function utc(local,tz,occurrence='auto'){
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local))throw Error('Enter a complete date and time.');
 const naive=Date.parse(local+':00Z'),matches=[];
 for(let offset=-14*60;offset<=14*60;offset+=15){const iso=new Date(naive-offset*60000).toISOString();if(localParts(iso,tz)===local)matches.push(iso);}
 matches.sort();if(!matches.length)throw Error('That local time does not exist in this timezone. Choose another time.');
 if(matches.length>1&&occurrence==='auto')throw Error('That clock time occurs twice. Choose the first or second occurrence.');
 return occurrence==='second'?matches.at(-1):matches[0];
}
async function refresh(){
 app.setAttribute('aria-busy','true');
 try{allowed=new Set((await request('/api/tools')).tools.map(t=>t.name));context=await call('context');const result=await call('list');items=result.items;version=result.version;notices=(await call('notifications')).items;
 if(selected){const found=items.find(p=>p.id===selected.id);selected=found||null;}render();status.textContent='Up to date · '+fmt(context.virtual_now)+' · '+zone;delete status.dataset.error;
 }finally{app.setAttribute('aria-busy','false');}
}
async function choose(id){app.setAttribute('aria-busy','true');try{const r=await call('get',{id});selected=r.item;version=r.version;render();}finally{app.setAttribute('aria-busy','false');}}
function modal(title,content,tool,collect,submitLabel='Save'){
 const observed=structuredClone(version),dialog=el('dialog',{'aria-label':title}),alert=el('p',{role:'alert',class:'form-error'}),submit=el('button',{type:'submit',class:'primary'},submitLabel),cancel=button('Close',()=>dialog.close());
 const form=el('form',{},el('h2',{},title),content,alert,el('div',{class:'form-actions'},cancel,submit));let fingerprint='',requestId='',sending=false;
 form.addEventListener('submit',async e=>{e.preventDefault();if(sending)return;sending=true;submit.disabled=true;cancel.disabled=true;alert.textContent='';try{
  const args=collect(),next=JSON.stringify(args);if(next!==fingerprint){fingerprint=next;requestId=crypto.randomUUID();}
  const r=await call(tool,{...args,expected_version:observed,request_id:requestId});version=r.version;dialog.close();
  try{await refresh();if(tool==='create')await choose(r.id);}catch(e){error(Error('Saved successfully, but refresh failed. Use Refresh to see the committed change.'));}
 }catch(e){alert.textContent=e.message;alert.dataset.code=e.code||'validation_error';}finally{sending=false;submit.disabled=false;cancel.disabled=false;}});
 dialog.addEventListener('cancel',e=>{if(sending)e.preventDefault();});dialog.addEventListener('close',()=>dialog.remove());dialog.append(form);document.body.append(dialog);dialog.showModal();
}
function confirmation(title,tool,extra={},reason=false){const p=selected,reasonInput=input('reason');const body=el('div',{},el('p',{},p.title),el('p',{},title==='Reopen poll'?'The previous meeting will no longer be confirmed. Participants will be notified.':'This change will be saved for the current meeting.'));
 if(reason)body.append(label('Reason',reasonInput));modal(title,body,tool,()=>{if(reason&&!reasonInput.value.trim())throw Error('Enter a reason.');return {id:p.id,...extra,...(reason?{reason:reasonInput.value}:{})};},'Confirm');}
function slotEditor(index,initial){
 const start=input('slot-'+index+'-start',initial||localParts(new Date(Date.parse(context.virtual_now)+(5+index)*86400000).toISOString(),zone),'datetime-local');
 const duration=input('slot-'+index+'-duration','30','number');duration.min='15';duration.max='120';
 const tz=select('slot-'+index+'-timezone',zones,zone),occurrence=select('slot-'+index+'-occurrence',[{value:'auto',label:'Automatic'},{value:'first',label:'First occurrence'},{value:'second',label:'Second occurrence'}],'auto');
 const row=el('fieldset',{},el('legend',{},'Candidate time '+(index+1)),label('Local start',start),label('Minutes',duration),label('Timezone',tz),label('Repeated clock time',occurrence));
 return {row,read:()=>{const iso=utc(start.value,tz.value,occurrence.value),minutes=Number(duration.value);if(!Number.isFinite(minutes)||minutes<15||minutes>120)throw Error('Duration must be 15–120 minutes.');return {start:iso,end:new Date(Date.parse(iso)+minutes*60000).toISOString(),timezone:tz.value};}};
}
function editor(edit=false){
 const p=edit?selected:null,title=input('title',p?.title||''),description=el('textarea',{'data-field':'description'},p?.description||''),location=input('location',p?.location||''),deadline=input('deadline',p?.deadline||new Date(Date.parse(context.virtual_now)+2*86400000).toISOString());
 const body=el('div',{class:'fields'},label('Meeting title',title),label('Agenda and requirements',description),label('Location',location),label('Response deadline (ISO time with offset)',deadline));
 const members=[];
 if(!p||p.status==='draft'){
  const fieldset=el('fieldset',{},el('legend',{},'Participants (2–12)'));
  for(const person of context.people){const box=input('participant-'+person.person_id,'','checkbox');box.checked=p?p.participant_ids.includes(person.person_id):person.person_id===context.owner_person_id;members.push([person.person_id,box]);fieldset.append(label(person.name,box));}body.append(fieldset);
 }
 const remove=[];
 if(p){const existing=el('fieldset',{},el('legend',{},'Existing candidate times'));for(const s of p.slots.filter(s=>s.active)){const checkbox=input('remove-'+s.id,'','checkbox');remove.push([s.id,checkbox]);existing.append(label('Remove '+period(s),checkbox));}body.append(existing);}
 const editors=[],holder=el('div',{});function add(){if(editors.length>=10)return;const s=slotEditor(editors.length);editors.push(s);holder.append(s.row);}if(!p){add();add();}
 body.append(holder,button('Add candidate time',add));
 modal(edit?'Edit poll':'New poll',body,edit?'edit':'create',()=>{
  if(!title.value.trim())throw Error('Enter a meeting title.');
  const fields={title:title.value,description:description.value,location:location.value,deadline:deadline.value};
  if(members.length){fields.participant_ids=members.filter(([,box])=>box.checked).map(([id])=>id);if(fields.participant_ids.length<2||fields.participant_ids.length>12)throw Error('Choose 2–12 participants.');}
  if(p)return {id:p.id,patch:{...fields,add_slots:editors.map(x=>x.read()),remove_slot_ids:remove.filter(([,box])=>box.checked).map(([id])=>id)}};
  return {...fields,slots:editors.map(x=>x.read())};
 });
}
function respond(){const p=selected,last=latest(p,context.owner_person_id),fields=[];const body=el('div',{},el('p',{},'Choose your availability for every candidate time. “Not answered” is not agreement.'));
 for(const s of p.slots.filter(s=>s.active)){const control=select('vote-'+s.id,[{value:'',label:'Choose availability'},{value:'yes',label:'Yes'},{value:'if-needed',label:'If needed'},{value:'no',label:'No'}],last?.withdrawn?'':last?.votes.find(v=>v.slot_id===s.id)?.value||'');fields.push([s.id,control]);body.append(label(period(s),control));}
 modal('Your availability',body,'respond',()=>{if(fields.some(([,field])=>!field.value))throw Error('Choose an answer for every candidate time.');return {id:p.id,votes:fields.map(([slot_id,field])=>({slot_id,value:field.value}))};},'Submit response');}
function finalize(){const p=selected,slots=p.slots.filter(s=>s.active),choice=select('slot_id',slots.map(s=>({value:s.id,label:period(s)})));modal('Confirm meeting',el('div',{},el('p',{},'Review the latest replies and the meeting requirements before confirming. All participants will be notified.'),label('Meeting time',choice)),'finalize',()=>({id:p.id,slot_id:choice.value}),'Confirm meeting');}
function reopen(){const p=selected,deadline=input('deadline',p.deadline),reason=input('reason');modal('Reopen poll',el('div',{},el('p',{},'The prior meeting becomes superseded. Its time is no longer confirmed.'),label('New deadline (ISO time with offset)',deadline),label('Reason',reason)),'reopen',()=>{if(!reason.value.trim())throw Error('Enter a reason.');return {id:p.id,deadline:deadline.value,reason:reason.value};},'Reopen and notify');}
function inbox(){const box=el('article',{},el('h2',{},'Your notifications'));for(const n of notices){const poll=items.find(p=>p.id===n.poll_id);box.append(el('section',{},el('strong',{},n.type.replaceAll('_',' ')),el('p',{},(poll?.title||'Meeting')+' · '+fmt(n.at)),n.read?el('span',{},'Read'):button('Mark read',()=>modal('Mark notification read',el('p',{},'Mark this notification as read.'),'notification.read',()=>({id:n.id})))));}if(!notices.length)box.append(el('p',{},'No notifications yet.'));detail.replaceChildren(box);selected=null;}
function render(){
 actions.replaceChildren();if(allowed.has('meeting-poll.create'))actions.append(button('New poll',()=>editor(),{class:'primary'}));
 nav.replaceChildren(...['all','draft','open','closed','finalized','cancelled'].map(state=>button(state==='all'?'All meetings':state[0].toUpperCase()+state.slice(1),()=>{filter=state;render();},{'aria-current':filter===state?'page':false})),button('Notifications ('+notices.filter(n=>!n.read).length+')',inbox));
 const shown=items.filter(p=>(filter==='all'||p.effective_status===filter)&&p.title.toLowerCase().includes(search.value.toLowerCase()));
 records.replaceChildren(...shown.map(p=>button(p.title+' · '+p.effective_status,()=>choose(p.id),{class:'record','data-record-id':p.id,'aria-pressed':selected?.id===p.id})));if(!shown.length)records.append(el('p',{},'No meetings in this view.'));
 detail.replaceChildren();if(!selected){detail.append(el('article',{},el('h2',{},'Find a time that works'),el('p',{class:'body-text'},'Choose a meeting or create a new poll. Replies and changes remain connected to the meeting.')));return;}
 const p=selected;detail.dataset.selectedId=p.id;
 const controls=el('div',{class:'actions'});function actionButton(label,tool,fn,condition=true){if(condition&&allowed.has('meeting-poll.'+tool))controls.append(button(label,fn));}
 const organizer=p.viewer_role==='organizer',state=p.effective_status;
 actionButton('Edit poll','edit',()=>editor(true),organizer&&['draft','open'].includes(state));actionButton('Publish poll','publish',()=>confirmation('Publish poll','publish'),organizer&&state==='draft');
 actionButton('Your availability','respond',respond,p.participant_ids.includes(context.owner_person_id)&&state==='open');actionButton('Withdraw response','withdraw',()=>confirmation('Withdraw response','withdraw'),p.participant_ids.includes(context.owner_person_id)&&state==='open'&&latest(p,context.owner_person_id)&&!latest(p,context.owner_person_id).withdrawn);
 actionButton('Confirm meeting','finalize',finalize,organizer&&['open','closed'].includes(state));actionButton('Reopen poll','reopen',reopen,organizer&&['closed','finalized'].includes(state));actionButton('Cancel poll','cancel',()=>confirmation('Cancel poll','cancel',{},true),organizer&&state!=='cancelled');
 detail.append(el('span',{class:'kicker'},state+' · '+p.viewer_role),el('h2',{},p.title),el('p',{class:'body-text'},p.description||'No agenda'),el('p',{},'Organizer: '+name(p.organizer_id)),el('p',{},'Location: '+(p.location||'Not set')),el('p',{},'Reply by '+fmt(p.deadline)),controls);
 const activeMeeting=p.meetings.find(m=>m.status==='active');if(activeMeeting)detail.append(el('p',{class:'notice'},'Confirmed: '+period(p.slots.find(s=>s.id===activeMeeting.slot_id))));
 const visiblePeople=organizer?p.participant_ids:[context.owner_person_id],table=el('table',{cellpadding:'8',cellspacing:'0'},el('thead',{},el('tr',{},el('th',{},'Candidate time'),visiblePeople.map(id=>el('th',{},name(id))))));
 const tbody=el('tbody');for(const s of p.slots.filter(s=>s.active))tbody.append(el('tr',{},el('td',{},period(s)),visiblePeople.map(id=>{const r=latest(p,id),value=r&&!r.withdrawn?r.votes.find(v=>v.slot_id===s.id)?.value:null;return el('td',{},value||'Not answered');})));table.append(tbody);detail.append(el('h3',{},organizer?'Availability overview':'Your availability'),table);
 detail.append(el('h3',{},'Activity'),el('ul',{},p.history.map(h=>el('li',{},fmt(h.at)+' · '+name(h.actor_id)+' · '+h.action+(h.reason?' · '+h.reason:'')))));
 if(p.meetings.some(m=>m.status!=='active'))detail.append(el('h3',{},'Previous arrangements'),el('ul',{},p.meetings.filter(m=>m.status!=='active').map(m=>el('li',{},period(p.slots.find(s=>s.id===m.slot_id))+' · '+m.status))));
 const article=el('article',{class:'event-reader'},...Array.from(detail.childNodes));detail.replaceChildren(article);
}
app.replaceChildren(el('div',{class:'app-shell'},el('aside',{class:'sidebar'},el('div',{class:'brand'},el('span',{class:'brand-mark'},'M'),el('h1',{},'Meeting Poll')),actions,nav,label('Display timezone',displayZone)),el('main',{class:'app-main'},el('header',{class:'toolbar'},search,button('Refresh',refresh)),status,el('div',{class:'workspace'},el('section',{class:'collection'},el('div',{class:'collection-head'},el('h2',{class:'section-title'},'Meetings')),records),detail))));
search.addEventListener('input',render);displayZone.addEventListener('change',()=>{zone=displayZone.value;render();});
try{const token=new URLSearchParams(location.hash.slice(1)).get('access');if(token){csrf=(await request('/session','POST',{token})).csrf;history.replaceState(null,'',location.pathname);}else csrf=(await request('/session')).csrf;await refresh();}catch(e){app.setAttribute('aria-busy','false');error(e);}
