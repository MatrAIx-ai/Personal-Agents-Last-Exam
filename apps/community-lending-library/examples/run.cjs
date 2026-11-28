'use strict';
const assert=require('node:assert/strict'),{handleTool,applyEvent,validateSeed}=require('../plugin.cjs');
const d=structuredClone(require('../fixtures/minimal.json')),binding=require('../fixtures/binding.json'),e=require('./scenario.json');
const ctx={binding,role:'agent',virtual_now:d.seed_at};
validateSeed(ctx,d);
applyEvent({...ctx,role:'infra',virtual_now:e.at},d,e);
const v=handleTool({...ctx,virtual_now:e.at},d,'community-lending-library.get_item',{item_id:'I2'});
assert.equal(v.result.item.queue_length,1);assert.equal(v.result.item.your_position,null);
console.log('Synthetic FIFO update changes counts without identifying other members.');
