'use strict';
// Record consistency for the public edition catalog and the bound reader's private state.
const {fail, text, references} = require('./domain-utils.cjs');
const {index, instant} = require('./catalog.cjs');

function unique(list, key, label) {
  const seen = new Set();
  for (const item of list) {
    if (seen.has(item[key])) fail('invalid_seed', 'Duplicate ' + label + ' ID: ' + item[key] + '.');
    seen.add(item[key]);
  }
}

// Shared by seed validation ('invalid_seed') and edition.publish ('invalid_event') so a bad
// event is reported as an event error rather than surfacing later from Core's re-validation.
function checkEdition(idx, e, code) {
  const story = idx.stories.get(e.story_id);
  if (!story) fail(code, 'Edition ' + e.edition_id + ' references an unknown story.');
  if (!idx.outlets.has(e.outlet_id)) fail(code, 'Edition ' + e.edition_id + ' references an unknown outlet.');
  if (!text(e.headline, 300) || !text(e.byline, 200) || !text(e.text, 20000)) {
    fail(code, 'Edition headline, byline and text cannot be blank.');
  }
  // Publisher time may be earlier than the commit, never later.
  if (instant(e.published_at) > instant(e.added_at)) fail(code, 'Edition ' + e.edition_id + ' is dated after it was published in Dayline.');
  if (instant(e.added_at) < instant(story.created_at)) fail(code, 'Edition ' + e.edition_id + ' was added before its story group existed.');
  const credited = new Set();
  for (const credit of e.credits) {
    const source = idx.editions.get(credit.edition_id);
    if (!source || credit.edition_id === e.edition_id) {
      fail(code, 'Edition ' + e.edition_id + ' credits a missing or self-referential source edition.');
    }
    if (credited.has(credit.edition_id)) fail(code, 'Edition ' + e.edition_id + ' repeats a credit.');
    if (!text(credit.credit, 300)) fail(code, 'Credit text cannot be blank.');
    if (instant(source.added_at) > instant(e.added_at) || instant(source.published_at) > instant(e.published_at)) {
      fail(code, 'Edition ' + e.edition_id + ' credits an edition that was published later.');
    }
    credited.add(credit.edition_id);
  }
}

function validateSeed(ctx, data) {
  references(ctx, data);
  unique(data.outlets, 'outlet_id', 'outlet');
  unique(data.stories, 'story_id', 'story');
  unique(data.editions, 'edition_id', 'edition');
  unique(data.front_pages, 'front_page_id', 'front page');
  // Seed dates are not compared with the run clock: a run may start before an App's sample fixture
  // (Core validates package fixtures at registration). Tools show only records dated at or before
  // the clock (catalog.visible), so a multi-period seed can load at any point in its window.
  const idx = index(data);
  for (const outlet of data.outlets) {
    if (!text(outlet.name, 200)) fail('invalid_seed', 'Outlet names cannot be blank.');
  }
  for (const story of data.stories) {
    if (!text(story.title, 200)) fail('invalid_seed', 'Story titles cannot be blank.');
  }
  for (const e of data.editions) checkEdition(idx, e, 'invalid_seed');
  // Credits point back to earlier editions; reject cycles even when timestamps tie.
  const visiting = new Set(), done = new Set();
  function visit(id) {
    if (visiting.has(id)) fail('invalid_seed', 'Edition credits cannot form a cycle.');
    if (done.has(id)) return;
    visiting.add(id);
    for (const credit of idx.editions.get(id).credits) visit(credit.edition_id);
    visiting.delete(id); done.add(id);
  }
  for (const id of idx.editions.keys()) visit(id);
  for (const page of data.front_pages) {
    if (!text(page.title, 100)) fail('invalid_seed', 'Front page titles cannot be blank.');
    if (page.entries.some(id => !idx.editions.has(id))) {
      fail('invalid_seed', 'Front page ' + page.front_page_id + ' lists an unknown edition.');
    }
  }
  for (const [list, key, label] of [[data.reading_history, 'read_at', 'Reading history'], [data.reading_list, 'saved_at', 'Reading list']]) {
    unique(list, 'edition_id', label.toLowerCase() + ' edition');
    for (const entry of list) {
      const e = idx.editions.get(entry.edition_id);
      if (!e) fail('invalid_seed', label + ' references an unknown edition.');
      if (instant(entry[key]) < instant(e.added_at)) fail('invalid_seed', label + ' entry precedes the edition being published.');
    }
  }
}

module.exports = {
  validateSeed,
  checkEdition,
  records: data => data.editions,
  objects: data => data.editions.map(e => e.edition_id),
  references: () => [],
};
