import {mount,el,time,tag,textBlock,metadata} from '/shared/client.js';
// App-owned interaction catalog and presentation. The Host connects as the Agent, so every
// action here is an Agent tool. Sold seats, schedule changes and expiries arrive from Infra.
const points=n=>Number(n).toLocaleString('en-US')+' pts';
const money=c=>(c<0?'−$':'$')+(Math.abs(c)/100).toFixed(2);
const route=t=>t.flights[0].origin+' → '+t.flights.at(-1).dest;
const openChange=t=>t.status==='ticketed'&&t.change?.status==='open';
const statusLabel=t=>t.status==='cancelled'?'Cancelled':openChange(t)?'Schedule change':'Ticketed';
// Flight times are shown as the airport's own wall clock with its UTC offset, never converted to the
// viewer's time zone, so "HND 17:30" means 17:30 in Tokyo wherever the page is opened.
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const localTime=iso=>{const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.exec(String(iso||''));
 return m?MONTHS[+m[2]-1]+' '+(+m[3])+', '+m[4]+':'+m[5]+' (UTC'+(m[6]==='Z'?'+00:00':m[6])+')':time(iso);};
const leg=f=>f.flight_number+' '+f.origin+' '+localTime(f.departs_at)+' → '+f.dest+' '+localTime(f.arrives_at);
// Book award's optional seats: one "flight_id passenger_id seat" per line, sent as skyline.book seat objects.
export const seatLines=text=>text.split('\n').map(x=>x.trim()).filter(Boolean).map(line=>{
 const parts=line.split(/[\s,]+/);
 if(parts.length!==3)throw Error('Each seat line needs a flight ID, a passenger ID and a seat, for example PC12-2027-10-21 pax-daniel 3A.');
 const [flight_id,passenger_id,seat]=parts;return {flight_id,passenger_id,seat:seat.toUpperCase()};
});
export const config={
 id:'skyline',title:'Skyline Miles',description:'Award flights, trips and points for this member.',
 list:'skyline.trips',collection:'trips',listArgs:{},get:'skyline.trips',item:'trip',
 heading:t=>route(t)+' · '+t.locator,subtitle:t=>statusLabel(t)+' · '+localTime(t.flights[0].departs_at),
 labels:{option_id:'Option ID (from Search awards)',passenger_ids:'Passengers',payment_label:'Pay taxes and fees with',dest:'Destination',pax:'Passengers'},
 actions:[
  {label:'Search awards',tool:'skyline.search',success:'Search finished.'},
  {label:'Book award',tool:'skyline.book',primary:true,success:'Award ticketed.'},
  {label:'Manage trip',tool:'skyline.manage',hidden:true}
 ]
};

async function manage(ui,args){try{await ui.perform('skyline.manage',args);}catch(e){ui.error(e);}}
function seatPicker(t,f,ui){
 const selects=t.passenger_ids.map(p=>{
  const current=t.seats.find(s=>s.flight_id===f.flight_id&&s.passenger_id===p).seat;
  const s=el('select',{'aria-label':'Seat for '+p+' on '+f.flight_number,disabled:t.status!=='ticketed'});
  for(const seat of [current,...f.free_seats])s.append(el('option',{value:seat},seat));
  return {p,current,s};
 });
 const save=el('button',{type:'button',disabled:t.status!=='ticketed'||!ui.has('skyline.manage')},'Save seats');
 save.addEventListener('click',()=>{const seats=selects.filter(x=>x.s.value!==x.current).map(x=>({flight_id:f.flight_id,passenger_id:x.p,seat:x.s.value}));
  if(seats.length)manage(ui,{booking_id:t.id,action:'change_seats',seats});});
 return el('div',{class:'metadata-line'},el('span',{},leg(f)),el('div',{},...selects.map(x=>el('label',{},x.p.replace(/^pax-/,'')+' ',x.s)),save),
  el('small',{},f.adjacent_pairs.length?'Free pairs: '+f.adjacent_pairs.map(x=>x.join('/')).join(', '):'No free pair of seats'));
}
function changeBox(t,ui){
 const ch=t.change;if(!ch)return null;
 const box=el('section',{class:'query-result'},el('h3',{},'Schedule change ('+ch.reason.replace('_',' ')+') · '+ch.status),
  metadata('Choose by',localTime(ch.deadline)));
 for(const a of ch.alternatives){
  const accept=el('button',{type:'button',disabled:!openChange(t)||!ui.has('skyline.manage')},'Accept '+a.id);
  accept.addEventListener('click',()=>manage(ui,{booking_id:t.id,action:'accept_alternative',alternative_id:a.id}));
  box.append(el('div',{class:'metadata-line'},el('span',{},a.flight_ids.join(' + ')),accept));
 }
 return box;
}
function ledgerRow(e){return el('article',{class:'record'},el('span',{class:'record-title'},(e.points>0?'+':'')+points(e.points)+' · '+e.kind.replace('_',' ')),
 el('span',{class:'record-subtitle'},time(e.at)+' · balance '+points(e.balance_after)));}
function noticeRow(n){return el('article',{class:'record'},el('span',{class:'record-title'},n.title),el('span',{class:'record-subtitle'},time(n.created_at)),el('small',{},n.body));}
Object.assign(config,{
 symbol:'✈',searchLabel:'Search trips',initialSection:'upcoming',
 load:async ui=>({
  account:ui.has('skyline.balance')?await ui.call('skyline.balance',{}):null,
  notices:ui.has('skyline.notices.list')?(await ui.call('skyline.notices.list',{})).notices:[]
 }),
 sections:()=>[
  {id:'upcoming',label:'Trips',symbol:'✈',filter:t=>t.status==='ticketed'},
  {id:'changes',label:'Schedule changes',symbol:'!',filter:openChange},
  {id:'cancelled',label:'Cancelled',symbol:'×',filter:t=>t.status==='cancelled'},
  {id:'points',label:'Points',symbol:'◎',filter:()=>false,count:false},
  {id:'notices',label:'Notices',symbol:'✉',filter:()=>false,count:false}
 ],
 renderList:(items,ui)=>{
  const a=ui.aux.account;
  if(ui.section==='points')return el('div',{},a?el('p',{class:'kicker'},a.member_number+' · '+points(a.balance)):null,...(a?.ledger||[]).slice().reverse().map(ledgerRow));
  if(ui.section==='notices')return el('div',{},...(ui.aux.notices||[]).slice().reverse().map(noticeRow));
  return el('div',{},...items.map(t=>ui.record(t,el('span',{class:'record-title'},config.heading(t)),el('span',{class:'record-subtitle'},config.subtitle(t)))));
 },
 view:(t,ui)=>{
  const cancel=el('button',{type:'button',disabled:t.status!=='ticketed'||!ui.has('skyline.manage')},'Cancel trip');
  cancel.addEventListener('click',()=>manage(ui,{booking_id:t.id,action:'cancel'}));
  return el('article',{},el('span',{class:'kicker'},statusLabel(t)),el('h2',{},route(t)+' · '+t.locator),
   el('div',{class:'tags'},tag(t.cabin),tag(t.passenger_ids.length+' passenger'+(t.passenger_ids.length===1?'':'s'))),
   metadata('Points',points(t.points)),metadata('Partner fee and taxes',money(t.partner_fee_cents+t.taxes_cents)+' to '+t.payment_label),
   ...t.flights.map(f=>seatPicker(t,f,ui)),changeBox(t,ui),textBlock(t.status==='ticketed'?'Cancelling refunds points and taxes; the partner fee is kept unless a schedule change is open.':''),cancel);
 },
 field:(name,ui)=>{
  const a=ui.aux.account;
  if(name==='passenger_ids'&&a)return {options:a.passengers.map(p=>({value:p.id,label:p.name}))};
  if(name==='payment_label'&&a)return {options:a.payment_labels.map(l=>({value:l,label:l}))};
  if(name==='seats')return {placeholder:'PC12-2027-10-21 pax-daniel 3A',parse:seatLines,
   help:'One seat per line: flight ID, passenger ID and seat. Leave empty for the first free seats (they may not sit together); choose seats later on the trip.'};
  if(name==='date')return {placeholder:'YYYY-MM-DD',help:'Local date of the first departure.'};
  return {};
 },
 emptyView:ui=>el('div',{class:'empty'},ui.aux.account?el('p',{class:'kicker'},points(ui.aux.account.balance)):null,el('h3',{},'No trip selected'),
  el('p',{},'Search awards, copy an option ID, then book it for named passengers.')),
 sectionAfter:tool=>tool==='skyline.book'?'upcoming':null
});
mount(config);
