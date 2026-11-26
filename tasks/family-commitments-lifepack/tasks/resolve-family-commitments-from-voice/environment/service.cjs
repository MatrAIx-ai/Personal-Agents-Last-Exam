'use strict';
const fs=require('node:fs'), path=require('node:path'), http=require('node:http');
const {Household}=require('./session.cjs');
const {grade}=require('../tests/score.cjs');
async function main(){
  // Exactly one task and initial state per controller process. No reset, schema
  // discovery on Core, arbitrary paths, target identities, or grading API.
  const house=new Household(), start=new Date(), wall=performance.now();
  const privateDir=process.env.PRIVATE_LOGS, resultDir=process.env.RESULT_DIR;
  if(!privateDir||!resultDir) throw Error('Set PRIVATE_LOGS and RESULT_DIR');
  fs.mkdirSync(privateDir,{recursive:true});fs.mkdirSync(resultDir,{recursive:true});
  if(fs.existsSync(path.join(resultDir,'score.json'))) throw Error('Use fresh result storage for each trial');
  const labeled=({hash,stage})=>{
    const file=process.env.CHAT_LABELS;
    if(file){const labels=JSON.parse(fs.readFileSync(file,'utf8'));if(labels[stage+':'+hash])return labels[stage+':'+hash];}
    throw Error('Trusted reader needed before delivery; use a structured utterance or supply CHAT_LABELS');
  };
  await house.init({variant:process.env.VARIANT||'main',reply:process.env.REPLY||'answered',hint:process.env.HINT_MODE==='hinted',adjudicate:labeled});
  let current=await house.advance(), busy=false;
  const server=http.createServer(async(req,res)=>{
    const send=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
    if(req.url==='/ready' && req.method==='GET')return send(200,{ready:true});
    if(req.url!=='/action'||req.method!=='POST')return send(404,{error:'unknown route'});
    if(!current)return send(409,{error:'trial has ended'});
    if(busy)return send(409,{error:'another action is pending'});
    busy=true;
    try{
      let body='';
      for await(const chunk of req){body+=chunk;if(body.length>16384){send(413,{error:'request too large'});return;}}
      const action=JSON.parse(body);
      if(action.op==='observe')return send(200,{event:current});
      if(action.op!=='finish_turn')return send(200,{result:await house.act(action)});
      current=await house.advance();
      if(current)return send(200,{event:current});
      const run={schema:'family-runner/1',type:'controller',started_at:start.toISOString(),elapsed_ms:Math.round(performance.now()-wall),
        variant:house.variant,reply:house.reply,hinted:house.hint,boards:house.boards,trace:house.trace};
      fs.writeFileSync(path.join(privateDir,'trace.json'),JSON.stringify(run)+'\n',{flag:'wx'});
      const score=grade(run);
      fs.writeFileSync(path.join(resultDir,'score.pending'),JSON.stringify(score)+'\n',{flag:'wx'});
      fs.renameSync(path.join(resultDir,'score.pending'),path.join(resultDir,'score.json'));
      await house.close();
      return send(200,{complete:true});
    }catch(e){
      console.error(e.message);
      send(400,{error:'Invalid action or trusted interpretation unavailable'});
    }finally{busy=false;}
  });
  server.listen(Number(process.env.PORT||8080),process.env.LISTEN_HOST||'127.0.0.1',()=>{
    console.log('listening '+server.address().port);
  });
  const stop=async()=>{server.close();await house.close();};
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
