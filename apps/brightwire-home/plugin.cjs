'use strict';
const model = require('./src/model.cjs');
const house = require('./src/house.cjs');
module.exports = {
  validateSeed: model.validateSeed,
  records: model.records,
  objects: model.objects,
  references: model.references,
  assetReferences: model.assetReferences,
  handleTool: house.handleTool,
  applyEvent: house.applyEvent
};
