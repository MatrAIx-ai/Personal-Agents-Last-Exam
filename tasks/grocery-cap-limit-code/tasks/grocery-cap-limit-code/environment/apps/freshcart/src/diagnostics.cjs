'use strict';
function log(ctx, step, details = {}) {
  try { if (typeof ctx?.log === 'function') ctx.log(step, details); } catch { /* diagnostics never change the result */ }
}
module.exports = { log };
