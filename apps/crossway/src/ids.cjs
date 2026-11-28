'use strict';
// Deterministic run-time IDs: the next number after the highest existing one.
function nextId(list, prefix) {
  let max = 0;
  const pattern = new RegExp('^' + prefix.replace(/[-.]/g, '\\$&') + '-(\\d+)$');
  for (const item of list) {
    const m = pattern.exec(item.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
}
module.exports = {nextId};
