"use strict";
const d = require("./domain.cjs");
const records = (data) => [
  ...data.resources,
  ...data.holds,
  ...data.bookings,
  ...data.blocks,
  ...data.notifications,
];
function validateSeed(ctx, data) {
  d.actor(ctx, data);
  try {
    new Intl.DateTimeFormat("en", { timeZone: data.office.timezone });
  } catch {
    d.fail("invalid_seed", "Invalid office time zone.");
  }
  if (
    data.office.open_minute >= data.office.close_minute ||
    !data.office.weekdays.length
  )
    d.fail("invalid_seed", "Invalid office hours.");
  const all = records(data);
  if (new Set(all.map((r) => r.id)).size !== all.length)
    d.fail("invalid_seed", "Duplicate object IDs.");
  const people = new Set(ctx.binding.people.map((p) => p.person_id));
  for (const r of data.resources) {
    if (r.kind === "room" && (r.capacity === null || r.compatible_rooms.length))
      d.fail("invalid_seed", "Invalid room.");
    for (const id of r.compatible_rooms)
      if (d.find(data.resources, id).kind !== "room")
        d.fail("invalid_seed", "Invalid compatible room.");
  }
  for (const r of [...data.holds, ...data.bookings]) {
    if (!people.has(r.owner_person_id))
      d.fail("invalid_seed", "Unknown owner.");
    if (d.find(data.resources, r.room_id).kind !== "room")
      d.fail("invalid_seed", "Invalid room reference.");
    for (const id of r.equipment_ids) {
      const unit = d.find(data.resources, id);
      if (
        unit.kind !== "equipment" ||
        !unit.compatible_rooms.includes(r.room_id)
      )
        d.fail("invalid_seed", "Invalid equipment reference.");
    }
    d.interval(data, r, ctx.virtual_now, false);
    if (d.instant(r.created_at) > d.instant(r.updated_at))
      d.fail("invalid_seed", "Reversed record timeline.");
    let prior = d.instant(r.created_at);
    for (const h of r.history) {
      const at = d.instant(h.at);
      if (at < prior || at > d.instant(r.updated_at))
        d.fail("invalid_seed", "Invalid history.");
      prior = at;
    }
    if (!r.history.length || prior !== d.instant(r.updated_at))
      d.fail("invalid_seed", "History must include latest update.");
    if (
      r.expires_at &&
      (d.instant(r.expires_at) <= d.instant(r.created_at) ||
        d.instant(r.expires_at) >
          Math.min(d.instant(r.created_at) + 300000, d.instant(r.start_at)))
    )
      d.fail("invalid_seed", "Invalid hold expiry.");
  }
  for (const b of data.bookings) {
    if ((b.status === "superseded") !== Boolean(b.replacement_id))
      d.fail("invalid_seed", "Invalid replacement status.");
    if (b.previous_id) {
      const old = d.find(data.bookings, b.previous_id);
      if (
        old.replacement_id !== b.id ||
        old.owner_person_id !== b.owner_person_id ||
        d.instant(old.updated_at) > d.instant(b.created_at)
      )
        d.fail("invalid_seed", "Broken replacement chain.");
    }
    if (b.replacement_id) {
      const next = d.find(data.bookings, b.replacement_id);
      if (next.previous_id !== b.id)
        d.fail("invalid_seed", "Broken replacement link.");
    }
    const seen = new Set([b.id]);
    let cursor = b;
    while (cursor.previous_id) {
      if (seen.has(cursor.previous_id))
        d.fail("invalid_seed", "Cyclic replacement chain.");
      seen.add(cursor.previous_id);
      cursor = d.find(data.bookings, cursor.previous_id);
    }
  }
  for (const b of data.blocks) {
    d.find(data.resources, b.resource_id);
    if (
      d.instant(b.start_at) >= d.instant(b.end_at) ||
      d.instant(b.created_at) > d.instant(b.updated_at)
    )
      d.fail("invalid_seed", "Invalid maintenance interval.");
  }
  for (const n of data.notifications)
    if (
      !people.has(n.recipient_person_id) ||
      ![...data.holds, ...data.bookings].some(
        (r) =>
          r.id === n.object_id && r.owner_person_id === n.recipient_person_id,
      )
    )
      d.fail("invalid_seed", "Invalid notification reference.");
  const allocated = d.allocations(data, ctx.virtual_now);
  for (let i = 0; i < allocated.length; i++) {
    const a = allocated[i];
    for (const b of allocated.slice(i + 1))
      if (d.overlaps(a, b) && d.ids(a).some((id) => d.ids(b).includes(id)))
        d.fail("invalid_seed", "Overlapping active allocations.");
    if (
      data.blocks.some(
        (b) => b.active && d.ids(a).includes(b.resource_id) && d.overlaps(a, b),
      )
    )
      d.fail("invalid_seed", "Allocation overlaps maintenance.");
  }
}
module.exports = {
  validateSeed,
  records,
  objects: (data) => records(data).map((r) => r.id),
  references: () => [],
  assetReferences: () => [],
};
