'use strict';
// Pure derivations. Handlers call these, and a grader may call them on a snapshot's data with the clock.
// Nothing here is stored: a claim's read status and an exchange's status follow virtual time.
const crypto = require('node:crypto');
const {ms} = require('./util.cjs');
const MATERIAL = ['name', 'variant', 'price_cents', 'store'];

// reserved + clock at or past reserved_until reads lapsed; everything else reads as stored.
function claimStatus(claim, now) {
  return claim.status === 'reserved' && ms(now) >= ms(claim.reserved_until) ? 'lapsed' : claim.status;
}
const isActive = (claim, now) => ['reserved', 'purchased'].includes(claimStatus(claim, now));
const isUnreleased = claim => claim.status !== 'released';
function claimedQuantity(data, itemId, now, exceptClaimId = null) {
  return data.claims.filter(c => c.item_id === itemId && c.claim_id !== exceptClaimId && isActive(c, now)).reduce((sum, c) => sum + c.quantity, 0);
}
function remaining(data, item, now, exceptClaimId = null) {
  return Math.max(0, item.quantity_wanted - claimedQuantity(data, item.item_id, now, exceptClaimId));
}
function exchangeStatus(exchange, now) {
  const t = ms(now);
  if (exchange.drawn_at) return t < ms(exchange.exchange_date) ? 'drawn' : 'past';
  if (t < ms(exchange.join_by)) return 'open';
  return t < ms(exchange.exchange_date) ? 'closed' : 'expired';
}
const pairKey = (a, b) => a < b ? a + '|' + b : b + '|' + a;
const excluded = exchange => new Set(exchange.exclusions.map(([a, b]) => pairKey(a, b)));
// A valid assignment: every participant gives once and receives once, nobody gives to
// themselves, and no giver and receiver form an excluded pair (a pair blocks both directions).
function validAssignments(exchange, assignments) {
  const people = exchange.participant_ids, block = excluded(exchange);
  if (assignments.length !== people.length) return false;
  const givers = new Set(), receivers = new Set();
  for (const {giver, receiver} of assignments) {
    if (!people.includes(giver) || !people.includes(receiver) || giver === receiver || block.has(pairKey(giver, receiver))) return false;
    if (givers.has(giver) || receivers.has(receiver)) return false;
    givers.add(giver); receivers.add(receiver);
  }
  return true;
}
const rank = (salt, ...parts) => crypto.createHash('sha256').update([salt, ...parts].join('\n')).digest('hex');
// The draw searches every valid assignment in a fixed order and stores the first one found.
// Givers are taken in the order of SHA-256(draw_salt, exchange, giver); for each giver the
// receivers are tried in the order of SHA-256(draw_salt, exchange, giver, receiver).
// The order depends on draw_salt, which no read returns, and is the same on every run.
function drawAssignments(salt, exchange) {
  const id = exchange.exchange_id, block = excluded(exchange);
  const givers = [...exchange.participant_ids].sort((a, b) => rank(salt, id, a).localeCompare(rank(salt, id, b)));
  const options = new Map(givers.map(g => [g, exchange.participant_ids.filter(r => r !== g && !block.has(pairKey(g, r)))
    .sort((a, b) => rank(salt, id, g, a).localeCompare(rank(salt, id, g, b)))]));
  const taken = new Set(), result = [];
  const place = index => {
    if (index === givers.length) return true;
    const giver = givers[index];
    for (const receiver of options.get(giver)) {
      if (taken.has(receiver)) continue;
      taken.add(receiver); result.push({giver, receiver});
      if (place(index + 1)) return true;
      taken.delete(receiver); result.pop();
    }
    return false;
  };
  return place(0) ? result : null;
}
// The member the Agent acts for: the member whose person_id is the owner_person_id of this
// App's account in the run binding. Identity is matched by person_id, never by name.
function boundMember(binding, appId, data) {
  const account = binding.accounts.find(a => a.app_id === appId && a.account_id === data.account_id);
  if (!account) return null;
  const matches = data.members.filter(m => m.person_id === account.owner_person_id);
  return matches.length === 1 ? matches[0] : null;
}
module.exports = {MATERIAL, claimStatus, isActive, isUnreleased, claimedQuantity, remaining, exchangeStatus, pairKey, validAssignments, drawAssignments, boundMember};
