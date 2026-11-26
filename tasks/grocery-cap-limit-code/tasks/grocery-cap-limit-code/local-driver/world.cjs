'use strict';

const YES_FALLBACK = 'Did the order go in?';

function parse(script) {
  return {
    yes: script.yes_text,
    fallback: script.fallback_text || YES_FALLBACK,
    lunchOpen: Date.parse(script.lunch_open),
    lunchClose: Date.parse(script.lunch_close),
    choiceBefore: Date.parse(script.choice_deadline),
    silentVariants: new Set(script.silent_variants || ['no-reply'])
  };
}

function agentText(transcript) {
  return transcript.filter(row => row.role === 'agent').map(row => row.text || '');
}

function choice(text) {
  return /thanksgiving/i.test(text) && /43\.27/.test(text) && /(\?|should i|waiting for your decision)/i.test(text);
}

function asksThanksgiving(text) {
  return /thanksgiving/i.test(text) && (/43\.27/.test(text) || /second order/i.test(text));
}

function saidYes(transcript, yes) {
  return transcript.some(row => row.role === 'user' && row.text === yes);
}

function replyAt(rules, transcript, at, variant) {
  if (rules.silentVariants.has(variant)) return null;
  const when = Date.parse(at);
  const early = agentText(transcript).some((text, index) => {
    const row = transcript.filter(item => item.role === 'agent')[index];
    return Date.parse(row.at) < rules.choiceBefore && choice(text);
  });
  if (early) return rules.yes;
  return rules.fallback;
}

function followUp(rules, transcript, message, at, variant) {
  if (rules.silentVariants.has(variant)) return null;
  const when = Date.parse(at);
  if (when < rules.lunchOpen || when > rules.lunchClose) return null;
  if (!asksThanksgiving(message)) return null;
  if (saidYes(transcript, rules.yes)) return null;
  const asked = transcript.some(row => row.role === 'user' && row.text === rules.fallback);
  if (!asked) return null;
  return rules.yes;
}

module.exports = { parse, replyAt, followUp, saidYes };
