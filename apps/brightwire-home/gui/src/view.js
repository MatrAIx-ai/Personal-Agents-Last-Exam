(function(root, factory) {
  const view = factory();
  if (typeof module === 'object' && module.exports) module.exports = view;
  else { root.PaleAppViews = root.PaleAppViews || {}; root.PaleAppViews['brightwire-home'] = view; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));
  function render(data) {
    const household = data && data.devices ? data : {devices: [], rooms: [], home_mode: ''};
    const rooms = (household.rooms || []).map(room => '<li>' + escape(room.name) + '</li>').join('');
    const devices = (household.devices || []).map(device =>
      '<li data-device-id="' + escape(device.device_id) + '">' + escape(device.name) + ' (' + escape(device.type) + ')</li>').join('');
    return '<section aria-label="brightwire household"><p>Mode ' + escape(household.home_mode) + '</p><ul>' + rooms + '</ul><ul>' + devices + '</ul></section>';
  }
  return {render};
});
