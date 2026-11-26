'use strict';
// Infra-applied events: offer.publish, offer.end, title.update and correction.decision. Core deduplicates
// event IDs, rejects a reused ID with different content and rolls back failures (data and clock).
// During applyEvent, ctx.virtual_now equals event.at. A missing target fails with target_not_found;
// any other inconsistency fails with invalid_event, checked here before Core's re-validation.
// Targets and rule evaluation use the records that exist at the event time (catalog.visible);
// consistency checks (season and episode numbers, guide version order, diary dates against release
// dates) use every stored record, so an event that collides with a later seeded record is invalid_event.
const {fail, copy} = require('./domain-utils.cjs');
const {log} = require('./diagnostics.cjs');
const c = require('./catalog.cjs');
const r = require('./rules.cjs');
const m = require('./model.cjs');

const SUBJECT = {'offer.publish': 'offer', 'offer.end': 'offer', 'title.update': 'title', 'correction.decision': 'correction'};

// After an event changes a title's offers, seasons or details, its active, unexpired rules are
// evaluated at the event time; each match becomes triggered with one notice.
function fireRules(ctx, data, event, titleId, seq) {
  const fired = r.evaluate(ctx, data, a => a.title_id === titleId, {event_id: event.event_id, operation: event.operation});
  const idx = c.index(data), notices = [];
  for (const f of fired) {
    f.alert.trigger.notice_id = r.notice(ctx, data, seq, {kind: 'alert_triggered', title_id: titleId, alert_id: f.alert.alert_id,
      event_id: event.event_id, text: r.noticeText(idx, f.alert, f.offer, f.season)});
    notices.push(f.alert.trigger.notice_id);
  }
  return {alert_ids: fired.map(f => f.alert.alert_id), notice_ids: notices};
}

function offerPublish(ctx, data, event) {
  const p = event.payload, idx = c.index(data);
  if (!idx.titles.has(p.title_id)) fail('target_not_found', 'Title ' + p.title_id + ' does not exist.');
  const prior = idx.offers.get(p.offer_id);
  if (prior && prior.title_id !== p.title_id) fail('invalid_event', 'Offer ' + p.offer_id + ' belongs to another title.');
  const offer = {offer_id: p.offer_id, title_id: p.title_id, edition_id: p.edition_id ?? null, service_id: p.service_id, region: p.region, type: p.type,
    price: p.price ?? null, currency: p.currency ?? null, quality: p.quality, available_from: p.available_from, available_until: p.available_until ?? null};
  m.checkOffer(idx, offer, 'invalid_event');
  const before = prior ? copy(prior) : null;
  if (prior) Object.assign(prior, offer); else data.offers.push(offer);
  return {object_id: offer.offer_id, title_id: offer.title_id, replaced: before};
}

function offerEnd(ctx, data, event) {
  const idx = c.index(data), o = idx.offers.get(event.payload.offer_id);
  if (!o) fail('target_not_found', 'Offer ' + event.payload.offer_id + ' does not exist.');
  const state = c.availability(o, c.instant(event.at));
  if (state === 'ended') fail('invalid_event', 'Offer ' + o.offer_id + ' has already ended.');
  if (state === 'upcoming') fail('invalid_event', 'Offer ' + o.offer_id + ' has not started; change its window with offer.publish instead.');
  const before = copy(o);
  o.available_until = event.at;
  return {object_id: o.offer_id, title_id: o.title_id, replaced: before};
}

function titleUpdate(ctx, data, event) {
  const p = event.payload, idx = c.index(data), t = idx.titles.get(p.title_id);
  if (!t) fail('target_not_found', 'Title ' + p.title_id + ' does not exist.');
  if (!p.add_seasons && !p.add_episodes && !p.release_dates && !p.guide_version) fail('invalid_event', 'title.update needs at least one change.');
  const before = {seasons: copy(t.seasons), releases: copy(t.releases), episode_count: (idx.episodesByTitle.get(t.title_id) || []).length,
    guide_version: c.currentGuide(idx.guides.get(t.title_id)).version};
  const seasons = new Set(t.seasons.map(s => s.season_number));
  const numbers = new Set((idx.episodesByTitle.get(t.title_id) || []).map(e => e.season_number + ':' + e.number));
  const ids = new Set(idx.episodes.keys());
  const addEpisode = ep => {
    if (ids.has(ep.episode_id) || !c.ID.test(ep.episode_id)) fail('invalid_event', 'Episode ' + ep.episode_id + ' already exists or is malformed.');
    m.checkEpisode(t, ep, seasons, numbers, 'invalid_event');
    ids.add(ep.episode_id); data.episodes.push(ep);
  };
  for (const s of p.add_seasons || []) {
    if (t.kind !== 'series') fail('invalid_event', t.name + ' is a film and has no seasons.');
    if (seasons.has(s.season_number)) fail('invalid_event', t.name + ' already has season ' + s.season_number + '.');
    seasons.add(s.season_number);
    t.seasons.push({season_number: s.season_number, name: s.name, added_at: event.at});
    for (const ep of s.episodes) addEpisode({episode_id: ep.episode_id, title_id: t.title_id, season_number: s.season_number, number: ep.number,
      name: ep.name, synopsis: ep.synopsis, air_date: ep.air_date, runtime_minutes: ep.runtime_minutes});
  }
  for (const ep of p.add_episodes || []) addEpisode({episode_id: ep.episode_id, title_id: t.title_id, season_number: ep.season_number, number: ep.number,
    name: ep.name, synopsis: ep.synopsis, air_date: ep.air_date, runtime_minutes: ep.runtime_minutes});
  for (const rd of p.release_dates || []) {
    const existing = t.releases.find(x => x.region === rd.region);
    const release = {region: rd.region, date: rd.date, certification: rd.certification ?? existing?.certification};
    if (release.certification === undefined) fail('invalid_event', 'A new release region needs a certification.');
    m.checkRelease(t, release, 'invalid_event');
    if (existing) Object.assign(existing, release); else t.releases.push(release);
  }
  if (p.release_dates && data.diary.some(e => e.title_id === t.title_id && e.watched_on < c.earliestRelease(t))) {
    fail('invalid_event', 'The new release dates would place diary entries before ' + t.name + '\'s release.');
  }
  let guideVersion = null;
  if (p.guide_version) {
    const g = idx.guides.get(t.title_id), cur = c.currentGuide(g), next = {version: p.guide_version.version, reason: p.guide_version.reason,
      published_at: event.at, categories: copy(cur.categories)};
    for (const [name, delta] of Object.entries(p.guide_version.categories)) {
      const cat = next.categories[name];
      if (delta.severity !== undefined) cat.severity = delta.severity;
      if (delta.summary !== undefined) cat.summary = delta.summary;
      for (const id of delta.remove_items || []) {
        if (!cat.items.some(i => i.item_id === id)) fail('invalid_event', 'Guide item ' + id + ' is not in ' + name + '.');
        cat.items = cat.items.filter(i => i.item_id !== id);
      }
      cat.items.push(...copy(delta.add_items || []));
    }
    const items = new Map();
    for (const guide of data.guides) for (const v of guide.versions) for (const n of c.CATEGORIES) for (const i of v.categories[n].items) items.set(i.item_id, guide.title_id);
    m.checkGuideVersion(t.title_id, next, cur, items, 'invalid_event');
    g.versions.push(next);
    guideVersion = next.version;
  }
  return {object_id: t.title_id, title_id: t.title_id, replaced: before, guideVersion};
}

function correctionDecision(ctx, data, event) {
  const p = event.payload, ref = p.correction_ref, idx = c.index(data);
  // The full key is {title_id, field, target}. The approved proposal's example omits target; that
  // short form is accepted only when exactly one open correction matches the title and field.
  // Only corrections submitted by the event time count, each in its state as of then.
  const open = c.visible(data, event.at).corrections.filter(co => r.isOpen(co) && co.title_id === ref.title_id && co.field === ref.field
    && (ref.target === undefined || r.sameTarget(co.target, ref.target)));
  if (!open.length) fail('target_not_found', 'No open ' + ref.field + ' correction matches ' + JSON.stringify(ref) + '.');
  if (open.length > 1) fail('target_not_found', open.length + ' open ' + ref.field + ' corrections match ' + ref.title_id + '; name the target to choose one.');
  // A correction that the seed decides after the event time loses those later decisions (see rules.adopt).
  const before = copy(open[0]), co = r.adopt(data, 'corrections', 'correction_id', open[0], c.instant(event.at));
  if (p.decision === 'needs_info' && (co.status === 'needs_info' || co.amended_at !== null)) {
    fail('invalid_event', 'Correction ' + co.correction_id + ' already ' + (co.status === 'needs_info' ? 'awaits information' : 'used its one amendment') + '; decide approved or declined.');
  }
  let guideVersion = null;
  if (p.decision === 'approved') {
    r.currentValue(idx, co.title_id, co.field, co.target, 'target_not_found');
    r.checkProposed(co.field, co.target, co.proposed_value, 'invalid_event');
    guideVersion = r.applyCorrection(ctx, data, idx, co);
  }
  co.status = p.decision; co.updated_at = event.at;
  co.decisions.push({decision: p.decision, note: p.note ?? null, decided_at: event.at, event_id: event.event_id});
  return {object_id: co.correction_id, title_id: co.title_id, replaced: before, correction: co, guideVersion};
}

const FIELD_LABEL = {runtime: 'runtime', release_date: 'release date', certification: 'certification', credit: 'credit', guide_item: 'parental guide'};
function applyEvent(ctx, data, event) {
  const handler = {'offer.publish': offerPublish, 'offer.end': offerEnd, 'title.update': titleUpdate, 'correction.decision': correctionDecision}[event.operation];
  if (!handler) fail('invalid_event', 'Unsupported operation.');
  const seq = r.nextSeq(data), done = handler(ctx, data, event), idx = c.index(data);
  let effects = {alert_ids: [], notice_ids: []};
  if (event.operation === 'correction.decision') {
    const co = done.correction, target = Object.values(co.target)[0], t = idx.titles.get(co.title_id).name;
    const what = {approved: 'was approved', declined: 'was declined', needs_info: 'needs more information'}[co.status];
    const text = 'Your ' + FIELD_LABEL[co.field] + ' correction for ' + t + ' (' + target + ') ' + what + (event.payload.note ? ': ' + event.payload.note : '.')
      + (done.guideVersion ? ' The parental guide is now at version ' + done.guideVersion + '.' : '');
    effects.notice_ids.push(r.notice(ctx, data, seq, {kind: 'correction_decided', title_id: co.title_id, correction_id: co.correction_id,
      guide_version: done.guideVersion, event_id: event.event_id, text: text.length > 500 ? text.slice(0, 497) + '...' : text}));
  }
  // A new guide version for a watchlist title gets its own notice, whether published or from an approved correction.
  if (done.guideVersion && idx.watch.has(done.title_id)) {
    effects.notice_ids.push(r.notice(ctx, data, seq, {kind: 'guide_updated', title_id: done.title_id, guide_version: done.guideVersion, event_id: event.event_id,
      text: 'The parental guide for ' + idx.titles.get(done.title_id).name + ' was updated to version ' + done.guideVersion + '.'}));
  }
  if (event.operation !== 'correction.decision') {
    const fired = fireRules(ctx, data, event, done.title_id, seq);
    effects = {alert_ids: fired.alert_ids, notice_ids: [...effects.notice_ids, ...fired.notice_ids]};
  }
  r.record(ctx, data, {action: event.operation, event_id: event.event_id, object_type: SUBJECT[event.operation], object_id: done.object_id,
    replaced: done.replaced, ...effects});
  log(ctx, 'kinodex.event.' + event.operation, {event_id: event.event_id, object_id: done.object_id, alerts: effects.alert_ids.length, notices: effects.notice_ids.length});
  return data;
}

module.exports = {applyEvent};
