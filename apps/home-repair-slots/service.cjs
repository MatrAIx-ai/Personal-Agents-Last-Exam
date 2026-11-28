#!/usr/bin/env node
'use strict';
// Provided launcher pattern. Business functions do not import the runtime.
const fs=require('node:fs'),path=require('node:path');
let root=__dirname,runtime;
while(!fs.existsSync(path.join(root,'runtime/launch.cjs'))){
 const parent=path.dirname(root);
 if(parent===root)break;
 root=parent;
}
if(fs.existsSync(path.join(root,'runtime/launch.cjs')))runtime=path.join(root,'runtime');
else if(process.env.PALE_RUNTIME_ROOT)runtime=path.resolve(process.env.PALE_RUNTIME_ROOT);
else throw Error('Run this App in the public PALE checkout, or set PALE_RUNTIME_ROOT to its runtime directory.');
require(path.join(runtime,'launch.cjs')).main({appDirectory:__dirname,fixedApp:'home-repair-slots'});
