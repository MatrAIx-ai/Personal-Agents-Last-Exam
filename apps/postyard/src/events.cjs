'use strict';
const {fail, instant} = require('./common.cjs');
const store = require('./store.cjs');

function applyEvent(ctx, data, event) {
  if (instant(event.at, 'invalid_event') < instant(ctx.virtual_now, 'invalid_event')) {
    fail('invalid_event', 'The App virtual clock cannot move backwards.');
  }
  ctx = {...ctx, virtual_now: event.at};
  const payload = event.payload || {};
  if (event.operation === 'publication.release_due') {
    if (payload && Object.keys(payload).length) fail('invalid_event', 'publication.release_due carries an empty payload.');
    store.releaseDue(data, ctx, event);
    return data;
  }
  if (event.operation === 'owner.confirm_publication' || event.operation === 'owner.decline_publication') {
    const item = store.selectPending(data, payload);
    const decline = event.operation === 'owner.decline_publication';
    if (payload.object_type === 'post') {
      if (decline) store.declinePost(data, ctx, item, payload);
      else store.confirmPost(data, ctx, item, payload, event);
      return data;
    }
    if (payload.object_type === 'note') {
      if (decline) store.declineNote(data, ctx, item, payload);
      else store.confirmNote(data, ctx, item, payload, event);
      return data;
    }
    if (decline) store.declineProfile(data, ctx, item, payload);
    else store.confirmProfile(data, ctx, item, payload);
    return data;
  }
  if (event.operation === 'notes.post_by_other') {
    store.postByOther(data, ctx, event);
    return data;
  }
  if (event.operation === 'notes.reply_by_other') {
    store.replyByOther(data, ctx, event);
    return data;
  }
  if (event.operation === 'notes.repost_by_other') {
    store.repostByOther(data, ctx, event);
    return data;
  }
  if (event.operation === 'follower.changed') {
    store.followerChanged(data, ctx, event);
    return data;
  }
  fail('invalid_event', 'Unsupported operation.');
}

module.exports = {applyEvent};
