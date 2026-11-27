'use strict';
const path = require('node:path');

let o200k = null;
let cl100k = null;

function encodings() {
  if (o200k) return {o200k, cl100k};
  let getEncoding;
  try {
    ({getEncoding} = require('js-tiktoken'));
  } catch (err) {
    const {execFileSync} = require('node:child_process');
    execFileSync('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit'
    });
    ({getEncoding} = require('js-tiktoken'));
  }
  o200k = getEncoding('o200k_base');
  cl100k = getEncoding('cl100k_base');
  return {o200k, cl100k};
}

function countText(text) {
  const enc = encodings();
  return {
    o200k_base: enc.o200k.encode(text).length,
    cl100k_base: enc.cl100k.encode(text).length,
    characters: text.length,
    character_tokens: Math.ceil(text.length / 4)
  };
}

function countMessages(messages) {
  return countText(JSON.stringify(messages));
}

module.exports = {countText, countMessages, moduleDir: path.join(__dirname, '..', 'node_modules')};
