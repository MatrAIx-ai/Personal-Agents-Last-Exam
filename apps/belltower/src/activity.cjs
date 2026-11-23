'use strict';
// The activity log: one row for every committed Agent write, every applied event and every
// effect of an event (a notification written, a notification superseded). Time-driven
// changes run no App code and write no row. Returns the row's sequence number.
function record(data, row) {
  const seq = (data.activity.length ? data.activity[data.activity.length - 1].seq : 0) + 1;
  const clean = { seq };
  for (const key of ['at', 'actor', 'action', 'object_id', 'request_id', 'event_id', 'details']) if (row[key] !== undefined) clean[key] = row[key];
  data.activity.push(clean);
  return seq;
}
module.exports = { record };
