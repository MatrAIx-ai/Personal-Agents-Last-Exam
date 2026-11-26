'use strict';
// Standard host hooks. Business logic lives in src/.
const model = require('./src/model.cjs');
const {handleTool} = require('./src/operations.cjs');
const {applyEvent} = require('./src/events.cjs');

module.exports = {
  validateSeed: model.validateSeed,
  handleTool,
  applyEvent,
  records: model.records,
  objects: model.objects,
  references: model.references
};
