import {el} from '/shared/client.js';
// Lanternbox's business page. The App owns these views, labels and forms; the shared Host only serves the
// page and forwards permitted Agent MCP tools. Every value is rendered as text. There is no browser-side
// store: each view is read from the App again, and a form sends the version it saw when it opened.
const APP = 'lanternbox';
const VIEWS = [['browse', 'Browse', '▶'], ['profiles', 'Profiles', '☺'], ['account', 'Plan and billing', '$'], ['notifications', 'Notifications', '•']];
const keep = (key, value) => { if (value === null || value === undefined) sessionStorage.removeItem(key); else sessionStorage.setItem(key, value); };
const state = {csrf: '', tools: new Set(), view: sessionStorage.getItem('lb-view') || 'browse', as: sessionStorage.getItem('lb-as'), title: sessionStorage.getItem('lb-title'), profile: sessionStorage.getItem('lb-profile'),
  query: '', kind: '', availability: '', hidden: false, account: null};
// Layout uses the Host's shared stylesheet; the few App-specific touches are set through the CSSOM (the Host's policy forbids inline style text).
const css = (node, styles) => { Object.assign(node.style, styles); return node; };
const money = cents => '$' + (cents / 100).toFixed(2);
const when = iso => iso ? iso.replace('T', ' ').replace(/:\d\d([+-]\d\d:\d\d|Z)$/, ' (UTC$1)') : '—';
const minutes = seconds => Math.round(seconds / 60) + ' min';
const status = el('p', {role: 'status', 'aria-live': 'polite', id: 'status'}, 'Connecting…');
const nav = el('nav', {'aria-label': 'Lanternbox navigation'}), title = el('h2', {class: 'section-title'}, '');
const collection = el('section', {class: 'collection', 'aria-label': 'Records'}), detail = el('section', {class: 'detail', 'aria-label': 'Selected record'});
const workspace = el('div', {class: 'workspace'}, collection, detail), globalActions = el('div', {class: 'actions'});
const dialog = el('dialog', {'aria-label': 'Business operation'});
const say = (text, error = false) => { status.textContent = text; if (error) status.dataset.error = 'true'; else delete status.dataset.error; };
const has = name => state.tools.has(APP + '.' + name);

async function request(url, method = 'GET', value) {
  const r = await fetch(url, {method, headers: method === 'POST' ? {'Content-Type': 'application/json', 'X-Pale-CSRF': state.csrf} : {}, ...(method === 'POST' ? {body: JSON.stringify(value)} : {})});
  const out = await r.json(); if (!r.ok) throw Error(out.error || 'Request failed'); return out;
}
const MESSAGES = {stale_version: 'This changed since the form opened. Nothing was saved. Close the form, refresh and try again.', permission_denied: 'This operation is not allowed for the current account and policy.'};
async function call(name, args = {}) {
  const r = await request('/api/call', 'POST', {name: APP + '.' + name, arguments: args});
  if (!['ok', 'committed'].includes(r.status)) throw Object.assign(Error(MESSAGES[r.status] || r.message || r.status), {code: r.status});
  return r;
}

// One dialog serves every write. The version is the one observed when the form opened; an unchanged
// retry (for example after a lost response) reuses its request ID, so it cannot repeat a committed effect.
async function openForm({heading, note, fields = [], submit = 'Save', build}) {
  const version = (await call('account.get')).version, error = el('p', {role: 'alert', class: 'form-error'}), inputs = new Map();
  const rows = fields.map(f => {
    const input = f.type === 'select' ? el('select', {name: f.name}, f.options.map(([value, label]) => el('option', {value, selected: value === f.value}, label)))
      : el('input', {name: f.name, type: f.type === 'number' ? 'number' : 'text', value: f.value ?? '', placeholder: f.placeholder || ''});
    inputs.set(f.name, input);
    return el('label', {class: 'field'}, el('span', {}, f.label), input);
  });
  const save = el('button', {type: 'submit', class: 'primary'}, submit), cancel = el('button', {type: 'button', onclick: () => dialog.close()}, 'Cancel');
  let sent = null;
  const form = el('form', {onsubmit: async event => {
    event.preventDefault(); error.textContent = ''; save.disabled = true;
    try {
      const values = Object.fromEntries([...inputs].map(([name, input]) => [name, input.value]));
      const {name, args} = build(values), key = JSON.stringify([name, args]);
      if (!sent || sent.key !== key) sent = {key, request_id: 'web-' + crypto.randomUUID()};
      await call(name, {...args, expected_version: version, request_id: sent.request_id});
      dialog.close(); await refresh(); say('Saved.');
    } catch (e) { error.textContent = e.message + (e.code ? ' [' + e.code + ']' : ''); }
    finally { save.disabled = false; }
  }}, el('h2', {}, heading), note ? el('p', {class: 'muted'}, note) : null, el('div', {class: 'fields'}, rows), error, el('div', {class: 'form-actions'}, cancel, save));
  dialog.replaceChildren(form); dialog.showModal();
}
const act = (label, tool, options, primary = false) => has(tool) ? el('button', {type: 'button', class: primary ? 'primary' : '', 'data-action': tool, onclick: () => openForm(options()).catch(e => say(e.message, true))}, label) : null;
const line = (label, value) => el('div', {class: 'metadata-line'}, el('span', {}, label), el('strong', {}, value));
const chip = text => css(el('span', {class: 'tag'}, text), {marginLeft: '8px'});
const item = (attrs, ...children) => css(el('div', attrs, ...children), {margin: '10px 0 14px'});
const card = (...children) => css(el('article', {}), {padding: '14px 18px', borderBottom: '1px solid var(--line)', minHeight: '0'}).appendChild(el('div', {}, ...children)).parentNode;
const row = (id, pressed, select, ...content) => el('button', {type: 'button', class: 'record', 'data-record-id': id, 'aria-pressed': String(pressed), onclick: select}, ...content);
const put = (node, ...children) => node.replaceChildren(...children.flat(3).filter(Boolean));
const buttons = (...nodes) => css(el('div', {class: 'actions'}, nodes.filter(Boolean)), {display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px'});
const yesNo = [['true', 'On'], ['false', 'Off']];
const RATINGS = ['all', '7+', '13+', '16+', '18+'].map(r => [r, r]);
const control = (label, node) => css(el('label', {class: 'field'}, el('span', {}, label), node), {margin: '6px 12px'});
const progressText = (p, runtime) => !p ? 'not started' : p.completed ? 'watched' + (p.set_by === 'agent' ? ' (marked by hand)' : '') : p.position_seconds === 0 ? 'back at the start' + (p.set_by === 'agent' ? ' (set by hand)' : '')
  : 'at ' + minutes(p.position_seconds) + ' of ' + minutes(runtime) + (p.set_by === 'agent' ? ' (set by hand)' : '');

// Buttons for one playable (a film or an episode) as one profile.
function playableButtons(profile, playable, name, p) {
  const target = {id: profile.profile_id, playable_id: playable};
  return buttons(
    !(p && p.completed) && act('Mark watched', 'progress.set', () => ({heading: 'Mark “' + name + '” as watched for ' + profile.name + '?', note: 'This is recorded as marked by hand; it adds no viewing to the history.', submit: 'Mark watched',
      build: () => ({name: 'progress.set', args: {...target, patch: {completed: true}}})})),
    act('Set position', 'progress.set', () => ({heading: 'Position in “' + name + '” for ' + profile.name, fields: [{name: 'position', label: 'Position in seconds', type: 'number', value: p ? p.position_seconds : 0}],
      build: v => ({name: 'progress.set', args: {...target, patch: {position_seconds: Number(v.position)}}})})),
    p && (p.completed || p.position_seconds > 0) && act('Back to start', 'progress.set', () => ({heading: 'Put “' + name + '” back to the start for ' + profile.name + '?', submit: 'Back to start',
      build: () => ({name: 'progress.set', args: {...target, patch: {position_seconds: 0}}})})));
}

async function showBrowse(profiles) {
  if (state.as && !profiles.some(p => p.profile_id === state.as)) state.as = null;
  if (state.as === null && sessionStorage.getItem('lb-as') === null) state.as = state.account.account.owner_profile_id;
  keep('lb-as', state.as ?? '');
  const viewer = profiles.find(p => p.profile_id === state.as) || null;
  const {titles, total} = await call('catalog.search', {limit: 100, ...(viewer ? {id: viewer.profile_id} : {}), ...(state.query ? {query: state.query} : {}), ...(state.kind ? {kind: state.kind} : {}), ...(state.availability ? {availability: state.availability} : {})});
  if (!titles.some(t => t.title_id === state.title)) state.title = titles[0]?.title_id ?? null;
  const pick = id => { state.title = id; keep('lb-title', id); refresh(); };
  const select = (name, value, options, set) => el('select', {name, onchange: e => { set(e.target.value); refresh(); }}, options.map(([v, label]) => el('option', {value: v, selected: v === value}, label)));
  const search = el('input', {name: 'query', type: 'search', value: state.query, placeholder: 'Title, genre or words'});
  collection.replaceChildren(el('div', {class: 'collection-head'}, el('h2', {class: 'section-title'}, 'Catalog'), el('span', {class: 'collection-count'}, String(total))),
    control('Viewing as', select('viewing-as', state.as ?? '', [['', 'Nobody (whole catalog)'], ...profiles.map(p => [p.profile_id, p.name + ' · up to ' + p.maturity_ceiling])], v => { state.as = v || null; keep('lb-as', v); })),
    el('form', {onsubmit: e => { e.preventDefault(); state.query = search.value.trim(); refresh(); }}, control('Search', search)),
    control('Kind', select('kind', state.kind, [['', 'Films and series'], ['film', 'Films'], ['series', 'Series']], v => { state.kind = v; })),
    control('Availability', select('availability', state.availability, [['', 'Any'], ['available', 'Available'], ['leaving_soon', 'Leaving soon'], ['upcoming', 'Upcoming'], ['expired', 'Expired']], v => { state.availability = v; })),
    el('div', {class: 'records'}, titles.map(t => row(t.title_id, t.title_id === state.title, () => pick(t.title_id), el('span', {class: 'record-title'}, t.name),
      el('span', {class: 'record-subtitle'}, [t.kind, t.maturity, t.availability.replace('_', ' ')].join(' · '))))));
  if (!state.title) return put(detail, el('p', {class: 'empty'}, 'No titles match.'));
  const t = (await call('titles.get', {title_id: state.title, ...(viewer ? {id: viewer.profile_id} : {})})).title;
  const listed = viewer ? (await call('watchlist.list', {id: viewer.profile_id})).watchlist.some(w => w.title_id === t.title_id) : false;
  put(detail, card(el('h2', {'data-title-id': t.title_id}, t.name, chip(t.kind), chip(t.maturity), chip(t.availability.replace('_', ' '))),
    t.synopsis ? el('p', {class: 'body-text'}, t.synopsis) : null, line('Genres', t.genres.join(', ')), line('Available from', when(t.available_from)), line('Leaves', t.available_until ? when(t.available_until) : 'no end date'),
    t.kind === 'film' ? line('Runtime', minutes(t.runtime_seconds)) : line('Episodes', t.episode_count + ' in ' + t.season_count + (t.season_count === 1 ? ' season' : ' seasons')),
    viewer ? line('Viewing as', viewer.name) : el('p', {class: 'muted'}, 'Choose a profile under “Viewing as” to see progress and to change a list.'),
    viewer && t.kind === 'series' ? line('Next up', t.next_up ? 'Season ' + t.next_up.season + ', episode ' + t.next_up.number + ' · ' + t.next_up.name : 'nothing new to watch') : null,
    viewer && t.kind === 'film' ? line('Progress', progressText(t.progress, t.runtime_seconds)) : null,
    viewer ? buttons(!listed && act('Add to watchlist', 'watchlist.add', () => ({heading: 'Add “' + t.name + '” to ' + viewer.name + '’s watchlist?', submit: 'Add', build: () => ({name: 'watchlist.add', args: {id: viewer.profile_id, title_id: t.title_id}})}), true),
      listed && act('Remove from watchlist', 'watchlist.remove', () => ({heading: 'Remove “' + t.name + '” from ' + viewer.name + '’s watchlist?', submit: 'Remove', build: () => ({name: 'watchlist.remove', args: {id: viewer.profile_id, title_id: t.title_id}})}))) : null,
    viewer && t.kind === 'film' ? playableButtons(viewer, t.title_id, t.name, t.progress) : null),
    t.seasons.map(s => [css(el('h3', {class: 'section-title'}, 'Season ' + s.number), {padding: '14px 18px 0'}), s.episodes.map(e => card(el('h3', {'data-playable-id': e.playable_id}, e.number + '. ' + e.name, e.released ? null : chip('not released')),
      el('p', {class: 'muted'}, [minutes(e.runtime_seconds), (e.released ? 'released ' : 'due ') + when(e.released_at), viewer ? progressText(e.progress, e.runtime_seconds) : null].filter(Boolean).join(' · ')),
      viewer ? playableButtons(viewer, e.playable_id, e.name, e.progress) : null))]));
}

async function showProfiles(profiles) {
  if (!profiles.some(p => p.profile_id === state.profile)) state.profile = profiles[0]?.profile_id ?? null;
  const pick = id => { state.profile = id; keep('lb-profile', id); refresh(); };
  const settings = (p = {}) => [{name: 'name', label: 'Name', value: p.name}, {name: 'ceiling', label: 'Maturity ceiling', type: 'select', value: p.maturity_ceiling || '18+', options: RATINGS},
    {name: 'autoplay', label: 'Autoplay', type: 'select', value: String(p.autoplay ?? true), options: yesNo}, {name: 'episodes', label: 'Notices of new episodes', type: 'select', value: String(p.notify_new_episodes ?? true), options: yesNo},
    {name: 'leaving', label: 'Notices of titles leaving', type: 'select', value: String(p.notify_leaving ?? true), options: yesNo}];
  const values = v => ({name: v.name.trim(), maturity_ceiling: v.ceiling, autoplay: v.autoplay === 'true', notify_new_episodes: v.episodes === 'true', notify_leaving: v.leaving === 'true'});
  globalActions.replaceChildren(...[act('New profile', 'profiles.create', () => ({heading: 'New profile', note: 'A kids profile cannot go above 7+.',
    fields: [{name: 'kind', label: 'Kind', type: 'select', value: 'adult', options: [['adult', 'Adult'], ['kids', 'Kids']]}, ...settings({maturity_ceiling: '7+'})], submit: 'Create',
    build: v => ({name: 'profiles.create', args: {profile: {kind: v.kind, ...values(v)}}})}), true)].filter(Boolean));
  collection.replaceChildren(el('div', {class: 'collection-head'}, el('h2', {class: 'section-title'}, 'Profiles'), el('span', {class: 'collection-count'}, profiles.length + ' of ' + state.account.account.profile_limit)),
    el('div', {class: 'records'}, profiles.map(p => row(p.profile_id, p.profile_id === state.profile, () => pick(p.profile_id), el('span', {class: 'record-title'}, p.name),
      el('span', {class: 'record-subtitle'}, [p.kind, 'up to ' + p.maturity_ceiling, p.is_owner ? 'account holder' : null].filter(Boolean).join(' · '))))));
  if (!state.profile) return put(detail, el('p', {class: 'empty'}, 'No profiles.'));
  const id = state.profile, {profile: p, counts} = await call('profiles.get', {id});
  const [{watchlist}, started, {history, total}] = await Promise.all([call('watchlist.list', {id}), call('progress.list', {id, state: 'in_progress', limit: 20}), call('history.list', {id, include_hidden: state.hidden, limit: 30})]);
  const toggle = el('input', {type: 'checkbox', id: 'show-hidden', onchange: e => { state.hidden = e.target.checked; refresh(); }}); toggle.checked = state.hidden;
  put(detail, card(el('h2', {'data-profile-id': p.profile_id}, p.name, chip(p.kind), p.is_owner ? chip('account holder') : null), line('Maturity ceiling', p.maturity_ceiling), line('Autoplay', p.autoplay ? 'on' : 'off'),
    line('New-episode notices', p.notify_new_episodes ? 'on' : 'off'), line('Leaving notices', p.notify_leaving ? 'on' : 'off'),
    line('Stored for this profile', counts.history_rows + ' viewings · ' + counts.progress_rows + ' progress rows · ' + counts.watchlist_entries + ' list entries'),
    buttons(act('Edit profile', 'profiles.update', () => ({heading: 'Edit ' + p.name, fields: settings(p), build: v => ({name: 'profiles.update', args: {id, patch: values(v)}})})),
      !p.is_owner && act('Delete profile', 'profiles.delete', () => ({heading: 'Delete ' + p.name + '?', submit: 'Delete profile',
        note: 'This removes ' + counts.history_rows + ' viewings, ' + counts.progress_rows + ' progress rows and ' + counts.watchlist_entries + ' list entries. It cannot be undone.', build: () => ({name: 'profiles.delete', args: {id}})})))),
    card(el('h3', {}, 'Watchlist'), watchlist.length ? watchlist.map(w => item({'data-list-title': w.title_id}, el('p', {}, w.title.name, chip(w.title.availability.replace('_', ' '))),
      buttons(act('Remove', 'watchlist.remove', () => ({heading: 'Remove “' + w.title.name + '” from ' + p.name + '’s watchlist?', submit: 'Remove', build: () => ({name: 'watchlist.remove', args: {id, title_id: w.title_id}})}))))) : el('p', {class: 'muted'}, 'Nothing listed.')),
    card(el('h3', {}, 'Continue watching'), started.progress.length ? started.progress.map(r => el('p', {class: 'muted', 'data-progress-id': r.playable_id}, r.title_name + (r.season ? ' · S' + r.season + ' E' + r.number + ' ' + r.playable_name : '') + ' · ' + progressText(r, r.runtime_seconds)))
      : el('p', {class: 'muted'}, 'Nothing in progress.')),
    card(el('h3', {}, 'Viewing history'), el('label', {for: 'show-hidden'}, toggle, ' Show hidden viewings'), el('p', {class: 'muted'}, 'Showing ' + history.length + ' of ' + total + ', newest first.'),
      history.map(h => item({'data-history-id': h.history_id}, el('p', {}, h.title_name + (h.season ? ' · S' + h.season + ' E' + h.number + ' ' + h.playable_name : ''), h.hidden ? chip('hidden') : null),
        el('p', {class: 'muted'}, when(h.started_at) + ' · ' + minutes(h.seconds_watched) + ' · ' + h.device_name),
        buttons(act(h.hidden ? 'Unhide' : 'Hide', 'history.hide', () => ({heading: (h.hidden ? 'Show' : 'Hide') + ' this viewing of “' + h.title_name + '”?', note: 'Progress is not changed.', submit: h.hidden ? 'Unhide' : 'Hide',
          build: () => ({name: 'history.hide', args: {id, history_id: h.history_id, hidden: !h.hidden}})})))))));
}

async function showAccount() {
  const a = state.account.account, [{plans}, {charges}, {devices}] = await Promise.all([call('plans.list'), call('billing.history', {limit: 200}), call('devices.list')]);
  const current = plans.find(p => p.current), pending = a.pending;
  collection.replaceChildren();
  put(detail, card(el('h2', {'data-account-id': a.account_id}, 'Account', chip(a.status.replace('_', ' '))), line('Plan', current.name + ' · ' + money(current.price_cents) + ' a month'), line('Paid through', when(a.paid_through)),
    line('Profiles', a.profile_count + ' of ' + a.profile_limit), a.suspends_at ? line('Suspends at', when(a.suspends_at)) : null,
    line('Pending change', !pending ? 'none' : pending.kind === 'cancel' ? 'cancellation at ' + when(pending.due_at) : 'downgrade to ' + plans.find(p => p.plan_id === pending.plan_id).name + ' at ' + when(pending.due_at)),
    line('Next charge', a.next_charge ? money(a.next_charge.amount_cents) + ' for the period from ' + when(a.next_charge.period_start) : 'none'),
    buttons(pending?.kind !== 'cancel' && act('Cancel plan', 'plan.cancel', () => ({heading: 'Cancel the plan?', note: 'The account stays active until ' + when(a.paid_through) + '.', submit: 'Cancel plan', build: () => ({name: 'plan.cancel', args: {}})})),
      pending && act('Undo pending change', 'plan.resume', () => ({heading: 'Undo the pending change?', submit: 'Undo', build: () => ({name: 'plan.resume', args: {}})})))),
    card(el('h3', {}, 'Plans'), plans.map(p => item({'data-plan-id': p.plan_id}, el('p', {}, p.name, p.current ? chip('current') : null), el('p', {class: 'muted'}, [money(p.price_cents) + ' a month', p.max_profiles + ' profiles', p.quality,
      p.can_move_now ? (p.move === 'none' ? 'choosing it clears the pending change' : p.move + ' takes effect ' + when(p.takes_effect)) : 'not possible now: ' + p.blockers.join('; ')].join(' · ')),
      buttons(!(p.current && !pending) && act(p.current ? 'Keep ' + p.name : 'Move to ' + p.name, 'plan.change', () => ({heading: 'Move to ' + p.name + '?', note: p.move === 'downgrade' ? 'A downgrade takes effect when the paid period ends.' : null, submit: 'Confirm',
        build: () => ({name: 'plan.change', args: {id: p.plan_id}})})))))),
    card(el('h3', {}, 'Devices'), devices.map(d => item({'data-device-id': d.device_id}, el('p', {}, d.name, chip(d.status.replace('_', ' '))), el('p', {class: 'muted'}, d.kind + ' · last used ' + when(d.last_used_at)),
      buttons(d.status === 'signed_in' && act('Sign out', 'devices.sign_out', () => ({heading: 'Sign “' + d.name + '” out?', submit: 'Sign out', build: () => ({name: 'devices.sign_out', args: {id: d.device_id}})})))))),
    card(el('h3', {}, 'Charges'), [...charges].reverse().slice(0, 12).map(c => el('p', {class: 'muted', 'data-charge-id': c.charge_id}, when(c.at) + ' · ' + money(c.amount_cents) + ' · ' + c.result + (c.reason ? ' (' + c.reason + ')' : '') + ' · ' + c.plan_id))));
}

async function showNotifications() {
  const {notifications} = await call('notifications.list', {limit: 100});
  collection.replaceChildren();
  put(detail, notifications.length ? [...notifications].reverse().map(n => card(el('p', {'data-notification-id': n.notification_id}, n.text), el('p', {class: 'muted'}, n.kind + ' · ' + when(n.at)))) : el('p', {class: 'empty'}, 'No notifications.'));
}

async function refresh() {
  try {
    say('Loading…');
    state.tools = new Set((await request('/api/tools')).tools.map(t => t.name));
    state.account = await call('account.get');
    const profiles = (await call('profiles.list')).profiles;
    const current = VIEWS.find(v => v[0] === state.view) || VIEWS[0];
    title.textContent = current[1];
    nav.replaceChildren(...VIEWS.map(([id, label, symbol]) => el('button', {type: 'button', 'data-view': id, 'aria-current': id === current[0] ? 'page' : false, onclick: () => { state.view = id; keep('lb-view', id); refresh(); }},
      el('span', {class: 'nav-symbol', 'aria-hidden': 'true'}, symbol), el('span', {}, label))));
    globalActions.replaceChildren();
    const split = ['browse', 'profiles'].includes(current[0]);
    workspace.style.gridTemplateColumns = split ? '' : '1fr'; collection.hidden = !split;
    await ({browse: () => showBrowse(profiles), profiles: () => showProfiles(profiles), account: showAccount, notifications: showNotifications})[current[0]]();
    const a = state.account.account;
    say('Account ' + a.account_id + ' · ' + a.plan_id + ' plan · ' + a.status.replace('_', ' ') + ' · App time ' + when(state.account.now));
  } catch (e) { say(e.message, true); }
}
document.title = 'Lanternbox · PALE'; document.body.dataset.app = APP;
document.querySelector('#app').replaceChildren(el('div', {class: 'app-shell'},
  el('aside', {class: 'sidebar'}, el('div', {class: 'brand'}, el('span', {class: 'brand-mark', 'aria-hidden': 'true'}, 'L'), el('h1', {}, 'Lanternbox')), globalActions, nav),
  el('main', {class: 'app-main'}, el('header', {class: 'toolbar'}, title, el('button', {type: 'button', id: 'refresh', onclick: refresh}, 'Refresh')), status, workspace)), dialog);
(async () => {
  try {
    const token = new URLSearchParams(location.hash.slice(1)).get('access');
    if (token) { history.replaceState(null, '', location.pathname); ({csrf: state.csrf} = await request('/session', 'POST', {token})); }
    else ({csrf: state.csrf} = await request('/session'));
    await refresh();
  } catch (e) { say(e.message, true); }
})();
