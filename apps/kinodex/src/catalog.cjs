'use strict';
// Read-side helpers: lookups, the clock cutoff, clock-derived availability and alert status, spoiler
// boundaries and agent-facing views. Nothing here mutates data.
const {fail, copy} = require('./domain-utils.cjs');

const DAY = 86400000, LEAVING_MS = 7 * DAY;
const CATEGORIES = ['violence', 'language', 'sexual_content', 'frightening', 'substances'];
const CURRENCY = {US: 'USD', UK: 'GBP', CA: 'CAD'};
const REGIONS = ['US', 'UK', 'CA'];
function region(value) {
  if (!REGIONS.includes(value)) fail('not_found', 'Region ' + value + ' is not one Kinodex covers (' + REGIONS.join(', ') + ').');
  return value;
}
// Certification labels accepted per region (films and series share one list per region).
const CERTIFICATIONS = {
  US: ['G', 'PG', 'PG-13', 'R', 'NC-17', 'TV-Y', 'TV-Y7', 'TV-G', 'TV-PG', 'TV-14', 'TV-MA'],
  UK: ['U', 'PG', '12A', '12', '15', '18', 'R18'],
  CA: ['G', 'PG', '14A', '18A', 'R'],
};
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/;
const instant = value => Date.parse(value);
function isDate(value) {
  const m = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return !!m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= new Date(Date.UTC(+m[1], +m[2], 0)).getUTCDate();
}
// "Today" is the calendar date of the clock's instant in the account's IANA time zone, so the same
// instant gives the same answer however Infra spells the clock.
function dateIn(now, zone) {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(new Date(instant(now)));
  const part = type => parts.find(p => p.type === type).value;
  return part('year') + '-' + part('month') + '-' + part('day');
}
const today = (now, zone) => dateIn(now, zone);
function validZone(zone) {
  try {new Intl.DateTimeFormat('en-US', {timeZone: zone}); return true;} catch {return false;}
}
const halfStar = r => typeof r === 'number' && r >= 0.5 && r <= 5 && Number.isInteger(r * 2);

function group(list, key) {
  const map = new Map();
  for (const item of list) {
    if (!map.has(item[key])) map.set(item[key], []);
    map.get(item[key]).push(item);
  }
  return map;
}
function index(data) {
  const editions = new Map();
  for (const t of data.titles) for (const e of t.editions) editions.set(e.edition_id, {title_id: t.title_id, edition: e});
  return {
    titles: new Map(data.titles.map(t => [t.title_id, t])), editions,
    episodes: new Map(data.episodes.map(e => [e.episode_id, e])), episodesByTitle: group(data.episodes, 'title_id'),
    people: new Map(data.people.map(p => [p.person_id, p])), credits: new Map(data.credits.map(c => [c.credit_id, c])),
    creditsByTitle: group(data.credits, 'title_id'), creditsByPerson: group(data.credits, 'person_id'),
    guides: new Map(data.guides.map(g => [g.title_id, g])), services: new Map(data.services.map(s => [s.service_id, s])),
    offers: new Map(data.offers.map(o => [o.offer_id, o])), offersByTitle: group(data.offers, 'title_id'),
    diary: new Map(data.diary.map(e => [e.entry_id, e])), lists: new Map(data.lists.map(l => [l.list_id, l])),
    alerts: new Map(data.alerts.map(a => [a.alert_id, a])), corrections: new Map(data.corrections.map(c => [c.correction_id, c])),
    watch: new Set(data.watchlist.title_ids),
  };
}
function title(idx, id) {
  const found = idx.titles.get(id);
  if (!found) fail('not_found', 'Title ' + id + ' does not exist in Kinodex.');
  return found;
}
const earliestRelease = t => t.releases.reduce((min, r) => (r.date < min ? r.date : min), t.releases[0].date);
const currentGuide = g => g.versions[g.versions.length - 1];

// ---- Clock cutoff -------------------------------------------------------------------------
// What the account sees at the run clock. A record that happens in Kinodex exists from its own time:
// a diary entry from logged_at, a public review from posted_at, a list or alert from created_at, a
// correction from submitted_at, a notice from at, a season (and its episodes) from added_at, and a
// guide version after the first from published_at. Later transitions that keep their own time are read
// as of the clock: a rule triggered or deleted later reads active, and a correction shows only the
// decisions, amendment and withdrawal dated by then. Scheduled and descriptive dates (release and air
// dates, offer windows, expires_at, guide version 1) are not filtered. Nothing is stored for this:
// later records appear when the clock reaches them, and records with nothing hidden keep their identity.
const by = (nowMs, value) => instant(value) <= nowMs;
function alertAsOf(a, nowMs) {
  if (a.status === 'triggered' && !by(nowMs, a.trigger.at)) return {...a, status: 'active', trigger: null, updated_at: a.created_at};
  if (a.status === 'deleted' && !by(nowMs, a.updated_at)) return {...a, status: 'active', updated_at: a.created_at};
  return a;
}
function correctionAsOf(co, nowMs) {
  const decisions = co.decisions.filter(d => by(nowMs, d.decided_at));
  const amended = co.amended_at !== null && by(nowMs, co.amended_at), withdrawn = co.withdrawn_at !== null && by(nowMs, co.withdrawn_at);
  if (decisions.length === co.decisions.length && amended === (co.amended_at !== null) && withdrawn === (co.withdrawn_at !== null)) return co;
  const steps = [...decisions.map(d => [d.decided_at, d.decision]), ...(amended ? [[co.amended_at, 'submitted']] : []),
    ...(withdrawn ? [[co.withdrawn_at, 'withdrawn']] : [])].sort((x, y) => instant(x[0]) - instant(y[0]));
  const last = steps[steps.length - 1];
  return {...co, decisions, amended_at: amended ? co.amended_at : null, withdrawn_at: withdrawn ? co.withdrawn_at : null,
    status: last ? last[1] : 'submitted', updated_at: last ? last[0] : co.submitted_at};
}
function visible(data, now) {
  const nowMs = instant(now), shown = value => by(nowMs, value), laterSeasons = new Set();
  const titles = data.titles.map(t => {
    if (t.seasons.every(s => shown(s.added_at))) return t;
    for (const s of t.seasons) if (!shown(s.added_at)) laterSeasons.add(t.title_id + ':' + s.season_number);
    return {...t, seasons: t.seasons.filter(s => shown(s.added_at))};
  });
  const firstAndShown = (v, i) => i === 0 || shown(v.published_at);
  return {...data, titles,
    episodes: laterSeasons.size ? data.episodes.filter(e => !laterSeasons.has(e.title_id + ':' + e.season_number)) : data.episodes,
    guides: data.guides.map(g => (g.versions.every(firstAndShown) ? g : {...g, versions: g.versions.filter(firstAndShown)})),
    public_reviews: data.public_reviews.filter(r => shown(r.posted_at)),
    diary: data.diary.filter(e => shown(e.logged_at)),
    lists: data.lists.filter(l => shown(l.created_at)),
    alerts: data.alerts.filter(a => shown(a.created_at)).map(a => alertAsOf(a, nowMs)),
    corrections: data.corrections.filter(co => shown(co.submitted_at)).map(co => correctionAsOf(co, nowMs)),
    notices: data.notices.filter(n => shown(n.at))};
}

// ---- Offers -------------------------------------------------------------------------------
function availability(offer, nowMs) {
  if (nowMs < instant(offer.available_from)) return 'upcoming';
  if (offer.available_until !== null) {
    const until = instant(offer.available_until);
    if (nowMs >= until) return 'ended';
    if (until - nowMs <= LEAVING_MS) return 'leaving_soon';
  }
  return 'available';
}
const isCurrent = state => state === 'available' || state === 'leaving_soon';
const mine = (data, o) => o.region === data.account.region && data.account.service_ids.includes(o.service_id);
// Subscription offers on subscribed services in the account's region. Back-to-back windows count as
// continuous, so a title is "leaving" only when that coverage ends within seven days.
function mySubscriptions(idx, data, titleId, nowMs) {
  const own = (idx.offersByTitle.get(titleId) || []).filter(o => o.type === 'subscription' && mine(data, o) && availability(o, nowMs) !== 'ended');
  const live = own.filter(o => isCurrent(availability(o, nowMs)));
  if (!live.length) {
    const next = own.slice().sort((a, b) => instant(a.available_from) - instant(b.available_from))[0];
    return next ? {status: 'upcoming', available_until: null, service_ids: [...new Set(own.map(o => o.service_id))], next_available_from: next.available_from}
      : {status: 'none', available_until: null, service_ids: [], next_available_from: null};
  }
  let t = nowMs, end = null;
  for (let guard = 0; guard < 1000; guard++) {
    let best = null, bestOffer = null;
    for (const o of own) {
      const from = instant(o.available_from), until = o.available_until === null ? Infinity : instant(o.available_until);
      if (from <= t && until > t && (best === null || until > best)) {best = until; bestOffer = o;}
    }
    if (best === null) break;
    if (best === Infinity) {end = null; t = Infinity; break;}
    t = best; end = bestOffer.available_until;
  }
  return {status: t === Infinity || t - nowMs > LEAVING_MS ? 'available' : 'leaving_soon', available_until: t === Infinity ? null : end,
    service_ids: [...new Set(live.map(o => o.service_id))], next_available_from: null};
}
function offerView(idx, data, o, nowMs) {
  return {...copy(o), service_name: idx.services.get(o.service_id).name, availability: availability(o, nowMs), on_my_services: mine(data, o)};
}

// ---- Alerts -------------------------------------------------------------------------------
// expired = the clock reached expires_at while the rule was still active (no trigger was recorded).
function alertStatus(alert, nowMs) {
  return alert.status === 'active' && alert.expires_at !== null && nowMs >= instant(alert.expires_at) ? 'expired' : alert.status;
}
function alertView(idx, a, nowMs) {
  return {...copy(a), status: alertStatus(a, nowMs), title_name: idx.titles.get(a.title_id).name};
}

// ---- Spoilers -----------------------------------------------------------------------------
// The furthest episode a person has seen: the owner's whole diary, or for anyone else the owner's
// entries whose watched_with includes them (other household members keep no diary of their own).
function spoilerPerson(data, args) {
  const person = args.as_of_person;
  if (person === undefined || person === data.owner_person_id) return data.owner_person_id;
  if (!data.diary.some(e => e.watched_with.includes(person))) {
    fail('not_found', 'as_of_person must be the account owner or someone in this diary\'s watched_with history.');
  }
  return person;
}
const later = (a, b) => a.season_number > b.season_number || (a.season_number === b.season_number && a.number > b.number);
function boundary(idx, data, titleId, personId) {
  let best = null;
  for (const e of data.diary) {
    if (e.title_id !== titleId || (personId !== data.owner_person_id && !e.watched_with.includes(personId))) continue;
    for (const id of e.episode_ids) {const ep = idx.episodes.get(id); if (!best || later(ep, best)) best = ep;}
  }
  return {person_id: personId, furthest_episode: best && {episode_id: best.episode_id, season_number: best.season_number, number: best.number}};
}
function episodeView(ep, hide, b) {
  const withheld = hide && (!b.furthest_episode || later(ep, b.furthest_episode));
  return {episode_id: ep.episode_id, season_number: ep.season_number, number: ep.number, name: ep.name, air_date: ep.air_date,
    runtime_minutes: ep.runtime_minutes, synopsis: withheld ? null : ep.synopsis, synopsis_withheld: withheld};
}
const byEpisode = (a, b) => a.season_number - b.season_number || a.number - b.number;
function guideView(idx, titleId, version, hide) {
  const g = idx.guides.get(titleId), cur = currentGuide(g);
  const v = version === undefined ? cur : g.versions.find(x => x.version === version);
  if (!v) fail('not_found', 'Guide version ' + version + ' does not exist for ' + titleId + '.');
  const categories = {};
  for (const c of CATEGORIES) {
    const cat = v.categories[c], items = hide ? cat.items.filter(i => !i.spoiler) : cat.items;
    categories[c] = {severity: cat.severity, summary: cat.summary, items: copy(items), withheld_items: cat.items.length - items.length};
  }
  return {title_id: titleId, version: v.version, reason: v.reason, published_at: v.published_at, current_version: cur.version, spoilers_hidden: !!hide,
    categories, versions: g.versions.map(x => ({version: x.version, reason: x.reason, published_at: x.published_at}))};
}

// ---- Titles and search --------------------------------------------------------------------
function summary(idx, data, t) {
  const release = t.releases.find(r => r.region === data.account.region);
  return {title_id: t.title_id, kind: t.kind, name: t.name, year: t.year, genres: copy(t.genres),
    certification: release ? release.certification : null, on_watchlist: idx.watch.has(t.title_id)};
}
const fold = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const words = value => fold(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
function matches(t, terms) {
  if (!terms.length) return true;
  const w = words([t.name, t.synopsis, ...t.genres].join(' '));
  return terms.every(term => w.some(x => x.startsWith(term)));
}
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.title_id < b.title_id ? -1 : 1);
const listItem = (t, position) => ({position, title_id: t.title_id, name: t.name, kind: t.kind, year: t.year});
function diaryView(idx, e) {
  return {entry_id: e.entry_id, title_id: e.title_id, title_name: idx.titles.get(e.title_id).name,
    episodes: e.episode_ids.map(id => {const ep = idx.episodes.get(id); return {episode_id: id, season_number: ep.season_number, number: ep.number};}),
    edition_id: e.edition_id, watched_on: e.watched_on, rewatch: e.rewatch, watched_with: copy(e.watched_with), rating: e.rating,
    review: copy(e.review), logged_at: e.logged_at, updated_at: e.updated_at};
}
// Agent writes in one session share the virtual time, so ties keep insertion order (latest first).
const latestFirst = (list, key) => list.map((x, i) => [x, i]).sort(([a, ia], [b, ib]) =>
  (a[key] < b[key] ? 1 : a[key] > b[key] ? -1 : 0) || ib - ia).map(([x]) => x);
const latestInstantFirst = (list, key) => list.map((x, i) => [x, i]).sort(([a, ia], [b, ib]) =>
  instant(b[key]) - instant(a[key]) || ib - ia).map(([x]) => x);

module.exports = {DAY, LEAVING_MS, CATEGORIES, CURRENCY, REGIONS, region, CERTIFICATIONS, ID, instant, isDate, today, validZone, halfStar, index, title, earliestRelease,
  currentGuide, alertAsOf, correctionAsOf, visible, availability, isCurrent, mine, mySubscriptions, offerView, alertStatus, alertView, spoilerPerson, boundary, episodeView,
  byEpisode, guideView, summary, fold, words, matches, byName, listItem, diaryView, latestFirst, latestInstantFirst, later};
