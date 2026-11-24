'use strict';
function validateSeed(ctx,data){if(data.account_id!=='noticebox-maya'||data.owner_person_id!=='person-maya'||new Set(data.items.map(x=>x.id)).size!==data.items.length)throw Object.assign(Error('Invalid notice fixture'),{code:'invalid_seed'});}
module.exports={validateSeed,records:d=>d.items,objects:d=>d.items.map(x=>x.id),references:()=>[]};
