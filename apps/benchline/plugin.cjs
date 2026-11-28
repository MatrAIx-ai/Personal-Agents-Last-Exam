'use strict';
const {validateSeed, records, objects, references} = require('./src/model.cjs');
module.exports = {validateSeed, records, objects, references, handleTool: require('./src/operations.cjs').handleTool, applyEvent: require('./src/events.cjs').applyEvent};
