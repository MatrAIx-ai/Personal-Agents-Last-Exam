'use strict';
const {read} = require('./reads.cjs');
const {write} = require('./writes.cjs');
const {log} = require('./common.cjs');

// Reads return data unchanged (Core rejects a read that mutates); writes work on Core's copy.
function handleTool(ctx, data, name, args) {
  const result = read(ctx, data, name, args);
  if (result) return {data, result};
  const out = write(ctx, data, name, args);
  log(ctx, name + '.committed', {});
  return {data, result: out};
}

module.exports = {handleTool};
