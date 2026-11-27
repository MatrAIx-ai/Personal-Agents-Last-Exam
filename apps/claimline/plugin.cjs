'use strict';
const m=require('./src/model.cjs');
module.exports={validateSeed:m.validateSeed,records:m.records,objects:data=>m.records(data).map(r=>r.id),references:()=>[],assetReferences:m.assetReferences,handleTool:(ctx,data,name,args)=>require('./src/operations.cjs').handleTool(ctx,data,name.replace(/^claimline\./,'expense.'),args),...require('./src/events.cjs')};
