'use strict';
// Story rules for the evaluation claims: each claim must hold together as one story of its scenario in dev/evaluation-scenarios.cjs.
// dev/check-fixture.cjs --evaluation runs them on every delivered seed. `problems(entries)` returns one row for each broken rule.
const views = require('../src/views.cjs');
const time = require('../src/time.cjs');
const S = require('./evaluation-scenarios.cjs');

const ZONE = 'America/New_York', ms = Date.parse, cents = amount => Math.round(amount * 100);
const local = at => time.iso(ms(at), ZONE), hour = at => Number(local(at).slice(11, 13)), month = at => Number(local(at).slice(5, 7));
const weekday = at => new Date(time.dayNumber(local(at).slice(0, 10)) * time.DAY_MS).getUTCDay();
const minutes = at => hour(at) * 60 + Number(local(at).slice(14, 16));
const linesOf = claim => claim.estimates.flatMap(e => e.lines);
const standing = line => line.decisions[line.decisions.length - 1] || null;

// Phrases in a loss text and the loss times they allow.
const PHRASES = [
  [/overnight/i, at => hour(at) >= 22 || hour(at) < 6, 'an overnight loss is between 22:00 and 5:59'],
  [/at dusk/i, at => { const [h, m] = S.SUNSET[month(at) - 1], d = minutes(at) - (h * 60 + m); return d >= -30 && d <= 60; }, 'a dusk loss is near the sunset of its month'],
  [/while we were at work/i, at => weekday(at) >= 1 && weekday(at) <= 5 && hour(at) >= 8 && hour(at) < 18, 'a loss at work time is on a weekday between 8:00 and 17:59'],
  [/for the weekend/i, at => [0, 6].includes(weekday(at)), 'a weekend loss is on a Saturday or Sunday'],
  [/\bic(e|y)\b/i, at => month(at) >= 11 || month(at) <= 3, 'ice is from November to March'],
  [/hail/i, at => month(at) >= 4 && month(at) <= 9, 'hail is from April to September'],
  [/froze/i, at => month(at) === 12 || month(at) <= 2, 'a frozen pipe is from December to February'],
  [/morning/i, at => hour(at) >= 5 && hour(at) < 12, 'a morning loss is between 5:00 and 11:59'],
  [/afternoon/i, at => hour(at) >= 12 && hour(at) < 18, 'an afternoon loss is between 12:00 and 17:59'],
  [/\bevening\b/i, at => hour(at) >= 17, 'an evening loss is after 17:00']
];
const RULES = ['scenario', 'lines', 'supplements', 'named parts', 'estimate source', 'decisions', 'disputes', 'invoice', 'side', 'loss time', 'evidence times', 'receipts', 'proof', 'money',
  'wear', 'answers', 'names', 'repeats'];
const STORE = 'Replacement prices from store websites';
// Parts that a loss text can name. A claim that names one has a line for it.
const PARTS = ['roof', 'hood', 'trunk', 'windshield', 'bumper', 'window', 'catalytic converter', 'airbag'];
const surname = name => name.trim().split(' ').pop();

function problems(entries) {
  const out = [], texts = new Map(), names = {household: new Set(), staff: new Set(), other: []};
  for (const {seed, scenarios} of entries) {
    const household = seed.account_id.split('-').slice(1).join('-');
    for (const p of seed.policies.flatMap(x => x.listed_people)) names.household.add(surname(p.name));
    for (const claim of seed.claims) {
      const id = scenarios.find(s => s.claim_id === claim.id), sc = id && S.SCENARIOS[id.scenario];
      const bad = (rule, detail) => out.push({account_id: seed.account_id, claim_id: claim.id, rule, detail});
      if (!sc) { bad('scenario', 'no scenario in manifest.json'); continue; }
      if (sc.coverage && claim.coverage !== sc.coverage) bad('scenario', 'coverage ' + claim.coverage);
      texts.set(claim.description, (texts.get(claim.description) || 0) + 1);
      const lines = linesOf(claim), photos = claim.evidence.filter(e => e.kind === 'photo');
      // Lines come from the scenario's templates, or from its item list.
      const templates = [...(sc.required || []), ...(sc.area || []), ...(sc.hidden || [])], items = sc.pool ? S.ITEMS[sc.pool] : null;
      const templateOf = line => items ? null : templates.find(t => S.lineRegex(t.text).test(line.text));
      const itemOf = line => items && items.find(i => line.text === i[0] || line.text.startsWith(i[0] + ', bought '));
      for (const line of lines) if (!templateOf(line) && !itemOf(line)) bad('lines', line.text);
      // A supplement line is hidden damage behind an approved line of an earlier estimate, or behind a line before it in the same supplement.
      claim.estimates.forEach((estimate, k) => {
        if (estimate.kind !== 'supplement') return;
        const before = claim.estimates.slice(0, k).flatMap(e => e.lines).filter(l => standing(l) && standing(l).status === 'approved').map(l => l.text);
        estimate.lines.forEach((line, j) => {
          const t = templateOf(line), near = [...before, ...estimate.lines.slice(0, j).map(l => l.text)];
          if (!t || !(sc.hidden || []).includes(t) || (t.needs && !near.some(text => t.needs.test(text)))) bad('supplements', line.text + ' has no part in front of it');
        });
      });
      if (lines.length && !items) for (const part of PARTS) if (new RegExp('\\b' + part, 'i').test(claim.description) && !lines.some(l => l.text.toLowerCase().includes(part))) bad('named parts', 'the text names the ' + part + ', but no line does');
      for (const e of claim.estimates) {
        if (e.source === 'policyholder' && e.shop_name !== STORE) bad('estimate source', e.id + ' is from the policyholder but names ' + e.shop_name);
        if (e.source !== 'policyholder' && e.shop_name === STORE) bad('estimate source', e.id + ' names store prices but is from ' + e.source);
      }
      if (lines.some(l => /^Paint materials/.test(l.text)) && !lines.some(l => { const t = templateOf(l); return t && t.rule === 'paint'; })) bad('lines', 'paint materials with no paint line');
      // Decisions use the reason of the line's rule. A denial is for older damage, for missing proof, or by the scenario's exclusion.
      for (const line of lines) {
        const t = templateOf(line), item = itemOf(line), years = /bought (\d+ years?) ago/.exec(line.text);
        for (const d of line.decisions.filter(x => x.source === 'determination')) {
          const ok = d.status === 'approved'
            ? (d.amount === line.amount && !d.reason) || (t && d.reason === S.DECISIONS[t.rule].cut) || (item && item[3] === 'worn' && years && d.reason === S.DECISIONS.worn.cut(years[1]))
            : (t && t.old && d.reason === S.DECISIONS.old.deny) || (sc.denial && d.reason === sc.denial.deny) || (item && item[3] !== 'service' && d.reason === S.DECISIONS.unproven.deny);
          if (!ok) bad('decisions', line.text + ': ' + d.status + ' ' + (d.reason || ''));
        }
      }
      // A dispute answers the decision it disputes, and its result uses the words of that same rule.
      for (const dispute of claim.disputes) {
        const line = lines.find(l => l.id === dispute.line_id), decision = line.decisions[dispute.decision_index], t = templateOf(line), item = itemOf(line);
        const rule = sc.denial && decision.reason === sc.denial.deny ? null : decision.status === 'denied' ? S.DECISIONS.old
          : item ? S.DECISIONS.worn : t && S.DECISIONS[t.rule];
        const driver = claim.driver && claim.driver.kind === 'listed' ? seed.policies.flatMap(p => p.listed_people).find(p => p.person_id === claim.driver.person_id) : null;
        const expected = rule ? rule.dispute : sc.denial.dispute({who: driver ? driver.name.split(' ')[0] : ''});
        if (dispute.reason !== expected) bad('disputes', dispute.id + ' does not answer: ' + decision.reason);
        if (!dispute.evidence_ids.length) bad('disputes', dispute.id + ' has no evidence');
        const note = dispute.state === 'changed' ? rule && rule.changed : dispute.state === 'upheld' ? (rule ? rule.upheld : sc.denial.upheld) : null;
        if (dispute.state !== 'open' && dispute.note !== note) bad('disputes', dispute.id + ' result note: ' + dispute.note);
        const attached = claim.evidence.filter(e => dispute.evidence_ids.includes(e.id));
        if (/photo/i.test(dispute.note || '') && !attached.some(e => e.kind === 'photo')) bad('disputes', dispute.id + ' result speaks of a photo that the dispute does not attach');
        const changed = line.decisions.find(d => d.source === 'dispute' && d.source_id === dispute.id), years = /bought (\d+) years? ago/.exec(line.text);
        if (changed && item && item[3] === 'worn' && (!years || changed.amount !== S.DECISIONS.worn.raised(line.amount, Number(years[1])))) bad('disputes', dispute.id + ' raises the value beyond the wear rule for its age');
      }
      // The invoice is what the shop billed for the approved lines: never below the approved total.
      if (claim.repair_completed_at) {
        const approved = lines.filter(l => standing(l) && standing(l).status === 'approved');
        const billed = approved.reduce((s, l) => s + cents(l.amount), 0), allowed = approved.reduce((s, l) => s + cents(standing(l).amount), 0);
        if (cents(claim.final_invoice_total) !== billed || billed < allowed) bad('invoice', claim.final_invoice_total + ' for approved lines billed at ' + billed / 100);
      }
      const sided = lines.filter(l => { const t = templateOf(l); return t && t.text.includes('{side}'); });
      const sides = new Set(sided.map(l => /\b(left|right)\b/.exec(l.text)[1])), named = /\b(left|right) (side|rear|doors)\b/.exec(claim.description);
      if (sides.size > 1 || (named && sides.size && !sides.has(named[1]))) bad('side', [...sides].join(', ') + ' against the description');
      for (const [pattern, fits, rule] of PHRASES) if (pattern.test(claim.description) && !fits(claim.loss_at)) bad('loss time', rule + ': ' + claim.loss_at);
      // Evidence is dated before it was added. At night only right after the loss. Before the loss only when it says so. A found car only after it was found.
      for (const e of claim.evidence) {
        const h = hour(e.dated), scene = ms(e.dated) >= ms(claim.loss_at) && ms(e.dated) - ms(claim.loss_at) <= 2 * 3600000;
        if (ms(e.dated) > ms(e.added_at)) bad('evidence times', e.id + ' is dated after it was added');
        if ((h < 7 || h >= 21) && !scene) bad('evidence times', e.id + ' is dated at night: ' + e.dated);
        if (e.kind === 'photo' && ms(e.dated) < ms(claim.loss_at) && !/before the loss|last year/.test(e.description)) bad('evidence times', e.id + ' shows the loss before it happened');
        if (/burned car|burned engine/.test(e.description) && ms(e.dated) < ms(claim.loss_at) + 86400000) bad('evidence times', e.id + ' shows the found car too early');
      }
      // A receipt is for a bought item on the list, dated near the purchase year that the line states, and before the loss.
      for (const e of claim.evidence.filter(x => x.kind === 'receipt')) {
        const name = e.description.replace(/^Receipt for (the )?/, '').replace(/\.$/, ''), line = lines.find(l => l.text.toLowerCase().startsWith(name)), y = line && /bought (\d+) year/.exec(line.text);
        const age = (ms(claim.loss_at) - ms(e.dated)) / (365.25 * 86400000);
        if (!line || !y || Math.abs(age - Number(y[1])) > 0.5 || ms(e.dated) > ms(claim.loss_at)) bad('receipts', e.id + ' ' + name);
      }
      // One rule for every bought item: it is denied for no proof exactly when it has no receipt and no photo that shows it.
      if (items && !sc.denial) for (const line of lines) {
        const item = itemOf(line);
        if (!item || item[3] === 'service') continue;
        const name = item[0].split(',')[0].toLowerCase(), word = name.split(' ').pop();
        const proof = claim.evidence.some(e => e.kind === 'receipt' && e.description.toLowerCase().includes(name)) || photos.some(p => p.description.toLowerCase().includes(name) || p.description.toLowerCase().includes(' ' + word + ' '));
        const deniedForProof = line.decisions.some(d => d.reason === S.DECISIONS.unproven.deny);
        if (proof === deniedForProof) bad('proof', line.text + (proof ? ' is denied for no proof, but proof is attached' : ' has no proof but is approved'));
      }
      if (claim.payments.some(p => p.amount < 25)) bad('money', 'a payment below 25.00');
      const summary = views.summary(seed, claim, ms(claim.closed_at || claim.withdrawn_at || claim.filed_at));
      if (claim.outcome === 'paid' && (!claim.payments.length || (claim.path === 'repair' && summary.still_due > 0))) bad('money', 'closed as paid with money still due');
      if (claim.outcome === 'denied' && claim.payments.length) bad('money', 'closed as denied with a payment');
      for (const line of lines) {
        const y = /bought (\d+ years?) ago/.exec(line.text), acv = line.decisions.map(d => /after (\d+ years?) of use/.exec(d.reason || '')).find(Boolean);
        if (acv && (!y || y[1] !== acv[1])) bad('wear', line.text);
      }
      // Answers and notes agree with the claim text.
      for (const q of claim.requests) for (const ask of q.asks) if (ask.key === 'parked' && ask.answer && /behind/.test(claim.description) && /in front/.test(ask.answer.text)) bad('answers', 'parked in front, but the text says behind');
      if (claim.outcome === 'denied' && lines.some(l => standing(l) && standing(l).status === 'approved') && !claim.determinations.some(d => /deductible|no proof/.test(d.note))) bad('answers', 'approved lines on a denied claim, and no note says why');
      // People: no shared surnames between policyholders, staff and other drivers.
      const others = claim.requests.flatMap(q => q.asks).filter(a => a.key === 'other_party' && a.answer).map(a => /is (\w+ \w+), insured/.exec(a.answer.text)[1]);
      const staff = [...claim.requests.map(q => q.issued_by), ...claim.determinations.map(d => d.issued_by), ...claim.offers.map(o => o.issued_by), ...claim.disputes.map(d => d.decided_by).filter(Boolean)];
      for (const name of others) names.other.push(surname(name));
      for (const name of staff) names.staff.add(surname(name));
    }
  }
  for (const [text, n] of texts) if (n > 3) out.push({account_id: '*', claim_id: '*', rule: 'repeats', detail: n + ' claims share the text: ' + text});
  const shared = [...names.staff].filter(n => names.household.has(n)).concat(names.other.filter(n => names.household.has(n) || names.staff.has(n)));
  for (const n of new Set(shared)) out.push({account_id: '*', claim_id: '*', rule: 'names', detail: 'the surname ' + n + ' is used by two kinds of people'});
  for (const n of new Set(names.other)) if (names.other.filter(x => x === n).length > 3) out.push({account_id: '*', claim_id: '*', rule: 'names', detail: 'the other-driver surname ' + n + ' is used more than 3 times'});
  return out;
}
module.exports = {RULES, problems};
