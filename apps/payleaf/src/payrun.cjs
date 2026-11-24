'use strict';
const c = require('./common.cjs');
const {cents, tenths, sum} = c;
// What follows from the person's own choices when a run posts: the deductions, the net pay and the split across the deposit accounts. All in cents.

// The split rules of a deposit setup. Returns the broken rule, or null.
function splitProblem(accounts) {
  if (accounts.length > 3) return 'A deposit setup has at most three accounts.';
  if (accounts.filter(a => a.remainder === true).length !== 1) return 'A deposit setup has exactly one account that takes the remainder.';
  if (sum(accounts.filter(a => a.percent !== undefined).map(a => tenths(a.percent))) > 1000) return 'The percentages of a deposit setup are above 100 in total.';
  return null;
}
// Fixed amounts in order (filled in order when net pay is short), then each percentage of what is left after them, rounded down, then the remainder.
function split(net, accounts) {
  const out = accounts.map(() => 0);
  let left = net;
  accounts.forEach((a, i) => { if (a.amount !== undefined) { out[i] = Math.min(cents(a.amount), left); left -= out[i]; } });
  const base = left;
  accounts.forEach((a, i) => { if (a.percent !== undefined) { out[i] = Math.floor(base * tenths(a.percent) / 1000); left -= out[i]; } });
  accounts.forEach((a, i) => { if (a.remainder === true) out[i] = left; });
  return out;
}
// Rounded half up to the cent.
const retirementDue = (percent, salary) => Math.floor((tenths(percent) * salary + 500) / 1000);
const percentText = percent => String(percent) + ' percent';
// The deduction lines of a run, in order: each benefit in the order of the plans, then retirement. Each one is taken in full
// while the pay after taxes covers it. The first one it does not cover is taken in part, and the later ones are not taken.
function deductionLines(data, payDate, settings, force, salary, afterTaxes) {
  const lines = [], year = payDate.slice(0, 4), perYear = data.employer.rules.pay_periods_per_year;
  for (const plan of data.plans) {
    const row = force.choices.find(x => x.plan_id === plan.id), choice = row ? row.choice : {no_coverage: true};
    if (choice.no_coverage) continue;
    if (choice.option_id !== undefined) {
      const option = plan.options.find(o => o.id === choice.option_id);
      lines.push({kind: 'benefit', plan_id: plan.id, option_id: option.id, text: plan.name + ': ' + option.name, due: cents(option.per_pay_cost)});
      continue;
    }
    const yearly = cents(choice.yearly_amount);
    const taken = sum(data.statements.filter(s => s.pay_date.slice(0, 4) === year).flatMap(s => s.deductions).filter(d => d.plan_id === plan.id).map(d => cents(d.amount)));
    lines.push({kind: 'benefit', plan_id: plan.id, option_id: null, text: plan.name + ': ' + c.amountText(yearly) + ' a year',
      due: Math.min(Math.ceil(yearly / perYear), yearly - taken)});
  }
  lines.push({kind: 'retirement', plan_id: null, option_id: null, text: 'Retirement savings at ' + percentText(settings.retirement.percent),
    due: retirementDue(settings.retirement.percent, salary)});
  let left = afterTaxes, cut = false;
  return lines.filter(line => line.due > 0).map((line, index) => {
    const amount = cut ? 0 : Math.min(line.due, left);
    if (amount < line.due) cut = true;
    left -= amount;
    return {line_id: 'd' + (index + 1), ...line, amount};
  });
}
module.exports = {splitProblem, split, retirementDue, deductionLines};
