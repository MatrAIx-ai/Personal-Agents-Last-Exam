import { el, human, tag, metadata } from '/shared/client.js';

/**
 * Hearth Household Dashboard Controller
 * Uses /shared/style.css layout primitives (.app-shell, .toolbar, .workspace,
 * .collection, .detail, .metadata-line) and CSSOM styles (CSP-safe) to render
 * rooms & 2D floor plans, inventory, maintenance, budget/purchases, and residents.
 */
(async function main() {
  document.title = 'Hearth · PALE';
  document.body.dataset.app = 'hearth';

  const css = (node, styles) => {
    Object.assign(node.style, styles);
    return node;
  };

  let csrf = '';
  let tools = [];
  let version = { epoch: 1, revision: 0 };
  let propertyData = null;
  let rooms = [];
  let budget = { total_cap: 0, spent: 0, reserved: 0 };
  let purchases = [];
  let inventory = [];
  let issues = [];
  let residents = [];

  let activeTab = 'rooms';
  let selectedRoomId = null;
  let selectedRoomDetail = null;
  let selectedItemId = null;
  let selectedIssueId = null;
  let selectedPurchaseId = null;
  let selectedResidentId = null;
  let searchQuery = '';
  let statusFilter = '';
  let categoryFilter = '';
  let busy = false;

  const statusBar = el('p', { role: 'status', 'aria-live': 'polite', id: 'status' }, 'Connecting…');
  const nav = el('nav', { 'aria-label': 'Hearth sections' });
  const globalActions = el('div', { class: 'actions' });
  const sidebarFootText = el('div', {}, el('strong', {}, 'Household'), el('small', {}, 'Connecting…'));

  const searchInput = el('input', {
    type: 'search',
    placeholder: 'Search rooms, inventory, maintenance, or purchases…',
    'aria-label': 'Search',
    oninput: () => {
      searchQuery = searchInput.value.trim().toLowerCase();
      renderWorkspace();
    }
  });
  const refreshBtn = el('button', { type: 'button', onclick: () => refreshAll().catch(showError) }, 'Refresh');

  const sectionTitle = el('h2', { class: 'section-title' }, 'Rooms');
  const sectionCount = el('span', { class: 'collection-count' }, '0');
  const collectionHead = el('div', { class: 'collection-head' }, sectionTitle, sectionCount);
  const filterBar = css(el('div', {}), { padding: '0 22px 12px', display: 'none', gap: '8px' });
  const recordsList = el('div', { class: 'records', id: 'records' });
  const detailPane = el('section', { class: 'detail', 'aria-label': 'Details' });
  const workspace = el(
    'div',
    { class: 'workspace' },
    el('section', { class: 'collection', 'aria-label': 'List' }, collectionHead, filterBar, recordsList),
    detailPane
  );

  const dialog = el('dialog', { 'aria-label': 'Hearth action' });
  const form = el('form', {});
  const formTitle = el('h2', {});
  const formFields = el('div', { class: 'fields' });
  const formError = el('p', { role: 'alert', class: 'form-error' });
  const formSubmit = el('button', { type: 'submit', class: 'primary' }, 'Submit');
  const formCancel = el('button', { type: 'button', onclick: () => dialog.close() }, 'Cancel');
  form.append(formTitle, formFields, formError, el('div', { class: 'form-actions' }, formCancel, formSubmit));
  dialog.append(form);

  const appRoot = document.querySelector('#app');
  appRoot.setAttribute('aria-busy', 'true');
  appRoot.replaceChildren(
    el(
      'div',
      { class: 'app-shell' },
      el(
        'aside',
        { class: 'sidebar' },
        el('div', { class: 'brand' }, el('span', { class: 'brand-mark', 'aria-hidden': 'true' }, '⌂'), el('h1', {}, 'Hearth')),
        globalActions,
        nav,
        el('div', { class: 'sidebar-foot' }, el('span', { class: 'avatar small', 'aria-hidden': 'true' }, 'H'), sidebarFootText)
      ),
      el(
        'main',
        { class: 'app-main' },
        el('header', { class: 'toolbar' }, searchInput, refreshBtn),
        statusBar,
        workspace
      )
    ),
    dialog
  );

  function showError(err) {
    statusBar.textContent = err?.message || String(err);
    statusBar.dataset.error = 'true';
  }

  function showStatus(msg) {
    statusBar.textContent = msg;
    delete statusBar.dataset.error;
  }

  async function request(url, method = 'GET', body) {
    const res = await fetch(url, {
      method,
      headers: method === 'POST' ? { 'Content-Type': 'application/json', 'X-Pale-CSRF': csrf } : {},
      ...(method === 'POST' ? { body: JSON.stringify(body) } : {})
    });
    const out = await res.json();
    if (!res.ok) throw Error(out.error || 'Request failed');
    return out;
  }

  async function callTool(name, args = {}) {
    const res = await request('/api/call', 'POST', { name, arguments: args });
    if (!['ok', 'committed', 'ready'].includes(res.status)) {
      throw Object.assign(Error(res.message || res.status), { code: res.status });
    }
    if (res.version) version = res.version;
    return res;
  }

  const hasTool = (name) => tools.some((t) => t.name === name);

  async function selectRoom(roomId) {
    selectedRoomId = roomId;
    if (hasTool('hearth.get_room')) {
      const res = await callTool('hearth.get_room', { room_id: roomId });
      selectedRoomDetail = res;
      const roomItems = res.active_items || [];
      if (!roomItems.some((i) => i.id === selectedItemId)) {
        selectedItemId = roomItems[0]?.id || null;
      }
    }
    renderWorkspace();
  }

  async function refreshAll() {
    appRoot.setAttribute('aria-busy', 'true');
    try {
      const discovered = await request('/api/tools');
      tools = discovered.tools || [];

      const [propRes, invRes, issRes] = await Promise.all([
        callTool('hearth.get_property', {}),
        callTool('hearth.list_inventory', {}),
        callTool('hearth.list_maintenance_issues', {})
      ]);

      propertyData = propRes.property;
      rooms = propRes.rooms || [];
      budget = propRes.budget || { total_cap: 0, spent: 0, reserved: 0 };
      purchases = propRes.purchases || [];
      inventory = invRes.items || [];
      issues = issRes.issues || [];

      if (!selectedRoomId || !rooms.some((r) => r.id === selectedRoomId)) {
        selectedRoomId = rooms[0]?.id || null;
      }
      if (selectedRoomId && hasTool('hearth.get_room')) {
        selectedRoomDetail = await callTool('hearth.get_room', { room_id: selectedRoomId });
      }
      if (!selectedItemId || !inventory.some((i) => i.id === selectedItemId)) {
        selectedItemId = inventory[0]?.id || null;
      }
      if (!selectedIssueId || !issues.some((i) => i.id === selectedIssueId)) {
        selectedIssueId = issues[0]?.id || null;
      }
      if (!selectedPurchaseId || !purchases.some((p) => p.id === selectedPurchaseId)) {
        selectedPurchaseId = purchases[0]?.id || null;
      }

      if (hasTool('hearth.get_resident_profile')) {
        const knownIds = ['person_nassim_01', 'person_partner_02', 'person_elena_01', 'person_samira_01'];
        const settled = await Promise.allSettled(knownIds.map((id) => callTool('hearth.get_resident_profile', { person_id: id })));
        residents = settled.filter((r) => r.status === 'fulfilled' && r.value.resident).map((r) => r.value.resident);
        if (!selectedResidentId || !residents.some((r) => r.person_id === selectedResidentId)) {
          selectedResidentId = residents[0]?.person_id || null;
        }
      }

      const available = budget.total_cap - (budget.spent + budget.reserved);
      sidebarFootText.replaceChildren(
        el('strong', {}, propertyData?.address || 'Household'),
        el('small', {}, `Avail: $${available.toFixed(0)} · v${version.epoch}.${version.revision}`)
      );

      renderGlobalActions();
      renderNav();
      renderWorkspace();
      showStatus(`Synced · ${propertyData?.address || 'Hearth'} · Available budget $${available.toFixed(2)}`);
    } finally {
      appRoot.setAttribute('aria-busy', 'false');
    }
  }

  function renderGlobalActions() {
    globalActions.replaceChildren();
    if (hasTool('hearth.request_purchase')) {
      globalActions.append(el('button', { type: 'button', class: 'primary', onclick: () => openToolModal('Request purchase', 'hearth.request_purchase', { target_room_id: selectedRoomId || rooms[0]?.id || '' }) }, 'Request purchase'));
    }
    if (hasTool('hearth.report_maintenance_issue')) {
      globalActions.append(el('button', { type: 'button', onclick: () => openToolModal('Report maintenance issue', 'hearth.report_maintenance_issue', { severity: 'minor' }) }, 'Report issue'));
    }
  }

  function renderNav() {
    const pendingCount = purchases.filter((p) => p.status === 'pending_approval').length;
    const tabs = [
      { id: 'rooms', label: 'Rooms & Floor Plan', symbol: '⊞', count: rooms.length },
      { id: 'inventory', label: 'Inventory', symbol: '◫', count: inventory.length },
      { id: 'maintenance', label: 'Maintenance', symbol: '⚙', count: issues.length },
      { id: 'budget', label: 'Budget & Purchases', symbol: '$', count: pendingCount || purchases.length },
      { id: 'residents', label: 'Residents', symbol: '☺', count: residents.length }
    ];
    nav.replaceChildren(
      ...tabs.map((t) =>
        el(
          'button',
          {
            type: 'button',
            'aria-current': activeTab === t.id ? 'page' : false,
            onclick: () => {
              activeTab = t.id;
              renderNav();
              renderWorkspace();
            }
          },
          el('span', { class: 'nav-symbol', 'aria-hidden': 'true' }, t.symbol),
          el('span', {}, t.label),
          t.count !== '' ? el('small', {}, String(t.count)) : null
        )
      )
    );
  }

  function renderWorkspace() {
    filterBar.style.display = 'none';
    filterBar.replaceChildren();
    if (activeTab === 'rooms') return renderRoomsWorkspace();
    if (activeTab === 'inventory') return renderInventoryWorkspace();
    if (activeTab === 'maintenance') return renderMaintenanceWorkspace();
    if (activeTab === 'budget') return renderBudgetWorkspace();
    if (activeTab === 'residents') return renderResidentsWorkspace();
  }

  function renderRoomsWorkspace() {
    const shownRooms = rooms.filter((r) => !searchQuery || `${r.name} ${r.id}`.toLowerCase().includes(searchQuery));
    sectionTitle.textContent = 'Rooms';
    sectionCount.textContent = String(shownRooms.length);
    const layerOrderRef = { decor: 1, furniture: 2, appliance: 3 };
    let floorBoxRef = null;

    const listNodes = [];
    for (const r of shownRooms) {
      const roomItems = inventory.filter((i) => i.room_id === r.id && i.status !== 'disposed');
      const isRoomSelected = r.id === selectedRoomId;
      listNodes.push(
        el(
          'button',
          {
            type: 'button',
            class: 'record',
            'aria-pressed': String(isRoomSelected),
            onclick: () => selectRoom(r.id).catch(showError)
          },
          el('span', { class: 'record-title' }, r.name),
          el('span', { class: 'record-subtitle' }, `${r.dimensions_cm[0]} × ${r.dimensions_cm[1]} cm · ${r.is_storage ? 'Storage' : 'Living'} · ${roomItems.length} items`)
        )
      );

      // Nested item list under the currently selected room
      if (isRoomSelected && roomItems.length) {
        for (const item of roomItems) {
          const isItemSelected = item.id === selectedItemId;
          const locText = Array.isArray(item.coordinates) ? `[${item.coordinates.join(', ')}] cm` : 'stored';
          const dimText = Array.isArray(item.dimensions_cm) ? `${item.dimensions_cm.join(' × ')} cm` : null;
          const subtitle = [human(item.category), locText, dimText].filter(Boolean).join(' · ');
          const nestedBtn = el(
            'button',
            {
              type: 'button',
              class: 'record',
              title: `${item.name} · ${subtitle}`,
              'aria-pressed': String(isItemSelected),
              onmouseenter: () => {
                const box = floorBoxRef?.querySelector(`[data-item-id="${item.id}"]`);
                if (box) {
                  box.style.boxShadow = '0 0 0 2px #2563eb';
                  box.style.zIndex = '20';
                }
              },
              onmouseleave: () => {
                const box = floorBoxRef?.querySelector(`[data-item-id="${item.id}"]`);
                if (box) {
                  box.style.boxShadow = '';
                  box.style.zIndex = isItemSelected ? '10' : String(layerOrderRef[item.category] || 2);
                }
              },
              onclick: () => {
                selectedItemId = item.id;
                renderRoomsWorkspace();
              }
            },
            el('span', { class: 'record-title' }, `↳ ${item.name}`),
            el('span', { class: 'record-subtitle' }, subtitle)
          );
          css(nestedBtn, {
            paddingLeft: '36px',
            paddingTop: '10px',
            paddingBottom: '10px',
            background: isItemSelected ? '#edf3ff' : '#fafbfd'
          });
          listNodes.push(nestedBtn);
        }
      }
    }
    recordsList.replaceChildren(...listNodes);

    const room = selectedRoomDetail?.room || rooms.find((r) => r.id === selectedRoomId);
    if (!room) {
      detailPane.replaceChildren(el('div', { class: 'empty' }, el('h3', {}, 'No room selected'), el('p', {}, 'Select a room to inspect its 2D floor plan.')));
      return;
    }

    const roomItems = inventory.filter((i) => i.room_id === room.id && i.status !== 'disposed');
    const [rw, rh] = room.dimensions_cm;
    const scale = Math.min(560 / rw, 360 / rh);
    const canvasW = Math.round(rw * scale);
    const canvasH = Math.round(rh * scale);

    const floorBox = css(el('div', { 'aria-label': `2D floor plan for ${room.name}` }), {
      position: 'relative',
      width: `${canvasW}px`,
      height: `${canvasH}px`,
      border: '2px solid #334155',
      background: '#f8fafc',
      borderRadius: '8px',
      overflow: 'hidden',
      margin: '18px 0'
    });
    floorBoxRef = floorBox;

    // Layer decor (e.g., rugs) beneath furniture and appliances; selected item on top
    const sortedForPaint = [...roomItems].sort((a, b) => (layerOrderRef[a.category] || 2) - (layerOrderRef[b.category] || 2));

    for (const item of sortedForPaint) {
      const [cx, cy] = Array.isArray(item.coordinates) ? item.coordinates : [20, 20];
      const [iw, id] = Array.isArray(item.dimensions_cm) ? item.dimensions_cm : [50, 50];
      const left = Math.max(2, Math.min(canvasW - 34, Math.round(cx * scale)));
      const top = Math.max(2, Math.min(canvasH - 22, Math.round(cy * scale)));
      const w = Math.max(32, Math.min(canvasW - left - 2, Math.round(iw * scale)));
      const h = Math.max(20, Math.min(canvasH - top - 2, Math.round(id * scale)));
      const isSelected = item.id === selectedItemId;

      const boxBtn = css(
        el('button', {
          type: 'button',
          'data-item-id': item.id,
          title: `${item.name} (${cx}, ${cy})`,
          onclick: () => {
            selectedItemId = item.id;
            renderRoomsWorkspace();
          }
        }, item.name),
        {
          position: 'absolute',
          left: `${left}px`,
          top: `${top}px`,
          width: `${w}px`,
          height: `${h}px`,
          zIndex: isSelected ? '10' : String(layerOrderRef[item.category] || 2),
          padding: '2px 4px',
          fontSize: '10px',
          lineHeight: '1.2',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          borderRadius: '4px',
          border: isSelected ? '2px solid #2563eb' : '1px solid #64748b',
          background: isSelected ? '#dbeafe' : item.is_heirloom ? '#fef3c7' : item.category === 'decor' ? '#f1f5f9' : item.category === 'appliance' ? '#e0f2fe' : '#e2e8f0',
          color: '#1e293b',
          opacity: item.category === 'decor' ? '0.85' : '0.96'
        }
      );
      floorBox.append(boxBtn);
    }

    const picked = roomItems.find((i) => i.id === selectedItemId) || roomItems[0] || null;
    const actionBar = el('div', { class: 'actions' });
    if (picked) {
      if (hasTool('hearth.update_item_placement')) {
        actionBar.append(el('button', { type: 'button', onclick: () => openToolModal('Move item', 'hearth.update_item_placement', { item_id: picked.id, room_id: picked.room_id, coordinates: picked.coordinates || [50, 50] }) }, 'Move item'));
      }
      if (hasTool('hearth.store_item') && !room.is_storage) {
        actionBar.append(el('button', { type: 'button', onclick: () => openToolModal('Store item', 'hearth.store_item', { item_id: picked.id, storage_room_id: rooms.find((x) => x.is_storage)?.id || '' }) }, 'Move to storage'));
      }
      if (hasTool('hearth.dispose_item')) {
        actionBar.append(el('button', { type: 'button', onclick: () => openToolModal('Dispose item', 'hearth.dispose_item', { item_id: picked.id }) }, 'Dispose item'));
      }
    }

    detailPane.replaceChildren(
      el('div', { class: 'detail-actions' }, actionBar),
      el(
        'article',
        {},
        el('span', { class: 'kicker' }, room.is_storage ? 'Storage Space' : 'Living Space'),
        el('h2', {}, room.name),
        el('div', { class: 'tags' }, tag(`${rw} × ${rh} cm`), tag(`${roomItems.length} items`)),
        floorBox,
        roomItems.length === 0 ? el('p', { class: 'muted' }, 'No items in this room.') : null
      )
    );
  }

  function renderInventoryWorkspace() {
    filterBar.style.display = 'flex';
    const statusSel = css(
      el('select', { 'aria-label': 'Status filter', onchange: () => { statusFilter = statusSel.value; renderInventoryWorkspace(); } },
        el('option', { value: '', selected: statusFilter === '' }, 'All statuses'),
        el('option', { value: 'active', selected: statusFilter === 'active' }, 'Active'),
        el('option', { value: 'stored', selected: statusFilter === 'stored' }, 'Stored'),
        el('option', { value: 'disposed', selected: statusFilter === 'disposed' }, 'Disposed')
      ),
      { flex: '1', padding: '6px 8px', fontSize: '12px' }
    );
    const catSel = css(
      el('select', { 'aria-label': 'Category filter', onchange: () => { categoryFilter = catSel.value; renderInventoryWorkspace(); } },
        el('option', { value: '', selected: categoryFilter === '' }, 'All categories'),
        el('option', { value: 'furniture', selected: categoryFilter === 'furniture' }, 'Furniture'),
        el('option', { value: 'appliance', selected: categoryFilter === 'appliance' }, 'Appliance'),
        el('option', { value: 'decor', selected: categoryFilter === 'decor' }, 'Decor')
      ),
      { flex: '1', padding: '6px 8px', fontSize: '12px' }
    );
    filterBar.replaceChildren(statusSel, catSel);

    const shown = inventory.filter((i) => {
      if (statusFilter && i.status !== statusFilter) return false;
      if (categoryFilter && i.category !== categoryFilter) return false;
      if (searchQuery && !`${i.name} ${i.room_id} ${i.category}`.toLowerCase().includes(searchQuery)) return false;
      return true;
    });

    sectionTitle.textContent = 'Inventory';
    sectionCount.textContent = String(shown.length);

    recordsList.replaceChildren(
      ...shown.map((item) =>
        el(
          'button',
          {
            type: 'button',
            class: 'record',
            'data-record-id': item.id,
            'aria-pressed': String(item.id === selectedItemId),
            onclick: () => {
              selectedItemId = item.id;
              renderInventoryWorkspace();
            }
          },
          el('span', { class: 'record-title' }, item.name),
          el('span', { class: 'record-subtitle' }, `${item.room_id} · ${human(item.category)} · ${human(item.status)}${item.is_heirloom ? ' · Heirloom' : ''}`)
        )
      )
    );

    const item = shown.find((i) => i.id === selectedItemId) || shown[0] || null;
    if (!item) {
      detailPane.replaceChildren(el('div', { class: 'empty' }, el('h3', {}, 'No matching items'), el('p', {}, 'Adjust your filters or search query.')));
      return;
    }
    selectedItemId = item.id;

    const actions = el('div', { class: 'actions' });
    if (hasTool('hearth.update_item_placement') && item.status !== 'disposed') {
      actions.append(el('button', { type: 'button', onclick: () => openToolModal('Move item', 'hearth.update_item_placement', { item_id: item.id, room_id: item.room_id, coordinates: item.coordinates || [50, 50] }) }, 'Move item'));
    }
    if (hasTool('hearth.store_item') && item.status === 'active') {
      actions.append(el('button', { type: 'button', onclick: () => openToolModal('Store item', 'hearth.store_item', { item_id: item.id, storage_room_id: rooms.find((r) => r.is_storage)?.id || '' }) }, 'Store item'));
    }
    if (hasTool('hearth.dispose_item') && item.status !== 'disposed') {
      actions.append(el('button', { type: 'button', onclick: () => openToolModal('Dispose item', 'hearth.dispose_item', { item_id: item.id }) }, 'Dispose item'));
    }
    if (hasTool('hearth.report_maintenance_issue') && item.category === 'appliance') {
      actions.append(el('button', { type: 'button', onclick: () => openToolModal('Report issue', 'hearth.report_maintenance_issue', { appliance_id: item.id, severity: 'minor' }) }, 'Report issue'));
    }

    detailPane.replaceChildren(
      el('div', { class: 'detail-actions' }, actions),
      el(
        'article',
        {},
        el('span', { class: 'kicker' }, human(item.category)),
        el('h2', {}, item.name),
        el(
          'div',
          { class: 'tags' },
          tag(human(item.status)),
          item.is_heirloom ? tag('Heirloom') : null,
          item.condition ? tag(human(item.condition)) : null,
          item.warranty_status ? tag(`Warranty: ${human(item.warranty_status)}`) : null
        ),
        metadata('Item ID', item.id),
        metadata('Room', rooms.find((r) => r.id === item.room_id)?.name || item.room_id),
        metadata('Coordinates', Array.isArray(item.coordinates) ? `[${item.coordinates.join(', ')}] cm` : 'Not placed'),
        metadata('Dimensions', Array.isArray(item.dimensions_cm) ? `${item.dimensions_cm.join(' × ')} cm` : '—'),
        item.warranty_expires_at ? metadata('Warranty expires', item.warranty_expires_at) : null,
        item.disposal_reason ? metadata('Disposal reason', item.disposal_reason) : null,
        metadata('Created at', item.created_at || '—')
      )
    );
  }

  function renderMaintenanceWorkspace() {
    const shown = issues.filter((iss) => !searchQuery || `${iss.description} ${iss.appliance_id} ${iss.status}`.toLowerCase().includes(searchQuery));
    sectionTitle.textContent = 'Maintenance';
    sectionCount.textContent = String(shown.length);

    recordsList.replaceChildren(
      ...shown.map((iss) =>
        el(
          'button',
          {
            type: 'button',
            class: 'record',
            'aria-pressed': String(iss.id === selectedIssueId),
            onclick: () => {
              selectedIssueId = iss.id;
              renderMaintenanceWorkspace();
            }
          },
          el('span', { class: 'record-title' }, iss.description),
          el('span', { class: 'record-subtitle' }, `${iss.appliance_id} · ${human(iss.status)} · ${human(iss.severity)}`)
        )
      )
    );

    const iss = shown.find((i) => i.id === selectedIssueId) || shown[0] || null;
    if (!iss) {
      detailPane.replaceChildren(el('div', { class: 'empty' }, el('h3', {}, 'No maintenance issues'), el('p', {}, 'Use "Report issue" in the sidebar to log a fault.')));
      return;
    }
    selectedIssueId = iss.id;

    const actions = el('div', { class: 'actions' });
    if (hasTool('hearth.schedule_maintenance') && iss.status === 'reported') {
      actions.append(el('button', { type: 'button', onclick: () => openToolModal('Schedule maintenance', 'hearth.schedule_maintenance', { issue_id: iss.id }) }, 'Schedule repair'));
    }
    if (hasTool('hearth.resolve_maintenance_issue') && !['resolved', 'cancelled'].includes(iss.status)) {
      actions.append(el('button', { type: 'button', onclick: () => openToolModal('Resolve issue', 'hearth.resolve_maintenance_issue', { issue_id: iss.id, cost_usd: 0 }) }, 'Resolve issue'));
    }

    detailPane.replaceChildren(
      el('div', { class: 'detail-actions' }, actions),
      el(
        'article',
        {},
        el('span', { class: 'kicker' }, `Issue ${iss.id}`),
        el('h2', {}, iss.description),
        el('div', { class: 'tags' }, tag(human(iss.status)), tag(human(iss.severity))),
        metadata('Appliance', inventory.find((x) => x.id === iss.appliance_id)?.name || iss.appliance_id),
        metadata('Created at', iss.created_at || '—'),
        iss.scheduled_date ? metadata('Scheduled date', iss.scheduled_date) : null,
        iss.service_contact_id ? metadata('Service contact', iss.service_contact_id) : null,
        iss.resolution_notes ? metadata('Resolution notes', iss.resolution_notes) : null,
        iss.repair_cost_usd != null ? metadata('Repair cost', `$${iss.repair_cost_usd.toFixed(2)}`) : null
      )
    );
  }

  function renderBudgetWorkspace() {
    const shownPurchases = purchases.filter((p) => !searchQuery || `${p.item_name} ${p.status} ${p.category} ${p.target_room_id}`.toLowerCase().includes(searchQuery));
    sectionTitle.textContent = 'Purchases';
    sectionCount.textContent = String(shownPurchases.length);
    const available = budget.total_cap - (budget.spent + budget.reserved);

    recordsList.replaceChildren(
      ...shownPurchases.map((p) =>
        el(
          'button',
          {
            type: 'button',
            class: 'record',
            'aria-pressed': String(p.id === selectedPurchaseId),
            onclick: () => {
              selectedPurchaseId = p.id;
              renderBudgetWorkspace();
            }
          },
          el('span', { class: 'record-title' }, p.item_name),
          el('span', { class: 'record-subtitle' }, `$${p.cost_usd.toFixed(2)} · ${human(p.status)} · ${p.target_room_id}`)
        )
      )
    );

    const picked = shownPurchases.find((p) => p.id === selectedPurchaseId) || shownPurchases[0] || null;
    if (picked) selectedPurchaseId = picked.id;

    const actions = el('div', { class: 'actions' });
    if (hasTool('hearth.request_purchase')) {
      actions.append(el('button', { type: 'button', onclick: () => openToolModal('Request purchase', 'hearth.request_purchase', { target_room_id: rooms[0]?.id || '' }) }, 'New purchase request'));
    }
    if (hasTool('hearth.cancel_purchase') && picked && picked.status === 'pending_approval') {
      actions.append(el('button', { type: 'button', onclick: () => openToolModal('Cancel purchase', 'hearth.cancel_purchase', { purchase_id: picked.id }) }, 'Cancel selected purchase'));
    }

    detailPane.replaceChildren(
      el('div', { class: 'detail-actions' }, actions),
      el(
        'article',
        {},
        el('span', { class: 'kicker' }, 'Household Ledger'),
        el('h2', {}, propertyData?.address || 'Household Budget'),
        el('div', { class: 'tags' }, tag(`${propertyData?.total_area_sqm || 0} m²`), tag(`v${version.epoch}.${version.revision}`)),
        metadata('Total Cap', `$${budget.total_cap.toFixed(2)}`),
        metadata('Spent', `$${budget.spent.toFixed(2)}`),
        metadata('Reserved (Pending)', `$${budget.reserved.toFixed(2)}`),
        metadata('Available', `$${available.toFixed(2)}`),
        picked
          ? el(
              'div',
              {},
              css(el('h3', {}, 'Selected Purchase Request'), { marginTop: '24px' }),
              metadata('Item', picked.item_name),
              metadata('Status', human(picked.status)),
              metadata('Cost', `$${picked.cost_usd.toFixed(2)}`),
              metadata('Target Room', rooms.find((r) => r.id === picked.target_room_id)?.name || picked.target_room_id),
              picked.expires_at ? metadata('Expires at', picked.expires_at) : null,
              picked.decided_by ? metadata('Decided by', picked.decided_by) : null
            )
          : el('p', { class: 'muted' }, 'No purchase requests yet.')
      )
    );
  }

  function renderResidentsWorkspace() {
    sectionTitle.textContent = 'Residents';
    sectionCount.textContent = String(residents.length);

    recordsList.replaceChildren(
      ...residents.map((r) =>
        el(
          'button',
          {
            type: 'button',
            class: 'record',
            'aria-pressed': String(r.person_id === selectedResidentId),
            onclick: () => {
              selectedResidentId = r.person_id;
              renderResidentsWorkspace();
            }
          },
          el('span', { class: 'record-title' }, human(r.person_id)),
          el('span', { class: 'record-subtitle' }, `${human(r.role)} · ${(r.rules || []).length} rules`)
        )
      )
    );

    const res = residents.find((r) => r.person_id === selectedResidentId) || residents[0] || null;
    if (!res) {
      detailPane.replaceChildren(el('div', { class: 'empty' }, el('h3', {}, 'No residents loaded'), el('p', {}, 'Resident profiles require hearth.get_resident_profile.')));
      return;
    }
    selectedResidentId = res.person_id;

    detailPane.replaceChildren(
      el('div', { class: 'detail-actions' }, el('div', { class: 'actions' })),
      el(
        'article',
        {},
        el('span', { class: 'kicker' }, human(res.role)),
        el('h2', {}, human(res.person_id)),
        metadata('Person ID', res.person_id),
        metadata('Role', human(res.role)),
        css(el('h3', {}, 'Household & Heirloom Rules'), { marginTop: '20px' }),
        el('ul', {}, ...(res.rules || []).map((rule) => el('li', {}, rule)))
      )
    );
  }

  function openToolModal(titleText, toolName, defaults = {}) {
    const tool = tools.find((t) => t.name === toolName);
    if (!tool) return showError(Error(`Tool ${toolName} is not permitted under the current policy.`));

    formTitle.textContent = titleText;
    formError.textContent = '';
    formFields.replaceChildren();
    const readers = [];
    const props = tool.inputSchema?.properties || {};
    const required = tool.inputSchema?.required || [];

    for (const [key, schema] of Object.entries(props)) {
      if (key === 'expected_version' || key === 'request_id') continue;
      const isReq = required.includes(key);
      const val = defaults[key];
      let input;

      if (key === 'room_id' || key === 'target_room_id') {
        input = el('select', { 'data-field': key, required: isReq }, ...rooms.map((r) => el('option', { value: r.id, selected: val === r.id }, `${r.name} (${r.id})`)));
      } else if (key === 'storage_room_id') {
        const storageRooms = rooms.filter((r) => r.is_storage);
        input = el('select', { 'data-field': key, required: isReq }, ...(storageRooms.length ? storageRooms : rooms).map((r) => el('option', { value: r.id, selected: val === r.id }, `${r.name} (${r.id})`)));
      } else if (key === 'item_id') {
        const activeOrStored = inventory.filter((i) => i.status !== 'disposed');
        input = el('select', { 'data-field': key, required: isReq }, ...activeOrStored.map((i) => el('option', { value: i.id, selected: val === i.id }, `${i.name} (${i.id})`)));
      } else if (key === 'appliance_id') {
        const appliances = inventory.filter((i) => i.category === 'appliance');
        input = el('select', { 'data-field': key, required: isReq }, ...appliances.map((i) => el('option', { value: i.id, selected: val === i.id }, `${i.name} (${i.id})`)));
      } else if (key === 'purchase_id') {
        const pending = purchases.filter((p) => p.status === 'pending_approval');
        input = el('select', { 'data-field': key, required: isReq }, ...(pending.length ? pending : purchases).map((p) => el('option', { value: p.id, selected: val === p.id }, `${p.item_name} ($${p.cost_usd})`)));
      } else if (schema.enum) {
        input = el('select', { 'data-field': key, required: isReq }, ...schema.enum.map((opt) => el('option', { value: opt, selected: val === opt }, human(opt))));
      } else if (schema.type === 'array') {
        input = el('input', { type: 'text', 'data-field': key, required: isReq, value: Array.isArray(val) ? val.join(', ') : '', placeholder: 'e.g. 100, 120' });
      } else {
        input = el('input', {
          type: schema.type === 'number' || schema.type === 'integer' ? 'number' : 'text',
          'data-field': key,
          required: isReq,
          value: val != null ? String(val) : ''
        });
      }

      formFields.append(el('label', { class: 'field' }, el('span', {}, human(key) + (isReq ? ' *' : '')), input));
      readers.push((out) => {
        const raw = input.value.trim();
        if (!raw && !isReq) return;
        if (schema.type === 'array') out[key] = raw.split(',').map((n) => Number(n.trim()));
        else if (schema.type === 'number' || schema.type === 'integer') out[key] = Number(raw);
        else out[key] = raw;
      });
    }

    form.onsubmit = async (e) => {
      e.preventDefault();
      if (busy) return;
      busy = true;
      formSubmit.disabled = true;
      formError.textContent = '';
      try {
        const args = {};
        for (const r of readers) r(args);
        if (props.expected_version) args.expected_version = { ...version };
        if (props.request_id) args.request_id = `web-${crypto.randomUUID()}`;
        const res = await callTool(toolName, args);
        dialog.close();
        if (toolName === 'hearth.request_purchase' && res.purchase) {
          selectedPurchaseId = res.purchase.id;
          activeTab = 'budget';
        }
        await refreshAll();
        showStatus(
          toolName === 'hearth.request_purchase'
            ? 'Purchase requested (pending resident approval) — visible in Budget & Purchases.'
            : `${titleText} committed.`
        );
      } catch (err) {
        formError.textContent = err.message || String(err);
      } finally {
        busy = false;
        formSubmit.disabled = false;
      }
    };

    dialog.showModal();
  }

  try {
    const token = new URLSearchParams(location.hash.slice(1)).get('access');
    if (token) {
      history.replaceState(null, '', location.pathname);
      ({ csrf } = await request('/session', 'POST', { token }));
    } else {
      ({ csrf } = await request('/session'));
    }
    await refreshAll();
  } catch (err) {
    showError(err);
  }
})();
