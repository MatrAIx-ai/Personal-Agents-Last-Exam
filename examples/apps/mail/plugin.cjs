'use strict';
// Stable App entrypoint. Implement domain behavior under src/.
module.exports={
 ...require('./src/model.cjs'),
 ...require('./src/migrations.cjs'),
 ...require('./src/operations.cjs'),
 ...require('./src/events.cjs')
};
