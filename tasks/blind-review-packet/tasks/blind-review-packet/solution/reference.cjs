'use strict';

// The reference reads the same App records and writes through the same account as the agent.
async function solve(agent, choices = {}) {
  const app = async (name, args) => {
    const result = await agent({op:'call', name, args});
    if (!['ok','committed'].includes(result.status)) throw Error(name + ': ' + JSON.stringify(result));
    return result;
  };
  const {session} = await agent({op:'status'});
  const mail = (await app('mail.search', {})).messages;
  const catalogId = mail.find(m => m.thread_id === 'friday-catalog').id;
  const catalog = (await app('mail.get', {id:catalogId})).message.body.split('\n')
    .map(l => l.split('|').map(s => s.trim())).filter(row => /^[ABC][1-4]$/.test(row[0]));
  const noteList = (await app('notes.list', {query:'packet'})).items;
  await app('notes.get', {id:noteList.find(n=>n.title.includes('guide')).id});
  const packet = noteList.find(n=>n.title === 'Friday packet');
  const exposed = new Map(), locks = new Map();
  for (const summary of mail.filter(m => ['calibration','receipts','lab-notes'].includes(m.thread_id))) {
    const m = (await app('mail.get', {id:summary.id})).message;
    if (m.from === 'ren@lab.example') {
      const names = m.body.startsWith('I edited the source-labelled answer') ?
        [m.body.match(/answer to (\w+)/)[1]] :
        m.body.includes('personally saw the source-labelled answers') ? m.body.match(/answers to (\w+) and (\w+)/).slice(1) : [];
      for (const name of names) {
        const id = catalog.find(row=>row[3]===name)[0];
        const when = m.thread_id === 'lab-notes' ? m.received_at.replace('11:03','11:00') : m.received_at;
        exposed.set(id, Math.min(exposed.get(id) ?? Infinity, Date.parse(when)));
      }
    }
    if (m.thread_id==='receipts' && m.body.includes('Action: LOCKED')) {
      locks.set(m.body.match(/Card: (\w+)/)[1], {receipt:m.body.match(/Receipt: ([\w-]+)/)[1], at:Date.parse(m.body.match(/Time: (.+)/)[1])});
    }
  }
  const rows = ['| Slot | Card | Status | Receipt |','| --- | --- | --- | --- |'];
  for (const [slot, category, role] of catalog) {
    if (role !== 'assigned') continue;
    const lock = locks.get(slot);
    const valid = lock && lock.at < (exposed.get(slot) ?? Infinity);
    const reserves = catalog.filter(r => r[1]===category && r[2]==='reserve' && !exposed.has(r[0]));
    const card = !valid && exposed.has(slot) ? reserves[choices[slot] || 0][0] : slot;
    rows.push('| ' + [slot,card,valid?'COUNTED':'OPEN',valid?lock.receipt:''].join(' | ')+' |');
  }
  const current = await app('notes.get', {id:packet.id});
  await app('notes.update',{id:packet.id,expected_version:current.version,request_id:'packet-'+session,
    patch:{body:rows.join('\n')}});
}
module.exports = {solve};
if (require.main === module) {
  const {request} = require('/usr/local/lib/packet.cjs');
  solve(request).catch(err => { console.error(err.message); process.exitCode=1; });
}
