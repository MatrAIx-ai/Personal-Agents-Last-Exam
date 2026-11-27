"use strict";
// Select completed lifecycles before a task's first session, without leaking future outcomes.
const fs = require("node:fs"),
  path = require("node:path"),
  { validateSeed } = require("../src/model.cjs");
function selectHistory(data, cutoff) {
  const time = Date.parse(cutoff);
  if (!Number.isFinite(time) || !/(Z|[+-]\d\d:\d\d)$/.test(cutoff))
    throw Error("Provide an offset-qualified first-session cutoff.");
  const seed = structuredClone(data);
  // Keep a replacement chain only when every member has finished changing before cutoff.
  const groups = new Map();
  for (const b of data.bookings) {
    let root = b;
    const seen = new Set();
    while (root.previous_id) {
      if (seen.has(root.id)) throw Error("Cycle");
      seen.add(root.id);
      root = data.bookings.find((x) => x.id === root.previous_id);
      if (!root) throw Error("Dangling replacement");
    }
    if (!groups.has(root.id)) groups.set(root.id, []);
    groups.get(root.id).push(b);
  }
  seed.bookings = [...groups.values()]
    .filter((group) =>
      group.every(
        (b) => Date.parse(b.updated_at) < time && Date.parse(b.end_at) < time,
      ),
    )
    .flat();
  seed.holds = data.holds.filter(
    (h) => Date.parse(h.updated_at) < time && Date.parse(h.end_at) < time,
  );
  seed.blocks = data.blocks.filter(
    (b) => Date.parse(b.updated_at) < time && Date.parse(b.end_at) < time,
  );
  const ids = new Set([...seed.holds, ...seed.bookings].map((r) => r.id));
  seed.notifications = data.notifications.filter(
    (n) => ids.has(n.object_id) && Date.parse(n.at) < time,
  );
  validateSeed(
    { binding: require("../fixtures/binding.json"), virtual_now: cutoff },
    seed,
  );
  return seed;
}
module.exports = { selectHistory };
if (require.main === module) {
  const [cutoff, output] = process.argv.slice(2);
  if (!cutoff || !output)
    throw Error("Usage: node scripts/select-history.cjs CUTOFF OUTPUT.json");
  const data = selectHistory(require("../datasets/evaluation.json"), cutoff);
  fs.writeFileSync(path.resolve(output), JSON.stringify(data, null, 2) + "\n");
  console.log(
    JSON.stringify({
      cutoff,
      bookings: data.bookings.length,
      holds: data.holds.length,
      excluded:
        "In-progress and future lifecycles are omitted, never rewritten as past outcomes.",
    }),
  );
}
