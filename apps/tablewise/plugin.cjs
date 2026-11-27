'use strict';
const m=require('./src/model.cjs');
module.exports={validateSeed:m.validateSeed,records:m.records,objects:d=>m.records(d).map(r=>r.id),references:()=>[],assetReferences:m.assetReferences,...require('./src/operations.cjs'),...require('./src/events.cjs')};
