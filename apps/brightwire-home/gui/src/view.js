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
  function readyAsset(asset) {
    return Boolean(asset && asset.availability && asset.availability.status === 'ready' && asset.storage && asset.storage.path);
  }
  function picture(asset) {
    const alt = escape((asset.presentation && asset.presentation.alt_text) || asset.asset_id);
    const id = escape(asset.asset_id);
    if (!readyAsset(asset)) return '<span class="placeholder" data-asset-id="' + id + '" data-placeholder="missing">' + alt + '</span>';
    return '<img alt="' + alt + '" src="' + escape(asset.storage.path) + '" data-asset-id="' + id + '">';
  }
  function render(data, catalog) {
    const household = data && data.devices ? data : {devices: [], rooms: [], home_mode: ''};
    const assets = catalogOf(data, catalog).assets || [];
    const known = new Set(assets.map(asset => asset.asset_id));
    const pictures = assets.map(picture).join('');
    const seen = new Set();
    const absent = (household.devices || []).filter(device => {
      const id = device.snapshot_asset_id;
      if (!id || known.has(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    }).map(device => '<span class="placeholder" data-asset-id="' + escape(device.snapshot_asset_id) + '" data-placeholder="missing">' + escape(device.name) + '</span>').join('');
    const rooms = (household.rooms || []).map(room => '<li>' + escape(room.name) + '</li>').join('');
    const devices = (household.devices || []).map(device =>
      '<li data-device-id="' + escape(device.device_id) + '">' + escape(device.name) + ' (' + escape(device.type) + ')</li>').join('');
    return '<section aria-label="brightwire household"><p>Mode ' + escape(household.home_mode) + '</p><div>' + pictures + absent + '</div><ul>' + rooms + '</ul><ul>' + devices + '</ul></section>';
  }
  return {render};
});
