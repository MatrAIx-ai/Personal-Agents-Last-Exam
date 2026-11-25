/**
 * Hearth App Plugin Interface implementing Core lifecycle hooks.
 */
const { handleToolCall, handleEvent } = require('./operations.cjs');

function validateSeed(seed) {
  if (!seed || typeof seed !== 'object') {
    return { valid: false, errors: ['Seed must be a valid JSON object.'] };
  }
  if (!seed.property || !Array.isArray(seed.rooms) || !Array.isArray(seed.inventory)) {
    return { valid: false, errors: ['Seed missing required property, rooms, or inventory arrays.'] };
  }
  return { valid: true };
}

async function handleTool(name, params, state, ctx) {
  return handleToolCall(name, params, state, ctx);
}

async function applyEvent(event, state, ctx) {
  return handleEvent(event, state, ctx);
}

module.exports = {
  validateSeed,
  handleTool,
  applyEvent,
};
