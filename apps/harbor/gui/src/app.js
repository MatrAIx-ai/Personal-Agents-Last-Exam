import {mount,el,date,tag,textBlock,metadata} from '/shared/client.js';
// App-owned interaction catalog and presentation. The Host only supplies an Agent connection,
// so category changes, expiry and transfers in (Infra events) are shown but not triggered here.
const statusLabel={confirmed:'Confirmed',cancelled:'Cancelled'};
const methodLabel={points:'Points',certificate:'Free-night certificate',points_cash:'Points + Cash',cash:'Cash'};
// Reservations carry the hotel ID only; the label is derived from it (Search shows full names).
const hotelName=id=>String(id).replace(/^hotel-/,'').split('-').map(w=>w[0].toUpperCase()+w.slice(1)).join(' ');
const points=n=>String(n).replace(/\B(?=(\d{3})+(?!\d))/g,',')+' pts';
const usd=c=>'USD '+(c/100).toFixed(2);
const price=r=>[r.points?points(r.points):null,r.cash_cents?usd(r.cash_cents):null].filter(Boolean).join(' + ')||'Certificate';
export const config={
 id:'harbor',title:'Harbor Hotels',description:'Award stays, free-night certificates and points expiry for your hotel account.',
 list:'harbor.reservations',collection:'items',listArgs:{},get:'harbor.reservations',item:'item',
 heading:r=>hotelName(r.hotel_id),subtitle:r=>statusLabel[r.status]+' · '+r.check_in+' → '+r.check_out+' · '+methodLabel[r.payment.method],
 labels:{hotel_id:'Hotel ID',check_in:'Check-in (date at the hotel)',check_out:'Check-out (date at the hotel)',method:'Pay with',
  certificate_id:'Certificate',payment_label:'Payment label',reservation_id:'Reservation',city:'City'},
 actions:[
  {label:'Book a stay',tool:'harbor.book',primary:true,success:'Reservation confirmed.'},
  {label:'Search hotels',tool:'harbor.search',defaults:{city:'Kyoto'}},
  {label:'Cancel reservation',tool:'harbor.cancel',selected:true,available:r=>r.status==='confirmed',prefill:r=>({reservation_id:r.id}),success:'Reservation cancelled.'}
 ]
};

function accountPanel(ui){
 const a=ui.aux.account;if(!a)return el('div',{class:'empty'},el('h3',{},'Account unavailable'));
 return el('article',{},el('span',{class:'kicker'},'Member '+a.member_number),el('h2',{},points(a.balance)),
  metadata('Last activity',date(a.last_activity_at,{year:'numeric'})),metadata('Points expire',a.expires_at),
  a.forfeited_at?metadata('Forfeited',a.forfeited_at):null,
  el('h3',{},'Certificates'),...a.certificates.map(c=>el('p',{},'Category 1–'+c.category_cap+' free night, check in by '+c.expires_on+' · '+c.status)),
  el('h3',{},'Ledger'),...[...a.ledger].reverse().map(e=>el('p',{},e.at.slice(0,10)+' · '+e.kind+' · '+(e.points>0?'+':'')+e.points+' → '+e.balance_after)));
}
function noticeRow(n){
 return el('article',{class:'record'},el('span',{class:'record-title'},n.title),el('span',{class:'record-subtitle'},n.kind.replace(/_/g,' ')+' · '+date(n.created_at,{year:'numeric'})),el('small',{},n.body));
}
Object.assign(config,{
 symbol:'⚓',searchLabel:'Search reservations',initialSection:'confirmed',
 load:async ui=>({
  account:ui.has('harbor.account')?await ui.call('harbor.account',{}):null,
  notices:ui.has('harbor.notices.list')?(await ui.call('harbor.notices.list',{})).items:[]
 }),
 sections:()=>[
  {id:'confirmed',label:'Confirmed',symbol:'✓',filter:r=>r.status==='confirmed'},
  {id:'cancelled',label:'Cancelled',symbol:'×',filter:r=>r.status==='cancelled'},
  {id:'account',label:'Points & certificates',symbol:'◎',filter:()=>false,count:false},
  {id:'notices',label:'Notices',symbol:'✉',filter:()=>false,count:false}
 ],
 renderList:(items,ui)=>{
  if(ui.section==='account')return accountPanel(ui);
  if(ui.section==='notices')return el('div',{},...(ui.aux.notices||[]).map(noticeRow));
  return el('div',{},...items.map(r=>ui.record(r,el('span',{class:'record-title'},config.heading(r)),el('span',{class:'record-subtitle'},config.subtitle(r)))));
 },
 view:r=>el('article',{},el('span',{class:'kicker'},statusLabel[r.status]+' · '+r.confirmation),el('h2',{},hotelName(r.hotel_id)),
  el('div',{class:'tags'},tag(methodLabel[r.payment.method]),tag('Category '+r.category_locked+' (locked)')),
  metadata('Stay',r.check_in+' → '+r.check_out+' ('+r.nights+(r.nights===1?' night':' nights')+')'),metadata('Price',price(r)),
  r.payment.payment_label?metadata('Charged to',r.payment.payment_label):null,r.payment.certificate_id?metadata('Certificate',r.payment.certificate_id):null,
  textBlock('Booked '+r.created_at+'. A later category change does not reprice this stay.')),
 field:(name,ui)=>{
  const a=ui?.aux?.account;
  if(name==='payment.payment_label'&&a)return {options:a.payment_labels.map(l=>({value:l,label:l})),emptyLabel:'None (points or certificate)'};
  if(name==='payment.certificate_id'&&a)return {options:a.certificates.filter(c=>c.status==='active').map(c=>({value:c.id,label:'Category 1–'+c.category_cap+', check in by '+c.expires_on})),emptyLabel:'None'};
  if(name==='hotel_id')return {placeholder:'hotel-kyoto-station',help:'Use Search hotels to see IDs, prices and certificate eligibility.'};
  if(name==='check_in'||name==='check_out')return {placeholder:'YYYY-MM-DD'};
  return {};
 },
 emptyView:()=>el('div',{class:'empty'},el('h3',{},'No reservation selected'),el('p',{},'Search hotels, then book with points, a certificate, Points + Cash or cash.')),
 sectionAfter:tool=>tool==='harbor.cancel'?'cancelled':tool==='harbor.book'?'confirmed':null
});
mount(config);
