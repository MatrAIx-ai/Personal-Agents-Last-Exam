'use strict';
const a=require('node:assert/strict'),p=require('../plugin.cjs'),e=require('./scenario.json');
const d=structuredClone(require('../fixtures/minimal.json'));
const ctx={app_id:'civic311',binding:require('../fixtures/binding.json'),virtual_now:require('../fixtures/clock.json').initial_time,role:'agent'};
p.validateSeed(ctx,d);
const saved=p.handleTool(ctx,d,'civic311.save_watch',{case_id:'C17',change_types:['resolved'],request_id:'example'}).result;
p.applyEvent({...ctx,role:'infra',virtual_now:e.at},d,e);
a.equal(d.activity.length,1);
console.log(JSON.stringify({watch:saved.watch,reminder:d.activity[0]},null,2));
