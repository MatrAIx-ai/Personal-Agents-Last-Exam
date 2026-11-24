import {mount,el,time,tag,textBlock,metadata} from '/shared/client.js';
// App-owned interaction catalog and presentation for one Waypoint member. Settlement, bonuses and
// incoming combines are Infra events, so the page shows them but cannot apply them.
const statusLabel={pending:'Pending delivery',completed:'Credited',rejected:'Rejected and refunded'};
const points=n=>Number(n).toLocaleString('en-US')+' pts';
const delay=m=>m%1440===0?(m/1440)+(m===1440?' day':' days'):m%60===0?(m/60)+' h':m+' min';
const target=t=>t.kind==='partner_transfer'?'To '+t.partner_id:'To household member '+t.to_person_id;
export const config={
 id:'waypoint',title:'Waypoint Rewards',description:'Points balance, transfers to partner programs and household combines.',
 list:'waypoint.transfers.list',collection:'items',listArgs:{},get:'waypoint.transfers.get',item:'item',
 heading:t=>target(t)+' · '+points(t.base_points),subtitle:t=>statusLabel[t.status]+' · '+time(t.created_at),
 labels:{partner_id:'Partner',points:'Points',to_person_id:'Household member'},
 actions:[
  {label:'Transfer to partner',tool:'waypoint.transfer',primary:true,success:'Transfer submitted. Points leave the balance now and are credited when delivered.'},
  {label:'Combine with household',tool:'waypoint.combine',success:'Points sent to the household member when delivered.'}
 ]
};

function balancePanel(ui){
 const b=ui.aux.balance;if(!b)return null;
 return el('div',{},el('p',{class:'kicker'},points(b.balance)+(b.pending_points?' · '+points(b.pending_points)+' pending':'')),
  ...b.ledger.slice().reverse().map(r=>el('article',{class:'record'},
   el('span',{class:'record-title'},(r.points>0?'+':'')+points(r.points)+' · '+(r.description||r.kind)),
   el('span',{class:'record-subtitle'},time(r.at)+' · balance '+points(r.balance_after)))));
}
function partnerPanel(ui){
 return el('div',{},...(ui.aux.partners||[]).map(p=>el('article',{class:'record'},
  el('span',{class:'record-title'},p.name+(p.bonus_pct_now?' · +'+p.bonus_pct_now+'% bonus now':'')),
  el('span',{class:'record-subtitle'},'Ratio '+p.ratio.from+':'+p.ratio.to+' · multiples of '+p.increment+' · '+(p.delay_minutes?'credited after '+delay(p.delay_minutes):'instant')),
  el('small',{},'Your account '+p.recipient_account_id))),
  ...(ui.aux.bonuses||[]).map(b=>el('article',{class:'record'},el('span',{class:'record-title'},'+'+b.percent+'% to '+b.partner_id+' · '+b.state),
   el('span',{class:'record-subtitle'},time(b.starts_at)+' – '+time(b.ends_at)))));
}
Object.assign(config,{
 symbol:'◇',searchLabel:'Search transfers',initialSection:'pending',
 load:async ui=>({
  balance:ui.has('waypoint.balance')?await ui.call('waypoint.balance',{}):null,
  partners:ui.has('waypoint.partners')?(await ui.call('waypoint.partners',{})).items:[],
  bonuses:ui.has('waypoint.bonuses')?(await ui.call('waypoint.bonuses',{})).items:[]
 }),
 sections:()=>[
  {id:'points',label:'Points',symbol:'◆',filter:()=>false},
  {id:'partners',label:'Partners',symbol:'⇄',filter:()=>false},
  {id:'pending',label:'Pending',symbol:'◷',filter:t=>t.status==='pending'},
  {id:'completed',label:'Credited',symbol:'✓',filter:t=>t.status==='completed'},
  {id:'rejected',label:'Refunded',symbol:'↺',filter:t=>t.status==='rejected'}
 ],
 renderList:(items,ui)=>{
  if(ui.section==='points')return balancePanel(ui)||el('p',{},'Balance unavailable.');
  if(ui.section==='partners')return partnerPanel(ui);
  return el('div',{},...items.map(t=>ui.record(t,el('span',{class:'record-title'},config.heading(t)),el('span',{class:'record-subtitle'},config.subtitle(t)))));
 },
 view:t=>el('article',{},el('span',{class:'kicker'},statusLabel[t.status]),el('h2',{},target(t)),
  el('div',{class:'tags'},t.bonus_pct?tag('+'+t.bonus_pct+'% bonus'):null,tag(t.kind==='partner_transfer'?'Partner transfer':'Household combine')),
  textBlock(points(t.base_points)+' sent; '+points(t.points)+' credited at the destination.'),
  metadata('Made',time(t.created_at)),metadata('Released',time(t.available_at)),
  t.settled_at?metadata(t.status==='completed'?'Credited':'Refunded',time(t.settled_at)):null,
  t.receipt?metadata('Receipt',t.receipt.target_app_id+' / '+t.receipt.target_account_id+' · '+t.receipt.event_id):null,
  t.rejection?metadata('Rejection',t.rejection.code+(t.rejection.reason?' ('+t.rejection.reason+')':'')):null),
 field:(name,ui)=>name==='partner_id'?{options:(ui.aux.partners||[]).map(p=>({value:p.id,label:p.name+(p.bonus_pct_now?' (+'+p.bonus_pct_now+'% now)':'')})),
   help:'Transfers are irreversible and go only to your own account in that program.'}:
  name==='to_person_id'?{options:(ui.aux.balance?.household||[]).map(m=>({value:m.person_id,label:m.name})),help:'You can only send your own points.'}:{},
 emptyView:ui=>el('div',{class:'empty'},el('h3',{},ui.aux.balance?points(ui.aux.balance.balance):'Waypoint Rewards'),el('p',{},'Choose a transfer, or open Points or Partners.')),
 sectionAfter:tool=>tool==='waypoint.transfer'||tool==='waypoint.combine'?'pending':null
});
mount(config);
