'use strict';
// A strict reader for the small part of YAML that LifePack files use:
// block mappings, block sequences, one-line scalars, quoted strings, [a, b] lists of scalars and # comments.
// Anything else (anchors, tags, multi-line text blocks, several documents, tabs) is an error, not a guess.
// The repository runs on Node.js without external packages, so there is no general YAML library to call.

function parse(source, name = 'yaml') {
  const fail = (n, message) => { throw new Error(`${name}:${n}: ${message}`); };

  // Drop a comment: a # at the start of the line or after a space, outside quotes.
  const stripComment = (raw) => {
    let quote = null;
    for (let i = 0; i < raw.length; i += 1) {
      const c = raw[i];
      if (quote) {
        if (c === '\\' && quote === '"') i += 1;
        else if (c === quote) quote = null;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '#' && (i === 0 || /\s/.test(raw[i - 1]))) return raw.slice(0, i);
    }
    return raw;
  };

  const lines = [];
  source.split(/\r?\n/).forEach((raw, i) => {
    if (raw.match(/^\s*/)[0].includes('\t')) fail(i + 1, 'tabs are not allowed for indentation');
    const text = stripComment(raw).replace(/\s+$/, '');
    if (!text.trim()) return;
    if (/^(---|\.\.\.)(\s|$)/.test(text)) fail(i + 1, 'several documents in one file are not supported');
    lines.push({ indent: text.match(/^ */)[0].length, text: text.trim(), n: i + 1 });
  });
  let pos = 0;

  const scalar = (text, n) => {
    if (text === '[]') return [];
    if (text === '{}') return {};
    if (text.startsWith('[')) {
      if (!text.endsWith(']')) fail(n, 'a list in brackets must end on the same line');
      const items = [];
      let current = '';
      let quote = null;
      for (const c of text.slice(1, -1)) {
        if (quote) { current += c; if (c === quote) quote = null; } else if (c === '"' || c === "'") { quote = c; current += c; } else if (c === ',') { items.push(current); current = ''; } else if (c === '[' || c === '{') fail(n, 'nested brackets are not supported'); else current += c;
      }
      if (current.trim()) items.push(current);
      return items.map((item) => scalar(item.trim(), n));
    }
    if (text.startsWith('{')) fail(n, 'mappings in braces are not supported; use indented keys');
    if (text.startsWith('"')) {
      try { return JSON.parse(text); } catch { fail(n, 'bad double-quoted string'); }
    }
    if (text.startsWith("'")) {
      if (!text.endsWith("'") || text.length < 2) fail(n, 'bad single-quoted string');
      return text.slice(1, -1).replace(/''/g, "'");
    }
    if (/^[|>&*!%@`]/.test(text)) fail(n, `"${text[0]}" syntax is not supported; write the value on one line or in a separate file`);
    if (text === 'null' || text === '~') return null;
    if (text === 'true') return true;
    if (text === 'false') return false;
    if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(text)) return Number(text);
    return text;
  };

  // Splits "key: value" at the first colon that is followed by a space or ends the line.
  const splitKey = (line) => {
    const m = line.text.match(/^("(?:[^"\\]|\\.)*"|'[^']*'|[^\s:][^:]*?)\s*:(?:\s+(.*))?$/);
    if (!m) fail(line.n, 'expected "key: value"');
    const key = /^["']/.test(m[1]) ? scalar(m[1], line.n) : m[1];
    return { key, rest: (m[2] || '').trim() };
  };
  const isItem = (text) => text === '-' || text.startsWith('- ');
  const isKeyed = (text) => /^("(?:[^"\\]|\\.)*"|'[^']*'|[^\s:"'\[{][^:]*?)\s*:(\s|$)/.test(text);

  function nested(parentIndent) {
    if (pos >= lines.length) return null;
    const next = lines[pos];
    if (next.indent > parentIndent) return block(next.indent);
    if (next.indent === parentIndent && isItem(next.text)) return sequence(parentIndent);
    return null;
  }
  function block(indent) {
    return isItem(lines[pos].text) ? sequence(indent) : mapping(indent);
  }
  function mapping(indent) {
    const out = {};
    while (pos < lines.length && lines[pos].indent === indent && !isItem(lines[pos].text)) {
      const line = lines[pos];
      const { key, rest } = splitKey(line);
      if (Object.prototype.hasOwnProperty.call(out, key)) fail(line.n, `duplicate key "${key}"`);
      pos += 1;
      out[key] = rest === '' ? nested(indent) : scalar(rest, line.n);
    }
    if (pos < lines.length && lines[pos].indent > indent) fail(lines[pos].n, 'unexpected indentation');
    return out;
  }
  function sequence(indent) {
    const out = [];
    while (pos < lines.length && lines[pos].indent === indent && isItem(lines[pos].text)) {
      const line = lines[pos];
      const rest = line.text === '-' ? '' : line.text.slice(1).trim();
      if (rest === '') { pos += 1; out.push(nested(indent)); continue; }
      if (isKeyed(rest)) {
        // "- key: value" starts a mapping whose other keys line up under the first key.
        const column = indent + line.text.indexOf(rest);
        lines[pos] = { indent: column, text: rest, n: line.n };
        out.push(mapping(column));
      } else { pos += 1; out.push(scalar(rest, line.n)); }
    }
    if (pos < lines.length && lines[pos].indent > indent) fail(lines[pos].n, 'unexpected indentation');
    return out;
  }

  if (!lines.length) return null;
  if (lines[0].indent !== 0) fail(lines[0].n, 'the first line must not be indented');
  const value = block(0);
  if (pos < lines.length) fail(lines[pos].n, 'unexpected content');
  return value;
}

module.exports = { parse };
