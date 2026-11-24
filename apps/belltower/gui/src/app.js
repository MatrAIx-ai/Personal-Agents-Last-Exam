// Belltower business pages: local news and public notices with every revision, follow rules,
// clippings, the notification log, the reading record and settings. This controller is the App's
// own: its navigation, forms and how revisions, copies and notifications are shown. The shared
// Host serves it and forwards only the Agent's permitted tools. Every value shown comes from
// those tools; the page keeps no business data of its own, never marks an item as read by
// itself and never uses the browser clock for a business decision.
import {mount,el,textBlock} from '/shared/client.js';

const TOOL={
  sources:'belltower.sources.list',areas:'belltower.areas.list',items:'belltower.items.list',item:'belltower.items.get',
  follows:'belltower.follows.list',reading:'belltower.reading.list',clippings:'belltower.clippings.list',
  notifications:'belltower.notifications.list',preferences:'belltower.preferences.get',
  follow:'belltower.follows.create',editFollow:'belltower.follows.update',unfollow:'belltower.follows.remove',
  settings:'belltower.preferences.update',mark:'belltower.reading.mark',
  clip:'belltower.clippings.add',editClip:'belltower.clippings.update',unclip:'belltower.clippings.remove'
};

// ---- presentation ---------------------------------------------------------------------------
const sheet=new CSSStyleSheet();
sheet.replaceSync(`
.brand h1{font-size:1.3rem;letter-spacing:-.01em}
.detail-actions:has(.actions:empty){display:none}
[hidden]{display:none!important}
.bt-list{display:grid;gap:.45rem}
.bt-list-head{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.6rem;padding:.35rem 1.35rem .2rem}
.bt-list-head p{margin:0;color:var(--muted);font-size:.85rem;flex:1 1 12rem}
.bt-list-head select{flex:1 1 9rem;min-width:0}
.bt-list>.empty{padding:0 1.35rem}
.bt-filters{margin:0 1.35rem;border:1px solid var(--line);border-radius:10px;padding:.45rem .7rem}
.bt-filters summary{cursor:pointer;font-weight:600;font-size:.9rem}
.bt-filter-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(10.5rem,1fr));gap:.45rem;margin-top:.55rem}
.bt-filter-grid select{min-width:0;width:100%}
.bt-group{margin:.8rem 0 .1rem;padding:0 1.35rem;font-size:.72rem;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);font-weight:700}
.bt-row{display:grid;gap:.25rem;width:100%;text-align:left}
.bt-row-sub{color:var(--muted);font-size:.84rem}
.bt-chips{display:flex;flex-wrap:wrap;gap:.3rem}
.bt-chip{display:inline-flex;align-items:center;border-radius:999px;padding:.05rem .55rem;font-size:.74rem;font-weight:600;border:1px solid var(--line);background:var(--soft);white-space:nowrap}
.bt-chip[data-tone=good]{background:#ecfdf3;border-color:#abefc6;color:#067647}
.bt-chip[data-tone=warn]{background:#fffaeb;border-color:#fedf89;color:#b54708}
.bt-chip[data-tone=bad]{background:#fef3f2;border-color:#fecdca;color:#b42318}
.bt-chip[data-tone=quiet]{color:var(--muted)}
.bt-page{display:grid;gap:1rem;min-width:0}
.bt-head h2{margin:0;font-size:1.5rem}
.bt-head p{margin:.2rem 0 0;color:var(--muted)}
.bt-toolbar{display:flex;flex-wrap:wrap;gap:.45rem;align-items:center}
.bt-card{border:1px solid var(--line);border-radius:14px;padding:.9rem 1rem;min-width:0;display:grid;gap:.5rem}
.bt-card h3{margin:0;font-size:1rem}
.bt-banner{border-left:4px solid var(--accent);background:var(--soft);padding:.6rem .8rem;border-radius:8px;display:grid;gap:.35rem}
.bt-banner[data-tone=bad]{border-color:#d92d20;background:#fef3f2}
.bt-banner[data-tone=warn]{border-color:#f79009;background:#fffaeb}
.bt-banner p{margin:0}
.bt-muted{color:var(--muted);font-size:.85rem;margin:0}
.bt-dl{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:.3rem 1rem;margin:0}
.bt-dl dt{color:var(--muted)}
.bt-dl dd{margin:0;overflow-wrap:anywhere}
.bt-revisions{list-style:none;padding:0;margin:0;display:grid;gap:.4rem}
.bt-rev{display:grid;gap:.15rem;width:100%;text-align:left;border:1px solid var(--line);border-radius:10px;padding:.5rem .7rem;background:transparent;cursor:pointer;font:inherit;color:inherit}
.bt-rev[aria-pressed=true]{border-color:var(--accent);background:var(--soft)}
.bt-links{list-style:none;padding:0;margin:0;display:grid;gap:.4rem}
.bt-links li{display:flex;justify-content:space-between;gap:.6rem;align-items:center;flex-wrap:wrap;border-bottom:1px dashed var(--line);padding-bottom:.4rem}
.bt-links li>span{min-width:0;overflow-wrap:anywhere}
.bt-history{list-style:none;padding:0;margin:0;display:grid;gap:.45rem}
.bt-history li{border:1px solid var(--line);border-radius:10px;padding:.5rem .7rem;display:grid;gap:.2rem}
.bt-form{display:grid;gap:.75rem;width:min(660px,86vw)}
.bt-form h2{margin:0}
.bt-form fieldset,.bt-settings fieldset{border:1px solid var(--line);border-radius:10px;padding:.6rem .8rem .8rem;display:grid;gap:.55rem;margin:0;min-width:0}
.bt-form legend,.bt-settings legend{display:block;font-weight:700;padding:0 .3rem}
.bt-form label{display:grid;gap:.25rem}
.bt-checks{display:flex;flex-wrap:wrap;gap:.35rem 1rem}
label.bt-check,.bt-checks label{display:flex!important;justify-content:flex-start;grid-template-columns:none;gap:.45rem;align-items:center;text-align:left}
label.bt-check input,.bt-checks input{width:auto;flex:0 0 auto;margin:0}
.bt-checks label.bt-level1{margin-left:1rem}
.bt-checks label.bt-level2{margin-left:2rem}
.bt-area-checks{display:grid;gap:.3rem}
.bt-pair{display:grid;grid-template-columns:1fr 1fr;gap:.6rem}
.bt-triple{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.6rem}
.bt-fields{display:grid;gap:.75rem}
.bt-error{color:#b42318;font-weight:600;margin:0;min-height:1.2em}
.bt-settings{display:grid;gap:.8rem;max-width:620px}
.bt-area{padding:.15rem 1.35rem;font-size:.86rem}
.bt-area[data-level=district]{padding-left:2.2rem}
.bt-area[data-level=neighbourhood]{padding-left:3.1rem;color:var(--muted)}
dialog.bt-dialog{max-width:min(740px,94vw);max-height:90vh;overflow:auto}
@media(max-width:760px){.bt-pair,.bt-triple{grid-template-columns:1fr}}
`);
document.adoptedStyleSheets=[...document.adoptedStyleSheets,sheet];

const fmts=new Map();
const formatter=(tz,options)=>{const key=tz+JSON.stringify(options);if(!fmts.has(key))fmts.set(key,new Intl.DateTimeFormat('en-US',{timeZone:tz,...options}));return fmts.get(key);};
// Times are shown in the account's zone (preferences.timezone), never the browser's.
let clockYear=null; // the year of the App's virtual clock, from the last refresh
const yearOf=iso=>String(iso).slice(0,4);
const when=(iso,tz)=>iso?formatter(tz,{weekday:'short',month:'short',day:'numeric',...(clockYear&&yearOf(iso)!==clockYear?{year:'numeric'}:{}),hour:'numeric',minute:'2-digit'}).format(new Date(iso)):'—';
const zoneName=(tz,iso)=>formatter(tz,{timeZoneName:'short'}).formatToParts(iso?new Date(iso):new Date(0)).find(p=>p.type==='timeZoneName')?.value||tz;
const span=(a,b,tz)=>when(a,tz)+' – '+(b?when(b,tz):'until further notice');

const TOPICS=['water','power','roads','transit','schools','libraries','health','safety','weather','government','community','business'];
const PRIORITIES=['routine','important','urgent'];
const TYPE={original:'Original',update:'Update',correction:'Correction',retraction:'Retraction'};
const KIND={'item.published':['Published',null],'item.updated':['Updated',null],'item.corrected':['Corrected','warn'],'item.retracted':['Retracted','bad']};
const kindChip=kind=>chip(KIND[kind]?.[0]||kind,KIND[kind]?.[1]);
const REASON={follow:'a follow rule matches',earlier_notification:'you were notified about this item before',watched_clipping:'you watch a clipping of it'};
const toneOf={current:'good',corrected:'warn',retracted:'bad',urgent:'bad',important:'warn',upcoming:'warn',in_effect:'good',ended:'quiet',held:'warn',released:'quiet',superseded:'quiet',behind:'warn',paused:'warn',active:'good',correction:'warn',retraction:'bad'};
const words=value=>String(value||'').replace(/_/g,' ').replace(/^./,c=>c.toUpperCase());
const chip=(text,tone)=>el('span',{class:'bt-chip','data-tone':tone||toneOf[text]||null},words(text));
const effectChip=item=>item.kind==='notice'&&item.effect?chip(item.effect==='in_effect'?'In effect':words(item.effect),toneOf[item.effect]):null;
const priorityText=p=>p==='urgent'?'Urgent only':p==='important'?'Important or urgent':'Any priority';
const button=(label,onclick,primary=false,extra={})=>el('button',{type:'button',class:primary?'primary':'',onclick,...extra},label);
const definition=pairs=>el('dl',{class:'bt-dl'},pairs.filter(Boolean).flatMap(([k,v])=>[el('dt',{},k),el('dd',{},v??'—')]));
const empty=(title,text,...more)=>el('div',{class:'empty'},el('h3',{},title),el('p',{},text),...more);
const say=text=>{const s=document.getElementById('status');if(s){s.textContent=text;delete s.dataset.error;}};
const searchText=()=>(document.querySelector('.toolbar input[type=search]')?.value||'').trim().toLowerCase();
const found=(q,...texts)=>!q||texts.join(' ').toLowerCase().includes(q);
const setCount=n=>{const c=document.querySelector('.collection-count');if(c)c.textContent=String(n);};
// Async parts of a view mark themselves loaded, so a reader (or a test) knows the values are in.
const loaded=node=>{node.dataset.loaded='true';return node;};
const fail=(message,code)=>{throw Object.assign(Error(message),{code});};

// ---- UI state: what is selected and filtered. Business data is always read again. --------------
const state={filters:{source_id:'',area_id:'',topic:'',kind:'',status:'',min_priority:'',changed:''},filtersOpen:false,
  revision:new Map(),follow:null,clipping:null,clipState:'',notification:null,nKind:'',nState:'',mark:null};
const aux=ui=>ui.aux||{};
const accountZone=ui=>aux(ui).preferences?.timezone||'UTC';
const sourceName=(ui,id)=>aux(ui).sources?.find(s=>s.id===id)?.name||id;
const areaName=(ui,id)=>aux(ui).areas?.find(a=>a.id===id)?.name||id;
const headline=(ui,id)=>aux(ui).headlines?.get(id)||id;
const sameSet=(a,b)=>a.length===b.length&&[...a].sort().join('\n')===[...b].sort().join('\n');
const newsArgs=()=>{const f=state.filters,a={limit:100};for(const k of ['source_id','area_id','topic','kind','status','min_priority'])if(f[k])a[k]=f[k];if(f.changed)a.changed_since_read=f.changed==='yes';return a;};
const notificationArgs=()=>({limit:50,...(state.nKind?{kind:state.nKind}:{}),...(state.nState?{state:state.nState}:{})});

// Writes carry the version the form was opened on, so a concurrent change shows as a conflict
// instead of being overwritten; an unchanged resubmission reuses its request ID, so a retry after
// a lost response cannot repeat the effect.
function writer(ui,version){
  let pending=null;
  return async(name,args)=>{
    const payload={...args,expected_version:version},signature=name+JSON.stringify(payload);
    if(!pending||pending.signature!==signature)pending={signature,id:'web-'+crypto.randomUUID()};
    return ui.call(name,{...payload,request_id:pending.id});
  };
}
// One-click writes (mark as read, pause, watch, move) resend the same request after a lost response.
const quick=new Map();
async function quickWrite(ui,key,name,args,version){
  const kept=quick.get(key),payload=kept||{...args,expected_version:version,request_id:'web-'+crypto.randomUUID()};
  quick.set(key,payload);
  try{const result=await ui.call(name,payload);quick.delete(key);return result;}
  catch(e){if(e.code)quick.delete(key);throw e;}
}

function dialog(title,submitLabel,onSubmit){
  const error=el('p',{role:'alert',class:'form-error bt-error'}),body=el('div',{class:'bt-fields'});
  const submit=el('button',{type:'submit',class:'primary'},submitLabel),cancel=el('button',{type:'button'},'Cancel');
  const form=el('form',{class:'bt-form','aria-label':title},el('h2',{},title),body,error,el('div',{class:'form-actions'},cancel,submit));
  const node=el('dialog',{class:'bt-dialog','aria-label':title},form);
  cancel.addEventListener('click',()=>node.close());
  node.addEventListener('close',()=>node.remove());
  let busy=false;
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;busy=true;submit.disabled=true;error.textContent='';delete error.dataset.code;
    try{if(await onSubmit()!==false)node.close();}
    catch(e){error.textContent=e.message;error.dataset.code=e.code||'request_failed';}
    finally{busy=false;submit.disabled=false;}
  });
  document.body.append(node);node.showModal();
  return {node,body};
}
const field=(label,input,help)=>el('label',{class:'field'},el('span',{},label),input,help?el('small',{},help):null);
const select=(name,options,value)=>{const s=el('select',{'data-field':name});for(const [v,l] of options)s.append(el('option',{value:v},l));if(value!==undefined&&value!==null)s.value=String(value);return s;};
// A set of checkboxes; values() gives the checked values in the App's order.
function checkGroup(name,options,checked,cls='bt-checks'){
  const box=el('div',{class:cls,'data-field':name,role:'group'});
  for(const [value,label,level] of options){const input=el('input',{type:'checkbox',value});input.checked=checked.includes(value);box.append(el('label',{class:level?'bt-level'+level:''},input,label));}
  box.values=()=>[...box.querySelectorAll('input:checked')].map(i=>i.value);
  return box;
}
const levelOf=area=>Math.max(0,(area.path||[]).length-1);

// ---- data loaded with every refresh ------------------------------------------------------------
async function load(ui){
  const out={preferences:null,sources:[],areas:[],follows:[],clippings:[],notifications:[],notificationCursor:null,marks:[],markCursor:null,headlines:new Map()};
  if(ui.has(TOOL.preferences))out.preferences=(await ui.call(TOOL.preferences,{})).preferences;
  if(ui.has(TOOL.sources))out.sources=(await ui.call(TOOL.sources,{})).sources;
  if(ui.has(TOOL.areas))out.areas=(await ui.call(TOOL.areas,{})).areas;
  if(ui.has(TOOL.follows))out.follows=(await ui.call(TOOL.follows,{})).follows;
  if(ui.has(TOOL.clippings))out.clippings=(await ui.call(TOOL.clippings,state.clipState?{state:state.clipState}:{})).clippings;
  if(ui.has(TOOL.notifications)){const r=await ui.call(TOOL.notifications,notificationArgs());out.notifications=r.notifications;out.notificationCursor=r.next_cursor;}
  if(ui.has(TOOL.reading)){const r=await ui.call(TOOL.reading,{limit:100});out.marks=r.marks;out.markCursor=r.next_cursor;}
  // Headlines for clippings and read marks: the News list when it is complete, otherwise the newest 100 items.
  const filtered=Object.values(state.filters).some(Boolean)||searchText();
  for(const item of filtered?(await ui.call(TOOL.items,{limit:100})).items:ui.records)out.headlines.set(item.id,item.headline);
  for(const id of new Set([...out.clippings.map(c=>c.item_id),...out.marks.map(m=>m.item_id)]))
    if(!out.headlines.has(id))out.headlines.set(id,(await ui.call(TOOL.item,{id})).item.headline);
  clockYear=out.preferences?.next_digest_at?yearOf(out.preferences.next_digest_at):null;
  return out;
}

// ---- lists (middle column) ------------------------------------------------------------------------
function renderList(shown,ui){
  const q=searchText();
  if(ui.section==='following')return followList(ui,q);
  if(ui.section==='clippings')return clippingList(ui,q);
  if(ui.section==='notifications')return notificationList(ui,q);
  if(ui.section==='reading')return markList(ui,q);
  if(ui.section==='settings')return sourceList(ui);
  return newsList(shown,ui);
}
function row(attrs,selected,onclick,title,sub,chips){
  return el('button',{type:'button',class:'record',...attrs,'aria-pressed':String(selected),onclick},el('span',{class:'bt-row'},el('span',{class:'record-title'},title),sub?el('span',{class:'bt-row-sub'},sub):null,chips?el('span',{class:'bt-chips'},chips):null));
}
function newsList(shown,ui){
  const a=aux(ui),tz=accountZone(ui),f=state.filters;
  const filter=(name,label,options)=>{const s=select(name,options,f[name]);s.setAttribute('aria-label',label);s.addEventListener('change',()=>{f[name]=s.value;ui.refresh().catch(ui.error);});return s;};
  const on=Object.values(f).filter(Boolean).length;
  const box=el('details',{class:'bt-filters'},el('summary',{},'Filters'+(on?' · '+on+' on':'')),el('div',{class:'bt-filter-grid'},
    filter('source_id','Source',[['','All sources'],...(a.sources||[]).map(s=>[s.id,s.name])]),
    filter('area_id','Area',[['','All areas'],...(a.areas||[]).map(x=>[x.id,'  '.repeat(levelOf(x))+x.name])]),
    filter('topic','Topic',[['','All topics'],...TOPICS.map(t=>[t,words(t)])]),
    filter('kind','Kind',[['','Articles and notices'],['article','Articles'],['notice','Public notices']]),
    filter('status','Status',[['','Any status'],['current','Current'],['corrected','Corrected'],['retracted','Retracted']]),
    filter('min_priority','Priority',[['','Any priority'],['important','Important or urgent'],['urgent','Urgent']]),
    filter('changed','Reading',[['','Read or not'],['yes','Changed since I read it'],['no','Not changed since I read it']])),
    on?button('Clear filters',()=>{for(const k of Object.keys(f))f[k]='';ui.refresh().catch(ui.error);}):null);
  box.open=state.filtersOpen;box.addEventListener('toggle',()=>{state.filtersOpen=box.open;});
  const list=el('div',{class:'bt-list'},el('div',{class:'bt-list-head'},el('p',{},shown.length?'Newest first. Search and filters look at every revision. Times in '+zoneName(tz,a.preferences?.next_digest_at)+'.':'No items match.')),box);
  for(const item of shown){
    const matched=item.matched_revisions||[];
    const chips=[effectChip(item),item.status!=='current'?chip(item.status):null,item.priority!=='routine'?chip(item.priority):null,
      item.changed_since_read?chip('Changed since read','warn'):null,item.clipping_id?chip('Clipped','quiet'):null,
      matched.length&&!matched.includes(item.revision)?chip('Found in revision '+matched.join(', '),'warn'):null];
    list.append(ui.record(item,el('span',{class:'bt-row'},el('span',{class:'record-title'},item.headline),
      el('span',{class:'record-subtitle'},sourceName(ui,item.source_id)+' · '+when(item.received_at,tz)+(item.revision>1?' · revision '+item.revision:'')),el('span',{class:'bt-chips'},chips))));
  }
  if(shown.length===100)list.append(el('p',{class:'bt-muted bt-area'},'The newest 100 are shown. Narrow with search or filters.'));
  return list;
}
function ruleText(ui,f){
  const parts=[f.topics.length?f.topics.map(words).join(', '):'Everything'];
  if(f.source_ids.length)parts.push('from '+f.source_ids.map(id=>sourceName(ui,id)).join(', '));
  if(f.area_ids.length)parts.push('in '+f.area_ids.map(id=>areaName(ui,id)).join(', '));
  return parts.join(' ');
}
function followList(ui,q){
  const items=(aux(ui).follows||[]).filter(f=>found(q,ruleText(ui,f),f.delivery,f.state));
  setCount(items.length);
  const list=el('div',{class:'bt-list'}),head=el('div',{class:'bt-list-head'},el('p',{},'A rule notifies you about new revisions that meet all its filters.'));
  if(ui.has(TOOL.follow))head.append(button('New follow rule',()=>followDialog(ui,null).catch(ui.error),true));
  list.append(head);
  if(!items.length){list.append(empty('No follow rules','Follow sources, areas or topics to be told about what arrives from now on.'));return list;}
  if(!items.some(f=>f.id===state.follow))state.follow=items[0].id;
  for(const [title,group] of [['Active',items.filter(f=>f.state==='active')],['Paused',items.filter(f=>f.state==='paused')]]){
    if(!group.length)continue;
    list.append(el('h3',{class:'bt-group'},title+' ('+group.length+')'));
    for(const f of group)list.append(row({'data-follow-id':f.id},f.id===state.follow,()=>{state.follow=f.id;ui.navigate('following').catch(ui.error);},ruleText(ui,f),
      priorityText(f.min_priority)+' · '+(f.delivery==='immediate'?'immediately':'in the daily digest'),[f.state==='paused'?chip('paused'):null]));
  }
  return list;
}
function clippingList(ui,q){
  const items=(aux(ui).clippings||[]).filter(c=>found(q,headline(ui,c.item_id),c.note||'',c.state));
  setCount(items.length);
  const st=select('state',[['','All clippings'],['current','Current'],['behind','Behind']],state.clipState);st.setAttribute('aria-label','Clipping state');
  st.addEventListener('change',()=>{state.clipState=st.value;state.clipping=null;ui.refresh().catch(ui.error);});
  const list=el('div',{class:'bt-list'},el('div',{class:'bt-list-head'},el('p',{},'A clipping keeps one revision of an item with your note.'),st));
  if(!items.length){list.append(empty('No clippings',state.clipState?'No clipping is in this state.':'Clip an item from News to keep the revision you relied on.'));return list;}
  if(!items.some(c=>c.id===state.clipping))state.clipping=items[0].id;
  const tz=accountZone(ui);
  for(const c of items)list.append(row({'data-clipping-id':c.id},c.id===state.clipping,()=>{state.clipping=c.id;ui.navigate('clippings').catch(ui.error);},headline(ui,c.item_id),
    'Holds revision '+c.revision+(c.state==='behind'?' of '+c.latest_revision:'')+' · clipped '+when(c.created_at,tz),
    [chip(c.state),c.watch?chip('Watching','quiet'):null,c.linked_object?chip('Linked to '+c.linked_object.app_id,'quiet'):null]));
  return list;
}
function notificationList(ui,q){
  const a=aux(ui),items=(a.notifications||[]).filter(n=>found(q,n.title,n.body,n.kind));
  setCount(items.length);
  const kind=select('kind',[['','All kinds'],['item.published','Published'],['item.updated','Updated'],['item.corrected','Corrected'],['item.retracted','Retracted']],state.nKind);
  const st=select('state',[['','Any state'],['held','Held'],['released','Released'],['superseded','Superseded']],state.nState);
  kind.setAttribute('aria-label','Notification kind');st.setAttribute('aria-label','Notification state');
  // The log is read again with the App's own filters; a reader who moved on is not pulled back.
  const refilter=async()=>{state.nKind=kind.value;state.nState=st.value;const r=await ui.call(TOOL.notifications,notificationArgs());a.notifications=r.notifications;a.notificationCursor=r.next_cursor;state.notification=null;if(ui.section==='notifications')await ui.navigate('notifications');};
  kind.addEventListener('change',()=>refilter().catch(ui.error));st.addEventListener('change',()=>refilter().catch(ui.error));
  const list=el('div',{class:'bt-list'},el('div',{class:'bt-list-head'},kind,st));
  if(!items.length){list.append(empty('No notifications','A notification is written when a revision arrives that a rule, an earlier notification or a watched clipping asks for.'));return list;}
  if(!items.some(n=>n.id===state.notification))state.notification=items[0].id;
  const tz=accountZone(ui);
  for(const n of items)list.append(row({'data-notification-id':n.id},n.id===state.notification,()=>{state.notification=n.id;ui.navigate('notifications').catch(ui.error);},n.title,
    when(n.created_at,tz)+' · '+(n.delivery==='digest'?'digest':'immediate'),[kindChip(n.kind),chip(n.state)]));
  if(a.notificationCursor)list.append(button('Load older notifications',()=>(async()=>{const r=await ui.call(TOOL.notifications,{...notificationArgs(),cursor:a.notificationCursor});a.notifications.push(...r.notifications);a.notificationCursor=r.next_cursor;if(ui.section==='notifications')await ui.navigate('notifications');})().catch(ui.error)));
  return list;
}
function markList(ui,q){
  const a=aux(ui),items=(a.marks||[]).filter(m=>found(q,headline(ui,m.item_id)));
  setCount(items.length);
  const list=el('div',{class:'bt-list'},el('div',{class:'bt-list-head'},el('p',{},'What you marked as read, newest first. Opening an item does not mark it.')));
  if(!items.length){list.append(empty('Nothing marked as read','Mark the revision you read from an item page.'));return list;}
  if(!items.some(m=>m.item_id===state.mark))state.mark=items[0].item_id;
  const tz=accountZone(ui),seen=new Set();
  for(const m of items){
    const first=!seen.has(m.item_id);seen.add(m.item_id);
    list.append(row({'data-mark-item-id':m.item_id,'data-revision':String(m.revision)},first&&m.item_id===state.mark,()=>{state.mark=m.item_id;ui.navigate('reading').catch(ui.error);},headline(ui,m.item_id),
      'Revision '+m.revision+' · read '+when(m.read_at,tz),[m.is_latest?chip('Latest revision','good'):chip('Revision '+m.latest_revision+' is newer','warn')]));
  }
  if(a.markCursor)list.append(button('Load older read marks',()=>(async()=>{const r=await ui.call(TOOL.reading,{limit:100,cursor:a.markCursor});a.marks.push(...r.marks);a.markCursor=r.next_cursor;if(ui.section==='reading')await ui.navigate('reading');})().catch(ui.error)));
  return list;
}
function sourceList(ui){
  const a=aux(ui),sources=a.sources||[];setCount(sources.length);
  const list=el('div',{class:'bt-list'},el('div',{class:'bt-list-head'},el('p',{},'Sources Belltower carries. It does not rank them or say which one is right.')));
  for(const s of sources)list.append(el('div',{class:'record','data-source-id':s.id},el('span',{class:'bt-row'},el('span',{class:'record-title'},s.name),
    el('span',{class:'bt-row-sub'},words(s.kind==='official'?'official body':s.kind)+' · '+s.items+' item'+(s.items===1?'':'s')))));
  if(a.areas?.length){
    list.append(el('h3',{class:'bt-group'},'Areas'));
    for(const x of a.areas)list.append(el('p',{class:'bt-area','data-level':x.level,'data-area-id':x.id},x.name+' · '+x.level));
  }
  return list;
}

// ---- detail (right column) ---------------------------------------------------------------------------
function emptyView(ui){
  if(ui.section==='following')return followDetail(ui);
  if(ui.section==='clippings')return clippingDetail(ui);
  if(ui.section==='notifications')return notificationDetail(ui);
  if(ui.section==='reading')return markDetail(ui);
  if(ui.section==='settings')return settingsView(ui);
  return empty(Object.values(state.filters).some(Boolean)||searchText()?'No items match':'No news yet','Items arrive from the sources as they are published.');
}
async function openItem(ui,id,revision){
  if(revision)state.revision.set(id,revision);else state.revision.delete(id);
  if(ui.section!=='news')await ui.navigate('news');
  await ui.select(id);
}

// An item at one revision, with every revision of it, what it copies and who copied it.
function itemView(item,ui){
  const page=el('article',{class:'bt-page','data-item-id':item.id},el('p',{class:'bt-muted'},'Loading…'));
  const wanted=state.revision.get(item.id);
  showRevision(page,item.id,wanted,ui).catch(e=>{if(page.isConnected)page.replaceChildren(el('p',{role:'alert',class:'bt-error'},e.message));});
  return page;
}
async function showRevision(page,id,revision,ui){
  const r=await ui.call(TOOL.item,revision?{id,revision}:{id});
  if(!page.isConnected)return;
  if(revision&&r.item.is_latest)state.revision.delete(id);
  page.replaceChildren(...itemParts(r.item,ui,page));
  loaded(page);
}
function itemParts(it,ui,page){
  const a=aux(ui),tz=accountZone(ui),latest=it.revisions.at(-1),read=it.read_revisions.includes(it.revision);
  const pick=n=>{state.revision.set(it.id,n);page.removeAttribute('data-loaded');showRevision(page,it.id,n,ui).catch(ui.error);};
  const actions=el('div',{class:'bt-toolbar'});
  if(read)actions.append(chip('You marked revision '+it.revision+' as read','good'));
  else if(ui.has(TOOL.mark))actions.append(button('Mark revision '+it.revision+' as read',e=>markRead(ui,it,e.currentTarget),true));
  if(it.clipping_id){if(ui.has(TOOL.clippings))actions.append(button('Open clipping',()=>{state.clipping=it.clipping_id;ui.navigate('clippings').catch(ui.error);}));}
  else if(ui.has(TOOL.clip))actions.append(button('Clip this item',()=>clipDialog(ui,it).catch(ui.error)));
  const parts=[el('header',{class:'bt-head'},el('h2',{},it.headline),
      el('p',{},it.source_name+' ('+words(it.source_kind==='official'?'official body':it.source_kind)+') · '+(it.kind==='notice'?'public notice':'article')+' · '+it.area_ids.map(x=>areaName(ui,x)).join(', ')+' · '+it.topics.map(words).join(', '))),
    el('div',{class:'bt-chips'},chip(it.status),it.priority!=='routine'?chip(it.priority):null,effectChip(it)),actions];
  if(!it.is_latest)parts.push(el('section',{class:'bt-banner','data-tone':'warn','aria-label':'Earlier revision'},
    el('p',{},el('strong',{},'You are reading revision '+it.revision+' of '+it.latest_revision+'.'),' The latest is revision '+it.latest_revision+' ('+TYPE[latest.type].toLowerCase()+', received '+when(latest.received_at,tz)+').'),
    el('div',{class:'bt-toolbar'},button('Show the latest revision',()=>pick(it.latest_revision)))));
  if(it.type==='correction')parts.push(el('section',{class:'bt-banner','data-tone':'warn','aria-label':'Correction'},el('p',{},el('strong',{},'Correction from the publisher: '),it.note)));
  if(it.type==='retraction')parts.push(el('section',{class:'bt-banner','data-tone':'bad','aria-label':'Retraction'},el('p',{},el('strong',{},'Retracted by the publisher: '),it.note),
    el('p',{},'A retraction has no text of its own. The earlier revisions stay readable below.')));
  parts.push(el('section',{class:'bt-card','aria-label':'Revision text','data-revision':String(it.revision)},
    el('h3',{},'Revision '+it.revision+' · '+TYPE[it.type]),
    definition([['Published',when(it.published_at,tz)+' (as the publisher states)'],['Received',when(it.received_at,tz)],
      it.kind==='notice'&&it.effective?['In effect',span(it.effective.start,it.effective.end,tz)]:null,['Priority',words(it.priority)]]),
    it.body===null?el('p',{class:'bt-muted'},'No text in this revision.'):textBlock(it.body)));
  const revs=el('ol',{class:'bt-revisions'});
  for(const v of it.revisions)revs.append(el('li',{},el('button',{type:'button',class:'bt-rev','data-revision':String(v.revision),'aria-pressed':String(v.revision===it.revision),onclick:()=>pick(v.revision)},
    el('strong',{},'Revision '+v.revision+' · '+TYPE[v.type]),el('span',{class:'bt-muted'},'Published '+when(v.published_at,tz)+' · received '+when(v.received_at,tz)),
    v.note?el('span',{class:'bt-muted'},'Note: '+v.note):null,it.read_revisions.includes(v.revision)?el('span',{class:'bt-chips'},chip('You read this','good')):null)));
  parts.push(el('section',{class:'bt-card','aria-label':'Revisions'},el('h3',{},'Revisions ('+it.revisions.length+')'),revs,
    el('p',{class:'bt-muted'},it.read_revisions.length?'Marked as read: revision '+it.read_revisions.join(', ')+'.'+(it.changed_since_read?' A newer revision arrived since.':''):'Not marked as read.')));
  if(it.based_on){
    const b=it.based_on,card=el('section',{class:'bt-card','aria-label':'Based on'},el('h3',{},b.relation==='copy'?'A copy of another item':'A report on another item'),el('p',{class:'bt-muted'},'Loading…'));
    parts.push(card);
    ui.call(TOOL.item,{id:b.item_id,revision:b.revision}).then(r=>{
      const o=r.item;if(!card.isConnected)return;
      card.replaceChildren(el('h3',{},b.relation==='copy'?'A copy of another item':'A report on another item'),
        el('p',{},'The publisher states that this revision '+(b.relation==='copy'?'copies':'reports on')+' revision '+b.revision+' of “'+o.headline+'” from '+o.source_name+' ('+TYPE[o.type].toLowerCase()+', received '+when(o.received_at,tz)+'). That item has '+o.latest_revision+' revision'+(o.latest_revision===1?'':'s')+' now.'),
        el('div',{class:'bt-toolbar'},button('Open revision '+b.revision+' of it',()=>openItem(ui,b.item_id,b.revision).catch(ui.error)),o.latest_revision>b.revision?button('Open its latest revision',()=>openItem(ui,b.item_id).catch(ui.error)):null));
      loaded(card);
    }).catch(e=>{if(card.isConnected)card.replaceChildren(el('p',{role:'alert',class:'bt-error'},e.message));});
  }
  if(it.referenced_by.length){
    const links=el('ul',{class:'bt-links'});
    for(const x of it.referenced_by)links.append(el('li',{'data-ref-item-id':x.item_id},el('span',{},sourceName(ui,x.source_id)+' · '+x.relation+' of revision '+x.used_revision+' · published '+when(x.published_at,tz)),
      button('Open',()=>openItem(ui,x.item_id,x.revision).catch(ui.error))));
    parts.push(el('section',{class:'bt-card','aria-label':'Copied or reported by'},el('h3',{},'Copied or reported by ('+it.referenced_by.length+')'),links,
      el('p',{class:'bt-muted'},'Each one names the revision it used. Belltower does not merge them or say which is right.')));
  }
  if(ui.has(TOOL.notifications)){
    const card=el('section',{class:'bt-card','aria-label':'Notifications about this item'},el('h3',{},'Notifications about this item'),el('p',{class:'bt-muted'},'Loading…'));
    parts.push(card);
    ui.call(TOOL.notifications,{id:it.id,limit:20}).then(r=>{
      if(!card.isConnected)return;
      const links=el('ul',{class:'bt-links'});
      for(const n of r.notifications)links.append(el('li',{'data-notification-id':n.id},el('span',{},'Revision '+n.revision+' · '+n.kind.replace('item.','')+' · '+n.state+' · '+when(n.created_at,tz)),
        button('Open',()=>{state.notification=n.id;state.nKind='';state.nState='';ui.navigate('notifications').catch(ui.error);})));
      card.replaceChildren(el('h3',{},'Notifications about this item ('+r.notifications.length+')'),r.notifications.length?links:el('p',{class:'bt-muted'},'None.'));
      loaded(card);
    }).catch(e=>{if(card.isConnected)card.replaceChildren(el('p',{role:'alert',class:'bt-error'},e.message));});
  }
  parts.push(el('p',{class:'bt-muted'},'Item ID '+it.id+'. Times in '+zoneName(tz,it.received_at)+' ('+tz+').'));
  return parts;
}
async function markRead(ui,it,node){
  node.disabled=true;
  try{
    const fresh=await ui.call(TOOL.item,{id:it.id,revision:it.revision});
    await quickWrite(ui,'mark:'+it.id+':'+it.revision,TOOL.mark,{id:it.id,revision:it.revision},fresh.version);
    await ui.refresh(it.id);say('Revision '+it.revision+' marked as read.');
  }catch(e){ui.error(e);node.disabled=false;}
}
function linkFields(link){
  const app=el('input',{type:'text','data-field':'linked_object.app_id',maxlength:'100',value:link?.app_id||''});
  const type=el('input',{type:'text','data-field':'linked_object.object_type',maxlength:'100',value:link?.object_type||''});
  const id=el('input',{type:'text','data-field':'linked_object.object_id',maxlength:'150',value:link?.object_id||''});
  const read=()=>{const v=[app.value.trim(),type.value.trim(),id.value.trim()];if(!v.some(Boolean))return null;if(!v.every(Boolean))fail('Give the app, the object type and the object ID, or leave all three empty.','invalid_input');return {app_id:v[0],object_type:v[1],object_id:v[2]};};
  return {read,node:el('fieldset',{},el('legend',{},'What relies on it (optional)'),el('div',{class:'bt-triple'},field('App',app),field('Object type',type),field('Object ID',id)),
    el('p',{class:'bt-muted'},'For example calendar · event · its ID. Stored as given and never opened.'))};
}
async function clipDialog(ui,it){
  const base=await ui.call(TOOL.item,{id:it.id}),write=writer(ui,base.version),latest=base.item;
  const note=el('textarea',{'data-field':'note',maxlength:'1000',rows:'3'}),link=linkFields(null),watch=el('input',{type:'checkbox','data-field':'watch'});
  const d=dialog('Clip this item','Clip item',async()=>{
    const args={id:it.id},linked=link.read();
    if(note.value.trim())args.note=note.value.trim();
    if(linked)args.linked_object=linked;
    if(watch.checked)args.watch=true;
    const r=await write(TOOL.clip,args);state.clipping=r.id;await ui.refresh(it.id);say('Clipped at revision '+latest.revision+'.');
  });
  d.body.append(el('p',{},'“'+latest.headline+'”'),el('p',{class:'bt-muted'},'The clipping keeps revision '+latest.revision+', the latest, with your note.'),
    field('Note',note,'Why you keep it.'),link.node,el('label',{class:'bt-check'},watch,'Watch it: notify me about every later revision of this item'));
}

function followDetail(ui){
  const f=(aux(ui).follows||[]).find(x=>x.id===state.follow);
  if(!f)return empty('No rule selected','Choose a follow rule.');
  const tz=accountZone(ui),actions=el('div',{class:'bt-toolbar'});
  if(ui.has(TOOL.editFollow)){actions.append(button('Edit rule',()=>followDialog(ui,f).catch(ui.error)));actions.append(button(f.state==='paused'?'Resume rule':'Pause rule',e=>togglePause(ui,f,e.currentTarget)));}
  if(ui.has(TOOL.unfollow))actions.append(button('Remove rule',()=>removeFollow(ui,f).catch(ui.error)));
  return loaded(el('article',{class:'bt-page','data-follow-id':f.id},el('header',{class:'bt-head'},el('h2',{},ruleText(ui,f)),
      el('p',{},f.state==='paused'?'Paused: it matches nothing until it is resumed.':'Active: it matches revisions that arrive from now on.')),
    el('div',{class:'bt-chips'},chip(f.state),chip(f.delivery==='immediate'?'Immediate':'Daily digest','quiet')),actions,
    definition([['Sources',f.source_ids.length?f.source_ids.map(id=>sourceName(ui,id)).join(', '):'Any source'],['Areas',f.area_ids.length?f.area_ids.map(id=>areaName(ui,id)).join(', '):'Any area'],
      ['Topics',f.topics.length?f.topics.map(words).join(', '):'Any topic'],['Priority',priorityText(f.min_priority)],
      ['Delivery',f.delivery==='immediate'?'Immediately (held over quiet hours unless urgent)':'In the daily digest'],
      ['Created',when(f.created_at,tz)],['Changed',f.updated_at?when(f.updated_at,tz):'Never'],['Rule ID',f.id]]),
    el('p',{class:'bt-muted'},'Pausing or removing a rule does not withdraw notifications already written, and later revisions of an item you were already told about still notify you.')));
}
async function followDialog(ui,rule){
  const base=await ui.call(TOOL.follows,{}),write=writer(ui,base.version),a=aux(ui);
  const current=rule?base.follows.find(x=>x.id===rule.id):null;
  if(rule&&!current)fail('This rule no longer exists. Refresh.','not_found');
  const sources=checkGroup('source_ids',(a.sources||[]).map(s=>[s.id,s.name]),current?.source_ids||[]);
  const areas=checkGroup('area_ids',(a.areas||[]).map(x=>[x.id,x.name,levelOf(x)]),current?.area_ids||[],'bt-checks bt-area-checks');
  const topics=checkGroup('topics',TOPICS.map(t=>[t,words(t)]),current?.topics||[]);
  const priority=select('min_priority',PRIORITIES.map(p=>[p,priorityText(p)]),current?.min_priority||'routine');
  const delivery=select('delivery',[['immediate','Immediately'],['digest','In the daily digest']],current?.delivery||'digest');
  const d=dialog(current?'Edit follow rule':'New follow rule',current?'Save rule':'Follow',async()=>{
    const values={source_ids:sources.values(),area_ids:areas.values(),topics:topics.values(),min_priority:priority.value,delivery:delivery.value};
    if(!current){
      const args={min_priority:values.min_priority,delivery:values.delivery};
      for(const k of ['source_ids','area_ids','topics'])if(values[k].length)args[k]=values[k];
      const r=await write(TOOL.follow,args);state.follow=r.id;await ui.refresh();say('Follow rule created.');return;
    }
    const patch={};
    for(const k of ['source_ids','area_ids','topics'])if(!sameSet(values[k],current[k]))patch[k]=values[k];
    for(const k of ['min_priority','delivery'])if(values[k]!==current[k])patch[k]=values[k];
    if(!Object.keys(patch).length)fail('No changes to save.','no_changes');
    await write(TOOL.editFollow,{id:current.id,patch});await ui.refresh();say('Follow rule saved.');
  });
  d.body.append(el('p',{class:'bt-muted'},'A rule matches a new revision when every filter you set is met; an empty list means any. Set at least one source, area or topic. It applies to what arrives from now on.'),
    el('fieldset',{},el('legend',{},'Sources'),sources),
    el('fieldset',{},el('legend',{},'Areas'),areas,el('p',{class:'bt-muted'},'An area also matches the areas inside it and the area that contains it.')),
    el('fieldset',{},el('legend',{},'Topics'),topics),el('div',{class:'bt-pair'},field('Priority',priority),field('Delivery',delivery)));
}
async function togglePause(ui,rule,node){
  node.disabled=true;
  try{
    const base=await ui.call(TOOL.follows,{}),current=base.follows.find(x=>x.id===rule.id);
    if(!current||current.state!==rule.state)fail('This rule changed. Refresh before trying again.','stale_version');
    const paused=current.state==='active';
    await quickWrite(ui,'pause:'+rule.id+':'+paused,TOOL.editFollow,{id:rule.id,patch:{paused}},base.version);
    await ui.refresh();say(paused?'Rule paused.':'Rule resumed.');
  }catch(e){ui.error(e);node.disabled=false;}
}
async function removeFollow(ui,rule){
  const base=await ui.call(TOOL.follows,{}),write=writer(ui,base.version);
  const d=dialog('Remove this follow rule?','Remove rule',async()=>{await write(TOOL.unfollow,{id:rule.id});state.follow=null;await ui.refresh();say('Follow rule removed.');});
  d.body.append(el('p',{},ruleText(ui,rule)),el('p',{class:'bt-muted'},'It brings no notification for new items from now on. Notifications already written stay, and later revisions of an item you were already told about still notify you.'));
}

function clippingDetail(ui){
  const c=(aux(ui).clippings||[]).find(x=>x.id===state.clipping);
  if(!c)return empty('No clipping selected','Choose a clipping.');
  const page=el('article',{class:'bt-page','data-clipping-id':c.id},el('p',{class:'bt-muted'},'Loading…'));
  (async()=>{
    const r=await ui.call(TOOL.item,{id:c.item_id,revision:c.revision}),it=r.item,tz=accountZone(ui),latest=it.revisions.at(-1);
    if(state.clipping!==c.id||!page.isConnected)return;
    const actions=el('div',{class:'bt-toolbar'});
    if(ui.has(TOOL.editClip)){
      if(c.state==='behind')actions.append(button('Move to revision '+c.latest_revision,e=>moveClipping(ui,c,e.currentTarget),true));
      actions.append(button('Edit clipping',()=>editClipping(ui,c).catch(ui.error)));
      actions.append(button(c.watch?'Stop watching':'Watch',e=>toggleWatch(ui,c,e.currentTarget)));
    }
    if(ui.has(TOOL.unclip))actions.append(button('Remove clipping',()=>removeClipping(ui,c).catch(ui.error)));
    actions.append(button('Open the item',()=>openItem(ui,c.item_id,c.revision).catch(ui.error)));
    const history=el('ol',{class:'bt-history'});
    for(const h of [...c.history].reverse())history.append(el('li',{},el('strong',{},'Until '+when(h.replaced_at,tz)+': revision '+h.revision),
      el('span',{},h.note?'Note: '+h.note:'No note'),el('span',{class:'bt-muted'},(h.watch?'Watching':'Not watching')+(h.linked_object?' · linked to '+[h.linked_object.app_id,h.linked_object.object_type,h.linked_object.object_id].join(' · '):''))));
    page.replaceChildren(el('header',{class:'bt-head'},el('h2',{},it.headline),el('p',{},it.source_name+' · revision '+c.revision+' ('+TYPE[it.type].toLowerCase()+')')),
      el('div',{class:'bt-chips'},chip(c.state),c.watch?chip('Watching','quiet'):null),
      c.state==='behind'?el('section',{class:'bt-banner','data-tone':'warn','aria-label':'Newer revision'},
        el('p',{},el('strong',{},'The item has a newer revision.'),' Revision '+latest.revision+' ('+TYPE[latest.type].toLowerCase()+') was received '+when(latest.received_at,tz)+'.'),
        latest.note?el('p',{},'Publisher’s note: '+latest.note):null):null,
      actions,
      definition([['Holds','Revision '+c.revision+' of '+c.latest_revision],['Note',c.note||'No note'],
        ['Relied on by',c.linked_object?[c.linked_object.app_id,c.linked_object.object_type,c.linked_object.object_id].join(' · ')+' (stored as given, not opened)':'Nothing linked'],
        ['Watching',c.watch?'Yes: every later revision notifies you':'No'],['Clipped',when(c.created_at,tz)],['Changed',c.updated_at?when(c.updated_at,tz):'Never'],['Clipping ID',c.id]]),
      el('section',{class:'bt-card','aria-label':'Clipped text'},el('h3',{},'The revision you kept'),it.body===null?el('p',{class:'bt-muted'},'No text in this revision.'):textBlock(it.body)),
      el('section',{class:'bt-card','aria-label':'Clipping history'},el('h3',{},'Earlier versions of this clipping ('+c.history.length+')'),c.history.length?history:el('p',{class:'bt-muted'},'None.')));
    loaded(page);
  })().catch(e=>{if(page.isConnected)page.replaceChildren(el('p',{role:'alert',class:'bt-error'},e.message));});
  return page;
}
async function freshClipping(ui,c){
  const r=await ui.call(TOOL.clippings,{id:c.item_id}),current=r.clippings.find(x=>x.id===c.id);
  if(!current||current.revision!==c.revision||current.watch!==c.watch||current.note!==c.note)fail('This clipping changed. Refresh before trying again.','stale_version');
  return {current,version:r.version};
}
async function moveClipping(ui,c,node){
  node.disabled=true;
  try{
    const {version}=await freshClipping(ui,c);
    await quickWrite(ui,'move:'+c.id+':'+c.latest_revision,TOOL.editClip,{id:c.id,patch:{revision:c.latest_revision}},version);
    await ui.refresh();say('The clipping now holds revision '+c.latest_revision+'.');
  }catch(e){ui.error(e);node.disabled=false;}
}
async function toggleWatch(ui,c,node){
  node.disabled=true;
  try{
    const {version}=await freshClipping(ui,c),watch=!c.watch;
    await quickWrite(ui,'watch:'+c.id+':'+watch,TOOL.editClip,{id:c.id,patch:{watch}},version);
    await ui.refresh();say(watch?'Watching this item.':'No longer watching this item.');
  }catch(e){ui.error(e);node.disabled=false;}
}
async function editClipping(ui,c){
  const {current,version}=await freshClipping(ui,c),write=writer(ui,version);
  const r=await ui.call(TOOL.item,{id:c.item_id}),newer=r.item.revisions.filter(v=>v.revision>current.revision);
  const revision=select('revision',[['','Keep revision '+current.revision],...newer.map(v=>[String(v.revision),'Move to revision '+v.revision+' ('+TYPE[v.type].toLowerCase()+')'])],'');
  const note=el('textarea',{'data-field':'note',maxlength:'1000',rows:'3'});note.value=current.note||'';
  const link=linkFields(current.linked_object),watch=el('input',{type:'checkbox','data-field':'watch'});watch.checked=current.watch;
  dialog('Edit clipping','Save clipping',async()=>{
    const patch={},text=note.value.trim()||null,linked=link.read();
    if(revision.value)patch.revision=Number(revision.value);
    if(text!==(current.note||null))patch.note=text;
    if(JSON.stringify(linked)!==JSON.stringify(current.linked_object||null))patch.linked_object=linked;
    if(watch.checked!==current.watch)patch.watch=watch.checked;
    if(!Object.keys(patch).length)fail('No changes to save.','no_changes');
    await write(TOOL.editClip,{id:c.id,patch});await ui.refresh();say('Clipping saved.');
  }).body.append(el('p',{},'“'+headline(ui,c.item_id)+'”'),field('Revision',revision,'A clipping can only move to a newer revision. The version it held stays in its history.'),
    field('Note',note,'Empty removes the note.'),link.node,el('label',{class:'bt-check'},watch,'Watch: notify me about every later revision of this item'));
}
async function removeClipping(ui,c){
  const {version}=await freshClipping(ui,c),write=writer(ui,version);
  dialog('Remove this clipping?','Remove clipping',async()=>{await write(TOOL.unclip,{id:c.id});state.clipping=null;await ui.refresh();say('Clipping removed.');})
    .body.append(el('p',{},'“'+headline(ui,c.item_id)+'”'),el('p',{class:'bt-muted'},'The clipping and its history are removed. The item and your read marks stay.'));
}

function notificationDetail(ui){
  const n=(aux(ui).notifications||[]).find(x=>x.id===state.notification);
  if(!n)return empty('No notification selected','Choose a notification to read it.');
  const tz=accountZone(ui);
  const stateText=n.state==='held'?'Held until '+when(n.release_at,tz)+(n.delivery==='digest'?' (daily digest)':' (quiet hours)'):n.state==='released'?'Released '+when(n.release_at,tz):'Superseded by '+n.superseded_by+' before its release time ('+when(n.release_at,tz)+'): never shown';
  const open=[button('Open revision '+n.revision,()=>openItem(ui,n.item_id,n.revision).catch(ui.error))];
  for(const other of [n.supersedes,n.superseded_by].filter(Boolean))open.push(button('Open '+other,()=>{state.notification=other;state.nKind='';state.nState='';ui.refresh().catch(ui.error);}));
  return loaded(el('article',{class:'bt-page','data-notification-id':n.id},el('header',{class:'bt-head'},el('h2',{},n.title),el('p',{},'Written '+when(n.created_at,tz))),
    el('div',{class:'bt-chips'},kindChip(n.kind),chip(n.state),chip(n.delivery==='digest'?'Daily digest':'Immediate','quiet')),textBlock(n.body),
    definition([['State',stateText],['Why','Written because '+n.reasons.map(r=>REASON[r]||r).join(', and ')+'.'],
      ['Rules that match',n.matched_follow_ids.length?n.matched_follow_ids.map(id=>{const f=(aux(ui).follows||[]).find(x=>x.id===id);return f?ruleText(ui,f)+' ('+id+')':id;}).join('; '):'None'],['About','Revision '+n.revision+' of '+headline(ui,n.item_id)],
      n.supersedes?['Replaces',n.supersedes+', which was still held']:null,['Email copy prepared',n.email_prepared?'Yes':'No'],['Notification ID',n.id]]),
    el('div',{class:'bt-toolbar'},open)));
}
function markDetail(ui){
  const id=state.mark;
  if(!id)return empty('Nothing selected','Choose an item you marked as read.');
  const page=el('article',{class:'bt-page','data-item-id':id,'data-read-view':''},el('p',{class:'bt-muted'},'Loading…'));
  showRevision(page,id,null,ui).catch(e=>{if(page.isConnected)page.replaceChildren(el('p',{role:'alert',class:'bt-error'},e.message));});
  return page;
}

// ---- settings ------------------------------------------------------------------------------------
function settingsView(ui){
  const page=el('article',{class:'bt-page','data-settings':''},el('header',{class:'bt-head'},el('h2',{},'Settings'),el('p',{},'Time zone, quiet hours, the daily digest, corrections and email copies.')),el('p',{class:'bt-muted'},'Loading…'));
  (async()=>{
    const r=await ui.call(TOOL.preferences,{}),p=r.preferences,write=writer(ui,r.version);
    if(!page.isConnected)return;
    const editable=ui.has(TOOL.settings);
    const zone=el('input',{type:'text','data-field':'timezone',value:p.timezone,maxlength:'64'});
    const quiet=el('input',{type:'checkbox','data-field':'quiet_hours.enabled'});quiet.checked=p.quiet_hours.enabled;
    const from=el('input',{type:'time','data-field':'quiet_hours.start',value:p.quiet_hours.start,step:'60'}),to=el('input',{type:'time','data-field':'quiet_hours.end',value:p.quiet_hours.end,step:'60'});
    const digest=el('input',{type:'time','data-field':'digest_time',value:p.digest_time,step:'60'});
    const corrections=select('corrections',[['as_item','Like the item’s other notifications'],['immediate','At once']],p.corrections);
    const email=el('input',{type:'checkbox','data-field':'email_notices'});email.checked=p.email_notices;
    for(const input of [zone,quiet,from,to,digest,corrections,email])input.disabled=!editable;
    const error=el('p',{role:'alert',class:'form-error bt-error'}),save=el('button',{type:'submit',class:'primary'},'Save settings');
    const tz=p.timezone;
    const form=el('form',{class:'bt-settings','aria-label':'Settings'},
      el('fieldset',{},el('legend',{},'Time'),field('Time zone',zone,'An IANA zone, for example America/Chicago. Quiet hours and the digest time are in this zone.')),
      el('fieldset',{},el('legend',{},'Quiet hours'),el('label',{class:'bt-check'},quiet,'Hold immediate notifications that are not urgent during quiet hours'),el('div',{class:'bt-pair'},field('From',from),field('Until',to)),
        el('p',{class:'bt-muted'},p.in_quiet_hours?'Quiet hours are on now.':'Quiet hours are not on now.')),
      el('fieldset',{},el('legend',{},'Daily digest'),field('Digest time',digest,'Digest notifications are released at this time. It cannot lie inside the quiet hours.'),
        el('p',{class:'bt-muted'},'Next digest: '+when(p.next_digest_at,tz)+'.')),
      el('fieldset',{},el('legend',{},'Corrections and retractions'),field('Deliver them',corrections)),
      el('fieldset',{},el('legend',{},'Email'),el('label',{class:'bt-check'},email,'Prepare an email copy of each new notification')),
      error,editable?el('div',{class:'form-actions'},save):el('p',{class:'bt-muted'},'Changing settings is not allowed for this account and policy.'));
    form.addEventListener('submit',async event=>{
      event.preventDefault();save.disabled=true;error.textContent='';delete error.dataset.code;
      try{
        const patch={};
        if(zone.value.trim()!==p.timezone)patch.timezone=zone.value.trim();
        const q={};if(quiet.checked!==p.quiet_hours.enabled)q.enabled=quiet.checked;if(from.value!==p.quiet_hours.start)q.start=from.value;if(to.value!==p.quiet_hours.end)q.end=to.value;
        if(Object.keys(q).length)patch.quiet_hours=q;
        if(digest.value!==p.digest_time)patch.digest_time=digest.value;
        if(corrections.value!==p.corrections)patch.corrections=corrections.value;
        if(email.checked!==p.email_notices)patch.email_notices=email.checked;
        if(!Object.keys(patch).length)fail('No changes to save.','no_changes');
        await write(TOOL.settings,{patch});
        await ui.refresh();say('Settings saved.');
      }catch(e){error.textContent=e.message;error.dataset.code=e.code||'request_failed';save.disabled=false;}
    });
    page.replaceChildren(page.firstChild,form);loaded(page);
  })().catch(e=>{if(page.isConnected)page.replaceChildren(el('p',{role:'alert',class:'bt-error'},e.message));});
  return page;
}

export const config={
  id:'belltower',title:'Belltower',description:'Local news and public notices, with every revision kept.',symbol:'🔔',
  searchLabel:'Search the news (every revision)',initialSection:'news',
  list:TOOL.items,collection:'items',get:TOOL.item,item:'item',queryField:'query',
  get listArgs(){return newsArgs();},
  heading:i=>i.headline,subtitle:i=>i.source_id,actions:[],
  sections:ui=>{const a=aux(ui),active=(a.follows||[]).filter(f=>f.state==='active').length,behind=(a.clippings||[]).filter(c=>c.state==='behind').length,held=(a.notifications||[]).filter(n=>n.state==='held').length;
    return [{id:'news',label:'News',symbol:'▤'},
      {id:'following',label:'Following'+(active?' · '+active:''),symbol:'★',filter:()=>false,count:false},
      {id:'clippings',label:'Clippings'+(behind?' · '+behind+' behind':''),symbol:'✂',filter:()=>false,count:false},
      {id:'notifications',label:'Notifications'+(held?' · '+held+' held':''),symbol:'✉',filter:()=>false,count:false},
      {id:'reading',label:'Read',symbol:'✓',filter:()=>false,count:false},
      {id:'settings',label:'Settings',symbol:'⚙',filter:()=>false,count:false}];},
  load,renderList,emptyView,view:itemView
};
mount(config);
