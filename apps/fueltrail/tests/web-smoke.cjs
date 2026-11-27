'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {start}=require('../../../runtime/web/server.cjs');
const root=path.resolve(__dirname,'../../..');

test('Fueltrail web controller serves its five views and calls the real business API',async()=>{
 const stateDir=fs.mkdtempSync(path.join(os.tmpdir(),'pale-fueltrail-web-'));
 let host;
 try{
  host=await start({app:'fueltrail',registry:path.join(root,'apps.registry.json'),run:'fueltrail-web-smoke',stateDir,profile:'sandbox'});
  const token=new URL(host.accessUrl).hash.slice('#access='.length);
  const session=await fetch(host.url+'/session',{method:'POST',headers:{Origin:host.url,'Content-Type':'application/json'},body:JSON.stringify({token})});
  assert.equal(session.status,200);const {csrf}=await session.json(),cookie=session.headers.get('set-cookie').split(';')[0];
  const page=await (await fetch(host.url+'/')).text(),controller=await (await fetch(host.url+'/app.js')).text();
  assert.match(page,/Fueltrail/);for(const view of ['Stations','Price alerts','Vehicles','Fuel log','Economy'])assert.match(controller,new RegExp(view));
  assert.match(controller,/fueltrail\.station\.search/);assert.match(controller,/fueltrail\.fuel_log\.preview/);
  const listed=await fetch(host.url+'/api/tools',{headers:{Cookie:cookie}});assert.equal(listed.status,200);
  const tools=(await listed.json()).tools;assert.ok(tools.length>=20);assert.ok(tools.some(x=>x.name==='fueltrail.price_alert.create'));
  const response=await fetch(host.url+'/api/call',{method:'POST',headers:{Origin:host.url,Cookie:cookie,'X-Pale-CSRF':csrf,'Content-Type':'application/json'},body:JSON.stringify({name:'fueltrail.station.search',arguments:{place_id:'place-harbor',grade:'regular',price_type:'credit',radius_milli:10000,sort:'price'}})});
  assert.equal(response.status,200);const result=await response.json();assert.ok(Array.isArray(result.results));assert.ok(result.results.length);
 }finally{if(host)await host.close();fs.rmSync(stateDir,{recursive:true,force:true});}
});
