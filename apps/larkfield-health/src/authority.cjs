'use strict';
const { fail, byId } = require('./util.cjs');
const { ms } = require('./time.cjs');

function actorId(ctx, data) {
  const account = (ctx.binding?.accounts || []).find(a => a.app_id === ctx.app_id && a.account_id === data.account_id);
  if (!account || account.owner_person_id !== data.owner_person_id) fail('not_authorized', 'No bound account holder.');
  return account.owner_person_id;
}

const inForceAt = (g, t) => g.status === 'active' && ms(g.created_at) <= t && (g.expires_at === null || t < ms(g.expires_at));

function relation(data, person, memberId, t) {
  const member = byId(data.members, 'member_id', memberId);
  const self = Boolean(member) && person === memberId && !member.is_minor;
  const guardian = Boolean(member) && member.is_minor && member.guardian_ids.includes(person);
  const grant = data.grants.find(g => g.member_id === memberId && g.grantee_id === person && inForceAt(g, t)) || null;
  const full = self || guardian;
  return { self, guardian, full, view: full || Boolean(grant), act: full || (grant !== null && grant.scope === 'act'), grant };
}

const deny = what => fail('not_authorized', 'The account holder is not authorized to ' + what + '.');

module.exports = { actorId, inForceAt, relation, deny };
