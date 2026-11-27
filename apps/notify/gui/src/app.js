import {mount,el,date,tag,textBlock,metadata} from '/shared/client.js';
// Times show on the phone's clock (the device time zone from notify.focus.get), not the browser's.
let zone;
const time=value=>{try{return date(value,{hour:'numeric',minute:'2-digit',timeZone:zone});}catch{return date(value,{hour:'numeric',minute:'2-digit'});}};
// App-owned interaction catalog and presentation. The Host only supplies an Agent connection,
// so focus, silence and dismissal (user actions applied by Infra) are shown but not editable here.
const statusLabel={scheduled:'Upcoming',delivered:'Delivered',silenced:'Arrived silently',cancelled:'Cancelled'};
export const config={
 id:'notify',title:'Notifications',description:'Reminders you have set and the notifications that reached the phone.',
 list:'notify.reminder.list',collection:'items',listArgs:{},get:'notify.reminder.get',item:'item',
 heading:r=>r.title,subtitle:r=>statusLabel[r.status]+' · '+time(r.fired_at||r.fire_at),
 labels:{fire_at:'Remind at',body:'Details',actionable:'Needs action',calendar_account_id:'Calendar account',
  calendar_event_id:'Calendar event ID',event_start:'Event start',minutes_before:'Minutes before the event'},
 actions:[
  {label:'New reminder',tool:'notify.reminder.create',primary:true,success:'Reminder scheduled.'},
  {label:'Edit reminder',tool:'notify.reminder.update',selected:true,available:r=>r.status==='scheduled',
   // fire_at stays empty: the browser time control holds only minutes, so prefilling it would
   // resubmit a rounded time on a text-only edit and detach a Calendar anchor.
   prefill:r=>({patch:{title:r.title,body:r.body,actionable:r.actionable}})},
  {label:'Cancel reminder',tool:'notify.reminder.cancel',selected:true,available:r=>r.status==='scheduled'}
 ]
};

function quietBanner(ui){
 const f=ui.aux.focus;if(!f)return null;
 const label=f.quiet_reason==='silence'?'Silenced until '+time(f.device.silence_until):f.quiet_reason==='focus'?
  'Focus: '+(f.device.focus.find(w=>w.id===f.focus_id)?.label||'on'):'Notifications on';
 return el('p',{class:'kicker'},label);
}
function feedRow(item,ui){
 const read=item.read_at!==null;
 const mark=el('button',{type:'button',disabled:read||!ui.has('notify.feed.mark_read')},read?'Read':'Mark read');
 mark.addEventListener('click',async()=>{mark.disabled=true;try{await ui.perform('notify.feed.mark_read',{id:item.id});}catch(e){mark.disabled=false;ui.error(e);}});
 return el('article',{class:'record'+(read?'':' unread')},
  el('span',{class:'record-title'},item.title),
  el('span',{class:'record-subtitle'},(item.source.kind==='push'?item.source.app_id:'Reminder')+' · '+time(item.arrived_at)+
   (item.delivery==='silenced'?' · arrived silently':'')+(item.dismissed_at?' · dismissed':'')),
  item.body?el('small',{},item.body):null,mark);
}
Object.assign(config,{
 symbol:'◔',searchLabel:'Search reminders',initialSection:'upcoming',
 load:async ui=>({
  feed:ui.has('notify.feed.list')?(await ui.call('notify.feed.list',{include_dismissed:true})).items:[],
  focus:ui.has('notify.focus.get')?await ui.call('notify.focus.get',{}).then(f=>{zone=f.device?.timezone;return f;}):null
 }),
 sections:()=>[
  {id:'upcoming',label:'Upcoming',symbol:'◷',filter:r=>r.status==='scheduled'},
  {id:'feed',label:'Lock screen',symbol:'▤',filter:()=>false,count:false}, // the feed is not a reminder list
  {id:'fired',label:'Fired',symbol:'✓',filter:r=>r.status==='delivered'||r.status==='silenced'},
  {id:'cancelled',label:'Cancelled',symbol:'×',filter:r=>r.status==='cancelled'}
 ],
 renderList:(items,ui)=>{
  if(ui.section==='feed')return el('div',{},quietBanner(ui),...(ui.aux.feed||[]).map(f=>feedRow(f,ui)));
  return el('div',{},...items.map(r=>ui.record(r,el('span',{class:'record-title'},r.title),el('span',{class:'record-subtitle'},config.subtitle(r)))));
 },
 view:r=>el('article',{},el('span',{class:'kicker'},statusLabel[r.status]),el('h2',{},r.title),
  el('div',{class:'tags'},r.actionable?tag('Needs action'):null,r.anchor?tag('Calendar'):null),
  textBlock(r.body||'No details'),metadata('Remind at',time(r.fire_at)),
  r.fired_at?metadata('Reached the phone',time(r.fired_at)+(r.status==='silenced'?' (silently)':'')):null,
  r.anchor?metadata('Calendar event',r.anchor.minutes_before+' min before '+time(r.anchor.event_start)):null),
 field:name=>name==='patch.fire_at'?{help:'Leave empty to keep the current time. A new time replaces any Calendar anchor.'}:name.endsWith('calendar_account_id')?{help:'Optional. Instead of a fixed time, fill all four calendar fields to remind before an event.'}:{},
 emptyView:ui=>el('div',{class:'empty'},quietBanner(ui),el('h3',{},'No reminder selected'),el('p',{},'Choose a reminder, or open Lock screen to see what reached the phone.')),
 sectionAfter:tool=>tool==='notify.reminder.cancel'?'cancelled':tool==='notify.reminder.create'?'upcoming':null
});
mount(config);
