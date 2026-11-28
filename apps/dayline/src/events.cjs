'use strict';
// Infra-applied incoming event: edition.publish. Core deduplicates event IDs and rolls back failures.
const {fail, copy} = require('./domain-utils.cjs');
const {log} = require('./diagnostics.cjs');
const {index, instant} = require('./catalog.cjs');
const {checkEdition} = require('./model.cjs');

function applyEvent(ctx, data, event) {
  if (event.operation !== 'edition.publish') fail('invalid_event', 'Unsupported operation.');
  const p = event.payload, idx = index(data);
  if (idx.editions.has(p.edition_id)) fail('invalid_event', 'Edition ' + p.edition_id + ' is already published; editions are immutable.');
  if (!idx.stories.has(p.story_id)) fail('invalid_event', 'Unknown story ' + p.story_id + '.');
  if (!idx.outlets.has(p.outlet_id)) fail('invalid_event', 'Unknown outlet ' + p.outlet_id + '.');
  for (const credit of p.credits) {
    if (!idx.editions.has(credit.edition_id)) fail('invalid_event', 'Credited source edition ' + credit.edition_id + ' is not published.');
  }
  if ((p.front_page === undefined) !== (p.position === undefined)) {
    fail('invalid_event', 'front_page and position must be supplied together.');
  }
  const edition = {
    edition_id: p.edition_id, story_id: p.story_id, outlet_id: p.outlet_id, section: p.section,
    geography: p.geography, language: p.language, headline: p.headline, byline: p.byline, text: p.text,
    credits: copy(p.credits), published_at: p.published_at,
    // Visible from the moment the event commits, even when the publisher's timestamp is earlier.
    added_at: event.at,
  };
  checkEdition(idx, edition, 'invalid_event');
  data.editions.push(edition);
  if (p.front_page !== undefined) {
    const page = idx.frontPages.get(p.front_page);
    if (!page) fail('invalid_event', 'Unknown front page ' + p.front_page + '.');
    // Positions count the entries a reader sees at the event time; entries added later keep their place.
    const shown = page.entries.filter(id => instant(idx.editions.get(id).added_at) <= instant(event.at));
    if (p.position > shown.length + 1) fail('invalid_event', 'Position is past the end of front page ' + p.front_page + '.');
    const at = p.position <= shown.length ? page.entries.indexOf(shown[p.position - 1])
      : shown.length ? page.entries.indexOf(shown[shown.length - 1]) + 1 : 0;
    page.entries.splice(at, 0, p.edition_id);
  }
  log(ctx, 'dayline.edition_published', {edition_id: p.edition_id, story_id: p.story_id,
    front_page: p.front_page ?? null, position: p.position ?? null});
  return data;
}

module.exports = {applyEvent};
