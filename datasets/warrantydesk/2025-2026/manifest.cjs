'use strict';
const C=require('./common.cjs'),{fs,path,hash,assert}=C,id=path.basename(path.dirname(__dirname)),e=C.environment(id,__dirname);
const rawHash=x=>require('node:crypto').createHash('sha256').update(x).digest('hex');
const runtime=path.resolve(e.app,'../../runtime'),base=process.env.PALE_BASE_RUNTIME_ROOT;
assert.ok(base,'Set PALE_BASE_RUNTIME_ROOT to the independent pristine runtime used for base-mcp-readback.json');
const dataset=JSON.parse(fs.readFileSync(path.join(__dirname,'data.json'),'utf8'));
for(const f of ['mcp-readback.json','base-mcp-readback.json']){const r=JSON.parse(fs.readFileSync(path.join(__dirname,f),'utf8'));assert.equal(r.passed,true,f+' must pass');assert.equal(r.dataset_sha256,hash(dataset));assert.equal(r.package_sha256,dataset.app_package_sha256);}
function tree(root){const files=[];function walk(dir){for(const n of fs.readdirSync(dir).sort()){const p=path.join(dir,n);if(fs.statSync(p).isDirectory())walk(p);else files.push({path:path.relative(root,p).split(path.sep).join('/'),sha256:rawHash(fs.readFileSync(p))});}}walk(root);return {algorithm:'SHA256 of ordered JSON file-hash list',sha256:hash(files),file_count:files.length,files};}
const files=fs.readdirSync(__dirname).filter(f=>f!=='manifest.json'&&fs.statSync(path.join(__dirname,f)).isFile()).sort().map(f=>({path:f,sha256:rawHash(fs.readFileSync(path.join(__dirname,f)))}));
const index=path.resolve(e.app,'../../docs/validation',id+'-history-2025-2026.md');files.push({path:'../../../docs/validation/'+id+'-history-2025-2026.md',sha256:rawHash(fs.readFileSync(index))});
C.write(path.join(__dirname,'manifest.json'),{schema:'pale.historical-evidence-manifest.v1',app_id:id,policy_revision:dataset.policy_revision,app_revision:dataset.app_revision,app_package_sha256:dataset.app_package_sha256,dataset_sha256:hash(dataset),files,runtime_trees:{current:tree(runtime),independent_base:tree(path.resolve(base))}});
console.log(JSON.stringify({app:id,manifest_files:files.length,independent_base_verified:true}));
