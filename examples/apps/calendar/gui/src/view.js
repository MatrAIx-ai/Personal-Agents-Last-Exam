(function(root,factory){
 'use strict';
 const view=factory();
 if(typeof module==='object'&&module.exports)module.exports=view;
 else{root.PaleAppViews=root.PaleAppViews||{};root.PaleAppViews.calendar=view;}
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function agenda(events,selectedId=null){const labCache={calendar:events},selectedEvent=selectedId;return labCache.calendar.length?labCache.calendar.slice().sort((a,b)=>a.start.localeCompare(b.start)).map(e=>'<button class="agenda-event '+(e.status==='cancelled'?'cancelled':'')+'" data-event-id="'+escape(e.id)+'" aria-pressed="'+(e.id===selectedEvent)+'"><strong>'+escape(e.start.slice(11,16)+'–'+e.end.slice(11,16))+'</strong><span><b>'+escape(e.title)+'</b><small>'+escape(e.id)+' · '+escape(e.location)+' '+(e.status==='cancelled'?'· Cancelled':'')+'</small></span></button>').join(''):'<p class="empty">Refresh to load calendar records.</p>';}
 function attachments(e,labAssets=[]){return (e.attachments||[]).map(id=>{const a=labAssets.find(a=>a.app_id==='calendar'&&a.asset_id===id);return '<button class="attachment-button" data-calendar-asset="'+escape(id)+'"><b>'+escape(a?.filename||id)+'</b><small>'+escape(a?.mime_type||'unknown')+'</small></button>';}).join('');}
 return {agenda,attachments};
});
