'use strict';
const { fail } = require('./domain-utils.cjs');

function applyEvent(ctx, data, event) {
  if (event.operation !== 'webstub.page.publish') {
    fail('invalid_event', 'This stub does not accept that operation.');
  }
  const page = event.payload || {};
  if (!page.id || !page.url || !page.host) fail('invalid_event', 'The page is missing its address.');
  if (!data.pages.some(row => row.url === page.url)) data.pages.push(page);
  return data;
}

module.exports = { applyEvent };
