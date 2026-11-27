'use strict';
const { log } = require('./diagnostics.cjs');

const APP = 'reelpulse';
const AUDIENCES = ['close_friends', 'subscribers', 'public'];
const AUDIENCE_RANK = { close_friends: 1, subscribers: 2, public: 3 };
const FORMATS = ['carousel', 'reel'];
const STATUSES = ['draft', 'scheduled', 'published'];
const CIRCLES = ['close_friends', 'subscribers', 'none'];
const SHARING_LIMITS = ['close_friends_only', 'subscribers_only', 'public_allowed'];

function fail(code, message) {
  throw Object.assign(new Error(message || code), { code });
}

function copy(value) {
  return structuredClone(value);
}

function parseTime(value, code = 'invalid_arguments') {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    fail(code, 'Invalid ISO-8601 timestamp: ' + value);
  }
  return Date.parse(value);
}

function findPost(data, id, code = 'not_found') {
  const post = data.posts.find(p => p.id === id);
  if (!post) fail(code, 'Post does not exist: ' + id);
  return post;
}

function findSponsor(data, id, code = 'not_found') {
  const sponsor = data.sponsors.find(s => s.id === id);
  if (!sponsor) fail(code, 'Sponsorship brief does not exist: ' + id);
  return sponsor;
}

function sponsorForPost(data, post) {
  if (!post.sponsor_id) return null;
  return data.sponsors.find(s => s.id === post.sponsor_id) || null;
}

// Derived post view from ctx.virtual_now without mutating stored records.
// Once ctx.virtual_now >= scheduled_at, a scheduled post counts as published
// with published_at === scheduled_at.
function derivePost(ctx, post) {
  const view = copy(post);
  const now = Date.parse(ctx?.virtual_now || '1970-01-01T00:00:00Z');
  if (view.status === 'scheduled' && view.scheduled_at && now >= Date.parse(view.scheduled_at)) {
    view.status = 'published';
    view.published_at = view.scheduled_at;
  }
  const runId = ctx?.run_id || 'run-demo';
  view.asset_ids = (view.asset_ids || []).filter(id => {
    if (!ctx?.assets) return true; // The standalone business harness has no asset service.
    try {
      ctx.assets.read(id);
      return true;
    } catch (error) {
      if (error.code === 'not_available' || error.code === 'unavailable') return false;
      throw error;
    }
  });
  view.resource_uris = view.asset_ids.map(id => `pale://${runId}/${APP}/assets/${id}`);
  return view;
}

function complianceFailure(data, post, audience, targetInstantMs) {
  if (!AUDIENCES.includes(audience)) {
    return { code: 'invalid_arguments', message: 'Invalid audience: ' + audience };
  }
  const sponsor = sponsorForPost(data, post);
  if (!sponsor) return null;
  if (!sponsor.approved) {
    return { code: 'compliance_error', reason: 'SPONSOR_NOT_APPROVED', message: 'Sponsorship brief is not approved for release.' };
  }
  if (targetInstantMs < Date.parse(sponsor.earliest_publish_at)) {
    return {
      code: 'compliance_error',
      reason: 'SPONSOR_EMBARGO',
      message: 'Release time is before sponsor embargo ' + sponsor.earliest_publish_at,
    };
  }
  if (sponsor.disclosure_required && !post.paid_partnership) {
    return {
      code: 'compliance_error',
      reason: 'DISCLOSURE_REQUIRED',
      message: 'Sponsored post requires paid_partnership: true.',
    };
  }
  const forbiddenSet = new Set((sponsor.forbidden_tags || []).map(t => t.toLowerCase()));
  const blocked = (post.tags || []).filter(t => forbiddenSet.has(t.toLowerCase()));
  if (blocked.length > 0) {
    return {
      code: 'compliance_error',
      reason: 'FORBIDDEN_TAG',
      message: 'Post contains sponsor-forbidden tags: ' + blocked.join(', '),
    };
  }
  return null;
}

function checkCompliance(data, post, audience, targetInstantMs) {
  const err = complianceFailure(data, post, audience, targetInstantMs);
  if (err) fail(err.code, err.message);
}

function latestPublishedPost(ctx, data, code = 'invalid_event') {
  const published = data.posts
    .map(raw => ({ raw, view: derivePost(ctx, raw) }))
    .filter(({ view }) => view.status === 'published' && view.published_at &&
      Date.parse(view.published_at) <= Date.parse(ctx.virtual_now));
  if (published.length === 0) {
    fail(code, 'No published post exists at the current virtual time.');
  }
  published.sort((a, b) =>
    Date.parse(b.view.published_at) - Date.parse(a.view.published_at) ||
    compareIds(a.raw.id, b.raw.id));
  return published[0].raw;
}

function compareIds(a, b) {
  return a === b ? 0 : a < b ? -1 : 1;
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

module.exports = {
  APP,
  AUDIENCES,
  AUDIENCE_RANK,
  FORMATS,
  STATUSES,
  CIRCLES,
  SHARING_LIMITS,
  fail,
  copy,
  parseTime,
  findPost,
  findSponsor,
  sponsorForPost,
  derivePost,
  complianceFailure,
  checkCompliance,
  latestPublishedPost,
  round2,
  compareIds,
  log,
};
