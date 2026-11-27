"use strict";
// Task-specific outcome checks, deliberately separate from business acceptance rules.
const assert = require("node:assert/strict"),
  { fixture } = require("./harness.cjs");
const args = {
  room_id: "room-cedar",
  equipment_ids: ["equipment-1"],
  title: "Planning",
  start_at: "2026-12-08T22:00:00Z",
  end_at: "2026-12-08T23:00:00Z",
};
function outcome(data) {
  const active = data.bookings.filter(
    (b) => b.owner_person_id === "person-maya" && b.status === "confirmed",
  );
  if (
    active.length !== 1 ||
    data.holds.some(
      (h) => h.owner_person_id === "person-maya" && h.status === "active",
    )
  )
    return false;
  const b = active[0],
    room = data.resources.find((r) => r.id === b.room_id);
  return (
    room.capacity >= 8 &&
    room.step_free === true &&
    (room.video === true ||
      b.equipment_ids.some(
        (id) => data.resources.find((r) => r.id === id)?.video === true,
      )) &&
    Date.parse(b.start_at) === Date.parse(args.start_at) &&
    Date.parse(b.end_at) === Date.parse(args.end_at)
  );
}
function book(f, bundle) {
  return f.call("holds.confirm", { id: f.call("holds.create", bundle).item.id })
    .item;
}
const f = fixture();
assert.equal(outcome(f.data), false, "No-op fails");
f.call("holds.create", args);
assert.equal(outcome(f.data), false, "Hold-only fails");
const wrong = fixture();
book(wrong, { ...args, room_id: "room-maple" });
assert.equal(
  outcome(wrong.data),
  false,
  "Insufficient capacity fails despite valid booking",
);
const correct = fixture();
book(correct, args);
assert.equal(outcome(correct.data), true, "Correct confirmed outcome passes");
book(correct, { ...args, room_id: "room-willow", equipment_ids: [] });
assert.equal(outcome(correct.data), false, "Duplicate reservation fails");
const cancelled = fixture();
const b = book(cancelled, args);
cancelled.call("bookings.cancel", { id: b.id });
assert.equal(outcome(cancelled.data), false, "Cancelled result fails");
const recovery = fixture();
const old = book(recovery, args);
recovery.event(require("../examples/scenario.json"));
assert.equal(outcome(recovery.data), false, "Disrupted outcome fails");
recovery.call("bookings.replace", {
  ...args,
  id: old.id,
  room_id: "room-willow",
});
assert.equal(outcome(recovery.data), true, "Valid outage recovery passes");
console.log("8 reference controls passed.");
module.exports = { outcome };
