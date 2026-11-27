import {mount, el, tag, textBlock, metadata} from '/shared/client.js';
// App-owned Homegrid interface: services, moves and installations, equipment, outages and advisories,
// bills and notices for one account. All data comes from the Agent MCP tools; the Host adds nothing.
// The shared shell lists one collection; this controller loads every record kind in `load` and renders
// its own sections, so `list` is used only for the version that writes must carry.

let chosen = null; // {kind, id}: the record shown in the detail pane (transient UI state)
let zone = 'UTC'; // the account's time zone, from preferences
// Calendar dates (YYYY-MM-DD) are shown as written; instants in the account's time zone, not the browser's.
const date = d => (d ? new Intl.DateTimeFormat('en-US', {month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'}).format(new Date(String(d).slice(0, 10) + 'T00:00:00Z')) : 'No date');
const time = t => (t ? new Intl.DateTimeFormat('en-US', {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: zone, timeZoneName: 'short'}).format(new Date(t)) : '—');
const money = c => (c < 0 ? '-' : '') + '$' + (Math.abs(c || 0) / 100).toFixed(2);
const label = s => String(s || '').replace(/_/g, ' ');
const premiseName = (ui, id) => (ui.aux.premises || []).find(p => p.premise_id === id)?.address || id;
const choose = (ui, kind, id) => { chosen = {kind, id}; ui.navigate(ui.section).catch(ui.error); };
const row = (ui, kind, id, title, subtitle, extra = []) => el('button', {type: 'button', class: 'record', 'data-record-id': id,
  'aria-pressed': chosen && chosen.kind === kind && chosen.id === id, onclick: () => choose(ui, kind, id)},
  el('span', {class: 'record-title'}, title), el('span', {class: 'record-subtitle'}, subtitle), ...extra);
const act = (ui, text, tool, values) => ui.has(tool) ? el('button', {type: 'button', onclick: () => ui.action(tool, values)}, text) : null;
const actions = (...buttons) => el('div', {class: 'detail-actions'}, ...buttons.filter(Boolean));
const history = list => el('section', {}, el('h3', {}, 'History'), ...(list || []).map(h => metadata(time(h.at), h.action)));

async function load(ui) {
  const call = async (name, args = {}) => (ui.has(name) ? ui.call(name, args) : {});
  const account = (await call('homegrid.account.get')).account || {premises: []};
  const [services, orders, equipment, bills, payments, notes, prefs] = await Promise.all([
    call('homegrid.services.list'), call('homegrid.orders.list'), call('homegrid.equipment.list'), call('homegrid.bills.list'),
    call('homegrid.payments.list'), call('homegrid.notifications.list'), call('homegrid.preferences.get')]);
  const outages = [], advisories = [];
  for (const p of account.premises) {
    for (const o of (await call('homegrid.outages.list', {premise_id: p.premise_id})).outages || []) if (!outages.some(x => x.outage_id === o.outage_id)) outages.push({...o, premise_id: p.premise_id});
    for (const a of (await call('homegrid.advisories.list', {premise_id: p.premise_id})).advisories || []) if (!advisories.some(x => x.advisory_id === a.advisory_id)) advisories.push({...a, premise_id: p.premise_id});
  }
  zone = prefs.preferences?.time_zone || zone;
  return {account, premises: account.premises, services: services.services || [], orders: orders.orders || [], equipment: equipment.equipment || [],
    bills: bills.bills || [], payments: payments.payments || [], arrangements: payments.arrangements || [], autopay: payments.autopay || {},
    notifications: notes.notifications || [], preferences: prefs.preferences || null, outages, advisories, as_of: services.as_of};
}

// ---- Sections: list rows and detail views ----
const SECTIONS = {
  services: {label: 'Services', symbol: '⚡',
    items: ui => ui.aux.services.map(s => row(ui, 'service', s.service_id, `${label(s.service_type)} · ${premiseName(ui, s.premise_id)}`,
      `${label(s.status)}${s.start_date ? ' · from ' + date(s.start_date) : ''}${s.stop_date ? ' · until ' + date(s.stop_date) : ''}`))},
  orders: {label: 'Moves & installs', symbol: '⇄',
    items: ui => ui.aux.orders.map(o => row(ui, 'order', o.order_id, `${label(o.type)} ${label(o.service_type)} · ${premiseName(ui, o.premise_id)}`,
      `${label(o.status)} · ${o.date ? date(o.date) : o.temp ? date(o.temp.from) + '–' + date(o.temp.to) : o.appointments.filter(a => a.status === 'booked').map(a => date(a.date) + ' ' + a.slot)[0] || 'no window booked'}`))},
  equipment: {label: 'Equipment', symbol: '▣',
    items: ui => ui.aux.equipment.map(e => row(ui, 'equipment', e.equipment_id, `${label(e.kind)} · ${premiseName(ui, e.premise_id)}`,
      `${label(e.status)}${e.return_due ? ' · return by ' + date(e.return_due) : ''}`))},
  disruptions: {label: 'Outages & advisories', symbol: '⚠',
    items: ui => [...ui.aux.advisories.map(a => row(ui, 'advisory', a.advisory_id, `${label(a.kind)} · ${premiseName(ui, a.premise_id)}`, `${label(a.status)} · version ${a.latest_version}`)),
      ...ui.aux.outages.map(o => row(ui, 'outage', o.outage_id, `${label(o.service_type)} outage · ${premiseName(ui, o.premise_id)}`, `${o.status}${o.etr ? ' · estimated ' + time(o.etr) : ''}`))]},
  bills: {label: 'Bills & payments', symbol: '$',
    items: ui => [...ui.aux.bills.map(b => row(ui, 'bill', b.bill_id, `Bill ${b.bill_id} · ${money(b.total_cents)}`, `${label(b.status)} · due ${date(b.due_date)} · ${premiseName(ui, b.premise_id)}`)),
      ...ui.aux.arrangements.map(a => row(ui, 'arrangement', a.arrangement_id, `Payment plan ${a.arrangement_id}`, `${label(a.status)} · ${a.installments.length} installments`)),
      ...ui.aux.payments.map(p => row(ui, 'payment', p.payment_id, `Payment ${money(p.amount_cents)}`, `${label(p.status)} · ${p.scheduled_for ? 'scheduled ' + date(p.scheduled_for) : date(p.created_at)}`))]},
  notices: {label: 'Notices', symbol: '✉',
    items: ui => [...ui.aux.notifications].reverse().map(n => row(ui, 'notification', n.notification_id, n.title, `${label(n.status)} · ${time(n.created_at)}${n.acknowledged_at ? ' · read' : ''}`))},
  settings: {label: 'Account & settings', symbol: '⚙',
    items: ui => [row(ui, 'account', 'account', ui.aux.account.name || 'Account', `${ui.aux.premises.length} premises`), row(ui, 'preferences', 'preferences', 'Notification preferences', ui.aux.preferences?.time_zone || '')]}
};

function detail(ui) {
  const a = ui.aux, find = (list, key) => (list || []).find(x => x[key] === chosen.id);
  if (!chosen) return overview(ui);
  if (chosen.kind === 'service') {
    const s = find(a.services, 'service_id');
    if (!s) return overview(ui);
    const order = a.orders.find(o => o.type === 'start' && o.premise_id === s.premise_id && o.service_type === s.service_type && o.status === 'scheduled');
    return el('article', {class: 'task-reader'},
      actions(s.service_type === 'internet' ? act(ui, 'Run connection test', 'homegrid.connection.run_test', {service_id: s.service_id}) : null,
        act(ui, 'Preview a stop or move', 'homegrid.orders.preview', {type: 'stop', service_id: s.service_id}),
        act(ui, 'Report an outage', 'homegrid.outages.report', {premise_id: s.premise_id, service_type: s.service_type}),
        act(ui, 'Plans here', 'homegrid.plans.list', {premise_id: s.premise_id, service_type: s.service_type}),
        order && order.needs === 'technician' ? act(ui, 'Installation windows', 'homegrid.appointments.slots', {premise_id: s.premise_id, order_id: order.order_id}) : null),
      el('p', {class: 'kicker'}, label(s.service_type)), el('h2', {}, premiseName(ui, s.premise_id)),
      metadata('Status', label(s.status)), metadata('Plan', s.plan_id), metadata('Starts', s.start_date && date(s.start_date)), metadata('Stops', s.stop_date && date(s.stop_date)),
      metadata('Activated', s.activated_at && time(s.activated_at)),
      metadata('Last test', s.last_test ? `${s.last_test.result}${s.last_test.speed_mbps ? ' at ' + s.last_test.speed_mbps + ' Mbps' : ''}${s.last_test.reason ? ' (' + label(s.last_test.reason) + (s.last_test.outage_id ? ' ' + s.last_test.outage_id : '') + ')' : ''} · ${time(s.last_test.at)}` : 'none'));
  }
  if (chosen.kind === 'order') {
    const o = find(a.orders, 'order_id');
    if (!o) return overview(ui);
    const open = o.status === 'scheduled', appt = o.appointments.find(x => x.status === 'booked');
    return el('article', {class: 'task-reader'},
      actions(open && o.needs === 'technician' && !appt ? act(ui, 'Book a window', 'homegrid.appointments.book', {order_id: o.order_id}) : null,
        open && o.needs === 'technician' ? act(ui, 'Find windows', 'homegrid.appointments.slots', {premise_id: o.premise_id, order_id: o.order_id}) : null,
        appt ? act(ui, 'Reschedule window', 'homegrid.appointments.reschedule', {appointment_id: appt.appointment_id}) : null,
        appt ? act(ui, 'Cancel window', 'homegrid.appointments.cancel', {appointment_id: appt.appointment_id}) : null,
        open && o.needs !== 'technician' && o.type !== 'temporary_internet' ? act(ui, 'Change date', 'homegrid.orders.reschedule', {order_id: o.order_id}) : null,
        open ? act(ui, 'Cancel order', 'homegrid.orders.cancel', {order_id: o.order_id}) : null),
      el('p', {class: 'kicker'}, `${label(o.type)} · ${label(o.status)}`), el('h2', {}, `${label(o.service_type)} at ${premiseName(ui, o.premise_id)}`),
      metadata('Order', o.order_id), metadata('Date', o.date ? date(o.date) : o.temp ? `${date(o.temp.from)} to ${date(o.temp.to)}` : null),
      metadata('Needs', label(o.needs)), metadata('Transfer', o.transfer_id), metadata('Deposit', o.deposit_cents ? money(o.deposit_cents) : null), metadata('Price', o.price_cents ? money(o.price_cents) : null),
      o.appointments.length ? el('section', {}, el('h3', {}, 'Installation windows'), ...o.appointments.map(x => metadata(`${date(x.date)} ${x.slot}`, `${label(x.status)} · ${x.appointment_id}`))) : null,
      history(o.history));
  }
  if (chosen.kind === 'equipment') {
    const e = find(a.equipment, 'equipment_id');
    if (!e) return overview(ui);
    return el('article', {class: 'task-reader'},
      actions(e.status !== 'returned' ? act(ui, 'Arrange return', 'homegrid.equipment.schedule_return', {equipment_id: e.equipment_id}) : null),
      el('p', {class: 'kicker'}, label(e.kind)), el('h2', {}, premiseName(ui, e.premise_id)),
      metadata('Equipment', e.equipment_id), metadata('Status', label(e.status)), metadata('Return by', e.return_due && date(e.return_due)),
      metadata('Return method', label(e.return_method)), metadata('Returned', e.returned_at && time(e.returned_at)));
  }
  if (chosen.kind === 'advisory') {
    const v = find(a.advisories, 'advisory_id');
    if (!v) return overview(ui);
    const latest = v.versions[v.versions.length - 1];
    return el('article', {class: 'task-reader'}, el('p', {class: 'kicker'}, `${label(v.kind)} · ${label(v.status)}`), el('h2', {}, premiseName(ui, v.premise_id)),
      metadata('Covers this premise', v.covers_premise ? 'yes' : 'no'), metadata('Effective from', time(latest.effective_from)), metadata('Planned end', latest.planned_end && time(latest.planned_end)),
      textBlock(latest.instructions),
      el('section', {}, el('h3', {}, 'Versions'), ...v.versions.map(x => metadata(`v${x.version} ${x.msg_type}`, `${time(x.issued_at)} · ${x.area_ids.concat(x.premise_ids).join(', ')}`))));
  }
  if (chosen.kind === 'outage') {
    const o = find(a.outages, 'outage_id');
    if (!o) return overview(ui);
    return el('article', {class: 'task-reader'},
      actions(o.status !== 'restored' ? act(ui, 'Report this outage', 'homegrid.outages.report', {premise_id: o.premise_id, service_type: o.service_type}) : null),
      el('p', {class: 'kicker'}, `${label(o.service_type)} outage · ${o.status}`), el('h2', {}, premiseName(ui, o.premise_id)),
      metadata('Cause', o.cause), metadata('Estimated restoration', o.etr && time(o.etr)), metadata('Your reports', o.reports.join(', ')),
      el('section', {}, el('h3', {}, 'Updates'), ...o.versions.map(x => metadata(`${x.seq}. ${label(x.status)}`, `${time(x.at)}${x.etr ? ' · estimate ' + time(x.etr) : ''}`))));
  }
  if (chosen.kind === 'bill') {
    const b = find(a.bills, 'bill_id');
    if (!b) return overview(ui);
    const due = b.total_cents - b.pending_cents, method = (a.account.payment_methods || [])[0];
    return el('article', {class: 'task-reader'},
      actions(due > 0 ? act(ui, 'Pay this bill', 'homegrid.payments.make', {amount_cents: due, payment_method_id: method?.payment_method_id}) : null,
        b.status === 'past_due' ? act(ui, 'Request a payment plan', 'homegrid.arrangements.request', {bill_id: b.bill_id, installments: 3}) : null,
        act(ui, 'Full bill', 'homegrid.bills.get', {bill_id: b.bill_id})),
      el('p', {class: 'kicker'}, `${label(b.status)} · due ${date(b.due_date)}`), el('h2', {}, `${money(b.total_cents)} · ${b.period.from} to ${b.period.to}`),
      metadata('Premise', premiseName(ui, b.premise_id)), metadata('Paid (settled)', money(b.paid_cents)), metadata('Counting pending', money(b.pending_cents)),
      b.prior_balance_cents !== undefined ? metadata('Earlier bills still owed', money(b.prior_balance_cents)) : null,
      el('section', {}, el('h3', {}, 'Lines'), ...b.lines.map(l => metadata(l.description, money(l.amount_cents)))));
  }
  if (chosen.kind === 'payment') {
    const p = find(a.payments, 'payment_id');
    if (!p) return overview(ui);
    return el('article', {class: 'task-reader'}, el('p', {class: 'kicker'}, label(p.status)), el('h2', {}, money(p.amount_cents)),
      metadata('Payment', p.payment_id), metadata('Method', p.payment_method_id), metadata('Created', time(p.created_at)), metadata('Scheduled for', p.scheduled_for && date(p.scheduled_for)),
      metadata('Autopay bill', p.autopay_bill_id), metadata('Resolved', p.resolved_at && time(p.resolved_at)));
  }
  if (chosen.kind === 'arrangement') {
    const r = find(a.arrangements, 'arrangement_id');
    if (!r) return overview(ui);
    return el('article', {class: 'task-reader'}, el('p', {class: 'kicker'}, label(r.status)), el('h2', {}, `Plan for ${r.bill_id}`),
      el('section', {}, el('h3', {}, 'Installments'), ...r.installments.map(i => metadata(date(i.due_date), money(i.amount_cents)))));
  }
  if (chosen.kind === 'notification') {
    const n = find(a.notifications, 'notification_id');
    if (!n) return overview(ui);
    return el('article', {class: 'task-reader'}, actions(!n.acknowledged_at ? act(ui, 'Mark as read', 'homegrid.notifications.acknowledge', {notification_id: n.notification_id}) : null),
      el('p', {class: 'kicker'}, `${label(n.type)} · ${label(n.status)}${n.health ? ' · health' : ''}`), el('h2', {}, n.title), el('div', {class: 'tags'}, tag(time(n.time))),
      textBlock(n.body), metadata('Release', n.release_at && time(n.release_at)), metadata('Delivery', n.outcome ? `${n.outcome.status}${n.outcome.code ? ' (' + n.outcome.code + ')' : ''}` : null));
  }
  if (chosen.kind === 'preferences') {
    const p = a.preferences || {types: {}};
    return el('article', {class: 'task-reader'}, actions(act(ui, 'Change preferences', 'homegrid.preferences.update', {})),
      el('h2', {}, 'Notification preferences'), metadata('Time zone', p.time_zone), metadata('Quiet hours', p.quiet_hours ? `${p.quiet_hours.start}–${p.quiet_hours.end}` : 'off'),
      ...Object.entries(p.types || {}).map(([t, v]) => metadata(label(t), v.enabled ? v.delivery : 'off')),
      metadata('Health advisories', p.health ? `${p.health.delivery}${p.health.bypass_quiet_hours ? ', wake me in quiet hours' : ''}` : null));
  }
  return overview(ui);
}

function overview(ui) {
  const a = ui.aux, acc = a.account || {};
  return el('article', {class: 'task-reader'},
    actions(act(ui, 'Find a premise', 'homegrid.premises.search', {}), act(ui, 'Autopay', 'homegrid.autopay.set', {payment_method_id: a.autopay?.payment_method_id || null})),
    el('p', {class: 'kicker'}, 'Account ' + (acc.account_id || '')), el('h2', {}, acc.name || 'Homegrid'),
    metadata('As of', a.as_of && time(a.as_of)), metadata('Autopay', a.autopay?.payment_method_id || 'off'),
    metadata('Payment methods', (acc.payment_methods || []).map(m => `${m.label} ••${m.last4}`).join(', ')),
    el('section', {}, el('h3', {}, 'Premises'), ...(a.premises || []).map(p => metadata(p.address, `${p.internet_tech} internet${p.self_install ? ', self-install' : ''}`))),
    el('section', {}, el('h3', {}, 'At a glance'), metadata('Active services', String(a.services.filter(s => s.status === 'active').length)),
      metadata('Open orders', String(a.orders.filter(o => o.status === 'scheduled').length)), metadata('Unpaid bills', String(a.bills.filter(b => b.status !== 'paid').length)),
      metadata('Unread notices', String(a.notifications.filter(n => !n.acknowledged_at).length))));
}

mount({
  id: 'homegrid', title: 'Homegrid', description: 'Utilities and home internet: services, moves, installations, outages, advisories and bills.',
  symbol: '⌂', searchLabel: 'Search this section', initialSection: 'services',
  // The list call supplies the version for writes; records are rendered from `load`.
  list: 'homegrid.account.get', collection: 'none', listArgs: {}, get: 'homegrid.account.get', item: 'account',
  heading: () => 'Homegrid', subtitle: () => '',
  load,
  sections: ui => Object.entries(SECTIONS).map(([id, s]) => ({id, label: `${s.label}${ui.aux.services ? ' (' + s.items(ui).length + ')' : ''}`, symbol: s.symbol, count: false})),
  renderList: (shown, ui) => {
    // The search box filters the current section's rows; the count shows what is listed.
    const q = (document.querySelector('input[type=search]')?.value || '').trim().toLowerCase();
    const items = (ui.aux.services ? SECTIONS[ui.section]?.items(ui) || [] : []).filter(b => !q || b.textContent.toLowerCase().includes(q));
    const count = document.querySelector('.collection-count');
    if (count) count.textContent = items.length;
    if (chosen && !items.some(b => b.dataset.recordId === chosen.id)) chosen = null;
    return el('div', {}, ...(items.length ? items : [el('div', {class: 'empty'}, el('h3', {}, 'Nothing here yet'), el('p', {}, 'Records appear when the account has them.'))]));
  },
  emptyView: ui => (ui.aux.services ? detail(ui) : el('div', {class: 'empty'}, el('h3', {}, 'Loading'))),
  labels: {order_token: 'Order token (from a preview)', amount_cents: 'Amount (cents)', payment_method_id: 'Payment method', service_type: 'Service', stop_date: 'Last day at the old address', start_date: 'First day at the new address'},
  actions: [
    {label: 'Preview an order', tool: 'homegrid.orders.preview', primary: true},
    {label: 'Place the previewed order', tool: 'homegrid.orders.create'},
    {label: 'Make a payment', tool: 'homegrid.payments.make'},
    {label: 'Notification settings', tool: 'homegrid.preferences.update'},
    // Opened from record views with the record's IDs filled in.
    {label: 'Find a premise', tool: 'homegrid.premises.search', hidden: true},
    {label: 'Plans', tool: 'homegrid.plans.list', hidden: true},
    {label: 'Installation windows', tool: 'homegrid.appointments.slots', hidden: true},
    {label: 'Book a window', tool: 'homegrid.appointments.book', hidden: true},
    {label: 'Reschedule window', tool: 'homegrid.appointments.reschedule', hidden: true},
    {label: 'Cancel window', tool: 'homegrid.appointments.cancel', hidden: true},
    {label: 'Change date', tool: 'homegrid.orders.reschedule', hidden: true},
    {label: 'Cancel order', tool: 'homegrid.orders.cancel', hidden: true},
    {label: 'Run connection test', tool: 'homegrid.connection.run_test', hidden: true},
    {label: 'Arrange return', tool: 'homegrid.equipment.schedule_return', hidden: true},
    {label: 'Report an outage', tool: 'homegrid.outages.report', hidden: true},
    {label: 'Request a payment plan', tool: 'homegrid.arrangements.request', hidden: true},
    {label: 'Autopay', tool: 'homegrid.autopay.set', hidden: true},
    {label: 'Full bill', tool: 'homegrid.bills.get', hidden: true},
    {label: 'Mark as read', tool: 'homegrid.notifications.acknowledge', hidden: true}
  ],
  // Read tools the page loads directly (listed for coverage): 'homegrid.services.list' 'homegrid.orders.list'
  // 'homegrid.equipment.list' 'homegrid.outages.list' 'homegrid.advisories.list' 'homegrid.bills.list'
  // 'homegrid.payments.list' 'homegrid.notifications.list' 'homegrid.preferences.get' 'homegrid.account.get'
  empty: 'Nothing here yet.'
});
