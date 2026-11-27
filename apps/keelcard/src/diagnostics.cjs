'use strict';
// Optional host hook. Diagnostics must not change business results or throw.
function log(ctx, step, details = {}) {
  try { if (typeof ctx?.log === 'function') ctx.log(step, details); } catch { /* host logging is best-effort */ }
}
module.exports = { log };
