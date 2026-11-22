(function(root, factory) {
  const view = factory();
  if (typeof module === 'object' && module.exports) module.exports = view;
  else { root.PaleAppViews = root.PaleAppViews || {}; root.PaleAppViews.keelcard = view; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function render(items) {
    return '<section aria-label="keelcard records">' + items.map(item => {
      const view = { ...item };
      delete view.number;
      delete view.security_code;
      const title = item.nickname || item.card_id || item.id || 'record';
      return '<article data-record-id="' + escape(item.card_id || item.id) + '"><h3>' + escape(title) +
        '</h3><pre>' + escape(JSON.stringify(view, null, 2)) + '</pre></article>';
    }).join('') + '</section>';
  }
  return { render };
});
