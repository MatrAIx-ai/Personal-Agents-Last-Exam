import {mount, el, tag, textBlock, metadata} from '/shared/client.js';
// App-owned Hopline interface: trips, stations and elevators, alerts, routes, fare cards, subscriptions
// and notices for one rider. All data comes from the Agent MCP tools; the Host adds nothing.
// The shared shell lists one collection; this controller loads every record kind in `load` and renders
// its own sections, so `list` is used only for the version that writes must carry.

let chosen = null; // {kind, id}: the record shown in the detail pane (transient UI state)
let zone = 'America/New_York', asOf = null; // the network's time zone and the virtual time of the last read
const money = c => (c < 0 ? '-' : '') + '$' + (Math.abs(c || 0) / 100).toFixed(2);
const label = s => String(s || '').replace(/_/g, ' ');
const time = t => (t ? new Intl.DateTimeFormat('en-US', {weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: zone, timeZoneName: 'short'}).format(new Date(t)) : '—');
const choose = (ui, kind, id) => { chosen = {kind, id}; ui.navigate(ui.section).catch(ui.error); };
const row = (ui, kind, id, title, subtitle) => el('button', {type: 'button', class: 'record', 'data-record-id': id,
  'aria-pressed': chosen && chosen.kind === kind && chosen.id === id, onclick: () => choose(ui, kind, id)},
  el('span', {class: 'record-title'}, title), el('span', {class: 'record-subtitle'}, subtitle));
const act = (ui, text, tool, values) => ui.has(tool) ? el('button', {type: 'button', onclick: () => ui.action(tool, values)}, text) : null;
// One-click actions that need no input run directly (with the version and a request ID), without a form.
const now = (ui, text, tool, args) => ui.has(tool) ? el('button', {type: 'button', onclick: () => ui.perform(tool, args).catch(ui.error)}, text) : null;
const actions = (...buttons) => el('div', {class: 'detail-actions'}, ...buttons.filter(Boolean));
const stopName = (ui, id) => ui.aux.stops.find(s => s.stop_id === id)?.name || ui.aux.places.find(p => p.place_id === id)?.name || id;
const inHour = () => { const t = Date.parse(asOf || new Date().toISOString()); return {from: new Date(t).toISOString(), to: new Date(t + 3600e3).toISOString()}; };
const month = () => new Intl.DateTimeFormat('en-CA', {year: 'numeric', month: '2-digit', timeZone: zone}).format(new Date(asOf || Date.now()));

async function load(ui) {
  const call = async (name, args = {}) => (ui.has(name) ? ui.call(name, args) : {});
  const [network, saved, subs, notes, cards, alerts] = await Promise.all([call('hopline.places.search', {}), call('hopline.saved.list'),
    call('hopline.subscriptions.list'), call('hopline.notifications.list'), call('hopline.cards.get'), call('hopline.alerts.list')]);
  asOf = network.as_of || asOf;
  const stops = network.stops || [], stations = [];
  for (const s of stops.filter(x => x.kind === 'station')) stations.push((await call('hopline.stops.get', {stop_id: s.stop_id})).stop);
  const routeIds = [...new Set(stops.flatMap(s => s.routes))].sort(), routes = [];
  for (const id of routeIds) routes.push((await call('hopline.routes.get', {route_id: id})).route);
  return {places: network.places || [], stops, stations: stations.filter(Boolean), routes: routes.filter(Boolean), saved: saved.saved || [],
    subscriptions: subs.subscriptions || [], notifications: notes.notifications || [], cards: cards.cards || [], alerts: alerts.alerts || []};
}
const outCount = st => st.facilities.filter(f => f.status === 'out_of_service').length;

const SECTIONS = {
  trips: {label: 'Saved trips', symbol: '★',
    items: ui => ui.aux.saved.map(s => row(ui, 'saved', s.saved_id, s.label, s.kind === 'commute'
      ? `commute · ${s.window.start}–${s.window.end} · ${s.step_free ? 'step-free' : 'any route'}` : `place · ${stopName(ui, s.place_ref)}`))},
  stations: {label: 'Stations & elevators', symbol: '⇵',
    items: ui => ui.aux.stations.map(st => row(ui, 'station', st.stop_id, st.name,
      outCount(st) ? `${outCount(st)} out of service · ${st.routes.join(', ')}` : `all ${st.facilities.length} facilities working · ${st.routes.join(', ')}`))},
  alerts: {label: 'Alerts', symbol: '⚠',
    items: ui => ui.aux.alerts.map(a => row(ui, 'alert', a.alert_id, a.header, `${label(a.status)} · ${label(a.effect)} · version ${a.latest_version}`))},
  routes: {label: 'Routes', symbol: '⇢',
    items: ui => ui.aux.routes.map(r => row(ui, 'route', r.route_id, r.name, `${r.mode} · ${r.patterns.length} patterns`))},
  cards: {label: 'Cards', symbol: '▭',
    items: ui => ui.aux.cards.map(c => row(ui, 'card', c.card_id, c.label, `${c.card_id} · ${c.status} · ${money(c.spendable_cents)}${c.pending_cents ? ' + ' + money(c.pending_cents) + ' pending' : ''}`))},
  subscriptions: {label: 'Subscriptions', symbol: '◎',
    items: ui => ui.aux.subscriptions.map(s => row(ui, 'subscription', s.subscription_id, `${label(s.target.kind)} ${s.target.kind === 'commute' ? ui.aux.saved.find(x => x.saved_id === s.target.id)?.label || s.target.id : s.target.id}`,
      `${s.status} · ${s.delivery}${s.quiet_hours ? ' · quiet ' + s.quiet_hours.start + '–' + s.quiet_hours.end : ''}`))},
  notices: {label: 'Notices', symbol: '✉',
    items: ui => [...ui.aux.notifications].reverse().map(n => row(ui, 'notification', n.notification_id, n.title, `${label(n.status)} · ${time(n.created_at)}${n.acknowledged_at ? ' · read' : ''}`))}
};

function detail(ui) {
  const a = ui.aux, find = (list, key) => (list || []).find(x => x[key] === chosen?.id);
  if (!chosen) return overview(ui);
  if (chosen.kind === 'saved') {
    const s = find(a.saved, 'saved_id');
    if (!s) return overview(ui);
    if (s.kind === 'place') return el('article', {class: 'task-reader'},
      actions(act(ui, 'Plan from here', 'hopline.trips.plan', {from: s.place_ref, depart_at: asOf}),
        act(ui, 'Remove', 'hopline.saved.remove', {saved_id: s.saved_id})),
      el('p', {class: 'kicker'}, 'Saved place'), el('h2', {}, s.label), metadata('Place', stopName(ui, s.place_ref)), metadata('Saved', time(s.created_at)));
    const day = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return el('article', {class: 'task-reader'},
      actions(act(ui, 'Plan this commute', 'hopline.trips.plan', {from: s.from_ref, to: s.to_ref, step_free: s.step_free, max_transfers: s.max_transfers, max_walk_m: s.max_walk_m, depart_at: asOf}),
        act(ui, 'Subscribe', 'hopline.subscriptions.create', {target: {kind: 'commute', id: s.saved_id}}),
        act(ui, 'Remove', 'hopline.saved.remove', {saved_id: s.saved_id})),
      el('p', {class: 'kicker'}, 'Saved commute'), el('h2', {}, s.label),
      metadata('From', stopName(ui, s.from_ref)), metadata('To', stopName(ui, s.to_ref)), metadata('Days', s.window.days.map(d => day[d - 1]).join(', ')),
      metadata('Departure window', `${s.window.start}–${s.window.end}`), metadata('Step-free', s.step_free ? 'yes' : 'no'),
      metadata('Max walk', s.max_walk_m + ' m'), metadata('Max transfers', String(s.max_transfers)), metadata('Avoid', s.avoid_modes.join(', ') || 'nothing'));
  }
  if (chosen.kind === 'station') {
    const st = find(a.stations, 'stop_id');
    if (!st) return overview(ui);
    return el('article', {class: 'task-reader'},
      actions(act(ui, 'Departures next hour', 'hopline.departures.list', {stop_id: st.stop_id, ...inHour()}),
        act(ui, 'Plan from here', 'hopline.trips.plan', {from: st.stop_id, depart_at: asOf}),
        act(ui, 'Subscribe to this station', 'hopline.subscriptions.create', {target: {kind: 'stop', id: st.stop_id}}),
        act(ui, 'Station details', 'hopline.stops.get', {stop_id: st.stop_id})),
      el('p', {class: 'kicker'}, `Station · ${st.step_free ? 'step-free' : 'not step-free'}`), el('h2', {}, st.name),
      metadata('Lines', st.routes.join(', ')),
      el('section', {}, el('h3', {}, 'Elevators, escalators and ramps'), ...st.facilities.map(f => metadata(`${f.code} · ${f.kind}`,
        f.status === 'out_of_service' ? `out of service since ${time(f.since)}${f.expected_return ? (f.estimate_passed ? ' · estimate passed (' + time(f.expected_return) + '), not restored' : ' · expected back ' + time(f.expected_return) + ' (estimate)') : ''}` : 'in service'))),
      st.alerts.length ? el('section', {}, el('h3', {}, 'Alerts'), ...st.alerts.map(x => metadata(label(x.status), x.header))) : null);
  }
  if (chosen.kind === 'alert') {
    const al = find(a.alerts, 'alert_id');
    if (!al) return overview(ui);
    return el('article', {class: 'task-reader'}, actions(act(ui, 'Version chain', 'hopline.alerts.get', {alert_id: al.alert_id})),
      el('p', {class: 'kicker'}, `${label(al.status)} · ${label(al.effect)} · ${label(al.cause)}`), el('h2', {}, al.header),
      al.description ? textBlock(al.description) : null,
      ...al.active_periods.map(p => metadata('In effect', `${time(p.start)} to ${p.end ? time(p.end) : 'further notice'}`)),
      metadata('Routes', al.informed.route_ids.join(', ')), metadata('Stops', al.informed.stop_ids.map(id => stopName(ui, id)).join(', ')),
      metadata('Facilities', al.informed.facility_ids.join(', ')), metadata('Moved to', al.replacement_stop_id && stopName(ui, al.replacement_stop_id)),
      metadata('Latest version', `v${al.latest_version} (${al.msg_type}) · ${time(al.issued_at)}`));
  }
  if (chosen.kind === 'route') {
    const r = find(a.routes, 'route_id');
    if (!r) return overview(ui);
    return el('article', {class: 'task-reader'}, el('p', {class: 'kicker'}, r.mode), el('h2', {}, r.name), metadata('Trip IDs', r.trip_id_rule),
      ...r.patterns.map(p => el('section', {}, el('h3', {}, `${p.direction.toUpperCase()} · ${p.headsign}`),
        metadata('Stops', p.stops.map(s => `${s.name} (+${s.offset_min})`).join(' → ')),
        ...Object.entries(p.frequencies).filter(([, f]) => f.length).map(([k, f]) => metadata(label(k), f.map(x => `${x.start}–${x.end} every ${x.headway_min} min`).join('; '))))),
      r.alerts.length ? el('section', {}, el('h3', {}, 'Alerts'), ...r.alerts.map(x => metadata(label(x.status), x.header))) : null);
  }
  if (chosen.kind === 'card') {
    const c = find(a.cards, 'card_id');
    if (!c) return overview(ui);
    const live = c.status === 'active', method = 'pm-visa';
    const scheduled = c.passes.filter(p => p.status === 'scheduled');
    return el('article', {class: 'task-reader'},
      actions(live ? act(ui, 'Add value', 'hopline.cards.add_value', {card_id: c.card_id, payment_method_id: method}) : null,
        live ? act(ui, 'Buy a monthly pass', 'hopline.passes.purchase', {card_id: c.card_id, product: 'monthly', start_month: month()}) : null,
        live ? act(ui, 'Autoreload', 'hopline.cards.set_autoreload', {card_id: c.card_id, rule: c.autoreload}) : null,
        live ? act(ui, 'Apply for a reduced fare', 'hopline.reduced_fare.apply', {card_id: c.card_id}) : null,
        ...scheduled.map(p => act(ui, `Cancel ${p.month} pass`, 'hopline.passes.cancel', {pass_id: p.pass_id})),
        live ? act(ui, 'Report lost', 'hopline.cards.report_lost', {card_id: c.card_id}) : null,
        act(ui, 'History', 'hopline.cards.history', {card_id: c.card_id, from: new Date(Date.parse(asOf) - 30 * 86400e3).toISOString(), to: asOf})),
      el('p', {class: 'kicker'}, `${c.card_id} · ${c.status}`), el('h2', {}, `${c.label} · ${money(c.spendable_cents)}`),
      c.replaced_by ? el('div', {class: 'tags'}, tag('Replaced by ' + c.replaced_by)) : null,
      metadata('Holder', c.holder_name), metadata('Spendable', money(c.spendable_cents)), metadata('Pending loads', c.pending_loads.map(l => `${money(l.amount_cents)} (${l.entry_id}${l.source === 'autoreload' ? ', autoreload' : ''})`).join(', ') || 'none'),
      metadata('Owed replacement fee', c.fee_owed_cents ? money(c.fee_owed_cents) : null),
      metadata('Fares now', `rail ${money(c.fares.rail)} · bus ${money(c.fares.bus)}`),
      metadata('This week', `${money(c.weekly_cap.paid_cents)} of ${money(c.weekly_cap.cap_cents)} cap · ${money(c.weekly_cap.remaining_cents)} left`),
      metadata('Reduced fare', c.reduced_fare ? `${c.reduced_fare.program} · ${c.reduced_fare.status} until ${time(c.reduced_fare.expires_at)}` : 'none'),
      metadata('Application', c.application ? `${c.application.program} · ${c.application.status}` : null),
      metadata('Autoreload', c.autoreload ? `below ${money(c.autoreload.threshold_cents)} add ${money(c.autoreload.amount_cents)} (${c.autoreload.payment_method_id})` : 'off'),
      el('section', {}, el('h3', {}, 'Passes'), ...(c.passes.length ? c.passes.map(p => metadata(p.month, `${p.product} · ${p.status}`)) : [el('p', {class: 'muted'}, 'No passes.')])));
  }
  if (chosen.kind === 'subscription') {
    const s = find(a.subscriptions, 'subscription_id');
    if (!s) return overview(ui);
    return el('article', {class: 'task-reader'},
      actions(act(ui, 'Change', 'hopline.subscriptions.update', {subscription_id: s.subscription_id, ...(s.window ? {window: s.window} : {}), ...(s.quiet_hours ? {quiet_hours: s.quiet_hours} : {}),
          ...(s.delay_threshold_min ? {delay_threshold_min: s.delay_threshold_min} : {}), ...(s.low_balance_cents !== null ? {low_balance_cents: s.low_balance_cents} : {}), urgent_override: s.urgent_override, delivery: s.delivery}),
        now(ui, s.status === 'active' ? 'Pause' : 'Resume', 'hopline.subscriptions.update', {subscription_id: s.subscription_id, status: s.status === 'active' ? 'paused' : 'active'}),
        now(ui, 'Delete', 'hopline.subscriptions.delete', {subscription_id: s.subscription_id})),
      el('p', {class: 'kicker'}, `${s.subscription_id} · ${s.status}`), el('h2', {}, `${label(s.target.kind)} ${s.target.id}`),
      metadata('Delivery', s.delivery), metadata('Quiet hours', s.quiet_hours ? `${s.quiet_hours.start}–${s.quiet_hours.end}` : 'none'),
      metadata('Urgent alerts override quiet hours', s.urgent_override ? 'yes' : 'no'), metadata('Delay threshold', s.delay_threshold_min ? s.delay_threshold_min + ' min' : null),
      metadata('Low balance', s.low_balance_cents !== null ? money(s.low_balance_cents) : null),
      metadata('Window', s.window ? `${s.window.days.join(',')} ${s.window.start}–${s.window.end}` : 'any time'),
      el('section', {}, el('h3', {}, 'Revisions'), ...s.history.map(h => metadata(`r${h.revision} · ${time(h.at)}`, h.action))));
  }
  if (chosen.kind === 'notification') {
    const n = find(a.notifications, 'notification_id');
    if (!n) return overview(ui);
    return el('article', {class: 'task-reader'}, actions(!n.acknowledged_at ? now(ui, 'Mark as read', 'hopline.notifications.acknowledge', {notification_id: n.notification_id}) : null),
      el('p', {class: 'kicker'}, `${label(n.status)} · ${n.subscription_id}${n.urgent ? ' · urgent' : ''}`), el('h2', {}, n.title), el('div', {class: 'tags'}, tag(time(n.time))),
      textBlock(n.body), metadata('Release', n.release_at && time(n.release_at)), metadata('Delivery', n.outcome ? `${n.outcome.status}${n.outcome.code ? ' (' + n.outcome.code + ')' : ''}` : null));
  }
  return overview(ui);
}

function overview(ui) {
  const a = ui.aux, out = a.stations.flatMap(st => st.facilities.filter(f => f.status === 'out_of_service').map(f => `${f.code} at ${st.name}`));
  return el('article', {class: 'task-reader'},
    actions(act(ui, 'Search places', 'hopline.places.search', {}), act(ui, 'Fares and passes', 'hopline.fares.products', {})),
    el('p', {class: 'kicker'}, 'Ashford transit'), el('h2', {}, 'Your trips and cards'),
    metadata('As of', time(asOf)), metadata('Out of service', out.join(', ') || 'nothing'),
    metadata('Active alerts', String(a.alerts.filter(x => x.status === 'active').length)),
    metadata('Cards', a.cards.map(c => `${c.label} ${money(c.spendable_cents)}`).join(' · ')),
    metadata('Unread notices', String(a.notifications.filter(n => !n.acknowledged_at).length)));
}

mount({
  id: 'hopline', title: 'Hopline', description: 'Trips, elevator status, service alerts and your fare cards in Ashford.',
  symbol: '⇄', searchLabel: 'Search this section', initialSection: 'trips',
  // The list call supplies the version for writes; records are rendered from `load`.
  list: 'hopline.saved.list', collection: 'none', listArgs: {}, get: 'hopline.saved.list', item: 'saved',
  heading: () => 'Hopline', subtitle: () => '',
  load,
  sections: ui => Object.entries(SECTIONS).map(([id, s]) => ({id, label: `${s.label}${ui.aux.cards ? ' (' + s.items(ui).length + ')' : ''}`, symbol: s.symbol, count: false})),
  renderList: (shown, ui) => {
    // The search box filters the current section's rows; the count shows what is listed.
    const q = (document.querySelector('input[type=search]')?.value || '').trim().toLowerCase();
    const items = (ui.aux.cards ? SECTIONS[ui.section]?.items(ui) || [] : []).filter(b => !q || b.textContent.toLowerCase().includes(q));
    const count = document.querySelector('.collection-count');
    if (count) count.textContent = items.length;
    if (chosen && !items.some(b => b.dataset.recordId === chosen.id)) chosen = null;
    return el('div', {}, ...(items.length ? items : [el('div', {class: 'empty'}, el('h3', {}, 'Nothing here yet'), el('p', {}, 'Records appear when the account has them.'))]));
  },
  emptyView: ui => (ui.aux.cards ? detail(ui) : el('div', {class: 'empty'}, el('h3', {}, 'Loading'))),
  labels: {depart_at: 'Leave at', arrive_by: 'Arrive by', step_free: 'Step-free only', max_walk_m: 'Max walking (m)', max_transfers: 'Max transfers', amount_cents: 'Amount (cents)',
    payment_method_id: 'Payment method', start_month: 'Start month (YYYY-MM)', place_ref: 'Place or stop ID', card_id: 'Card'},
  actions: [
    {label: 'Plan a trip', tool: 'hopline.trips.plan', primary: true},
    {label: 'Departures', tool: 'hopline.departures.list'},
    {label: 'Save a place or commute', tool: 'hopline.saved.add'},
    {label: 'New subscription', tool: 'hopline.subscriptions.create'},
    // Opened from record views with the record's IDs filled in.
    {label: 'Search places', tool: 'hopline.places.search', hidden: true},
    {label: 'Fares and passes', tool: 'hopline.fares.products', hidden: true},
    {label: 'Station details', tool: 'hopline.stops.get', hidden: true},
    {label: 'Route details', tool: 'hopline.routes.get', hidden: true},
    {label: 'Version chain', tool: 'hopline.alerts.get', hidden: true},
    {label: 'Remove', tool: 'hopline.saved.remove', hidden: true},
    {label: 'Change subscription', tool: 'hopline.subscriptions.update', hidden: true},
    {label: 'Delete subscription', tool: 'hopline.subscriptions.delete', hidden: true},
    {label: 'Mark as read', tool: 'hopline.notifications.acknowledge', hidden: true},
    {label: 'Add value', tool: 'hopline.cards.add_value', hidden: true},
    {label: 'Autoreload', tool: 'hopline.cards.set_autoreload', hidden: true},
    {label: 'Buy a monthly pass', tool: 'hopline.passes.purchase', hidden: true},
    {label: 'Cancel pass', tool: 'hopline.passes.cancel', hidden: true},
    {label: 'Report lost', tool: 'hopline.cards.report_lost', hidden: true},
    {label: 'Apply for a reduced fare', tool: 'hopline.reduced_fare.apply', hidden: true},
    {label: 'Card history', tool: 'hopline.cards.history', hidden: true}
  ],
  // Read tools the page loads directly (listed for coverage): 'hopline.saved.list' 'hopline.subscriptions.list'
  // 'hopline.notifications.list' 'hopline.cards.get' 'hopline.alerts.list'
  empty: 'Nothing here yet.'
});
