'use strict';
const childProcess = require('node:child_process');
const original = childProcess.spawn;
childProcess.spawn = function spawn(command, args, options) {
  const child = original.call(this, command, args, options);
  if (process.env.KINTHREAD_DROP_MAIL_REPLY !== '1') return child;
  const list = args || [];
  const appAt = list.indexOf('--app');
  if (appAt < 0 || list[appAt + 1] !== 'mail') return child;
  let dropId = null;
  const write = child.stdin.write.bind(child.stdin);
  child.stdin.write = function(chunk, encoding, callback) {
    const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    if (dropId === null && text.includes('env.apply_event')) {
      const line = text.split('\n').find(row => row.includes('env.apply_event'));
      try { dropId = JSON.parse(line).id; } catch (error) { dropId = null; }
    }
    return write(chunk, encoding, callback);
  };
  const on = child.stdout.on.bind(child.stdout);
  child.stdout.on = function(event, listener) {
    if (event !== 'data') return on(event, listener);
    return on(event, function(buf) {
      if (dropId === null || dropId === 'done') return listener(buf);
      const lines = buf.toString('utf8').split('\n');
      const kept = [];
      let dropped = false;
      for (const line of lines) {
        if (!line) continue;
        try {
          const message = JSON.parse(line);
          if (message.id === dropId) {
            dropId = 'done';
            dropped = true;
            continue;
          }
        } catch (error) { /* keep non-json fragments */ }
        kept.push(line);
      }
      if (kept.length) listener(Buffer.from(kept.join('\n') + '\n'));
      if (dropped) child.kill('SIGTERM');
    });
  };
  return child;
};
