'use strict';
const data=require('../fixtures/minimal.json'),plugin=require('../plugin.cjs');const ctx={virtual_now:'2026-11-24T09:00:00-08:00',binding:require('../fixtures/binding.json'),log:()=>{}};
const start=structuredClone(data),read=plugin.handleTool(ctx,start,'ledgerleaf-shared-expenses.group.balances.get',{group_id:'group-1'}).result;
const preview=plugin.handleTool(ctx,start,'ledgerleaf-shared-expenses.expense.preview',{mode:'create',group_id:'group-1',request_id:'example-preview',expense:{description:'Example shared lunch',date:'2026-11-24',category:'dining',notes:'Deterministic example',amount_minor:4201,currency:'USD',payers:[{member_id:'member-maya',amount_minor:2201},{member_id:'member-02',amount_minor:2000}],split:{type:'shares',allocations:[{member_id:'member-maya',shares:1},{member_id:'member-02',shares:2},{member_id:'member-03',shares:3}]}}}).result.preview;
const committed=plugin.handleTool(ctx,start,'ledgerleaf-shared-expenses.expense.create',{preview_id:preview.id,request_id:'example-commit'}).result;
const after=plugin.handleTool(ctx,start,'ledgerleaf-shared-expenses.group.balances.get',{group_id:'group-1'}).result;
console.log(JSON.stringify({workflow:'multi-payer shares preview and commit',before:read,preview,committed,after},null,2));
