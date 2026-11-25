'use strict';
// Read-side catalog helpers: lookups, agent-facing item views and search. No business mutations here.
const {fail, words, fold} = require('./domain-utils.cjs');

function index(data) {
  const map = (list, key) => new Map(list.map(x => [x[key], x]));
  return {
    artists: map(data.artists, 'artist_id'), albums: map(data.albums, 'album_id'), tracks: map(data.tracks, 'track_id'),
    shows: map(data.shows, 'show_id'), episodes: map(data.episodes, 'episode_id'),
    members: map(data.members, 'member_id'), devices: map(data.devices, 'device_id'), playlists: map(data.playlists, 'playlist_id'),
  };
}
// Item type by lookup, so one ID space serves catalog.get_item and downloads.
function find(idx, id) {
  for (const type of ['track', 'album', 'artist', 'show', 'episode']) {
    const item = idx[type + 's'].get(id);
    if (item) return {type, item};
  }
  return null;
}
function get(idx, type, id) {
  const item = idx[type + 's'].get(id);
  if (!item) fail('not_found', 'No ' + type + ' ' + id + ' in Tidepool.');
  return item;
}
// Queueing, saving or downloading needs an available item (and, for an episode, an available show).
function usable(idx, type, id) {
  const item = get(idx, type, id);
  const show = type === 'episode' ? idx.shows.get(item.show_id) : null;
  if (item.availability !== 'available' || (show && show.availability !== 'available')) fail('unavailable', 'This ' + type + ' has been removed from Tidepool.');
  return item;
}
const albumTracks = (idx, album) => album.track_ids.map(id => idx.tracks.get(id));
const itemBytes = (idx, type, item) => type === 'album' ? albumTracks(idx, item).reduce((s, t) => s + t.bytes, 0) : item.bytes;
function title(idx, type, id) {
  const item = idx[type + 's'].get(id);
  return type === 'artist' ? item.name : item.title;
}
function contextTitle(idx, type, id) {
  const item = idx[type + 's'].get(id);
  if (type === 'episode') return idx.shows.get(item.show_id).title;
  if (type === 'track' || type === 'album') return idx.artists.get(item.artist_id).name;
  return item.title;
}

function trackView(idx, t, filter) {
  return {item_type: 'track', track_id: t.track_id, title: t.title, artist_id: t.artist_id, artist_name: idx.artists.get(t.artist_id).name,
    album_id: t.album_id, album_title: idx.albums.get(t.album_id).title, duration_s: t.duration_s, explicit: t.explicit,
    clean_version_id: t.clean_version_id, filtered: filter && t.explicit, availability: t.availability, bytes: t.bytes};
}
function albumView(idx, a) {
  const tracks = albumTracks(idx, a);
  return {item_type: 'album', album_id: a.album_id, title: a.title, artist_id: a.artist_id, artist_name: idx.artists.get(a.artist_id).name,
    released: a.released, track_count: tracks.length, duration_s: tracks.reduce((s, t) => s + t.duration_s, 0),
    bytes: itemBytes(idx, 'album', a), explicit_tracks: tracks.filter(t => t.explicit).length, availability: a.availability};
}
function artistView(data, a) {
  return {item_type: 'artist', artist_id: a.artist_id, name: a.name, album_count: data.albums.filter(x => x.artist_id === a.artist_id).length};
}
const episodesOf = (data, showId) => data.episodes.filter(e => e.show_id === showId);
function showView(data, s, memberId) {
  const latest = episodesOf(data, s.show_id).sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))[0];
  return {item_type: 'show', show_id: s.show_id, title: s.title, publisher: s.publisher, explicit: s.explicit, availability: s.availability,
    episode_count: episodesOf(data, s.show_id).length, latest_episode_id: latest ? latest.episode_id : null,
    following: data.follows.some(f => f.member_id === memberId && f.show_id === s.show_id)};
}
function progressOf(data, memberId, episodeId) {
  return data.progress.find(p => p.member_id === memberId && p.episode_id === episodeId) || null;
}
function episodeView(idx, data, e, member) {
  const p = progressOf(data, member.member_id, e.episode_id);
  return {item_type: 'episode', episode_id: e.episode_id, show_id: e.show_id, show_title: idx.shows.get(e.show_id).title, number: e.number,
    title: e.title, published_at: e.published_at, duration_s: e.duration_s, explicit: e.explicit, filtered: member.explicit_filter && e.explicit,
    availability: e.availability, bytes: e.bytes, progress: p ? {state: p.state, position_s: p.position_s} : {state: 'unplayed', position_s: 0}};
}
function view(idx, data, type, item, member) {
  if (type === 'track') return trackView(idx, item, member.explicit_filter);
  if (type === 'album') return albumView(idx, item);
  if (type === 'artist') return artistView(data, item);
  if (type === 'show') return showView(data, item, member.member_id);
  return episodeView(idx, data, item, member);
}
function full(idx, data, id, member) {
  const found = find(idx, id);
  if (!found) fail('not_found', 'No catalog item ' + id + ' in Tidepool.');
  const {type, item} = found, base = view(idx, data, type, item, member);
  if (type === 'track') {
    return {...base, plays: data.plays.find(p => p.member_id === member.member_id && p.track_id === item.track_id)?.count ?? 0};
  }
  if (type === 'album') {
    return {...base, tracks: albumTracks(idx, item).map(t => trackView(idx, t, member.explicit_filter)),
      saved: data.library.some(l => l.member_id === member.member_id && l.item_type === 'album' && l.item_id === item.album_id)};
  }
  if (type === 'artist') return {...base, bio: item.bio, albums: data.albums.filter(a => a.artist_id === item.artist_id).map(a => albumView(idx, a))};
  if (type === 'show') return {...base, description: item.description};
  const p = progressOf(data, member.member_id, item.episode_id);
  return {...base, end_of_content_s: item.end_of_content_s, chapters: structuredClone(item.chapters), notes: item.notes, played_at: p?.played_at ?? null};
}

// Each query word must match the start of a word in the item's searchable text.
function search(idx, data, args, member) {
  const terms = words(args.query), types = args.item_type ? [args.item_type] : ['track', 'album', 'artist', 'show', 'episode'];
  const haystack = (type, x) => {
    if (type === 'track') return [x.title, idx.artists.get(x.artist_id).name, idx.albums.get(x.album_id).title];
    if (type === 'album') return [x.title, idx.artists.get(x.artist_id).name];
    if (type === 'artist') return [x.name];
    if (type === 'show') return [x.title, x.publisher];
    return [x.title, idx.shows.get(x.show_id).title];
  };
  const results = [];
  for (const type of types) {
    for (const item of idx[type + 's'].values()) {
      if (item.availability === 'removed') continue;
      if (type === 'episode' && idx.shows.get(item.show_id).availability === 'removed') continue;
      const hay = words(haystack(type, item).join(' '));
      if (terms.every(term => hay.some(word => word.startsWith(fold(term))))) results.push({type, item});
    }
  }
  // A filtered member also gets each matching explicit track's clean version, placed right after it.
  const cleanFor = new Map();
  for (const r of results) {
    const clean = r.type === 'track' && member.explicit_filter && r.item.explicit && r.item.clean_version_id ? idx.tracks.get(r.item.clean_version_id) : null;
    if (clean && clean.availability === 'available') cleanFor.set(r.item.track_id, clean);
  }
  const placed = new Set([...cleanFor.values()]), out = [];
  for (const r of results) {
    if (placed.has(r.item)) continue;
    out.push(r);
    if (cleanFor.has(r.item.track_id)) out.push({type: 'track', item: cleanFor.get(r.item.track_id)});
  }
  return {total: out.length, results: out.slice(0, args.limit ?? 20).map(r => view(idx, data, r.type, r.item, member))};
}

module.exports = {index, find, get, usable, albumTracks, itemBytes, title, contextTitle, trackView, albumView, showView, episodeView,
  episodesOf, progressOf, full, search};
