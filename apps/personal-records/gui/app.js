/**
 * Personal Records GUI Business Controller
 * Interacts with PersonalRecordsApp via standard tool contracts.
 */

// Global Application State
const state = {
  currentAccount: 'acc_demo_user',
  callerRole: 'user', // Controlled via the Session Selector
  documents: [],
  selectedDocumentId: null,
  proposals: [],
  links: []
};

// Fallback fetch helper
async function fetchSnapshot() {
  if (window.recordsApp && typeof window.recordsApp.snapshot === 'function') {
    return window.recordsApp.snapshot(state.currentAccount);
  }
  try {
    const res = await fetch(`/api/snapshot?account_id=${state.currentAccount}`);
    if (res.ok) return await res.json();
  } catch (err) {
    console.warn('Snapshot fetch fallback failed:', err);
  }
  return { proposals: [], links: [] };
}

// Dispatcher Adapter (Supports both in-process mock and Host POST /api/tools/call)
async function dispatchToolCall(toolName, params) {
  if (window.recordsApp && typeof window.recordsApp.callTool === 'function') {
    return window.recordsApp.callTool(toolName, params, {
      accountId: state.currentAccount,
      callerRole: state.callerRole
    });
  }

  // Fallback to Web Host HTTP endpoint if running inside runtime/web
  try {
    const res = await fetch('/api/tools/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: toolName,
        params,
        context: { accountId: state.currentAccount, callerRole: state.callerRole }
      })
    });
    return await res.json();
  } catch (err) {
    console.warn(`Local tool dispatch fallback for ${toolName}:`, err);
    return null;
  }
}

// Navigation Tabs
document.querySelectorAll('.nav-item').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.view-panel').forEach((p) => p.classList.remove('active'));

    button.classList.add('active');
    const tabName = button.getAttribute('data-tab');
    document.getElementById(`view-${tabName}`).classList.add('active');

    if (tabName === 'library') loadLibrary();
    if (tabName === 'graph') loadGraph();
    if (tabName === 'proposals') loadProposals();
  });
});

// Actor Role Switcher
document.getElementById('caller-session-toggle').addEventListener('change', (e) => {
  state.callerRole = e.target.value;
  console.log(`Active actor switched to: ${state.callerRole}`);
});

// Document Library View
async function loadLibrary() {
  const query = document.getElementById('search-input').value;
  const category = document.getElementById('category-filter').value;
  const verificationState = document.getElementById('state-filter').value;

  const docs = await dispatchToolCall('records.search', {
    query: query || undefined,
    category: category || undefined,
    verification_state: verificationState || undefined
  }) || [];

  state.documents = docs;
  const tbody = document.getElementById('documents-table-body');
  tbody.innerHTML = '';

  if (docs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">No documents found.</td></tr>';
    return;
  }

  docs.forEach((d) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${escapeHtml(d.title)}</strong></td>
      <td>${escapeHtml(d.category || 'General')}</td>
      <td>v${d.current_version_number}</td>
      <td><span class="status-pill ${d.verification_state}">${d.verification_state}</span></td>
      <td>${d.valid_until ? d.valid_until.split('T')[0] : 'N/A'}</td>
      <td><button class="btn" onclick="inspectDocument('${d.document_id}')">Inspect</button></td>
    `;
    tbody.appendChild(tr);
  });
}

// Search inputs debouncing
document.getElementById('search-input').addEventListener('input', debounce(loadLibrary, 250));
document.getElementById('category-filter').addEventListener('change', loadLibrary);
document.getElementById('state-filter').addEventListener('change', loadLibrary);

// Document & Passage Viewer
window.inspectDocument = async function (documentId) {
  state.selectedDocumentId = documentId;

  // Switch tab to viewer
  document.querySelector('[data-tab="viewer"]').click();

  const doc = await dispatchToolCall('records.get_document', {
    document_id: documentId,
    include_extracted_text: true,
    include_claims: true
  });

  if (!doc) return;

  document.getElementById('viewer-title').innerText = doc.title;
  document.getElementById('viewer-subtitle').innerText = `ID: ${doc.document_id} • Version: ${doc.current_version_number} • State: ${doc.verification_state}`;

  const textContainer = document.getElementById('document-text-container');
  const claimsContainer = document.getElementById('claims-list-container');

  const rawText = doc.extraction ? doc.extraction.raw_text : 'No text content available.';
  const claims = doc.claims || [];

  // Render text with passage highlight spans
  textContainer.innerHTML = renderHighlightedPassages(rawText, claims);

  // Render claims list
  claimsContainer.innerHTML = '';
  if (claims.length === 0) {
    claimsContainer.innerHTML = '<p class="empty-hint">No verified claims for this record.</p>';
  } else {
    claims.forEach((c) => {
      const card = document.createElement('div');
      card.className = 'claim-card';
      card.innerHTML = `
        <p class="claim-header">Offsets [${c.start_offset}, ${c.end_offset}] • ${c.verification_state}</p>
        <p><strong>Claim:</strong> ${escapeHtml(c.claim_text)}</p>
        <blockquote>"${escapeHtml(c.cited_text)}"</blockquote>
      `;
      claimsContainer.appendChild(card);
    });
  }
};

function renderHighlightedPassages(rawText, claims) {
  if (!claims || claims.length === 0) {
    return escapeHtml(rawText);
  }

  // Sort claims by start_offset
  const sorted = [...claims].sort((a, b) => a.start_offset - b.start_offset);
  let html = '';
  let cursor = 0;

  for (const c of sorted) {
    if (c.start_offset > cursor) {
      html += escapeHtml(rawText.slice(cursor, c.start_offset));
    }
    const cited = rawText.slice(c.start_offset, c.end_offset);
    html += `<mark class="passage-highlight" title="${escapeHtml(c.claim_text)}">${escapeHtml(cited)}</mark>`;
    cursor = c.end_offset;
  }

  if (cursor < rawText.length) {
    html += escapeHtml(rawText.slice(cursor));
  }

  return html;
}

// Proposals Review Panel
async function loadProposals() {
  const container = document.getElementById('proposals-list-container');
  container.innerHTML = '<p class="loading">Loading pending proposals...</p>';

  const snap = await fetchSnapshot();
  const proposals = (snap.proposals || []).filter((p) => p.status === 'PENDING');

  document.getElementById('proposal-count-badge').innerText = proposals.length;
  container.innerHTML = '';

  if (proposals.length === 0) {
    container.innerHTML = '<p class="empty-hint">No pending proposals awaiting review.</p>';
    return;
  }

  proposals.forEach((p) => {
    const card = document.createElement('div');
    card.className = 'proposal-card pending';
    card.innerHTML = `
      <div class="proposal-header">
        <strong>Proposal: ${p.proposal_id}</strong>
        <span class="status-pill INFERRED">${p.status}</span>
      </div>
      <div class="proposal-body">
        <p><strong>Target:</strong> ${p.target_type} (ID: ${p.target_id})</p>
        <p><strong>Rationale:</strong> ${escapeHtml(p.rationale)}</p>
        <div class="diff-preview">
          <code>${escapeHtml(p.proposed_changes)}</code>
        </div>
      </div>
      <div class="proposal-actions">
        <button class="btn btn-approve" onclick="confirmProposal('${p.proposal_id}', 'APPROVE')">Approve Update (User)</button>
        <button class="btn btn-reject" onclick="confirmProposal('${p.proposal_id}', 'REJECT')">Reject</button>
      </div>
    `;
    container.appendChild(card);
  });
}

window.confirmProposal = async function (proposalId, decision) {
  try {
    const res = await dispatchToolCall('records.confirm_update', {
      proposal_id: proposalId,
      decision
    });

    if (res && res.status) {
      alert(`Proposal ${proposalId} resolved with status: ${res.status}`);
      loadProposals();
      loadLibrary();
    }
  } catch (err) {
    alert(`Confirmation failed: ${err.message || 'Permission Denied'}`);
  }
};

// Relationship Graph View
async function loadGraph() {
  const container = document.getElementById('links-summary-list');
  container.innerHTML = '';

  const snap = await fetchSnapshot();
  const links = snap.links || [];

  if (links.length === 0) {
    container.innerHTML = '<p class="empty-hint">No directed links in graph.</p>';
    return;
  }

  links.forEach((l) => {
    const card = document.createElement('div');
    card.className = 'link-card';
    card.innerHTML = `
      <div class="link-edge">
        <span>${l.source_id}</span>
        <span class="link-type">${escapeHtml(l.relationship_type)}</span>
        <span>&rarr; ${l.target_id}</span>
      </div>
      <p style="font-size: 0.8rem; color: var(--text-muted);">Link ID: ${l.link_id}</p>
    `;
    container.appendChild(card);
  });
}

// Helpers
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// Initial Bootstrap
window.addEventListener('DOMContentLoaded', () => {
  loadLibrary();
});
