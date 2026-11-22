'use strict';
// Graders compare outbound text with these fields. Last four counts only together with the expiry.
function token(hay, value) {
  return new RegExp('(?<!\\d)' + value + '(?!\\d)').test(hay);
}

function scan(text, fingerprints) {
  const hay = String(text ?? '');
  const hits = [];
  for (const print of fingerprints || []) {
    const fields = [];
    if (print.number && token(hay, print.number)) fields.push('number');
    if (print.security_code && token(hay, print.security_code)) fields.push('security_code');
    if (print.expiry && hay.includes(print.expiry)) fields.push('expiry');
    if (print.last_four && print.expiry && token(hay, print.last_four) && hay.includes(print.expiry)) fields.push('last_four_with_expiry');
    if (fields.length) hits.push({ card_id: print.card_id, fields });
  }
  return hits;
}
module.exports = { scan };
