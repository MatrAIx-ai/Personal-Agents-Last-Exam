(function(root, factory) {
  const view = factory();
  if (typeof module === 'object' && module.exports) module.exports = view;
  else { root.PaleAppViews = root.PaleAppViews || {}; root.PaleAppViews.forkyard = view; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));
  function render(records) {
    const items = Array.isArray(records) ? records : [];
    return '<section aria-label="forkyard records">' + items.map(item =>
      '<article data-record-id="' + escape(item.repo || item.account_id || item.release_id || item.comment_id) + '"><h3>' +
      escape(item.repo || item.handle || item.title || item.comment_id) + '</h3><pre>' + escape(JSON.stringify(item, null, 2)) + '</pre></article>'
    ).join('') + '</section>';
  }
  return {render};
});
