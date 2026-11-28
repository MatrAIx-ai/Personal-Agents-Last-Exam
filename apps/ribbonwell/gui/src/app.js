import {el} from '/shared/client.js';
// Ribbonwell's business page. The App owns these views, labels and forms; the shared Host only serves the
// page and forwards permitted Agent MCP tools. Every value is rendered as text. There is no browser-side
// store: each view is read from the App again, and a form sends the version it saw when it opened.
const APP = 'ribbonwell';
const VIEWS = [['lists', 'Wish lists', '☰'], ['claims', 'My claims', '✓'], ['exchanges', 'Gift exchanges', '⇄'], ['notifications', 'Notifications', '•']];
const state = {csrf: '', tools: new Set(), view: sessionStorage.getItem('rw-view') || 'lists', list: sessionStorage.getItem('rw-list'), exchange: sessionStorage.getItem('rw-exchange'), removed: false, account: null};
// Layout uses the Host's shared stylesheet; the few App-specific touches are set through the CSSOM (the Host's policy forbids inline style text).
const css = (node, styles) => { Object.assign(node.style, styles); return node; };
const money = cents => cents === null ? 'no price' : '$' + (cents / 100).toFixed(2);
const when = iso => iso ? iso.replace('T', ' ').replace(/:\d\d([+-]\d\d:\d\d|Z)$/, ' (UTC$1)') : '—';
const status = el('p', {role: 'status', 'aria-live': 'polite', id: 'status'}, 'Connecting…');
const nav = el('nav', {'aria-label': 'Ribbonwell navigation'}), title = el('h2', {class: 'section-title'}, '');
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
      : f.type === 'textarea' ? el('textarea', {name: f.name, rows: 3}, f.value ?? '') : el('input', {name: f.name, type: f.type === 'number' ? 'number' : 'text', value: f.value ?? '', placeholder: f.placeholder || ''});
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
const blank = v => v.trim() === '' ? null : v.trim();
const number = v => v.trim() === '' ? undefined : Number(v);
const pairs = text => text.split('\n').map(line => line.split(',').map(x => x.trim()).filter(Boolean)).filter(p => p.length);
const itemFields = (i = {}) => [{name: 'name', label: 'Name', value: i.name}, {name: 'variant', label: 'Variant (size, colour…)', value: i.variant}, {name: 'price', label: 'Price in cents', type: 'number', value: i.price_cents},
  {name: 'store', label: 'Shop', value: i.store}, {name: 'note', label: 'Note for shoppers', type: 'textarea', value: i.note},
  {name: 'priority', label: 'Priority', type: 'select', value: i.priority || 'medium', options: [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]}, {name: 'quantity', label: 'Quantity wanted (1–20)', type: 'number', value: i.quantity_wanted ?? 1}];
const itemValues = v => ({name: v.name.trim(), variant: blank(v.variant), price_cents: v.price.trim() === '' ? null : Number(v.price), store: blank(v.store), note: blank(v.note), priority: v.priority, quantity_wanted: Number(v.quantity)});
const line = (label, value) => el('div', {class: 'metadata-line'}, el('span', {}, label), el('strong', {}, value));
const chip = text => el('span', {class: 'tag'}, text);
const card = (...children) => css(el('article', {}), {padding: '14px 18px', borderBottom: '1px solid var(--line)', minHeight: '0'}).appendChild(el('div', {}, ...children)).parentNode;
const row = (id, pressed, select, ...content) => el('button', {type: 'button', class: 'record', 'data-record-id': id, 'aria-pressed': String(pressed), onclick: select}, ...content);
const put = (node, ...children) => node.replaceChildren(...children.flat(3).filter(Boolean));
const buttons = (...nodes) => css(el('div', {class: 'actions'}, nodes.filter(Boolean)), {display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px'});

async function showLists() {
  const lists = (await call('lists.list', {limit: 100})).lists, groupName = Object.fromEntries((await call('groups.list')).groups.map(g => [g.group_id, g.name]));
  if (!lists.some(l => l.list_id === state.list)) state.list = (lists.find(l => l.view === 'own') || lists[0])?.list_id;
  const pick = id => { state.list = id; sessionStorage.setItem('rw-list', id); refresh(); };
  collection.replaceChildren(el('div', {class: 'collection-head'}, el('h2', {class: 'section-title'}, 'Lists'), el('span', {class: 'collection-count'}, String(lists.length))),
    el('div', {class: 'records'}, lists.map(l => row(l.list_id, l.list_id === state.list, () => pick(l.list_id), el('span', {class: 'record-title'}, l.owner_name),
      el('span', {class: 'record-subtitle'}, [groupName[l.group_id], l.view === 'own' ? 'your list' : l.view === 'managed' ? 'you manage it' : null, l.item_count + ' items', l.occasion_name].filter(Boolean).join(' · '))))));
  if (!state.list) return put(detail, el('p', {class: 'empty'}, 'No lists.'));
  const {list, items} = await call('lists.get', {id: state.list, include_removed: state.removed}), editor = list.view !== 'other';
  const toggle = el('input', {type: 'checkbox', id: 'show-removed', onchange: e => { state.removed = e.target.checked; refresh(); }}); toggle.checked = state.removed;
  put(detail, card(el('h2', {}, list.owner_name + '’s list'), line('Group', groupName[list.group_id]),
    line('Occasion', list.occasion_name ? list.occasion_name + ' · ' + when(list.occasion_date) : '—'), list.view === 'own' ? el('p', {class: 'muted'}, 'This is your own list: Ribbonwell never shows you who has reserved or bought anything on it.') : null,
    buttons(editor && act('Add item', 'items.add', () => ({heading: 'Add an item', fields: itemFields(), build: v => ({name: 'items.add', args: {id: list.list_id, item: itemValues(v)}})}), true),
      editor && act('Edit occasion', 'lists.update', () => ({heading: 'Occasion', fields: [{name: 'name', label: 'Occasion name', value: list.occasion_name}, {name: 'date', label: 'Date and time with offset', value: list.occasion_date, placeholder: '2027-02-11T00:00:00-05:00'}],
        build: v => ({name: 'lists.update', args: {id: list.list_id, patch: {occasion_name: blank(v.name), occasion_date: blank(v.date)}}})})),
      el('label', {for: 'show-removed'}, toggle, ' Show removed items'))),
    items.length ? items.map(i => {
      const mine = (i.claims || []).find(c => c.mine);
      return card(el('h3', {'data-item-id': i.item_id}, i.name, i.status === 'removed' ? chip('removed') : null), el('p', {class: 'muted'}, [i.variant, money(i.price_cents), i.store, i.priority + ' priority', 'wants ' + i.quantity_wanted].filter(Boolean).join(' · ')),
        i.note ? el('p', {class: 'body-text'}, i.note) : null,
        i.claims_hidden ? null : el('p', {}, i.remaining + ' left to give', i.over_claimed ? chip('over-claimed') : null),
        i.claims_hidden ? null : (i.claims.length ? i.claims.map(c => el('p', {class: 'muted', 'data-claim-id': c.claim_id}, (c.mine ? 'You' : c.member_name) + ' · ' + c.quantity + ' · ' + c.status + (c.reserved_until ? ' until ' + when(c.reserved_until) : ''))) : el('p', {class: 'muted'}, 'Nobody has claimed this yet.')),
        buttons(editor && i.status === 'listed' && act('Edit', 'items.update', () => ({heading: 'Edit “' + i.name + '”', fields: itemFields(i), build: v => ({name: 'items.update', args: {id: i.item_id, patch: itemValues(v)}})})),
          editor && i.status === 'listed' && act('Remove', 'items.remove', () => ({heading: 'Remove “' + i.name + '” from the list?', note: 'You can restore it later.', submit: 'Remove', build: () => ({name: 'items.remove', args: {id: i.item_id}})})),
          editor && i.status === 'removed' && act('Restore', 'items.restore', () => ({heading: 'Restore “' + i.name + '”?', submit: 'Restore', build: () => ({name: 'items.restore', args: {id: i.item_id}})})),
          list.view !== 'own' && i.status === 'listed' && !mine && act('Reserve', 'claims.reserve', () => ({heading: 'Reserve “' + i.name + '”', note: 'The hold lasts 14 days unless you extend it or mark it purchased.',
            fields: [{name: 'quantity', label: 'Quantity', type: 'number', value: 1}, {name: 'note', label: 'Private note (only you see it)', type: 'textarea'}], submit: 'Reserve',
            build: v => ({name: 'claims.reserve', args: {id: i.item_id, quantity: Number(v.quantity), ...(blank(v.note) ? {note: blank(v.note)} : {})}})}), true)));
    }) : el('p', {class: 'empty'}, 'No items on this list.'));
}
async function showClaims() {
  const {claims} = await call('claims.list', {limit: 100});
  collection.replaceChildren();
  put(detail, claims.length ? claims.map(c => card(el('h3', {'data-claim-id': c.claim_id}, c.item_name, chip(c.status), c.item_removed ? chip('item removed') : null, c.over_budget ? chip('over budget') : null),
    el('p', {class: 'muted'}, ['quantity ' + c.quantity, c.reserved_until ? 'held until ' + when(c.reserved_until) : null, c.for_exchange_id ? 'for exchange ' + c.for_exchange_id : null].filter(Boolean).join(' · ')),
    c.changed_fields.length ? el('p', {}, 'Changed by the owner since you claimed: ' + c.changed_fields.join(', ')) : null, c.note ? el('p', {class: 'body-text'}, c.note) : null,
    c.status === 'released' ? null : buttons(
      act('Edit claim', 'claims.update', () => ({heading: 'Edit claim on “' + c.item_name + '”', fields: [{name: 'quantity', label: 'Quantity', type: 'number', value: c.quantity}, {name: 'note', label: 'Private note', type: 'textarea', value: c.note},
        {name: 'until', label: 'Hold until (leave blank to keep)', placeholder: '2026-12-05T10:00:00-05:00'}, {name: 'exchange', label: 'Exchange ID (blank for none)', value: c.for_exchange_id}],
        build: v => ({name: 'claims.update', args: {id: c.claim_id, patch: {quantity: Number(v.quantity), note: blank(v.note), ...(blank(v.until) ? {reserved_until: blank(v.until)} : {}), for_exchange_id: blank(v.exchange)}}})})),
      c.status !== 'purchased' && act('Mark purchased', 'claims.update', () => ({heading: 'Mark “' + c.item_name + '” as purchased?', submit: 'Mark purchased', build: () => ({name: 'claims.update', args: {id: c.claim_id, patch: {status: 'purchased'}}})}), true),
      c.status === 'purchased' && act('Back to reserved', 'claims.update', () => ({heading: 'Move “' + c.item_name + '” back to reserved?', submit: 'Confirm', build: () => ({name: 'claims.update', args: {id: c.claim_id, patch: {status: 'reserved'}}})})),
      act('Release', 'claims.release', () => ({heading: 'Release your claim on “' + c.item_name + '”?', submit: 'Release', build: () => ({name: 'claims.release', args: {id: c.claim_id}})}))))) : el('p', {class: 'empty'}, 'You have not claimed anything.'));
}
async function showExchanges() {
  const {exchanges} = await call('exchanges.list'), {groups} = await call('groups.list');
  if (!exchanges.some(x => x.exchange_id === state.exchange)) state.exchange = exchanges.at(-1)?.exchange_id;
  const pick = id => { state.exchange = id; sessionStorage.setItem('rw-exchange', id); refresh(); };
  const dates = (x = {}) => [{name: 'name', label: 'Name', value: x.name}, {name: 'budget', label: 'Budget in cents (blank for none)', type: 'number', value: x.budget_cents}, {name: 'join_by', label: 'Join by (with offset)', value: x.join_by, placeholder: '2026-11-30T23:59:00-05:00'},
    {name: 'date', label: 'Exchange date (with offset)', value: x.exchange_date, placeholder: '2026-12-24T18:00:00-05:00'}, {name: 'exclusions', label: 'Exclusions: one pair of member IDs per line, separated by a comma', type: 'textarea', value: (x.exclusions || []).map(p => p.join(', ')).join('\n')}];
  const fromForm = v => ({name: v.name.trim(), budget_cents: v.budget.trim() === '' ? null : Number(v.budget), join_by: v.join_by.trim(), exchange_date: v.date.trim(), exclusions: pairs(v.exclusions)});
  globalActions.replaceChildren(...[act('New exchange', 'exchanges.create', () => ({heading: 'New gift exchange', fields: [{name: 'group', label: 'Group', type: 'select', value: groups[0].group_id, options: groups.map(g => [g.group_id, g.name])}, ...dates()],
    build: v => ({name: 'exchanges.create', args: {id: v.group, exchange: fromForm(v)}})}), true)].filter(Boolean));
  collection.replaceChildren(el('div', {class: 'collection-head'}, el('h2', {class: 'section-title'}, 'Exchanges'), el('span', {class: 'collection-count'}, String(exchanges.length))),
    el('div', {class: 'records'}, exchanges.map(x => row(x.exchange_id, x.exchange_id === state.exchange, () => pick(x.exchange_id), el('span', {class: 'record-title'}, x.name), el('span', {class: 'record-subtitle'}, x.status + ' · ' + x.participants.length + ' joined')))));
  const x = exchanges.find(x => x.exchange_id === state.exchange);
  if (!x) return put(detail, el('p', {class: 'empty'}, 'No exchanges.'));
  put(detail, card(el('h2', {'data-exchange-id': x.exchange_id}, x.name, chip(x.status)), line('Join by', when(x.join_by)), line('Exchange date', when(x.exchange_date)), line('Budget', x.budget_cents === null ? '—' : money(x.budget_cents)),
    line('Participants', x.participants.map(p => p.name).join(', ') || 'nobody yet'), line('You', (x.is_organizer ? 'organizer' : 'member') + (x.joined ? ', joined' : ', not joined')),
    line('Your giftee', x.my_giftee ? x.my_giftee.name : x.drawn_at ? 'none (you did not take part)' : 'not drawn yet'),
    x.is_organizer ? line('Draw', x.draw_ready ? 'ready' : 'not ready: ' + x.draw_blockers.join(', ')) : null,
    buttons(!x.joined && act('Join', 'exchanges.join', () => ({heading: 'Join “' + x.name + '”?', submit: 'Join', build: () => ({name: 'exchanges.join', args: {id: x.exchange_id}})}), true),
      x.joined && act('Leave', 'exchanges.leave', () => ({heading: 'Leave “' + x.name + '”?', submit: 'Leave', build: () => ({name: 'exchanges.leave', args: {id: x.exchange_id}})})),
      x.is_organizer && act('Edit exchange', 'exchanges.update', () => ({heading: 'Edit “' + x.name + '”', fields: dates(x), build: v => ({name: 'exchanges.update', args: {id: x.exchange_id, patch: fromForm(v)}})})),
      x.is_organizer && act('Run the draw', 'exchanges.draw', () => ({heading: 'Draw names for “' + x.name + '”?', note: 'A draw cannot be undone.', submit: 'Draw', build: () => ({name: 'exchanges.draw', args: {id: x.exchange_id}})})))));
}
async function showNotifications() {
  // The log is read oldest first, 100 at a time, until all of it is here; it is shown newest first.
  const notifications = [];
  for (;;) { const part = await call('notifications.list', {limit: 100, offset: notifications.length}); notifications.push(...part.notifications); if (!part.notifications.length || notifications.length >= part.total) break; }
  collection.replaceChildren();
  put(detail, notifications.length ? [...notifications].reverse().map(n => card(el('p', {'data-notification-id': n.notification_id}, n.text), el('p', {class: 'muted'}, n.kind + ' · ' + when(n.at)))) : el('p', {class: 'empty'}, 'No notifications.'));
}
async function refresh() {
  try {
    say('Loading…');
    state.tools = new Set((await request('/api/tools')).tools.map(t => t.name));
    state.account = await call('account.get');
    const current = VIEWS.find(v => v[0] === state.view) || VIEWS[0];
    title.textContent = current[1];
    nav.replaceChildren(...VIEWS.map(([id, label, symbol]) => el('button', {type: 'button', 'data-view': id, 'aria-current': id === current[0] ? 'page' : false, onclick: () => { state.view = id; sessionStorage.setItem('rw-view', id); refresh(); }},
      el('span', {class: 'nav-symbol', 'aria-hidden': 'true'}, symbol), el('span', {}, label))));
    globalActions.replaceChildren();
    const split = ['lists', 'exchanges'].includes(current[0]);
    workspace.style.gridTemplateColumns = split ? '' : '1fr'; collection.hidden = !split;
    await ({lists: showLists, claims: showClaims, exchanges: showExchanges, notifications: showNotifications})[current[0]]();
    say('Signed in as ' + state.account.account.name + ' · App time ' + when(state.account.now));
  } catch (e) { say(e.message, true); }
}
document.title = 'Ribbonwell · PALE'; document.body.dataset.app = APP;
document.querySelector('#app').replaceChildren(el('div', {class: 'app-shell'},
  el('aside', {class: 'sidebar'}, el('div', {class: 'brand'}, el('span', {class: 'brand-mark', 'aria-hidden': 'true'}, 'R'), el('h1', {}, 'Ribbonwell')), globalActions, nav),
  el('main', {class: 'app-main'}, el('header', {class: 'toolbar'}, title, el('button', {type: 'button', id: 'refresh', onclick: refresh}, 'Refresh')), status, workspace)), dialog);
(async () => {
  try {
    const token = new URLSearchParams(location.hash.slice(1)).get('access');
    if (token) { history.replaceState(null, '', location.pathname); ({csrf: state.csrf} = await request('/session', 'POST', {token})); }
    else ({csrf: state.csrf} = await request('/session'));
    await refresh();
  } catch (e) { say(e.message, true); }
})();
