import {mount,el,human} from '/shared/client.js';
// Fernshelf web page: the account holder's photo library. The shared Host supplies only the
// session and the Agent MCP connection; every record shown here is the answer of a fernshelf.*
// read on that connection, and every change is a fernshelf.* write with the version observed.
const T={
 account:'fernshelf.account.get',storage:'fernshelf.storage.summary',search:'fernshelf.items.search',get:'fernshelf.items.get',
 read:'fernshelf.items.read',albums:'fernshelf.albums.list',album:'fernshelf.albums.get',exposure:'fernshelf.exposure.get',
 removals:'fernshelf.removals.list',notifications:'fernshelf.notifications.list',
 update:'fernshelf.items.update',trash:'fernshelf.items.trash',restore:'fernshelf.items.restore',purge:'fernshelf.items.purge',
 create:'fernshelf.albums.create',edit:'fernshelf.albums.update',remove:'fernshelf.albums.delete',
 invite:'fernshelf.albums.members.invite',member:'fernshelf.albums.members.update',save:'fernshelf.albums.save_item',
 link:'fernshelf.links.create',revoke:'fernshelf.links.revoke',respond:'fernshelf.removals.respond'
};
const PAGE=200;
let ui,A={},picking=false;
const chosen=new Set();

// ---------- presentation helpers (text only; App strings never become markup) ----------
const zone=()=>A.account?.time_zone||undefined;
const fmt=(v,o)=>v&&Number.isFinite(Date.parse(v))?new Intl.DateTimeFormat('en-US',{timeZone:zone(),...o}).format(new Date(v)):'—';
const day=v=>fmt(v,{month:'short',day:'numeric',year:'numeric'});
const when=v=>fmt(v,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
const month=v=>fmt(v,{month:'long',year:'numeric'});
const size=n=>n==null?'—':n>=1e9?(n/1e9).toFixed(2)+' GB':n>=1e6?(n/1e6).toFixed(1)+' MB':n>=1e3?Math.round(n/1e3)+' KB':n+' bytes';
const plural=(n,w)=>n+' '+w+(n===1?'':'s');
const labelName=id=>A.labels?.find(l=>l.id===id)?.name||human(String(id).replace(/^pl-/,''));
const personName=id=>id===A.account?.owner_person_id?A.account.display_name+' (you)':A.people?.find(p=>p.person_id===id)?.display_name||human(id);
const placeOf=i=>typeof i.place==='string'?i.place:i.place?.label||null;
const titleOf=i=>i.caption||(i.kind==='video'?'Video':'Photo')+' · '+day(i.taken_at);
const seconds=v=>fmt(v,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit'});
// What the page says when a write or read is refused. The App's own messages are written for the
// Agent (they name IDs and arguments), so the page shows its own sentence for each error code.
const SAY={
 not_found:'That item, album or request no longer exists. Refresh to see the library as it is now.',
 not_yours:'That photo was added by another member; only they can change or remove it.',
 in_trash:'That item is in the trash. Restore it first.',
 gone:'That item has been deleted for good.',
 no_file:'There is no image file for this item.',
 not_backed_up:'That item is still waiting to back up from your phone, so it cannot go into an album yet.',
 already_in_album:'That item is already in this album.',
 not_in_album:'That item is no longer in this album.',
 not_stacked:'That item is not part of a stack.',
 already_invited:'That person is already invited to this album or a member of it.',
 not_member:'That person is no longer a member of this album.',
 not_shared:'That photo is no longer shared in this album.',
 over_quota:'There is not enough storage left. Delete items for good to free space, then try again.',
 confirm_required:'This needs your confirmation first.',
 limit_exceeded:'Choose at most 50 items at a time.',
 invalid_window:'Choose a time in the future.',
 invalid_state:'This has already changed (for example it was already answered, moved to the trash or ended). Refresh to see it as it is now.',
 invalid_arguments:'That change could not be made as entered. Check the fields and try again.',
 stale_version:'Something changed in the library since this was opened. Close it, refresh and try again.',
 idempotency_conflict:'Something changed in the library since this was opened. Close it, refresh and try again.',
 permission_denied:'This action is not available in this session.',
 not_available:'This is not available in this session.'
};
// A refusal whose own message is already plain (no IDs, no raw timestamps) keeps it: it says which field is wrong.
const plain=m=>typeof m==='string'&&!/\b(?:it|al|ln|rr|ct|pl|st|vw|ntf|person|img)-[\w-]+|\d{4}-\d\d-\d\dT|confirm: true|patch|_ids?\b/.test(m);
const say=e=>(['invalid_arguments','invalid_window'].includes(e?.code)&&plain(e.message)?e.message:SAY[e?.code])||(/locked/i.test(e?.message||'')?'The library is busy for a moment. Try again.':/fetch|network/i.test(e?.message||'')?'The connection was interrupted. Try again; nothing is done twice.':e?.message||'Something went wrong.');
const fail=e=>ui.error(Error(say(e)));
// The shared schema forms show a refusal's message as it came; this page replaces it with its own
// sentence as soon as the form marks the error with its code.
new MutationObserver(list=>{for(const m of list){const t=m.target;if(t.classList?.contains('form-error')&&t.dataset.code&&!t.closest('.fs-dialog'))t.textContent=say({code:t.dataset.code,message:t.textContent});}})
 .observe(document.body,{subtree:true,attributes:true,attributeFilter:['data-code']});
const SOURCES={camera:['Camera','Camera'],screenshot:['Screenshot','Screenshots'],download:['Download','Downloads'],saved_from_share:['Saved from a shared album','Saved from shared albums']};
const STATES={pending:'Pending',honored:'Honoured',declined:'Declined',withdrawn:'Withdrawn',active:'Active',expired:'Expired',revoked:'Revoked',
 invited:'Invited',joined:'Joined',left:'Left',removed:'Removed',trashed:'In the trash',purged:'Deleted for good',viewer:'Viewer',contributor:'Contributor'};
const stateName=k=>STATES[k]||human(k);
const HISTORY={imported:'Imported into the library',added:'Backed up from the phone',added_waiting:'Arrived; waiting to back up',backed_up:'Backed up',
 updated:'Edited',trashed:'Moved to the trash',restored:'Restored from the trash',purged:'Deleted for good',removal_honored:'Taken down after a removal request',
 saved_from_share:'Saved from a shared album'};
const FIELDS={caption:'caption',favorite:'favourite',archived:'archive',taken_at:'capture time',people:'people',cover:'stack cover',albums_cleared:'albums'};
const historyLine=h=>(HISTORY[h.action]||human(h.action))+(h.action==='updated'&&h.changes?' ('+Object.keys(h.changes).map(k=>FIELDS[k]||human(k)).join(', ')+')':'');
const row=(label,value)=>el('div',{class:'metadata-line'},el('span',{},label),el('strong',{},value==null||value===''?'—':value));
const badge=(text,kind='')=>el('span',{class:'fs-badge '+kind},text);
const button=(label,onclick,cls='')=>el('button',{type:'button',class:cls,onclick:()=>Promise.resolve().then(onclick).catch(fail)},label);
const can=name=>ui.has(name);
const record=id=>ui.records.find(r=>r.id===id);
const narrow=()=>matchMedia('(max-width:760px)').matches;
const hue=id=>{let h=0;for(const c of String(id))h=(h*31+c.charCodeAt(0))>>>0;return h%360;};

// Image bytes come only from fernshelf.items.read on the Agent connection, so a policy that
// withholds the tool, or an item the App refuses (trash, no file), shows a placeholder.
// Each MCP call costs a full state read in Core, and the Agent process answers one call at a time,
// so image reads go through a short queue (two in flight) and never hold up a click for long.
const queue=[];let inFlight=0;
// An item's image file never changes (no write replaces it, and a purged item is never read again),
// so its bytes are the one thing kept for the life of the page. Everything else is read again
// whenever the view is read again.
const images=new Map();
// While another process (Infra, another MCP client) commits, Core answers a read "App is locked;
// retry later". Reads of this page retry that answer a few times before giving up.
async function read(name,args){for(let i=0;;i++){try{return await ui.call(name,args);}catch(e){if(!/locked/i.test(e.message)||i>=5)throw e;await new Promise(r=>setTimeout(r,250*(i+1)));}}}

// ---------- versions ----------
// Core keeps one version for the whole library, and every read answers with it. `seen` is the
// version at which every list the current view shows was read: the view is read as one batch, and
// the batch is read again until all its answers carry the same version. Buttons and confirmations
// send `seen`; a form reads the record it shows when it opens and sends that read's version. So a
// write never pairs values read at one version with a newer version, and if anything committed
// since, Core refuses it (stale_version) and the page says so. A later read that answers with a
// newer version than `seen` means the view is out of date, and the page reads the whole view again.
let seen=null,loadingView=false,writing=false,staleTimer=null,picked=null;
const same=(a,b)=>!!a&&!!b&&a.epoch===b.epoch&&a.revision===b.revision;
const newer=(v,than)=>!!v&&!!than&&(v.epoch>than.epoch||(v.epoch===than.epoch&&v.revision>than.revision));
function noticed(version){
 if(loadingView||writing||staleTimer||!newer(version,seen))return;
 // The item the person last opened stays open, even if its panel had not finished loading.
 staleTimer=setTimeout(()=>{staleTimer=null;if(!loadingView&&!writing)ui.refresh(picked||ui.selected?.id).catch(fail);},0);
}
// A read made after the view was drawn (images, "who can see this", album covers, form contents).
const look=(name,args)=>read(name,args).then(r=>{noticed(r.version);return r;});
function later(job,first=false){return new Promise((resolve,reject)=>{queue[first?'unshift':'push']({job,resolve,reject});pump();});}
function pump(){while(inFlight<2&&queue.length){const {job,resolve,reject}=queue.shift();inFlight++;job().then(resolve,reject).finally(()=>{inFlight--;pump();});}}
const observer=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting){observer.unobserve(e.target);e.target.loadImage?.();}},{rootMargin:'200px'});
function media(item,{large=false,known=true}={}){
 const box=el('div',{class:'fs-media'+(large?' large':''),'data-kind':item.kind});
 box.style.setProperty('--h',hue(item.id));
 const note=item.state==='trashed'?'In the trash':item.backed_up===false?'Waiting to back up':item.kind==='video'?'Video · metadata only':'No image file';
 const hasFile=item.has_file??(item.file?true:!known),reading=hasFile&&item.state!=='trashed'&&item.state!=='purged'&&can(T.read);
 box.append(el('span',{class:'fs-glyph','aria-hidden':'true'},item.kind==='video'?'▶':'◧'));
 if(large)box.append(el('small',{},reading?'Loading image…':note));
 else if(item.caption||placeOf(item))box.append(el('span',{class:'fs-caption'},item.caption||placeOf(item)));
 if(reading){
  const show=img=>{box.replaceChildren(el('img',{src:img.url,alt:item.caption||titleOf(item),'data-sha256':img.sha256}));box.classList.add('loaded');};
  box.loadImage=()=>(images.has(item.id)?Promise.resolve(images.get(item.id)):later(()=>box.isConnected?look(T.read,{id:item.id}):Promise.resolve(null),large).then(r=>{
   if(!r)return null;
   const bytes=Uint8Array.from(atob(r.file.base64),c=>c.charCodeAt(0)),img={url:URL.createObjectURL(new Blob([bytes],{type:r.file.mime_type})),sha256:r.file.sha256};
   images.set(item.id,img);return img;
  })).then(img=>{if(img)show(img);})
   .catch(e=>{box.dataset.refused=e.code||'unavailable';const small=box.querySelector('small');if(small)small.textContent=e.code==='no_file'?note:'Image not available';});
  // Observe once the box is in the page; boxes observed before insertion were not reported.
  if(large||images.has(item.id))box.loadImage();else requestAnimationFrame(()=>{if(box.isConnected)observer.observe(box);});
 }
 return box;
}
function tile(item,{selectable=true,label,known=true}={}){
 const b=el('button',{type:'button',class:'record fs-tile'+(chosen.has(item.id)?' chosen':''),'data-record-id':item.id,'aria-pressed':String(item.id===ui.selected?.id),
  'aria-label':label||titleOf(item),title:label||titleOf(item),onclick:()=>{
   if(picking&&selectable){chosen.has(item.id)?chosen.delete(item.id):chosen.add(item.id);b.classList.toggle('chosen');updateBulk();return;}
   picked=item.id;ui.select(item.id).then(()=>{if(narrow())document.querySelector('.detail')?.scrollIntoView({behavior:'smooth'});}).catch(fail);
  }},media(item,{known}));
 const marks=el('span',{class:'fs-marks'});
 if(item.favorite)marks.append(badge('♥','fav'));
 if(item.stack_size>1)marks.append(badge('⧉ '+item.stack_size));
 if(item.backed_up===false)marks.append(badge('Waiting'));
 if(item.kind==='video')marks.append(badge('▶'));
 b.append(marks,el('span',{class:'fs-check','aria-hidden':'true'},'✓'));
 return b;
}

// ---------- dialogs ----------
// Fernshelf's forms show only the fields a person fills in; record IDs, decisions and other fixed
// arguments are set by the button that opened the form and are never fields. Each form first reads
// the record it shows, fills its fields from that read and sends that read's version, so a change
// committed after the form opened is refused as stale and never overwritten. A form is offered only
// when the live Agent discovery lists its tool; a field a task policy denies is refused by Core
// (permission_denied) and the form says so.
const localInput=v=>{if(!v)return '';const d=new Date(v);return new Date(d-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
const YESNO=[{value:'true',label:'Yes'},{value:'false',label:'No'}];
const ROLES=[{value:'viewer',label:'Viewer'},{value:'contributor',label:'Contributor'}];
function input(f){
 let n;const key=f.path||f.key;
 if(f.type==='select'){n=el('select',{'data-field':key,required:!!f.required});for(const o of f.options)n.append(el('option',{value:o.value},o.label));if(f.value!=null)n.value=String(f.value);}
 else if(f.type==='datetime'){n=el('input',{type:'datetime-local','data-field':key});n.value=localInput(f.value);}
 else{n=el(f.type==='textarea'?'textarea':'input',{...(f.type==='textarea'?{rows:3}:{type:'text'}),'data-field':key,required:!!f.required,maxlength:f.max});n.value=f.value??'';}
 return n;
}
// open({title, submit, tool, load, fields, args}): `load` reads what the form shows and returns
// {version, ...}; `fields(got)` lists the fields; `args(values, got)` builds the write.
async function openForm({title,submit,tool,load,fields,args,intro}){
 const got=await load();
 const list=fields(got),inputs={};
 const body=[...(intro?[intro(got)]:[]),...list.map(f=>{const n=inputs[f.key]=input(f);return el('label',{class:'field'},el('span',{},f.label+(f.required?' *':'')),f.help?el('small',{},f.help):null,n);})];
 const d=dialog(title,body,{confirm:submit,run:async()=>{
  const values={};
  for(const [k,n] of Object.entries(inputs))values[k]=n.type==='datetime-local'?(n.value?new Date(n.value).toISOString():''):n.value;
  await write(tool,args(values,got),{version:got.version});
 }});
 d.querySelector('[data-field]')?.focus();
 return d;
}
// The forms. Each names its record through the button that opened it.
const albumNow=async id=>{const r=await look(T.album,{id});return {version:r.version,album:r.album};};
const memberNow=(a,personId)=>a.members.find(m=>m.person_id===personId);
const noChange=()=>{throw Error('No changes to save.');};
function editDetails(id){
 return openForm({title:'Edit details',submit:'Save',tool:T.update,
  load:async()=>{const r=await look(T.get,{id});return {version:r.version,item:r.item};},
  fields:({item})=>[
   {key:'caption',path:'patch.caption',label:'Caption',type:'textarea',max:2000,value:item.caption,help:'Leave empty to remove the caption.'},
   {key:'favorite',path:'patch.favorite',label:'Favourite',type:'select',options:YESNO,value:item.favorite},
   {key:'archived',path:'patch.archived',label:'Archived',type:'select',options:YESNO,value:item.archived},
   {key:'taken_at',path:'patch.taken_at',label:'Corrected capture time',type:'datetime',value:item.taken_at,help:'Currently '+when(item.taken_at)+'. In your browser’s local time.'}],
  args:(v,{item})=>{
   const patch={};
   if('caption' in v){const c=v.caption.trim()||null;if(c!==item.caption)patch.caption=c;}
   for(const k of ['favorite','archived'])if(k in v&&(v[k]==='true')!==item[k])patch[k]=v[k]==='true';
   if(v.taken_at&&Math.floor(Date.parse(v.taken_at)/60000)!==Math.floor(Date.parse(item.taken_at)/60000))patch.taken_at=v.taken_at;
   if(!Object.keys(patch).length)noChange();
   return {id,patch};
  }});
}
function renameAlbum(id){
 return openForm({title:'Rename album',submit:'Rename',tool:T.edit,load:()=>albumNow(id),
  fields:({album})=>[{key:'title',label:'Album title',max:120,value:album.title,required:true}],
  args:(v,{album})=>{const title=v.title.trim();if(!title)throw Error('Enter a title.');if(title===album.title)noChange();return {id,title};}});
}
function invite(id){
 return openForm({title:'Invite to an album',submit:'Send invitation',tool:T.invite,load:()=>albumNow(id),
  intro:({album})=>el('p',{class:'muted'},'Invite someone to “'+album.title+'”. Viewers see the album; contributors can also add their own photos.'),
  fields:({album})=>{const current=new Set(album.members.filter(m=>['invited','joined'].includes(m.status)).map(m=>m.person_id));
   return [{key:'person_id',label:'Person',type:'select',required:true,options:(A.people||[]).filter(p=>!current.has(p.person_id)&&p.person_id!==A.account?.owner_person_id).map(p=>({value:p.person_id,label:p.display_name}))},
    {key:'role',label:'Role',type:'select',required:true,options:ROLES,value:'viewer'}];},
  args:v=>{if(!v.person_id)throw Error('Everyone you know is already invited.');return {id,person_id:v.person_id,role:v.role};}});
}
function changeRole(id,personId){
 return openForm({title:'Change role',submit:'Save role',tool:T.member,load:()=>albumNow(id),
  intro:({album})=>el('p',{class:'muted'},(memberNow(album,personId)?.display_name||personName(personId))+' in “'+album.title+'”.'),
  fields:({album})=>[{key:'role',label:'Role',type:'select',required:true,options:ROLES,value:memberNow(album,personId)?.role}],
  args:(v,{album})=>{if(v.role===memberNow(album,personId)?.role)noChange();return {id,person_id:personId,role:v.role};}});
}
function createLink(id){
 return openForm({title:'Create a link',submit:'Create link',tool:T.link,load:()=>albumNow(id),
  intro:({album})=>el('p',{class:'muted'},'Anyone with the link can see “'+album.title+'” until it expires or you revoke it.'),
  fields:()=>[{key:'expires_at',label:'Expires',type:'datetime',help:'Leave empty for a link that does not expire. In your browser’s local time.'}],
  args:v=>({id,...(v.expires_at?{expires_at:v.expires_at}:{})})});
}
function answer(id,decision){
 return openForm({title:decision==='honor'?'Honour this request':'Decline this request',submit:decision==='honor'?'Honour request':'Decline request',tool:T.respond,
  load:async()=>{const r=await look(T.removals,{});return {version:r.version,request:r.removals.find(x=>x.id===id)};},
  intro:({request})=>el('p',{class:'muted'},request?(request.from.display_name+' asked '+when(request.requested_at)+'. '+(decision==='honor'?'Honouring takes the photos down from the albums and links the request covers.':'Declining leaves the photos where they are.')):'This request no longer exists.'),
  fields:()=>[{key:'note',label:'Note to the requester',type:'textarea',max:2000,help:'Optional. Kept with your answer.'}],
  args:v=>({id,decision,...(v.note?.trim()?{note:v.note.trim()}:{})})});
}
function dialog(title,body,{confirm,danger=false,run}={}){
 const error=el('p',{role:'alert',class:'form-error'});
 const d=el('dialog',{class:'fs-dialog','aria-label':title});
 const done=el('button',{type:'button',onclick:()=>d.close()},confirm?'Cancel':'Close');
 const actions=el('div',{class:'form-actions'},done);
 if(confirm){
  const go=el('button',{type:'submit',class:danger?'primary danger':'primary'},confirm);
  actions.append(go);
  go.addEventListener('click',async()=>{
   go.disabled=true;error.textContent='';delete error.dataset.code;
   try{await run(d);d.close();}catch(e){error.textContent=e.say||say(e);error.dataset.code=e.code||'request_failed';}
   finally{go.disabled=false;}
  });
 }
 d.append(el('h2',{},title),el('div',{class:'fs-dialog-body'},body),error,actions);
 d.addEventListener('close',()=>d.remove());document.body.append(d);d.showModal();
 return d;
}
// A write sends the version of the view (or of the form's own read) and reuses its request ID if the
// same change is retried after a failure, so a write whose answer was lost commits once. After a
// write the whole view is read again.
const pendingWrites=new Map();
async function write(name,args,{version=seen,keepId=ui.selected?.id}={}){
 if(writing)throw Error('Another change is still being saved.');
 if(!version)throw Object.assign(Error('stale'),{code:'stale_version'});
 const payload={...structuredClone(args),expected_version:structuredClone(version)},key=name+JSON.stringify(payload);
 if(!pendingWrites.has(key))pendingWrites.set(key,'web-'+crypto.randomUUID());
 payload.request_id=pendingWrites.get(key);
 const app=document.querySelector('#app');
 writing=true;app.setAttribute('aria-busy','true');
 let result;
 try{result=await ui.call(name,payload);pendingWrites.delete(key);}
 catch(e){app.setAttribute('aria-busy','false');throw e;}
 finally{writing=false;}
 await ui.refresh(keepId);
 report(name,args,result);
 return result;
}
function report(name,args,result){
 const parts=[];
 if(result.warnings?.length)parts.push(el('h3',{},'Shown again to people who asked for removal'),el('ul',{class:'fs-list'},result.warnings.map(w=>el('li',{},
  personName(w.person_id)+' asked for “'+labelFor(w.item_id)+'” to be taken down, and that was honoured on '+day(w.honored_at)+'. This change shows it to people again.'))));
 if(name===T.respond&&args.decision==='honor'){
  parts.push(el('h3',{},'Taken down'),el('ul',{class:'fs-list'},result.cleared.length?result.cleared.map(c=>el('li',{},labelFor(c.item_id)+' — removed from '+plural(c.album_ids.length,'album')+(c.link_ids.length?' and '+plural(c.link_ids.length,'link'):''))):el('li',{},'Nothing was shared, so nothing had to be removed.')));
  if(result.not_removable.length)parts.push(el('h3',{},'Not yours to remove'),el('ul',{class:'fs-list'},result.not_removable.map(id=>el('li',{},contributionLabel(id)+': only the member who added it can take it down.'))));
  const seen=result.already_seen.filter(s=>s.views.length||s.saves.length);
  if(seen.length)parts.push(el('h3',{},'Already seen — cannot be called back'),el('ul',{class:'fs-list'},seen.map(s=>el('li',{},labelFor(s.item_id)+': '+plural(s.views.length,'view')+', '+plural(s.saves.length,'save')+' by '+[...new Set([...s.views,...s.saves].map(v=>v.viewer?.display_name||'someone with the link'))].join(', ')))));
 }
 if(name===T.purge&&result.freed_bytes!=null)parts.push(el('p',{},size(result.freed_bytes)+' freed.'));
 if(parts.length)dialog(name===T.respond?'Request honoured':'Saved — please note',parts);
}
const labelFor=id=>{const r=record(id);return r?titleOf(r):'a version inside a stack';};
// A member's contribution, named by who added it and its caption (from album details read on this page).
function contributionLabel(id){
 for(const a of Object.values(A.details||{})){const k=a.contributions.find(x=>x.id===id);if(k)return 'Photo from '+personName(k.person_id)+(k.caption?' (“'+k.caption+'”)':'')+' in '+a.title;}
 return 'A photo another member added';
}
const albumTitle=id=>A.albums?.find(a=>a.id===id)?.title||A.details?.[id]?.title||'an album that was later deleted';

function chooseAlbum(ids){
 const albums=A.albums.filter(a=>!a.deleted_at);
 const list=el('div',{class:'fs-choices'});
 const d=dialog('Add '+plural(ids.length,'item')+' to an album',[list]);
 for(const a of albums)list.append(el('button',{type:'button',class:'fs-choice',onclick:async()=>{
  try{await write(T.edit,{id:a.id,add_ids:ids});d.close();leavePicking();}
  catch(e){d.querySelector('.form-error').textContent=say(e);d.querySelector('.form-error').dataset.code=e.code||'request_failed';}
 }},el('strong',{},a.title),el('small',{},plural(a.item_count,'item')+' · '+(a.state==='shared'?'Shared':'Private'))));
 if(!albums.length)list.append(el('p',{class:'muted'},'No albums yet. Create one first.'));
}
function pickItems(album){
 const inAlbum=new Set(A.details[album.id]?.entries.map(e=>e.id));
 const pool=ui.records.filter(r=>r.state==='active'&&!inAlbum.has(r.id));
 const picked=new Set(),grid=el('div',{class:'fs-grid compact'}),count=el('small',{},'0 selected');
 const filter=el('input',{type:'search',placeholder:'Filter by caption, place or date','aria-label':'Filter photos'});
 const draw=()=>{grid.replaceChildren();const q=filter.value.toLowerCase();
  for(const r of pool.filter(r=>!q||[r.caption,r.place,day(r.taken_at)].join(' ').toLowerCase().includes(q)).slice(0,120)){
   const b=el('button',{type:'button',class:'fs-tile'+(picked.has(r.id)?' chosen':''),'data-pick-id':r.id,'aria-label':titleOf(r),title:titleOf(r),onclick:()=>{picked.has(r.id)?picked.delete(r.id):picked.add(r.id);b.classList.toggle('chosen');count.textContent=picked.size+' selected';}},media(r),el('span',{class:'fs-check','aria-hidden':'true'},'✓'));
   grid.append(b);}};
 filter.addEventListener('input',draw);draw();
 dialog('Add to “'+album.title+'”',[filter,count,grid],{confirm:'Add to album',run:async()=>{if(!picked.size)throw Error('Choose at least one item.');await write(T.edit,{id:album.id,add_ids:[...picked]});}})
  .classList.add('wide');
}

// ---------- multi-select ----------
const bulkBar=el('div',{class:'fs-bulk'});
function leavePicking(){picking=false;chosen.clear();ui.navigate(ui.section).catch(fail);}
function updateBulk(){
 bulkBar.replaceChildren();
 const ids=[...chosen],trash=ui.section==='trash';
 if(!picking){bulkBar.append(button('Select',()=>{picking=true;chosen.clear();return ui.navigate(ui.section);}));return;}
 bulkBar.append(el('strong',{},ids.length+' selected'));
 if(trash){
  if(can(T.restore))bulkBar.append(button('Restore',()=>ids.length&&write(T.restore,{ids}).then(leavePicking)));
  if(can(T.purge))bulkBar.append(button('Delete forever',()=>ids.length&&confirmPurge(ids),'danger'));
 }else{
  if(can(T.edit))bulkBar.append(button('Add to album',()=>ids.length&&chooseAlbum(ids)));
  if(can(T.trash))bulkBar.append(button('Move to trash',()=>ids.length&&write(T.trash,{ids}).then(leavePicking)));
 }
 bulkBar.append(button('Cancel',leavePicking,'quiet'));
}
const bulkWrites=()=>ui.section==='trash'?can(T.restore)||can(T.purge):can(T.edit)||can(T.trash);
function confirmPurge(ids){
 dialog('Delete forever?',[el('p',{},plural(ids.length,'item')+' will be deleted for good and their space freed. This cannot be undone.')],
  {confirm:'Delete forever',danger:true,run:async()=>{await write(T.purge,{ids,confirm:true});picking=false;chosen.clear();}});
}

// ---------- list pane views ----------
function grid(items,{group=true}={}){
 const wrap=el('div',{class:'fs-grid-wrap'});let current=null,g=null;
 for(const item of items){
  const m=month(item.taken_at);
  if(!g||(group&&m!==current)){current=m;if(group)wrap.append(el('h3',{class:'fs-month'},m));g=el('div',{class:'fs-grid'});wrap.append(g);}
  g.append(tile(item));
 }
 return wrap;
}
function libraryView(shown,ui){
 const head=el('div',{class:'fs-head'});
 const notes={photos:'Newest first. Stacks of edits, bursts and duplicates show their cover.',favorites:'Items you marked as favourites.',archive:'Archived items stay in albums and shares but leave the main view.',
  trash:'Items here still count against your storage. Each is deleted for good '+(A.account?.trash_retention_days??30)+' days after it was moved here.',
  storage:''};
 head.append(el('p',{class:'muted'},notes[ui.section]||''));
 if(bulkWrites()){updateBulk();head.append(bulkBar);}
 const body=el('div',{});
 if(!shown.length)body.append(el('div',{class:'empty'},el('h3',{},ui.section==='trash'?'Trash is empty':'Nothing here'),el('p',{},'Items appear here as you use the library.')));
 else body.append(grid(shown));
 return el('div',{class:'fs-pane'+(picking?' picking':'')},head,body);
}
function albumsView(){
 const cards=el('div',{class:'fs-albums'});
 for(const a of A.albums.filter(a=>!a.deleted_at)){
  cards.append(el('button',{type:'button',class:'fs-album-card','data-album-id':a.id,onclick:()=>openAlbum(a.id)},
   cover(a),
   el('strong',{},a.title),
   el('small',{},plural(a.item_count,'item')+(a.contribution_count?' · '+a.contribution_count+' from members':'')),
   el('span',{class:'fs-album-state'},a.state==='shared'?badge('Shared · '+a.members.joined+' joined'+(a.members.invited?', '+a.members.invited+' invited':''),'shared'):badge('Private'),a.active_links.length?badge('Link on','link'):null)));
 }
 if(!cards.children.length)cards.append(el('div',{class:'empty'},el('h3',{},'No albums yet'),el('p',{},'Create an album to collect photos and share them.')));
 return el('div',{class:'fs-pane'},el('div',{class:'fs-head'},el('p',{class:'muted'},'Albums hold items from your library; sharing an album shows its items to its members and to anyone with an active link.')),cards);
}
// An album card shows its first item that has an image; the album is read when the card scrolls
// into view, so opening the Albums view costs no extra call up front. The chosen cover is kept only
// until the view is read again.
const covers=new Map();
function cover(a){
 const box=el('div',{class:'fs-media empty-album'},el('span',{class:'fs-glyph','aria-hidden':'true'},'▣'));
 if(!a.item_count||!can(T.album))return box;
 const put=id=>{const r=id&&record(id);if(r&&box.isConnected)box.replaceWith(media(r));};
 if(covers.has(a.id)){requestAnimationFrame(()=>put(covers.get(a.id)));return box;}
 box.loadImage=()=>later(()=>look(T.album,{id:a.id}).then(r=>r.album)).then(d=>{
  const first=d.entries.find(e=>e.mine&&record(e.id)?.has_file);covers.set(a.id,first?first.id:null);put(first?.id);
 }).catch(e=>{box.dataset.refused=e.code||'unavailable';box.title='Cover not available';});
 requestAnimationFrame(()=>{if(box.isConnected)observer.observe(box);});
 return box;
}
const openAlbum=id=>{picking=false;chosen.clear();return ui.navigate('album:'+id);};
function memberRow(album,m){
 const active=['invited','joined'].includes(m.status);
 return el('li',{class:'fs-person'},el('span',{class:'avatar small','aria-hidden':'true'},(m.display_name||'?').split(' ').map(x=>x[0]).join('').slice(0,2)),
  el('div',{},el('strong',{},m.display_name||personName(m.person_id)),el('small',{},stateName(m.role)+' · '+stateName(m.status)+(m.status==='joined'?' '+day(m.joined_at):m.status==='invited'?' '+day(m.invited_at):m.ended_at?' '+day(m.ended_at):''))),
  active&&can(T.member)?el('span',{class:'fs-row-actions'},
   button('Change role',()=>changeRole(album.id,m.person_id),'quiet'),
   button('Remove',()=>dialog('Remove '+(m.display_name||m.person_id)+'?',[el('p',{},'They will stop seeing “'+album.title+'”. Anything they contributed leaves the album. Views and saves they already made stay recorded.')],
    {confirm:'Remove member',danger:true,run:()=>write(T.member,{id:album.id,person_id:m.person_id,remove:true})}),'quiet danger')):null);
}
function linkRow(l){
 return el('li',{class:'fs-person'},el('span',{class:'avatar small fs-link-icon','aria-hidden':'true'},'↗'),
  el('div',{},el('strong',{},'Link · '+stateName(l.state)),el('small',{},'Created '+day(l.created_at)+(l.expires_at?' · expires '+when(l.expires_at):' · no expiry')+(l.revoked_at?' · revoked '+day(l.revoked_at):'')+' · '+plural(l.views.length,'view')+', '+plural(l.views.reduce((n,v)=>n+v.saved_item_ids.length,0),'save'))),
  l.state==='active'&&can(T.revoke)?el('span',{class:'fs-row-actions'},button('Revoke',()=>dialog('Revoke this link?',[el('p',{},'Nobody will be able to open the album with this link any more. Views and saves already recorded stay recorded.')],{confirm:'Revoke link',danger:true,run:()=>write(T.revoke,{id:l.id})}),'quiet danger')):null);
}
function albumView(id){
 const a=A.details[id];if(!a)return el('div',{class:'empty'},el('h3',{},'Album not found'));
 const summary=A.albums.find(x=>x.id===id);
 const tools=el('div',{class:'fs-toolbar'});
 if(can(T.edit))tools.append(button('Add items',()=>pickItems(a),'primary'),button('Rename',()=>renameAlbum(id)));
 if(can(T.invite))tools.append(button('Invite',()=>invite(id)));
 if(can(T.link))tools.append(button('Create link',()=>createLink(id)));
 if(can(T.remove))tools.append(button('Delete album',()=>deleteAlbum(a,summary),'danger quiet'));
 const members=a.members.filter(m=>['invited','joined'].includes(m.status)),past=a.members.filter(m=>!['invited','joined'].includes(m.status));
 const sharing=el('div',{class:'fs-sharing'},
  el('section',{},el('h3',{},'Members'),members.length?el('ul',{class:'fs-people'},members.map(m=>memberRow(a,m))):el('p',{class:'muted'},'Not shared with anyone.'),
   past.length?el('details',{},el('summary',{},plural(past.length,'former member')),el('ul',{class:'fs-people'},past.map(m=>memberRow(a,m)))):null),
  el('section',{},el('h3',{},'Links'),a.links.length?el('ul',{class:'fs-people'},a.links.map(linkRow)):el('p',{class:'muted'},'No links.')));
 const g=el('div',{class:'fs-grid'});
 for(const e of a.entries){
  if(e.mine){g.append(record(e.id)?tile(record(e.id)):tile({...e,state:'active'},{known:false}));continue;}
  const c=a.contributions.find(x=>x.id===e.id)||e;
  const b=el('button',{type:'button',class:'fs-tile contribution','data-contribution-id':e.id,'aria-label':'From '+personName(c.person_id)+': '+(c.caption||'untitled'),title:'From '+personName(c.person_id),onclick:()=>contribution(a,c)},
   media({...c,has_file:false}),el('span',{class:'fs-marks'},badge('From '+personName(c.person_id).split(' ')[0],'member')));
  g.append(b);
 }
 const hidden=a.hidden_item_ids.length?el('p',{class:'muted'},plural(a.hidden_item_ids.length,'item')+' of this album '+(a.hidden_item_ids.length===1?'is':'are')+' in the trash and hidden until restored.'):null;
 return el('div',{class:'fs-pane'},el('div',{class:'fs-album-head'},
   el('p',{class:'fs-album-meta','data-album-title':a.title},(a.state==='shared'?'Shared':'Private')+' · created '+day(a.created_at)),tools),
  sharing,a.entries.length?g:el('div',{class:'empty'},el('h3',{},'This album is empty'),el('p',{},can(T.edit)?'Use “Add items” to fill it.':'')),hidden);
}
function deleteAlbum(a,summary){
 const seen=a.members.some(m=>m.status==='joined')||a.links.some(l=>l.state==='active');
 const box=el('input',{type:'checkbox',id:'fs-confirm-delete'});
 dialog('Delete “'+a.title+'”?',[el('p',{},'The album goes away; its items stay in your library.'),
  seen?el('label',{class:'fs-check-line'},box,el('span',{},'Also end access for '+plural(a.members.filter(m=>m.status==='joined').length,'joined member')+' and '+plural(summary?.active_links.length||0,'active link')+'.')):null],
  {confirm:'Delete album',danger:true,run:async()=>{
   try{await write(T.remove,{id:a.id,...(box.checked?{confirm:true}:{})});}
   catch(e){if(e.code==='confirm_required')e.say='“'+a.title+'” is still shared. Tick “Also end access” to delete it and end that access, or cancel.';throw e;}
   await ui.navigate('albums');}});
}
function contribution(a,c){
 const area=el('div',{class:'fs-exposure'},el('p',{class:'muted'},'Checking who can see it…'));
 const body=[media({...c,has_file:false},{large:true}),
  row('From',personName(c.person_id)),row('Caption',c.caption||'—'),row('Taken',when(c.taken_at)),row('Place',placeOf(c)),
  row('People',(c.people||[]).map(labelName).join(', ')||'—'),row('Size',size(c.declared_bytes)),row('Added',when(c.added_at)),area];
 const d=dialog('Shared by '+personName(c.person_id),body,can(T.save)?{confirm:'Save to my library',run:()=>write(T.save,{id:a.id,item_id:c.id})}:{});
 if(can(T.exposure))look(T.exposure,{id:c.id}).then(x=>{if(d.isConnected)area.replaceChildren(exposureView(x));}).catch(e=>area.replaceChildren(el('p',{class:'muted'},say(e))));
 else area.remove();
}
function sharingView(){
 const list=el('div',{class:'fs-cards'});
 for(const s of A.albums.filter(a=>!a.deleted_at)){
  const a=A.details[s.id];if(!a)continue;
  const members=a.members.filter(m=>['invited','joined'].includes(m.status)),links=a.links.filter(l=>l.state==='active');
  if(!members.length&&!links.length)continue;
  list.append(el('article',{class:'fs-card'},el('div',{class:'fs-card-head'},el('h3',{},a.title),button('Open album',()=>openAlbum(a.id),'quiet')),
   el('ul',{class:'fs-people'},members.map(m=>memberRow(a,m)),links.map(linkRow))));
 }
 if(!list.children.length)list.append(el('div',{class:'empty'},el('h3',{},'Nothing is shared'),el('p',{},'Invite people to an album or create a link to share it.')));
 return el('div',{class:'fs-pane'},el('div',{class:'fs-head'},el('p',{class:'muted'},'Everyone who can see something of yours right now: joined members see an album, and anyone holding an active link sees it too. Invited people see nothing until they join.')),list);
}
function requestsView(){
 const order={pending:0,declined:1,honored:2,withdrawn:3};
 const list=el('div',{class:'fs-cards'});
 for(const r of [...A.removals].sort((a,b)=>order[a.state]-order[b.state]||Date.parse(b.requested_at)-Date.parse(a.requested_at))){
  const items=el('div',{class:'fs-grid small'});
  // A named item that a search row does not show (a stack version that is not the cover) is
  // still mine and opens in the photo panel; other members' items are listed as not mine.
  for(const i of r.items){const rec=record(i.id);items.append(rec?tile(rec):i.mine&&i.state!=='purged'?tile({id:i.id,state:i.state},{known:false,label:'Another version inside a stack'}):
   el('span',{class:'fs-chip'},i.mine?'A photo deleted for good':contributionLabel(i.id)+' · not yours to remove'));}
  const actions=el('div',{class:'fs-toolbar'});
  if(['pending','declined'].includes(r.state)&&can(T.respond)){
   actions.append(button('Honour…',()=>answer(r.id,'honor'),'primary'));
   if(r.state==='pending')actions.append(button('Decline…',()=>answer(r.id,'decline')));
  }
  list.append(el('article',{class:'fs-card request '+r.state,'data-request-id':r.id},
   el('div',{class:'fs-card-head'},el('h3',{},r.from.display_name),badge(stateName(r.state),r.state)),
   el('small',{},'Asked '+when(r.requested_at)+' · '+(r.scope.type==='album'?'from “'+(r.scope_album_title||albumTitle(r.scope.album_id))+'”':'from everywhere it is shared')),
   el('blockquote',{},r.message||'No message.'),items,
   (r.not_removable||[]).length?el('p',{class:'muted'},plural(r.not_removable.length,'item')+' named here belong'+(r.not_removable.length===1?'s':'')+' to other members and cannot be removed by you.'):null,
   (r.answers||[]).length?el('ul',{class:'fs-list'},(r.answers||[]).map(x=>el('li',{},({honor:'Honoured',decline:'Declined'}[x.decision]||human(x.decision))+' '+when(x.at)+(x.note?' — “'+x.note+'”':'')))):null,
   r.state==='withdrawn'?el('p',{class:'muted'},'Withdrawn '+when(r.withdrawn_at)+(r.withdraw_message?' — “'+r.withdraw_message+'”':'')):null,
   (r.cleared||[]).length?el('p',{class:'muted'},'Taken down from '+[...new Set((r.cleared||[]).flatMap(c=>c.album_ids))].map(albumTitle).join(', ')+'.'):null,
   actions));
 }
 if(!list.children.length)list.append(el('div',{class:'empty'},el('h3',{},'No removal requests')));
 return el('div',{class:'fs-pane'},el('div',{class:'fs-head'},el('p',{class:'muted'},'People can ask for photos of them to be taken down. Select a photo to see exactly where it is visible before you answer.')),list);
}
function storageView(){
 const s=A.storage;if(!s)return el('div',{class:'empty'},el('h3',{},'Storage is not available'));
 const bar=el('div',{class:'fs-meter',role:'meter','aria-valuemin':'0','aria-valuemax':'100','aria-valuenow':String(s.used_percent),'aria-label':'Storage used'},el('span',{class:'used'}),el('span',{class:'trash'}));
 bar.firstChild.style.width=Math.min(100,s.used_bytes/s.quota_bytes*100)+'%';bar.lastChild.style.width=Math.min(100,s.trash_bytes/s.quota_bytes*100)+'%';
 const largest=s.largest_items.map(x=>record(x.id)).filter(Boolean),dups=s.duplicate_item_ids.map(record).filter(Boolean);
 return el('div',{class:'fs-pane'+(picking?' picking':'')},
  el('article',{class:'fs-card storage'},el('div',{class:'fs-card-head'},el('h3',{},(A.account?.plan||'Storage')),el('strong',{},s.used_percent+'% used')),bar,
   el('p',{},size(s.used_bytes)+' of '+size(s.quota_bytes)+' used · '+size(s.free_bytes)+' free'),
   el('div',{class:'fs-stats'},
    el('div',{},el('small',{},'In the trash'),el('strong',{},size(s.trash_bytes))),
    el('div',{},el('small',{},'Waiting to back up'),el('strong',{},s.pending_items?plural(s.pending_items,'item')+' · '+size(s.pending_bytes):'Nothing')),
    el('div',{},el('small',{},'Duplicates'),el('strong',{},size(s.duplicate_bytes))),
    ...Object.entries(s.by_kind).map(([k,v])=>el('div',{},el('small',{},{photo:'Photos',video:'Videos'}[k]||human(k)),el('strong',{},size(v)))),
    ...Object.entries(s.by_source).map(([k,v])=>el('div',{},el('small',{},SOURCES[k]?.[1]||human(k)),el('strong',{},size(v))))),
   el('p',{class:'muted'},'Only deleting items for good frees space. Moving them to the trash does not.')),
  el('div',{class:'fs-head'},bulkWrites()?(updateBulk(),bulkBar):null),
  el('h3',{class:'fs-month'},'Largest items'),largest.length?grid(largest,{group:false}):el('p',{class:'muted fs-pad'},'None.'),
  el('h3',{class:'fs-month'},'Duplicate copies'),dups.length?grid(dups,{group:false}):el('p',{class:'muted fs-pad'},'No duplicates found.'));
}
// Notices from the last 90 days (counted back from the newest) are listed; older ones, which go
// back to when the account was opened, sit under one collapsed "Earlier" entry.
const RECENT_DAYS=90;
function activityView(){
 const list=el('div',{class:'fs-cards'});
 const target=n=>n.object_type==='album'&&A.albums.some(a=>a.id===n.object_id&&!a.deleted_at)?'album:'+n.object_id:n.object_type==='removal_request'?'requests':n.kind==='storage.threshold'?'storage':null;
 const notice=n=>{const to=target(n);
  return el('article',{class:'fs-card notice '+n.kind.replace('.','-')},el('div',{class:'fs-card-head'},el('h3',{},n.title),el('time',{},when(n.at))),el('p',{},n.body),
   to?button(to==='requests'?'Open requests':to==='storage'?'Open storage':'Open album',()=>{picking=false;return ui.navigate(to);},'quiet'):null);};
 const all=[...A.notifications].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
 const since=all.length?Date.parse(all[0].at)-RECENT_DAYS*864e5:0,recent=all.filter(n=>Date.parse(n.at)>=since),older=all.filter(n=>Date.parse(n.at)<since);
 list.append(...recent.map(notice));
 if(older.length)list.append(el('details',{class:'fs-earlier'},el('summary',{},'Earlier · '+plural(older.length,'notice')+' since '+month(older[older.length-1].at)),el('div',{class:'fs-cards nested'},older.map(notice))));
 if(!list.children.length)list.append(el('div',{class:'empty'},el('h3',{},'No activity yet')));
 return el('div',{class:'fs-pane'},el('div',{class:'fs-head'},el('p',{class:'muted'},'What members, link viewers, requesters and your devices did. Your own changes are not listed here.')),list);
}

// ---------- detail pane ----------
function exposureView(x){
 const out=el('div',{});
 if(!x.visible&&!x.albums.length&&!x.returns_on_restore.length)out.append(el('p',{},x.state==='trashed'?'In the trash: nobody can see it.':'Only you can see it.'));
 if(x.visible)out.append(el('p',{},'Visible now to '+(x.visible_to.length?x.visible_to.map(personName).join(', '):'nobody by name')+(x.albums.some(a=>a.links.length)?' and anyone with a link':'')+'.'));
 for(const a of x.albums)out.append(el('div',{class:'fs-surface'},el('strong',{},a.title),el('small',{},
  [a.members.filter(m=>m.status==='joined').length?'joined: '+a.members.filter(m=>m.status==='joined').map(m=>m.display_name).join(', '):null,
   a.members.filter(m=>m.status==='invited').length?'invited: '+a.members.filter(m=>m.status==='invited').map(m=>m.display_name).join(', '):null,
   a.links.length?plural(a.links.length,'active link'):null].filter(Boolean).join(' · ')||'no one')));
 if(x.returns_on_restore.length)out.append(el('p',{class:'muted'},'If restored it returns to: '+x.returns_on_restore.map(a=>a.title||a.album_id).join(', ')+'.'));
 if(x.views.length||x.saves.length)out.append(el('p',{class:'muted'},'Already seen: '+plural(x.views.length,'view')+', '+plural(x.saves.length,'save')+' ('+[...new Set(x.views.map(v=>v.viewer.display_name||'someone with the link'))].join(', ')+'). Seen copies cannot be called back.'));
 return out;
}
function peopleEditor(item){
 const wrap=el('div',{class:'tags fs-people-tags'});
 for(const id of item.people)wrap.append(el('span',{class:'tag'},labelName(id),item.state==='active'&&can(T.update)?el('button',{type:'button',class:'fs-x','aria-label':'Remove '+labelName(id),onclick:()=>write(T.update,{id:item.id,patch:{remove_people:[id]}},{keepId:item.id}).catch(fail)},'×'):null));
 if(!item.people.length)wrap.append(el('span',{class:'muted'},'No people labelled'));
 if(item.state==='active'&&can(T.update)){
  const add=el('select',{'aria-label':'Add a person'},el('option',{value:''},'+ Add person'));
  for(const l of (A.labels||[]).filter(l=>!item.people.includes(l.id)))add.append(el('option',{value:l.id},l.name));
  add.addEventListener('change',()=>{if(add.value)write(T.update,{id:item.id,patch:{add_people:[add.value]}},{keepId:item.id}).catch(fail);});
  wrap.append(add);
 }
 return wrap;
}
function photoView(item){
 const active=item.state==='active',bar=el('div',{class:'fs-toolbar'});
 if(active&&can(T.update)){
  bar.append(button(item.favorite?'♥ Favourite':'♡ Favourite',()=>write(T.update,{id:item.id,patch:{favorite:!item.favorite}},{keepId:item.id}),item.favorite?'on':''));
  bar.append(button('Edit details',()=>editDetails(item.id)));
 }
 if(active&&can(T.edit))bar.append(button('Add to album',()=>chooseAlbum([item.id])));
 if(active&&can(T.update))bar.append(button(item.archived?'Unarchive':'Archive',()=>write(T.update,{id:item.id,patch:{archived:!item.archived}},{keepId:item.id})));
 if(active&&can(T.trash))bar.append(button('Move to trash',()=>write(T.trash,{ids:[item.id]}),'danger quiet'));
 if(item.state==='trashed'&&can(T.restore))bar.append(button('Restore',()=>write(T.restore,{ids:[item.id]},{keepId:item.id}),'primary'));
 if(item.state==='trashed'&&can(T.purge))bar.append(button('Delete forever',()=>confirmPurge([item.id]),'danger'));
 const art=el('article',{class:'fs-photo'},bar,media(item,{large:true}),
  el('h2',{},item.caption||el('span',{class:'muted'},'No caption')),
  el('p',{class:'fs-when'},when(item.taken_at)+(placeOf(item)?' · '+placeOf(item):'')));
 if(item.state==='trashed')art.append(el('p',{class:'fs-warning'},'In the trash since '+when(item.trashed_at)+'. Deleted for good on '+when(item.purge_at)+'.'));
 art.append(el('section',{},el('h3',{},'People'),peopleEditor(item)));
 art.append(el('section',{},el('h3',{},'Details'),
  row('Type',(item.kind==='video'?'Video':'Photo')+' · '+item.width+'×'+item.height+(item.duration_ms?' · '+Math.round(item.duration_ms/1000)+' s':'')),
  row('Size',size(item.declared_bytes)),row('Source',(SOURCES[item.source]?.[0]||human(item.source))+(item.saved_from?' (from '+personName(item.saved_from.person_id)+')':'')),
  row('Backup',item.backed_up?'Backed up':'Waiting to back up — not counted yet'),row('Added',when(item.added_at)),
  row('Archived',item.archived?'Yes':'No')));
 if(item.stack){
  const list=el('ul',{class:'fs-versions'});
  // Versions are told apart by their number, exact capture time (bursts are a second apart) and size.
  item.stack.versions.forEach((v,k)=>list.append(el('li',{class:v.id===item.id?'current':''},
   el('span',{},'Version '+(k+1)+(v.id===item.id?' (this one)':'')+' · '+seconds(v.taken_at)+' · '+size(v.declared_bytes)+(v.state==='trashed'?' · in the trash':'')),v.is_cover?badge('Cover','shared'):null,
   !v.is_cover&&v.state==='active'&&can(T.update)?button('Make cover',()=>write(T.update,{id:v.id,patch:{make_cover:true}},{keepId:item.id}),'quiet'):null,
   v.id!==item.id?button('Open',()=>{picked=v.id;return ui.select(v.id);},'quiet'):null)));
  art.append(el('section',{},el('h3',{},({edit:'Edited versions',burst:'Burst',duplicate:'Near-duplicates'}[item.stack.kind]||human(item.stack.kind))+' · '+plural(item.stack.versions.length,'version')),list));
 }
 const albums=el('ul',{class:'fs-list'});
 for(const a of item.albums)albums.append(el('li',{},el('button',{type:'button',class:'fs-link',onclick:()=>openAlbum(a.album_id).catch(fail)},a.title),' · '+(a.shared?'shared':'private')+(a.shows_item?'':' (hidden while in the trash)')));
 const here=ui.section.startsWith('album:')?A.details[ui.section.slice(6)]:null;
 const inHere=here?.entries.filter(e=>e.mine).map(e=>e.id)||[];
 const tools=el('div',{class:'fs-toolbar'});
 if(here&&inHere.includes(item.id)&&can(T.edit)){
  const i=inHere.indexOf(item.id);
  if(i>0)tools.append(button('Move earlier',()=>write(T.edit,{id:here.id,order:[...inHere.slice(0,i-1),item.id,inHere[i-1]]},{keepId:item.id}),'quiet'));
  if(i<inHere.length-1)tools.append(button('Move later',()=>write(T.edit,{id:here.id,order:[...inHere.slice(0,i),inHere[i+1],item.id]},{keepId:item.id}),'quiet'));
  tools.append(button('Remove from “'+here.title+'”',()=>write(T.edit,{id:here.id,remove_ids:[item.id]}),'quiet danger'));
 }
 art.append(el('section',{},el('h3',{},'Albums'),item.albums.length?albums:el('p',{class:'muted'},'Not in any album.'),tools));
 if(can(T.exposure)){
  const area=el('div',{class:'fs-exposure'},el('p',{class:'muted'},'Checking…'));
  art.append(el('section',{},el('h3',{},'Who can see this'),area));
  look(T.exposure,{id:item.id}).then(x=>{if(area.isConnected)area.replaceChildren(exposureView(x));}).catch(e=>area.replaceChildren(el('p',{class:'muted'},say(e))));
 }
 if(item.removal_requests.length||item.removal_history.length)art.append(el('section',{},el('h3',{},'Removal requests'),el('ul',{class:'fs-list'},
  item.removal_requests.map(r=>el('li',{},personName(r.from_person_id)+' · '+stateName(r.state))),
  item.removal_history.map(h=>el('li',{},'Taken down for '+personName(h.person_id)+' on '+day(h.at))))));
 art.append(el('details',{class:'fs-history'},el('summary',{},'History · '+item.history.length+(item.history.length===1?' entry':' entries')),
  el('ul',{class:'fs-list'},[...item.history].reverse().map(h=>el('li',{},when(h.at)+' · '+historyLine(h))))));
 return art;
}

// ---------- reads per view ----------
// Every load of the view (the first, Refresh, a search, after each of the page's own writes, and when
// a read shows the library has changed) reads in one batch: every page of the items, the trash, the
// account, the albums, the requests, the open album, and what the open view needs (storage,
// notifications, the albums behind Sharing and Requests). Nothing from an earlier load is kept
// except image bytes. If the answers of one batch carry different versions (something committed
// while it was being read), the batch is read again.
// What the open view needs beyond the albums list: each entry reads and returns how to store it.
function missing(section){
 const need=[],get=(name,args,put)=>need.push(reader=>reader(name,args).then(r=>()=>put(r)));
 const albumFor=id=>get(T.album,{id},r=>{A.details[id]=r.album;});
 if(section==='storage'&&A.storage===undefined){if(can(T.storage))get(T.storage,{},r=>{A.storage=r.storage;});else A.storage=null;}
 if(section==='activity'&&A.notifications===undefined){if(can(T.notifications))get(T.notifications,{},r=>{A.notifications=r.notifications;});else A.notifications=[];}
 if(!can(T.album))return need;
 if(section.startsWith('album:')){const id=section.slice(6);if(A.albums.some(a=>a.id===id&&!a.deleted_at)&&!A.details[id])albumFor(id);}
 if(section==='sharing')for(const a of A.albums.filter(a=>!a.deleted_at&&(a.members.joined||a.members.invited||a.active_links.length)&&!A.details[a.id]))albumFor(a.id);
 // Requests name members' photos by who added them: read the albums that hold contributions.
 if(section==='requests'&&A.removals.some(r=>r.items.some(i=>!i.mine)))for(const a of A.albums.filter(a=>a.contribution_count&&!a.deleted_at&&!A.details[a.id]))albumFor(a.id);
 return need;
}
// Reached through navigation, not a load: the reads count only if they answer with the view's
// version; otherwise the library has changed and the whole view is read again.
async function ensure(section){
 const view=A,versions=[],need=missing(section),app=document.querySelector('#app');
 app.setAttribute('aria-busy','true');
 try{
  const puts=await Promise.all(need.map(f=>f((n,a)=>read(n,a).then(r=>{versions.push(r.version);return r;}))));
  if(view!==A)return false;
  if(versions.every(v=>same(v,seen))){for(const put of puts)put();if(ui.section===section)await ui.navigate(section);return true;}
 }finally{app.setAttribute('aria-busy','false');}
 await ui.refresh();return false;
}
// The shared search box refreshes on every keystroke; Fernshelf waits for a pause in typing, since
// a refresh is several calls.
let searchTimer=null,searchHooked=false;
function debounceSearch(){
 const box=document.querySelector('.toolbar input[type=search]');if(searchHooked||!box)return;searchHooked=true;
 box.addEventListener('input',e=>{e.stopImmediatePropagation();clearTimeout(searchTimer);searchTimer=setTimeout(()=>ui.refresh().catch(fail),450);},true);
}
async function loadView(u){
 const text=document.querySelector('.toolbar input[type=search]')?.value||'',base={limit:PAGE,...(text?{text}:{})};
 const open=u.section.startsWith('album:')?u.section.slice(6):null;
 for(let attempt=1;;attempt++){
  const versions=[];
  const r=(name,args)=>read(name,args).then(x=>{versions.push(x.version);return x;});
  const opt=(name,args={},when=true)=>when&&u.has(name)?r(name,args):Promise.resolve(null);
  // The cursor of items.search is an offset: after the first page the others are read together.
  const pages=async args=>{const first=await r(T.search,args),rest=[];for(let o=PAGE;o<first.total;o+=PAGE)rest.push(r(T.search,{...args,cursor:String(o)}));return [...first.rows,...(await Promise.all(rest)).flatMap(x=>x.rows)];};
  // The reads are independent, so they are sent together; the Host passes them to the App in turn.
  const [rows,trashed,account,albums,removals,openAlbum,storage,notifications]=await Promise.all([
   pages(base),pages({...base,state:'trashed'}),opt(T.account),opt(T.albums),opt(T.removals),
   open&&can(T.album)?r(T.album,{id:open}).catch(e=>(e.code==='not_found'?null:Promise.reject(e))):Promise.resolve(null),
   opt(T.storage,{},u.section==='storage'),opt(T.notifications,{},u.section==='activity')]);
  A={account:account?.account||null,labels:account?.labels||[],people:account?.people||[],albums:albums?.albums||[],removals:removals?.removals||[],
   details:openAlbum?{[open]:openAlbum.album}:{},storage:u.section==='storage'?storage?.storage||null:undefined,notifications:u.section==='activity'?notifications?.notifications||[]:undefined};
  const puts=await Promise.all(missing(u.section).map(f=>f(r)));
  for(const put of puts)put();
  const consistent=versions.every(v=>same(v,versions[0]));
  if(consistent||attempt>=3){
   u.records.length=0;u.records.push(...rows,...trashed);
   seen=consistent?versions[0]:null;
   if(!consistent)ui.error(Error('The library is changing while it is being read. Refresh in a moment before making changes.'));
   return;
  }
 }
}

// ---------- App configuration for the shared mount ----------
export const config={
 id:'fernshelf',title:'Fernshelf',description:'Your photo library: albums, sharing, removal requests, storage and trash.',
 // The shared list read only starts a load; the view's own batch reads the items again with
 // everything else, so that all of it carries one version.
 list:T.search,collection:'rows',queryField:'text',listArgs:{limit:1},get:T.get,item:'item',
 heading:titleOf,subtitle:i=>day(i.taken_at),symbol:'❦',searchLabel:'Search captions',initialSection:'photos',
 labels:{title:'Album title'},
 // New album is the shared schema form (one field, the title); it shows nothing read from the library.
 actions:[{label:'New album',tool:T.create,primary:true,submit:'Create album'}],
 load:async u=>{
  debounceSearch();
  loadingView=true;seen=null;queue.length=0;covers.clear();
  try{await loadView(u);}finally{loadingView=false;}
  const foot=document.querySelector('.sidebar-foot');
  if(foot&&A.account)foot.replaceChildren(el('span',{class:'avatar small','aria-hidden':'true'},A.account.display_name.split(' ').map(x=>x[0]).join('').slice(0,2)),el('div',{},el('strong',{},A.account.display_name),el('small',{},A.account.plan)));
  return A;
 },
 sections:u=>{
  const pending=new Set(A.removals?.filter(r=>r.state==='pending').flatMap(r=>r.item_ids)),s=A.storage;
  const big=new Set(s?[...s.largest_items.map(x=>x.id),...s.duplicate_item_ids]:[]);
  const open=u.section.startsWith('album:')&&A.albums?.find(a=>a.id===u.section.slice(6)&&!a.deleted_at),openDetails=open&&A.details[open.id];
  const pendingCount=A.removals?.filter(r=>r.state==='pending').length||0;
  return [
   {id:'photos',label:'Photos',symbol:'▦',filter:i=>i.state==='active'&&!i.archived},
   {id:'favorites',label:'Favourites',symbol:'♥',filter:i=>i.state==='active'&&i.favorite},
   {id:'albums',label:'Albums',symbol:'▣',filter:()=>false,count:false},
   ...(open?[{id:u.section,label:open.title,symbol:'↳',filter:i=>!!openDetails?.entries.some(e=>e.id===i.id)}]:[]),
   {id:'sharing',label:'Sharing',symbol:'⇄',filter:()=>false,count:false},
   {id:'requests',label:pendingCount?'Requests · '+pendingCount+' new':'Requests',symbol:'⚑',filter:i=>pending.has(i.id),count:false},
   {id:'storage',label:'Storage',symbol:'☁',filter:i=>big.has(i.id)&&i.state==='active',count:false},
   {id:'activity',label:'Activity',symbol:'✉',filter:()=>false,count:false},
   {id:'archive',label:'Archive',symbol:'▤',filter:i=>i.state==='active'&&i.archived},
   {id:'trash',label:'Trash',symbol:'⌫',filter:i=>i.state==='trashed'}
  ];
 },
 renderList:(shown,u)=>{
  const s=u.section;
  if(missing(s).length){
   // Reached through navigation, not a load: read what this view needs, then draw it again.
   if(!loadingView)ensure(s).catch(fail);
   return el('div',{class:'empty'},el('p',{},'Loading…'));
  }
  document.body.dataset.view=['albums','sharing','requests','storage','activity'].includes(s)?'overview':'items';
  if(s==='albums')return albumsView();
  if(s.startsWith('album:'))return albumView(s.slice(6));
  if(s==='sharing')return sharingView();
  if(s==='requests')return requestsView();
  if(s==='storage')return storageView();
  if(s==='activity')return activityView();
  return libraryView(shown,u);
 },
 view:item=>photoView(item),
 emptyView:u=>el('div',{class:'empty'},el('h3',{},{albums:'Choose an album',sharing:'Who sees what',activity:'Activity',requests:'Removal requests'}[u.section]||'Nothing selected'),
  el('p',{},{albums:'Open an album to see its items, members and links.',sharing:'Open an album to change its members or links.',activity:'Open a notice to go to the album or request it is about.',requests:'Select a photo in a request to see where it is visible.'}[u.section]||'Select an item to see its details.')),
 sectionAfter:(tool,args,result)=>{report(tool,args,result);return tool===T.create?'album:'+result.id:null;}
};

// App styles are added to the shared stylesheet through the CSS object model (no inline styles,
// no extra file route), scoped to this App's body.
const RULES=`
body[data-app=fernshelf]{--accent:#2f7d6d;--soft:#e9f5f1}
body[data-app=fernshelf] .sidebar{background:#f1f6f4}
body[data-app=fernshelf] .workspace{grid-template-columns:minmax(0,1fr) 390px}
body[data-app=fernshelf] .detail-actions{display:none}
body[data-app=fernshelf][data-view=overview] .collection-count{display:none}
body[data-app=fernshelf] #records{padding-bottom:30px}
body[data-app=fernshelf] [hidden]{display:none!important}
.fs-pane{display:flex;flex-direction:column;gap:6px}
.fs-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 22px 6px;flex-wrap:wrap}
.fs-head>p{font-size:12px;max-width:640px}
.fs-pad{padding:0 22px}
.fs-bulk{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.fs-bulk button,.fs-toolbar button{font-size:12px;padding:6px 11px}
.fs-bulk strong{font-size:12px;margin-right:4px}
button.quiet{border-color:transparent;background:transparent;color:#5d6b7e}
button.danger{color:#b4473a}
button.primary.danger{background:#b4473a;border-color:#b4473a;color:#fff}
button.on{color:#c2416b;border-color:#f0c6d4;background:#fff5f8}
.fs-month{font-size:13px;font-weight:650;padding:16px 22px 8px;color:#38475a}
.fs-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:4px;padding:0 22px}
.fs-grid.small{grid-template-columns:repeat(auto-fill,minmax(72px,1fr));padding:0;margin:10px 0}
.fs-grid.compact{grid-template-columns:repeat(auto-fill,minmax(88px,1fr));padding:0;max-height:52vh;overflow:auto;margin-top:10px}
.fs-tile,body[data-app=fernshelf] .record.fs-tile{position:relative;display:block;width:100%;aspect-ratio:1/1;padding:0;border:0;border-radius:6px;overflow:hidden;background:#eef1f4}
body[data-app=fernshelf] .record.fs-tile[aria-pressed=true]{box-shadow:0 0 0 3px var(--accent);background:#eef1f4}
.fs-tile:hover .fs-media{filter:brightness(.94)}
.fs-media{position:absolute;inset:0;display:grid;place-items:center;align-content:center;gap:6px;background:linear-gradient(135deg,hsl(var(--h) 38% 88%),hsl(calc(var(--h) + 40) 30% 80%));color:hsl(var(--h) 25% 40%)}
.fs-media img{width:100%;height:100%;object-fit:cover;display:block}
.fs-media .fs-glyph{font-size:22px;opacity:.65}
.fs-caption{position:absolute;left:6px;right:6px;top:6px;font-size:10px;line-height:1.3;color:hsl(var(--h) 25% 30%);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;text-align:left}
.fs-media.large{position:relative;aspect-ratio:4/3;border-radius:10px;margin:14px 0 18px}
.fs-media.large img{object-fit:contain;background:#1f2a33;image-rendering:auto}
.fs-media.large small{font-size:12px;color:inherit}
.fs-media.empty-album{position:relative;aspect-ratio:4/3;background:#eef2f1;--h:160}
.fs-marks{position:absolute;left:5px;bottom:5px;display:flex;gap:3px;flex-wrap:wrap;pointer-events:none}
.fs-badge{display:inline-block;font-size:10px;line-height:1.4;padding:1px 6px;border-radius:9px;background:#ffffffd9;color:#38475a;font-weight:600}
.fs-badge.fav{color:#c2416b}.fs-badge.shared{background:var(--soft);color:var(--accent)}.fs-badge.link{background:#fff4dc;color:#8a5b00}
.fs-badge.member{background:#24323fcc;color:#fff}
.fs-badge.pending{background:#fff1d6;color:#8a5b00}.fs-badge.honored{background:var(--soft);color:var(--accent)}.fs-badge.declined{background:#fbe9e7;color:#a2392d}.fs-badge.withdrawn{background:#eef0f3;color:#68758a}
.fs-check{position:absolute;top:6px;right:6px;width:20px;height:20px;border-radius:50%;border:2px solid #fff;background:#00000033;color:transparent;font-size:12px;line-height:16px;text-align:center;display:none}
.picking .fs-check,dialog .fs-check{display:block}
.picking .fs-caption,dialog .fs-caption{right:30px}
.fs-tile.chosen .fs-check{background:var(--accent);color:#fff}
.fs-tile.chosen .fs-media{transform:scale(.9);border-radius:6px}
.fs-albums{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:18px;padding:6px 22px 24px}
.fs-album-card{display:flex;flex-direction:column;gap:4px;padding:0;border:0;background:transparent;text-align:left}
.fs-album-card .fs-media{position:relative;aspect-ratio:4/3;border-radius:10px;margin-bottom:6px;overflow:hidden}
.fs-album-card strong{font-size:14px}.fs-album-card small{font-size:12px}
.fs-album-state{display:flex;gap:4px;flex-wrap:wrap}
.fs-album-head{display:flex;justify-content:space-between;gap:14px;padding:4px 22px 10px;flex-wrap:wrap;align-items:flex-start}
.fs-album-meta{font-size:12px;color:var(--muted);margin:6px 0 0}
.fs-toolbar{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.fs-sharing{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:0 22px 14px;padding:14px 16px;border:1px solid var(--line);border-radius:12px;background:#fbfcfc}
.fs-sharing h3,.fs-photo section>h3,.fs-dialog h3{font-size:12px;color:#5f6d80;margin:0 0 8px;text-transform:uppercase;letter-spacing:.05em}
.fs-people{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.fs-person{display:flex;align-items:center;gap:10px;font-size:12px}
.fs-person>div{min-width:0;flex:1}.fs-person small{font-size:11px}
.fs-row-actions{display:flex;gap:2px}.fs-row-actions button{font-size:11px;padding:3px 7px}
.fs-link-icon{background:#fff4dc;color:#8a5b00}
.fs-cards{display:grid;gap:12px;padding:0 22px 24px}
.fs-pane>.fs-card{margin:0 22px}
.fs-card{border:1px solid var(--line);border-radius:12px;padding:16px 18px;background:#fff;display:flex;flex-direction:column;gap:6px}
.fs-card-head{display:flex;justify-content:space-between;align-items:center;gap:10px}
.fs-card-head h3{font-size:14px}
.fs-card blockquote{margin:6px 0;padding:8px 12px;border-left:3px solid var(--accent);background:#f7faf9;font-size:13px;white-space:pre-wrap}
.fs-card.request.pending{border-color:#f0d9a8;box-shadow:0 2px 10px #c4912a14}
.fs-card time{font-size:11px;color:var(--muted);white-space:nowrap}
.fs-card p{font-size:13px}
.fs-grid.small .fs-chip{grid-column:span 2}
.fs-chip{display:inline-block;font-size:11px;background:#f1f3f6;border-radius:6px;padding:4px 8px}
.fs-list{margin:4px 0;padding-left:18px;font-size:12px;display:grid;gap:3px}
.fs-meter{display:flex;height:12px;border-radius:7px;background:#e8ecef;overflow:hidden;margin:6px 0}
.fs-meter .used{background:var(--accent)}.fs-meter .trash{background:#e0a33b}
.fs-stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin:8px 0}
.fs-stats div{background:#f7f9fa;border-radius:8px;padding:8px 10px}.fs-stats strong{font-size:13px}
.fs-photo{padding:20px 24px 40px!important}
.fs-photo h2{font-size:21px;margin-top:4px}
.fs-photo section{margin-top:22px}
.fs-when{color:#5d6b7e;font-size:13px;margin-top:4px}
.fs-warning{margin-top:12px;padding:10px 12px;border-radius:8px;background:#fff6e5;color:#7a5200;font-size:12px}
.fs-people-tags{align-items:center}
.fs-people-tags .tag{font-size:12px;display:inline-flex;align-items:center;gap:4px}
.fs-people-tags select{width:auto;padding:4px 8px;font-size:12px;border-radius:6px}
.fs-x{border:0;background:transparent;padding:0 2px;color:inherit;font-size:13px;line-height:1}
.fs-versions{list-style:none;padding:0;margin:0;display:grid;gap:6px;font-size:12px}
.fs-versions li{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:6px 8px;border-radius:8px;background:#f7f9fa}
.fs-versions li.current{background:var(--soft)}
.fs-versions li span:first-child{flex:1}
.fs-versions button{font-size:11px;padding:2px 7px}
.fs-link{border:0;background:transparent;padding:0;color:var(--accent);font-weight:600}
.fs-surface{display:flex;flex-direction:column;padding:8px 10px;border-radius:8px;background:#f7f9fa;margin:6px 0;font-size:12px}
.fs-exposure p{font-size:13px;margin:4px 0}
.fs-history summary{cursor:pointer;font-size:12px;color:#5f6d80;margin-top:22px}
.fs-earlier summary{cursor:pointer;font-size:13px;font-weight:600;color:#38475a;padding:6px 0}
.fs-cards.nested{padding:8px 0 0}
.fs-choices{display:grid;gap:6px}
.fs-choice{display:flex;justify-content:space-between;align-items:center;text-align:left}
.fs-choice small{font-size:11px}
.fs-dialog.wide{max-width:820px}
.fs-dialog-body{display:flex;flex-direction:column;gap:6px}
.fs-dialog .fs-media.large{max-height:260px}
.fs-check-line{display:flex;gap:8px;align-items:flex-start;font-size:13px}
.fs-check-line input{width:auto;margin-top:3px}
@media(max-width:1150px){body[data-app=fernshelf] .workspace{grid-template-columns:minmax(0,1fr) 330px}.fs-sharing{grid-template-columns:1fr}}
@media(max-width:900px){body[data-app=fernshelf] .workspace{grid-template-columns:minmax(0,1fr)}body[data-app=fernshelf] .detail{border-top:1px solid var(--line)}}
@media(max-width:760px){body[data-app=fernshelf] .sidebar nav{flex-wrap:wrap;overflow:visible}body[data-app=fernshelf] #records{max-height:62vh}.fs-grid{grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:3px;padding:0 12px}.fs-head,.fs-album-head,.fs-cards,.fs-albums{padding-left:14px;padding-right:14px}.fs-sharing{margin:0 14px 12px}.fs-pane>.fs-card{margin:0 14px}.fs-albums{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.fs-month{padding:12px 14px 6px}.fs-photo{padding:16px 16px 30px!important}}
`;
function addStyles(){
 const sheet=[...document.styleSheets].find(s=>s.href&&new URL(s.href).pathname==='/shared/style.css');
 if(!sheet)return;
 // Split top-level rules; @media blocks keep their nested rules.
 let depth=0,start=0;
 for(let i=0;i<RULES.length;i++){const c=RULES[i];if(c==='{')depth++;else if(c==='}'){depth--;if(depth===0){sheet.insertRule(RULES.slice(start,i+1).trim(),sheet.cssRules.length);start=i+1;}}}
}
addStyles();
// The shared mount keeps its ui handle in a closure and passes it to load() on every refresh,
// before anything is rendered; the module-level helpers use that handle.
const load=config.load;
config.load=u=>{ui=u;return load(u);};
mount(config);
