'use strict';
// The committed story rules of the delivery dataset. Each rule names a contradiction that a scripted history must never have.
// problems(seed, manifest, at) returns one row for each broken rule and record. `at` is the time of a month-start seed; it defaults to the clock.
// Usage: node dev/check-evaluation.cjs. Exits 1 when a rule is broken.
const fs = require('node:fs');
const path = require('node:path');
const time = require('../src/time.cjs');
const S = require('./evaluation-scenarios.cjs');

const ZONE = 'America/New_York', START = '2025-01-01T00:00:00-05:00', ms = Date.parse;
const day = value => time.localDay(ms(value), ZONE);
const clock = value => time.iso(ms(value), ZONE).slice(11, 16);
const HOLIDAYS = new Set(S.HOLIDAYS), working = d => time.weekday(d) % 6 !== 0 && !HOLIDAYS.has(d);
const PEOPLE = new Set(S.PEOPLE.map(p => p.person_id)), FAMILIES = new Set(S.FAMILIES.map(f => f.family));
const RULES = ['story', 'metrics', 'versions', 'hours', 'members', 'reruns', 'tables', 'rationale', 'allocation', 'failures', 'notifications', 'names', 'deadlines', 'answers',
  'withdrawals', 'duplicates'];
const mean = list => list.reduce((a, b) => a + b, 0) / list.length;

// The kind of change of a version against the version before it on its line, skipping withdrawn ones: dataset, seeds, split or metrics.
function changeOf(data, p) {
  const before = data.protocols.filter(x => x.line === p.line && x.version < p.version && x.stored_state !== 'withdrawn').sort((a, b) => b.version - a.version)[0];
  if (!before) return null;
  if (before.dataset_version !== p.dataset_version) return 'dataset';
  if (JSON.stringify(before.seeds) !== JSON.stringify(p.seeds)) return 'seeds';
  if (before.eval_split !== p.eval_split) return 'split';
  if (JSON.stringify(before.metrics) !== JSON.stringify(p.metrics)) return 'metrics';
  return null;
}
const evaluationKey = (j, versions) => { const p = versions.get(j.protocol_id);
  return [j.config_id, j.seed, p ? [p.dataset_version, p.eval_split, p.metrics.map(m => m.name).join('+')].join('|') : 'no protocol'].join('|'); };
function problems(data, manifest, at = null) {
  const out = [], bad = (rule, record_id, detail) => out.push({rule, record_id, detail});
  const jobs = new Map(data.jobs.map(j => [j.id, j]));
  // story: every record of the window belongs to exactly one story of the manifest.
  const owner = new Map();
  for (const s of manifest.stories) for (const id of s.records) owner.set(id, (owner.get(id) || []).concat(s.story_id));
  const plans = new Set(data.run_plans.map(p => p.id));
  for (const s of manifest.stories) for (const id of s.records) if (!plans.has(id) && owner.get(id).length > 1) bad('story', id, 'in ' + owner.get(id).join(', '));
  const windowed = [...data.jobs, ...data.tables, ...data.allocation_changes, ...data.configs.filter(c => ms(c.registered_at) >= ms(START)),
    ...data.protocols.filter(p => ms(p.proposed_at) >= ms(START))];
  for (const r of windowed) if (!owner.has(r.id)) bad('story', r.id, 'in no story');
  // metrics: the results of one config under one protocol version are within 0.02 of their mean.
  const groups = new Map();
  for (const j of data.jobs) if (j.run && j.run.end_kind === 'completed' && j.protocol_id && typeof j.run.metrics.accuracy === 'number') {
    const key = j.config_id + '|' + j.protocol_id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(j);
  }
  for (const list of groups.values()) {
    const m = mean(list.map(j => j.run.metrics.accuracy));
    for (const j of list) if (Math.abs(j.run.metrics.accuracy - m) > 0.02) bad('metrics', j.id, j.run.metrics.accuracy + ' against a mean of ' + m.toFixed(3));
  }
  // versions: on one dataset release and split, the mean of every config of a family is within 0.03 of the family's mean. A sweep step can be
  // a little better or worse than the others, never far away.
  const byFamily = new Map();
  for (const [key, list] of groups) {
    const config = data.configs.find(c => c.id === key.split('|')[0]), k = config.family + '|' + config.eval_split + '|' + config.dataset_version;
    if (!byFamily.has(k)) byFamily.set(k, []);
    byFamily.get(k).push({config, mean: mean(list.map(j => j.run.metrics.accuracy))});
  }
  for (const [k, list] of byFamily) {
    const m = mean(list.map(x => x.mean));
    for (const x of list) if (Math.abs(x.mean - m) > 0.03) bad('versions', x.config.id, 'mean ' + x.mean.toFixed(3) + ' against ' + m.toFixed(3) + ' for ' + k);
  }
  // hours: people submit on working days between 07:00 and 21:00; scripts submit late in the evening.
  for (const j of data.jobs) {
    const d = day(j.submitted_at), t = clock(j.submitted_at);
    if (j.submitted_by === 'script' ? t < '21:30' : !working(d) || t < '07:00' || t > '21:00') bad('hours', j.id, j.submitted_by + ' on ' + d + ' at ' + t);
  }
  // members: nobody works before joining the lab.
  for (const j of data.jobs) if (S.JOINS[j.owner_person_id] && day(j.submitted_at) < S.JOINS[j.owner_person_id]) bad('members', j.id, j.owner_person_id + ' before ' + S.JOINS[j.owner_person_id]);
  // reruns: the rerun of a correction has the config and seed of the invalidated result, and comes after the invalidation.
  for (const s of manifest.stories.filter(x => x.template === 'correction')) {
    const rerun = s.records.map(id => jobs.get(id)).find(Boolean);
    if (!rerun) continue;
    const target = data.jobs.find(j => j.invalidation && j.config_id === rerun.config_id && j.seed === rerun.seed && ms(j.invalidation.at) <= ms(rerun.submitted_at));
    if (!target) bad('reruns', rerun.id, 'no invalidated result of ' + rerun.config_id + ' seed ' + rerun.seed + ' before it');
  }
  // tables: a deadline table is created at most 10 days before its deadline and frozen before it; a lab-meeting table names its month.
  for (const t of data.tables) {
    const deadline = S.DEADLINES.find(d => t.title.endsWith(d.name));
    if (deadline) {
      const created = time.dayNumber(day(t.created_at)), due = time.dayNumber(deadline.day);
      if (t.version === 1 && (created > due || due - created > 10) || t.frozen_at && t.version === 1 && day(t.frozen_at) >= deadline.day) bad('tables', t.id, t.title + ' on ' + day(t.created_at));
    } else if (/lab meeting$/.test(t.title)) {
      const month = new Date(Date.UTC(Number(day(t.created_at).slice(0, 4)), Number(day(t.created_at).slice(5, 7)) - 1, 1)).toLocaleString('en-US', {month: 'long', timeZone: 'UTC'});
      if (!t.title.includes(month)) bad('tables', t.id, t.title + ' on ' + day(t.created_at));
    } else if (!/journal version|draft/.test(t.title)) bad('tables', t.id, 'a title of no story: ' + t.title);
  }
  // rationale: a version's rationale names what it changes against the version before it on its line: the new seed count, the new dataset release,
  // the split or the metrics. `changeOf` gives the kind of change of a version.
  for (const p of data.protocols.filter(x => ms(x.proposed_at) >= ms(START))) {
    const kind = changeOf(data, p), r = p.rationale || '';
    const ok = kind === 'seeds' ? r.includes(' ' + p.seeds.length + ' seeds') : kind === 'dataset' ? r.includes(p.dataset_version) :
      kind === 'metrics' ? p.metrics.every(m => r.includes(m.name)) : kind === 'split' ? /split|subject|session|trial/i.test(r) : false;
    if (!ok) bad('rationale', p.id, (kind || 'no change') + ': ' + r);
  }
  // allocation: the lab head changes the allocation, with a reason of the right kind.
  for (const c of data.allocation_changes) {
    const cut = c.to_hours < c.from_hours;
    if (c.changed_by !== 'person-okafor' || !(cut ? S.CUTS : S.RAISES).includes(c.reason)) bad('allocation', c.id, (cut ? 'a cut' : 'a raise') + ' with the reason ' + c.reason);
  }
  // failures: an interruption names a node of the job's partition.
  for (const j of data.jobs.filter(x => x.stored_state === 'interrupted')) if (!S.NODES[j.partition_id].some(n => (j.interrupt_reason || '').includes(n))) bad('failures', j.id, j.interrupt_reason);
  // notifications: a job.ended notice names its job and its end kind.
  const WORD = {completed: 'has completed', failed: 'has failed', timed_out: 'ran out of time'};
  for (const n of data.notifications.filter(x => x.kind === 'job.ended')) {
    const j = jobs.get(n.object_id);
    if (!j || !j.run || !n.title.includes(j.id) || !n.title.endsWith(WORD[j.run.end_kind])) bad('notifications', n.id, n.title);
  }
  // names: every person is one of the lab, and every config is of a known family.
  for (const j of data.jobs) if (!PEOPLE.has(j.owner_person_id)) bad('names', j.id, j.owner_person_id);
  for (const c of data.configs) if (!FAMILIES.has(c.family) || !c.id.startsWith('cfg-' + c.family) || !PEOPLE.has(c.registered_by)) bad('names', c.id, c.family + ' by ' + c.registered_by);
  for (const p of data.protocols) for (const who of [p.proposed_by, ...p.signoffs.map(x => x.person_id)]) if (!PEOPLE.has(who)) bad('names', p.id, who);
  // deadlines: people submit more in the three weeks before a deadline than in a usual three weeks.
  if (!at) {
    const days = data.jobs.filter(j => j.submitted_by !== 'script').map(j => time.dayNumber(day(j.submitted_at)));
    const first = time.dayNumber('2025-01-01'), windows = [];
    for (let d = first; d + 21 <= time.dayNumber('2026-12-24'); d += 7) windows.push(days.filter(x => x >= d && x < d + 21).length);
    const median = windows.slice().sort((a, b) => a - b)[Math.floor(windows.length / 2)];
    for (const dl of S.DEADLINES) {
      const due = time.dayNumber(dl.day), n = days.filter(x => x >= due - 21 && x < due).length;
      if (n <= median) bad('deadlines', dl.day, n + ' submissions in the three weeks before ' + dl.name + ', median ' + median);
    }
  }
  // answers: a sign note is a sign note, and a decline note fits the kind of change that is declined.
  for (const p of data.protocols) for (const s of p.signoffs) {
    if (!s.note) continue;
    const kind = changeOf(data, p), ok = s.answer === 'sign' ? S.SIGN_NOTES.includes(s.note) : !!kind && S.CHANGES[kind].decline.includes(s.note);
    if (!ok) bad('answers', p.id, s.answer + ' of a ' + kind + ' change with the note ' + s.note);
  }
  // withdrawals: a version withdrawn for a typo has a dataset release that does not exist, the note names it, and the next version on its line fixes it.
  for (const p of data.protocols.filter(x => x.stored_state === 'withdrawn' && /typo/i.test(x.withdraw_note || ''))) {
    const next = data.protocols.find(x => x.line === p.line && x.version === p.version + 1);
    const known = S.ERAS.some(e => e.dataset === p.dataset_version);
    if (known || !p.withdraw_note.includes(p.dataset_version) || !next || !S.ERAS.some(e => e.dataset === next.dataset_version)) bad('withdrawals', p.id, p.dataset_version + ': ' + p.withdraw_note);
  }
  // duplicates: a config never changes, so the same config and seed under the same evaluation (dataset release, split and metrics, under any version
  // of a line) run again only after the run before did not give a usable result: it failed, timed out, was interrupted or cancelled, or was invalidated.
  const runs = new Map(), versions = new Map(data.protocols.map(p => [p.id, p]));
  for (const j of data.jobs) {
    const key = evaluationKey(j, versions);
    if (!runs.has(key)) runs.set(key, []);
    runs.get(key).push(j);
  }
  for (const list of runs.values()) {
    list.sort((a, b) => ms(a.submitted_at) - ms(b.submitted_at));
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1], usable = prev.run && prev.run.end_kind === 'completed' && prev.stored_state === 'queued' && !prev.invalidation;
      if (usable) bad('duplicates', list[i].id, 'runs ' + list[i].config_id + ' seed ' + list[i].seed + ' again after the completed ' + prev.id);
    }
  }
  return out;
}

function main() {
  const dir = path.resolve(__dirname, '../data/evaluation'), read = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  const rows = problems(read('seed.json'), read('manifest.json'));
  for (const rule of RULES) {
    const n = rows.filter(r => r.rule === rule).length;
    console.log((n ? 'FAIL  ' : 'ok    ') + rule + (n ? ': ' + n + ' rows, first ' + JSON.stringify(rows.find(r => r.rule === rule)) : ''));
  }
  process.exitCode = rows.length ? 1 : 0;
}
if (require.main === module) main();
module.exports = {problems, RULES, evaluationKey};
