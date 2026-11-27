'use strict';
const {
  fail,
  parseTime,
  derivePost,
  complianceFailure,
  latestPublishedPost,
  log,
} = require('./common.cjs');

function resolveEventTargetPost(ctx, data, explicitPostId) {
  if (explicitPostId !== undefined) {
    const post = data.posts.find(p => p.id === explicitPostId);
    if (!post) fail('invalid_event', 'Target post does not exist: ' + explicitPostId);
    const view = derivePost(ctx, post);
    if (view.status !== 'published' || !view.published_at ||
        parseTime(view.published_at, 'invalid_event') > parseTime(ctx.virtual_now, 'invalid_event')) {
      fail('invalid_event', 'Explicit target post is not published at event time: ' + explicitPostId);
    }
    return post;
  }
  return latestPublishedPost(ctx, data, 'invalid_event');
}

function applyEvent(ctx, data, event) {
  const atMs = parseTime(event.at, 'invalid_event');

  if (event.operation === 'reelpulse.comment.create') {
    const { post_id, comment_id, author, author_role = 'follower', text } = event.payload;
    if (data.posts.some(p => p.comments.some(c => c.id === comment_id))) {
      fail('invalid_event', 'Duplicate comment_id: ' + comment_id);
    }
    const post = resolveEventTargetPost(ctx, data, post_id);
    post.comments.push({
      id: comment_id,
      author,
      author_role,
      text,
      created_at: event.at,
      hidden: false,
      pinned: false,
      parent_comment_id: null,
    });
    post.updated_at = event.at;
    log(ctx, 'reelpulse.comment_created', { post_id: post.id, comment_id, event_id: event.event_id });
    return data;
  }

  if (event.operation === 'reelpulse.engagement.snapshot') {
    const { post_id, views, saves, completions, unfollows, not_interested } = event.payload;
    const post = resolveEventTargetPost(ctx, data, post_id);
    post.metrics = { views, saves, completions, unfollows, not_interested };
    post.updated_at = event.at;
    log(ctx, 'reelpulse.engagement_updated', { post_id: post.id, event_id: event.event_id });
    return data;
  }

  if (event.operation === 'reelpulse.sponsor.update') {
    const {
      sponsor_id,
      post_id,
      earliest_publish_at,
      approved,
      disclosure_required,
      forbidden_tags,
      promo_code,
    } = event.payload;
    const sponsor = data.sponsors.find(s => s.id === sponsor_id);
    if (!sponsor) fail('invalid_event', 'Unknown sponsor_id: ' + sponsor_id);
    const post = data.posts.find(p => p.id === post_id);
    if (!post || sponsor.post_id !== post_id || post.sponsor_id !== sponsor_id) {
      fail('invalid_event', 'Mismatched sponsor_id and post_id.');
    }
    if (earliest_publish_at !== undefined) {
      parseTime(earliest_publish_at, 'invalid_event');
      sponsor.earliest_publish_at = earliest_publish_at;
    }
    if (approved !== undefined) sponsor.approved = approved;
    if (disclosure_required !== undefined) sponsor.disclosure_required = disclosure_required;
    if (forbidden_tags !== undefined) sponsor.forbidden_tags = [...forbidden_tags];
    if (promo_code !== undefined) sponsor.promo_code = promo_code;
    sponsor.updated_at = event.at;

    // If the post has an active future schedule that has not yet gone live by event.at,
    // re-check compliance under the updated sponsorship rules and revert non-compliant schedules to draft.
    if (post.status === 'scheduled' && post.scheduled_at && Date.parse(post.scheduled_at) > atMs) {
      const failure = complianceFailure(data, post, post.audience, Date.parse(post.scheduled_at));
      if (failure) {
        post.status = 'draft';
        post.audience = null;
        post.scheduled_at = null;
        post.schedule_reverted_reason = failure.reason || failure.code;
        post.updated_at = event.at;
        post.revisions.push({
          at: event.at,
          action: `schedule_reverted_${post.schedule_reverted_reason.toLowerCase()}`,
          caption: post.caption,
          paid_partnership: post.paid_partnership,
          tags: [...post.tags],
        });
      }
    }
    log(ctx, 'reelpulse.sponsor_updated', { sponsor_id, post_id, event_id: event.event_id });
    return data;
  }

  fail('invalid_event', 'Unsupported event operation: ' + event.operation);
}

module.exports = { applyEvent };
