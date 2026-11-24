'use strict';
// The one suitability check, used by recipes.check, recipes.variant.preview and every plan slot's
// flags, plus nutrition per serving. Pure functions of their arguments: no state, no clock.
const {DIETS, NUTRIENTS, localDate, exact} = require('./common.cjs');
const {toGrams} = require('./units.cjs');

const SEVERITY = {unsafe: 6, may_contain: 5, unsuitable: 4, over_limit: 3, disliked: 2, ok_if_omitted: 1, ok: 0};
const worst = verdicts => verdicts.reduce((a, b) => (SEVERITY[b] > SEVERITY[a] ? b : a), 'ok');

// Nutrition per serving: grams of each non-optional line times the table's values per 100 g, over
// the recipe's servings. A line that cannot be converted to grams makes the whole value null.
function nutrition(content, ingredients) {
  const totals = Object.fromEntries(NUTRIENTS.map(n => [n, 0]));
  const optional_excluded = [], missing_for = [];
  content.lines.forEach((line, index) => {
    if (line.optional) { optional_excluded.push({line: index, ingredient_id: line.ingredient_id}); return; }
    const ing = ingredients.get(line.ingredient_id);
    const grams = toGrams(line.quantity, line.unit, ing);
    if (grams === null) { missing_for.push({line: index, ingredient_id: line.ingredient_id, unit: line.unit}); return; }
    for (const n of NUTRIENTS) totals[n] += grams * ing.nutrition_per_100g[n] / 100;
  });
  const per = missing_for.length ? null : Object.fromEntries(NUTRIENTS.map(n => [n, exact(totals[n] / content.servings)]));
  return {exact: per, missing_for, optional_excluded};
}
// Shown nutrition: kcal and sodium to whole numbers, grams to one decimal.
const shownNutrition = per => per && Object.fromEntries(NUTRIENTS.map(n => [n, n === 'kcal' || n === 'sodium_mg' ? Math.round(per[n]) : Math.round(per[n] * 10) / 10]));

// A member's constraint on a calendar date. An ended constraint stops applying from the household
// date on which it was ended; a scheduled one starts on effective_from; one expires after expires_on.
function constraintState(c, date, zone) {
  if (c.ended_at && date >= localDate(c.ended_at, zone)) return 'ended';
  if (c.effective_from && date < c.effective_from) return 'scheduled';
  if (c.expires_on && date > c.expires_on) return 'expired';
  return 'active';
}

const ref = (line, index) => ({line: index, ingredient_id: line.ingredient_id, optional: !!line.optional});

// Findings of one constraint against a dish. Each finding names the lines that cause it.
function findings(c, content, ingredients, per, factor) {
  const out = [];
  const lines = test => content.lines.map((l, i) => [l, i]).filter(([l]) => test(ingredients.get(l.ingredient_id), l)).map(([l, i]) => ref(l, i));
  const add = (verdict, reason, refs, extra = {}) => { if (refs.length) out.push({verdict, reason, constraint_id: c.id ?? null, kind: c.kind, lines: refs, ...extra}); };
  if (c.kind === 'allergy') {
    add('unsafe', 'contains_allergen', lines(ing => ing.allergens.includes(c.allergen)), {allergen: c.allergen});
    add(c.strict ? 'unsafe' : 'may_contain', 'may_contain_allergen',
      lines(ing => !ing.allergens.includes(c.allergen) && ing.may_contain.includes(c.allergen)), {allergen: c.allergen, strict: !!c.strict});
  } else if (c.kind === 'medical') {
    if (c.ingredient_id) add('unsafe', 'medical_ingredient', lines((ing, l) => l.ingredient_id === c.ingredient_id), {ingredient_id: c.ingredient_id});
    else add('unsafe', 'medical_flag', lines(ing => ing.flags.includes(c.flag)), {flag: c.flag});
  } else if (c.kind === 'diet') {
    const avoided = DIETS[c.diet];
    add('unsuitable', 'diet_flag', lines(ing => ing.flags.some(f => avoided.includes(f))), {diet: c.diet, flags: avoided});
  } else if (c.kind === 'limit') {
    if (per) {
      const value = exact(per[c.nutrient] * factor);
      if (value > c.max) out.push({verdict: 'over_limit', reason: 'over_limit', constraint_id: c.id ?? null, kind: c.kind, lines: [],
        nutrient: c.nutrient, max: c.max, value: Math.round(value * 10) / 10, portion_factor: factor});
    }
  } else if (c.kind === 'dislike') {
    if (c.ingredient_id) add('disliked', 'disliked_ingredient', lines((ing, l) => l.ingredient_id === c.ingredient_id), {ingredient_id: c.ingredient_id});
    else add('disliked', 'disliked_tag', lines(ing => ing.tags.includes(c.tag)), {tag: c.tag});
  }
  return out;
}

// One verdict per person. `people` rows are {kind: 'member'|'guest', id, name, portion_factor,
// constraints}; a member's constraints apply as they stand on `date` (the date of the meal).
function check(content, people, date, {ingredients, zone}) {
  const per = nutrition(content, ingredients).exact;
  return people.map(p => {
    const applied = p.kind === 'member' ? p.constraints.filter(c => constraintState(c, date, zone) === 'active') : p.constraints;
    const all = applied.flatMap(c => findings(c, content, ingredients, per, p.portion_factor));
    const unchecked = per ? [] : applied.filter(c => c.kind === 'limit').map(c => ({constraint_id: c.id ?? null, nutrient: c.nutrient, reason: 'nutrition_unknown'}));
    // A finding caused only by optional lines does not decide the verdict; if nothing else is
    // found the dish is ok once those lines are left out.
    const firm = all.filter(f => !f.lines.length || f.lines.some(l => !l.optional));
    let verdict = worst(firm.map(f => f.verdict)), omit = [];
    if (verdict === 'ok' && all.length) {
      verdict = 'ok_if_omitted';
      const seen = new Set();
      omit = all.flatMap(f => f.lines).filter(l => !seen.has(l.line) && seen.add(l.line)).sort((a, b) => a.line - b.line);
    }
    return {kind: p.kind, id: p.id, name: p.name, verdict, findings: all, omit_lines: omit, unchecked};
  });
}

module.exports = {SEVERITY, worst, nutrition, shownNutrition, constraintState, check};
