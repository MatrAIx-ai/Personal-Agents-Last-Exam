'use strict';
// Entry point used by `npm test` and the public verifier: runs every Platewright business test module.
require('./package.test.cjs');
require('./w1-recipes.test.cjs');
require('./w2-profiles.test.cjs');
require('./w3-substitutions.test.cjs');
require('./w4-plan.test.cjs');
require('./w5-pantry-shopping.test.cjs');
require('./events.test.cjs');
require('./fixtures.test.cjs');
require('./inputs.test.cjs');
require('./refusals.test.cjs');
require('./roundtrip.test.cjs');
