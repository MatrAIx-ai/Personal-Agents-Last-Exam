'use strict';
// Entry point used by `npm test` and the public verifier: runs every Fernshelf business test module.
require('./package.test.cjs');
require('./w1-library.test.cjs');
require('./w2-organising.test.cjs');
require('./w3-sharing.test.cjs');
require('./w4-removals.test.cjs');
require('./w5-storage.test.cjs');
require('./cross.test.cjs');
require('./edge-cases.test.cjs');
require('./fixtures.test.cjs');
require('./log-shapes.test.cjs');
require('./schema-inline.test.cjs');
require('./coverage.test.cjs');
