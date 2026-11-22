'use strict';
// Commits time effects that fell due before the current write or event.
// Reads never call this on stored data; they compute the same view on a copy.
const R = require('./rules.cjs');
const {ms, at, addDays, iso} = require('./clock.cjs');
const {notify, money} = require('./notices.cjs');

function history(r, at_, action, extra = {}) {
  r.history.push({at: at_, action, ...extra});
  r.updated_at = at_;
}

function settle(ctx, data) {
  const now = ms(ctx.virtual_now);
  for (const h of data.holds) {
    if (h.status === 'active' && now >= ms(h.expires_at)) h.status = 'expired';
  }
  // Due transitions are stamped with their own deadline, in time order.
  const due = [];
  for (const r of data.reservations) {
    if (r.state === 'confirmed' && now >= R.releaseAt(data, r)) due.push({t: R.releaseAt(data, r), kind: 'no_show', r});
    const off = R.facility(data, r.facility_id).utc_offset;
    const checkout = at(r.departure, '12:00', off);
    if (r.state === 'checked_in' && now >= checkout) due.push({t: checkout, kind: 'completed', r});
  }
  for (const p of data.payments) {
    if (p.kind === 'refund' && p.status === 'pending' && now >= ms(p.posts_at)) due.push({t: ms(p.posts_at), kind: 'refund', p});
  }
  due.sort((a, b) => a.t - b.t || (a.r || a.p).id.localeCompare((b.r || b.p).id));
  for (const item of due) {
    const stamp = iso(item.t);
    if (item.kind === 'no_show') {
      item.r.state = 'no_show';
      history(item.r, stamp, 'no_show_released');
      notify(ctx, data, {kind: 'no_show', object_type: 'reservation', object_id: item.r.id,
        title: `No check-in: reservation ${item.r.id} was released`,
        fields: [['Reservation', item.r.id], ['Site', item.r.site_id], ['Arrival', item.r.arrival],
          ['Released at', stamp], ['Refund', money(0)]]});
    } else if (item.kind === 'completed') {
      item.r.state = 'completed';
      history(item.r, stamp, 'completed');
    } else {
      item.p.status = 'posted';
      const card = data.wallet.cards.find(c => c.id === item.p.card_id);
      notify(ctx, data, {kind: 'refund_posted', object_type: 'reservation', object_id: item.p.reservation_id,
        title: `Refund of ${money(item.p.amount_cents)} posted for ${item.p.reservation_id}`,
        fields: [['Reservation', item.p.reservation_id], ['Refund', money(item.p.amount_cents)],
          ['Card', card ? R.cardLabel(card) : item.p.card_id], ['Posted', stamp]]});
    }
  }
  return data;
}

module.exports = {settle, history, addDays};
