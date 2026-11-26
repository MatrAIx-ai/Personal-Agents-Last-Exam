'use strict';
function log(ctx, step, details = {}) {
  if (typeof ctx?.log === 'function') ctx.log(step, details);
}
module.exports = { log };
