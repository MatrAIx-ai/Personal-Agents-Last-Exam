'use strict';
// Thin exports of the hooks required by the host; business logic lives in src/.
// `check` and `flagsFromSnapshot` are the pure suitability functions an evaluator can use to
// recompute verdicts and slot flags from a snapshot.
const {check} = require('./src/check.cjs');
const {flagsFromSnapshot} = require('./src/plan.cjs');
module.exports = {...require('./src/model.cjs'), ...require('./src/operations.cjs'), ...require('./src/events.cjs'), check, flagsFromSnapshot};
