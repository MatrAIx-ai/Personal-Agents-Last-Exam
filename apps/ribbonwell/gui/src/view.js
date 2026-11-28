(function(root,factory){
  const view=factory();
  if(typeof module==='object' && module.exports) module.exports=view;
  else {root.PaleAppViews=root.PaleAppViews||{};root.PaleAppViews.ribbonwell=view;}
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  // Reviewer renderer: every value is escaped; nothing from App data is executed.
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function render(items){
    return '<section aria-label="ribbonwell records">'+items.map(item=>
      '<article data-record-id="'+escape(item.item_id||item.list_id||item.claim_id||item.exchange_id||item.id)+'"><h3>'+escape(item.name||item.owner_name||item.item_name||item.id)+
      '</h3><pre>'+escape(JSON.stringify(item,null,2))+'</pre></article>').join('')+'</section>';
  }
  return {render};
});
