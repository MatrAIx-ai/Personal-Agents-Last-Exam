import {mount,el,date,time,tag,textBlock,metadata} from '/shared/client.js';
// App-owned interaction catalog and presentation. The Host only supplies an Agent connection, so
// slot changes by other applicants, consulate cancellations and the appointment check (Infra
// events) are shown but not triggered here. The visa file is registered through MCP
// (visaslot.file.submit); this page shows it and what would be missing if held now.
const statusLabel={booked:'Booked',cancelled:'Cancelled',held:'Held'};
const consulateName={'de-chicago':'German Consulate General Chicago','fr-chicago':'Consulate General of France in Chicago'};
const nameOf=id=>consulateName[id]||id;
const missingText=m=>m.rule.replace(/_/g,' ')+': '+(m.nights?'nights without a stay '+m.nights.join(', '):'expected '+m.expected+', found '+(m.found??'nothing'));
export const config={
 id:'visaslot',title:'VisaSlot',description:'Consulate appointments and the visa file for your Schengen trip.',
 list:'visaslot.appointments',collection:'items',listArgs:{},get:'visaslot.appointments',item:'item',
 heading:a=>nameOf(a.consulate_id),subtitle:a=>statusLabel[a.status]+' · '+a.slot_at+(a.file_version?' · file v'+a.file_version:' · no file'),
 labels:{consulate_id:'Consulate',slot_at:'Slot time',slot_version:'Slot version (from Find slots)',appointment_id:'Appointment',
  appointment_version:'Appointment version',from:'From (local date)',to:'To (local date)',category:'Visa category'},
 actions:[
  {label:'Book a slot',tool:'visaslot.book',primary:true,success:'Appointment booked.'},
  {label:'Find slots',tool:'visaslot.slots',defaults:{consulate_id:'de-chicago'}},
  {label:'Checklist',tool:'visaslot.checklist',defaults:{category:'business'}},
  {label:'Reschedule',tool:'visaslot.reschedule',selected:true,available:a=>a.status==='booked',prefill:a=>({appointment_id:a.id,appointment_version:a.version}),success:'Appointment moved.'},
  {label:'Cancel appointment',tool:'visaslot.cancel',selected:true,available:a=>a.status==='booked',prefill:a=>({appointment_id:a.id,appointment_version:a.version}),success:'Appointment cancelled.'},
  {label:'Visa file',tool:'visaslot.file.get',selected:true,prefill:a=>({appointment_id:a.id})}
 ]
};
Object.assign(config,{
 symbol:'🛂',searchLabel:'Search appointments',initialSection:'booked',
 sections:()=>[
  {id:'booked',label:'Booked',symbol:'◷',filter:a=>a.status==='booked'},
  {id:'held',label:'Held',symbol:'✓',filter:a=>a.status==='held'},
  {id:'cancelled',label:'Cancelled',symbol:'×',filter:a=>a.status==='cancelled'}
 ],
 renderList:(items,ui)=>el('div',{},...items.map(a=>ui.record(a,el('span',{class:'record-title'},config.heading(a)),el('span',{class:'record-subtitle'},config.subtitle(a))))),
 view:a=>el('article',{},el('span',{class:'kicker'},statusLabel[a.status]+' · '+a.id+' · version '+a.version),el('h2',{},nameOf(a.consulate_id)),
  el('div',{class:'tags'},tag(a.country),tag(a.file_version?'Visa file v'+a.file_version:'No visa file')),
  metadata('Slot',time(a.slot_at)+' ('+a.slot_at+')'),
  a.cancellation?metadata('Cancelled by',a.cancellation.by+(a.cancellation.reason?': '+a.cancellation.reason:'')):null,
  a.check?metadata('Result',a.check.result+' at '+a.check.held_at):null,
  ...(a.check?a.check.missing.map(m=>textBlock('Missing '+m.item.replace(/_/g,' ')+' — '+missingText(m))):[]),
  el('h3',{},'History'),...a.history.map(h=>el('p',{},date(h.at,{year:'numeric'})+' · '+h.action.replace(/_/g,' ')+' · slot '+h.slot_at)),
  textBlock('Use Visa file to see the registered documents and what would be missing if the appointment were held now.')),
 field:name=>{
  if(name==='consulate_id')return {options:Object.entries(consulateName).map(([value,label])=>({value,label}))};
  if(name==='from'||name==='to')return {placeholder:'YYYY-MM-DD'};
  if(name==='slot_version')return {help:'Each slot listed by Find slots carries its version; a changed slot is refused as stale.'};
  return {};
 },
 emptyView:()=>el('div',{class:'empty'},el('h3',{},'No appointment selected'),el('p',{},'Find slots at the consulate of your main destination, then book one.')),
 sectionAfter:tool=>tool==='visaslot.cancel'?'cancelled':tool==='visaslot.book'||tool==='visaslot.reschedule'?'booked':null
});
mount(config);
