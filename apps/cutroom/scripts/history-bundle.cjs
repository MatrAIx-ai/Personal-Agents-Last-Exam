'use strict';
// Builds the env.load_seed arguments for the delivery evaluation dataset.
//   const {loadSeedArgs}=require('apps/cutroom/scripts/history-bundle.cjs');
//   infra.call('env.load_seed',{...loadSeedArgs(),expected_version,policies,request_id});
// Blobs are read from each catalog entry's storage.path, relative to the App directory:
// the 24 package images under assets/ and the history thumbnails under datasets/history/assets/.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'datasets/history');
const json=file=>JSON.parse(fs.readFileSync(path.join(dir,file),'utf8'));
function historyBundle(){
  const catalog=json('assets.catalog.json');
  const blobs=Object.fromEntries(catalog.assets.map(a=>[a.asset_id,fs.readFileSync(path.join(root,a.storage.path)).toString('base64')]));
  return {dataset:json('dataset.json'),catalog,blobs};
}
function loadSeedArgs(){
  const dataset=json('dataset.json');
  return {data:json('seed.json'),bundle:historyBundle(),binding:json('binding.json'),
    virtual_now:dataset.sources[0].generation.parameters.load_clock.default_virtual_now};
}
module.exports={historyBundle,loadSeedArgs};
