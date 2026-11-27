(function (root, factory) {
  const view = factory();
  if (typeof module === 'object' && module.exports) module.exports = view;
  else {
    root.PaleAppViews = root.PaleAppViews || {};
    root.PaleAppViews['trailhead-rec'] = view;
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
      '<section aria-label="trailhead-rec records">' +
      items
        .map(
          (item) =>
            '<article data-record-id="' +
            escape(item.id) +
            '"><h3>' +
            escape(item.title || item.name || item.court_name || item.id) +
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
