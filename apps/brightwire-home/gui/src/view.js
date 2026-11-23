(function(root, factory) {
  const view = factory();
  if (typeof module === 'object' && module.exports) module.exports = view;
  else { root.PaleAppViews = root.PaleAppViews || {}; root.PaleAppViews['brightwire-home'] = view; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));
  function catalogOf(data, catalog) {
    if (catalog && catalog.assets) return catalog;
    if (data && data.catalog && data.catalog.assets) return data.catalog;
    return {assets: []};
  }
  function render(data, catalog) {
    const household = data && data.devices ? data : {devices: [], rooms: [], home_mode: ''};
    const assets = catalogOf(data, catalog).assets || [];
    const pictures = assets.map(asset => {
      const storage = asset.storage || {};
      const src = storage.path || asset.asset_id;
      return '<img alt="' + escape((asset.presentation && asset.presentation.alt_text) || asset.asset_id) + '" src="' + escape(src) + '" data-asset-id="' + escape(asset.asset_id) + '">';
    }).join('');
    const rooms = (household.rooms || []).map(room => '<li>' + escape(room.name) + '</li>').join('');
    const devices = (household.devices || []).map(device =>
      '<li data-device-id="' + escape(device.device_id) + '">' + escape(device.name) + ' (' + escape(device.type) + ')</li>').join('');
    return '<section aria-label="brightwire household"><p>Mode ' + escape(household.home_mode) + '</p><div>' + pictures + '</div><ul>' + rooms + '</ul><ul>' + devices + '</ul></section>';
  }
  return {render};
});
