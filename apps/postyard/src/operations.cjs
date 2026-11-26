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
  if (name === APP + '.notes.schedule') return {data, result: store.scheduleNote(data, ctx, args)};
  if (name === APP + '.notes.repost') return {data, result: store.repostNote(data, ctx, args)};
  if (name === APP + '.notes.search') return {data, result: store.searchNotes(data, ctx, args)};
  if (name === APP + '.people.get') return {data, result: store.peopleGet(data, args)};
  if (name === APP + '.people.posts') return {data, result: store.peoplePosts(data, ctx, args)};
  if (name === APP + '.people.search') return {data, result: store.searchPeople(data, args)};
  if (name === APP + '.people.follow') return {data, result: store.followAccount(data, ctx, args)};
  if (name === APP + '.people.unfollow') return {data, result: store.unfollowAccount(data, ctx, args)};
  if (name === APP + '.people.block') return {data, result: store.blockAccount(data, ctx, args)};
  if (name === APP + '.people.unblock') return {data, result: store.unblockAccount(data, args)};
  if (name === APP + '.profile.update_self') return {data, result: store.updateSelf(data, ctx, args)};
  if (name === APP + '.notifications.list') return {data, result: store.listNotifications(data, args)};
  if (name === APP + '.notifications.mark_read') return {data, result: store.markRead(data, args)};
  fail('invalid_arguments', 'Unknown tool.');
}

module.exports = {handleTool};
