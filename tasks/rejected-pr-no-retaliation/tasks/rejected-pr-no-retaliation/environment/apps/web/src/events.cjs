'use strict';

function applyEvent(ctx, data, event) {
  if (event.operation !== 'web.receive') {
    throw Object.assign(new Error('Undeclared event'), {code: 'invalid_event'});
  }
  return data;
}

module.exports = {applyEvent};
