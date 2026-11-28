'use strict';
const { nextId } = require('./util.cjs');
const { parseToken } = require('./tokens.cjs');

function userConfirmed(data, payload, ctx) {
  data.approvals.push({ approval_id: nextId(data, 'ap'), token: payload.token, subject: parseToken(payload.token), confirmed_by: payload.confirmed_by, confirmed_at: ctx.virtual_now, used_at: null });
  return data;
}

module.exports = { userConfirmed };
