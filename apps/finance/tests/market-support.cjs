'use strict';
const path=require('node:path'),{spawnSync}=require('node:child_process');
function frame(at='2026-12-01T21:00:00+00:00',value='233.456') {
  const code=`import sys,json
from datetime import datetime
sys.path.insert(0,sys.argv[1])
from market_data import collect
at=datetime.fromisoformat(sys.argv[2]);price=float(sys.argv[3])
payload={'chart':{'result':[{'meta':{'symbol':'IBM','currency':'USD','regularMarketPrice':price,'regularMarketTime':1796158740,'longName':'Test issuer'},'timestamp':[1796049000],'indicators':{'quote':[{'open':[231.125],'high':[235.5],'low':[230.0],'close':[price],'volume':[1234]}]}}]}}
print(json.dumps(collect(['IBM'],request=lambda url:json.dumps(payload).encode(),clock=lambda:at)))`;
  const result=spawnSync('python3',['-B','-c',code,path.resolve(__dirname,'../src'),at,value],{encoding:'utf8'});
  if(result.status!==0)throw Error(result.stderr);
  return JSON.parse(result.stdout);
}
module.exports={frame};
