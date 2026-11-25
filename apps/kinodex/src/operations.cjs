'use strict';
// Agent business tools. Reads return derived views of the unchanged working copy (status, availability
// and spoiler boundaries come from ctx.virtual_now and the diary at read time). Writes validate first
// and then change only the bound account's state, adding one activity row each.
const {fail, copy, text} = require('./domain-utils.cjs');
const {log} = require('./diagnostics.cjs');
const c = require('./catalog.cjs');
const r = require('./rules.cjs');
const {checkDiaryEntry} = require('./model.cjs');

const WRITE_CODES = {missing: 'not_found', date: 'invalid_date', rating: 'invalid_rating', args: 'invalid_arguments'};
const limit = (list, n, d) => list.slice(0, n ?? d);

function read(ctx, data, name, args) {
  const idx = c.index(data), nowMs = c.instant(ctx.virtual_now);
  switch (name) {
    case 'kinodex.titles.search': {
      const terms = c.words(args.query || '');
      const found = data.titles.filter(t => (args.kind === undefined || t.kind === args.kind)
        && (args.genre === undefined || t.genres.some(g => c.fold(g) === c.fold(args.genre)))
        && (args.year_from === undefined || t.year >= args.year_from) && (args.year_to === undefined || t.year <= args.year_to)
        && (args.on_watchlist === undefined || idx.watch.has(t.title_id) === args.on_watchlist) && c.matches(t, terms)).sort(c.byName);
      return {total: found.length, titles: limit(found, args.limit, 20).map(t => c.summary(idx, data, t))};
    }
    case 'kinodex.titles.get':
    case 'kinodex.episodes.list': {
      const t = c.title(idx, args.title_id);
      const hide = args.hide_spoilers === true, person = c.spoilerPerson(data, args);
      const b = t.kind === 'series' && (hide || args.as_of_person !== undefined) ? c.boundary(idx, data, t.title_id, person) : null;
      let eps = (idx.episodesByTitle.get(t.title_id) || []).slice().sort(c.byEpisode);
      if (name === 'kinodex.episodes.list') {
        if (t.kind !== 'series') fail('not_found', t.name + ' is a film and has no episodes.');
        if (args.season_number !== undefined) {
          if (!t.seasons.some(s => s.season_number === args.season_number)) fail('not_found', t.name + ' has no season ' + args.season_number + '.');
          eps = eps.filter(e => e.season_number === args.season_number);
        }
        return {title_id: t.title_id, spoiler_boundary: b, episodes: eps.map(e => c.episodeView(e, hide, b || {furthest_episode: null}))};
      }
      return {title: {...c.summary(idx, data, t), synopsis: t.synopsis, editions: copy(t.editions), releases: copy(t.releases),
        seasons: t.seasons.map(s => ({season_number: s.season_number, name: s.name, episode_count: eps.filter(e => e.season_number === s.season_number).length})),
        guide: c.guideView(idx, t.title_id, undefined, hide), episodes: eps.map(e => c.episodeView(e, hide, b || {furthest_episode: null})), spoiler_boundary: b}};
    }
    case 'kinodex.people.get': {
      const p = idx.people.get(args.person_id);
      if (!p) fail('not_found', 'Person ' + args.person_id + ' does not exist in Kinodex.');
      const credits = (idx.creditsByPerson.get(p.person_id) || []).map(cr => ({credit_id: cr.credit_id, title_id: cr.title_id,
        title_name: idx.titles.get(cr.title_id).name, year: idx.titles.get(cr.title_id).year, role: cr.role, character: cr.character, billing_order: cr.billing_order}))
        .sort((a, b) => b.year - a.year || (a.title_name < b.title_name ? -1 : 1));
      return {person: copy(p), credits};
    }
    case 'kinodex.credits.list': {
      const t = c.title(idx, args.title_id);
      return {title_id: t.title_id, credits: (idx.creditsByTitle.get(t.title_id) || []).filter(cr => args.role === undefined || cr.role === args.role)
        .slice().sort((a, b) => a.billing_order - b.billing_order).map(cr => ({credit_id: cr.credit_id, person_id: cr.person_id,
          person_name: idx.people.get(cr.person_id).name, role: cr.role, character: cr.character, billing_order: cr.billing_order}))};
    }
    case 'kinodex.guide.get':
      c.title(idx, args.title_id);
      return {guide: c.guideView(idx, args.title_id, args.version, args.hide_spoilers === true)};
    case 'kinodex.offers.search': {
      if (args.region !== undefined) c.region(args.region);
      const mineOnly = args.on_my_services === true, region = mineOnly ? data.account.region : (args.region ?? data.account.region);
      if (mineOnly && args.region !== undefined && args.region !== region) fail('invalid_arguments', 'on_my_services always uses the account\'s region (' + region + ').');
      const states = args.availability ?? ['upcoming', 'available', 'leaving_soon'];
      let list;
      if (args.title_ids) list = args.title_ids.map(id => c.title(idx, id));
      else {const terms = c.words(args.query || ''); list = data.titles.filter(t => c.matches(t, terms)).sort(c.byName);}
      const results = [];
      for (const t of list) {
        const offers = (idx.offersByTitle.get(t.title_id) || []).filter(o => o.region === region && (!mineOnly || c.mine(data, o))
          && (args.types === undefined || args.types.includes(o.type)) && states.includes(c.availability(o, nowMs)));
        if (!args.title_ids && !offers.length) continue;
        results.push({title_id: t.title_id, name: t.name, kind: t.kind, my_subscriptions: c.mySubscriptions(idx, data, t.title_id, nowMs),
          offers: offers.map(o => c.offerView(idx, data, o, nowMs))});
      }
      return {region, on_my_services: mineOnly, as_of: ctx.virtual_now, total: results.length, results: limit(results, args.limit, args.title_ids ? results.length : 50)};
    }
    case 'kinodex.offers.for_title': {
      const t = c.title(idx, args.title_id);
      if (args.region !== undefined) c.region(args.region);
      const offers = (idx.offersByTitle.get(t.title_id) || []).filter(o => (args.region === undefined || o.region === args.region)
        && (args.include_ended === true || c.availability(o, nowMs) !== 'ended'));
      return {region: data.account.region, as_of: ctx.virtual_now, result: {title_id: t.title_id, name: t.name, kind: t.kind,
        my_subscriptions: c.mySubscriptions(idx, data, t.title_id, nowMs), offers: offers.map(o => c.offerView(idx, data, o, nowMs))}};
    }
    case 'kinodex.services.list':
      return {services: data.services.map(s => ({...copy(s), subscribed: data.account.service_ids.includes(s.service_id)}))};
    case 'kinodex.account.get': {
      const counts = new Map();
      for (const e of data.diary) for (const p of e.watched_with) counts.set(p, (counts.get(p) || 0) + 1);
      const name = id => ctx.binding.people.find(p => p.person_id === id)?.name ?? null;
      // time_zone is seed data used for "today"; the approved tool output does not include it.
      const {time_zone, ...account} = copy(data.account);
      return {account: {account_id: data.account_id, owner_person_id: data.owner_person_id, ...account},
        people: [{person_id: data.owner_person_id, name: name(data.owner_person_id), owner: true, diary_entries: data.diary.length},
          ...[...counts].map(([person_id, n]) => ({person_id, name: name(person_id), owner: false, diary_entries: n}))]};
    }
    case 'kinodex.watchlist.get':
      return {watchlist_version: data.watchlist.version, updated_at: data.watchlist.updated_at,
        items: data.watchlist.title_ids.map((id, i) => c.listItem(idx.titles.get(id), i + 1))};
    case 'kinodex.diary.list': {
      if (args.title_id !== undefined) c.title(idx, args.title_id);
      const entries = c.latestFirst(data.diary, 'watched_on').filter(e => (args.title_id === undefined || e.title_id === args.title_id)
        && (args.from === undefined || e.watched_on >= args.from) && (args.to === undefined || e.watched_on <= args.to)
        && (args.with_person === undefined || e.watched_with.includes(args.with_person)));
      return {total: entries.length, entries: limit(entries, args.limit, 50).map(e => c.diaryView(idx, e))};
    }
    case 'kinodex.lists.list':
      return {lists: data.lists.map(l => ({list_id: l.list_id, name: l.name, description: l.description, visibility: l.visibility,
        list_version: l.version, count: l.title_ids.length, updated_at: l.updated_at}))};
    case 'kinodex.lists.get': {
      const l = idx.lists.get(args.list_id);
      if (!l) fail('not_found', 'List ' + args.list_id + ' does not exist.');
      return {list: {list_id: l.list_id, name: l.name, description: l.description, visibility: l.visibility, list_version: l.version,
        created_at: l.created_at, updated_at: l.updated_at, items: l.title_ids.map((id, i) => c.listItem(idx.titles.get(id), i + 1))}};
    }
    case 'kinodex.reviews.list': {
      if (args.title_id !== undefined) c.title(idx, args.title_id);
      const source = args.source ?? 'all', hide = args.hide_spoilers === true, owner = ctx.binding.people.find(p => p.person_id === data.owner_person_id)?.name;
      const rows = [];
      if (source !== 'public') for (const e of data.diary) if (e.review) rows.push({review_id: e.entry_id, source: 'mine', title_id: e.title_id, author: owner || data.owner_person_id,
        rating: e.rating, contains_spoilers: e.review.contains_spoilers, text: e.review.text, visibility: e.review.visibility, posted_at: e.logged_at});
      if (source !== 'mine') for (const p of data.public_reviews) rows.push({review_id: p.review_id, source: 'public', title_id: p.title_id, author: p.author,
        rating: p.rating, contains_spoilers: p.contains_spoilers, text: p.text, visibility: 'public', posted_at: p.posted_at});
      const shown = c.latestInstantFirst(rows.filter(x => args.title_id === undefined || x.title_id === args.title_id), 'posted_at');
      return {reviews: limit(shown, args.limit, 50).map(x => ({...x, title_name: idx.titles.get(x.title_id).name,
        text: hide && x.contains_spoilers ? null : x.text, text_withheld: hide && x.contains_spoilers}))};
    }
    case 'kinodex.alerts.list':
      if (args.title_id !== undefined) c.title(idx, args.title_id);
      return {alerts: c.latestInstantFirst(data.alerts, 'created_at').map(a => c.alertView(idx, a, nowMs))
        .filter(a => (args.status === undefined || a.status === args.status) && (args.title_id === undefined || a.title_id === args.title_id))};
    case 'kinodex.corrections.list':
      if (args.title_id !== undefined) c.title(idx, args.title_id);
      return {corrections: c.latestInstantFirst(data.corrections, 'submitted_at')
        .filter(co => (args.status === undefined || co.status === args.status) && (args.title_id === undefined || co.title_id === args.title_id))
        .map(co => ({...copy(co), title_name: idx.titles.get(co.title_id).name}))};
    case 'kinodex.notices.list':
      return {notices: limit(c.latestInstantFirst(data.notices, 'at').filter(n => (args.since === undefined || c.instant(n.at) >= c.instant(args.since))
        && (args.kind === undefined || n.kind === args.kind)), args.limit, 50).map(n => copy(n))};
    default:
      return null;
  }
}

// ---- Writes -------------------------------------------------------------------------------
function objectVersion(expected, actual, label) {
  if (expected !== undefined && expected !== actual) {
    fail('object_version_conflict', 'The ' + label + ' is at version ' + actual + ', not ' + expected + '; read it again before replacing it.');
  }
}
function titlesExist(idx, ids) {for (const id of ids) c.title(idx, id);}
function diaryEntry(ctx, data, idx, entry) {
  checkDiaryEntry(idx, data, ctx.binding, entry, WRITE_CODES);
  const day = c.today(ctx.virtual_now, data.account.time_zone);
  if (entry.watched_on > day) fail('invalid_date', 'watched_on (' + entry.watched_on + ') is after today (' + day + ' in ' + data.account.time_zone + ').');
}
function alertById(data, id) {
  const a = data.alerts.find(x => x.alert_id === id);
  if (!a) fail('not_found', 'Alert ' + id + ' does not exist.');
  return a;
}
function correctionById(data, id) {
  const co = data.corrections.find(x => x.correction_id === id);
  if (!co) fail('not_found', 'Correction ' + id + ' does not exist.');
  return co;
}

function write(ctx, data, name, args) {
  const idx = c.index(data), now = ctx.virtual_now, nowMs = c.instant(now), seq = r.nextSeq(data), req = {request_id: args.request_id};
  switch (name) {
    case 'kinodex.services.update': {
      const patch = args.patch, before = {region: data.account.region, service_ids: copy(data.account.service_ids), settings_version: data.account.settings_version};
      objectVersion(args.expected_settings_version, data.account.settings_version, 'account settings');
      if (patch.region !== undefined) c.region(patch.region);
      for (const id of patch.service_ids || []) if (!idx.services.has(id)) fail('not_found', 'Service ' + id + ' does not exist in Kinodex.');
      const region = patch.region ?? data.account.region, services = patch.service_ids ?? data.account.service_ids;
      const sameServices = services.length === data.account.service_ids.length && services.every(id => data.account.service_ids.includes(id));
      if (region === data.account.region && sameServices) fail('no_change', 'The region and services are already set to these values (order does not matter).');
      data.account.region = region; data.account.service_ids = copy(services);
      data.account.settings_version++; data.account.updated_at = now;
      // Re-check rules that depend on the account in the same write; no notice for the agent's own write.
      const fired = r.evaluate(ctx, data, a => a.kind !== 'new_season', req);
      r.record(ctx, data, {action: name, ...req, object_type: 'account', object_id: data.account_id, replaced: before, alert_ids: fired.map(f => f.alert.alert_id)});
      log(ctx, name, {settings_version: data.account.settings_version, triggered: fired.length});
      return {data, result: {id: data.account_id, settings_version: data.account.settings_version, region, service_ids: copy(services),
        triggered_alerts: fired.map(f => ({alert_id: f.alert.alert_id, title_id: f.alert.title_id, offer_id: f.offer.offer_id}))}};
    }
    case 'kinodex.watchlist.save': {
      objectVersion(args.expected_watchlist_version, data.watchlist.version, 'watchlist');
      titlesExist(idx, args.title_ids);
      if (JSON.stringify(args.title_ids) === JSON.stringify(data.watchlist.title_ids)) fail('no_change', 'The watchlist already has these titles in this order.');
      const before = copy(data.watchlist);
      data.watchlist = {version: data.watchlist.version + 1, title_ids: copy(args.title_ids), updated_at: now};
      r.record(ctx, data, {action: name, ...req, object_type: 'watchlist', object_id: 'watchlist', replaced: before});
      log(ctx, name, {watchlist_version: data.watchlist.version, count: args.title_ids.length});
      return {data, result: {id: 'watchlist', watchlist_version: data.watchlist.version, count: args.title_ids.length}};
    }
    case 'kinodex.diary.log': {
      const entry = {entry_id: r.newId('diary', seq, idx.diary), title_id: args.title_id, episode_ids: copy(args.episode_ids || []), edition_id: args.edition_id ?? null,
        watched_on: args.watched_on, rewatch: args.rewatch === true, watched_with: copy(args.watched_with || []), rating: args.rating ?? null,
        review: copy(args.review ?? null), logged_at: now, updated_at: now};
      diaryEntry(ctx, data, idx, entry);
      data.diary.push(entry);
      r.record(ctx, data, {action: name, ...req, object_type: 'diary_entry', object_id: entry.entry_id});
      log(ctx, name, {entry_id: entry.entry_id, episodes: entry.episode_ids.length});
      return {data, result: {id: entry.entry_id, entry: c.diaryView(idx, entry)}};
    }
    case 'kinodex.diary.update': {
      const entry = idx.diary.get(args.id);
      if (!entry) fail('not_found', 'Diary entry ' + args.id + ' does not exist.');
      if (nowMs < c.instant(entry.logged_at)) fail('invalid_date', 'The clock (' + now + ') is earlier than when this entry was logged (' + entry.logged_at + '); load history at or after its latest record.');
      const next = {...copy(entry), ...copy(args.patch)}, changed = Object.keys(args.patch).filter(k => JSON.stringify(args.patch[k]) !== JSON.stringify(entry[k]));
      if (!changed.length) fail('no_change', 'The patch matches the entry as it is.');
      diaryEntry(ctx, data, idx, next);
      const before = copy(entry);
      Object.assign(entry, copy(args.patch)); entry.updated_at = now;
      r.record(ctx, data, {action: name, ...req, object_type: 'diary_entry', object_id: entry.entry_id, replaced: before});
      log(ctx, name, {entry_id: entry.entry_id, changed_fields: changed});
      return {data, result: {id: entry.entry_id, changed_fields: changed, entry: c.diaryView(idx, entry)}};
    }
    case 'kinodex.diary.delete': {
      const entry = idx.diary.get(args.id);
      if (!entry) fail('not_found', 'Diary entry ' + args.id + ' does not exist.');
      data.diary = data.diary.filter(e => e.entry_id !== args.id);
      r.record(ctx, data, {action: name, ...req, object_type: 'diary_entry', object_id: entry.entry_id, replaced: entry});
      log(ctx, name, {entry_id: entry.entry_id});
      return {data, result: {id: entry.entry_id, removed: {title_id: entry.title_id, episode_ids: copy(entry.episode_ids), watched_on: entry.watched_on,
        rating: entry.rating, review: copy(entry.review)}}};
    }
    case 'kinodex.lists.create': {
      if (!text(args.name, 120)) fail('invalid_arguments', 'List names cannot be blank.');
      titlesExist(idx, args.title_ids || []);
      const list = {list_id: r.newId('list', seq, idx.lists), name: args.name, description: args.description ?? '', visibility: args.visibility ?? 'private',
        version: 1, title_ids: copy(args.title_ids || []), created_at: now, updated_at: now};
      data.lists.push(list);
      r.record(ctx, data, {action: name, ...req, object_type: 'list', object_id: list.list_id});
      log(ctx, name, {list_id: list.list_id, count: list.title_ids.length});
      return {data, result: {id: list.list_id, list_version: 1}};
    }
    case 'kinodex.lists.save': {
      const list = idx.lists.get(args.id);
      if (!list) fail('not_found', 'List ' + args.id + ' does not exist.');
      objectVersion(args.expected_list_version, list.version, 'list');
      if (args.patch.name !== undefined && !text(args.patch.name, 120)) fail('invalid_arguments', 'List names cannot be blank.');
      titlesExist(idx, args.patch.title_ids || []);
      const changed = Object.keys(args.patch).filter(k => JSON.stringify(args.patch[k]) !== JSON.stringify(list[k]));
      if (!changed.length) fail('no_change', 'The patch matches the list as it is.');
      const before = copy(list);
      Object.assign(list, copy(args.patch)); list.version++; list.updated_at = now;
      r.record(ctx, data, {action: name, ...req, object_type: 'list', object_id: list.list_id, replaced: before});
      log(ctx, name, {list_id: list.list_id, list_version: list.version, changed_fields: changed});
      return {data, result: {id: list.list_id, list_version: list.version, changed_fields: changed}};
    }
    case 'kinodex.lists.delete': {
      const list = idx.lists.get(args.id);
      if (!list) fail('not_found', 'List ' + args.id + ' does not exist.');
      data.lists = data.lists.filter(l => l.list_id !== args.id);
      r.record(ctx, data, {action: name, ...req, object_type: 'list', object_id: list.list_id, replaced: list});
      log(ctx, name, {list_id: list.list_id});
      return {data, result: {id: list.list_id, deleted: true}};
    }
    case 'kinodex.alerts.create': {
      const t = c.title(idx, args.title_id);
      if (args.kind === 'new_season' && t.kind !== 'series') fail('invalid_arguments', 'new_season rules need a series; ' + t.name + ' is a film.');
      const rule = {alert_id: r.newId('alert', seq, idx.alerts), kind: args.kind, title_id: t.title_id, offer_type: args.offer_type ?? null,
        threshold: args.threshold ?? null, expires_at: args.expires_at ?? null, status: 'active', created_at: now, updated_at: now,
        known_seasons: args.kind === 'new_season' ? t.seasons.map(s => s.season_number) : [], trigger: null};
      r.checkThreshold(idx, data, rule, nowMs);
      if (rule.expires_at !== null && c.instant(rule.expires_at) <= nowMs) fail('invalid_date', 'expires_at must be after the current time.');
      if (data.alerts.some(a => a.kind === rule.kind && a.title_id === rule.title_id && c.alertStatus(a, nowMs) === 'active')) {
        fail('duplicate_alert', 'An active ' + rule.kind + ' rule already exists for ' + t.name + '.');
      }
      r.checkAlreadyTrue(idx, data, rule, nowMs);
      data.alerts.push(rule);
      r.record(ctx, data, {action: name, ...req, object_type: 'alert', object_id: rule.alert_id});
      log(ctx, name, {alert_id: rule.alert_id, kind: rule.kind});
      return {data, result: {id: rule.alert_id, alert: c.alertView(idx, rule, nowMs)}};
    }
    case 'kinodex.alerts.update':
    case 'kinodex.alerts.delete': {
      const a = alertById(data, args.id), status = c.alertStatus(a, nowMs);
      if (status !== 'active') fail('not_active', 'Alert ' + a.alert_id + ' is ' + status + '; only active, unexpired rules can change.');
      const before = copy(a);
      if (name === 'kinodex.alerts.delete') {
        a.status = 'deleted'; a.updated_at = now;
      } else {
        const next = {...copy(a), ...copy(args.patch)};
        if (args.patch.threshold !== undefined && a.kind !== 'price_below') fail('invalid_threshold', 'Only price_below rules take a threshold.');
        if (next.expires_at !== null && c.instant(next.expires_at) <= nowMs) fail('invalid_date', 'expires_at must be after the current time.');
        if (!Object.keys(args.patch).some(k => JSON.stringify(args.patch[k]) !== JSON.stringify(a[k]))) fail('no_change', 'The patch matches the rule as it is.');
        r.checkThreshold(idx, data, next, nowMs);
        r.checkAlreadyTrue(idx, data, next, nowMs, false);
        Object.assign(a, copy(args.patch)); a.updated_at = now;
      }
      r.record(ctx, data, {action: name, ...req, object_type: 'alert', object_id: a.alert_id, replaced: before});
      log(ctx, name, {alert_id: a.alert_id});
      return {data, result: {id: a.alert_id, alert: c.alertView(idx, a, nowMs)}};
    }
    case 'kinodex.corrections.submit': {
      const t = c.title(idx, args.title_id);
      const current = r.currentValue(idx, t.title_id, args.field, args.target);
      r.checkProposed(args.field, args.target, args.proposed_value);
      if (!text(args.evidence, 2000)) fail('invalid_arguments', 'An evidence note is required.');
      if (data.corrections.some(co => r.isOpen(co) && co.title_id === t.title_id && co.field === args.field && r.sameTarget(co.target, args.target))) {
        fail('already_submitted', 'An open ' + args.field + ' correction already exists for this target of ' + t.name + '.');
      }
      if (r.sameValue(current, args.proposed_value)) fail('no_change', 'The proposed value equals the current value (' + JSON.stringify(current) + ').');
      const co = {correction_id: r.newId('corr', seq, idx.corrections), title_id: t.title_id, field: args.field, target: copy(args.target),
        proposed_value: copy(args.proposed_value), current_value: copy(current), evidence: args.evidence, status: 'submitted', submitted_at: now,
        updated_at: now, amended_at: null, withdrawn_at: null, decisions: []};
      data.corrections.push(co);
      r.record(ctx, data, {action: name, ...req, object_type: 'correction', object_id: co.correction_id});
      log(ctx, name, {correction_id: co.correction_id, field: co.field});
      return {data, result: {id: co.correction_id, correction: {...copy(co), title_name: t.name}}};
    }
    case 'kinodex.corrections.amend': {
      const co = correctionById(data, args.id);
      if (co.status === 'submitted') fail('already_submitted', 'Correction ' + co.correction_id + ' is already submitted and awaiting a decision.');
      if (co.status !== 'needs_info') fail('already_decided', 'Correction ' + co.correction_id + ' is ' + co.status + '.');
      if (co.amended_at !== null) fail('already_decided', 'Correction ' + co.correction_id + ' was already amended once.');
      const current = r.currentValue(idx, co.title_id, co.field, co.target), proposed = args.patch.proposed_value ?? co.proposed_value;
      r.checkProposed(co.field, co.target, proposed);
      if (args.patch.evidence !== undefined && !text(args.patch.evidence, 2000)) fail('invalid_arguments', 'An evidence note is required.');
      if (r.sameValue(current, proposed)) fail('no_change', 'The proposed value equals the current value (' + JSON.stringify(current) + ').');
      if (!Object.keys(args.patch).some(k => JSON.stringify(args.patch[k]) !== JSON.stringify(co[k]))) fail('no_change', 'The amendment changes nothing.');
      const before = copy(co);
      Object.assign(co, copy(args.patch)); co.current_value = copy(current); co.status = 'submitted'; co.amended_at = now; co.updated_at = now;
      r.record(ctx, data, {action: name, ...req, object_type: 'correction', object_id: co.correction_id, replaced: before});
      log(ctx, name, {correction_id: co.correction_id});
      return {data, result: {id: co.correction_id, correction: {...copy(co), title_name: idx.titles.get(co.title_id).name}}};
    }
    case 'kinodex.corrections.withdraw': {
      const co = correctionById(data, args.id);
      if (!r.isOpen(co)) fail('already_decided', 'Correction ' + co.correction_id + ' is ' + co.status + ' and can no longer be withdrawn.');
      const before = copy(co);
      co.status = 'withdrawn'; co.withdrawn_at = now; co.updated_at = now;
      r.record(ctx, data, {action: name, ...req, object_type: 'correction', object_id: co.correction_id, replaced: before});
      log(ctx, name, {correction_id: co.correction_id});
      return {data, result: {id: co.correction_id, correction: {...copy(co), title_name: idx.titles.get(co.title_id).name}}};
    }
    default:
      fail('unknown_tool', 'Unknown Kinodex operation.');
  }
}

function handleTool(ctx, data, name, args) {
  const result = read(ctx, data, name, args);
  if (result) return {data, result};
  return write(ctx, data, name, args);
}

module.exports = {handleTool};
