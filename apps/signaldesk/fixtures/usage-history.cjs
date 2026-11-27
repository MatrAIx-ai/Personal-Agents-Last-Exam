// Generate synthetic historical usage for a fixture at its seed time.
// The initial task sees 2025 history. Later snapshots can cover 2025 and 2026.
const { initial_time: taskStart } = require('./clock.json');

function usageHistoryAt(seedTime = taskStart) {
  const cutoff = Date.parse(seedTime);
  if (!Number.isFinite(cutoff) || cutoff < Date.parse(taskStart)) {
    throw new RangeError('A fixture seed time must fall on or after the task start.');
  }

  const history = [];
  for (let month = 0; month < 24; month++) {
    for (let line = 1; line <= 3; line++) {
      const instant = Date.UTC(2025, month, 1 + (line - 1) * 10);
      if (instant >= cutoff) continue;
      const occurredAt = new Date(instant).toISOString();
      const lineId = 'line-0' + line;
      history.push({
        id: 'usage-' + occurredAt.slice(0, 10) + '-' + lineId,
        line_id: lineId,
        kind: 'domestic_data',
        amount_mb: 100 + (month % 6) * 25 + line * 10,
        occurred_at: occurredAt
      });
    }
  }
  return history;
}

module.exports = { usageHistoryAt };

// Print the usage records for the default fixture or a later snapshot.
// Example: node fixtures/usage-history.cjs 2026-12-31T00:00:00Z
if (require.main === module) {
  console.log(JSON.stringify(usageHistoryAt(process.argv[2]), null, 2));
}
