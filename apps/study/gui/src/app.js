import {el} from '/shared/client.js';

const root=document.querySelector('#app');
const nav=el('nav',{'aria-label':'Study navigation'});
const notice=el('p',{role:'status','aria-live':'polite'},'Connecting…');
const stage=el('article',{class:'detail','aria-label':'Study workspace'});
root.replaceChildren(el('h1',{},'Language Study Workspace'),nav,notice,stage);

let csrf='',allow=new Set(),section='Queue',generation=0;
const ready=name=>allow.has('study.'+name);
const status=text=>{notice.textContent=text;};
const list=items=>el('ul',{},items.map(text=>el('li',{},text)));
const paragraph=text=>el('p',{},text);
const field=(caption,input)=>el('label',{},caption,' ',input);
const number=(value,min,max)=>el('input',{type:'number',value:String(value),min,max,step:1});
const exactInt=input=>{if(input.value.trim()===''||!input.validity.valid)throw Error('Enter valid whole-number limits and target day.');return input.valueAsNumber;};

async function request(url,method='GET',value){
  const r=await fetch(url,{method,headers:method==='POST'?{'Content-Type':'application/json','X-Pale-CSRF':csrf}:{},...(method==='POST'?{body:JSON.stringify(value)}:{})});
  const out=await r.json();
  if(!r.ok)throw Object.assign(Error(out.message||out.error||'Connection failed'),{code:'http_error'});
  return out;
}
async function call(name,args={}){
  if(!ready(name))throw Object.assign(Error('This operation is unavailable under the current study policy.'),{code:'unavailable'});
  const r=await request('/api/call','POST',{name:'study.'+name,arguments:args});
  if(!['ok','committed'].includes(r.status))throw Object.assign(Error(r.message||r.status),{code:r.status});
  return r;
}
function button(label,fn,token){
  return el('button',{type:'button',onclick:()=>Promise.resolve().then(fn).catch(err=>{
    if(token===undefined||token===generation)status(err.message);
  })},label);
}
function mount(token,...nodes){if(token===generation){stage.replaceChildren(...nodes);status('Study state loaded.');}}
const group=(label,...children)=>el('section',{'aria-label':label},...children);
function controls(...children){return el('div',{class:'actions'},...children);}
function gated(container,operation,label,handler,token){
  if(ready(operation))container.append(button(label,handler,token));
}
function trackedWrite(token,parent,operation,label,collect,version,done){
  let attempt,settled=false,busy=false,unconfirmed=false;
  const originalLabel=label;
  const submit=button(label,async()=>{
    if(busy||settled||token!==generation||!parent.isConnected)return;
    const payload=attempt||{...collect(),expected_version:version,request_id:crypto.randomUUID()};
    attempt=payload;busy=true;
    // Keep concurrent mutations and draft edits out of this UI panel while a receipt is unresolved.
    const panel=parent.closest('[data-write-scope]')||parent;
    const locked=[...panel.querySelectorAll('button,input,textarea,select')].filter(e=>!e.disabled||e.dataset.writeLocked==='yes');
    locked.forEach(e=>{e.disabled=true;e.dataset.writeLocked='yes';});
    try{
      const receipt=await call(operation,payload);
      settled=true;unconfirmed=false;
      if(token===generation&&parent.isConnected)await done(receipt);
    }catch(err){
      if(err.code){
        settled=true;unconfirmed=false;
        if(token===generation&&parent.isConnected)status(err.message);
      }else if(token===generation&&parent.isConnected){
        unconfirmed=true;
        status('No confirmation received. Retry the same request or refresh and check what was saved.');
        submit.textContent='Retry '+originalLabel;
      }
    }finally{
      busy=false;
      if(unconfirmed)submit.disabled=false;
      else locked.forEach(e=>{e.disabled=false;delete e.dataset.writeLocked;});
      if(settled)submit.disabled=true;
    }
  },token);
  parent.append(submit);return submit;
}
async function updated(token,next,message){
  if(token!==generation)return;
  await show(next,message);
}
function writeArea(...children){return el('div',{'data-write-scope':''},...children);}

async function show(next=section,message){
  section=next;const token=++generation;
  for(const e of nav.querySelectorAll('[data-section]')){
    if(e.dataset.section===next)e.setAttribute('aria-current','page');
    else e.removeAttribute('aria-current');
  }
  stage.replaceChildren();status('Reading study state…');
  const title=el('h2',{},next);
  try {
    if(next==='Decks')await showDecks(token,title);
    else if(next==='Plan')await showPlan(token,title);
    else if(next==='History')await showHistory(token,title);
    else await showQueue(token,title);
    if(token===generation&&message)status(message);
  } catch(err) {
    if(token===generation){stage.replaceChildren(title);status(err.message);}
  }
}
async function showDecks(token,title){
  const data=await call('list_cards');if(token!==generation)return;
  const pane=group('Card details');
  let openSeq=0;
  async function open(cardId,deckId){
    const seq=++openSeq;
    const existing=cardId?await call('get_card',{card_id:cardId}):null;
    if(token!==generation||openSeq!==seq)return;
    const source=existing?.card;
    const edit=writeArea();
    const label=source?'Edit '+source.prompt:'New card';
    if(source)edit.append(paragraph((source.suspended?'Suspended':'Active')+' · stage '+source.stage+' · due day '+source.due_day+' · card version '+source.card_version));
    if(ready('save_card')){
      const prompt=el('input',{type:'text',value:source?.prompt||'',maxlength:120});
      const answer=el('textarea',{maxlength:120},source?.answer||'');
      const row=controls();edit.append(field('Prompt',prompt),field('Answer',answer),row);
      trackedWrite(token,row,'save_card','Save card',()=>{
        if(!prompt.value.trim()||!answer.value.trim())throw Error('Enter a prompt and answer.');
        return {...(cardId?{card_id:cardId}:{}),deck_id:deckId,prompt:prompt.value.trim(),answer:answer.value.trim()};
      },existing?.version||data.version,()=>updated(token,'Decks','Card saved; reloaded authoritative decks.'));
    } else if(source)edit.append(paragraph(source.answer));
    const actions=controls();
    if(source&&ready('set_suspension'))
      trackedWrite(token,actions,'set_suspension',source.suspended?'Restore card':'Suspend card',()=>({card_id:source.id,suspended:!source.suspended}),existing.version,
        ()=>updated(token,'Decks',source.suspended?'Card restored.':'Card suspended.'));
    actions.append(button('Discard card form',()=>{++openSeq;pane.replaceChildren();status('Card draft discarded; nothing saved.');},token));
    edit.append(actions);
    pane.replaceChildren(el('h3',{},label),edit);
  }
  const decks=data.decks.map(deck=>{
    const cards=data.cards.filter(c=>c.deck_id===deck.id);
    const rows=el('ul',{},cards.map(c=>el('li',{},c.prompt+(c.suspended?' · Suspended':''),
      ...(ready('get_card')?[' ',button('Open '+c.prompt,()=>open(c.id,deck.id),token)]:[]))));
    const actions=controls();gated(actions,'save_card','Add card to '+deck.name,()=>open(null,deck.id),token);
    return el('section',{},el('h3',{},deck.name),cards.length?rows:paragraph('No cards.'),actions);
  });
  mount(token,title,...decks,pane);
}
const describePlan=plan=>list(['Target: study day '+plan.target_day,'Daily review limit: '+plan.daily_limit,'New-card limit: '+plan.new_limit,
 ...(plan.revision===undefined?[]:['Plan revision: '+plan.revision])]);
function capacityView(capacity){
  return list(['Remaining cards: '+capacity.remaining_cards,'Due now: '+capacity.due_now,'Available slots: '+capacity.available_slots,'Missing slots: '+capacity.missing_slots]);
}
function noticeView(notices){
  if(!notices?.length)return paragraph('No study notices.');
  return list(notices.map(n=>{
    const change={target_changed:'Target changed',card_corrected:'Card corrected',change_target:'Target changed',correct_card:'Card corrected','study.change_target':'Target changed','study.correct_card':'Card corrected'};
    return 'Study day '+n.day+' · '+(change[n.kind]||n.kind)+' · '+n.object_id;
  }));
}
async function showPlan(token,title){
  const info=await call('get_plan');if(token!==generation)return;
  const statusBox=group('Capacity');
  if(ready('get_capacity')){
    const {capacity}=await call('get_capacity');if(token!==generation)return;
    statusBox.append(el('h3',{},'Capacity'),capacityView(capacity));
  }
  const edit=group('Plan draft');const {plan}=info;
  if(ready('preview_plan')){
    const {decks}=await call('list_cards');if(token!==generation)return;
    const begin=()=>{
      const day=number(plan.target_day,-100000,100000),daily=number(plan.daily_limit,1,100),fresh=number(plan.new_limit,0,100);
      const check=decks.map(d=>({deck:d,input:el('input',{type:'checkbox'})}));
      check.forEach(x=>{x.input.checked=plan.deck_ids.includes(x.deck.id);});
      const box=el('fieldset',{},el('legend',{},'Decks'),...check.map(x=>field(x.deck.name,x.input)));
      const content=group('Plan preview');const action=controls();
      let editSeq=0;
      const draft=writeArea(box,controls(field('Target study day',day),field('Daily review limit',daily),field('New-card limit',fresh)),action,content);
      const invalidate=()=>{++editSeq;content.replaceChildren();};
      draft.addEventListener('input',invalidate);
      action.append(button('Preview plan',async()=>{
        const seq=++editSeq;content.replaceChildren();
        const deck_ids=check.filter(x=>x.input.checked).map(x=>x.deck.id);
        if(!deck_ids.length)throw Error('Select at least one deck.');
        const proposal={deck_ids,target_day:exactInt(day),daily_limit:exactInt(daily),new_limit:exactInt(fresh)};
        const review=await call('preview_plan',proposal);
        if(token!==generation||seq!==editSeq)return;
        const save=controls();
        if(ready('save_plan'))trackedWrite(token,save,'save_plan','Save previewed plan',()=>proposal,info.version,()=>updated(token,'Plan','Plan saved; reloaded authoritative plan and capacity.'));
        content.replaceChildren(el('h3',{},'Preview (not saved)'),describePlan(review.plan),capacityView(review.capacity),save);
      },token),button('Discard plan draft',()=>{invalidate();edit.replaceChildren(beginButton());status('Plan draft discarded; nothing saved.');},token));
      edit.replaceChildren(draft);
    };
    const beginButton=()=>button(ready('save_plan')?'Edit plan':'Try plan preview',begin,token);
    edit.append(beginButton());
  }
  mount(token,title,describePlan(plan),statusBox,edit,group('Study notices',el('h3',{},'Study notices'),noticeView(info.notices)));
}
async function showQueue(token,title){
  const q=await call('get_queue');if(token!==generation)return;
  const pane=group('Review card');let local=0;
  const rendered=writeArea();
  const sessionInfo=q.session?.card_id?paragraph('Session: '+(q.session.paused?'paused':'active')+' · '+q.session.card_id):null;
  if(sessionInfo)rendered.append(sessionInfo);
  const qActions=controls();
  if(q.session?.card_id&&ready('set_session')){
    const paused=Boolean(q.session.paused);
    trackedWrite(token,qActions,'set_session',paused?'Resume session':'Pause session',()=>({card_id:q.session.card_id,paused:!paused}),q.version,
      ()=>updated(token,'Queue',paused?'Session resumed.':'Session paused.'));
  }
  rendered.append(qActions);
  const open=async c=>{
    const seq=++local;
    pane.replaceChildren();
    const r=await call('reveal',{card_id:c.id});
    if(token!==generation||seq!==local)return;
    const actions=controls();const review=writeArea(el('h3',{},c.prompt),paragraph(r.answer),actions);
    if(ready('record_review')&&!q.session?.paused){
      for(const rating of ['Again','Good']){
        trackedWrite(token,actions,'record_review',rating,()=>({card_id:r.card_id,card_version:r.card_version,review_day:r.review_day,rating}),r.version,
          ()=>updated(token,'Queue','Recorded: '+rating));
      }
    }else actions.append(paragraph(q.session?.paused?'Resume before recording a review.':'Rating is disabled by the current study policy.'));
    if(ready('set_session')&&!q.session?.paused&&q.session?.card_id!==r.card_id)
      trackedWrite(token,actions,'set_session','Pause at this card',()=>({card_id:r.card_id,paused:true}),r.version,
        ()=>updated(token,'Queue','Session paused.'));
    actions.append(button('Close revealed card',()=>{++local;pane.replaceChildren();status('Review form closed; no rating recorded.');},token));
    pane.replaceChildren(review);
  };
  const rows=el('ul',{},q.cards.map(c=>el('li',{},c.prompt,' ',button('Reveal '+c.prompt,()=>open(c),token))));
  rendered.append(q.cards.length?rows:paragraph('No eligible cards.'),pane);
  mount(token,title,paragraph('Study day '+q.day+' · '+q.remaining+' review slots and '+q.new_remaining+' new-card slots left'),rendered);
}
async function showHistory(token,title){
  const data=await call('get_history');if(token!==generation)return;
  const undo=controls();
  if(ready('undo_review')&&data.undoable_review_id){
    undo.append(button('Undo latest review',()=>{
      undo.replaceChildren(paragraph('Undo the latest effective review and release its daily slot?'));
      trackedWrite(token,undo,'undo_review','Confirm undo',()=>({review_id:data.undoable_review_id}),data.version,()=>updated(token,'History','Latest review undone; audit entry retained.'));
      undo.append(button('Keep review',()=>updated(token,'History','Undo canceled; nothing changed.'),token));
    },token));
  }
  mount(token,title,data.history.length?list(data.history.map(r=>r.card_id+' · day '+r.day+' · '+r.rating+' · due day '+r.due_day+(r.undone?' · Undone':''))):paragraph('No reviews recorded.'),undo);
}
async function init(){
  const access=new URLSearchParams(location.hash.slice(1)).get('access');
  if(access){history.replaceState(null,'',location.pathname);({csrf}=await request('/session','POST',{token:access}));}
  else ({csrf}=await request('/session'));
  allow=new Set((await request('/api/tools')).tools.map(t=>t.name));
  nav.replaceChildren(...['Decks','Plan','Queue','History'].map(s=>{
    const tab=button(s,()=>show(s));tab.dataset.section=s;return tab;
  }),button('Refresh',()=>show()));
  await show();
}
init().catch(err=>status(err.message));
