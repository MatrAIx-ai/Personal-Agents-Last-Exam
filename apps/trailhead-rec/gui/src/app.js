// Trailhead Parks & Rec 4-view interactive Web GUI backed exclusively by Agent MCP tools via /api/call.
// Zero Infra/admin or waiver-signing controls; strict CSP (no inline scripts or styles).

let csrfToken = '';
let state = { tab: 'programs', version: null, programs: [], credit: 0, members: [], passes: [], passEff: {}, enrollments: [], enrEff: {}, slots: [], bookings: [], notice: '' };

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const ch of children.flat()) {
    if (ch === null || ch === undefined || ch === false) continue;
    node.append(typeof ch === 'string' ? document.createTextNode(ch) : ch);
  }
  return node;
}

async function authenticate() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const token = hash.get('access');
  if (token) {
    const r = await fetch('/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
    if (!r.ok) throw new Error('Session authentication failed');
    csrfToken = (await r.json()).csrf;
    history.replaceState(null, '', '/');
    return;
  }
  const r = await fetch('/session');
  if (!r.ok) throw new Error('Open the access URL printed by runtime/web/server.cjs');
  csrfToken = (await r.json()).csrf;
}

async function callTool(name, args = {}) {
  const r = await fetch('/api/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-pale-csrf': csrfToken },
    body: JSON.stringify({ name, arguments: args }),
  });
  const data = await r.json();
  if (data.version) state.version = data.version;
  return data;
}

function reqId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

async function refreshAll() {
  const [prgs, hh, enrs, slots, bkgs] = await Promise.all([
    callTool('trailhead-rec.program.search', {}),
    callTool('trailhead-rec.household.get', {}),
    callTool('trailhead-rec.enrollment.list', {}),
    callTool('trailhead-rec.court.search', {}),
    callTool('trailhead-rec.court.list_bookings', {}),
  ]);
  state.programs = prgs.items || [];
  state.credit = hh.household_credit_cents || 0;
  state.members = hh.members || [];
  state.passes = hh.passes || [];
  state.passEff = Object.fromEntries((hh.effective_pass_statuses || []).map((p) => [p.id, p.effective_status]));
  state.enrollments = enrs.items || [];
  state.enrEff = Object.fromEntries((enrs.effective_statuses || []).map((e) => [e.id, e.effective_status]));
  state.slots = slots.items || [];
  state.bookings = bkgs.items || [];
  render();
}

async function runWrite(label, name, args) {
  const res = await callTool(name, { ...args, expected_version: state.version, request_id: reqId('gui') });
  state.notice = res.status === 'committed' ? `${label}: committed (${res.id})` : `${label} failed: ${res.code || res.status} — ${res.message || ''}`;
  await refreshAll();
}

function renderPrograms() {
  return el('section', { class: 'pane' },
    el('h2', {}, 'Seasonal Programs Catalog'),
    ...state.programs.map((p) =>
      el('article', { class: 'card' },
        el('h3', {}, `${p.title} (${p.id})`),
        el('p', {}, `${p.category} · ${p.schedule_text} · Ages ${p.min_age}-${p.max_age} · ${p.enrolled_count}/${p.capacity} seats`),
        el('p', {}, `Resident: $${(p.resident_fee_cents / 100).toFixed(2)} · Prerequisite: ${p.prerequisite_skill || 'None'} · Waiver: ${p.required_waiver || 'None'}`),
        state.members.length
          ? el('button', { onClick: () => runWrite('Enroll', 'trailhead-rec.enrollment.enroll', { program_id: p.id, person_ref: state.members[0].person_ref }) }, `Enroll ${state.members[0].name}`)
          : null
      )
    )
  );
}

function renderHousehold() {
  return el('section', { class: 'pane' },
    el('h2', {}, `Household Roster & Passes (Credit: $${(state.credit / 100).toFixed(2)})`),
    el('h3', {}, 'Members'),
    ...state.members.map((m) =>
      el('article', { class: 'card' },
        el('strong', {}, `${m.name} (${m.person_ref}) · Age ${m.age} · ${m.resident ? 'Resident' : 'Non-resident'}`),
        el('p', {}, `Skills: ${(m.completed_skills || []).join(', ') || 'None'} · Emergency: ${m.emergency_contact}`),
        el('p', {}, `Waivers: ${(m.waivers || []).map((w) => `${w.waiver_type}=${w.status}`).join(', ')}`)
      )
    ),
    el('h3', {}, 'Facility Passes'),
    ...state.passes.map((ps) =>
      el('article', { class: 'card' },
        el('strong', {}, `${ps.id} · ${ps.pass_type} · ${state.passEff[ps.id] || ps.status}`),
        el('p', {}, `Holder: ${ps.person_ref} · Facility: ${ps.facility_id} · Remaining visits: ${ps.remaining_visits} · Expires: ${ps.expires_at}`)
      )
    )
  );
}

function renderEnrollments() {
  return el('section', { class: 'pane' },
    el('h2', {}, 'Enrollments & 24-Hour Waitlist Offers'),
    ...state.enrollments.map((e) => {
      const eff = state.enrEff[e.id] || e.status;
      return el('article', { class: 'card' },
        el('strong', {}, `${e.id} (${e.confirmation_code}) · ${e.program_id} · ${e.person_ref} · ${eff}`),
        el('p', {}, `Fee paid: $${(e.fee_paid_cents / 100).toFixed(2)} · Refunded: $${(e.refunded_cents / 100).toFixed(2)}${e.offer_expires_at ? ' · Offer expires: ' + e.offer_expires_at : ''}`),
        eff === 'offer_pending'
          ? el('div', {},
              el('button', { onClick: () => runWrite('Accept offer', 'trailhead-rec.enrollment.accept_offer', { id: e.id }) }, 'Accept waitlist offer'),
              el('button', { onClick: () => runWrite('Decline offer', 'trailhead-rec.enrollment.decline_offer', { id: e.id, reason: 'Declined from GUI' }) }, 'Decline offer')
            )
          : null,
        ['enrolled', 'waitlisted'].includes(eff)
          ? el('button', { onClick: () => runWrite('Withdraw', 'trailhead-rec.enrollment.withdraw', { id: e.id, reason: 'Withdrawn from GUI' }) }, 'Withdraw enrollment')
          : null
      );
    })
  );
}

function renderCourts() {
  return el('section', { class: 'pane' },
    el('h2', {}, 'Athletic Court Reservations & Open Slots'),
    el('h3', {}, 'Bookings'),
    ...state.bookings.map((b) =>
      el('article', { class: 'card' },
        el('strong', {}, `${b.id} (${b.confirmation_code}) · ${b.facility_id} · ${b.sport} · ${b.status}`),
        el('p', {}, `${b.starts_at} → ${b.ends_at} · Holder: ${b.person_ref} · Fee: $${(b.fee_paid_cents / 100).toFixed(2)}`),
        b.status === 'confirmed'
          ? el('button', { onClick: () => runWrite('Cancel court', 'trailhead-rec.court.cancel', { id: b.id, reason: 'Cancelled from GUI' }) }, 'Cancel booking')
          : null
      )
    ),
    el('h3', {}, `Open Court Slots (${state.slots.length})`),
    ...state.slots.slice(0, 8).map((s) =>
      el('article', { class: 'card' },
        el('strong', {}, `${s.id} · ${s.court_name} (${s.sport}) · ${s.starts_at}`),
        el('p', {}, `${s.indoor ? 'Indoor' : 'Outdoor'} · Fee: $${(s.resident_fee_cents / 100).toFixed(2)}`),
        state.members.length
          ? el('button', { onClick: () => runWrite('Book court', 'trailhead-rec.court.book', { slot_id: s.id, person_ref: state.members[0].person_ref }) }, `Book for ${state.members[0].name}`)
          : null
      )
    )
  );
}

function render() {
  const root = document.getElementById('app');
  root.replaceChildren(
    el('main', { class: 'shell' },
      el('header', {},
        el('h1', {}, 'Trailhead Parks & Rec'),
        el('nav', { 'aria-label': 'Trailhead views' },
          el('button', { onClick: () => { state.tab = 'programs'; render(); } }, `Programs (${state.programs.length})`),
          el('button', { onClick: () => { state.tab = 'household'; render(); } }, `Household & Passes ($${(state.credit / 100).toFixed(2)})`),
          el('button', { onClick: () => { state.tab = 'enrollments'; render(); } }, `Enrollments (${state.enrollments.length})`),
          el('button', { onClick: () => { state.tab = 'courts'; render(); } }, `Courts & Bookings (${state.bookings.length})`)
        ),
        state.notice ? el('p', { role: 'status' }, state.notice) : null
      ),
      state.tab === 'programs' ? renderPrograms()
        : state.tab === 'household' ? renderHousehold()
        : state.tab === 'enrollments' ? renderEnrollments()
        : renderCourts()
    )
  );
}

authenticate().then(refreshAll).catch((e) => {
  document.getElementById('app').textContent = e.message;
});
