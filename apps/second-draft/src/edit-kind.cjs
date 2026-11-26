'use strict';
// second-draft-edit-kind/1: classify a change to one paragraph, keep authorship per sentence and compute
// authorship shares. Pure functions; Second Draft's own test rule, not a judgment of good writing.
const RULE = 'second-draft-edit-kind/1';
const AUTHORS = ['student', 'agent', 'suggestion'];

// Split at '.', '?' or '!' followed by whitespace or the end; the terminator stays with its sentence.
function sentences(text) {
  return (String(text).trim().match(/.+?[.?!](?=\s|$)|.+$/g) || []).map(s => s.trim()).filter(Boolean);
}
const words = sentence => sentence.split(/\s+/).filter(Boolean);
const chars = text => [...text].length;

// Word-level Levenshtein distance; words are whitespace-separated tokens.
function distance(a, b) {
  let prev = Array.from({length: b.length + 1}, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
    prev = cur;
  }
  return prev[b.length];
}

// `language` when exactly one sentence changes, none is added or removed, and the word edit distance is at most
// 30% of the old sentence's words (compared as integers, 10·d ≤ 3·n); otherwise `content`.
function editKind(oldText, newText) {
  const o = sentences(oldText), n = sentences(newText);
  const changed = o.length === n.length ? o.map((s, i) => [s, n[i]]).filter(([a, b]) => a !== b) : null;
  if (!changed || changed.length !== 1) return {kind: 'content', words_changed: null, words_in_sentence: null};
  const a = words(changed[0][0]), d = distance(a, words(changed[0][1]));
  return {kind: 10 * d <= 3 * a.length ? 'language' : 'content', words_changed: d, words_in_sentence: a.length};
}

// New authorship for a paragraph: sentences kept unchanged (a longest common subsequence of the old and new
// sentences, compared exactly) keep their author; every other new sentence takes the change's author and ref.
function reauthor(old, newText, author, ref) {
  const o = old.map(s => s.text), n = sentences(newText);
  const L = Array.from({length: o.length + 1}, () => new Array(n.length + 1).fill(0));
  for (let i = o.length - 1; i >= 0; i--) {
    for (let j = n.length - 1; j >= 0; j--) L[i][j] = o[i] === n[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  }
  const out = [];
  let i = 0, j = 0;
  while (j < n.length) {
    if (i < o.length && o[i] === n[j]) { out.push({text: old[i].text, author: old[i].author, ref: old[i].ref}); i++; j++; }
    else if (i < o.length && L[i + 1][j] >= L[i][j + 1]) i++;
    else { out.push({text: n[j], author, ref}); j++; }
  }
  return out;
}

const paragraphText = p => p.sentences.map(s => s.text).join(' ');

// Characters in each author's sentences over the characters in all sentences, in percent to one decimal.
function shares(paragraphs) {
  const by = {};
  let total = 0;
  for (const p of paragraphs) for (const s of p.sentences) { const c = chars(s.text); total += c; by[s.author] = (by[s.author] || 0) + c; }
  return Object.fromEntries(AUTHORS.filter(a => by[a]).map(a => [a, Math.round(1000 * by[a] / total) / 10]));
}

// Occurrences of `quote` in `text` (overlapping occurrences count).
function occurrences(text, quote) {
  let n = 0;
  for (let at = text.indexOf(quote); at !== -1; at = text.indexOf(quote, at + 1)) n++;
  return n;
}

module.exports = {RULE, AUTHORS, sentences, words, distance, editKind, reauthor, paragraphText, shares, occurrences};
