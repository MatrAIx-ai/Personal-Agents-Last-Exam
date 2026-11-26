'use strict';
const {applyBusinessEvent} = require('./engine.cjs');
function applyEvent(ctx, data, event) {
  return applyBusinessEvent(ctx, data, event);
}
module.exports = {applyEvent};
