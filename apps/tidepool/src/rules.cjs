'use strict';
// Business transitions shared by Agent tools and Infra events. In 'event' mode every rule violation
// fails the event with invalid_event; in 'tool' mode it keeps its specific App error code.
const {fail, shift, MINUTE} = require('./domain-utils.cjs');
const c = require('./catalog.cjs');
const a = require('./account.cjs');

// Playlist operations apply in order to the current track list. add appends past the end (an event
// author may not know the length of a playlist the agent created); remove and move name a track.
function applyTrackOps(idx, p, ops, authorId, now, mode) {
  const code = x => mode === 'event' ? 'invalid_event' : x;
  for (const op of ops) {
    const at = p.tracks.findIndex(t => t.track_id === op.track_id);
    if (op.op === 'add') {
      const track = idx.tracks.get(op.track_id);
      if (!track) fail(code('not_found'), 'No track ' + op.track_id + ' in Tidepool.');
      if (track.availability !== 'available') fail(code('unavailable'), 'Track ' + op.track_id + ' has been removed from Tidepool.');
      if (at >= 0) fail(code('invalid_arguments'), 'Track ' + op.track_id + ' is already in the playlist.');
      const position = op.position === undefined ? p.tracks.length : Math.min(op.position - 1, p.tracks.length);
      p.tracks.splice(position, 0, {track_id: op.track_id, added_by: authorId, added_at: now});
    } else {
      if (at < 0) fail(code('not_found'), 'Track ' + op.track_id + ' is not in the playlist.');
      const [entry] = p.tracks.splice(at, 1);
      if (op.op === 'move') {
        if (op.position === undefined || op.position > p.tracks.length + 1) fail(code('invalid_position'), 'Move needs a position from 1 to the playlist length.');
        p.tracks.splice(op.position - 1, 0, entry);
      }
    }
  }
  p.track_version++;
  p.updated_at = now;
}

function checkCollaborators(data, ownerId, ids) {
  for (const id of ids) {
    const m = data.members.find(x => x.member_id === id);
    if (!m || m.status !== 'active') fail('not_found', 'Collaborator ' + id + ' is not an active family member.');
    if (id === ownerId) fail('invalid_arguments', 'The owner cannot also be a collaborator.');
  }
}

// Reserve the item's bytes now; the download completes one simulated minute later.
function reserve(data, idx, device, type, item, source, now) {
  const bytes = c.itemBytes(idx, type, item), id = item[type + '_id'];
  const free = device.storage_cap_bytes - a.usedBytes(data, device.device_id, now);
  if (bytes > free) fail('storage_full', 'Not enough Tidepool storage on ' + device.name + ': needs ' + bytes + ' bytes, ' + free + ' free.');
  const download = {download_id: a.newId(data, 'dl', x => data.downloads.some(d => d.download_id === x)), member_id: device.member_id,
    device_id: device.device_id, item_type: type, item_id: id, bytes, source, requested_at: now, completes_at: shift(now, MINUTE),
    auto_delete_at: null, removed_at: null, removed_reason: null};
  data.downloads.push(download);
  if (type === 'episode') a.scheduleAutoDelete(data, device.member_id, id, now);
  return download;
}
const activeDownload = (data, deviceId, type, id, now) => data.downloads.find(d => d.device_id === deviceId && d.item_type === type &&
  d.item_id === id && a.occupying(data, d, now));

module.exports = {applyTrackOps, checkCollaborators, reserve, activeDownload};
