// CloverVet 4-view interactive Web GUI backed exclusively by Agent MCP tools via /api/call.
// Zero Infra/admin controls; strict CSP (no inline scripts or styles).

let csrfToken = '';
let state = { tab: 'pets', version: null, pets: [], vaccinations: [], labs: [], clearances: [], clearanceEff: {}, slots: [], appointments: [], prescriptions: [], refills: [], notice: '' };

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
  const [pets, vax, clr, slots, appts, rxs] = await Promise.all([
    callTool('clovervet.pet.list', {}),
    callTool('clovervet.vaccination.list', {}),
    callTool('clovervet.clearance.list', {}),
    callTool('clovervet.slot.search', {}),
    callTool('clovervet.appointment.list', {}),
    callTool('clovervet.prescription.list', {}),
  ]);
  state.pets = pets.items || [];
  state.vaccinations = vax.vaccinations || [];
  state.labs = vax.lab_results || [];
  state.clearances = clr.items || [];
  state.clearanceEff = Object.fromEntries((clr.effective_statuses || []).map((x) => [x.id, x.effective_status]));
  state.slots = slots.items || [];
  state.appointments = appts.items || [];
  state.prescriptions = rxs.prescriptions || [];
  state.refills = rxs.refill_requests || [];
  render();
}

async function runWrite(label, name, args) {
  const res = await callTool(name, { ...args, expected_version: state.version, request_id: reqId('gui') });
  state.notice = res.status === 'committed' ? `${label}: committed (${res.id})` : `${label} failed: ${res.code || res.status} — ${res.message || ''}`;
  await refreshAll();
}

function renderPets() {
  return el('section', { class: 'pane' },
    el('h2', {}, 'Household Pets & Caretakers'),
    ...state.pets.map((p) =>
      el('article', { class: 'card' },
        el('h3', {}, `${p.name} (${p.breed}, ${p.species})`),
        el('p', {}, `Weight: ${p.weight_kg} kg · Microchip: ${p.microchip_id} · Exam valid until: ${p.exam_valid_until || 'None'}`),
        el('p', {}, `Allergies: ${(p.allergies || []).join(', ') || 'None'} · Handling: ${(p.handling_flags || []).join(', ') || 'Standard'}`),
        el('p', {}, `Caretakers: ${(p.authorized_caretakers || []).map((c) => `${c.person_ref} (${c.scope})`).join(', ') || 'Owner only'}`),
        el('p', {}, `Notes: ${p.notes || 'None'}`)
      )
    )
  );
}

function renderClearances() {
  return el('section', { class: 'pane' },
    el('h2', {}, 'Vaccinations, Lab Panels & Health Clearances'),
    el('h3', {}, 'Clearance Certificates'),
    ...state.clearances.map((c) => {
      const eff = state.clearanceEff[c.id] || c.status;
      return el('article', { class: 'card' },
        el('strong', {}, `${c.id} · ${c.pet_id} · ${c.clearance_type} · ${eff}`),
        el('p', {}, `Stay: ${c.stay_start_at} → ${c.stay_end_at || 'single-day'} · Valid until: ${c.valid_until}`),
        eff === 'issued'
          ? el('button', { onClick: () => runWrite('Revoke clearance', 'clovervet.clearance.revoke', { id: c.id, reason: 'Revoked from GUI' }) }, 'Revoke certificate')
          : null
      );
    }),
    el('h3', {}, 'Vaccinations'),
    ...state.vaccinations.map((v) => el('p', {}, `${v.pet_id} · ${v.vaccine_type} · administered ${v.administered_at} · expires ${v.expires_at} (${v.waiting_period_days}d wait)`)),
    el('h3', {}, 'Lab Results'),
    ...state.labs.map((l) => el('p', {}, `${l.pet_id} · ${l.panel_type} · ${l.status} · valid until ${l.valid_until}`))
  );
}

function renderAppointments() {
  return el('section', { class: 'pane' },
    el('h2', {}, 'Appointments & Open Clinic Slots'),
    el('h3', {}, 'Scheduled & Past Appointments'),
    ...state.appointments.map((a) =>
      el('article', { class: 'card' },
        el('strong', {}, `${a.id} (${a.confirmation_code}) · ${a.pet_id} · ${a.visit_type} · ${a.status}`),
        el('p', {}, `${a.branch_id} / ${a.vet_id} · ${a.starts_at}`),
        a.status === 'scheduled'
          ? el('button', { onClick: () => runWrite('Cancel appointment', 'clovervet.appointment.cancel', { id: a.id, reason: 'Cancelled from GUI' }) }, 'Cancel appointment')
          : null
      )
    ),
    el('h3', {}, `Open Clinic Slots (${state.slots.length})`),
    ...state.slots.slice(0, 8).map((s) =>
      el('article', { class: 'card' },
        el('strong', {}, `${s.id} · ${s.branch_id} · ${s.vet_id} · ${s.starts_at}`),
        el('p', {}, `Types: ${s.visit_types.join(', ')} · Fear-Free: ${s.fear_free_room} · Cat-Only: ${s.cat_only_slot}`),
        state.pets.length
          ? el('button', { onClick: () => runWrite('Book slot', 'clovervet.appointment.book', { pet_id: state.pets[0].id, slot_id: s.id, visit_type: s.visit_types[0] }) }, `Book for ${state.pets[0].name}`)
          : null
      )
    )
  );
}

function renderPrescriptions() {
  return el('section', { class: 'pane' },
    el('h2', {}, 'Prescriptions & Refill Requests'),
    el('h3', {}, 'Active Prescriptions'),
    ...state.prescriptions.map((rx) =>
      el('article', { class: 'card' },
        el('strong', {}, `${rx.id} · ${rx.pet_id} · ${rx.medication_name}`),
        el('p', {}, `Weight band: ${rx.min_weight_kg}-${rx.max_weight_kg} kg · Refills left: ${rx.refills_remaining} · Allergens: ${rx.allergen_tags.join(', ') || 'None'}`),
        el('button', { onClick: () => runWrite('Request refill', 'clovervet.prescription.request_refill', { prescription_id: rx.id, fulfillment_mode: 'clinic_pickup' }) }, 'Request clinic pickup refill')
      )
    ),
    el('h3', {}, 'Refill Requests'),
    ...state.refills.map((r) =>
      el('article', { class: 'card' },
        el('strong', {}, `${r.id} (${r.refill_receipt_id}) · ${r.prescription_id} · ${r.status}`),
        el('p', {}, `Mode: ${r.fulfillment_mode} · Address: ${r.shipping_address || r.pickup_branch_id || 'Clinic'}`),
        ['requested', 'vet_review'].includes(r.status)
          ? el('button', { onClick: () => runWrite('Cancel refill', 'clovervet.prescription.cancel_refill', { id: r.id, reason: 'Cancelled from GUI' }) }, 'Cancel refill')
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
        el('h1', {}, 'CloverVet'),
        el('nav', { 'aria-label': 'CloverVet views' },
          el('button', { onClick: () => { state.tab = 'pets'; render(); } }, `Pets (${state.pets.length})`),
          el('button', { onClick: () => { state.tab = 'clearances'; render(); } }, `Vaccinations & Clearances (${state.clearances.length})`),
          el('button', { onClick: () => { state.tab = 'appointments'; render(); } }, `Appointments & Slots (${state.appointments.length})`),
          el('button', { onClick: () => { state.tab = 'prescriptions'; render(); } }, `Prescriptions & Refills (${state.prescriptions.length})`)
        ),
        state.notice ? el('p', { role: 'status' }, state.notice) : null
      ),
      state.tab === 'pets' ? renderPets()
        : state.tab === 'clearances' ? renderClearances()
        : state.tab === 'appointments' ? renderAppointments()
        : renderPrescriptions()
    )
  );
}

authenticate().then(refreshAll).catch((e) => {
  document.getElementById('app').textContent = e.message;
});
