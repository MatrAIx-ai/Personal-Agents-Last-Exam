#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
function sanitize(value){const copy=structuredClone(value),removed=[];function walk(node,path='root'){if(!node||typeof node!=='object')return;if(!Array.isArray(node)){for(const key of Object.keys(node)){if(key==='auth_code_hash'||key==='auth_code'||key==='code_hash'){removed.push(`${path}.${key}`);delete node[key];continue;}walk(node[key],`${path}.${key}`);}}else node.forEach((item,index)=>walk(item,`${path}[${index}]`));}
 const state=copy.snapshot||copy;if(state.receipts&&typeof state.receipts==='object')for(const [key,receipt]of Object.entries(state.receipts)){const text=JSON.stringify(receipt);if(/auth_code|NGRV-|code_hash/i.test(text)){removed.push(`receipts.${key}`);delete state.receipts[key];}}
 walk(copy);return {snapshot:copy,removed};}
if(require.main===module){const input=process.argv[2];if(!input)throw Error('Usage: node scripts/sanitize-snapshot.cjs SNAPSHOT.json');const result=sanitize(JSON.parse(fs.readFileSync(input,'utf8')));process.stdout.write(JSON.stringify(result,null,2)+'\n');}
module.exports={sanitize};
