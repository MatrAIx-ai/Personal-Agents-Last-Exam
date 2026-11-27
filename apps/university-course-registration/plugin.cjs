'use strict';
// Keep the Core hooks stable; all business code lives under src/.
module.exports = {...require('./src/model.cjs'), ...require('./src/operations.cjs'), ...require('./src/events.cjs')};
