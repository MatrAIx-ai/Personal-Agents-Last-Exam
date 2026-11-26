import { mount, el, human, tag, metadata } from '/shared/client.js';

export const config = {
  id: 'hearth',
  title: 'Hearth',
  description: 'Household spatial inventory, maintenance lifecycle, and purchase approvals.',
  symbol: '⌂',
  searchLabel: 'Search inventory',
  initialSection: 'active',
  list: 'hearth.list_inventory',
  collection: 'items',
  listArgs: {},
  heading: (item) => item.name,
  subtitle: (item) => `${human(item.category)} · ${item.room_id} · ${human(item.status)}`,
  labels: {
    item_id: 'Item ID',
    room_id: 'Target Room ID',
    storage_room_id: 'Storage Room ID',
    coordinates: '2D Coordinates [x, y]',
    reason: 'Disposal Reason',
    item_name: 'Item Name',
    target_room_id: 'Target Room ID',
    cost_usd: 'Cost (USD)',
    appliance_id: 'Appliance ID',
    description: 'Issue Description',
    severity: 'Severity'
  },
  actions: [
    {
      label: 'Request purchase',
      tool: 'hearth.request_purchase',
      primary: true
    },
    {
      label: 'Move item',
      tool: 'hearth.update_item_placement',
      selected: true,
      prefill: (item) => ({
        item_id: item.id,
        room_id: item.room_id,
        coordinates: item.coordinates || [50, 50]
      })
    },
    {
      label: 'Store item',
      tool: 'hearth.store_item',
      selected: true,
      prefill: (item) => ({
        item_id: item.id,
        storage_room_id: 'room_basement_storage'
      })
    },
    {
      label: 'Dispose item',
      tool: 'hearth.dispose_item',
      selected: true,
      prefill: (item) => ({ item_id: item.id })
    },
    {
      label: 'Report issue',
      tool: 'hearth.report_maintenance_issue',
      selected: true,
      when: (item) => item.category === 'appliance',
      prefill: (item) => ({ appliance_id: item.id, severity: 'minor' })
    }
  ],
  sections: () => [
    { id: 'active', label: 'Active', symbol: '●', filter: (i) => i.status === 'active' },
    { id: 'stored', label: 'Stored', symbol: '□', filter: (i) => i.status === 'stored' },
    { id: 'disposed', label: 'Disposed', symbol: '×', filter: (i) => i.status === 'disposed' },
    { id: 'appliances', label: 'Appliances', symbol: '⚙', filter: (i) => i.category === 'appliance' },
    { id: 'all', label: 'All items', symbol: '≡', filter: () => true }
  ],
  row: (item, ui) =>
    ui.record(
      item,
      el('span', { class: 'record-title' }, item.name),
      el(
        'span',
        { class: 'record-subtitle' },
        `${item.room_id} · ${human(item.category)}${item.is_heirloom ? ' · Heirloom' : ''}`
      )
    ),
  view: (item) => {
    const dims = Array.isArray(item.dimensions_cm)
      ? `${item.dimensions_cm.join(' × ')} cm`
      : '—';
    const coords = Array.isArray(item.coordinates)
      ? `[${item.coordinates.join(', ')}]`
      : 'Not placed';
    return el(
      'article',
      { class: 'hearth-reader' },
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
      metadata('Room', item.room_id),
      metadata('Coordinates', coords),
      metadata('Dimensions', dims),
      item.warranty_expires_at ? metadata('Warranty expires', item.warranty_expires_at) : null,
      item.disposal_reason ? metadata('Disposal reason', item.disposal_reason) : null,
      metadata('Created at', item.created_at || '—')
    );
  }
};

mount(config);
