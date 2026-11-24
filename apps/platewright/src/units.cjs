'use strict';
// Kitchen units: fixed conversion values, conversion through an ingredient's density or weight per
// piece, and display rounding. Shown quantities carry their unrounded value as `exact`; sums use exact.
const {fail, exact} = require('./common.cjs');

// Size of each unit in the base unit of its dimension (g, ml or piece).
const UNITS = {
  g: {dim: 'mass', size: 1}, kg: {dim: 'mass', size: 1000}, oz: {dim: 'mass', size: 28.35}, lb: {dim: 'mass', size: 453.6},
  ml: {dim: 'volume', size: 1}, l: {dim: 'volume', size: 1000}, tsp: {dim: 'volume', size: 5}, tbsp: {dim: 'volume', size: 15},
  cup: {dim: 'volume', size: 240}, fl_oz: {dim: 'volume', size: 30},
  each: {dim: 'count', size: 1}
};
const UNIT_NAMES = Object.keys(UNITS);
const BASE = {mass: 'g', volume: 'ml', count: 'each'};
const UNIT_SYSTEMS = ['recipe', 'metric', 'us'];

const dimension = unit => UNITS[unit] && UNITS[unit].dim;
// A quantity may be recorded only in a unit of a dimension the ingredient is measured in.
const measurable = (ing, unit) => !!UNITS[unit] && ing.measures.includes(UNITS[unit].dim);

// Grams per one base unit of a dimension, or null where the table has no value.
function gramsPerBase(ing, dim) {
  if (dim === 'mass') return 1;
  if (dim === 'volume') return ing.density_g_per_ml ?? null;
  return ing.piece_g ?? null;
}
// Converts a quantity between any two units for this ingredient; null when it cannot.
function tryConvert(quantity, from, to, ing) {
  const a = UNITS[from], b = UNITS[to];
  if (!a || !b) return null;
  const base = quantity * a.size;
  if (a.dim === b.dim) return exact(base / b.size);
  const ga = gramsPerBase(ing, a.dim), gb = gramsPerBase(ing, b.dim);
  if (ga === null || gb === null) return null;
  return exact(base * ga / gb / b.size);
}
function convert(quantity, from, to, ing) {
  const value = tryConvert(quantity, from, to, ing);
  if (value === null) {
    const missing = [UNITS[from].dim, UNITS[to].dim].filter(d => gramsPerBase(ing, d) === null)
      .map(d => (d === 'volume' ? 'density' : 'weight per piece'));
    fail('no_conversion', `${ing.name} has no ${[...new Set(missing)].join(' or ')} in the ingredient table, so ${from} cannot be converted to ${to}.`);
  }
  return value;
}
const toGrams = (quantity, unit, ing) => tryConvert(quantity, unit, 'g', ing);

// Unit a quantity is shown in for a unit system; conversions stay inside the line's dimension.
function displayUnit(quantity, unit, system) {
  const dim = UNITS[unit].dim;
  if (system === 'recipe' || dim === 'count') return unit;
  if (system === 'metric') return BASE[dim];
  const base = quantity * UNITS[unit].size;
  if (dim === 'mass') return base >= 453.6 ? 'lb' : 'oz';
  if (base < 15) return 'tsp';
  return base < 60 ? 'tbsp' : 'cup';
}

// Display rounding: g and ml to the nearest 1 (0.5 below 10); spoons and cups to the nearest quarter
// (an eighth below 1 tsp); whole-piece ingredients counted in `each` round up to a whole piece.
// Choices where the plan is silent: kg and l to 0.01, oz, lb and fl oz to a quarter, other pieces to
// a quarter, and a positive quantity never rounds to zero (it shows the smallest step instead).
function step(value, unit) {
  if (unit === 'g' || unit === 'ml') return value < 10 ? 0.5 : 1;
  if (unit === 'kg' || unit === 'l') return 0.01;
  if (unit === 'tsp' && value < 1) return 0.125;
  return 0.25;
}
function round(value, unit, ing) {
  if (unit === 'each' && ing.whole_pieces) return Math.ceil(exact(value));
  const s = step(value, unit);
  const rounded = exact(Math.round(value / s) * s);
  return rounded === 0 && value > 0 ? s : rounded;
}
// Rounds up once, at the end of a shopping-list sum.
function roundUp(value, unit, ing) {
  if (unit === 'each' && ing.whole_pieces) return Math.ceil(exact(value));
  const s = step(value, unit);
  return exact(Math.ceil(exact(value / s)) * s);
}
// A shown quantity: rounded value, unit and the exact value it came from.
function shown(value, unit, ing) {
  return {quantity: round(value, unit, ing), unit, exact: exact(value)};
}

module.exports = {UNIT_NAMES, UNIT_SYSTEMS, BASE, dimension, measurable, tryConvert, convert, toGrams, displayUnit, roundUp, shown};
