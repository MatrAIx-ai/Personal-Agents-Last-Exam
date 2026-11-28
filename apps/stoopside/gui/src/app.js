import {el} from '/shared/client.js';
// Stoopside business pages. Every value shown comes from a Stoopside tool
// result over the Host's fixed Agent MCP connection; the page keeps no
// business state of its own. Business rules are applied by the tools: the page
// only formats their results and hides controls that the current profile does
// not list, or that the user's role in the group shown by the tools cannot use.
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
// The page context of the current render: the user's groups (with their role in
// each, from groups.list) and their member ID (from profile.get).
const ctx = {groups: [], me: null};

// ---- App-owned styles --------------------------------------------------------------
// The Host serves only the shared stylesheet and allows no inline <style>, so the
// App's own rules are a constructed stylesheet. They raise every App-owned text
// to at least 12px (body 14px) and add event, group, post and member cards.
const CSS = `
body[data-app=stoopside] #status{font-size:13px;height:auto;min-height:30px}
body[data-app=stoopside] .kicker{font-size:12px}
body[data-app=stoopside] .tag{font-size:12px;padding:3px 8px}
body[data-app=stoopside] .record-subtitle,body[data-app=stoopside] .field small,body[data-app=stoopside] small{font-size:12px}
body[data-app=stoopside] .sidebar-foot strong,body[data-app=stoopside] .sidebar-foot small,body[data-app=stoopside] .sidebar nav button small{font-size:12px}
body[data-app=stoopside] .toolbar button{font-size:13px}
body[data-app=stoopside] .detail-actions button,body[data-app=stoopside] .actions button{font-size:13px}
body[data-app=stoopside] .metadata-line{font-size:13px}
body[data-app=stoopside] .query-result{margin:24px 0}
body[data-app=stoopside] .detail article{max-width:980px}
body[data-app=stoopside] p{font-size:14px}
.st-lead{font-size:14px;color:#48556a;margin:10px 0 0}
.st-muted{color:var(--muted);font-size:12px}
.st-id{color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}
.st-cards{display:grid;gap:12px;margin-top:14px}
.st-grid{grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}
.st-card{display:flex;gap:14px;align-items:flex-start;padding:14px 16px;border:1px solid var(--line);border-radius:12px;background:#fff;color:inherit;text-decoration:none;min-width:0}
a.st-card:hover{border-color:#becbe0;background:#f8faff}
a.st-card[aria-current=page]{border-color:var(--accent);box-shadow:inset 3px 0 var(--accent)}
.st-card-body{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1}
.st-card-title{font-weight:650;font-size:15px;line-height:1.35}
.st-card-line{font-size:13px;color:#48556a}
.st-date{display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:54px;padding:6px 4px;border-radius:10px;background:var(--soft);color:var(--accent);line-height:1.1}
.st-date small{font-size:12px;font-weight:650;color:var(--accent);letter-spacing:.06em}
.st-date strong{font-size:22px;font-weight:700}
.st-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
.st-chip{display:inline-block;border-radius:999px;padding:2px 10px;font-size:12px;background:#f1f3f6;color:#4d5a6e}
.st-chip.ok{background:#e7f6ec;color:#1f6b3a}
.st-chip.warn{background:#fff4e0;color:#8a5300}
.st-chip.bad{background:#fdecea;color:#a23a2f}
.st-chip.mine{background:#e1e9f7;color:var(--accent)}
.st-hero{display:flex;gap:18px;align-items:flex-start;margin-bottom:10px}
.st-hero .st-date{min-width:70px;padding:10px 6px}
.st-hero .st-date strong{font-size:28px}
.st-facts{display:grid;gap:6px;margin:14px 0;font-size:14px}
.st-facts div{display:flex;gap:10px}
.st-facts dt{min-width:110px;color:var(--muted);font-size:13px}
.st-facts dd{margin:0;min-width:0}
.st-box{border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin:18px 0;background:#fff}
.st-box h3{font-size:15px;margin-bottom:8px}
.st-box p+p{margin-top:8px}
.st-flash{display:flex;gap:12px;align-items:flex-start;justify-content:space-between;margin:0 0 18px;padding:12px 16px;border-radius:10px;font-size:14px;background:#e7f6ec;color:#1f4f30;border:1px solid #bfe3cb}
.st-flash.error{background:#fdecea;color:#7c2a22;border-color:#f3c4bd}
.st-flash button{padding:2px 10px;font-size:13px;background:transparent}
.st-error{margin-top:12px;padding:10px 14px;border-radius:10px;background:#fdecea;color:#7c2a22;font-size:14px}
.st-error:empty{display:none}
.st-note{margin-top:10px;padding:10px 14px;border-radius:10px;background:#fff4e0;color:#6b4300;font-size:14px}
.st-preview{border:1px solid #becbe0;border-radius:12px;padding:18px;margin:18px 0;background:#f8faff}
.st-preview h3{font-size:16px;margin-bottom:10px}
.st-preview p{margin-top:8px}
.st-preview ul{margin:8px 0 0;padding-left:20px;font-size:14px}
.st-preview blockquote{margin:10px 0;padding:10px 14px;border-left:3px solid var(--accent);background:#fff;white-space:pre-wrap;font-size:14px}
.st-recipients{columns:2;column-gap:28px}
.st-recipients li{break-inside:avoid}
.st-confirm{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px;padding:10px 12px;border-radius:10px;background:#fff4e0;font-size:14px}
.st-post{display:block}
.st-post-head{display:flex;flex-wrap:wrap;gap:8px;align-items:baseline}
.st-post-text{white-space:pre-wrap;margin:6px 0 4px;font-size:14px;line-height:1.6}
.st-post.comment{margin-left:28px;border-style:dashed}
.st-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
.st-actions a,.st-linkbtn{font-size:13px}
.st-section{margin-top:28px}
.st-section>h3{font-size:16px;margin-bottom:6px}
@media(max-width:760px){.st-recipients{columns:1}.st-hero{flex-direction:column}.st-facts div{flex-direction:column;gap:0}.st-post.comment{margin-left:12px}}
`;
function installStyles() {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  } catch { /* an older browser keeps the shared stylesheet only */ }
}

// ---- Transport ------------------------------------------------------------------

async function http(url, method = 'GET', value) {
  const r = await fetch(url, {method, headers: method === 'POST' ? {'Content-Type': 'application/json', 'X-Pale-CSRF': csrf} : {},
    ...(method === 'POST' ? {body: JSON.stringify(value)} : {})});
  const out = await r.json();
  if (!r.ok) throw Error(out.error || 'Request failed');
  return out;
}
const MESSAGES = {
  stale_version: 'Something changed since this page loaded. Refresh the page and try again.',
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

// ---- Roles (as groups.list reports them) ------------------------------------------------
// The tools enforce every role rule; these only decide which controls to show.
const RANK = {member: 0, event_host: 1, co_organizer: 2, organizer: 3};
const ROLE = {member: 'Member', event_host: 'Event host', co_organizer: 'Co-organizer', organizer: 'Organizer'};
const groupOf = id => ctx.groups.find(g => g.id === id);
const roleIn = id => { const m = groupOf(id)?.my_membership; return m && m.state === 'member' ? m.role : null; };
const atLeast = (id, role) => roleIn(id) !== null && RANK[roleIn(id)] >= RANK[role];
const canManage = e => atLeast(e.group_id, 'co_organizer') || e.hosts.some(h => h.member_id === ctx.me);

// ---- Times in the group's zone --------------------------------------------------------
let zone = {offset: '-05:00', label: 'EST'};
function useZone(g) { if (g && g.utc_offset) zone = {offset: g.utc_offset, label: g.time_zone || 'UTC' + g.utc_offset}; }
const offsetMinutes = o => (o[0] === '-' ? -1 : 1) * (Number(o.slice(1, 3)) * 60 + Number(o.slice(4, 6)));
const local = s => { const t = Date.parse(s); return Number.isFinite(t) ? new Date(t + offsetMinutes(zone.offset) * 60000) : null; };
const fmt = opts => { const f = new Intl.DateTimeFormat('en-US', {timeZone: 'UTC', ...opts}); return d => f.format(d).replace(/ /g, ' '); };
const fDay = fmt({weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'});
const fTime = fmt({hour: 'numeric', minute: '2-digit'});
const fMonth = fmt({month: 'short'});
// "Sat, Mar 20, 2027, 4:00 PM EST"
const when = s => { const d = s && local(s); return d ? `${fDay(d)}, ${fTime(d)} ${zone.label}` : 'not set'; };
const day = s => { const d = s && local(s); return d ? fDay(d) : 'not set'; };
function span(a, b) {
  const x = local(a), y = local(b);
  if (!x || !y) return when(a);
  return fDay(x) === fDay(y) ? `${fDay(x)}, ${fTime(x)} to ${fTime(y)} ${zone.label}` : `${when(a)} to ${when(b)}`;
}
const toInput = s => { const d = s && local(s); return d ? d.toISOString().slice(0, 16) : ''; };
const fromInput = v => (v ? `${v}:00${zone.offset}` : '');

// ---- Presentation helpers -----------------------------------------------------------

const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
function party(guests, children) {
  const bits = ['you'];
  if (guests) bits.push(plural(guests, 'guest'));
  if (children) bits.push(plural(children, 'child', 'children'));
  return bits.length === 1 ? 'just you' : bits.slice(0, -1).join(', ') + ' and ' + bits.at(-1);
}
const chip = (text, kind = '') => el('span', {class: 'st-chip ' + kind}, text);
const tag = text => el('span', {class: 'tag'}, text);
const idText = text => el('span', {class: 'st-id'}, text);
const section = (title, ...children) => el('section', {class: 'st-section', 'data-section': title.toLowerCase().replace(/[^a-z]+/g, '-').replace(/-$/, '')}, el('h3', {}, title), ...children);
const link = (href, text, attrs = {}) => el('a', {href, ...attrs}, text);
const facts = rows => el('dl', {class: 'st-facts'}, ...rows.filter(Boolean).map(([k, v]) => el('div', {}, el('dt', {}, k), el('dd', {}, v))));
const nameOf = m => m.display_name;
const AUDIENCE = {group: 'Everyone in the group', event_guests: 'Guests of the event', hosts_only: 'Hosts only'};
const ANSWER = {yes: 'Going', no: 'Not going', waitlist: 'Waitlist', offered: 'Place offered', needs_reconfirm: 'Needs to reconfirm', expired: 'Offer expired'};
const FIELD = {title: 'Title', description: 'Description', start: 'Starts', end: 'Ends', venue: 'Venue', capacity: 'Capacity',
  guest_limit: 'Guests allowed per RSVP', rsvp_open: 'RSVPs open', rsvp_close: 'RSVPs close'};
const TIME_FIELDS = ['start', 'end', 'rsvp_open', 'rsvp_close'];
const fieldValue = (k, v) => (TIME_FIELDS.includes(k) ? when(v) : String(v));
function membershipText(m) {
  if (!m) return 'Not a member';
  return {member: ROLE[m.role] || 'Member', pending: 'Request pending', declined: 'Request declined', left: 'Left the group', removed: 'Removed'}[m.state] || m.state;
}

// The status line shows loading and connection state. Results of an action stay
// on the page: a receipt is a flash at the top of the page the user lands on,
// and an error stays next to the form that caused it.
const status = el('p', {role: 'status', 'aria-live': 'polite', id: 'status'}, 'Connecting...');
function say(text, error = false) {
  status.textContent = text;
  if (error) status.dataset.error = 'true'; else delete status.dataset.error;
}
const errorText = e => `${e.message}${e.code ? ` (${e.code})` : ''}`;
let flash = null;   // {hash, text, kind}
const flashBox = el('div', {id: 'flash'});
const routeHash = () => (location.hash && location.hash !== '#' ? location.hash : '#/groups');
function setFlash(text, kind = 'ok', hash = routeHash()) { flash = {hash, text, kind}; }
function showFlash() {
  flashBox.replaceChildren();
  if (!flash) return;
  if (flash.hash !== routeHash()) { flash = null; return; }
  flashBox.append(el('div', {class: 'st-flash' + (flash.kind === 'error' ? ' error' : ''), role: flash.kind === 'error' ? 'alert' : 'status', 'data-flash': flash.kind},
    el('span', {}, flash.text), el('button', {type: 'button', 'aria-label': 'Dismiss', onclick: () => { flash = null; showFlash(); }}, 'Dismiss')));
}
// Navigates and keeps the receipt visible on the destination page.
async function goTo(hash, receipt) {
  setFlash(receipt, 'ok', hash);
  if (location.hash === hash) await render(); else location.hash = hash;
}
// A button that runs one action; a failure is written into `slot` (next to the
// form) and into the status line, and stays until the next action there.
function button(label, onclick, attrs = {}, slot = null) {
  return el('button', {type: 'button', ...attrs, onclick: async event => {
    const b = event.currentTarget;
    if (busy) return;
    busy = true; b.disabled = true;
    if (slot) slot.replaceChildren();
    try { await onclick(); } catch (e) {
      say(errorText(e), true);
      if (slot) slot.replaceChildren(el('span', {'data-error-code': e.code || 'error'}, errorText(e)));
      else { setFlash(errorText(e), 'error'); showFlash(); }
    } finally { busy = false; if (b.isConnected) b.disabled = false; }
  }}, label);
}
const errorSlot = () => el('p', {class: 'st-error', role: 'alert', 'data-form-error': ''});
// A destructive one-click action asks first, inline.
function confirmButton(label, question, yesLabel, onconfirm, attrs = {}) {
  const wrap = el('span', {});
  const ask = el('button', {type: 'button', ...attrs, onclick: () => {
    const slot = errorSlot();
    wrap.replaceChildren(el('span', {class: 'st-confirm', 'data-confirm-box': ''}, el('span', {}, question),
      button(yesLabel, onconfirm, {class: 'primary', 'data-confirm-yes': attrs['data-action'] || label}, slot),
      el('button', {type: 'button', 'data-confirm-no': '', onclick: () => wrap.replaceChildren(ask)}, 'Keep it'), slot));
  }}, label);
  wrap.append(ask);
  return wrap;
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
function recipientsList(recipients) {
  const list = el('ul', {class: 'st-recipients', 'data-recipients': String(recipients.length)});
  for (const r of recipients) list.append(el('li', {}, nameOf(r), ' ', idText(r.member_id)));
  return recipients.length ? [el('h4', {}, `Who is notified (${recipients.length})`), list] : [el('p', {'data-recipients': '0'}, 'Nobody is notified.')];
}
// A preview: the tool's answer as sentences, every recipient, Confirm and Cancel.
function previewBox(heading, lines, preview, confirmLabel, confirm, {allowed: ok = true, why = ''} = {}) {
  const slot = errorSlot();
  const box = el('div', {class: 'st-preview', 'data-preview': preview.id}, el('h3', {}, heading), ...lines.filter(Boolean));
  if (preview.recipients) box.append(...recipientsList(preview.recipients));
  box.append(el('p', {class: 'st-muted'}, `This preview is valid until ${when(preview.expires_at)}. Nothing has changed yet.`), idText(`Preview ${preview.id}`));
  const actions = el('div', {class: 'form-actions'},
    el('button', {type: 'button', 'data-cancel-preview': preview.id, onclick: () => { box.replaceWith(el('p', {class: 'st-muted', 'data-preview-cancelled': ''}, 'Preview discarded. Nothing was changed.')); }}, 'Cancel'),
    ok ? button(confirmLabel, confirm, {class: 'primary', 'data-confirm': preview.id}, slot)
      : el('button', {type: 'button', class: 'primary', disabled: '', title: why, 'data-confirm-disabled': preview.id}, confirmLabel));
  box.append(actions, ok ? slot : el('p', {class: 'st-note'}, why));
  return box;
}

// ---- Cards ------------------------------------------------------------------------------

function dateBlock(s) {
  const d = local(s);
  return el('span', {class: 'st-date', 'aria-hidden': 'true'}, el('small', {}, d ? fMonth(d).toUpperCase() : ''), el('strong', {}, d ? String(d.getUTCDate()) : '?'));
}
function placesChip(e) {
  if (e.state === 'cancelled') return chip('Cancelled', 'bad');
  if (e.state === 'past') return chip('Past event');
  const wait = e.waitlist_count ? `, ${e.waitlist_count} on the waitlist` : '';
  return e.places_free > 0 ? chip(`${e.places_free} of ${e.capacity} places left${wait}`, 'ok') : chip(`Full${wait}`, 'warn');
}
function rsvpChip(r) {
  if (!r) return null;
  const text = r.answer === 'waitlist' && r.waitlist_position ? `Waitlist, position ${r.waitlist_position}` : ANSWER[r.answer] || r.answer;
  return chip(`Your RSVP: ${text}`, r.answer === 'offered' || r.answer === 'needs_reconfirm' ? 'warn' : 'mine');
}
function eventCard(e) {
  return el('a', {class: 'st-card', href: '#/event/' + e.id, 'data-event-id': e.id},
    dateBlock(e.start),
    el('span', {class: 'st-card-body'},
      el('span', {class: 'st-card-title'}, e.title),
      el('span', {class: 'st-card-line'}, span(e.start, e.end)),
      el('span', {class: 'st-card-line'}, e.venue),
      el('span', {class: 'st-chips'}, placesChip(e), rsvpChip(e.my_rsvp))));
}
function groupCard(g, current) {
  return el('a', {class: 'st-card record', href: '#/group/' + g.id, 'data-record-id': g.id, 'aria-current': g.id === current ? 'page' : false},
    el('span', {class: 'st-card-body'},
      el('span', {class: 'st-card-title record-title'}, g.name),
      el('span', {class: 'st-card-line'}, g.description),
      el('span', {class: 'st-chips record-subtitle'}, chip(plural(g.member_count, 'member')),
        chip(membershipText(g.my_membership), g.my_membership?.state === 'member' ? 'mine' : ''), g.requires_approval ? chip('Approval needed') : null)));
}
function rsvpSentence(r) {
  if (!r) return 'You have not answered yet.';
  const who = `${party(r.guests, r.children)} (${plural(r.places, 'place')})`;
  return {
    yes: `You are going: ${who}.`,
    waitlist: `You are on the waitlist${r.waitlist_position ? `, position ${r.waitlist_position},` : ''} for ${who}.`,
    offered: `A place was offered to you for ${who}. Claim by ${when(r.offer_expires_at)}.`,
    needs_reconfirm: `The event changed. Reconfirm by ${when(r.reconfirm_by)} to keep ${who}.`,
    no: 'You answered no.',
    expired: 'Your waitlist offer expired. You can rejoin the waitlist.',
  }[r.answer] || r.answer;
}
function postCard(p, groupId, events) {
  const actions = el('div', {class: 'st-actions'});
  const mine = p.author.member_id === ctx.me;
  if (!p.locked && p.state !== 'deleted' && ctx.memberOf(groupId)) {
    if (can('posts.preview')) actions.append(link(`#/compose/${groupId}/comment/${p.parent_id || p.id}`, 'Comment', {'data-comment': p.id}));
    if (can('posts.preview') && mine) actions.append(link(`#/compose/${groupId}/edit/${p.id}`, 'Edit', {'data-edit': p.id}));
    if (can('posts.delete') && (mine || atLeast(groupId, 'co_organizer'))) {
      actions.append(confirmButton('Delete', 'Delete this post? It is hidden from now on; anything already delivered stays delivered.', 'Delete post',
        async () => { await write('posts.delete', {post_id: p.id}); await goTo(routeHash(), `Post deleted. Anything already delivered stays delivered.`); },
        {'data-delete': p.id, 'data-action': 'delete-post'}));
    }
  }
  const ev = p.event_id && events.find(e => e.id === p.event_id);
  const audience = p.kind === 'announcement' ? 'Announcement, emailed to every member' :
    p.audience === 'event_guests' ? `Guests of ${ev ? ev.title : 'an event'}` : AUDIENCE[p.audience] || p.audience;
  return el('div', {class: 'st-card st-post' + (p.parent_id ? ' comment' : ''), 'data-post-id': p.id},
    el('div', {class: 'st-card-body'},
      el('div', {class: 'st-post-head'}, el('strong', {}, nameOf(p.author)), el('span', {class: 'st-muted'}, when(p.created_at)),
        chip(p.parent_id ? 'Comment' : audience, p.audience === 'group' ? '' : 'mine'),
        ev && p.audience !== 'event_guests' ? chip('About ' + ev.title) : null,
        p.state === 'deleted' ? chip('Deleted', 'bad') : null, p.state === 'edited' ? chip('Edited') : null, p.locked ? chip('Locked') : null),
      el('p', {class: 'st-post-text'}, p.text),
      idText(p.id), actions));
}

// ---- View-as selector -----------------------------------------------------------------

// Lists members already visible on the page; the answer is the tool's.
function viewAs(objectType, objectId, members) {
  const unique = [...new Map(members.map(m => [m.member_id, m])).values()].sort((a, b) => a.display_name.localeCompare(b.display_name));
  const out = el('div', {'data-view-as-result': ''});
  const choice = select('view_as_member', [['', 'Choose a member'], ...unique.map(m => [m.member_id, `${m.display_name} (${m.member_id})`])]);
  const label = {group: 'group', event: 'event', post: 'post', sheet: 'sign-up sheet'}[objectType];
  choice.addEventListener('change', async () => {
    out.replaceChildren();
    delete out.dataset.visible;
    if (!choice.value) return;
    try {
      const r = await call('visibility.view_as', {member_id: choice.value, object_type: objectType, object_id: objectId});
      out.dataset.visible = String(r.visible);
      const lines = [el('p', {}, el('strong', {}, nameOf(r.member)), r.visible ? ` can see this ${label} now.` : ` cannot see this ${label} now.`),
        el('p', {class: 'st-muted'}, `As of ${when(r.as_of)}. ${r.note}`)];
      if (r.view) {
        const v = r.view;
        if (objectType === 'event') lines.push(el('p', {}, v.guests_hidden ? 'The guest list is hidden from them.' : `They see ${plural(v.guests.length, 'guest')} on the guest list.`),
          el('p', {}, v.my_rsvp ? `Their RSVP: ${ANSWER[v.my_rsvp.answer] || v.my_rsvp.answer}, ${plural(v.my_rsvp.places, 'place')}.` : 'They have not answered.'));
        if (objectType === 'sheet') lines.push(el('p', {}, `Their slots: ${v.my_slots.join(', ') || 'none'}.`));
        if (objectType === 'group') lines.push(el('p', {}, `Their membership: ${membershipText(v.my_membership)}.`));
        if (objectType === 'post') lines.push(el('p', {}, `Audience: ${AUDIENCE[v.audience] || v.audience}.`), el('p', {}, v.text));
      }
      out.append(el('div', {class: 'st-box'}, ...lines));
    } catch (e) { out.replaceChildren(el('p', {class: 'st-error', role: 'alert'}, errorText(e))); }
  });
  return el('section', {class: 'st-section', 'data-section': 'view-as'}, el('h3', {}, 'View as another member'),
    el('p', {class: 'st-muted'}, `See this ${label} as another member sees it now. This does not show what was already delivered to them.`),
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
  installStyles();
  document.querySelector('#app').replaceChildren(el('div', {class: 'app-shell'},
    el('aside', {class: 'sidebar'}, el('div', {class: 'brand'}, mark, el('h1', {}, 'Stoopside')), nav,
      el('div', {class: 'sidebar-foot'}, el('div', {}, el('strong', {}, 'Community groups'), el('small', {}, 'Agent connection')))),
    el('main', {class: 'app-main'}, el('header', {class: 'toolbar'}, title, button('Refresh', () => render(), {'data-action': 'refresh'})), status,
      el('section', {class: 'detail', 'aria-label': 'Page'}, el('article', {}, flashBox, content)))));
}
function navigation(route) {
  const item = (href, label, symbol) => el('button', {type: 'button', 'aria-current': location.hash === href || (href === '#/groups' && route[0] === 'group') ? 'page' : false,
    onclick: () => { location.hash = href; }}, el('span', {class: 'nav-symbol', 'aria-hidden': 'true'}, symbol), el('span', {}, label));
  nav.replaceChildren(item('#/groups', 'Groups', '#'), item('#/profile', 'Profile', '@'), item('#/help', 'Help', '?'),
    ...ctx.groups.filter(g => g.my_membership?.state === 'member').map(g => item('#/group/' + g.id, g.name, '>')));
}

// ---- Pages -------------------------------------------------------------------------------

async function groupsPage(id) {
  const list = el('div', {class: 'records st-cards st-grid', id: 'records'});
  const search = input('group_query', '', {type: 'search', placeholder: 'Search groups by name or description', 'aria-label': 'Search groups'});
  const fill = items => list.replaceChildren(...(items.length ? items.map(g => groupCard(g, id)) : [el('p', {}, 'No groups match.')]));
  fill(ctx.groups);
  search.addEventListener('change', async () => { try { fill((await call('groups.list', {query: search.value})).groups); } catch (e) { say(errorText(e), true); } });
  const discovery = [el('h2', {}, id ? 'Discover more groups' : 'Groups'), el('p', {class: 'st-lead'}, 'Your groups and groups you can join near you.'), field('Search', search), list];
  if (!id) return {title: 'Groups', body: discovery};
  const r = await call('groups.get', {group_id: id}), g = r.group, mine = g.my_membership;
  useZone(g);
  const member = mine?.state === 'member';
  const slot = errorSlot();
  const actions = el('div', {class: 'st-actions'});
  if ((!mine || ['left', 'declined'].includes(mine.state)) && can('groups.join')) {
    actions.append(button(g.requires_approval ? 'Ask to join' : 'Join group', async () => {
      const out = await write('groups.join', {group_id: id});
      await goTo(routeHash(), out.membership.state === 'pending' ? `Request sent. An organizer of ${g.name} decides on it.` : `You joined ${g.name}.`);
    }, {class: 'primary', 'data-action': 'join'}, slot));
  }
  if (mine && ['member', 'pending'].includes(mine.state) && can('groups.leave')) {
    actions.append(mine.state === 'pending'
      ? confirmButton('Withdraw request', `Withdraw your request to join ${g.name}?`, 'Withdraw request',
        async () => { await write('groups.leave', {group_id: id}); await goTo(routeHash(), 'Your request was withdrawn.'); }, {'data-action': 'leave'})
      : confirmButton('Leave group', `Leave ${g.name}? Your RSVPs for its upcoming events become no and your sign-up slots are released.`, 'Leave group',
        async () => { await write('groups.leave', {group_id: id}); await goTo(routeHash(), `You left ${g.name}. Your upcoming RSVPs there are now no and your slots are released.`); }, {'data-action': 'leave'}));
  }
  if (member) {
    if (!g.hide_from_member_list || atLeast(id, 'co_organizer')) actions.append(link('#/members/' + id, 'Member directory', {'data-link': 'members'}));
    if (can('posts.preview')) actions.append(link('#/compose/' + id, 'Write a post', {'data-link': 'compose'}));
    if (can('events.preview_change') && atLeast(id, 'event_host')) actions.append(link('#/change/new/' + id, 'Create an event', {'data-link': 'new-event'}));
  }
  const detail = [el('span', {class: 'kicker'}, 'Group'), el('h2', {'data-group-name': g.id}, g.name), el('p', {class: 'st-lead'}, g.description),
    el('div', {class: 'st-chips'}, chip(plural(g.member_count, 'member')), chip(member ? `You are ${ROLE[mine.role].toLowerCase() === 'member' ? 'a member' : 'a ' + ROLE[mine.role].toLowerCase()}` : membershipText(mine), member ? 'mine' : ''),
      ...[g.requires_approval && 'Organizers approve new members', g.hide_from_member_list && 'Member list hidden', g.hide_rsvps && 'Guest lists hidden'].filter(Boolean).map(t => chip(t)),
      chip(`Times in ${g.time_zone} (UTC${g.utc_offset})`)),
    actions, slot,
    section('Hosts', el('div', {class: 'st-chips'}, ...r.hosts.map(h => chip(`${h.display_name}, ${ROLE[h.role]}`))))];
  if (member) {
    detail.push(section('Upcoming events', ...(r.upcoming_events.length ? [el('div', {class: 'st-cards'}, ...r.upcoming_events.map(eventCard))] : [el('p', {}, 'No upcoming events.')])));
    const [posts, events] = await Promise.all([call('posts.list', {group_id: id}).then(x => x.posts), call('events.list', {group_id: id}).then(x => x.events).catch(() => r.upcoming_events)]);
    const shown = posts.slice(-25).reverse();
    detail.push(section(`Posts (${posts.length})`, el('p', {class: 'st-muted'}, posts.length > 25 ? 'Newest 25 shown, newest first.' : 'Newest first.'),
      el('div', {class: 'st-cards'}, ...shown.map(p => postCard(p, id, events)))));
    detail.push(viewAs('group', id, [...r.hosts, ...posts.map(p => p.author)]));
  } else if (mine?.state === 'pending') {
    detail.push(el('p', {class: 'st-note'}, 'Your request to join is waiting for an organizer. Events and posts appear once you are a member.'));
  }
  return {title: g.name, body: [...detail, el('hr'), ...discovery]};
}

async function membersPage(groupId) {
  const g = (await call('groups.get', {group_id: groupId})).group;
  useZone(g);
  const q = input('member_query', '', {type: 'search', placeholder: 'Part of a display name or bio', 'aria-label': 'Search members'});
  const results = el('div', {'data-members': ''});
  const slot = errorSlot();
  const run = async () => {
    const members = (await call('members.search', {group_id: groupId, query: q.value})).members;
    results.replaceChildren(el('p', {}, `${plural(members.length, 'member')} ${members.length === 1 ? 'matches' : 'match'}${q.value ? ` "${q.value}"` : ''}. Search matches display names and bios only, not the names people use offline.`),
      el('div', {class: 'st-cards st-grid'}, ...members.map(m => el('div', {class: 'st-card', 'data-member-id': m.member_id},
        el('span', {class: 'st-card-body'}, el('span', {class: 'st-card-title'}, m.display_name),
          el('span', {class: 'st-chips'}, chip(ROLE[m.role] || 'Member', m.role && m.role !== 'member' ? 'mine' : '')),
          el('span', {class: 'st-card-line'}, m.bio), idText(m.member_id))))));
  };
  const body = [el('span', {class: 'kicker'}, 'Member directory'), el('h2', {}, g.name), el('p', {}, link('#/group/' + groupId, 'Back to the group')),
    el('div', {class: 'fields'}, field('Search members', q)), el('div', {class: 'form-actions'}, button('Search', run, {class: 'primary', 'data-action': 'search'}, slot)), slot, results];
  try { await run(); } catch (e) { slot.replaceChildren(errorText(e)); }
  if (can('members.export') && atLeast(groupId, 'co_organizer')) {
    const out = el('div', {'data-export': ''}), exportSlot = errorSlot();
    body.push(section('Member export', el('p', {class: 'st-muted'}, 'Co-organizers and organizers only. The export is the only place member emails appear.'),
      button('Export members', async () => {
        const r = await call('members.export', {group_id: groupId});
        out.replaceChildren(el('p', {}, `${plural(r.members.length, 'member')} exported.`), el('ul', {class: 'st-recipients'},
          ...r.members.map(m => el('li', {'data-export-row': m.member_id}, el('strong', {}, m.display_name), `, ${m.email}, ${ROLE[m.role] || 'Member'}, member since ${day(m.member_since)} `, idText(m.member_id)))));
      }, {'data-action': 'export'}, exportSlot), exportSlot, out));
  }
  return {title: 'Members: ' + g.name, body};
}

async function eventPage(id) {
  const e = (await call('events.get', {event_id: id})).event;
  const g = groupOf(e.group_id);
  useZone(g);
  const head = el('div', {class: 'st-hero'}, dateBlock(e.start), el('div', {},
    el('span', {class: 'kicker'}, g ? g.name : 'Event'), el('h2', {'data-event-title': e.id}, e.title),
    el('div', {class: 'st-chips'}, placesChip(e), rsvpChip(e.my_rsvp))));
  const body = [head, el('p', {class: 'st-lead'}, e.description),
    facts([['When', span(e.start, e.end)], ['Where', e.venue], ['Hosted by', e.hosts.map(nameOf).join(', ')],
      ['Places', `${e.places_taken} of ${e.capacity} taken${e.waitlist_count ? `, ${e.waitlist_count} on the waitlist` : ''}`],
      ['Guests', e.guest_limit ? `Up to ${plural(e.guest_limit, 'guest')} per RSVP; children take places but are not capped` : 'No guests; children take places but are not capped'],
      ['RSVPs', `Open ${when(e.rsvp_open)}, close ${when(e.rsvp_close)}`], ['Event ID', idText(e.id)]])];
  const mine = e.my_rsvp;
  const rsvpBox = el('div', {class: 'st-box', 'data-section': 'your-rsvp'}, el('h3', {}, 'Your RSVP'), el('p', {'data-my-rsvp': mine ? mine.answer : 'none'}, rsvpSentence(mine)), mine ? idText(`RSVP ${mine.id}`) : null);
  body.push(rsvpBox);
  if (e.state === 'published' && can('rsvps.preview')) {
    const answers = [['yes', mine?.answer === 'offered' ? 'Yes, claim the offered place' : mine?.answer === 'needs_reconfirm' ? 'Yes, reconfirm' : 'Yes']];
    if (mine && mine.answer !== 'no') answers.push(['no', mine.answer === 'offered' ? 'No, pass the place on' : 'No']);
    const form = el('form', {class: 'fields', 'data-form': 'rsvp'},
      field('Answer', select('answer', answers)),
      field('Guests', input('guests', '', {type: 'number', min: 0, max: 20, placeholder: 'Pre-filled if empty'}), `Leave empty to pre-fill from your latest RSVP in this group. Up to ${plural(e.guest_limit, 'guest')}.`),
      field('Children', input('children', '', {type: 'number', min: 0, max: 20, placeholder: 'Pre-filled if empty'}), 'Leave empty to pre-fill from your latest RSVP in this group.'));
    if (mine?.answer === 'expired') form.append(field('After an expired offer', select('rejoin_waitlist', [['', 'Do not rejoin'], ['true', 'Rejoin the back of the waitlist']])));
    const out = el('div'), slot = errorSlot();
    form.append(el('div', {class: 'form-actions'}, button('Preview RSVP', async () => {
      out.replaceChildren();
      const args = {event_id: id, answer: valueOf(form, 'answer')};
      for (const k of ['guests', 'children']) if (valueOf(form, k) !== '') args[k] = Number(valueOf(form, k));
      if (valueOf(form, 'rejoin_waitlist')) args.rejoin_waitlist = true;
      const p = (await write('rsvps.preview', args)).preview;
      const pf = p.prefilled_from;
      const lines = [
        el('p', {}, `${p.answer === 'yes' ? 'Yes' : 'No'} to ${p.event.title}, ${span(p.event.start, p.event.end)}, at ${p.event.venue}.`),
        p.answer === 'yes' ? el('p', {}, `Party: ${party(p.guests, p.children)}, ${plural(p.places, 'place')}.`) : null,
        pf ? el('p', {class: 'st-note', 'data-prefilled': 'true'}, `Guests and children were pre-filled from your RSVP to ${pf.event_title}, answered ${when(pf.answered_at)}: guests ${pf.guests}, children ${pf.children}. Type the counts above if they are not right for this event.`) : null,
        el('p', {'data-outcome': p.outcome}, `${p.note} ${p.answer === 'yes' ? `${plural(p.places_free, 'place')} free now.` : ''}`.trim()),
        p.offer_expires_at ? el('p', {}, `Your offer can be claimed until ${when(p.offer_expires_at)}.`) : null,
        p.reconfirm_by ? el('p', {}, `Reconfirm by ${when(p.reconfirm_by)}.`) : null];
      out.replaceChildren(previewBox('Check your RSVP', lines, p, p.outcome === 'claim' ? 'Claim place' : 'Confirm RSVP', async () => {
        const c = await write('rsvps.confirm', {preview_id: p.id});
        const r = c.rsvp;
        await goTo(routeHash(), `RSVP saved: ${ANSWER[r.answer] || r.answer}${r.answer === 'yes' || r.answer === 'waitlist' ? `, ${party(r.guests, r.children)} (${plural(r.places, 'place')})` : ''}. Receipt ${c.receipt.notice_id || 'recorded'} for RSVP ${r.id}.`);
      }, {allowed: can('rsvps.confirm'), why: 'This run\'s profile does not allow confirming RSVPs.'}));
    }, {class: 'primary', 'data-action': 'preview-rsvp'}, slot)), slot);
    rsvpBox.append(form, out);
  } else if (e.state === 'published') {
    rsvpBox.append(el('p', {class: 'st-note'}, 'This run\'s profile is read-only: RSVPs cannot be changed here.'));
  }
  const manage = el('div', {class: 'st-actions'});
  if (e.state === 'published' && can('events.preview_change') && canManage(e)) manage.append(link(`#/change/edit/${id}`, 'Edit event', {'data-link': 'edit-event'}), link(`#/change/cancel/${id}`, 'Cancel event', {'data-link': 'cancel-event'}));
  if (e.state === 'published' && can('posts.preview') && roleIn(e.group_id) !== null) manage.append(link(`#/compose/${e.group_id}/event/${id}`, 'Post to the guests', {'data-link': 'post-to-guests'}));
  if (manage.childNodes.length) body.push(manage);
  body.push(section('Guests', ...(e.guests_hidden ? [el('p', {}, 'This group hides guest lists from members who are not hosts.')] :
    e.guests.length ? [el('ul', {class: 'st-recipients', 'data-guests': String(e.guests.length)}, ...e.guests.map(x => el('li', {'data-guest': x.member_id},
      el('strong', {}, x.display_name), ` ${ANSWER[x.answer] || x.answer}`, x.guests || x.children ? `, ${[x.guests && plural(x.guests, 'guest'), x.children && plural(x.children, 'child', 'children')].filter(Boolean).join(' and ')}` : '', ' ', idText(x.member_id))))] : [el('p', {}, 'Nobody has answered yet.')])));
  if (e.sheets.length) body.push(section('Sign-up sheets', ...e.sheets.map(s => el('p', {}, link('#/sheet/' + s.id, s.title, {'data-sheet-id': s.id})))));
  if (e.changes.length) {
    body.push(section('Changes', el('ul', {}, ...e.changes.map(c => {
      const what = c.action === 'cancelled' ? 'Cancelled' : 'Changed ' + Object.entries(c.fields).map(([k, v]) => `${FIELD[k].toLowerCase()} to ${fieldValue(k, v)}`).join('; ');
      const who = c.notify === 'guests' ? 'every open RSVP was notified' : c.notify === 'group' ? 'the whole group was notified' : 'nobody was notified';
      return el('li', {'data-change': c.action}, `${when(c.at)}: ${what}; ${who}.`);
    }))));
  }
  try {
    const posts = (await call('posts.list', {group_id: e.group_id, event_id: id})).posts;
    body.push(section(`Posts about this event (${posts.length})`, el('div', {class: 'st-cards'}, ...posts.map(p => postCard(p, e.group_id, [e])))));
  } catch (err) { /* the user may not be a member any more */ }
  body.push(viewAs('event', id, [...e.hosts, ...e.guests]));
  return {title: e.title, body};
}

const EVENT_FIELDS = ['title', 'description', 'start', 'end', 'venue', 'capacity', 'guest_limit', 'rsvp_open', 'rsvp_close'];
async function changePage(mode, id) {
  const e = mode === 'new' ? null : (await call('events.get', {event_id: id})).event;
  const groupId = e ? e.group_id : id;
  const g = groupOf(groupId);
  useZone(g);
  const form = el('form', {class: 'fields', 'data-form': 'change'});
  if (mode !== 'cancel') {
    for (const k of EVENT_FIELDS) {
      const numeric = ['capacity', 'guest_limit'].includes(k), time = TIME_FIELDS.includes(k);
      const value = e ? (time ? toInput(e[k]) : e[k]) : '';
      form.append(field(FIELD[k], k === 'description' ? el('textarea', {'data-field': k, rows: 3}, value) : input(k, value, numeric ? {type: 'number', min: 0} : time ? {type: 'datetime-local'} : {}),
        time ? `In the group's time zone, ${zone.label} (UTC${zone.offset}).` : null));
    }
    if (mode === 'edit') {
      form.append(field('Who to notify', select('notify', [['', 'Nobody (only when the date, time and venue stay the same)'], ['guests', 'Guests: every open RSVP'], ['group', 'Everyone in the group']]),
        'Moving the date, time or venue needs guests or group, and every yes must reconfirm within 48 hours.'));
    }
  }
  const out = el('div'), slot = errorSlot();
  const value = k => {
    const raw = valueOf(form, k);
    if (['capacity', 'guest_limit'].includes(k)) return raw === '' ? '' : Number(raw);
    return TIME_FIELDS.includes(k) ? fromInput(raw) : raw;
  };
  form.append(el('div', {class: 'form-actions'}, link(e ? '#/event/' + e.id : '#/group/' + groupId, 'Back', {class: 'st-linkbtn', 'data-link': 'back'}),
    button(mode === 'cancel' ? 'Preview cancellation' : 'Preview change', async () => {
      out.replaceChildren();
      const args = {change: mode === 'new' ? 'create' : mode};
      if (mode === 'new') args.group_id = groupId; else args.event_id = id;
      if (mode !== 'cancel') {
        args.fields = {};
        for (const k of EVENT_FIELDS) {
          const v = value(k);
          const same = mode === 'new' ? v === '' : TIME_FIELDS.includes(k) ? Date.parse(v) === Date.parse(e[k]) : String(v) === String(e[k]);
          if (!same) args.fields[k] = v;
        }
      }
      if (valueOf(form, 'notify')) args.notify = valueOf(form, 'notify');
      const p = (await write('events.preview_change', args)).preview;
      const changed = Object.entries(p.fields || {});
      const lines = [];
      if (p.change === 'cancel') lines.push(el('p', {}, `${p.title} will be cancelled. This cannot be undone; the event's sign-up sheets lock at once.`));
      else if (p.change === 'create') lines.push(el('p', {}, `A new event in ${g ? g.name : groupId}:`), el('ul', {}, ...changed.map(([k, v]) => el('li', {}, `${FIELD[k]}: ${fieldValue(k, v)}`))));
      else lines.push(el('p', {}, `Changes to ${p.title}:`), el('ul', {'data-changed-fields': changed.map(([k]) => k).join(' ')}, ...changed.map(([k, v]) => el('li', {}, `${FIELD[k]}: ${fieldValue(k, v)} (was ${fieldValue(k, e[k])})`))));
      lines.push(el('p', {}, p.notify === 'guests' ? 'Every open RSVP is notified by email.' : p.notify === 'group' ? 'Every member of the group is notified by email.' : 'Nobody is notified.'));
      if (p.rsvps_to_reconfirm) lines.push(el('p', {class: 'st-note'}, `${plural(p.rsvps_to_reconfirm, 'yes RSVP')} must reconfirm: each holds its place for 48 hours (or until the event starts) and then becomes no.`));
      else lines.push(el('p', {}, p.note));
      out.replaceChildren(previewBox({create: 'Check the new event', edit: 'Check this change', cancel: 'Cancel this event?'}[p.change], lines, p,
        {create: 'Create event', edit: 'Confirm change', cancel: 'Cancel event'}[p.change], async () => {
          const c = await write('events.confirm_change', {preview_id: p.id});
          const r = c.receipt;
          const done = {create: `Event created: ${p.title}.`, edit: `Change saved for ${p.title}.`, cancel: `${p.title} is cancelled.`}[r.change];
          await goTo('#/event/' + r.event_id, `${done} ${r.recipient_count ? `${plural(r.recipient_count, 'member')} notified by email` : 'Nobody was notified'}.${r.notice_id ? ` Receipt ${r.notice_id}.` : ''}`);
        }, {allowed: can('events.confirm_change'), why: 'This run\'s profile does not allow confirming event changes.'}));
    }, {class: 'primary', 'data-action': 'preview-change'}, slot)), slot);
  const intro = mode === 'cancel' ? el('p', {class: 'st-note'}, 'Cancelling notifies every open RSVP by email, locks the event\'s sign-up sheets and cannot be undone.')
    : mode === 'edit' ? el('p', {class: 'st-lead'}, 'Change what you need, then preview. Nothing is saved or sent until you confirm.') : el('p', {class: 'st-lead'}, 'Fill in every field, then preview. Nobody is notified when an event is created.');
  return {title: {new: 'New event', edit: 'Edit event', cancel: 'Cancel event'}[mode], body: [el('span', {class: 'kicker'}, {new: 'New event', edit: 'Edit event', cancel: 'Cancel event'}[mode]),
    el('h2', {}, e ? e.title : 'New event in ' + (g ? g.name : groupId)), e ? el('p', {class: 'st-muted'}, `${span(e.start, e.end)}, ${e.venue}`) : null, intro, form, out]};
}

async function composePage(groupId, mode, ref) {
  const g = (await call('groups.get', {group_id: groupId})).group;
  useZone(g);
  const events = (await call('events.list', {group_id: groupId})).events;
  const posts = mode === 'edit' || mode === 'comment' ? (await call('posts.list', {group_id: groupId})).posts : [];
  const target = posts.find(p => p.id === ref);
  const form = el('form', {class: 'fields', 'data-form': 'compose'});
  if (mode === 'comment') {
    form.append(el('p', {class: 'st-muted', 'data-parent': ref}, target ? `Commenting on ${nameOf(target.author)}'s post: "${target.text.slice(0, 120)}". A comment has the same audience as its post.` : `Commenting on post ${ref}.`));
  } else if (mode !== 'edit') {
    const kinds = [['post', 'Post']];
    if (atLeast(groupId, 'co_organizer')) kinds.push(['announcement', 'Announcement (emailed to every member, one a day)']);
    form.append(field('Kind', select('kind', kinds, 'post')));
    form.append(field('Audience', select('audience', [['', 'Choose who can see it'], ['group', 'Everyone in the group'], ['event_guests', 'Guests of an event (RSVP yes) and its hosts'], ['hosts_only', 'Hosts only (organizers, co-organizers, event hosts)']],
      mode === 'event' ? 'event_guests' : ''), 'Required: there is no default audience.'));
    form.append(field('Event', select('event_id', [['', 'No event'], ...events.map(x => [x.id, `${x.title}, ${day(x.start)}`])], mode === 'event' ? ref : ''), 'Needed for guests of an event.'));
  }
  form.append(field('Text', el('textarea', {'data-field': 'text', rows: 5}, target && mode === 'edit' ? target.text : '')));
  const out = el('div'), slot = errorSlot();
  form.append(el('div', {class: 'form-actions'}, link('#/group/' + groupId, 'Back', {class: 'st-linkbtn', 'data-link': 'back'}), button('Preview', async () => {
    out.replaceChildren();
    const args = {group_id: groupId, text: valueOf(form, 'text')};
    if (mode === 'edit') Object.assign(args, {kind: target ? target.kind : 'post', edit_of: ref});
    else if (mode === 'comment') Object.assign(args, {kind: 'comment', parent_id: ref});
    else {
      args.kind = valueOf(form, 'kind');
      for (const k of ['audience', 'event_id']) if (valueOf(form, k)) args[k] = valueOf(form, k);
    }
    const p = (await write('posts.preview', args)).preview;
    const ev = p.event_id && events.find(x => x.id === p.event_id);
    const who = p.kind === 'announcement' ? `An announcement to everyone in ${g.name}, sent by email.` :
      p.mode === 'edit' ? 'An edit of your post. Only the text changes.' :
      p.kind === 'comment' ? `A comment, visible to the same audience as its post (${(AUDIENCE[p.audience] || p.audience).toLowerCase()}).` :
      p.audience === 'event_guests' ? `A post to the guests of ${ev ? ev.title : 'the event'} (RSVP yes) and its hosts.` :
      p.audience === 'hosts_only' ? 'A post to the hosts only: organizers, co-organizers and event hosts.' : `A post to everyone in ${g.name}.`;
    out.replaceChildren(previewBox(p.mode === 'edit' ? 'Check your edit' : 'Check your post', [el('p', {}, who), el('blockquote', {}, p.text),
      el('p', {}, p.channel === 'email' ? 'Members are notified by email.' : 'Members are notified in Stoopside.'), el('p', {}, p.note)], p,
    p.mode === 'edit' ? 'Save edit' : 'Publish', async () => {
      const c = await write('posts.publish', {preview_id: p.id});
      const r = c.receipt;
      await goTo('#/group/' + groupId, `${r.mode === 'edit' ? 'Edit saved' : 'Published'}. ${r.recipient_count ? `${plural(r.recipient_count, 'member')} notified` : 'Nobody was notified'}. Post ${r.post_id}.`);
    }, {allowed: can('posts.publish'), why: 'This run\'s profile does not allow publishing.'}));
  }, {class: 'primary', 'data-action': 'preview-post'}, slot)), slot);
  const heading = mode === 'edit' ? 'Edit your post' : mode === 'comment' ? 'Write a comment' : mode === 'event' ? `Post to the guests of ${events.find(x => x.id === ref)?.title || 'an event'}` : 'Write a post';
  return {title: 'Post composer', body: [el('span', {class: 'kicker'}, g.name), el('h2', {}, heading),
    el('p', {class: 'st-lead'}, 'Preview first: it lists everyone who will be notified. Deleting a post later does not recall what was delivered.'), form, out]};
}

async function sheetPage(id) {
  const r = await call('signups.get', {sheet_id: id}), s = r.sheet;
  const e = (await call('events.get', {event_id: s.event_id}).catch(() => null))?.event;
  if (e) useZone(groupOf(e.group_id));
  const me = ctx.me;
  const label = slotId => s.slots.find(x => x.id === slotId)?.label || slotId;
  const claimers = s.slots.flatMap(x => x.claimed_by);
  const slot = errorSlot();
  const body = [el('span', {class: 'kicker'}, 'Sign-up sheet'), el('h2', {'data-sheet-title': s.id}, s.title),
    el('p', {}, 'For ', e ? link('#/event/' + s.event_id, `${e.title}, ${span(e.start, e.end)}`) : s.event_id, '.'),
    el('div', {class: 'st-chips'}, s.locked ? chip('Locked', 'bad') : chip(`Open until ${when(s.lock_at)}`, 'ok')),
    el('p', {class: 'st-lead', 'data-my-slots': s.my_slots.join(' ')}, s.my_slots.length ? `You signed up for: ${s.my_slots.map(label).join('; ')}.` : 'You have not signed up for anything.'), slot];
  const writable = !s.locked;
  body.push(section('Slots', el('div', {class: 'st-cards'}, ...s.slots.map(x => {
    const mine = s.my_slots.includes(x.id), actions = el('div', {class: 'st-actions'});
    if (writable && !mine && x.open > 0 && can('signups.claim')) actions.append(button('Claim', async () => { await write('signups.claim', {sheet_id: id, slot_id: x.id}); await goTo(routeHash(), `You claimed ${x.label}.`); }, {class: 'primary', 'data-claim': x.id}, slot));
    if (writable && mine && can('signups.release')) actions.append(button('Release', async () => { await write('signups.release', {sheet_id: id, slot_id: x.id}); await goTo(routeHash(), `Released ${x.label}.`); }, {'data-release': x.id}, slot));
    return el('div', {class: 'st-card', 'data-slot-id': x.id}, el('span', {class: 'st-card-body'},
      el('span', {class: 'st-card-title'}, x.label),
      el('span', {class: 'st-chips'}, x.open > 0 ? chip(`${x.open} of ${x.quantity} open`, 'ok') : chip('Full', 'warn'), mine ? chip('Yours', 'mine') : null),
      el('span', {class: 'st-card-line'}, x.claimed_by.length ? 'Signed up: ' + x.claimed_by.map(nameOf).join(', ') : 'Nobody yet'), actions));
  }))));
  body.push(section(`Swaps (${r.swaps.length})`, ...(r.swaps.length ? [el('div', {class: 'st-cards'}, ...r.swaps.map(w => {
    const actions = el('div', {class: 'st-actions'});
    const toMe = w.to.member_id === me, fromMe = w.from.member_id === me;
    if (w.state === 'proposed' && can('signups.swap_answer')) {
      const answer = (a, text, cls = '') => button(text, async () => { await write('signups.swap_answer', {swap_id: w.id, answer: a}); await goTo(routeHash(), `Swap ${w.id}: ${{accept: 'accepted, the claims are exchanged', decline: 'declined', withdraw: 'withdrawn'}[a]}.`); }, {class: cls, 'data-swap-answer': w.id + ':' + a}, slot);
      if (toMe) actions.append(answer('accept', 'Accept', 'primary'), answer('decline', 'Decline'));
      if (fromMe) actions.append(answer('withdraw', 'Withdraw'));
    }
    const text = toMe ? `${nameOf(w.from)} offers their ${label(w.give_slot)} for your ${label(w.want_slot)}.` :
      fromMe ? `You offered your ${label(w.give_slot)} for ${nameOf(w.to)}'s ${label(w.want_slot)}.` :
      `${nameOf(w.from)} offered ${label(w.give_slot)} for ${nameOf(w.to)}'s ${label(w.want_slot)}.`;
    return el('div', {class: 'st-card', 'data-swap-id': w.id}, el('span', {class: 'st-card-body'},
      el('span', {class: 'st-card-title'}, text),
      el('span', {class: 'st-chips'}, chip({proposed: 'Waiting for an answer', accepted: 'Accepted', declined: 'Declined', withdrawn: 'Withdrawn', expired: 'Expired'}[w.state] || w.state, w.state === 'proposed' ? 'warn' : '')),
      el('span', {class: 'st-card-line'}, `Proposed ${when(w.proposed_at)}${w.state === 'proposed' ? `; answer by ${when(w.expires_at)}` : w.decided_at ? `; decided ${when(w.decided_at)}` : ''}.`),
      idText(w.id), actions));
  }))] : [el('p', {}, 'No swaps.')])));
  // A swap gives one of the user's slots for a slot another member holds and the user does not.
  const wantable = s.slots.filter(x => !s.my_slots.includes(x.id) && x.claimed_by.some(m => m.member_id !== me));
  if (writable && s.my_slots.length && can('signups.swap_propose')) {
    if (!wantable.length) body.push(section('Propose a swap', el('p', {}, 'No other member holds a slot you could swap for.')));
    else {
      const want = select('want_slot', wantable.map(x => [x.id, x.label]));
      const member = select('member_id', []);
      const fillMembers = () => {
        const holders = (wantable.find(x => x.id === want.value)?.claimed_by || []).filter(m => m.member_id !== me);
        member.replaceChildren(...holders.map(m => el('option', {value: m.member_id}, m.display_name)));
      };
      want.addEventListener('change', fillMembers);
      fillMembers();
      const form = el('form', {class: 'fields', 'data-form': 'swap'},
        field('Give', select('give_slot', s.my_slots.map(x => [x, label(x)]))), field('Want', want), field('From', member, 'They have 48 hours (or until the sheet locks) to accept.'));
      member.dataset.field = 'member_id';
      const swapSlot = errorSlot();
      form.append(el('div', {class: 'form-actions'}, button('Propose swap', async () => {
        const w = (await write('signups.swap_propose', {sheet_id: id, give_slot: valueOf(form, 'give_slot'), want_slot: valueOf(form, 'want_slot'), member_id: valueOf(form, 'member_id')})).swap;
        await goTo(routeHash(), `Swap proposed to ${nameOf(w.to)}: your ${label(w.give_slot)} for their ${label(w.want_slot)}. They can answer until ${when(w.expires_at)}.`);
      }, {class: 'primary', 'data-action': 'propose-swap'}, swapSlot)), swapSlot);
      body.push(section('Propose a swap', form));
    }
  }
  body.push(viewAs('sheet', id, claimers));
  return {title: s.title, body};
}

async function profilePage() {
  const r = await call('profile.get', {});
  const slot = errorSlot();
  const body = [el('span', {class: 'kicker'}, 'Profile'), el('h2', {'data-profile': r.profile.member_id}, r.profile.display_name), idText(r.profile.member_id),
    el('p', {class: 'st-lead'}, r.profile.bio)];
  if (can('profile.update')) {
    const form = el('form', {class: 'fields', 'data-form': 'profile'},
      field('Display name', input('display_name', r.profile.display_name), 'Other members see this name. Search matches it and your bio.'), field('Bio', el('textarea', {'data-field': 'bio', rows: 3}, r.profile.bio)));
    form.append(el('div', {class: 'form-actions'}, button('Save profile', async () => {
      const args = {};
      if (valueOf(form, 'display_name') !== r.profile.display_name) args.display_name = valueOf(form, 'display_name');
      if (valueOf(form, 'bio') !== r.profile.bio) args.bio = valueOf(form, 'bio');
      await write('profile.update', args);
      await goTo(routeHash(), 'Profile saved.');
    }, {class: 'primary', 'data-action': 'save-profile'}, slot)), slot);
    body.push(form);
  }
  body.push(section('Your groups', el('ul', {}, ...r.memberships.map(m => el('li', {}, link('#/group/' + m.group_id, m.group_name), `: ${membershipText(m)}`)))));
  return {title: 'Profile', body};
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
    const [groups, profile] = await Promise.all([call('groups.list', {}), call('profile.get', {})]);
    ctx.groups = groups.groups;
    ctx.me = profile.profile.member_id;
    ctx.memberOf = id => roleIn(id) !== null;
    useZone(ctx.groups[0]);
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
    navigation(route);
    title.textContent = page.title;
    document.title = `${page.title} · Stoopside`;
    content.replaceChildren(...page.body.filter(Boolean));
    content.dataset.page = route[0];
    showFlash();
    if (status.dataset.error === 'true' || /Connecting|Loading/.test(status.textContent)) say('Loaded.');
  } catch (e) {
    if (ticket === renderTicket) {
      const missing = e.code === 'not_found';
      title.textContent = missing ? 'Not found' : 'Not available';
      document.title = `${title.textContent} · Stoopside`;
      flash = null; showFlash();
      content.replaceChildren(el('div', {class: 'empty', 'data-page-error': e.code || 'error'}, el('h3', {}, missing ? 'This page does not exist or you cannot see it' : 'This page is not available'),
        el('p', {}, errorText(e)), el('p', {}, link('#/groups', 'Back to groups'))));
      say(errorText(e), true);
    }
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
  } catch (e) { say(errorText(e), true); }
})();
