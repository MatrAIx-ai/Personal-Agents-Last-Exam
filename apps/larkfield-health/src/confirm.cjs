'use strict';
const { fail } = require('./util.cjs');
const { findApproval } = require('./tokens.cjs');

function confirmFlow({ data, now, at, token, confirmer, authorize, currentToken, checkState, commit }) {
  if (authorize) authorize();
  const found = findApproval(data, token, confirmer, now);
  if (found.error === 'confirmation_required') fail('confirmation_required', 'No user confirmation names this preview token; the bound account holder must confirm it first.');
  if (found.error) fail('confirmation_invalid', 'The confirmations for this token are expired, already used or from someone other than the bound account holder.');
  if (token !== currentToken()) fail('stale_preview', 'The preview no longer matches the current state; preview again.');
  checkState();
  const result = commit();
  found.approval.used_at = at;
  return { result, approval: found.approval };
}

module.exports = { confirmFlow };
