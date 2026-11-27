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
  const facIds = checkUnique(data.facilities, 'facility');
  const prgIds = checkUnique(data.programs, 'program');
  checkUnique(data.passes, 'pass', data.account_id);
  checkUnique(data.enrollments, 'enrollment', data.account_id);
  const slotIds = checkUnique(data.court_slots, 'court_slot');
  checkUnique(data.court_bookings, 'court_booking', data.account_id);

  for (const p of data.programs) {
    if (!facIds.has(p.facility_id)) fail('invalid_seed', `Program ${p.id} references unknown facility ${p.facility_id}`);
  }
  for (const e of data.enrollments) {
    if (!prgIds.has(e.program_id)) fail('invalid_seed', `Enrollment ${e.id} references unknown program ${e.program_id}`);
  }
  for (const b of data.court_bookings) {
    if (!slotIds.has(b.slot_id) || !facIds.has(b.facility_id)) {
      fail('invalid_seed', `Booking ${b.id} references unknown slot or facility.`);
    }
  }
}

function records(data) {
  return [
    ...data.facilities,
    ...data.programs,
    ...data.passes,
    ...data.enrollments,
    ...data.court_slots,
    ...data.court_bookings,
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
  for (const f of data.facilities) {
    if (f.map_asset_id) refs.push({ asset_id: f.map_asset_id, object_id: f.id, object_type: 'rec_record' });
  }
  for (const p of data.programs) {
    if (p.card_asset_id) refs.push({ asset_id: p.card_asset_id, object_id: p.id, object_type: 'rec_record' });
  }
  return refs;
}

module.exports = { validateSeed, records, objects, references, assetReferences };
