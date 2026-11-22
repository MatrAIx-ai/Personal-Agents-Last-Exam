'use strict';
// Keep the Core hooks stable; organize all business code under src/.
module.exports={...require('./src/model.cjs'),...require('./src/operations.cjs'),...require('./src/events.cjs')};
