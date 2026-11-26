#!/usr/bin/env node
'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '../../..');
const taskRoot = path.join(repo, 'tasks/grocery-cap-limit-code/tasks/grocery-cap-limit-code');
const facts = JSON.parse(fs.readFileSync(path.join(taskRoot, 'tests/facts.json'), 'utf8'));
const fresh = JSON.parse(fs.readFileSync(path.join(taskRoot, 'environment/workspace/freshcart/seed.json'), 'utf8'));
const mail = JSON.parse(fs.readFileSync(path.join(taskRoot, 'environment/workspace/mail/seed.json'), 'utf8'));
const policies = JSON.parse(fs.readFileSync(path.join(taskRoot, 'environment/workspace/keelcard/policies.json'), 'utf8'));
const blob = execFileSync('git', ['hash-object', 'proposals/task/grocery-cap-limit-code.md'], { cwd: repo, encoding: 'utf8' }).trim();
if (blob !== '87f75800a3a8c8b9ed56720fa8b68566e4205603') throw new Error('proposal blob ' + blob);
if (fresh.catalog.length !== 40) throw new Error('catalog');
if (fresh.shared_list.length !== 0 || fresh.list_total_cents !== 0) throw new Error('seed list is dated after the seed clock');
if (fresh.card_limit_cents !== facts.per_transaction_cents) throw new Error('cap');
const edits = JSON.parse(fs.readFileSync(path.join(taskRoot, 'environment/workspace/freshcart/list-edits.json'), 'utf8'));
const goods = edits.femi.reduce((sum, row) => sum + row.line_cents, 0) + facts.delivery_cents;
if (goods !== facts.full_cart_cents || edits.grace[0].added_at !== '2026-11-19T18:04:00-05:00') throw new Error('list edits');
const store = mail.messages.filter(row => row.from.includes('orders@freshcart.example'));
const other = mail.messages.filter(row => !row.from.includes('orders@freshcart.example'));
if (store.length !== 31 || other.length !== 12) throw new Error('mail ' + store.length + ' ' + other.length);
const allow = policies.scenario.allow.join(' ');
if (!allow.includes('keelcard.controls.request_change') || !allow.includes('keelcard.controls.confirm_change')) throw new Error('policy');
if (!allow.includes('keelcard.authorizations.lookup')) throw new Error('lookup');
console.log('facts ok');
