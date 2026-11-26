'use strict';
const c = require('./common.cjs');
const {ms, time} = c;
// A stored time is a full timestamp with a UTC offset. The wire message of a notification follows Mail's schema instead.
const TIME_KEY = /^(at|start|end|dated|respond_by)$|_at$/, WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const noOffset = value => Object.entries(value).some(([key, item]) => typeof item === 'string' ? TIME_KEY.test(key) && !WITH_OFFSET.test(item)
  : item !== null && typeof item === 'object' && key !== 'email' && noOffset(item));
// The rules that a seed must keep. Core runs them on every loaded seed and after every write and event.
function validate(ctx, data, code = 'invalid_seed') {
  const bad = message => c.fail(code, message);
  const amounts = (...values) => { if (values.some(v => v !== null && v !== undefined && !c.twoDecimals(v))) bad('An amount has more than two decimals.'); };
  if (!time.validZone(data.insurer.timezone) || !time.validZone(data.preferences.timezone)) bad('A time zone is unknown.');
  if (noOffset(data)) bad('A timestamp has no UTC offset.');
  const ids = new Set();
  const take = id => { if (ids.has(id)) bad('The ID ' + id + ' is used twice.'); ids.add(id); };
  for (const policy of data.policies) {
    take(policy.id);
    if (ms(policy.term.start) >= ms(policy.term.end)) bad('A policy term ends before it starts.');
    for (const vehicle of policy.vehicles) take(vehicle.id);
    if (policy.insured_address) take(policy.insured_address.id);
    const auto = policy.kind === 'auto', types = policy.coverages.map(x => x.type);
    if (new Set(types).size !== types.length || types.some(type => (type === 'personal_property') === auto)) bad('A policy has a coverage that does not fit its kind.');
    if (auto ? !policy.vehicles.length || policy.insured_address : policy.vehicles.length || !policy.insured_address || policy.rental_benefit) bad('A policy has insured items that do not fit its kind.');
    for (const coverage of policy.coverages) amounts(coverage.deductible, coverage.limit);
    if (policy.rental_benefit) amounts(policy.rental_benefit.daily_cap);
  }
  const open = new Set();
  for (const claim of data.claims) {
    take(claim.id);
    const policy = c.policyOf(data, claim);
    if (!policy) bad('A claim names a policy that does not exist.');
    if (!c.coverageOf(policy, claim.coverage)) bad('A claim names a coverage that its policy does not have.');
    const subject = c.subjectOf(policy, claim.coverage, claim.subject_id);
    if (!subject) bad('A claim names a vehicle or an address that its policy does not have.');
    if (ms(claim.loss_at) < ms(policy.term.start) || ms(claim.loss_at) >= ms(policy.term.end)) bad('The loss time of a claim is outside the term of its policy.');
    if (ms(claim.filed_at) < ms(claim.loss_at)) bad('A claim is filed before its loss.');
    if (claim.driver && claim.driver.kind === 'listed' && !policy.listed_people.some(p => p.person_id === claim.driver.person_id)) bad('A listed driver is not on the policy.');
    const closed = claim.state === 'closed';
    if ((claim.outcome !== null) !== closed || (claim.closed_at !== null) !== closed || (claim.withdrawn_at !== null) !== (claim.state === 'withdrawn')) bad('The state of a claim does not fit its closing fields.');
    if ((claim.repair_completed_at === null) !== (claim.repair_reported_by === null)) bad('The repair completion fields of a claim do not agree.');
    amounts(claim.final_invoice_total);
    const ended = claim.state === 'open' ? null : ms(claim.closed_at || claim.withdrawn_at);
    if (claim.state === 'open') {
      const key = [claim.policy_id, claim.coverage, claim.subject_id, c.lossDay(data, claim)].join('|');
      if (open.has(key)) bad('Two open claims on one policy have the same coverage, vehicle or address and loss day.');
      open.add(key);
    }
    const evidence = new Set(), lines = new Map();
    for (const item of claim.evidence) { take(item.id); evidence.add(item.id); }
    const known = list => { if (list.some(id => !evidence.has(id))) bad('An evidence item of another claim, or an unknown one, is named.'); };
    for (const request of claim.requests) {
      take(request.id);
      if (!request.asks.length) bad('An information request has no asks.');
      if (new Set(request.asks.map(a => a.key)).size !== request.asks.length) bad('An information request has two asks with one key.');
      const unanswered = request.asks.filter(a => a.answer === null).length;
      if (request.state === 'answered' ? unanswered : request.state === 'open' && !unanswered) bad('The state of an information request does not fit its answers.');
      if (request.state === 'open' && ended !== null) bad('A claim that is not open has an open information request.');
      for (const ask of request.asks) if (ask.answer) known(ask.answer.evidence_ids);
    }
    for (const estimate of claim.estimates) {
      take(estimate.id);
      if (!estimate.lines.length) bad('An estimate has no lines.');
      for (const line of estimate.lines) {
        if (lines.has(line.id)) bad('The line ' + line.id + ' is used twice in one claim.');
        lines.set(line.id, line);
        amounts(line.amount);
        line.decisions.forEach((decision, index) => {
          if (index && ms(decision.decided_at) < ms(line.decisions[index - 1].decided_at)) bad('The decisions of a line are not in order of time.');
          amounts(decision.amount);
          if ((decision.status === 'approved') !== (decision.amount !== null) || decision.status === 'approved' && decision.amount <= 0) bad('An approved line needs an amount, and a denied line has none.');
        });
      }
    }
    for (const determination of claim.determinations) {
      take(determination.id);
      if (!determination.line_ids.length) bad('A determination names no line.');
      for (const id of determination.line_ids) {
        if (!lines.has(id)) bad('A determination names a line of another claim.');
        if (lines.get(id).decisions.filter(d => d.source === 'determination' && d.source_id === determination.id).length !== 1) bad('A determination and the decisions of its lines do not agree.');
      }
    }
    const disputed = new Set();
    for (const dispute of claim.disputes) {
      take(dispute.id);
      const line = lines.get(dispute.line_id);
      if (!line || dispute.decision_index >= line.decisions.length) bad('A dispute names a line or a decision that does not exist.');
      if (dispute.state === 'open') {
        if (disputed.has(dispute.line_id)) bad('One line has two open disputes.');
        if (dispute.decision_index !== line.decisions.length - 1) bad('An open dispute is on a decision that a newer decision replaced.');
        if (ended !== null || claim.path === 'total_loss') bad('A claim that is not open on the repair path has an open dispute.');
        disputed.add(dispute.line_id);
      }
      if ((dispute.state === 'upheld' || dispute.state === 'changed') !== (dispute.decided_at !== null)) bad('The state of a dispute does not fit its decision time.');
      if ((dispute.state === 'changed') !== line.decisions.some(d => d.source === 'dispute' && d.source_id === dispute.id)) bad('A dispute and the decision of its line do not agree.');
      known(dispute.evidence_ids);
    }
    for (const row of lines.values()) for (const decision of row.decisions) {
      const source = decision.source === 'determination' ? claim.determinations.find(d => d.id === decision.source_id && d.line_ids.includes(row.id))
        : claim.disputes.find(d => d.id === decision.source_id && d.line_id === row.id);
      if (!source) bad('A decision names a determination or a dispute that does not exist.');
    }
    const vehicle = c.vehicleOf(policy, claim.subject_id);
    if ((claim.path === 'total_loss') !== (claim.offers.length > 0)) bad('A claim is on the total_loss path only when it has an offer.');
    claim.offers.forEach((offer, index) => {
      take(offer.id);
      if (!vehicle) bad('An offer is on a claim that is not an auto claim.');
      amounts(offer.valuation, offer.lienholder_payoff);
      if ((offer.lienholder_payoff !== null) !== (vehicle.lienholder !== null)) bad('An offer has a payoff only when the vehicle has a lienholder.');
      if ((offer.state === 'accepted' || offer.state === 'rejected') !== (offer.answered_at !== null)) bad('The state of an offer does not fit its answer time.');
      known(offer.evidence_ids);
      const next = claim.offers[index + 1];
      if (next && ms(next.issued_at) < ms(offer.issued_at)) bad('The offers of a claim are not in order of time.');
      if (next && offer.state === 'accepted') bad('An offer follows an accepted offer.');
      if (next && offer.state === 'open' && ms(offer.respond_by) > ms(next.issued_at)) bad('One claim has two open offers.');
      if (!next && offer.state === 'open' && ended !== null && ms(offer.respond_by) > ended) bad('A claim that is not open has an open offer.');
    });
    const rentals = [...claim.rentals].sort((a, b) => ms(a.start_at) - ms(b.start_at));
    rentals.forEach((rental, index) => {
      take(rental.id);
      amounts(rental.daily_rate);
      if (!policy.rental_benefit) bad('A rental period is on a policy with no rental benefit.');
      if ((rental.state === 'ended') !== (rental.end_at !== null) || rental.end_at !== null && ms(rental.end_at) < ms(rental.start_at)) bad('The state of a rental period does not fit its end time.');
      if (rental.state === 'active' && (index < rentals.length - 1 || ended !== null)) bad(index < rentals.length - 1 ? 'One claim has two active rental periods, or two rental periods that overlap.' : 'A claim that is not open has an active rental period.');
      if (index && ms(rental.start_at) < ms(rentals[index - 1].end_at)) bad('Two rental periods of one claim overlap.');
    });
    for (const payment of claim.payments) {
      take(payment.id);
      amounts(payment.amount);
      if (payment.amount <= 0) bad('A payment has an amount of zero or less.');
      if (payment.payee.kind === 'shop' && payment.payee.name === null) bad('A payment to a shop needs the name of the shop.');
      if (payment.kind === 'settlement' && (payment.payee.kind === 'shop' || claim.path !== 'total_loss')) bad(payment.payee.kind === 'shop' ? 'A settlement payment goes to the lienholder or to the policyholder.' : 'A settlement payment is on a claim on the repair path.');
    }
  }
  for (const notification of data.notifications) {
    take(notification.id);
    if (!data.claims.some(claim => claim.id === notification.claim_id)) bad('A notification names a claim that does not exist.');
  }
  data.activity.forEach((row, index) => {
    if (index && row.seq <= data.activity[index - 1].seq) bad('The activity rows are not in order.');
    if (row.object_id !== data.account_id && !ids.has(row.object_id)) bad('An activity row names an object that does not exist.');
  });
}
module.exports = {validate};
