import {el} from '/shared/client.js';
const node=document.querySelector('#app');
const status=el('p',{role:'status','aria-live':'polite'},'Connecting…');
const panel=el('section',{class:'detail','aria-label':'Library content'});
const lib=el('input',{id:'library-id',value:'group-1',required:true});
const nav=el('nav',{'aria-label':'Workspace sections'});
const dialog=el('dialog',{'aria-label':'Library operation'});
const root=el('div',{},el('h1',{},'Research Library'),el('p',{},'Local synthetic workspace. Saving requires an editor grant.'),el('label',{for:'library-id'},'Library ID'),lib,nav,status,panel,dialog);
node.replaceChildren(root);
let csrf='', tools=new Set(), selected=null, section='library', serial=0;
const filter={library:{query:'',tag:'',reading_status:''},catalog:{query:''}};
async function request(url,method='GET',data){
  const r=await fetch(url,{method,headers:method==='POST'?{'Content-Type':'application/json','X-Pale-CSRF':csrf}:{},...(data===undefined?{}:{body:JSON.stringify(data)})});
  const out=await r.json();if(!r.ok)throw Error(out.error||'Connection failed');return out;
}
async function call(action,args){
  const out=await request('/api/call','POST',{name:'library.'+action,arguments:args});
  if(!['ok','committed'].includes(out.status))throw Object.assign(Error(out.message||out.status),{code:out.status});return out;
}
function button(label,fn){return el('button',{type:'button',onclick:()=>Promise.resolve().then(fn).catch(e=>status.textContent=e.message)},label);}
function label(text,field){return el('label',{},text+' ',field);}
function facts(r){return el('p',{},r.authors.join(', ')+' · '+r.year+(r.reading_status?' · '+r.reading_status:''));}
function option(name){return el('option',{value:name},name||'All reading statuses');}
function can(action){return tools.has('library.'+action);}
function id(){if(!/^[a-z][a-z0-9-]{0,79}$/.test(lib.value))throw Error('Enter a valid library ID.');return lib.value;}
function action(title,fields,values){
  const form=el('form',{});const confirm=el('button',{type:'submit',class:'primary'},'Confirm');
  const cancel=button('Cancel',async()=>dialog.close());
  const failure=el('p',{role:'alert'});let busy=false,last=null;
  form.append(el('h2',{},title),...fields,failure,el('div',{class:'actions'},cancel,confirm));
  dialog.replaceChildren(form);dialog.showModal();
  dialog.oncancel=e=>{if(busy)e.preventDefault();};
  form.addEventListener('submit',async e=>{
    e.preventDefault();if(busy)return;
    const payload=values.args();
    const key=JSON.stringify(payload);
    if(last?.key!==key)last={key,id:crypto.randomUUID()};
    busy=true;confirm.disabled=cancel.disabled=true;failure.textContent='';
    try {
      const written=await call(values.operation,{...payload,request_id:last.id});
      dialog.close();
      if(written.record){selected=written.record.id;section=values.after||'library';}
      // A committed receipt already exists; a read-back outage must never reopen the write.
      try {await show();status.textContent='Committed: '+(written.record?.title||written.collection?.name||written.export?.id||'operation');}
      catch(err){status.textContent='Committed, but read-back failed: '+err.message;}
    } catch(err){failure.textContent=err.message;}
    finally{busy=false;confirm.disabled=cancel.disabled=false;}
  });
}
async function detail(library,recordId,output,bound){
  const r=await call('get',{library_id:library,id:recordId});
  if(bound!==serial)return;
  const rec=r.record;
  const base={library_id:library,id:rec.id,expected_version:r.version,expected_record_revision:rec.revision};
  const controls=el('div',{class:'actions'});
  if(can('save_record'))controls.append(button('Edit record',async()=>{
    const title=el('input',{value:rec.title,maxlength:200,required:true});
    const year=el('input',{type:'number',value:rec.year,min:1000,max:9999,required:true});
    const reading=el('select',{},['unread','reading','read'].map(option));reading.value=rec.reading_status;
    const authors=el('textarea',{rows:3},rec.authors.join('\n'));
    const tags=el('textarea',{rows:2},rec.tags.join('\n'));
    const lines=field=>field.value.split('\n').map(x=>x.trim()).filter(Boolean);
    action('Edit record',[label('Title',title),label('Year',year),label('Reading status',reading),label('Authors (one per line)',authors),label('Tags (one per line)',tags)],
      {operation:'save_record',args:()=>({...base,patch:{title:title.value,year:year.valueAsNumber,reading_status:reading.value,authors:lines(authors),tags:lines(tags)}})});
  }));
  if(can('save_note'))controls.append(button('Edit your private note',async()=>{
    const note=el('textarea',{maxlength:4000,rows:6},r.notes[0]?.text??'');
    action('Edit your private note',[label('Only your account can read this note',note)],
      {operation:'save_note',args:()=>({...base,text:note.value})});
  }));
  if(can('trash_record'))controls.append(button('Move to trash',async()=>action('Move to trash',[el('p',{},rec.title)],{operation:'trash_record',after:'trash',args:()=>base})));
  const preview=r.text_preview?.status==='available'?el('pre',{},r.text_preview.text):el('p',{},'No text preview is available.');
  output.replaceChildren(el('h3',{},rec.title),facts(rec),el('p',{},'Tags: '+(rec.tags.join(', ')||'None')),el('h4',{},'Text preview'),preview,el('h4',{},'Your private notes'),
    ...(r.notes.length?r.notes.map(n=>el('p',{},n.text)):[el('p',{},'No private notes are visible to this account.')]),controls);
}
async function show(){
  const ticket=++serial;const current=section;const library=id();const f=filter[current];
  if(!f)return advanced(current,library,ticket);
  panel.replaceChildren();status.textContent='Reading…';
  const form=el('form',{role:'search'}), fields={};
  for(const key of Object.keys(f)){
    const v=fields[key]=key==='reading_status'?el('select',{},['','unread','reading','read'].map(option)):el('input',{value:f[key],maxlength:200});
    if(key==='reading_status')v.value=f[key];
    form.append(label({query:'Search by title or author',tag:'Tag',reading_status:'Reading status'}[key],v));
  }
  form.append(el('button',{type:'submit'},'Search'));
  form.addEventListener('submit',e=>{e.preventDefault();for(const [key,value] of Object.entries(fields))f[key]=value.value.trim();selected=null;show().catch(err=>status.textContent=err.message);});
  panel.append(el('h2',{},current==='library'?'Library records':'Synthetic catalog'),form);
  const args={library_id:library,...Object.fromEntries(Object.entries(f).filter(([,v])=>v))};
  const r=await call(current==='library'?'search':'catalog_search',args);
  if(ticket!==serial)return;
  const rows=r.records||r.items;
  const results=el('ul',{'aria-label':'Search results'});
  const output=el('section',{'aria-label':'Selected record'});
  for(const row of rows){
    const item=el('li',{},el('strong',{},row.title),facts(row));
    if(current==='library')item.append(button('Open '+row.title,async()=>{selected=row.id;await show();}));
    else if(can('import'))item.append(button('Import '+row.title,async()=>action('Import record',[el('p',{},row.title)],{operation:'import',args:()=>({library_id:library,catalog_id:row.id,expected_version:r.version})})));
    results.append(item);
  }
  panel.append(rows.length?results:el('p',{},'No results.'),output);
  status.textContent=rows.length+' results.';
  if(current==='library'&&selected)await detail(library,selected,output,ticket);
}
async function advanced(which,library,ticket){
  panel.replaceChildren();status.textContent='Reading…';
  const libArgs={library_id:library};
  if(which==='collections'){
    const r=await call('list_collections',libArgs);if(ticket!==serial)return;
    const {records}=await call('search',libArgs);if(ticket!==serial)return;
    const newCollection=button('New collection',async()=>{
      const name=el('input',{required:true,maxlength:200});
      action('New collection',[label('Name',name)],{operation:'create_collection',args:()=>({...libArgs,name:name.value,expected_version:r.version})});
    });
    panel.append(el('h2',{},'Collections'));
    if(can('create_collection'))panel.append(newCollection);
    for(const c of r.collections){
      const block=el('section',{},el('h3',{},c.name));
      for(const x of records.filter(x=>c.member_ids.includes(x.id)))block.append(el('p',{},x.title));
      if(can('rename_collection'))block.append(button('Rename '+c.name,async()=>{
        const name=el('input',{value:c.name,required:true,maxlength:200});
        action('Rename collection',[label('Name',name)],{operation:'rename_collection',args:()=>({...libArgs,collection_id:c.id,name:name.value,expected_version:r.version})});
      }));
      for(const x of records)if(can('set_membership')){
        const member=!c.member_ids.includes(x.id);const verb=member?'Add ':'Remove ';
        block.append(button(verb+x.title,async()=>action('Change membership',[el('p',{},verb+x.title+' · '+c.name)],{operation:'set_membership',args:()=>({...libArgs,collection_id:c.id,record_id:x.id,member,expected_version:r.version})})));
      }
      panel.append(block);
    }
  }else if(which==='citations'){
    const r=await call('search',libArgs);if(ticket!==serial)return;
    const form=el('form',{}),preview=el('section',{'aria-label':'Citation preview'});
    const inputs=r.records.map(rec=>el('input',{type:'checkbox',value:rec.id}));
    form.append(...inputs.map((input,i)=>label(r.records[i].title,input)),el('button',{type:'submit'},'Preview selected'));
    form.addEventListener('change',()=>preview.replaceChildren());
    form.addEventListener('submit',async e=>{
      e.preventDefault();const ids=inputs.filter(x=>x.checked).map(x=>x.value);
      if(!ids.length){status.textContent='Select at least one record.';return;}
      preview.replaceChildren();
      try {
        const out=await call('preview_citations',{...libArgs,record_ids:ids});
        if(ticket!==serial||ids.join()!==inputs.filter(x=>x.checked).map(x=>x.value).join())return;
        preview.append(el('pre',{},out.bibtex));
        if(can('export_citations'))preview.append(button('Save local BibTeX export',async()=>{
          action('Save local BibTeX export',[el('p',{},ids.length+' selected records')],{operation:'export_citations',args:()=>({...libArgs,record_ids:ids,expected_version:out.version})});
        }));
      }catch(err){status.textContent=err.message;}
    });
    panel.append(el('h2',{},'Citations'),form,preview);
    if(can('read_export')){
      const exportId=el('input',{required:true});
      panel.append(label('Saved export ID',exportId),button('Read saved export',async()=>{
        const e=await call('read_export',{...libArgs,export_id:exportId.value.trim()});
        if(ticket===serial)preview.replaceChildren(el('pre',{},e.export.bibtex));
      }));
    }
  }else if(which==='trash'){
    const r=await call('list_trash',libArgs);if(ticket!==serial)return;
    panel.append(el('h2',{},'Trash'));
    if(!r.records.length)panel.append(el('p',{},'Trash is empty.'));
    for(const rec of r.records)panel.append(el('p',{},rec.title,' ',can('restore_record')?button('Restore '+rec.title,async()=>{
      action('Restore record',[el('p',{},rec.title)],{operation:'restore_record',args:()=>({...libArgs,id:rec.id,expected_record_revision:rec.revision,expected_version:r.version})});
    }):null));
  }
  status.textContent='Loaded.';
}
async function init(){
  const access=new URLSearchParams(location.hash.slice(1)).get('access');
  if(access){history.replaceState(null,'',location.pathname);({csrf}=await request('/session','POST',{token:access}));}
  else ({csrf}=await request('/session'));
  tools=new Set((await request('/api/tools')).tools.map(x=>x.name));
  nav.append(button('Library',async()=>{section='library';await show();}),
    button('Catalog',async()=>{section='catalog';await show();}));
  for(const [sectionId,labelName,tool] of [['collections','Collections','list_collections'],['citations','Citations','preview_citations'],['trash','Trash','list_trash']])if(can(tool))nav.append(button(labelName,async()=>{section=sectionId;await show();}));
  nav.append(button('Refresh',show));
  lib.addEventListener('change',()=>{selected=null;show().catch(e=>status.textContent=e.message);});
  await show();
}
init().catch(e=>status.textContent=e.message);
