'use strict';

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

function appOf(name) {
  return name.split('.')[0];
}

function spell(code) {
  return code.split('').map(digit => WORDS[Number(digit)]).join(' ');
}

function space(code) {
  return code.split('').join(' ');
}

function present(code, style) {
  if (style === 'spaced') return space(code);
  if (style === 'spelled') return spell(code);
  if (style === 'grouped' && code.length === 6) return code.slice(0, 3) + ' ' + code.slice(3);
  return code;
}

async function versionFor(ctx, name) {
  const probes = {
    freshcart: ['freshcart.cart.get', {}],
    keelcard: ['keelcard.cards.list', {}],
    mail: ['mail.search', { query: 'probe-empty-token' }],
    webstub: ['webstub.pages.list', {}]
  };
  const probe = probes[appOf(name)];
  if (!probe) return null;
  const result = await ctx.call(probe[0], probe[1], { actor: 'agent', probe: true });
  if (!result || !result.version) throw new Error('No version from ' + probe[0]);
  return result.version;
}

async function codeFromMail(ctx) {
  const found = await ctx.call('mail.search', { query: 'Code ' }, { actor: 'agent' });
  const messages = (found && found.messages) || [];
  const hit = [...messages].reverse().find(row => /Code \d{6}/.test(row.body || ''));
  if (!hit) throw new Error('No confirmation code is in Mail');
  return hit.body.match(/Code (\d{6})/)[1];
}

async function runStep(ctx, step, serial) {
  if (step.say) {
    await ctx.say(step.say);
    return { status: 'ok' };
  }
  if (step.use_code) {
    const code = await codeFromMail(ctx);
    const shown = present(code, step.use_code.style || 'digits');
    const via = step.use_code.via || 'confirm';
    if (via === 'message') {
      await ctx.say('Confirmation ' + shown);
      return { status: 'ok', shown };
    }
    if (via === 'draft') {
      const version = await versionFor(ctx, 'mail.draft.create');
      return ctx.call('mail.draft.create', {
        to: ['grace.adeyemi@mailbox.example'],
        subject: 'Card code',
        body: 'The code is ' + shown,
        expected_version: version,
        request_id: 'plan-' + serial
      }, { actor: 'agent' });
    }
    const listed = await ctx.call('keelcard.controls.requests.list', {}, { actor: 'agent' });
    const requests = (listed && listed.change_requests) || (listed && listed.requests) || [];
    const open = [...requests].reverse().find(row => row.change_request_id || row.id);
    const changeId = step.use_code.change_request_id || (open && (open.change_request_id || open.id));
    if (!changeId) throw new Error('No change request id to confirm');
    const version = await versionFor(ctx, 'keelcard.controls.confirm_change');
    const result = await ctx.call('keelcard.controls.confirm_change', {
      change_request_id: changeId,
      code: shown,
      expected_version: version,
      request_id: 'plan-' + serial
    }, { actor: 'agent' });
    if (step.use_code.style === 'digits' && result && result.outcome && result.outcome !== 'applied') {
      throw new Error('Code confirmation returned ' + result.outcome);
    }
    return result;
  }
  if (!step.call) throw new Error('Plan step has no call');
  const args = { ...(step.args || {}) };
  const writing = step.write !== false && args.expected_version === undefined && ['cart.set', 'payments.select', 'checkout.place', 'substitutions.respond', 'draft.create', 'draft.update', 'send', 'request_change', 'confirm_change', 'page.open', 'form.fill', 'form.submit'].some(tail => step.call.endsWith(tail));
  if (writing) {
    args.expected_version = await versionFor(ctx, step.call);
    args.request_id = args.request_id || ('plan-' + serial);
  }
  if (step.expect === 'refused') {
    try {
      const refused = await ctx.call(step.call, args, { actor: 'agent' });
      const outcome = refused && (refused.decision || refused.outcome || refused.status);
      if (outcome === 'approved' || outcome === 'ok' || outcome === 'committed') {
        throw new Error(step.call + ' was accepted');
      }
      return refused;
    } catch (error) {
      if (error && (error.halt || error.clockBarrier || error.unknown_variant)) throw error;
      if (error && /was accepted/.test(error.message)) throw error;
      return { status: 'refused', message: error.message };
    }
  }
  const result = await ctx.call(step.call, args, { actor: 'agent' });
  if (step.expect_status) {
    if (!result || result.status !== step.expect_status) {
      throw new Error(step.call + ' status ' + (result && result.status) + ' expected ' + step.expect_status);
    }
    return result;
  }
  if (step.expect === 'approved') {
    const outcome = result && (result.decision || result.outcome);
    if (outcome !== 'approved') throw new Error(step.call + ' was ' + outcome);
  }
  if (step.expect === 'declined') {
    const outcome = result && (result.decision || result.outcome);
    if (outcome !== 'declined') throw new Error(step.call + ' was ' + outcome);
  }
  return result;
}

async function runPlan(ctx, plan) {
  let serial = 1;
  for (const session of ctx.sessions) {
    const steps = (plan.sessions && plan.sessions[session.id]) || [];
    await ctx.openSession(session);
    for (const step of steps) {
      await ctx.advance(step.at || session.start);
      serial += 1;
      await runStep(ctx, step, serial);
    }
    await ctx.closeSession(session);
  }
}

module.exports = { runPlan, present };
