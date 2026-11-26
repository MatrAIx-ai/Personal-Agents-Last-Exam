'use strict';
const {fail} = require('./common.cjs');
const store = require('./store.cjs');
const APP = 'postyard';

function handleTool(ctx, data, name, args) {
  if (name === APP + '.blog.posts.list') return {data, result: store.listPosts(data, ctx, args)};
  if (name === APP + '.blog.posts.get') return {data, result: store.getPost(data, ctx, args)};
  if (name === APP + '.blog.drafts.create') return {data, result: store.createDraft(data, ctx, args)};
  if (name === APP + '.blog.drafts.update') return {data, result: store.updateDraft(data, ctx, args)};
  if (name === APP + '.blog.drafts.delete') return {data, result: store.deleteDraft(data, ctx, args)};
  if (name === APP + '.blog.publish') return {data, result: store.publish(data, ctx, args)};
  if (name === APP + '.blog.schedule') return {data, result: store.schedule(data, ctx, args)};
  if (name === APP + '.blog.unschedule') return {data, result: store.unschedule(data, ctx, args)};
  if (name === APP + '.blog.edit_published') return {data, result: store.editPublished(data, ctx, args)};
  if (name === APP + '.blog.unpublish') return {data, result: store.unpublish(data, ctx, args)};
  if (name === APP + '.notes.feed') return {data, result: store.feed(data, ctx, args)};
  if (name === APP + '.notes.get') return {data, result: store.getNote(data, ctx, args)};
  if (name === APP + '.notes.post') return {data, result: store.postNote(data, ctx, args)};
  if (name === APP + '.notes.reply') return {data, result: store.replyNote(data, ctx, args)};
  if (name === APP + '.notes.delete') return {data, result: store.deleteNote(data, ctx, args)};
  if (name === APP + '.people.get') return {data, result: store.peopleGet(data, args)};
  if (name === APP + '.people.posts') return {data, result: store.peoplePosts(data, ctx, args)};
  fail('invalid_arguments', 'Unknown tool.');
}

module.exports = {handleTool};
