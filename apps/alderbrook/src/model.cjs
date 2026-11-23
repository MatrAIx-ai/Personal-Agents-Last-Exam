'use strict';
const {references} = require('./common.cjs');
const rules = require('./rules.cjs');
function validateSeed(ctx, data) {
  references(ctx, data);
  rules.validate(ctx, data);
}
// Policies and claims are the records of the account. Everything else belongs to a claim.
const records = data => [...data.policies, ...data.claims];
module.exports = {validateSeed, records, objects: data => records(data).map(record => record.id), references: () => []};
