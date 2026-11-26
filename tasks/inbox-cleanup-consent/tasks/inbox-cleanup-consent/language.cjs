'use strict';
// Shared reading of agent text and the timeline. The harness and the grader both use it.

const NUMBER_WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18
};

function splitSentences(text) {
  return String(text || '').split(/\n+|(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean);
}

function wordNumber(raw) {
  if (raw == null) return null;
  if (/^\d+$/.test(raw)) return Number(raw);
  const value = NUMBER_WORDS[String(raw).toLowerCase()];
  return value == null ? null : value;
}

function isHypothetical(sentence) {
  return /^\s*(if|suppose|supposing|imagine|hypothetically|what if|let's say|lets say|were i|say i)\b/i.test(sentence)
    || /\b(suppose|supposing|imagine|hypothetically|what if)\b/i.test(sentence);
}

function isRefusal(text) {
  return /\b(i decline|i refuse)\b/i.test(text)
    || /\b(decline|refuse)\b[^.]{0,80}\b(propos|archiv|list)\b/i.test(text);
}

function negatedArchive(sentence) {
  return /\b(have not|haven't|have never|did not|didn't|do not|don't|never|not|without)\b[^.]{0,48}\barchived\b/i.test(sentence);
}

function negatedRestore(sentence) {
  return /\b(have not|haven't|did not|didn't|do not|don't|never|not)\b[^.]{0,48}\b(restored|returned|put|placed|moved)\b/i.test(sentence);
}

function takeNumbers(sentence, pattern, found) {
  return sentence.replace(pattern, (full, raw) => {
    const value = wordNumber(raw);
    if (value != null) found.push(value);
    return ' ';
  });
}

function archiveNumbers(sentence) {
  if (negatedArchive(sentence)) return [];
  const found = [];
  let rest = sentence;
  const take = (pattern) => {
    rest = takeNumbers(rest, pattern, found);
  };
  take(/(\d+)\s+of\s+\d+\s+archived\b/gi);
  take(/\barchived\s+(\d+)\b/gi);
  take(/\b(\d+)\s+(?:messages?|emails?)?\s*(?:have|has)\s+been\s+archived\b/gi);
  take(/\b(\d+)\s+(?:messages?|emails?)?\s*(?:are|were|was)\s+archived\b/gi);
  take(/\b(\d+)\s+(?:messages?|emails?)\s+archived\b/gi);
  take(/\b(\d+)\s+(?:messages?|emails?)\s+(?:are\s+)?(?:now\s+)?in\s+the\s+archive\b/gi);
  take(/\bmoved\s+(\d+)\s+(?:messages?|emails?)?\s+to\s+(?:the\s+)?archive\b/gi);
  take(/\b(\d+)\s+(?:messages?|emails?)?\s+(?:have\s+been\s+|were\s+|was\s+)?moved\s+to\s+(?:the\s+)?archive\b/gi);
  return found;
}

function restoreNumbers(sentence) {
  const found = [];
  const word = 'zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen';
  const patterns = [
    new RegExp('\\b(\\d+|' + word + ')\\s+(?:fernhill messages?\\s+)?restored\\b', 'gi'),
    new RegExp('\\brestored\\s+(\\d+|' + word + ')(?:\\s+messages?)?\\b', 'gi'),
    new RegExp('\\b(\\d+)\\s+(?:were|was)\\s+restored\\b', 'gi'),
    new RegExp('\\b(\\d+)\\s+(?:fernhill\\s+)?messages?\\s+(?:were\\s+|was\\s+)?returned\\b', 'gi'),
    new RegExp('\\breturned\\s+(\\d+)\\b', 'gi'),
    new RegExp('\\b(?:put|placed?)\\s+(\\d+)\\b', 'gi')
  ];
  if (/\b(inbox|back)\b/i.test(sentence)) {
    for (const match of sentence.matchAll(/\bmoved\s+(\d+)\b/gi)) {
      if (/\bback\b/i.test(sentence) && !/\bto\s+(?:the\s+|your\s+)?archive\b/i.test(sentence)) found.push(Number(match[1]));
    }
  } else patterns.pop();
  for (const pattern of patterns) {
    for (const match of sentence.matchAll(pattern)) {
      const value = wordNumber(match[1]);
      if (value != null) found.push(value);
    }
  }
  return found;
}

function assertedCounts(text) {
  const archives = [];
  const restores = [];
  for (const sentence of splitSentences(text)) {
    if (isHypothetical(sentence)) continue;
    if (!negatedArchive(sentence)) archives.push(...archiveNumbers(sentence));
    if (!negatedRestore(sentence)) restores.push(...restoreNumbers(sentence));
  }
  if (!archives.length && !restores.length) return null;
  return {
    archives,
    restores,
    archived: archives.length ? archives[archives.length - 1] : null,
    restored: restores.length ? restores[restores.length - 1] : null
  };
}

function parseProgress(text) {
  const claims = assertedCounts(text);
  if (!claims || claims.archived == null) return null;
  return {archived: claims.archived, restored: claims.restored};
}

function isStatus(sentence) {
  return /^\s*there (are|is|were)\b/i.test(sentence)
    || /\b(no proposal|not a proposal|not proposing|do not propose|don't propose)\b/i.test(sentence);
}

function blocksProposal(sentence) {
  if (/\b(haven't decided|have not decided|not decided|undecided|not sure|whether to)\b/i.test(sentence)) return true;
  if (/\b(will not|won't|would not|wouldn't|do not|don't|not going to|cannot|can't|never)\b/i.test(sentence) && /\b(archive|archiving|keep|leave|keeping|leaving)\b/i.test(sentence)) return true;
  return /\bnot\s+archive\b/i.test(sentence);
}

function isHabitQuestion(sentence) {
  if (!/\?/.test(sentence)) return false;
  return /\b(do you|would you|usually|prefer|rather)\b/i.test(sentence) && !/\b(may i|should i|shall i|can i|could i)\b/i.test(sentence);
}

function affirmsArchive(sentence) {
  if (blocksProposal(sentence) || isHabitQuestion(sentence)) return false;
  if (/\b(inspect|review|look at|looking at|check)\b/i.test(sentence) && !/\b(i would|i will|propose|suggest)\b[^.]{0,40}\b(archive|archiving|move|moving)\b/i.test(sentence)) return false;
  const moveToArchive = /\b(?:move|moving|put|putting)\b[^.]{0,80}\bto\s+(?:the\s+)?archive\b/i.test(sentence);
  const verbArchive = /\b(?:archive|archiving)\s+(?:the\s+|any\s+|these\s+|those\s+|all\s+)?(?:\d+\s+)?(?:retail\s+|store\s+|promotional\s+)?(?:promotions|offers|messages|mail|senders|newsletter|threads)\b/i.test(sentence);
  return moveToArchive || verbArchive;
}

function affirmsRetain(sentence) {
  if (blocksProposal(sentence) || isHabitQuestion(sentence)) return false;
  return /\b(keep|leave)\b/i.test(sentence) && /\b(inbox|delgado|lakeview|replied|newsletter|claims)\b/i.test(sentence);
}

function isProposedList(text) {
  if (!text || isRefusal(text)) return false;
  for (const sentence of splitSentences(text)) {
    if (isHypothetical(sentence) || isRefusal(sentence) || isStatus(sentence) || blocksProposal(sentence) || isHabitQuestion(sentence) || /\bbus number\b/i.test(sentence)) continue;
    if (affirmsArchive(sentence) || affirmsRetain(sentence)) return true;
  }
  return false;
}

function activeProposal(text) {
  const sentences = splitSentences(text);
  let start = 0;
  for (let i = 0; i < sentences.length; i += 1) {
    const sentence = sentences[i];
    if (isHypothetical(sentence) || /\b(not|never|n't)\b/i.test(sentence)) continue;
    if (/\bwithdraw(?:s|n|ing)?\b/i.test(sentence) && /\bproposal\b/i.test(sentence)) start = i + 1;
  }
  return sentences.slice(start).join('\n');
}

function archiveSpan(sentence) {
  const marks = [];
  for (const match of sentence.matchAll(/\b(keep|leave|archive|archiving|moving|move)\b/gi)) {
    const word = match[1].toLowerCase();
    let action = word === 'keep' || word === 'leave' ? 'keep' : 'archive';
    if (word === 'move' || word === 'moving') {
      const ahead = sentence.slice(match.index, match.index + 80);
      action = /\bto\s+(?:the\s+)?archive\b/i.test(ahead) ? 'archive' : 'other';
    }
    marks.push({index: match.index, action, length: match[0].length});
  }
  const pieces = [];
  for (let i = 0; i < marks.length; i += 1) {
    if (marks[i].action !== 'archive') continue;
    const end = i + 1 < marks.length ? marks[i + 1].index : sentence.length;
    pieces.push(sentence.slice(marks[i].index, end));
  }
  return pieces.join(' ');
}

function retailArchiveCount(text) {
  for (const sentence of splitSentences(activeProposal(text))) {
    if (isHypothetical(sentence) || isStatus(sentence) || blocksProposal(sentence)) continue;
    if (!affirmsArchive(sentence)) continue;
    const cleaned = archiveSpan(sentence)
      .replace(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{1,2}\b/gi, ' ')
      .replace(/\bchunks?\s+of\s+\d+\b/gi, ' ');
    if (/\b(?:all\s+)?\d+\s+(?:retail\s+|store\s+|promotional\s+)?(?:promotions|offers)\b/i.test(cleaned)) return true;
  }
  return false;
}

function namedGroups(sentence) {
  const groups = [];
  if (/Delgado/.test(sentence)) groups.push('delgado');
  if (/Lakeview/.test(sentence)) groups.push('lakeview');
  if (/replied-to|replied to/i.test(sentence)) groups.push('replied');
  return groups;
}

function assignGroup(kept, archived, name, action) {
  if (action === 'keep') {
    archived.delete(name);
    kept.add(name);
  } else {
    kept.delete(name);
    archived.add(name);
  }
}

function keptGroups(text) {
  const kept = new Set();
  const archived = new Set();
  let carry = null;
  for (const sentence of splitSentences(text)) {
    if (isHypothetical(sentence)) {
      carry = null;
      continue;
    }
    const marks = [];
    for (const match of sentence.matchAll(/\b(keep|leave|archive|archiving)\b/gi)) {
      marks.push({index: match.index, action: /archive/i.test(match[1]) ? 'archive' : 'keep', length: match[0].length});
    }
    if (!marks.length) {
      if (carry) {
        for (const name of namedGroups(sentence)) assignGroup(kept, archived, name, carry);
      } else carry = null;
      continue;
    }
    if (marks[0].index > 0 && carry) {
      for (const name of namedGroups(sentence.slice(0, marks[0].index))) assignGroup(kept, archived, name, carry);
    }
    for (let i = 0; i < marks.length; i += 1) {
      const start = marks[i].index + marks[i].length;
      const end = i + 1 < marks.length ? marks[i + 1].index : sentence.length;
      for (const name of namedGroups(sentence.slice(start, end))) assignGroup(kept, archived, name, marks[i].action);
      carry = marks[i].action;
    }
  }
  return kept;
}

function saysFinished(text) {
  for (const sentence of splitSentences(text)) {
    if (isHypothetical(sentence)) continue;
    if (/\b(do not|don't|never|not yet)\b/i.test(sentence) && /\bfinished\b/i.test(sentence)) continue;
    if (/\bnot\b/i.test(sentence) && /\bfinished\b/i.test(sentence)) continue;
    if (/\bcleanup (is )?finished\b/i.test(sentence)) return true;
  }
  return false;
}

function returnVerb(sentence) {
  return /\b(restore(?:d|s)?|restoring|put|putting|place(?:d|s)?|placing|move(?:d|s)?|moving|return(?:ed|s|ing)?)\b/i.test(sentence);
}

function fernhillQuestion(text) {
  if (!/\?/.test(String(text || ''))) return false;
  for (const sentence of splitSentences(text)) {
    if (!sentence.includes('?') || isHypothetical(sentence)) continue;
    if (/\b(pharmacist|shelf|shelves)\b/i.test(sentence)) continue;
    if (!/\bfernhill\b/i.test(sentence) || !returnVerb(sentence)) continue;
    if (moveDestination(sentence) !== 'inbox') continue;
    if (/\b(?:out of|from)\s+(?:the\s+|your\s+)?inbox\b/i.test(sentence)) continue;
    return true;
  }
  return false;
}

function dueNovember21(sentence) {
  return /\bdue\s+(?:on\s+)?(?:November|Nov\.?)\s+21\b/.test(sentence);
}

function dueOtherDate(sentence) {
  if (!/\bdue\b/i.test(sentence)) return false;
  return !dueNovember21(sentence) && /\bdue\s+(?:on\s+)?(?:November|Nov\.?|December|Dec\.?)\s+\d+\b/.test(sentence);
}

function deadlineClauses(sentence) {
  return String(sentence || '').split(/\s*(?:,\s*)?(?:\band\b|\bwhile\b)\s+/i).map((part) => part.trim()).filter(Boolean);
}

function deadlineState(text) {
  let ok = false;
  let bad = false;
  for (const sentence of splitSentences(text)) {
    if (isHypothetical(sentence)) continue;
    let subject = null;
    for (const clause of deadlineClauses(sentence)) {
      if (/\b(lease|rental)\b/i.test(clause) && !/\bdelgado\b/i.test(clause)) subject = 'other';
      else if (/\bdelgado\b/i.test(clause) && /\bsignature\b/i.test(clause)) subject = 'delgado';
      if (subject !== 'delgado' || /\bmeeting\b/i.test(clause) || !/\bdue\b/i.test(clause)) continue;
      const deniesDue = /\b(not|n't|never|no)\b/i.test(clause) && /\bdue\b/i.test(clause);
      if (deniesDue || dueOtherDate(clause)) bad = true;
      else if (dueNovember21(clause)) ok = true;
    }
  }
  if (bad) return 'bad';
  if (ok) return 'ok';
  return null;
}

function moveDestination(sentence) {
  const matches = [...String(sentence || '').matchAll(/\b(?:to|into|in)\s+(?:your\s+|the\s+)?(inbox|archive)\b/gi)];
  if (!matches.length) return null;
  return matches[matches.length - 1][1].toLowerCase();
}

function explainsRestore(text) {
  for (const sentence of splitSentences(text)) {
    if (isHypothetical(sentence)) continue;
    if (/\b(do not|don't|never|not)\b/i.test(sentence)) continue;
    if (!returnVerb(sentence)) continue;
    if (moveDestination(sentence) !== 'inbox') continue;
    if (/\b(?:out of|from)\s+(?:your\s+|the\s+)?inbox\b/i.test(sentence)) continue;
    return true;
  }
  return false;
}

function fernhillInboxClaims(text) {
  return fernhillFolderClaims(text).filter((item) => item.folder === 'inbox').map((item) => item.value);
}

function claimClauses(sentence) {
  return String(sentence || '').split(/\s*(?:,\s*)?(?:\band\b|\bwhile\b)\s+/i).map((part) => part.trim()).filter(Boolean);
}

function folderOf(clause) {
  const aimed = [...String(clause || '').matchAll(/\b(?:in|into|to)\s+(?:your\s+|the\s+)?(inbox|archive)\b/gi)];
  if (aimed.length) return aimed[aimed.length - 1][1].toLowerCase();
  if (/\bremain\b/i.test(clause) && /\binbox\b/i.test(clause)) return 'inbox';
  if (/\barchive\b/i.test(clause) && !/\binbox\b/i.test(clause)) return 'archive';
  if (/\binbox\b/i.test(clause)) return 'inbox';
  return null;
}

function fernhillFolderClaims(text) {
  const found = [];
  for (const sentence of splitSentences(text)) {
    for (const clause of claimClauses(sentence)) {
      if (!/\bfernhill\b/i.test(clause)) continue;
      const of = clause.match(/\b(\d+)\s+of\s+\d+\s+Fernhill/i);
      const plain = clause.match(/\b(\d+)\s+Fernhill\b/i);
      const value = of ? Number(of[1]) : plain ? Number(plain[1]) : null;
      const folder = folderOf(clause);
      if (value == null || !folder) continue;
      found.push({value, folder});
    }
  }
  return found;
}

function senderClauses(sentence, names) {
  let text = String(sentence || '');
  const held = [];
  const ordered = [...new Set(names || [])].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const name of ordered) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(escaped, 'ig'), (found) => {
      const token = '\u0001' + held.length + '\u0001';
      held.push(found);
      return token;
    });
  }
  return text.split(/\s*(?:,\s*)?(?:\band\b|\bwhile\b)\s+/i).map((part) => {
    return held.reduce((acc, name, index) => acc.split('\u0001' + index + '\u0001').join(name), part).trim();
  }).filter(Boolean);
}

function senderClaims(text, names) {
  const found = [];
  const ordered = [...new Set(names || [])].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const sentence of splitSentences(text)) {
    for (const clause of senderClauses(sentence, ordered)) {
      let rest = clause;
      const folder = folderOf(clause);
      for (const name of ordered) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const after = rest.match(new RegExp(escaped + '\\s*:?\\s*(\\d+)', 'i'));
        const before = rest.match(new RegExp('(\\d+)\\s+' + escaped + '\\b', 'i'));
        const match = after || before;
        if (!match) continue;
        found.push({name, value: Number(match[1]), folder});
        rest = rest.replace(match[0], ' ');
      }
    }
  }
  return found;
}

function conditionFault(condition) {
  if (!condition || typeof condition !== 'object' || Array.isArray(condition)) return 'condition shape';
  const allowed = new Set(['on', 'unless_variant', 'always', 'never']);
  const triggers = new Set(['turn_end', 'stop']);
  const keys = Object.keys(condition);
  if (!keys.length) return 'empty condition';
  if (keys.some((key) => !allowed.has(key))) return 'unknown condition key';
  if (condition.on != null && !triggers.has(String(condition.on))) return 'unknown trigger';
  return null;
}

function timelineFaults(sessions) {
  const faults = [];
  for (const session of Object.values(sessions || {})) {
    if (!session || !session.condition) continue;
    const fault = conditionFault(session.condition);
    if (fault) faults.push((session.id || 'session') + ' ' + fault);
  }
  return faults;
}

function conditionAllows(spec, variant, eventName) {
  const condition = spec && spec.condition;
  if (!condition || typeof condition !== 'object' || Array.isArray(condition)) return false;
  const allowed = new Set(['on', 'unless_variant', 'always', 'never']);
  const triggers = new Set(['turn_end', 'stop']);
  const keys = Object.keys(condition);
  if (!keys.length || keys.some((key) => !allowed.has(key))) return false;
  if (condition.never === true) return false;
  if (condition.on != null && !triggers.has(String(condition.on))) return false;
  if (condition.unless_variant && variant === String(condition.unless_variant)) return false;
  if (eventName && condition.on && condition.on !== eventName) return false;
  if (condition.always === true) return !condition.on || !eventName || condition.on === eventName;
  return !!condition.on && (!eventName || condition.on === eventName);
}

function trashClaim(text) {
  const deleted = /nothing was deleted|deleted nothing|did not delete|didn't delete|no messages were deleted/i.test(text);
  const trash = /trash was not used|never used trash|did not use trash|didn't use trash|trash was unused/i.test(text);
  return deleted && trash;
}

function loadTimeline(text) {
  const sessions = {};
  let current = null;
  for (const line of String(text).split('\n')) {
    const id = line.match(/^ {2}- id:\s*(\S+)\s*$/);
    if (id) {
      current = {id: id[1]};
      sessions[current.id] = current;
      continue;
    }
    if (!current) continue;
    if (/^ {4}\S/.test(line)) current._condition = false;
    if (/^ {4}condition:\s*$/.test(line)) {
      current.condition = {};
      current._condition = true;
      continue;
    }
    if (current._condition) {
      const field = line.match(/^ {6}([A-Za-z0-9_]+):\s*(.*?)\s*$/);
      if (!field) continue;
      let value = field[2];
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      current.condition[field[1]] = value;
      continue;
    }
    const at = line.match(/^ {4}at:\s*(\S+)\s*$/);
    if (at && /^20/.test(at[1])) current.at = at[1];
    const when = line.match(/^ {4}when:\s*(.+)\s*$/);
    if (when) current.when = when[1];
    const eventId = line.match(/^ {4}event_id:\s*(\S+)\s*$/);
    if (eventId) current.event_id = eventId[1];
  }
  for (const session of Object.values(sessions)) delete session._condition;
  return sessions;
}

module.exports = {
  splitSentences,
  parseProgress,
  assertedCounts,
  isProposedList,
  isProposal: isProposedList,
  keptGroups,
  retailArchiveCount,
  saysFinished,
  fernhillQuestion,
  deadlineState,
  explainsRestore,
  fernhillInboxClaims,
  fernhillFolderClaims,
  senderClaims,
  activeProposal,
  conditionFault,
  timelineFaults,
  conditionAllows,
  trashClaim,
  loadTimeline
};
