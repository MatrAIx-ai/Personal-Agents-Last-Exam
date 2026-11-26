'use strict';
// App-owned domain utilities. No persistence, authentication or platform runtime.
const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
const copy = value => structuredClone(value);
const ms = value => Date.parse(value);
// Amounts are numbers with two decimals outside the App and integer cents inside it.
const cents = amount => Math.round(amount * 100);
const money = value => value / 100;
const twoDecimals = amount => Number.isFinite(amount) && Math.round(amount * 100) / 100 === amount;
// Leave hours and percentages have one decimal outside the App and are integer tenths inside it.
const tenths = value => Math.round(value * 10);
const fromTenths = value => value / 10;
const oneDecimal = value => Number.isFinite(value) && Math.round(value * 10) / 10 === value;
const sum = values => values.reduce((total, value) => total + value, 0);
function references(ctx, data) {
  const person = ctx.binding.people.some(p => p.person_id === data.owner_person_id);
  const account = ctx.binding.accounts.some(a => a.app_id === ctx.app_id && a.account_id === data.account_id && a.owner_person_id === data.owner_person_id);
  if (!person || !account) fail('invalid_seed', 'Account and owner must exist in the supplied binding.');
}
module.exports = {fail, copy, ms, cents, money, twoDecimals, tenths, fromTenths, oneDecimal, sum, references};
