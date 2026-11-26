'use strict';
// Optional actual Notes + PriceWatch assembly through separate MCP calls.
// No direct App-to-App access, fake Notes client, or model qualification.
const crypto = require('node:crypto');
const {driver, output} = require('../examples/runtime-support.cjs');
const {clone, later, blankWorkspace, filterCriteria, quoteEvent} = require('../examples/fixture-data.cjs');

async function run() {
  const d = driver({notes: true});
  const {open, call, snapshot, write, event, load, eq, ok} = d;
  try {
    const pwAgent = await open('pricewatch', 'agent', 'notes-assembly');
    const pwInfra = await open('pricewatch', 'infra', 'notes-assembly');
    const pwInitial = await snapshot(pwInfra);
    const pwBaseline = await load(pwInfra, blankWorkspace(pwInitial.snapshot.data), {now: pwInitial.snapshot.virtual_now});
    const personId = pwBaseline.snapshot.binding.accounts.find(item =>
      item.app_id === 'pricewatch' && item.account_id === pwBaseline.snapshot.data.account_id).owner_person_id;
    const notesAgent = await open('notes', 'agent', 'notes-assembly');
    const notesInfra = await open('notes', 'infra', 'notes-assembly');
    const notesInitial = await snapshot(notesInfra);
    const notesData = clone(notesInitial.snapshot.data);
    notesData.account_id = 'notes-pricewatch-example';
    notesData.owner_person_id = personId;
    notesData.notes = [];
    const binding = clone(notesInitial.snapshot.binding);
    for (const person of pwBaseline.snapshot.binding.people) {
      if (!binding.people.some(item => item.person_id === person.person_id)) binding.people.push(clone(person));
    }
    const priorNotesAccount = binding.accounts.find(item => item.app_id === 'notes');
    binding.accounts = binding.accounts.filter(item => item.app_id !== 'notes');
    binding.accounts.push({...clone(priorNotesAccount), account_id: notesData.account_id, owner_person_id: personId});
    await load(notesInfra, notesData, {binding, now: pwBaseline.snapshot.virtual_now});

    const privateBody = 'SYNTHETIC-PRIVATE-DIARY-ONLY-IN-NOTES: I recorded a personal experience here; this complete text stays in Notes.';
    const privateNote = await write(notesAgent, notesInfra, 'notes.create', {
      title: 'Private synthetic diary', body: privateBody, tags: ['private-example']}, 'private-note');
    const actualPrivate = (await call(notesAgent, 'notes.get', {id: privateNote.id})).item;
    eq('Actual Notes receiver stores the complete private record', actualPrivate.body, privateBody);

    // A real agent chooses neutral criteria after reading its authorized context.
    // This deterministic example tests the integration boundary, not that choice.
    const criteria = filterCriteria(pwBaseline.snapshot.data);
    const watch = await write(pwAgent, pwInfra, 'pricewatch.watch.upsert', {
      watch_key: 'notes-assembly-filter', criteria, state: 'active'}, 'notes-assembly-watch');
    const priceEvent = quoteEvent(pwBaseline.snapshot.data, criteria, {
      id: 'notes-assembly-quote-event', episode: 'notes-assembly-quote',
      at: later(pwBaseline.snapshot.virtual_now, 60 * 60 * 1000)});
    await event(pwInfra, priceEvent);
    const view = await call(pwAgent, 'pricewatch.watch.get', {watch_id: watch.watch_id});
    eq('Real PriceWatch candidate exists', view.watch.available_candidate_count, 1);
    const candidateId = view.candidates.find(item => item.effective_status === 'available_in_app').id;
    const operationalBody = 'PriceWatch watch ID: ' + watch.watch_id + '\nCandidate ID: ' + candidateId +
      '\nNeutral rule: filter-family/R1, one unit, USD ceiling 30.00. No private diary text copied.';
    const derived = await write(notesAgent, notesInfra, 'notes.create', {
      title: 'Operational PriceWatch link', body: operationalBody, tags: ['pricewatch']}, 'derived-note');
    const actualDerived = (await call(notesAgent, 'notes.get', {id: derived.id})).item;
    eq('An actual derived Note contains returned watch and candidate IDs', actualDerived.body, operationalBody);
    ok('Derived Note links the real returned watch ID', actualDerived.body.includes(watch.watch_id));
    ok('Derived Note links the real returned candidate ID', actualDerived.body.includes(candidateId));

    const pwAfter = await snapshot(pwInfra);
    const pwRecords = JSON.stringify(pwAfter.snapshot.data);
    ok('PriceWatch records contain no raw diary marker', !pwRecords.includes('SYNTHETIC-PRIVATE-DIARY-ONLY-IN-NOTES'));
    ok('PriceWatch records contain no complete private diary', !pwRecords.includes(privateBody));
    const pwCalls = d.trace.filter(entry => entry.identity.app === 'pricewatch');
    ok('PriceWatch arguments contain no raw diary', !JSON.stringify(pwCalls.map(entry => entry.arguments)).includes(privateBody));
    ok('PriceWatch receives no private Note body or title', !pwRecords.includes(actualPrivate.title) && !pwRecords.includes(privateBody));
    eq('PriceWatch keeps a neutral operational rule', view.watch.criteria, criteria);
    const notesAfter = await snapshot(notesInfra);
    eq('Notes still owns the private record after PriceWatch operations',
      (await call(notesAgent, 'notes.get', {id: privateNote.id})).item.body, privateBody);
    eq('Both real accounts are bound to the same logical owner', notesAfter.snapshot.data.owner_person_id, personId);
    return d.report({mode: 'Optional real Notes + PriceWatch MCP assembly', notes_version: '1.0.0',
      private_note_id: privateNote.id, private_body_sha256: crypto.createHash('sha256').update(privateBody).digest('hex'),
      derived_note_id: derived.id, derived_note_body: actualDerived.body, watch_id: watch.watch_id, candidate_id: candidateId,
      boundaries: ['Separate Agent business calls', 'No Messaging', 'No PriceWatch access to Notes state',
        'Synthetic private Notes contents are redacted from combined trace', 'No model rollout or Task qualification']});
  } finally {await d.close();}
}

module.exports = {run};
if (require.main === module) output(run);
