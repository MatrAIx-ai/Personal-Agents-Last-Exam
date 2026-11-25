'use strict';
const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
const ID={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,149}$'},STR={type:'string'},INT={type:'integer'},VER={type:'object',properties:{epoch:{type:'integer',minimum:1},revision:{type:'integer',minimum:0}},required:['epoch','revision'],additionalProperties:false};
const obj=(properties={},required=Object.keys(properties),extra=false)=>({type:'object',properties,required,additionalProperties:extra});
const allocation=obj({member_id:ID,amount_minor:{type:'integer',minimum:0}}),payer=obj({member_id:ID,amount_minor:{type:'integer',minimum:1}});
const split={type:'object',properties:{type:{enum:['equal','exact','percentage','shares']},member_ids:{type:'array',items:ID,minItems:1,uniqueItems:true},allocations:{type:'array',items:{type:'object',properties:{member_id:ID,amount_minor:{type:'integer',minimum:0},basis_points:{type:'integer',minimum:1,maximum:10000},shares:{type:'integer',minimum:1}},required:['member_id'],additionalProperties:false},minItems:1}},required:['type'],additionalProperties:false};
const expense=obj({description:{type:'string',minLength:1,maxLength:200},date:{type:'string',pattern:'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'},category:{type:'string',minLength:1,maxLength:50},notes:{type:'string',maxLength:5000},amount_minor:{type:'integer',minimum:1},currency:{enum:['USD','CAD','EUR','GBP']},payers:{type:'array',items:payer,minItems:1},split},['description','date','category','amount_minor','currency','payers','split']);
const output={type:'object',properties:{status:{enum:['ok','committed','ready']},app_id:{const:'ledgerleaf-shared-expenses'},version:VER},required:['status','app_id','version'],additionalProperties:true};
function tool(name,description,read_only,properties={},required=[]){if(!read_only){properties={...properties,expected_version:VER,request_id:ID};required=[...required,'expected_version','request_id'];}return {name:`ledgerleaf-shared-expenses.${name}`,description,read_only,scope:`ledgerleaf-shared-expenses.${name}`,resource_target:'current Ledgerleaf account and authorized group objects',inputSchema:obj(properties,required),outputSchema:output};}
const tools=[
 tool('group.list','List groups and lifecycle state without changing the ledger.',true,{status:{enum:['active','archived']}},[]),
 tool('group.create','Create a single-currency group with the account owner as administrator.',false,{name:{type:'string',minLength:1,maxLength:120},type:{enum:['household','trip','couple','general']},currency:{enum:['USD','CAD','EUR','GBP']},member_ids:{type:'array',items:ID,uniqueItems:true,maxItems:50}},['name','type','currency']),
 tool('group.get','Read a group, membership, balances and simplified obligations.',true,{id:ID},['id']),
 tool('group.update','Rename or recategorize an active group using its business version.',false,{id:ID,group_version:{type:'integer',minimum:1},patch:obj({name:{type:'string',minLength:1,maxLength:120},type:{enum:['household','trip','couple','general']}},[],false)},['id','group_version','patch']),
 tool('group.archive','Archive a group; history remains readable and new expenses are rejected.',false,{id:ID,group_version:{type:'integer',minimum:1}},['id','group_version']),
 tool('group.member.list','List current and former members with bound synthetic profiles.',true,{group_id:ID},['group_id']),
 tool('member.directory.list','List synthetic member profiles available to add to groups.',true,{},[]),
 tool('group.member.add','Add or restore a synthetic member when the caller is an administrator.',false,{group_id:ID,group_version:{type:'integer',minimum:1},member_id:ID,role:{enum:['admin','member']}},['group_id','group_version','member_id']),
 tool('group.member.remove','Mark a member former only after their net balance reaches zero.',false,{group_id:ID,group_version:{type:'integer',minimum:1},member_id:ID},['group_id','group_version','member_id']),
 tool('expense.list','List active expenses or include historical tombstones.',true,{group_id:ID,include_deleted:{type:'boolean'}},['group_id']),
 tool('expense.get','Read one expense and all immutable revisions.',true,{id:ID},['id']),
 tool('expense.preview','Persist an expiring create, full-replacement update, or delete preview bound to object versions.',false,{mode:{enum:['create','update','delete']},group_id:ID,expense_id:ID,expense_version:{type:'integer',minimum:1},expense},['mode','group_id']),
 tool('expense.create','Commit an unexpired create preview exactly once.',false,{preview_id:ID},['preview_id']),
 tool('expense.update','Commit an unexpired full-replacement preview and append a revision.',false,{preview_id:ID},['preview_id']),
 tool('expense.delete','Commit an unexpired delete preview and retain a tombstone.',false,{preview_id:ID},['preview_id']),
 tool('group.balances.get','Derive zero-sum member balances and deterministic pairwise obligations.',true,{group_id:ID},['group_id']),
 tool('settlement.plan.preview','Persist an expiring debt-simplification plan without moving money.',false,{group_id:ID},['group_id']),
 tool('settlement.list','List immutable settlements and their reversal status.',true,{group_id:ID},['group_id']),
 tool('settlement.preview','Persist an external settlement confirmation bound to current balances.',false,{group_id:ID,from_member_id:ID,to_member_id:ID,amount_minor:{type:'integer',minimum:1},method:{enum:['cash','bank','payment_app','other']},note:{type:'string',maxLength:500}},['group_id','from_member_id','to_member_id','amount_minor','method']),
 tool('settlement.record','Record evidence of an external settlement; Ledgerleaf never moves funds.',false,{preview_id:ID},['preview_id']),
 tool('settlement.reverse','Reverse a settlement explicitly without rewriting the original record.',false,{id:ID,settlement_version:{type:'integer',minimum:1},reason:{type:'string',minLength:1,maxLength:500}},['id','settlement_version','reason']),
 tool('group.activity.list','Read chronological business activity and optional notification preparation state.',true,{group_id:ID,limit:{type:'integer',minimum:1,maximum:500}},['group_id'])
];
fs.writeFileSync(path.join(root,'tools.json'),JSON.stringify(tools,null,2)+'\n');
