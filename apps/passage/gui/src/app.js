import {mount,el,date,tag,textBlock,metadata} from '/shared/client.js';
// App-owned interaction catalog and presentation for the international-office e-form portal.
// The Host only supplies an Agent connection, so processing (an Infra event) is shown but not
// triggered here. The page renders its own panels and never selects a record, so it only uses
// the three Agent tools.
const statusLabel={submitted:'In processing',processed:'Processed'};
const signatureLabel={valid:'Valid',lapsed:'Lapsed',none:'No travel signature'};
export const config={
 id:'passage',title:'Passage',description:'International student e-forms: I-20 travel signature requests and status.',
 list:'passage.requests.list',collection:'items',listArgs:{},
 reads:['passage.documents.status'],
 actions:[
  {label:'Request travel signature',tool:'passage.travel_signature.request',primary:true,success:'Request submitted. Check your email for the receipt.'}
 ]
};

function signatureCard(s){
 return el('article',{class:'record'},el('span',{class:'record-title'},'Signed '+s.signed_on+' · '+signatureLabel[s.status]),
  el('span',{class:'record-subtitle'},s.status==='valid'?'Valid until '+s.valid_until+' ('+s.days_until_lapse+' days left)':'Lapsed on '+s.valid_until),
  el('small',{},s.id+' · request '+s.request_id));
}
function documentPanel(ui){
 const status=ui.aux.status,doc=status?.documents?.[0];
 if(!doc)return el('div',{class:'empty'},el('h3',{},'Document status unavailable'));
 const current=doc.current_signature;
 return el('article',{},el('span',{class:'kicker'},'Form I-20 · '+doc.school),el('h2',{},doc.holder_name),
  el('div',{class:'tags'},tag(signatureLabel[doc.travel_signature_status]),doc.pending_request_id?tag('Request '+doc.pending_request_id+' in processing'):null),
  metadata('Today at the office',status.today+' ('+status.timezone+')'),
  current?metadata('Travel signature',current.signed_on+' → '+current.valid_until):null,
  textBlock(current?(current.status==='valid'?'The travel signature lapses on '+current.valid_until+'. Request a new one before then if you will travel later.':'The travel signature lapsed on '+current.valid_until+'. Request a new one before travelling.'):'Request a travel signature before travelling outside the United States.'),
  el('h3',{},'Signatures'),...doc.signatures.map(signatureCard));
}
function requestRow(r){
 return el('article',{class:'record'},el('span',{class:'record-title'},'Travel Signature Request '+r.id),
  el('span',{class:'record-subtitle'},statusLabel[r.status]+' · submitted '+date(r.submitted_at,{year:'numeric'})+' · '+(r.status==='processed'?'signature '+r.signature_id:'expected '+r.due_on)),
  el('small',{},r.business_days+' business days from '+r.submitted_on+(r.processed_at?' · processed '+r.processed_at:'')));
}
Object.assign(config,{
 symbol:'✈',searchLabel:'Search requests',initialSection:'documents',
 load:async ui=>({status:ui.has('passage.documents.status')?await ui.call('passage.documents.status',{}):null}),
 sections:()=>[
  {id:'documents',label:'I-20 & signature',symbol:'◎',filter:()=>false,count:false},
  {id:'requests',label:'My requests',symbol:'✉',filter:()=>false,count:false}
 ],
 renderList:(items,ui)=>ui.section==='documents'?documentPanel(ui):el('div',{},...(ui.records.length?ui.records.map(requestRow):[el('div',{class:'empty'},el('h3',{},'No requests yet'))])),
 emptyView:()=>el('div',{class:'empty'},el('h3',{},'Travel signatures'),el('p',{},'A request is processed in a set number of business days; weekends and office holidays do not count. The office emails you when it is received and when your I-20 is signed.')),
 sectionAfter:tool=>tool==='passage.travel_signature.request'?'requests':null
});
mount(config);
