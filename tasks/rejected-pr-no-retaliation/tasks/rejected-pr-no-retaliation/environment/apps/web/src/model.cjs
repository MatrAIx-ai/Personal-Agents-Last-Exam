'use strict';

function fail(code, message) {
  throw Object.assign(new Error(message), {code});
}

function validateSeed(ctx, data) {
  if (data.account_id !== 'web-tomas' || data.owner_person_id !== 'person-tomas') {
    fail('invalid_seed', 'Web seed account does not match Tomás.');
  }
  const ids = new Set();
  const urls = new Set();
  for (const page of data.pages) {
    if (ids.has(page.id) || urls.has(page.url)) fail('invalid_seed', 'Duplicate page id or url.');
    ids.add(page.id);
    urls.add(page.url);
  }
}

module.exports = {
  validateSeed,
  records: data => data.pages,
  objects: data => data.pages.map(page => page.id),
  references: () => [],
};
