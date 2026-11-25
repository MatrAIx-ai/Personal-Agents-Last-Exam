'use strict';
// Read-side helpers: lookups, agent-facing summaries and search. No business mutations here.
const {fail, copy} = require('./domain-utils.cjs');

function index(data) {
  return {
    outlets: new Map(data.outlets.map(o => [o.outlet_id, o])),
    stories: new Map(data.stories.map(s => [s.story_id, s])),
    editions: new Map(data.editions.map(e => [e.edition_id, e])),
    frontPages: new Map(data.front_pages.map(p => [p.front_page_id, p])),
    read: new Map(data.reading_history.map(h => [h.edition_id, h])),
    saved: new Map(data.reading_list.map(s => [s.edition_id, s])),
  };
}

function edition(idx, id) {
  const found = idx.editions.get(id);
  if (!found) fail('not_found', 'Edition does not exist in Dayline.');
  return found;
}

// A story group is only visible once it carries a published edition, so a group that a
// task pre-declares for a later edition.publish event does not leak upcoming coverage.
function visibleStory(idx, data, id) {
  const story = idx.stories.get(id);
  if (!story || !data.editions.some(e => e.story_id === id)) fail('not_found', 'Story does not exist in Dayline.');
  return story;
}

function summary(idx, e) {
  return {
    edition_id: e.edition_id, story_id: e.story_id, outlet_id: e.outlet_id,
    outlet_name: idx.outlets.get(e.outlet_id).name, section: e.section, geography: e.geography,
    language: e.language, headline: e.headline, byline: e.byline, published_at: e.published_at,
    read: idx.read.has(e.edition_id), saved: idx.saved.has(e.edition_id),
  };
}

function full(idx, e) {
  return {
    ...summary(idx, e), text: e.text, credits: copy(e.credits), added_at: e.added_at,
    read_at: idx.read.get(e.edition_id)?.read_at ?? null,
    saved_at: idx.saved.get(e.edition_id)?.saved_at ?? null,
  };
}

// Case- and accent-insensitive matching so "Bahia" finds "Bahía".
const fold = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const instant = value => Date.parse(value);
const newestFirst = (a, b) => instant(b.published_at) - instant(a.published_at) || a.edition_id.localeCompare(b.edition_id);
const oldestFirst = (a, b) => instant(a.published_at) - instant(b.published_at) || a.edition_id.localeCompare(b.edition_id);

function search(idx, data, args) {
  const terms = fold(args.query || '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const after = args.published_after === undefined ? null : instant(args.published_after);
  const before = args.published_before === undefined ? null : instant(args.published_before);
  const matches = data.editions.filter(e => {
    for (const key of ['outlet_id', 'section', 'geography', 'language', 'story_id']) {
      if (args[key] !== undefined && e[key] !== args[key]) return false;
    }
    if (after !== null && instant(e.published_at) < after) return false;
    if (before !== null && instant(e.published_at) > before) return false;
    if (!terms.length) return true;
    const words = fold([e.headline, e.text, e.byline, idx.outlets.get(e.outlet_id).name,
      idx.stories.get(e.story_id).title, ...e.credits.map(c => c.credit)].join(' ')).split(/[^\p{L}\p{N}]+/u);
    // Each query word must match the start of a word, so "air" finds "airport" but not "repair".
    return terms.every(term => words.some(word => word.startsWith(term)));
  }).sort(newestFirst);
  return {total: matches.length, editions: matches.slice(0, args.limit ?? 20).map(e => summary(idx, e))};
}

module.exports = {index, edition, visibleStory, summary, full, search, fold, instant, newestFirst, oldestFirst};
