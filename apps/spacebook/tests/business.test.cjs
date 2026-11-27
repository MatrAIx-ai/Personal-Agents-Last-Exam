"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  { fixture } = require("./harness.cjs");
const bundle = {
  room_id: "room-cedar",
  equipment_ids: ["equipment-1"],
  title: "Planning",
  start_at: "2026-12-08T22:00:00Z",
  end_at: "2026-12-08T23:00:00Z",
};
const confirm = (f) =>
  f.call("holds.confirm", { id: f.call("holds.create", bundle).item.id }).item;
test("hold and confirm allocate the whole bundle; reads are pure", () => {
  const f = fixture();
  const h = f.call("holds.create", bundle).item;
  assert.equal(h.expires_at, "2026-12-08T17:05:00.000Z");
  const b = f.call("holds.confirm", { id: h.id }).item;
  assert.equal(b.status, "confirmed");
  assert.equal(
    f.call("resources.get", {
      id: "equipment-1",
      start_at: bundle.start_at,
      end_at: bundle.end_at,
    }).item.available,
    false,
  );
  assert.throws(() => f.call("holds.confirm", { id: h.id }));
});
test("conflicting bundle fails without partial allocation", () => {
  const f = fixture();
  confirm(f);
  const before = f.data;
  assert.throws(
    () => f.call("holds.create", { ...bundle, room_id: "room-willow" }),
    { code: "resource_unavailable" },
  );
  assert.deepEqual(f.data, before);
});
test("expired at equality without event; query does not mutate", () => {
  const f = fixture();
  const h = f.call("holds.create", bundle).item;
  f.ctx.virtual_now = h.expires_at;
  const before = f.data;
  assert.equal(f.call("context").holds[0].status, "expired");
  assert.equal(
    f.call("resources.get", {
      id: bundle.room_id,
      start_at: bundle.start_at,
      end_at: bundle.end_at,
    }).item.available,
    true,
  );
  assert.deepEqual(f.data, before);
  assert.throws(() => f.call("holds.confirm", { id: h.id }));
});
test("hold expires at start when less than five minutes remain", () => {
  const f = fixture();
  f.ctx.virtual_now = "2026-12-08T21:58:00Z";
  assert.equal(
    f.call("holds.create", bundle).item.expires_at,
    bundle.start_at.replace("Z", ".000Z"),
  );
});
test("incompatible equipment, duplicates, unknown IDs and closed hours rejected", () => {
  for (const patch of [
    { room_id: "room-birch" },
    { equipment_ids: ["equipment-1", "equipment-1"] },
    { room_id: "missing" },
    { start_at: "2026-12-08T15:00:00Z", end_at: "2026-12-08T16:00:00Z" },
  ]) {
    const f = fixture();
    assert.throws(() => f.call("holds.create", { ...bundle, ...patch }));
    assert.equal(f.data.holds.length, 0);
  }
});
test("adjacent intervals allowed", () => {
  const f = fixture();
  confirm(f);
  assert.equal(
    f.call("holds.create", {
      ...bundle,
      start_at: bundle.end_at,
      end_at: "2026-12-09T00:00:00Z",
    }).item.status,
    "active",
  );
});
test("failed replacement preserves confirmed booking; same resources may be reused", () => {
  const f = fixture(),
    b = confirm(f);
  f.call("holds.create", {
    ...bundle,
    room_id: "room-maple",
    equipment_ids: [],
  });
  const before = f.data;
  assert.throws(() =>
    f.call("bookings.replace", {
      ...bundle,
      id: b.id,
      room_id: "room-maple",
      equipment_ids: [],
    }),
  );
  assert.deepEqual(f.data, before);
  const next = f.call("bookings.replace", {
    ...bundle,
    id: b.id,
    title: "Updated",
  }).item;
  assert.equal(next.previous_id, b.id);
  assert.equal(
    f.call("bookings.get", { id: b.id }).item.replacement_id,
    next.id,
  );
});
test("outage releases whole bundle, replacement failure preserves disruption, unblock never resurrects", () => {
  const f = fixture(),
    b = confirm(f);
  f.event(require("../examples/scenario.json"));
  assert.equal(f.call("bookings.get", { id: b.id }).item.status, "disrupted");
  assert.equal(
    f.call("resources.get", {
      id: "equipment-1",
      start_at: bundle.start_at,
      end_at: bundle.end_at,
    }).item.available,
    true,
  );
  const before = f.data;
  assert.throws(() => f.call("bookings.replace", { ...bundle, id: b.id }));
  assert.deepEqual(f.data, before);
  f.event({
    event_id: "unblock",
    at: "2026-12-08T18:01:00Z",
    operation: "spacebook.resource_unblock",
    payload: { block_id: "block-1" },
  });
  assert.equal(f.call("bookings.get", { id: b.id }).item.status, "disrupted");
  const next = f.call("bookings.replace", {
    ...bundle,
    id: b.id,
    room_id: "room-willow",
  }).item;
  assert.equal(next.status, "confirmed");
  assert.equal(
    f.data.bookings.filter((b) => b.status === "confirmed").length,
    1,
  );
});
test("cancel and release are business-idempotent", () => {
  const f = fixture(),
    b = confirm(f);
  f.call("bookings.cancel", { id: b.id });
  const before = f.data;
  f.call("bookings.cancel", { id: b.id });
  assert.deepEqual(f.data, before);
  const h = f.call("holds.create", bundle).item;
  f.call("holds.release", { id: h.id });
  const released = f.data;
  f.call("holds.release", { id: h.id });
  assert.deepEqual(f.data, released);
});
test("other employee identity, title, IDs hidden; guessed booking cannot be read or cancelled", () => {
  const f = fixture();
  f.event({
    event_id: "other-hold",
    at: f.ctx.virtual_now,
    operation: "spacebook.actor_action",
    payload: {
      actor_person_id: "person-alex",
      action: "holds.create",
      args: { ...bundle, title: "Private secret" },
    },
  });
  const h = f.data.holds[0];
  f.event({
    event_id: "other-confirm",
    at: f.ctx.virtual_now,
    operation: "spacebook.actor_action",
    payload: {
      actor_person_id: "person-alex",
      action: "holds.confirm",
      args: { id: h.id },
    },
  });
  const b = f.data.bookings[0];
  assert.deepEqual(f.call("bookings.list").items, []);
  assert.throws(() => f.call("bookings.get", { id: b.id }), {
    code: "not_found",
  });
  assert.throws(() => f.call("bookings.cancel", { id: b.id }), {
    code: "not_found",
  });
  const out = JSON.stringify(
    f.call("resources.search", {
      start_at: bundle.start_at,
      end_at: bundle.end_at,
    }),
  );
  for (const secret of ["person-alex", "Private secret", b.id])
    assert.ok(!out.includes(secret));
});
test("in-progress outage rejected without state changes", () => {
  const f = fixture();
  confirm(f);
  const before = f.data;
  assert.throws(() =>
    f.event({
      event_id: "late",
      at: "2026-12-08T22:15:00Z",
      operation: "spacebook.resource_block",
      payload: {
        block_id: "late-block",
        resource_id: "room-cedar",
        start_at: "2026-12-08T22:15:00Z",
        end_at: "2026-12-08T23:00:00Z",
        reason: "Late outage",
      },
    }),
  );
  assert.deepEqual(f.data, before);
});
test("unknown capability never matches a required facility", () => {
  const f = fixture();
  const out = f.call("resources.search", {
    start_at: bundle.start_at,
    end_at: bundle.end_at,
    step_free: true,
    video: true,
  });
  assert.ok(
    !out.items.some((r) => r.id === "room-pine" || r.id === "room-oak"),
  );
});
module.exports = { bundle };
test("time zones and daylight saving use office-local hours", () => {
  for (const [start, end] of [
    ["2026-07-06T15:00:00Z", "2026-07-06T16:00:00Z"],
    ["2026-12-08T16:00:00Z", "2026-12-08T17:00:00Z"],
  ]) {
    const f = fixture();
    f.ctx.virtual_now = "2026-01-01T00:00:00Z";
    assert.equal(
      f.call("holds.create", { ...bundle, start_at: start, end_at: end }).item
        .status,
      "active",
    );
  }
  const f = fixture();
  assert.throws(() =>
    f.call("holds.create", {
      ...bundle,
      start_at: "2026-12-08T22:00:00",
      end_at: bundle.end_at,
    }),
  );
});
test("expiry event persists history once; invalidation blocks confirmation", () => {
  const f = fixture(),
    h = f.call("holds.create", bundle).item;
  f.event({
    event_id: "expires",
    operation: "spacebook.expire_holds",
    at: h.expires_at,
    payload: {},
  });
  const before = f.data;
  f.event({
    event_id: "expires-again",
    operation: "spacebook.expire_holds",
    at: h.expires_at,
    payload: {},
  });
  assert.deepEqual(f.data, before);
  const g = fixture(),
    other = g.call("holds.create", bundle).item;
  g.event({ ...require("../examples/scenario.json"), at: g.ctx.virtual_now });
  assert.equal(g.data.holds[0].status, "invalidated");
  assert.throws(() => g.call("holds.confirm", { id: other.id }));
});
test("notice recipient binding and explicit read flag", () => {
  const f = fixture();
  confirm(f);
  const n = f.call("notifications.list").items[0];
  assert.equal(n.read, false);
  f.call("notifications.read", { id: n.id });
  assert.equal(f.call("notifications.list").items[0].read, true);
});
test("malformed and conflicting historical seeds fail validation", () => {
  const f = fixture();
  confirm(f);
  const seed = f.data;
  const variants = [];
  const duplicate = structuredClone(seed);
  duplicate.bookings.push({ ...duplicate.bookings[0], id: "second-booking" });
  variants.push(duplicate);
  const owner = structuredClone(seed);
  owner.owner_person_id = "person-alex";
  variants.push(owner);
  const dangling = structuredClone(seed);
  dangling.bookings[0].room_id = "absent";
  variants.push(dangling);
  const chain = structuredClone(seed);
  chain.bookings[0].previous_id = chain.bookings[0].id;
  variants.push(chain);
  for (const data of variants) assert.throws(() => fixture(data));
});
test('replacement reports an owned conflicting hold and succeeds after explicit release',()=>{const f=fixture(),b=confirm(f),h=f.call('holds.create',{...bundle,room_id:'room-willow',equipment_ids:[]}).item;assert.throws(()=>f.call('bookings.replace',{...bundle,id:b.id,room_id:'room-willow',equipment_ids:[]}),e=>e.code==='resource_unavailable'&&e.message.includes(h.id));f.call('holds.release',{id:h.id});assert.equal(f.call('bookings.replace',{...bundle,id:b.id,room_id:'room-willow',equipment_ids:[]}).item.status,'confirmed');});
