'use strict';
const fs = require('node:fs');
const {memberAt, groupForMessage} = require('../src/common.cjs');

function load(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function check(kinthread, messages) {
  const errors = [];
  const groups = kinthread.groups || [];
  for (const group of groups) {
    const conversation = (messages.conversations || []).find(item => item.id === group.messages_conversation_id);
    if (!conversation) {
      errors.push('Missing Messages conversation ' + group.messages_conversation_id);
      continue;
    }
    const participants = new Set(conversation.participant_ids);
    for (const member of group.members) {
      if (!participants.has(member.person_id)) errors.push(member.person_id + ' is a Kinthread member and is absent from ' + conversation.id);
    }
    for (const personId of conversation.participant_ids) {
      if (!group.members.some(member => member.person_id === personId)) errors.push(personId + ' is a Messages participant and is absent from ' + group.group_id);
    }
  }
  for (const conversation of messages.conversations || []) {
    const linked = groups.find(group => group.messages_conversation_id === conversation.id);
    if (linked) continue;
    for (const personId of conversation.participant_ids || []) {
      if (!groups.some(group => group.members.some(member => member.person_id === personId))) errors.push(personId + ' is in ' + conversation.id + ' and is absent from every Kinthread group');
    }
  }
  for (const message of messages.messages || []) {
    const conversation = (messages.conversations || []).find(item => item.id === message.conversation_id);
    if (!conversation) {
      errors.push((message.id || 'message') + ' names conversation ' + message.conversation_id + ', which does not exist');
      continue;
    }
    if (!(conversation.participant_ids || []).includes(message.author_person_id)) {
      errors.push((message.id || 'message') + ' author ' + message.author_person_id + ' is not a participant in ' + conversation.id);
      continue;
    }
    if (!message.sent_at) {
      errors.push(message.id + ' has no sent_at, so authorship at send time cannot be established');
      continue;
    }
    const found = groupForMessage(groups, message, messages.conversations);
    if (found.group_match === 'ambiguous') {
      errors.push((message.id || 'message') + ' matches more than one Kinthread group');
      continue;
    }
    if (!found.group || !memberAt(found.group, message.author_person_id, message.sent_at)) {
      errors.push((message.id || 'message') + ' author ' + message.author_person_id + ' was not a member at ' + message.sent_at);
    }
  }
  return errors;
}
function main(argv) {
  const [kinFile, messageFile] = argv;
  if (!kinFile || !messageFile) {
    console.error('Usage: node scripts/check-messages-seed.cjs <kinthread-seed.json> <messages-seed.json>');
    process.exitCode = 2;
    return;
  }
  const errors = check(load(kinFile), load(messageFile));
  if (errors.length) {
    for (const error of errors) console.error(error);
    process.exitCode = 1;
    return;
  }
  console.log('ok ' + kinFile);
}
module.exports = {check};
if (require.main === module) main(process.argv.slice(2));
