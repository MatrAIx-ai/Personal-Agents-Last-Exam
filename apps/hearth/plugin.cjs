'use strict';
const { handleToolCall, handleEvent } = require('./src/operations.cjs');

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  throw err;
}

function validateSeed(ctx, data) {
  if (!data || typeof data !== 'object') {
    fail('invalid_seed', 'Seed must be a valid JSON object.');
  }
  if (!data.property || !Array.isArray(data.rooms) || !Array.isArray(data.inventory)) {
    fail('invalid_seed', 'Seed missing required property, rooms, or inventory arrays.');
  }
  if (ctx && ctx.binding) {
    const accountOk = (ctx.binding.accounts || []).some(
      (a) => a.app_id === 'hearth' && a.account_id === data.account_id && a.owner_person_id === data.owner_person_id
    );
    if (!accountOk) {
      fail('invalid_seed', 'Seed account_id / owner_person_id is not bound in binding.json.');
    }
    const peopleIds = new Set((ctx.binding.people || []).map((p) => p.person_id));
    for (const r of data.residents || []) {
      if (!peopleIds.has(r.person_id)) {
        fail('invalid_seed', `Resident ${r.person_id} is not bound in binding.json.`);
      }
    }
  }
  const roomIds = new Set(data.rooms.map((r) => r.id));
  for (const item of data.inventory) {
    if (!roomIds.has(item.room_id)) {
      fail('invalid_seed', `Inventory item ${item.id} references unknown room ${item.room_id}.`);
    }
  }
}

function records(data) {
  return data.inventory || [];
}

function objects(data) {
  const ids = (data.inventory || []).map((item) => item.id);
  if (data.account_id) ids.unshift(data.account_id);
  return ids;
}

function references() {
  return [];
}

function assetReferences(data) {
  const assets = [];
  if (data.property && data.property.floor_plan_image) {
    assets.push({
      asset_id: data.property.floor_plan_image,
      object_id: data.account_id,
      object_type: 'property',
    });
  }
  return assets;
}

function handleTool(ctx, data, name, args) {
  return handleToolCall(ctx, data, name, args);
}

function applyEvent(ctx, data, event) {
  return handleEvent(ctx, data, event);
}

module.exports = {
  validateSeed,
  records,
  objects,
  references,
  assetReferences,
  handleTool,
  applyEvent,
};
