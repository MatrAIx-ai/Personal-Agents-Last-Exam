'use strict';
// Statuses that fall due with time. Infra moves the clock with env.advance_time, which runs no App code, so
// reads derive them on a copy, and every write or event stores them first. Alert, pass and eligibility status
// and the weekly cap window are computed on read from the virtual time and never stored.
function materialize(data, now) {
  const t = Date.parse(now);
  for (const n of data.notifications) if (n.status === 'held_quiet_hours' && n.release_at && t >= Date.parse(n.release_at)) n.status = 'pending_delivery';
  return data;
}
module.exports = {materialize};
