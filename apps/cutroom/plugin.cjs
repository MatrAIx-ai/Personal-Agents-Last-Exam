'use strict';

const compare = (a,b) => a < b ? -1 : a > b ? 1 : 0;
const fail = (code,message) => { throw Object.assign(new Error(message),{code}); };
const find = (rows,id,code='not_found') => rows.find(x=>x.id===id) || fail(code,`Unknown record: ${id}`);
const time = Date.parse;
const assetReferences = data => data.projects.flatMap(p => p.cuts.flatMap(c =>
  [...c.thumbnails,...c.keyframes].map(asset_id=>({asset_id,object_type:'project',object_id:p.id}))));
const latest = (history,at,initial) => history.filter(x=>time(x.at)<=at).at(-1)?.status ?? initial;
const available = (item,at,scope) =>
  latest(item.history,at,'active')==='active' &&
  (!item.expires_at || at<=time(item.expires_at)) && (!scope || item.license_scope===scope);

function audit(data,p,at) {
  const cut=find(p.cuts,p.active_cut);
  const row=(code,target_id,message)=>({code,target_id,message});
  const blockers=cut.notes.filter(n=>time(n.at)<=at && (!n.resolved_at || time(n.resolved_at)>at))
    .map(n=>row('unresolved_note',n.id,`${n.timecode} ${n.text}`));
  const track=find(data.library,p.track_id);
  if (!available(track,at,p.sponsored?'commercial_sponsored':undefined))
    blockers.push(row('invalid_license',track.id,'Assigned music is not cleared at release time.'));
  for(const r of p.guest_releases)
    if(latest(r.history,at,'signed')!=='signed')
      blockers.push(row('missing_guest_release',r.id,'Guest release is not signed at release time.'));
  return {cleared:!blockers.length,blockers};
}

// Assess pending schedules before each change. If already due, keep the
// outcome based on pre-change records; reading or advancing time writes nothing.
function settlement(data,p,now) {
  if(!p.schedule || time(p.schedule.at)>now) return null;
  const {at,override}=p.schedule;
  const check=audit(data,p,time(at));
  return {visibility:override||check.cleared?'public':'private',
    published_at:override||check.cleared?at:null, release_blockers:override?[]:check.blockers};
}
function settled(data,now) {
  for(const p of data.projects) {
    const outcome=settlement(data,p,now);
    if(outcome) Object.assign(p,outcome,{schedule:null});
  }
}
function view(ctx,data,p) {
  const outcome=settlement(data,p,time(ctx.virtual_now));
  const asset_ids=[...new Set(assetReferences({projects:[p]}).map(x=>x.asset_id))].filter(id=>{
    if(!ctx.assets) return true;
    try {ctx.assets.read(id);return true;}
    catch(e){if(['not_available','unavailable'].includes(e.code))return false;throw e;}
  });
  const allowed=new Set(asset_ids);
  const cuts=p.cuts.map(c=>({...c,thumbnails:c.thumbnails.filter(id=>allowed.has(id)),
    keyframes:c.keyframes.filter(id=>allowed.has(id)),
    results:c.results.filter(row=>allowed.has(row.asset_id)),
    active_thumbnail:allowed.has(c.active_thumbnail)?c.active_thumbnail:null}));
  return {...p,...outcome,cuts,asset_ids,
    resource_uris:asset_ids.map(id=>`pale://${ctx.run_id}/cutroom/assets/${id}`)};
}
function handleTool(ctx,data,name,a) {
  const now=time(ctx.virtual_now);
  const out=result=>({data,result});
  const op=name.slice('cutroom.'.length);
  if(op==='projects.list') return out({items:data.projects.map(p=>view(ctx,data,p))});
  if(op==='library.search'){
    const items=data.library.filter(x=>
      (!a.kind||x.kind===a.kind)&&(!a.query||x.title.toLowerCase().includes(a.query.toLowerCase()))&&
      (!a.mood||x.mood===a.mood)&&(a.max_bpm===undefined||(x.bpm!==null&&x.bpm<=a.max_bpm))&&
      (!a.license_scope||x.license_scope===a.license_scope)&&
      (a.active===undefined||available(x,now)===a.active)&&
      (!a.visual_tags||a.visual_tags.every(tag=>x.visual_tags.includes(tag))));
    return out({items:items.sort((x,y)=>compare(x.id,y.id))});
  }
  const p=find(data.projects,a.id);
  if(op==='projects.get')return out({item:view(ctx,data,p)});
  if(op==='projects.audit_clearance')return out(audit(data,p,now));
  if(op==='cuts.list_notes')return out({items:find(p.cuts,a.cut_id).notes});
  settled(data,now);
  if(op==='projects.set_thumbnail'){
    const c=find(p.cuts,a.cut_id);
    if(!c.thumbnails.includes(a.asset_id))fail('not_found','Thumbnail is not a candidate for this cut.');
    c.active_thumbnail=a.asset_id;
  } else if(op==='projects.assign_track'){
    const track=find(data.library,a.track_id);
    if(track.kind!=='bgm'||!available(track,now,p.sponsored?'commercial_sponsored':undefined))
      fail('invalid_license','Track is unavailable or not cleared for the project.');
    p.track_id=track.id;
  } else if(op==='cuts.resolve_note'){
    const note=find(find(p.cuts,a.cut_id).notes,a.note_id);
    note.resolved_at ??= ctx.virtual_now;
  } else if(op==='cuts.add_note'){
    addNote(find(p.cuts,a.cut_id),a,ctx.virtual_now,'invalid_arguments');
  } else if(op==='projects.update_metadata'){
    if(!Object.keys(a.patch).length)fail('invalid_arguments','Metadata patch is empty.');
    Object.assign(p,a.patch);
  } else if(['projects.set_visibility','projects.schedule_release','projects.override_release'].includes(op)){
    const override=op==='projects.override_release';
    const schedule=op==='projects.schedule_release'||(override&&a.at!==undefined);
    const target=schedule?time(a.at):now;
    const visibility=schedule?'public':override?'public':a.visibility;
    if(schedule&&(target<=now||p.visibility==='public')) fail('invalid_time','Schedule must be future and project not public.');
    if(visibility==='public'){
      const check=audit(data,p,target);
      if(!check.cleared&&!override)fail('clearance_blocked',check.blockers.map(b=>`${b.code}: ${b.target_id}`).join('; '));
      if(override){
        p.overrides.push({actor:data.owner_person_id,at:ctx.virtual_now,
          intended_transition:{visibility,scheduled_at:a.at??null},reason:a.reason,blockers:check.blockers});
      }
    }
    if(schedule)p.schedule={at:a.at,override};
    else {
      p.schedule=null;
      p.visibility=visibility;
      p.published_at=visibility==='public'?(p.published_at??ctx.virtual_now):null;
    }
    p.release_blockers=[];
  } else fail('unknown_tool',name);
  return out({item:view(ctx,data,p)});
}
function addNote(c,a,at,code){
  if(c.notes.some(n=>n.id===a.note_id))fail(code,'Duplicate note.');
  c.notes.push({id:a.note_id,timecode:a.timecode,text:a.text,at,resolved_at:null});
}
function applyEvent(ctx,data,e){
  const a=e.payload,p=find(data.projects,a.project_id,'invalid_event');
  // Earlier releases are final; a change timestamped exactly at release takes
  // effect before the release is assessed.
  settled(data,time(e.at)-1);
  if(e.operation==='cutroom.license.revoke'){
    const guest=p.guest_releases.find(r=>r.id===a.resource_id);
    if(guest){
      if(!['withdrawn','signed'].includes(a.status))fail('invalid_event','Expected withdrawn or signed guest status.');
      guest.history.push({at:e.at,status:a.status,reason:a.reason});
    } else {
      if(p.track_id!==a.resource_id||a.status!=='revoked')fail('invalid_event','Expected revoked status and assigned BGM.');
      const track=find(data.library,a.resource_id,'invalid_event');
      track.history.push({at:e.at,status:a.status,reason:a.reason});
    }
  } else if(e.operation==='cutroom.cut.add_note'){
    addNote(find(p.cuts,a.cut_id,'invalid_event'),a,e.at,'invalid_event');
  } else if(e.operation==='cutroom.ab_test.update'){
    const c=find(p.cuts,a.cut_id,'invalid_event');
    if(!c.thumbnails.includes(a.asset_id))fail('invalid_event','Unknown thumbnail candidate.');
    const next={asset_id:a.asset_id,ctr:a.ctr,retention:a.retention,at:e.at};
    c.results=c.results.filter(x=>x.asset_id!==a.asset_id).concat(next);
  } else fail('invalid_event','Unsupported event.');
  return data;
}
// Stored facts that must already have happened at the clock. Schedules,
// license expiries and an override's intended schedule are plans and may
// point forward; everything here is history.
function pastFacts(data){
  const rows=[],add=(path,at)=>{if(at)rows.push({path,at});};
  for(const p of data.projects){
    add(`${p.id}.published_at`,p.published_at);
    for(const c of p.cuts){
      for(const n of c.notes){add(`${p.id}/${c.id}/${n.id}.at`,n.at);add(`${p.id}/${c.id}/${n.id}.resolved_at`,n.resolved_at);}
      for(const r of c.results)add(`${p.id}/${c.id}/results/${r.asset_id}.at`,r.at);
    }
    for(const g of p.guest_releases)for(const h of g.history)add(`${p.id}/${g.id}.history.${h.status}`,h.at);
    for(const o of p.overrides)add(`${p.id}.overrides.at`,o.at);
  }
  for(const t of data.library)for(const h of t.history)add(`${t.id}.history.${h.status}`,h.at);
  return rows;
}
function validateSeed(ctx,data){
  const now=time(ctx.virtual_now);
  if(Number.isNaN(now))fail('invalid_seed','A virtual clock is required to validate CutRoom history.');
  const late=pastFacts(data).filter(x=>time(x.at)>now);
  if(late.length)fail('invalid_seed',`${late.length} stored record(s) are dated after the clock ${ctx.virtual_now}, e.g. ${late[0].path} ${late[0].at}. Load this data with a later virtual_now.`);
  if(!ctx.binding.accounts.some(a=>a.app_id==='cutroom'&&a.account_id===data.account_id&&a.owner_person_id===data.owner_person_id))
    fail('invalid_seed','Studio account is not bound.');
  const unique=rows=>{if(new Set(rows.map(x=>x.id)).size!==rows.length)fail('invalid_seed','Duplicate IDs.');};
  unique(data.projects);unique(data.library);
  const assetIds=assetReferences(data).map(r=>r.asset_id);
  if(new Set(assetIds).size!==assetIds.length)fail('invalid_seed','An image must have one owning cut.');
  for(const p of data.projects){
    unique(p.cuts);unique(p.guest_releases);
    if(!p.cuts.some(c=>c.id===p.active_cut)||!data.library.some(t=>t.id===p.track_id&&t.kind==='bgm'))
      fail('invalid_seed','Invalid active cut or music reference.');
    for(const c of p.cuts){
      unique(c.notes);
      if(c.active_thumbnail&&!c.thumbnails.includes(c.active_thumbnail))fail('invalid_seed','Invalid active thumbnail.');
    }
  }
}
module.exports={validateSeed,pastFacts,handleTool,applyEvent,records:d=>d.projects,objects:d=>d.projects.map(p=>p.id),references:()=>[],assetReferences};
