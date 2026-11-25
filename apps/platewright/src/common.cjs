'use strict';
// Platewright vocabulary, error helper and calendar arithmetic. No persistence and no runtime imports.

const ALLERGENS = ['milk', 'egg', 'fish', 'crustacean_shellfish', 'tree_nut', 'peanut', 'wheat', 'soy', 'sesame'];
const FLAGS = ['meat', 'poultry', 'fish_or_seafood', 'animal_product', 'gluten', 'lactose', 'pork', 'alcohol'];
// A diet is the fixed set of content flags a person avoids.
const DIETS = {
  vegetarian: ['meat', 'poultry', 'fish_or_seafood'],
  vegan: ['meat', 'poultry', 'fish_or_seafood', 'animal_product'],
  pescatarian: ['meat', 'poultry'],
  gluten_free: ['gluten'],
  lactose_free: ['lactose'],
  no_pork: ['pork'],
  no_alcohol: ['alcohol']
};
const NUTRIENTS = ['kcal', 'protein_g', 'carbs_g', 'fat_g', 'sodium_mg'];
const KINDS = ['allergy', 'medical', 'diet', 'limit', 'dislike'];
const METHODS = ['bake', 'simmer', 'raw', 'fry', 'sauce'];
// Meals in the order they are eaten on one day; leftovers can only come from an earlier slot.
const MEALS = ['breakfast', 'lunch', 'snack', 'dinner'];
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const EVENT_KINDS = ['member.updated', 'recipe.added', 'plan.changed', 'guest.changed', 'pantry.changed', 'shopping.changed'];

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/;

function fail(code, message) {
  throw Object.assign(new Error(message), {code});
}
const copy = value => structuredClone(value);

// ---- Calendar dates (YYYY-MM-DD) ------------------------------------------------------------
function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T00:00:00Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
function addDays(date, days) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
// Whole days from a to b (b - a).
function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}
function weekday(date) {
  return WEEKDAYS[new Date(date + 'T00:00:00Z').getUTCDay()];
}
function validTimeZone(zone) {
  try { new Intl.DateTimeFormat('en-US', {timeZone: zone}); return typeof zone === 'string' && zone.length > 0; } catch { return false; }
}
// The calendar date of an instant in an IANA time zone, through Node's built-in Intl.
function localDate(instant, zone) {
  const parts = new Intl.DateTimeFormat('en-US', {timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit'})
    .formatToParts(new Date(instant));
  const get = type => parts.find(p => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
// "Today" is virtual_now in the household's time zone.
const today = (ctx, data) => localDate(ctx.virtual_now, data.household.time_zone);

// ---- Wording shared by notifications and messages ------------------------------------------------
// Dates and meals in the words a person uses: "Sat 14 Nov 2026", "dinner on Sat 14 Nov 2026".
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dateText(date) {
  if (!isDate(date)) return String(date);
  const d = new Date(date + 'T00:00:00Z');
  return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
function slotText(id) {
  const m = /^(\d{4}-\d{2}-\d{2}):([a-z]+)$/.exec(String(id));
  return m ? `${m[2]} on ${dateText(m[1])}` : String(id);
}
const words = value => String(value).replace(/_/g, ' ');
const quantityText = (quantity, unit) => (unit === 'each' || !unit ? `${quantity}` : `${quantity} ${words(unit)}`);

// ---- Small numeric helpers ----------------------------------------------------------------------
// Trims floating-point noise from exact values (1049.9999999 -> 1050) without rounding real fractions.
const exact = n => Math.round(n * 1e6) / 1e6;
const ceilHalf = n => Math.ceil(exact(n) * 2) / 2;

// ---- Lookups --------------------------------------------------------------------------------
const byId = (list, key = 'id') => new Map(list.map(item => [item[key], item]));
function ingredient(data, id, code = 'unknown_ingredient') {
  const found = data.ingredients.find(i => i.id === id);
  if (!found) fail(code, `Ingredient ${id} is not in the ingredient table.`);
  return found;
}
function recipe(data, id, code = 'not_found') {
  const found = data.recipes.find(r => r.id === id);
  if (!found) fail(code, `Recipe ${id} does not exist.`);
  return found;
}
function member(data, id, code = 'unknown_member') {
  const found = data.members.find(m => m.person_id === id);
  if (!found) fail(code, `${id} is not a member of this household.`);
  return found;
}
// Next free ID of the form <prefix><zero-padded number>.
function nextId(prefix, taken, width = 4) {
  const used = new Set(taken);
  let n = 1;
  while (used.has(prefix + String(n).padStart(width, '0'))) n++;
  return prefix + String(n).padStart(width, '0');
}
function slug(text) {
  return text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'recipe';
}

module.exports = {
  ALLERGENS, FLAGS, DIETS, NUTRIENTS, KINDS, METHODS, MEALS, WEEKDAYS, EVENT_KINDS, ID_PATTERN,
  fail, copy, isDate, addDays, daysBetween, weekday, validTimeZone, localDate, today, exact, ceilHalf,
  byId, ingredient, recipe, member, nextId, slug, dateText, slotText, words, quantityText
};
