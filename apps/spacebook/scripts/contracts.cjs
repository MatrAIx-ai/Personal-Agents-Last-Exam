"use strict";
// App-owned schemas; shared envelope schemas retain their public PALE provenance.
const fs = require("node:fs"),
  path = require("node:path");
const root = path.resolve(__dirname, ".."),
  check = process.argv.includes("--check");
const obj = (properties, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const str = (max = 200) => ({ type: "string", minLength: 1, maxLength: max });
const id = { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$" },
  date = { type: "string", format: "date-time", description: "Offset-qualified instant. Use local wall time with its UTC offset OR converted UTC with Z, never both conversions. For example 14:00-08:00 equals 22:00Z, not 22:00-08:00." },
  bool = { type: "boolean" },
  integer = (min, max) => ({ type: "integer", minimum: min, maximum: max });
const arr = (items, max = 10000) => ({ type: "array", items, maxItems: max });
const nullable = (s) => ({ anyOf: [s, { type: "null" }] });
const version = obj({
  epoch: integer(1, 100000000),
  revision: integer(0, 100000000),
});
const history = arr(
  obj({
    at: date,
    action: str(80),
    reason: { type: "string", maxLength: 1000 },
  }),
);
const fields = {
  id,
  owner_person_id: id,
  room_id: id,
  equipment_ids: { ...arr(id, 2), uniqueItems: true },
  start_at: date,
  end_at: date,
  title: str(),
  created_at: date,
  updated_at: date,
  history,
};
const hold = obj({
  ...fields,
  status: {
    enum: ["active", "consumed", "released", "expired", "invalidated"],
  },
  expires_at: date,
});
const booking = obj({
  ...fields,
  status: { enum: ["confirmed", "superseded", "cancelled", "disrupted"] },
  previous_id: nullable(id),
  replacement_id: nullable(id),
});
const block = obj({
  id,
  resource_id: id,
  start_at: date,
  end_at: date,
  reason: str(1000),
  active: bool,
  created_at: date,
  updated_at: date,
});
const resource = obj({
  id,
  kind: { enum: ["room", "equipment"] },
  name: str(),
  capacity: nullable(integer(1, 1000)),
  step_free: nullable(bool),
  video: nullable(bool),
  compatible_rooms: { ...arr(id, 100), uniqueItems: true },
});
const notice = obj({
  id,
  recipient_person_id: id,
  object_id: id,
  type: str(80),
  reason: { type: "string", maxLength: 1000 },
  at: date,
  read: bool,
});
const office = obj({
  name: str(),
  timezone: str(),
  open_minute: integer(0, 1439),
  close_minute: integer(1, 1440),
  weekdays: { ...arr(integer(0, 6), 7), uniqueItems: true },
});
const seed = obj({
  account_id: id,
  owner_person_id: id,
  office,
  resources: arr(resource, 100),
  holds: arr(hold),
  bookings: arr(booking),
  blocks: arr(block),
  notifications: arr(notice, 50000),
});
const bundle = {
  room_id: id,
  equipment_ids: { ...arr(id, 2), uniqueItems: true },
  start_at: date,
  end_at: date,
  title: str(),
};
const interval = { start_at: date, end_at: date };
const busy = obj({
  ...interval,
  kind: { enum: ["hold", "booking", "maintenance"] },
});
const resourceView = obj({
  ...resource.properties,
  busy: arr(busy),
  available: bool,
});
const holdView = obj({
  ...hold.properties,
  status: {
    enum: ["active", "consumed", "released", "expired", "invalidated"],
  },
});
const bookingView = obj({ ...booking.properties, past: bool });
const defs = [
  [
    "context",
    true,
    {},
    [],
    { office, virtual_now: date, owner_person_id: id, holds: arr(holdView) },
    "Read office rules, the authoritative virtual clock and your holds. No clock advancement.",
  ],
  [
    "resources.search",
    true,
    {
      ...interval,
      min_capacity: {...integer(1, 1000), description: "Room capacity filter. Equipment has no capacity and is excluded when this filter is supplied."},
      step_free: {...bool, description: "Filter the resource's known step-free access. Equipment has no accessibility value."},
      video: {...bool, description: "For rooms this means BUILT-IN video only, not video supplied by portable equipment. To find a room plus camera combination, omit this filter for rooms and inspect equipment compatibility separately."},
    },
    ["start_at", "end_at"],
    { items: arr(resourceView), filter_scope: str(1000) },
    "Search rooms and equipment with anonymous busy intervals. Filters apply to individual resources, not bundles: video=true requires built-in video on rooms and does not find room-plus-camera combinations. Omit filters to inspect all rooms and compatible portable equipment. Unknown facilities never match a requirement. Search does not reserve resources.",
  ],
  [
    "resources.get",
    true,
    { id, ...interval },
    ["id", "start_at", "end_at"],
    { item: resourceView },
    "Inspect one resource and its current availability, without exposing other employees or booking identifiers.",
  ],
  [
    "bookings.list",
    true,
    {},
    [],
    { items: arr(bookingView) },
    "Read your bookings including history, disruptions and replacement links.",
  ],
  [
    "bookings.get",
    true,
    { id },
    ["id"],
    { item: bookingView },
    "Read the current booking state. A prior confirmation receipt is historical, not current availability.",
  ],
  [
    "holds.create",
    false,
    bundle,
    Object.keys(bundle),
    { item: holdView },
    "Hold one room and zero to two compatible equipment units atomically for up to five virtual minutes.",
  ],
  [
    "holds.release",
    false,
    { id },
    ["id"],
    { item: holdView },
    "Release your hold and all its resources. Releasing an already released hold has no further business effect.",
  ],
  [
    "holds.confirm",
    false,
    { id },
    ["id"],
    { item: bookingView },
    "Confirm your unexpired hold into one booking. After a replay, read bookings.get for current status.",
  ],
  [
    "bookings.replace",
    false,
    { id, ...bundle },
    ["id", ...Object.keys(bundle)],
    { item: bookingView },
    "Atomically replace your future confirmed or disrupted booking by allocating the selected bundle directly. Do not create a separate hold first: this operation does not consume holds. Release any of your holds on the replacement resources before calling replace. Failure preserves the previous business state and allocation.",
  ],
  [
    "bookings.cancel",
    false,
    { id },
    ["id"],
    { item: bookingView },
    "Cancel your future confirmed or disrupted booking, releasing the whole bundle.",
  ],
  [
    "notifications.list",
    true,
    {},
    [],
    { items: arr(notice, 50000) },
    "Read your local notices; this is not mail delivery.",
  ],
  [
    "notifications.read",
    false,
    { id },
    ["id"],
    { item: notice },
    "Explicitly mark your local notice read.",
  ],
];
const tools = defs.map(
  ([suffix, read_only, props, required, out, description]) => ({
    name: "spacebook." + suffix,
    description,
    read_only,
    scope: "spacebook." + suffix,
    resource_target: "current account",
    inputSchema: obj(
      {
        ...props,
        ...(!read_only ? { expected_version: version, request_id: id } : {}),
      },
      [...required, ...(!read_only ? ["expected_version", "request_id"] : [])],
    ),
    outputSchema: obj({
      status: { const: read_only ? "ok" : "committed" },
      app_id: { const: "spacebook" },
      version,
      ...out,
    }),
  }),
);
const actionTypes = [
  "holds.create",
  "holds.release",
  "holds.confirm",
  "bookings.replace",
  "bookings.cancel",
];
const actorVariants = actionTypes.map((action) => {
  const d = defs.find((d) => d[0] === action);
  return obj({
    actor_person_id: id,
    action: { const: action },
    args: obj(d[2], d[3]),
  });
});
const payloads = {
  resource_block: obj({
    block_id: id,
    resource_id: id,
    ...interval,
    reason: str(1000),
  }),
  resource_unblock: obj({ block_id: id }),
  actor_action: { oneOf: actorVariants },
  expire_holds: obj({}),
};
const events = {
  oneOf: Object.entries(payloads).map(([suffix, payload]) =>
    obj({
      event_id: id,
      at: date,
      operation: { const: "spacebook." + suffix },
      payload,
    }),
  ),
};
function save(file, value) {
  const text = JSON.stringify(value, null, 2) + "\n",
    p = path.join(root, file);
  if (check) {
    if (fs.readFileSync(p, "utf8") !== text)
      throw Error("Stale generated file: " + file);
  } else fs.writeFileSync(p, text);
}
save("schemas/seed.schema.json", seed);
save("schemas/events.schema.json", events);
save("tools.json", tools);
const contribution = JSON.parse(
  fs.readFileSync(path.join(root, "contribution/contribution.json")),
);
contribution.interfaces[0].operations = tools.map((t) => ({
  name: t.name,
  effect: t.read_only ? "read" : "write",
  caller: "agent",
}));
save("contribution/contribution.json", contribution);
save("fixtures/policies.json", {
  scenario: {
    allow: tools.filter((t) => t.read_only).map((t) => t.name),
    constraints: {},
  },
  sandbox: { allow: tools.map((t) => t.name), constraints: {} },
});
