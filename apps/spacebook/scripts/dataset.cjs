"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."),
  d = require("../src/domain.cjs"),
  model = require("../src/model.cjs"),
  { compile } = require("../tests/schema-validator.cjs");
const valid = compile(
    require("../schemas/seed.schema.json"),
    path.join(root, "schemas"),
  ),
  check = process.argv.includes("--check");
const baseline = require("../fixtures/minimal.json"),
  binding = require("../fixtures/binding.json");
let eventSeq = 0;
const ctx = {
  binding,
  virtual_now: "2025-01-01T16:00:00Z",
  app_id: "spacebook",
};
function localInstant(date, hour) {
  const target = Date.parse(
    date + "T" + String(hour).padStart(2, "0") + ":00:00Z",
  );
  let candidate = target;
  for (let i = 0; i < 4; i++) {
    const parts = d.localParts
      ? d.localParts(candidate, "America/Los_Angeles")
      : Object.fromEntries(
          new Intl.DateTimeFormat("en-CA", {
            timeZone: "America/Los_Angeles",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
          })
            .formatToParts(new Date(candidate))
            .map((p) => [p.type, p.value]),
        );
    candidate +=
      target -
      Date.parse(
        `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00Z`,
      );
  }
  return new Date(candidate).toISOString();
}
function at(iso, minutes) {
  return new Date(Date.parse(iso) + minutes * 60000).toISOString();
}
function event(data, when, operation, payload) {
  ctx.virtual_now = when;
  return d.applyEvent(ctx, data, {
    event_id: "generated-" + ++eventSeq,
    at: when,
    operation: "spacebook." + operation,
    payload,
  });
}
function act(data, when, who, action, args) {
  event(data, when, "actor_action", { actor_person_id: who, action, args });
  return data;
}
function cycle(data, date, index, month, hour = 10) {
  const start = localInstant(date, hour),
    now = at(start, -30),
    who = ["person-maya", "person-alex", "person-sam"][(index + month) % 3],
    room = ["room-cedar", "room-maple", "room-willow", "room-oak"][
      (index + month) % 4
    ];
  const args = {
    room_id: room,
    equipment_ids: index % 3 === 0 ? ["equipment-" + ((index % 4) + 1)] : [],
    title: [
      "Team planning",
      "Design review",
      "Customer briefing",
      "Project workshop",
      "Quiet collaboration",
    ][(index + month) % 5],
    start_at: start,
    end_at: at(start, [30, 45, 60, 90][(index + month) % 4]),
  };
  act(data, now, who, "holds.create", args);
  const h = data.holds.at(-1);
  const mode = (index + month * 2) % 11;
  if (mode === 0) {
    event(data, at(now, 5), "expire_holds", {});
    return;
  }
  if (mode === 1) {
    act(data, at(now, 1), who, "holds.release", { id: h.id });
    return;
  }
  act(data, at(now, 1), who, "holds.confirm", { id: h.id });
  const b = data.bookings.at(-1);
  if (mode === 2 || mode === 3) {
    act(data, at(now, 3), who, "bookings.cancel", { id: b.id });
  } else if (mode === 4) {
    event(data, at(now, 3), "resource_block", {
      block_id: "block-gen-" + eventSeq,
      resource_id: room,
      start_at: start,
      end_at: args.end_at,
      reason: [
        "Display maintenance",
        "Room inspection",
        "Audio equipment repair",
      ][month % 3],
    });
    act(data, at(now, 4), who, "bookings.replace", {
      ...args,
      id: b.id,
      room_id: room === "room-willow" ? "room-cedar" : "room-willow",
    });
  } else if (mode === 5) {
    act(data, at(now, 3), who, "bookings.replace", {
      ...args,
      id: b.id,
      title: args.title + " — revised",
      room_id: room === "room-willow" ? "room-cedar" : "room-willow",
    });
  }
}
function validate(data, now) {
  ctx.virtual_now = now;
  assert.ok(valid(data), "Dataset schema");
  model.validateSeed(ctx, data);
}
function save(file, value) {
  const filename = path.join(root, file),
    text = JSON.stringify(value, null, 2) + "\n";
  if (check)
    assert.equal(
      fs.readFileSync(filename, "utf8"),
      text,
      "Generated drift: " + file,
    );
  else {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, text);
  }
  return crypto.createHash("sha256").update(text).digest("hex");
}
const data = structuredClone(baseline),
  monthlyTargets = {};
for (let month = 0; month < 24; month++) {
  const year = 2025 + Math.floor(month / 12),
    m = (month % 12) + 1,
    dates = [];
  for (let day = 1; day <= new Date(Date.UTC(year, m, 0)).getUTCDate(); day++) {
    const dt = new Date(Date.UTC(year, m - 1, day));
    if (dt.getUTCDay() > 0 && dt.getUTCDay() < 6)
      dates.push(dt.toISOString().slice(0, 10));
  }
  const count = 16 + ((month * 7) % 9);
  monthlyTargets[`${year}-${String(m).padStart(2, "0")}`] = count;
  for (let i = 0; i < count; i++) {
    // Sort meetings chronologically, with a second daily slot only when needed.
    const dayIndex = Math.floor((i * dates.length) / count),
      samePrevious =
        i > 0 && Math.floor(((i - 1) * dates.length) / count) === dayIndex;
    cycle(data, dates[dayIndex], i, month, samePrevious ? 14 : 10);
  }
}
validate(data, "2027-01-01T08:00:00Z");
const hash = save("datasets/evaluation.json", data);
const sourceRows = [...data.holds, ...data.bookings]
  .flatMap((r) =>
    r.history.map((h, i) => ({ source: r.id, entry: i, at: h.at })),
  )
  .concat(
    data.blocks.map((b) => ({ source: b.id, at: b.created_at })),
    data.notifications.map((n) => ({ source: n.id, at: n.at })),
  );
const dateOf = (at) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(new Date(at))
      .map((p) => [p.type, p.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
};
const dates = [...new Set(sourceRows.map((r) => dateOf(r.at)))].sort(),
  months = Object.keys(monthlyTargets).map((month) => ({
    month,
    planned_lifecycles: monthlyTargets[month],
    holds: data.holds.filter((h) => dateOf(h.created_at).startsWith(month))
      .length,
    bookings: data.bookings.filter((b) =>
      dateOf(b.created_at).startsWith(month),
    ).length,
    activity_entries: sourceRows.filter((r) => dateOf(r.at).startsWith(month))
      .length,
    distinct_activity_dates: dates.filter((d) => d.startsWith(month)).length,
    synthetic: true,
  }));
const report = {
  schema: "spacebook.coverage.v1",
  timezone: "America/Los_Angeles",
  window: ["2025-01-01", "2026-12-31"],
  dataset_sha256: hash,
  generator_sha256: crypto
    .createHash("sha256")
    .update(fs.readFileSync(__filename))
    .digest("hex"),
  generation:
    "Deterministic calendar/roster variation, generator v1; no random or observed customer data.",
  date_fields: [
    "holds.history[].at",
    "bookings.history[].at",
    "blocks.created_at",
    "notifications.at",
  ],
  total_records: model.records(data).length,
  activity_entries: sourceRows.length,
  global_distinct_activity_dates: dates.length,
  earliest: dates[0],
  latest: dates.at(-1),
  months,
  dates,
  scheduled_dates: [
    ...new Set(data.bookings.map((b) => dateOf(b.start_at))),
  ].sort(),
  invalid_dates: [],
  out_of_window: sourceRows.filter(
    (r) => dateOf(r.at) < "2025-01-01" || dateOf(r.at) > "2026-12-31",
  ),
  missing_months: months.filter((m) => !m.activity_entries).map((m) => m.month),
  provenance: {
    real_records: 0,
    synthetic_records: model.records(data).length,
    reference_only: [
      "https://envoy.help/en/articles/3673273-about-envoy-rooms",
      "https://envoy.help/en/articles/6812624-booking-checking-into-and-releasing-rooms-for-employees",
    ],
  },
  gaps: "Weekends and unbooked workdays intentionally have no activity; all 24 months contain distinct meaningful lifecycles.",
};
assert.equal(report.out_of_window.length, 0);
assert.equal(report.missing_months.length, 0);
save("datasets/coverage.json", report);
// Small, independently loadable scenario fixtures. Each has historical activity plus a different live boundary.
const fixtureNames = [
  "ordinary",
  "active-hold",
  "expired-hold",
  "cancelled",
  "disrupted",
  "replaced",
  "other-owner",
  "maintenance",
];
for (let n = 0; n < fixtureNames.length; n++) {
  const seed = structuredClone(baseline);
  for (let i = 0; i < 4; i++)
    cycle(seed, `2026-11-${String(2 + i).padStart(2, "0")}`, i, n);
  const now = "2026-12-08T17:00:00Z",
    args = {
      room_id: "room-cedar",
      equipment_ids: ["equipment-1"],
      title: "December planning",
      start_at: "2026-12-08T22:00:00Z",
      end_at: "2026-12-08T23:00:00Z",
    };
  ctx.virtual_now = now;
  if (n > 0 && n < 7) {
    const owner = n === 6 ? "person-alex" : "person-maya";
    act(
      seed,
      n === 2 ? "2026-12-08T16:50:00Z" : now,
      owner,
      "holds.create",
      args,
    );
    const h = seed.holds.at(-1);
    if (n >= 3) {
      act(seed, now, owner, "holds.confirm", { id: h.id });
      const b = seed.bookings.at(-1);
      if (n === 3) act(seed, now, owner, "bookings.cancel", { id: b.id });
      if (n === 4)
        event(seed, now, "resource_block", {
          block_id: "fixture-block",
          resource_id: "room-cedar",
          start_at: args.start_at,
          end_at: args.end_at,
          reason: "Scheduled maintenance",
        });
      if (n === 5)
        act(seed, now, owner, "bookings.replace", {
          ...args,
          id: b.id,
          room_id: "room-willow",
        });
    }
  }
  if (n === 7)
    event(seed, now, "resource_block", {
      block_id: "fixture-block",
      resource_id: "room-cedar",
      start_at: args.start_at,
      end_at: args.end_at,
      reason: "Scheduled maintenance",
    });
  validate(seed, now);
  save("fixtures/scenarios/" + fixtureNames[n] + ".json", seed);
}
console.log(
  JSON.stringify({
    checked: check,
    lifecycles: data.holds.length,
    bookings: data.bookings.length,
    months: months.length,
    distinct_dates: dates.length,
  }),
);
