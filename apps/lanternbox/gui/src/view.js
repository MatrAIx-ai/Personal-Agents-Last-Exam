(function(root,factory){
  const view=factory();
  if(typeof module==='object' && module.exports) module.exports=view;
  else {root.PaleAppViews=root.PaleAppViews||{};root.PaleAppViews.lanternbox=view;}
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  // Reviewer renderer: every value is escaped; nothing from App data is executed.
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function render(items){
    return '<section aria-label="lanternbox records">'+items.map(item=>
      '<article data-record-id="'+escape(item.title_id||item.profile_id||item.device_id||item.charge_id||item.id)+'"><h3>'+escape(item.name||item.charge_id||item.id)+
      '</h3><pre>'+escape(JSON.stringify(item,null,2))+'</pre></article>').join('')+'</section>';
  }
  return {render};
});
