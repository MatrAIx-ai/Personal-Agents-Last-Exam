'use strict';
function log(ctx, step, details = {}) {
  try { if (ctx && typeof ctx.log === 'function') ctx.log(step, details); } catch (_) {}
}
module.exports = { log };
