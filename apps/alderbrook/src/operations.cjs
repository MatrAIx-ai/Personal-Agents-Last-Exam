'use strict';
const c = require('./common.cjs');
const views = require('./views.cjs');
const {ms, cents, money, time, fail} = c;
const A = c.APP + '.';

const MESSAGES = {
  invalid_window: 'The loss time is in the future.',
  not_in_force: 'The policy was not in force at the loss time.',
  not_covered: 'The policy does not have this coverage.',
  too_late: 'The last day to file this loss has passed.',
  duplicate_claim: 'An open claim on this policy has the same coverage, the same vehicle or address and the same loss day.'
};
const open = claim => { if (claim.state !== 'open') fail('invalid_state', 'The claim is not open.'); };
const decimals = (...values) => { if (values.some(v => v !== undefined && !c.twoDecimals(v))) fail('invalid_arguments', 'An amount has at most two decimals.'); };
function window(args) {
  if (args.start !== undefined && args.end !== undefined && ms(args.end) < ms(args.start)) fail('invalid_window', 'The window ends before it starts.');
  return value => (args.start === undefined || ms(value) >= ms(args.start)) && (args.end === undefined || ms(value) <= ms(args.end));
}
function evidenceOf(claim, ids = []) {
  if (ids.some(id => !claim.evidence.some(item => item.id === id))) fail('not_found', 'The claim has no evidence item with this ID.');
  return [...ids];
}
function driverOf(policy, driver) {
  if (driver && driver.kind === 'listed' && !policy.listed_people.some(p => p.person_id === driver.person_id)) fail('not_found', 'No listed person of the policy has this ID.');
  return driver === undefined ? null : c.copy(driver);
}
// Find a part of a claim by its ID, with its claim.
function part(data, kind, id, label) {
  for (const claim of data.claims) {
    const item = claim[kind].find(x => x.id === id);
    if (item) return {claim, item};
  }
  return fail('not_found', 'No ' + label + ' has this ID.');
}
// One check for `coverage.check` and `claims.file`. It lists every rule that a filing would break, in the order of the error table.
function coverageCheck(data, args, now) {
  const policy = c.findPolicy(data, args.id), zone = c.zone(data), loss = ms(args.loss_at), days = data.insurer.rules.notice_days;
  if (!c.knownSubject(policy, args.subject_id)) fail('not_found', 'The policy has no vehicle or address with this ID.');
  const coverage = c.subjectOf(policy, args.coverage, args.subject_id) ? c.coverageOf(policy, args.coverage) : null, failures = [];
  const day = time.localDay(loss, zone);
  if (loss > now) failures.push('invalid_window');
  if (loss < ms(policy.term.start) || loss >= ms(policy.term.end)) failures.push('not_in_force');
  if (!coverage) failures.push('not_covered');
  if (now >= time.limitEnd(loss, days, zone)) failures.push('too_late');
  if (data.claims.some(k => k.state === 'open' && k.policy_id === policy.id && k.coverage === args.coverage && k.subject_id === args.subject_id && c.lossDay(data, k) === day)) failures.push('duplicate_claim');
  return {policy, coverage, failures, lastDay: time.lastDay(loss, days, zone)};
}

const reads = {
  'policies.list': (data, args, now) => ({items: data.policies.map(p => views.policyView(p, now))}),
  'policies.get': (data, args, now) => ({policy: views.policyView(c.findPolicy(data, args.id), now)}),
  'coverage.check'(data, args, now) {
    decimals(args.estimated_amount);
    const {coverage, failures, lastDay} = coverageCheck(data, args, now);
    const expected = coverage && args.estimated_amount !== undefined ? money(views.owed(coverage, cents(args.estimated_amount)).owes) : null;
    return {covered: !failures.length, coverage: coverage && c.copy(coverage), failures, last_day_to_file: lastDay, expected_payment: expected,
      flags: expected === 0 ? ['under_deductible'] : []};
  },
  'claims.list'(data, args, now) {
    if (args.id !== undefined) c.findPolicy(data, args.id);
    const inside = window(args);
    const claims = data.claims.filter(k => (args.state === undefined || k.state === args.state) && (args.id === undefined || k.policy_id === args.id) &&
      (args.coverage === undefined || k.coverage === args.coverage) && inside(k.filed_at));
    return {items: claims.sort((a, b) => ms(a.filed_at) - ms(b.filed_at) || a.id.localeCompare(b.id)).map(k => views.claimRow(data, k, now))};
  },
  'claims.get': (data, args, now) => ({claim: views.claimView(data, c.findClaim(data, args.id), now)}),
  'estimates.get'(data, args, now) {
    const {claim, item} = part(data, 'estimates', args.id, 'estimate');
    return {estimate: views.estimateView(data, claim, item, now)};
  },
  'payments.list'(data, args) {
    if (args.id !== undefined) c.findClaim(data, args.id);
    const inside = window(args);
    const rows = data.claims.filter(k => args.id === undefined || k.id === args.id).flatMap(k => k.payments.map(p => ({...c.copy(p), claim_id: k.id})));
    return {items: rows.filter(p => (args.kind === undefined || p.kind === args.kind) && inside(p.issued_at)).sort((a, b) => ms(a.issued_at) - ms(b.issued_at) || a.id.localeCompare(b.id))};
  },
  'notifications.list'(data, args) {
    if (args.id !== undefined) c.findClaim(data, args.id);
    const inside = window(args);
    return {items: data.notifications.filter(n => (args.id === undefined || n.claim_id === args.id) && inside(n.at))
      .map(n => ({id: n.id, at: n.at, kind: n.kind, claim_id: n.claim_id, title: n.title, text: n.text, emailed: n.email !== null}))};
  },
  'preferences.get': data => ({preferences: c.copy(data.preferences)})
};

const writes = {
  'claims.file'(t, data, args) {
    const policy = c.findPolicy(data, args.id), driver = driverOf(policy, args.driver), {failures} = coverageCheck(data, args, t.now);
    if (failures.length) fail(failures[0], MESSAGES[failures[0]]);
    const claim = {id: c.nextId(c.allIds(data), 'clm-'), policy_id: policy.id, coverage: args.coverage, subject_id: args.subject_id,
      loss_at: args.loss_at, filed_at: t.at, description: args.description, police_report_number: args.police_report_number ?? null, driver,
      state: 'open', path: 'repair', outcome: null, closed_at: null, withdrawn_at: null, repair_completed_at: null, repair_reported_by: null,
      final_invoice_total: null, payee: null, evidence: [], requests: [], estimates: [], determinations: [], disputes: [], offers: [], rentals: [],
      payments: [], history: []};
    data.claims.push(claim);
    c.record(t, data, claim, 'claims.file', claim.id);
    return {id: claim.id};
  },
  'claims.update'(t, data, args) {
    if (args.description === undefined && args.police_report_number === undefined && args.driver === undefined) fail('invalid_arguments', 'Give the description, the police report number or the driver.');
    const claim = c.findClaim(data, args.id), driver = driverOf(c.policyOf(data, claim), args.driver);
    open(claim);
    if (args.description !== undefined) claim.description = args.description;
    if (args.police_report_number !== undefined) claim.police_report_number = args.police_report_number;
    if (args.driver !== undefined) claim.driver = driver;
    c.record(t, data, claim, 'claims.update', claim.id);
    return {id: claim.id};
  },
  'claims.add_evidence'(t, data, args) {
    const claim = c.findClaim(data, args.id), ids = c.allIds(data), added = [];
    open(claim);
    for (const item of args.items) {
      const id = c.nextId(ids, 'evd-');
      ids.push(id); added.push(id);
      claim.evidence.push({id, kind: item.kind, dated: item.dated, description: item.description, reference: item.reference ?? null, added_at: t.at});
    }
    c.record(t, data, claim, 'claims.add_evidence', claim.id);
    return {id: claim.id, evidence_ids: added};
  },
  'claims.withdraw'(t, data, args) {
    const claim = c.findClaim(data, args.id);
    open(claim);
    if (claim.payments.length || claim.offers.some(o => o.state === 'accepted')) fail('invalid_state', 'A claim with a payment or an accepted offer cannot be withdrawn.');
    Object.assign(claim, {state: 'withdrawn', withdrawn_at: t.at});
    c.record(t, data, claim, 'claims.withdraw', claim.id);
    c.endClaim(t, data, claim, 'claim_withdrawn');
    return {id: claim.id};
  },
  'requests.respond'(t, data, args) {
    if (new Set(args.answers.map(a => a.key)).size !== args.answers.length) fail('invalid_arguments', 'One call answers each ask once.');
    const {claim, item: request} = part(data, 'requests', args.id, 'information request');
    const asks = args.answers.map(a => request.asks.find(ask => ask.key === a.key) || fail('not_found', 'The request has no ask with the key ' + a.key + '.'));
    const evidence = args.answers.map(a => evidenceOf(claim, a.evidence_ids));
    open(claim);
    if (request.state !== 'open') fail('invalid_state', 'The information request is not open.');
    if (asks.some(ask => ask.answer !== null)) fail('invalid_state', 'An ask already has an answer. An answer is not edited.');
    asks.forEach((ask, index) => { ask.answer = {text: args.answers[index].text, evidence_ids: evidence[index], answered_at: t.at}; });
    c.record(t, data, claim, 'requests.respond', request.id);
    if (request.asks.every(ask => ask.answer !== null)) { request.state = 'answered'; c.record(t, data, claim, 'request.answered', request.id, true); }
    return {id: request.id};
  },
  'estimates.submit'(t, data, args) {
    decimals(...args.lines.map(l => l.amount));
    const claim = c.findClaim(data, args.id);
    open(claim);
    if (claim.path === 'total_loss') fail('invalid_state', 'The claim is on the total_loss path. Its estimates are closed.');
    const lineIds = c.linesOf(claim).map(row => row.line.id);
    const estimate = {id: c.nextId(c.allIds(data), 'est-p'), kind: args.kind, source: 'policyholder', shop_name: args.shop_name, submitted_at: t.at,
      lines: args.lines.map(l => { const id = c.nextId(lineIds, 'ln-p', 2); lineIds.push(id); return {id, text: l.text, amount: l.amount, decisions: []}; })};
    claim.estimates.push(estimate);
    c.record(t, data, claim, 'estimates.submit', estimate.id);
    return {id: estimate.id};
  },
  'determinations.dispute'(t, data, args) {
    const claim = c.findClaim(data, args.claim_id), row = c.findLine(claim, args.id) || fail('not_found', 'The claim has no estimate line with this ID.');
    const evidence = evidenceOf(claim, args.evidence_ids), line = row.line, last = c.standing(line);
    open(claim);
    if (claim.path === 'total_loss') fail('invalid_state', 'The claim is on the total_loss path. Its lines are history.');
    if (!last || last.status === 'approved' && cents(last.amount) >= cents(line.amount)) fail('nothing_to_dispute', 'The line is approved in full or still pending.');
    if (views.alreadyDisputed(claim, line)) fail('already_disputed', 'The standing decision of the line already has a dispute, or a dispute produced it.');
    if (t.now >= time.limitEnd(ms(last.decided_at), data.insurer.rules.dispute_window_days, c.zone(data))) fail('too_late', 'The last day to dispute this decision has passed.');
    const dispute = {id: c.nextId(c.allIds(data), 'dsp-'), line_id: line.id, decision_index: line.decisions.length - 1, reason: args.reason,
      evidence_ids: evidence, opened_at: t.at, state: 'open', decided_at: null, decided_by: null, note: null};
    claim.disputes.push(dispute);
    c.record(t, data, claim, 'determinations.dispute', dispute.id);
    return {id: dispute.id};
  },
  'payee.set'(t, data, args) {
    const claim = c.findClaim(data, args.id);
    open(claim);
    claim.payee = c.copy(args.payee);
    c.record(t, data, claim, 'payee.set', claim.id);
    return {id: claim.id};
  },
  'offers.accept': (t, data, args) => answerOffer(t, data, args, 'accepted'),
  'offers.reject': (t, data, args) => answerOffer(t, data, args, 'rejected'),
  'rental.start'(t, data, args) {
    decimals(args.daily_rate);
    const claim = c.findClaim(data, args.id), start = ms(args.start_at);
    open(claim);
    if (start < ms(claim.loss_at) || start > t.now || claim.rentals.some(r => r.end_at !== null && start < ms(r.end_at))) fail('invalid_window', 'A rental starts after the loss, after the end of every earlier rental period of the claim, and not after the current time.');
    if (!c.policyOf(data, claim).rental_benefit) fail('not_covered', 'The policy has no rental benefit.');
    if (claim.rentals.some(r => r.state === 'active')) fail('already_active', 'The claim already has an active rental period.');
    const rental = {id: c.nextId(c.allIds(data), 'rnt-'), start_at: args.start_at, daily_rate: args.daily_rate, state: 'active', end_at: null, ended_by: null};
    claim.rentals.push(rental);
    c.record(t, data, claim, 'rental.start', rental.id);
    return {id: rental.id};
  },
  'rental.end'(t, data, args) {
    const {claim, item: rental} = part(data, 'rentals', args.id, 'rental period'), end = ms(args.end_at);
    if (rental.state !== 'active') fail('invalid_state', 'The rental period is not active.');
    if (end < ms(rental.start_at) || end > t.now) fail('invalid_window', 'A rental ends after its start and not after the current time.');
    Object.assign(rental, {state: 'ended', end_at: args.end_at, ended_by: 'agent'});
    c.record(t, data, claim, 'rental.end', rental.id);
    return {id: rental.id};
  },
  'preferences.update'(t, data, args) {
    if (args.timezone === undefined && args.email_notices === undefined) fail('invalid_arguments', 'Give the time zone or email_notices.');
    if (args.timezone !== undefined && !time.validZone(args.timezone)) fail('invalid_timezone', 'The time zone is unknown. Use an IANA name such as America/New_York.');
    Object.assign(data.preferences, c.copy({timezone: args.timezone ?? data.preferences.timezone, email_notices: args.email_notices ?? data.preferences.email_notices}));
    c.record(t, data, null, 'preferences.update', data.account_id);
    return {id: data.account_id};
  }
};
function answerOffer(t, data, args, state) {
  const {claim, item: offer} = part(data, 'offers', args.id, 'offer'), evidence = evidenceOf(claim, args.evidence_ids);
  open(claim);
  if (offer.state !== 'open') fail('invalid_state', 'The offer is ' + offer.state + '. It keeps its state.');
  if (c.offerState(claim, offer, t.now) === 'expired') fail('too_late', 'The offer expired. Its respond_by has passed.');
  Object.assign(offer, {state, answered_at: t.at, reason: args.reason ?? null, evidence_ids: evidence});
  c.record(t, data, claim, state === 'accepted' ? 'offers.accept' : 'offers.reject', offer.id);
  return {id: offer.id};
}
function handleTool(ctx, data, name, args) {
  const short = name.startsWith(A) ? name.slice(A.length) : '', now = ms(ctx.virtual_now);
  if (reads[short]) return {data, result: {...reads[short](data, args, now), now: time.iso(now, c.zone(data))}};
  if (!writes[short]) fail('unknown_tool', 'Unknown Alderbrook operation.');
  const result = writes[short]({ctx, at: ctx.virtual_now, now, actor: 'agent', ref: args.request_id}, data, args);
  return {data, result};
}
module.exports = {handleTool};
