'use strict';
require('./generate-tools.cjs').run({check:true});
require('./generate-fixtures.cjs').run({check:true});
require('./generate-mail-contract.cjs').run({check:true});
console.log('PASS: Brightpath deterministic generated files match.');
