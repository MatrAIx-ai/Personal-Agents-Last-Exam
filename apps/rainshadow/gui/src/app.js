// Rainshadow business pages: saved places with their forecasts, alerts, watches, notices and
// settings. This controller is the App's own: its navigation, forms and how forecasts, alert
// threads and watch evaluations are shown. The shared Host serves it and forwards only the
// Agent's permitted tools. Every value shown comes from those tools; the page keeps no
// business data of its own and never uses the browser clock for a business decision.
import {mount,el,textBlock} from '/shared/client.js';

const TOOL={
  search:'rainshadow.places.search',places:'rainshadow.places.list',sources:'rainshadow.sources.list',
  issuances:'rainshadow.forecast.issuances',hourly:'rainshadow.forecast.hourly',daily:'rainshadow.forecast.daily',
  conditions:'rainshadow.conditions.get',alerts:'rainshadow.alerts.list',alert:'rainshadow.alerts.get',
  watches:'rainshadow.watches.list',watch:'rainshadow.watches.get',notices:'rainshadow.notices.list',
  preferences:'rainshadow.preferences.get',save:'rainshadow.places.save',update:'rainshadow.places.update',
  remove:'rainshadow.places.remove',settings:'rainshadow.preferences.update',acknowledge:'rainshadow.alerts.acknowledge',
  create:'rainshadow.watches.create',edit:'rainshadow.watches.update',cancel:'rainshadow.watches.cancel'
};

// ---- presentation ---------------------------------------------------------------------------
const sheet=new CSSStyleSheet();
sheet.replaceSync(`
.brand h1{font-size:1.3rem;letter-spacing:-.01em}
.detail-actions:has(.actions:empty){display:none}
.rs-list{display:grid;gap:.45rem}
.rs-list-head{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.6rem;padding:.35rem 1.35rem .2rem}
.rs-list-head p{margin:0;color:var(--muted);font-size:.85rem;flex:1 1 12rem}
.rs-list-head select{flex:1 1 9rem;min-width:0}
.rs-list>.empty{padding:0 1.35rem}
.rs-group{margin:.8rem 0 .1rem;padding:0 1.35rem;font-size:.72rem;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);font-weight:700}
.rs-row{display:grid;gap:.25rem;width:100%;text-align:left}
.rs-row-top{display:flex;justify-content:space-between;gap:.6rem;align-items:baseline}
.rs-row-sub{color:var(--muted);font-size:.84rem}
.rs-chips{display:flex;flex-wrap:wrap;gap:.3rem}
.rs-chip{display:inline-flex;align-items:center;border-radius:999px;padding:.05rem .55rem;font-size:.74rem;font-weight:600;border:1px solid var(--line);background:var(--soft);white-space:nowrap}
.rs-chip[data-tone=good]{background:#ecfdf3;border-color:#abefc6;color:#067647}
.rs-chip[data-tone=warn]{background:#fffaeb;border-color:#fedf89;color:#b54708}
.rs-chip[data-tone=bad]{background:#fef3f2;border-color:#fecdca;color:#b42318}
.rs-chip[data-tone=quiet]{color:var(--muted)}
.rs-page{display:grid;gap:1rem;min-width:0}
.rs-head h2{margin:0;font-size:1.55rem}
.rs-head p{margin:.2rem 0 0;color:var(--muted)}
.rs-toolbar{display:flex;flex-wrap:wrap;gap:.45rem;align-items:center}
.rs-card{border:1px solid var(--line);border-radius:14px;padding:.9rem 1rem;min-width:0}
.rs-card h3{margin:0 0 .55rem;font-size:1rem}
.rs-card-head{display:flex;justify-content:space-between;flex-wrap:wrap;gap:.4rem .8rem;align-items:baseline;margin-bottom:.5rem}
.rs-card-head h3{margin:0}
.rs-now{display:flex;gap:1.2rem;align-items:center;flex-wrap:wrap}
.rs-big{font-size:2.3rem;font-weight:700;line-height:1}
.rs-sky{font-size:1.6rem;line-height:1}
.rs-banner{border-left:4px solid var(--accent);background:var(--soft);padding:.6rem .8rem;border-radius:8px;display:grid;gap:.3rem}
.rs-banner[data-tone=bad]{border-color:#d92d20;background:#fef3f2}
.rs-banner[data-tone=warn]{border-color:#f79009;background:#fffaeb}
.rs-banner p{margin:0}
.rs-scroll{overflow-x:auto;max-width:100%}
.rs-table{border-collapse:collapse;width:100%;font-size:.86rem;min-width:600px}
.rs-table th,.rs-table td{padding:.32rem .45rem;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}
.rs-table th{font-size:.74rem;color:var(--muted);font-weight:700}
.rs-table th:first-child,.rs-table td:first-child,.rs-table .rs-left{text-align:left}
.rs-table td.rs-hot{font-weight:700;color:#b42318}
.rs-days{display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:.55rem}
.rs-day{border:1px solid var(--line);border-radius:12px;padding:.65rem .7rem;display:grid;gap:.2rem;align-content:start}
.rs-day .rs-hl{font-weight:600}
.rs-muted{color:var(--muted);font-size:.85rem;margin:0}
.rs-dl{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:.3rem 1rem;margin:0}
.rs-dl dt{color:var(--muted)}
.rs-dl dd{margin:0;overflow-wrap:anywhere}
.rs-thread{display:grid;gap:.6rem;list-style:none;padding:0;margin:0}
.rs-message{border:1px solid var(--line);border-radius:12px;padding:.75rem .85rem;display:grid;gap:.35rem}
.rs-message h4{margin:0}
.rs-conditions{display:grid;gap:.45rem;list-style:none;padding:0;margin:0}
.rs-conditions li{border:1px solid var(--line);border-radius:10px;padding:.5rem .7rem;display:grid;gap:.2rem}
.rs-form{display:grid;gap:.75rem;width:min(640px,86vw)}
.rs-form h2{margin:0}
.rs-form fieldset,.rs-settings fieldset{border:1px solid var(--line);border-radius:10px;padding:.6rem .8rem .8rem;display:grid;gap:.55rem;margin:0;min-width:0}
.rs-form legend,.rs-settings legend{display:block;font-weight:700;padding:0 .3rem}
.rs-form label{display:grid;gap:.25rem}
.rs-checks{display:flex;flex-wrap:wrap;gap:.35rem 1rem}
label.rs-check,.rs-checks label,.rs-results label{display:flex!important;justify-content:flex-start;grid-template-columns:none;gap:.5rem;align-items:center;text-align:left}
label.rs-check input,.rs-checks input,.rs-results input{width:auto;flex:0 0 auto;margin:0}
.rs-pair{display:grid;grid-template-columns:1fr 1fr;gap:.6rem}
[hidden]{display:none!important}
.rs-fields{display:grid;gap:.75rem}
.rs-condition{display:flex;flex-wrap:wrap;gap:.5rem;align-items:end;border-bottom:1px dashed var(--line);padding-bottom:.55rem}
.rs-condition>*{flex:1 1 9rem;min-width:0}
.rs-condition>button{flex:0 0 auto}
.rs-error{color:#b42318;font-weight:600;margin:0;min-height:1.2em}
.rs-results{display:grid;gap:.3rem;max-height:13rem;overflow:auto}
.rs-results label{display:flex;gap:.55rem;align-items:center;border:1px solid var(--line);border-radius:8px;padding:.4rem .6rem}
.rs-settings{display:grid;gap:.8rem;max-width:620px}
dialog.rs-dialog{max-width:min(720px,94vw);max-height:90vh;overflow:auto}
@media(max-width:760px){.rs-pair{grid-template-columns:1fr}.rs-big{font-size:1.9rem}}
`);
document.adoptedStyleSheets=[...document.adoptedStyleSheets,sheet];

const fmts=new Map();
const formatter=(tz,options)=>{const key=tz+JSON.stringify(options);if(!fmts.has(key))fmts.set(key,new Intl.DateTimeFormat('en-US',{timeZone:tz,...options}));return fmts.get(key);};
// Times are shown in the zone of the place they belong to (or the account's zone), never the browser's.
let clockYear=null; // the year of the App's virtual clock, from the last refresh
const yearOf=iso=>String(iso).slice(0,4);
const when=(iso,tz)=>iso?formatter(tz,{weekday:'short',month:'short',day:'numeric',...(clockYear&&yearOf(iso)!==clockYear?{year:'numeric'}:{}),hour:'numeric',minute:'2-digit'}).format(new Date(iso)):'—';
const hourOf=(iso,tz)=>formatter(tz,{weekday:'short',hour:'numeric'}).format(new Date(iso));
const zoneName=(tz,iso)=>formatter(tz,{timeZoneName:'short'}).formatToParts(iso?new Date(iso):new Date(0)).find(p=>p.type==='timeZoneName')?.value||tz;
const dayOf=date=>formatter('UTC',{weekday:'short',month:'short',day:'numeric',...(clockYear&&yearOf(date)!==clockYear?{year:'numeric'}:{})}).format(new Date(date+'T12:00:00Z'));
const span=(a,b,tz)=>when(a,tz)+' – '+when(b,tz);
function wall(ms,tz){const o={};for(const p of formatter(tz,{hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(new Date(ms)))o[p.type]=p.value;return o;}
const offsetAt=(ms,tz)=>{const o=wall(ms,tz);return Date.UTC(+o.year,+o.month-1,+o.day,+o.hour,+o.minute,+o.second)-Math.floor(ms/1000)*1000;};
// A wall time typed for a place ('2026-11-21T10:00') as an ISO time with that place's offset.
function wallToIso(local,tz){
  const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local||'');if(!m)return '';
  const guess=Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5]);let off=offsetAt(guess,tz);const second=offsetAt(guess-off,tz);if(second!==off)off=second;
  const a=Math.abs(off)/60000;return m[1]+'-'+m[2]+'-'+m[3]+'T'+m[4]+':'+m[5]+':00'+(off<0?'-':'+')+String(Math.floor(a/60)).padStart(2,'0')+':'+String(a%60).padStart(2,'0');
}
const isoToWall=(iso,tz)=>{const o=wall(Date.parse(iso),tz);return o.year+'-'+o.month+'-'+o.day+'T'+o.hour+':'+o.minute;};
const addHours=(local,hours,tz)=>isoToWall(new Date(Date.parse(wallToIso(local,tz))+hours*3600000).toISOString(),tz);

const SKY={clear:['☾','Clear'],mostly_clear:['☼','Mostly clear'],sunny:['☀','Sunny'],partly_cloudy:['⛅','Partly cloudy'],mostly_cloudy:['☁','Mostly cloudy'],cloudy:['☁','Cloudy'],fog:['≋','Fog'],haze:['≋','Haze'],smoke:['≋','Smoke'],drizzle:['☂','Drizzle'],rain:['☂','Rain'],heavy_rain:['☔','Heavy rain'],sleet:['❄','Sleet'],snow:['❄','Snow'],thunderstorm:['⚡','Thunderstorms']};
const sky=value=>SKY[value]||['•',String(value||'—').replace(/_/g,' ')];
const words=value=>String(value||'').replace(/_/g,' ').replace(/^./,c=>c.toUpperCase());
const num=(value,digits=1)=>value===null||value===undefined?'—':Number(value).toFixed(digits).replace(/\.0$/,'');
const temp=(value,u)=>num(value)+' °'+(u?.temperature||'C');
const SEVERITY=['minor','moderate','severe','extreme'];
const CATEGORIES=['flood','storm','winter','wind','temperature','fire','air_quality','other'];
const toneOf={extreme:'bad',severe:'bad',moderate:'warn',minor:'quiet',triggered:'bad',clear:'good',no_data:'warn',ended:'quiet',cancelled:'quiet',active:'bad',upcoming:'warn',expired:'quiet',held:'warn',released:'quiet'};
const chip=(text,tone)=>el('span',{class:'rs-chip','data-tone':tone||toneOf[text]||null},words(text));
const live=alert=>alert.status==='active'||alert.status==='upcoming';
const openWatch=watch=>['clear','triggered','no_data'].includes(watch.status);
const button=(label,onclick,primary=false,extra={})=>el('button',{type:'button',class:primary?'primary':'',onclick,...extra},label);
const definition=(pairs)=>el('dl',{class:'rs-dl'},pairs.filter(Boolean).flatMap(([k,v])=>[el('dt',{},k),el('dd',{},v??'—')]));
const empty=(title,text,...more)=>el('div',{class:'empty'},el('h3',{},title),el('p',{},text),...more);
const say=text=>{const s=document.getElementById('status');if(s){s.textContent=text;delete s.dataset.error;}};
const searchText=()=>(document.querySelector('.toolbar input[type=search]')?.value||'').trim().toLowerCase();
const found=(q,...texts)=>!q||texts.join(' ').toLowerCase().includes(q);
const setCount=n=>{const c=document.querySelector('.collection-count');if(c)c.textContent=String(n);};
// Async parts of a view mark themselves loaded, so a reader (or a test) knows the values are in.
const loaded=node=>{node.dataset.loaded='true';return node;};

// ---- UI state: what is selected and filtered. Business data is always read again. --------------
const state={alert:null,watch:null,notice:null,source:new Map(),noticeKind:'',noticeState:''};
const aux=ui=>ui.aux||{};
const accountZone=ui=>aux(ui).preferences?.timezone||'UTC';
const sourceName=(ui,id)=>aux(ui).sources?.find(s=>s.id===id)?.name||id||'—';
const savedPlace=(ui,id)=>(aux(ui).saved||ui.records).find(p=>p.id===id);
const placeTitle=p=>p?(p.label?p.label+' ('+p.name+')':p.name):'—';

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
// One-click writes (acknowledge, pause) resend the same request after a lost response.
const quick=new Map();
async function quickWrite(ui,key,name,args,version){
  const kept=quick.get(key),payload=kept||{...args,expected_version:version,request_id:'web-'+crypto.randomUUID()};
  quick.set(key,payload);
  try{const result=await ui.call(name,payload);quick.delete(key);return result;}
  catch(e){if(e.code)quick.delete(key);throw e;}
}

function dialog(title,submitLabel,onSubmit){
  const error=el('p',{role:'alert',class:'form-error rs-error'}),body=el('div',{class:'rs-fields'});
  const submit=el('button',{type:'submit',class:'primary'},submitLabel),cancel=el('button',{type:'button'},'Cancel');
  const form=el('form',{class:'rs-form','aria-label':title},el('h2',{},title),body,error,el('div',{class:'form-actions'},cancel,submit));
  const node=el('dialog',{class:'rs-dialog','aria-label':title},form);
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
  return {node,body,error,fail:(message,code='invalid_input')=>{throw Object.assign(Error(message),{code});}};
}
const field=(label,input,help)=>el('label',{class:'field'},el('span',{},label),input,help?el('small',{},help):null);
const select=(name,options,value)=>{const s=el('select',{'data-field':name});for(const [v,l] of options)s.append(el('option',{value:v},l));if(value!==undefined&&value!==null)s.value=String(value);return s;};
const sameJson=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

// ---- data loaded with every refresh ------------------------------------------------------------
async function load(ui){
  const out={preferences:null,sources:[],saved:[],watches:[],alerts:[],notices:[],noticeCursor:null,now:null};
  if(ui.has(TOOL.preferences))out.preferences=(await ui.call(TOOL.preferences,{})).preferences;
  if(ui.has(TOOL.sources))out.sources=(await ui.call(TOOL.sources,{})).sources;
  if(ui.has(TOOL.places))out.saved=(await ui.call(TOOL.places,{})).places;
  if(ui.has(TOOL.watches))out.watches=(await ui.call(TOOL.watches,{include_closed:true})).watches;
  if(ui.has(TOOL.alerts)){
    const threads=new Map();
    for(const place of out.saved){
      const r=await ui.call(TOOL.alerts,{id:place.id,include_closed:true});out.now??=r.start;
      for(const a of r.alerts){const known=threads.get(a.id);if(known)known.places.push(place);else threads.set(a.id,{...a,places:[place],timezone:r.place.timezone});}
    }
    const rank={active:0,upcoming:1,expired:2,cancelled:3};
    out.alerts=[...threads.values()].sort((a,b)=>rank[a.status]-rank[b.status]||Date.parse(b.onset||0)-Date.parse(a.onset||0));
  }
  if(ui.has(TOOL.notices)){const r=await ui.call(TOOL.notices,noticeArgs());out.notices=r.notices;out.noticeCursor=r.next_cursor;}
  clockYear=out.now?yearOf(out.now):null;
  return out;
}
const noticeArgs=()=>({limit:50,...(state.noticeKind?{kind:state.noticeKind}:{}),...(state.noticeState?{state:state.noticeState}:{})});

// ---- lists (middle column) ------------------------------------------------------------------------
function renderList(shown,ui){
  const q=searchText();
  if(ui.section==='alerts')return alertList(ui,q);
  if(ui.section==='watches')return watchList(ui,q);
  if(ui.section==='notices')return noticeList(ui,q);
  if(ui.section==='settings')return sourceList(ui);
  return placeList(shown,ui);
}
function placeList(shown,ui){
  const list=el('div',{class:'rs-list'}),head=el('div',{class:'rs-list-head'},el('p',{},shown.length?'Saved places, in the order you saved them':'No saved places yet'));
  if(ui.has(TOOL.save)&&ui.has(TOOL.search))head.append(button('Add place',()=>addPlace(ui).catch(ui.error),true));
  list.append(head);
  for(const p of shown){
    const alerts=(aux(ui).alerts||[]).filter(a=>live(a)&&a.places.some(x=>x.id===p.id));
    const chips=el('span',{class:'rs-chips'});
    for(const a of alerts.slice(0,2))chips.append(chip(a.event,toneOf[a.severity]));
    if(alerts.length>2)chips.append(chip('+'+(alerts.length-2)+' more','warn'));
    if(p.open_watches)chips.append(chip(p.open_watches+' open watch'+(p.open_watches===1?'':'es'),'quiet'));
    if(p.alert_rule?.paused)chips.append(chip('Alerts paused','warn'));
    list.append(ui.record(p,el('span',{class:'rs-row'},el('span',{class:'record-title'},p.label||p.name),el('span',{class:'record-subtitle'},(p.label?p.name+' · ':'')+p.region),chips)));
  }
  return list;
}
function row(attrs,selected,onclick,title,sub,chips){
  return el('button',{type:'button',class:'record',...attrs,'aria-pressed':String(selected),onclick},el('span',{class:'rs-row'},el('span',{class:'rs-row-top'},el('span',{class:'record-title'},title)),sub?el('span',{class:'rs-row-sub'},sub):null,chips?el('span',{class:'rs-chips'},chips):null));
}
function alertList(ui,q){
  const items=(aux(ui).alerts||[]).filter(a=>found(q,a.event,a.headline,a.category,a.places.map(p=>p.label+' '+p.name).join(' ')));
  setCount(items.length);
  const list=el('div',{class:'rs-list'});
  if(!items.length){list.append(empty('No alerts','Alerts that affect a saved place appear here, with the ones that ended or were cancelled in the last days.'));return list;}
  if(!items.some(a=>a.id===state.alert))state.alert=items[0].id;
  let group=null;
  for(const a of items){
    const g=live(a)?'In effect or coming up':'Ended or cancelled';
    if(g!==group){list.append(el('h3',{class:'rs-group'},g));group=g;}
    list.append(row({'data-alert-id':a.id},a.id===state.alert,()=>{state.alert=a.id;ui.navigate('alerts').catch(ui.error);},a.event,
      a.places.map(p=>p.label||p.name).join(', ')+' · '+span(a.onset,a.ends,a.timezone),[chip(a.severity),chip(a.status),a.acknowledged?chip('Acknowledged','good'):null]));
  }
  return list;
}
function watchList(ui,q){
  const a=aux(ui),items=(a.watches||[]).filter(w=>found(q,w.label,w.place.name,savedPlace(ui,w.place.id)?.label||'',w.status));
  setCount(items.length);
  const list=el('div',{class:'rs-list'}),head=el('div',{class:'rs-list-head'},el('p',{},'A watch checks a place and a time window against the forecast and alerts.'));
  if(ui.has(TOOL.create)&&(a.saved||[]).length)head.append(button('New watch',()=>watchDialog(ui,{}).catch(ui.error),true));
  list.append(head);
  if(!items.length){list.append(empty('No watches','Create a watch for a saved place and a time window.'));return list;}
  const open=items.filter(openWatch),closed=items.filter(w=>!openWatch(w)).sort((x,y)=>Date.parse(y.start)-Date.parse(x.start));
  if(!items.some(w=>w.id===state.watch))state.watch=(open[0]||closed[0]).id;
  for(const [title,group] of [['Open',open],['Ended or cancelled',closed]]){
    if(!group.length)continue;
    list.append(el('h3',{class:'rs-group'},title+' ('+group.length+')'));
    for(const w of group){const tz=w.place.timezone;
      list.append(row({'data-watch-id':w.id},w.id===state.watch,()=>{state.watch=w.id;ui.navigate('watches').catch(ui.error);},w.label||'Watch at '+w.place.name,
        placeTitle(savedPlace(ui,w.place.id)||w.place)+' · '+span(w.start,w.end,tz),[chip(w.status)]));}
  }
  return list;
}
function noticeList(ui,q){
  const a=aux(ui),items=(a.notices||[]).filter(n=>found(q,n.title,n.body,n.kind));
  setCount(items.length);
  const list=el('div',{class:'rs-list'});
  const kind=select('kind',[['','All kinds'],['alert.issued','Alert issued'],['alert.updated','Alert updated'],['alert.cancelled','Alert cancelled'],['watch.triggered','Watch triggered'],['watch.cleared','Watch cleared']],state.noticeKind);
  const st=select('state',[['','Held and released'],['held','Held (quiet hours)'],['released','Released']],state.noticeState);
  kind.setAttribute('aria-label','Notice kind');st.setAttribute('aria-label','Notice state');
  // The list is read again with the App's own filters; a reader who moved on is not pulled back.
  const refilter=async()=>{state.noticeKind=kind.value;state.noticeState=st.value;const r=await ui.call(TOOL.notices,noticeArgs());a.notices=r.notices;a.noticeCursor=r.next_cursor;state.notice=null;if(ui.section==='notices')await ui.navigate('notices');};
  kind.addEventListener('change',()=>refilter().catch(ui.error));st.addEventListener('change',()=>refilter().catch(ui.error));
  list.append(el('div',{class:'rs-list-head'},kind,st));
  if(!items.length){list.append(empty('No notices','Notices are written when an alert matches a saved place or a watch changes.'));return list;}
  if(!items.some(n=>n.id===state.notice))state.notice=items[0].id;
  const tz=accountZone(ui);
  for(const n of items)list.append(row({'data-notice-id':n.id},n.id===state.notice,()=>{state.notice=n.id;ui.navigate('notices').catch(ui.error);},n.title,
    when(n.created_at,tz),[chip(n.kind.replace('.',' ')),n.state==='held'?chip('held'):null,n.severity?chip(n.severity):null]));
  if(a.noticeCursor)list.append(button('Load older notices',()=>(async()=>{const r=await ui.call(TOOL.notices,{...noticeArgs(),cursor:a.noticeCursor});a.notices.push(...r.notices);a.noticeCursor=r.next_cursor;if(ui.section==='notices')await ui.navigate('notices');})().catch(ui.error)));
  return list;
}
function sourceList(ui){
  const sources=aux(ui).sources||[];setCount(sources.length);
  const list=el('div',{class:'rs-list'},el('div',{class:'rs-list-head'},el('p',{},'Forecast and air-quality sources')));
  const tz=accountZone(ui);
  for(const s of sources)list.append(el('div',{class:'record','data-source-id':s.id},el('span',{class:'rs-row'},el('span',{class:'record-title'},s.name),
    el('span',{class:'rs-row-sub'},(s.kind==='air_quality'?'Air quality':'Weather')+' · '+s.issuance_count+' issuances · latest '+when(s.latest_issued_at,tz)),
    el('span',{class:'rs-chips'},s.is_default?chip('Your default','good'):null))));
  return list;
}

// ---- detail (right column) ---------------------------------------------------------------------------
function emptyView(ui){
  if(ui.section==='alerts')return alertDetail(ui);
  if(ui.section==='watches')return watchDetail(ui);
  if(ui.section==='notices')return noticeDetail(ui);
  if(ui.section==='settings')return settingsView(ui);
  return empty('No saved places','Save a place to see its forecast, alerts and watches.',ui.has(TOOL.save)&&ui.has(TOOL.search)?button('Add place',()=>addPlace(ui).catch(ui.error),true):null);
}

// A saved place: what it is like now, its alerts, the forecast from one source and its watches.
function placeView(place,ui){
  const a=aux(ui),saved=savedPlace(ui,place.id)||place,tz=place.timezone;
  const page=el('article',{class:'rs-page','data-place-id':place.id});
  const actions=el('div',{class:'rs-toolbar'});
  if(ui.has(TOOL.update)){
    actions.append(button('Edit place',()=>editPlace(ui,saved).catch(ui.error)));
    actions.append(button(saved.alert_rule?.paused?'Resume alerts':'Pause alerts',e=>togglePause(ui,saved,e.currentTarget)));
  }
  if(ui.has(TOOL.create))actions.append(button('New watch here',()=>watchDialog(ui,{placeId:place.id}).catch(ui.error)));
  if(ui.has(TOOL.remove))actions.append(button('Remove place',()=>removePlace(ui,saved).catch(ui.error)));
  const rule=saved.alert_rule;
  page.append(el('header',{class:'rs-head'},el('h2',{},saved.label||place.name),
    el('p',{},(saved.label?place.name+' · ':'')+place.region+' · times in '+zoneName(tz,a.now)+' ('+tz+')'),
    rule?el('p',{},rule.paused?'Alerts paused for this place.':'Alerts about '+rule.categories.map(words).join(', ')+', '+rule.min_severity+' or worse.'):null),actions);
  for(const alert of (a.alerts||[]).filter(x=>live(x)&&x.places.some(p=>p.id===place.id))){
    page.append(el('section',{class:'rs-banner','data-tone':toneOf[alert.severity],'aria-label':alert.event},
      el('p',{},el('strong',{},alert.event),' · ',words(alert.status),' · ',span(alert.onset,alert.ends,tz)),el('p',{},alert.headline),
      el('div',{class:'rs-toolbar'},button('Open alert',()=>{state.alert=alert.id;ui.navigate('alerts').catch(ui.error);}),alert.acknowledged?chip('Acknowledged','good'):null)));
  }
  const weather=(a.sources||[]).filter(s=>s.kind==='weather'),choice=state.source.get(place.id)||{};
  const source=choice.source_id||a.preferences?.default_source_id||weather[0]?.id;
  const sourcePick=select('source',weather.map(s=>[s.id,s.name+(s.id===a.preferences?.default_source_id?' (your default)':'')]),source);
  sourcePick.setAttribute('aria-label','Forecast source');
  const issuancePick=el('select',{'aria-label':'Issuance','data-field':'issuance'},el('option',{value:''},'Latest issuance'));
  const now=el('section',{class:'rs-card','aria-label':'Now'},el('h3',{},'Now'),el('p',{class:'rs-muted'},'Loading…'));
  const hourly=el('section',{class:'rs-card','aria-label':'Next 24 hours'},el('h3',{},'Next 24 hours'),el('p',{class:'rs-muted'},'Loading…'));
  const daily=el('section',{class:'rs-card','aria-label':'Daily forecast'},el('h3',{},'Daily forecast'),el('p',{class:'rs-muted'},'Loading…'));
  const air=el('section',{class:'rs-card','aria-label':'Air quality'},el('h3',{},'Air quality'),el('p',{class:'rs-muted'},'Loading…'));
  const issued=el('p',{class:'rs-muted','data-issuance':''});
  const banner=el('div');
  page.append(el('section',{class:'rs-card','aria-label':'Forecast source'},el('div',{class:'rs-toolbar'},field('Forecast from',sourcePick),field('Issuance',issuancePick)),issued,banner),now,hourly,daily,air);
  const watches=(a.watches||[]).filter(w=>w.place.id===place.id&&openWatch(w));
  page.append(el('section',{class:'rs-card','aria-label':'Watches here'},el('h3',{},'Open watches here'),
    watches.length?el('div',{class:'rs-list'},watches.map(w=>row({'data-watch-id':w.id},false,()=>{state.watch=w.id;ui.navigate('watches').catch(ui.error);},w.label||'Watch',span(w.start,w.end,tz),[chip(w.status)]))):el('p',{class:'rs-muted'},'No open watch for this place.')));
  sourcePick.addEventListener('change',()=>{state.source.set(place.id,{source_id:sourcePick.value});fill().catch(ui.error);});
  issuancePick.addEventListener('change',()=>{state.source.set(place.id,{source_id:sourcePick.value,issuance_id:issuancePick.value||undefined});fill().catch(ui.error);});
  let ticket=0;
  async function fill(){
    const mine=++ticket,pick=state.source.get(place.id)||{},source_id=pick.source_id||source;
    const args={id:place.id,...(source_id?{source_id}:{}),...(pick.issuance_id?{issuance_id:pick.issuance_id}:{})};
    const airSource=a.preferences?.default_air_source_id;
    const [cond,hours,days,list,aq]=await Promise.all([ui.call(TOOL.conditions,{id:place.id}),ui.call(TOOL.hourly,args),ui.call(TOOL.daily,args),
      ui.call(TOOL.issuances,{id:place.id,...(source_id?{source_id}:{}),limit:12}),airSource?ui.call(TOOL.daily,{id:place.id,source_id:airSource}):null]);
    if(mine!==ticket||!page.isConnected)return;
    issuancePick.replaceChildren(el('option',{value:''},'Latest issuance'));
    for(const i of list.issuances)issuancePick.append(el('option',{value:i.id},when(i.issued_at,tz)+(i.is_latest?' (latest)':'')+' · '+i.id));
    issuancePick.value=pick.issuance_id||'';
    const used=hours.issuance;
    issued.replaceChildren(used?'Issued '+when(used.issued_at,tz)+' by '+hours.source.name+' · '+used.id:'');
    banner.replaceChildren();
    if(used&&!used.is_latest)banner.append(el('div',{class:'rs-banner','data-tone':'warn','data-earlier':'true'},el('p',{},'You are looking at an earlier issuance. Newer forecasts from this source exist.'),
      el('div',{},button('Show the latest',()=>{state.source.set(place.id,{source_id});fill().catch(ui.error);}))));
    now.replaceChildren(el('h3',{},'Now'),nowCard(cond,id=>sourceName(ui,id)));
    hourly.replaceChildren(el('div',{class:'rs-card-head'},el('h3',{},'Next 24 hours'),el('span',{class:'rs-muted'},hours.units?'°'+hours.units.temperature+', '+hours.units.wind+', '+hours.units.precipitation:'')),hourTable(hours,tz));
    daily.replaceChildren(el('h3',{},'Daily forecast'),dayCards(days));
    air.replaceChildren(el('h3',{},'Air quality'),aq?airTable(aq):el('p',{class:'rs-muted'},'No air-quality source is set in your settings.'));
    loaded(page);
  }
  fill().catch(ui.error);
  return page;
}
function nowCard(r,nameOf){
  const o=r.observation,u=r.units;
  if(!o)return el('p',{class:'rs-muted'},'No observation has been reported for this place.');
  const [symbol,label]=sky(o.conditions);
  return el('div',{class:'rs-now','data-observation':o.id},el('span',{class:'rs-sky','aria-hidden':'true'},symbol),el('span',{class:'rs-big'},temp(o.temp,u)),
    el('div',{},el('strong',{},label),el('p',{class:'rs-muted'},'Wind '+num(o.wind,0)+' '+u.wind+', gusts '+num(o.gust,0)+' '+u.wind+(o.humidity!=null?' · humidity '+o.humidity+' %':'')),
      el('p',{class:'rs-muted'},'Observed '+when(o.observed_at,r.place.timezone)+' ('+o.age_minutes+' min before now) · '+nameOf(o.source_id))));
}
function coverageNote(c,unit){
  if(!c||!c.missing?.length)return null;
  if(c.reason==='no_issuance')return el('p',{class:'rs-muted'},'This source has no forecast for this place.');
  return el('p',{class:'rs-muted'},'This issuance does not cover '+c.missing.length+' of the requested '+unit+'.');
}
function hourTable(r,tz){
  if(!r.issuance)return el('p',{class:'rs-muted'},'This source has no forecast for this place. Another source may have one.');
  const u=r.units,table=el('table',{class:'rs-table','data-issuance-id':r.issuance.id},el('thead',{},el('tr',{},['Time','Sky','Temp','Feels like','Rain','Thunder','Precip.','Wind','Gusts'].map(h=>el('th',{scope:'col',class:h==='Sky'?'rs-left':''},h)))));
  const body=el('tbody');
  for(const h of r.rows){const [symbol,label]=sky(h.sky);
    body.append(el('tr',{'data-start':h.start},el('td',{},hourOf(h.start,tz)),el('td',{class:'rs-left'},symbol+' '+label),el('td',{},temp(h.temp,u)),el('td',{},temp(h.apparent_temp,u)),
      el('td',{class:h.pop>=50?'rs-hot':''},h.pop+' %'),el('td',{class:h.thunder_prob>=20?'rs-hot':''},h.thunder_prob+' %'),el('td',{},num(h.precip)+' '+u.precipitation),
      el('td',{},num(h.wind,0)+' '+u.wind),el('td',{},num(h.gust,0)+' '+u.wind)));}
  table.append(body);
  return el('div',{},el('div',{class:'rs-scroll'},table),coverageNote(r.coverage,'hours'));
}
function dayCards(r){
  if(!r.issuance)return el('p',{class:'rs-muted'},'This source has no daily forecast for this place.');
  const u=r.units;
  return el('div',{},el('div',{class:'rs-days','data-issuance-id':r.issuance.id},r.rows.map(d=>el('div',{class:'rs-day','data-date':d.date},el('strong',{},dayOf(d.date)),
    el('span',{class:'rs-hl'},d.headline),el('span',{class:'rs-muted'},d.summary),el('span',{},'High '+temp(d.high,u)+' · low '+temp(d.low,u)),
    el('span',{class:'rs-muted'},'Rain '+d.pop_day+' % day, '+d.pop_night+' % night')))),coverageNote(r.coverage,'days'));
}
function airTable(r){
  if(!r.issuance)return el('p',{class:'rs-muted'},'No air-quality forecast for this place from '+r.source.name+'.');
  const table=el('table',{class:'rs-table','data-issuance-id':r.issuance.id},el('thead',{},el('tr',{},['Day','Index','Category','Main pollutant'].map(h=>el('th',{scope:'col'},h)))),
    el('tbody',{},r.rows.map(d=>el('tr',{'data-date':d.date},el('td',{},dayOf(d.date)),el('td',{class:d.aqi>100?'rs-hot':''},String(d.aqi)),el('td',{},d.category||'—'),el('td',{},String(d.pollutant||'—').toUpperCase())))));
  return el('div',{},el('div',{class:'rs-scroll'},table),el('p',{class:'rs-muted'},r.source.name+' · issued '+when(r.issuance.issued_at,r.place.timezone)),coverageNote(r.coverage,'days'));
}

function alertDetail(ui){
  const id=state.alert,known=(aux(ui).alerts||[]).find(a=>a.id===id);
  if(!known)return empty('No alert selected','Choose an alert to read its messages.');
  const page=el('article',{class:'rs-page','data-alert-id':id},el('p',{class:'rs-muted'},'Loading…'));
  (async()=>{
    const r=await ui.call(TOOL.alert,{id}),a=r.alert,tz=known.timezone;
    if(state.alert!==id||!page.isConnected)return;
    const actions=el('div',{class:'rs-toolbar'});
    if(live(a)&&!a.acknowledged&&ui.has(TOOL.acknowledge))actions.append(button('Acknowledge',e=>acknowledge(ui,a,e.currentTarget),true));
    if(a.acknowledged)actions.append(chip('Acknowledged','good'));
    const messages=el('ol',{class:'rs-thread'});
    for(const m of [...a.messages].reverse())messages.append(el('li',{class:'rs-message','data-message-id':m.message_id},
      el('div',{class:'rs-chips'},chip(m.type==='alert'?'Issued':m.type==='update'?'Update':'Cancelled',m.type==='cancel'?'quiet':null),m.severity?chip(m.severity):null,el('span',{class:'rs-muted'},'Sent '+when(m.sent_at,tz))),
      el('h4',{},m.headline||m.event||''),m.description?textBlock(m.description):null,m.instruction?el('p',{},el('strong',{},'What to do: '),m.instruction):null,
      m.onset?el('p',{class:'rs-muted'},'In effect '+span(m.onset,m.ends,tz)):null));
    page.replaceChildren(el('header',{class:'rs-head'},el('h2',{},a.event),el('p',{},a.source.name+' · '+words(a.category)+' · '+a.zone_ids.join(', '))),
      el('div',{class:'rs-chips'},chip(a.severity),chip(a.status),chip(a.urgency,'quiet'),chip(a.certainty,'quiet')),actions,
      definition([['In effect',span(a.onset,a.ends,tz)],['Affects',a.affected_places.map(p=>p.saved?(p.label||p.name)+' ('+p.name+')':p.name).join(', ')],['Messages',String(a.message_count)],
        ['Acknowledged',a.acknowledgements.length?a.acknowledgements.map(x=>x.message_id+' at '+when(x.acknowledged_at,accountZone(ui))).join('; '):'Not yet']]),
      el('h3',{},'Messages, newest first'),messages);
    loaded(page);
  })().catch(e=>{if(page.isConnected){page.replaceChildren(el('p',{role:'alert',class:'rs-error'},e.message));}});
  return page;
}
async function acknowledge(ui,alert,node){
  node.disabled=true;
  try{
    // Read the thread again: a newer message would need reading before it can be acknowledged.
    const fresh=await ui.call(TOOL.alert,{id:alert.id});
    if(fresh.alert.latest_message_id!==alert.latest_message_id)throw Object.assign(Error('A newer message arrived for this alert. Read it before acknowledging.'),{code:'stale_message'});
    await quickWrite(ui,'ack:'+alert.id+':'+alert.latest_message_id,TOOL.acknowledge,{id:alert.id,message_id:alert.latest_message_id},fresh.version);
    await ui.refresh();say('Alert acknowledged.');
  }catch(e){ui.error(e);node.disabled=false;}
}

const VARIABLES={pop:['Chance of rain',['%']],thunder_prob:['Chance of thunder',['%']],precip:['Precipitation in an hour',['mm','in']],wind_gust:['Wind gusts',['km/h','mph']],
  wind_speed:['Wind speed',['km/h','mph']],temp:['Temperature',['C','F']],apparent_temp:['Feels-like temperature',['C','F']],aqi:['Air quality index',['index']],alert:['An alert',[]]};
const conditionText=c=>c.variable==='alert'?'An alert about '+(c.category&&c.category!=='any'?words(c.category):'anything')+', '+(c.min_severity||'minor')+' or worse'
  :VARIABLES[c.variable][0]+' '+(c.op==='lte'?'≤':'≥')+' '+c.value+(c.unit==='%'?' %':c.unit==='index'?'':' '+(c.unit==='C'||c.unit==='F'?'°'+c.unit:c.unit));
function matchText(m,tz){
  if(m.alert_id)return m.alert_id+' ('+m.severity+', '+words(m.category)+')';
  return (m.start?hourOf(m.start,tz):dayOf(m.date))+': '+m.value+(m.unit==='%'?' %':m.unit==='index'?'':' '+m.unit);
}
function watchDetail(ui){
  const id=state.watch,known=(aux(ui).watches||[]).find(w=>w.id===id);
  if(!known)return empty('No watch selected','Choose a watch, or create one for a saved place.');
  const page=el('article',{class:'rs-page','data-watch-id':id},el('p',{class:'rs-muted'},'Loading…'));
  (async()=>{
    const r=await ui.call(TOOL.watch,{id}),w=r.watch,tz=w.place.timezone,ev=w.evaluation;
    if(state.watch!==id||!page.isConnected)return;
    const actions=el('div',{class:'rs-toolbar'});
    if(openWatch(w)&&ui.has(TOOL.edit))actions.append(button('Edit watch',()=>watchDialog(ui,{watch:w}).catch(ui.error)));
    if(openWatch(w)&&ui.has(TOOL.cancel))actions.append(button('Cancel watch',()=>cancelWatch(ui,w).catch(ui.error)));
    const conditions=el('ul',{class:'rs-conditions'});
    w.conditions.forEach((c,i)=>{const result=ev.conditions.find(x=>x.index===i);
      conditions.append(el('li',{'data-condition':String(i)},el('strong',{},conditionText(c)),
        el('span',{class:'rs-chips'},result?(result.evaluable?chip(result.met?'met':'not met',result.met?'bad':'good'):chip('cannot tell yet','warn')):null),
        result?.matches?.length?el('span',{class:'rs-muted'},'Matched: '+result.matches.slice(0,6).map(m=>matchText(m,tz)).join(' · ')+(result.matches.length>6?' …':'')):null));});
    const cause=ev.cause;
    page.replaceChildren(el('header',{class:'rs-head'},el('h2',{},w.label||'Watch at '+w.place.name),el('p',{},placeTitle(savedPlace(ui,w.place.id)||w.place)+' · '+span(w.start,w.end,tz))),
      el('div',{class:'rs-chips'},chip(w.status)),actions,el('h3',{},'Conditions (any one is enough)'),conditions,
      el('h3',{},'Latest evaluation'),definition([
        ['Status',words(ev.status)],['Evaluated',when(ev.evaluated_at,tz)],
        ['Because of',cause.kind==='create'?'Watch created':cause.kind==='update'?'Watch changed':cause.kind==='forecast.issued'?'New forecast ('+cause.event_id+')':cause.kind.startsWith('alert')?'Alert message ('+cause.event_id+')':words(cause.kind)],
        w.conditions.some(c=>c.variable!=='aqi'&&c.variable!=='alert')?['Forecast used',ev.issuance?sourceName(ui,w.source_id)+' · '+ev.issuance.id+' · issued '+when(ev.issuance.issued_at,tz):'None yet']:null,
        w.aq_source_id?['Air quality used',ev.aq_issuance?sourceName(ui,w.aq_source_id)+' · '+ev.aq_issuance.id:'None yet']:null,
        ev.hours.considered||ev.hours.missing.length?['Hours checked',ev.hours.considered+(ev.hours.missing.length?' ('+ev.hours.missing.length+' not covered)':'')]:null,
        ev.dates.considered?['Days checked',String(ev.dates.considered)+(ev.dates.missing.length?' ('+ev.dates.missing.length+' not covered)':'')]:null]),
      el('h3',{},'Record'),definition([['Created',when(w.created_at,tz)],w.updated_at?['Changed',when(w.updated_at,tz)]:null,w.cancelled_at?['Cancelled',when(w.cancelled_at,tz)]:null,
        w.linked_object?['Linked to',w.linked_object.app_id+' · '+w.linked_object.object_id]:null,['Watch ID',w.id]]));
    loaded(page);
  })().catch(e=>{if(page.isConnected)page.replaceChildren(el('p',{role:'alert',class:'rs-error'},e.message));});
  return page;
}
function noticeDetail(ui){
  const n=(aux(ui).notices||[]).find(x=>x.id===state.notice);
  if(!n)return empty('No notice selected','Choose a notice to read it.');
  const tz=accountZone(ui),places=n.place_ids.map(id=>placeTitle(savedPlace(ui,id)||{name:id})).join(', ');
  const open=n.object.type==='alert'?button('Open alert',()=>{state.alert=n.object.id;ui.navigate('alerts').catch(ui.error);}):button('Open watch',()=>{state.watch=n.object.id;ui.navigate('watches').catch(ui.error);});
  return loaded(el('article',{class:'rs-page','data-notice-id':n.id},el('header',{class:'rs-head'},el('h2',{},n.title),el('p',{},'Written '+when(n.created_at,tz))),
    el('div',{class:'rs-chips'},chip(n.kind.replace('.',' ')),chip(n.state),n.severity?chip(n.severity):null),textBlock(n.body),
    definition([['Places',places],['State',n.state==='held'?'Held until '+when(n.release_at,tz)+' (quiet hours)':'Released '+when(n.release_at,tz)],['Email copy',n.email_copy?'Yes':'No'],['About',n.object.type+' '+n.object.id]]),
    el('div',{class:'rs-toolbar'},open)));
}

// ---- settings ------------------------------------------------------------------------------------
function settingsView(ui){
  const page=el('article',{class:'rs-page','data-settings':''},el('header',{class:'rs-head'},el('h2',{},'Settings'),el('p',{},'Units, default sources, quiet hours and email copies of notices.')),el('p',{class:'rs-muted'},'Loading…'));
  (async()=>{
    const r=await ui.call(TOOL.preferences,{}),p=r.preferences,write=writer(ui,r.version),sources=aux(ui).sources||[];
    if(!page.isConnected)return;
    const editable=ui.has(TOOL.settings);
    const units=select('units',[['metric','Metric (°C, km/h, mm)'],['us','US (°F, mph, in)']],p.units);
    const source=select('default_source_id',sources.filter(s=>s.kind==='weather').map(s=>[s.id,s.name]),p.default_source_id);
    const airSource=select('default_air_source_id',[['','None'],...sources.filter(s=>s.kind==='air_quality').map(s=>[s.id,s.name])],p.default_air_source_id||'');
    const zone=el('input',{type:'text','data-field':'timezone',value:p.timezone,maxlength:'64',list:'rs-zones'});
    const zones=el('datalist',{id:'rs-zones'},[...new Set([p.timezone,...(aux(ui).saved||[]).map(x=>x.timezone).filter(Boolean)])].map(z=>el('option',{value:z})));
    const quiet=el('input',{type:'checkbox','data-field':'quiet_hours.enabled'});quiet.checked=p.quiet_hours.enabled;
    const from=el('input',{type:'time','data-field':'quiet_hours.start',value:p.quiet_hours.start,step:'60'}),to=el('input',{type:'time','data-field':'quiet_hours.end',value:p.quiet_hours.end,step:'60'});
    const email=el('input',{type:'checkbox','data-field':'email_notices'});email.checked=p.email_notices;
    for(const input of [units,source,airSource,zone,quiet,from,to,email])input.disabled=!editable;
    const error=el('p',{role:'alert',class:'form-error rs-error'}),save=el('button',{type:'submit',class:'primary'},'Save settings');
    const form=el('form',{class:'rs-settings','aria-label':'Settings'},
      el('fieldset',{},el('legend',{},'Display'),field('Units',units),field('Time zone for notices and quiet hours',zone,'An IANA zone, for example America/Denver.'),zones),
      el('fieldset',{},el('legend',{},'Default sources'),field('Weather forecasts',source),field('Air quality',airSource)),
      el('fieldset',{},el('legend',{},'Quiet hours'),el('label',{class:'rs-check'},quiet,'Hold notices that are not urgent during quiet hours'),el('div',{class:'rs-pair'},field('From',from),field('Until',to)),
        el('p',{class:'rs-muted'},p.in_quiet_hours?'Quiet hours are on now.':'Quiet hours are not on now.')),
      el('fieldset',{},el('legend',{},'Email'),el('label',{class:'rs-check'},email,'Send an email copy of each notice')),
      error,editable?el('div',{class:'form-actions'},save):el('p',{class:'rs-muted'},'Changing settings is not allowed for this account and policy.'));
    form.addEventListener('submit',async event=>{
      event.preventDefault();save.disabled=true;error.textContent='';delete error.dataset.code;
      try{
        const patch={};
        if(units.value!==p.units)patch.units=units.value;
        if(source.value!==p.default_source_id)patch.default_source_id=source.value;
        if((airSource.value||null)!==(p.default_air_source_id||null))patch.default_air_source_id=airSource.value||null;
        if(zone.value.trim()!==p.timezone)patch.timezone=zone.value.trim();
        const q={};if(quiet.checked!==p.quiet_hours.enabled)q.enabled=quiet.checked;if(from.value!==p.quiet_hours.start)q.start=from.value;if(to.value!==p.quiet_hours.end)q.end=to.value;
        if(Object.keys(q).length)patch.quiet_hours=q;
        if(email.checked!==p.email_notices)patch.email_notices=email.checked;
        if(!Object.keys(patch).length)throw Object.assign(Error('No changes to save.'),{code:'no_changes'});
        await write(TOOL.settings,{patch});
        await ui.refresh();say('Settings saved.');
      }catch(e){error.textContent=e.message;error.dataset.code=e.code||'request_failed';save.disabled=false;}
    });
    page.replaceChildren(page.firstChild,form);loaded(page);
  })().catch(e=>{if(page.isConnected)page.replaceChildren(el('p',{role:'alert',class:'rs-error'},e.message));});
  return page;
}

// ---- place forms -------------------------------------------------------------------------------------
function ruleFields(rule={categories:CATEGORIES,min_severity:'moderate',paused:false},withPause){
  const boxes=CATEGORIES.map(c=>{const b=el('input',{type:'checkbox',value:c,'data-field':'alert_rule.categories'});b.checked=rule.categories.includes(c);return [c,b];});
  const severity=select('alert_rule.min_severity',SEVERITY.map(s=>[s,words(s)+' or worse']),rule.min_severity);
  const paused=el('input',{type:'checkbox','data-field':'alert_rule.paused'});paused.checked=!!rule.paused;
  const node=el('fieldset',{},el('legend',{},'Alerts for this place'),el('div',{class:'rs-checks'},boxes.map(([c,b])=>el('label',{},b,words(c)))),field('Only alerts that are at least',severity),
    withPause?el('label',{class:'rs-check'},paused,'Pause alerts for this place'):null);
  return {node,read:()=>({categories:boxes.filter(([,b])=>b.checked).map(([c])=>c),min_severity:severity.value,...(withPause?{paused:paused.checked}:{})})};
}
async function addPlace(ui){
  const base=await ui.call(TOOL.places,{}),write=writer(ui,base.version);
  let chosen=null;
  const query=el('input',{type:'search','data-field':'query',maxlength:'100',placeholder:'Town, lake, pass or region'}),results=el('div',{class:'rs-results',role:'radiogroup','aria-label':'Places found'});
  const label=el('input',{type:'text','data-field':'label',maxlength:'80',placeholder:'For example: Mom\'s house'}),rule=ruleFields(undefined,false);
  const find=async()=>{
    const q=query.value.trim();results.replaceChildren();chosen=null;if(!q)return;
    const r=await ui.call(TOOL.search,{query:q,limit:10});
    if(!r.places.length)results.append(el('p',{class:'rs-muted'},'No place matches “'+q+'”.'));
    for(const p of r.places){const radio=el('input',{type:'radio',name:'rs-place',value:p.id,disabled:p.saved});radio.addEventListener('change',()=>{chosen=p.id;});
      results.append(el('label',{'data-result-id':p.id},radio,el('span',{},el('strong',{},p.name),' · '+p.region+(p.saved?' · already saved as '+p.label:''))));}
  };
  const d=dialog('Add place','Save place',async()=>{
    if(!chosen)d.fail('Choose a place from the search results.');
    const r=rule.read(),args={id:chosen,alert_rule:{categories:r.categories,min_severity:r.min_severity}};
    if(label.value.trim())args.label=label.value.trim();
    const result=await write(TOOL.save,args);
    await ui.refresh(result.id||chosen);say('Place saved.');
  });
  const go=button('Search',()=>find().catch(e=>{d.error.textContent=e.message;}));
  query.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();go.click();}});
  d.body.append(el('div',{class:'rs-pair'},field('Find a place',query),el('div',{},go)),results,field('Your name for it (optional)',label),rule.node);
  query.focus();
}
async function editPlace(ui,place){
  const base=await ui.call(TOOL.places,{}),current=base.places.find(p=>p.id===place.id);
  if(!current)throw Object.assign(Error('This place is no longer saved. Refresh the page.'),{code:'not_found'});
  const write=writer(ui,base.version),label=el('input',{type:'text','data-field':'label',maxlength:'80',value:current.label||''}),rule=ruleFields(current.alert_rule,true);
  const d=dialog('Edit '+(current.label||current.name),'Save changes',async()=>{
    // Only what changed is sent: a task may allow changing the alert rule but not the label.
    const patch={},r=rule.read(),was=current.alert_rule,changed={};
    if(label.value.trim()&&label.value.trim()!==(current.label||''))patch.label=label.value.trim();
    if(!sameJson([...r.categories].sort(),[...was.categories].sort()))changed.categories=r.categories;
    if(r.min_severity!==was.min_severity)changed.min_severity=r.min_severity;
    if(r.paused!==was.paused)changed.paused=r.paused;
    if(Object.keys(changed).length)patch.alert_rule=changed;
    if(!Object.keys(patch).length)d.fail('No changes to save.','no_changes');
    await write(TOOL.update,{id:current.id,patch});
    await ui.refresh(current.id);say('Place updated.');
  });
  d.body.append(el('p',{class:'rs-muted'},current.name+' · '+current.region),field('Your name for it',label),rule.node);
}
async function togglePause(ui,place,node){
  node.disabled=true;
  try{
    const base=await ui.call(TOOL.places,{}),current=base.places.find(p=>p.id===place.id);
    if(!current||current.alert_rule.paused!==place.alert_rule.paused)throw Object.assign(Error('This place changed. Refresh before trying again.'),{code:'stale_version'});
    const paused=!current.alert_rule.paused;
    await quickWrite(ui,'pause:'+place.id+':'+paused,TOOL.update,{id:place.id,patch:{alert_rule:{paused}}},base.version);
    await ui.refresh(place.id);say(paused?'Alerts paused for this place.':'Alerts resumed for this place.');
  }catch(e){ui.error(e);node.disabled=false;}
}
async function removePlace(ui,place){
  const base=await ui.call(TOOL.places,{}),write=writer(ui,base.version);
  const d=dialog('Remove '+(place.label||place.name)+'?','Remove place',async()=>{await write(TOOL.remove,{id:place.id});await ui.refresh();say('Place removed.');});
  d.body.append(el('p',{},'It leaves your saved places. Earlier notices and ended watches stay in your history. A place with an open watch cannot be removed.'));
}

// ---- watch forms -------------------------------------------------------------------------------------
function conditionRow(c,prefs,onRemove){
  const metric=prefs?.units!=='us';
  const variable=select('condition.variable',Object.entries(VARIABLES).map(([k,[l]])=>[k,l]),c.variable);variable.setAttribute('aria-label','Watch for');
  const op=select('condition.op',[['gte','at least'],['lte','at most']],c.op||'gte');op.setAttribute('aria-label','Comparison');
  const value=el('input',{type:'number',step:'any','data-field':'condition.value','aria-label':'Value'});if(c.value!==undefined)value.value=String(c.value);
  const unit=el('select',{'data-field':'condition.unit','aria-label':'Unit'});
  const category=select('condition.category',[['any','Any alert'],...CATEGORIES.map(x=>[x,words(x)])],c.category||'any');category.setAttribute('aria-label','Alert about');
  const severity=select('condition.min_severity',SEVERITY.map(s=>[s,words(s)+' or worse']),c.min_severity||'moderate');severity.setAttribute('aria-label','Alert severity');
  const numeric=el('div',{class:'rs-pair'},field('Is',op),field('Value',value)),alertBits=el('div',{class:'rs-pair'},field('About',category),field('Severity',severity));
  const unitField=field('Unit',unit),remove=button('Remove',()=>onRemove(node),false,{'aria-label':'Remove condition'});
  const node=el('div',{class:'rs-condition','data-condition-row':''},field('Watch for',variable),numeric,unitField,alertBits,remove);
  const sync=(keep)=>{
    const v=variable.value,isAlert=v==='alert',units=VARIABLES[v][1];
    numeric.hidden=isAlert;unitField.hidden=isAlert||units.length<2;alertBits.hidden=!isAlert;
    const fallback=units.find(u=>metric?['C','km/h','mm','%','index'].includes(u):['F','mph','in','%','index'].includes(u))||units[0];
    unit.replaceChildren(...units.map(u=>el('option',{value:u},u==='C'||u==='F'?'°'+u:u)));
    unit.value=keep&&units.includes(c.unit)?c.unit:fallback;
  };
  variable.addEventListener('change',()=>sync(false));sync(true);
  return {node,read:()=>{
    if(variable.value==='alert')return {variable:'alert',category:category.value,min_severity:severity.value};
    if(value.value==='')throw Object.assign(Error('Every condition needs a value.'),{code:'invalid_input'});
    return {variable:variable.value,op:op.value,value:Number(value.value),unit:unit.value||VARIABLES[variable.value][1][0]};
  }};
}
async function watchDialog(ui,{watch=null,placeId=null}){
  const a=aux(ui),prefs=a.preferences;
  // The form is based on what the App holds now; its version is what the write expects.
  const base=watch?await ui.call(TOOL.watch,{id:watch.id}):await ui.call(TOOL.places,{});
  const current=watch?base.watch:null,places=watch?[]:base.places;
  if(!watch&&!places.length)throw Object.assign(Error('Save a place before creating a watch.'),{code:'not_found'});
  const write=writer(ui,base.version),weather=(a.sources||[]).filter(s=>s.kind==='weather'),air=(a.sources||[]).filter(s=>s.kind==='air_quality');
  const place=select('id',places.map(p=>[p.id,placeTitle(p)]),placeId||places[0]?.id);place.setAttribute('aria-label','Place');
  const zoneOf=()=>watch?current.place.timezone:places.find(p=>p.id===place.value).timezone;
  const label=el('input',{type:'text','data-field':'label',maxlength:'80',value:current?.label||'',placeholder:'For example: Saturday hike'});
  const start=el('input',{type:'datetime-local','data-field':'start',step:'60'}),end=el('input',{type:'datetime-local','data-field':'end',step:'60'});
  const zoneNote=el('small',{});
  const source=select('source_id',weather.map(s=>[s.id,s.name]),current?.source_id||prefs?.default_source_id);source.setAttribute('aria-label','Weather source');
  const airSource=select('aq_source_id',air.map(s=>[s.id,s.name]),current?.aq_source_id||prefs?.default_air_source_id||air[0]?.id);airSource.setAttribute('aria-label','Air-quality source');
  const airField=field('Air-quality source',airSource,'Used by the air quality condition.');
  const rows=el('div',{class:'rs-conditions-edit'}),conditions=[];
  const refreshAir=()=>{airField.hidden=!conditions.some(c=>c.node.querySelector('[data-field="condition.variable"]').value==='aqi');};
  const addRow=c=>{const r=conditionRow(c,prefs,node=>{if(conditions.length===1)return;conditions.splice(conditions.findIndex(x=>x.node===node),1);node.remove();refreshAir();});
    conditions.push(r);rows.append(r.node);r.node.querySelector('[data-field="condition.variable"]').addEventListener('change',refreshAir);refreshAir();};
  const setTimes=()=>{const tz=zoneOf();zoneNote.textContent='Local time at the place: '+zoneName(tz,a.now)+' ('+tz+').';};
  if(current){const tz=current.place.timezone;start.value=isoToWall(current.start,tz);end.value=isoToWall(current.end,tz);current.conditions.forEach(addRow);}
  else{
    const tz=zoneOf(),now=a.now?isoToWall(a.now,tz):null;
    if(now){const next=addHours(now.slice(0,14)+'00',2,tz);start.value=next;end.value=addHours(next,3,tz);}
    addRow({variable:'pop',op:'gte',value:40,unit:'%'});
  }
  place.addEventListener('change',()=>{
    // Keep the typed wall times; they are read in the newly chosen place's zone.
    setTimes();
  });
  setTimes();
  const title=current?'Edit watch':'New watch';
  const d=dialog(title,current?'Save changes':'Create watch',async()=>{
    const tz=zoneOf(),s=wallToIso(start.value,tz),e=wallToIso(end.value,tz);
    if(!s||!e)d.fail('Enter a start and an end.');
    const list=conditions.map(c=>c.read()),hasAqi=list.some(c=>c.variable==='aqi');
    if(!current){
      const args={id:place.value,start:s,end:e,conditions:list,source_id:source.value};
      if(label.value.trim())args.label=label.value.trim();
      if(hasAqi&&airSource.value)args.aq_source_id=airSource.value;
      const result=await write(TOOL.create,args);
      state.watch=result.watch?.id||result.id;
    }else{
      // Only edited fields are sent; times that name the same instant are unchanged.
      const patch={};
      if(label.value.trim()&&label.value.trim()!==(current.label||''))patch.label=label.value.trim();
      if(Date.parse(s)!==Date.parse(current.start))patch.start=s;
      if(Date.parse(e)!==Date.parse(current.end))patch.end=e;
      if(!sameJson(list,current.conditions))patch.conditions=list;
      if(source.value!==current.source_id)patch.source_id=source.value;
      if(hasAqi&&airSource.value&&airSource.value!==current.aq_source_id)patch.aq_source_id=airSource.value;
      if(!Object.keys(patch).length)d.fail('No changes to save.','no_changes');
      await write(TOOL.edit,{id:current.id,patch});
      state.watch=current.id;
    }
    await ui.refresh();await ui.navigate('watches');say(current?'Watch updated.':'Watch created.');
  });
  d.body.append(current?el('p',{class:'rs-muted'},placeTitle(savedPlace(ui,current.place.id)||current.place)):field('Place',place),
    field('Name (optional)',label),el('div',{class:'rs-pair'},field('From',start),field('Until',end)),zoneNote,field('Weather source',source),
    el('fieldset',{},el('legend',{},'Tell me if any of these happens'),rows,el('div',{},button('Add condition',()=>{if(conditions.length<6)addRow({variable:'thunder_prob',op:'gte',value:20,unit:'%'});}))),airField);
}
async function cancelWatch(ui,watch){
  const base=await ui.call(TOOL.watch,{id:watch.id}),write=writer(ui,base.version);
  const d=dialog('Cancel '+(watch.label||'this watch')+'?','Cancel watch',async()=>{await write(TOOL.cancel,{id:watch.id});await ui.refresh();say('Watch cancelled.');});
  d.body.append(el('p',{},'The watch stops checking the forecast and alerts. It stays in your history.'));
}

export const config={
  id:'rainshadow',title:'Rainshadow',description:'Forecasts, alerts and weather watches for your saved places.',symbol:'☂',
  searchLabel:'Search places, alerts, watches and notices',initialSection:'places',
  list:TOOL.places,collection:'places',get:TOOL.conditions,item:'place',
  heading:p=>p.label||p.name,subtitle:p=>p.name+' · '+p.region,actions:[],
  sections:ui=>{const a=aux(ui),alerts=(a.alerts||[]).filter(live).length,watches=(a.watches||[]).filter(openWatch).length,held=(a.notices||[]).filter(n=>n.state==='held').length;
    return [{id:'places',label:'Places',symbol:'⌂'},{id:'alerts',label:'Alerts'+(alerts?' · '+alerts:''),symbol:'⚠',filter:()=>false,count:false},
      {id:'watches',label:'Watches'+(watches?' · '+watches+' open':''),symbol:'◎',filter:()=>false,count:false},
      {id:'notices',label:'Notices'+(held?' · '+held+' held':''),symbol:'✉',filter:()=>false,count:false},{id:'settings',label:'Settings',symbol:'⚙',filter:()=>false,count:false}];},
  load,renderList,emptyView,view:placeView
};
mount(config);
