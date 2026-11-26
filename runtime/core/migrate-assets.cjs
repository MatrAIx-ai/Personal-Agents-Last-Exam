'use strict';
// Explicit migration of stored pre-contract states, never an accepted MCP input format.
const copy=x=>JSON.parse(JSON.stringify(x));
function descriptor(a,dataset,scope={level:'package',app_id:a.app_id}){
 const media={...(a.source?.captured_at?{captured_at:a.source.captured_at}:{}),...(a.source?.device_id?{device_ref:a.source.device_id}:{})};
 const pick=keys=>Object.fromEntries(keys.filter(k=>a[k]!==undefined).map(k=>[k,a[k]]));
 if(a.mime_type.startsWith('image/'))media.image=pick(['width','height']);
 if(a.mime_type.startsWith('audio/'))media.audio=pick(['duration_ms','codec','sample_rate_hz','channels']);
 if(a.mime_type.startsWith('video/'))media.video=pick(['duration_ms','codec','width','height','fps','has_audio']);
 if(a.unit)media.sensor={...pick(['unit','sample_count']),...(a.source?.device_id?{device_ref:a.source.device_id}:{})};
 return {schema_version:'pale.asset-descriptor.v1',asset_id:a.asset_id,scope,
  roles:[a.disposition==='inline'?'content.inline':'content.attachment'],subjects:[{app_id:a.app_id,...copy(a.owner)}],mime_type:a.mime_type,
  availability:{status:a.availability,...(a.availability!=='ready'?{reason:'Explicit missing fixture; do not infer its contents.'}:{})},
  storage:{adapter:'storage.file',path:'assets/'+a.filename,packaging:a.availability==='ready'?'bundled':'not_materialized'},
  ...(a.availability==='ready'?{integrity:{bytes:a.bytes,sha256:a.sha256}}:{}),
  provenance:{dataset_id:dataset.dataset_id,source_ids:[a.source.source_id]},publication:'public',
  access:{audience:[a.access==='agent'?'agent':'evaluator'],rule:'parent_object'},
  presentation:{alt_text:a.filename,...(a.content_id?{inline_content_id:a.content_id}:{})},media,extensions:[]};
}
function bundle(old,app){
 if(!Array.isArray(old.catalog))return copy(old);
 const d=copy(old.dataset);return {dataset:d,catalog:{schema_version:'pale.asset-catalog.v1',catalog_id:app+'-assets',app_id:app,dataset_ref:'dataset.json',assets:old.catalog.map(a=>descriptor(a,d)),extensions:[]},blobs:copy(old.blobs)};
}
module.exports={descriptor,bundle};
