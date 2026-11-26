'use strict';
// Writes a seed of the evaluation history "as of" a time: only the steps at or before it, so each record is in its state at that time
// and no later record is history. A task loads it with env.load_seed and the same time as virtual_now.
// Usage: node dev/select-evaluation-seed.cjs --as-of 2026-11-19T12:00:00-05:00 [--out FILE]. Without --out it prints a summary only.
const fs = require('node:fs');
const path = require('node:path');
const {build, START, CLOCK} = require('./generate-evaluation-data.cjs');
const {records} = require('../src/model.cjs');

// Due times of a schedule: a pay run's cut-off and a window's open and close. They may be later than the seed's time, like the pay dates.
const DUE = ['cutoff_at', 'opens_at', 'closes_at'];
// Every timestamp anywhere in a seed that is after `asOf`, outside the due times, with its path. A seed made by `select` has none.
function later(data, asOf, at = '', out = []) {
  if (typeof data === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T/.test(data) && Date.parse(data) > Date.parse(asOf) && !DUE.includes(at.split('.').pop().replace(/\[\d+\]$/, ''))) out.push({path: at, value: data});
  } else if (data && typeof data === 'object') {
    for (const [key, value] of Object.entries(data)) later(value, asOf, Array.isArray(data) ? at + '[' + key + ']' : at ? at + '.' + key : key, out);
  }
  return out;
}
function select(asOf) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/.test(asOf || '')) throw new Error('--as-of needs a time with a UTC offset, such as 2026-11-19T12:00:00-05:00.');
  const data = build(asOf), extra = later(data, asOf);
  if (extra.length) throw new Error('The seed holds ' + extra.length + ' timestamps after ' + asOf + ', first ' + JSON.stringify(extra[0]));
  return data;
}
function main(argv) {
  const at = argv.indexOf('--as-of'), out = argv.indexOf('--out');
  try {
    const asOf = at >= 0 ? argv[at + 1] : undefined, data = select(asOf);
    if (out >= 0) fs.writeFileSync(path.resolve(argv[out + 1]), JSON.stringify(data, null, 2) + '\n');
    console.log('Seed as of ' + asOf + ': ' + records(data).length + ' records, ' + data.statements.length + ' pay statements, ' + data.leave_requests.length + ' leave requests, ' +
      data.notifications.length + ' notifications, ' + data.calendar.filter(e => e.state === 'planned').length + ' planned pay dates.' +
      (out >= 0 ? ' Wrote ' + argv[out + 1] + '. Load it with virtual_now ' + asOf + '.' : ''));
  } catch (error) {
    console.error(error.message + ' The time must be inside ' + START + ' to ' + CLOCK + '.');
    process.exitCode = 1;
  }
}
if (require.main === module) main(process.argv.slice(2));
module.exports = {select, later};
