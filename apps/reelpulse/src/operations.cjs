'use strict';
const {
  AUDIENCES,
  AUDIENCE_RANK,
  FORMATS,
  CIRCLES,
  SHARING_LIMITS,
  fail,
  copy,
  parseTime,
  findPost,
  findSponsor,
  derivePost,
  checkCompliance,
  round2,
  compareIds,
  log,
} = require('./common.cjs');

function computeSlots(ctx, data, { format, limit = 3 } = {}) {
  if (!Number.isInteger(limit) || limit <= 0) fail('invalid_arguments', 'limit must be a positive integer.');
  if (format !== undefined && !FORMATS.includes(format)) fail('invalid_arguments', 'Invalid format filter.');

  const derived = data.posts.map(p => derivePost(ctx, p));
  const eligible = derived.filter(
    p => p.status === 'published' && (!format || p.format === format) && p.metrics && p.metrics.views > 0
  );

  const buckets = new Map();
  for (const post of eligible) {
    const key = JSON.stringify([post.topic_angle, post.day_slot]);
    if (!buckets.has(key)) {
      buckets.set(key, {
        slot_id: post.slot_id,
        topic_angle: post.topic_angle,
        day_slot: post.day_slot,
        format: post.format,
        samples: [],
      });
    }
    const views = post.metrics.views;
    buckets.get(key).samples.push({
      save_rate: post.metrics.saves / views,
      completion_rate: post.metrics.completions / views,
      negative_feedback_rate: (post.metrics.unfollows + post.metrics.not_interested) / views,
    });
    if (compareIds(post.slot_id, buckets.get(key).slot_id) < 0) {
      buckets.get(key).slot_id = post.slot_id;
    }
  }

  const ranked = [...buckets.values()].map(b => {
    const n = b.samples.length;
    const avg_save_rate = b.samples.reduce((s, x) => s + x.save_rate, 0) / n;
    const avg_completion_rate = b.samples.reduce((s, x) => s + x.completion_rate, 0) / n;
    const avg_negative_feedback_rate = b.samples.reduce((s, x) => s + x.negative_feedback_rate, 0) / n;
    const slot_score = round2(
      avg_save_rate * 0.55 + avg_completion_rate * 0.35 - avg_negative_feedback_rate * 0.60
    );
    return {
      slot_id: b.slot_id,
      topic_angle: b.topic_angle,
      day_slot: b.day_slot,
      sample_count: n,
      avg_save_rate: Number(avg_save_rate.toFixed(6)),
      avg_completion_rate: Number(avg_completion_rate.toFixed(6)),
      avg_negative_feedback_rate: Number(avg_negative_feedback_rate.toFixed(6)),
      slot_score,
    };
  });

  ranked.sort((a, b) => b.slot_score - a.slot_score || compareIds(a.slot_id, b.slot_id));
  return ranked.slice(0, limit);
}

function handleTool(ctx, data, name, args = {}) {
  const nowStr = ctx.virtual_now;
  const nowMs = parseTime(nowStr);

  if (name === 'reelpulse.posts.list') {
    const { status, audience, format } = args;
    const items = data.posts
      .map(p => derivePost(ctx, p))
      .filter(p =>
        (status === undefined || p.status === status) &&
        (audience === undefined || p.audience === audience) &&
        (format === undefined || p.format === format)
      );
    return { data, result: { items } };
  }

  if (name === 'reelpulse.posts.get') {
    const post = findPost(data, args.id);
    return { data, result: { item: derivePost(ctx, post) } };
  }

  if (name === 'reelpulse.posts.search') {
    const { status, audience, tag, query, from, to } = args;
    const q = query ? query.toLowerCase() : null;
    const tagLower = tag ? tag.toLowerCase() : null;
    const fromMs = from ? parseTime(from) : null;
    const toMs = to ? parseTime(to) : null;
    const items = data.posts
      .map(p => derivePost(ctx, p))
      .filter(p => {
        if (status !== undefined && p.status !== status) return false;
        if (audience !== undefined && p.audience !== audience) return false;
        if (tagLower && !p.tags.some(t => t.toLowerCase() === tagLower)) return false;
        if (q && !p.title.toLowerCase().includes(q) && !p.caption.toLowerCase().includes(q)) return false;
        const refTime = p.published_at || p.scheduled_at || p.updated_at;
        const refMs = Date.parse(refTime);
        if (fromMs !== null && refMs < fromMs) return false;
        if (toMs !== null && refMs > toMs) return false;
        return true;
      });
    return { data, result: { items } };
  }

  if (name === 'reelpulse.comments.list') {
    const post = findPost(data, args.post_id);
    const includeHidden = args.include_hidden !== false;
    const items = post.comments.filter(c => includeHidden || !c.hidden).map(copy);
    return { data, result: { post_id: post.id, items } };
  }

  if (name === 'reelpulse.sponsors.list') {
    return { data, result: { items: data.sponsors.map(copy) } };
  }

  if (name === 'reelpulse.sponsors.get') {
    let sponsor = null;
    if (args.sponsor_id) {
      sponsor = findSponsor(data, args.sponsor_id);
    } else if (args.post_id) {
      const post = findPost(data, args.post_id);
      sponsor = post.sponsor_id ? findSponsor(data, post.sponsor_id) : null;
    } else {
      fail('invalid_arguments', 'Provide sponsor_id or post_id.');
    }
    return { data, result: { item: copy(sponsor) } };
  }

  if (name === 'reelpulse.circles.get') {
    return { data, result: { circles: copy(data.circles) } };
  }

  if (name === 'reelpulse.analytics.summary') {
    const derived = data.posts.map(p => derivePost(ctx, p));
    const published = derived.filter(p => p.status === 'published');
    const totals = published.reduce(
      (acc, p) => {
        acc.views += p.metrics.views;
        acc.saves += p.metrics.saves;
        acc.completions += p.metrics.completions;
        acc.unfollows += p.metrics.unfollows;
        acc.not_interested += p.metrics.not_interested;
        return acc;
      },
      { views: 0, saves: 0, completions: 0, unfollows: 0, not_interested: 0 }
    );
    return {
      data,
      result: {
        summary: {
          total_posts: derived.length,
          published_posts: published.length,
          scheduled_posts: derived.filter(p => p.status === 'scheduled').length,
          draft_posts: derived.filter(p => p.status === 'draft').length,
          ...totals,
        },
      },
    };
  }

  if (name === 'reelpulse.recommend.slots') {
    const items = computeSlots(ctx, data, args);
    return { data, result: { items } };
  }

  if (name === 'reelpulse.asset.read') {
    const post = findPost(data, args.post_id);
    if (!post.asset_ids.includes(args.asset_id)) {
      fail('not_available', 'Asset is not attached to post ' + post.id);
    }
    const meta = ctx.assets ? ctx.assets.read(args.asset_id) : null;
    if (!meta) fail('not_available', 'Asset metadata unavailable: ' + args.asset_id);
    return {
      data,
      result: {
        asset: {
          asset_id: args.asset_id,
          post_id: post.id,
          filename: meta.filename,
          mime_type: meta.mime_type,
          sha256: meta.sha256,
          media: meta.media || {},
        },
      },
    };
  }

  if (name === 'reelpulse.posts.create_draft') {
    const id = args.id || `post-draft-${data.posts.length + 1}`;
    if (data.posts.some(p => p.id === id)) fail('duplicate_id', 'Post ID already exists: ' + id);
    const post = {
      id,
      account_id: data.account_id,
      title: args.title,
      caption: args.caption || '',
      format: args.format,
      topic_angle: args.topic_angle || 'General creator update',
      day_slot: args.day_slot || 'Tue 09:00',
      slot_id: args.slot_id || `slot-${id}`,
      status: 'draft',
      audience: null,
      paid_partnership: Boolean(args.paid_partnership),
      sponsor_id: null,
      tags: args.tags ? [...args.tags] : [],
      asset_ids: [],
      created_at: nowStr,
      updated_at: nowStr,
      scheduled_at: null,
      published_at: null,
      schedule_reverted_reason: null,
      pinned_comment_id: null,
      metrics: { views: 0, saves: 0, completions: 0, unfollows: 0, not_interested: 0 },
      revisions: [
        {
          at: nowStr,
          action: 'created_draft',
          caption: args.caption || '',
          paid_partnership: Boolean(args.paid_partnership),
          tags: args.tags ? [...args.tags] : [],
        },
      ],
      moderation_history: [],
      comments: [],
    };
    data.posts.push(post);
    log(ctx, 'reelpulse.post_draft_created', { post_id: post.id });
    return { data, result: { item: derivePost(ctx, post) } };
  }

  if (name === 'reelpulse.posts.update_draft') {
    const post = findPost(data, args.id);
    const view = derivePost(ctx, post);
    if (view.status !== 'draft') fail('invalid_state', 'Only draft posts can be updated with update_draft.');
    if (
      args.title === undefined &&
      args.caption === undefined &&
      args.paid_partnership === undefined &&
      args.tags === undefined
    ) {
      fail('invalid_arguments', 'update_draft requires at least one field to update.');
    }
    if (args.title !== undefined) post.title = args.title;
    if (args.caption !== undefined) post.caption = args.caption;
    if (args.paid_partnership !== undefined) post.paid_partnership = args.paid_partnership;
    if (args.tags !== undefined) post.tags = [...args.tags];
    post.updated_at = nowStr;
    post.revisions.push({
      at: nowStr,
      action: 'updated_draft',
      caption: post.caption,
      paid_partnership: post.paid_partnership,
      tags: [...post.tags],
    });
    log(ctx, 'reelpulse.post_draft_updated', { post_id: post.id });
    return { data, result: { item: derivePost(ctx, post) } };
  }

  if (name === 'reelpulse.posts.schedule') {
    const post = findPost(data, args.id);
    const view = derivePost(ctx, post);
    if (view.status === 'published') fail('invalid_state', 'Published posts cannot be scheduled.');
    const targetMs = parseTime(args.at);
    if (targetMs <= nowMs) fail('invalid_time', 'Scheduled time must be strictly after virtual_now.');
    checkCompliance(data, post, args.audience, targetMs);
    post.status = 'scheduled';
    post.audience = args.audience;
    post.scheduled_at = args.at;
    post.published_at = null;
    post.schedule_reverted_reason = null;
    post.updated_at = nowStr;
    post.revisions.push({
      at: nowStr,
      action: 'scheduled',
      caption: post.caption,
      paid_partnership: post.paid_partnership,
      tags: [...post.tags],
    });
    log(ctx, 'reelpulse.post_scheduled', { post_id: post.id, scheduled_at: args.at, audience: args.audience });
    return { data, result: { item: derivePost(ctx, post) } };
  }

  if (name === 'reelpulse.posts.publish') {
    const post = findPost(data, args.id);
    const view = derivePost(ctx, post);
    if (view.status === 'published' && view.audience === args.audience) {
      // An already-effective publication does not need a business-state write.
      return { data, result: { item: view } };
    }
    if (view.status === 'published') {
      fail('invalid_state', 'Post is already published; use set_visibility to change audience.');
    }
    checkCompliance(data, post, args.audience, nowMs);
    post.status = 'published';
    post.audience = args.audience;
    post.published_at = nowStr;
    post.scheduled_at = null;
    post.schedule_reverted_reason = null;
    post.updated_at = nowStr;
    post.revisions.push({
      at: nowStr,
      action: 'published',
      caption: post.caption,
      paid_partnership: post.paid_partnership,
      tags: [...post.tags],
    });
    log(ctx, 'reelpulse.post_published', { post_id: post.id, audience: args.audience });
    return { data, result: { item: derivePost(ctx, post) } };
  }

  if (name === 'reelpulse.posts.set_visibility') {
    const post = findPost(data, args.id);
    const view = derivePost(ctx, post);
    if (view.status === 'draft') fail('invalid_state', 'Draft posts have no audience; use schedule or publish.');
    if (!AUDIENCES.includes(args.audience)) fail('invalid_arguments', 'Invalid audience.');
    const targetMs = view.status === 'scheduled' ? parseTime(post.scheduled_at) : nowMs;
    if (AUDIENCE_RANK[args.audience] > AUDIENCE_RANK[view.audience]) {
      checkCompliance(data, post, args.audience, targetMs);
    }
    post.audience = args.audience;
    post.updated_at = nowStr;
    post.revisions.push({
      at: nowStr,
      action: `visibility_${args.audience}`,
      caption: post.caption,
      paid_partnership: post.paid_partnership,
      tags: [...post.tags],
    });
    return { data, result: { item: derivePost(ctx, post) } };
  }

  if (name === 'reelpulse.posts.unpublish') {
    const post = findPost(data, args.id);
    post.status = 'draft';
    post.audience = null;
    post.scheduled_at = null;
    post.published_at = null;
    post.schedule_reverted_reason = null;
    if (post.pinned_comment_id) {
      for (const c of post.comments) c.pinned = false;
      post.pinned_comment_id = null;
    }
    post.updated_at = nowStr;
    post.revisions.push({
      at: nowStr,
      action: 'unpublished_to_draft',
      caption: post.caption,
      paid_partnership: post.paid_partnership,
      tags: [...post.tags],
    });
    return { data, result: { item: derivePost(ctx, post) } };
  }

  if (name === 'reelpulse.comments.hide') {
    const post = findPost(data, args.post_id);
    const comment = post.comments.find(c => c.id === args.comment_id);
    if (!comment) fail('not_found', 'Comment does not exist: ' + args.comment_id);
    if (!comment.hidden) {
      comment.hidden = true;
      if (comment.pinned) {
        comment.pinned = false;
        if (post.pinned_comment_id === comment.id) post.pinned_comment_id = null;
      }
      post.updated_at = nowStr;
      post.moderation_history.push({ at: nowStr, action: 'hide_comment', target_id: comment.id });
    }
    return { data, result: { comment: copy(comment) } };
  }

  if (name === 'reelpulse.comments.reply') {
    const post = findPost(data, args.post_id);
    const view = derivePost(ctx, post);
    if (view.status !== 'published') fail('post_not_published', 'Cannot reply on an unpublished post.');
    const parent = post.comments.find(c => c.id === args.parent_comment_id);
    if (!parent) fail('comment_not_found', 'Parent comment does not exist: ' + args.parent_comment_id);
    const id = args.id || `reply-${post.id}-${post.comments.length + 1}`;
    if (data.posts.some(p => p.comments.some(c => c.id === id))) {
      fail('duplicate_id', 'Comment ID already exists: ' + id);
    }
    const reply = {
      id,
      author: data.owner_person_id,
      author_role: 'creator',
      text: args.text,
      created_at: nowStr,
      hidden: false,
      pinned: false,
      parent_comment_id: parent.id,
    };
    post.comments.push(reply);
    post.updated_at = nowStr;
    post.moderation_history.push({ at: nowStr, action: 'reply_comment', target_id: reply.id });
    return { data, result: { comment: copy(reply) } };
  }

  if (name === 'reelpulse.comments.pin') {
    const post = findPost(data, args.post_id);
    const view = derivePost(ctx, post);
    if (view.status !== 'published') {
      fail('post_not_published', 'Post must be published before pinning a comment.');
    }
    const comment = post.comments.find(c => c.id === args.comment_id);
    if (!comment) {
      fail('comment_not_found', 'Comment does not exist on this post: ' + args.comment_id);
    }
    if (comment.hidden) {
      fail('comment_hidden', 'Hidden comments cannot be pinned.');
    }
    for (const c of post.comments) c.pinned = c.id === comment.id;
    post.pinned_comment_id = comment.id;
    post.updated_at = nowStr;
    post.moderation_history.push({ at: nowStr, action: 'pin_comment', target_id: comment.id });
    return { data, result: { comment: copy(comment) } };
  }

  if (name === 'reelpulse.circles.update_member') {
    const member = data.circles.members.find(m => m.person_id === args.person_id);
    if (!member) fail('not_found', 'Circle member does not exist: ' + args.person_id);
    if (args.circle === undefined && args.sharing === undefined) {
      fail('invalid_arguments', 'Provide circle or sharing to update.');
    }
    if (args.circle !== undefined) {
      if (!CIRCLES.includes(args.circle)) fail('invalid_arguments', 'Invalid circle.');
      member.circle = args.circle;
    }
    if (args.sharing !== undefined) {
      if (!SHARING_LIMITS.includes(args.sharing)) fail('invalid_arguments', 'Invalid sharing limit.');
      member.sharing = args.sharing;
    }
    data.circles.close_friends = data.circles.members
      .filter(m => m.circle === 'close_friends')
      .map(m => m.person_id);
    data.circles.subscribers = data.circles.members
      .filter(m => m.circle === 'subscribers')
      .map(m => m.person_id);
    return { data, result: { member: copy(member) } };
  }

  fail('unknown_tool', 'Unknown business operation: ' + name);
}

module.exports = { handleTool, computeSlots };
