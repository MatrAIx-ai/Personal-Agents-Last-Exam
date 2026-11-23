'use strict';
const PROJECTION = Symbol('projection');
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const clone = value => structuredClone(value);
const textLength = text => [...text].length;

function allIds(data) {
  return [
    ...data.orders.map(o => o.id), ...data.cart.lines.map(l => l.id),
    ...data.orders.flatMap(o => o.lines.map(l => l.id)), ...data.orders.flatMap(o => o.refunds.map(r => r.id)),
    ...data.notices.map(n => n.id),
  ];
}
function nextId(data, prefix) {
  const pattern = new RegExp('^' + prefix + '-(\\d+)$');
  const highest = allIds(data).reduce((max, id) => {
    const m = pattern.exec(id);
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);
  if (!data.issued) data.issued = {};
  const next = Math.max(highest, data.issued[prefix] || 0) + 1;
  if (next > 999999999 && !data[PROJECTION]) fail('invalid_state', 'This account has issued every ' + prefix + ' ID it can; no further records can be created.');
  data.issued[prefix] = next;
  return prefix + '-' + next;
}
module.exports = { fail, clone, textLength, nextId, PROJECTION };
