'use strict';
const fs = require('node:fs');
const path = require('node:path');

const source = path.resolve(__dirname, '../tasks/blind-review-packet');

function prepare(destination, {alternate = false, hinted = false} = {}) {
  const dest = path.resolve(destination);
  if (dest === source || dest.startsWith(source + path.sep) || fs.existsSync(dest)) {
    throw Error('Choose a new directory outside the source task');
  }
  fs.mkdirSync(path.dirname(dest), {recursive:true});
  const stage = fs.mkdtempSync(path.join(path.dirname(dest), '.packet-prepare-'));
  try {
    fs.cpSync(source, stage, {recursive:true});
    if (alternate) {
      const history = JSON.parse(fs.readFileSync(path.join(stage, 'context/user/history.json')));
      const file = path.join(stage, 'environment/workspace/mail/seed.json');
      const seed = JSON.parse(fs.readFileSync(file));
      const {record, field, replacement} = history.alternate;
      const targets = seed.messages.filter(m => m.id === record);
      if (targets.length !== 1 || field !== 'body') throw Error('Invalid alternate history');
      targets[0][field] = replacement;
      fs.writeFileSync(file, JSON.stringify(seed, null, 2) + '\n');
    }
    if (hinted) {
      const hint = fs.readFileSync(path.join(stage, 'tests/hints.md'), 'utf8').trim();
      const {sessions} = JSON.parse(fs.readFileSync(path.join(stage, 'context/timeline.yaml')));
      for (const {id} of sessions) fs.appendFileSync(path.join(stage, 'steps', id, 'instruction.md'), '\n' + hint + '\n');
    }
    fs.renameSync(stage, dest);
  } finally {
    fs.rmSync(stage, {recursive:true, force:true});
  }
  return dest;
}
module.exports = {prepare, source};
if (require.main === module) {
  const [destination, ...flags] = process.argv.slice(2);
  if (!destination || flags.some(x=>!['--alternate','--hinted'].includes(x))) throw Error('Usage: node tools/prepare.cjs NEW_DIRECTORY [--alternate] [--hinted]');
  console.log(prepare(destination, {alternate:flags.includes('--alternate'), hinted:flags.includes('--hinted')}));
}
