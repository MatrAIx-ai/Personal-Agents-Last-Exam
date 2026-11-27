'use strict';
// Entry point used by `npm run test:deep` (not run by the public verifier): the full sweeps whose
// representative slices are in the business suite (tests/business.test.cjs).
require('./package.deep.test.cjs');
require('./inputs.deep.test.cjs');
require('./roundtrip.deep.test.cjs');
