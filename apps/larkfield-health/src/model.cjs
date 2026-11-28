'use strict';
const { fail, COUNTER, textLength, compareSeq } = require('./util.cjs');
const { ms, toIso, HOUR, MINUTE, localDate, planYear, validDate, endOfDay, dayDeadline } = require('./time.cjs');
const { halfUp, lineOutcome, adjudicate, overturn } = require('./adjudication.cjs');

const invalid = message => fail('invalid_seed', message);
const CATEGORIES = new Set(['office', 'specialist', 'imaging', 'therapy', 'emergency', 'lab', 'surgery', 'pharmacy']);
const ISSUED = new Set(['ir', 'eob', 'ap', 'gr', 'cf', 'n', 'seq', 'post', 'file']);
const RUN_IDS = [['info_requests', 'info_request_id', 'ir'], ['eobs', 'eob_id', 'eob'], ['appeals', 'appeal_id', 'ap'], ['approvals', 'approval_id', 'cf'], ['notices', 'notice_id', 'n']];
const ANSWERS = { other_coverage: new Set(['none', 'other_secondary', 'other_primary']), accident: new Set(['not_accident', 'accident', 'work_related']) };
const OPEN_APPEAL = new Set(['under_review', 'info_requested']);
const AMOUNTS = ['allowed_cents', 'copay_cents', 'deductible_cents', 'coinsurance_cents', 'member_cost_cents', 'plan_paid_cents'];
const big = s => BigInt(s);
const issued = (data, key) => big(data.issued[key] ?? '0');
function same(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object') { const ka = Object.keys(a), kb = Object.keys(b); return ka.length === kb.length && ka.every(k => Object.hasOwn(b, k) && same(a[k], b[k])); }
  return a === b;
}

function unique(list, key, what) {
  const m = new Map();
  for (const r of list) { if (m.has(r[key])) invalid('Duplicate ' + what + ' ' + r[key] + '.'); m.set(r[key], r); }
  return m;
}

function need(map, id, what, where) {
  if (!map.has(id)) invalid(where + ' names an unknown ' + what + ' ' + id + '.');
  return map.get(id);
}

function checkBinding(ctx, data) {
  const owner = (ctx.binding?.accounts || []).find(a => a.app_id === ctx.app_id && a.account_id === data.account_id);
  if (!owner) invalid('The seed account ' + data.account_id + ' is not bound in this run.');
  if (owner.owner_person_id !== data.owner_person_id) invalid('The seed owner ' + data.owner_person_id + ' is not the bound account holder.');
  const bound = new Set((ctx.binding.people || []).map(p => p.person_id));
  for (const m of data.members) if (!bound.has(m.member_id)) invalid('Member ' + m.member_id + ' is not in the run binding.');
  return bound;
}

function checkPlan(data, idx) {
  const years = Object.keys(data.plan.years);
  if (!years.length) invalid('The plan has no plan year.');
  for (const y of years) {
    if (!/^[0-9]{4}$/.test(y) || Number(y) < 2000 || Number(y) > 2199) invalid('Plan year key ' + y + ' is not a year from 2000 to 2199.');
    const p = data.plan.years[y];
    for (const c of Object.keys(p.copays)) if (!CATEGORIES.has(c)) invalid('Plan year ' + y + ' has a copay for an unknown category ' + c + '.');
    if (p.deductible.individual_cents > p.deductible.family_cents) invalid('Plan year ' + y + ' has an individual deductible above the family deductible.');
    if (p.oop_max.individual_cents > p.oop_max.family_cents) invalid('Plan year ' + y + ' has an individual out-of-pocket maximum above the family maximum.');
    if (p.deductible.individual_cents > p.oop_max.individual_cents || p.deductible.family_cents > p.oop_max.family_cents) invalid('Plan year ' + y + ' has a deductible above its out-of-pocket maximum.');
  }
  for (const s of data.plan.pa_services) need(idx.services, s, 'service', 'The plan\'s PA list');
  for (const s of data.services) if (s.fee_cents === null) invalid('Service ' + s.service_id + ' has no fee.');
  for (const [k, v] of Object.entries(data.issued)) { if (!ISSUED.has(k)) invalid('Unknown counter ' + k + '.'); if (!COUNTER.test(v)) invalid('Counter ' + k + ' is not a decimal string.'); }
}

function checkMembers(data, idx) {
  const owner = idx.members.get(data.owner_person_id);
  if (!owner) invalid('The account holder is not a member.');
  for (const m of data.members) {
    if (!validDate(m.birth_date, 1900)) invalid('Member ' + m.member_id + ' has an invalid birth date.');
    for (const g of m.guardian_ids) {
      const guardian = need(idx.members, g, 'guardian', 'Member ' + m.member_id);
      if (g === m.member_id) invalid('Member ' + m.member_id + ' is their own guardian.');
      if (guardian.is_minor) invalid('Guardian ' + g + ' of ' + m.member_id + ' is a minor.');
    }
    if (m.guardian_ids.length && !m.is_minor) invalid('Adult member ' + m.member_id + ' has guardians.');
    if (m.is_minor && !m.guardian_ids.length) invalid('Minor ' + m.member_id + ' has no guardian.');
    if (!m.enrolled_years.length) invalid('Member ' + m.member_id + ' is enrolled in no plan year.');
    for (const y of m.enrolled_years) if (!data.plan.years[String(y)]) invalid('Member ' + m.member_id + ' is enrolled in plan year ' + y + ', which the plan does not cover.');
  }
}

function checkCoverage(data, idx) {
  const seen = new Map();
  for (const c of data.coverage) {
    const label = 'Coverage of ' + c.member_id + ' for ' + c.plan_year;
    const member = need(idx.members, c.member_id, 'member', label);
    if (!member.enrolled_years.includes(c.plan_year)) invalid(label + ' is for a year the member is not enrolled in.');
    const key = c.member_id + ':' + c.plan_year;
    if (seen.has(key)) invalid(label + ' is recorded twice.');
    seen.set(key, c);
    if ((c.status === 'unknown') !== (c.attested_at === null)) invalid(label + ' has an attestation time that does not match its status.');
  }
  for (const m of data.members) for (const y of m.enrolled_years) if (!seen.has(m.member_id + ':' + y)) invalid('Member ' + m.member_id + ' has no coverage record for ' + y + '.');
  return seen;
}

function checkClaims(data, idx) {
  const seqs = new Set();
  for (const c of data.claims) {
    const label = 'Claim ' + c.claim_id;
    const member = need(idx.members, c.member_id, 'member', label);
    need(idx.providers, c.provider_id, 'provider', label);
    if (seqs.has(big(c.received_seq))) invalid(label + ' repeats received_seq ' + c.received_seq + '.');
    seqs.add(big(c.received_seq));
    if (big(c.received_seq) > issued(data, 'seq')) invalid(label + ' has received_seq above the issued counter.');
    if (ms(c.review_at) !== dayDeadline(c.received_at, 3)) invalid(label + ' review time is not 23:59 local three days after receipt.');
    const lines = new Set();
    c.lines.forEach((l, i) => {
      if (lines.has(l.line_id)) invalid(label + ' repeats line ' + l.line_id + '.');
      lines.add(l.line_id);
      if (l.position !== i + 1) invalid(label + ' line ' + l.line_id + ' is not at position ' + (i + 1) + '.');
      if (!validDate(l.service_date)) invalid(label + ' line ' + l.line_id + ' has an invalid service date.');
      if (l.service_date > localDate(ms(c.received_at))) invalid(label + ' line ' + l.line_id + ' is dated after receipt.');
      const service = need(idx.services, l.service_id, 'service', label);
      if (service.category === 'pharmacy') invalid(label + ' line ' + l.line_id + ' names a pharmacy service.');
      if (!member.enrolled_years.includes(planYear(l.service_date))) invalid(label + ' line ' + l.line_id + ' falls outside the member\'s enrolment.');
    });
  }
}

function coverageAtReview(cov, claim, line) {
  const c = cov.get(claim.member_id + ':' + planYear(line.service_date));
  return c.attested_at === null || ms(c.attested_at) >= ms(claim.review_at) ? 'unknown' : c.status;
}

function checkRequests(data, idx, cov) {
  const byClaim = new Map(data.claims.map(c => [c.claim_id, []]));
  const keys = new Set();
  for (const r of data.info_requests) {
    const label = 'Information request ' + r.info_request_id;
    const claim = need(idx.claims, r.claim_id, 'claim', label);
    const line = claim.lines.find(l => l.line_id === r.line_id);
    if (!line) invalid(label + ' names an unknown line ' + r.line_id + ' of ' + r.claim_id + '.');
    const key = r.claim_id + '|' + r.line_id + '|' + r.type;
    if (keys.has(key)) invalid(label + ' repeats a request of its type on line ' + r.line_id + '.');
    keys.add(key);
    if (r.plan_year !== planYear(line.service_date)) invalid(label + ' plan year differs from its line\'s service year.');
    if (ms(r.opened_at) !== ms(claim.review_at)) invalid(label + ' was not opened at its claim\'s review.');
    if (ms(r.expires_at) !== dayDeadline(r.opened_at, 45)) invalid(label + ' expiry is not 23:59 local 45 days after it opened.');
    if (r.status === 'answered') {
      if (!ANSWERS[r.type].has(r.answer) || r.answered_at === null) invalid(label + ' is answered without a valid answer and time.');
      if (ms(r.answered_at) < ms(r.opened_at) || ms(r.answered_at) >= ms(r.expires_at)) invalid(label + ' was answered outside its open period.');
    } else if (r.answer !== null || r.answered_at !== null) invalid(label + ' carries an answer while ' + r.status + '.');
    if (r.type === 'other_coverage') {
      const c = cov.get(claim.member_id + ':' + r.plan_year);
      if (r.status === 'open' && c.status !== 'unknown') invalid(label + ' is still open although coverage for ' + r.plan_year + ' was attested.');
      if (r.status === 'answered' && (r.answer !== c.status || ms(r.answered_at) !== ms(c.attested_at))) invalid(label + ' answer differs from the attestation that answered it.');
      if (r.status === 'expired' && c.attested_at !== null && ms(c.attested_at) < ms(r.expires_at)) invalid(label + ' expired although coverage was attested before its expiry.');
    }
    byClaim.get(r.claim_id).push(r);
  }
  for (const c of data.claims) {
    const label = 'Claim ' + c.claim_id;
    const requests = byClaim.get(c.claim_id), open = requests.filter(r => r.status === 'open');
    const eobs = data.eobs.filter(e => e.claim_id === c.claim_id);
    if (c.status === 'received' && (requests.length || eobs.length || c.processed_at !== null)) invalid(label + ' is received but already has requests, an EOB or a processing time.');
    if (c.status === 'pending_info' && (!open.length || eobs.length || c.processed_at !== null)) invalid(label + ' is pending information without an open request, or with an EOB.');
    if (c.status === 'processed' && (open.length || c.processed_at === null)) invalid(label + ' is processed with an open request or without a processing time.');
    if (c.status === 'received') continue;
    const expected = [];
    for (const l of c.lines) {
      const at = coverageAtReview(cov, c, l);
      if (at === 'other_primary') continue;
      if (at === 'unknown') expected.push(l.line_id + '|other_coverage');
      if (l.possible_accident) expected.push(l.line_id + '|accident');
    }
    const actual = requests.map(r => r.line_id + '|' + r.type);
    if (!same([...expected].sort(), [...actual].sort())) invalid(label + ' carries requests other than those its review opens.');
    if (c.status === 'processed') {
      const closes = requests.map(r => ms(r.status === 'answered' ? r.answered_at : r.expires_at));
      const v1at = Math.max(ms(c.review_at), ...closes);
      if (ms(c.processed_at) !== v1at) invalid(label + ' was processed at ' + c.processed_at + ', not when its review or its last request closed (' + toIso(v1at) + ').');
    }
  }
  return byClaim;
}

function checkEobLine(label, claimLine, line, service, plan, category) {
  const allowed = Math.min(claimLine.billed_cents, service.fee_cents * claimLine.units);
  if (line.not_allowed_cents !== claimLine.billed_cents - (line.status === 'paid' ? allowed : 0)) invalid(label + ' not-allowed amount does not match the billed and allowed amounts.');
  if (line.status === 'denied') {
    if (line.reason === null || AMOUNTS.some(k => line[k] !== 0) || line.pa_id !== null || line.pa_units !== 0) invalid(label + ' is denied with a missing reason, an amount or PA use.');
    return;
  }
  if (line.reason !== null) invalid(label + ' is paid with a denial reason.');
  if (line.allowed_cents !== allowed) invalid(label + ' allowed amount is not the lesser of billed and fee times units.');
  if (line.member_cost_cents !== line.copay_cents + line.deductible_cents + line.coinsurance_cents) invalid(label + ' member cost is not copay plus deductible plus coinsurance.');
  if (line.plan_paid_cents !== allowed - line.member_cost_cents || line.plan_paid_cents < 0) invalid(label + ' plan payment is not the allowed amount less the member cost.');
  const copay = plan.copays[category];
  if (copay !== undefined) {
    if (line.deductible_cents !== 0 || line.coinsurance_cents !== 0 || line.copay_cents > copay) invalid(label + ' copay line carries a deductible, coinsurance or more than its copay.');
  } else if (line.copay_cents !== 0 || line.coinsurance_cents > halfUp(allowed - line.deductible_cents, plan.coinsurance_pct)) invalid(label + ' deductible line carries a copay or more than its deductible and coinsurance allow.');
}

function checkEobs(data, idx, byClaim, cov) {
  const versions = new Map(), posts = new Set();
  for (const e of data.eobs) {
    const label = 'EOB ' + e.eob_id;
    const claim = need(idx.claims, e.claim_id, 'claim', label);
    if (posts.has(big(e.posting_seq))) invalid(label + ' repeats posting_seq ' + e.posting_seq + '.');
    posts.add(big(e.posting_seq));
    if (big(e.posting_seq) > issued(data, 'post')) invalid(label + ' has posting_seq above the issued counter.');
    if (!versions.has(e.claim_id)) versions.set(e.claim_id, []);
    versions.get(e.claim_id).push(e);
    const ids = e.lines.map(l => l.line_id);
    if (!same([...ids].sort(), claim.lines.map(l => l.line_id).sort())) invalid(label + ' does not list each line of ' + e.claim_id + ' exactly once.');
    const years = [...new Set(claim.lines.map(l => planYear(l.service_date)))].sort();
    if (!same(Object.keys(e.ledger_before).sort(), years.map(String))) invalid(label + ' ledger snapshot does not cover exactly the plan years its lines touch.');
    for (const l of e.lines) {
      const cl = claim.lines.find(x => x.line_id === l.line_id), service = idx.services.get(cl.service_id), year = planYear(cl.service_date);
      checkEobLine(label + ' line ' + l.line_id, cl, l, service, data.plan.years[String(year)], service.category);
      if (l.pa_id !== null && (cl.emergency || !data.plan.pa_services.includes(cl.service_id))) invalid(label + ' line ' + l.line_id + ' uses a PA although it is an emergency or not PA-listed.');
      if ((l.pa_id === null) !== (l.pa_units === 0)) invalid(label + ' line ' + l.line_id + ' has PA units without a PA, or a PA without units.');
      if (l.pa_id !== null && l.pa_units !== cl.units) invalid(label + ' line ' + l.line_id + ' PA units differ from the line\'s units.');
      if (l.pa_id !== null) {
        const pa = need(idx.pas, l.pa_id, 'PA', label + ' line ' + l.line_id);
        if (pa.member_id !== claim.member_id || pa.service_id !== cl.service_id || pa.approved === null || cl.service_date < pa.approved.valid_from || cl.service_date > pa.approved.valid_until) invalid(label + ' line ' + l.line_id + ' names a PA that does not cover it.');
        if (e.version === 1 && (!COUNTER.test(pa.approved_after_post) || big(pa.approved_after_post) >= big(e.posting_seq))) invalid(label + ' line ' + l.line_id + ' names a PA approved after it posted.');
      }
    }
    const sums = years.map(y => {
      const mine = e.lines.filter(l => planYear(claim.lines.find(x => x.line_id === l.line_id).service_date) === y);
      return { member_id: claim.member_id, plan_year: y, deductible_cents: mine.reduce((s, l) => s + l.deductible_cents, 0), oop_cents: mine.reduce((s, l) => s + l.member_cost_cents, 0) };
    });
    if (!same([...e.postings].sort((a, b) => a.plan_year - b.plan_year), sums)) invalid(label + ' postings are not the sums of its lines per plan year.');
  }
  for (const c of data.claims) {
    const list = (versions.get(c.claim_id) || []).sort((a, b) => a.version - b.version);
    if (c.status === 'processed' && !list.length) invalid('Claim ' + c.claim_id + ' is processed without an EOB.');
    list.forEach((e, i) => {
      const label = 'EOB ' + e.eob_id;
      if (e.version !== i + 1) invalid('Claim ' + c.claim_id + ' EOB versions are not contiguous from 1.');
      if (i === 0) {
        if (e.reason !== 'initial' || e.appeal_id !== null) invalid(label + ' is version 1 but not an initial EOB.');
        if (ms(e.issued_at) !== ms(c.processed_at)) invalid(label + ' was not issued when its claim was processed.');
        for (const l of e.lines) {
          const cl = c.lines.find(x => x.line_id === l.line_id), mine = byClaim.get(c.claim_id).filter(r => r.line_id === l.line_id);
          const paListed = !cl.emergency && data.plan.pa_services.includes(cl.service_id);
          if (l.status === 'paid' && paListed && l.pa_id === null) invalid(label + ' line ' + l.line_id + ' is a paid PA-listed line without a PA.');
          const outcome = lineOutcome(coverageAtReview(cov, c, cl), mine);
          const network = !cl.emergency && !idx.providers.get(c.provider_id).in_network;
          const want = outcome ?? (network ? 'out_of_network' : null);
          if (want !== null ? l.reason !== want : l.status === 'denied' && !(paListed && l.reason === 'prior_auth_missing')) invalid(label + ' line ' + l.line_id + ' outcome does not follow its requests, network and PA rules.');
        }
        return;
      }
      const prev = list[i - 1];
      if (e.reason !== 'appeal' || e.appeal_id === null) invalid(label + ' is a later version without its appeal.');
      const appeal = need(idx.appeals, e.appeal_id, 'appeal', label);
      if (appeal.target.type !== 'claim' || appeal.target.id !== c.claim_id || appeal.status !== 'overturned') invalid(label + ' names an appeal that did not overturn claim ' + c.claim_id + '.');
      if (ms(e.issued_at) !== ms(appeal.decided_at) || ms(e.issued_at) < ms(prev.issued_at)) invalid(label + ' was not issued when its appeal was decided.');
      const changed = e.lines.filter(l => !same(l, prev.lines.find(x => x.line_id === l.line_id))).map(l => l.line_id).sort();
      if (!appeal.outcome || !Array.isArray(appeal.outcome.lines) || !same(changed, [...appeal.outcome.lines].sort())) invalid(label + ' changes lines other than those its appeal overturned.');
      for (const id of changed) {
        const before = prev.lines.find(x => x.line_id === id), after = e.lines.find(x => x.line_id === id);
        if (before.status !== 'denied' || after.status !== 'paid' || after.pa_id !== null) invalid(label + ' line ' + id + ' was not a denied line repriced as covered without a PA.');
      }
    });
  }
  for (const a of data.appeals) if (a.status === 'overturned' && a.target.type === 'claim' && data.eobs.filter(e => e.appeal_id === a.appeal_id).length !== 1) invalid('Overturned appeal ' + a.appeal_id + ' does not have exactly one EOB version.');
  return versions;
}

function checkLedger(data, idx, versions) {
  const enrolled = y => data.members.filter(m => m.enrolled_years.includes(y)).map(m => m.member_id);
  const running = new Map(), cell = (m, y) => running.get(m + ':' + y) || { deductible_cents: 0, oop_cents: 0 };
  const family = y => enrolled(y).reduce((s, m) => ({ deductible_cents: s.deductible_cents + cell(m, y).deductible_cents, oop_cents: s.oop_cents + cell(m, y).oop_cents }), { deductible_cents: 0, oop_cents: 0 });
  const prevOf = e => (e.version > 1 ? versions.get(e.claim_id).find(x => x.version === e.version - 1) : null);
  for (const e of [...data.eobs].sort((a, b) => (big(a.posting_seq) < big(b.posting_seq) ? -1 : 1))) {
    const member = idx.claims.get(e.claim_id).member_id, prev = prevOf(e);
    if (prev && big(prev.posting_seq) > big(e.posting_seq)) invalid('EOB ' + e.eob_id + ' posted before its predecessor.');
    for (const [y, snap] of Object.entries(e.ledger_before)) {
      const want = { member: cell(member, Number(y)), family: family(Number(y)) };
      if (!same(snap, want)) invalid('EOB ' + e.eob_id + ' ledger before posting does not equal the running ledger for ' + y + '.');
    }
    for (const p of e.postings) {
      const before = prev ? prev.postings.find(x => x.plan_year === p.plan_year) : null, c = cell(member, p.plan_year);
      running.set(member + ':' + p.plan_year, { deductible_cents: c.deductible_cents + p.deductible_cents - (before ? before.deductible_cents : 0), oop_cents: c.oop_cents + p.oop_cents - (before ? before.oop_cents : 0) });
    }
  }
  const accs = new Map();
  for (const a of data.accumulators) {
    const label = 'Accumulator of ' + a.member_id + ' for ' + a.plan_year;
    const m = need(idx.members, a.member_id, 'member', label);
    if (!m.enrolled_years.includes(a.plan_year)) invalid(label + ' is for a year the member is not enrolled in.');
    if (accs.has(a.member_id + ':' + a.plan_year)) invalid(label + ' is recorded twice.');
    accs.set(a.member_id + ':' + a.plan_year, a);
    const c = cell(a.member_id, a.plan_year);
    if (a.deductible_cents !== c.deductible_cents || a.oop_cents !== c.oop_cents) invalid(label + ' does not equal the sum of its current EOB postings.');
    const p = data.plan.years[String(a.plan_year)];
    if (a.deductible_cents > p.deductible.individual_cents || a.oop_cents > p.oop_max.individual_cents || a.deductible_cents > a.oop_cents) invalid(label + ' is outside the plan\'s individual limits.');
  }
  for (const m of data.members) for (const y of m.enrolled_years) if (!accs.has(m.member_id + ':' + y)) invalid('Member ' + m.member_id + ' has no accumulator for ' + y + '.');
  for (const y of Object.keys(data.plan.years)) {
    const f = family(Number(y)), p = data.plan.years[y];
    if (f.deductible_cents > p.deductible.family_cents || f.oop_cents > p.oop_max.family_cents) invalid('Family accumulators for ' + y + ' are outside the plan\'s family limits.');
  }
}

const rank = p => p.approved.valid_until + '|' + p.pa_id;

function checkPas(data, idx, versions) {
  const covered = new Set();
  for (const p of data.pas) {
    const label = 'PA ' + p.pa_id;
    need(idx.members, p.member_id, 'member', label);
    const provider = need(idx.providers, p.provider_id, 'provider', label), service = need(idx.services, p.service_id, 'service', label);
    if (service.category === 'pharmacy' && !['pharmacy', 'prescriber'].includes(provider.kind)) invalid(label + ' is a pharmacy PA from a provider that is not a pharmacy or prescriber.');
    for (const d of [p.requested.valid_from, p.requested.valid_until]) if (!validDate(d, 2000, 2200)) invalid(label + ' has an invalid requested date.');
    if (p.requested.valid_from > p.requested.valid_until) invalid(label + ' has an inverted requested interval.');
    const fast = p.expedite && p.expedite.status === 'approved';
    if (ms(p.due_at) !== (fast ? Math.min(dayDeadline(p.submitted_at, 15), ms(p.expedite.requested_at) + 72 * HOUR) : dayDeadline(p.submitted_at, 15))) invalid(label + ' decision due time is not 15 days after submission, or the earlier expedited time once expedite was approved.');
    const d15 = dayDeadline(p.submitted_at, 15), od = p.overdue_at === null ? null : ms(p.overdue_at), ed = fast ? ms(p.expedite.decided_at) : null;
    if (fast && ms(p.due_at) <= ed && !p.overdue) invalid(label + ' had its expedite approved at or after its accelerated due time without becoming overdue.');
    const pendingSteps = [...p.info_requests.map(r => r.at), ...(p.expedite ? [p.expedite.requested_at, p.expedite.decided_at] : [])].filter(t => t !== null);
    if (!p.overdue && pendingSteps.some(t => ms(t) >= ms(p.due_at))) invalid(label + ' records a step only a pending PA takes at or after its due time without becoming overdue.');
    const overdueTimes = fast ? (od === d15 && d15 <= ed) || (od === ed && ms(p.due_at) <= ed && ed < d15) || (od === ms(p.due_at) && ms(p.due_at) > ed) : od === ms(p.due_at);
    if (p.overdue !== (p.overdue_at !== null) || (p.overdue && !overdueTimes)) invalid(label + ' overdue flag and time disagree with its due times and expedite decision.');
    const overturnedPa = data.appeals.some(a => a.target.type === 'pa' && a.target.id === p.pa_id && a.status === 'overturned');
    const firstDecision = overturnedPa ? p.denial_notice_at : p.decided_at;
    if (firstDecision !== null && ms(firstDecision) >= ms(p.due_at) && (!p.overdue || ms(p.overdue_at) > ms(firstDecision))) invalid(label + ' was decided at or after its due time without becoming overdue first.');
    const decided = ['approved', 'denied', 'expired'].includes(p.status);
    if (decided !== (p.decided_at !== null)) invalid(label + ' decision time does not match its status.');
    if (firstDecision !== null && (ms(firstDecision) < ms(p.submitted_at) || ms(p.decided_at) < ms(firstDecision))) invalid(label + ' was decided before it was submitted.');
    if (p.overdue && firstDecision !== null && ms(p.overdue_at) > ms(firstDecision)) invalid(label + ' became overdue after its decision.');
    if ((p.approved !== null) !== ['approved', 'expired'].includes(p.status)) invalid(label + ' approved terms do not match its status.');
    if ((p.approved !== null) !== (p.approved_after_post !== null)) invalid(label + ' approval posting mark does not match its approved terms.');
    if (p.approved_after_post !== null) {
      if (!COUNTER.test(p.approved_after_post) || big(p.approved_after_post) > issued(data, 'post')) invalid(label + ' approval posting mark is above the issued counter.');
      const mark = big(p.approved_after_post), at = ms(p.decided_at);
      for (const e of data.eobs) {
        const before = big(e.posting_seq) <= mark, t = ms(e.issued_at);
        if (t !== at ? before !== (t < at) : !before && timerIssued(data, idx, e)) invalid(label + ' approval posting mark does not match the EOBs issued around its decision.');
      }
    }
    if ((p.status === 'expired') !== (p.expired_at !== null)) invalid(label + ' expiry time does not match its status.');
    if (p.approved !== null) {
      for (const d of [p.approved.valid_from, p.approved.valid_until]) if (!validDate(d, 2000, 2200)) invalid(label + ' has an invalid approved date.');
      const cutoff = endOfDay(p.approved.valid_until);
      if (p.status === 'expired' && ms(p.expired_at) !== Math.max(cutoff, ms(p.decided_at))) invalid(label + ' expired at neither its validity end nor its decision past that end.');
      if (p.approved.valid_from > p.approved.valid_until && !(p.status === 'expired' && ms(p.decided_at) === ms(p.expired_at) && ms(p.expired_at) >= cutoff)) invalid(label + ' has an inverted approved interval outside an immediate expiry.');
      const used = [...versions.values()].map(l => l[l.length - 1]).flatMap(e => e.lines).filter(l => l.pa_id === p.pa_id).reduce((s, l) => s + l.pa_units, 0);
      if (p.units_used !== used || p.units_used > p.approved.units) invalid(label + ' units used differ from its paid lines or exceed the approved units.');
    } else if (p.units_used !== 0) invalid(label + ' has units used without approval.');
    const overturned = data.appeals.some(a => a.target.type === 'pa' && a.target.id === p.pa_id && a.status === 'overturned');
    if ((p.denial_notice_at !== null) !== (p.status === 'denied' || overturned) || (overturned && p.approved === null)) invalid(label + ' denial notice time does not match its status.');
    if (p.status === 'denied' && ms(p.denial_notice_at) !== ms(p.decided_at)) invalid(label + ' denial notice is not dated at its decision.');
    if (p.status === 'info_requested' && !p.info_requests.length) invalid(label + ' is waiting for information it never requested.');
    for (const r of p.info_requests) if (ms(r.at) < ms(p.submitted_at) || textLength(r.text) < 1 || textLength(r.text) > 2000) invalid(label + ' has an information request before submission or with a text outside 1 to 2,000 characters.');
    if (p.expedite && p.expedite.reason !== null && (textLength(p.expedite.reason) < 1 || textLength(p.expedite.reason) > 2000)) invalid(label + ' expedite reason is outside 1 to 2,000 characters.');
    for (const t of [...p.info_requests.map(r => r.at), ...(p.expedite ? [p.expedite.requested_at, p.expedite.decided_at] : [])]) if (t !== null && firstDecision !== null && ms(t) > ms(firstDecision)) invalid(label + ' records an information or expedite step after its decision.');
    if (p.expedite) {
      const x = p.expedite;
      if (ms(x.requested_at) < ms(p.submitted_at) || (x.status === 'open') !== (x.decided_at === null) || (x.decided_at !== null && ms(x.decided_at) < ms(x.requested_at))) invalid(label + ' expedite record is inconsistent.');
    }
    for (const s of p.covered_submissions) {
      if (service.category === 'pharmacy' && !['pharmacy', 'prescriber'].includes(need(idx.providers, s.provider_id, 'provider', label + ' covered submission').kind)) invalid(label + ' covered submission ' + s.pa_id + ' comes from a provider that is not a pharmacy or prescriber.');
      if (covered.has(s.pa_id) || idx.pas.has(s.pa_id)) invalid(label + ' covered submission ' + s.pa_id + ' repeats a PA ID.');
      covered.add(s.pa_id);
      need(idx.providers, s.provider_id, 'provider', label + ' covered submission');
      if (p.approved === null || ms(s.at) < ms(p.decided_at) || s.valid_from < p.approved.valid_from || s.valid_until > p.approved.valid_until || s.valid_from > s.valid_until) invalid(label + ' covered submission ' + s.pa_id + ' is not inside its approval.');
      if (!validDate(s.valid_from, 2000, 2200) || !validDate(s.valid_until, 2000, 2200) || ms(s.at) >= endOfDay(p.approved.valid_until)) invalid(label + ' covered submission ' + s.pa_id + ' has an invalid date or came after the approval ended.');
      const usedBefore = data.eobs.filter(e => e.version === 1 && (ms(e.issued_at) < ms(s.at) || (ms(e.issued_at) === ms(s.at) && timerIssued(data, idx, e)))).flatMap(e => e.lines).filter(l => l.pa_id === p.pa_id).reduce((t, l) => t + l.pa_units, 0);
      if (s.units > p.approved.units - usedBefore) invalid(label + ' covered submission ' + s.pa_id + ' asks for more units than remained.');
      const posted = data.eobs.filter(e => e.version === 1 && ms(e.issued_at) <= ms(s.at)).flatMap(e => e.lines);
      const first = data.pas.find(q => q.approved !== null && q.member_id === p.member_id && q.service_id === p.service_id && rank(q) < rank(p) && ms(q.decided_at) < ms(s.at) && (q.expired_at === null || ms(q.expired_at) > ms(s.at))
        && q.approved.valid_from <= s.valid_from && s.valid_until <= q.approved.valid_until && q.approved.units - posted.filter(l => l.pa_id === q.pa_id).reduce((t, l) => t + l.pa_units, 0) >= s.units);
      if (first) invalid(label + ' covered submission ' + s.pa_id + ' belongs under ' + first.pa_id + ', which comes first in the plan\'s order and was approved before the intake with enough units left.');
    }
  }
}

function checkPricing(data, idx, byClaim, cov) {
  const used = new Map();
  for (const e of [...data.eobs].sort((a, b) => compareSeq(a.posting_seq, b.posting_seq))) {
    const c = idx.claims.get(e.claim_id), label = 'EOB ' + e.eob_id;
    let want;
    if (e.version === 1) {
      const requests = byClaim.get(c.claim_id);
      const outcomes = Object.fromEntries(c.lines.map(l => [l.line_id, lineOutcome(coverageAtReview(cov, c, l), requests.filter(r => r.line_id === l.line_id))]));
      const pas = data.pas.filter(p => p.member_id === c.member_id && p.approved !== null && big(p.approved_after_post) < big(e.posting_seq))
        .map(p => ({ pa_id: p.pa_id, service_id: p.service_id, valid_from: p.approved.valid_from, valid_until: p.approved.valid_until, remaining: p.approved.units - (used.get(p.pa_id) || 0) }));
      want = adjudicate({ plan: data.plan, services: idx.services, provider: idx.providers.get(c.provider_id), memberId: c.member_id, lines: c.lines, ledger: e.ledger_before, outcomes, pas });
      for (const u of want.pa_use) used.set(u.pa_id, (used.get(u.pa_id) || 0) + u.units);
    } else {
      want = overturn({ plan: data.plan, services: idx.services, memberId: c.member_id, lines: c.lines, previous: e.lines, named: idx.appeals.get(e.appeal_id).outcome.lines, ledger: e.ledger_before });
    }
    for (const l of e.lines) {
      const w = want.lines.find(x => x.line_id === l.line_id);
      if (l.pa_id !== w.pa_id) invalid(label + ' line ' + l.line_id + ' outcome differs from the plan\'s choice among the PAs approved before it posted, with the units left then: it selects ' + w.pa_id + '.');
      if (!same(l, w)) invalid(label + ' line ' + l.line_id + ' amounts differ from the plan\'s pricing against the ledger before it posted, advanced through the lines before it.');
    }
  }
}

function timerIssued(data, idx, e) {
  if (e.version !== 1) return false;
  const c = idx.claims.get(e.claim_id), t = ms(e.issued_at);
  const requests = data.info_requests.filter(r => r.claim_id === e.claim_id);
  if (t === ms(c.review_at) && !requests.length) return true;
  return requests.some(r => r.status === 'expired' && ms(r.expires_at) === t) && !requests.some(r => r.status === 'answered' && ms(r.answered_at) === t);
}

function appealableAt(data, target, t) {
  if (data.appeals.some(a => a.target.type === target.type && a.target.id === target.id && (a.status === 'upheld' || a.status === 'overturned') && ms(a.decided_at) < t)) return false;
  if (target.type === 'pa') return true;
  const current = data.eobs.filter(e => e.claim_id === target.id && ms(e.issued_at) < t).sort((a, b) => b.version - a.version)[0];
  return Boolean(current) && current.lines.some(l => l.status === 'denied');
}

function chainOrder(a, b) {
  const d = ms(a.filed_at) - ms(b.filed_at);
  return d !== 0 ? d : (big(a.filed_seq) < big(b.filed_seq) ? -1 : 1);
}

const latest = list => Math.max(...list.map(x => ms(x.at)));
const times = list => list.map(x => ms(x.at)).sort((x, y) => x - y);

function lastAnswered(a) {
  const asks = times(a.info_requests), says = times(a.statements.slice(1));
  let j = 0;
  const reply = (from, to) => {
    while (says[j] < from) j++;
    if (j === says.length || says[j] > to) return false;
    j++;
    return true;
  };
  for (let i = 1; i < asks.length; i++) if (!reply(asks[i - 1], asks[i])) return null;
  return !asks.length || reply(asks[asks.length - 1], Infinity);
}

function checkAppeals(data, idx, versions, windows) {
  const seqs = new Set(), byTarget = new Map();
  for (const a of data.appeals) {
    const label = 'Appeal ' + a.appeal_id;
    const target = a.target.type === 'claim' ? need(idx.claims, a.target.id, 'claim', label) : need(idx.pas, a.target.id, 'PA', label);
    if (target.member_id !== a.member_id) invalid(label + ' member differs from its target\'s member.');
    if (seqs.has(big(a.filed_seq)) || big(a.filed_seq) > issued(data, 'file')) invalid(label + ' filing sequence repeats or is above the issued counter.');
    seqs.add(big(a.filed_seq));
    const w = windows.get(a.target.type + ':' + a.target.id);
    if (!w || ms(a.filed_at) < ms(w.notice_at) || ms(a.filed_at) >= ms(w.ends_at)) invalid(label + ' was filed outside its target\'s appeal window.');
    if (a.target.type === 'claim') {
      if (a.expedited || a.lines === null || !a.lines.length) invalid(label + ' is a claim appeal that is expedited or names no lines.');
      const v1 = (versions.get(a.target.id) || []).find(e => e.version === 1);
      const denied = v1 ? v1.lines.filter(l => l.status === 'denied').map(l => l.line_id).sort() : [];
      if (!same([...a.lines].sort(), denied)) invalid(label + ' lines are not the denied lines of its claim\'s EOB v1.');
      if (ms(a.due_at) !== dayDeadline(a.filed_at, 60)) invalid(label + ' is not due 60 days after filing.');
    } else {
      if (a.lines !== null) invalid(label + ' is a PA appeal that names lines.');
      if (ms(a.due_at) !== (a.expedited ? ms(a.filed_at) + 72 * HOUR : dayDeadline(a.filed_at, 30))) invalid(label + ' due time does not follow its filing.');
    }
    if (a.overdue !== (a.overdue_at !== null) || (a.overdue && ms(a.overdue_at) !== ms(a.due_at))) invalid(label + ' overdue flag and time disagree.');
    const endedAt = a.decided_at ?? a.withdrawn_at;
    if (endedAt !== null && ms(endedAt) >= ms(a.due_at) && !a.overdue) invalid(label + ' ended at or after its due time without becoming overdue first.');
    for (const x of [...a.statements, ...a.info_requests]) if (endedAt !== null && ms(x.at) > ms(endedAt)) invalid(label + ' records a statement or request after it ended.');
    for (const x of [...a.statements, ...a.info_requests]) if (textLength(x.text) < 1 || textLength(x.text) > 2000) invalid(label + ' has a statement or request text outside 1 to 2,000 characters.');
    const open = OPEN_APPEAL.has(a.status), decided = a.status === 'upheld' || a.status === 'overturned';
    if (decided !== (a.decided_at !== null) || (a.status === 'withdrawn') !== (a.withdrawn_at !== null)) invalid(label + ' decision or withdrawal time does not match its status.');
    if ((a.status === 'overturned') !== (a.outcome !== null)) invalid(label + ' outcome does not match its status.');
    if (a.overdue && !open && ms(a.overdue_at) > ms(a.decided_at ?? a.withdrawn_at)) invalid(label + ' became overdue after it ended.');
    if (a.outcome) {
      const claimOutcome = a.target.type === 'claim';
      if (claimOutcome ? (!a.outcome.lines || !a.outcome.lines.length || a.outcome.lines.some(l => !a.lines.includes(l)) || a.outcome.units !== null || a.outcome.valid_until !== null)
        : (a.outcome.lines !== null || a.outcome.units === null || !validDate(a.outcome.valid_until, 2000, 2200))) invalid(label + ' outcome does not fit its target.');
      if (!claimOutcome) {
        const pa = target;
        if (pa.approved === null || pa.approved.units !== a.outcome.units || pa.approved.valid_until !== a.outcome.valid_until || pa.approved.valid_from !== localDate(ms(a.decided_at)) || ms(pa.decided_at) !== ms(a.decided_at)) invalid(label + ' overturn is not reflected in PA ' + pa.pa_id + '.');
      }
    }
    if (!a.statements.length || ms(a.statements[0].at) !== ms(a.filed_at)) invalid(label + ' has no filing statement.');
    for (const s of a.statements) { if (ms(s.at) < ms(a.filed_at)) invalid(label + ' has a statement before filing.'); if (!idx.bound.has(s.by)) invalid(label + ' statement is by an unknown person ' + s.by + '.'); }
    for (const r of a.info_requests) if (ms(r.at) < ms(a.filed_at)) invalid(label + ' has an information request before filing.');
    const answered = lastAnswered(a);
    if (answered === null) invalid(label + ' has an information request recorded while an earlier one was still unanswered.');
    if (a.status === 'info_requested' && latest(a.info_requests) < latest(a.statements)) invalid(label + ' is waiting for information it never requested, or a statement came after its latest request.');
    if (a.status === 'under_review' && !answered) invalid(label + ' is under review although its latest information request came after its latest statement.');
    const key = a.target.type + ':' + a.target.id;
    if (!byTarget.has(key)) byTarget.set(key, []);
    byTarget.get(key).push(a);
  }
  for (const [key, list] of byTarget) {
    list.sort(chainOrder);
    list.forEach((a, i) => {
      if (i === list.length - 1) return;
      const next = list[i + 1];
      if (a.status !== 'withdrawn' || ms(a.withdrawn_at) > ms(next.filed_at)) invalid('Appeal ' + next.appeal_id + ' on ' + key + ' was filed while ' + a.appeal_id + ' was open or decided.');
    });
  }
}

function checkWindows(data, idx, versions) {
  const windows = new Map(), expected = new Map();
  for (const [claim, list] of versions) if (list[0].lines.some(l => l.status === 'denied')) expected.set('claim:' + claim, list[0].issued_at);
  for (const p of data.pas) if (p.denial_notice_at !== null) expected.set('pa:' + p.pa_id, p.denial_notice_at);
  for (const w of data.windows) {
    const key = w.target.type + ':' + w.target.id;
    if (windows.has(key)) invalid('Appeal window of ' + key + ' is recorded twice.');
    windows.set(key, w);
    if (!expected.has(key) || ms(expected.get(key)) !== ms(w.notice_at)) invalid('Appeal window of ' + key + ' does not belong to a denial notice of its target.');
    if (ms(w.ends_at) !== dayDeadline(w.notice_at, 180)) invalid('Appeal window of ' + key + ' does not end 180 days after its notice.');
    if (ms(w.closing.due_at) !== dayDeadline(w.notice_at, 166)) invalid('Appeal window of ' + key + ' closing notice is not due 14 days before it ends.');
    if (w.closing.notice_at !== null && (!w.closing.done || ms(w.closing.notice_at) !== ms(w.closing.due_at))) invalid('Appeal window of ' + key + ' records a closing notice off its due time or while not done.');
    if (w.closing.done && (w.closing.notice_at !== null) !== appealableAt(data, w.target, ms(w.closing.due_at))) invalid('Appeal window of ' + key + ' closing notice does not match whether the target was appealable at the closing time.');
  }
  for (const key of expected.keys()) if (!windows.has(key)) invalid('The denial of ' + key + ' has no appeal window.');
  return windows;
}

function checkGrants(data, idx) {
  const pairs = new Map();
  for (const g of data.grants) {
    const label = 'Grant ' + g.grant_id;
    const member = need(idx.members, g.member_id, 'member', label);
    if (!idx.bound.has(g.grantee_id)) invalid(label + ' grantee ' + g.grantee_id + ' is not in the run binding.');
    if (g.grantee_id === g.member_id) invalid(label + ' grants a member access to their own records.');
    if (member.is_minor ? !member.guardian_ids.includes(g.grantor_id) : g.grantor_id !== g.member_id) invalid(label + ' grantor may not grant access to ' + g.member_id + '.');
    if (g.expires_at !== null && ms(g.expires_at) <= ms(g.created_at)) invalid(label + ' expires before it was created.');
    if ((g.status === 'revoked') !== (g.revoked_at !== null)) invalid(label + ' revocation time does not match its status.');
    if (g.revoked_at !== null && (ms(g.revoked_at) < ms(g.created_at) || (g.expires_at !== null && ms(g.revoked_at) >= ms(g.expires_at)))) invalid(label + ' was revoked outside its term.');
    const key = g.member_id + '|' + g.grantee_id;
    if (!pairs.has(key)) pairs.set(key, []);
    pairs.get(key).push(g);
  }
  const end = g => (g.revoked_at !== null ? ms(g.revoked_at) : g.expires_at !== null ? ms(g.expires_at) : Infinity);
  for (const [key, list] of pairs) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    if (ms(a.created_at) < end(b) && ms(b.created_at) < end(a)) invalid('Grants ' + a.grant_id + ' and ' + b.grant_id + ' overlap on the pair ' + key + '.');
  }
}

function checkApprovals(data, idx) {
  for (const a of data.approvals) {
    const label = 'Approval ' + a.approval_id;
    if (!idx.bound.has(a.confirmed_by)) invalid(label + ' was confirmed by an unknown person ' + a.confirmed_by + '.');
    if (a.used_at !== null && (ms(a.used_at) < ms(a.confirmed_at) || ms(a.used_at) >= ms(a.confirmed_at) + 30 * MINUTE)) invalid(label + ' was used outside its 30 minutes.');
  }
  for (const n of data.notices) {
    const label = 'Notice ' + n.notice_id;
    if (!idx.bound.has(n.recipient_id)) invalid(label + ' recipient ' + n.recipient_id + ' is not in the run binding.');
    need(idx.members, n.member_id, 'member', label);
    const map = { claim: idx.claims, info_request: idx.requests, pa: idx.pas, appeal: idx.appeals }[n.subject.type];
    need(map, n.subject.id, n.subject.type, label);
  }
}

function checkCounters(data) {
  for (const [list, key, prefix] of RUN_IDS) for (const r of data[list]) {
    const m = new RegExp('^' + prefix + '-(0|[1-9][0-9]{0,14})$').exec(r[key]);
    if (m && big(m[1]) > issued(data, prefix)) invalid(r[key] + ' is above the issued ' + prefix + ' counter.');
  }
}

function pendingTimers(data) {
  const due = [];
  for (const c of data.claims) if (c.status === 'received') due.push(['review', c.claim_id, ms(c.review_at)]);
  for (const r of data.info_requests) if (r.status === 'open') due.push(['request_expiry', r.info_request_id, ms(r.expires_at)]);
  for (const p of data.pas) {
    if (p.status === 'approved') due.push(['validity_end', p.pa_id, endOfDay(p.approved.valid_until)]);
    if ((p.status === 'pending' || p.status === 'info_requested') && !p.overdue) due.push(['pa_due', p.pa_id, ms(p.due_at)]);
  }
  for (const a of data.appeals) if (OPEN_APPEAL.has(a.status) && !a.overdue) due.push(['appeal_due', a.appeal_id, ms(a.due_at)]);
  for (const w of data.windows) if (!w.closing.done) due.push(['window_closing', w.target.id, ms(w.closing.due_at)]);
  return due;
}

function recordedInstants(data) {
  const out = [];
  const add = (what, t) => { if (t !== null && t !== undefined) out.push([what, t]); };
  for (const c of data.coverage) add('coverage of ' + c.member_id + ' attested', c.attested_at);
  for (const c of data.claims) { add('claim ' + c.claim_id + ' received', c.received_at); add('claim ' + c.claim_id + ' processed', c.processed_at); }
  for (const r of data.info_requests) { add('request ' + r.info_request_id + ' opened', r.opened_at); add('request ' + r.info_request_id + ' answered', r.answered_at); if (r.status === 'expired') add('request ' + r.info_request_id + ' expired', r.expires_at); }
  for (const e of data.eobs) add('EOB ' + e.eob_id + ' issued', e.issued_at);
  for (const p of data.pas) {
    for (const k of ['submitted_at', 'decided_at', 'expired_at', 'overdue_at', 'denial_notice_at']) add('PA ' + p.pa_id + ' ' + k, p[k]);
    for (const r of p.info_requests) add('PA ' + p.pa_id + ' information request', r.at);
    if (p.expedite) { add('PA ' + p.pa_id + ' expedite', p.expedite.requested_at); add('PA ' + p.pa_id + ' expedite decision', p.expedite.decided_at); }
    for (const s of p.covered_submissions) add('covered submission ' + s.pa_id, s.at);
  }
  for (const a of data.appeals) {
    for (const k of ['filed_at', 'decided_at', 'withdrawn_at', 'overdue_at']) add('appeal ' + a.appeal_id + ' ' + k, a[k]);
    for (const s of a.statements) add('appeal ' + a.appeal_id + ' statement', s.at);
    for (const r of a.info_requests) add('appeal ' + a.appeal_id + ' information request', r.at);
  }
  for (const w of data.windows) { add('window of ' + w.target.id + ' notice', w.notice_at); add('window of ' + w.target.id + ' closing notice', w.closing.notice_at); if (w.closing.done) add('window of ' + w.target.id + ' closing', w.closing.due_at); }
  for (const g of data.grants) { add('grant ' + g.grant_id + ' created', g.created_at); add('grant ' + g.grant_id + ' revoked', g.revoked_at); }
  for (const a of data.approvals) { add('approval ' + a.approval_id + ' confirmed', a.confirmed_at); add('approval ' + a.approval_id + ' used', a.used_at); }
  for (const n of data.notices) add('notice ' + n.notice_id, n.at);
  return out;
}

function checkCutoff(ctx, data) {
  const timers = pendingTimers(data);
  const earliest = timers.length ? Math.min(...timers.map(t => t[2])) : Infinity;
  const now = ctx.virtual_now ? ms(ctx.virtual_now) : Infinity;
  for (const [what, t] of recordedInstants(data)) {
    if (ms(t) > now) invalid('The seed records ' + what + ' at ' + t + ', after the App\'s current time.');
    if (ms(t) >= earliest) invalid('The seed records ' + what + ' at ' + t + ', not before its earliest pending timer at ' + toIso(earliest) + '.');
  }
}

function completion(data, idx, e) {
  const c = idx.claims.get(e.claim_id), t = ms(e.issued_at), requests = data.info_requests.filter(r => r.claim_id === e.claim_id);
  if (e.version !== 1) return { timer: false, cob: null };
  if (t === ms(c.review_at) && !requests.length) return { timer: true, key: c.claim_id, kind: 0 };
  const expired = requests.filter(r => r.status === 'expired' && ms(r.expires_at) === t).map(r => r.info_request_id).sort();
  if (expired.length && !requests.some(r => r.status === 'answered' && ms(r.answered_at) === t)) return { timer: true, key: expired[expired.length - 1], kind: 1 };
  const closedAt = requests.filter(r => ms(r.status === 'answered' ? r.answered_at : r.expires_at) === t);
  const byCob = closedAt.length && closedAt.every(r => r.type === 'other_coverage' && r.status === 'answered' && r.plan_year === closedAt[0].plan_year);
  return { timer: false, cob: byCob ? c.member_id + ':' + closedAt[0].plan_year : null };
}

function checkPostingOrder(data, idx) {
  const at = new Map();
  for (const e of data.eobs) {
    const t = ms(e.issued_at);
    if (!at.has(t)) at.set(t, []);
    at.get(t).push({ e, ...completion(data, idx, e) });
  }
  for (const list of at.values()) {
    const bySeq = list.sort((a, b) => (big(a.e.posting_seq) < big(b.e.posting_seq) ? -1 : 1));
    bySeq.forEach((x, i) => {
      if (!i) return;
      const p = bySeq[i - 1], when = x.e.issued_at;
      if (x.timer && !p.timer) invalid('EOB ' + x.e.eob_id + ' was posted by a timer at ' + when + ' after an action at that instant; timers run first.');
      if (x.timer && p.timer && (p.key > x.key || (p.key === x.key && p.kind > x.kind))) invalid('Timers due at ' + when + ' posted ' + p.e.claim_id + ' before ' + x.e.claim_id + '; same-instant timers run in object ID string order.');
    });
    const cob = new Map();
    for (const x of bySeq) if (x.cob) { if (!cob.has(x.cob)) cob.set(x.cob, []); cob.get(x.cob).push(x.e); }
    for (const [key, claims] of cob) {
      const member = key.slice(0, key.lastIndexOf(':')), year = Number(key.slice(key.lastIndexOf(':') + 1)), when = claims[0].issued_at;
      const lo = big(claims[0].posting_seq), hi = big(claims[claims.length - 1].posting_seq);
      const span = bySeq.map(x => x.e).filter(e => big(e.posting_seq) >= lo && big(e.posting_seq) <= hi);
      for (const e of span) {
        const c = idx.claims.get(e.claim_id);
        if (e.version !== 1 || c.member_id !== member || !data.info_requests.some(r => r.claim_id === c.claim_id && r.type === 'other_coverage' && r.plan_year === year)) invalid('EOB ' + e.eob_id + ' was posted inside the batch of the attestation of ' + member + ' for ' + year + ' at ' + when + ', but that attestation did not complete its claim.');
      }
      span.forEach((e, i) => {
        if (!i) return;
        const a = idx.claims.get(span[i - 1].claim_id), b = idx.claims.get(e.claim_id);
        if (Math.sign(ms(a.received_at) - ms(b.received_at) || compareSeq(a.received_seq, b.received_seq)) === 1) invalid('One attestation completed ' + a.claim_id + ' before ' + b.claim_id + ' at ' + e.issued_at + '; it adjudicates claims in received order.');
      });
      const pa = data.pas.find(p => p.approved_after_post !== null && COUNTER.test(p.approved_after_post) && big(p.approved_after_post) >= lo && big(p.approved_after_post) < hi);
      if (pa) invalid('PA ' + pa.pa_id + ' was approved inside the batch of one attestation at ' + when + '; one confirm posts its claims together.');
    }
  }
}

function checkOrder(list, seq, at, what) {
  const sorted = [...list].sort((a, b) => (big(a[seq]) < big(b[seq]) ? -1 : 1));
  sorted.forEach((r, i) => { if (i && ms(r[at]) < ms(sorted[i - 1][at])) invalid(what + ' sequence ' + r[seq] + ' is dated before sequence ' + sorted[i - 1][seq] + '.'); });
}

function validateSeed(ctx, data) {
  const bound = checkBinding(ctx, data);
  const idx = {
    bound, members: unique(data.members, 'member_id', 'member'), providers: unique(data.providers, 'provider_id', 'provider'), services: unique(data.services, 'service_id', 'service'),
    claims: unique(data.claims, 'claim_id', 'claim'), pas: unique(data.pas, 'pa_id', 'PA'), appeals: unique(data.appeals, 'appeal_id', 'appeal'),
    requests: unique(data.info_requests, 'info_request_id', 'information request'),
  };
  unique(data.grants, 'grant_id', 'grant'); unique(data.eobs, 'eob_id', 'EOB'); unique(data.approvals, 'approval_id', 'approval'); unique(data.notices, 'notice_id', 'notice');
  checkPlan(data, idx);
  checkMembers(data, idx);
  const cov = checkCoverage(data, idx);
  checkClaims(data, idx);
  checkOrder(data.claims, 'received_seq', 'received_at', 'Claim receipt');
  checkOrder(data.eobs, 'posting_seq', 'issued_at', 'EOB posting');
  checkOrder(data.appeals, 'filed_seq', 'filed_at', 'Appeal filing');
  const byClaim = checkRequests(data, idx, cov);
  const versions = checkEobs(data, idx, byClaim, cov);
  checkLedger(data, idx, versions);
  checkPostingOrder(data, idx);
  checkPas(data, idx, versions);
  checkPricing(data, idx, byClaim, cov);
  const windows = checkWindows(data, idx, versions);
  checkAppeals(data, idx, versions, windows);
  checkGrants(data, idx);
  checkApprovals(data, idx);
  checkCounters(data);
  checkCutoff(ctx, data);
}

const KEYS = [['members', 'member_id'], ['providers', 'provider_id'], ['services', 'service_id'], ['claims', 'claim_id'], ['pas', 'pa_id'], ['appeals', 'appeal_id'], ['grants', 'grant_id']];
const records = data => KEYS.flatMap(([list]) => data[list]);
const objects = data => KEYS.flatMap(([list, key]) => data[list].map(r => r[key]));
const references = () => [];

module.exports = { validateSeed, records, objects, references, pendingTimers, coverageAtReview };
