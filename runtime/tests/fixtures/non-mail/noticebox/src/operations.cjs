'use strict';
function handleTool(ctx,data,name,args){
 if(name==='noticebox.list')return {data,result:{items:data.items}};
 if(name==='noticebox.add'){const id='item-'+(data.items.length+1);data.items.push({id,text:args.text,timestamp:ctx.virtual_now});return {data,result:{id}};}
 throw Object.assign(Error('Unknown tool'),{code:'not_found'});
}
module.exports={handleTool};
