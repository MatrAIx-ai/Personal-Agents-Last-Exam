(function(root,factory){
  const view=factory();
  if(typeof module==='object' && module.exports) module.exports=view;
  else {root.PaleAppViews=root.PaleAppViews||{};root.PaleAppViews['university-course-registration']=view;}
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  // Compatible reviewer renderer: lists records as escaped text. The business
  // interface is gui/index.html with gui/src/app.js, served by the public Web Host.
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function render(items){
    return '<section aria-label="university course registration records">'+items.map(item=>
      '<article data-record-id="'+escape(item.id)+'"><h3>'+escape(item.code||item.label||item.title||item.id)+
      '</h3><pre>'+escape(JSON.stringify(item,null,2))+'</pre></article>').join('')+'</section>';
  }
  return {render};
});
