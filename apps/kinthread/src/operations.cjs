'use strict';
const {reads, writes} = require('./engine.cjs');
function handleTool(ctx, data, name, args) {
  if (args && (Object.hasOwn(args, 'actor') || Object.hasOwn(args, 'acting_as') || Object.hasOwn(args, 'person_as'))) {
    const {fail} = require('./common.cjs');
    fail('invalid_arguments', 'Tools do not accept an actor argument.');
  }
  const read = reads(ctx, data, name, args);
  if (read) return {data, result: read};
  return writes(ctx, data, name, args);
}
module.exports = {handleTool};
