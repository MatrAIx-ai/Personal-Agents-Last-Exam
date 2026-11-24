import {mount,el,tag,metadata} from '/shared/client.js';

const T={
 account:'plateway.account.get',search:'plateway.restaurants.search',restaurant:'plateway.restaurants.get',item:'plateway.menu_items.get',
 cart:'plateway.cart.get',add:'plateway.cart.add_item',update:'plateway.cart.update_item',remove:'plateway.cart.remove_item',
 preview:'plateway.checkout.preview',orders:'plateway.orders.list',order:'plateway.orders.get',place:'plateway.orders.place',
 cancelPreview:'plateway.orders.cancel.preview',cancel:'plateway.orders.cancel.confirm',report:'plateway.orders.report_issue',rate:'plateway.orders.rate'
};
const LABEL_MAX=40,RATING_TEXT_MAX=500,TIP_MAX_CENTS=100000;
const S={version:null,account:null,cart:null,cartRestaurant:null,orders:[],restaurants:[],cuisines:[],restaurant:null,menu:[],item:null,editItem:null,order:null,
 addressId:null,cuisine:'',restaurantId:null,itemId:null,orderId:null,editLineId:null,draft:null,lineDraft:null,reportDraft:null,rateDraft:null,goto:null,intent:0,unknown:null,undo:null,
 checkout:{address_id:null,card_id:null,mode:'asap',date:'',time:'19:00',tip:'0.00',rev:0},quote:null,cancelQuote:null,panel:null,flash:null,error:null,busy:false};
let loads=0;
const css=(node,style)=>{Object.assign(node.style,style);return node;};
const points=text=>[...String(text||'')].length;
const money=cents=>(cents<0?'−':'')+'$'+(Math.abs(cents)/100).toFixed(2);
const zone=()=>S.account?.time_zone||'UTC';
const fmt=(iso,options)=>iso?new Intl.DateTimeFormat('en-US',{timeZone:zone(),...options}).format(new Date(iso)):'—';
const year=iso=>fmt(iso,{year:'numeric'});
const when=(iso,extra={})=>fmt(iso,{weekday:'short',month:'short',day:'numeric',...(iso&&S.account&&year(iso)!==year(S.account.now)?{year:'numeric'}:{}),hour:'numeric',minute:'2-digit',...extra});
const zoned=iso=>when(iso,{timeZoneName:'short'});
const clock=iso=>fmt(iso,{hour:'numeric',minute:'2-digit'});
const zoneName=()=>new Intl.DateTimeFormat('en-US',{timeZone:zone(),timeZoneName:'longGeneric'}).formatToParts(new Date()).find(p=>p.type==='timeZoneName')?.value||zone();
const hm=t=>{const [h,m]=t.split(':').map(Number);return h*60+m;};
const twelve=t=>{const [h,m]=t.split(':').map(Number);return (h%12||12)+':'+String(m).padStart(2,'0')+' '+(h<12||h===24?'AM':'PM');};
const reasonText=r=>CANCEL_REASON[r]||String(r||'').replace(/_/g,' ');
const STATUS={scheduled:'Scheduled',submitted:'Waiting for the restaurant',preparing:'Preparing',picked_up:'On the way',delivered:'Delivered',cancelled:'Cancelled'};
const DAYS=[['mon','Mon'],['tue','Tue'],['wed','Wed'],['thu','Thu'],['fri','Fri'],['sat','Sat'],['sun','Sun']];
const DAY_KEYS=['sun','mon','tue','wed','thu','fri','sat'],DAY_NAMES=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const CANCEL_REASON={account_holder:'cancelled by you',rejected:'declined by the restaurant',not_accepted:'not accepted by the restaurant in time',unavailable_at_release:'the restaurant was unavailable when the order was due to be sent',closed_at_release:'the restaurant was closed when the order was due to be sent',last_line_unavailable:'none of the items were available'};
const REFUND_REASON={cancelled:'Cancellation refund',line_unavailable:'Unavailable item',line_removed_at_release:'Item unavailable when sent',line_reported:'Reported item'};
const ISO_TEXT=/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})/g;
const SMALL_ORDER_BELOW_CENTS=1200,SMALL_ORDER_FEE_CENTS=249;
const searchText=()=>(document.querySelector('.toolbar input[type=search]')?.value||'').trim().slice(0,80);
const transport=e=>e instanceof TypeError&&/fetch|network|load failed/i.test(e.message);
const unavailable=text=>el('div',{class:'empty','data-unavailable':'true'},el('h3',{},'Not available'),el('p',{},text+' is not allowed by the current policy.'));

function parts(t,tz){return Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:tz,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(new Date(t)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));}
function offset(t,tz){const p=parts(t,tz);return Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second)-Math.floor(t/1000)*1000;}
function zonedIso(date,time,tz){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||!/^\d{2}:\d{2}$/.test(time||''))return {error:'Choose a delivery date and time.'};
 const [y,m,d]=date.split('-').map(Number),[h,mi]=time.split(':').map(Number),want=Date.UTC(y,m-1,d,h,mi);
 const found=[...new Set([-2,-1,0,1,2].map(k=>offset(want+k*86400000,tz)))].map(o=>want-o).filter(t=>{const p=parts(t,tz);return +p.year===y&&+p.month===m&&+p.day===d&&+p.hour===h&&+p.minute===mi;}).sort((a,b)=>a-b);
 if(!found.length)return {error:'There is no '+time+' on '+date+' in '+tz+' (the clocks change that night). Choose another time.'};
 const o=offset(found[0],tz)/60000,a=Math.abs(o),pad=n=>String(n).padStart(2,'0');
 return {iso:date+'T'+time+':00'+(o<0?'-':'+')+pad(Math.floor(a/60))+':'+pad(a%60)};
}
function localNow(){const p=parts(Date.parse(S.account.now),zone());return {year:+p.year,month:+p.month,dow:new Date(Date.UTC(+p.year,+p.month-1,+p.day)).getUTCDay(),min:+p.hour*60+ +p.minute};}
function expired(card){const n=localNow();return card.exp_year<n.year||(card.exp_year===n.year&&card.exp_month<n.month);}
function nextOpening(r){const {dow,min}=localNow();for(let k=0;k<8;k++){const d=(dow+k)%7,start=(r.hours[DAY_KEYS[d]]||[]).map(s=>s[0]).sort().find(s=>k>0||hm(s)>min);if(start)return (k===0?'today':k===1?'tomorrow':DAY_NAMES[d])+' at '+twelve(start);}return null;}
function closingTime(r){
 const {dow,min}=localNow(),span=(a,b,shift)=>[hm(a)+shift,(hm(b)<=hm(a)?hm(b)+1440:hm(b))+shift],spans=[];
 for(let k=-1;k<=7;k++)for(const [a,b] of r.hours[DAY_KEYS[(dow+k+7)%7]]||[])spans.push(span(a,b,k*1440));
 spans.sort((x,y)=>x[0]-y[0]);
 let end=null;for(const [a,b] of spans){if(end===null){if(a<=min&&min<b)end=b;}else if(a<=end&&b>end)end=b;}
 if(end===null)return null;if(end>=min+7*1440)return 'never';
 const m=((end%1440)+1440)%1440;return twelve(String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0'));
}
function openAt(r,t){const p=parts(t,zone()),dow=new Date(Date.UTC(+p.year,+p.month-1,+p.day)).getUTCDay(),min=+p.hour*60+ +p.minute;
 if((r.hours[DAY_KEYS[dow]]||[]).some(([a,b])=>{const s=hm(a),e=hm(b);return e>s?min>=s&&min<e:min>=s;}))return true;
 return (r.hours[DAY_KEYS[(dow+6)%7]]||[]).some(([a,b])=>hm(b)<=hm(a)&&min<hm(b));}
function estimateFor(r,addressId){const zone=S.account.addresses.find(a=>a.id===addressId)?.zone_id,travel=r.zones?.find(z=>z.zone_id===zone)?.travel_minutes;return travel==null?null:r.prep_minutes+travel;}
function wall(t){const p=parts(t,zone());return Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute);}
function firstSlot(r,addressId){
 const estimate=estimateFor(r,addressId);if(estimate==null)return null;
 const now=Date.parse(S.account.now),step=900000,lastWall=wall(now)+7*86400000;
 for(let t=Math.ceil((now+45*60000)/step)*step;wall(t)<=lastWall;t+=step){
  const release=t-estimate*60000;if(release<=now||!openAt(r,release))continue;
  const p=parts(t,zone()),date=p.year+'-'+p.month+'-'+p.day,time=p.hour+':'+p.minute,z=zonedIso(date,time,zone());
  if(!z.iso||Date.parse(z.iso)!==t)continue;
  return {date,time};
 }
 return null;
}
function hoursOn(r,dayKey){return (r.hours[dayKey]||[]).map(([a,b])=>twelve(a)+' – '+twelve(b)).join(', ')||'Closed';}
function noteText(o,note){return String(note).replace(/\bol-h?\d+\b/g,id=>{const l=o.lines.find(x=>x.id===id);return l?'“'+l.name+'”':'an item';}).replace(ISO_TEXT,iso=>clock(iso)).replace(/^Cancelled: (\w+)$/,(m,r)=>r==='account_holder'?'Cancelled by you':'Cancelled: '+reasonText(r));}
function tomorrow(account){const p=parts(Date.parse(account.now),account.time_zone);return new Date(Date.UTC(+p.year,+p.month-1,+p.day+1)).toISOString().slice(0,10);}

async function read(ui,name,args,fallback=null){
 if(!ui.has(name))return fallback;
 try{return await ui.call(name,args);}catch(e){if(e.code==='not_found')return fallback;throw e;}
}
function applied(r){if(r.version)S.version=r.version;if(r.cart){S.cart=r.cart;if(S.editLineId&&!r.cart.lines.some(l=>l.id===S.editLineId)){S.editLineId=null;S.lineDraft=null;}}S.wrote=true;}
async function commit(ui,name,args,label,done,plan=null,step=null){
 const request={expected_version:plan?plan.version:S.version,request_id:'web-'+crypto.randomUUID()};let r;
 try{r=await ui.call(name,{...args,...request});}
 catch(e){if(!e.code)S.unknown={name,args,request,label,done,plan,step,reason:transport(e)?'the connection dropped':e.message};throw e;}
 applied(r);if(plan&&r.version)plan.version=r.version;done(r);return r;
}
async function runSteps(ui,plan){
 while(plan.steps.length){
  const step=plan.steps[0];
  try{await commit(ui,step.name,step.args,step.label,r=>{plan.steps.shift();plan.applied++;step.done?.(r,plan);},plan,step);}
  catch(e){
   if(!e.code)throw e;
   if(step.skip?.includes(e.code)){plan.steps.shift();step.skipped?.(e,plan);continue;}
   if(plan.applied)e.partial='“'+plan.label+'” stopped part-way; check your cart.';
   throw e;
  }
 }
 plan.finish(plan);
}
async function retryUnknown(ui){
 const u=S.unknown;let r;
 try{r=await ui.call(u.name,{...u.args,...u.request});}
 catch(e){
  if(!e.code||e.code==='permission_denied')throw e;
  if(u.plan&&u.step?.skip?.includes(e.code)){S.unknown=null;u.plan.steps.shift();u.step.skipped?.(e,u.plan);u.plan.viaRetry=true;await runSteps(ui,u.plan);return;}
  const now=(await ui.call(T.account,{}).catch(()=>null))?.version;
  if(!now)throw Object.assign(Error('Plateway answered, but the page could not read its current state to tell whether the earlier request took effect. Retry again.'),{code:'unconfirmed_pending'});
  S.unknown=null;
  const same=now.epoch===u.request.expected_version.epoch,plan=u.plan;
  const partial=plan?(plan.applied?(same?'Part of “'+plan.label+'” had already been done and the rest was not; check your cart.':'Part of “'+plan.label+'” had already been done; check your cart.'):plan.steps.length>1&&same?'The rest of “'+plan.label+'” was not done.':''):'';
  throw Object.assign(Error(same?'Plateway did not apply the earlier request to '+u.label+(plan&&plan.applied?'.':'; nothing was done. Start it again if you still want it.'):'Plateway was reset or reloaded after the earlier request to '+u.label+', so whether it took effect cannot be confirmed. Check the cart and Orders before trying again.'),{code:same?'not_applied':'unconfirmed',partial});
 }
 S.unknown=null;applied(r);if(u.plan&&r.version)u.plan.version=r.version;u.done(r);
 if(u.plan){u.plan.viaRetry=true;await runSteps(ui,u.plan);}
}
const said=(r,text,label)=>r.duplicate?'Your earlier request to '+label+' had already gone through; it was not applied twice.':text;
function lock(){
 for(const b of document.querySelectorAll('#records button,.detail button'))b.disabled=true;
 const status=document.getElementById('status');if(status){status.textContent='Working…';delete status.dataset.error;}
}
async function act(ui,scope,run,resolving=false){
 if(S.busy)return;
 if(S.stale&&!resolving){S.flash=null;S.error={scope,code:'refresh_needed',message:'The page could not load Plateway’s latest state after the last change. Press Refresh before changing anything else.'};ui.navigate(ui.section).catch(ui.error);return;}
 const origin=ui.section;S.wrote=false;
 if(S.unknown&&!resolving){S.flash=null;S.error={scope,code:'unanswered',message:'Plateway has not answered the earlier request to '+S.unknown.label+'. Retry or dismiss it first.'};ui.navigate(ui.section).catch(ui.error);return;}
 S.busy=true;S.error=null;S.flash=null;if(scope!=='undo')S.undo=null;lock();const pendingBefore=S.unknown;
 try{await run();}
 catch(e){S.error=e.code==='stale_version'?{scope,code:e.code,message:'Plateway changed since this page last read it. Check the refreshed details, then try again.'}:e.code?{scope,code:e.code,message:e.message}:transport(e)?{scope,code:'connection_lost',message:'The connection dropped before Plateway answered.'}:{scope,code:/not permitted/i.test(e.message)?'not_permitted':'request_failed',message:e.message};
  if(e.partial)S.error.message+=' '+e.partial;
  if(S.unknown&&S.unknown!==pendingBefore)S.error.message='Plateway did not confirm this request; see “Waiting for Plateway”.';}
 finally{S.busy=false;S.intent++;S.flashSection=S.goto||origin;if(S.wrote)S.stale=true;}
 try{await ui.navigate(ui.section);}catch(e){ui.error(e);}
 try{await ui.refresh();if(S.goto){const target=S.goto;S.goto=null;await ui.navigate(target);}}catch(e){ui.error(e);}
 document.querySelector('.detail [role=alert]:not(:empty),.detail [data-flash],.detail [aria-label="Order total"]')?.scrollIntoView({block:'nearest'});
}
function choose(ui,changes){if(S.busy)return;Object.assign(S,changes);S.intent++;S.error=null;S.flash=null;ui.refresh().catch(ui.error);}
const ALERT={background:'#fff4f1',padding:'8px 10px',borderRadius:'8px',marginTop:'12px'};
function local(code){return css(el('p',{role:'alert',class:'form-error','data-code':code}),ALERT);}
function alertFor(scope){return S.error?.scope===scope?css(el('p',{role:'alert',class:'form-error','data-code':S.error.code},S.error.message),ALERT):null;}
const muted=(text,attrs={})=>css(el('p',attrs,text),{color:'var(--muted)',fontSize:'12px',margin:'6px 0'});
function flash(){return css(el('p',{role:'status','data-flash':'true'},S.flash),{color:'var(--accent)',fontWeight:'600',fontSize:'13px'});}
function button(label,onclick,attrs={}){return el('button',{type:'button',disabled:S.busy?'':false,...attrs,onclick},label);}
function row(attrs,onclick,title,...lines){return el(onclick?'button':'div',{...(onclick?{type:'button',onclick,disabled:S.busy?'':false}:{}),class:'record',...attrs},el('span',{class:'record-title'},title),...lines.filter(Boolean).map(l=>el('span',{class:'record-subtitle'},l)));}
function panel(label,...children){return css(el('section',{class:'query-result','aria-label':label},el('h3',{},label),...children.flat().filter(Boolean)),{marginTop:'18px'});}
function group(legendText){const legend=css(el('legend',{},legendText),{display:'block',fontWeight:'600',marginBottom:'4px'});return css(el('fieldset',{},legend),{gap:'2px'});}
function choiceLabel(input,...text){css(input,{width:'auto',margin:'0'});return css(el('label',{},input,el('span',{},...text)),{display:'flex',gap:'8px',alignItems:'center',padding:'4px 0'});}
function allergenText(a){const c=a?.contains||[],m=a?.may_contain||[];return [c.length?'Contains '+c.join(', '):'',m.length?'May contain '+m.join(', '):''].filter(Boolean).join(' · ');}
function lineOptions(line){return line.options?.length?line.options.map(o=>o.name+(o.price_delta_cents?' (+'+money(o.price_delta_cents)+')':'')).join(', '):'No options';}
function cardName(id){const c=S.account.cards.find(x=>x.id===id);return c?c.brand+' '+c.masked_number:id;}
function addressName(id){const a=S.account.addresses.find(x=>x.id===id);return a?a.label+' — '+a.line1:id;}

async function load(ui){
 const seq=++loads,intent=S.intent,N={};
 const account=await ui.call(T.account,{});N.version=account.version;N.account=account;
 N.addressId=account.addresses.some(a=>a.id===S.addressId)?S.addressId:account.addresses[0]?.id||null;
 N.cart=await read(ui,T.cart,{},{restaurant_id:null,lines:[],subtotal_cents:0});
 N.cartRestaurant=N.cart.restaurant_id?(await read(ui,T.restaurant,{restaurant_id:N.cart.restaurant_id}))?.restaurant||null:null;
 N.orders=(await read(ui,T.orders,{},{orders:[]})).orders;
 const all=N.addressId?(await read(ui,T.search,{address_id:N.addressId},{restaurants:[]})).restaurants:[];
 N.cuisines=[...new Set(all.flatMap(r=>r.cuisines))].sort();N.cuisine=N.cuisines.includes(S.cuisine)?S.cuisine:'';
 const text=searchText(),args={address_id:N.addressId,...(text?{text}:{}),...(N.cuisine?{cuisine:N.cuisine}:{})};
 N.restaurants=N.addressId&&(text||N.cuisine)?(await read(ui,T.search,args,{restaurants:[]})).restaurants:all;
 const detail=S.restaurantId?await read(ui,T.restaurant,{restaurant_id:S.restaurantId}):null;
 N.restaurant=detail?.restaurant||null;N.menu=detail?.menu||[];N.restaurantId=N.restaurant?S.restaurantId:null;
 N.item=S.itemId?(await read(ui,T.item,{item_id:S.itemId}))?.item||null:null;N.itemId=N.item?S.itemId:null;
 const line=N.cart.lines.find(l=>l.id===S.editLineId);
 N.editItem=line?(await read(ui,T.item,{item_id:line.item_id}))?.item||null:null;N.editLineId=line&&N.editItem?S.editLineId:null;
 N.orderId=N.orders.some(o=>o.id===S.orderId)?S.orderId:N.orders[0]?.id||null;
 N.order=N.orderId?(await read(ui,T.order,{order_id:N.orderId}))?.order||null:null;
 if(seq!==loads||intent!==S.intent)return {};
 Object.assign(S,N);S.stale=false;
 const c=S.checkout;
 if(!account.addresses.some(a=>a.id===c.address_id))c.address_id=S.addressId;
 if(!account.cards.some(k=>k.id===c.card_id&&!expired(k)))c.card_id=account.cards.find(k=>!expired(k))?.id||null;
 if(!c.date)c.date=tomorrow(account);
 if(!S.cart.lines.length||!ui.has(T.preview))S.quote=null;
 if(S.cancelQuote&&S.cancelQuote.order_id!==S.orderId)S.cancelQuote=null;
 if(S.panel&&(S.panel.order_id!==S.orderId||S.order?.status!=='delivered'))S.panel=null;
 return {};
}

function optionEditor(item,chosen,changed){
 const box=el('div',{class:'fields','data-options-for':item.id});
 for(const g of item.option_groups||[]){
  const single=g.max===1,rule=g.required?(g.min===g.max?'choose '+g.min:'choose '+g.min+' to '+g.max):'optional'+(single?'':', up to '+g.max);
  const set=group(g.name+' · '+rule);set.dataset.group=g.id;
  if(single&&!g.required){const none=el('input',{type:'radio',name:'group-'+item.id+'-'+g.id,value:'','data-option':'none-'+g.id,'aria-label':g.name+': none'});none.checked=!g.options.some(o=>chosen.includes(o.id));set.append(choiceLabel(none,'None'));}
  for(const o of g.options){
   const input=el('input',{type:single?'radio':'checkbox',name:'group-'+item.id+'-'+g.id,value:o.id,'data-option':o.id,'aria-label':g.name+': '+o.name});
   input.checked=chosen.includes(o.id);
   const extra=[o.price_delta_cents?'+'+money(o.price_delta_cents):'',allergenText(o.allergens)].filter(Boolean).join(' · ');
   set.append(choiceLabel(input,o.name,extra?el('small',{},extra):null));
  }
  box.append(set);
 }
 box.addEventListener('change',()=>changed());
 const value=()=>[...box.querySelectorAll('input:checked')].map(i=>i.value).filter(Boolean);
 const problem=()=>{for(const g of item.option_groups||[]){const n=g.options.filter(o=>value().includes(o.id)).length;if(n<g.min||n>g.max)return g.min===g.max?'Choose '+g.min+' for '+g.name+'.':'Choose '+g.min+' to '+g.max+' for '+g.name+'.';}return null;};
 return {element:box,value,problem};
}
function lineFields(quantity,label,changed){
 const q=el('select',{'aria-label':'Quantity','data-field':'quantity'});for(let i=1;i<=10;i++)q.append(el('option',{value:String(i)},String(i)));q.value=String(quantity);
 const count=el('small',{'data-counter':'label'}),l=el('input',{type:'text','aria-label':'Label on the receipt','data-field':'label',maxlength:'80',placeholder:'Optional, for example who it is for'});
 const show=()=>{count.textContent=points(l.value)+' / '+LABEL_MAX+' characters';count.dataset.over=String(points(l.value)>LABEL_MAX);};
 l.value=label||'';show();l.addEventListener('input',()=>{show();changed();});q.addEventListener('change',()=>changed());
 const element=el('div',{class:'fields'},el('label',{class:'field'},el('span',{},'Quantity'),q),el('label',{class:'field'},el('span',{},'Label on the receipt'),l,count));
 return {element,quantity:()=>Number(q.value),label:()=>l.value.trim()||null,raw:()=>l.value,problem:()=>points(l.value.trim())>LABEL_MAX?'Labels are limited to '+LABEL_MAX+' characters.':null};
}

function restaurantList(ui){
 const address=el('select',{'aria-label':'Deliver to','data-field':'search-address'},...S.account.addresses.map(a=>el('option',{value:a.id},a.label+' — '+a.line1)));
 address.value=S.addressId||'';address.addEventListener('change',()=>choose(ui,{addressId:address.value,restaurantId:null,itemId:null,draft:null}));
 const cuisine=el('select',{'aria-label':'Cuisine','data-field':'search-cuisine'},el('option',{value:''},'All cuisines'),...S.cuisines.map(c=>el('option',{value:c},c[0].toUpperCase()+c.slice(1))));
 cuisine.value=S.cuisine;cuisine.addEventListener('change',()=>choose(ui,{cuisine:cuisine.value}));
 const filters=css(el('div',{class:'fields'},el('label',{class:'field'},el('span',{},'Deliver to'),address),el('label',{class:'field'},el('span',{},'Cuisine'),cuisine)),{padding:'0 22px 14px'});
 if(!ui.has(T.search))return el('div',{},filters,unavailable('Restaurant search'));
 const list=el('div',{'data-list':'restaurants'});
 for(const r of S.restaurants){
  const state=r.status==='paused'?'Paused'+(r.pause_reason?' — '+r.pause_reason:''):r.status==='open'?'Open':'Closed now';
  list.append(row({'data-restaurant-id':r.id,'aria-pressed':String(r.id===S.restaurantId)},ui.has(T.restaurant)?()=>choose(ui,{restaurantId:r.id,itemId:null,draft:null}):null,r.name,
   r.cuisines.join(', ')+' · '+state,'Delivery '+money(r.delivery_fee_cents)+' · about '+r.estimate_minutes+' min · ★ '+r.rating.average.toFixed(1)+' ('+r.rating.count+')'));
 }
 if(!S.restaurants.length)list.append(el('div',{class:'empty'},el('h3',{},'No restaurants found'),el('p',{},searchText()||S.cuisine?'Try a different search or cuisine.':'No restaurant delivers to this address.')));
 const place=S.account.addresses.find(a=>a.id===S.addressId)?.label||'this address';
 const note=S.restaurants.length?css(muted((searchText()||S.cuisine?S.restaurants.length+' matching':S.restaurants.length)+' restaurant'+(S.restaurants.length===1?'':'s')+' deliver'+(S.restaurants.length===1?'s':'')+' to '+place+'.',{'data-delivery-note':'true'}),{padding:'0 22px 10px'}):null;
 return el('div',{},filters,note,list);
}
function statusLine(r){
 if(r.status==='open'){const c=closingTime(r);return 'Open now'+(c==='never'?' · open around the clock':c?' · closes at '+c:'');}
 if(r.status==='paused')return 'Paused'+(r.pause_reason?': '+r.pause_reason:'')+' · you can still schedule a delivery for later';
 const n=nextOpening(r);return 'Closed now'+(n?' · opens '+n:'')+' · you can schedule a delivery for when it is open';
}
function hoursBlock(r){const d=el('details',{'data-hours':r.id},css(el('summary',{},'Opening hours'),{cursor:'pointer',fontSize:'13px',fontWeight:'600',margin:'14px 0 4px'}),...DAYS.map(([k,l])=>metadata(l,hoursOn(r,k))));if(r.status!=='open')d.open=true;return d;}
function dishPanel(ui){
 const item=S.item,draft=S.draft?.item_id===item.id?S.draft:{option_ids:[],quantity:1,label:''},check=local('invalid_option');
 const save=()=>{S.draft={item_id:item.id,option_ids:options.value(),quantity:fields.quantity(),label:fields.raw()};};
 const options=optionEditor(item,draft.option_ids,save),fields=lineFields(draft.quantity,draft.label,save);
 const submit=()=>{
  const problem=options.problem()||fields.problem();check.textContent=problem||'';if(problem)return;
  const args={item_id:item.id,option_ids:options.value(),quantity:fields.quantity(),label:fields.label()},browsing=S.addressId,firstLine=!S.cart.lines.length;save();
  act(ui,'dish',()=>commit(ui,T.add,args,'add '+item.name,r=>{S.flash=said(r,'Added '+item.name+' to your cart.','add '+item.name);S.itemId=null;S.draft=null;S.quote=null;
   if(firstLine){S.checkout.address_id=browsing;S.checkout.rev++;}}));
 };
 const add=button('Add to cart',submit,{class:'primary','data-action':'add-to-cart'});
 const incompatible=S.cart.lines.length&&S.cart.restaurant_id&&S.cart.restaurant_id!==item.restaurant_id;
 const conflict=incompatible&&item.available&&ui.has(T.add)?el('div',{class:'form-actions','data-conflict':'dish'},muted('Your cart has dishes from '+(S.cartRestaurant?.name||'another restaurant')+', and a cart holds one restaurant’s dishes. Clear the cart first, then add this dish.'),
  ui.has(T.remove)?button('Clear cart',()=>clearCart(ui,'dish',item.restaurant_id,shownCart(),async()=>{const it=(await read(ui,T.item,{item_id:item.id}))?.item;return it?.available?null:item.name+' is not available now, so your cart was left as it is.';}),{'data-action':'clear-cart'}):null):null;
 return panel(item.name,el('p',{},item.description),metadata('Price',money(item.price_cents)),metadata('Allergens',allergenText(item.allergens)||'None declared'),
  item.available?null:el('p',{class:'form-error'},'Sold out right now.'),S.restaurant&&S.restaurant.status!=='open'?muted('This restaurant is not taking orders right now; you can add dishes and schedule the delivery for when it is open.'):null,
  options.element,fields.element,check,alertFor('dish'),conflict,
  el('div',{class:'form-actions'},button('Close',()=>{S.itemId=null;S.draft=null;S.error=null;ui.navigate(ui.section).catch(ui.error);}),ui.has(T.add)&&item.available&&!incompatible?add:null));
}
function restaurantView(ui){
 const r=S.restaurant;
 if(!r)return el('div',{class:'empty'},el('h3',{},'Choose a restaurant'),el('p',{},ui.has(T.restaurant)?'Pick a restaurant to see its hours and menu.':'Restaurant details are not allowed by the current policy.'));
 const menu=el('div',{'data-list':'menu'});
 for(const d of S.menu)menu.append(row({'data-item-id':d.id,'aria-pressed':String(d.id===S.itemId)},ui.has(T.item)?()=>choose(ui,{itemId:d.id}):null,
  d.name+' · '+money(d.price_cents),d.description,[d.available?'':'Sold out',allergenText(d.allergens),d.has_options?'Options available':''].filter(Boolean).join(' · ')));
 return el('article',{'data-restaurant':r.id},el('span',{class:'kicker'},r.cuisines.join(' · ')),el('h2',{},r.name),
  el('div',{class:'tags'},tag(r.status==='open'?'Open':r.status==='paused'?'Paused':'Closed now'),tag('★ '+r.rating.average.toFixed(1)+' ('+r.rating.count+')')),
  el('p',{'data-status-line':r.status},statusLine(r)),hoursBlock(r),metadata('Delivery fee',money(r.delivery_fee_cents)),
  S.item?dishPanel(ui):null,css(el('h3',{},'Menu'),{margin:'22px 0 8px'}),ui.has(T.item)?null:el('p',{class:'kicker'},'Dish details and adding to the cart are not allowed by the current policy.'),menu);
}

function cartList(ui){
 if(!ui.has(T.cart))return unavailable('The cart');
 const lines=S.cart.lines;
 if(!lines.length)return el('div',{class:'empty'},el('h3',{},'Your cart is empty'),el('p',{},'Add dishes from a restaurant.'),css(button('Browse restaurants',()=>ui.navigate('restaurants').catch(ui.error)),{marginTop:'14px'}),...[alertFor('cart')].filter(Boolean));
 const box=el('div',{'data-list':'cart'},css(el('p',{class:'kicker'},S.cartRestaurant?.name||S.cart.restaurant_id),{padding:'0 22px'}));
 const setQuantity=(l,q)=>act(ui,'cart',()=>commit(ui,T.update,{line_id:l.id,quantity:q},'change '+l.name+' to '+q,r=>{S.flash=said(r,l.name+': quantity '+q+'.','change '+l.name+' to '+q);S.quote=null;}));
 const remove=l=>act(ui,'cart',()=>commit(ui,T.remove,{line_id:l.id},'remove '+l.name,r=>{S.flash=said(r,'Removed '+l.name+'.','remove '+l.name);S.quote=null;if(S.editLineId===l.id)S.editLineId=null;
  if(!r.duplicate&&ui.has(T.add))S.undo={name:l.name,args:{item_id:l.item_id,option_ids:l.options.map(o=>o.id),quantity:l.quantity,label:l.label||null}};}));
 for(const l of lines){
  const step=ui.has(T.update)?css(el('span',{'aria-label':'Quantity of '+l.name},l.quantity>1||ui.has(T.remove)?button('−',()=>l.quantity>1?setQuantity(l,l.quantity-1):remove(l),{'aria-label':l.quantity>1?'Decrease '+l.name:'Decrease '+l.name+' (removes it)','data-action':'decrease','data-line-id':l.id}):null,
   css(el('strong',{'data-quantity':l.id},String(l.quantity)),{minWidth:'18px',textAlign:'center'}),l.quantity<10?button('+',()=>setQuantity(l,l.quantity+1),{'aria-label':'Increase '+l.name,'data-action':'increase','data-line-id':l.id}):null),{display:'inline-flex',alignItems:'center',gap:'6px',marginRight:'6px'}):null;
  const tools=css(el('div',{class:'actions'},step,ui.has(T.update)&&ui.has(T.item)?button('Edit',()=>choose(ui,{editLineId:l.id,lineDraft:null}),{'aria-label':'Edit '+l.name,'data-action':'edit-line','data-line-id':l.id}):null,
   ui.has(T.remove)?button('Remove',()=>remove(l),{'aria-label':'Remove '+l.name,'data-action':'remove-line','data-line-id':l.id}):null),{marginTop:'10px',alignItems:'center'});
  box.append(css(el('div',{class:'record','data-line-id':l.id},el('span',{class:'record-title'},l.quantity+' × '+l.name+' · '+money(l.subtotal_cents)),
   el('span',{class:'record-subtitle'},lineOptions(l)),l.label?el('span',{class:'record-subtitle','data-label':l.id},'Label: '+l.label):null,
   l.available?null:el('span',{class:'record-subtitle form-error'},'No longer available'),tools),{cursor:'default'}));
 }
 box.append(...[css(el('p',{},'Subtotal ',el('strong',{},money(S.cart.subtotal_cents))),{padding:'14px 22px 0'}),
  S.cart.subtotal_cents<SMALL_ORDER_BELOW_CENTS?css(muted('Orders under '+money(SMALL_ORDER_BELOW_CENTS)+' add a '+money(SMALL_ORDER_FEE_CENTS)+' small-order fee.',{'data-small-order-note':'true'}),{padding:'0 22px'}):null,
  alertFor('cart')].filter(Boolean));
 return box;
}
function lineEditor(ui){
 const line=S.cart.lines.find(l=>l.id===S.editLineId),item=S.editItem,check=local('invalid_option');
 if(!line||!item)return null;
 const draft=S.lineDraft?.line_id===line.id?S.lineDraft:{option_ids:line.options.map(o=>o.id),quantity:line.quantity,label:line.label||''};
 const save=()=>{S.lineDraft={line_id:line.id,option_ids:options.value(),quantity:fields.quantity(),label:fields.raw()};};
 const options=optionEditor(item,draft.option_ids,save),fields=lineFields(draft.quantity,draft.label,save);
 const submit=button('Save changes',()=>{
  const problem=options.problem()||fields.problem();check.textContent=problem||'';if(problem)return;
  const args={line_id:line.id,option_ids:options.value(),quantity:fields.quantity(),label:fields.label()};save();
  act(ui,'line',()=>commit(ui,T.update,args,'change '+line.name,r=>{S.flash=said(r,'Updated '+line.name+'.','change '+line.name);S.editLineId=null;S.lineDraft=null;S.quote=null;}));
 },{class:'primary','data-action':'save-line'});
 return panel('Edit '+line.name,options.element,fields.element,check,alertFor('line'),el('div',{class:'form-actions'},button('Cancel',()=>{S.editLineId=null;S.lineDraft=null;S.error=null;ui.navigate(ui.section).catch(ui.error);}),submit));
}
function addable(item,line){
 if(!item||!item.available)return false;
 const chosen=[...new Set(line.options.map(o=>o.id))],groups=item.option_groups||[],known=new Set(groups.flatMap(g=>g.options.map(o=>o.id)));
 return chosen.every(id=>known.has(id))&&groups.every(g=>{const n=g.options.filter(o=>chosen.includes(o.id)).length;return n>=g.min&&n<=g.max;});
}
const lineKey=l=>JSON.stringify([l.id,l.item_id,(l.options||[]).map(o=>o.id).sort(),l.quantity,l.label??null]);
const shownCart=()=>({restaurant:S.cart.restaurant_id,lines:S.cart.lines.map(lineKey).sort(),epoch:S.version?.epoch});
function clearCart(ui,scope,target,shown,pointless){
 act(ui,scope,async()=>{
  const fresh=await ui.call(T.cart,{});
  if(!fresh.lines.length||fresh.restaurant_id===target){S.flash='Your cart can take this now; nothing was removed.';return;}
  const from=(await read(ui,T.restaurant,{restaurant_id:fresh.restaurant_id}))?.restaurant?.name||'another restaurant';
  const same=fresh.version.epoch===shown.epoch&&fresh.restaurant_id===shown.restaurant&&JSON.stringify(fresh.lines.map(lineKey).sort())===JSON.stringify(shown.lines);
  if(!same){S.flash='Your cart changed meanwhile (it now has '+fresh.lines.map(l=>l.quantity+' × '+l.name).join(', ')+' from '+from+'); nothing was removed. Check it and try again.';return;}
  const reason=await pointless();if(reason){S.flash=reason;return;}
  const names=fresh.lines.map(l=>l.name);
  await runSteps(ui,{label:'clear your cart',version:fresh.version,applied:0,steps:fresh.lines.map(l=>({name:T.remove,args:{line_id:l.id},label:'remove '+l.name,skip:['not_found']})),
   finish:()=>{S.quote=null;S.error=null;S.flash='Cleared your cart: removed '+names.join(', ')+' from '+from+'.';}});
 });
}
const SKIP_REASON={item_unavailable:'sold out',invalid_option:'its options changed',not_found:'no longer on the menu'};
const skipReason=e=>SKIP_REASON[e.code]||String(e.message||e.code).replace(/\.$/,'');
function checkoutHint(){
 const r=S.cartRestaurant,code=S.error?.scope==='checkout'?S.error.code:null;if(!r||!code)return null;
 if(code==='restaurant_closed'){const n=nextOpening(r);return muted(r.name+' is not taking orders now'+(n?'; it opens '+n:'')+'. Choose “Schedule for later” to order for when it is open.',{'data-checkout-hint':code});}
 if(code==='delivery_time_unavailable'){const e=estimateFor(r,S.checkout.address_id);return muted(r.name+' must be open when the order is sent to it'+(e?', about '+e+' minutes before the delivery time':'')+'. Its hours for that day are shown under the date.',{'data-checkout-hint':code});}
 return null;
}
function checkoutArgs(){
 const c=S.checkout;
 if(!/^\d{1,4}(\.\d{1,2})?$/.test(String(c.tip).trim()||'0'))return {error:'Enter a tip in dollars, for example 2.50.'};
 const tip=Math.round(Number(String(c.tip).trim()||'0')*100);
 if(tip>TIP_MAX_CENTS)return {error:'A tip can be at most $1,000.00.'};
 let when={mode:'asap'};
 if(c.mode==='scheduled'){const z=zonedIso(c.date,c.time,zone());if(z.error)return {error:z.error};when={mode:'scheduled',delivery_at:z.iso};}
 return {args:{address_id:c.address_id,card_id:c.card_id,when,tip_cents:tip}};
}
function placed(r){S.quote=null;S.orderId=r.order_id;Object.assign(S.checkout,{mode:'asap',tip:'0.00',slotEdited:false,rev:S.checkout.rev+1});S.cancelQuote=null;S.panel=null;S.goto='orders';S.flash=r.duplicate?'Order '+r.order_id+' was already placed; it was not placed or charged again.':'Order '+r.order_id+' placed.';}
async function place(ui,args){
 try{await commit(ui,T.place,args,'place this order',placed);}
 catch(e){S.quote=null;throw e;}
}
function whenText(w){return w.mode==='asap'?'As soon as possible':zoned(w.delivery_at);}
function quoteView(ui){
 const q=S.quote.result,a=S.quote.args;
 return panel('Order total',el('div',{'data-quote-for':a.address_id+' '+a.card_id},metadata('Deliver to',addressName(a.address_id)),metadata('Pay with',cardName(a.card_id)),metadata('When',whenText(a.when))),
  q.lines.map(l=>el('div',{class:'metadata-line','data-quote-line':l.id},el('span',{},l.quantity+' × '+l.name+(l.label?' ('+l.label+')':'')),el('strong',{},money(l.subtotal_cents)))),
  el('div',{class:'metadata-line','data-fee':'delivery'},el('span',{},'Delivery fee'),el('strong',{},money(q.fees.delivery_cents))),
  el('div',{class:'metadata-line','data-fee':'service'},el('span',{},'Service fee'),el('strong',{},money(q.fees.service_cents))),
  q.fees.small_order_cents?el('div',{class:'metadata-line','data-fee':'small_order'},el('span',{},'Small-order fee'),el('strong',{},money(q.fees.small_order_cents))):null,
  el('div',{class:'metadata-line','data-fee':'tax'},el('span',{},'Tax'),el('strong',{},money(q.tax_cents))),
  el('div',{class:'metadata-line','data-fee':'tip'},el('span',{},'Tip'),el('strong',{},money(q.tip_cents))),
  el('div',{class:'metadata-line','data-total':String(q.total_cents)},el('span',{},'Total'),el('strong',{},money(q.total_cents))),
  q.mode==='asap'?el('div',{class:'metadata-line','data-estimate':q.estimated_delivery_at},el('span',{},'Estimated delivery'),el('strong',{},clock(q.estimated_delivery_at)+' (about '+q.estimate_minutes+' min)'))
   :el('div',{class:'metadata-line','data-delivery':q.delivery_at},el('span',{},'Scheduled delivery'),el('strong',{},zoned(q.delivery_at))),
  q.release_at?el('div',{class:'metadata-line','data-release':q.release_at},el('span',{},'Sent to the restaurant'),el('strong',{},zoned(q.release_at))):null,
  el('div',{class:'form-actions'},ui.has(T.place)?button('Place order · '+money(q.total_cents),()=>act(ui,'checkout',()=>place(ui,S.quote.args)),{class:'primary','data-action':'place-order'}):null));
}
function unknownBanner(ui){
 const u=S.unknown;
 return css(panel('Waiting for Plateway',el('p',{},'Plateway did not confirm the request to '+u.label+' ('+u.reason+'), so it may or may not have taken effect. Retry sends exactly the same request again: it takes effect at most once, and the page then says which happened. Other changes wait until this is settled.'),
  alertFor('unknown'),el('div',{class:'form-actions'},button('Dismiss',()=>{if(S.busy)return;S.unknown=null;S.error=null;ui.navigate(ui.section).catch(ui.error);},{'data-action':'dismiss-unknown'}),
   ui.has(u.name)?button('Retry',()=>act(ui,'unknown',()=>retryUnknown(ui),true),{class:'primary','data-action':'retry-unknown'}):el('p',{},'This operation is no longer allowed by the current policy; check the cart and Orders, then dismiss.'))),{margin:'18px 24px 0'});
}
function checkoutView(ui){
 if(!ui.has(T.cart))return el('article',{},unavailable('The cart'));
 const c=S.checkout,quoteBox=S.quote?quoteView(ui):null,check=local('invalid_arguments');
 const invalidate=()=>{c.rev++;if(S.quote){S.quote=null;quoteBox?.remove();}};
 const address=el('select',{'aria-label':'Deliver to','data-field':'address_id'},...S.account.addresses.map(a=>el('option',{value:a.id},a.label+' — '+a.line1)));address.value=c.address_id||'';
 address.addEventListener('change',()=>{c.address_id=address.value;invalidate();});
 const card=el('select',{'aria-label':'Pay with','data-field':'card_id'},...S.account.cards.map(k=>el('option',{value:k.id,disabled:expired(k)?'':false},k.brand+' '+k.masked_number+(expired(k)?' · expired '+String(k.exp_month).padStart(2,'0')+'/'+k.exp_year:' · expires '+String(k.exp_month).padStart(2,'0')+'/'+k.exp_year))));card.value=c.card_id||'';
 card.addEventListener('change',()=>{c.card_id=card.value;invalidate();});
 const asap=el('input',{type:'radio',name:'when',value:'asap','data-field':'when-asap','aria-label':'As soon as possible'}),later=el('input',{type:'radio',name:'when',value:'scheduled','data-field':'when-scheduled','aria-label':'Schedule for later'});
 asap.checked=c.mode==='asap';later.checked=c.mode==='scheduled';
 const date=el('input',{type:'date','aria-label':'Delivery date','data-field':'delivery-date'}),time=el('input',{type:'time',step:'900','aria-label':'Delivery time','data-field':'delivery-time'});
 date.value=c.date;time.value=c.time;
 const hoursHint=el('small',{'data-hours-hint':'true'});
 const showHours=()=>{const r=S.cartRestaurant,ok=/^\d{4}-\d{2}-\d{2}$/.test(c.date);if(!r||!ok){hoursHint.textContent='';return;}const [y,m,d]=c.date.split('-').map(Number),dow=new Date(Date.UTC(y,m-1,d)).getUTCDay();hoursHint.textContent=r.name+' on '+DAY_NAMES[dow]+': '+hoursOn(r,DAY_KEYS[dow])+'. The restaurant must be open when the order is sent to it, shortly before the delivery time.';};showHours();
 const slot=el('div',{class:'fields'},el('label',{class:'field'},el('span',{},'Delivery date'),date,hoursHint),el('label',{class:'field'},el('span',{},'Delivery time ('+zoneName()+')'),time,el('small',{},'15-minute steps, 45 minutes to 7 days ahead.')));
 const showSlot=()=>css(slot,{display:c.mode==='scheduled'?'':'none'});showSlot();
 const suggest=()=>{if(c.mode!=='scheduled'||c.slotEdited||!S.cartRestaurant)return;const f=firstSlot(S.cartRestaurant,c.address_id);if(f){c.date=f.date;c.time=f.time;date.value=f.date;time.value=f.time;showHours();}};
 for(const r of [asap,later])r.addEventListener('change',()=>{c.mode=later.checked?'scheduled':'asap';suggest();showSlot();invalidate();});
 date.addEventListener('input',()=>{c.date=date.value;c.slotEdited=true;showHours();invalidate();});time.addEventListener('input',()=>{c.time=time.value;c.slotEdited=true;invalidate();});
 address.addEventListener('change',suggest);suggest();
 const tip=el('input',{type:'text',inputmode:'decimal','aria-label':'Tip in dollars','data-field':'tip'});tip.value=c.tip;
 tip.addEventListener('input',()=>{c.tip=tip.value;invalidate();});
 const preview=ui.has(T.preview)&&S.cart.lines.length?button('Preview total',()=>{
  const built=checkoutArgs();check.textContent=built.error||'';if(built.error)return;
  const rev=c.rev;
  act(ui,'checkout',async()=>{
   const r=await ui.call(T.preview,built.args);
   if(rev!==c.rev){S.error={scope:'checkout',code:'details_changed',message:'The checkout details changed while the total was being prepared. Preview again.'};return;}
   S.quote={args:{...built.args,token:r.token},result:r};
  });
 },{class:'primary','data-action':'preview'}):null;
 const whenSet=group('When');whenSet.append(choiceLabel(asap,'As soon as possible'),choiceLabel(later,'Schedule for later'),slot);
 const editing=S.editLineId&&S.editItem&&ui.has(T.update)?css(lineEditor(ui),{margin:'0 0 24px'}):null;
 return el('article',{'data-view':'checkout'},editing,el('h2',{},'Checkout'),
  S.cart.lines.length?css(el('div',{class:'fields'},el('label',{class:'field'},el('span',{},'Deliver to'),address),el('label',{class:'field'},el('span',{},'Pay with'),card),whenSet,
   el('label',{class:'field'},el('span',{},'Tip ($)'),tip)),{marginTop:'18px'}):el('p',{},'Your cart is empty.'),
  check,alertFor('checkout'),checkoutHint(),S.cart.lines.length&&!ui.has(T.preview)?el('p',{class:'kicker','data-unavailable':'true'},'Previewing a total is not allowed by the current policy, so orders cannot be placed here.'):null,el('div',{class:'form-actions'},preview),quoteBox);
}

function orderList(ui){
 if(!ui.has(T.orders))return unavailable('Order history');
 const text=searchText().toLowerCase(),shown=S.orders.filter(o=>!text||o.restaurant_name.toLowerCase().includes(text)||o.id.toLowerCase()===text);
 const groups=[['Active',o=>['submitted','preparing','picked_up'].includes(o.status)],['Scheduled',o=>o.status==='scheduled'],['Past',o=>['delivered','cancelled'].includes(o.status)]];
 const box=el('div',{'data-list':'orders'});
 for(const [label,test] of groups){
  const items=shown.filter(test);if(!items.length)continue;
  box.append(css(el('p',{class:'kicker'},label),{padding:'12px 22px 0'}));
  for(const o of items)box.append(row({'data-order-id':o.id,'aria-pressed':String(o.id===S.orderId)},()=>choose(ui,{orderId:o.id,cancelQuote:null,panel:null}),
   o.restaurant_name+' · '+money(o.total_cents),o.status==='scheduled'?'Scheduled for '+when(o.delivery_at):o.status==='delivered'?'Delivered '+when(o.delivered_at):o.status==='cancelled'?'Cancelled · placed '+when(o.placed_at):STATUS[o.status]+' · arriving about '+clock(o.estimated_delivery_at),
   o.refunded_cents?'Refunded '+money(o.refunded_cents):null));
 }
 if(!shown.length)box.append(el('div',{class:'empty'},el('h3',{},'No orders'),el('p',{},text?'Try a different search.':'Orders you place appear here.')));
 return box;
}
function cancelPanel(ui){
 const q=S.cancelQuote.result;
 return panel('Cancel this order?',metadata('Charged',money(q.charge_cents)),q.prior_refunds_cents?metadata('Already refunded',money(q.prior_refunds_cents)):null,
  el('div',{class:'metadata-line','data-refund':String(q.refund_cents)},el('span',{},'Refund now'),el('strong',{},money(q.refund_cents)+' to '+cardName(q.refund_card_id))),
  el('div',{class:'metadata-line','data-kept':String(q.kept_cents)},el('span',{},'Kept by the restaurant'),el('strong',{},money(q.kept_cents))),
  q.kept_cents?el('p',{},'The restaurant is already preparing this order, so only the delivery fee and tip are refunded.'):null,
  alertFor('cancel'),el('div',{class:'form-actions'},button('Keep order',()=>{S.cancelQuote=null;S.error=null;ui.navigate(ui.section).catch(ui.error);},{'data-action':'keep-order'}),
   ui.has(T.cancel)?button('Confirm cancellation',()=>act(ui,'cancel',async()=>{
    try{await commit(ui,T.cancel,{order_id:q.order_id,token:q.token},'cancel order '+q.order_id,r=>{S.flash=said(r,'Order '+q.order_id+' cancelled; '+money(q.refund_cents)+' refunded to '+cardName(q.refund_card_id)+'.','cancel order '+q.order_id);S.cancelQuote=null;});}
    catch(e){S.cancelQuote=null;throw e;}
   }),{class:'primary','data-action':'confirm-cancel'}):null));
}
function reportPanel(ui){
 const o=S.order,open=o.lines.filter(l=>!l.removed&&!l.report),draft=S.reportDraft?.order_id===o.id?S.reportDraft.lines:[],check=local('invalid_arguments');
 const rows=open.map(l=>{
  const prior=draft.find(d=>d.line_id===l.id),pick=el('input',{type:'checkbox',value:l.id,'data-report-line':l.id,'aria-label':'Report '+l.name});pick.checked=!!prior;
  const kind=el('select',{'aria-label':'Problem with '+l.name,'data-report-kind':l.id},el('option',{value:'missing'},'Missing'),el('option',{value:'wrong'},'Wrong item'));kind.value=prior?.kind||'missing';
  return {line:l,pick,kind,element:css(el('div',{},choiceLabel(pick,l.quantity+' × '+l.name+' · refund '+money(l.subtotal_cents+l.tax_cents)+' incl. tax'),kind),{display:'grid',gap:'6px',padding:'6px 0'})};
 });
 const chosen=()=>rows.filter(r=>r.pick.checked).map(r=>({line_id:r.line.id,kind:r.kind.value}));
 const save=()=>{S.reportDraft={order_id:o.id,lines:chosen()};};
 for(const r of rows){r.pick.addEventListener('change',save);r.kind.addEventListener('change',save);}
 const send=button('Send report',()=>{
  const lines=chosen();check.textContent=lines.length?'':'Choose at least one item.';if(!lines.length)return;save();
  act(ui,'report',()=>commit(ui,T.report,{order_id:o.id,lines},'report a problem with order '+o.id,r=>{S.flash=said(r,'Report sent; refunds go to '+cardName(o.card_id)+'.','report a problem with order '+o.id);S.panel=null;S.reportDraft=null;}));
 },{class:'primary','data-action':'send-report'});
 return panel('Report a problem',el('p',{},'Missing or wrong items reported within 48 hours of delivery are refunded in full to the original card.'),rows.map(r=>r.element),check,alertFor('report'),
  el('div',{class:'form-actions'},button('Close',()=>{S.panel=null;S.reportDraft=null;S.error=null;ui.navigate(ui.section).catch(ui.error);}),send));
}
function ratePanel(ui){
 const o=S.order,draft=S.rateDraft?.order_id===o.id?S.rateDraft:{stars:null,text:''},check=local('invalid_arguments'),stars=el('div',{role:'radiogroup','aria-label':'Stars'});
 for(let i=5;i>=1;i--){const input=el('input',{type:'radio',name:'stars',value:String(i),'data-stars':String(i),'aria-label':i+' star'+(i===1?'':'s')});input.checked=draft.stars===i;stars.append(choiceLabel(input,'★'.repeat(i)));}
 const count=el('small',{}),text=el('textarea',{rows:'3','aria-label':'Comment','data-field':'rating-text',maxlength:'2000'});text.value=draft.text;
 const save=()=>{const s=stars.querySelector('input:checked');S.rateDraft={order_id:o.id,stars:s?Number(s.value):null,text:text.value};};
 const show=()=>{count.textContent=points(text.value)+' / '+RATING_TEXT_MAX+' characters';};show();
 text.addEventListener('input',()=>{show();save();});stars.addEventListener('change',save);
 const send=button('Submit rating',()=>{
  const chosen=stars.querySelector('input:checked'),comment=text.value.trim();
  const problem=!chosen?'Choose 1 to 5 stars.':points(comment)>RATING_TEXT_MAX?'Comments are limited to '+RATING_TEXT_MAX+' characters.':null;check.textContent=problem||'';if(problem)return;
  save();
  act(ui,'rate',()=>commit(ui,T.rate,{order_id:o.id,stars:Number(chosen.value),...(comment?{text:comment}:{})},'rate order '+o.id,r=>{S.flash=said(r,'Thanks for rating this order.','rate order '+o.id);S.panel=null;S.rateDraft=null;}));
 },{class:'primary','data-action':'send-rating'});
 return panel('Rate this order',stars,el('label',{class:'field'},el('span',{},'Comment (optional)'),text,count),check,alertFor('rate'),
  el('div',{class:'form-actions'},button('Close',()=>{S.panel=null;S.rateDraft=null;S.error=null;ui.navigate(ui.section).catch(ui.error);}),send));
}
function openPanel(ui,kind){S.panel={kind,order_id:S.order.id};S.cancelQuote=null;S.error=null;S.flash=null;ui.navigate(ui.section).catch(ui.error);}
function reorder(ui,o){
 const keep=S.account.addresses.some(a=>a.id===o.address_id)?o.address_id:null;
 act(ui,'order',()=>runSteps(ui,{label:'reorder '+o.id,version:S.version,applied:0,added:[],skipped:[],steps:o.lines.filter(x=>!x.removed).map(l=>({name:T.add,args:{item_id:l.item_id,option_ids:[...new Set(l.options.map(x=>x.id))],quantity:l.quantity,label:l.label||null},label:'add '+l.name+' from order '+o.id,
   skip:['item_unavailable','invalid_option','invalid_arguments','not_found'],done:(r,p)=>p.added.push(l.name),skipped:(e,p)=>p.skipped.push(l.name+' ('+skipReason(e)+')')})),
  finish:p=>{
   S.quote=null;
   S.flash=p.added.length?'Added '+p.added.length+' item'+(p.added.length===1?'':'s')+' from order '+o.id+' to your cart'+(p.skipped.length?'; not added: '+p.skipped.join(', '):'')+'.':'None of the items from order '+o.id+' could be added now: '+p.skipped.join(', ')+'.';
   if(p.added.length){S.goto='cart';if(keep){S.checkout.address_id=keep;S.checkout.rev++;}}
  }}));
}
function orderView(ui){
 if(!ui.has(T.orders))return el('article',{},unavailable('Order history'));
 const o=S.order;
 if(!o)return el('div',{class:'empty'},el('h3',{},'No order selected'),el('p',{},ui.has(T.order)?'Your orders appear here once placed.':'Order details are not allowed by the current policy.'));
 const actions=css(el('div',{class:'actions'}),{alignItems:'center'}),open=S.panel?.order_id===o.id?S.panel.kind:null,notes=[];
 const now=Date.parse(S.account.now),delivered=o.delivered_at?Date.parse(o.delivered_at):null,reportUntil=delivered&&delivered+48*3600000,rateUntil=delivered&&delivered+30*86400000;
 if(['scheduled','submitted','preparing'].includes(o.status)&&ui.has(T.cancelPreview))actions.append(button('Cancel order',()=>act(ui,'cancel',async()=>{S.panel=null;const r=await ui.call(T.cancelPreview,{order_id:o.id});S.cancelQuote={order_id:o.id,result:r};}),{'data-action':'cancel-order'}));
 if(o.status==='delivered'&&ui.has(T.report)&&o.lines.some(l=>!l.removed&&!l.report)){
  if(now<=reportUntil)actions.append(button('Report a problem',()=>openPanel(ui,'report'),{'data-action':'report-issue'}));
  else notes.push(muted('Problems could be reported until '+when(new Date(reportUntil).toISOString())+' (48 hours after delivery).',{'data-report-closed':'true'}));
 }
 if(o.status==='delivered'&&!o.rating&&ui.has(T.rate)){
  if(now<=rateUntil)actions.append(button('Rate order',()=>openPanel(ui,'rate'),{'data-action':'rate-order'}));
  else notes.push(muted('Ratings closed '+when(new Date(rateUntil).toISOString())+' (30 days after delivery).',{'data-rate-closed':'true'}));
 }
 const reorderable=['delivered','cancelled'].includes(o.status)&&ui.has(T.add)&&o.lines.some(l=>!l.removed);
 if(reorderable&&!(S.cart.lines.length&&S.cart.restaurant_id&&S.cart.restaurant_id!==o.restaurant_id))actions.append(button('Reorder',()=>reorder(ui,o),{'data-action':'reorder'}));
 const conflict=reorderable&&S.cart.lines.length&&S.cart.restaurant_id&&S.cart.restaurant_id!==o.restaurant_id?el('div',{class:'form-actions','data-conflict':'order'},muted('Your cart has dishes from '+(S.cartRestaurant?.name||'another restaurant')+', and a cart holds one restaurant’s dishes. Clear the cart first, then reorder.'),
  ui.has(T.remove)&&ui.has(T.item)?button('Clear cart',()=>clearCart(ui,'order',o.restaurant_id,shownCart(),async()=>{
   if(!ui.has(T.item))return 'The page cannot check the dishes of order '+o.id+' right now, so your cart was left as it is.';
   for(const l of o.lines.filter(x=>!x.removed))if(addable((await read(ui,T.item,{item_id:l.item_id}))?.item,l))return null;
   return 'None of the dishes from order '+o.id+' can be added now, so your cart was left as it is.';}),{'data-action':'clear-cart'}):null):null;
 const lines=o.lines.map(l=>css(el('div',{'data-order-line':l.id},el('strong',{},l.quantity+' × '+l.name+' · '+money(l.subtotal_cents)),el('small',{},lineOptions(l)),l.label?el('small',{},'Label: '+l.label):null,
  l.removed?el('small',{class:'form-error'},'Removed: '+String(l.removed_reason||'unavailable').replace(/_/g,' ')+(l.removed_at?' at '+clock(l.removed_at):'')):null,
  l.report?el('small',{'data-reported':l.report.kind},'Reported '+l.report.kind+' '+when(l.report.at)):null),{display:'grid',gap:'2px',padding:'8px 0',borderBottom:'1px solid var(--line)'}));
 const heading=text=>css(el('h3',{},text),{margin:'22px 0 4px'});
 const refunded=o.refunded_cents||o.refunds.reduce((n,r)=>n+r.amount_cents,0);
 const refundLabel=r=>(REFUND_REASON[r.reason]||String(r.reason).replace(/_/g,' '))+(r.line_id?': '+(o.lines.find(l=>l.id===r.line_id)?.name||'item'):'');
 return el('article',{'data-order':o.id,'data-status':o.status},muted('Order '+o.id),el('h2',{},o.restaurant_name),
  el('div',{class:'tags'},el('span',{class:'tag','data-order-status':o.status},STATUS[o.status]),o.mode==='scheduled'?tag('Scheduled delivery'):null),
  actions,notes,alertFor('order'),conflict,S.cancelQuote?cancelPanel(ui):alertFor('cancel'),open==='report'&&ui.has(T.report)&&now<=reportUntil?reportPanel(ui):alertFor('report'),open==='rate'&&ui.has(T.rate)&&now<=rateUntil?ratePanel(ui):alertFor('rate'),
  metadata('Placed',when(o.placed_at)),o.delivery_at?metadata('Scheduled for',when(o.delivery_at)):null,o.release_at&&o.status==='scheduled'?metadata('Sent to the restaurant',when(o.release_at)):null,
  !o.delivered_at&&o.status!=='cancelled'?metadata('Estimated delivery',when(o.estimated_delivery_at)):null,o.delivered_at?metadata('Delivered',when(o.delivered_at)):null,
  metadata('Deliver to',addressName(o.address_id)),metadata('Paid with',cardName(o.card_id)),
  heading('Items'),lines,
  heading('Receipt'),metadata('Subtotal',money(o.subtotal_cents)),metadata('Delivery fee',money(o.fees.delivery_cents)),metadata('Service fee',money(o.fees.service_cents)),
  o.fees.small_order_cents?metadata('Small-order fee',money(o.fees.small_order_cents)):null,metadata('Tax',money(o.tax_cents)),metadata('Tip',money(o.tip_cents)),metadata('Total charged',money(o.total_cents)),
  refunded?metadata('Refunded',money(refunded)):null,refunded?el('div',{class:'metadata-line','data-net':String(o.total_cents-refunded)},el('span',{},'Net charge'),el('strong',{},money(o.total_cents-refunded))):null,
  o.refunds.length?heading('Refunds'):null,o.refunds.map(r=>metadata(when(r.at),money(r.amount_cents)+' · '+refundLabel(r))),
  o.cancellation?metadata('Cancelled',when(o.cancellation.at)+' · '+reasonText(o.cancellation.reason)):null,
  o.rating?metadata('Your rating','★'.repeat(o.rating.stars)+(o.rating.text?' · '+o.rating.text:'')):null,
  heading('Timeline'),o.timeline.map(t=>metadata(when(t.at),noteText(o,t.note))));
}

function accountList(){
 const a=S.account;
 return el('div',{'data-list':'account'},css(el('div',{},el('span',{class:'record-title'},a.holder.name),el('span',{class:'record-subtitle'},'Times shown in '+zoneName()+' ('+a.time_zone+') · now '+when(a.now))),{padding:'0 22px 14px'}),
  ...a.addresses.map(x=>el('div',{class:'record','data-address-id':x.id},el('span',{class:'record-title'},x.label),el('span',{class:'record-subtitle'},x.line1))));
}
function accountView(){
 return el('article',{},el('h2',{},'Payment cards'),...S.account.cards.map(c=>metadata(c.brand+' '+c.masked_number,(expired(c)?'Expired ':'Expires ')+String(c.exp_month).padStart(2,'0')+'/'+c.exp_year)),
  css(el('p',{class:'kicker'},'Card numbers are masked; Plateway never shows a full card number.'),{marginTop:'18px'}));
}

mount({
 id:'plateway',title:'Plateway',symbol:'◒',searchLabel:'Search restaurants, dishes or orders',initialSection:'restaurants',
 list:T.account,collection:'none',get:T.account,item:'holder',heading:x=>x?.name||'Plateway',actions:[],load,
 sections:()=>[{id:'restaurants',label:'Restaurants',symbol:'◍',count:false},{id:'cart',label:'Cart'+(S.cart?.lines.length?' ('+S.cart.lines.reduce((n,l)=>n+l.quantity,0)+')':''),symbol:'▤',count:false},{id:'orders',label:'Orders',symbol:'≡',count:false},{id:'account',label:'Account',symbol:'◉',count:false}],
 renderList:(shown,ui)=>{const badge=document.querySelector('.collection-count');if(badge)css(badge,{display:'none'});const nav=document.querySelector('.sidebar nav');if(nav)css(nav,{flexWrap:'wrap'});if(!S.account)return el('div');return ui.section==='cart'?cartList(ui):ui.section==='orders'?orderList(ui):ui.section==='account'?accountList():restaurantList(ui);},
 emptyView:ui=>{if(!S.account)return el('div',{class:'empty'},el('h3',{},'Loading…'));const view=ui.section==='cart'?checkoutView(ui):ui.section==='orders'?orderView(ui):ui.section==='account'?accountView():restaurantView(ui);
  return el('div',{},S.unknown?unknownBanner(ui):null,!S.unknown&&S.error?.scope==='unknown'?css(alertFor('unknown'),{margin:'18px 24px 0'}):null,S.flash&&S.flashSection===ui.section?css(el('div',{},flash(),S.undo&&ui.section==='cart'?button('Undo',()=>{const u=S.undo;act(ui,'undo',()=>commit(ui,T.add,u.args,'put '+u.name+' back',r=>{S.undo=null;S.quote=null;S.flash=said(r,'Put '+u.name+' back in your cart.','put '+u.name+' back');}));},{'data-action':'undo-remove','aria-label':'Undo removing '+S.undo.name}):null),{margin:'18px 24px 0',display:'flex',gap:'12px',alignItems:'center',flexWrap:'wrap'}):null,alertFor('undo'),view);}
});
const status=document.getElementById('status');
if(status)new MutationObserver(()=>{if(S.busy&&status.textContent!=='Working…')queueMicrotask(lock);}).observe(status,{childList:true,characterData:true,subtree:true});
