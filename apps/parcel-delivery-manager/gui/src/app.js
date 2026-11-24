import {mount, el, tag, metadata} from '/shared/client.js';
// App-owned controller for the Parcel Delivery Manager business page. The shared Web Host
// serves this file and forwards permitted Agent MCP tools; it holds no business logic.
// Everything shown comes from those tools. The browser clock is never used for business
// state: validity and deadlines are the flags the App returns (valid_now, passed).

const TOOL = {
  list: 'parcel-delivery-manager.shipments.list', get: 'parcel-delivery-manager.shipments.get',
  options: 'parcel-delivery-manager.options.get', addresses: 'parcel-delivery-manager.addresses.list',
  points: 'parcel-delivery-manager.points.list', preview: 'parcel-delivery-manager.change.preview',
  submit: 'parcel-delivery-manager.change.submit', cancel: 'parcel-delivery-manager.change.cancel',
  changes: 'parcel-delivery-manager.changes.list', collectors: 'parcel-delivery-manager.collectors.list',
  grants: 'parcel-delivery-manager.grants.list', grantPreview: 'parcel-delivery-manager.grant.preview',
  grantCreate: 'parcel-delivery-manager.grant.create', grantRevoke: 'parcel-delivery-manager.grant.revoke',
  pass: 'parcel-delivery-manager.pass.get', notices: 'parcel-delivery-manager.notices.list'
};
const STATUS = {in_transit: 'In transit', out_for_delivery: 'Out for delivery', attempt_failed: 'Delivery failed', at_pickup: 'Ready for pickup',
  delivered: 'Delivered', collected: 'Collected', returning: 'Returning to sender', returned: 'Returned to sender'};
const CLOSED = ['delivered', 'collected', 'returned'];
const KIND = {reschedule: 'Change delivery date', address: 'Deliver to another address', hold: 'Hold the parcel',
  redirect: 'Send to a pickup point', home_delivery: 'Deliver to a home address'};
const WHY = {
  parcel_closed: 'This parcel is closed.', return_started: 'The parcel is being returned to the sender.',
  change_pending: 'Another request is waiting for the carrier.', out_for_delivery: 'The parcel is out for delivery.',
  cutoff_passed: 'The change cutoff has passed.', deadline_passed: 'The deadline has passed.',
  not_applicable: 'Does not apply to the current delivery plan.', not_permitted: 'Not permitted for this parcel.',
  not_ready: 'The parcel is not waiting at a pickup point.'
};
const DEADLINE = {pickup: 'Collect by', failure_action: 'Choose a new option by', hold_end: 'Hold ends'};
const GRANT = {active: 'Current', revoked: 'Revoked', replaced: 'Replaced', expired: 'Expired', invalidated: 'Ended', consumed: 'Used for collection'};
const NOTICE = {pickup_ready: 'Ready for pickup', change_applied: 'Change applied', change_rejected: 'Change declined', delivered: 'Delivered',
  delivery_failed: 'Delivery failed', collected: 'Collected', relocated: 'Moved to another point', hold_ended: 'Hold ended',
  point_closed: 'Pickup point closed', point_reopened: 'Pickup point reopened', return_started: 'Return started', returned: 'Returned to sender',
  collection_authorized: 'You may collect a parcel'};
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// All instants are shown in UTC so the page reads the same in every browser time zone.
const stamp = new Intl.DateTimeFormat('en-US', {timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'});
const when = value => (value ? stamp.format(new Date(value)) + ' UTC' : '—');
const text = value => String(value ?? '');
const searchText = () => (document.querySelector('.toolbar input[type=search]')?.value || '').trim().toLowerCase();
const matches = (...values) => { const q = searchText(); return !q || values.some(v => text(v).toLowerCase().includes(q)); };

const pointOf = (ui, id) => ui.aux.points.find(p => p.id === id);
const pointName = (ui, id) => pointOf(ui, id)?.name || id;
const addressLabel = (ui, id) => { const a = ui.aux.addresses.find(x => x.id === id); return a ? a.label + ' — ' + a.line1 + ', ' + a.city : id; };
const parcelName = (ui, id) => ui.records.find(s => s.id === id)?.contents_label || id;
function planText(ui, plan) {
  if (!plan) return '—';
  if (plan.mode === 'pickup') return 'Pickup at ' + pointName(ui, plan.point_id);
  const where = addressLabel(ui, plan.address_id);
  if (plan.mode === 'hold') return 'On hold until ' + plan.hold_until + ', then delivery to ' + where;
  return 'Home delivery to ' + where + (plan.delivery_date ? ' on ' + plan.delivery_date : ' (date to be scheduled)');
}
function hoursText(point) {
  const groups = new Map();
  for (const h of point.hours) { const key = h.opens + '–' + h.closes; groups.set(key, [...(groups.get(key) || []), h.weekday]); }
  // Consecutive days are shown as a range, for example Mon–Sat.
  const days = list => {
    if (list.length === 7) return 'Every day';
    const sorted = [...list].sort(), runs = [];
    for (const d of sorted) { const run = runs.at(-1); if (run && d === run[1] + 1) run[1] = d; else runs.push([d, d]); }
    return runs.map(([a, b]) => (a === b ? DAYS[a] : DAYS[a] + '–' + DAYS[b])).join(', ');
  };
  return [...groups].map(([time, list]) => days(list) + ' ' + time).join('; ') + ' (' + point.time_zone + ')';
}

// ---------- dialogs: every write is reviewed before it is sent ----------
function field({name, label, type = 'text', required = false, options, value, min, max, help}) {
  let input;
  if (options) {
    input = el('select', {'data-field': name, required});
    if (!required) input.append(el('option', {value: ''}, 'None'));
    for (const o of options) input.append(el('option', {value: o.value}, o.label));
    if (value !== undefined && value !== null) input.value = value;
  } else {
    input = el('input', {type, 'data-field': name, required, min, max});
    if (value !== undefined && value !== null) input.value = value;
  }
  return el('label', {class: 'field'}, el('span', {}, label + (required ? ' *' : '')), help ? el('small', {}, help) : null, input);
}
// spec.preview is optional. With it the dialog has two steps: the App checks the request and
// returns a confirmation, the person reviews the effect, then the confirmed request is sent.
function openDialog(ui, spec) {
  const fields = el('div', {class: 'fields'}, spec.intro ? el('p', {}, spec.intro) : null, (spec.fields || []).map(field));
  const review = el('div', {class: 'fields'});
  const error = el('p', {role: 'alert', class: 'form-error'});
  const submit = el('button', {type: 'submit', class: 'primary'}, spec.preview ? 'Preview' : spec.confirmLabel);
  const back = el('button', {type: 'button'}, 'Edit');
  const cancel = el('button', {type: 'button'}, 'Cancel');
  const actions = el('div', {class: 'form-actions'}, cancel, submit);
  const form = el('form', {}, el('h2', {}, spec.title), fields, review, error, actions);
  const dialog = el('dialog', {'aria-label': spec.title, 'data-operation': spec.operation, 'data-step': spec.preview ? 'edit' : 'confirm'}, form);
  let args = null, checked = null, working = false;
  const inputs = () => [...fields.querySelectorAll('[data-field]')];
  const fail = (message, code) => { error.textContent = message; error.dataset.code = code || 'request_failed'; };
  function edit() {
    checked = null;
    dialog.dataset.step = 'edit';
    review.replaceChildren();
    for (const input of inputs()) input.disabled = false;
    submit.textContent = 'Preview';
    back.remove();
  }
  back.addEventListener('click', edit);
  cancel.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => dialog.remove());
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (working) return;
    working = true; submit.disabled = true; error.textContent = ''; delete error.dataset.code;
    try {
      if (spec.preview && !checked) {
        args = {};
        for (const input of inputs()) if (input.value !== '') args[input.dataset.field] = spec.convert?.[input.dataset.field]?.(input.value) ?? input.value;
        const result = await spec.preview(args);
        if (!result.allowed) return fail(result.summary, result.reason);
        checked = result;
        dialog.dataset.step = 'review';
        for (const input of inputs()) input.disabled = true;
        review.replaceChildren(el('fieldset', {'data-review': 'true'}, el('legend', {}, 'Review before sending'),
          (spec.reviewLines?.(result) || []).map(([label, value]) => metadata(label, value)), el('p', {}, result.summary)));
        submit.textContent = spec.confirmLabel;
        cancel.after(back);
      } else {
        await spec.commit(args, checked?.confirmation);
        dialog.close();
      }
    } catch (e) {
      fail(e.message, e.code);
    } finally {
      working = false; submit.disabled = false;
    }
  });
  document.body.append(dialog);
  dialog.showModal();
  (fields.querySelector('[data-field]') || submit).focus();
}

function changeDialog(ui, s, kind, options) {
  const addresses = ids => ids.map(id => ({value: id, label: addressLabel(ui, id)}));
  const date = (name, label, extra = {}) => ({name, label, type: 'date', ...extra});
  const specs = {
    reschedule: [date('delivery_date', 'New delivery date', {required: true, min: options.reschedule.earliest_date, max: options.reschedule.latest_date,
      help: 'Between ' + options.reschedule.earliest_date + ' and ' + options.reschedule.latest_date + '.'})],
    address: [{name: 'address_id', label: 'Deliver to', required: true, options: addresses(options.address.address_ids)}, date('delivery_date', 'Delivery date (optional)')],
    hold: [date('hold_until', 'Hold until', {required: true, max: options.hold.latest_date, help: 'No later than ' + options.hold.latest_date + '. Delivery resumes after the hold ends.'})],
    redirect: [{name: 'point_id', label: 'Pickup point', required: true, options: options.redirect.point_ids.map(id => {
      const p = pointOf(ui, id); return {value: id, label: p ? p.name + ' (' + p.kind + (p.accessible ? ', step-free' : ', not step-free') + ')' : id};
    })}],
    home_delivery: [{name: 'address_id', label: 'Deliver to', required: true, options: addresses(options.home_delivery.address_ids)}, date('delivery_date', 'Delivery date (optional)')]
  };
  openDialog(ui, {
    operation: TOOL.submit, title: KIND[kind], fields: specs[kind], confirmLabel: 'Send request to carrier',
    intro: 'The carrier decides each request. The delivery plan changes only after the carrier applies it.',
    preview: async args => (await ui.call(TOOL.preview, {id: s.id, kind, ...args})).preview,
    reviewLines: result => [['Current plan', planText(ui, result.current_plan)], ['Requested', planText(ui, result.proposed_plan)]],
    commit: (args, confirmation) => ui.perform(TOOL.submit, {id: s.id, kind, ...args, confirmation})
  });
}

function grantDialog(ui, s, options, replace) {
  const latest = options.delegation.latest_expires_at;
  const current = ui.aux.grants.filter(g => g.shipment_id === s.id && g.status === 'active');
  openDialog(ui, {
    operation: TOOL.grantCreate, title: replace ? 'Replace authorization' : 'Authorize a collector', confirmLabel: 'Authorize collection',
    intro: 'The collector gets their own pass for this parcel only. They cannot change the parcel or authorize anyone else.',
    fields: [
      {name: 'collector_person_id', label: 'Collector', required: true, value: replace?.collector_person_id,
        options: ui.aux.collectors.map(c => ({value: c.person_id, label: (c.name || c.person_id) + ' (' + c.relationship + ')'}))},
      {name: 'expires_at', label: 'Valid until (UTC)', type: 'datetime-local', required: true, value: latest.slice(0, 16), max: latest.slice(0, 16),
        help: 'No later than ' + when(latest) + '.'},
      ...(current.length ? [{name: 'replaces_grant_id', label: 'Replaces authorization', value: replace?.id,
        options: current.map(g => ({value: g.id, label: (g.collector_name || g.collector_person_id) + ', until ' + when(g.expires_at)}))}] : [])
    ],
    convert: {expires_at: value => value + ':00Z'},
    preview: async args => (await ui.call(TOOL.grantPreview, {id: s.id, ...args})).preview,
    reviewLines: result => [['Pickup point', pointName(ui, result.point_id)], ['Valid until', when(result.expires_at)]],
    commit: (args, confirmation) => ui.perform(TOOL.grantCreate, {id: s.id, ...args, confirmation})
  });
}

// ---------- parcel detail ----------
function panel(name, title) {
  return el('section', {class: 'query-result', 'data-panel': name, 'data-ready': 'false'}, el('h3', {}, title));
}
const ready = section => { section.dataset.ready = 'true'; return section; };

function pendingPanel(ui, s) {
  const change = s.pending_change, section = ready(panel('pending', 'Request waiting for the carrier'));
  section.append(metadata('Requested', planText(ui, change.target)), metadata('Sent', when(change.created_at)),
    el('p', {}, 'The current delivery plan stays in effect until the carrier applies this request.'));
  if (ui.has(TOOL.cancel)) section.append(el('button', {type: 'button', onclick: () => openDialog(ui, {
    operation: TOOL.cancel, title: 'Withdraw this request?', confirmLabel: 'Withdraw request',
    intro: 'The carrier will not act on it and the delivery plan stays as it is.',
    commit: () => ui.perform(TOOL.cancel, {id: change.id})
  })}, 'Withdraw request'));
  return section;
}

function optionsPanel(ui, s, loaded) {
  const section = panel('options', 'Delivery options');
  loaded.then(options => {
    if (options.cutoff_at) section.append(metadata('Changes close', when(options.cutoff_at)));
    const canWrite = ui.has(TOOL.preview) && ui.has(TOOL.submit), rows = el('div', {class: 'people'});
    // When one condition blocks every change (a pending request, a passed deadline, a return), say it once.
    const reasons = new Set(Object.keys(KIND).map(kind => options[kind].reason));
    const blocked = reasons.size === 1 && !reasons.has(null) ? [...reasons][0] : null;
    if (blocked) rows.append(el('div', {class: 'person', 'data-blocked': blocked}, el('strong', {}, 'No changes available'), el('small', {}, WHY[blocked] || blocked)));
    for (const kind of blocked ? [] : Object.keys(KIND)) {
      const o = options[kind];
      if (o.reason === 'not_applicable') continue;
      // An unavailable option is shown as text with its reason, never as a control.
      rows.append(el('div', {class: 'person', 'data-option': kind, 'data-allowed': String(o.allowed)}, o.allowed && canWrite
        ? el('button', {type: 'button', 'data-change': kind, onclick: () => changeDialog(ui, s, kind, options)}, KIND[kind])
        : [el('strong', {}, KIND[kind]), el('small', {}, o.allowed ? 'Read-only access.' : WHY[o.reason] || o.reason)]));
    }
    section.append(rows);
    ready(section);
  }).catch(e => { section.append(el('p', {class: 'form-error'}, e.message)); ready(section); });
  return section;
}

function collectionPanel(ui, s, loaded) {
  const section = panel('collection', 'Collection');
  const recipient = s.access === 'recipient';
  const grants = recipient ? ui.aux.grants.filter(g => g.shipment_id === s.id) : [];
  const pass = s.status === 'at_pickup' && ui.has(TOOL.pass)
    ? ui.call(TOOL.pass, {id: s.id}).then(r => r.pass).catch(() => null) : Promise.resolve(null);
  Promise.all([pass, loaded.catch(() => null)]).then(([p, options]) => {
    if (p) {
      section.append(el('div', {class: 'attachment-card', 'data-pass': p.id},
        el('div', {}, el('small', {}, p.role === 'delegate' ? 'Your pass as authorized collector' : 'Your pickup pass'), el('h2', {'data-pass-code': 'true'}, p.code)),
        tag(p.valid_now ? 'Valid' : 'Expired'), el('small', {}, 'At ' + p.point_name + ' until ' + when(p.expires_at))));
    } else if (s.status === 'at_pickup') section.append(el('p', {class: 'muted'}, 'No current pass.'));
    const rows = el('div', {class: 'people'});
    for (const g of grants) {
      const state = g.status === 'active' && !g.valid_now ? 'Expired' : GRANT[g.status];
      const row = el('div', {class: 'person', 'data-grant': g.id}, el('strong', {}, g.collector_name || g.collector_person_id), tag(state),
        el('small', {}, 'until ' + when(g.expires_at)));
      if (g.status === 'active' && ui.has(TOOL.grantRevoke)) row.append(el('button', {type: 'button', onclick: () => openDialog(ui, {
        operation: TOOL.grantRevoke, title: 'Revoke this authorization?', confirmLabel: 'Revoke authorization',
        intro: (g.collector_name || g.collector_person_id) + ' will no longer be able to collect this parcel. Their pass stops working at once.',
        commit: () => ui.perform(TOOL.grantRevoke, {id: g.id})
      })}, 'Revoke'));
      if (g.status === 'active' && options?.delegation.allowed && ui.has(TOOL.grantCreate)) {
        row.append(el('button', {type: 'button', onclick: () => grantDialog(ui, s, options, g)}, 'Replace'));
      }
      rows.append(row);
    }
    if (recipient && options) {
      const d = options.delegation, can = d.allowed && ui.has(TOOL.grantPreview) && ui.has(TOOL.grantCreate) && ui.aux.collectors.length > 0;
      const note = d.allowed ? (ui.aux.collectors.length ? (can ? 'Until ' + when(d.latest_expires_at) + ' at the latest.' : 'Read-only access.') : 'No saved collectors.') : WHY[d.reason] || d.reason;
      rows.append(el('div', {class: 'person', 'data-option': 'delegation', 'data-allowed': String(d.allowed)}, can
        ? el('button', {type: 'button', 'data-authorize': 'true', onclick: () => grantDialog(ui, s, options)}, 'Authorize a collector')
        : el('strong', {}, 'Authorize a collector'), el('small', {}, note)));
    }
    section.append(rows);
    ready(section);
  });
  return section;
}

function view(s, ui) {
  const recipient = s.access === 'recipient';
  const options = recipient && ui.has(TOOL.options) ? ui.call(TOOL.options, {id: s.id}).then(r => r.options) : Promise.reject(Error('Delivery options are not available.'));
  options.catch(() => {});
  const article = el('article', {'data-parcel': s.id, 'data-status': s.status},
    el('span', {class: 'kicker'}, recipient ? 'Tracking ' + s.tracking_number : 'Authorized pickup'),
    el('h2', {}, s.contents_label),
    el('div', {class: 'tags'}, tag(STATUS[s.status]), s.pending_change ? tag('Change pending') : null, s.deadlines.some(d => d.passed) ? tag('Deadline passed') : null),
    recipient ? metadata('From', s.sender_label) : null,
    recipient ? metadata('Delivery plan', planText(ui, s.plan)) : null,
    recipient && s.estimated_delivery ? metadata('Estimated delivery', s.estimated_delivery) : null,
    s.point ? metadata('Pickup point', s.point.name + ' — ' + s.point.address_text) : null,
    s.point ? metadata('Point status', (s.point.status === 'closed' ? 'Closed' : s.point.open_now ? 'Open now' : 'Closed at this hour') + (s.point.status_note ? ' — ' + s.point.status_note : '')) : null,
    s.point ? metadata('Opening hours', hoursText(s.point)) : null,
    s.deadlines.map(d => metadata(DEADLINE[d.kind], when(d.at) + (d.passed ? ' — passed' : ''))),
    s.attempt ? metadata('Failed attempt', s.attempt.reason) : null,
    s.return_info ? metadata('Return', s.return_info.reason + (s.return_info.completed_at ? ' Completed ' + when(s.return_info.completed_at) + '.' : '')) : null,
    s.completed_at ? metadata('Closed', when(s.completed_at)) : null);
  if (s.pending_change) article.append(pendingPanel(ui, s));
  if (recipient && !CLOSED.includes(s.status) && ui.has(TOOL.options)) article.append(optionsPanel(ui, s, options));
  if (s.status === 'at_pickup' || (recipient && ui.aux.grants.some(g => g.shipment_id === s.id))) article.append(collectionPanel(ui, s, options));
  if (s.timeline.length) {
    article.append(el('section', {'data-panel': 'timeline'}, el('h3', {}, 'Timeline'),
      [...s.timeline].reverse().map(e => el('div', {class: 'version-entry'}, el('span', {class: 'version-number'}, when(e.at)), el('strong', {}, e.summary)))));
  }
  return article;
}

// ---------- lists ----------
async function load(ui) {
  const read = (tool, key) => (ui.has(tool) ? ui.call(tool, {}).then(r => r[key]).catch(() => []) : Promise.resolve([]));
  const [points, addresses, changes, grants, notices, collectors] = await Promise.all([
    read(TOOL.points, 'items'), read(TOOL.addresses, 'items'), read(TOOL.changes, 'items'), read(TOOL.grants, 'items'), read(TOOL.notices, 'items'), read(TOOL.collectors, 'items')]);
  return {points, addresses, changes, grants, notices, collectors};
}
const none = () => false;
const sections = () => [
  {id: 'inbox', label: 'Active parcels', symbol: '▤', filter: s => !CLOSED.includes(s.status)},
  {id: 'action', label: 'Needs action', symbol: '!', filter: s => ['attempt_failed', 'at_pickup'].includes(s.status)},
  {id: 'waiting', label: 'Waiting for carrier', symbol: '…', filter: s => s.has_pending_change},
  {id: 'closed', label: 'Closed', symbol: '✓', filter: s => CLOSED.includes(s.status)},
  {id: 'points', label: 'Pickup points', symbol: '⌂', filter: none, count: false},
  {id: 'changes', label: 'Change requests', symbol: '⇄', filter: none, count: false},
  {id: 'collectors', label: 'Collectors', symbol: '☺', filter: none, count: false},
  {id: 'notices', label: 'Notices', symbol: '✉', filter: none, count: false}
];
async function openParcel(ui, id) {
  const s = ui.records.find(x => x.id === id);
  if (!s) return;
  await ui.navigate(CLOSED.includes(s.status) ? 'closed' : 'inbox');
  await ui.select(id);
}
const linked = (ui, id, attrs, ...content) => (ui.records.some(s => s.id === id)
  ? el('button', {type: 'button', class: 'record', ...attrs, onclick: () => openParcel(ui, id).catch(ui.error)}, ...content)
  : el('div', {class: 'record', ...attrs}, ...content));
const title = value => el('span', {class: 'record-title'}, value);
const subtitle = value => el('span', {class: 'record-subtitle'}, value);

const LISTS = {
  parcels: (shown, ui) => shown.map(s => ui.record(s,
    el('div', {class: 'row-top'}, title(s.contents_label), el('time', {}, when(s.updated_at))),
    subtitle(s.access === 'delegate' ? 'Authorized pickup' : s.sender_label + ' · ' + s.tracking_number),
    el('div', {class: 'row-bottom'}, tag(STATUS[s.status]), s.has_pending_change ? tag('Change pending') : null, s.deadline_passed ? tag('Deadline passed') : null,
      s.pickup_deadline && !s.deadline_passed ? el('small', {}, 'Collect by ' + when(s.pickup_deadline)) : null))),
  points: (shown, ui) => ui.aux.points.filter(p => matches(p.name, p.address_text, p.kind)).map(p => el('div', {class: 'record', 'data-point': p.id},
    el('div', {class: 'row-top'}, title(p.name), tag(p.status === 'closed' ? 'Closed' : p.open_now ? 'Open now' : 'Closed at this hour')),
    subtitle(p.address_text),
    el('div', {class: 'row-bottom'}, tag(p.kind === 'locker' ? 'Locker' : 'Counter'), tag(p.accessible ? 'Step-free' : 'Not step-free'), p.accepts_redirects ? null : tag('No redirects')),
    el('span', {class: 'snippet'}, hoursText(p) + (p.status_note ? ' — ' + p.status_note : '')))),
  changes: (shown, ui) => [...ui.aux.changes].reverse().filter(c => matches(parcelName(ui, c.shipment_id), c.status, c.reason)).map(c => linked(ui, c.shipment_id, {'data-change-id': c.id},
    el('div', {class: 'row-top'}, title(planText(ui, c.target)), tag(c.status[0].toUpperCase() + c.status.slice(1))),
    subtitle(parcelName(ui, c.shipment_id) + ' · requested ' + when(c.created_at)),
    c.reason ? el('span', {class: 'snippet'}, c.reason) : null)),
  collectors: (shown, ui) => [
    ...ui.aux.collectors.filter(c => matches(c.name, c.relationship)).map(c => el('div', {class: 'record', 'data-collector': c.person_id}, title(c.name || c.person_id), subtitle('Saved collector · ' + c.relationship))),
    ...[...ui.aux.grants].reverse().filter(g => matches(g.collector_name, parcelName(ui, g.shipment_id))).map(g => linked(ui, g.shipment_id, {'data-grant-id': g.id},
      el('div', {class: 'row-top'}, title((g.collector_name || g.collector_person_id) + ' — ' + parcelName(ui, g.shipment_id)), tag(g.status === 'active' && !g.valid_now ? 'Expired' : GRANT[g.status])),
      subtitle('At ' + pointName(ui, g.point_id) + ' until ' + when(g.expires_at))))],
  notices: (shown, ui) => [...ui.aux.notices].reverse().filter(n => matches(n.message, NOTICE[n.type])).map(n => linked(ui, n.shipment_id, {'data-notice-id': n.id},
    el('div', {class: 'row-top'}, title(NOTICE[n.type] || n.type), el('time', {}, when(n.at))),
    el('span', {class: 'snippet'}, n.message)))
};
const EMPTY = {
  points: ['No pickup points', 'No point matches this search.'], changes: ['No change requests', 'Requests you send to the carrier appear here with their decisions.'],
  collectors: ['No collectors', 'Saved collectors and the authorizations you give them appear here.'], notices: ['No notices', 'Carrier notices for your parcels appear here.'],
  parcels: ['No parcels here', 'Parcels appear when the carrier has them.']
};
function renderList(shown, ui) {
  const kind = LISTS[ui.section] ? ui.section : 'parcels';
  const rows = LISTS[kind](shown, ui);
  const count = document.querySelector('.collection-count');
  if (count) count.textContent = rows.length;
  const wrap = el('div', {'data-list': kind});
  if (rows.length) wrap.append(...rows);
  else wrap.append(el('div', {class: 'empty'}, el('h3', {}, EMPTY[kind][0]), el('p', {}, searchText() ? 'Try a different search.' : EMPTY[kind][1])));
  return wrap;
}
const HINT = {
  points: 'Opening hours are local to each point. A parcel can be collected only while its point is open and before its pickup deadline.',
  changes: 'A request changes nothing until the carrier applies it. Select a request to open its parcel.',
  collectors: 'A collector can collect one parcel at its pickup point with their own pass, until the authorization ends.',
  notices: 'Notices are kept for the parcels you can currently see.'
};
const emptyView = ui => el('div', {class: 'empty'}, el('h3', {}, sections().find(s => s.id === ui.section)?.label || 'Parcels'),
  el('p', {}, HINT[ui.section] || 'Select a parcel to see its plan, deadlines and timeline.'));

mount({
  id: 'parcel-delivery-manager', title: 'Parcels', symbol: '▣', searchLabel: 'Search parcels, points and notices', initialSection: 'inbox',
  list: TOOL.list, collection: 'items', queryField: 'query', listArgs: {include_closed: true}, get: TOOL.get, item: 'shipment',
  heading: s => s.contents_label, subtitle: s => STATUS[s.status], actions: [],
  load, sections, renderList, view, emptyView
});
