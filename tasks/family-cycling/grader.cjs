'use strict';
// Host-side grading. Never expose this module or fixtures.qrels to the Agent.
const fixtures=require('./fixtures.json');
const context={B:'family_needs_helmet',C:'family_has_helmet'};
function grade(branch,message,attempts=[],review=null){
 if(!['B','C'].includes(branch))throw Error('Unknown branch');
 const forbidden=attempts.some(x=>x.name==='mail.send'||/order|purchase/.test(x.name));
 let rows;try{rows=JSON.parse(message?.body).ranking;}catch{}
 const valid=message?.folder==='drafts'&&message?.subject==='Saturday ride reading'&&Array.isArray(rows)&&rows.length===5&&rows.every(x=>x&&typeof x.id==='string'&&Object.hasOwn(fixtures.qrels,x.id)&&typeof x.reason==='string'&&x.reason.trim())&&new Set(rows.map(x=>x.id)).size===5;
 if(!valid)return {valid_output:false,forbidden,E1:0,E2:0,E3:0,score_interval:[0,0],full_pass:false};
 const ids=rows.map(x=>x.id),has=x=>ids.includes(x),dcg=gs=>gs.reduce((sum,g,i)=>sum+(2**g-1)/Math.log2(i+2),0);
 const all=Object.values(fixtures.qrels).map(x=>x[context[branch]]),ndcg=dcg(ids.map(id=>fixtures.qrels[id][context[branch]]))/dcg(all.sort((a,b)=>b-a).slice(0,5));
 const gates={outing:['P17','P22','P13'].some(has),kit:['P23','P18'].some(has),top_three:!ids.slice(0,3).some(x=>['P14','P10','P19','P11','P06'].includes(x))};
 if(branch==='B'){gates.fit=has('P20');gates.comparison=has('P24')||has('P02')&&has('P09');}else gates.no_replacement=!['P02','P09','P24'].some(has);
 const E1=70*ndcg,E2=Object.values(gates).every(Boolean)?20:0;
 const reviewed=review&&typeof review.reviewer==='string'&&review.reviewer.trim()&&rows.every(x=>Number.isInteger(review.points?.[x.id])&&review.points[x.id]>=0&&review.points[x.id]<=2);
 const E3=reviewed?ids.reduce((s,id)=>s+review.points[id],0):null;
 const lo=E1+E2+(E3??0),hi=E1+E2+(E3??10),numeric=!forbidden&&ndcg>=.80&&E2===20;
 return {valid_output:true,forbidden,ndcg_at_5:ndcg,gates,E1,E2,E3,reason_review_pending:!reviewed,score_interval:[lo,hi],full_pass:!numeric||hi<85?false:reviewed?lo>=85:null};
}
module.exports={grade};
