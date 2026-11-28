'use strict';
const { fail } = require('./util.cjs');
const { findApproval } = require('./tokens.cjs');

function confirmFlow({ data, now, at, token, authorize, confirmer, currentToken, checkState, pay, commit }) {
  if (authorize) authorize();
  let approval = null;
  if (confirmer !== undefined) {
    const found = findApproval(data, token, confirmer, now);
    if (found.error === 'confirmation_required') fail('confirmation_required', 'No user confirmation names this preview token; the required person must confirm it first.');
    if (found.error) fail('confirmation_invalid', 'The confirmations for this token are expired, already used or from someone other than the required person.');
    approval = found.approval;
  }
  if (token !== currentToken()) fail('stale_preview', 'The preview no longer matches the current state; preview again.');
  checkState();
  if (pay) pay();
  const result = commit();
  if (approval) approval.used_at = at;
  return { result, approval };
}

module.exports = { confirmFlow };
