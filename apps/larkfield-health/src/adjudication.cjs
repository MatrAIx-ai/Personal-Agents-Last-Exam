'use strict';
const { sortBy } = require('./util.cjs');

const halfUp = (cents, pct) => Math.floor((cents * pct + 50) / 100);
const yearOf = date => date.slice(0, 4);
const ordered = lines => [...lines].sort(sortBy('service_date'));
const AMOUNTS = ['allowed_cents', 'copay_cents', 'deductible_cents', 'coinsurance_cents', 'member_cost_cents', 'plan_paid_cents'];

function lineOutcome(standing, requests) {
  if (standing === 'other_primary' || requests.some(r => r.answer === 'other_primary' || r.answer === 'work_related')) return 'other_party_liable';
  return requests.some(r => r.status === 'expired') ? 'missing_information' : null;
}

function split(year, category, allowed, cell) {
  const flat = Object.hasOwn(year.copays, category);
  const copay = flat ? Math.min(year.copays[category], allowed) : 0;
  const ded = flat ? 0 : Math.min(allowed, Math.max(0, year.deductible.individual_cents - cell.member.deductible_cents), Math.max(0, year.deductible.family_cents - cell.family.deductible_cents));
  const coins = flat ? 0 : halfUp(allowed - ded, year.coinsurance_pct);
  let room = Math.min(Math.max(0, year.oop_max.individual_cents - cell.member.oop_cents), Math.max(0, year.oop_max.family_cents - cell.family.oop_cents));
  const take = want => { const got = Math.min(want, room); room -= got; return got; };
  return { copay: take(copay), ded: take(ded), coins: take(coins) };
}

function advance(cell, ded, cost) {
  for (const k of ['member', 'family']) { cell[k].deductible_cents += ded; cell[k].oop_cents += cost; }
}

function price(plan, service, line, book, pa) {
  const year = yearOf(line.service_date), allowed = Math.min(line.billed_cents, service.fee_cents * line.units);
  const s = split(plan.years[year], service.category, allowed, book[year]), cost = s.copay + s.ded + s.coins;
  advance(book[year], s.ded, cost);
  return { line_id: line.line_id, status: 'paid', reason: null, allowed_cents: allowed, copay_cents: s.copay, deductible_cents: s.ded, coinsurance_cents: s.coins, member_cost_cents: cost,
    plan_paid_cents: allowed - cost, not_allowed_cents: line.billed_cents - allowed, pa_id: pa ? pa.pa_id : null, pa_units: pa ? line.units : 0 };
}

function denied(line, reason) {
  const out = { line_id: line.line_id, status: 'denied', reason };
  for (const k of AMOUNTS) out[k] = 0;
  return { ...out, not_allowed_cents: line.billed_cents, pa_id: null, pa_units: 0 };
}

function choosePa(pool, line) {
  const fits = pool.filter(p => p.service_id === line.service_id && p.valid_from <= line.service_date && line.service_date <= p.valid_until && p.remaining >= line.units);
  return fits.map(p => ({ p, key: p.valid_until + '|' + p.pa_id })).sort(sortBy('key')).map(x => x.p)[0] || null;
}

function postings(memberId, lines, priced) {
  const years = [...new Set(lines.map(l => yearOf(l.service_date)))].sort();
  return years.map(y => {
    const mine = lines.filter(l => yearOf(l.service_date) === y).map(l => priced.get(l.line_id));
    return { member_id: memberId, plan_year: Number(y), deductible_cents: mine.reduce((t, l) => t + l.deductible_cents, 0), oop_cents: mine.reduce((t, l) => t + l.member_cost_cents, 0) };
  });
}

function adjudicate({ plan, services, provider, memberId, lines, ledger, outcomes, pas }) {
  const book = structuredClone(ledger), pool = pas.map(p => ({ ...p })), priced = new Map(), use = [];
  for (const l of ordered(lines)) {
    const outcome = outcomes[l.line_id];
    if (outcome) { priced.set(l.line_id, denied(l, outcome)); continue; }
    if (!l.emergency && !provider.in_network) { priced.set(l.line_id, denied(l, 'out_of_network')); continue; }
    let pa = null;
    if (!l.emergency && plan.pa_services.includes(l.service_id)) {
      pa = choosePa(pool, l);
      if (pa === null) { priced.set(l.line_id, denied(l, 'prior_auth_missing')); continue; }
      pa.remaining -= l.units;
      use.push({ pa_id: pa.pa_id, units: l.units });
    }
    priced.set(l.line_id, price(plan, services.get(l.service_id), l, book, pa));
  }
  return { lines: lines.map(l => priced.get(l.line_id)), postings: postings(memberId, lines, priced), ledger: book, pa_use: use };
}

function overturn({ plan, services, memberId, lines, previous, named, ledger }) {
  const book = structuredClone(ledger), priced = new Map();
  for (const l of ordered(lines)) {
    const before = previous.find(x => x.line_id === l.line_id);
    priced.set(l.line_id, named.includes(l.line_id) ? price(plan, services.get(l.service_id), l, book, null) : structuredClone(before));
  }
  return { lines: lines.map(l => priced.get(l.line_id)), postings: postings(memberId, lines, priced), ledger: book };
}

module.exports = { halfUp, ordered, lineOutcome, split, adjudicate, overturn, choosePa };
