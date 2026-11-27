(function(root, factory) {
  const view = factory();
  if (typeof module === 'object' && module.exports) module.exports = view;
  else { root.PaleAppViews = root.PaleAppViews || {}; root.PaleAppViews.keelcard = view; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PUBLIC_KEYS = new Set([
    'event_id', 'operation', 'nickname', 'card_id', 'id', 'authorization_id', 'last_four', 'status', 'effective_status',
    'merchant_name', 'name', 'category', 'merchant_id', 'amount_cents', 'decision', 'decline_code',
    'type', 'currency', 'limits', 'per_transaction', 'per_day', 'per_month', 'lifetime',
    'merchant', 'payload', 'card'
  ]);
  function publicFields(value) {
    if (Array.isArray(value)) return value.map(publicFields);
    if (!value || typeof value !== 'object') return value;
    const view = {};
    for (const key of Object.keys(value)) {
      if (key === 'number' || key === 'security_code' || key === 'expiry') continue;
      if (!PUBLIC_KEYS.has(key)) continue;
      view[key] = publicFields(value[key]);
    }
    return view;
  }
  function cents(value) {
    if (value === null || value === undefined || value === '') return 'Unlimited';
    return escape(value) + ' cents';
  }
  function render(items) {
    return '<section aria-label="keelcard records">' + items.map(item => {
      const view = publicFields(item);
      const title = item.nickname || item.card_id || item.id || item.event_id || 'record';
      return '<article data-record-id="' + escape(item.card_id || item.id || item.event_id) + '"><h3>' + escape(title) +
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
      '<dt>Per transaction</dt><dd>' + cents(limits.per_transaction) + '</dd>' +
      '<dt>Per day</dt><dd>' + cents(limits.per_day) + '</dd>' +
      '<dt>Per month</dt><dd>' + cents(limits.per_month) + '</dd>' +
      '<dt>Lifetime</dt><dd>' + cents(limits.lifetime) + '</dd></dl></section>';
  }
  function renderTransactions(rows) {
    return '<section aria-label="transactions"><table><thead><tr><th>When</th><th>Merchant</th><th>Amount</th><th>Status</th></tr></thead><tbody>' +
      rows.map(row => {
        const view = publicFields(row);
        const shown = view.effective_status || view.status || view.decision;
        return '<tr><td>' + escape(row.decided_at || row.at) + '</td><td>' + escape(view.merchant_name) +
          '</td><td>' + cents(view.amount_cents) + '</td><td>' + escape(shown) + '</td></tr>';
      }).join('') + '</tbody></table></section>';
  }
  return { render, renderCardList, renderCardDetail, renderTransactions };
});
