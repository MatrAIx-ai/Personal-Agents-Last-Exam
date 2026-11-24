'use strict';
// Thin exports of the hooks required by the host; business logic lives in src/.
// `visibility(data, at)` is the pure visibility rule (see src/derive.cjs), exported for graders.
const {visibility} = require('./src/derive.cjs');
module.exports = {...require('./src/model.cjs'), ...require('./src/operations.cjs'), ...require('./src/events.cjs'), visibility};
