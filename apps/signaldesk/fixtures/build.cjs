'use strict';
const {usageHistoryAt}=require('./usage-history.cjs');
const {plans}=require('../src/catalog.cjs');
const now='2026-01-01T00:00:00.000Z';
function fixture(variant='ordinary'){
  const lines=['owner','sam','lee'].map((person,i)=>({id:'line-0'+(i+1),person_id:'person-'+person}));
  const data={account_id:'carrier-household',owner_person_id:'person-owner',role:'owner',actor_id:'person-owner',sequence:1,
    settled_at:now,plan_id:'family',pending:null,lines,usage:usageHistoryAt(now),passes:[],charges:[],notices:[],previews:[],receipts:[]};
  for(let m=0;m<=12;m++){
    const at=new Date(Date.UTC(2025,m,1)).toISOString();
    data.charges.push({id:'monthly-'+at.slice(0,7),at,source:'family',cents:plans[1].price,line_id:null});
  }
  const pass={id:'pass-seeded',line_id:'line-02',product_id:'world',destination:'JP',remaining_mb:5000,cancelled:false};
  switch(variant){
    case 'ordinary':break;
    case 'pending':data.pending={id:'pending-seeded',plan_id:'basic',effective:'2026-02-01T00:00:00.000Z'};break;
    case 'near-limit':data.usage.push({id:'heavy-use',line_id:'line-01',occurred_at:now,kind:'domestic_data',amount_mb:29900});break;
    case 'scheduled':data.passes.push({...pass,start:'2026-01-03T00:00:00.000Z',end:'2026-01-10T00:00:00.000Z'});break;
    case 'active-expired':
      for(const [id,day] of [['old',10],['current',30]]){
        const start=new Date(Date.UTC(2025,11,day)).toISOString(),end=new Date(Date.UTC(2025,11,day+7)).toISOString();
        data.passes.push({...pass,id,start,end});data.charges.push({id:'activation-'+id,source:id,at:start,cents:2800,line_id:pass.line_id});
        data.notices.push({id:'notice-activation-'+id,at:start,source:'activation-'+id,text:'Pass activated',line_id:pass.line_id});
        if(end<=now)data.notices.push({id:'expiry-'+id,at:end,source:id,text:'Pass expired',line_id:pass.line_id});
      }break;
    case 'member':data.role='member';data.actor_id='person-sam';break;
    default:throw Error('Unknown fixture '+variant);
  }
  return data;
}
module.exports={fixture};
if(require.main===module) console.log(JSON.stringify(fixture(process.argv[2]),null,2));
