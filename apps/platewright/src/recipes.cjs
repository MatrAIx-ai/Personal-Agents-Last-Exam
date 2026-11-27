'use strict';
// W1 recipe box and W3 substitutions: search, scaled reads, create, revisions, archive, variants.
const c = require('./common.cjs');
const u = require('./units.cjs');
const {nutrition, shownNutrition, check} = require('./check.cjs');
const {fail, copy, exact} = c;

const CONTENT_KEYS = ['title', 'servings', 'lines', 'method_tags', 'steps', 'tags', 'active_minutes', 'total_minutes'];
const contentOf = r => copy(Object.fromEntries(CONTENT_KEYS.map(k => [k, r[k]])));
function contentAt(r, revision) {
  if (!revision || revision === r.revision) return contentOf(r);
  const row = r.revisions.find(x => x.revision === revision);
  if (!row) fail('not_found', `${r.title} has no revision ${revision}.`);
  return copy(row.content);
}
const ingredientsMap = data => c.byId(data.ingredients);
const state = r => (r.archived ? 'archived' : 'active');

function checkServings(servings) {
  if (typeof servings !== 'number' || !Number.isFinite(servings) || servings < 1 || servings > 200) {
    fail('invalid_servings', 'Servings must be between 1 and 200.');
  }
}
function checkLine(data, line) {
  const ing = c.ingredient(data, line.ingredient_id);
  if (!(line.quantity > 0) || !Number.isFinite(line.quantity)) fail('invalid_quantity', `The quantity of ${ing.name} must be positive.`);
  if (line.quantity < c.LIMITS.line_min || line.quantity > c.LIMITS.quantity) fail('invalid_quantity', `The quantity of ${ing.name} must be between 0.001 and 1,000,000.`);
  if (!u.measurable(ing, line.unit)) fail('invalid_quantity', `${ing.name} cannot be measured in ${line.unit}.`);
  return ing;
}
// Normalizes and validates recipe content; throws before anything is written.
function normalizeContent(data, input) {
  const content = {
    title: input.title.trim(), servings: input.servings,
    lines: input.lines.map(l => ({ingredient_id: l.ingredient_id, quantity: l.quantity, unit: l.unit, optional: !!l.optional, note: l.note ?? null})),
    method_tags: [...input.method_tags], steps: [...input.steps], tags: [...(input.tags || [])],
    active_minutes: input.active_minutes ?? null, total_minutes: input.total_minutes ?? null
  };
  if (!content.title) fail('invalid_arguments', 'A recipe needs a title.');
  checkServings(content.servings);
  for (const line of content.lines) checkLine(data, line);
  if (content.active_minutes !== null && content.total_minutes !== null && content.active_minutes > content.total_minutes) {
    fail('invalid_arguments', 'Active minutes cannot exceed total minutes.');
  }
  return content;
}

// Allergens and flags a recipe's lines carry (optional lines included, and listed).
function profile(content, ingredients) {
  const contains = new Set(), may = new Set(), flags = new Set(), optional = new Set();
  for (const l of content.lines) {
    const ing = ingredients.get(l.ingredient_id);
    ing.allergens.forEach(a => contains.add(a));
    ing.may_contain.forEach(a => may.add(a));
    ing.flags.forEach(f => flags.add(f));
    if (l.optional) ing.allergens.forEach(a => optional.add(a));
  }
  const allOptional = [...optional].filter(a => content.lines.every(l => l.optional || !ingredients.get(l.ingredient_id).allergens.includes(a)));
  return {contains: [...contains].sort(), may_contain: [...may].filter(a => !contains.has(a)).sort(), flags: [...flags].sort(), allergens_only_in_optional_lines: allOptional.sort()};
}

function variantView(data, r) {
  if (!r.variant) return null;
  const base = data.recipes.find(x => x.id === r.variant.base_recipe_id);
  return {...copy(r.variant), base_title: base.title, base_current_revision: base.revision, stale_base: base.revision > r.variant.base_revision};
}

function summary(data, r, ingredients) {
  return {id: r.id, title: r.title, state: state(r), revision: r.revision, servings: r.servings, method_tags: r.method_tags, tags: r.tags,
    active_minutes: r.active_minutes, total_minutes: r.total_minutes, ...profile(r, ingredients),
    variant_of: r.variant ? r.variant.base_recipe_id : null};
}

// ---- Reads -------------------------------------------------------------------------------------
function search(ctx, data, args) {
  const ingredients = ingredientsMap(data);
  for (const a of args.allergen_free || []) if (!c.ALLERGENS.includes(a)) fail('invalid_arguments', `${a} is not one of the nine allergens.`);
  for (const d of args.diet || []) if (!c.DIETS[d]) fail('invalid_arguments', `${d} is not a known diet.`);
  if (args.ingredient_id) c.ingredient(data, args.ingredient_id);
  const q = (args.query || '').trim().toLowerCase();
  const items = data.recipes.filter(r => {
    if (r.archived && !args.include_archived) return false;
    const ings = r.lines.map(l => ingredients.get(l.ingredient_id));
    if (q) {
      const text = [r.title, ...r.tags, ...ings.flatMap(i => [i.name, ...i.aliases])].join(' ').toLowerCase();
      if (!q.split(/\s+/).every(word => text.includes(word))) return false;
    }
    if (args.ingredient_id && !r.lines.some(l => l.ingredient_id === args.ingredient_id)) return false;
    if (args.tags && !args.tags.every(t => r.tags.includes(t))) return false;
    if (args.max_total_minutes !== undefined && (r.total_minutes === null || r.total_minutes > args.max_total_minutes)) return false;
    for (const a of args.allergen_free || []) {
      if (ings.some(i => i.allergens.includes(a) || (args.strict && i.may_contain.includes(a)))) return false;
    }
    for (const d of args.diet || []) if (ings.some(i => i.flags.some(f => c.DIETS[d].includes(f)))) return false;
    return true;
  }).sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  const offset = args.offset || 0, limit = args.limit || 20;
  const page = items.slice(offset, offset + limit).map(r => summary(data, r, ingredients));
  return {items: page, total: items.length, offset, next_offset: offset + limit < items.length ? offset + limit : null};
}

function ingredientSearch(ctx, data, args) {
  for (const a of args.allergen_free || []) if (!c.ALLERGENS.includes(a)) fail('invalid_arguments', `${a} is not one of the nine allergens.`);
  if (args.diet && !c.DIETS[args.diet]) fail('invalid_arguments', `${args.diet} is not a known diet.`);
  const q = (args.query || '').trim().toLowerCase();
  const items = data.ingredients.filter(i => {
    if (q && ![i.name, ...i.aliases].some(n => n.toLowerCase().includes(q))) return false;
    if ((args.allergen_free || []).some(a => i.allergens.includes(a))) return false;
    if (args.diet && i.flags.some(f => c.DIETS[args.diet].includes(f))) return false;
    if (args.tag && !i.tags.includes(args.tag)) return false;
    if (args.flag && !i.flags.includes(args.flag)) return false;
    return true;
  }).sort((a, b) => a.name.localeCompare(b.name));
  const offset = args.offset || 0, limit = args.limit || 20;
  return {items: copy(items.slice(offset, offset + limit)), total: items.length, offset, next_offset: offset + limit < items.length ? offset + limit : null};
}

// Lines of a content at a number of servings in a unit system, each with its exact value.
function scaledLines(data, content, servings, system, overrides = {}) {
  const ingredients = ingredientsMap(data);
  for (const id of Object.keys(overrides)) {
    if (!content.lines.some(l => l.ingredient_id === id)) fail('not_in_recipe', `${(ingredients.get(id) || {name: id}).name} is not in this recipe.`);
  }
  const factor = servings / content.servings;
  return content.lines.map((line, index) => {
    const ing = ingredients.get(line.ingredient_id);
    const q = exact(line.quantity * factor);
    const unit = overrides[line.ingredient_id] || u.displayUnit(q, line.unit, system);
    const value = u.convert(q, line.unit, unit, ing);
    return {line: index, ingredient_id: line.ingredient_id, name: ing.name, optional: line.optional, note: line.note,
      ...u.shown(value, unit, ing), as_written: {quantity: line.quantity, unit: line.unit}};
  });
}

// Lines whose grams are unknown (they make nutrition null).
const nutritionMissing = (data, content) => nutrition(content, ingredientsMap(data)).missing_for;

function nutritionView(data, content) {
  const n = nutrition(content, ingredientsMap(data));
  return {nutrition: shownNutrition(n.exact), nutrition_exact: n.exact, missing_for: n.missing_for, optional_excluded: n.optional_excluded};
}

function get(ctx, data, args) {
  const r = c.recipe(data, args.id);
  const content = contentAt(r, args.revision);
  const servings = args.servings ?? content.servings;
  checkServings(servings);
  const system = args.unit_system || data.household.unit_system;
  const lines = scaledLines(data, content, servings, system, args.units || {});
  return {recipe: {
    id: r.id, title: content.title, state: state(r), revision: r.revision, revision_shown: args.revision || r.revision,
    base_servings: content.servings, servings, unit_system: system, lines,
    method_tags: content.method_tags, steps: content.steps, tags: content.tags, active_minutes: content.active_minutes, total_minutes: content.total_minutes,
    ...profile(content, ingredientsMap(data)), ...nutritionView(data, content),
    revisions: r.revisions.map(x => ({revision: x.revision, at: x.at, actor: x.actor, by: x.by})),
    history: copy(r.history), variant: variantView(data, r), origin: copy(r.origin)
  }};
}

function mealDate(ctx, data, date) {
  const d = date || c.today(ctx, data);
  if (!c.isDate(d)) fail('invalid_arguments', `${d} is not a calendar date.`);
  return d;
}

// The people a check is run for: listed members (default: every member) and the given guests.
function people(data, memberIds, guests) {
  const ids = memberIds || data.members.map(m => m.person_id);
  const rows = ids.map(id => {
    const m = c.member(data, id);
    return {kind: 'member', id, name: m.display_name, portion_factor: m.portion_factor, constraints: m.constraints};
  });
  return rows.concat((guests || []).map(g => ({kind: 'guest', id: g.guest_id, name: g.name, portion_factor: 1, constraints: g.constraints})));
}

function checkRecipe(ctx, data, args) {
  const r = c.recipe(data, args.id);
  const content = contentAt(r, args.revision);
  const date = mealDate(ctx, data, args.date);
  const guests = require('./household.cjs').normalizeGuests(data, args.guests || []);
  const verdicts = check(content, people(data, args.members, guests), date, {ingredients: ingredientsMap(data), zone: data.household.time_zone});
  return {recipe_id: r.id, revision: args.revision || r.revision, date, ...nutritionView(data, content), verdicts};
}

// ---- Writes ------------------------------------------------------------------------------------
const origin = (ctx, data, args) => ({at: ctx.virtual_now, actor: 'agent', by: data.owner_person_id, request_id: args.request_id, event_id: null});

function uniqueRecipeId(data, title) {
  const base = 'rec-' + c.slug(title), ids = new Set(data.recipes.map(r => r.id));
  if (!ids.has(base)) return base;
  let n = 2;
  while (ids.has(base + '-' + n)) n++;
  return base + '-' + n;
}

// Adds a recipe at revision 1. `who` is the origin row (agent request or event).
function insertRecipe(data, content, who, {id, variant = null} = {}) {
  const recipeId = id || uniqueRecipeId(data, content.title);
  const r = {id: recipeId, ...content, archived: false, revision: 1,
    revisions: [{revision: 1, at: who.at, actor: who.actor, by: who.by, request_id: who.request_id, event_id: who.event_id, content: copy(content)}],
    variant, origin: copy(who),
    history: [{at: who.at, actor: who.actor, by: who.by, action: 'created', revision: 1, request_id: who.request_id, event_id: who.event_id}]};
  data.recipes.push(r);
  return r;
}

function create(ctx, data, args) {
  const content = normalizeContent(data, args);
  const r = insertRecipe(data, content, origin(ctx, data, args));
  return {id: r.id, state: 'active', revision: 1};
}

function update(ctx, data, args) {
  const r = c.recipe(data, args.id);
  const patch = args.patch, keys = Object.keys(patch);
  if (!keys.length) fail('invalid_arguments', 'The patch must change at least one field.');
  const contentKeys = keys.filter(k => k !== 'archived');
  if (r.archived && contentKeys.length) fail('invalid_state', 'An archived recipe can only be restored; restore it with archived: false before editing.');
  if (r.variant && contentKeys.length) fail('invalid_state', 'A variant records the swaps it was made with; save another variant instead of editing it.');
  let next = null;
  if (contentKeys.length) {
    next = normalizeContent(data, {...contentOf(r), ...Object.fromEntries(contentKeys.map(k => [k, patch[k]]))});
    if (JSON.stringify(next) === JSON.stringify(contentOf(r))) next = null;
  }
  const toggle = 'archived' in patch && patch.archived !== r.archived;
  if ('archived' in patch && !toggle && !next) fail('invalid_state', r.archived ? 'The recipe is already archived.' : 'The recipe is already active.');
  if (!next && !toggle) fail('invalid_arguments', 'The patch does not change the recipe.');
  const who = origin(ctx, data, args);
  const row = action => ({at: who.at, actor: 'agent', by: who.by, action, revision: r.revision, request_id: who.request_id, event_id: null});
  if (next) {
    Object.assign(r, next);
    r.revision += 1;
    r.revisions.push({revision: r.revision, at: who.at, actor: 'agent', by: who.by, request_id: who.request_id, event_id: null, content: copy(next)});
    r.history.push(row('revised'));
  }
  if (toggle) {
    r.archived = patch.archived;
    r.history.push(row(patch.archived ? 'archived' : 'restored'));
  }
  return {id: r.id, state: state(r), revision: r.revision, new_revision: !!next};
}

// ---- W3 substitutions -------------------------------------------------------------------------------
function ruleStatus(rule, recipeMethods) {
  if (!recipeMethods) return {applicable: true, reason: null};
  const missing = recipeMethods.filter(m => !rule.methods.includes(m));
  return missing.length
    ? {applicable: false, reason: `Valid only for ${rule.methods.join(', ')}; this recipe is also ${missing.join(', ')}.`}
    : {applicable: true, reason: null};
}
function ruleView(data, rule, recipeMethods) {
  const to = data.ingredients.find(i => i.id === rule.to_ingredient_id);
  return {...copy(rule), to_name: to.name, to_allergens: to.allergens, to_may_contain: to.may_contain, to_flags: to.flags, ...ruleStatus(rule, recipeMethods)};
}
function substitutions(ctx, data, args) {
  if (!args.id === !args.ingredient_id) fail('invalid_arguments', 'Give either a recipe id or an ingredient_id.');
  if (args.ingredient_id) {
    const ing = c.ingredient(data, args.ingredient_id);
    return {recipe_id: null, ingredient_id: ing.id, rules: data.substitution_rules.filter(r => r.from_ingredient_id === ing.id).map(r => ruleView(data, r, null)), lines: []};
  }
  const r = c.recipe(data, args.id);
  const ingredients = ingredientsMap(data);
  return {recipe_id: r.id, ingredient_id: null, rules: [], lines: r.lines.map((l, index) => ({line: index, ingredient_id: l.ingredient_id, name: ingredients.get(l.ingredient_id).name,
    rules: data.substitution_rules.filter(x => x.from_ingredient_id === l.ingredient_id).map(x => ruleView(data, x, r.method_tags))}))};
}

// Resolves swaps against a base recipe and returns the variant content and record; writes nothing.
function buildVariant(data, args) {
  const base = c.recipe(data, args.id);
  if (base.variant) fail('invalid_state', `${base.title} is itself a variant; start from its base recipe, ${c.recipe(data, base.variant.base_recipe_id).title}.`);
  if (base.archived) fail('invalid_state', 'Restore the archived recipe before making a variant of it.');
  const content = contentOf(base), used = new Set(), swaps = [];
  for (const s of args.swaps) {
    const from = c.ingredient(data, s.ingredient_id);
    const indexes = base.lines.map((l, i) => [l, i]).filter(([l, i]) => l.ingredient_id === from.id && (s.line === undefined || s.line === i)).map(([, i]) => i);
    if (!indexes.length) fail('not_in_recipe', `${from.name} is not ${s.line === undefined ? 'in this recipe' : 'on line ' + s.line + ' of this recipe'}.`);
    let to, ratio, rule = null;
    if (s.rule_id) {
      rule = data.substitution_rules.find(x => x.id === s.rule_id);
      if (!rule || rule.from_ingredient_id !== from.id) fail('unknown_rule', `No substitution rule with that ID replaces ${from.name}.`);
      const status = ruleStatus(rule, base.method_tags);
      if (!status.applicable) fail('rule_not_applicable', `${c.ingredient(data, rule.to_ingredient_id).name} for ${from.name}: ${status.reason}`);
      to = c.ingredient(data, rule.to_ingredient_id); ratio = rule.ratio;
    } else if (s.to_ingredient_id) {
      to = c.ingredient(data, s.to_ingredient_id); ratio = s.ratio ?? 1;
      if (!(ratio > 0)) fail('invalid_quantity', 'A swap ratio must be positive.');
      if (ratio < c.LIMITS.ratio_min || ratio > c.LIMITS.ratio_max) fail('invalid_quantity', 'A swap ratio must be between 0.01 and 100.');
    } else fail('invalid_arguments', 'A swap needs a rule_id or a to_ingredient_id.');
    if (to.id === from.id) fail('invalid_arguments', 'A swap must change the ingredient.');
    for (const i of indexes) {
      if (used.has(i)) fail('conflict', `Line ${i} (${from.name}) is swapped twice.`);
      used.add(i);
      const line = content.lines[i];
      if (!u.measurable(to, line.unit)) fail('invalid_quantity', `${to.name} cannot be measured in ${line.unit}, the unit of line ${i}.`);
      const quantity = exact(line.quantity * ratio);
      if (quantity < c.LIMITS.line_min || quantity > c.LIMITS.quantity) {
        fail('invalid_quantity', `The swap makes ${c.quantityText(quantity, line.unit)} of ${to.name}; a line quantity must be between 0.001 and 1,000,000.`);
      }
      content.lines[i] = {...line, ingredient_id: to.id, quantity};
      swaps.push({line: i, from_ingredient_id: from.id, to_ingredient_id: to.id, ratio, rule_id: rule ? rule.id : null, custom: !rule});
    }
  }
  const names = swaps.map(s => `${data.ingredients.find(i => i.id === s.to_ingredient_id).name} for ${data.ingredients.find(i => i.id === s.from_ingredient_id).name}`);
  content.title = (args.title || `${base.title} (${[...new Set(names)].join(', ')})`).trim();
  if (!content.title) fail('invalid_arguments', 'A recipe needs a title.');
  const variant = {base_recipe_id: base.id, base_revision: base.revision, swaps, unverified: swaps.some(s => s.custom)};
  return {base, content, variant};
}

function preview(ctx, data, args) {
  const {base, content, variant} = buildVariant(data, args);
  const date = mealDate(ctx, data, args.date);
  const guests = require('./household.cjs').normalizeGuests(data, args.guests || []);
  const who = people(data, args.members, guests), opts = {ingredients: ingredientsMap(data), zone: data.household.time_zone};
  const before = check(contentOf(base), who, date, opts), after = check(content, who, date, opts);
  return {base_recipe_id: base.id, base_revision: base.revision, title: content.title, unverified: variant.unverified, swaps: variant.swaps,
    content, lines: scaledLines(data, content, content.servings, 'recipe'), ...nutritionView(data, content),
    date, base_check: before, check: after,
    changes: after.map((v, i) => ({kind: v.kind, id: v.id, from: before[i].verdict, to: v.verdict})).filter(x => x.from !== x.to)};
}

function createVariant(ctx, data, args) {
  const {content, variant} = buildVariant(data, args);
  const r = insertRecipe(data, content, origin(ctx, data, args), {variant});
  return {id: r.id, state: 'active', revision: 1, base_recipe_id: variant.base_recipe_id, base_revision: variant.base_revision, unverified: variant.unverified};
}

module.exports = {nutritionMissing, contentOf, contentAt, ingredientsMap, checkServings, normalizeContent, insertRecipe, people,
  search, ingredientSearch, get, checkRecipe, create, update, substitutions, preview, createVariant};
