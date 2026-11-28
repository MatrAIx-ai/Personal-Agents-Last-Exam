'use strict';
// Record consistency for the public catalog and the bound account's private state. The check functions
// take the error code as a parameter so seed validation reports invalid_seed, event handlers report
// invalid_event and agent writes report their own App errors, from one rule each.
const {fail, text, references} = require('./domain-utils.cjs');
const c = require('./catalog.cjs');
const {checkProposed} = require('./rules.cjs');

function unique(list, key, label, seen = new Set()) {
  for (const item of list) {
    if (!c.ID.test(item[key])) fail('invalid_seed', 'Malformed ' + label + ' ID: ' + item[key] + '.');
    if (seen.has(item[key])) fail('invalid_seed', 'Duplicate ' + label + ' ID: ' + item[key] + '.');
    seen.add(item[key]);
  }
  return seen;
}

function checkOffer(idx, o, code) {
  const t = idx.titles.get(o.title_id), s = idx.services.get(o.service_id);
  if (!t) fail(code, 'Offer ' + o.offer_id + ' references an unknown title.');
  if (!s) fail(code, 'Offer ' + o.offer_id + ' references an unknown service.');
  if (!s.regions.includes(o.region)) fail(code, s.name + ' does not operate in region ' + o.region + '.');
  if (!s.offer_types.includes(o.type)) fail(code, s.name + ' has no ' + o.type + ' offers.');
  if (o.edition_id !== null && idx.editions.get(o.edition_id)?.title_id !== o.title_id) fail(code, 'Offer ' + o.offer_id + ' names an edition of another title.');
  const priced = o.type === 'rent' || o.type === 'buy';
  if (priced && !(typeof o.price === 'number' && o.price > 0 && Math.abs(o.price * 100 - Math.round(o.price * 100)) < 1e-6 && o.currency === c.CURRENCY[o.region])) {
    fail(code, 'Offer ' + o.offer_id + ': rent and buy offers need a positive price in ' + c.CURRENCY[o.region] + '.');
  }
  if (!priced && (o.price !== null || o.currency !== null)) fail(code, 'Offer ' + o.offer_id + ': subscription and free_with_ads offers carry no price.');
  if (o.available_until !== null && c.instant(o.available_until) < c.instant(o.available_from)) {
    fail(code, 'Offer ' + o.offer_id + ': available_until precedes available_from.');
  }
}

function checkRelease(t, r, code) {
  if (!c.isDate(r.date)) fail(code, 'Release date for ' + t.title_id + ' in ' + r.region + ' is not a valid date.');
  if (!c.CERTIFICATIONS[r.region].includes(r.certification)) fail(code, r.certification + ' is not a certification used in ' + r.region + '.');
}

function checkEpisode(t, ep, seasons, numbers, code) {
  if (t.kind !== 'series') fail(code, 'Episode ' + ep.episode_id + ' belongs to a film.');
  if (!seasons.has(ep.season_number)) fail(code, 'Episode ' + ep.episode_id + ' is outside the seasons of ' + t.title_id + '.');
  const key = ep.season_number + ':' + ep.number;
  if (numbers.has(key)) fail(code, 'Episode number ' + key + ' repeats in ' + t.title_id + '.');
  if (!c.isDate(ep.air_date)) fail(code, 'Episode ' + ep.episode_id + ' has an invalid air date.');
  if (!text(ep.name, 200) || !text(ep.synopsis, 1000)) fail(code, 'Episode names and synopses cannot be blank.');
  numbers.add(key);
}

// items: map of item_id -> title_id across the catalog, so an item ID belongs to one title only.
function checkGuideVersion(titleId, v, previous, items, code) {
  if (v.version !== (previous ? previous.version + 1 : 1)) fail(code, 'Guide versions for ' + titleId + ' must be numbered 1, 2, 3, ...');
  if (previous && c.instant(v.published_at) < c.instant(previous.published_at)) fail(code, 'Guide version ' + v.version + ' of ' + titleId + ' is dated before the previous one.');
  if (!previous && v.reason !== 'seed') fail(code, 'Guide version 1 of ' + titleId + ' must have reason seed.');
  if (previous && v.reason === 'seed') fail(code, 'Only guide version 1 can have reason seed.');
  const local = new Set();
  for (const name of c.CATEGORIES) {
    const cat = v.categories[name];
    if (!text(cat.summary, 300)) fail(code, 'Guide summaries cannot be blank.');
    if (cat.severity === 'none' && cat.items.length) fail(code, 'A category rated none cannot list items.');
    for (const item of cat.items) {
      if (!c.ID.test(item.item_id) || local.has(item.item_id)) fail(code, 'Guide item ' + item.item_id + ' is malformed or repeated in ' + titleId + '.');
      if (items.has(item.item_id) && items.get(item.item_id) !== titleId) fail(code, 'Guide item ' + item.item_id + ' already belongs to another title.');
      if (!text(item.text, 500)) fail(code, 'Guide item text cannot be blank.');
      local.add(item.item_id);
    }
  }
  for (const id of local) items.set(id, titleId);
}

// Shared by seed validation and the diary write tools. codes maps the kind of problem to an error code.
function checkDiaryEntry(idx, data, binding, e, codes) {
  const t = idx.titles.get(e.title_id);
  if (!t) fail(codes.missing, 'Title ' + e.title_id + ' does not exist in Kinodex.');
  if (t.kind === 'film' && e.episode_ids.length) fail(codes.args, 'Film entries cannot name episodes.');
  if (t.kind === 'series' && !e.episode_ids.length) fail(codes.args, 'Series entries need at least one episode_id.');
  let latestAir = null;
  for (const id of e.episode_ids) {
    const ep = idx.episodes.get(id);
    if (!ep || ep.title_id !== t.title_id) fail(codes.missing, 'Episode ' + id + ' does not belong to ' + t.name + '.');
    if (latestAir === null || ep.air_date > latestAir) latestAir = ep.air_date;
  }
  if (e.edition_id !== null && idx.editions.get(e.edition_id)?.title_id !== t.title_id) fail(codes.missing, 'Edition ' + e.edition_id + ' does not belong to ' + t.name + '.');
  if (!c.isDate(e.watched_on)) fail(codes.date, 'watched_on must be a real YYYY-MM-DD date.');
  if (e.watched_on < c.earliestRelease(t)) fail(codes.date, 'watched_on is before ' + t.name + '\'s earliest release (' + c.earliestRelease(t) + ').');
  if (latestAir !== null && e.watched_on < latestAir) fail(codes.date, 'watched_on is before the episode aired (' + latestAir + ').');
  if (e.rating !== null && !c.halfStar(e.rating)) fail(codes.rating, 'Ratings are half stars from 0.5 to 5.');
  for (const person of e.watched_with) {
    if (person === data.owner_person_id) fail(codes.args, 'watched_with lists other people, not the account owner.');
    if (!binding.people.some(p => p.person_id === person)) fail(codes.missing, 'Person ' + person + ' is not in the task binding.');
  }
  if (e.review && !text(e.review.text, 5000)) fail(codes.args, 'Review text cannot be blank.');
}
const SEED_CODES = {missing: 'invalid_seed', date: 'invalid_seed', rating: 'invalid_seed', args: 'invalid_seed'};

function validateSeed(ctx, data) {
  references(ctx, data);
  // Seed dates are never compared with the run clock: Core validates package fixtures at registration
  // under the registry's initial time. Tools show only the records that exist at the clock
  // (catalog.visible), so a seed that runs past the clock loads at any point in its window.
  unique(data.services, 'service_id', 'service');
  unique(data.titles, 'title_id', 'title');
  const editions = new Set();
  for (const t of data.titles) unique(t.editions, 'edition_id', 'edition', editions);
  unique(data.episodes, 'episode_id', 'episode');
  unique(data.people, 'person_id', 'person');
  unique(data.credits, 'credit_id', 'credit');
  unique(data.offers, 'offer_id', 'offer');
  unique(data.public_reviews, 'review_id', 'review');
  unique(data.diary, 'entry_id', 'diary entry');
  unique(data.lists, 'list_id', 'list');
  unique(data.alerts, 'alert_id', 'alert');
  unique(data.corrections, 'correction_id', 'correction');
  unique(data.notices, 'notice_id', 'notice');
  const idx = c.index(data);
  for (const s of data.services) if (!text(s.name, 80)) fail('invalid_seed', 'Service names cannot be blank.');
  const seasons = new Map(), numbers = new Map();
  for (const t of data.titles) {
    if (!text(t.name, 200) || !text(t.synopsis, 1000)) fail('invalid_seed', 'Title names and synopses cannot be blank.');
    if (new Set(t.releases.map(r => r.region)).size !== t.releases.length) fail('invalid_seed', 'Title ' + t.title_id + ' repeats a release region.');
    for (const r of t.releases) checkRelease(t, r, 'invalid_seed');
    if (t.kind === 'film' && t.seasons.length) fail('invalid_seed', 'Film ' + t.title_id + ' cannot have seasons.');
    if (new Set(t.seasons.map(s => s.season_number)).size !== t.seasons.length) fail('invalid_seed', 'Title ' + t.title_id + ' repeats a season number.');
    seasons.set(t.title_id, new Set(t.seasons.map(s => s.season_number)));
    numbers.set(t.title_id, new Set());
  }
  for (const ep of data.episodes) {
    const t = idx.titles.get(ep.title_id);
    if (!t) fail('invalid_seed', 'Episode ' + ep.episode_id + ' references an unknown series.');
    checkEpisode(t, ep, seasons.get(t.title_id), numbers.get(t.title_id), 'invalid_seed');
  }
  for (const p of data.people) if (!text(p.name, 120)) fail('invalid_seed', 'Person names cannot be blank.');
  for (const cr of data.credits) {
    if (!idx.titles.has(cr.title_id) || !idx.people.has(cr.person_id)) fail('invalid_seed', 'Credit ' + cr.credit_id + ' references an unknown title or person.');
  }
  if (data.guides.length !== data.titles.length || data.guides.some(g => !idx.titles.has(g.title_id)) || idx.guides.size !== data.guides.length) {
    fail('invalid_seed', 'Every title needs exactly one parental guide.');
  }
  const items = new Map();
  for (const g of data.guides) g.versions.forEach((v, i) => checkGuideVersion(g.title_id, v, g.versions[i - 1], items, 'invalid_seed'));
  for (const o of data.offers) checkOffer(idx, o, 'invalid_seed');
  for (const r of data.public_reviews) {
    if (!idx.titles.has(r.title_id)) fail('invalid_seed', 'Review ' + r.review_id + ' references an unknown title.');
    if (!c.halfStar(r.rating) || !text(r.text, 2000) || !text(r.author, 60)) fail('invalid_seed', 'Review ' + r.review_id + ' needs an author, text and a half-star rating.');
  }
  // Account state. Records about a title are dated from its first listing (guide version 1), and a diary
  // entry from when the seasons of its episodes were added: before then catalog.visible hides the title or
  // season, so the record could not be shown. Writes and events keep this, because they date records at
  // the clock and see only listed titles and added seasons.
  const listedAt = id => idx.guides.get(id).versions[0].published_at;
  const fromListing = (what, at, titleId) => {
    if (c.instant(at) < c.instant(listedAt(titleId))) {
      fail('invalid_seed', what + ' is dated ' + at + ', before ' + idx.titles.get(titleId).name + ' was listed in Kinodex (' + listedAt(titleId) + ').');
    }
  };
  if (data.account.service_ids.some(id => !idx.services.has(id))) fail('invalid_seed', 'The account subscribes to an unknown service.');
  if (!c.validZone(data.account.time_zone)) fail('invalid_seed', 'The account time_zone must be an IANA time zone name such as America/Los_Angeles.');
  if (data.watchlist.title_ids.some(id => !idx.titles.has(id))) fail('invalid_seed', 'The watchlist lists an unknown title.');
  for (const e of data.diary) {
    checkDiaryEntry(idx, data, ctx.binding, e, SEED_CODES);
    if (c.instant(e.updated_at) < c.instant(e.logged_at)) fail('invalid_seed', 'Diary entry ' + e.entry_id + ' was updated before it was logged.');
    fromListing('Diary entry ' + e.entry_id, e.logged_at, e.title_id);
    const t = idx.titles.get(e.title_id);
    for (const id of e.episode_ids) {
      const season = t.seasons.find(s => s.season_number === idx.episodes.get(id).season_number);
      if (c.instant(e.logged_at) < c.instant(season.added_at)) {
        fail('invalid_seed', 'Diary entry ' + e.entry_id + ' is dated ' + e.logged_at + ', before season ' + season.season_number + ' of ' + t.name + ' was added (' + season.added_at + ').');
      }
    }
  }
  for (const l of data.lists) {
    if (!text(l.name, 120) || l.title_ids.some(id => !idx.titles.has(id))) fail('invalid_seed', 'List ' + l.list_id + ' needs a name and known titles.');
  }
  for (const a of data.alerts) {
    const t = idx.titles.get(a.title_id);
    if (!t) fail('invalid_seed', 'Alert ' + a.alert_id + ' references an unknown title.');
    fromListing('Alert ' + a.alert_id, a.created_at, a.title_id);
    const priced = a.kind === 'price_below';
    if (priced !== (a.offer_type !== null) || priced !== (a.threshold !== null) || (priced && !(a.threshold > 0))) {
      fail('invalid_seed', 'Alert ' + a.alert_id + ': only price_below rules carry an offer_type and a positive threshold.');
    }
    if (a.kind === 'new_season' && t.kind !== 'series') fail('invalid_seed', 'Alert ' + a.alert_id + ': new_season rules need a series.');
    if (a.kind !== 'new_season' && a.known_seasons.length) fail('invalid_seed', 'Alert ' + a.alert_id + ': only new_season rules record known seasons.');
    if ((a.status === 'triggered') !== (a.trigger !== null)) fail('invalid_seed', 'Alert ' + a.alert_id + ': a triggered rule, and only a triggered rule, keeps its trigger.');
    if (a.trigger) {
      const tr = a.trigger;
      if ((tr.cause === 'event') !== (tr.event_id !== null && tr.operation !== null) || (tr.cause === 'services.update') !== (tr.request_id !== null)) {
        fail('invalid_seed', 'Alert ' + a.alert_id + ': an event trigger names its event and a services.update trigger names its request.');
      }
      if (tr.notice_id !== null && !data.notices.some(n => n.notice_id === tr.notice_id)) fail('invalid_seed', 'Alert ' + a.alert_id + ' references an unknown notice.');
      if ((a.kind === 'new_season') !== (tr.season_number !== null) || (a.kind === 'new_season') === (tr.offer !== null)) {
        fail('invalid_seed', 'Alert ' + a.alert_id + ': offer rules keep the matching offer, new_season rules keep the season.');
      }
    }
  }
  const TARGET = {runtime: 'edition_id', release_date: 'region', certification: 'region', credit: 'credit_id', guide_item: 'item_id'};
  for (const co of data.corrections) {
    const t = idx.titles.get(co.title_id);
    if (!t) fail('invalid_seed', 'Correction ' + co.correction_id + ' references an unknown title.');
    fromListing('Correction ' + co.correction_id, co.submitted_at, co.title_id);
    if (Object.keys(co.target)[0] !== TARGET[co.field]) fail('invalid_seed', 'Correction ' + co.correction_id + ': a ' + co.field + ' correction targets ' + TARGET[co.field] + '.');
    const target = co.target[TARGET[co.field]];
    const exists = co.field === 'runtime' ? idx.editions.get(target)?.title_id === t.title_id
      : co.field === 'credit' ? idx.credits.get(target)?.title_id === t.title_id
        : co.field === 'guide_item' ? items.get(target) === t.title_id : t.releases.some(r => r.region === target);
    if (!exists) fail('invalid_seed', 'Correction ' + co.correction_id + ' targets an object that is not part of ' + t.title_id + '.');
    if (!text(co.evidence, 2000)) fail('invalid_seed', 'Corrections need an evidence note.');
    checkProposed(co.field, co.target, co.proposed_value, 'invalid_seed');
    const last = co.decisions[co.decisions.length - 1];
    if ((co.status === 'approved' || co.status === 'declined') && (!last || last.decision !== co.status)) {
      fail('invalid_seed', 'Correction ' + co.correction_id + ': a decided correction keeps its decision.');
    }
    if (co.status === 'needs_info' && (!last || last.decision !== 'needs_info')) fail('invalid_seed', 'Correction ' + co.correction_id + ': needs_info comes from a decision.');
    if ((co.status === 'withdrawn') !== (co.withdrawn_at !== null)) fail('invalid_seed', 'Correction ' + co.correction_id + ': only withdrawn corrections keep withdrawn_at.');
  }
  const open = new Set();
  for (const co of data.corrections) {
    if (co.status !== 'submitted' && co.status !== 'needs_info') continue;
    const key = co.title_id + '|' + co.field + '|' + JSON.stringify(co.target);
    if (open.has(key)) fail('invalid_seed', 'Only one open correction is allowed per title, field and target.');
    open.add(key);
  }
  for (const n of data.notices) {
    if (!idx.titles.has(n.title_id) || (n.alert_id !== null && !idx.alerts.has(n.alert_id)) || (n.correction_id !== null && !idx.corrections.has(n.correction_id))) {
      fail('invalid_seed', 'Notice ' + n.notice_id + ' references an unknown title, alert or correction.');
    }
    fromListing('Notice ' + n.notice_id, n.at, n.title_id);
    if (!text(n.text, 500)) fail('invalid_seed', 'Notice text cannot be blank.');
  }
  for (let i = 1; i < data.activity.length; i++) {
    if (data.activity[i].seq <= data.activity[i - 1].seq) fail('invalid_seed', 'Activity rows must have increasing sequence numbers.');
  }
}

module.exports = {
  validateSeed, checkOffer, checkRelease, checkEpisode, checkGuideVersion, checkDiaryEntry,
  records: data => data.titles,
  objects: data => data.titles.map(t => t.title_id),
  references: () => [],
};
