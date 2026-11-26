'use strict';
const assert = require('node:assert/strict');
const {fixture} = require('../tests/harness.cjs');

function demonstrate() {
  const f = fixture({dir: 'examples/task-data/family-care'});
  const before = f.data;
  const result = f.call('kinthread.roles.set', {
    group_id: 'grp-osei-care',
    person_id: 'person-mercy',
    role: 'member'
  });
  const notice = f.data.notices.find(item => item.notice_id === result.notice_id);
  assert.equal(notice.status, 'pending_delivery');
  assert.equal(notice.notice_type, 'role_change');
  assert.equal(notice.recipient_person_id, 'person-daniel');
  assert.equal(f.data.groups[0].members.find(member => member.person_id === 'person-mercy').role, 'member');
  assert.equal(before.notices.length, 0);
  return {
    group_id: 'grp-osei-care',
    person_id: 'person-mercy',
    from: 'admin',
    to: 'member',
    notice_id: notice.notice_id,
    status: notice.status,
    title: notice.title,
    body: notice.body
  };
}

module.exports = {demonstrate};
if (require.main === module) console.log(JSON.stringify(demonstrate(), null, 2));
