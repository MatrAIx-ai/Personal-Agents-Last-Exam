'use strict';
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const find = (xs, id) => xs.find(x => x.id === id);
const catalogFields = ['title','authors','year'];
const writes = new Set(['library.import','library.save_record','library.save_note','library.create_collection','library.rename_collection','library.set_membership','library.export_citations','library.trash_record','library.restore_record']);
const utf8 = text => Buffer.byteLength(text,'utf8');
const allocate = (items, prefix) => { let serial=1; while (find(items,prefix+serial)) serial++; return prefix+serial; };
const checkedName = value => {
  const name=value.trim();
  if (!name) fail('invalid_arguments','Collection name must not be blank.');
  return name;
};
const nextRecordRevision = record => {
  if (record.revision>=999999999) fail('capacity_reached','Record revision limit reached.');
  record.revision++;
};
const bibtexEscapes = {'\\':'\\textbackslash{}','{':'{\\char123}','}':'{\\char125}','%':'\\%','&':'\\&','#':'\\#','$':'\\$','_':'\\_','~':'\\textasciitilde{}','^':'\\textasciicircum{}'};
const escapeBibtex = text => text.replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/[\\{}%&#$_~^]/g,ch=>bibtexEscapes[ch]);
const den = () => fail('permission_denied', 'Not permitted for the current library or account.');
const person = (ctx, d) => ctx.binding.accounts.find(x => x.app_id === 'library' && x.account_id === d.account_id)?.owner_person_id;
function validateSeed(ctx, d) {
  const principals = new Set(ctx.binding.people.map(x => x.person_id));
  const check = (keys, reason) => {
    if (new Set(keys).size !== keys.length) fail('invalid_seed', reason);
  };
  if (!principals.has(person(ctx, d))) fail('invalid_seed', 'Library account has no bound principal.');
  check(d.libraries.map(x => x.id), 'Duplicate library.');
  check(d.catalog.map(x => x.id), 'Duplicate catalog item.');
  check(d.records.map(x => x.id), 'Duplicate record.');
  check(d.records.map(x => x.library_id + ':' + x.catalog_id), 'Duplicate import within a library.');
  check(d.notes.map(x => x.record_id + ':' + x.author), 'Duplicate note.');
  for (const l of d.libraries) {
    check(l.grants.map(x => x.principal_id), 'Duplicate grant.');
    if (l.grants.some(x => !principals.has(x.principal_id))) fail('invalid_seed', 'Grant names an unknown principal.');
  }
  if (d.records.some(x => !find(d.libraries, x.library_id) || !find(d.catalog, x.catalog_id))) fail('invalid_seed', 'Unresolvable record reference.');
  check(d.collections.map(x=>x.id),'Duplicate collection.');
  check(d.exports.map(x=>x.id),'Duplicate export.');
  check(d.previews.map(x=>x.record_id),'Duplicate preview.');
  const inLibrary=(rid,lid)=>find(d.records,rid)?.library_id===lid;
  if (d.collections.some(x=>!find(d.libraries,x.library_id)||!x.name.trim()||x.member_ids.some(r=>!inLibrary(r,x.library_id)))) fail('invalid_seed','Unresolvable collection reference.');
  if (d.trash.some(x=>!find(d.records,x))) fail('invalid_seed','Unresolvable trash reference.');
  if (d.previews.some(p=>!find(d.records,p.record_id)||utf8(p.text)>8192)) fail('invalid_seed','Invalid preview reference or byte limit.');
  if (d.exports.some(x=>!find(d.libraries,x.library_id)||x.record_ids.some(r=>!inLibrary(r,x.library_id))||utf8(x.bibtex)>16384)) fail('invalid_seed','Invalid scoped export reference or byte limit.');
  if (d.notes.some(x => !find(d.records,x.record_id) || !principals.has(x.author))) fail('invalid_seed', 'Unresolvable note reference.');
}
function applyEvent(ctx, d, e) {
  if (ctx.role!=='infra') fail('invalid_event','Unsupported event.');
  if (e.operation==='library.catalog_correct') {
    const {record_id,expected_revision,patch}=e.payload;
    const record=find(d.records,record_id);
    if (!record || record.revision!==expected_revision) fail('invalid_event','Unknown record or stale correction.');
    if (!Object.keys(patch).length || Object.keys(patch).some(x=>!catalogFields.includes(x))) fail('invalid_event','Correction may only edit catalog-owned citation fields.');
    for (const field of catalogFields) if (Object.hasOwn(patch,field)) record[field]=patch[field];
    nextRecordRevision(record);
    return d;
  }
  if (e.operation!=='library.permission_change') fail('invalid_event','Unsupported event.');
  const {library_id, principal_id, role} = e.payload;
  const l = find(d.libraries, library_id);
  if (!l || !ctx.binding.people.some(x=>x.person_id===principal_id) || !['none','viewer','editor'].includes(role)) fail('invalid_event','Unknown library, principal or role.');
  l.grants=l.grants.filter(x=>x.principal_id!==principal_id);
  if (role!=='none') l.grants.push({principal_id,role});
  return d;
}
function handleTool(ctx,d,name,args) {
  if (Date.parse(ctx.virtual_now)>=Date.parse(d.session_expires_at)) fail('session_expired','This synthetic session has expired.');
  const actor=person(ctx,d), library=find(d.libraries,args.library_id);
  const role=library?.grants.find(x=>x.principal_id===actor)?.role;
  if (!actor || !['viewer','editor'].includes(role)) den();
  if (writes.has(name) && role!=='editor') den();
  const records=d.records.filter(x=>x.library_id===library.id);
  const active=records.filter(x=>!d.trash.includes(x.id));
  const get=()=>find(active,args.id) || fail('not_found','Record is unavailable in the selected library.');
  const match=(x)=>!args.query || [x.title,...x.authors].join(' ').toLowerCase().includes(args.query.toLowerCase());
  const finish=result=>({data:d,result});
  const getCollection=()=>find(d.collections.filter(x=>x.library_id===library.id),args.collection_id)
    || fail('not_found','Collection is unavailable in the selected library.');
  const project=collection=>({...collection,member_ids:collection.member_ids.filter(id=>!d.trash.includes(id))});
  const cite=()=>{
    const record_ids=args.record_ids;
    const selected=record_ids.map(id=>find(active,id)||fail('not_found','A selected record is unavailable in the selected library.'));
    const bibtex=selected.map(x=>`@misc{${x.id},
  title={${escapeBibtex(x.title)}},
  author={${x.authors.map(escapeBibtex).join(' and ')}},
  year={${x.year}}
}
`).join('\n');
    if (utf8(bibtex)>16384) fail('capacity_reached','Citation export exceeds the 16 KiB limit.');
    return {record_ids,bibtex};
  };
  switch(name) {
    case 'library.search':
      return finish({records:active.filter(x=>match(x)&&(!args.tag||x.tags.includes(args.tag))&&(!args.reading_status||x.reading_status===args.reading_status))});
    case 'library.get': {
      const record=get();
      const preview=d.previews.find(x=>x.record_id===record.id);
      return finish({record,notes:d.notes.filter(n=>n.record_id===record.id && n.author===actor),text_preview:preview ? {status:'available',text:preview.text} : {status:'missing'}});
    }
    case 'library.catalog_search': return finish({items:d.catalog.filter(match)});
    case 'library.import': {
      const item=find(d.catalog,args.catalog_id);
      if (!item) fail('not_found','Unknown catalog item.');
      if (records.some(x=>x.catalog_id===item.id)) fail('duplicate_import','Already imported in this library.');
      if (d.records.length>=100) fail('capacity_reached','Record limit reached.');
      let serial=1;
      while (find(d.records,'import-'+serial)) serial++;
      const record={...item,id:'import-'+serial,catalog_id:item.id,library_id:library.id,revision:1,tags:[],reading_status:'unread'};
      d.records.push(record);
      return finish({record});
    }
    case 'library.save_record':
    case 'library.save_note': {
      const record=get();
      if (record.revision!==args.expected_record_revision) fail('stale_record','The record changed; reread it before saving.');
      if (name==='library.save_record') {
        const fields=['title','authors','year','tags','reading_status'];
        for (const field of fields) if (Object.hasOwn(args.patch,field)) record[field]=args.patch[field];
        nextRecordRevision(record);
        return finish({record});
      }
      const i=d.notes.findIndex(n=>n.record_id===record.id&&n.author===actor);
      if (i<0 && d.notes.length>=100) fail('capacity_reached','Note limit reached.');
      const note={record_id:record.id,author:actor,text:args.text};
      if (i<0) d.notes.push(note); else d.notes[i]=note;
      nextRecordRevision(record);
      return finish({record,note});
    }
    case 'library.list_collections':
      return finish({collections:d.collections.filter(x=>x.library_id===library.id).map(project)});
    case 'library.create_collection': {
      if (d.collections.length>=100) fail('capacity_reached','Collection limit reached.');
      const collection={id:allocate(d.collections,'collection-'),library_id:library.id,name:checkedName(args.name),member_ids:[]};
      d.collections.push(collection);
      return finish({collection});
    }
    case 'library.rename_collection': {
      const collection=getCollection();
      collection.name=checkedName(args.name);
      return finish({collection:project(collection)});
    }
    case 'library.set_membership': {
      const collection=getCollection();
      if (!find(active,args.record_id)) fail('not_found','Record is unavailable in this collection’s library.');
      const exists=collection.member_ids.includes(args.record_id);
      if (args.member && !exists) collection.member_ids.push(args.record_id);
      if (!args.member && exists) collection.member_ids=collection.member_ids.filter(id=>id!==args.record_id);
      return finish({collection:project(collection)});
    }
    case 'library.preview_citations':
      return finish(cite());
    case 'library.export_citations': {
      if (d.exports.length>=8) fail('capacity_reached','Export limit reached.');
      const content=cite();
      const artifact={id:allocate(d.exports,'export-'),library_id:library.id,...content};
      d.exports.push(artifact);
      return finish({export:artifact});
    }
    case 'library.read_export': {
      const artifact=find(d.exports.filter(x=>x.library_id===library.id),args.export_id);
      if (!artifact) fail('not_found','Export is unavailable in the selected library.');
      return finish({export:artifact});
    }
    case 'library.list_trash':
      return finish({records:records.filter(x=>d.trash.includes(x.id))});
    case 'library.trash_record':
    case 'library.restore_record': {
      const toTrash=name==='library.trash_record';
      const record=find(records,args.id);
      if (!record || d.trash.includes(record.id)===toTrash) fail('not_found','Record is unavailable in the selected view.');
      if (record.revision!==args.expected_record_revision) fail('stale_record','The record changed; reread it before saving.');
      nextRecordRevision(record);
      if (toTrash) d.trash.push(record.id); else d.trash=d.trash.filter(id=>id!==record.id);
      return finish({record});
    }
    default: fail('invalid_arguments','Unknown Library operation.');
  }
}
module.exports={validateSeed,applyEvent,handleTool,objects:d=>d.records.map(x=>x.id),records:d=>d.records,references:()=>[]};
