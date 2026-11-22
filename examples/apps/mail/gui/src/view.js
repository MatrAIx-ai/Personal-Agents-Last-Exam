(function(root,factory){
 'use strict';
 const view=factory();
 if(typeof module==='object'&&module.exports)module.exports=view;
 else{root.PaleAppViews=root.PaleAppViews||{};root.PaleAppViews.mail=view;}
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 // Rendering only: callers supply authorized MCP results, never a second state store.
 function list(messages,{query='',folder='',selectedId=null}={}){
  const q=query.toLowerCase(),selectedMail=selectedId;
  const records=messages.filter(m=>(!folder||m.folder===folder)&&[m.subject,m.body,m.from,m.thread_id].join(' ').toLowerCase().includes(q)).sort((a,b)=>b.received_at.localeCompare(a.received_at));
  return records.length?records.map(m=>'<button class="mail-choice" data-mail-id="'+escape(m.id)+'" aria-pressed="'+(m.id===selectedMail)+'"><b>'+escape(m.subject)+'</b><small>'+escape(m.from.split('@')[0])+' · '+escape(m.received_at.slice(5,16).replace('T',' '))+'</small><span class="tag '+(m.read?'':'amber')+'">'+(m.read?'Read':'Unread')+'</span> '+(m.attachments.length?'<span class="tag">'+m.attachments.length+' attachments</span>':'')+'</button>').join(''):'<p class="empty">No matching loaded messages.<br>Refresh after an event or reset.</p>';
 }
 function reader(m,labAssets=[]){return '<h3>'+escape(m.subject)+'</h3><div class="mail-from">'+escape(m.from)+' → '+escape(m.to.join(', '))+'<br>'+escape(m.received_at)+'<br>thread: '+escape(m.thread_id)+' · '+escape(m.folder)+'</div><p>'+escape(m.body)+'</p>'+(m.event_ref?'<div class="callout small">Related Calendar / '+escape(m.event_ref.object_id)+'<br>A reference does not grant access.</div>':'')+'<div class="attachment-list">'+m.attachments.map(id=>{const a=labAssets.find(a=>a.app_id==='mail'&&a.asset_id===id);return '<button class="attachment-button" data-asset="'+escape(id)+'"><b>'+escape(a?.filename||id)+'</b><small>'+escape(a?.mime_type||'unknown')+'</small></button>';}).join('')+'</div><div class="media-preview" id="lab-media-preview" hidden></div>';}
 return {list,reader};
});
