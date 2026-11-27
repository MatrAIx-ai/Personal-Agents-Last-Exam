'use strict';
const path=require('node:path'),root=path.resolve(__dirname,'../../..'),{Client}=require(path.join(root,'runtime/client.cjs'));
(async()=>{const registry=path.join(root,'apps/coverline/registry.json'),run='coverline-demo',stateDir=path.join(root,'.state'),host=await require(path.join(root,'runtime/web/server.cjs')).start({app:'coverline',registry,run,stateDir,port:8792}),infra=new Client('coverline','infra',run,stateDir,'coverline-local-provider',{registry});await infra.initialize();let busy=false,closing=false;
 const timer=setInterval(async()=>{if(busy||closing)return;busy=true;try{await require('./provider-actor.cjs').tick(infra);}catch(e){console.error('Local provider update delayed: '+e.message);}finally{busy=false;}},1500);
 console.log('Open '+host.accessUrl);console.log('Synthetic provider actor enabled. User consent remains Infra-only.');
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{closing=true;clearInterval(timer);await infra.close();await host.close();process.exit(0);});
})().catch(e=>{console.error(e.message);process.exitCode=1;});
