import {mount,el,tag,textBlock,metadata} from '/shared/client.js';
// App-owned interaction catalog and presentation. The Host only supplies an Agent connection,
// so the window opening, the deadline and letter issuing (Infra events) are shown but not triggered here.
// Every view is drawn from the read tools; no record is selected, so no per-record read is needed.
const money=r=>r.currency+' '+(r.amount_cents/100).toFixed(2);
const windowLabel={not_open:'Not open yet',open:'Open',closed:'Closed'};
const paperLabel={awaiting_registration:'Awaiting an author registration',in_program:'In the program',removed:'Removed from the program'};
export const config={
 id:'confdesk',title:'ConfDesk',description:'Author registration, visa invitation letters and corrections for your accepted paper.',
 list:'confdesk.letter.get',collection:'letters',listArgs:{},get:'confdesk.letter.get',item:'current',
 heading:l=>l.name_on_letter,subtitle:l=>l.id+' · issued '+l.issued_at.slice(0,10)+' · '+l.status,
 labels:{paper_id:'Paper',preview_id:'Preview ID',payment_label:'Pay with','fields.salutation':'Salutation','fields.surname':'Surname',
  'fields.given_names':'Given names','fields.date_of_birth':'Date of birth','fields.nationality':'Nationality'},
 actions:[
  {label:'Preview registration',tool:'confdesk.register.preview',primary:true},
  {label:'Confirm registration',tool:'confdesk.register.confirm',success:'Registration confirmed.'},
  {label:'Request letter correction',tool:'confdesk.letter.request_correction',success:'Correction requested.'}
 ]
};

function overview(ui){
 const {conference:c,paper:p,registration:r}=ui.aux;
 if(!c||!p)return el('div',{class:'empty'},el('h3',{},'Conference unavailable'));
 return el('article',{},el('span',{class:'kicker'},c.city+' · '+c.starts_on+' → '+c.ends_on),el('h2',{},c.short_name+', '+c.name),
  el('div',{class:'tags'},tag('Registration: '+windowLabel[c.registration.status]),tag(paperLabel[p.paper.status])),
  metadata('Registration opens',c.registration.opens_at),metadata('Registration deadline',c.registration.closes_at),
  metadata('Author rate',c.author_rate?money(c.author_rate):'Not set yet'),metadata('Rate covers',c.rate_covers.join('; ')),
  metadata('Invitation letter',c.letter_business_days+' business days after registration'),
  metadata('Corrections',c.correction_business_days+' business days after the request'),
  metadata('Business calendar',c.business_calendar.timezone+', Saturday and Sunday off, '+c.business_calendar.holidays.length+' holidays'),
  el('h3',{},'Paper #'+p.paper.number),textBlock(p.paper.title),metadata('Session',p.paper.session),
  el('h3',{},'Registration'),
  r&&r.registration?el('div',{},metadata('Registration',r.registration.id),metadata('Completed',r.registration.completed_at),
   metadata('Paid',money(r.registration.rate)+' with '+r.registration.payment_label)):el('p',{},'No author registration yet.'),
  r?metadata('Name on file',r.attendee.name_on_file):null);
}
function letterView(l){
 return el('article',{class:'record'},el('span',{class:'record-title'},l.name_on_letter+(l.status==='current'?'':' (superseded)')),
  el('span',{class:'record-subtitle'},l.id+' · '+l.kind+' · issued '+l.issued_at),el('pre',{class:'body-text'},l.text));
}
function lettersPanel(ui){
 const out=ui.aux.letters;if(!out)return el('div',{class:'empty'},el('h3',{},'Letters unavailable'));
 return el('div',{},
  out.letter_expected_on?el('p',{},'Your invitation letter is due on '+out.letter_expected_on+'.'):null,
  ...out.correction_requests.map(r=>el('article',{class:'record'},el('span',{class:'record-title'},'Correction '+r.id+' · '+r.status),
   el('span',{class:'record-subtitle'},'Requested '+r.at+' · expected '+r.expected_on),
   el('small',{},Object.entries(r.fields).map(([k,v])=>k+': '+v).join(', ')))),
  ...out.letters.map(letterView),
  !out.letters.length&&!out.letter_expected_on?el('p',{},'No letter yet. A letter is issued after you register.'):null);
}
Object.assign(config,{
 symbol:'✎',searchLabel:'Search letters',initialSection:'registration',
 load:async ui=>({
  conference:ui.has('confdesk.conference.get')?(await ui.call('confdesk.conference.get',{})).conference:null,
  paper:ui.has('confdesk.paper.status')?await ui.call('confdesk.paper.status',{}):null,
  registration:ui.has('confdesk.registration.get')?await ui.call('confdesk.registration.get',{}):null,
  letters:ui.has('confdesk.letter.get')?await ui.call('confdesk.letter.get',{}):null
 }),
 sections:()=>[
  {id:'registration',label:'Registration',symbol:'◎',filter:()=>false,count:false},
  {id:'letters',label:'Invitation letters',symbol:'✉',filter:()=>false,count:false}
 ],
 renderList:(items,ui)=>ui.section==='letters'?lettersPanel(ui):overview(ui),
 field:(name,ui)=>{
  const r=ui?.aux?.registration,p=ui?.aux?.paper;
  if(name==='payment_label'&&r)return {options:r.payment_labels.map(l=>({value:l,label:l}))};
  if(name==='paper_id'&&p)return {options:[{value:p.paper.id,label:'#'+p.paper.number+' '+p.paper.title}]};
  if(name==='preview_id')return {placeholder:'pv-…',help:'The preview_id from Preview registration; it is single use and expires.'};
  if(name==='fields.date_of_birth')return {placeholder:'YYYY-MM-DD'};
  if(name.startsWith('fields.'))return {help:'Leave empty unless this detail is wrong on the letter.'};
  return {};
 },
 emptyView:()=>el('div',{class:'empty'},el('h3',{},'Register, then check your letter'),el('p',{},'Preview the author rate, confirm with a payment label, and request a correction if the letter is wrong.')),
 sectionAfter:tool=>tool==='confdesk.letter.request_correction'?'letters':tool==='confdesk.register.confirm'?'registration':null
});
mount(config);
