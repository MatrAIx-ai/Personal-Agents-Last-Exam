'use strict';
const fs=require('node:fs');
// Local references and the Harbor oracle share the same reference decisions.
class RemoteHousehold {
  constructor(url){this.url=url;this.stage=null;}
  async call(action){
    const res=await fetch(this.url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(action)});
    if(!res.ok) throw Error('Household service '+res.status+': '+await res.text());
    return res.json();
  }
  async init(){}
  async close(){}
  async advance(){const r=await this.call({op:this.stage?'finish_turn':'observe'});if(r.complete)return null;this.stage=r.event.phase;return r.event;}
  async act(action){return (await this.call(action)).result;}
}
async function replay(options) {
  const house=process.env.FAMILY_ENDPOINT?new RemoteHousehold(process.env.FAMILY_ENDPOINT):new (require('../environment/session.cjs').Household)();
  const started=new Date(),start=performance.now();
  try {
    await house.init(options);
    const controls=options.strategy??'reference';
    const act=async action=>{
      const result=await house.act(action);
      if(result?.status && !['committed','delivered','ok'].includes(result.status)) throw Error(JSON.stringify({action,result}));
      return result;
    };
    let cake='cake',handoff,transport,delegate=false,settled=false;
    const transition=(id,status)=>act({op:'transition',id,status});
    const create=async(category,owner,title,description='')=>(await act({op:'create',category,owner,title,description})).id;
    const assign=(id,owner)=>act({op:'assign',id,owner});
    for(let event=await house.advance();event;event=await house.advance()){
      if(controls==='noop') continue;
      if(event.folder.includes('Saturday board permissions')){
        const note=await act({op:'folder',name:'Saturday board permissions'});
        delegate=note.includes('without asking me again');
      }
      if(event.folder.includes('Cake backup')) await act({op:'folder',name:'Cake backup'});
      if(house.stage==='discussion'){
        await act({op:'folder',name:'Saturday arrangements transcript'});
        await act({op:'folder',name:'Bakery order card'});
        await act({op:'board'});
        if(controls==='alternative') await assign(cake,'mei');
        else if(controls!=='last-name'){
          await transition(cake,'cancelled');
          cake=await create('cake','mei','Collect the cake from Station Road Bakery');
        }
        handoff=await create('handoff','rui','Give Mei the collection code','For Mei, use order BK-613.');
        await transition('pickup','todo');
      }
      if(house.stage==='withdrawal'){
        if(controls!=='last-name'){
          if(controls==='alternative'&&delegate) await assign(cake,'rui');
          else await transition(cake,'cancelled');
        }
        await transition(handoff,'cancelled');
        if(delegate&&controls!=='alternative'&&controls!=='last-name') await transition('cake','todo');
        if(!delegate&&controls!=='combined') await create('authority','rui','May the backup be activated on the board?');
        await transition('pickup','cancelled');
        transport=await create(!delegate&&controls==='combined'?'combined':'transport','rui','How will the bakery trip and car availability work?');
        await act({op:'ask',topic:delegate?'transport':'both'});
      }
      if(house.stage==='transport-reply' && event.message){
        settled=true;await transition('pickup','todo');if(!delegate&&controls==='combined') await act({op:'resolve_transport',id:transport});
        else await transition(transport,'completed');
      }
      if(house.stage==='close') await act({op:'report',cake:delegate?'rui':'none',pickup:settled?'confirmed':'open',permissionPending:!delegate});
    }
    if(process.env.FAMILY_ENDPOINT)return {complete:true};
    return {schema:'family-runner/1',type:'scripted',started_at:started.toISOString(),elapsed_ms:Math.round(performance.now()-start),
      variant:house.variant,reply:house.reply,strategy:controls,hinted:house.hint,boards:house.boards,trace:house.trace};
  } finally {await house.close();}
}
module.exports={replay};
if(require.main===module) replay({variant:process.argv[3],reply:process.argv[4],strategy:process.argv[5],hint:process.argv[6]==='hinted'})
  .then(run=>{if(!process.env.FAMILY_ENDPOINT) fs.writeFileSync(process.argv[2],JSON.stringify(run)+'\n');}).catch(e=>{console.error(e);process.exitCode=1;});
