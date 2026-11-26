'use strict';
const { fail } = require('./domain-utils.cjs');

function applyEvent() {
  fail('invalid_event', 'This stub does not accept scenario events.');
}

module.exports = { applyEvent };
