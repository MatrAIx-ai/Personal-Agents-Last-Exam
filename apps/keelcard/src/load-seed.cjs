'use strict';

const { assertLoadClock } = require('./model.cjs');

// Supported Infra load. Raw env.load_seed on stock runtime 1.6.0 does not
// compare the requested clock with the seed, because Core sets the virtual
// clock to that request before validation.
async function loadSeed(client, args) {
  try {
    assertLoadClock(args && args.data, args && args.virtual_now);
  } catch (error) {
    return { status: 'invalid_seed', applied: false, message: error && error.message || 'The requested clock does not match the seed initial clock.' };
  }
  return client.call('env.load_seed', args);
}

module.exports = { loadSeed };
