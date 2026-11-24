import {el} from '/shared/client.js';
// Stoopside business pages. Every value shown comes from a Stoopside tool
// result over the Host's fixed Agent MCP connection; the page keeps no
// business state of its own and applies no business rule. Previews, recipient
// lists, counts and errors are exactly what the tools return.
//
// Pages (hash routes):
//   #/groups, #/group/<id>       group home with discovery          view-as
//   #/members/<group>            member directory (search, export)
//   #/event/<id>                 event, RSVP preview and confirm    view-as
//   #/change/<new|edit|cancel>/<id>  change preview and confirm
//   #/compose/<group>[/<mode>/<id>]  post composer (post, comment, edit, event)
//   #/sheet/<id>                 sign-up sheet, claims and swaps    view-as
//   #/profile, #/help
//
// Tools used (the Host lists only those the run's profile allows):
// 'stoopside.groups.list' 'stoopside.groups.get' 'stoopside.groups.join' 'stoopside.groups.leave'
// 'stoopside.members.search' 'stoopside.members.export' 'stoopside.profile.get' 'stoopside.profile.update'
// 'stoopside.events.list' 'stoopside.events.get' 'stoopside.events.preview_change' 'stoopside.events.confirm_change'
// 'stoopside.rsvps.preview' 'stoopside.rsvps.confirm' 'stoopside.posts.list' 'stoopside.posts.preview'
// 'stoopside.posts.publish' 'stoopside.posts.delete' 'stoopside.signups.get' 'stoopside.signups.claim'
// 'stoopside.signups.release' 'stoopside.signups.swap_propose' 'stoopside.signups.swap_answer'
// 'stoopside.visibility.view_as' 'stoopside.help.get'

const P = 'stoopside.';
let csrf = '', allowed = new Set(), version = null, busy = false, renderTicket = 0;
const pending = new Map();   // write signature -> request_id, reused on retry

// ---- Transport ------------------------------------------------------------------

async function http(url, method = 'GET', value) {
  const r = await fetch(url, {method, headers: method === 'POST' ? {'Content-Type': 'application/json', 'X-Pale-CSRF': csrf} : {},
    ...(method === 'POST' ? {body: JSON.stringify(value)} : {})});
  const out = await r.json();
  if (!r.ok) throw Error(out.error || 'Request failed');
  return out;
}
const MESSAGES = {
  stale_version: 'Something changed since this page loaded. Refresh and try again.',
  permission_denied: 'This run\'s profile does not allow this operation.',
};
async function call(tool, args = {}) {
  const r = await http('/api/call', 'POST', {name: P + tool, arguments: args});
  if (r.version) version = r.version;
  if (!['ok', 'committed', 'ready'].includes(r.status)) throw Object.assign(Error(MESSAGES[r.status] || r.message || r.status), {code: r.status});
  return r;
}
// A write carries the version the page last read and a request ID that stays
// the same if the same write is retried after a lost response.
async function write(tool, args) {
  const payload = {...args, expected_version: version};
  const key = tool + JSON.stringify(payload);
  if (!pending.has(key)) pending.set(key, 'web-' + crypto.randomUUID());
  payload.request_id = pending.get(key);
  const r = await call(tool, payload);
  pending.delete(key);
  return r;
}
const can = tool => allowed.has(P + tool);

// ---- Presentation helpers -----------------------------------------------------------

// Times are shown exactly as the tools return them, in the group's offset.
const when = s => (s ? `${s.slice(0, 10)} ${s.slice(11, 16)} ${s.endsWith('Z') ? 'UTC' : 'UTC' + s.slice(-6)}` : '-');
const meta = (label, value) => el('div', {class: 'metadata-line'}, el('span', {}, label), el('strong', {}, value === null || value === undefined || value === '' ? '-' : String(value)));
const tag = text => el('span', {class: 'tag'}, text);
const section = (title, ...children) => el('section', {class: 'query-result', 'data-section': title.toLowerCase().replace(/[^a-z]+/g, '-')}, el('h3', {}, title), ...children);
const link = (href, text, attrs = {}) => el('a', {href, ...attrs}, text);
const who = m => `${m.display_name} (${m.member_id})`;
const status = el('p', {role: 'status', 'aria-live': 'polite', id: 'status'}, 'Connecting...');
function say(text, error = false) {
  status.textContent = text;
  if (error) status.dataset.error = 'true'; else delete status.dataset.error;
}
const fail = e => say((e.code ? e.code + ': ' : '') + e.message, true);
function button(label, onclick, attrs = {}) {
  return el('button', {type: 'button', ...attrs, onclick: async event => {
    const b = event.currentTarget;
    if (busy) return;
    busy = true; b.disabled = true;
    try { await onclick(); } catch (e) { fail(e); } finally { busy = false; b.disabled = false; }
  }}, label);
}
function field(label, input, help) {
  return el('label', {class: 'field'}, el('span', {}, label), input, help ? el('small', {}, help) : null);
}
const input = (name, value = '', attrs = {}) => el('input', {'data-field': name, value: value ?? '', ...attrs});
function select(name, options, value) {
  const s = el('select', {'data-field': name});
  for (const [v, label] of options) s.append(el('option', {value: v}, label));
  if (value !== undefined && value !== null) s.value = value;
  return s;
}
const valueOf = (form, name) => form.querySelector(`[data-field="${name}"]`)?.value ?? '';
// A preview block: the tool's own summary, every recipient, and a confirm button.
function previewBlock(title, preview, confirmLabel, confirm) {
  const box = section(title,
    meta('Preview', `${preview.id}, expires ${when(preview.expires_at)}`),
    ...Object.entries(preview).filter(([k]) => !['id', 'kind', 'created_at', 'expires_at', 'recipients', 'fields', 'event', 'prefilled_from'].includes(k))
      .map(([k, v]) => meta(k.replace(/_/g, ' '), typeof v === 'object' && v !== null ? JSON.stringify(v) : v)));
  if (preview.event) box.append(meta('event', `${preview.event.title} (${preview.event.id}), ${when(preview.event.start)}, ${preview.event.venue}`));
  if (preview.fields) box.append(meta('fields', JSON.stringify(preview.fields)));
  if (preview.prefilled_from) {
    const p = preview.prefilled_from;
    box.append(el('p', {class: 'form-error', 'data-prefilled': 'true'}, `Counts were pre-filled from RSVP ${p.rsvp_id} for ${p.event_title}, answered ${when(p.answered_at)}: guests ${p.guests}, children ${p.children}.`));
  }
  if (preview.recipients) {
    const list = el('ul', {'data-recipients': String(preview.recipients.length)});
    for (const r of preview.recipients) list.append(el('li', {}, who(r)));
    box.append(el('h4', {}, `Recipients (${preview.recipients.length})`), list);
  }
  box.append(el('div', {class: 'form-actions'}, button(confirmLabel, confirm, {class: 'primary', 'data-confirm': preview.id})));
  return box;
}

// ---- View-as selector -----------------------------------------------------------------

// Lists members already visible on the page; the answer is the tool's.
function viewAs(objectType, objectId, members) {
  const unique = [...new Map(members.map(m => [m.member_id, m])).values()].sort((a, b) => a.display_name.localeCompare(b.display_name));
  const out = el('div', {'data-view-as-result': ''});
  const choice = select('view_as_member', [['', 'Choose a member'], ...unique.map(m => [m.member_id, who(m)])]);
  choice.addEventListener('change', async () => {
    out.replaceChildren();
    if (!choice.value) return;
    try {
      const r = await call('visibility.view_as', {member_id: choice.value, object_type: objectType, object_id: objectId});
      out.dataset.visible = String(r.visible);
      out.append(meta('Member', who(r.member)), meta('Can see it now', r.visible ? 'yes' : 'no'), meta('As of', when(r.as_of)), el('small', {}, r.note));
      if (r.view) {
        const v = r.view;
        if (objectType === 'event') out.append(meta('Guest list', v.guests_hidden ? 'hidden from this member' : `${v.guests.length} guests`), meta('Their RSVP', v.my_rsvp ? `${v.my_rsvp.answer}, places ${v.my_rsvp.places}` : 'none'));
        if (objectType === 'sheet') out.append(meta('Their slots', v.my_slots.join(', ') || 'none'));
        if (objectType === 'group') out.append(meta('Their membership', v.my_membership ? `${v.my_membership.state}${v.my_membership.role ? ', ' + v.my_membership.role : ''}` : 'none'));
        if (objectType === 'post') out.append(meta('Audience', v.audience), meta('Text', v.text));
      }
    } catch (e) { fail(e); }
  });
  return section('View as', el('p', {}, 'See this ' + objectType + ' as another member sees it now. This does not show what was already delivered to them.'),
    field('Member', choice), out);
}

// ---- Shell ------------------------------------------------------------------------------

const nav = el('nav', {'aria-label': 'Stoopside navigation'});
const title = el('h2', {class: 'section-title', id: 'page-title'}, 'Stoopside');
const content = el('div', {id: 'page'});
function shell() {
  const mark = el('span', {class: 'brand-mark', 'aria-hidden': 'true'}, 'S');
  document.title = 'Stoopside · PALE';
  document.body.dataset.app = 'stoopside';
  document.querySelector('#app').replaceChildren(el('div', {class: 'app-shell'},
    el('aside', {class: 'sidebar'}, el('div', {class: 'brand'}, mark, el('h1', {}, 'Stoopside')), nav,
      el('div', {class: 'sidebar-foot'}, el('div', {}, el('strong', {}, 'Community groups'), el('small', {}, 'Agent connection')))),
    el('main', {class: 'app-main'}, el('header', {class: 'toolbar'}, title, button('Refresh', () => render(), {'data-action': 'refresh'})), status,
      el('section', {class: 'detail', 'aria-label': 'Page'}, el('article', {}, content)))));
}
function navigation(groups, route) {
  const item = (href, label, symbol) => el('button', {type: 'button', 'aria-current': location.hash === href || (href === '#/groups' && route[0] === 'group') ? 'page' : false,
    onclick: () => { location.hash = href; }}, el('span', {class: 'nav-symbol', 'aria-hidden': 'true'}, symbol), el('span', {}, label));
  nav.replaceChildren(item('#/groups', 'Groups', '#'), item('#/profile', 'Profile', '@'), item('#/help', 'Help', '?'),
    ...groups.filter(g => g.my_membership?.state === 'member').map(g => item('#/group/' + g.id, g.name, '>')));
}

// ---- Pages -------------------------------------------------------------------------------

async function groupsPage(id) {
  const groups = (await call('groups.list', {})).groups;
  const list = el('div', {class: 'records', id: 'records'});
  const search = input('group_query', '', {type: 'search', placeholder: 'Search groups', 'aria-label': 'Search groups'});
  const fill = items => list.replaceChildren(...items.map(g => el('a', {class: 'record', href: '#/group/' + g.id, 'data-record-id': g.id, 'aria-current': g.id === id ? 'page' : false},
    el('span', {class: 'record-title'}, g.name), el('span', {class: 'record-subtitle'}, `${g.member_count} members · ${g.my_membership ? g.my_membership.state : 'not a member'}`))));
  fill(groups);
  search.addEventListener('change', async () => { try { fill((await call('groups.list', {query: search.value})).groups); } catch (e) { fail(e); } });
  const body = [el('h2', {}, 'Groups'), field('Discover groups', search), list];
  if (!id) return {title: 'Groups', body, groups};
  const r = await call('groups.get', {group_id: id}), g = r.group, mine = g.my_membership;
  const member = mine?.state === 'member';
  const actions = el('div', {class: 'actions detail-actions'});
  if (!mine || ['left', 'declined'].includes(mine.state)) actions.append(button('Join group', async () => { await write('groups.join', {group_id: id}); say('Join request sent.'); await render(); }));
  if (mine && ['member', 'pending'].includes(mine.state)) actions.append(button(mine.state === 'pending' ? 'Withdraw request' : 'Leave group', async () => { await write('groups.leave', {group_id: id}); say('Left the group.'); await render(); }));
  if (member) actions.append(link('#/members/' + id, 'Member directory'), link('#/compose/' + id, 'New post'), link('#/change/new/' + id, 'New event'));
  const detail = [el('span', {class: 'kicker'}, 'Group'), el('h2', {'data-group-name': g.id}, g.name), el('p', {class: 'body-text'}, g.description),
    el('div', {class: 'tags'}, ...[g.requires_approval && 'Approval needed', g.hide_from_member_list && 'Member list hidden', g.hide_rsvps && 'Guest lists hidden', `Times in ${g.time_zone} (UTC${g.utc_offset})`].filter(Boolean).map(tag)),
    meta('Members', g.member_count), meta('Your membership', mine ? `${mine.state}${mine.role ? ', ' + mine.role.replace('_', '-') : ''}` : 'not a member'), actions,
    section('Hosts', ...r.hosts.map(h => meta(h.role.replace('_', '-'), who(h))))];
  if (member) {
    detail.push(section('Upcoming events', ...(r.upcoming_events.length ? r.upcoming_events.map(e => el('p', {}, link('#/event/' + e.id, e.title, {'data-event-id': e.id}),
      ` · ${when(e.start)} · ${e.venue} · ${e.places_taken}/${e.capacity} taken` + (e.my_rsvp ? ` · your RSVP: ${e.my_rsvp.answer}` : ''))) : [el('p', {}, 'No upcoming events.')])));
    const posts = (await call('posts.list', {group_id: id})).posts;
    detail.push(section(`Posts (${posts.length})`, el('small', {}, posts.length > 25 ? 'Newest 25 shown.' : 'Newest first.'), ...posts.slice(-25).reverse().map(p => postItem(p, id))));
    detail.push(viewAs('group', id, [...r.hosts, ...posts.map(p => p.author)]));
  }
  return {title: g.name, body: [...detail, el('hr'), ...body], groups};
}

function postItem(p, groupId) {
  const actions = el('div', {class: 'actions'});
  if (!p.locked && p.state !== 'deleted') {
    actions.append(link(`#/compose/${groupId}/comment/${p.parent_id || p.id}`, 'Comment'));
    actions.append(link(`#/compose/${groupId}/edit/${p.id}`, 'Edit'));
    actions.append(button('Delete', async () => { await write('posts.delete', {post_id: p.id}); say(`Deleted ${p.id}. Anything already delivered stays delivered.`); await render(); }, {'data-delete': p.id}));
  }
  return el('div', {class: 'metadata-line', 'data-post-id': p.id},
    el('span', {}, `${p.kind}${p.parent_id ? ' on ' + p.parent_id : ''} · ${p.audience}${p.event_id ? ' · ' + p.event_id : ''} · ${when(p.created_at)}`),
    el('div', {}, el('strong', {}, who(p.author)), el('p', {}, p.text), el('small', {}, `${p.id} · ${p.state}${p.locked ? ' · locked' : ''}`), actions));
}

async function membersPage(groupId) {
  const g = (await call('groups.get', {group_id: groupId})).group;
  const q = input('member_query', '', {type: 'search', placeholder: 'Part of a display name or bio', 'aria-label': 'Search members'});
  const results = el('div', {'data-members': ''});
  const run = async () => {
    const members = (await call('members.search', {group_id: groupId, query: q.value})).members;
    results.replaceChildren(el('p', {}, `${members.length} members match. Search matches display names and bios only.`),
      ...members.map(m => meta(m.role ? m.role.replace('_', '-') : 'member', `${who(m)}: ${m.bio}`)));
  };
  const body = [el('span', {class: 'kicker'}, 'Member directory'), el('h2', {}, g.name), field('Search', q), button('Search', run, {'data-action': 'search'}), results];
  try { await run(); } catch (e) { results.replaceChildren(el('p', {class: 'form-error'}, `${e.code}: ${e.message}`)); }
  if (can('members.export')) {
    const out = el('div', {'data-export': ''});
    body.push(section('Member export', el('p', {}, 'Co-organizers and organizers only. The export is the only place emails appear.'),
      button('Export members', async () => {
        const r = await call('members.export', {group_id: groupId});
        out.replaceChildren(...r.members.map(m => meta(m.member_id, `${m.display_name} · ${m.email} · ${m.role} · since ${when(m.member_since)}`)));
      }, {'data-action': 'export'}), out));
  }
  return {title: 'Members: ' + g.name, body};
}

async function eventPage(id) {
  const e = (await call('events.get', {event_id: id})).event;
  const body = [el('span', {class: 'kicker'}, `Event · ${e.group_id}`), el('h2', {'data-event-title': e.id}, e.title), el('p', {class: 'body-text'}, e.description),
    el('div', {class: 'tags'}, tag(e.state), tag(`${e.places_taken}/${e.capacity} places taken`), tag(`${e.waitlist_count} waiting`)),
    meta('When', `${when(e.start)} to ${when(e.end)}`), meta('Venue', e.venue), meta('Guest limit', e.guest_limit),
    meta('RSVPs', `open ${when(e.rsvp_open)}, close ${when(e.rsvp_close)}`), meta('Hosts', e.hosts.map(who).join(', ')),
    meta('Your RSVP', e.my_rsvp ? `${e.my_rsvp.id}: ${e.my_rsvp.answer}, guests ${e.my_rsvp.guests}, children ${e.my_rsvp.children}, places ${e.my_rsvp.places}` +
      (e.my_rsvp.waitlist_position ? `, waitlist position ${e.my_rsvp.waitlist_position}` : '') + (e.my_rsvp.offer_expires_at ? `, claim by ${when(e.my_rsvp.offer_expires_at)}` : '') +
      (e.my_rsvp.reconfirm_by ? `, reconfirm by ${when(e.my_rsvp.reconfirm_by)}` : '') : 'none')];
  if (e.state === 'published') {
    const form = el('form', {class: 'fields', 'data-form': 'rsvp'},
      field('Answer', select('answer', [['yes', 'Yes'], ['no', 'No']])),
      field('Guests', input('guests', '', {type: 'number', min: 0, max: 20}), 'Leave empty to pre-fill from your latest RSVP in this group.'),
      field('Children', input('children', '', {type: 'number', min: 0, max: 20}), 'Leave empty to pre-fill from your latest RSVP in this group.'),
      field('Rejoin the waitlist after an expired offer', select('rejoin_waitlist', [['', 'No'], ['true', 'Yes']])));
    const out = el('div');
    form.append(el('div', {class: 'form-actions'}, button('Preview RSVP', async () => {
      const args = {event_id: id, answer: valueOf(form, 'answer')};
      for (const k of ['guests', 'children']) if (valueOf(form, k) !== '') args[k] = Number(valueOf(form, k));
      if (valueOf(form, 'rejoin_waitlist')) args.rejoin_waitlist = true;
      const p = (await write('rsvps.preview', args)).preview;
      out.replaceChildren(previewBlock('RSVP preview', p, 'Confirm RSVP', async () => {
        const c = await write('rsvps.confirm', {preview_id: p.id});
        say(`RSVP ${c.rsvp.id} is ${c.rsvp.answer} (${c.receipt.outcome}).`);
        await render();
      }));
    }, {class: 'primary', 'data-action': 'preview-rsvp'})));
    body.push(section('RSVP', form, out));
    body.push(el('div', {class: 'actions detail-actions'}, link(`#/change/edit/${id}`, 'Edit event'), link(`#/change/cancel/${id}`, 'Cancel event'),
      link(`#/compose/${e.group_id}/event/${id}`, 'Post to guests')));
  }
  body.push(section('Guests', ...(e.guests_hidden ? [el('p', {}, 'This group hides guest lists from members who are not hosts.')] :
    e.guests.map(x => meta(x.answer, `${who(x)} · guests ${x.guests}, children ${x.children}`)))));
  if (e.sheets.length) body.push(section('Sign-up sheets', ...e.sheets.map(s => el('p', {}, link('#/sheet/' + s.id, s.title, {'data-sheet-id': s.id})))));
  if (e.changes.length) body.push(section('Changes', ...e.changes.map(c => meta(when(c.at), `${c.action}: ${JSON.stringify(c.fields)}${c.notify ? ', notified ' + c.notify : ''}`))));
  try {
    const posts = (await call('posts.list', {group_id: e.group_id, event_id: id})).posts;
    body.push(section(`Posts about this event (${posts.length})`, ...posts.map(p => postItem(p, e.group_id))));
  } catch (err) { /* the user may not be a member any more */ }
  body.push(viewAs('event', id, [...e.hosts, ...e.guests]));
  return {title: e.title, body};
}

const EVENT_FIELDS = ['title', 'description', 'start', 'end', 'venue', 'capacity', 'guest_limit', 'rsvp_open', 'rsvp_close'];
async function changePage(mode, id) {
  const e = mode === 'new' ? null : (await call('events.get', {event_id: id})).event;
  const groupId = e ? e.group_id : id;
  const form = el('form', {class: 'fields', 'data-form': 'change'});
  if (mode !== 'cancel') {
    for (const k of EVENT_FIELDS) {
      const numeric = ['capacity', 'guest_limit'].includes(k);
      form.append(field(k.replace(/_/g, ' '), input(k, e ? e[k] : '', numeric ? {type: 'number', min: 0} : {}),
        ['start', 'end', 'rsvp_open', 'rsvp_close'].includes(k) ? 'ISO time with the group\'s offset, for example 2027-04-01T10:00:00-05:00.' : null));
    }
  }
  if (mode !== 'new') form.append(field('Notify', select('notify', [['', 'Nobody (allowed only when date, time and venue stay the same)'], ['guests', 'Guests: every open RSVP'], ['group', 'The whole group']])));
  const out = el('div');
  form.append(el('div', {class: 'form-actions'}, button('Preview change', async () => {
    const args = {change: mode === 'new' ? 'create' : mode};
    if (mode === 'new') args.group_id = groupId; else args.event_id = id;
    if (mode !== 'cancel') {
      args.fields = {};
      for (const k of EVENT_FIELDS) {
        const raw = valueOf(form, k), value = ['capacity', 'guest_limit'].includes(k) && raw !== '' ? Number(raw) : raw;
        if (mode === 'new' ? raw !== '' : String(value) !== String(e[k])) args.fields[k] = value;
      }
    }
    if (valueOf(form, 'notify')) args.notify = valueOf(form, 'notify');
    const p = (await write('events.preview_change', args)).preview;
    out.replaceChildren(previewBlock('Change preview', p, 'Confirm change', async () => {
      const c = await write('events.confirm_change', {preview_id: p.id});
      say(`${c.receipt.change} committed for ${c.receipt.event_id}; ${c.receipt.recipient_count} members notified.`);
      location.hash = '#/event/' + c.receipt.event_id;
    }));
  }, {class: 'primary', 'data-action': 'preview-change'})));
  return {title: {new: 'New event', edit: 'Edit event', cancel: 'Cancel event'}[mode], body: [el('span', {class: 'kicker'}, 'Change preview'),
    el('h2', {}, e ? e.title : 'New event in ' + groupId), mode === 'cancel' ? el('p', {}, 'Cancelling notifies every open RSVP, locks the event\'s sign-up sheets and cannot be undone.') : null, form, out]};
}

async function composePage(groupId, mode, ref) {
  const g = (await call('groups.get', {group_id: groupId}));
  const events = (await call('events.list', {group_id: groupId})).events;
  const posts = mode === 'edit' || mode === 'comment' ? (await call('posts.list', {group_id: groupId})).posts : [];
  const target = posts.find(p => p.id === ref);
  const form = el('form', {class: 'fields', 'data-form': 'compose'});
  if (mode !== 'edit') {
    form.append(field('Kind', select('kind', [['post', 'Post'], ['comment', 'Comment'], ['announcement', 'Announcement (emailed to every member)']], mode === 'comment' ? 'comment' : 'post')));
    form.append(field('Audience', select('audience', [['', 'Choose an audience'], ['group', 'Everyone in the group'], ['event_guests', 'Guests of an event (RSVP yes)'], ['hosts_only', 'Hosts only']],
      mode === 'event' ? 'event_guests' : ''), 'Required for posts and announcements; comments use their parent\'s audience.'));
    form.append(field('Event', select('event_id', [['', 'No event'], ...events.map(x => [x.id, `${x.title} (${x.id})`])], mode === 'event' ? ref : '')));
    form.append(field('Comment on', input('parent_id', mode === 'comment' ? ref : '', {placeholder: 'Post ID, for comments'})));
  }
  form.append(field('Text', el('textarea', {'data-field': 'text', rows: 5}, target && mode === 'edit' ? target.text : '')));
  const out = el('div');
  form.append(el('div', {class: 'form-actions'}, button('Preview', async () => {
    const args = {group_id: groupId, text: valueOf(form, 'text')};
    if (mode === 'edit') Object.assign(args, {kind: target ? target.kind : 'post', edit_of: ref});
    else {
      args.kind = valueOf(form, 'kind');
      for (const k of ['audience', 'event_id', 'parent_id']) if (valueOf(form, k)) args[k] = valueOf(form, k);
      if (args.kind === 'comment') delete args.event_id;
    }
    const p = (await write('posts.preview', args)).preview;
    out.replaceChildren(previewBlock('Post preview', p, mode === 'edit' ? 'Save edit' : 'Publish', async () => {
      const c = await write('posts.publish', {preview_id: p.id});
      say(`${c.receipt.post_id} ${c.receipt.mode === 'edit' ? 'edited' : 'published'}; ${c.receipt.recipient_count} members notified.`);
      location.hash = '#/group/' + groupId;
    }));
  }, {class: 'primary', 'data-action': 'preview-post'})));
  return {title: 'Post composer', body: [el('span', {class: 'kicker'}, 'Post composer'), el('h2', {}, `${mode === 'edit' ? 'Edit ' + ref : mode === 'comment' ? 'Comment on ' + ref : 'New post'} in ${g.group.name}`), form, out]};
}

async function sheetPage(id) {
  const me = (await call('profile.get', {})).profile.member_id;
  const r = await call('signups.get', {sheet_id: id}), s = r.sheet;
  const claimers = s.slots.flatMap(x => x.claimed_by);
  const body = [el('span', {class: 'kicker'}, 'Sign-up sheet'), el('h2', {'data-sheet-title': s.id}, s.title),
    el('p', {}, link('#/event/' + s.event_id, 'Back to event ' + s.event_id)),
    el('div', {class: 'tags'}, tag(s.locked ? 'Locked' : 'Open'), tag('Locks ' + when(s.lock_at))), meta('Your slots', s.my_slots.join(', ') || 'none')];
  body.push(section('Slots', ...s.slots.map(slot => {
    const mine = s.my_slots.includes(slot.id), actions = el('div', {class: 'actions'});
    if (!s.locked && !mine) actions.append(button('Claim', async () => { await write('signups.claim', {sheet_id: id, slot_id: slot.id}); say(`Claimed ${slot.label}.`); await render(); }, {'data-claim': slot.id}));
    if (!s.locked && mine) actions.append(button('Release', async () => { await write('signups.release', {sheet_id: id, slot_id: slot.id}); say(`Released ${slot.label}.`); await render(); }, {'data-release': slot.id}));
    return el('div', {class: 'metadata-line', 'data-slot-id': slot.id}, el('span', {}, `${slot.label} (${slot.id})`),
      el('div', {}, el('strong', {}, `${slot.open} of ${slot.quantity} open`), el('p', {}, slot.claimed_by.map(who).join(', ') || 'nobody yet'), actions));
  })));
  body.push(section(`Swaps (${r.swaps.length})`, ...r.swaps.map(w => {
    const actions = el('div', {class: 'actions'});
    if (w.state === 'proposed') {
      for (const answer of ['accept', 'decline', 'withdraw']) {
        actions.append(button(answer[0].toUpperCase() + answer.slice(1), async () => { await write('signups.swap_answer', {swap_id: w.id, answer}); say(`Swap ${w.id}: ${answer}.`); await render(); }, {'data-swap-answer': w.id + ':' + answer}));
      }
    }
    return el('div', {class: 'metadata-line', 'data-swap-id': w.id}, el('span', {}, `${w.id} · ${w.state}`),
      el('div', {}, el('strong', {}, `${who(w.from)} gives ${w.give_slot} for ${who(w.to)}'s ${w.want_slot}`), el('small', {}, `proposed ${when(w.proposed_at)}, expires ${when(w.expires_at)}`), actions));
  })));
  if (!s.locked && s.my_slots.length) {
    const others = [...new Map(claimers.filter(m => m.member_id !== me).map(m => [m.member_id, m])).values()];
    const form = el('form', {class: 'fields', 'data-form': 'swap'},
      field('Give', select('give_slot', s.my_slots.map(x => [x, x]))),
      field('Want', select('want_slot', s.slots.filter(x => x.claimed_by.length).map(x => [x.id, `${x.label} (${x.id})`]))),
      field('From member', select('member_id', others.map(m => [m.member_id, who(m)]))));
    form.append(el('div', {class: 'form-actions'}, button('Propose swap', async () => {
      const w = (await write('signups.swap_propose', {sheet_id: id, give_slot: valueOf(form, 'give_slot'), want_slot: valueOf(form, 'want_slot'), member_id: valueOf(form, 'member_id')})).swap;
      say(`Swap ${w.id} proposed; it expires ${when(w.expires_at)}.`);
      await render();
    }, {'data-action': 'propose-swap'})));
    body.push(section('Propose a swap', form));
  }
  body.push(viewAs('sheet', id, claimers));
  return {title: s.title, body};
}

async function profilePage() {
  const r = await call('profile.get', {});
  const form = el('form', {class: 'fields', 'data-form': 'profile'},
    field('Display name', input('display_name', r.profile.display_name)), field('Bio', el('textarea', {'data-field': 'bio', rows: 3}, r.profile.bio)));
  form.append(el('div', {class: 'form-actions'}, button('Save profile', async () => {
    const args = {};
    if (valueOf(form, 'display_name') !== r.profile.display_name) args.display_name = valueOf(form, 'display_name');
    if (valueOf(form, 'bio') !== r.profile.bio) args.bio = valueOf(form, 'bio');
    await write('profile.update', args);
    say('Profile saved.');
    await render();
  }, {class: 'primary', 'data-action': 'save-profile'})));
  return {title: 'Profile', body: [el('span', {class: 'kicker'}, 'Profile'), el('h2', {'data-profile': r.profile.member_id}, `${r.profile.display_name} (${r.profile.member_id})`),
    el('p', {class: 'body-text'}, r.profile.bio), form,
    section('Memberships', ...r.memberships.map(m => meta(m.state + (m.role ? ', ' + m.role.replace('_', '-') : ''), m.group_name)))]};
}

async function helpPage() {
  const r = await call('help.get', {});
  return {title: 'Help', body: [el('span', {class: 'kicker'}, 'Help'), el('h2', {}, 'How Stoopside works'),
    ...r.topics.map(t => section(t.topic[0].toUpperCase() + t.topic.slice(1), ...t.rules.map(x => el('p', {'data-rule': t.topic}, x))))]};
}

// ---- Router ------------------------------------------------------------------------------

async function render() {
  const ticket = ++renderTicket;
  const route = (location.hash.replace(/^#\/?/, '') || 'groups').split('/').map(decodeURIComponent);
  document.querySelector('#app').setAttribute('aria-busy', 'true');
  try {
    allowed = new Set((await http('/api/tools')).tools.map(t => t.name));
    let page;
    if (route[0] === 'group') page = await groupsPage(route[1]);
    else if (route[0] === 'members') page = await membersPage(route[1]);
    else if (route[0] === 'event') page = await eventPage(route[1]);
    else if (route[0] === 'change') page = await changePage(route[1], route[2]);
    else if (route[0] === 'compose') page = await composePage(route[1], route[2], route[3]);
    else if (route[0] === 'sheet') page = await sheetPage(route[1]);
    else if (route[0] === 'profile') page = await profilePage();
    else if (route[0] === 'help') page = await helpPage();
    else page = await groupsPage(null);
    if (ticket !== renderTicket) return;
    const groups = page.groups || (await call('groups.list', {})).groups;
    if (ticket !== renderTicket) return;
    navigation(groups, route);
    title.textContent = page.title;
    content.replaceChildren(...page.body.filter(Boolean));
    content.dataset.page = route[0];
    if (status.dataset.error !== 'true' && /Connecting|Loading/.test(status.textContent)) say('Loaded.');
  } catch (e) {
    if (ticket === renderTicket) { content.replaceChildren(el('div', {class: 'empty'}, el('h3', {}, 'This page is not available'), el('p', {}, e.message))); fail(e); }
  } finally {
    if (ticket === renderTicket) document.querySelector('#app').setAttribute('aria-busy', 'false');
  }
}

(async () => {
  shell();
  try {
    const token = new URLSearchParams(location.hash.slice(1)).get('access');
    if (token) {
      history.replaceState(null, '', location.pathname + '#/groups');
      ({csrf} = await http('/session', 'POST', {token}));
    } else ({csrf} = await http('/session'));
    window.addEventListener('hashchange', () => { say('Loading...'); render(); });
    say('Loading...');
    await render();
  } catch (e) { fail(e); }
})();
