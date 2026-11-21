'use strict';
// Platform-owned permission enforcement. App hooks report data relationships only.
function allowed(pkg,state,asset){
 if(!asset||asset.scope.app_id!==state.app_id||asset.access.rule!=='parent_object'||!asset.access.audience.includes('agent'))return false;
 const policy=state.policies[state.profile],references=pkg.plugin.assetReferences?.(state.data)||[];
 return asset.subjects.some(subject=>{
  if(subject.app_id!==state.app_id||subject.account_id!==state.data.account_id)return false;
  const tool=pkg.resourceAccess?.[subject.object_type];
  if(!tool||!pkg.tools.some(t=>t.name===tool&&t.read_only)||!policy.allow.includes(tool))return false;
  if(policy.constraints[tool]?.ids&&!policy.constraints[tool].ids.includes(subject.object_id))return false;
  return pkg.plugin.objects(state.data).includes(subject.object_id)&&references.some(r=>r.asset_id===asset.asset_id&&r.object_id===subject.object_id&&r.object_type===subject.object_type);
 });
}
module.exports={allowed};
