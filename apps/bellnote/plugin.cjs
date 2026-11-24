'use strict';
// Thin exports of the hooks required by the host; business logic lives in src/.
module.exports = {...require('./src/model.cjs'), ...require('./src/operations.cjs'), ...require('./src/events.cjs')};
