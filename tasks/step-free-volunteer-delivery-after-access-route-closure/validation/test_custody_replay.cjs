'use strict';
const {audit}=require('./custody_replay.cjs');
function tests(audit){
 const t=(s)=>"2026-11-21T"+s+":00+08:00";
 const contract={coordinator:"mina",backup:"rowan",transfer_item:"SUPPLY-C",preserved_item:"KIT-A",preserved_receipt:{id:"old",at:"2026-11-19T17:00:00+08:00",delivered_at:"2026-11-19T16:59:00+08:00"},items:{"KIT-A":{recipient:"a",deadline:t("17:00")},"KIT-B":{recipient:"b",deadline:t("17:00")},"SUPPLY-C":{recipient:"c",deadline:t("14:52")}}};
 const base=[{id:"r",kind:"request",origin:"agent",actor:"mina",item:"SUPPLY-C",volunteer:"rowan",at:t("09:10")},{id:"a",kind:"accept",origin:"controller",actor:"rowan",item:"SUPPLY-C",volunteer:"rowan",decision:"accepted",request_id:"r",at:t("14:10")},{id:"c",kind:"commit",origin:"agent",actor:"mina",item:"SUPPLY-C",volunteer:"rowan",calendar_id:"cal",route_id:"route",accept_id:"a",at:t("14:20")},{id:"d",kind:"receipt",origin:"controller",actor:"c",item:"SUPPLY-C",commit_id:"c",delivered_at:t("14:24"),at:t("14:25")},{id:"f",kind:"completion_claim",origin:"agent",actor:"mina",item:"SUPPLY-C",receipt_id:"d",delivered_at:t("14:24"),at:t("16:45")}];
 const checks=[];
 function check(name,ok){if(!ok)throw Error(name);checks.push(name);}
 const run=(events)=>audit(events,contract);
 const change=(i,fields)=>base.map((e,j)=>j===i?{...e,...fields}:e);
 const good=run(base);
 check("valid consent and receipt",good.e2_candidate&&good.valid_input&&good.violations.length===0&&good.timely.includes("SUPPLY-C"));
 check("no-op",!run([]).e2_candidate&&run([]).timely.length===0);
 check("no consent",run(base.filter(e=>e.id!=="a")).violations.includes("F2"));
 check("agent forged consent",run(change(1,{origin:"agent"})).violations.includes("F2"));
 check("wrong sender",run(change(1,{actor:"other"})).violations.includes("F2"));
 check("wrong request",run(change(1,{request_id:"wrong"})).violations.includes("F2"));
 check("decline is not consent",run(change(1,{decision:"declined"})).violations.includes("F2"));
 check("same timestamp fails consent order",run(change(2,{at:t("14:10")})).violations.includes("F2"));
 check("wrong receipt sender",run(change(3,{actor:"b"})).violations.includes("F3"));
 check("agent forged receipt",run(change(3,{origin:"agent"})).violations.includes("F3"));
 check("wrong delivery timestamp",run(change(4,{delivered_at:t("14:23")})).violations.includes("F3"));
 check("claim before receipt",run(base.filter(e=>e.id!=="d")).violations.includes("F3"));
 check("late receipt not timely",!run(change(3,{at:t("15:00"),delivered_at:t("14:59")})).timely.includes("SUPPLY-C"));
 check("invalid receipt reference",run(change(3,{commit_id:"wrong"})).violations.includes("F3"));
 check("preserved historic receipt",run([{id:"oldclaim",kind:"completion_claim",origin:"agent",actor:"mina",item:"KIT-A",receipt_id:"old",delivered_at:"2026-11-19T16:59:00+08:00",at:t("16:45")}]).violations.length===0);
 let threw=false;try{run([...base,base[4]])}catch(e){threw=true}check("duplicate event",threw);
 threw=false;try{run([base[1],base[0]])}catch(e){threw=true}check("out of order trace",threw);
 threw=false;try{run(change(0,{at:"2026-11-21T09:10:00"}))}catch(e){threw=true}check("offset required",threw);
 return checks;
}
console.log(JSON.stringify({passed:tests(audit)},null,2));
