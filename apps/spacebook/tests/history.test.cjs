"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  { selectHistory } = require("../scripts/select-history.cjs");
test("history selection excludes future outcomes and retains complete replacement chains", () => {
  const cutoff = "2026-01-01T08:00:00Z",
    data = selectHistory(require("../datasets/evaluation.json"), cutoff);
  assert.ok(data.bookings.length > 100);
  assert.ok(
    data.bookings.every(
      (b) =>
        Date.parse(b.updated_at) < Date.parse(cutoff) &&
        Date.parse(b.end_at) < Date.parse(cutoff),
    ),
  );
  assert.ok(
    data.notifications.every((n) => Date.parse(n.at) < Date.parse(cutoff)),
  );
  for (const b of data.bookings) {
    if (b.previous_id)
      assert.ok(data.bookings.some((p) => p.id === b.previous_id));
    if (b.replacement_id)
      assert.ok(data.bookings.some((p) => p.id === b.replacement_id));
  }
});
