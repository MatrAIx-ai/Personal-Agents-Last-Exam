'use strict';
const path = require('node:path');
const { compile } = require('./schema-validator.cjs');
const { fail, pending, same, sorted, propertyDate } = require('./common.cjs');
const { conditions, terms, sameIdentity, matchesConditions, matchesTerms } = require('./conditions.cjs');
const valid = compile(require('../schemas/seed.schema.json'), path.join(__dirname, '../schemas'));

function records(data) {
  return [{ record_type: 'property', ...data.property }, { record_type: 'stay', ...data.stay },
    ...['people', 'sources', 'needs', 'requests', 'commitments', 'history']
      .flatMap(k => data[k].map(x => ({ record_type: k, ...x })))];
}

function sourceSnapshots(data, versions) {
  if (new Set(versions.map(v => v.source_id)).size !== versions.length)
    fail('invalid_seed', 'A source may have only one version snapshot per record.');
  for (const version of versions) {
    const source = data.sources.find(s => s.id === version.source_id);
    if (!source || version.version > source.version || version.grant_version > source.grant_version)
      fail('invalid_seed', 'A source snapshot must name an existing observed source version.');
  }
}

function validateSeed(ctx, data) {
  if (!valid(data)) fail('invalid_seed', 'StayReady seed/state does not match its schema.');
  try { new Intl.DateTimeFormat('en-GB', {timeZone: data.property.timezone}).format(0); }
  catch { fail('invalid_seed', 'The property timezone must be a recognized IANA time zone.'); }
  const rows = records(data), ids = rows.map(x => x.id);
  if (new Set(ids).size !== ids.length) fail('invalid_seed', 'Business record IDs must be unique.');
  if (!ctx.binding || !ctx.binding.people.some(p => p.person_id === data.owner_person_id) ||
      !ctx.binding.accounts.some(a => a.app_id === 'stayready' && a.account_id === data.account_id && a.owner_person_id === data.owner_person_id))
    fail('invalid_seed', 'Account and owner must match the trusted binding.');
  if (data.people.some(p => !ctx.binding.people.some(x => x.person_id === p.id)))
    fail('invalid_seed', 'All people must exist in the trusted binding.');
  const people = new Set(data.people.map(p => p.id));
  if (!data.stay.guest_person_ids.includes(data.owner_person_id) || data.stay.guest_person_ids.some(x => !people.has(x)))
    fail('invalid_seed', 'Stay guests must include the owner and a known companion.');
  // Local date ordinals count hotel nights without imposing a 48-hour duration.
  if (data.stay.property_id !== data.property.id || Date.parse(data.stay.check_out) <= Date.parse(data.stay.check_in) ||
      Date.parse(propertyDate(data, data.stay.check_out) + 'T00:00:00Z') - Date.parse(propertyDate(data, data.stay.check_in) + 'T00:00:00Z') !== 172800000)
    fail('invalid_seed', 'Stay must cover two calendar nights in the property timezone.');

  const entranceIds = data.property.entrances.map(e => e.id), routeIds = data.property.routes.map(r => r.id);
  if (new Set(entranceIds).size !== entranceIds.length || new Set(routeIds).size !== routeIds.length)
    fail('invalid_seed', 'Duplicate entrance or route.');
  for (const r of data.property.routes)
    if (!entranceIds.includes(r.entrance_id) || Date.parse(r.window.start) >= Date.parse(r.window.end))
      fail('invalid_seed', 'Invalid route record.');
  for (const s of data.sources) {
    if (s.person_id !== null && !people.has(s.person_id)) fail('invalid_seed', 'Unknown source subject.');
    if (s.disclose_fields.some(f => !Object.hasOwn(s.fields, f)))
      fail('invalid_seed', 'A disclosure grant refers to an absent service field.');
  }

  const slots = new Set();
  for (const n of data.needs) {
    if (n.person_ids.some(x => !people.has(x)) || n.source_ids.some(id => !data.sources.some(s => s.id === id)))
      fail('invalid_seed', 'A need has a dangling reference.');
    if (n.service !== 'late_arrival' && n.person_ids.length !== 1 || n.service === 'late_arrival' && n.person_ids.length !== 2)
      fail('invalid_seed', 'Invalid need traveler scope.');
    if (n.service === 'late_arrival' && !same(sorted(n.person_ids), sorted(data.stay.guest_person_ids)))
      fail('invalid_seed', 'The current arrival need must name the current booked travelers.');
    const slot = n.service === 'late_arrival' ? n.service : n.service + ':' + n.person_ids[0];
    if (slots.has(slot)) fail('invalid_seed', 'Need slots must be unique for each supported service and traveler.');
    slots.add(slot);
    if (n.conditions) {
      conditions(data, n.conditions, n);
      if (!same(sorted(n.person_ids), sorted(n.conditions.person_ids)))
        fail('invalid_seed', 'Need conditions must describe its travelers.');
    } else if (n.source_ids.length) fail('invalid_seed', 'An empty need cannot retain source references.');
    if (!same(sorted(n.source_ids), sorted(n.source_versions.map(v => v.source_id))))
      fail('invalid_seed', 'Need source snapshots must match its source references.');
    sourceSnapshots(data, n.source_versions);
  }
  // These are seed-defined slots, not objects created in response to an Agent run.
  if (!slots.has('late_arrival') || data.people.some(p =>
      !slots.has('step_free_access:' + p.id) || !slots.has('breakfast:' + p.id)))
    fail('invalid_seed', 'The seed must include arrival and personal service slots for all three travelers.');

  for (const r of data.requests) {
    const n = data.needs.find(n => n.id === r.need_id);
    if (!n) fail('invalid_seed', 'Request references an unknown need.');
    const requested = conditions(data, r.conditions, n);
    if (r.action === 'arrange' && (r.predecessor_id !== null || r.predecessor !== null) ||
        r.action !== 'arrange' && (!r.predecessor_id || !r.predecessor))
      fail('invalid_seed', 'Request predecessor shape does not match its action.');
    if (r.predecessor_id) {
      const c = data.commitments.find(c => c.id === r.predecessor_id);
      if (!c || c.need_id !== r.need_id || !matchesTerms(data, c.terms, r.predecessor.terms, n) ||
          Date.parse(c.confirmed_at) !== Date.parse(r.predecessor.confirmed_at) ||
          Date.parse(c.confirmed_at) > Date.parse(r.submitted_at))
        fail('invalid_seed', 'Request predecessor must preserve an existing prior promise.');
      if (r.action === 'cancel' && !matchesConditions(data, r.conditions, c.request_conditions, n))
        fail('invalid_seed', 'Cancellation must retain the exact prior requested conditions.');
      if (r.status === 'confirmed' && c.status !== (r.action === 'cancel' ? 'cancelled' : 'superseded'))
        fail('invalid_seed', 'A confirmed change or cancellation must preserve its predecessor transition.');
    }
    sourceSnapshots(data, r.source_versions);
    const field = { late_arrival: 'arrival_at', step_free_access: 'functional_need', breakfast: 'meal_request' }[n.service];
    if (r.action === 'cancel' && (r.disclosures.length || r.source_versions.length) ||
        r.action !== 'cancel' && !r.disclosures.length)
      fail('invalid_seed', 'The request disclosure history must match its action.');
    for (const disclosure of r.disclosures) {
      const source = data.sources.find(s => s.id === disclosure.source_id);
      const equalFact = field === 'arrival_at' ? Date.parse(disclosure.value) === Date.parse(requested[field]) : disclosure.value === requested[field];
      if (!source || !r.source_versions.some(v => v.source_id === source.id) || disclosure.field !== field || !equalFact ||
          source.person_id !== null && !requested.person_ids.includes(source.person_id))
        fail('invalid_seed', 'Historical disclosures must contain only the submitted service fact and its source.');
    }
    if (['confirmed', 'declined'].includes(r.status) !== Boolean(r.final_reply) ||
        r.final_reply && (r.final_reply.outcome !== r.status || !same(r.final_reply, r.replies.at(-1))))
      fail('invalid_seed', 'Final request state requires its immutable final reply in history.');
    let lastReplyTime = Date.parse(r.submitted_at);
    for (const reply of r.replies) {
      if (Date.parse(reply.at) < lastReplyTime) fail('invalid_seed', 'Reply history must follow submission in chronological order.');
      lastReplyTime = Date.parse(reply.at);
      const hasTerms = reply.outcome === 'confirmed' && r.action !== 'cancel';
      if (Boolean(reply.terms) !== hasTerms || reply.terms && !sameIdentity(terms(data, reply.terms, n), requested))
        fail('invalid_seed', 'Reply terms must match its outcome, service and travelers.');
      if (['confirmed', 'declined'].includes(reply.outcome) && !same(reply, r.final_reply))
        fail('invalid_seed', 'A request can contain only its one immutable final response.');
    }
  }
  for (const n of data.needs) {
    if (data.requests.filter(r => r.need_id === n.id && pending(r)).length > 1)
      fail('invalid_seed', 'Only one pending request may exist per need.');
    if (data.commitments.filter(c => c.need_id === n.id && c.status === 'active').length > 1)
      fail('invalid_seed', 'Only one current commitment may exist per need.');
  }
  const confirmedRequests = new Set();
  for (const c of data.commitments) {
    const n = data.needs.find(n => n.id === c.need_id);
    if (!n) fail('invalid_seed', 'Commitment references an unknown need.');
    conditions(data, c.request_conditions, n); terms(data, c.terms, n);
    if (!sameIdentity(c.request_conditions, c.terms)) fail('invalid_seed', 'Commitment terms have another service or traveler.');
    if (c.request_id) {
      const r = data.requests.find(r => r.id === c.request_id);
      if (!r || r.status !== 'confirmed' || r.action === 'cancel' || r.need_id !== c.need_id || confirmedRequests.has(r.id) ||
          !matchesConditions(data, c.request_conditions, r.conditions, n) ||
          !matchesTerms(data, c.terms, r.final_reply.terms, n) || Date.parse(c.confirmed_at) !== Date.parse(r.final_reply.at))
        fail('invalid_seed', 'Commitment must preserve the exact terms and time of its confirmed service request.');
      confirmedRequests.add(r.id);
    }
    for (const u of c.unavailability)
      if (Date.parse(u.effective_at) < Date.parse(u.recorded_at) || Date.parse(u.recorded_at) < Date.parse(c.confirmed_at))
        fail('invalid_seed', 'Unavailability must follow confirmation and cannot predate its notice.');
  }
  for (const r of data.requests)
    if (r.status === 'confirmed' && r.action !== 'cancel' && !confirmedRequests.has(r.id))
      fail('invalid_seed', 'A confirmed service request must retain its commitment record.');
  const eventIds = data.history.filter(h => h.event_id).map(h => h.event_id);
  if (new Set(eventIds).size !== eventIds.length) fail('invalid_seed', 'Accepted event IDs must be unique in history.');
  return true;
}

function references(data) {
  return data.sources.filter(s => s.provenance.account_id && ['notes', 'contacts'].includes(s.provenance.app_id))
    .map(s => ({ app_id: s.provenance.app_id, account_id: s.provenance.account_id, object_id: s.provenance.object_id }));
}
module.exports = { validateSeed, records, objects: data => records(data).map(x => x.id), references };
