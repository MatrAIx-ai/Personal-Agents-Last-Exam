'use strict';
const {fail}=require('./domain-utils.cjs');
function add(ctx,parent,files){
 if(!ctx.assets?.add)fail('unsupported_capability','This operation requires the public attachment runtime');
 return ctx.assets.add({object_type:'message',object_id:parent.id,files});
}
module.exports={add};
