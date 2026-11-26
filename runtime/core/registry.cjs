'use strict';
const fs=require('node:fs'),path=require('node:path'),{compile}=require('./schema.cjs');
const API='1.2.0',read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
function inside(root,p){if(typeof p!=='string'||path.isAbsolute(p))throw new Error('Package paths must be relative');const abs=fs.realpathSync(path.resolve(root,p));if(abs!==fs.realpathSync(root)&&!abs.startsWith(fs.realpathSync(root)+path.sep))throw new Error('Path escapes approved root');return abs;}
function load(registryFile=path.join(__dirname,'../../examples/registry.json')){
 const root=path.dirname(path.resolve(registryFile)),registry=read(registryFile),apps=new Map(),allTools=new Set();
 if(!compile(read(path.join(__dirname,'schemas/registry.schema.json')),__dirname)(registry))throw new Error('Invalid registry');
 for(const item of registry.apps){
  if(!/^[-a-z][a-z0-9-]*$/.test(item.app_id)||apps.has(item.app_id))throw new Error('Duplicate / invalid app id');
  const dir=inside(root,item.path),manifest=read(inside(dir,'app.json'));
  if(!compile(read(path.join(__dirname,'schemas/app.schema.json')),__dirname)(manifest))throw new Error('Manifest schema validation failed');
  if(manifest.schema_version!==1||manifest.app_id!==item.app_id||manifest.version!==item.version||!/^\d+\.\d+\.\d+$/.test(manifest.version))throw new Error('Manifest identity / pinned version mismatch');
  if(manifest.core_api_version!==API)throw new Error('Incompatible Core API');
  if(!manifest.maintainer?.contact||!manifest.license||!Array.isArray(manifest.dependencies)||!Array.isArray(manifest.event_types)||!manifest.capabilities)throw new Error('Missing contribution metadata');
  inside(dir,'LICENSE');inside(dir,'README.md');inside(dir,manifest.service);
  const tools=read(inside(dir,manifest.tools)),validators={};
  if(!compile(read(path.join(__dirname,'schemas/tools.schema.json')),__dirname)(tools))throw new Error('Tool catalog schema mismatch');
  for(const t of tools){
   if(!/^[a-z][a-z0-9-]*\.[a-z][a-z0-9_.-]*$/.test(t.name)||!t.name.startsWith(item.app_id+'.')||allTools.has(t.name)||typeof t.read_only!=='boolean'||!t.scope||!t.resource_target||!t.description)throw new Error('Duplicate / invalid tool registration');
   if(!t.read_only&&(!t.inputSchema.required?.includes('expected_version')||!t.inputSchema.required?.includes('request_id')))throw new Error('Write tool must require version and request id');
   if(t.inputSchema?.type!=='object'||t.outputSchema?.type!=='object')throw new Error('MCP tool schemas must describe objects');
   allTools.add(t.name);t.validateInput=compile(t.inputSchema,dir);t.validateOutput=compile(t.outputSchema,dir);
  }
  for(const kind of ['seed','state','events']){const f=inside(dir,manifest.schemas[kind]);validators[kind]=compile(read(f),path.dirname(f));}
  const fixtures={};for(const [key,file] of Object.entries(manifest.fixtures))fixtures[key]=read(inside(dir,file));
  const resources=manifest.resources?{catalog:read(inside(dir,manifest.resources.catalog)),directory:inside(dir,manifest.resources.directory)}:null;
  const pkg={dir,manifest,tools,validators,fixtures,resources,dataset:read(inside(dir,manifest.dataset)),entry:inside(dir,manifest.entrypoint)};
  pkg.resourceAccess=require('./registration.cjs').load(item.app_id,tools);
  pkg.contribution=require('./contribution.cjs').load(pkg,inside);
  apps.set(item.app_id,pkg);
 }
 for(const pkg of apps.values())for(const dep of pkg.manifest.dependencies){if(!apps.has(dep.app_id)||apps.get(dep.app_id).manifest.version!==dep.version)throw new Error('Missing / incompatible App dependency');}
 const visiting=new Set(),done=new Set();function visit(id){if(visiting.has(id))throw new Error('Cyclic App dependencies');if(done.has(id))return;visiting.add(id);for(const d of apps.get(id).manifest.dependencies)visit(d.app_id);visiting.delete(id);done.add(id);}for(const id of apps.keys())visit(id);
 // Only approved, fully checked packages can execute entrypoints. Packages are trusted code, not a sandbox.
 for(const pkg of apps.values()){
  pkg.plugin=require(pkg.entry);for(const hook of ['validateSeed','handleTool','applyEvent','objects','references','records'])if(typeof pkg.plugin[hook]!=='function')throw new Error('Missing App hook '+hook);
  if(Boolean(pkg.resources)!==pkg.manifest.capabilities.resources||pkg.resources&&typeof pkg.plugin.assetReferences!=='function')throw new Error('Resource capability / hook mismatch');
  pkg.bundle=require('./assets.cjs').fromPackage(pkg,inside);
  pkg.quality=require('./assets.cjs').check(pkg,pkg.fixtures.seed,pkg.bundle).quality;
 }
 return {root,apps,api:API,initialTime:registry.initial_time||'1970-01-01T00:00:00Z'};
}
module.exports={load,inside,read,API};
