#!/usr/bin/env node
'use strict';

/**
 * Deterministic generator for QuestShelf's 2025-01-01..2026-12-31 synthetic evaluation
 * dataset (MIT License). Reads fixtures/minimal.json for the 20-game catalog and
 * constructs realistic, cross-record-consistent multi-year user activity:
 * varied shelf arcs, play sessions aligned with co-op game nights, completions,
 * ratings, drop reasons, friend library acquisitions, and 18 organic co-op polls.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const APP_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(APP_ROOT, 'datasets', 'eval-2025-2026');
const minimal = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'fixtures', 'minimal.json'), 'utf8'));
const binding = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'fixtures', 'binding.json'), 'utf8'));
const plugin = require(path.join(APP_ROOT, 'plugin.cjs'));
const { compile } = require(path.join(APP_ROOT, 'tests', 'schema-validator.cjs'));

fs.mkdirSync(OUT_DIR, { recursive: true });

// 1. Staggered catalog patch timestamps across 2025-01 .. 2026-09 (metadata only)
const catalogUpdatedAt = {
  'game-lantern-hollow': '2025-02-14T10:00:00-08:00',
  'game-clockwork-isle': '2025-04-08T11:30:00-07:00',
  'game-orbit-relay': '2025-01-10T09:15:00-08:00',
  'game-ashen-depths': '2025-06-19T14:00:00-07:00',
  'game-moss-cartographer': '2025-05-03T10:00:00-07:00',
  'game-neon-drift-99': '2025-03-11T16:00:00-07:00',
  'game-ember-kitchen': '2025-01-05T12:00:00-08:00',
  'game-iron-sovereign': '2025-07-22T15:00:00-07:00',
  'game-crypt-echo': '2025-08-14T13:00:00-07:00',
  'game-sunlit-rails': '2025-09-09T10:30:00-07:00',
  'game-starlight-tactics': '2025-10-16T11:00:00-07:00',
  'game-rift-runners': '2025-11-04T09:45:00-08:00',
  'game-pebble-harbor': '2025-01-20T10:00:00-08:00',
  'game-boulder-league': '2025-12-02T14:20:00-08:00',
  'game-velvet-cipher': '2026-01-18T11:00:00-08:00',
  'game-frost-protocol': '2026-02-26T16:10:00-08:00',
  'game-tiny-botanist': '2026-03-19T09:00:00-07:00',
  'game-void-breaker': '2026-05-11T15:30:00-07:00',
  'game-timber-trails': '2026-07-08T10:00:00-07:00',
  'game-glyph-forge': '2026-09-21T12:45:00-07:00',
};

const games = minimal.games.map(g => ({
  ...structuredClone(g),
  updated_at: catalogUpdatedAt[g.id],
}));

// 2. Friend library acquisitions spanning 2025-01 .. 2026-12
const friends = [
  {
    friend_id: 'friend-alex',
    name: 'Alex Rivera',
    platforms: ['ps5'],
    owned_games: [
      { game_id: 'game-ember-kitchen', platform: 'ps5', added_at: '2025-01-16T18:00:00-08:00' },
      { game_id: 'game-orbit-relay', platform: 'ps5', added_at: '2025-03-04T19:30:00-08:00' },
      { game_id: 'game-neon-drift-99', platform: 'ps5', added_at: '2025-08-12T20:10:00-07:00' },
      { game_id: 'game-rift-runners', platform: 'ps5', added_at: '2026-01-29T17:45:00-08:00' },
      { game_id: 'game-boulder-league', platform: 'ps5', added_at: '2026-07-17T19:00:00-07:00' },
    ],
  },
  {
    friend_id: 'friend-sam',
    name: 'Sam Patel',
    platforms: ['pc', 'switch'],
    owned_games: [
      { game_id: 'game-ember-kitchen', platform: 'switch', added_at: '2025-02-09T14:20:00-08:00' },
      { game_id: 'game-orbit-relay', platform: 'pc', added_at: '2025-04-21T18:15:00-07:00' },
      { game_id: 'game-neon-drift-99', platform: 'pc', added_at: '2025-09-28T16:50:00-07:00' },
      { game_id: 'game-boulder-league', platform: 'pc', added_at: '2026-04-11T16:40:00-07:00' },
      { game_id: 'game-glyph-forge', platform: 'pc', added_at: '2026-05-15T19:05:00-07:00' },
    ],
  },
  {
    friend_id: 'friend-lin',
    name: 'Lin Zhou',
    platforms: ['handheld', 'switch'],
    owned_games: [
      { game_id: 'game-tiny-botanist', platform: 'switch', added_at: '2025-02-11T11:30:00-08:00' },
      { game_id: 'game-ember-kitchen', platform: 'switch', added_at: '2025-11-29T13:00:00-08:00' },
      { game_id: 'game-orbit-relay', platform: 'switch', added_at: '2026-03-10T18:20:00-07:00' },
      { game_id: 'game-clockwork-isle', platform: 'switch', added_at: '2026-10-20T15:25:00-07:00' },
      { game_id: 'game-moss-cartographer', platform: 'handheld', added_at: '2026-12-08T17:50:00-08:00' },
    ],
  },
];

// 3. Varied multi-year user shelf history (2025-01-03 through 2026-12-28)
// Naturalized arcs: several games start directly in `playing`, entry counts range 1..9,
// completion hours span 0.88x..1.42x catalog main hours, and notes use natural language
// without raw poll IDs.
const shelves = [
  {
    game_id: 'game-pebble-harbor',
    owned_platforms: ['handheld', 'switch'],
    play_history: [
      { at: '2025-01-03T19:20:00-08:00', status: 'backlog', hours_logged: 0.0, rating: null, drop_reasons: [], note: 'Picked up during New Year eShop sale.' },
      { at: '2025-01-11T21:10:00-08:00', status: 'playing', hours_logged: 1.8, rating: null, drop_reasons: [], note: 'Delivered first cliffside mail route; cozy pace.' },
      { at: '2025-01-19T16:40:00-08:00', status: 'playing', hours_logged: 3.9, rating: null, drop_reasons: [], note: 'Finished lighthouse keeper letters on handheld.' },
      { at: '2025-02-02T20:15:00-08:00', status: 'completed', hours_logged: 6.8, rating: 9.2, drop_reasons: [], note: '100% side-parcel deliveries and final harbor festival.' }, // 1.36x main (5h)
    ],
  },
  {
    game_id: 'game-tiny-botanist',
    owned_platforms: ['handheld', 'switch'],
    play_history: [
      { at: '2025-02-16T18:50:00-08:00', status: 'playing', hours_logged: 1.4, rating: null, drop_reasons: [], note: 'Downloaded on Lin recommendation and crossbred first silver fern.' },
      { at: '2025-03-22T19:45:00-07:00', status: 'completed', hours_logged: 3.6, rating: 9.4, drop_reasons: [], note: 'Breezed through all 40 greenhouse beds on commute rides.' }, // 0.90x main (4h)
    ],
  },
  {
    game_id: 'game-crypt-echo',
    owned_platforms: ['pc'],
    play_history: [
      { at: '2025-04-04T22:00:00-07:00', status: 'backlog', hours_logged: 0.0, rating: null, drop_reasons: [], note: 'Included in spring indie bundle.' },
      { at: '2025-04-12T22:40:00-07:00', status: 'playing', hours_logged: 0.6, rating: null, drop_reasons: [], note: 'Entered B1 catacombs; hallway feels very tight.' },
      { at: '2025-04-18T21:55:00-07:00', status: 'dropped', hours_logged: 1.2, rating: 4.0, drop_reasons: ['first_person_motion_sickness', 'horror'], note: 'Narrow corridor wobble gave instant headache plus jump scares.' },
    ],
  },
  {
    game_id: 'game-sunlit-rails',
    owned_platforms: ['handheld', 'pc'],
    play_history: [
      { at: '2025-05-05T18:10:00-07:00', status: 'backlog', hours_logged: 0.0, rating: null, drop_reasons: [], note: 'Queued after finishing Tiny Botanist.' },
      { at: '2025-05-17T09:40:00-07:00', status: 'playing', hours_logged: 2.2, rating: null, drop_reasons: [], note: 'Cleared coastal timber depot contracts.' },
      { at: '2025-05-31T15:05:00-07:00', status: 'playing', hours_logged: 4.8, rating: null, drop_reasons: [], note: 'Rebuilt mountain freight loop for express timing.' },
      { at: '2025-06-06T20:25:00-07:00', status: 'playing', hours_logged: 7.1, rating: null, drop_reasons: [], note: 'Solved dual-track bridge timing puzzle.' },
      { at: '2025-06-21T17:15:00-07:00', status: 'completed', hours_logged: 9.8, rating: 8.8, drop_reasons: [], note: 'Finished main line plus extra harbor freight contracts.' }, // 1.40x main (7h)
    ],
  },
  {
    game_id: 'game-void-breaker',
    owned_platforms: ['pc'],
    play_history: [
      { at: '2025-07-14T21:30:00-07:00', status: 'playing', hours_logged: 1.1, rating: null, drop_reasons: [], note: 'Booted right after installing to test GPU; camera bob feels aggressive.' },
      { at: '2025-07-26T22:10:00-07:00', status: 'dropped', hours_logged: 2.0, rating: 5.0, drop_reasons: ['first_person_motion_sickness'], note: 'Rapid dash turns still trigger motion sickness.' },
    ],
  },
  {
    game_id: 'game-timber-trails',
    owned_platforms: ['handheld', 'switch'],
    play_history: [
      { at: '2025-08-08T17:45:00-07:00', status: 'backlog', hours_logged: 0.0, rating: null, drop_reasons: [], note: 'Saving for August cabin trip.' },
      { at: '2025-08-19T20:30:00-07:00', status: 'playing', hours_logged: 2.3, rating: null, drop_reasons: [], note: 'Photographed glacial tarn wildlife on Switch.' },
      { at: '2025-09-07T15:10:00-07:00', status: 'playing', hours_logged: 5.1, rating: null, drop_reasons: [], note: 'Unlocked summit camp recipes.' },
      { at: '2025-09-14T19:20:00-07:00', status: 'playing', hours_logged: 6.4, rating: null, drop_reasons: [], note: 'Chasing dawn fog photo badge at Pine Overlook.' },
      { at: '2025-09-24T21:00:00-07:00', status: 'completed', hours_logged: 8.4, rating: 8.7, drop_reasons: [], note: 'Wrapped autumn ridge loop and extra wildlife album.' }, // 1.20x main (7h)
    ],
  },
  {
    game_id: 'game-neon-drift-99',
    owned_platforms: ['pc'],
    play_history: [
      { at: '2025-10-05T19:15:00-07:00', status: 'backlog', hours_logged: 0.0, rating: null, drop_reasons: [], note: 'Grabbed on Steam autumn promo.' },
      { at: '2025-10-18T21:05:00-07:00', status: 'playing', hours_logged: 1.0, rating: null, drop_reasons: [], note: 'Tried two drift cups with Alex & Sam; way too frantic after work.' },
      { at: '2025-10-25T16:40:00-07:00', status: 'backlog', hours_logged: 1.0, rating: null, drop_reasons: [], note: 'Shelved and muted arcade racers.' },
    ],
  },
  {
    game_id: 'game-orbit-relay',
    owned_platforms: ['pc', 'switch'],
    play_history: [
      { at: '2025-03-14T18:20:00-07:00', status: 'backlog', hours_logged: 0.0, rating: null, drop_reasons: [], note: 'Bought for PC-PS5 co-op nights with Alex.' },
      { at: '2025-03-21T21:30:00-07:00', status: 'playing', hours_logged: 1.5, rating: null, drop_reasons: [], note: 'First cross-play launch night with Alex.' },
      { at: '2025-04-26T21:20:00-07:00', status: 'playing', hours_logged: 3.0, rating: null, drop_reasons: [], note: 'Trio orbital rescue run with Alex & Sam.' },
      { at: '2025-06-13T22:15:00-07:00', status: 'playing', hours_logged: 4.0, rating: null, drop_reasons: [], note: 'Second half of our June double-header co-op evening.' },
      { at: '2025-10-26T18:50:00-07:00', status: 'playing', hours_logged: 5.3, rating: null, drop_reasons: [], note: 'Sunday afternoon repair sprint with Alex & Sam.' },
      { at: '2025-11-14T21:45:00-08:00', status: 'playing', hours_logged: 6.8, rating: null, drop_reasons: [], note: 'Cleared Sector 4 oxygen-leak emergency with Alex.' },
      { at: '2026-01-31T14:20:00-08:00', status: 'playing', hours_logged: 7.6, rating: null, drop_reasons: [], note: 'Short quickplay thruster drill after friends got tied up.' },
      { at: '2026-04-17T21:30:00-07:00', status: 'playing', hours_logged: 9.1, rating: null, drop_reasons: [], note: 'First 4-player cross-play run with Alex, Sam & Lin.' },
      { at: '2026-06-28T17:10:00-07:00', status: 'playing', hours_logged: 10.4, rating: null, drop_reasons: [], note: 'Late-June Sunday rescue run with full crew.' },
      { at: '2026-10-09T21:25:00-07:00', status: 'playing', hours_logged: 11.8, rating: null, drop_reasons: [], note: 'Autumn trio rescue night with Alex & Sam.' },
    ],
  },
  {
    game_id: 'game-ember-kitchen',
    owned_platforms: ['pc', 'switch'],
    play_history: [
      { at: '2025-01-24T19:50:00-08:00', status: 'playing', hours_logged: 0.7, rating: null, drop_reasons: [], note: 'Tried solo tutorial shift right after buying for party nights.' },
      { at: '2025-02-15T20:45:00-08:00', status: 'playing', hours_logged: 1.7, rating: null, drop_reasons: [], note: 'Opening Saturday bistro night with Sam.' },
      { at: '2025-06-13T20:30:00-07:00', status: 'playing', hours_logged: 2.7, rating: null, drop_reasons: [], note: 'Three-starred brick-oven flatbread rush during double-header night.' },
      { at: '2025-08-22T20:15:00-07:00', status: 'playing', hours_logged: 3.7, rating: null, drop_reasons: [], note: 'Spontaneous Friday dinner rush with Alex.' },
      { at: '2025-12-12T21:00:00-08:00', status: 'playing', hours_logged: 4.9, rating: null, drop_reasons: [], note: 'Holiday kitchen DLC night with the full 4-player squad.' },
      { at: '2026-02-14T20:15:00-08:00', status: 'playing', hours_logged: 5.9, rating: null, drop_reasons: [], note: 'Cozy Switch trio session with Sam & Lin.' },
      { at: '2026-06-19T20:40:00-07:00', status: 'playing', hours_logged: 7.1, rating: null, drop_reasons: [], note: 'Beat pastry gauntlet with Alex & Lin.' },
      { at: '2026-11-06T20:55:00-08:00', status: 'playing', hours_logged: 8.3, rating: null, drop_reasons: [], note: 'Pre-holiday 4-player bistro session.' },
    ],
  },
  {
    game_id: 'game-starlight-tactics',
    owned_platforms: ['pc', 'handheld'],
    play_history: [
      { at: '2025-11-28T15:30:00-08:00', status: 'backlog', hours_logged: 0.0, rating: null, drop_reasons: [], note: 'Black Friday handheld strategy pickup.' },
      { at: '2025-12-06T19:20:00-08:00', status: 'playing', hours_logged: 2.6, rating: null, drop_reasons: [], note: 'Completed Decks A and B without squad losses.' },
      { at: '2025-12-27T14:50:00-08:00', status: 'playing', hours_logged: 6.4, rating: null, drop_reasons: [], note: 'Heavy boarding mission over winter break.' },
      { at: '2026-01-10T18:40:00-08:00', status: 'playing', hours_logged: 9.8, rating: null, drop_reasons: [], note: 'Reached flagship engine bay.' },
      { at: '2026-01-17T21:05:00-08:00', status: 'playing', hours_logged: 13.5, rating: null, drop_reasons: [], note: 'Cleared bonus derelict cruiser missions.' },
      { at: '2026-01-25T20:15:00-08:00', status: 'completed', hours_logged: 16.4, rating: 8.6, drop_reasons: [], note: 'Wrapped campaign plus bonus boarding skirmishes.' }, // 1.37x main (12h)
    ],
  },
  {
    game_id: 'game-velvet-cipher',
    owned_platforms: ['handheld', 'switch'],
    play_history: [
      { at: '2026-02-21T20:05:00-08:00', status: 'playing', hours_logged: 2.1, rating: null, drop_reasons: [], note: 'Started on February flight and solved dining-car cipher.' },
      { at: '2026-03-20T21:10:00-07:00', status: 'completed', hours_logged: 5.3, rating: 9.0, drop_reasons: [], note: 'Crisp mystery finale; finished quickly without hints.' }, // 0.88x main (6h)
    ],
  },
  {
    game_id: 'game-frost-protocol',
    owned_platforms: ['pc', 'handheld'],
    play_history: [
      { at: '2026-04-03T18:00:00-07:00', status: 'backlog', hours_logged: 0.0, rating: null, drop_reasons: [], note: 'Heard rave strategy reviews.' },
      { at: '2026-04-26T21:20:00-07:00', status: 'playing', hours_logged: 1.8, rating: null, drop_reasons: [], note: 'Survived first -40C blizzard, lots of coal micro.' },
      { at: '2026-05-09T22:00:00-07:00', status: 'backlog', hours_logged: 2.4, rating: null, drop_reasons: [], note: 'Putting on hold; HUD feels cramped on handheld.' },
    ],
  },
  {
    game_id: 'game-glyph-forge',
    owned_platforms: ['pc', 'handheld'],
    play_history: [
      { at: '2026-05-24T15:00:00-07:00', status: 'backlog', hours_logged: 0.0, rating: null, drop_reasons: [], note: 'Recommended by Sam for short deckbuilder runs.' },
      { at: '2026-06-05T19:40:00-07:00', status: 'playing', hours_logged: 3.1, rating: null, drop_reasons: [], note: 'Cleared Act 2 with frost-rune combo.' },
      { at: '2026-07-12T17:20:00-07:00', status: 'playing', hours_logged: 8.4, rating: null, drop_reasons: [], note: 'Unlocked Ascension 2 sigils.' },
      { at: '2026-07-29T20:50:00-07:00', status: 'completed', hours_logged: 14.2, rating: 9.1, drop_reasons: [], note: 'Beat final rune golem across three deck archetypes.' }, // 1.42x main (10h)
    ],
  },
  {
    game_id: 'game-boulder-league',
    owned_platforms: ['pc'],
    play_history: [
      { at: '2026-08-06T18:30:00-07:00', status: 'backlog', hours_logged: 0.0, rating: null, drop_reasons: [], note: 'Steam key from sports bundle; no PC-PS5 cross-play.' },
      { at: '2026-08-22T20:15:00-07:00', status: 'playing', hours_logged: 1.5, rating: null, drop_reasons: [], note: 'Played two PC-only arena matches with Sam.' },
      { at: '2026-09-05T14:20:00-07:00', status: 'backlog', hours_logged: 1.5, rating: null, drop_reasons: [], note: 'Waiting to see if cross-play patch ever lands.' },
    ],
  },
  {
    game_id: 'game-iron-sovereign',
    owned_platforms: ['pc', 'handheld'],
    play_history: [
      { at: '2026-09-18T12:15:00-07:00', status: 'backlog', hours_logged: 0.0, rating: null, drop_reasons: [], note: 'Saving massive 45h RPG for winter break.' },
    ],
  },
  {
    game_id: 'game-lantern-hollow',
    owned_platforms: ['handheld'],
    play_history: [
      { at: '2026-10-04T14:05:00-07:00', status: 'backlog', hours_logged: 0.0, rating: null, drop_reasons: [], note: 'Picked up in autumn indie bundle; have not booted yet.' },
    ],
  },
  {
    game_id: 'game-clockwork-isle',
    owned_platforms: ['handheld', 'switch'],
    play_history: [
      { at: '2026-10-15T09:30:00-07:00', status: 'backlog', hours_logged: 0.0, rating: null, drop_reasons: [], note: 'Looks promising for upcoming flights.' },
      { at: '2026-11-22T15:10:00-08:00', status: 'playing', hours_logged: 2.2, rating: null, drop_reasons: [], note: 'Restored brass tidal gate on flight to Seattle.' },
      { at: '2026-12-05T16:40:00-08:00', status: 'playing', hours_logged: 4.6, rating: null, drop_reasons: [], note: 'Solved wind-tower pendulum puzzle.' },
      { at: '2026-12-13T19:25:00-08:00', status: 'completed', hours_logged: 7.9, rating: 9.3, drop_reasons: [], note: 'Favorite puzzle adventure of the year; cleared bonus clocktower gears.' }, // 1.32x main (6h)
    ],
  },
  {
    game_id: 'game-ashen-depths',
    owned_platforms: ['handheld', 'pc'],
    play_history: [
      { at: '2026-11-12T20:15:00-08:00', status: 'playing', hours_logged: 6.5, rating: null, drop_reasons: [], note: 'Jumped straight in over the weekend; struggling with tiny text on handheld.' },
      { at: '2026-11-27T21:40:00-08:00', status: 'dropped', hours_logged: 7.4, rating: 5.5, drop_reasons: ['tiny_ui_text', 'excessive_grind'], note: 'Dropped after material-farming wall and eye strain.' },
    ],
  },
  {
    game_id: 'game-moss-cartographer',
    owned_platforms: ['handheld'],
    play_history: [
      { at: '2026-11-18T10:15:00-08:00', status: 'backlog', hours_logged: 0.0, rating: null, drop_reasons: [], note: 'Queued up for December holidays.' },
      { at: '2026-12-19T14:50:00-08:00', status: 'playing', hours_logged: 1.9, rating: null, drop_reasons: [], note: 'Sketched Fern Glen river bends on handheld.' },
      { at: '2026-12-28T18:30:00-08:00', status: 'playing', hours_logged: 3.8, rating: null, drop_reasons: [], note: 'Halfway through misty highland valley map.' },
    ],
  },
].map(entry => {
  const last = entry.play_history[entry.play_history.length - 1];
  return {
    game_id: entry.game_id,
    status: last.status,
    owned_platforms: entry.owned_platforms,
    hours_logged: last.hours_logged,
    rating: last.rating,
    drop_reasons: last.drop_reasons,
    note: last.note,
    updated_at: last.at,
    play_history: entry.play_history,
  };
});

// 4. 18 organic, non-templated co-op polls (neutral IDs poll-01..poll-18)
// Includes weekend creations & votes, two 2-poll months (2025-10, 2026-06),
// varied candidate subsets, missed votes, a 0-vote cancellation, a 1-vote bust,
// a 2-2 tie, split votes, 4-player full squads, early & post-deadline closes.
const polls = [
  {
    poll_id: 'poll-01',
    title: 'Saturday Bistro Opener',
    status: 'closed',
    candidate_game_ids: ['game-ember-kitchen'],
    invited_friend_ids: ['friend-alex', 'friend-sam'],
    max_session_minutes: 60,
    votes: [
      { voter_id: 'questshelf-maya', selected_game_ids: ['game-ember-kitchen'], note: 'Switch dock is ready for Saturday.', voted_at: '2025-02-14T18:45:00-08:00' },
      { voter_id: 'friend-sam', selected_game_ids: ['game-ember-kitchen'], note: 'In! 60 minutes fits before dinner.', voted_at: '2025-02-15T11:20:00-08:00' }, // Saturday vote
    ],
    winner_game_ids: ['game-ember-kitchen'],
    created_at: '2025-02-14T18:10:00-08:00', // Friday creation
    closes_at: '2025-02-15T22:00:00-08:00',
    closed_at: '2025-02-15T19:00:00-08:00',
  },
  {
    poll_id: 'poll-02',
    title: 'Orbit Relay Cross-Play Test',
    status: 'closed',
    candidate_game_ids: ['game-orbit-relay', 'game-ember-kitchen'],
    invited_friend_ids: ['friend-alex'],
    max_session_minutes: 90,
    votes: [
      { voter_id: 'questshelf-maya', selected_game_ids: ['game-orbit-relay'], note: 'Just installed Orbit Relay on PC.', voted_at: '2025-03-19T20:10:00-07:00' },
      { voter_id: 'friend-alex', selected_game_ids: ['game-orbit-relay'], note: 'PS5 cross-play lobby ready!', voted_at: '2025-03-21T09:30:00-07:00' },
    ],
    winner_game_ids: ['game-orbit-relay'],
    created_at: '2025-03-19T19:05:00-07:00',
    closes_at: '2025-03-21T22:00:00-07:00',
    closed_at: '2025-03-21T18:40:00-07:00',
  },
  {
    poll_id: 'poll-03',
    title: 'April Trio Co-Op Vote',
    status: 'closed',
    candidate_game_ids: ['game-orbit-relay', 'game-ember-kitchen'],
    invited_friend_ids: ['friend-alex', 'friend-sam'],
    max_session_minutes: 90,
    votes: [
      { voter_id: 'questshelf-maya', selected_game_ids: ['game-orbit-relay'], note: 'Sam owns Orbit Relay now, let us run 3-player!', voted_at: '2025-04-24T19:00:00-07:00' },
      { voter_id: 'friend-sam', selected_game_ids: ['game-ember-kitchen'], note: 'Slight preference for Ember Kitchen tonight.', voted_at: '2025-04-25T12:40:00-07:00' },
      { voter_id: 'friend-alex', selected_game_ids: ['game-orbit-relay'], note: 'Down for orbital repairs.', voted_at: '2025-04-26T10:15:00-07:00' }, // Saturday vote
    ],
    winner_game_ids: ['game-orbit-relay'],
    created_at: '2025-04-24T17:15:00-07:00',
    closes_at: '2025-04-26T21:00:00-07:00',
    closed_at: '2025-04-26T17:30:00-07:00',
  },
  {
    poll_id: 'poll-04',
    title: 'Memorial Weekend Check-In',
    status: 'closed',
    candidate_game_ids: ['game-orbit-relay', 'game-ember-kitchen'],
    invited_friend_ids: ['friend-alex', 'friend-sam'],
    max_session_minutes: 75,
    votes: [], // 0 votes — cancelled after everyone traveled
    winner_game_ids: [],
    created_at: '2025-05-23T16:30:00-07:00', // Friday creation
    closes_at: '2025-05-24T20:00:00-07:00',
    closed_at: '2025-05-25T10:15:00-07:00', // Sunday post-deadline close
  },
  {
    poll_id: 'poll-05',
    title: 'June Double-Header Night',
    status: 'closed',
    candidate_game_ids: ['game-ember-kitchen', 'game-orbit-relay'],
    invited_friend_ids: ['friend-alex', 'friend-sam'],
    max_session_minutes: 120,
    votes: [
      { voter_id: 'questshelf-maya', selected_game_ids: ['game-ember-kitchen'], note: 'Craving flatbread rush.', voted_at: '2025-06-11T08:15:00-07:00' },
      { voter_id: 'friend-alex', selected_game_ids: ['game-orbit-relay'], note: 'Still chasing Sector 2 gold.', voted_at: '2025-06-11T21:40:00-07:00' },
      { voter_id: 'friend-sam', selected_game_ids: ['game-ember-kitchen', 'game-orbit-relay'], note: 'Happy to split 1h each!', voted_at: '2025-06-12T14:05:00-07:00' },
    ],
    winner_game_ids: ['game-ember-kitchen', 'game-orbit-relay'], // exact 2-2 tie
    created_at: '2025-06-09T20:00:00-07:00', // Monday creation
    closes_at: '2025-06-13T19:00:00-07:00',
    closed_at: '2025-06-13T18:10:00-07:00',
  },
  {
    poll_id: 'poll-06',
    title: 'Spontaneous Friday Co-Op',
    status: 'closed',
    candidate_game_ids: ['game-ember-kitchen'],
    invited_friend_ids: ['friend-alex'],
    max_session_minutes: 60,
    votes: [
      { voter_id: 'friend-alex', selected_game_ids: ['game-ember-kitchen'], note: 'Only have an hour, kitchen is faster to jump into.', voted_at: '2025-08-22T13:05:00-07:00' },
      { voter_id: 'questshelf-maya', selected_game_ids: ['game-ember-kitchen'], note: 'Agreed, see you at 8pm!', voted_at: '2025-08-22T14:20:00-07:00' },
    ],
    winner_game_ids: ['game-ember-kitchen'],
    created_at: '2025-08-22T12:15:00-07:00', // Friday same-day poll
    closes_at: '2025-08-22T19:00:00-07:00',
    closed_at: '2025-08-22T17:00:00-07:00',
  },
  {
    poll_id: 'poll-07',
    title: 'October Three-Game Showdown',
    status: 'closed',
    candidate_game_ids: ['game-neon-drift-99', 'game-ember-kitchen', 'game-orbit-relay'],
    invited_friend_ids: ['friend-alex', 'friend-sam'],
    max_session_minutes: 60,
    votes: [
      { voter_id: 'friend-alex', selected_game_ids: ['game-neon-drift-99'], note: 'All three of us own Neon Drift now — let us race!', voted_at: '2025-10-16T11:10:00-07:00' },
      { voter_id: 'friend-sam', selected_game_ids: ['game-neon-drift-99'], note: 'Keen to test the synthwave circuit.', voted_at: '2025-10-17T17:45:00-07:00' },
      { voter_id: 'questshelf-maya', selected_game_ids: ['game-ember-kitchen'], note: 'Prefer cozy bistro, but I will try racing if outvoted.', voted_at: '2025-10-18T09:30:00-07:00' }, // Saturday vote
    ],
    winner_game_ids: ['game-neon-drift-99'],
    created_at: '2025-10-15T18:20:00-07:00',
    closes_at: '2025-10-18T18:00:00-07:00',
    closed_at: '2025-10-18T16:00:00-07:00',
  },
  {
    poll_id: 'poll-08',
    title: 'Sunday Afternoon Co-Op Recovery',
    status: 'closed',
    candidate_game_ids: ['game-orbit-relay', 'game-ember-kitchen'],
    invited_friend_ids: ['friend-alex', 'friend-sam'],
    max_session_minutes: 90,
    votes: [
      { voter_id: 'questshelf-maya', selected_game_ids: ['game-orbit-relay'], note: 'Back to non-racing co-op!', voted_at: '2025-10-25T20:10:00-07:00' }, // Saturday vote
      { voter_id: 'friend-alex', selected_game_ids: ['game-orbit-relay'], note: 'Fair enough, Orbit Relay sounds great.', voted_at: '2025-10-26T10:05:00-07:00' }, // Sunday vote
      { voter_id: 'friend-sam', selected_game_ids: ['game-orbit-relay'], note: 'Ready at 5pm Sunday.', voted_at: '2025-10-26T11:30:00-07:00' }, // Sunday vote
    ],
    winner_game_ids: ['game-orbit-relay'], // 2nd poll in Oct 2025!
    created_at: '2025-10-25T19:00:00-07:00', // Saturday creation
    closes_at: '2025-10-26T16:30:00-07:00',
    closed_at: '2025-10-26T15:00:00-07:00',
  },
  {
    poll_id: 'poll-09',
    title: 'November Deep-Space Night',
    status: 'closed',
    candidate_game_ids: ['game-orbit-relay'],
    invited_friend_ids: ['friend-alex', 'friend-sam'],
    max_session_minutes: 90,
    votes: [
      { voter_id: 'questshelf-maya', selected_game_ids: ['game-orbit-relay'], note: 'Aiming to clear Sector 4 tonight.', voted_at: '2025-11-12T08:40:00-08:00' },
      { voter_id: 'friend-alex', selected_game_ids: ['game-orbit-relay'], note: 'Online by 8pm PT.', voted_at: '2025-11-13T20:15:00-08:00' },
    ],
    winner_game_ids: ['game-orbit-relay'],
    created_at: '2025-11-11T19:30:00-08:00',
    closes_at: '2025-11-14T20:00:00-08:00',
    closed_at: '2025-11-14T19:00:00-08:00',
  },
  {
    poll_id: 'poll-10',
    title: 'December 4-Player Holiday Bistro',
    status: 'closed',
    candidate_game_ids: ['game-ember-kitchen'],
    invited_friend_ids: ['friend-alex', 'friend-sam', 'friend-lin'],
    max_session_minutes: 75,
    votes: [
      { voter_id: 'questshelf-maya', selected_game_ids: ['game-ember-kitchen'], note: 'Lin joined on Switch — full four-chef crew!', voted_at: '2025-12-08T19:10:00-08:00' },
      { voter_id: 'friend-lin', selected_game_ids: ['game-ember-kitchen'], note: 'Excited for my first co-op night!', voted_at: '2025-12-10T12:30:00-08:00' },
      { voter_id: 'friend-sam', selected_game_ids: ['game-ember-kitchen'], note: 'Calling dibs on brick oven duty.', voted_at: '2025-12-11T18:05:00-08:00' },
      { voter_id: 'friend-alex', selected_game_ids: ['game-ember-kitchen'], note: 'Holiday DLC installed on PS5.', voted_at: '2025-12-11T21:40:00-08:00' },
    ],
    winner_game_ids: ['game-ember-kitchen'],
    created_at: '2025-12-08T17:00:00-08:00', // Monday creation
    closes_at: '2025-12-12T19:30:00-08:00',
    closed_at: '2025-12-12T18:00:00-08:00',
  },
  {
    poll_id: 'poll-11',
    title: 'Late-January Co-Op Check-In',
    status: 'closed',
    candidate_game_ids: ['game-orbit-relay', 'game-ember-kitchen'],
    invited_friend_ids: ['friend-alex', 'friend-sam'],
    max_session_minutes: 90,
    votes: [
      { voter_id: 'questshelf-maya', selected_game_ids: ['game-orbit-relay'], note: 'Free Saturday afternoon if anyone is around.', voted_at: '2026-01-29T09:15:00-08:00' },
    ],
    winner_game_ids: ['game-orbit-relay'], // only Maya voted; closed after deadline
    created_at: '2026-01-28T18:00:00-08:00',
    closes_at: '2026-01-30T21:00:00-08:00',
    closed_at: '2026-01-31T11:00:00-08:00', // Saturday post-deadline close
  },
  {
    poll_id: 'poll-12',
    title: 'February Switch Cozy Trio',
    status: 'closed',
    candidate_game_ids: ['game-ember-kitchen'],
    invited_friend_ids: ['friend-sam', 'friend-lin'],
    max_session_minutes: 60,
    votes: [
      { voter_id: 'friend-lin', selected_game_ids: ['game-ember-kitchen'], note: 'Switch handheld mode ready on the couch.', voted_at: '2026-02-12T20:15:00-08:00' },
      { voter_id: 'friend-sam', selected_game_ids: ['game-ember-kitchen'], note: 'Valentine dinner rush!', voted_at: '2026-02-13T14:00:00-08:00' },
      { voter_id: 'questshelf-maya', selected_game_ids: ['game-ember-kitchen'], note: 'See you both Saturday at 7pm.', voted_at: '2026-02-14T10:30:00-08:00' }, // Saturday vote
    ],
    winner_game_ids: ['game-ember-kitchen'],
    created_at: '2026-02-12T16:40:00-08:00',
    closes_at: '2026-02-14T19:00:00-08:00',
    closed_at: '2026-02-14T17:00:00-08:00',
  },
  {
    poll_id: 'poll-13',
    title: 'April 4-Player Cross-Play Squad',
    status: 'closed',
    candidate_game_ids: ['game-orbit-relay', 'game-ember-kitchen'],
    invited_friend_ids: ['friend-alex', 'friend-sam', 'friend-lin'],
    max_session_minutes: 90,
    votes: [
      { voter_id: 'friend-lin', selected_game_ids: ['game-orbit-relay'], note: 'Grabbed Orbit Relay on Switch last month — ready to fly!', voted_at: '2026-04-15T10:20:00-07:00' },
      { voter_id: 'friend-alex', selected_game_ids: ['game-orbit-relay'], note: 'Full 4-astronaut crew finally!', voted_at: '2026-04-15T18:50:00-07:00' },
      { voter_id: 'friend-sam', selected_game_ids: ['game-ember-kitchen'], note: 'Voted kitchen but fine with either.', voted_at: '2026-04-16T13:15:00-07:00' },
      { voter_id: 'questshelf-maya', selected_game_ids: ['game-orbit-relay'], note: 'Orbit Relay wins 3-1!', voted_at: '2026-04-16T20:00:00-07:00' },
    ],
    winner_game_ids: ['game-orbit-relay'],
    created_at: '2026-04-13T19:00:00-07:00', // Monday creation
    closes_at: '2026-04-17T20:00:00-07:00',
    closed_at: '2026-04-17T18:30:00-07:00',
  },
  {
    poll_id: 'poll-14',
    title: 'June Pastry Gauntlet Attempt',
    status: 'closed',
    candidate_game_ids: ['game-ember-kitchen'],
    invited_friend_ids: ['friend-alex', 'friend-sam', 'friend-lin'],
    max_session_minutes: 75,
    votes: [
      { voter_id: 'questshelf-maya', selected_game_ids: ['game-ember-kitchen'], note: 'Going for 3 stars on the pastry gauntlet.', voted_at: '2026-06-16T21:00:00-07:00' },
      { voter_id: 'friend-lin', selected_game_ids: ['game-ember-kitchen'], note: 'Count me in on dessert prep!', voted_at: '2026-06-17T16:40:00-07:00' },
      { voter_id: 'friend-alex', selected_game_ids: ['game-ember-kitchen'], note: 'PS5 cross-play ready.', voted_at: '2026-06-18T19:20:00-07:00' },
    ],
    winner_game_ids: ['game-ember-kitchen'],
    created_at: '2026-06-16T18:10:00-07:00',
    closes_at: '2026-06-19T19:30:00-07:00',
    closed_at: '2026-06-19T18:00:00-07:00',
  },
  {
    poll_id: 'poll-15',
    title: 'Late-June Sunday Orbital Run',
    status: 'closed',
    candidate_game_ids: ['game-orbit-relay', 'game-ember-kitchen'],
    invited_friend_ids: ['friend-alex', 'friend-sam', 'friend-lin'],
    max_session_minutes: 90,
    votes: [
      { voter_id: 'friend-alex', selected_game_ids: ['game-orbit-relay'], note: 'Sunday matinee mission?', voted_at: '2026-06-27T11:20:00-07:00' }, // Saturday vote
      { voter_id: 'friend-lin', selected_game_ids: ['game-orbit-relay'], note: 'Works great on Sunday afternoon!', voted_at: '2026-06-27T16:45:00-07:00' }, // Saturday vote
      { voter_id: 'friend-sam', selected_game_ids: ['game-orbit-relay'], note: 'Count me in.', voted_at: '2026-06-28T09:10:00-07:00' }, // Sunday vote
      { voter_id: 'questshelf-maya', selected_game_ids: ['game-orbit-relay'], note: 'Locked in for 4pm.', voted_at: '2026-06-28T10:30:00-07:00' }, // Sunday vote
    ],
    winner_game_ids: ['game-orbit-relay'], // 2nd poll in Jun 2026!
    created_at: '2026-06-26T18:40:00-07:00', // Friday creation
    closes_at: '2026-06-28T15:30:00-07:00',
    closed_at: '2026-06-28T14:00:00-07:00',
  },
  {
    poll_id: 'poll-16',
    title: 'PC-Only Duo with Sam',
    status: 'closed',
    candidate_game_ids: ['game-boulder-league', 'game-orbit-relay'],
    invited_friend_ids: ['friend-sam'],
    max_session_minutes: 90,
    votes: [
      { voter_id: 'friend-sam', selected_game_ids: ['game-boulder-league'], note: 'Since Alex cannot cross-play Boulder League, let us try it on Steam!', voted_at: '2026-08-20T12:15:00-07:00' },
      { voter_id: 'questshelf-maya', selected_game_ids: ['game-boulder-league'], note: 'Sounds good, installed my bundle key.', voted_at: '2026-08-21T19:45:00-07:00' },
    ],
    winner_game_ids: ['game-boulder-league'],
    created_at: '2026-08-19T17:30:00-07:00',
    closes_at: '2026-08-22T18:00:00-07:00',
    closed_at: '2026-08-22T15:30:00-07:00',
  },
  {
    poll_id: 'poll-17',
    title: 'October Trio Orbital Night',
    status: 'closed',
    candidate_game_ids: ['game-orbit-relay', 'game-ember-kitchen'],
    invited_friend_ids: ['friend-alex', 'friend-sam'],
    max_session_minutes: 90,
    votes: [
      { voter_id: 'friend-alex', selected_game_ids: ['game-orbit-relay'], note: 'Up for deep-space rescue.', voted_at: '2026-10-07T14:30:00-07:00' },
      { voter_id: 'questshelf-maya', selected_game_ids: ['game-orbit-relay'], note: 'Let us finish Sector 6 before holidays.', voted_at: '2026-10-08T09:10:00-07:00' },
      { voter_id: 'friend-sam', selected_game_ids: ['game-orbit-relay'], note: 'Bringing engineer loadout on PC.', voted_at: '2026-10-08T19:55:00-07:00' },
    ],
    winner_game_ids: ['game-orbit-relay'],
    created_at: '2026-10-05T18:45:00-07:00', // Monday creation
    closes_at: '2026-10-09T19:30:00-07:00',
    closed_at: '2026-10-09T17:45:00-07:00',
  },
  {
    poll_id: 'poll-18',
    title: 'November 4-Player Hangout',
    status: 'closed',
    candidate_game_ids: ['game-ember-kitchen', 'game-orbit-relay'],
    invited_friend_ids: ['friend-alex', 'friend-sam', 'friend-lin'],
    max_session_minutes: 75,
    votes: [
      { voter_id: 'friend-sam', selected_game_ids: ['game-ember-kitchen'], note: 'Relaxed cooking night works best.', voted_at: '2026-11-04T11:50:00-08:00' },
      { voter_id: 'questshelf-maya', selected_game_ids: ['game-ember-kitchen'], note: 'Voting kitchen after a long week.', voted_at: '2026-11-04T20:30:00-08:00' },
      { voter_id: 'friend-lin', selected_game_ids: ['game-orbit-relay'], note: 'Either works, slight nod to Orbit Relay.', voted_at: '2026-11-05T15:10:00-08:00' },
      { voter_id: 'friend-alex', selected_game_ids: ['game-ember-kitchen'], note: 'Bistro it is!', voted_at: '2026-11-05T21:05:00-08:00' },
    ],
    winner_game_ids: ['game-ember-kitchen'],
    created_at: '2026-11-03T17:20:00-08:00',
    closes_at: '2026-11-06T19:30:00-08:00',
    closed_at: '2026-11-06T18:15:00-08:00',
  },
  {
    poll_id: 'poll-19',
    title: 'New Years Eve 90-Min Co-Op',
    status: 'open',
    candidate_game_ids: ['game-orbit-relay', 'game-ember-kitchen'],
    invited_friend_ids: ['friend-alex', 'friend-sam', 'friend-lin'],
    max_session_minutes: 90,
    votes: [
      { voter_id: 'questshelf-maya', selected_game_ids: ['game-orbit-relay', 'game-ember-kitchen'], note: 'Happy with either for NYE.', voted_at: '2026-12-28T10:15:00-08:00' },
      { voter_id: 'friend-alex', selected_game_ids: ['game-ember-kitchen'], note: 'Bistro countdown sounds fun!', voted_at: '2026-12-29T19:05:00-08:00' },
      { voter_id: 'friend-lin', selected_game_ids: ['game-orbit-relay'], note: 'Down for orbital fireworks on Switch.', voted_at: '2026-12-30T14:20:00-08:00' },
    ],
    winner_game_ids: [],
    created_at: '2026-12-27T17:00:00-08:00', // Sunday creation
    closes_at: '2026-12-31T23:59:00-08:00', // 12h open window from clock.json (12:00)
    closed_at: null,
  },
];

// Cross-record consistency verification
const mayaOwnedAt = new Map(shelves.map(s => [s.game_id, Date.parse(s.play_history[0].at)]));
const friendMap = new Map(friends.map(f => [f.friend_id, f]));
for (const p of polls) {
  const createdMs = Date.parse(p.created_at);
  for (const cid of p.candidate_game_ids) {
    const mAt = mayaOwnedAt.get(cid);
    if (!Number.isFinite(mAt) || mAt > createdMs) {
      throw new Error(`Consistency error: Maya did not own ${cid} when ${p.poll_id} was created (${p.created_at})`);
    }
    for (const fid of p.invited_friend_ids) {
      const f = friendMap.get(fid);
      const og = f.owned_games.find(x => x.game_id === cid);
      if (!og || Date.parse(og.added_at) > createdMs) {
        throw new Error(`Consistency error: ${fid} did not own ${cid} when ${p.poll_id} was created (${p.created_at})`);
      }
    }
  }
  if (p.status === 'closed') {
    const counts = new Map(p.candidate_game_ids.map(id => [id, 0]));
    for (const v of p.votes) {
      for (const gid of v.selected_game_ids) counts.set(gid, counts.get(gid) + 1);
    }
    const maxV = Math.max(0, ...counts.values());
    const expectedWinners = maxV > 0 ? [...counts.entries()].filter(([, c]) => c === maxV).map(([id]) => id).sort() : [];
    if (JSON.stringify([...p.winner_game_ids].sort()) !== JSON.stringify(expectedWinners)) {
      throw new Error(`Winner mismatch on ${p.poll_id}: got ${JSON.stringify(p.winner_game_ids)} vs ${JSON.stringify(expectedWinners)}`);
    }
  }
}

const evalSeed = {
  account_id: minimal.account_id,
  owner_person_id: minimal.owner_person_id,
  games,
  shelves,
  preferences: {
    preferred_platforms: ['handheld', 'pc', 'switch'],
    muted_tags: ['arcade_racer', 'horror', 'first_person'],
    not_interested: ['game-neon-drift-99'],
    avoid_reasons: ['first_person_motion_sickness', 'horror'],
    min_hud_font_pt: 14,
    updated_at: '2026-11-27T21:45:00-08:00',
  },
  friends,
  polls,
};

const EVAL_CLOCK = '2026-12-31T12:00:00-08:00';
const seedValidator = compile(
  JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'schemas', 'seed.schema.json'), 'utf8')),
  path.join(APP_ROOT, 'schemas')
);
if (!seedValidator(evalSeed)) {
  throw new Error('eval-2025-2026 seed failed JSON schema validation');
}
plugin.validateSeed({ binding, virtual_now: EVAL_CLOCK }, evalSeed);

const seedPath = path.join(OUT_DIR, 'seed.json');
fs.writeFileSync(seedPath, JSON.stringify(evalSeed, null, 2) + '\n', 'utf8');
const seedSha = crypto.createHash('sha256').update(fs.readFileSync(seedPath)).digest('hex');

const clockPath = path.join(OUT_DIR, 'clock.json');
fs.writeFileSync(clockPath, JSON.stringify({ initial_time: EVAL_CLOCK }, null, 2) + '\n', 'utf8');

const datasetMeta = {
  schema_version: 'pale.dataset.v1',
  dataset_id: 'questshelf-eval-2025-2026',
  version: '1.0.0',
  description: 'Full 24-month (2025-01-01 through 2026-12-31) synthetic QuestShelf evaluation dataset containing varied shelf arcs, play sessions aligned with co-op game nights, completions, ratings, drop reasons, friend library additions, and 19 organic co-op polls. Load at virtual_now >= 2026-12-31T12:00:00-08:00 (datasets/eval-2025-2026/clock.json, distinct from fixtures/clock.json 2026-11-20T16:30:00-08:00), or generate a pre-cutoff slice for any earlier clock via scripts/slice-dataset.cjs --cutoff <ISO>.',
  record_source_ids: ['synthetic-eval-history'],
  sources: [
    {
      source_id: 'synthetic-eval-history',
      kind: 'synthetic',
      description: '100% synthetic 2-year user game-library activity, friend library additions, and non-templated co-op poll history authored deterministically in scripts/build-eval-dataset.cjs (no RNG, no scraped store data, no real personal data).',
      uri: null,
      license: 'MIT',
      usage: 'permitted',
      collection: null,
      generation: {
        method: 'script',
        tool: 'scripts/build-eval-dataset.cjs',
        tool_version: '3.0.0',
        seed: null,
        parameters: {
          time_zone: 'America/Los_Angeles',
          window_start: '2025-01-01',
          window_end: '2026-12-31',
          recommended_virtual_now: EVAL_CLOCK,
          slice_tool: 'scripts/slice-dataset.cjs',
          seed_sha256: seedSha,
        },
      },
    },
    {
      source_id: 'synthetic-previews',
      kind: 'synthetic',
      description: '20 programmatically rendered 640x360 PNG gameplay & proportional HUD preview screenshots generated by scripts/render-previews.py (Pillow) and cataloged in contribution/assets.catalog.json.',
      uri: null,
      license: 'MIT',
      usage: 'permitted',
      collection: null,
      generation: {
        method: 'script',
        tool: 'scripts/render-previews.py (Pillow)',
        tool_version: '2.0.0',
        seed: null,
        parameters: {
          dimensions: '640x360',
          palette_colors: 96,
        },
      },
    },
  ],
  transformations: [
    'Validated against schemas/seed.schema.json, plugin.validateSeed chronological and clock invariants, and cross-record ownership/poll-tally consistency checks.',
  ],
  expected_counts: {
    records: evalSeed.games.length,
    assets: 20,
  },
  quality_policy: {
    duplicate_records: 'reject',
    duplicate_assets: 'reject',
    missing_assets: 'reject',
  },
  review: {
    status: 'pending',
    reviewer: null,
    notes: '100% synthetic evaluation dataset verified across all 24 months (2025-01..2026-12) and multiple pre-cutoff slices (2025-06-15, 2026-11-20, 2026-12-31) via scripts/slice-dataset.cjs, scripts/coverage.cjs, and real stdio MCP tests; independent reviewer sign-off pending.',
  },
};
fs.writeFileSync(path.join(OUT_DIR, 'dataset.json'), JSON.stringify(datasetMeta, null, 2) + '\n', 'utf8');

console.log(JSON.stringify({
  seed_path: 'datasets/eval-2025-2026/seed.json',
  seed_sha256: seedSha,
  recommended_virtual_now: EVAL_CLOCK,
  games: evalSeed.games.length,
  shelves: evalSeed.shelves.length,
  play_history_entries: evalSeed.shelves.reduce((n, s) => n + (s.play_history ? s.play_history.length : 0), 0),
  friend_owned_entries: evalSeed.friends.reduce((n, f) => n + f.owned_games.length, 0),
  polls: evalSeed.polls.length,
}, null, 2));
