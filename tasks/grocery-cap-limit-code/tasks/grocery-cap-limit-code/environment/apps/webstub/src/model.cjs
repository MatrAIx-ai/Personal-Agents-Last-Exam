'use strict';
const { fail, references } = require('./domain-utils.cjs');

function validateSeed(ctx, data) {
  references(ctx, data);
  const ids = data.pages.map(page => page.id);
  if (new Set(ids).size !== ids.length) fail('invalid_seed', 'Duplicate page id.');
  for (const page of data.pages) {
    if (!page.id || !page.url || !page.host) fail('invalid_seed', 'A page is missing its address.');
  }
  for (const row of data.log) {
    if (Date.parse(row.at) > Date.parse(ctx.virtual_now)) fail('invalid_seed', 'A log row is dated after the clock.');
  }
}

function records(data) {
  return data.pages;
}

module.exports = {
  validateSeed,
  records,
  objects: data => records(data).map(row => row.id),
  references: () => [],
  assetReferences: () => []
};
