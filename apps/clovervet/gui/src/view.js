(function (root, factory) {
  const view = factory();
  if (typeof module === 'object' && module.exports) module.exports = view;
  else {
    root.PaleAppViews = root.PaleAppViews || {};
    root.PaleAppViews.clovervet = view;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const escape = (v) =>
    String(v ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[ch]));

  function render(items) {
    return (
      '<section aria-label="clovervet records">' +
      items
        .map(
          (item) =>
            '<article data-record-id="' +
            escape(item.id) +
            '"><h3>' +
            escape(item.name || item.medication_name || item.visit_type || item.id) +
            '</h3><pre>' +
            escape(JSON.stringify(item, null, 2)) +
            '</pre></article>'
        )
        .join('') +
      '</section>'
    );
  }

  return { render };
});
