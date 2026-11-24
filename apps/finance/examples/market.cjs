'use strict';
// Trusted feed runner. Network collection is outside the pure Core plugin.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const app=path.resolve(__dirname,'..'),root=path.resolve(app,'../..'),runtime=process.env.PALE_RUNTIME_ROOT||path.join(root,'runtime');
const {Client}=require(path.join(runtime,'client.cjs')),{start}=require(path.join(runtime,'web/server.cjs'));
const groups=['accounts','proposals','receipts','transactions','assessments','instruments','quotes','market_history','announcements','obligations','rules'];
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const sha=body=>crypto.createHash('sha256').update(body).digest('hex');
const defaultSymbols=read(path.join(app,'market-watchlist.json')).symbols.join(',');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function readSnapshot(infra,wait=pause) {
  for(let attempt=0;attempt<4;attempt++) {
    try{return await infra.call('env.snapshot');}
    catch(error){if(attempt===3||!/App is locked|MCP request timed out/i.test(error.message))throw error;await wait(250*(attempt+1));}
  }
}

function verifyFrame(frame) {
  if(!frame||!frame.snapshot||!Array.isArray(frame.responses))throw Error('Invalid capture frame.');
  const {id,...body}=frame.snapshot;
  if(id!=='snapshot-'+hash(body).slice(0,48))throw Error('Capture snapshot hash mismatch.');
  const responses=new Map();
  for(const response of frame.responses) {
    if(typeof response.body!=='string'||sha(response.body)!==response.sha256)throw Error('Captured provider response hash mismatch.');
    if(!responses.has(response.sha256))responses.set(response.sha256,[]);
    responses.get(response.sha256).push(response);
  }
  for(const row of [...frame.snapshot.quotes,...frame.snapshot.history]) {
    const response=(responses.get(row.raw_sha256)||[]).find(r=>r.provider===row.provider&&r.symbol===row.instrument_id&&r.collected_at===row.collected_at&&r.url===row.source_url);
    if(!response)
      throw Error('Observation provenance does not resolve to its captured provider response.');
  }
  return frame;
}
function readCapture(file) {
  if(fs.statSync(file).size>64*1024*1024)throw Error('Capture exceeds the 64 MiB local archive limit.');
  const capture=read(file);
  if(capture.schema!=='pale.market-capture.v1'||!Array.isArray(capture.frames)||!capture.frames.length||capture.frames.length>2048)throw Error('Invalid market capture archive.');
  for(const frame of capture.frames)verifyFrame(frame);
  const universe=capture.frames[0].snapshot.instruments.map(i=>i.id).sort().join(','),provider=capture.frames[0].snapshot.provider;
  if(capture.frames.some(f=>f.snapshot.provider!==provider||f.snapshot.instruments.map(i=>i.id).sort().join(',')!==universe))throw Error('One capture must use one provider and ticker universe.');
  for(let i=1;i<capture.frames.length;i++)if(Date.parse(capture.frames[i].snapshot.checked_at)<=Date.parse(capture.frames[i-1].snapshot.checked_at))throw Error('Capture frames must have increasing collection times.');
  return capture;
}
function record(file,frame) {
  verifyFrame(frame);
  const capture=fs.existsSync(file)?readCapture(file):{schema:'pale.market-capture.v1',frames:[]};
  if(capture.frames.length&&(capture.frames[0].snapshot.provider!==frame.snapshot.provider||
    capture.frames[0].snapshot.instruments.map(i=>i.id).sort().join(',')!==frame.snapshot.instruments.map(i=>i.id).sort().join(',')))
    throw Error('Choose a new capture file for a different provider or ticker universe.');
  if(capture.frames.some(f=>f.snapshot.id===frame.snapshot.id))return;
  if(capture.frames.length&&Date.parse(frame.snapshot.checked_at)<=Date.parse(capture.frames.at(-1).snapshot.checked_at))throw Error('New collection time must follow the recorded capture.');
  capture.frames.push(frame);
  const encoded=JSON.stringify(capture)+'\n';
  if(Buffer.byteLength(encoded)>64*1024*1024||capture.frames.length>2048)throw Error('Capture archive is full; start a new archive.');
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temporary=file+'.'+process.pid+'.tmp';fs.writeFileSync(temporary,encoded,{mode:0o600,flag:'wx'});fs.renameSync(temporary,file);
}
function collect({symbols=defaultSymbols,provider='yahoo_chart'}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn('python3',['-B',path.join(app,'src/market_data.py'),'--symbols',symbols,'--provider',provider],{stdio:['ignore','pipe','pipe']});
    let text='',errors='',size=0,settled=false;
    const timer=setTimeout(()=>{child.kill('SIGTERM');if(!settled){settled=true;reject(Error('Market collection timed out.'));}},120000);
    child.stdout.on('data',bytes=>{size+=bytes.length;if(size>16*1024*1024)child.kill('SIGTERM');else text+=bytes;});
    child.stderr.on('data',bytes=>{if(errors.length<2000)errors+=bytes;});
    child.on('error',e=>{clearTimeout(timer);if(!settled){settled=true;reject(e);}});
    child.on('close',code=>{clearTimeout(timer);if(settled)return;settled=true;
      if(code!==0)return reject(Error(errors.trim()||'Market collector failed.'));
      try {const frame=verifyFrame(JSON.parse(text));for(const part of frame.continuations||[])verifyFrame(part);resolve(frame);}catch(e){reject(e);}
    });
  });
}
function framesOf(frame){const {continuations,...first}=frame;return [first,...(continuations||[])];}
function seedFor(frame,mode) {
  const snapshot=verifyFrame(frame).snapshot,data=read(path.join(app,'fixtures/minimal.json'));
  data.holdings=[];data.proposals=[];data.receipts=[];data.assessments=[];data.next_id=1;
  data.transactions=data.transactions.filter(t=>Date.parse(t.at)<=Date.parse(snapshot.checked_at));
  data.instruments=structuredClone(snapshot.instruments);data.quotes=structuredClone(snapshot.quotes);data.market_history=structuredClone(snapshot.history);data.announcements=[];
  data.market_source={mode,provider:snapshot.provider,status:snapshot.status,checked_at:snapshot.checked_at,
    last_success_at:snapshot.quotes.length?snapshot.checked_at:null,snapshot_id:snapshot.id,errors:structuredClone(snapshot.errors)};
  return data;
}
async function initialize(infra,frame,mode) {
  const observed=await readSnapshot(infra);
  if(observed.status!=='ok')throw Error(observed.message||'Unable to inspect the market run.');
  const s=observed.snapshot;
  if(s.data.market_source?.mode===mode) {
    const ids=s.data.instruments.map(i=>i.id).sort().join(','),incoming=frame.snapshot.instruments.map(i=>i.id).sort().join(',');
    if(s.data.market_source.provider!==frame.snapshot.provider||ids!==incoming)throw Error('This run uses another provider or ticker universe. Choose a new run.');
    return s;
  }
  if(s.revision!==0||s.epoch!==1||s.data.proposals.length||s.data.receipts.length||s.data.market_source)throw Error('This run already contains state. Choose a new run; existing balances/actions will not be reset.');
  const data=seedFor(frame,mode),bundle=structuredClone(s.resources.bundle);
  bundle.dataset.dataset_id='finance-'+mode+'-market';
  bundle.dataset.description='Fictional bank accounts with collected market observations; provider data is not relicensed.';
  bundle.dataset.record_source_ids=['authored','market-provider'];
  bundle.dataset.sources=bundle.dataset.sources.filter(source=>source.source_id==='authored');
  bundle.dataset.sources.push({source_id:'market-provider',kind:'collected',description:'Observed market prices, source times and hashes; source responses retained in a separate local capture.',
    uri:frame.snapshot.provider==='yahoo_chart'?'https://query1.finance.yahoo.com/':'https://www.alphavantage.co/documentation/',
    license:'Provider terms; not covered by the synthetic fixture MIT license',usage:'review_required',
    collection:{method:'Read-only public HTTPS JSON capture',collected_at:frame.snapshot.checked_at},generation:null});
  bundle.dataset.expected_counts={records:groups.reduce((n,key)=>n+data[key].length,0),assets:0};
  bundle.dataset.review={status:'pending',reviewer:null,notes:'Review provider reuse terms before publishing captured data. Raw captures stay outside the App source package.'};
  const loaded=await infra.call('env.load_seed',{expected_version:observed.version,request_id:'market-initialize-'+frame.snapshot.id,data,bundle,
    virtual_now:frame.snapshot.checked_at});
  if(loaded.status!=='ready')throw Error(loaded.message||loaded.status);
  return (await readSnapshot(infra)).snapshot;
}
async function importFrame(infra,frame,mode) {
  verifyFrame(frame);
  const event={event_id:'import-'+frame.snapshot.id,at:frame.snapshot.checked_at,operation:'finance.market_imported',payload:{mode,snapshot:frame.snapshot}};
  if(Buffer.byteLength(JSON.stringify(event))>1800000)throw Error('Normalized market snapshot exceeds the MCP input budget.');
  for(let attempt=0;attempt<3;attempt++) {
    const current=await readSnapshot(infra);
    let result;
    try{result=await infra.call('env.apply_event',{expected_version:current.version,event});}
    catch(error){if(attempt<2&&/App is locked|MCP request timed out/i.test(error.message)){await pause(250*(attempt+1));continue;}throw error;}
    if(result.status==='stale_version')continue;
    if(result.status!=='committed')throw Error(result.message||result.status);
    return result;
  }
  throw Error('The run kept changing during market import. Retry this recorded snapshot.');
}
function options(argv) {
  const [command,...args]=argv;
  if(!['collect','live','replay'].includes(command))throw Error('Use market.cjs collect|live|replay [--symbols IBM,SPY,QQQ --capture FILE --run RUN --port PORT --interval SECONDS --frame INDEX].');
  const o={command,symbols:defaultSymbols,provider:'yahoo_chart',run:command==='replay'?'finance-replay':'finance-live',port:command==='replay'?8788:8787,interval:300,
    stateDir:path.join(root,'.state'),registry:path.join(app,'registry.json')};
  for(let i=0;i<args.length;i+=2) {
    const key={'--symbols':'symbols','--provider':'provider','--capture':'capture','--run':'run','--port':'port','--interval':'interval','--frame':'frame','--state-dir':'stateDir','--registry':'registry'}[args[i]],value=args[i+1];
    if(!key||!value)throw Error('Unknown or missing market runner option.');
    o[key]=['port','interval','frame'].includes(key)?Number(value):value;
  }
  if(!Number.isInteger(o.interval)||o.interval<30||o.interval>3600||!Number.isInteger(o.port)||o.port<0||o.port>65535)throw Error('Use a valid port and a collection interval of 30–3600 seconds.');
  o.capture=path.resolve(o.capture||path.join(root,'.artifacts/market-captures',o.run+'.json'));
  return o;
}
async function main(argv=process.argv.slice(2)) {
  const o=options(argv);
  let archive,frame;
  if(o.command==='replay') {archive=readCapture(o.capture);frame=archive.frames[0];}
  else {frame=await collect(o);for(const part of framesOf(frame))record(o.capture,part);}
  if(o.command==='collect') {console.log(JSON.stringify({capture:o.capture,provider:frame.snapshot.provider,status:frame.snapshot.status,symbols:frame.snapshot.instruments.map(i=>i.id),quotes:frame.snapshot.quotes.length,history:framesOf(frame).reduce((n,f)=>n+f.snapshot.history.length,0)}));return;}
  const infra=new Client('finance','infra',o.run,o.stateDir,'finance-trusted-market-runner',{registry:o.registry});
  let host,timer,busy=false,closed=false;
  const close=async()=>{if(closed)return;closed=true;clearInterval(timer);await host?.close();await infra.close();};
  try {
    await infra.initialize();const initialized=await initialize(infra,frame,o.command==='replay'?'replay':'live');
    if(o.command==='replay') {
      const target=o.frame===undefined?archive.frames.length-1:o.frame;
      if(!Number.isInteger(target)||target<0||target>=archive.frames.length)throw Error('Replay frame is outside this capture.');
      const from=archive.frames.findIndex(f=>f.snapshot.id===initialized.data.market_source.snapshot_id);
      if(from<0||target<from)throw Error('Use a new run to replay an earlier point in this capture.');
      for(let i=from+1;i<=target;i++)await importFrame(infra,archive.frames[i],'replay');
    } else {
      if(initialized.data.market_source.snapshot_id!==frame.snapshot.id)await importFrame(infra,framesOf(frame)[0],'live');
      for(const part of framesOf(frame).slice(1))await importFrame(infra,part,'live');
    }
    host=await start({app:'finance',registry:o.registry,run:o.run,stateDir:o.stateDir,port:o.port});
    console.log('Open '+host.accessUrl);console.log((o.command==='replay'?'Offline replay':'Live collection')+' · '+frame.snapshot.provider+' · '+o.run+' · capture '+o.capture);
    if(o.command==='live')timer=setInterval(async()=>{
      if(busy||closed)return;busy=true;
      try {const next=await collect(o);for(const part of framesOf(next)){record(o.capture,part);await importFrame(infra,part,'live');}console.log('Market '+next.snapshot.status+' at '+next.snapshot.checked_at);}
      catch(error){
        console.error('Market update failed; web page remains available: '+error.message);
        if(/archive is full|archive limit|EACCES|ENOSPC/i.test(error.message)){
          clearInterval(timer);console.error('Collection paused. Restart with a new writable capture file to continue.');
        }
      }
      finally{busy=false;}
    },o.interval*1000);
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>close().then(()=>process.exit(0)));
    return {host,infra,close};
  } catch(error) {await close();throw error;}
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={collect,verifyFrame,readCapture,record,seedFor,initialize,importFrame,options,main,framesOf,readSnapshot};
