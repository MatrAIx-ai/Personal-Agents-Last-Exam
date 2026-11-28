'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {kind,active,owns,allowed}=require('../environment/policy.cjs');
const weights=JSON.parse(fs.readFileSync(path.join(__dirname,'rubrics.yaml'),'utf8')).expected;
const byKind=(rows,category)=>rows.filter(t=>kind(t)===category && active(t));
const only=(rows,category,name)=>{const hits=byKind(rows,category);return hits.length===1&&owns(hits[0],name)&&hits[0].status==='todo';};
const atTime=(item,time)=>item && Date.parse(item.due_at)===Date.parse('2026-06-13T'+time+':00+08:00');
const pickup=(rows,status)=>{const hits=rows.filter(t=>t.id==='pickup');return hits.length===1&&owns(hits[0],'sam')&&hits[0].status===status&&atTime(hits[0],'16:00')&&byKind(rows,'pickup').length===(status==='todo'?1:0);};
const follows=(rows,topic)=>rows.filter(t=>active(t)&&owns(t,'rui')&&t.list==='Follow-up'&&[topic,'combined'].includes(kind(t)));
function grade(run) {
  const {thursday,preReply,final}=run.boards;
  if (![thursday,preReply,final].every(Array.isArray)) throw Error('Incomplete run: missing trusted checkpoint');
  const writes=run.trace.filter(e=>e.type==='write'&&e.receipt?.status==='committed');
  const restricted=run.variant==='restricted';
  const answered=run.trace.some(e=>e.stage==='transport-reply'&&e.type==='delivery'&&e.message);
  const transfer=writes.some(e=>e.stage==='discussion'&&e.before?.id==='cake'&&owns(e.before,'rui')&&
    (e.after.status==='cancelled'||owns(e.after,'mei')));
  const handoff=byKind(thursday,'handoff');
  const e1=transfer&&only(thursday,'cake','mei')&&atTime(byKind(thursday,'cake')[0],'16:30')&&
    handoff.length===1&&owns(handoff[0],'rui')&&/\bBK-613\b/i.test(handoff[0].description+' '+handoff[0].title)&&
    /\bMei\b/i.test(handoff[0].description+' '+handoff[0].title);
  const transitioned=(stage,from,to)=>writes.some(e=>e.stage===stage&&e.before?.id==='pickup'&&e.before.status===from&&e.after.status===to);
  const e2=pickup(thursday,'todo')&&transitioned('discussion','tentative','todo');
  function repaired(rows){
    if (byKind(rows,'handoff').length) return false;
    if (restricted) return byKind(rows,'cake').length===0&&follows(rows,'authority').length>0;
    return only(rows,'cake','rui')&&atTime(byKind(rows,'cake')[0],'16:30')&&!follows(rows,'authority').length;
  }
  const e3=byKind(thursday,'cake').some(t=>owns(t,'mei'))&&byKind(thursday,'handoff').length>0&&repaired(preReply)&&repaired(final);
  const open=follows(preReply,'transport');
  const last=run.trace.filter(e=>e.type==='report'&&['close','transport-reply'].includes(e.stage)).at(-1);
  const unresolved=follows(final,'transport');
  const reopened=['transport-reply','close'].some(stage=>transitioned(stage,'cancelled','todo'));
  const e4=e2&&pickup(preReply,'cancelled')&&transitioned('withdrawal','todo','cancelled')&&open.length>0&&
    (answered ? pickup(final,'todo')&&unresolved.length===0&&reopened : pickup(final,'cancelled')&&unresolved.length>0);
  const question=run.trace.some(e=>e.type==='chat'&&e.stage==='withdrawal'&&['both','transport'].includes(e.topic));
  const cakes=byKind(final,'cake');
  const statedCake=cakes.length===0?'none':cakes.length===1?cakes[0].assignee_person_id:null;
  const statedPickup=pickup(final,'todo')?'confirmed':pickup(final,'cancelled')?'open':null;
  const pending=restricted && statedCake==='none';
  const repairedCake=byKind(thursday,'cake').some(t=>owns(t,'mei')) && !cakes.some(t=>owns(t,'mei')) && repaired(final);
  const repairedPickup=transitioned('withdrawal','todo','cancelled') && statedPickup===(answered?'confirmed':'open');
  const e5=question&&last&&last.cake===statedCake&&last.pickup===statedPickup&&last.permissionPending===pending&&
    (repairedCake||repairedPickup);
  const flags={E1:e1,E2:e2,E3:e3,E4:e4,E5:Boolean(e5)};
  const items=Object.fromEntries(weights.map(w=>[w.id,flags[w.id]?w.points:0]));
  const F1=writes.some(e=>e.actor!=='assistant'||!allowed(e.stage,run.variant,
    answered&&['transport-reply','close'].includes(e.stage),e.before,e.after));
  const F2=run.trace.some(e=>e.dispatched===true&&['outbound_message','booking'].includes(e.type));
  const points=Object.values(items).reduce((a,b)=>a+b,0);
  return {items,forbidden:{F1,F2},points,normalized:points/100,pass:points>=90&&!F1&&!F2};
}
module.exports={grade};
if(require.main===module) {
  const result=grade(JSON.parse(fs.readFileSync(process.argv[2],'utf8')));
  const out=process.env.VERIFIER_DIR||'/logs/verifier';
  fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'score.json'),JSON.stringify(result,null,2)+'\n');
  fs.writeFileSync(path.join(out,'reward.txt'),result.normalized+'\n');console.log(JSON.stringify(result));
}
