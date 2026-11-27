"use strict";
const copy = (x) => structuredClone(x);
function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}
function instant(value) {
  if (
    typeof value !== "string" ||
    !/(Z|[+-]\d\d:\d\d)$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    fail("invalid_time", "Use an offset-qualified timestamp.");
  return Date.parse(value);
}
const iso = (value) => new Date(instant(value)).toISOString();
const overlaps = (a, b) =>
  instant(a.start_at) < instant(b.end_at) &&
  instant(b.start_at) < instant(a.end_at);
const ids = (x) => [x.room_id, ...x.equipment_ids];
function find(rows, id) {
  const row = rows.find((r) => r.id === id);
  if (!row) fail("not_found", "Record not available.");
  return row;
}
function own(rows, id, actor) {
  const row = find(rows, id);
  if (row.owner_person_id !== actor) fail("not_found", "Record not available.");
  return row;
}
function actor(ctx, data) {
  const a = ctx.binding.accounts.find(
    (a) => a.app_id === "spacebook" && a.account_id === data.account_id,
  );
  if (!a || a.owner_person_id !== data.owner_person_id)
    fail("invalid_seed", "Account must match trusted binding.");
  return a.owner_person_id;
}
function localParts(at, zone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(new Date(instant(at)));
  return Object.fromEntries(parts.map((x) => [x.type, x.value]));
}
function interval(data, args, now, future = true) {
  const start = instant(args.start_at),
    end = instant(args.end_at);
  if (
    end - start < 15 * 60000 ||
    end - start > 240 * 60000 ||
    (future && start <= instant(now))
  )
    fail("invalid_time", "Use a future interval lasting 15–240 minutes.");
  const a = localParts(args.start_at, data.office.timezone),
    b = localParts(args.end_at, data.office.timezone),
    minutes = (p) =>
      Number(p.hour) * 60 + Number(p.minute) + Number(p.second) / 60;
  if (
    ["year", "month", "day"].some((k) => a[k] !== b[k]) ||
    !data.office.weekdays.includes(
      ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(a.weekday),
    ) ||
    minutes(a) < data.office.open_minute ||
    minutes(b) > data.office.close_minute
  )
    fail(
      "outside_hours",
      `The requested interval is ${a.year}-${a.month}-${a.day} ${a.hour}:${a.minute} to ${b.year}-${b.month}-${b.day} ${b.hour}:${b.minute} in ${data.office.timezone}. It must fit within opening minutes ${data.office.open_minute}–${data.office.close_minute} on open weekdays. Check the timestamp offsets against the intended local time.`,
    );
  return {
    start_at: new Date(start).toISOString(),
    end_at: new Date(end).toISOString(),
  };
}
function effectiveHold(row, now) {
  return row.status === "active" && instant(now) >= instant(row.expires_at)
    ? "expired"
    : row.status;
}
function allocations(data, now, exclude) {
  return [
    ...data.holds.filter((h) => effectiveHold(h, now) === "active"),
    ...data.bookings.filter((b) => b.status === "confirmed"),
  ].filter((r) => r.id !== exclude);
}
function available(data, resource, span, now, exclude) {
  return (
    !data.blocks.some(
      (b) => b.active && b.resource_id === resource && overlaps(b, span),
    ) &&
    !allocations(data, now, exclude).some(
      (r) => ids(r).includes(resource) && overlaps(r, span),
    )
  );
}
function validateBundle(data, args, now, exclude, who) {
  const span = interval(data, args, now);
  const room = find(data.resources, args.room_id);
  if (room.kind !== "room") fail("invalid_bundle", "Choose a room.");
  if (
    !Array.isArray(args.equipment_ids) ||
    args.equipment_ids.length > 2 ||
    new Set(args.equipment_ids).size !== args.equipment_ids.length
  )
    fail("invalid_bundle", "Choose up to two distinct equipment units.");
  for (const id of args.equipment_ids) {
    const unit = find(data.resources, id);
    if (unit.kind !== "equipment" || !unit.compatible_rooms.includes(room.id))
      fail(
        "incompatible_equipment",
        "Equipment is not compatible with this room.",
      );
  }
  if (
    typeof args.title !== "string" ||
    !args.title.trim() ||
    args.title.length > 200
  )
    fail("invalid_arguments", "Supply a meeting title.");
  if (ids(args).some((id) => !available(data, id, span, now, exclude))) {
    const ownHolds = data.holds.filter(h => h.id !== exclude && h.owner_person_id === who && effectiveHold(h, now) === "active" && overlaps(h, span) && ids(h).some(id => ids(args).includes(id)));
    fail("resource_unavailable", ownHolds.length
      ? `Your active hold(s) ${ownHolds.map(h => h.id).join(", ")} overlap this bundle. Replacement allocates resources directly and does not consume a hold. Release your overlapping hold before retrying replacement; read the current version after releasing.`
      : "A selected resource is no longer available.");
  }
  return span;
}
function next(data, prefix) {
  const used = new Set(
    [
      ...data.holds,
      ...data.bookings,
      ...data.blocks,
      ...data.notifications,
    ].map((r) => r.id),
  );
  let n = 1;
  while (used.has(prefix + "-" + n)) n++;
  return prefix + "-" + n;
}
function stamp(row, now, action, reason = "") {
  if (instant(now) < instant(row.updated_at))
    fail("invalid_time", "Clock precedes record history.");
  row.updated_at = iso(now);
  row.history.push({ at: iso(now), action, reason });
}
function notice(data, row, now, type, reason = "") {
  data.notifications.push({
    id: next(data, "notice"),
    recipient_person_id: row.owner_person_id,
    object_id: row.id,
    type,
    reason,
    at: iso(now),
    read: false,
  });
}
function transition(data, row, now, status, reason = "") {
  if (row.status === status) return;
  stamp(row, now, status, reason);
  row.status = status;
  notice(data, row, now, status, reason);
}
function base(data, args, who, now, prefix, span) {
  return {
    id: next(data, prefix),
    owner_person_id: who,
    room_id: args.room_id,
    equipment_ids: copy(args.equipment_ids),
    ...span,
    title: args.title,
    created_at: iso(now),
    updated_at: iso(now),
    history: [],
  };
}
function viewBooking(row, now) {
  return { ...copy(row), past: instant(row.end_at) <= instant(now) };
}
function viewHold(row, now) {
  return { ...copy(row), status: effectiveHold(row, now) };
}
function action(data, who, now, name, args) {
  if (name === "holds.create") {
    const span = validateBundle(data, args, now, undefined, who),
      row = {
        ...base(data, args, who, now, "hold", span),
        status: "active",
        expires_at: new Date(
          Math.min(instant(now) + 300000, instant(span.start_at)),
        ).toISOString(),
      };
    stamp(row, now, "held");
    data.holds.push(row);
    return viewHold(row, now);
  }
  if (name === "holds.release") {
    const row = own(data.holds, args.id, who);
    if (row.status === "released") return viewHold(row, now);
    if (effectiveHold(row, now) !== "active")
      fail("invalid_state", "Only an active hold can be released.");
    transition(data, row, now, "released");
    return viewHold(row, now);
  }
  if (name === "holds.confirm") {
    const held = own(data.holds, args.id, who);
    if (effectiveHold(held, now) !== "active")
      fail("invalid_state", "Hold is no longer active.");
    const span = validateBundle(data, held, now, held.id, who);
    const row = {
      ...base(data, held, who, now, "booking", span),
      status: "confirmed",
      previous_id: null,
      replacement_id: null,
    };
    stamp(row, now, "confirmed");
    stamp(held, now, "consumed");
    held.status = "consumed";
    data.bookings.push(row);
    notice(data, row, now, "confirmed");
    return viewBooking(row, now);
  }
  if (name === "bookings.replace") {
    const old = own(data.bookings, args.id, who);
    if (
      !["confirmed", "disrupted"].includes(old.status) ||
      instant(old.start_at) <= instant(now)
    )
      fail(
        "invalid_state",
        "Only future confirmed or disrupted bookings can be replaced.",
      );
    const span = validateBundle(data, args, now, old.id, who);
    const row = {
      ...base(data, args, who, now, "booking", span),
      status: "confirmed",
      previous_id: old.id,
      replacement_id: null,
    };
    stamp(row, now, "confirmed");
    transition(data, old, now, "superseded");
    old.replacement_id = row.id;
    data.bookings.push(row);
    notice(data, row, now, "confirmed", "Replacement for " + old.id);
    return viewBooking(row, now);
  }
  if (name === "bookings.cancel") {
    const row = own(data.bookings, args.id, who);
    if (row.status === "cancelled") return viewBooking(row, now);
    if (
      !["confirmed", "disrupted"].includes(row.status) ||
      instant(row.start_at) <= instant(now)
    )
      fail(
        "invalid_state",
        "Only future confirmed or disrupted bookings can be cancelled.",
      );
    transition(data, row, now, "cancelled");
    return viewBooking(row, now);
  }
  fail("unknown_tool", "Unknown action.");
}
function resourceView(data, row, span, now) {
  const busy = [
    ...allocations(data, now)
      .filter((r) => ids(r).includes(row.id) && overlaps(r, span))
      .map((r) => ({
        start_at: r.start_at,
        end_at: r.end_at,
        kind: r.expires_at ? "hold" : "booking",
      })),
    ...data.blocks
      .filter((b) => b.active && b.resource_id === row.id && overlaps(b, span))
      .map((b) => ({
        start_at: b.start_at,
        end_at: b.end_at,
        kind: "maintenance",
      })),
  ];
  return { ...copy(row), busy, available: busy.length === 0 };
}
function handleTool(ctx, data, name, args) {
  const who = actor(ctx, data),
    now = ctx.virtual_now,
    suffix = name.replace(/^spacebook\./, "");
  let result;
  if (suffix === "context")
    result = {
      office: copy(data.office),
      virtual_now: now,
      owner_person_id: who,
      holds: data.holds
        .filter((h) => h.owner_person_id === who)
        .map((h) => viewHold(h, now)),
    };
  else if (suffix === "resources.search" || suffix === "resources.get") {
    const span = interval(data, args, now);
    if (suffix === "resources.get")
      result = {
        item: resourceView(data, find(data.resources, args.id), span, now),
      };
    else
      result = {
        filter_scope: "Filters match individual resources, not complete bundles. video=true on a room means built-in video only. A room excluded by video=true may still support video using compatible portable equipment. To inspect combinations, search rooms without the video filter and equipment without capacity/accessibility filters, then check compatible_rooms and availability. Unknown attributes do not satisfy a requirement.",
        items: data.resources
          .filter(
            (r) =>
              (args.min_capacity === undefined ||
                (r.capacity !== null && r.capacity >= args.min_capacity)) &&
              ["step_free", "video"].every(
                (k) => args[k] === undefined || r[k] === args[k],
              ),
          )
          .map((r) => resourceView(data, r, span, now)),
      };
  } else if (suffix === "bookings.list")
    result = {
      items: data.bookings
        .filter((b) => b.owner_person_id === who)
        .map((b) => viewBooking(b, now)),
    };
  else if (suffix === "bookings.get")
    result = { item: viewBooking(own(data.bookings, args.id, who), now) };
  else if (suffix === "notifications.list")
    result = {
      items: copy(
        data.notifications.filter((n) => n.recipient_person_id === who),
      ),
    };
  else if (suffix === "notifications.read") {
    const row = find(data.notifications, args.id);
    if (row.recipient_person_id !== who)
      fail("not_found", "Notice not available.");
    row.read = true;
    result = { item: copy(row) };
  } else result = { item: action(data, who, now, suffix, args) };
  return { data, result };
}
function applyEvent(ctx, data, event) {
  const now = event.at,
    p = event.payload;
  actor(ctx, data);
  if (event.operation === "spacebook.actor_action") {
    if (!ctx.binding.people.some((x) => x.person_id === p.actor_person_id))
      fail("invalid_event", "Unknown bound actor.");
    action(data, p.actor_person_id, now, p.action, p.args);
  } else if (event.operation === "spacebook.expire_holds") {
    for (const h of data.holds)
      if (h.status === "active" && effectiveHold(h, now) === "expired")
        transition(data, h, now, "expired");
  } else if (event.operation === "spacebook.resource_block") {
    find(data.resources, p.resource_id);
    if (data.blocks.some((b) => b.id === p.block_id))
      fail("invalid_event", "Block ID already used.");
    if (
      instant(p.start_at) < instant(now) ||
      instant(p.end_at) <= instant(p.start_at)
    )
      fail("invalid_time", "Maintenance must start at or after event time.");
    const affected = data.bookings.filter(
      (b) =>
        b.status === "confirmed" &&
        ids(b).includes(p.resource_id) &&
        overlaps(b, p),
    );
    if (
      affected.some(
        (b) =>
          instant(b.start_at) <= instant(now) &&
          instant(now) < instant(b.end_at),
      )
    )
      fail("invalid_state", "In-progress disruptions are outside this App.");
    data.blocks.push({
      id: p.block_id,
      resource_id: p.resource_id,
      start_at: iso(p.start_at),
      end_at: iso(p.end_at),
      reason: p.reason,
      active: true,
      created_at: iso(now),
      updated_at: iso(now),
    });
    for (const h of data.holds)
      if (
        effectiveHold(h, now) === "active" &&
        ids(h).includes(p.resource_id) &&
        overlaps(h, p)
      )
        transition(data, h, now, "invalidated", p.reason);
    for (const b of affected) transition(data, b, now, "disrupted", p.reason);
  } else if (event.operation === "spacebook.resource_unblock") {
    const block = find(data.blocks, p.block_id);
    if (block.active) {
      block.active = false;
      block.updated_at = iso(now);
    }
  } else fail("invalid_event", "Unsupported event.");
  return data;
}
module.exports = {
  copy,
  fail,
  instant,
  iso,
  overlaps,
  ids,
  find,
  actor,
  interval,
  effectiveHold,
  allocations,
  available,
  handleTool,
  applyEvent,
};
