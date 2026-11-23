'use strict';
const {fail, copy, log, place: getPlace, rule: getRule, savedPlace, nextId} = require('./common.cjs');
const {validateRule} = require('./model.cjs');
const {validZone, render} = require('./time.cjs');
const {LIMITS, DEFAULT_PROVIDER} = require('./catalog.cjs');

const RULE_FIELDS = ['saved_place_id', 'metric', 'comparator', 'threshold', 'provider', 'look_ahead_hours', 'window',
  'alert_events', 'min_severity', 'notify_on_clear', 'delivery', 'quiet_hours', 'severe_override'];
const stamp = (ctx, data) => render(ctx.virtual_now, data.settings.time_zone);

function history(ctx, data, rule, action, changes) {
  rule.history.push({revision: rule.revision, at: stamp(ctx, data), action, changes: copy(changes)});
}

function write(ctx, data, name, args) {
  switch (name) {
    case 'gustline.saved_places.add': {
      getPlace(data, args.place_id);
      if (data.saved_places.length >= LIMITS.saved_places) fail('saved_place_limit', 'At most 20 saved places.');
      if (data.saved_places.some(s => s.place_id === args.place_id || s.label === args.label)) fail('duplicate_saved_place', 'That place or label is already saved.');
      const saved_place_id = nextId(data.saved_places, 'saved_place_id', 'sp');
      data.saved_places.push({saved_place_id, place_id: args.place_id, label: args.label, created_at: stamp(ctx, data)});
      return {saved_place_id};
    }
    case 'gustline.saved_places.rename': {
      const s = savedPlace(data, args.saved_place_id);
      if (data.saved_places.some(x => x !== s && x.label === args.label)) fail('duplicate_saved_place', 'That label is already used.');
      s.label = args.label;
      return {saved_place_id: s.saved_place_id};
    }
    case 'gustline.saved_places.remove': {
      const s = savedPlace(data, args.saved_place_id);
      if (data.rules.some(r => r.saved_place_id === s.saved_place_id)) fail('saved_place_in_use', 'A rule refers to this saved place; delete or retarget it first.');
      data.saved_places = data.saved_places.filter(x => x !== s);
      if (data.settings.default_saved_place_id === s.saved_place_id) data.settings.default_saved_place_id = null;
      return {saved_place_id: s.saved_place_id};
    }
    case 'gustline.settings.update': {
      const {expected_version, request_id, ...changes} = args;
      if (!Object.keys(changes).length) fail('invalid_preferences', 'Nothing to change.');
      if (changes.time_zone !== undefined && !validZone(changes.time_zone)) fail('invalid_preferences', 'Unknown time zone.');
      if (changes.default_saved_place_id) savedPlace(data, changes.default_saved_place_id);
      Object.assign(data.settings, changes);
      return {settings: copy(data.settings)};
    }
    case 'gustline.rules.create': {
      if (data.rules.length >= LIMITS.rules) fail('rule_limit', 'At most 25 rules.');
      const alert = args.kind === 'official_alert';
      const rule = {rule_id: nextId(data.rules, 'rule_id', 'rule'), saved_place_id: args.saved_place_id, kind: args.kind,
        metric: alert ? null : (args.metric ?? null), comparator: alert ? null : (args.comparator ?? null),
        threshold: alert ? null : (args.threshold ?? null), provider: args.provider || DEFAULT_PROVIDER,
        look_ahead_hours: args.kind === 'forecast_threshold' ? (args.look_ahead_hours ?? 24) : null,
        window: args.window ?? null, alert_events: args.alert_events || [], min_severity: args.min_severity ?? null,
        notify_on_clear: args.notify_on_clear ?? false, delivery: args.delivery || 'in_app', quiet_hours: args.quiet_hours ?? null,
        severe_override: args.severe_override ?? false, status: 'active', created_at: stamp(ctx, data), revision: 1, history: []};
      if (alert && (args.metric !== undefined || args.threshold !== undefined || args.comparator !== undefined)) fail('invalid_rule', 'Alert rules take events and a minimum severity, not a metric.');
      validateRule(data, rule);
      history(ctx, data, rule, 'created', Object.fromEntries(RULE_FIELDS.map(k => [k, rule[k]])));
      data.rules.push(rule);
      log(ctx, 'gustline.rule_created', {rule_id: rule.rule_id});
      return {rule_id: rule.rule_id, revision: 1};
    }
    case 'gustline.rules.update': {
      const rule = getRule(data, args.rule_id);
      if (!Object.keys(args.patch).length) fail('invalid_rule', 'Patch must change a field.');
      Object.assign(rule, copy(args.patch));
      validateRule(data, rule);
      rule.revision++;
      history(ctx, data, rule, 'updated', args.patch);
      return {rule_id: rule.rule_id, revision: rule.revision};
    }
    case 'gustline.rules.pause':
    case 'gustline.rules.resume': {
      const rule = getRule(data, args.rule_id), pause = name.endsWith('pause');
      if (pause && rule.status === 'paused') fail('already_paused', 'The rule is already paused.');
      if (!pause && rule.status === 'active') fail('not_paused', 'The rule is not paused.');
      rule.status = pause ? 'paused' : 'active';
      rule.revision++;
      history(ctx, data, rule, pause ? 'paused' : 'resumed', {status: rule.status});
      return {rule_id: rule.rule_id, revision: rule.revision};
    }
    case 'gustline.rules.delete': {
      const rule = getRule(data, args.rule_id);
      data.rules = data.rules.filter(r => r !== rule);
      return {rule_id: rule.rule_id};
    }
    case 'gustline.notifications.acknowledge': {
      const n = data.notifications.find(x => x.notification_id === args.notification_id);
      if (!n) fail('notification_not_found', 'Notification does not exist.');
      n.acknowledged_at = n.acknowledged_at || stamp(ctx, data);
      return {notification_id: n.notification_id, acknowledged_at: n.acknowledged_at};
    }
    default: fail('unknown_tool', 'Unknown business operation.');
  }
}

module.exports = {write};
