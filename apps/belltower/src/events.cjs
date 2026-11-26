'use strict';
// Incoming events: what sources publish. Time is the environment's: Belltower has no timers,
// no scheduler and no clock event. An event is handled at its own time T (`event.at`, which
// the host also supplies as ctx.virtual_now while the handler runs): T becomes the
// revision's received_at, a held notification whose release time is after T can still be
// superseded, and a notification written at T is held or released by the quiet hours and
// the digest time at T.
// Content is whatever the event supplies. Belltower checks that a revision is well formed
// and in order; it never checks whether it is true, and it never edits another item.
const { fail, ms } = require('./util.cjs');
const { validateSeed, objects, index, latest, revisionProblem } = require('./model.cjs');
const { record } = require('./activity.cjs');
const { arrive } = require('./notifications.cjs');
const { log } = require('./diagnostics.cjs');

const APP = 'belltower.';
const reject = message => fail('invalid_event', message);
const TYPE = { 'item.published': 'original', 'item.updated': 'update', 'item.corrected': 'correction', 'item.retracted': 'retraction' };

// Store one arriving revision, write the event's activity row and then its effects.
function append(data, ix, item, type, event) {
  const given = event.payload.revision, previous = item.revisions.length ? latest(item) : null, what = 'Item ' + item.id + ' revision ' + given.number;
  if (previous && previous.type === 'retraction') reject('Item ' + item.id + ' was retracted and takes no further revision.');
  if (given.number !== (previous ? previous.number + 1 : 1)) reject(what + ' is not the next revision: ' + (previous ? 'the item is at revision ' + previous.number + '.' : 'a new item starts at revision 1.'));
  if (ms(given.published_at) > ms(event.at)) reject(what + ' cannot be published after the event that delivers it.');
  if (previous && ms(given.published_at) < ms(previous.published_at)) reject(what + ' cannot be published before the revision it follows.');
  const revision = { number: given.number, type, published_at: given.published_at, received_at: event.at };
  for (const key of ['note', 'headline', 'body', 'topics', 'area_ids', 'priority', 'effective', 'based_on']) if (given[key] !== undefined) revision[key] = given[key];
  const problem = revisionProblem(ix, item, revision);
  if (problem) reject(what + ' ' + problem);
  item.revisions.push(revision);
  record(data, { at: event.at, actor: 'event', action: event.operation.slice(APP.length), object_id: item.id, event_id: event.event_id, details: { revision: revision.number, type } });
  arrive(data, ix, item, revision, event);
  return item.id;
}

function published(data, ix, type, event) {
  const p = event.payload;
  if (objects(data).includes(p.item_id)) reject('ID ' + p.item_id + ' is already in use.');
  if (!ix.sources.has(p.source_id)) reject('Unknown source ' + p.source_id + '.');
  const item = { id: p.item_id, source_id: p.source_id, kind: p.kind, revisions: [] };
  data.items.push(item);
  ix.items.set(item.id, item);
  return append(data, ix, item, type, event);
}
function revised(data, ix, type, event) {
  const item = ix.items.get(event.payload.item_id);
  if (!item) reject('Unknown item ' + event.payload.item_id + '.');
  return append(data, ix, item, type, event);
}
const handlers = { 'item.published': published, 'item.updated': revised, 'item.corrected': revised, 'item.retracted': revised };

function applyEvent(ctx, data, event) {
  const name = String(event.operation).startsWith(APP) ? event.operation.slice(APP.length) : '', handler = handlers[name];
  if (!handler) reject('Unknown Belltower event ' + event.operation + '.');
  const objectId = handler(data, index(data), TYPE[name], event);
  // Anything an event would leave inconsistent is the event's fault, not the seed's.
  try { validateSeed(ctx, data); } catch (e) { if (e.code === 'invalid_seed') reject(e.message); throw e; }
  log(ctx, 'belltower.event.prepared', { operation: event.operation, object_id: objectId });
  return data;
}

module.exports = { applyEvent };
