'use strict';
const { byId } = require('./util.cjs');
const { ms, localDate, addDays } = require('./time.cjs');

function eligibleOn(data, patientId, drugId, refillDays, at) {
  let latest = null;
  for (const f of data.fills) {
    if (f.state !== 'collected' || ms(f.closed_at) > ms(at)) continue;
    const rx = byId(data.prescriptions, 'rx_id', f.rx_id);
    if (rx.patient_id !== patientId || rx.drug_id !== drugId) continue;
    if (latest === null || ms(f.closed_at) > ms(latest)) latest = f.closed_at;
  }
  return latest === null ? null : addDays(localDate(ms(latest)), refillDays);
}

function adjudicate(data, fill, at) {
  const rx = byId(data.prescriptions, 'rx_id', fill.rx_id);
  const patient = byId(data.people, 'person_id', rx.patient_id);
  const plan = patient.plan_id === null ? null : byId(data.plans, 'plan_id', patient.plan_id);
  const rule = plan ? plan.rules[rx.drug_id] : null;
  const rejected = (reason, eligible = null) => ({ result: 'rejected', reason, eligible_on: eligible, copay_cents: null });
  if (!rule || !rule.covered) return rejected('not_covered');
  if (rule.max_quantity !== null && fill.quantity > rule.max_quantity) return rejected('quantity_limit');
  if (rule.prior_auth_required && !fill.waived.includes('prior_auth_required')) return rejected('prior_auth_required');
  if (!fill.waived.includes('refill_too_soon')) {
    const eligible = eligibleOn(data, patient.person_id, rx.drug_id, rule.refill_days, at);
    if (eligible !== null && localDate(ms(at)) < eligible) return rejected('refill_too_soon', eligible);
  }
  return { result: 'paid', reason: null, eligible_on: null, copay_cents: rule.copay_cents };
}

const cashPrice = (data, fill) => data.cash_prices[byId(data.prescriptions, 'rx_id', fill.rx_id).drug_id][String(fill.quantity)];

module.exports = { adjudicate, eligibleOn, cashPrice };
