(function(root,factory){
  const view=factory();
  if(typeof module==='object' && module.exports) module.exports=view;
  else {root.PaleAppViews=root.PaleAppViews||{};root.PaleAppViews.rainshadow=view;}
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  // Compatible reviewer renderer: records as escaped text. The business pages are gui/src/app.js.
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function render(items){
    return '<section aria-label="rainshadow records">'+items.map(item=>
      '<article data-record-id="'+escape(item.id)+'"><h3>'+escape(item.label||item.title||item.name||item.event||item.id)+
      '</h3><pre>'+escape(JSON.stringify(item,null,2))+'</pre></article>').join('')+'</section>';
  }
  return {render};
});
