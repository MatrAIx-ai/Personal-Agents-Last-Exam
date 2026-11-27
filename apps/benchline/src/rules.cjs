'use strict';
const c = require('./common.cjs');
const views = require('./views.cjs');
const {sha256, canonical} = require('./sha256.cjs');
const {ms, time, hundredths} = c;
// A stored time is a full timestamp with a UTC offset. The wire message of a notification follows Mail's schema instead.
const TIME_KEY = /^at$|_at$|^respond_by$/, WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const noOffset = value => Object.entries(value).some(([key, item]) => typeof item === 'string' ? TIME_KEY.test(key) && !WITH_OFFSET.test(item)
  : item !== null && typeof item === 'object' && key !== 'email' && key !== 'params' && noOffset(item));

// The rules that a seed must keep. Core runs them on every loaded seed, and the App runs them after every event.
function validate(ctx, data, code = 'invalid_seed') {
  const bad = message => c.fail(code, message);
  const now = ms(ctx.virtual_now);
  const decimals = (...values) => { if (values.some(v => v !== null && v !== undefined && !c.twoDecimals(v))) bad('An hour value or a rate has more than two decimals.'); };
  if (!time.validZone(c.zone(data)) || !time.validZone(data.preferences.timezone)) bad('A time zone is unknown.');
  if (noOffset(data)) bad('A timestamp has no UTC offset.');
  const NAME = /^[a-z][a-z0-9_]{0,39}$/;
  const values = m => { if (m !== null && (!Object.keys(m).length || Object.keys(m).length > 20 || Object.entries(m).some(([k, v]) => !NAME.test(k) || !Number.isFinite(v)))) bad('A metrics object is empty, too long, or has a bad name or value.'); };
  const ids = new Set();
  const take = id => { if (ids.has(id)) bad('The ID ' + id + ' is used twice.'); ids.add(id); };

  // The project, its people, partitions and allocation.
  for (const p of data.people) { take(p.person_id); decimals(p.share_hours); }
  const people = new Set(data.people.map(p => p.person_id));
  if (!people.has(data.owner_person_id)) bad('The account holder is not one of the people of the project.');
  if (!people.has(data.project.lab_head_person_id)) bad('The lab head is not one of the people of the project.');
  const policy = data.project.policy;
  if (!policy.required_signers.length) bad('The project has no required signers.');
  if (policy.required_signers.some(id => !people.has(id)) || new Set(policy.required_signers).size !== policy.required_signers.length) bad('A required signer is unknown or listed twice.');
  for (const p of data.partitions) { take(p.id); decimals(p.rate, p.max_hours); }
  const a = data.allocation;
  take(a.period_id);
  decimals(a.allocation_hours, a.opening_hours, ...a.opening_shares.map(s => s.share_hours));
  for (const p of data.past_periods) { take(p.period_id); decimals(p.allocation_hours, p.opening_hours); }
  const periods = new Map([[a.period_id, a], ...data.past_periods.map(p => [p.period_id, p])]);
  for (const p of periods.values()) if (ms(p.ends_at) <= ms(p.starts_at)) bad('An allocation period ends before it starts.');
  for (const s of a.opening_shares) if (!people.has(s.person_id)) bad('An opening share names an unknown person.');

  for (const key of c.RECORDS) for (const row of data[key]) take(row.id);
  for (const n of data.notifications) take(n.id);
  for (const ch of data.allocation_changes) {
    if (!periods.has(ch.period_id) || !people.has(ch.changed_by) || ch.shares.some(s => !people.has(s.person_id))) bad('An allocation change names an unknown period or person.');
    decimals(ch.from_hours, ch.to_hours, ...ch.shares.flatMap(s => [s.from, s.to]));
  }
  const configs = new Map(data.configs.map(x => [x.id, x])), protocols = new Map(data.protocols.map(x => [x.id, x]));
  const partitions = new Set(data.partitions.map(p => p.id));
  for (const x of data.configs) if (!people.has(x.registered_by)) bad('A config names an unknown person.');

  // Protocol versions.
  const lines = new Map();
  for (const p of data.protocols) {
    if (!people.has(p.proposed_by)) bad('A protocol version names an unknown proposer.');
    if (new Set(p.seeds).size !== p.seeds.length || new Set(p.metrics.map(m => m.name)).size !== p.metrics.length) bad('A protocol version lists a seed or a metric twice.');
    // The signers of the policy can change later, so a sign-off of an earlier version needs only a known person.
    for (const s of p.signoffs) if (!people.has(s.person_id)) bad('A sign-off is from an unknown person.');
    if (new Set(p.signoffs.map(s => s.person_id)).size !== p.signoffs.length) bad('A person answered one version twice.');
    const fits = {proposed: p.signed_at === null && p.declined_at === null && p.withdrawn_at === null, signed: p.signed_at !== null && p.superseded_at === null,
      superseded: p.signed_at !== null && p.superseded_at !== null && p.superseded_by !== null, declined: p.declined_at !== null, withdrawn: p.withdrawn_at !== null}[p.stored_state];
    if (!fits) bad('The state of a protocol version does not fit its times.');
    if (p.stored_state === 'declined' && !p.signoffs.some(s => s.answer === 'decline')) bad('A declined version has no decline.');
    for (const ref of [p.supersedes, p.superseded_by]) if (ref !== null && !protocols.has(ref)) bad('A protocol version names a version that does not exist.');
    if (!lines.has(p.line)) lines.set(p.line, []);
    lines.get(p.line).push(p);
  }
  for (const list of lines.values()) {
    if (list.filter(p => views.protocolState(p, now) === 'proposed').length > 1) bad('Two versions on one line are proposed and not yet expired.');
    if (list.filter(p => p.stored_state === 'signed').length > 1) bad('A line has two signed versions.');
    if (new Set(list.map(p => p.version)).size !== list.length) bad('Two versions on one line have the same number.');
  }

  // Run plans.
  for (const r of data.run_plans) {
    if (!configs.has(r.config_id) || r.partition_id !== null && !partitions.has(r.partition_id)) bad('A run plan names an unknown config or partition.');
    if ((r.outcome === 'completed') !== (r.metrics !== null)) bad('A completed run plan has metrics, and a failed one has none.');
    values(r.metrics);
  }
  const keys = data.run_plans.map(r => r.config_id + '|' + r.seed + '|' + r.partition_id);
  if (new Set(keys).size !== keys.length) bad('Two run plans are for the same config, seed and partition.');

  // Jobs.
  for (const j of data.jobs) {
    if (!people.has(j.owner_person_id) || !configs.has(j.config_id) || !partitions.has(j.partition_id) || !periods.has(j.period_id)) bad('A job names an unknown person, config, partition or period.');
    decimals(j.time_limit_hours);
    const protocol = j.protocol_id === null ? null : protocols.get(j.protocol_id);
    if (j.protocol_id !== null && !protocol) bad('A job names a protocol version that does not exist.');
    if (protocol && !views.covers(protocol, configs.get(j.config_id), j.seed)) bad('A job has a seed or config that its protocol version does not cover.');
    if (c.isOwner(data, j.owner_person_id) === (j.submitted_by === 'labmate')) bad('A job of the account holder comes from the Agent or a script, and a labmate\'s job is recorded.');
    if ((j.submitted_by === 'script') !== (j.script !== null)) bad('A script job names its script, and other jobs name none.');
    const run = j.run;
    if (run) {
      if (ms(run.ends_at) < ms(run.starts_at)) bad('A job ends before it starts.');
      if (ms(run.ends_at) - ms(run.starts_at) > hundredths(j.time_limit_hours) * 36000) bad('A job runs longer than its time limit.');
      if ((run.end_kind === 'completed') !== (run.metrics !== null)) bad('A completed job has metrics, and other jobs have none.');
      values(run.metrics);
    }
    if ((j.stored_state === 'held') !== (j.hold_reason !== null) || j.stored_state === 'held' && run !== null) bad('A held job has its reason and no run, and other jobs have no hold reason.');
    if ((j.stored_state === 'cancelled') !== (j.cancelled_at !== null) || (j.stored_state === 'interrupted') !== (j.interrupted_at !== null)) bad('The state of a job does not fit its times.');
    if (j.review && j.review.excluded && !j.review.reason) bad('An excluded result has no reason.');
    if ((j.review || j.invalidation) && !(run && run.end_kind === 'completed' && j.stored_state === 'queued')) bad('Only the result of a completed job has a review or an invalidation.');
  }
  const jobs = new Map(data.jobs.map(j => [j.id, j]));

  // Table versions.
  const families = new Map();
  for (const t of data.tables) {
    if (!protocols.has(t.protocol_id)) bad('A table names a protocol version that does not exist.');
    const ok = {draft: t.frozen_at === null && t.manifest === null, frozen: t.frozen_at !== null && t.manifest !== null && t.superseded_at === null,
      superseded: t.frozen_at !== null && t.manifest !== null && t.superseded_at !== null, discarded: t.discarded_at !== null && t.manifest === null}[t.stored_state];
    if (!ok) bad('The state of a table version does not fit its fields.');
    for (const id of t.rows.flatMap(r => r.result_ids)) if (!jobs.has(id)) bad('A table cites a job that does not exist.');
    if (t.revises !== null && !data.tables.some(x => x.id === t.revises && x.table_id === t.table_id)) bad('A table version revises a version of another table.');
    if (t.manifest) {
      const {content_hash, ...body} = t.manifest;
      const cited = body.rows.flatMap(r => r.result_ids), mine = t.rows.flatMap(r => r.result_ids);
      const results = cited.every(id => jobs.has(id) && jobs.get(id).run && jobs.get(id).run.end_kind === 'completed' && jobs.get(id).protocol_id === t.protocol_id);
      const values = results && body.rows.every(r => r.result_ids.every((id, i) => jobs.get(id).seed === r.seeds[i] && jobs.get(id).config_id === r.config_id) &&
        Object.entries(r.metrics).every(([name, s]) => canonical(s) === canonical(views.stats(r.result_ids.map(id => jobs.get(id).run.metrics[name]).filter(v => typeof v === 'number')))));
      if (!values || canonical(cited.slice().sort()) !== canonical(mine.slice().sort()) || content_hash !== 'sha256:' + sha256(canonical(body))) bad('A frozen table\'s manifest does not match the results it cites.');
    }
    if (!families.has(t.table_id)) families.set(t.table_id, []);
    families.get(t.table_id).push(t);
  }
  for (const list of families.values()) {
    if (list.filter(t => t.stored_state === 'draft').length > 1) bad('A table has two draft versions.');
    if (list.filter(t => t.stored_state === 'frozen').length > 1) bad('A table has two frozen versions that are not superseded.');
  }

  for (const n of data.notifications) {
    const target = {allocation: periods.has(n.object_id), job: jobs.has(n.object_id), result: jobs.has(n.object_id), config: configs.has(n.object_id), protocol: protocols.has(n.object_id)}[n.object_type];
    if (!target) bad('A notification names an object that does not exist.');
  }
  data.activity.forEach((row, index) => {
    if (index && row.seq <= data.activity[index - 1].seq) bad('The activity rows are not in order.');
    if (row.object_id !== data.account_id && !ids.has(row.object_id)) bad('An activity row names an object that does not exist.');
  });
}
module.exports = {validate};
