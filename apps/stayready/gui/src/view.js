(function(root,factory){const view=factory();if(typeof module==='object'&&module.exports)module.exports=view;else{root.PaleAppViews=root.PaleAppViews||{};root.PaleAppViews.stayready=view;}})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  // Reviewer fallback: authorized record text only; interactive workflows use
  // the public pale.web page and Agent MCP session in app.js.
  function render(items){return '<section aria-label="StayReady records">'+items.map(item=>'<article data-record-id="'+escape(item.id)+'"><h3>'+escape(item.name||item.service||item.type||item.id)+'</h3><p>'+escape(item.status||item.reservation_status||'Hotel record')+'</p></article>').join('')+'</section>';}
  return {render};
});
