'use strict';
// Legacy reviewer-renderer compatibility. The interactive product UI is gui/src/app.js.
module.exports=function render(state){return {title:'Parkstead Parking',summary:`${state.data.facilities.length} facilities · ${state.data.reservations.length} reservations`,records:state.data.reservations.map(x=>({id:x.id,title:x.status,subtitle:`${x.arrival_at} – ${x.departure_at}`}))};};
