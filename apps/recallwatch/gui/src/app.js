import { el } from '/shared/client.js';

// App-owned 4-view interactive Web GUI backed exclusively by Agent MCP tools (no Infra/admin controls).
const root = document.getElementById('app');
let csrfToken = '';

async function initSession() {
  const hash = location.hash || '';
  const m = hash.match(/access=([^&]+)/);
  if (m) {
    const r = await fetch('/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: decodeURIComponent(m[1]) }),
    });
    const out = await r.json();
    if (!r.ok) throw new Error(out.error || 'Session auth failed');
    csrfToken = out.csrf;
    history.replaceState(null, '', location.pathname + location.search);
  } else {
    const r = await fetch('/session');
    const out = await r.json();
    if (!r.ok) throw new Error(out.error || 'Session unavailable');
    csrfToken = out.csrf;
  }
}

const client = {
  async call(name, args = {}) {
    const r = await fetch('/api/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Pale-CSRF': csrfToken },
      body: JSON.stringify({ name, arguments: args }),
    });
    return r.json();
  },
};
const state = {
  tab: 'recalls',
  version: null,
  query: '',
  recalls: [],
  inventory: [],
  exposures: [],
  watchlists: [],
  claims: [],
  statusMessage: '',
  errorMessage: '',
  lastReceipt: null,
  claimForm: {
    recall_id: 'RW-2026-014',
    item_id: 'item-oat-daycare',
    remedy_type: 'refund',
    proof_kind: 'receipt_ref',
    proof_id: '',
    proof_version: '1',
    recipient_name: 'Priya Nair',
    recipient_person_ref: 'person-priya',
    shipping_address: '410 Maple Ave, Apt 3B, Exampleton, MA 02100',
    payout_method: 'original_payment',
    notes: 'Submitted through RecallWatch web portal',
  },
};

let reqSeq = 1;
const nextReq = (tag) => `web-rw-${tag}-${Date.now()}-${reqSeq++}`;

async function callTool(name, args = {}) {
  const res = await client.call(name, args);
  if (res.version) state.version = res.version;
  return res;
}

async function refreshAll() {
  const [recalls, inv, watchlists, claims] = await Promise.all([
    callTool('recallwatch.recall.search', state.query ? { query: state.query } : {}),
    callTool('recallwatch.inventory.list', { include_archived: true }),
    callTool('recallwatch.watchlist.list', {}),
    callTool('recallwatch.claim.list', {}),
  ]);
  state.recalls = recalls.items || [];
  state.inventory = inv.items || [];
  state.exposures = inv.exposures || [];
  state.watchlists = watchlists.items || [];
  state.claims = claims.items || [];
  render();
}

async function runWrite(label, tool, args) {
  state.errorMessage = '';
  try {
    const res = await callTool(tool, {
      ...args,
      expected_version: state.version,
      request_id: nextReq(label),
    });
    if (res.status === 'committed') {
      const receiptNote = res.claim_receipt_id ? ` · Receipt: ${res.claim_receipt_id}` : '';
      state.statusMessage = `${label}: committed (v${res.version.epoch}.${res.version.revision})${receiptNote}`;
      if (res.claim_receipt_id) state.lastReceipt = res.claim_receipt_id;
    } else {
      const code = res.code || (res.error && res.error.code) || res.status;
      const msg = res.message || (res.error && res.error.message) || JSON.stringify(res);
      state.errorMessage = `${label} failed [${code}]: ${msg}`;
    }
    await refreshAll();
    return res;
  } catch (err) {
    state.errorMessage = `${label} failed: ${err.message}`;
    render();
    return null;
  }
}

async function submitProofClaimFlow() {
  state.errorMessage = '';
  const f = state.claimForm;
  const proofRef = f.proof_id.trim()
    ? { kind: f.proof_kind, id: f.proof_id.trim(), version: Number.parseInt(f.proof_version, 10) || 1 }
    : null;

  // Step 1: Preview eligibility first (validates lot, deadline, proof_ref syntax/presence)
  const preview = await callTool('recallwatch.claim.preview', {
    recall_id: f.recall_id,
    item_id: f.item_id,
    remedy_type: f.remedy_type,
    ...(proofRef ? { proof_ref: proofRef } : {}),
  });
  if (preview.status !== 'ok' || !preview.eligible) {
    const reasons = Array.isArray(preview.reasons) && preview.reasons.length ? preview.reasons.join(', ') : (preview.code || 'ineligible');
    state.errorMessage = `Eligibility check rejected [${reasons}]: supply a valid structured proof_ref (syntax & presence validated in v1).`;
    render();
    return;
  }

  // Step 2: Create draft claim
  const draft = await runWrite('claim.create_draft', 'recallwatch.claim.create_draft', {
    recall_id: f.recall_id,
    item_id: f.item_id,
    remedy_type: f.remedy_type,
    ...(proofRef ? { proof_ref: proofRef } : {}),
    recipient_person_ref: f.recipient_person_ref,
    recipient_name: f.recipient_name,
    shipping_address: f.shipping_address,
    payout_method: f.payout_method,
    notes: f.notes,
  });
  const draftId = draft && (draft.id || (draft.item && draft.item.id));
  if (!draft || draft.status !== 'committed' || !draftId) return;

  // Step 3: Submit draft claim and capture persisted claim_receipt_id
  await runWrite('claim.submit', 'recallwatch.claim.submit', { id: draftId });
}

function renderRecalls() {
  const input = el('input', { type: 'search', id: 'recall-search', placeholder: 'Search brand, UPC, hazard, or lot...', value: state.query });
  const btn = el('button', { type: 'button', id: 'recall-search-btn' }, 'Search');
  btn.addEventListener('click', () => {
    state.query = input.value.trim();
    refreshAll();
  });
  const list = el('div', { class: 'list' });
  for (const r of state.recalls) {
    list.appendChild(
      el(
        'article',
        { class: 'card', 'data-record-id': r.id },
        el('h3', {}, `${r.brand} — ${r.product_name}`),
        el('p', {}, `${r.id} · ${r.severity.toUpperCase()} · ${r.status} · Hazard: ${r.hazard} · Proof required: ${r.proof_required ? 'Yes' : 'No'}`),
        el('p', {}, `UPC: ${r.upc} · Affected lots: ${(r.affected_lots || []).join(', ')} · Deadline: ${r.remedy_deadline_at}`)
      )
    );
  }
  return el('section', { 'data-view': 'recalls' }, el('h2', {}, 'Product Safety Recalls'), el('div', { class: 'toolbar' }, input, btn), list);
}

function renderInventory() {
  const expById = new Map((state.exposures || []).map((e) => [e.item_id, e]));
  const list = el('div', { class: 'list' });
  for (const it of state.inventory) {
    const exp = expById.get(it.id);
    const actions = [];
    if (it.status !== 'archived') {
      const archBtn = el('button', { type: 'button', 'data-action': 'archive-item', 'data-id': it.id }, 'Archive Item');
      archBtn.addEventListener('click', () =>
        runWrite('inventory.archive', 'recallwatch.inventory.archive', { id: it.id, disposal_note: 'Disposed via RecallWatch web portal' })
      );
      actions.push(archBtn);
    }
    list.appendChild(
      el(
        'article',
        { class: 'card', 'data-record-id': it.id },
        el('h4', {}, `${it.brand} ${it.product_name} (${it.status})`),
        el('p', {}, `ID: ${it.id} · UPC: ${it.upc} · Lot: ${it.lot_code} · Holder: ${it.holder_person_ref}`),
        el('p', {}, `Exposure: ${exp ? exp.exposure_status : 'unknown'}${exp && exp.matched_recall_ids && exp.matched_recall_ids.length ? ` (${exp.matched_recall_ids.join(', ')})` : ''}`),
        ...actions
      )
    );
  }
  return el('section', { 'data-view': 'inventory' }, el('h2', {}, 'Household Inventory & Exposure'), list);
}

function renderWatchlists() {
  const list = el('div', { class: 'list' });
  for (const w of state.watchlists) {
    const delBtn = el('button', { type: 'button', 'data-action': 'delete-watchlist', 'data-id': w.id }, 'Remove Watchlist');
    delBtn.addEventListener('click', () =>
      runWrite('watchlist.delete', 'recallwatch.watchlist.delete', { id: w.id })
    );
    list.appendChild(
      el(
        'article',
        { class: 'card', 'data-record-id': w.id },
        el('h4', {}, `${w.id} · ${w.name || w.label || w.category || 'Watchlist'}`),
        el('p', {}, `Status: ${w.status || 'active'} · Min severity: ${w.min_severity || 'any'} · Delivery: ${w.delivery_mode || 'immediate'}`),
        delBtn
      )
    );
  }
  return el('section', { 'data-view': 'watchlists' }, el('h2', {}, 'Watchlists'), list);
}

function renderClaims() {
  const f = state.claimForm;
  const recallInput = el('input', { type: 'text', id: 'claim-recall-id', value: f.recall_id });
  recallInput.addEventListener('input', () => { f.recall_id = recallInput.value; });
  const itemInput = el('input', { type: 'text', id: 'claim-item-id', value: f.item_id });
  itemInput.addEventListener('input', () => { f.item_id = itemInput.value; });
  const proofKind = el('select', { id: 'claim-proof-kind' },
    el('option', { value: 'receipt_ref' }, 'receipt_ref'),
    el('option', { value: 'file_ref' }, 'file_ref'),
    el('option', { value: 'asset_ref' }, 'asset_ref')
  );
  proofKind.value = f.proof_kind;
  proofKind.addEventListener('change', () => { f.proof_kind = proofKind.value; });
  const proofIdInput = el('input', { type: 'text', id: 'claim-proof-id', placeholder: 'e.g. rcpt-oat-daycare-2026', value: f.proof_id });
  proofIdInput.addEventListener('input', () => { f.proof_id = proofIdInput.value; });

  const createSubmitBtn = el('button', { type: 'button', id: 'claim-create-submit-btn' }, 'Create & Submit Proof-Required Claim');
  createSubmitBtn.addEventListener('click', () => { submitProofClaimFlow(); });

  const formCard = el(
    'section',
    { class: 'card', id: 'new-claim-panel' },
    el('h3', {}, 'Submit Proof-Required Remedy Claim'),
    el('p', {}, 'v1 validates structured proof_ref syntax & presence (optional Files is not bundled).'),
    el('div', { class: 'toolbar' },
      el('label', {}, 'Recall ID ', recallInput),
      el('label', {}, 'Item ID ', itemInput),
      el('label', {}, 'Proof Kind ', proofKind),
      el('label', {}, 'Proof Ref ID ', proofIdInput),
      createSubmitBtn
    )
  );

  const list = el('div', { class: 'list' });
  for (const c of [...state.claims].reverse()) {
    const actions = [];
    if (c.status === 'draft') {
      const subBtn = el('button', { type: 'button', 'data-action': 'submit-claim', 'data-id': c.id }, 'Submit Claim');
      subBtn.addEventListener('click', () => runWrite('claim.submit', 'recallwatch.claim.submit', { id: c.id }));
      actions.push(subBtn);
    }
    if (['draft', 'submitted'].includes(c.status)) {
      const wdBtn = el('button', { type: 'button', 'data-action': 'withdraw-claim', 'data-id': c.id }, 'Withdraw Claim');
      wdBtn.addEventListener('click', () => runWrite('claim.withdraw', 'recallwatch.claim.withdraw', { id: c.id, reason: 'Withdrawn by household' }));
      actions.push(wdBtn);
    }
    list.appendChild(
      el(
        'article',
        { class: 'card', 'data-record-id': c.id },
        el('h4', {}, `${c.id} · ${c.recall_id} · ${c.status}`),
        el('p', {}, `Item: ${c.item_id} · Lot: ${c.lot_code} · Remedy: ${c.remedy_type} · Receipt: ${c.claim_receipt_id || 'pending'}`),
        el('p', {}, `Proof ref: ${c.proof_ref ? `${c.proof_ref.kind}:${c.proof_ref.id} (v${c.proof_ref.version || 1})` : 'none'}${c.decision_note ? ` · Decision: ${c.decision_note}` : ''}`),
        ...actions
      )
    );
  }
  return el('section', { 'data-view': 'claims' }, el('h2', {}, 'Remedy Claims'), formCard, list);
}

function render() {
  root.textContent = '';
  const tabs = [
    ['recalls', 'Recalls'],
    ['inventory', 'Household Inventory'],
    ['watchlists', 'Watchlists'],
    ['claims', 'Remedy Claims'],
  ];
  const nav = el('nav', { class: 'tabs' });
  for (const [id, label] of tabs) {
    const btn = el('button', { type: 'button', 'data-tab': id, class: state.tab === id ? 'active' : '' }, label);
    btn.addEventListener('click', () => {
      state.tab = id;
      render();
    });
    nav.appendChild(btn);
  }
  const refreshBtn = el('button', { type: 'button', id: 'refresh-btn' }, 'Refresh');
  refreshBtn.addEventListener('click', () => { refreshAll(); });
  nav.appendChild(refreshBtn);

  const header = el(
    'header',
    {},
    el('h1', {}, 'RecallWatch'),
    el('p', { id: 'version-meta' }, `State version: v${state.version ? `${state.version.epoch}.${state.version.revision}` : '0.0'}${state.lastReceipt ? ` · Last receipt: ${state.lastReceipt}` : ''}`),
    state.statusMessage ? el('p', { class: 'status', role: 'status' }, state.statusMessage) : el('span', {}),
    state.errorMessage ? el('p', { class: 'error', role: 'alert' }, state.errorMessage) : el('span', {}),
    nav
  );
  let body;
  if (state.tab === 'recalls') body = renderRecalls();
  else if (state.tab === 'inventory') body = renderInventory();
  else if (state.tab === 'watchlists') body = renderWatchlists();
  else body = renderClaims();
  root.appendChild(el('main', {}, header, body));
}

initSession()
  .then(() => refreshAll())
  .catch((err) => {
    state.errorMessage = `Connection error: ${err.message}`;
    render();
  });
