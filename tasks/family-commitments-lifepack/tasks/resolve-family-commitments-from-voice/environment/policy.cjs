'use strict';
// These tags denote household task categories. The adapter owns tags, stable identifiers,
// and list placement; text is display-only and never grants an additional permission.
const categories = ['cake','pickup','handoff','transport','authority','combined'];
const names = {rui:'Rui',mei:'Mei',sam:'Sam'};
const active = t => Boolean(t && ['todo','in_progress'].includes(t.status));
function kind(t) { return t?.tags?.length === 1 ? t.tags[0] : undefined; }
function listFor(owner, category) {
  return ['transport','authority','combined'].includes(category) ? 'Follow-up' : names[owner];
}
function owns(t, owner) { return t?.assignee_person_id === owner; }
function allowed(stage, variant, answered, before, after) {
  const category = kind(after);
  if (!categories.includes(category) || !names[after.assignee_person_id]) return false;
  if (before && kind(before) !== category) {
    // Once travel is settled a combined Rui question can become permission-only.
    if (!(kind(before)==='combined' && category==='authority' && answered &&
      variant==='restricted' && owns(before,'rui') && before.status==='todo')) return false;
  }
  if (after.list !== listFor(after.assignee_person_id, category)) return false;
  if (category === 'pickup' && (after.id !== 'pickup' || !owns(after,'sam'))) return false;
  const friday = ['withdrawal','transport-reply','close'].includes(stage);
  if (!friday && stage !== 'discussion') return false;
  if (category === 'cake') {
    if (before && !['mei','rui'].includes(before.assignee_person_id)) return false;
    if (after.status === 'cancelled')
      return before && owns(before,friday ? 'mei':'rui') && owns(after,before.assignee_person_id);
    return after.status === 'todo' && owns(after,friday ? 'rui':'mei') && (!friday || variant === 'main');
  }
  if (category === 'handoff') return owns(after,'rui') && (!before || owns(before,'rui')) &&
    (friday ? before && after.status === 'cancelled' : after.status === 'todo');
  if (category === 'pickup') return Boolean(before) && owns(before,'sam') &&
    after.status === ((!friday || answered) ? 'todo' : 'cancelled');
  if (!friday || !owns(after,'rui') || (before && !owns(before,'rui'))) return false;
  if (['authority','combined'].includes(category) && variant !== 'restricted') return false;
  if (after.status === 'todo') return category !== 'transport' || !answered;
  return category === 'transport' && answered && before && after.status === 'completed';
}
module.exports = {categories,names,kind,owns,active,listFor,allowed};
