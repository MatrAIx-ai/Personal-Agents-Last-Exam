'use strict';
const c = require('./common.cjs');
const views = require('./views.cjs');
const {ms, time, hoursText, hundredths} = c;
// The text of a notification and, when the account wants email, the full wire message for Mail's receive contract.
// The object type and the subscription topic of each kind of notification.
const ABOUT = {
  'allocation.changed': ['allocation', 'allocation-changes'], 'job.ended': ['job', 'job-updates'], 'job.interrupted': ['job', 'job-updates'],
  'job.submission_rejected': ['config', 'job-updates'], 'protocol.proposed': ['protocol', 'protocol-updates'], 'protocol.updated': ['protocol', 'protocol-updates'],
  'result.invalidated': ['result', 'result-updates']
};
const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const count = n => n < WORDS.length ? WORDS[n] : String(n);
// "the department moved hours to the shared pool": a reason as part of a sentence.
// The first letter goes to lower case only for an ordinary word: not an acronym ("NSF"), not a word with a digit or a dot ("Prof.", "H100"),
// and not a name of a person of the project ("Mei").
function clause(text, data) {
  const first = text.split(/\s+/)[0].replace(/[,;:]$/, ''), names = new Set(data.people.flatMap(p => p.name.split(/\s+/)));
  const ordinary = /^[A-Z][a-z']*$/.test(first) && !names.has(first);
  return ((ordinary ? text.charAt(0).toLowerCase() : text.charAt(0)) + text.slice(1)).replace(/[.!?]+$/, '');
}
const sentence = value => value ? ' ' + value + (/[.!?]$/.test(value) ? '' : '.') : '';
const jobText = (data, job) => job.config_id + ', seed ' + job.seed + ', ' + job.gpus + (job.gpus === 1 ? ' GPU' : ' GPUs') + ' on ' +
  data.partitions.find(p => p.id === job.partition_id).name + ' for up to ' + job.time_limit_hours + ' hours';
const REJECTED = {
  time_limit_too_long: ({partition}) => 'the time limit is longer than ' + partition.max_hours + ' hours, the longest job time of ' + partition.name,
  protocol_mismatch: ({protocol}) => 'the protocol version ' + protocol.id + ' does not cover this config and seed',
  too_many_active: ({data}) => 'you already have ' + data.project.policy.max_active_jobs + ' jobs queued, held or running, the most the lab allows',
  over_allocation: ({check}) => 'the project has ' + hoursText(Math.max(0, check.projectLeft + check.reserve)) + ' GPU-hours left, and the job needs ' + hoursText(check.reserve),
  over_share: ({check}) => 'your share has ' + hoursText(Math.max(0, check.shareLeft + check.reserve)) + ' GPU-hours left, and the job needs ' + hoursText(check.reserve)
};

const writers = {
  'allocation.changed'({data, change, held, say}) {
    const a = data.allocation, head = c.nameOf(data, data.project.lab_head_person_id), range = time.rangeText(c.dayOf(data, a.starts_at), c.dayOf(data, a.ends_at));
    const share = change.shares.find(s => s.person_id === data.owner_person_id), parts = [];
    const shareText = share && share.from !== share.to ? ' Your share is now ' + (share.to === null ? 'removed, so only the project allocation applies' : share.to + ' GPU-hours') +
      (share.from === null ? '.' : ', from ' + share.from + '.') : '';
    if (change.from_hours !== change.to_hours) {
      parts.push(head + '\'s project allocation for ' + range + ' changed from ' + change.from_hours + ' to ' + change.to_hours + ' GPU-hours.');
    } else parts.push('Your share of ' + head + '\'s project allocation for ' + range + ' changed.');
    if (change.reason) parts.push('Reason given: ' + clause(change.reason, data) + '.');
    if (shareText) parts.push(shareText.trim());
    if (held.length) parts.push(count(held.length) + ' of your queued jobs ' + (held.length === 1 ? 'no longer fits and is' : 'no longer fit and are') + ' on hold.');
    parts.push('Open Benchline to see your jobs and what is left.');
    const title = change.from_hours !== change.to_hours ? 'Your lab\'s ' + a.label + ' allocation is now ' + change.to_hours + ' GPU-hours'
      : 'Your share of the ' + a.label + ' allocation is now ' + (share.to === null ? 'removed' : share.to + ' GPU-hours');
    return {title, text: parts.join(' ')};
  },
  'job.ended'({data, job, say}) {
    const run = job.run, ran = hoursText(Math.round((ms(run.ends_at) - ms(run.starts_at)) / 36000)), charge = hoursText(views.chargeOf(data, job, ms(run.ends_at)));
    const what = 'Your job ' + job.id + ' (' + jobText(data, job) + ')';
    if (run.end_kind === 'completed') return {title: 'Your job ' + job.id + ' has completed', text: what + ' completed ' + say.moment(run.ends_at) + '. It ran for ' + ran +
      ' hours and was charged ' + charge + ' GPU-hours. Its result is ready in Benchline.'};
    if (run.end_kind === 'failed') return {title: 'Your job ' + job.id + ' has failed', text: what + ' failed ' + say.moment(run.ends_at) + '.' + sentence(run.error) +
      ' It ran for ' + ran + ' hours and was charged ' + charge + ' GPU-hours. It leaves no result.'};
    return {title: 'Your job ' + job.id + ' ran out of time', text: what + ' reached its time limit ' + say.moment(run.ends_at) + ' and was stopped. It was charged ' + charge +
      ' GPU-hours. It leaves no result.'};
  },
  'job.interrupted'({data, job, say, now}) {
    return {title: 'Your job ' + job.id + ' was interrupted', text: 'Your job ' + job.id + ' (' + jobText(data, job) + ') was interrupted ' + say.moment(job.interrupted_at) + '.' +
      (job.interrupt_reason ? ' Reason given: ' + clause(job.interrupt_reason, data) + '.' : '') + ' It leaves no result. It was charged ' + hoursText(views.chargeOf(data, job, now)) +
      ' GPU-hours. Submit it again if you still need it.'};
  },
  'job.submission_rejected'({data, args, check, error, script, say, at}) {
    const job = {...args};
    return {title: 'Your script\'s job was not submitted', text: 'Your script ' + script + ' tried to submit a job ' + say.moment(at) + ' (' + jobText(data, job) +
      (args.protocol_id ? ', under ' + args.protocol_id : '') + '). Benchline did not add it, because ' + REJECTED[error]({data, check, partition: check.partition, protocol: check.protocol}) +
      ' (' + error + '). No hours were reserved.'};
  },
  'protocol.proposed'({data, protocol, say}) {
    const signed = data.protocols.find(p => p.line === protocol.line && p.stored_state === 'signed'), changes = [];
    for (const [key, label] of [['dataset_version', 'dataset version'], ['eval_split', 'evaluation split']]) {
      if (signed && signed[key] !== protocol[key]) changes.push('the ' + label + ' from ' + signed[key] + ' to ' + protocol[key]);
    }
    if (signed && signed.metrics.map(m => m.name).join(',') !== protocol.metrics.map(m => m.name).join(',')) changes.push('the metrics to ' + protocol.metrics.map(m => m.name).join(', '));
    if (signed && signed.seeds.join(',') !== protocol.seeds.join(',')) changes.push('the seeds to ' + protocol.seeds.join(', '));
    const who = c.nameOf(data, protocol.proposed_by);
    return {title: who + ' asks you to sign ' + protocol.id, text: who + ' proposed ' + protocol.id + ', a new version of the protocol line ' + protocol.line + '.' +
      (changes.length ? ' It changes ' + changes.join(', and ') + '.' : signed ? '' : ' The line has no signed version yet.') +
      (protocol.rationale ? ' Rationale: ' + clause(protocol.rationale, data) + '.' : '') + ' You are a required signer. Sign or decline it by ' + say.moment(protocol.respond_by).replace(/^on /, '') +
      '. After that it expires.'};
  },
  'protocol.updated'({data, protocol, answer, withdrawn, say, now}) {
    if (withdrawn) {
      const who = c.nameOf(data, protocol.proposed_by);
      return {title: who + ' withdrew ' + protocol.id, text: who + ' withdrew the proposed version ' + protocol.id + ' of ' + protocol.line + '.' + sentence(withdrawn.note) +
        ' No other version changed.'};
    }
    const who = c.nameOf(data, answer.person_id), state = views.protocolState(protocol, now), missing = views.missingSigners(data, protocol).map(id => c.nameOf(data, id));
    const result = state === 'signed' ? ' Every required signer has signed, so ' + protocol.id + ' is now the signed version of ' + protocol.line + '.' +
      (protocol.supersedes ? ' ' + protocol.supersedes + ' is superseded.' : '')
      : state === 'declined' ? ' So ' + protocol.id + ' is declined, and the signed version of ' + protocol.line + ' does not change.'
      : ' It still needs ' + missing.join(' and ') + '.';
    return {title: who + (answer.answer === 'sign' ? ' signed ' : ' declined ') + protocol.id, text: who + (answer.answer === 'sign' ? ' signed ' : ' declined ') + protocol.id +
      ' of ' + protocol.line + ' ' + say.moment(answer.at) + '.' + (answer.note ? ' Note: ' + clause(answer.note, data) + '.' : '') + result};
  },
  'result.invalidated'({data, job, tables}) {
    const who = c.nameOf(data, job.invalidation.by), own = c.isOwner(data, job.owner_person_id);
    return {title: 'The result of ' + job.id + ' was invalidated', text: who + ' marked the result of ' + (own ? 'your job ' : 'the job ') + job.id + ' (' + job.config_id + ', seed ' + job.seed + ') as invalid.' +
      (job.invalidation.reason ? ' Reason given: ' + clause(job.invalidation.reason, data) + '.' : '') +
      (tables.length ? ' Your tables that cite it keep it and now read the flag cites_invalidated: ' + tables.join(', ') + '. A correction is a new version of the table.' : '')};
  }
};
function wire(data, notification) {
  const [objectType, topic] = ABOUT[notification.kind];
  return {specversion: '1.0', id: notification.id, source: 'urn:pale:app:' + encodeURIComponent(c.APP) + ':account:' + encodeURIComponent(data.account_id),
    type: 'org.pale.mail.notification.v1', time: notification.at, datacontenttype: 'application/json', dataschema: 'urn:pale:email-payload:1',
    data: {channel: 'channel.email', recipient: {kind: 'person_ref', id: data.owner_person_id},
      source_object: {app_id: c.APP, account_id: data.account_id, object_type: objectType, object_id: notification.object_id},
      content: {title: notification.title, body: {format: 'text/plain', text: notification.text}, asset_ids: []},
      subscription_ref: data.account_id + ':' + topic, extensions: []}};
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// "on 2 December at 22:00", with the year only when it is not the year of the notification.
const dayText = (day, year) => Number(day.slice(8, 10)) + ' ' + MONTHS[Number(day.slice(5, 7)) - 1] + (day.slice(0, 4) === String(year) ? '' : ' ' + day.slice(0, 4));
// One notification, released at `at` (the time of the act, or the end of a job). Days and times in the text use the time zone of the preferences.
function write(t, data, kind, objectId, details, at = t.at) {
  const zone = data.preferences.timezone, year = Number(time.localDay(ms(at), zone).slice(0, 4));
  const say = {moment: value => { const local = time.iso(ms(value), zone); return 'on ' + dayText(local.slice(0, 10), year) + ' at ' + local.slice(11, 16); }};
  const {title, text} = writers[kind]({data, say, now: t.now, at, ...details});
  const notification = {id: c.nextId(c.allIds(data), 'ntf-'), at, kind, event_id: t.actor === 'event' ? t.ref : null, request_id: t.actor === 'agent' ? t.ref : null,
    object_type: ABOUT[kind][0], object_id: objectId, title: title.slice(0, 200), text: text.slice(0, 4000), details: details.record || null, email: null, removed_at: null};
  if (data.preferences.email_notices) notification.email = wire(data, notification);
  data.notifications.push(notification);
  c.record(t, data, 'notification.written', notification.id, true);
  return notification;
}
// The job.ended notice of a job of the account holder, while job_end_notices is on. It is released at the end of the job.
function jobEnded(t, data, job) {
  if (!data.preferences.job_end_notices || !job.run) return null;
  return write(t, data, 'job.ended', job.id, {job}, job.run.ends_at);
}
// A cancellation, a hold or an interruption removes the pending job.ended notice of the job.
function removeJobEnded(t, data, job) {
  for (const n of data.notifications) {
    if (n.kind === 'job.ended' && n.object_id === job.id && n.removed_at === null && ms(n.at) > t.now) {
      n.removed_at = t.at;
      c.record(t, data, 'notification.removed', n.id, true);
    }
  }
}
module.exports = {write, wire, jobEnded, removeJobEnded, ABOUT, hundredths};
