import {el, human, tag, metadata, textBlock, avatar} from '/shared/client.js';

// This controller uses the public Host's fixed Agent session. Its only business
// data is the latest authorized inspect result; previews are read-only receipts.
document.body.dataset.app = 'stayready';
// The public Host deliberately serves only its shared stylesheet. These static,
// App-owned CSSOM rules extend that stylesheet without adding a server route or
// allowing inline/user-provided styles through the Host's CSP.
const presentation = new CSSStyleSheet();
presentation.replaceSync(`
  body[data-app="stayready"] :is(small,.tag,.record-subtitle,.kicker,.collection-count,.sidebar-foot strong,#status,.attachments h3) {font-size:12px}
  body[data-app="stayready"] #status {height:auto;min-height:30px}
  body[data-app="stayready"]:has(dialog[open]) #app {height:100dvh;overflow:hidden}
  html:has(body[data-app="stayready"] dialog[open]) {overflow:hidden}
`);
document.adoptedStyleSheets = [...document.adoptedStyleSheets, presentation];
const pendingStatuses = new Set(['submitted', 'acknowledged', 'needs_clarification']);
const serviceLabels = {late_arrival:'Late arrival', step_free_access:'Step-free access', breakfast:'Breakfast'};
const activityLabels = {'stayready.need.save':'Need updated','stayready.people.replace':'Companion replaced','stayready.request.submit':'Request sent','stayready.request.withdraw':'Request withdrawn','stayready.source_updated':'Source updated','stayready.hotel_reply':'Hotel reply received','stayready.service_unavailable':'Service availability notice'};
const statusLabels = {submitted:'Sent · awaiting hotel', acknowledged:'Received · not yet confirmed', needs_clarification:'Hotel needs clarification', confirmed:'Hotel confirmed', declined:'Hotel declined', withdrawn:'Withdrawn', superseded:'Replaced by a newer request', active:'Confirmed arrangement', unavailable:'Service unavailable', cancelled:'Hotel confirmed cancellation'};
let csrf = '', tools = new Set(), state = null, version = null, view = sessionStorage.getItem('stayready-view') || 'stay';
let selected = sessionStorage.getItem('stayready-selected') || 'need-arrival', refreshing = false, busy = false;
const hotelZone = () => state.property.timezone;
const displayTime = value => value ? new Intl.DateTimeFormat('en-GB', {day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZoneName:'short',timeZone:hotelZone()}).format(new Date(value)) : '—';
// A breakfast morning is a calendar date, not an instant to shift across zones.
const displayMorning = value => new Intl.DateTimeFormat('en-GB', {day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z'));
function localInput(value) {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:hotelZone(),year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).map(p=>[p.type,p.value]));
  return parts.year+'-'+parts.month+'-'+parts.day+'T'+parts.hour+':'+parts.minute;
}
function localToInstant(value, original) {
  // Preserve the precise original instant for an unchanged wall-clock field,
  // including an original instant inside an autumn overlap.
  if(original && value===localInput(original))return original;
  const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if(!match)throw Object.assign(Error('Enter a complete hotel-local date and time.'),{code:'invalid_arguments'});
  const wall=Date.UTC(+match[1],+match[2]-1,+match[3],+match[4],+match[5]);
  const candidates=new Set();
  // Both sides of a possible daylight-saving transition supply their actual
  // IANA offset. Never parse datetime-local using the browser's own timezone.
  for(const hours of [-36,-12,0,12,36]) {
    const probe=wall+hours*3600000;
    const local=localInput(new Date(probe).toISOString());
    const offset=Date.parse(local+':00Z')-probe;
    const candidate=new Date(wall-offset).toISOString();
    if(localInput(candidate)===value)candidates.add(candidate);
  }
  if(candidates.size!==1)throw Object.assign(Error(candidates.size ? 'This hotel-local time occurs twice when the clocks change. Choose an unambiguous time.' : 'This hotel-local time does not exist when the clocks change. Choose a valid time.'),{code:'invalid_arguments'});
  return [...candidates][0];
}
const personName = id => state.people.find(p => p.id === id)?.name || id;
const peopleNames = ids => (ids || []).map(personName).join(', ');
const needTitle = need => serviceLabels[need.service] || human(need.service);
const currentCommitment = id => state.commitments.find(c => c.need_id === id && ['active','unavailable'].includes(c.effective_status || c.status));
const pendingRequest = id => state.requests.find(r => r.need_id === id && pendingStatuses.has(r.status));
const can = name => tools.has('stayready.' + name);
const button = (label, action, attrs={}) => el('button', {type:'button', onclick:()=>Promise.resolve(action()).catch(showError), ...attrs}, label);
const status = el('p', {id:'status', role:'status', 'aria-live':'polite'}, 'Connecting to your stay…');
const nav = el('nav', {'aria-label':'StayReady navigation'});
const list = el('div', {id:'records', class:'records'});
const collectionTitle = el('h2', {class:'section-title'});
const count = el('span', {class:'collection-count'});
const detail = el('section', {class:'detail', 'aria-label':'Stay details'});
const collection = el('section', {class:'collection', 'aria-label':'StayReady records'}, el('div', {class:'collection-head'}, collectionTitle, count), list);
const toolbarTitle = el('strong', {}, 'Your stay');
const workspace = el('div', {class:'workspace'}, collection, detail);
const refreshButton = button('Refresh', ()=>refresh('Updated from the hotel record.'));
const dialog = el('dialog', {'aria-labelledby':'operation-title'});
dialog.addEventListener('cancel', event=>{if(busy)event.preventDefault();});
document.querySelector('#app').replaceChildren(el('div', {class:'app-shell'},
  el('aside', {class:'sidebar'},
    el('div', {class:'brand'}, el('span', {class:'brand-mark','aria-hidden':'true'}, 'S'), el('h1', {}, 'StayReady')),
    nav,
    el('div', {class:'sidebar-foot'}, avatar('Your stay'), el('div', {}, el('strong', {}, 'One stay, clear arrangements'), el('small', {}, 'Hotel replies remain separate from requests.')))),
  el('main', {class:'app-main'}, el('header', {class:'toolbar'}, toolbarTitle, refreshButton), status, workspace)), dialog);

async function request(path, method='GET', body) {
  const response = await fetch(path, {method, credentials:'same-origin', headers:method === 'POST' ? {'Content-Type':'application/json','X-Pale-CSRF':csrf} : {}, body:body === undefined ? undefined : JSON.stringify(body)});
  const result = await response.json();
  if (!response.ok) { const error = Error(result.error || 'The request could not be completed.'); error.code = response.status === 403 ? 'permission_denied' : 'request_failed'; throw error; }
  return result;
}
async function call(name, args={}) {
  const result = await request('/api/call', 'POST', {name:'stayready.'+name, arguments:args});
  if (!['ok','committed','ready'].includes(result.status)) {
    const friendly = {stale_version:'This record changed while you were working. Close this dialog, refresh, and review the latest record before trying again.', permission_denied:'This action is not permitted. No changes were made.', stale_preview:'The request or its sharing permission changed. Close this dialog and make a new preview.', invalid_arguments:'Some details are invalid. Review the dates and selected sources.'};
    const error = Error(friendly[result.status] || result.message || result.error?.message || human(result.status)); error.code = result.status; throw error;
  }
  return result;
}
function showError(error) { status.textContent = error.message; status.dataset.error = 'true'; status.dataset.code = error.code || 'request_failed'; }
async function refresh(message='') {
  if (refreshing) return;
  refreshing = true; workspace.setAttribute('aria-busy','true'); refreshButton.disabled = true;
  try {
    const discovery = await request('/api/tools'); tools = new Set(discovery.tools.map(t => t.name));
    const result = await call('inspect'); state = result.view; version = result.version;
    render(); status.textContent = message || 'Record as of ' + displayTime(state.virtual_now) + '.';
    delete status.dataset.error; delete status.dataset.code;
  } finally { refreshing = false; workspace.setAttribute('aria-busy','false'); refreshButton.disabled = false; }
}
function navigate(next, id) {
  view = next; if (id) selected = id;
  sessionStorage.setItem('stayready-view', view); sessionStorage.setItem('stayready-selected', selected);
  render();
}
function record(id, title, subtitle, label, action) {
  return button('', action, {class:'record','data-record-id':id,'aria-pressed':selected === id}).appendChild(el('span', {}, el('span', {class:'record-title'}, title), el('span', {class:'record-subtitle'}, subtitle), label ? el('span', {class:'row-bottom'}, tag(label)) : null)).parentElement;
}
function article(kicker, title, ...children) { return el('article', {}, el('span', {class:'kicker'}, kicker), el('h2', {}, title), ...children); }
function section(title, ...children) { return el('section', {class:'attachments'}, el('h3', {}, title), ...children); }
function facts(value) {
  if (!value) return textBlock('No current requirement saved. Existing hotel arrangements remain on record.');
  const rows = [metadata('Guests', peopleNames(value.person_ids))];
  if (value.arrival_at) rows.push(metadata('Arrival', displayTime(value.arrival_at)));
  if (value.arrival_window) rows.push(metadata('Arrival window', displayTime(value.arrival_window.start) + ' – ' + displayTime(value.arrival_window.end)));
  if (value.window) rows.push(metadata('Coverage', displayTime(value.window.start) + ' – ' + displayTime(value.window.end)));
  if (value.functional_need) rows.push(metadata('Access needed', 'Step-free route to lodging'));
  if (value.route_id) rows.push(metadata('Confirmed route', state.property.routes.find(r => r.id === value.route_id)?.label || value.route_id));
  if (value.entrance_id) rows.push(metadata('Entrance', state.property.entrances.find(e => e.id === value.entrance_id)?.label || value.entrance_id));
  if (value.access_method_id) rows.push(metadata('Arrival method', human(value.access_method_id)));
  if (value.morning_dates) rows.push(metadata('Mornings', value.morning_dates.map(displayMorning).join(', ')));
  if (value.meal_request) rows.push(metadata('Meal request', value.meal_request));
  return el('div', {}, rows);
}
function render() {
  nav.replaceChildren(...[['stay','Your stay'],['needs','Needs & requests'],['replies','Replies & arrangements']].map(([id,label]) => button(label, ()=>navigate(id), {'aria-current':view === id ? 'page' : null})));
  toolbarTitle.textContent = state.property.name;
  if (view === 'stay') renderStay(); else if (view === 'needs') renderNeeds(); else renderReplies();
}
function renderStay() {
  if(!['booking','policies'].includes(selected)) selected='booking';
  collectionTitle.textContent = 'Your stay'; count.textContent = '2 nights';
  list.replaceChildren(record('booking','Booking & guests','Reservation and people staying','Room booking ' + state.stay.reservation_status,()=>navigate('stay','booking')), record('policies','Policies & routes','Reception, entrances and access','Hotel information',()=>navigate('stay','policies')));
  if (selected === 'policies') {
    detail.replaceChildren(article('Hotel information','Policies & routes',textBlock(state.property.policy_text), metadata('Reception',state.property.reception_hours),
      section('Access routes', state.property.routes.map(route => el('section', {class:'query-result'}, el('h3',{},route.label), el('div',{class:'tags'}, tag(route.step_free ? 'Step-free route' : 'Includes steps'), tag(route.uses_lift ? 'Uses a lift' : 'No lift')), metadata('Route hours',displayTime(route.window.start)+' – '+displayTime(route.window.end))))),
      textBlock('A lift does not establish a step-free entrance. Check the route and the hotel’s confirmed coverage for the person and time you need.')));
    return;
  }
  detail.replaceChildren(article('Booking stays separate from service requests',state.property.name,
    el('div',{class:'tags'},tag('Room reservation ' + state.stay.reservation_status),tag('Two guests · two nights')),
    metadata('Check-in',displayTime(state.stay.check_in)),metadata('Check-out',displayTime(state.stay.check_out)),metadata('Hotel time zone',hotelZone()),
    section('Staying guests',el('div',{class:'people'},state.stay.guest_person_ids.map(id=>el('div',{class:'person'},avatar(personName(id)),el('div',{},el('strong',{},personName(id)),el('small',{},id === state.owner_person_id ? 'Booking owner' : 'Companion')))))),
    textBlock('You can replace the companion while keeping the same headcount. Review the new guest’s needs and arrange cancellation of any unwanted confirmed services separately.'),
    el('div',{class:'reader-footer actions'},can('people.replace') ? button('Replace companion',replacePerson,{class:'primary'}) : null,button('Review needs',()=>navigate('needs','need-arrival'))),
    section('Booking policy',textBlock(state.property.policy_text),el('small',{},'Room dates, room assignment and headcount changes are outside this service workspace.'))));
}
function renderNeeds() {
  collectionTitle.textContent = 'Needs'; const needs = state.needs; count.textContent = needs.filter(n => n.is_current).length + ' current';
  if (!needs.some(n=>n.id===selected)) selected = needs.find(n=>n.is_current)?.id || needs[0]?.id;
  list.replaceChildren(...needs.map(n => record(n.id,needTitle(n),peopleNames(n.person_ids),!n.is_current ? 'Former / other guest' : n.review_required ? 'Source changed · review needed' : n.conditions ? 'Current requirement' : 'No requirement',()=>navigate('needs',n.id))));
  const need = needs.find(n=>n.id===selected); if(!need) return detail.replaceChildren(el('p',{class:'empty'},'No needs available.'));
  const commitment = currentCommitment(need.id), pending = pendingRequest(need.id);
  const actions = [];
  if (can('need.save') && need.is_current) {
    actions.push(button('Edit need',()=>editNeed(need),{class:'primary'}));
    if (need.conditions) actions.push(button('Clear local need',()=>openForm('Clear local requirement',[textBlock('Clear this local requirement. Pending requests and hotel-confirmed services remain on record; withdraw or request cancellation separately when needed.')],'Clear local need','need.save',()=>({need_id:need.id,conditions:null,source_ids:[]}))));
  }
  if (can('request.preview') && need.conditions && need.is_current) actions.push(button(commitment ? 'Preview change' : 'Preview request',()=>previewRequest(need,commitment ? 'change' : 'arrange',commitment)));
  if (can('request.preview') && commitment) actions.push(button('Preview cancellation',()=>previewRequest(need,'cancel',commitment)));
  if (pending && can('request.withdraw')) actions.push(button('Withdraw pending request',()=>withdraw(pending)));
  detail.replaceChildren(article(need.is_current ? 'Current guest requirement' : 'Historical guest requirement',needTitle(need),
    el('div',{class:'tags'},tag(peopleNames(need.person_ids)),need.review_required ? tag('Source changed · review needed') : null), facts(need.conditions),
    el('div',{class:'reader-footer actions'},actions),
    pending ? section('Pending request',tag(statusLabels[pending.status]),textBlock('A sent or acknowledged request is not a confirmed arrangement. A new submission replaces this pending attempt; its history is retained.')) : null,
    commitment ? section('Existing hotel arrangement',tag(statusLabels[commitment.effective_status || commitment.status]),facts(commitment.terms),textBlock('Editing this need or requesting a change does not remove the hotel’s existing promise.')) : null,
    section('Linked sources', (need.source_ids || []).map(id => sourceCard(state.sources.find(s=>s.id===id) || {id,readable:false})))));
}
function sourceCard(source) {
  const visible = source.readable !== false;
  const allowed = new Set(source.disclose_fields || []);
  return el('section',{class:'query-result'},el('h3',{},human(source.id.replace(/^source-/,''))),
    el('small',{},visible ? 'Observed ' + displayTime(source.observed_at) : 'Source unavailable or access denied'),
    visible ? el('div',{},Object.entries(source.fields || {}).filter(([key])=>allowed.has(key) && key !== 'private_background').map(([key,value])=>metadata(human(key),key === 'arrival_at' ? displayTime(value) : String(value)))) : null,
    el('small',{},'Only permitted service facts can be included in a hotel request.'));
}
function historySubject(entry) {
  const request=state.requests.find(r=>r.id===entry.target_id);
  const commitment=state.commitments.find(c=>c.id===entry.target_id);
  const need=state.needs.find(n=>n.id===(request?.need_id || commitment?.need_id || entry.selector?.need_id || entry.target_id));
  if(need){const people=request?.conditions?.person_ids || commitment?.terms?.person_ids || entry.selector?.request_conditions?.person_ids || entry.selector?.commitment_terms?.person_ids;return needTitle(need)+(people ? ' · '+peopleNames(people) : '');}
  const source=state.sources.find(s=>s.id===entry.target_id);
  if(source)return human(source.id.replace(/^source-/,''))+(source.person_id ? ' · '+personName(source.person_id) : '');
  if(entry.details?.new_person_id)return personName(entry.details.old_person_id)+' → '+personName(entry.details.new_person_id);
  return 'This stay';
}
function renderReplies() {
  collectionTitle.textContent = 'Hotel record'; count.textContent = state.requests.length + (state.requests.length === 1 ? ' request' : ' requests');
  const entries = [...state.requests].reverse();
  list.replaceChildren(record('arrangements','Confirmed arrangements','Original promises and current availability',state.commitments.length+' on record',()=>navigate('replies','arrangements')),
    ...entries.map(r=>record(r.id,needTitle(state.needs.find(n=>n.id===r.need_id)||r)+' · '+human(r.action),peopleNames(r.conditions?.person_ids),statusLabels[r.status]||human(r.status),()=>navigate('replies',r.id))),
    record('history','Activity history','Observed changes and matching outcomes','Past activity only',()=>navigate('replies','history')));
  if (selected === 'history') {
    detail.replaceChildren(article('Observed activity','Activity history',textBlock('This history records observed actions and hotel updates. No future hotel events are shown.'),
      ...[...state.history].reverse().map((h,i)=>el('section',{class:'query-result','data-history-index':i},el('h3',{},activityLabels[h.operation] || 'Hotel record updated'),metadata('Record',historySubject(h)),metadata('Observed at',displayTime(h.at)),metadata('Outcome',h.outcome?.startsWith('history_only/') ? 'History only · '+human(h.outcome.split('/')[1]) : human(h.outcome || 'Recorded')), h.details?.reason ? metadata('Detail',human(h.details.reason)) : null))));return;
  }
  const req = state.requests.find(r=>r.id===selected);
  if (!req) {
    selected = 'arrangements';
    detail.replaceChildren(article('Promises are separate from current requirements','Confirmed arrangements',
      textBlock('Read each arrangement’s guests, dates, route and terms. Availability notices do not erase the original hotel promise.'),
      ...state.commitments.map(c=>el('section',{class:'query-result','data-commitment-id':c.id},el('h3',{},needTitle(state.needs.find(n=>n.id===c.need_id)||c)),el('div',{class:'tags'},tag(statusLabels[c.effective_status || c.status] || human(c.status))),facts(c.terms),metadata('Confirmed',displayTime(c.confirmed_at)),...(c.unavailability || []).map(n=>textBlock((n.reason || 'Service unavailable') + ' · effective ' + displayTime(n.effective_at))),
        ['active','unavailable'].includes(c.effective_status || c.status) && can('request.preview') ? el('div',{class:'reader-footer actions'},button('Review associated need',()=>navigate('needs',c.need_id)),button('Preview cancellation',()=>previewRequest(state.needs.find(n=>n.id===c.need_id),'cancel',c))) : null)),
      state.commitments.length ? null : el('p',{class:'empty'},'No hotel-confirmed arrangements yet.')));return;
  }
  detail.replaceChildren(article('Immutable submitted request',needTitle(state.needs.find(n=>n.id===req.need_id)||req)+' · '+human(req.action),el('div',{class:'tags'},tag(statusLabels[req.status]||human(req.status))),metadata('Sent',displayTime(req.submitted_at)),facts(req.conditions),
    pendingStatuses.has(req.status) ? textBlock('Waiting for the hotel. An acknowledgment or a clarification question does not confirm service.') : null,
    req.predecessor ? section('Earlier promise remains until confirmed change or cancellation',facts(req.predecessor.terms)) : null,
    section('Hotel replies',req.replies.length ? req.replies.map(r=>el('section',{class:'query-result'},tag(statusLabels[r.outcome]||human(r.outcome)),r.message ? textBlock(r.message) : null,r.terms ? facts(r.terms) : null)) : textBlock('No hotel reply yet.')),
    el('div',{class:'reader-footer actions'},pendingStatuses.has(req.status) && can('request.withdraw') ? button('Withdraw pending request',()=>withdraw(req)) : null,button('View arrangements',()=>navigate('replies','arrangements')))));
}
function field(label, input, hint) { return el('label',{class:'field'},el('span',{},label),input,hint ? el('small',{},hint) : null); }
function select(options, current) { const input = el('select'); for (const [value,label] of options) input.append(el('option',{value,selected:value===current},label)); return input; }
function openForm(title, content, label, operation, values, after) {
  const capturedVersion = structuredClone(version); let pending = null;
  const error = el('p',{class:'form-error',role:'alert'}), submit = el('button',{type:'submit',class:'primary'},label);
  const close = button('Close',()=>dialog.close());
  const form = el('form',{},el('h2',{id:'operation-title'},title),el('div',{class:'fields'},content),error,el('div',{class:'form-actions'},close,submit));
  dialog.dataset.operation = operation; dialog.replaceChildren(form); dialog.showModal();
  form.addEventListener('submit', async event=>{
    event.preventDefault(); if(busy)return; busy=true; submit.disabled=true; close.disabled=true; error.textContent='';
    try {
      const args={...values(),expected_version:capturedVersion}; const signature=JSON.stringify(args);
      if(!pending || pending.signature !== signature) pending={signature,id:'stayready-web-'+crypto.randomUUID()};
      const result=await call(operation,{...args,request_id:pending.id}); dialog.close();
      if(after)after(result); await refresh('Saved. The hotel record has been refreshed.');
    } catch(e) { error.textContent=e instanceof TypeError && !e.code ? 'The reply could not be received. Retry this unchanged form to check the same operation without sending it twice.' : e.message; error.dataset.code=e.code || 'request_failed'; }
    finally {busy=false;submit.disabled=false;close.disabled=false;}
  });
}
function replacePerson() {
  const old = state.stay.guest_person_ids.find(id=>id !== state.owner_person_id);
  const options = state.people.filter(p=>!state.stay.guest_person_ids.includes(p.id)).map(p=>[p.id,p.name]);
  const choice = select(options,options[0]?.[0]); choice.setAttribute('name','new_person_id');
  openForm('Replace companion',[textBlock('Replace '+personName(old)+' while keeping the booking at two guests. Existing promises will stay on record until separately changed or cancelled.'),field('New companion',choice)],'Replace companion','people.replace',()=>({old_person_id:old,new_person_id:choice.value}),()=>{selected='booking';});
}
function editNeed(need) {
  const factKey = {late_arrival:'arrival_at',step_free_access:'functional_need',breakfast:'meal_request'}[need.service];
  const sources = state.sources.filter(s=>s.readable !== false && (s.person_id == null || need.person_ids.includes(s.person_id)) && s.fields?.[factKey] !== undefined);
  const sourceInput = select(sources.map(s=>[s.id,human(s.id.replace(/^source-/,''))+' · '+(factKey==='arrival_at' ? displayTime(s.fields[factKey]) : String(s.fields[factKey]))]),need.source_ids?.[0]); sourceInput.name='source_id';
  const inputs = [field('Service fact source',sourceInput,'Use an observed source fact. Sharing permission is checked again when you send.')];
  let readConditions;
  const base = {stay_id:state.stay.id,service:need.service,person_ids:need.person_ids};
  if(need.service === 'late_arrival') {
    inputs.push(textBlock('Saving applies the selected source’s latest arrival time to this need. Preview the exact time and guests before sending.'));
    readConditions=()=>({...base,arrival_at:sources.find(s=>s.id===sourceInput.value)?.fields.arrival_at});
  } else if(need.service === 'step_free_access') {
    const originalStart=need.conditions?.window.start || state.stay.check_in, originalEnd=need.conditions?.window.end || state.stay.check_out;
    const start=el('input',{name:'window_start',type:'datetime-local',required:true,value:localInput(originalStart)});
    const end=el('input',{name:'window_end',type:'datetime-local',required:true,value:localInput(originalEnd)});
    inputs.push(field('Coverage starts ('+hotelZone()+')',start),field('Coverage ends ('+hotelZone()+')',end,'Hotel local time; daylight-saving offsets are applied automatically.'));
    readConditions=()=>({...base,functional_need:sources.find(s=>s.id===sourceInput.value)?.fields.functional_need,window:{start:localToInstant(start.value,originalStart),end:localToInstant(end.value,originalEnd)}});
  } else {
    const dates=el('input',{name:'morning_dates',type:'text',required:true,value:(need.conditions?.morning_dates || []).join(', ')});
    inputs.push(field('Breakfast mornings',dates,'Dates in the stay, separated by commas: YYYY-MM-DD.'));
    readConditions=()=>({...base,morning_dates:dates.value.split(',').map(v=>v.trim()).filter(Boolean),meal_request:sources.find(s=>s.id===sourceInput.value)?.fields.meal_request});
  }
  openForm('Edit '+needTitle(need).toLowerCase(),inputs,'Save need','need.save',()=>({need_id:need.id,conditions:readConditions(),source_ids:[sourceInput.value]}));
}
async function previewRequest(need, action, predecessor) {
  const args={need_id:need.id,action,...(predecessor ? {predecessor_id:predecessor.id} : {})};
  const result=await call('request.preview',args); const preview=result.preview;
  // The preview and form version are captured together. Later refreshes never
  // silently change this disclosure or turn a stale attempt into a fresh write.
  const previousVersion=version; version=result.version;
  const disclosures = Array.isArray(preview.disclosures) ? preview.disclosures : Object.entries(preview.disclosures || {}).map(([field,value])=>({field,value}));
  openForm('Review '+(action === 'cancel' ? 'cancellation' : action === 'change' ? 'change request' : 'hotel request'),[
    textBlock(action === 'cancel' ? 'Ask the hotel to cancel this service. The existing promise remains until the hotel confirms cancellation.' : 'These are the exact service details for the hotel. Sending creates a pending request; the hotel must confirm the arrangement.'),
    facts(preview.request_conditions),section('Permitted disclosure',disclosures.length ? disclosures.map(d=>metadata(({arrival_at:'Arrival time',functional_need:'Access need',meal_request:'Breakfast request'})[d.field] || human(d.field || d.name || d.source_id),d.field === 'arrival_at' ? displayTime(d.value) : d.field === 'functional_need' && d.value === 'step_free' ? 'Step-free route to lodging' : String(d.value ?? d.text ?? 'Selected service fact'))) : textBlock('Only the service conditions shown above.')),
    pendingRequest(need.id) ? textBlock('This replaces the pending request for this need. Earlier attempts and replies remain in history.') : null
  ],action === 'cancel' ? 'Send cancellation request' : 'Send to hotel','request.submit',()=>({...args,preview_token:preview.preview_token}),r=>{view='replies';selected=r.hotel_request_id;sessionStorage.setItem('stayready-view',view);sessionStorage.setItem('stayready-selected',selected);});
  version=previousVersion;
}
function withdraw(req) {
  openForm('Withdraw pending request',[textBlock('Withdraw this unanswered or unconfirmed attempt. Existing confirmed services are unchanged.'),facts(req.conditions)],'Withdraw request','request.withdraw',()=>({hotel_request_id:req.id}));
}
try {
  const token = new URLSearchParams(location.hash.slice(1)).get('access');
  if(token) {history.replaceState(null,'',location.pathname);({csrf}=await request('/session','POST',{token}));}
  else ({csrf}=await request('/session'));
  await refresh();
} catch(error) {showError(error);workspace.setAttribute('aria-busy','false');}
