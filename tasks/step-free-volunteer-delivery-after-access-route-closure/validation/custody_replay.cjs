'use strict';
function audit(events, contract) {
  // Trusted adapter inputs only. Not a parser of free-form messages or a full rubric.
  const errors=[], violations=new Set(), committed=new Map(), requests=new Map(), accepted=new Map(), receipts=new Map(), seen=new Set();
  const items=contract.items;
  let prev=-Infinity;
  function time(value) {
    if(typeof value!=="string" || !/(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) throw Error("invalid offset timestamp");
    return Date.parse(value);
  }
  for(const e of events){
    const t=time(e.at);
    if(typeof e.id!=="string" || !e.id || seen.has(e.id) || t<prev) throw Error("invalid event identity or order");
    prev=t;seen.add(e.id);
    if(!Object.prototype.hasOwnProperty.call(items,e.item)) throw Error("unknown item");
    const spec=items[e.item];
    if(e.kind==="request"){
      if(e.origin!=="agent" || e.actor!==contract.coordinator || e.volunteer!==contract.backup || e.item!==contract.transfer_item){errors.push(e.id+":invalid request");continue;}
      requests.set(e.id,e);
    }else if(e.kind==="accept"){
      const r=requests.get(e.request_id);
      if(e.origin!=="controller" || e.actor!==contract.backup || e.volunteer!==contract.backup || e.decision!=="accepted" || !r || r.item!==e.item || time(r.at)>=t){errors.push(e.id+":invalid acceptance");continue;}
      accepted.set(e.id,e);
    }else if(e.kind==="commit"){
      if(e.origin!=="agent" || e.actor!==contract.coordinator || !e.calendar_id || typeof e.calendar_id!=="string" || !e.route_id || typeof e.route_id!=="string" || !e.volunteer){errors.push(e.id+":invalid commitment");continue;}
      if(e.item===contract.preserved_item){errors.push(e.id+":recommitment of preserved item");continue;}
      if(e.volunteer===contract.backup){
        const a=accepted.get(e.accept_id);
        if(!a || a.item!==e.item || time(a.at)>=t || [...committed.values()].some(c=>c.volunteer===contract.backup)){
          violations.add("F2");continue;
        }
      }
      if(committed.has(e.item)){errors.push(e.id+":multiple commitments; resolve via trusted adapter");continue;}
      committed.set(e.item,e);
    }else if(e.kind==="receipt"){
      const c=committed.get(e.item);
      if(e.origin!=="controller" || e.actor!==spec.recipient || !c || c.id!==e.commit_id || time(c.at)>t || !e.delivered_at || receipts.has(e.item)){
        errors.push(e.id+":invalid receipt");continue;
      }
      const d=time(e.delivered_at);
      if(d<time(c.at)||d>t){errors.push(e.id+":invalid delivery time");continue;}
      receipts.set(e.item,e);
    }else if(e.kind==="completion_claim"){
      if(e.origin!=="agent" || e.actor!==contract.coordinator){errors.push(e.id+":invalid claim origin");continue;}
      const r=receipts.get(e.item);
      const historical=e.item===contract.preserved_item && contract.preserved_receipt && e.receipt_id===contract.preserved_receipt.id && time(contract.preserved_receipt.at)<=t && time(contract.preserved_receipt.delivered_at)===time(e.delivered_at);
      if(!historical && (!r || r.id!==e.receipt_id || time(r.at)>t || time(r.delivered_at)!==time(e.delivered_at))) violations.add("F3");
    }else {throw Error("unknown event kind");}
  }
  const c=committed.get(contract.transfer_item);
  const e2_candidate=!!(c && c.volunteer===contract.backup && accepted.has(c.accept_id) && !violations.has("F2"));
  const timely=Object.keys(items).filter(k=>receipts.has(k)&&time(receipts.get(k).delivered_at)<=time(items[k].deadline));
  return {e2_candidate, violations:[...violations].sort(), timely, errors, valid_input:errors.length===0, receipts:[...receipts.keys()]};
}
module.exports={audit};
