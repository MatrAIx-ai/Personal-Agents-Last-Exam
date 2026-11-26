'use strict';
// Records the observations the runner actually delivers.
const fs = require('node:fs');

function createAgent() {
  const seen = [];
  const cursor = {s1: 0, s2: 0, s3: 0};
  const steps = {
    s1: [{say: 'Hello.'}, {end_turn: true}],
    s2: [{say: 'Where should I start?'}, {end_turn: true}],
    s3: [{say: 'Nothing further.'}, {end_turn: true}]
  };
  return {
    name: 'recorder',
    next(ctx) {
      seen.push({
        session_id: ctx.session_id,
        system: ctx.system,
        hint: ctx.hint,
        history_ids: ctx.history ? ctx.history.map((row) => row.id) : null,
        observations: (ctx.observations || []).map((row) => ({type: row.type, kind: row.kind || null, name: row.name || null, status: row.status || null}))
      });
      if (process.env.PALE_OBSERVATION_LOG) fs.writeFileSync(process.env.PALE_OBSERVATION_LOG, JSON.stringify(seen));
      const list = steps[ctx.session_id] || [];
      const step = list[cursor[ctx.session_id]] || null;
      cursor[ctx.session_id] += 1;
      return step;
    }
  };
}

module.exports = {createAgent};
