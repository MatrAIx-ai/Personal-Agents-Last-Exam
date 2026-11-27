'use strict';

const { assertAccountBinding, fail, parseMs } = require('./common.cjs');

function checkUnique(list, label, accountId = null) {
  const seen = new Set();
  for (const item of list) {
    if (seen.has(item.id)) fail('invalid_seed', `Duplicate ${label} ID: ${item.id}`);
    seen.add(item.id);
    if (accountId && item.account_id !== accountId) {
      fail('invalid_seed', `${label} ${item.id} belongs to wrong account ${item.account_id}`);
    }
    if (item.created_at && item.updated_at && parseMs(item.created_at) > parseMs(item.updated_at)) {
      fail('invalid_seed', `${label} ${item.id} timestamps are reversed.`);
    }
  }
  return seen;
}

function validateSeed(ctx, data) {
  assertAccountBinding(ctx, data);
  const branchIds = checkUnique(data.branches, 'branch');
  const vetIds = checkUnique(data.vets, 'vet');
  const slotIds = checkUnique(data.slots, 'slot');
  const ruleIds = checkUnique(data.clearance_rules, 'clearance_rule');
  const petIds = checkUnique(data.pets, 'pet', data.account_id);
  checkUnique(data.vaccinations, 'vaccination', data.account_id);
  checkUnique(data.lab_results, 'lab_result', data.account_id);
  checkUnique(data.clearances, 'clearance', data.account_id);
  checkUnique(data.appointments, 'appointment', data.account_id);
  const rxIds = checkUnique(data.prescriptions, 'prescription', data.account_id);
  checkUnique(data.refill_requests, 'refill_request', data.account_id);

  for (const s of data.slots) {
    if (!branchIds.has(s.branch_id) || !vetIds.has(s.vet_id)) {
      fail('invalid_seed', `Slot ${s.id} references unknown branch or vet.`);
    }
  }
  for (const c of data.clearances) {
    if (!petIds.has(c.pet_id) || !ruleIds.has(c.rule_id)) {
      fail('invalid_seed', `Clearance ${c.id} references unknown pet or rule.`);
    }
  }
  for (const a of data.appointments) {
    if (!petIds.has(a.pet_id) || !slotIds.has(a.slot_id)) {
      fail('invalid_seed', `Appointment ${a.id} references unknown pet or slot.`);
    }
  }
  for (const r of data.refill_requests) {
    if (!rxIds.has(r.prescription_id) || !petIds.has(r.pet_id)) {
      fail('invalid_seed', `Refill ${r.id} references unknown prescription or pet.`);
    }
  }
}

function records(data) {
  return [
    ...data.branches,
    ...data.vets,
    ...data.slots,
    ...data.clearance_rules,
    ...data.pets,
    ...data.vaccinations,
    ...data.lab_results,
    ...data.clearances,
    ...data.appointments,
    ...data.prescriptions,
    ...data.refill_requests,
  ];
}

function objects(data) {
  return records(data).map((r) => r.id);
}

function references() {
  return [];
}

function assetReferences(data) {
  const refs = [];
  for (const b of data.branches) {
    if (b.map_asset_id) refs.push({ asset_id: b.map_asset_id, object_id: b.id, object_type: 'clinic_record' });
  }
  for (const p of data.pets) {
    if (p.card_asset_id) refs.push({ asset_id: p.card_asset_id, object_id: p.id, object_type: 'clinic_record' });
  }
  for (const cl of data.clearances) {
    if (cl.certificate_asset_id) refs.push({ asset_id: cl.certificate_asset_id, object_id: cl.id, object_type: 'clinic_record' });
  }
  return refs;
}

module.exports = { validateSeed, records, objects, references, assetReferences };
