'use strict';
// handleTool: routes the 22 Agent operations. Reads return a view and leave data untouched; each
// committed write adds one activity row. The Agent always acts as the account holder bound by Infra.
const c = require('./common.cjs');
const R = require('./recipes.cjs');
const H = require('./household.cjs');
const P = require('./plan.cjs');
const Pantry = require('./pantry.cjs');
const S = require('./shopping.cjs');
const Rec = require('./records.cjs');
const {log} = require('./diagnostics.cjs');

const READS = {
  'household.get': H.get,
  'ingredients.search': R.ingredientSearch,
  'recipes.search': R.search,
  'recipes.get': R.get,
  'recipes.check': R.checkRecipe,
  'substitutions.list': R.substitutions,
  'recipes.variant.preview': R.preview,
  'plan.get': P.get,
  'pantry.list': Pantry.list,
  'shopping.get': S.view,
  'notifications.list': Rec.list
};
const WRITES = {
  'recipes.create': R.create,
  'recipes.update': R.update,
  'recipes.variant.create': R.createVariant,
  'members.constraint.set': H.setTool,
  'members.constraint.remove': H.removeTool,
  'plan.slot.set': P.setTool,
  'plan.slot.mark': P.markTool,
  'pantry.set': Pantry.setTool,
  'shopping.generate': S.generate,
  'shopping.item.set': S.itemSet,
  'shopping.item.remove': S.itemRemove
};

function handleTool(ctx, data, name, args) {
  const op = name.startsWith('platewright.') ? name.slice('platewright.'.length) : '';
  if (READS[op]) return {data, result: READS[op](ctx, data, args)};
  if (!WRITES[op]) c.fail('unknown_tool', `${name} is not a Platewright operation.`);
  const result = WRITES[op](ctx, data, args);
  Rec.activity(data, {at: ctx.virtual_now, actor: 'agent', by: data.owner_person_id, action: op, object_id: result.id, request_id: args.request_id, event_id: null});
  log(ctx, 'platewright.write_prepared', {operation: op, object_id: result.id});
  return {data, result};
}

module.exports = {READS, WRITES, handleTool};
