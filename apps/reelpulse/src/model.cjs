'use strict';
const { fail, parseTime } = require('./common.cjs');

const EARLIEST_HISTORY_MS = Date.parse('2026-01-01T00:00:00Z');

function validateSeed(ctx, data) {
  if (!data || typeof data !== 'object') fail('invalid_seed', 'Seed data must be an object.');
  const bound = ctx?.binding?.accounts?.find(
    a => a.app_id === 'reelpulse' && a.account_id === data.account_id && a.owner_person_id === data.owner_person_id
  );
  if (ctx?.binding?.accounts && !bound) {
    fail('invalid_seed', 'Account or owner_person_id does not match binding.json.');
  }
  const postIds = new Set();
  const commentIds = new Set();
  const sponsorIds = new Set();
  const memberIds = new Set();

  for (const member of data.circles.members) {
    if (memberIds.has(member.person_id)) fail('invalid_seed', 'Duplicate circle member ID: ' + member.person_id);
    memberIds.add(member.person_id);
  }
  for (const id of data.circles.close_friends) {
    const m = data.circles.members.find(x => x.person_id === id);
    if (!m || m.circle !== 'close_friends') fail('invalid_seed', 'close_friends list disagrees with members.');
  }
  for (const id of data.circles.subscribers) {
    const m = data.circles.members.find(x => x.person_id === id);
    if (!m || m.circle !== 'subscribers') fail('invalid_seed', 'subscribers list disagrees with members.');
  }

  for (const sponsor of data.sponsors) {
    if (sponsorIds.has(sponsor.id)) fail('invalid_seed', 'Duplicate sponsor ID: ' + sponsor.id);
    sponsorIds.add(sponsor.id);
    if (parseTime(sponsor.earliest_publish_at, 'invalid_seed') < EARLIEST_HISTORY_MS ||
        parseTime(sponsor.updated_at, 'invalid_seed') < EARLIEST_HISTORY_MS) {
      fail('invalid_seed', 'Sponsor timestamps must start on or after 2026-01-01.');
    }
  }

  for (const post of data.posts) {
    if (postIds.has(post.id)) fail('invalid_seed', 'Duplicate post ID: ' + post.id);
    if (post.account_id !== data.account_id) fail('invalid_seed', 'Post account_id mismatch: ' + post.id);
    postIds.add(post.id);

    const createdMs = parseTime(post.created_at, 'invalid_seed');
    const updatedMs = parseTime(post.updated_at, 'invalid_seed');
    if (createdMs < EARLIEST_HISTORY_MS || updatedMs < createdMs) {
      fail('invalid_seed', 'Invalid post timeline on ' + post.id);
    }
    if (post.sponsor_id && !sponsorIds.has(post.sponsor_id)) {
      fail('invalid_seed', 'Post references unknown sponsor_id: ' + post.sponsor_id);
    }
    if (post.status === 'draft' && (post.audience !== null || post.scheduled_at !== null || post.published_at !== null)) {
      fail('invalid_seed', 'Draft post cannot have audience, scheduled_at or published_at.');
    }
    if (post.status === 'scheduled' && (!post.audience || !post.scheduled_at || post.published_at !== null)) {
      fail('invalid_seed', 'Scheduled post must have audience and scheduled_at without published_at.');
    }
    if (post.status === 'published' && (!post.audience || !post.published_at)) {
      fail('invalid_seed', 'Published post must have audience and published_at.');
    }

    let prevRev = createdMs;
    for (const rev of post.revisions) {
      const at = parseTime(rev.at, 'invalid_seed');
      if (at < prevRev || at > updatedMs) fail('invalid_seed', 'Invalid revision timeline on ' + post.id);
      prevRev = at;
    }

    for (const c of post.comments) {
      if (commentIds.has(c.id)) fail('invalid_seed', 'Duplicate comment ID: ' + c.id);
      commentIds.add(c.id);
      if (parseTime(c.created_at, 'invalid_seed') < EARLIEST_HISTORY_MS) {
        fail('invalid_seed', 'Comment timestamp before 2026-01-01: ' + c.id);
      }
    }
    if (post.pinned_comment_id) {
      const pinned = post.comments.find(c => c.id === post.pinned_comment_id);
      if (!pinned || !pinned.pinned || pinned.hidden) {
        fail('invalid_seed', 'Invalid pinned_comment_id on ' + post.id);
      }
    }
  }

  for (const sponsor of data.sponsors) {
    const post = data.posts.find(p => p.id === sponsor.post_id);
    if (!post || post.sponsor_id !== sponsor.id) {
      fail('invalid_seed', 'Sponsor post_id relationship mismatch on ' + sponsor.id);
    }
  }
}

function assetReferences(data) {
  return (data.posts || []).flatMap(post =>
    [...new Set(post.asset_ids || [])].map(asset_id => ({
      asset_id,
      object_id: post.id,
      object_type: 'post',
    }))
  );
}

module.exports = {
  validateSeed,
  records: data => data.posts,
  objects: data => data.posts.map(p => p.id),
  references: () => [],
  assetReferences,
};
