'use strict';
const {references} = require('./common.cjs');
const rules = require('./rules.cjs');
function validateSeed(ctx, data) {
  references(ctx, data);
  rules.validate(ctx, data);
}
// The records of the account. Lines, deposits, leave entries, choices and notifications belong to them or to the employer setup.
const records = data => [...data.calendar, ...data.statements, ...data.changes, ...data.inquiries, ...data.leave_requests, ...data.windows, ...data.election_sets];
module.exports = {validateSeed, records, objects: data => records(data).map(record => record.id), references: () => []};
