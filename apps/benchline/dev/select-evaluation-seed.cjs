'use strict';
// Writes a seed of the delivery dataset "as of" a time: it replays only the steps strictly before that time, so each record is in its state
// at that time and no later record is history. The allocation period that contains the time is the current one, and the seed keeps its
// notifications and activity rows. Then it scans every timestamp at any depth and refuses the seed when one is later than the time.
// A task loads the result with env.load_seed and the same time as virtual_now.
// Usage: node dev/select-evaluation-seed.cjs --as-of 2026-06-01T00:00:00-04:00 [--out FILE]. Without --out it prints a summary only.
// `--check` confirms that the seed at the clock is the delivered seed byte for byte and that later or outside times are refused.
const fs = require('node:fs');
const path = require('node:path');
const views = require('../src/views.cjs');
const {records} = require('../src/model.cjs');
const {build, CLOCK, START, MONTH_STARTS} = require('./generate-dataset.cjs');

const ms = Date.parse;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
// Due times of a schedule may be later than the seed's time: the end of the current period, the respond_by of a protocol version, the planned start
// and end of a job that has not started or not ended, or that was interrupted or cancelled (world data that no read shows), and the planned release of a
// job.ended notice that is not yet released or that was removed.
function allowed(seed, where, asOf) {
  if (where === 'allocation.ends_at' || /^protocols\[\d+\]\.respond_by$/.test(where)) return true;
  const run = /^jobs\[(\d+)\]\.run\.(starts_at|ends_at)$/.exec(where);
  // A job that was interrupted or cancelled keeps its planned run as world data: its planned start and end never happened, and no read shows them.
  if (run) return ['queued', 'running', 'interrupted', 'cancelled'].includes(views.jobState(seed.jobs[Number(run[1])], ms(asOf)));
  const notice = /^notifications\[(\d+)\]\.(at|email\.time)$/.exec(where);
  // A job.ended notice is released at the end of its job: not yet, or never when a cancellation, a hold or an interruption removed it.
  if (notice) return seed.notifications[Number(notice[1])].kind === 'job.ended';
  return false;
}
// Every timestamp anywhere in the seed that is after `asOf` and is not an allowed due time, with its path.
function later(seed, asOf, value = seed, where = '', out = []) {
  if (typeof value === 'string') {
    if (STAMP.test(value) && ms(value) > ms(asOf) && !allowed(seed, where, asOf)) out.push({path: where, value});
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) later(seed, asOf, item, Array.isArray(value) ? where + '[' + key + ']' : where ? where + '.' + key : key, out);
  }
  return out;
}
function select(asOf) {
  if (typeof asOf !== 'string' || !STAMP.test(asOf) || !Number.isFinite(ms(asOf))) throw new Error('--as-of needs a time with a UTC offset, such as 2026-06-01T00:00:00-04:00.');
  if (ms(asOf) < ms(START) || ms(asOf) > ms(CLOCK)) throw new Error('The time ' + asOf + ' is not inside ' + START + ' to ' + CLOCK + '.');
  const data = build(asOf), extra = later(data, asOf);
  if (extra.length) throw new Error('The seed holds ' + extra.length + ' timestamps after ' + asOf + ', first ' + JSON.stringify(extra[0]) + '.');
  return data;
}
function refuses(asOf) { try { select(asOf); return false; } catch { return true; } }

function check() {
  const file = path.resolve(__dirname, '../data/evaluation/seed.json'), delivered = fs.readFileSync(file, 'utf8'), seed = JSON.parse(delivered), failed = [];
  if (JSON.stringify(select(CLOCK)) + '\n' !== delivered) failed.push('the seed at the clock ' + CLOCK + ' is not data/evaluation/seed.json byte for byte');
  if (!later(seed, MONTH_STARTS[17]).length) failed.push('control: the delivered seed has no timestamp after ' + MONTH_STARTS[17]);
  for (const asOf of ['2027-01-01T00:00:00-05:00', '2024-12-01T00:00:00-05:00', '2026-06-01T00:00:00', '2026-06-01']) if (!refuses(asOf)) failed.push('the time ' + asOf + ' is not refused');
  if (failed.length) { failed.forEach(f => console.error(f)); process.exitCode = 1; return; }
  console.log('Checked the selector: the seed at ' + CLOCK + ' is data/evaluation/seed.json byte for byte, and times without an offset or outside ' + START + ' to ' + CLOCK + ' are refused.');
}
function main(argv) {
  if (argv.includes('--check')) return check();
  const at = argv.indexOf('--as-of'), out = argv.indexOf('--out');
  try {
    const asOf = at >= 0 ? argv[at + 1] : undefined, data = select(asOf);
    if (out >= 0) fs.writeFileSync(path.resolve(argv[out + 1]), JSON.stringify(data) + '\n');
    console.log('Seed as of ' + asOf + ': ' + records(data).length + ' records, period ' + data.allocation.period_id + ', ' + data.jobs.length + ' jobs, ' + data.protocols.length +
      ' protocol versions, ' + data.tables.length + ' table versions, ' + data.notifications.length + ' notifications.' + (out >= 0 ? ' Wrote ' + argv[out + 1] + '. Load it with virtual_now ' + asOf + '.' : ''));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
if (require.main === module) main(process.argv.slice(2));
module.exports = {select, later};
