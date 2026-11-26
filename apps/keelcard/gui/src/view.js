(function(root, factory) {
  const view = factory();
  if (typeof module === 'object' && module.exports) module.exports = view;
  else { root.PaleAppViews = root.PaleAppViews || {}; root.PaleAppViews.keelcard = view; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function publicFields(item) {
    const view = { ...item };
    delete view.number;
    delete view.security_code;
    return view;
  }
  function render(items) {
    return '<section aria-label="keelcard records">' + items.map(item => {
      const view = publicFields(item);
      const title = item.nickname || item.card_id || item.id || 'record';
      return '<article data-record-id="' + escape(item.card_id || item.id) + '"><h3>' + escape(title) +
        '</h3><pre>' + escape(JSON.stringify(view, null, 2)) + '</pre></article>';
    }).join('') + '</section>';
  }
  function renderCardList(cards) {
    return '<section aria-label="card list">' + cards.map(card => {
      const view = publicFields(card);
      return '<article data-card-id="' + escape(view.card_id) + '"><h3>' + escape(view.nickname || view.card_id) +
        '</h3><p>Last four ' + escape(view.last_four) + '. Status ' + escape(view.status) + '.</p></article>';
    }).join('') + '</section>';
  }
  function renderCardDetail(card) {
    const view = publicFields(card);
    const limits = view.limits || {};
    return '<section aria-label="card detail"><h3>' + escape(view.nickname || view.card_id) +
      '</h3><p>Last four ' + escape(view.last_four) + '. Status ' + escape(view.status) + '.</p><dl>' +
      '<dt>Per transaction</dt><dd>' + escape(limits.per_transaction) + '</dd>' +
      '<dt>Per day</dt><dd>' + escape(limits.per_day) + '</dd>' +
      '<dt>Per month</dt><dd>' + escape(limits.per_month) + '</dd>' +
      '<dt>Lifetime</dt><dd>' + escape(limits.lifetime) + '</dd></dl></section>';
  }
  function renderTransactions(rows) {
    return '<section aria-label="transactions"><table><thead><tr><th>When</th><th>Merchant</th><th>Amount</th><th>Status</th></tr></thead><tbody>' +
      rows.map(row => {
        const view = publicFields(row);
        return '<tr><td>' + escape(view.decided_at || view.at) + '</td><td>' + escape(view.merchant_name) +
          '</td><td>' + escape(view.amount_cents) + '</td><td>' + escape(view.status || view.decision) + '</td></tr>';
      }).join('') + '</tbody></table></section>';
  }
  return { render, renderCardList, renderCardDetail, renderTransactions };
});
