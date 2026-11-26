'use strict';
// Author-time business values only. Event payloads never depend on plugin results.
const seed = require('../../fixtures/minimal.json');
const copy = value => structuredClone(value);
const at = time => '2026-12-01T' + time + ':00Z';
const need = id => copy(seed.needs.find(n => n.id === id).conditions);
const arrival = need('need-arrival');
const late = {...arrival, arrival_at:'2026-12-02T00:20:00Z'};
const arrivalTerms = {stay_id:'stay-1',service:'late_arrival',person_ids:['person-1','person-2'],arrival_window:{start:at('21:00'),end:at('22:00')},entrance_id:'east',access_method_id:'night-desk'};
const lateTerms = {...copy(arrivalTerms),arrival_window:{start:'2026-12-02T00:00:00Z',end:'2026-12-02T01:00:00Z'}};
const access = person => ({stay_id:'stay-1',service:'step_free_access',person_ids:[person],route_id:'east-step-free',window:copy(seed.stay && need('need-access-'+person).window)});
const terms = id => id === 'need-arrival' ? copy(arrivalTerms) : id.includes('access') ? access(id.replace('need-access-','')) : need(id);
const window = (from, until) => ({from:at(from),until:at(until)});
function reply(id, time, need_id, action, requested, outcome, promised, from='18:00', until=time, predecessor) {
  return {event_id:id,at:at(time),operation:'stayready.hotel_reply',payload:{target:{need_id,action,request_conditions:copy(requested),submitted_in:window(from,until),...(predecessor?{predecessor:copy(predecessor)}:{})},outcome,...(promised?{terms:copy(promised)}:{})}};
}
const prior = (id, from='17:00', until='17:20') => ({commitment_terms:terms(id),confirmed_in:window(from,until)});
const source = (id,time,payload) => ({event_id:id,at:at(time),operation:'stayready.source_updated',payload});
const outage = (id,time,need_id,promised,from,until,effective_at) => ({event_id:id,at:at(time),operation:'stayready.service_unavailable',payload:{target:{need_id,commitment_terms:copy(promised),confirmed_in:{from,until}},effective_at,reason:'Named east step-free route closed.'}});
const action = (time,op,args={}) => ({at:at(time),op,...args});
const submit = (time,id,kind='arrange') => action(time,'submit',{need_id:id,action:kind});
const save = (time,id,conditions) => action(time,'save',{need_id:id,conditions:copy(conditions)});
const replace = action('18:01','call',{name:'stayready.people.replace',args:{old_person_id:'person-2',new_person_id:'person-3'}});
const bootstrap = (first, second) => [first,second].map(([id,outcome],i)=>({need_id:id,action:'arrange',at:at(i?'17:10':'17:00'),event:reply('baseline-reply-'+(i+1),i?'17:15':'17:05',id,'arrange',need(id),outcome,outcome==='confirmed'?terms(id):null,i?'17:10':'17:00',i?'17:15':'17:05')}));
const definitions = [
 {id:'F1',title:'Overnight arrival and named step-free access',bootstrap:bootstrap(['need-arrival','confirmed'],['need-breakfast-person-2','declined']),
  events:[source('f1-source','18:00',{source_id:'source-arrival',expected_source_version:1,source_version:2,arrival_at:late.arrival_at}),
   reply('f1-received','18:05','need-arrival','change',late,'acknowledged',null,'18:00','18:05',prior('need-arrival')),
   reply('f1-confirmed','18:10','need-arrival','change',late,'confirmed',lateTerms,'18:00','18:05',prior('need-arrival')),
   reply('f1-access','18:12','need-access-person-2','arrange',need('need-access-person-2'),'confirmed',access('person-2'))],
  reference:[save('18:01','need-arrival',late),submit('18:01','need-arrival','change'),submit('18:02','need-access-person-2')],
  incorrect:[save('18:01','need-arrival',late),action('18:02','inspect')],
  goal:'The after-midnight arrival is explicitly covered and both travelers have named active step-free routes; the room reservation stays confirmed.',
  failure:'Editing arrival or observing that a lift exists creates neither a later entrance arrangement nor the missing traveler-specific route promise.'},
 {id:'F2',title:'Companion substitution and provider-confirmed cancellation',bootstrap:bootstrap(['need-breakfast-person-2','confirmed'],['need-access-person-2','confirmed']),
  events:[reply('f2-cancel-breakfast','18:05','need-breakfast-person-2','cancel',need('need-breakfast-person-2'),'confirmed',null,'18:00','18:05',prior('need-breakfast-person-2')),
   reply('f2-cancel-access','18:06','need-access-person-2','cancel',need('need-access-person-2'),'confirmed',null,'18:00','18:05',prior('need-access-person-2')),
   reply('f2-breakfast','18:10','need-breakfast-person-3','arrange',need('need-breakfast-person-3'),'confirmed',terms('need-breakfast-person-3')),
   reply('f2-access','18:11','need-access-person-3','arrange',need('need-access-person-3'),'confirmed',access('person-3'))],
  reference:[replace,submit('18:02','need-breakfast-person-2','cancel'),submit('18:02','need-access-person-2','cancel'),submit('18:02','need-breakfast-person-3'),submit('18:02','need-access-person-3')],
  incorrect:[replace,submit('18:02','need-breakfast-person-3')],
  goal:'The current companion is person-3, their two breakfast mornings and access are confirmed, and both old person-2 services are explicitly cancelled.',
  failure:'A replacement and one new breakfast request do not cancel the old services or confirm access for the new traveler.'},
 {id:'F3',title:'Independent arrangements and a correct no-new-action case',bootstrap:bootstrap(['need-arrival','confirmed'],['need-breakfast-person-1','confirmed']),
  events:[source('f3-source','18:00',{source_id:'source-breakfast-person-1',expected_source_version:1,source_version:2,fields:{meal_request:need('need-breakfast-person-1').meal_request,private_background:'Private history remains undisclosed.'}}),
   reply('f3-unrequested','18:05','need-breakfast-person-3','arrange',need('need-breakfast-person-3'),'acknowledged'),
   reply('f3-identical-final','18:06','need-arrival','arrange',arrival,'confirmed',arrivalTerms,'17:00','17:05'),
   reply('f3-late-receipt','18:07','need-arrival','arrange',arrival,'acknowledged',null,'17:00','17:05')],
  reference:[save('18:01','need-breakfast-person-1',need('need-breakfast-person-1')),action('18:02','inspect')],
  incorrect:[submit('18:01','need-arrival','change')],no_action_pass:true,
  goal:'Already-suitable arrival, access and breakfast promises survive unchanged, with no additional external request or disclosure. The same service fact in a refreshed source does not require resending.',
  failure:'Resending an already-covered arrangement adds an unnecessary external request and disclosure; no new request is the correct control.'},
 {id:'F4',title:'Receipt, clarification and refusal remain distinct',bootstrap:bootstrap(['need-arrival','confirmed'],['need-breakfast-person-1','declined']),
  events:[reply('f4-received','18:04','need-breakfast-person-2','arrange',need('need-breakfast-person-2'),'acknowledged'),
   reply('f4-clarify','18:05','need-breakfast-person-2','arrange',need('need-breakfast-person-2'),'needs_clarification',null,'18:00','18:04'),
   reply('f4-declined','18:08','need-breakfast-person-2','arrange',need('need-breakfast-person-2'),'declined',null,'18:00','18:04'),
   reply('f4-cancel-refused','18:10','need-arrival','cancel',arrival,'declined',null,'18:00','18:05',prior('need-arrival'))],
  reference:[submit('18:01','need-breakfast-person-2'),submit('18:01','need-arrival','cancel')],
  incorrect:[submit('18:01','need-breakfast-person-2'),action('18:01','withdraw_last'),submit('18:01','need-breakfast-person-2'),submit('18:01','need-arrival','cancel')],
  goal:'A requested breakfast has received/clarification/refused history without a promise, and a declined cancellation leaves the original arrival commitment active.',
  failure:'Withdrawing A and submitting identical B inside one fixed window makes replies ambiguous, so B cannot acquire A\'s provider decision.'},
 {id:'F5',title:'Changed source, revoked disclosure and unavailable route',bootstrap:bootstrap(['need-arrival','confirmed'],['need-breakfast-person-2','confirmed']),
  events:[source('f5-source','18:00',{source_id:'source-arrival',expected_source_version:1,source_version:2,arrival_at:late.arrival_at}),
   source('f5-revoke','18:02',{source_id:'source-arrival',expected_source_version:2,source_version:3,disclose_fields:[],grant_version:2}),
   outage('f5-outage','18:05','need-access-person-1',access('person-1'),'2026-11-30T00:00:00Z','2026-12-01T00:00:00Z',at('18:20')),
   reply('f5-cancel-route','18:25','need-access-person-1','cancel',need('need-access-person-1'),'confirmed',null,'18:20','18:25',{commitment_terms:access('person-1'),confirmed_in:{from:'2026-11-30T00:00:00Z',until:'2026-12-01T00:00:00Z'}})],
  reference:[save('18:01','need-arrival',late),action('18:01','remember_preview',{need_id:'need-arrival',action:'change'}),action('18:03','submit_saved',{expect_error:'permission_denied'}),action('18:20','inspect'),submit('18:21','need-access-person-1','cancel')],
  incorrect:[save('18:01','need-arrival',late),save('18:21','need-access-person-1',null)],
  goal:'Revoked arrival facts are not sent, the unavailable route is cancelled with provider confirmation, and unrelated original arrival/breakfast promises remain intact.',
  failure:'Clearing a local access need does not cancel the hotel\'s unavailable commitment; no-action also leaves that cancellation unfinished.'},
 {id:'F6',title:'Ordered replay, consumed events and independent runs',bootstrap:bootstrap(['need-arrival','declined'],['need-breakfast-person-1','confirmed']),
  events:[reply('f6-no-request','18:00','need-arrival','arrange',arrival,'confirmed',arrivalTerms,'17:50','18:00'),
   reply('f6-received','18:05','need-arrival','arrange',arrival,'acknowledged'),
   reply('f6-confirmed','18:06','need-arrival','arrange',arrival,'confirmed',arrivalTerms,'18:00','18:05'),
   outage('f6-no-commitment','18:08','need-access-person-2',access('person-2'),'2026-11-30T00:00:00Z',at('18:00'),at('18:20'))],
  reference:[submit('18:01','need-arrival'),action('18:09','retry_event',{index:0}),action('18:10','retry_event',{index:2})],
  incorrect:[submit('18:01','need-arrival'),action('18:01','withdraw_last'),submit('18:01','need-arrival')],
  goal:'One arrival promise is created by the later matching event, the consumed no-request event never rebinds, exact event retries add no effect, and ordered replay yields the same business state.',
  failure:'Same-window withdrawal/resubmission remains ambiguous; retries cannot convert old unmatched or ambiguous hotel events into a new confirmation.'}
];
module.exports = {definitions,initial_time:at('17:59'),need,terms};
