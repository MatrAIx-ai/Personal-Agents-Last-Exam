#!/usr/bin/env node
'use strict';
// Public PALE reference launcher; App business modules have no Host imports.
const fs=require('node:fs'),path=require('node:path');
let root=__dirname,runtime=process.env.PALE_RUNTIME_ROOT;
if(!runtime){
  while(!fs.existsSync(path.join(root,'runtime/launch.cjs'))){
    const parent=path.dirname(root);
    if(parent===root)throw Error('Set PALE_RUNTIME_ROOT to the public PALE runtime directory.');
    root=parent;
  }
  runtime=path.join(root,'runtime');
}
require(path.join(path.resolve(runtime),'launch.cjs')).main({appDirectory:__dirname,fixedApp:'pricewatch'});
