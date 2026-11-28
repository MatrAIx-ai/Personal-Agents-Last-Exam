'use strict';
const fs = require('node:fs');
const path = require('node:path');
const plugin = require('../plugin.cjs');
const { compile } = require('../tests/schema-validator.cjs');
const { asActor } = require('../tests/seeds.cjs');
const { ms, toIso, fromLocal, localDate, addDays, weekdayOf, isOpen, intervalsOn, rxExpiry, MINUTE, HOUR, DAY } = require('../src/time.cjs');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'fixtures/minimal.json');
const read = rel => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const BINDING = read('fixtures/binding.json');
const CLOCK = read('fixtures/clock.json').initial_time;
const APP = 'mendwell-pharmacy', P = APP + '.';
const TOOLS = read('tools.json');
const seedValid = compile(read('schemas/seed.schema.json'), path.join(ROOT, 'schemas'));
const eventValid = compile(read('schemas/events.schema.json'), path.join(ROOT, 'schemas'));
const inputValid = new Map(TOOLS.map(t => [t.name, compile(t.inputSchema, ROOT)]));
const WRITES = new Set(TOOLS.filter(t => !t.read_only).map(t => t.name));

const SEED = 2025, FROM = '2025-01-01', TASK_FROM = '2026-01-01';
const HISTORY = /^[a-z]+-h\d+$/;
const TIMELINE_NOTICE = /^n-t\d+$/;
const COUNTED = ['f', 'cl', 'pr', 'rn', 'au', 'ch', 'rf', 'n'];
const LIVE_ID = /\b(?:f|cl|pr|rn|au|ch|rf|n)-\d+\b/g;
const RECORDS = ['prescriptions', 'fills', 'claims', 'authorizations', 'charges', 'grants', 'plan_requests', 'renewals', 'approvals', 'notices'];
const RESTOCKED = [['st-3', 'd-donepezil-5'], ['st-1', 'd-montelukast-4'], ['st-1', 'd-albuterol-90']];

const REGIMENS = [
  ['p4-atorvastatin', 'p-4', 'd-atorvastatin-40', 30, [24, 29], 'st-3'],
  ['p4-warfarin', 'p-4', 'd-warfarin-5', 30, [24, 29], 'st-3'],
  ['p4-donepezil', 'p-4', 'd-donepezil-5', 90, [81, 87], 'st-3'],
  ['p4-amlodipine', 'p-4', 'd-amlodipine-5', 90, [81, 87], 'st-3'],
  ['p2-levothyroxine', 'p-2', 'd-levothyroxine-50', 90, [81, 87], 'st-1'],
  ['p2-lisinopril', 'p-2', 'd-lisinopril-10', 90, [81, 87], 'st-1'],
  ['p2-metformin', 'p-2', 'd-metformin-500', 180, [81, 87], 'st-1'],
  ['p1-sertraline', 'p-1', 'd-sertraline-50', 90, [81, 87], 'st-1'],
  ['p1-omeprazole', 'p-1', 'd-omeprazole-20', 90, [81, 87], 'st-1'],
  ['p3-montelukast', 'p-3', 'd-montelukast-4', 30, [24, 29], 'st-1'],
  ['p3-albuterol', 'p-3', 'd-albuterol-90', 1, [70, 115], 'st-1'],
].map(([key, patient, drug, quantity, gap, store]) => ({ key, patient, drug, quantity, gap, store, actor: patient === 'p-4' ? 'p-4' : 'p-2' }));

const ASK = { 'p-4': [540, 690], 'p-2': [1140, 1290] };
const VISIT = { 'p-4': [null, [600, 870], [600, 870], [600, 870], [600, 870], [600, 870], [600, 720]], 'p-2': [[660, 990], [1060, 1230], [1060, 1230], [1060, 1230], [1060, 1230], [1060, 1230], [600, 960]] };
const HOLDS = [
  ['Pharmacist confirming the dose with the prescriber\'s office', 'The prescriber\'s office confirmed the dose'],
  ['Checking the prescription against the medication list on file', 'Medication list check completed'],
  ['Waiting for the prescriber to confirm the quantity', 'The prescriber confirmed the quantity'],
];
const PA_NOTES = ['Prior authorization form sent by the prescriber', 'Chart notes sent by the prescriber'];
const CARD_SWITCH = '2026-06-01T00:00:00-04:00';

const HISTORY_STEPS = [
  { at: '2025-01-01 10:00', do: 'grant', patient: 'p-1', grantor: 'p-1', grantee: 'p-2', scope: 'refill', fill: null, expires: null },
  { at: '2025-01-01 10:01', do: 'grant', patient: 'p-1', grantor: 'p-1', grantee: 'p-2', scope: 'pickup', fill: null, expires: null },
  { at: '2025-01-08 15:00', do: 'rx', start: true, patient: 'p-4', prescriber: 'dr-2', drug: 'd-atorvastatin-40', quantity: 30, fills: 13 },
  { at: '2025-01-08 15:01', do: 'rx', start: true, patient: 'p-4', prescriber: 'dr-2', drug: 'd-warfarin-5', quantity: 30, fills: 13 },
  { at: '2025-01-08 15:02', do: 'rx', start: true, patient: 'p-4', prescriber: 'dr-2', drug: 'd-donepezil-5', quantity: 90, fills: 5 },
  { at: '2025-01-08 15:03', do: 'rx', start: true, patient: 'p-4', prescriber: 'dr-2', drug: 'd-amlodipine-5', quantity: 90, fills: 5 },
  { at: '2025-01-13 11:00', do: 'rx', start: true, patient: 'p-3', prescriber: 'dr-1', drug: 'd-montelukast-4', quantity: 30, fills: 13 },
  { at: '2025-01-13 11:01', do: 'rx', start: true, patient: 'p-3', prescriber: 'dr-1', drug: 'd-albuterol-90', quantity: 1, fills: 6 },
  { at: '2025-01-20 17:00', do: 'rx', start: true, patient: 'p-2', prescriber: 'dr-3', drug: 'd-levothyroxine-50', quantity: 90, fills: 5 },
  { at: '2025-01-20 17:01', do: 'rx', start: true, patient: 'p-2', prescriber: 'dr-3', drug: 'd-lisinopril-10', quantity: 90, fills: 5 },
  { at: '2025-01-20 17:02', do: 'rx', start: true, patient: 'p-2', prescriber: 'dr-3', drug: 'd-metformin-500', quantity: 180, fills: 5 },
  { at: '2025-01-20 17:03', do: 'rx', start: true, patient: 'p-1', prescriber: 'dr-3', drug: 'd-sertraline-50', quantity: 90, fills: 5 },
  { at: '2025-01-20 17:04', do: 'rx', start: true, patient: 'p-1', prescriber: 'dr-3', drug: 'd-omeprazole-20', quantity: 90, fills: 5 },
  { at: '2025-02-17 09:40', do: 'rx', label: 'amox-1', patient: 'p-3', prescriber: 'dr-1', drug: 'd-amoxicillin-250-5', quantity: 100, fills: 1 },
  { at: '2025-02-17 10:00', do: 'request', fill: 'amox-f1', rx: 'amox-1', store: 'st-1', quantity: 100, actor: 'p-2' },
  { at: '2025-02-17 18:15', do: 'collect', fill: 'amox-f1', collector: 'p-2', card: 'card-4' },
  { at: '2025-03-12 10:00', do: 'grant', patient: 'p-4', grantor: 'p-4', grantee: 'p-1', scope: 'view', fill: null, expires: '2025-07-01T00:00:00-04:00' },
  { at: '2025-11-03 09:30', do: 'rx', label: 'amox-2', patient: 'p-3', prescriber: 'dr-1', drug: 'd-amoxicillin-250-5', quantity: 150, fills: 1 },
  { at: '2025-11-03 10:00', do: 'request', fill: 'amox-f2', rx: 'amox-2', store: 'st-1', quantity: 150, actor: 'p-2' },
  { at: '2025-11-03 12:30', do: 'grant', label: 'amox-2', patient: 'p-3', grantor: 'p-1', grantee: 'p-4', scope: 'pickup', fill: 'amox-f2', expires: null },
  { at: '2025-11-03 12:35', do: 'collector', fill: 'amox-f2', actor: 'p-2', person: 'p-4' },
  { at: '2025-11-03 15:00', do: 'revoke', grant: 'amox-2' },
  { at: '2025-11-03 18:30', do: 'collect', fill: 'amox-f2', collector: 'p-2', card: 'card-4' },
];

const TIMELINE = [
  { at: '2026-01-01 10:00', do: 'grant', id: 'g-1', patient: 'p-4', grantor: 'p-4', grantee: 'p-1', scope: 'view', fill: null, expires: '2026-12-01T00:00:00-05:00' },
  { at: '2026-01-07 14:00', do: 'rx', id: 'rx-1', patient: 'p-4', prescriber: 'dr-2', drug: 'd-atorvastatin-40', quantity: 30, fills: 12 },
  { at: '2026-01-07 14:01', do: 'rx', id: 'rx-2', patient: 'p-4', prescriber: 'dr-2', drug: 'd-warfarin-5', quantity: 30, fills: 12 },
  { at: '2026-01-07 14:02', do: 'rx', id: 'rx-3', patient: 'p-4', prescriber: 'dr-2', drug: 'd-donepezil-5', quantity: 90, fills: 4 },
  { at: '2026-01-07 14:03', do: 'rx', id: 'rx-4', patient: 'p-4', prescriber: 'dr-2', drug: 'd-amlodipine-5', quantity: 90, fills: 4 },
  { at: '2026-01-12 10:20', do: 'request', claim: 'p4-donepezil', fill: 'f-1', rx: 'rx-3', store: 'st-3', quantity: 90, actor: 'p-4' },
  { at: '2026-01-12 13:05', do: 'plan', fill: 'f-1', plan: 'pr-1', actor: 'p-4', reason: 'prior_auth_required', note: 'Prior authorization form sent by the prescriber' },
  { at: '2026-01-14 11:00', do: 'decide', plan: 'pr-1', decision: 'approved' },
  { at: '2026-01-14 16:00', do: 'rx', id: 'rx-5', patient: 'p-2', prescriber: 'dr-3', drug: 'd-levothyroxine-50', quantity: 90, fills: 3 },
  { at: '2026-01-14 16:01', do: 'rx', id: 'rx-6', patient: 'p-2', prescriber: 'dr-3', drug: 'd-lisinopril-10', quantity: 90, fills: 5 },
  { at: '2026-01-14 16:02', do: 'rx', id: 'rx-7', patient: 'p-2', prescriber: 'dr-3', drug: 'd-metformin-500', quantity: 180, fills: 5 },
  { at: '2026-01-14 16:03', do: 'rx', id: 'rx-8', patient: 'p-1', prescriber: 'dr-3', drug: 'd-sertraline-50', quantity: 90, fills: 5 },
  { at: '2026-01-14 16:04', do: 'rx', id: 'rx-11', patient: 'p-1', prescriber: 'dr-3', drug: 'd-omeprazole-20', quantity: 90, fills: 4 },
  { at: '2026-01-15 11:30', do: 'collect', fill: 'f-1', collector: 'p-4', card: 'card-1', resume: true },
  { at: '2026-02-03 11:00', do: 'rx', id: 'rx-12', patient: 'p-3', prescriber: 'dr-1', drug: 'd-montelukast-4', quantity: 30, fills: 12 },
  { at: '2026-02-23 19:30', do: 'renew', claim: 'p3-albuterol', renewal: 'rn-1', reg: 'p3-albuterol', actor: 'p-2', note: 'The inhaler prescription has expired' },
  { at: '2026-02-24 15:00', do: 'reply', renewal: 'rn-1', decision: 'approved', rx: { id: 'rx-13', quantity: 1, fills: 4 } },
  { at: '2026-02-24 18:00', do: 'request', fill: 'f-2', rx: 'rx-13', store: 'st-1', quantity: 1, actor: 'p-2' },
  { at: '2026-02-25 18:20', do: 'collect', fill: 'f-2', collector: 'p-2', card: 'card-4', resume: true },
  { at: '2026-03-09 10:30', do: 'rx', id: 'rx-14', patient: 'p-3', prescriber: 'dr-1', drug: 'd-amoxicillin-250-5', quantity: 100, fills: 1 },
  { at: '2026-03-09 11:00', do: 'request', fill: 'f-3', rx: 'rx-14', store: 'st-1', quantity: 100, actor: 'p-2' },
  { at: '2026-03-09 11:05', do: 'grant', id: 'g-2', patient: 'p-3', grantor: 'p-2', grantee: 'p-4', scope: 'pickup', fill: 'f-3', expires: null },
  { at: '2026-03-09 13:35', do: 'collector', fill: 'f-3', actor: 'p-2', person: 'p-4' },
  { at: '2026-03-09 16:10', do: 'collect', fill: 'f-3', collector: 'p-4', card: 'card-1' },
  { at: '2026-04-13 09:40', do: 'request', claim: 'p4-donepezil', fill: 'f-4', rx: 'rx-3', store: 'st-3', quantity: 90, actor: 'p-4' },
  { at: '2026-04-13 12:30', do: 'plan', fill: 'f-4', plan: 'pr-2', actor: 'p-4', reason: 'prior_auth_required', note: 'Prior authorization form sent by the prescriber' },
  { at: '2026-04-15 10:00', do: 'decide', plan: 'pr-2', decision: 'denied' },
  { at: '2026-04-15 14:00', do: 'plan', fill: 'f-4', plan: 'pr-3', actor: 'p-4', reason: 'prior_auth_required', note: 'Chart notes sent by the prescriber' },
  { at: '2026-04-17 11:00', do: 'decide', plan: 'pr-3', decision: 'approved' },
  { at: '2026-04-17 14:45', do: 'collect', fill: 'f-4', collector: 'p-4', card: 'card-1', resume: true },
  { at: '2026-05-18 19:00', do: 'request', claim: 'p1-sertraline', fill: 'f-5', rx: 'rx-8', store: 'st-1', quantity: 90, actor: 'p-2' },
  { at: '2026-05-19 08:30', do: 'plan', fill: 'f-5', plan: 'pr-4', actor: 'p-2', reason: 'refill_too_soon', note: 'Extra supply before a work trip' },
  { at: '2026-05-19 18:00', do: 'request', claim: 'p2-lisinopril', fill: 'f-6', rx: 'rx-6', store: 'st-1', quantity: 90, actor: 'p-2' },
  { at: '2026-05-19 18:01', do: 'request', claim: 'p2-levothyroxine', fill: 'f-7', rx: 'rx-5', store: 'st-1', quantity: 90, actor: 'p-2' },
  { at: '2026-05-19 18:02', do: 'request', claim: 'p2-metformin', fill: 'f-8', rx: 'rx-7', store: 'st-1', quantity: 180, actor: 'p-2' },
  { at: '2026-05-20 08:00', do: 'plan', fill: 'f-6', plan: 'pr-5', actor: 'p-2', reason: 'refill_too_soon', note: 'Vacation supply' },
  { at: '2026-05-20 08:01', do: 'plan', fill: 'f-7', plan: 'pr-6', actor: 'p-2', reason: 'refill_too_soon', note: 'Vacation supply' },
  { at: '2026-05-20 08:02', do: 'plan', fill: 'f-8', plan: 'pr-7', actor: 'p-2', reason: 'refill_too_soon', note: 'Vacation supply' },
  { at: '2026-05-20 12:00', do: 'decide', plan: 'pr-4', decision: 'approved' },
  { at: '2026-05-20 18:30', do: 'collect', fill: 'f-5', collector: 'p-2', card: 'card-4', resume: true },
  { at: '2026-05-21 10:00', do: 'decide', plan: 'pr-5', decision: 'approved' },
  { at: '2026-05-21 10:01', do: 'decide', plan: 'pr-6', decision: 'approved' },
  { at: '2026-05-21 10:02', do: 'decide', plan: 'pr-7', decision: 'denied' },
  { at: '2026-05-21 12:00', do: 'wait', fill: 'f-8', actor: 'p-2', collect: { days: 1, time: '12:30', collector: 'p-2', card: 'card-3', resume: true } },
  { at: '2026-05-21 12:30', do: 'prepay', fill: 'f-7', actor: 'p-2', card: 'card-3' },
  { at: '2026-05-21 17:58', do: 'collect', fill: 'f-6', collector: 'p-2', card: 'card-2', expect: 'refused' },
  { at: '2026-05-21 18:00', do: 'collect', fill: 'f-6', collector: 'p-2', card: 'card-3', resume: true },
  { at: '2026-05-21 18:02', do: 'collect', fill: 'f-7', collector: 'p-2', resume: true },
  { at: '2026-07-13 09:50', do: 'request', claim: 'p4-donepezil', fill: 'f-9', rx: 'rx-3', store: 'st-3', quantity: 90, actor: 'p-4' },
  { at: '2026-07-13 12:40', do: 'plan', fill: 'f-9', plan: 'pr-8', actor: 'p-4', reason: 'prior_auth_required', note: 'Prior authorization form sent by the prescriber' },
  { at: '2026-07-15 10:30', do: 'decide', plan: 'pr-8', decision: 'approved' },
  { at: '2026-07-16 11:15', do: 'collect', fill: 'f-9', collector: 'p-4', card: 'card-1', resume: true },
  { at: '2026-08-05 10:00', do: 'request', claim: 'p4-warfarin', margin: 7, fill: 'f-10', rx: 'rx-2', store: 'st-3', quantity: 30, actor: 'p-4' },
  { at: '2026-08-05 13:00', do: 'plan', fill: 'f-10', plan: 'pr-9', actor: 'p-4', reason: 'refill_too_soon', note: 'Replacement for a lost supply' },
  { at: '2026-08-06 10:00', do: 'decide', plan: 'pr-9', decision: 'approved' },
  { at: '2026-08-06 14:00', do: 'collect', fill: 'f-10', collector: 'p-4', card: 'card-1', resume: true },
  { at: '2026-08-25 09:00', do: 'request', claim: 'p4-atorvastatin', fill: 'f-11', rx: 'rx-1', store: 'st-3', quantity: 90, actor: 'p-4' },
  { at: '2026-08-25 11:30', do: 'expect', fill: 'f-11', actor: 'p-4', state: 'claim_rejected', reason: 'quantity_limit' },
  { at: '2026-08-25 11:45', do: 'quantity', fill: 'f-11', actor: 'p-4', quantity: 30 },
  { at: '2026-08-25 11:55', do: 'expect', fill: 'f-11', actor: 'p-4', state: 'ready' },
  { at: '2026-08-25 13:30', do: 'collect', fill: 'f-11', collector: 'p-4', card: 'card-1', resume: true },
  { at: '2026-10-12 09:45', do: 'request', claim: 'p4-donepezil', fill: 'f-12', rx: 'rx-3', store: 'st-3', quantity: 90, actor: 'p-4' },
  { at: '2026-10-12 12:30', do: 'plan', fill: 'f-12', plan: 'pr-10', actor: 'p-4', reason: 'prior_auth_required', note: 'Prior authorization form sent by the prescriber' },
  { at: '2026-10-13 09:00', do: 'withdraw', plan: 'pr-10', actor: 'p-4' },
  { at: '2026-10-13 09:05', do: 'plan', fill: 'f-12', plan: 'pr-11', actor: 'p-4', reason: 'prior_auth_required', note: 'Corrected prior authorization form sent by the prescriber' },
  { at: '2026-10-15 10:00', do: 'decide', plan: 'pr-11', decision: 'approved' },
  { at: '2026-10-16 11:00', do: 'collect', fill: 'f-12', collector: 'p-4', card: 'card-1', resume: true },
  { at: '2026-10-19 07:30', do: 'request', claim: 'p3-montelukast', fill: 'f-13', rx: 'rx-12', store: 'st-3', quantity: 30, actor: 'p-2' },
  { at: '2026-10-19 07:45', do: 'cancel', fill: 'f-13', actor: 'p-2', resume: true },
  { at: '2026-11-06 08:30', do: 'request', claim: 'p1-omeprazole', fill: 'f-14', rx: 'rx-11', store: 'st-1', quantity: 90, actor: 'p-2' },
  { at: '2026-11-06 11:00', do: 'cash', fill: 'f-14', actor: 'p-2', reason: 'not_covered' },
  { at: '2026-11-10 20:00', do: 'renew', claim: 'p2-levothyroxine', renewal: 'rn-2', rx: 'rx-5', actor: 'p-2', note: 'The last refill has been used' },
  { at: '2026-11-16 09:30', do: 'request', claim: 'p4-atorvastatin', fill: 'f-15', rx: 'rx-1', store: 'st-2', quantity: 30, actor: 'p-4' },
  { at: '2026-11-16 10:00', do: 'request', claim: 'p2-metformin', fill: 'f-16', rx: 'rx-7', store: 'st-1', quantity: 180, actor: 'p-2' },
  { at: '2026-11-16 12:00', do: 'expect', fill: 'f-15', actor: 'p-4', state: 'waiting_stock' },
  { at: '2026-11-16 13:30', do: 'plan', fill: 'f-16', plan: 'pr-12', actor: 'p-2', reason: 'refill_too_soon', note: 'Holiday travel supply' },
  { at: '2026-11-16 14:00', do: 'request', fill: 'f-17', rx: 'rx-11', store: 'st-1', quantity: 90, actor: 'p-2' },
  { at: '2026-11-16 16:30', do: 'cash', fill: 'f-17', actor: 'p-2', reason: 'not_covered' },
  { at: '2026-11-16 18:00', do: 'prepay', fill: 'f-17', actor: 'p-2', card: 'card-3' },
  { at: '2026-11-17 09:15', do: 'hold', fill: 'f-17', note: 'Pharmacist checking the fill against the medication list on file before release' },
  { at: '2026-11-17 10:00', do: 'request', claim: 'p4-warfarin', fill: 'f-18', rx: 'rx-2', store: 'st-3', quantity: 90, actor: 'p-4' },
  { at: '2026-11-17 12:30', do: 'expect', fill: 'f-18', actor: 'p-4', state: 'claim_rejected', reason: 'quantity_limit' },
  { at: '2026-11-17 15:00', do: 'request', claim: 'p3-montelukast', fill: 'f-19', rx: 'rx-12', store: 'st-1', quantity: 30, actor: 'p-2' },
  { at: '2026-11-17 15:40', do: 'hold', fill: 'f-19', note: 'Pharmacist confirming the dose with the prescriber\'s office' },
  { at: '2026-11-18 10:40', do: 'request', fill: 'f-20', rx: 'rx-8', store: 'st-1', quantity: 90, actor: 'p-2' },
];

const stamp = text => fromLocal(text.slice(0, 10), text.slice(11, 16));
const pad = n => String(n).padStart(2, '0');
const clockOf = minutes => pad(Math.floor(minutes / 60)) + ':' + pad(minutes % 60);
const regOf = (patient, drug) => REGIMENS.find(r => r.patient === patient && r.drug === drug) || null;
const byKey = key => REGIMENS.find(r => r.key === key);

function authored(current) {
  const base = structuredClone(current);
  for (const key of RECORDS) base[key] = [];
  base.issued = {};
  for (const p of base.people) p.grant_set_version = 0;
  for (const [storeId, drugId] of RESTOCKED) delete base.stores.find(s => s.store_id === storeId).stock[drugId];
  return base;
}

function simulate(base, observe) {
  const lcg = seed => { let state = seed; const n = k => { state = (state * 1103515245 + 12345) % 2147483648; return Math.floor(state / 65536) % k; }; return { n, between: (a, b) => a + n(b - a + 1), pick: list => list[n(list.length)] }; };
  const streams = new Map(REGIMENS.map((r, i) => [r.key, lcg(SEED + 1000 * (i + 1))]));
  const R = reg => streams.get(reg.key);
  const END = ms(CLOCK), START = fromLocal(FROM, '00:00');
  let data = structuredClone(base), revision = 0, requests = 0, events = 0, steps = 0, seq = 0, tag = 'history', hRx = 0, hGrant = 0;
  const tags = new Map(), labels = new Map(), queue = [], done = new Set(), routine = new Set(), forgotten = new Set(), swept = new Set();
  const run = new Map(REGIMENS.map(r => [r.key, { claims: TIMELINE.filter(s => s.claim === r.key).map(s => ({ t: stamp(s.at), margin: (s.margin ?? 16) * DAY })).sort((a, b) => a.t - b.t), index: 0, arrivals: TIMELINE.filter(s => s.do === 'rx' && regOf(s.patient, s.drug) === r).map(s => stamp(s.at)) }]));
  const schedule = (t, fn, as = tag) => queue.push({ t, seq: seq++, fn, as });
  const fail = message => { throw new Error(message); };
  const ctxOf = (binding, t, role = 'agent') => ({ app_id: APP, run_id: 'fixture-history', role, virtual_now: toIso(t), binding });
  const relations = new Map(base.people.map(p => [p.person_id, p.relation]));
  const created = () => new Set([...data.fills.map(f => f.fill_id), ...data.renewals.map(r => r.renewal_id)]);
  function valid(state, ctx, when) {
    if (!seedValid(state)) fail('the state ' + when + ' at ' + ctx.virtual_now + ' does not match the seed schema');
    try { plugin.validateSeed(ctx, state); } catch (e) { fail('the state ' + when + ' at ' + ctx.virtual_now + ' fails validateSeed: ' + e.message); }
  }
  function owned(state) {
    const back = asActor(state, BINDING, base.owner_person_id).seed;
    for (const p of back.people) p.relation = relations.get(p.person_id);
    return back;
  }
  function commit(next, t, before) {
    valid(next, ctxOf(BINDING, t), 'after the write');
    if (observe) observe(next, toIso(t));
    data = next;
    steps++;
    revision++;
    for (const id of created()) if (!before.has(id)) tags.set(id, tag);
  }
  function call(t, actor, name, args = {}) {
    const write = WRITES.has(P + name);
    const full = write ? { request_id: 'fixture-' + (++requests), expected_version: { epoch: 1, revision }, ...args } : args;
    if (!inputValid.get(P + name)(full)) fail(name + ' arguments do not match the tool schema: ' + JSON.stringify(args));
    const before = created(), { seed: mine, binding } = asActor(data, BINDING, actor), ctx = ctxOf(binding, t);
    valid(mine, ctx, 'before ' + name + ' as ' + actor);
    let out;
    try { out = plugin.handleTool(ctx, mine, P + name, full); } catch (e) { fail(name + ' at ' + toIso(t) + ' as ' + actor + ': ' + (e.code || 'error') + ' ' + e.message); }
    if (write) {
      valid(out.data, ctx, 'after ' + name + ' as ' + actor);
      commit(owned(out.data), t, before);
    }
    return out.result;
  }
  function event(t, operation, payload) {
    const envelope = { event_id: 'fixture-' + (++events), at: toIso(t), operation, payload };
    if (!eventValid(envelope)) fail(operation + ' does not match the event schema: ' + JSON.stringify(payload));
    const before = created();
    let next;
    try { next = plugin.applyEvent(ctxOf(BINDING, t, 'infra'), structuredClone(data), envelope); } catch (e) { fail(operation + ' at ' + toIso(t) + ': ' + (e.code || 'error') + ' ' + e.message); }
    commit(next, t, before);
  }
  const fillOf = id => data.fills.find(f => f.fill_id === id);
  const regOfFill = id => { const rx = data.prescriptions.find(r => r.rx_id === fillOf(id).rx_id); return regOf(rx.patient_id, rx.drug_id); };
  const storeOf = id => data.stores.find(s => s.store_id === id);
  const view = (t, actor, id) => call(t, actor, 'fills.get', { fill_id: id }).fill;
  const cardFor = (person, t) => (person === 'p-4' ? 'card-1' : t < ms(CARD_SWITCH) ? 'card-4' : 'card-3');
  const currentRx = (reg, t) => data.prescriptions.filter(r => r.patient_id === reg.patient && r.drug_id === reg.drug && r.state === 'active' && ms(r.received_at) <= t && t < rxExpiry(r.written_on) && r.fills_remaining >= 1).sort((a, b) => ms(b.received_at) - ms(a.received_at))[0] || null;
  const near = (reg, t, days) => { const s = run.get(reg.key), c = s.claims[s.index]; return c !== undefined && c.t - t < days * DAY; };
  const askAt = (reg, date) => fromLocal(date, clockOf(R(reg).between(...ASK[reg.actor])));
  const later = (reg, t, low, high) => { let date = addDays(localDate(t), R(reg).between(low, high)), at = askAt(reg, date); while (at <= t) { date = addDays(date, 1); at = askAt(reg, date); } return at; };
  function office(t, days, rand) {
    let date = addDays(localDate(t), days);
    while ([0, 6].includes(weekdayOf(date))) date = addDays(date, 1);
    return fromLocal(date, clockOf(rand.between(540, 990)));
  }
  function visitAt(person, storeId, after, rand) {
    const store = storeOf(storeId);
    for (let d = rand.pick([0, 1, 1, 1, 2, 2, 3]); d < 21; d++) {
      const date = addDays(localDate(after), d), window = VISIT[person][weekdayOf(date)];
      if (!window) continue;
      const t = fromLocal(date, clockOf(rand.between(...window)));
      if (t > after + 45 * MINUTE && isOpen(store, t)) return t;
    }
    return fail('no visit time for ' + person + ' at ' + storeId + ' after ' + toIso(after));
  }
  function closingOf(store, t) {
    for (const date of [addDays(localDate(t), -1), localDate(t)]) for (const [open, close] of intervalsOn(store, date)) if (open <= t && t < close) return close;
    return null;
  }
  function nextNeed(reg, closed) {
    const gap = reg.quantity >= 90 && !near(reg, closed, 120) && R(reg).n(100) < 4 ? R(reg).between(60, 68) : R(reg).between(...reg.gap);
    return askAt(reg, addDays(localDate(closed), gap));
  }
  function planNext(reg, need) {
    const s = run.get(reg.key), claim = s.claims[s.index];
    if (claim !== undefined && need + claim.margin > claim.t) return;
    if (need > END) return;
    schedule(need, t => cycle(reg, t), 'history');
  }
  function resume(reg, need) {
    run.get(reg.key).index++;
    planNext(reg, need);
  }
  function cycle(reg, t) {
    const rx = currentRx(reg, t);
    if (!rx) {
      const arrival = run.get(reg.key).arrivals.find(a => a > t);
      if (arrival !== undefined && arrival - t < 45 * DAY) return planNext(reg, later(reg, arrival, 0, 2));
      return renew(reg, t);
    }
    const fill = call(t, reg.actor, 'fills.request', { rx_id: rx.rx_id, store_id: reg.store, quantity: reg.quantity }).fill;
    routine.add(fill.fill_id);
    const due = ms(fill.review_due_at);
    const rand = R(reg);
    const store = storeOf(reg.store), placed = t + rand.between(15, 40) * MINUTE, close = isOpen(store, placed) ? closingOf(store, placed) : null;
    if (!near(reg, t, 30) && rand.n(100) < 5 && placed < due && close !== null && close - placed >= 2 * HOUR) {
      const [hold, release] = rand.pick(HOLDS), until = Math.min(placed + rand.between(60, 300) * MINUTE, close - 15 * MINUTE);
      schedule(placed, u => event(u, 'fill.hold_placed', { fill_id: fill.fill_id, note: hold }));
      schedule(until, u => event(u, 'fill.hold_released', { fill_id: fill.fill_id, note: release }));
    }
    schedule(due + rand.between(5, 40) * MINUTE, u => check(reg, fill.fill_id, u));
  }
  function renew(reg, t) {
    const old = data.prescriptions.filter(r => r.patient_id === reg.patient && r.drug_id === reg.drug && r.state === 'active').sort((a, b) => ms(b.received_at) - ms(a.received_at))[0];
    const rn = call(t, reg.actor, 'renewals.create', { rx_id: old.rx_id }).renewal;
    schedule(office(t, 1, R(reg)), u => {
      event(u, 'renewal.replied', { renewal_id: rn.renewal_id, decision: 'approved', rx: { rx_id: 'rx-h' + (++hRx), quantity: reg.quantity, fills_authorized: old.fills_authorized, written_on: localDate(u) } });
      planNext(reg, later(reg, u, 0, 1));
    });
  }
  function check(reg, id, t) {
    if (swept.has(id)) return;
    const f = view(t, reg.actor, id);
    if (f.state === 'requested' || f.state === 'pending_plan_decision') return schedule(t + HOUR, u => check(reg, id, u));
    if (f.state === 'ready') return ready(reg, f, t);
    if (f.state === 'waiting_stock') return waiting(reg, f, t);
    if (f.state === 'claim_rejected') return rejected(reg, f, t);
    return fail('fill ' + id + ' is unexpectedly ' + f.state + ' at ' + toIso(t));
  }
  function ready(reg, f, t) {
    const rand = R(reg), r = rand.n(100), s = run.get(reg.key), quiet = near(reg, t, 35) || s.missed;
    if (!quiet && r < 3) { s.missed = true; forgotten.add(f.fill_id); return planNext(reg, later(reg, ms(f.return_at), 1, 3)); }
    if (!quiet && r < 5) return forgotten.add(f.fill_id), schedule(askAt(reg, addDays(localDate(t), 1)), u => {
      s.missed = true;
      const preview = call(u, reg.actor, 'fills.cancel.preview', { fill_id: f.fill_id });
      call(u, reg.actor, 'fills.cancel.confirm', { fill_id: f.fill_id, token: preview.preview.token });
      planNext(reg, later(reg, u, 1, 2));
    });
    return schedule(visitAt(reg.actor, f.store_id, Math.max(t, ms(f.ready_at)), rand), u => collect(reg, f.fill_id, u));
  }
  function attempt(t, id, collector, card) {
    event(t, 'fill.collection_attempted', { fill_id: id, collector_id: collector, ...(card ? { card_id: card } : {}) });
    return fillOf(id).state === 'collected';
  }
  const pickups = [...HISTORY_STEPS, ...TIMELINE].filter(s => s.do === 'collect'), ran = new Set(), covered = new Set();
  const nameOf = id => { for (const [name, value] of labels) if (value === id && !name.startsWith('grant:')) return name; return null; };
  const planned = name => pickups.filter(s => s.fill === name && !ran.has(s) && !covered.has(s));
  function sweepAuthored(collector, storeId, id, at) {
    const name = nameOf(id), plan = name ? planned(name) : [];
    if (!plan.length || plan.some(s => s.expect === 'refused') || plan[0].collector !== collector) return false;
    schedule(at, u => {
      const now = fillOf(id), left = planned(name);
      if (now.state !== 'ready' || now.hold !== null || !isOpen(storeOf(storeId), u) || !left.length || left.some(s => s.expect === 'refused') || left[0].collector !== collector) return;
      if (!attempt(u, id, collector, left[0].card)) fail('collection of ' + name + ' with ' + collector + '\'s other fills at ' + toIso(u) + ' was refused: ' + fillOf(id).refusals.at(-1).reason);
      for (const s of left) covered.add(s);
      if (left[0].resume) { const reg = regOfFill(id); resume(reg, nextNeed(reg, u)); }
    });
    return true;
  }
  function sweep(collector, storeId, t) {
    let at = t;
    for (const g of data.fills.filter(x => !forgotten.has(x.fill_id) && !swept.has(x.fill_id) && x.state === 'ready' && x.hold === null && x.store_id === storeId)) {
      if (!routine.has(g.fill_id)) {
        if (sweepAuthored(collector, storeId, g.fill_id, at + 2 * MINUTE)) at += 2 * MINUTE;
        continue;
      }
      const reg = regOfFill(g.fill_id), id = g.fill_id;
      if (reg.actor !== collector) continue;
      at += R(reg).between(1, 2) * MINUTE;
      schedule(at, u => {
        const now = fillOf(id);
        if (swept.has(id) || forgotten.has(id) || now.state !== 'ready' || now.hold !== null || !isOpen(storeOf(storeId), u)) return;
        if (!attempt(u, id, collector, now.amount_due_cents > 0 ? cardFor(collector, u) : undefined)) fail('collection of ' + id + ' with ' + collector + '\'s other fills at ' + toIso(u) + ' was refused: ' + fillOf(id).refusals.at(-1).reason);
        swept.add(id);
        run.get(reg.key).missed = false;
        planNext(reg, nextNeed(reg, u));
      });
    }
  }
  function collect(reg, id, t) {
    if (swept.has(id)) return;
    const rand = R(reg), f = view(t, reg.actor, id), store = storeOf(f.store_id), r = rand.n(100), card = f.amount_due_cents > 0 ? cardFor(reg.actor, t) : undefined;
    if (r < 4 && reg.actor === 'p-2' && card) {
      if (attempt(t, id, reg.actor, 'card-2')) fail('a declined card paid for ' + id);
      return schedule(t + rand.between(2, 6) * MINUTE, u => collect(reg, id, u));
    }
    if (r >= 96 && reg.actor === 'p-2') {
      const late = closingOf(store, t) + rand.between(5, 25) * MINUTE;
      return schedule(late, u => {
        if (swept.has(id)) return;
        if (attempt(u, id, reg.actor, card)) fail('a closed store released ' + id);
        schedule(visitAt(reg.actor, f.store_id, u + 8 * HOUR, rand), w => collect(reg, id, w));
      });
    }
    if (!attempt(t, id, reg.actor, card)) fail('collection of ' + id + ' at ' + toIso(t) + ' was refused: ' + fillOf(id).refusals.at(-1).reason);
    run.get(reg.key).missed = false;
    planNext(reg, nextNeed(reg, t));
    sweep(reg.actor, f.store_id, t);
  }
  function waiting(reg, f, t) {
    const drug = reg.drug, store = storeOf(f.store_id);
    if (RESTOCKED.some(([s, d]) => s === f.store_id && d === drug) && store.stock[drug] !== true) {
      const rand = R(reg);
      return schedule(office(t, rand.between(1, 2), rand), u => { event(u, 'store.restocked', { store_id: f.store_id, drug_id: drug }); schedule(u + rand.between(20, 90) * MINUTE, w => check(reg, f.fill_id, w)); });
    }
    const other = data.stores.find(s => s.store_id !== f.store_id && s.stock[drug] === true);
    call(t, reg.actor, 'fills.change_store', { fill_id: f.fill_id, store_id: other.store_id });
    return schedule(t + 10 * MINUTE, u => check(reg, f.fill_id, u));
  }
  function rejected(reg, f, t) {
    const id = f.fill_id, reason = f.claim.reason, rand = R(reg);
    if (reason === 'refill_too_soon') {
      call(t, reg.actor, 'fills.wait', { fill_id: id });
      const due = fillOf(id).resubmission_due_at;
      return schedule(due === null ? t + 10 * MINUTE : ms(due) + rand.between(7 * 60, 10 * 60) * MINUTE, u => check(reg, id, u));
    }
    if (reason === 'prior_auth_required') {
      const pr = call(t, reg.actor, 'plan_requests.create', { fill_id: id, note: rand.pick(PA_NOTES) }).plan_request;
      const first = data.plan_requests.filter(x => x.fill_id === id).length === 1;
      return schedule(office(t, rand.between(1, 3), rand), u => {
        event(u, 'plan.decided', { plan_request_id: pr.plan_request_id, decision: first && rand.n(100) < 15 ? 'denied' : 'approved' });
        schedule(u + rand.between(20, 120) * MINUTE, w => check(reg, id, w));
      });
    }
    if (reason === 'not_covered') {
      const preview = call(t, reg.actor, 'fills.choose_cash.preview', { fill_id: id });
      call(t, reg.actor, 'fills.choose_cash.confirm', { fill_id: id, token: preview.preview.token });
      return schedule(t + 10 * MINUTE, u => check(reg, id, u));
    }
    return fail('fill ' + id + ' was rejected for ' + reason + ', which the routine history does not handle');
  }
  const label = (name, id) => { if (labels.has(name)) fail('label ' + name + ' is used twice'); labels.set(name, id); };
  const ref = name => labels.get(name) ?? fail('unknown label ' + name);
  function step(s, t) {
    const actor = s.actor;
    if (s.do === 'rx') {
      const id = s.id || 'rx-h' + (++hRx);
      event(t, 'rx.received', { rx_id: id, patient_id: s.patient, prescriber_id: s.prescriber, drug_id: s.drug, quantity: s.quantity, fills_authorized: s.fills, written_on: localDate(t) });
      label(s.label || id, id);
      if (s.start) { const reg = regOf(s.patient, s.drug); planNext(reg, later(reg, t, 0, 1)); }
    } else if (s.do === 'grant') {
      const id = s.id || 'g-h' + (++hGrant);
      event(t, 'grant.changed', { grant_id: id, patient_id: s.patient, grantor_id: s.grantor, grantee_id: s.grantee, scope: s.scope, fill_id: s.fill === null ? null : ref(s.fill), expires_at: s.expires, status: 'active' });
      label('grant:' + (s.label || id), id);
    } else if (s.do === 'revoke') event(t, 'grant.changed', { grant_id: ref('grant:' + s.grant), status: 'revoked' });
    else if (s.do === 'request') {
      const rx = ref(s.rx), fill = call(t, actor, 'fills.request', { rx_id: rx, store_id: s.store, quantity: s.quantity }).fill;
      label(s.fill, fill.fill_id);
    } else if (s.do === 'expect') {
      const f = view(t, actor, ref(s.fill));
      if (f.state !== s.state || (s.reason && (!f.claim || f.claim.reason !== s.reason))) fail(s.fill + ' is ' + f.state + (f.claim && f.claim.reason ? ' (' + f.claim.reason + ')' : '') + ' at ' + toIso(t) + ', not ' + s.state + (s.reason ? ' (' + s.reason + ')' : ''));
    } else if (s.do === 'plan') {
      const f = view(t, actor, ref(s.fill));
      if (f.state !== 'claim_rejected' || f.claim.reason !== s.reason) fail(s.fill + ' is ' + f.state + ' (' + (f.claim && f.claim.reason) + ') at ' + toIso(t) + ', not rejected for ' + s.reason);
      label(s.plan, call(t, actor, 'plan_requests.create', { fill_id: ref(s.fill), ...(s.note ? { note: s.note } : {}) }).plan_request.plan_request_id);
    } else if (s.do === 'withdraw') call(t, actor, 'plan_requests.withdraw', { plan_request_id: ref(s.plan) });
    else if (s.do === 'decide') event(t, 'plan.decided', { plan_request_id: ref(s.plan), decision: s.decision });
    else if (s.do === 'wait') {
      const id = ref(s.fill);
      call(t, actor, 'fills.wait', { fill_id: id });
      const due = fillOf(id).resubmission_due_at, c = s.collect;
      const pickup = { do: 'collect', fill: s.fill, collector: c.collector, card: c.card, resume: c.resume };
      pickups.push(pickup);
      schedule(fromLocal(addDays(localDate(ms(due)), c.days), c.time), u => step(pickup, u));
    } else if (s.do === 'quantity') call(t, actor, 'fills.change_quantity', { fill_id: ref(s.fill), quantity: s.quantity });
    else if (s.do === 'cash') {
      const id = ref(s.fill), f = view(t, actor, id);
      if (f.state !== 'claim_rejected' || f.claim.reason !== s.reason) fail(s.fill + ' is ' + f.state + ' at ' + toIso(t) + ', not rejected for ' + s.reason);
      const preview = call(t, actor, 'fills.choose_cash.preview', { fill_id: id });
      call(t, actor, 'fills.choose_cash.confirm', { fill_id: id, token: preview.preview.token });
    } else if (s.do === 'prepay') {
      const id = ref(s.fill), preview = call(t, actor, 'fills.prepay.preview', { fill_id: id, card_id: s.card });
      event(t, 'user.confirmed', { token: preview.preview.token, confirmed_by: actor });
      call(t, actor, 'fills.prepay.confirm', { fill_id: id, card_id: s.card, token: preview.preview.token });
    } else if (s.do === 'collector') call(t, actor, 'fills.set_collector', { fill_id: ref(s.fill), collector_id: s.person });
    else if (s.do === 'collect') {
      if (covered.has(s)) return;
      ran.add(s);
      const id = ref(s.fill), ok = attempt(t, id, s.collector, s.card);
      if (ok !== (s.expect !== 'refused')) fail(s.fill + ' collection at ' + toIso(t) + ' ended ' + fillOf(id).state);
      if (ok && s.resume) { const reg = regOfFill(id); resume(reg, nextNeed(reg, t)); }
      if (ok) sweep(s.collector, fillOf(id).store_id, t);
    } else if (s.do === 'cancel') {
      const id = ref(s.fill), preview = call(t, actor, 'fills.cancel.preview', { fill_id: id });
      call(t, actor, 'fills.cancel.confirm', { fill_id: id, token: preview.preview.token });
      if (s.resume) resume(regOfFill(id), t + 15 * MINUTE);
    } else if (s.do === 'hold') event(t, 'fill.hold_placed', { fill_id: ref(s.fill), note: s.note });
    else if (s.do === 'renew') {
      const rx = s.rx ? ref(s.rx) : data.prescriptions.filter(r => r.patient_id === byKey(s.reg).patient && r.drug_id === byKey(s.reg).drug).sort((a, b) => ms(b.received_at) - ms(a.received_at))[0].rx_id;
      label(s.renewal, call(t, actor, 'renewals.create', { rx_id: rx, ...(s.note ? { note: s.note } : {}) }).renewal.renewal_id);
    } else if (s.do === 'reply') {
      event(t, 'renewal.replied', { renewal_id: ref(s.renewal), decision: s.decision, rx: { rx_id: s.rx.id, quantity: s.rx.quantity, fills_authorized: s.rx.fills, written_on: localDate(t) } });
      label(s.rx.id, s.rx.id);
    } else fail('unknown step ' + s.do);
  }
  for (const list of [HISTORY_STEPS, TIMELINE]) list.forEach((s, i) => { if (i && stamp(s.at) < stamp(list[i - 1].at)) fail('step ' + s.at + ' ' + s.do + ' is out of date order'); });
  for (const s of HISTORY_STEPS) schedule(stamp(s.at), t => { step(s, t); done.add(s); }, 'history');
  for (const s of TIMELINE) schedule(stamp(s.at), t => { step(s, t); done.add(s); }, 'timeline');
  if (Math.min(...queue.map(q => q.t)) < START) fail('a step comes before ' + FROM);
  if (Math.min(...TIMELINE.map(s => stamp(s.at))) < fromLocal(TASK_FROM, '00:00')) fail('a task-timeline step comes before ' + TASK_FROM);
  while (queue.length) {
    queue.sort((a, b) => a.t - b.t || a.seq - b.seq);
    const task = queue.shift();
    if (task.t > END) continue;
    tag = task.as;
    task.fn(task.t);
  }
  const missing = [...HISTORY_STEPS, ...TIMELINE].filter(s => !done.has(s));
  if (missing.length) fail('steps after the fixture clock: ' + missing.map(s => s.at + ' ' + s.do).join(', '));
  return { data, tags, labels, steps };
}

function relabel({ data, tags, labels }) {
  const owner = new Map(data.fills.map(f => [f.fill_id, tags.get(f.fill_id)]));
  const records = [];
  for (const f of data.fills) { records.push([f.fill_id, owner.get(f.fill_id)]); for (const r of f.refusals) records.push([r.refusal_id, owner.get(f.fill_id)]); }
  for (const c of data.claims) records.push([c.claim_id, owner.get(c.fill_id)]);
  for (const r of data.plan_requests) records.push([r.plan_request_id, owner.get(r.fill_id)]);
  for (const a of data.authorizations) records.push([a.authorization_id, owner.get(a.fill_id)]);
  for (const c of data.charges) records.push([c.charge_id, owner.get(c.fill_id)]);
  for (const r of data.renewals) records.push([r.renewal_id, tags.get(r.renewal_id)]);
  let previous = null;
  for (const n of data.notices) {
    const as = n.subject.type === 'fill' ? owner.get(n.subject.id) : n.subject.type === 'renewal' ? tags.get(n.subject.id) : previous;
    records.push([n.notice_id, as]);
    previous = as;
  }
  const groups = new Map(), map = new Map(), counts = {};
  for (const [id, as] of records) {
    const prefix = id.slice(0, id.lastIndexOf('-')), key = prefix + ' ' + as;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(id);
  }
  const number = id => Number(id.slice(id.lastIndexOf('-') + 1));
  for (const [key, ids] of groups) {
    const [prefix, as] = key.split(' ');
    const series = as === 'history' ? 'h' : prefix === 'n' ? 't' : '';
    ids.sort((a, b) => number(a) - number(b)).forEach((id, i) => map.set(id, prefix + '-' + series + (i + 1)));
    if (as === 'timeline' && series === '') counts[prefix] = ids.length;
  }
  const swap = v => (typeof v === 'string' ? v.replace(LIVE_ID, m => map.get(m) ?? m) : Array.isArray(v) ? v.map(swap) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)])) : v);
  const out = { ...data };
  for (const key of RECORDS) out[key] = key === 'approvals' ? [] : swap(data[key]);
  const grants = out.grants.filter(g => !HISTORY.test(g.grant_id)).length;
  out.issued = Object.fromEntries([...COUNTED.filter(p => counts[p]).map(p => [p, counts[p]]), ...(grants ? [['g', grants]] : [])]);
  for (const [name, id] of labels) if (/^(?:f|pr|rn)-\d+$/.test(name) && map.get(id) !== name) throw new Error('timeline label ' + name + ' became ' + map.get(id));
  if (out.notices.some(n => !HISTORY.test(n.notice_id) && !TIMELINE_NOTICE.test(n.notice_id))) throw new Error('a seeded notice is in the runtime notice series');
  return out;
}

const cache = new Map();
function build(current) {
  const base = authored(current), key = JSON.stringify(base);
  if (!cache.has(key)) {
    const sim = simulate(base);
    const out = relabel(sim);
    if (!seedValid(out)) throw new Error('the generated fixture does not match the seed schema');
    plugin.validateSeed({ app_id: APP, virtual_now: CLOCK, binding: BINDING }, out);
    cache.set(key, { out, steps: sim.steps });
  }
  const { out, steps } = cache.get(key);
  return { out: structuredClone(out), steps };
}

function main() {
  const current = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const { out, steps } = build(current);
  const text = JSON.stringify(out, null, 2) + '\n';
  if (process.argv.includes('--check')) {
    const same = text === fs.readFileSync(FILE, 'utf8');
    console.log(same ? 'fixture history is up to date' : 'fixture history differs from the generator output');
    process.exitCode = same ? 0 : 1;
    return;
  }
  fs.writeFileSync(FILE, text);
  const count = (list, key) => ({ history: list.filter(r => HISTORY.test(r[key])).length, timeline: list.filter(r => !HISTORY.test(r[key])).length });
  console.log(JSON.stringify({ validated_states: steps, prescriptions: count(out.prescriptions, 'rx_id'), fills: count(out.fills, 'fill_id'), claims: count(out.claims, 'claim_id'), notices: count(out.notices, 'notice_id'), bytes: Buffer.byteLength(text) }));
}

if (require.main === module) main();
module.exports = { build, authored, simulate, relabel, HISTORY, TIMELINE_NOTICE, LIVE_ID, SEED, FROM, TASK_FROM, RESTOCKED, TIMELINE, HISTORY_STEPS, REGIMENS };
