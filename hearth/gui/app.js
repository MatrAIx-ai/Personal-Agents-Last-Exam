/**
 * Hearth Web GUI Controller
 * Connects directly to the Agent MCP tool dispatcher provided by the shared Host.
 */

// Tool invocation wrapper across shared Host transport
async function callTool(name, params = {}) {
  if (window.agentMcp && typeof window.agentMcp.callTool === 'function') {
    return window.agentMcp.callTool(name, params);
  }
  // Fallback for standalone mock inspection
  const res = await fetch(`/api/tools/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
}

async function initDashboard() {
  // Setup tabs
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      const panel = document.getElementById(btn.dataset.tab);
      if (panel) panel.classList.add('active');
    });
  });

  // Load initial data
  await refreshPropertyAndBudget();
  await refreshInventory();
  await refreshMaintenance();
}

async function refreshPropertyAndBudget() {
  const data = await callTool('hearth.get_property');
  if (!data || !data.property) return;

  document.getElementById('property-address').textContent = data.property.address;
  const available = data.budget.total_cap - (data.budget.spent + data.budget.reserved);
  document.getElementById('budget-available').textContent = `$${available.toFixed(2)}`;
  document.getElementById('budget-spent').textContent = `(Spent: $${data.budget.spent.toFixed(2)} / Cap: $${data.budget.total_cap.toFixed(2)})`;

  // Render rooms
  const roomsList = document.getElementById('rooms-list');
  roomsList.innerHTML = '';
  const roomSelect = document.getElementById('filter-inventory-room');

  for (const r of data.property.rooms || []) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <h3>${r.name}</h3>
      <p><strong>Dimensions:</strong> ${r.dimensions_cm[0]} × ${r.dimensions_cm[1]} cm</p>
      <p><strong>Type:</strong> ${r.is_storage ? 'Storage Space' : 'Living Area'}</p>
    `;
    roomsList.appendChild(card);

    if (roomSelect) {
      const opt = document.createElement('option');
      opt.value = r.id;
      opt.textContent = r.name;
      roomSelect.appendChild(opt);
    }
  }
}

async function refreshInventory() {
  const roomFilter = document.getElementById('filter-inventory-room')?.value;
  const statusFilter = document.getElementById('filter-inventory-status')?.value;

  const params = {};
  if (roomFilter) params.room_id = roomFilter;
  if (statusFilter) params.status = statusFilter;

  const data = await callTool('hearth.list_inventory', params);
  const tbody = document.getElementById('inventory-table-body');
  tbody.innerHTML = '';

  for (const item of (data && data.items) || []) {
    const tr = document.createElement('tr');
    const dimText = item.dimensions_cm ? `${item.dimensions_cm[0]} × ${item.dimensions_cm[1]} × ${item.dimensions_cm[2]}` : '—';
    const condText = item.condition ? `${item.condition} (Warranty: ${item.warranty_status || 'active'})` : '—';

    tr.innerHTML = `
      <td><strong>${item.name}</strong> ${item.is_heirloom ? '⭐ <em>Heirloom</em>' : ''}</td>
      <td>${item.category}</td>
      <td>${item.room_id}</td>
      <td><span class="badge badge-${item.status}">${item.status}</span></td>
      <td>${dimText}</td>
      <td>${condText}</td>
    `;
    tbody.appendChild(tr);
  }
}

async function refreshMaintenance() {
  const data = await callTool('hearth.list_maintenance_issues');
  const container = document.getElementById('maintenance-list');
  container.innerHTML = '';

  const issues = (data && data.issues) || [];
  if (issues.length === 0) {
    container.innerHTML = '<p class="subtext">No open maintenance issues recorded.</p>';
    return;
  }

  for (const iss of issues) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <h3>Issue on ${iss.appliance_id}</h3>
      <p>${iss.description}</p>
      <p><strong>Severity:</strong> ${iss.severity} | <strong>Status:</strong> <span class="badge badge-${iss.status}">${iss.status}</span></p>
    `;
    container.appendChild(card);
  }
}

window.addEventListener('DOMContentLoaded', initDashboard);
