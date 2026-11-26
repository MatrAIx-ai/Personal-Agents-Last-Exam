'use strict';
const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
const copy = value => structuredClone(value);
function references(ctx, data) {
  const person = ctx.binding.people.some(p => p.person_id === data.owner_person_id);
  const account = ctx.binding.accounts.some(a => a.app_id === ctx.app_id && a.account_id === data.account_id && a.owner_person_id === data.owner_person_id);
  if (!person || !account) fail('invalid_seed', 'Account and owner must exist in the supplied binding.');
}
module.exports = { fail, copy, references };
