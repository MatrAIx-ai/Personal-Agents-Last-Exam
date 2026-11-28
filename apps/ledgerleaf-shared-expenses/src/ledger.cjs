'use strict';
const c=require('./common.cjs');
const CURRENCIES=new Set(['USD','CAD','EUR','GBP']);
function member(data,id){return c.find(data.members,id,'Member');}
function group(data,id){return c.find(data.groups,id,'Group');}
function membership(group,id,{active=true}={}){const row=group.members.find(x=>x.member_id===id);if(!row||active&&row.status!=='active')c.fail('not_group_member','The member is not active in this group.');return row;}
function ownerMember(data){const row=data.members.find(x=>x.person_id===data.owner_person_id);if(!row)c.fail('invalid_seed','The account owner needs a member profile.');return row;}
function ensureGroupOpen(group){if(group.status!=='active')c.fail('group_archived','Archived groups are read-only.');}
function splitMinor(amount,weights){
 if(!Number.isSafeInteger(amount)||amount<=0)c.fail('invalid_amount','Amount must be a positive safe integer in minor units.');
 if(!weights.length||weights.some(x=>!Number.isSafeInteger(x.weight)||x.weight<=0)||new Set(weights.map(x=>x.member_id)).size!==weights.length)c.fail('invalid_split','Split weights must be positive and members unique.');
 const total=weights.reduce((n,x)=>n+x.weight,0);let used=0;
 const rows=weights.map(x=>{const numerator=amount*x.weight,base=Math.floor(numerator/total);used+=base;return {member_id:x.member_id,amount_minor:base,remainder:numerator%total};});
 rows.sort((a,b)=>b.remainder-a.remainder||a.member_id.localeCompare(b.member_id));for(let i=0;i<amount-used;i++)rows[i].amount_minor++;
 return rows.sort((a,b)=>a.member_id.localeCompare(b.member_id)).map(({member_id,amount_minor})=>({member_id,amount_minor}));
}
function normalizePayers(group,amount,payers){
 if(!Array.isArray(payers)||!payers.length||new Set(payers.map(x=>x.member_id)).size!==payers.length)c.fail('invalid_payers','At least one unique payer is required.');
 for(const row of payers){membership(group,row.member_id);if(!Number.isSafeInteger(row.amount_minor)||row.amount_minor<=0)c.fail('invalid_payers','Payer amounts must be positive integers.');}
 if(payers.reduce((n,x)=>n+x.amount_minor,0)!==amount)c.fail('invalid_payers','Paid amounts must equal the expense total.');
 return c.copy(payers).sort((a,b)=>a.member_id.localeCompare(b.member_id));
}
function normalizeSplit(group,amount,split){
 if(!split||!['equal','exact','percentage','shares'].includes(split.type))c.fail('invalid_split','Use equal, exact, percentage, or shares.');
 let rows;
 if(split.type==='equal')rows=splitMinor(amount,(split.member_ids||[]).map(member_id=>({member_id,weight:1})));
 if(split.type==='exact'){
  rows=c.copy(split.allocations||[]);if(!rows.length||new Set(rows.map(x=>x.member_id)).size!==rows.length||rows.some(x=>!Number.isSafeInteger(x.amount_minor)||x.amount_minor<0)||rows.reduce((n,x)=>n+x.amount_minor,0)!==amount)c.fail('invalid_split','Exact allocations must be unique nonnegative integers totaling the expense.');
 }
 if(split.type==='percentage'){
  const input=split.allocations||[];if(input.reduce((n,x)=>n+x.basis_points,0)!==10000)c.fail('invalid_split','Percentages must total exactly 100.00%.');rows=splitMinor(amount,input.map(x=>({member_id:x.member_id,weight:x.basis_points})));
 }
 if(split.type==='shares')rows=splitMinor(amount,(split.allocations||[]).map(x=>({member_id:x.member_id,weight:x.shares})));
 if(!rows.length||new Set(rows.map(x=>x.member_id)).size!==rows.length)c.fail('invalid_split','At least one unique participant is required.');
 for(const row of rows)membership(group,row.member_id);
 return rows.sort((a,b)=>a.member_id.localeCompare(b.member_id));
}
function normalizeExpense(data,group,fields){
 ensureGroupOpen(group);const amount=Number(fields.amount_minor);const currency=String(fields.currency||'');if(!CURRENCIES.has(currency)||currency!==group.currency)c.fail('unsupported_currency','Expense currency must match the group currency.');
 const payers=normalizePayers(group,amount,fields.payers),shares=normalizeSplit(group,amount,fields.split);
 const date=String(fields.date||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(`${date}T00:00:00Z`).toISOString().slice(0,10)!==date)c.fail('invalid_date','Expense date must be a real YYYY-MM-DD date.');
 return {description:c.text(fields.description,'Description',200),date,category:c.text(fields.category||'other','Category',50),notes:String(fields.notes||'').slice(0,5000),amount_minor:amount,currency,payers,shares,split_rule:c.copy(fields.split)};
}
function delta(expense,sign=1){const out=new Map();for(const x of expense.payers)out.set(x.member_id,(out.get(x.member_id)||0)+sign*x.amount_minor);for(const x of expense.shares)out.set(x.member_id,(out.get(x.member_id)||0)-sign*x.amount_minor);return out;}
function combine(...maps){const out=new Map();for(const map of maps)for(const[k,v]of map)out.set(k,(out.get(k)||0)+v);return out;}
function balances(data,groupId){
 const g=group(data,groupId),out=new Map(g.members.map(x=>[x.member_id,0]));
 for(const e of data.expenses.filter(x=>x.group_id===groupId&&x.status==='active'))for(const[k,v]of delta(e))out.set(k,(out.get(k)||0)+v);
 for(const s of data.settlements.filter(x=>x.group_id===groupId&&x.status==='active')){out.set(s.from_member_id,(out.get(s.from_member_id)||0)+s.amount_minor);out.set(s.to_member_id,(out.get(s.to_member_id)||0)-s.amount_minor);}
 const rows=[...out].map(([member_id,balance_minor])=>({member_id,balance_minor})).sort((a,b)=>a.member_id.localeCompare(b.member_id));
 if(rows.reduce((n,x)=>n+x.balance_minor,0)!==0)c.fail('ledger_invariant','The group ledger is not zero-sum.');return rows;
}
function obligations(data,groupId){
 const rows=balances(data,groupId),debtors=rows.filter(x=>x.balance_minor<0).map(x=>({id:x.member_id,amount:-x.balance_minor})).sort((a,b)=>a.id.localeCompare(b.id)),creditors=rows.filter(x=>x.balance_minor>0).map(x=>({id:x.member_id,amount:x.balance_minor})).sort((a,b)=>a.id.localeCompare(b.id)),out=[];let i=0,j=0;
 while(i<debtors.length&&j<creditors.length){const amount=Math.min(debtors[i].amount,creditors[j].amount);out.push({from_member_id:debtors[i].id,to_member_id:creditors[j].id,amount_minor:amount});debtors[i].amount-=amount;creditors[j].amount-=amount;if(!debtors[i].amount)i++;if(!creditors[j].amount)j++;}
 return out;
}
function asDeltas(map){return [...map].filter(([,amount_minor])=>amount_minor).map(([member_id,amount_minor])=>({member_id,amount_minor})).sort((a,b)=>a.member_id.localeCompare(b.member_id));}
function canManage(group,actor){const m=membership(group,actor);return m.role==='admin';}
function ensureCanEdit(group,expense,actor){if(expense.created_by_member_id!==actor&&!canManage(group,actor))c.fail('permission_denied','Only the expense creator or a group administrator may change this expense.');}
module.exports={CURRENCIES,member,group,membership,ownerMember,ensureGroupOpen,normalizeExpense,delta,combine,balances,obligations,asDeltas,canManage,ensureCanEdit};
