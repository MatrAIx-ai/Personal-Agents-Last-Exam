/**
 * State helpers and pure time-derived projections.
 * Core rule: Reads must NEVER mutate business state.
 */

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Derives dynamic time-based properties for reads without modifying persistent state.
 */
function deriveStateForRead(state, virtualNowIso) {
  const virtualNow = virtualNowIso ? new Date(virtualNowIso).getTime() : Date.now();
  const projected = clone(state);

  // 1. Derive appliance warranty status
  for (const item of projected.inventory) {
    if (item.category === 'appliance' && item.warranty_expires_at) {
      const expTime = new Date(item.warranty_expires_at).getTime();
      item.warranty_status = virtualNow > expTime ? 'expired' : 'active';
    }
  }

  // 2. Derive purchase expiry without changing stored data
  for (const p of projected.purchases) {
    if (p.status === 'pending_approval' && p.expires_at) {
      const expTime = new Date(p.expires_at).getTime();
      if (virtualNow > expTime) {
        p.status = 'expired';
      }
    }
  }

  return projected;
}

/**
 * Commits time-based derivations (like expiry) during a write/event cycle.
 */
function commitDerivedState(state, virtualNowIso) {
  const virtualNow = virtualNowIso ? new Date(virtualNowIso).getTime() : Date.now();

  for (const p of state.purchases) {
    if (p.status === 'pending_approval' && p.expires_at) {
      const expTime = new Date(p.expires_at).getTime();
      if (virtualNow > expTime) {
        p.status = 'expired';
        // Release budget reservation
        state.budget.reserved = Math.max(0, state.budget.reserved - p.cost_usd);
      }
    }
  }
}

module.exports = {
  clone,
  deriveStateForRead,
  commitDerivedState,
};
