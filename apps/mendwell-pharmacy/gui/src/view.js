(function(root,factory){
  const view=factory();
  if(typeof module==='object' && module.exports) module.exports=view;
  else {root.PaleAppViews=root.PaleAppViews||{};root.PaleAppViews["mendwell-pharmacy"]=view;}
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function render(items){
    return '<section aria-label="mendwell-pharmacy records">'+items.map(item=>
      '<article data-record-id="'+escape(item.id||item.fill_id||item.rx_id||item.person_id)+'"><h3>'+escape(item.title||item.name||item.display_name||item.fill_id||item.rx_id||item.person_id||item.id)+
      '</h3><pre>'+escape(JSON.stringify(item,null,2))+'</pre></article>').join('')+'</section>';
  }
  return {render};
});
