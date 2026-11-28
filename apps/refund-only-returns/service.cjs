'use strict';
const path=require('node:path');
if(!process.env.PALE_RUNTIME_ROOT)throw Error('Set PALE_RUNTIME_ROOT to the public PALE runtime directory.');
require(path.join(path.resolve(process.env.PALE_RUNTIME_ROOT),'launch.cjs')).main({appDirectory:__dirname,fixedApp:'refund-only-returns'});
