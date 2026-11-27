import {el as node, tag, metadata, textBlock} from '/shared/client.js';
// Gustline's own pages: saved places with forecasts, observations, air quality, alerts and daylight;
// personal rules; notifications; settings; and the place gazetteer. The shared Host supplies only a fixed
// Agent MCP connection. Every value shown comes from a Gustline read; nothing is computed or stored here.
//
// Gustline's records are keyed by place_id, rule_id and notification_id, so this controller keeps its own
// small transport instead of the shared mount(). Writes follow the shared rules: the version observed when
// a form opens is sent with the write, an unchanged retry reuses its request_id, and a stale form reports
// the conflict instead of silently refreshing.

// Optional children written as `condition && el(...)` are skipped rather than shown as "false".
const el = (name, attrs, ...children) => node(name, attrs, ...children.flat().filter(c => c !== false && c !== undefined));

const css = new CSSStyleSheet();
css.replaceSync(`
body[data-app=gustline] .content{padding:24px 28px;max-width:1200px}.stack{display:grid;gap:18px}
.place-head{display:flex;align-items:flex-end;gap:14px;flex-wrap:wrap}.place-head h2{font-size:28px}.place-head .actions{margin-left:auto}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px}
.card{border:1px solid var(--line);border-radius:12px;padding:16px 18px;background:#fff;min-width:0}
.card h3{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:10px}
.big{font-size:34px;font-weight:650;letter-spacing:-.03em;line-height:1.1}
.hours{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(64px,1fr);overflow-x:auto;gap:6px}
.hour{border-radius:10px;background:#f5f7fb;padding:8px;text-align:center;font-size:12px}.hour strong{display:block;font-size:15px}
.days{display:grid;gap:6px}.day{display:grid;grid-template-columns:110px 90px 70px 1fr;gap:10px;align-items:center;font-size:13px}
.alert{border-left:4px solid #d9822b;background:#fff8ef;border-radius:8px;padding:10px 14px;margin-bottom:8px}
.alert.severe,.alert.extreme{border-color:#c0392b;background:#fff1f0}.alert.informational{border-color:#7a8596;background:#f5f7fa}
.alert button{margin-top:6px;font-size:11px;padding:4px 8px}
.chip{display:inline-block;white-space:nowrap;border-radius:999px;padding:1px 9px;font-size:11px;background:#eef2f8;color:#4e5d74;margin-right:6px}
.chip.good{background:#e5f6ea;color:#22693a}.chip.moderate{background:#fff6d6;color:#7a5c00}.chip.unhealthy_for_sensitive_groups{background:#ffe9d6;color:#8a4600}
.chip.unhealthy,.chip.very_unhealthy,.chip.hazardous,.chip.delivery_failed{background:#fde4e4;color:#932222}
.chip.delivered{background:#e5f6ea;color:#22693a}.chip.held_quiet_hours,.chip.pending_delivery{background:#fff6d6;color:#7a5c00}
table.history{width:100%;border-collapse:collapse;font-size:12px}table.history td,table.history th{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
.muted-card{color:var(--muted);font-size:12px}.weekdays{display:flex;gap:6px;flex-wrap:wrap}.weekdays label{display:flex;gap:4px;align-items:center;font-size:12px}
.weekdays input{width:auto}.filter{padding:0 22px 12px}.inline{display:grid;grid-template-columns:1fr 1fr;gap:10px}
`);
document.adoptedStyleSheets = [...document.adoptedStyleSheets, css];
document.title = 'Gustline · PALE';
document.body.dataset.app = 'gustline';

// ---- transport ----
let csrf = '', tools = [], version = null, busy = false;
async function request(url, method = 'GET', value) {
  const r = await fetch(url, {method, headers: method === 'POST' ? {'Content-Type': 'application/json', 'X-Pale-CSRF': csrf} : {},
    ...(method === 'POST' ? {body: JSON.stringify(value)} : {})});
  const out = await r.json();
  if (!r.ok) throw Error(out.error || 'Request failed');
  return out;
}
const MESSAGES = {stale_version: 'Gustline changed since this form opened. Close it and refresh before trying again.',
  permission_denied: 'This operation is not allowed for the current account and policy.'};
async function call(name, args = {}) {
  const r = await request('/api/call', 'POST', {name, arguments: args});
  if (!['ok', 'committed'].includes(r.status)) throw Object.assign(Error(MESSAGES[r.status] || r.message || r.status), {code: r.status});
  if (r.version) version = r.version;
  return r;
}
const has = name => tools.some(t => t.name === name);
const schemaOf = name => tools.find(t => t.name === name)?.inputSchema || {properties: {}};
const enumOf = (name, key) => { const p = schemaOf(name).properties[key] || {}; return p.enum || p.anyOf?.find(x => x.enum)?.enum || []; };
// A read that may legitimately fail for a place (no station, no issuance yet) returns its error instead.
const attempt = (name, args) => call(name, args).catch(e => ({error: e}));

// ---- presentation helpers ----
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// Local wall-clock parts of an RFC 3339 time, in the zone the App rendered it in (not the browser's).
function wall(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(text || '');
  if (!m) return {date: '', time: '', weekday: '', label: text || '—'};
  const weekday = WEEKDAY[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()];
  // History reaches back to 2025, so times outside the current year show it.
  const year = now && m[1] !== now.slice(0, 4) ? '/' + m[1] : '';
  return {date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}`, weekday, label: `${weekday} ${m[2]}/${m[3]}${year} ${m[4]}:${m[5]}`};
}
const words = s => String(s ?? '').replace(/_/g, ' ');
const chip = (text, kind = text) => el('span', {class: 'chip ' + kind}, words(text));
const card = (title, ...body) => el('section', {class: 'card'}, el('h3', {}, title), ...body);
const failed = (title, error) => card(title, el('p', {class: 'muted-card'}, words(error.code || '') + (error.message && error.code !== error.message ? ': ' + error.message : '')));
const plusHours = (iso, h) => new Date(Date.parse(iso) + h * 3600e3).toISOString();
const unit = (units, metric, us) => (units === 'us' ? us : metric);

// ---- shell ----
const status = el('p', {role: 'status', 'aria-live': 'polite', id: 'status'}, 'Connecting…');
const nav = el('nav', {'aria-label': 'Gustline navigation'}), globalActions = el('div', {class: 'actions'});
const search = el('input', {type: 'search', placeholder: 'Find a place', 'aria-label': 'Find a place'});
const content = el('div', {class: 'content', id: 'content'});
const refreshButton = el('button', {type: 'button', onclick: () => refresh().catch(showError)}, 'Refresh');
document.querySelector('#app').replaceChildren(el('div', {class: 'app-shell'},
  el('aside', {class: 'sidebar'}, el('div', {class: 'brand'}, el('span', {class: 'brand-mark', 'aria-hidden': 'true'}, '☁'), el('h1', {}, 'Gustline')),
    globalActions, nav, el('div', {class: 'sidebar-foot'}, el('span', {class: 'avatar small', 'aria-hidden': 'true'}, 'G'),
      el('div', {}, el('strong', {}, 'Weather and air quality'), el('small', {}, 'Synthetic data')))),
  el('main', {class: 'app-main'}, el('header', {class: 'toolbar'}, search, refreshButton), status, content)));
function showError(e) { status.textContent = e.message; status.dataset.error = 'true'; }
function ok(text) { status.textContent = text; delete status.dataset.error; }
function loading(on) { document.querySelector('#app').setAttribute('aria-busy', String(on)); for (const b of document.querySelectorAll('button')) b.disabled = on; }

// ---- state read from the App on every refresh ----
let view = sessionStorage.getItem('gustline-view') || 'place', current = sessionStorage.getItem('gustline-current') || null;
let settings = null, saved = [], now = null, detail = null;
function go(next, id = null) {
  view = next; current = id; detail = null;
  sessionStorage.setItem('gustline-view', view);
  if (id) sessionStorage.setItem('gustline-current', id); else sessionStorage.removeItem('gustline-current');
  return render();
}

async function refresh() {
  loading(true);
  try {
    tools = (await request('/api/tools')).tools;
    settings = (await call('gustline.settings.get')).settings;
    saved = (await call('gustline.saved_places.list')).saved_places;
    now = (await call('gustline.notifications.list')).as_of;
    globalActions.replaceChildren(...[
      has('gustline.rules.create') && el('button', {type: 'button', class: 'primary', onclick: () => ruleForm(null).catch(showError)}, 'New rule'),
      has('gustline.saved_places.add') && el('button', {type: 'button', onclick: () => go('search').catch(showError)}, 'Add a place')].filter(Boolean));
    await render();
    ok('Up to date as of ' + wall(now).label);
  } finally { loading(false); }
}

async function render() {
  if (view === 'place' && !saved.some(s => s.saved_place_id === current)) current = settings.default_saved_place_id || saved[0]?.saved_place_id || null;
  const item = (id, label, symbol, sub, active) => el('button', {type: 'button', 'aria-current': active ? 'page' : false, 'data-nav': id,
    onclick: () => (id.startsWith('sp:') ? go('place', id.slice(3)) : go(id)).catch(showError)},
  el('span', {class: 'nav-symbol', 'aria-hidden': 'true'}, symbol), el('span', {}, label), el('small', {}, sub || ''));
  nav.replaceChildren(
    ...saved.map(s => item('sp:' + s.saved_place_id, s.label, s.saved_place_id === settings.default_saved_place_id ? '★' : '⌂', '', view === 'place' && current === s.saved_place_id)),
    item('rules', 'Rules', '⚑', '', view === 'rules'), item('notifications', 'Notifications', '✉', '', view === 'notifications'),
    item('search', 'Find places', '⌕', '', view === 'search'), item('settings', 'Settings', '⚙', '', view === 'settings'));
  loading(true);
  try {
    const page = view === 'rules' ? await rulesPage() : view === 'notifications' ? await notificationsPage()
      : view === 'search' ? await searchPage() : view === 'settings' ? settingsPage() : await placePage();
    content.replaceChildren(page);
  } finally { loading(false); }
}

// ---- place page: everything Gustline knows about one saved place at the virtual time ----
async function placePage() {
  const s = saved.find(x => x.saved_place_id === current);
  if (!s) return el('div', {class: 'empty'}, el('h3', {}, 'No saved places yet'), el('p', {}, 'Use Find places to save one.'));
  const place = (await call('gustline.places.get', {place_id: s.place_id})).place, units = settings.units;
  const [hourly, daily, obs, air, airDays, alerts, astro, history] = await Promise.all([
    attempt('gustline.forecast.get', {place_id: place.place_id, from: now, to: plusHours(now, 24), granularity: 'hourly'})
      .then(r => (r.error?.code === 'outside_horizon' ? attempt('gustline.forecast.get', {place_id: place.place_id, from: now, to: plusHours(now, 6), granularity: 'hourly'}) : r)),
    attempt('gustline.forecast.get', {place_id: place.place_id, from: now, to: plusHours(now, 24 * 6), granularity: 'daily'})
      .then(r => (r.error?.code === 'outside_horizon' ? attempt('gustline.forecast.get', {place_id: place.place_id, from: now, to: plusHours(now, 48), granularity: 'daily'}) : r)),
    place.station_id ? attempt('gustline.observations.get', {place_id: place.place_id, from: plusHours(now, -6), to: now}) : null,
    place.monitor_id ? attempt('gustline.air.current', {place_id: place.place_id}) : null,
    place.air_area_id ? attempt('gustline.air.forecast', {place_id: place.place_id, from_date: now.slice(0, 10), to_date: plusHours(now, 72).slice(0, 10)}) : null,
    attempt('gustline.alerts.list', {place_id: place.place_id}),
    attempt('gustline.astro.get', {place_id: place.place_id, date: now.slice(0, 10)}),
    attempt('gustline.forecast.history', {place_id: place.place_id, kind: 'weather'})]);
  const head = el('div', {class: 'place-head'},
    el('div', {}, el('span', {class: 'kicker'}, words(place.kind) + ' · ' + place.time_zone), el('h2', {}, s.label), el('small', {}, place.name)),
    el('div', {class: 'actions'},
      has('gustline.saved_places.rename') && el('button', {type: 'button', onclick: () => renameForm(s).catch(showError)}, 'Rename'),
      has('gustline.settings.update') && s.saved_place_id !== settings.default_saved_place_id &&
        el('button', {type: 'button', onclick: () => settingsForm({default_saved_place_id: s.saved_place_id}).catch(showError)}, 'Make default'),
      has('gustline.rules.create') && el('button', {type: 'button', onclick: () => ruleForm(null, {saved_place_id: s.saved_place_id}).catch(showError)}, 'New rule here'),
      has('gustline.saved_places.remove') && el('button', {type: 'button', onclick: () => confirmWrite('Remove ' + s.label + '?', 'gustline.saved_places.remove', {saved_place_id: s.saved_place_id}, 'Place removed.').catch(showError)}, 'Remove')));
  const sections = [head, alertsCard(alerts)];
  const cards = el('div', {class: 'cards'});
  if (obs) cards.append(obs.error ? failed('Now', obs.error) : nowCard(obs, units));
  if (air) cards.append(air.error ? failed('Air quality now', air.error) : airCard(air));
  cards.append(astro.error ? failed('Daylight', astro.error) : card('Daylight · ' + astro.date,
    metadata('Civil dawn', wall(astro.civil_dawn).time), metadata('Sunrise', wall(astro.sunrise).time),
    metadata('Sunset', wall(astro.sunset).time), metadata('Civil dusk', wall(astro.civil_dusk).time)));
  if (airDays) cards.append(airDays.error ? failed('Air quality forecast', airDays.error) : card('Air quality forecast',
    ...airDays.days.map(d => metadata(d.date, el('span', {}, chip(d.aqi_category), d.dominant_pollutant ? d.dominant_pollutant.toUpperCase() : ''))),
    airDays.narrative ? el('small', {}, airDays.narrative) : null));
  sections.push(cards, hourly.error ? failed('Next hours', hourly.error) : hourlyCard(hourly, units),
    daily.error ? failed('Next days', daily.error) : dailyCard(daily, units), history.error ? failed('Forecast issuances', history.error) : historyCard(history));
  return el('div', {class: 'stack'}, ...sections);
}

function nowCard(r, units) {
  const o = r.observations.at(-1);
  if (!o) return card('Now', el('p', {class: 'muted-card'}, 'No observation in the last six hours.'));
  const temp = units === 'us' ? o.temp_f : o.temp_c, gust = units === 'us' ? o.gust_mph : o.gust_kph, wind = units === 'us' ? o.wind_mph : o.wind_kph;
  return card('Now · ' + wall(o.observed_at).time + (o.corrected ? ' · corrected' : ''),
    el('div', {class: 'big'}, temp === undefined ? '—' : temp + unit(units, ' °C', ' °F')),
    metadata('Wind', wind === undefined ? '—' : wind + unit(units, ' kph', ' mph')), metadata('Gusts', gust === undefined ? '—' : gust + unit(units, ' kph', ' mph')),
    metadata('Humidity', o.humidity_pct === undefined ? '—' : o.humidity_pct + '%'), el('small', {}, 'Station ' + r.station_id));
}
function airCard(r) {
  return card('Air quality now · ' + wall(r.observed_at).time, el('div', {class: 'big'}, r.aqi ?? '—'),
    el('div', {}, r.category ? chip(r.category) : null, r.dominant_pollutant ? tag(r.dominant_pollutant.toUpperCase()) : null, r.stale ? chip('stale', 'delivery_failed') : null),
    el('small', {}, r.basis), el('small', {}, 'Monitor ' + r.monitor_id + ' · table ' + r.aqi_table));
}
function alertsCard(r) {
  if (r.error) return failed('Official alerts', r.error);
  const live = r.alerts.filter(a => ['active', 'upcoming'].includes(a.status));
  const past = r.alerts.length - live.length;
  return card('Official alerts', ...(live.length ? live.map(a => el('div', {class: 'alert ' + a.version.severity + (a.informational ? ' informational' : '')},
    el('strong', {}, a.version.headline), el('div', {}, chip(a.status), chip(a.version.severity), a.informational ? chip('informational') : null,
      el('small', {}, wall(a.version.onset).label + ' – ' + wall(a.version.expires).label + ' · ' + a.version.issuer)),
    a.version.instruction ? textBlock(a.version.instruction) : null,
    el('button', {type: 'button', onclick: () => alertDialog(a.alert_id).catch(showError)}, 'Version history (' + a.latest_version + ')')))
    : [el('p', {class: 'muted-card'}, 'No active or upcoming alerts.')]),
  past ? el('small', {}, past + ' past or cancelled alert' + (past === 1 ? '' : 's') + ' for this place.') : null);
}
function hourlyCard(r, units) {
  const temp = units === 'us' ? 'temp_f' : 'temp_c', gust = units === 'us' ? 'gust_mph' : 'gust_kph';
  return card(`Next hours (${unit(units, '°C, kph', '°F, mph')}) · ${r.provider} · issued ${wall(r.issued_at).label}`,
    el('div', {class: 'hours'}, ...r.periods.map(p => el('div', {class: 'hour'}, el('small', {}, wall(p.start).time),
      el('strong', {}, p[temp] ?? '—'), el('small', {}, (p.precip_prob_pct ?? '—') + '% rain'), el('small', {}, 'gust ' + (p[gust] ?? '—'))))),
    r.not_provided.length ? el('small', {}, 'Not forecast by this provider: ' + r.not_provided.map(words).join(', ')) : null,
    r.other_providers_available.length ? el('small', {}, 'Also available: ' + r.other_providers_available.join(', ')) : null);
}
function dailyCard(r, units) {
  const hi = units === 'us' ? 'high_f' : 'high_c', lo = units === 'us' ? 'low_f' : 'low_c';
  return card(`Next days (high / low ${unit(units, '°C', '°F')}, chance of rain)`, el('div', {class: 'days'}, ...r.periods.map(d => el('div', {class: 'day'},
    el('strong', {}, wall(d.date + 'T12:00').weekday + ' ' + d.date.slice(5)), el('span', {}, (d[hi] ?? '—') + ' / ' + (d[lo] ?? '—')),
    el('span', {}, (d.precip_prob_pct ?? '—') + '%'), el('span', {}, d.headline || '')))));
}
function historyCard(r) {
  return card('Forecast issuances', el('table', {class: 'history'}, el('tr', {}, el('th', {}, 'Issuance'), el('th', {}, 'Issued'), el('th', {}, 'Status')),
    ...r.issuances.slice(0, 8).map(i => el('tr', {}, el('td', {}, i.issuance_id), el('td', {}, wall(i.issued_at).label), el('td', {}, chip(i.status))))));
}
async function alertDialog(id) {
  const a = (await call('gustline.alerts.get', {alert_id: id})).alert;
  show(a.version.headline, el('div', {}, el('p', {}, chip(a.status), a.informational ? chip('informational') : null),
    el('table', {class: 'history'}, el('tr', {}, el('th', {}, 'Version'), el('th', {}, 'Type'), el('th', {}, 'Issued'), el('th', {}, 'In effect')),
      ...a.chain.map(v => el('tr', {}, el('td', {}, v.version), el('td', {}, v.msg_type), el('td', {}, wall(v.issued_at).label),
        el('td', {}, wall(v.onset).label + ' – ' + wall(v.expires).label))))));
}

// ---- rules ----
const KINDS = {forecast_threshold: ['temp_max_c', 'temp_min_c', 'feels_like_c', 'precip_prob_pct', 'precip_mm', 'thunder_prob_pct', 'gust_kph', 'uv_index', 'aqi_forecast_category'],
  observation_threshold: ['temp_c', 'feels_like_c', 'precip_mm', 'gust_kph', 'aqi'], official_alert: []};
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function describe(r) {
  const place = saved.find(s => s.saved_place_id === r.saved_place_id)?.label || r.saved_place_id;
  if (r.kind === 'official_alert') return `Alerts at ${place}: ${r.alert_events.length ? r.alert_events.map(words).join(', ') : 'any event'}${r.min_severity ? ', ' + r.min_severity + ' or worse' : ''}`;
  return `${words(r.metric)} ${r.comparator === 'gte' ? '≥' : '≤'} ${r.threshold} at ${place}${r.look_ahead_hours ? ' within ' + r.look_ahead_hours + ' h' : ''}`;
}
async function rulesPage() {
  const rules = (await call('gustline.rules.list')).rules;
  if (!detail || !rules.some(r => r.rule_id === detail)) detail = rules.find(r => r.status !== 'deleted')?.rule_id || null;
  const list = el('div', {class: 'records', id: 'records'}, ...rules.map(r => el('button', {type: 'button', class: 'record', 'data-record-id': r.rule_id,
    'aria-pressed': String(r.rule_id === detail), onclick: () => { detail = r.rule_id; render().catch(showError); }},
  el('span', {class: 'record-title'}, describe(r)), el('span', {class: 'record-subtitle'}, r.rule_id + ' · ' + words(r.status) + ' · ' + r.delivery))));
  const r = rules.find(x => x.rule_id === detail);
  const pane = r ? (await ruleDetail(r)) : el('div', {class: 'empty'}, el('h3', {}, 'No rules yet'), el('p', {}, 'Create one to be told when a forecast, observation or alert matters to you.'));
  return el('div', {class: 'workspace'}, el('section', {class: 'collection', 'aria-label': 'Rules'}, el('div', {class: 'collection-head'}, el('h2', {class: 'section-title'}, 'Rules'),
    el('span', {class: 'collection-count'}, rules.length)), list), el('section', {class: 'detail', 'aria-label': 'Selected rule', 'data-selected-id': r?.rule_id || false}, pane));
}
async function ruleDetail(summary) {
  const r = (await call('gustline.rules.get', {rule_id: summary.rule_id})).rule, live = r.status !== 'deleted';
  const w = r.window, windowText = !w ? 'Any time' : w.type === 'absolute' ? wall(w.from).label + ' – ' + wall(w.to).label
    : w.days.map(d => DAYS[d - 1]).join(', ') + ' ' + w.start + '–' + w.end;
  return el('div', {}, el('div', {class: 'detail-actions'}, el('div', {class: 'actions'},
    live && has('gustline.rules.update') && el('button', {type: 'button', onclick: () => ruleForm(r).catch(showError)}, 'Edit rule'),
    live && r.status === 'active' && has('gustline.rules.pause') && el('button', {type: 'button', onclick: () => confirmWrite('Pause this rule?', 'gustline.rules.pause', {rule_id: r.rule_id}, 'Rule paused.').catch(showError)}, 'Pause'),
    live && r.status === 'paused' && has('gustline.rules.resume') && el('button', {type: 'button', onclick: () => confirmWrite('Resume this rule from the next update?', 'gustline.rules.resume', {rule_id: r.rule_id}, 'Rule resumed.').catch(showError)}, 'Resume'),
    live && has('gustline.rules.delete') && el('button', {type: 'button', onclick: () => confirmWrite('Delete this rule? Notices not yet sent are withdrawn.', 'gustline.rules.delete', {rule_id: r.rule_id}, 'Rule deleted.').catch(showError)}, 'Delete'))),
  el('article', {}, el('span', {class: 'kicker'}, words(r.kind) + ' · revision ' + r.revision), el('h2', {}, describe(r)),
    el('p', {}, chip(r.status), chip(r.delivery), r.notify_on_clear ? chip('notify on clear') : null, r.severe_override ? chip('severe overrides quiet hours') : null),
    metadata('Window', windowText), metadata('Quiet hours', r.quiet_hours ? r.quiet_hours.start + '–' + r.quiet_hours.end : 'None'),
    r.kind === 'forecast_threshold' ? metadata('Provider', r.provider) : null, metadata('Created', wall(r.created_at).label),
    el('h3', {}, 'History'), el('table', {class: 'history'}, el('tr', {}, el('th', {}, 'Rev.'), el('th', {}, 'When'), el('th', {}, 'Change')),
      ...r.history.map(h => el('tr', {}, el('td', {}, h.revision), el('td', {}, wall(h.at).label), el('td', {}, h.action + (Object.keys(h.changes).length && h.action !== 'created' ? ': ' + JSON.stringify(h.changes) : '')))))));
}

// ---- notifications ----
async function notificationsPage() {
  const filter = sessionStorage.getItem('gustline-notification-filter') || '';
  const r = await call('gustline.notifications.list', filter ? {status: filter} : {});
  const list = [...r.notifications].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  if (!detail || !list.some(n => n.notification_id === detail)) detail = list[0]?.notification_id || null;
  const select = el('select', {'aria-label': 'Filter by status', onchange: e => { sessionStorage.setItem('gustline-notification-filter', e.target.value); detail = null; render().catch(showError); }},
    el('option', {value: ''}, 'All statuses'), ...enumOf('gustline.notifications.list', 'status').map(s => el('option', {value: s}, words(s))));
  select.value = filter;
  const n = list.find(x => x.notification_id === detail);
  return el('div', {class: 'workspace'},
    el('section', {class: 'collection', 'aria-label': 'Notifications'}, el('div', {class: 'collection-head'}, el('h2', {class: 'section-title'}, 'Notifications'),
      el('span', {class: 'collection-count'}, list.length)), el('div', {class: 'filter'}, select),
    el('div', {class: 'records', id: 'records'}, ...list.slice(0, 200).map(x => el('button', {type: 'button', class: 'record' + (x.acknowledged_at ? '' : ' unread'),
      'data-record-id': x.notification_id, 'aria-pressed': String(x.notification_id === detail), onclick: () => { detail = x.notification_id; render().catch(showError); }},
    el('span', {class: 'record-title'}, x.title), el('span', {class: 'record-subtitle'}, wall(x.created_at).label + ' · ' + words(x.status)))))),
    el('section', {class: 'detail', 'aria-label': 'Selected notification', 'data-selected-id': n?.notification_id || false}, !n ? el('div', {class: 'empty'}, el('h3', {}, 'Nothing here'))
      : el('div', {}, el('div', {class: 'detail-actions'}, el('div', {class: 'actions'}, !n.acknowledged_at && has('gustline.notifications.acknowledge') &&
        el('button', {type: 'button', onclick: () => write('gustline.notifications.acknowledge', {notification_id: n.notification_id}, version).then(() => refresh()).then(() => ok('Marked as read.')).catch(showError)}, 'Mark as read'))),
      el('article', {}, el('span', {class: 'kicker'}, n.rule_id + ' · ' + words(n.phase)), el('h2', {}, n.title), el('p', {}, chip(n.status), chip(n.delivery)), textBlock(n.body),
        metadata('Created', wall(n.created_at).label), n.release_at ? metadata('Released at', wall(n.release_at).label) : null,
        n.outcome ? metadata('Delivery', words(n.outcome.status) + (n.outcome.code ? ' · ' + n.outcome.code : '')) : null,
        metadata('Read', n.acknowledged_at ? wall(n.acknowledged_at).label : 'Not yet')))));
}

// ---- places ----
async function searchPage() {
  const query = search.value.trim(), places = (await call('gustline.places.search', {query})).places;
  const savedIds = new Set(saved.map(s => s.place_id));
  return el('div', {}, el('h2', {}, query ? 'Places matching “' + query + '”' : 'All places'),
    el('div', {class: 'cards'}, ...places.map(p => card(words(p.kind), el('strong', {}, p.name), el('small', {}, p.time_zone + ' · zone ' + p.zone_id),
      el('small', {}, [p.station_id && 'station', p.monitor_id && 'air monitor', p.air_area_id && 'air forecast'].filter(Boolean).join(' · ') || 'Forecast only'),
      savedIds.has(p.place_id) ? chip('saved') : has('gustline.saved_places.add') && el('button', {type: 'button', 'data-place-id': p.place_id,
        onclick: () => saveForm(p).catch(showError)}, 'Save place')))));
}
search.addEventListener('keydown', e => { if (e.key === 'Enter') go('search').catch(showError); });

function settingsPage() {
  return el('div', {}, el('h2', {}, 'Settings'), card('Display', metadata('Units', settings.units === 'us' ? 'US (°F, mph, in)' : 'Metric (°C, kph, mm)'),
    metadata('Your time zone', settings.time_zone), metadata('Default place', saved.find(s => s.saved_place_id === settings.default_saved_place_id)?.label || 'None'),
    has('gustline.settings.update') && el('button', {type: 'button', onclick: () => settingsForm().catch(showError)}, 'Change settings')));
}

// ---- forms ----
const dialog = el('dialog', {'aria-label': 'Gustline operation'});
document.body.append(dialog);
function show(title, body) {
  dialog.replaceChildren(el('h2', {}, title), body, el('div', {class: 'form-actions'}, el('button', {type: 'button', onclick: () => dialog.close()}, 'Close')));
  dialog.showModal();
}
const pending = new Map();
// A write with the version from when its form opened; an identical retry reuses the request_id.
async function write(name, args, formVersion) {
  if (busy) throw Error('An operation is already in progress.');
  const payload = {...args, expected_version: formVersion}, key = name + JSON.stringify(payload);
  if (!pending.has(key)) pending.set(key, 'web-' + crypto.randomUUID());
  busy = true;
  try { const r = await call(name, {...payload, request_id: pending.get(key)}); pending.delete(key); return r; } finally { busy = false; }
}
const field = (label, input, help) => el('label', {class: 'field'}, el('span', {}, label), input, help ? el('small', {}, help) : null);
const input = (attrs) => el('input', attrs);
const select = (name, options, value, attrs = {}) => {
  const s = el('select', {'data-field': name, ...attrs}, ...options.map(([v, l]) => el('option', {value: v}, l)));
  if (value !== undefined && value !== null) s.value = String(value);
  return s;
};
function form(title, fields, submitLabel, build, done) {
  const formVersion = structuredClone(version), error = el('p', {role: 'alert', class: 'form-error'});
  const submit = el('button', {type: 'submit', class: 'primary'}, submitLabel);
  const f = el('form', {}, el('h2', {}, title), el('div', {class: 'fields'}, ...fields), error,
    el('div', {class: 'form-actions'}, el('button', {type: 'button', onclick: () => dialog.close()}, 'Cancel'), submit));
  f.onsubmit = async e => {
    e.preventDefault(); error.textContent = ''; submit.disabled = true;
    try {
      const [name, args] = build();
      const r = await write(name, args, formVersion);
      dialog.close(); await refresh(); ok(done(r));
    } catch (err) { error.textContent = err.message; error.dataset.code = err.code || 'request_failed'; } finally { submit.disabled = false; }
  };
  dialog.dataset.operation = title;
  dialog.replaceChildren(f); dialog.showModal(); f.querySelector('input,select,textarea')?.focus();
}
async function confirmWrite(question, name, args, done) {
  form(question, [], 'Confirm', () => [name, args], () => done);
}
async function saveForm(p) {
  const label = input({type: 'text', 'data-field': 'label', required: true, maxlength: 80, value: p.name});
  form('Save ' + p.name, [field('Your label', label)], 'Save place', () => ['gustline.saved_places.add', {place_id: p.place_id, label: label.value}], r => 'Saved as ' + r.saved_place_id + '.');
}
async function renameForm(s) {
  const label = input({type: 'text', 'data-field': 'label', required: true, maxlength: 80, value: s.label});
  form('Rename ' + s.label, [field('Label', label)], 'Rename', () => ['gustline.saved_places.rename', {saved_place_id: s.saved_place_id, label: label.value}], () => 'Renamed.');
}
async function settingsForm(preset = {}) {
  const units = select('units', [['metric', 'Metric (°C, kph, mm)'], ['us', 'US (°F, mph, in)']], settings.units);
  const zone = input({type: 'text', 'data-field': 'time_zone', value: settings.time_zone, required: true});
  const def = select('default_saved_place_id', [['', 'None'], ...saved.map(s => [s.saved_place_id, s.label])], preset.default_saved_place_id ?? settings.default_saved_place_id ?? '');
  form('Settings', [field('Units', units), field('Your time zone', zone, 'IANA name, e.g. America/Los_Angeles'), field('Default place', def)], 'Save settings', () => {
    const changes = {};
    if (units.value !== settings.units) changes.units = units.value;
    if (zone.value !== settings.time_zone) changes.time_zone = zone.value;
    if ((def.value || null) !== settings.default_saved_place_id) changes.default_saved_place_id = def.value || null;
    if (!Object.keys(changes).length) throw Error('No changes to save.');
    return ['gustline.settings.update', changes];
  }, () => 'Settings saved.');
}
// Create (rule null) or edit (patch of changed fields only) a rule.
async function ruleForm(rule, preset = {}) {
  const r = rule || {kind: 'forecast_threshold', comparator: 'gte', provider: 'gustline', look_ahead_hours: 24, delivery: 'in_app', alert_events: [],
    notify_on_clear: false, severe_override: false, window: null, quiet_hours: null, ...preset};
  const place = select('saved_place_id', saved.map(s => [s.saved_place_id, s.label]), r.saved_place_id);
  const kind = select('kind', enumOf('gustline.rules.create', 'kind').map(k => [k, words(k)]), r.kind, rule ? {disabled: true} : {});
  const metric = select('metric', [], null), comparator = select('comparator', [['gte', 'at least'], ['lte', 'at most']], r.comparator);
  const threshold = input({type: 'number', step: 'any', 'data-field': 'threshold', value: r.threshold ?? ''});
  const provider = select('provider', enumOf('gustline.rules.create', 'provider').map(p => [p, p]), r.provider);
  const ahead = input({type: 'number', min: 1, max: 72, 'data-field': 'look_ahead_hours', value: r.look_ahead_hours ?? 24});
  const events = select('alert_events', (schemaOf('gustline.rules.create').properties.alert_events?.items?.enum || []).map(e => [e, words(e)]), null, {multiple: true, size: 6});
  for (const o of events.options) o.selected = (r.alert_events || []).includes(o.value);
  const severity = select('min_severity', [['', 'Any'], ...(schemaOf('gustline.rules.create').properties.min_severity?.enum || []).map(s => [s, s])], r.min_severity ?? '');
  const windowType = select('window.type', [['', 'Any time'], ['recurring', 'Every week'], ['absolute', 'Between two times']], r.window?.type || '');
  const days = el('div', {class: 'weekdays'}, ...DAYS.map((d, i) => el('label', {}, input({type: 'checkbox', value: i + 1, 'data-day': i + 1,
    ...(r.window?.type === 'recurring' && r.window.days.includes(i + 1) ? {checked: true} : {})}), d)));
  const wStart = input({type: 'time', 'data-field': 'window.start', value: r.window?.start || '07:00'}), wEnd = input({type: 'time', 'data-field': 'window.end', value: r.window?.end || '09:00'});
  const wFrom = input({type: 'text', 'data-field': 'window.from', placeholder: '2027-10-08T00:00:00-07:00', value: r.window?.from || ''});
  const wTo = input({type: 'text', 'data-field': 'window.to', placeholder: '2027-10-10T00:00:00-07:00', value: r.window?.to || ''});
  const delivery = select('delivery', [['in_app', 'In Gustline only'], ['mail', 'Email to Mail']], r.delivery);
  const quiet = input({type: 'checkbox', 'data-field': 'quiet', ...(r.quiet_hours ? {checked: true} : {})});
  const qStart = input({type: 'time', 'data-field': 'quiet_hours.start', value: r.quiet_hours?.start || '22:00'}), qEnd = input({type: 'time', 'data-field': 'quiet_hours.end', value: r.quiet_hours?.end || '07:00'});
  const clear = input({type: 'checkbox', 'data-field': 'notify_on_clear', ...(r.notify_on_clear ? {checked: true} : {})});
  const severe = input({type: 'checkbox', 'data-field': 'severe_override', ...(r.severe_override ? {checked: true} : {})});
  const groups = {threshold: [field('Metric', metric), el('div', {class: 'inline'}, field('Comparison', comparator), field('Threshold', threshold))],
    forecast: [el('div', {class: 'inline'}, field('Provider', provider), field('Look ahead (hours)', ahead))],
    alert: [field('Alert events (none means any)', events), field('Minimum severity', severity)],
    recurring: [days, el('div', {class: 'inline'}, field('From', wStart), field('Until', wEnd))], absolute: [el('div', {class: 'inline'}, field('From', wFrom), field('Until', wTo))],
    quiet: [el('div', {class: 'inline'}, field('Quiet from', qStart), field('Quiet until', qEnd))]};
  const box = el('div', {});
  const layout = () => {
    const k = kind.value, w = windowType.value;
    const choices = KINDS[k] || [];
    const keep = metric.value || r.metric;
    metric.replaceChildren(...choices.map(m => el('option', {value: m}, words(m))));
    if (choices.includes(keep)) metric.value = keep;
    box.replaceChildren(field('Place', place), field('Kind', kind), ...(k === 'official_alert' ? groups.alert : groups.threshold),
      ...(k === 'forecast_threshold' ? groups.forecast : []), ...(k === 'official_alert' ? [] : [field('When', windowType), ...(w === 'recurring' ? groups.recurring : w === 'absolute' ? groups.absolute : [])]),
      field('Deliver', delivery), el('label', {class: 'field'}, el('span', {}, 'Quiet hours'), quiet), ...(quiet.checked ? groups.quiet : []),
      el('label', {class: 'field'}, el('span', {}, k === 'official_alert' ? 'Also tell me when it is cancelled' : 'Also tell me when it clears'), clear),
      k === 'official_alert' ? el('label', {class: 'field'}, el('span', {}, 'Severe alerts ignore quiet hours'), severe) : null);
  };
  kind.addEventListener('change', layout); windowType.addEventListener('change', layout); quiet.addEventListener('change', layout);
  layout();
  form(rule ? 'Edit ' + rule.rule_id : 'New rule', [box], rule ? 'Save rule' : 'Create rule', () => {
    const k = kind.value, w = windowType.value, out = {saved_place_id: place.value, delivery: delivery.value, notify_on_clear: clear.checked,
      quiet_hours: quiet.checked ? {start: qStart.value, end: qEnd.value} : null};
    if (k === 'official_alert') Object.assign(out, {alert_events: [...events.selectedOptions].map(o => o.value), min_severity: severity.value || null, severe_override: severe.checked});
    else {
      Object.assign(out, {metric: metric.value, comparator: comparator.value, threshold: Number(threshold.value),
        window: w === 'recurring' ? {type: 'recurring', days: [...days.querySelectorAll('input:checked')].map(x => Number(x.value)), start: wStart.value, end: wEnd.value}
          : w === 'absolute' ? {type: 'absolute', from: wFrom.value, to: wTo.value} : null});
      if (k === 'forecast_threshold') Object.assign(out, {provider: provider.value, look_ahead_hours: Number(ahead.value)});
    }
    if (!rule) {
      const args = {kind: k, ...out};
      for (const key of Object.keys(args)) if (args[key] === null) delete args[key];
      return ['gustline.rules.create', args];
    }
    const patch = {};
    for (const [key, value] of Object.entries(out)) if (JSON.stringify(value) !== JSON.stringify(rule[key] ?? null)) patch[key] = value;
    if (patch.min_severity === null) delete patch.min_severity; // the API sets a minimum severity but cannot clear one
    if (!Object.keys(patch).length) throw Error('No changes to save.');
    return ['gustline.rules.update', {rule_id: rule.rule_id, patch}];
  }, res => (rule ? 'Rule saved (revision ' + res.revision + ').' : 'Rule ' + res.rule_id + ' created.'));
}

// ---- start ----
(async () => {
  try {
    const token = new URLSearchParams(location.hash.slice(1)).get('access');
    if (token) { history.replaceState(null, '', location.pathname); ({csrf} = await request('/session', 'POST', {token})); }
    else ({csrf} = await request('/session'));
    await refresh();
  } catch (e) { showError(e); }
})();
