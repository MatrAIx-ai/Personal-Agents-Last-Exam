'use strict';
const {read} = require('./reads.cjs');
const {write} = require('./writes.cjs');
const {materialize} = require('./derive.cjs');
const {copy, log, checkDates} = require('./common.cjs');

// Reads run on a materialized copy and return data unchanged (Core rejects a read that mutates).
// Writes store the derived statuses on Core's copy first, then apply the change.
function handleTool(ctx, data, name, args) {
  checkDates(args, 'invalid_window');
  const result = read(ctx, materialize(copy(data), ctx.virtual_now), name, args);
  if (result) return {data, result};
  materialize(data, ctx.virtual_now);
  const out = write(ctx, data, name, args);
  log(ctx, name + '.committed', {});
  return {data, result: out};
}

module.exports = {handleTool};
