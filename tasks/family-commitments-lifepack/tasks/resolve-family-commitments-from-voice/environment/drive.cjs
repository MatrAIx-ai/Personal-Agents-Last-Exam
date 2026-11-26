'use strict';
// Trusted controller. Connect an agent over pipes; never mount this package or
// PALE_ROOT into the agent environment. Each incoming JSON line is one request.
const fs=require('node:fs'), readline=require('node:readline');
const {Household}=require('./session.cjs');
const output=value=>process.stdout.write(JSON.stringify(value)+'\n');
async function main(){
  const house=new Household();
  const out=process.env.RUN_TRACE;
  if(!out) throw Error('RUN_TRACE must point to a private host path.');
  const start=new Date(), clock=performance.now();
  try{
    const adjudicate=async({hash,text,stage})=>{
      if(process.env.CHAT_LABELS) {
        const file=JSON.parse(fs.readFileSync(process.env.CHAT_LABELS,'utf8'));
        if(file[stage+':'+hash])return file[stage+':'+hash];
      }
      // Keep ordinary free-text runs pending, never silently infer a failing label.
      throw Error('Independent chat interpretation required at '+stage+' for '+hash+' '+JSON.stringify(text));
    };
    await house.init({variant:process.env.VARIANT||'main',reply:process.env.REPLY||'answered',hint:process.env.HINT_MODE==='hinted',adjudicate});
    output({event:await house.advance()});
    for await(const line of readline.createInterface({input:process.stdin})){
      const a=JSON.parse(line);
      if(a.op==='finish_turn'){
        const next=await house.advance();
        if(!next){
          fs.writeFileSync(out,JSON.stringify({schema:'family-runner/1',type:'external',started_at:start.toISOString(),elapsed_ms:Math.round(performance.now()-clock),variant:house.variant,reply:house.reply,hinted:house.hint,boards:house.boards,trace:house.trace})+'\n',{flag:'wx'});
          output({complete:true});return;
        }
        output({event:next});
      }else output({result:await house.act(a)});
    }
    throw Error('Agent disconnected before the final checkpoint');
  }finally{await house.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
