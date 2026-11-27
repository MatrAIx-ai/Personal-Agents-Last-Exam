'use strict';
// The task runner calls this after each Agent call that committed a notice,
// and once more when the session ends. Kinthread does not publish by itself.
const {publishPending} = require('../src/publisher.cjs');

async function publishPendingNotices({infra, router}) {
  return publishPending({infra, router});
}

module.exports = {publishPendingNotices};
