'use strict';

function options(argv, flags = []) {
  const out = { date: null };
  for (const f of flags) out[f.slice(2)] = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--date') {
      const v = argv[++i];
      const d = new Date((v || '') + 'T00:00:00Z');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '') || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw Error('--date needs a calendar date as YYYY-MM-DD');
      if (out.date !== null) throw Error('--date is given twice');
      out.date = v;
    } else if (flags.includes(a)) out[a.slice(2)] = true;
    else throw Error('Unknown argument ' + a + '; accepted: --date YYYY-MM-DD' + flags.map(f => ', ' + f).join(''));
  }
  return out;
}

const today = () => new Date().toISOString().slice(0, 10);

module.exports = { options, today };
