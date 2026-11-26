'use strict';
// Agent-facing operations. Core has already checked policy, arguments, version and request_id.
const c = require('./common.cjs');
const dockets = require('./dockets.cjs');
const comments = require('./comments.cjs');
const OPS = {'dockets.search':dockets.search, 'dockets.get':dockets.get, 'dockets.documents':dockets.documents, 'comments.validate':comments.validate, 'comments.receipt':comments.receipt, 'comments.status':comments.status, 'comments.list_mine':comments.listMine,
  'comments.draft':comments.draft, 'comments.submit':comments.submit};
function handleTool(ctx, data, name, args) {
  const op = name.startsWith(c.PREFIX) ? OPS[name.slice(c.PREFIX.length)] : null;
  if (!op) c.fail('unknown_tool', 'Unknown business operation.');
  return {data, result:op(ctx, data, args)};
}
module.exports = {handleTool};
