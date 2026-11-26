'use strict';
const {references, RECORDS} = require('./common.cjs');
const rules = require('./rules.cjs');
function validateSeed(ctx, data) {
  references(ctx, data);
  rules.validate(ctx, data);
}
// The records of the account. Products, notifications and activity rows belong to the issuer setup or to these records.
const records = data => RECORDS.flatMap(key => data[key]);
module.exports = {validateSeed, records, objects: data => records(data).map(record => record.id), references: () => []};
