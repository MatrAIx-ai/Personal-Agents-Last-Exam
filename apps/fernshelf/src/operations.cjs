'use strict';
// Tool dispatch. Core hands every call a working copy; reads return it untouched. A committed write
// then drops what the clock has already made unreachable (settle), which changes nothing a read
// returns; a refused write throws before any change.
const c = require('./common.cjs');
const {READS} = require('./reads.cjs');
const {settle} = require('./derive.cjs');
const {log} = require('./diagnostics.cjs');
const WRITES = {...require('./library.cjs').WRITES, ...require('./albums.cjs').WRITES, ...require('./removals.cjs').WRITES};

function handleTool(ctx, data, name, args) {
  if (READS[name]) {
    const result = READS[name](ctx, data, args);
    log(ctx, 'read', {tool: name});
    return {data, result};
  }
  if (!WRITES[name]) c.fail('unknown_tool', 'Unknown Fernshelf operation ' + name + '.');
  log(ctx, 'write.prepare', {tool: name});
  const result = WRITES[name](ctx, data, args);
  settle(ctx, data);
  log(ctx, 'write.prepared', {tool: name, activity_rows: data.activity.length});
  return {data, result};
}
module.exports = {handleTool};
