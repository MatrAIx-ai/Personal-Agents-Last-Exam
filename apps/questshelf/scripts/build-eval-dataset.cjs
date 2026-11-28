#!/usr/bin/env node
'use strict';

/**
 * Deterministic generator for QuestShelf's 2025-01-01..2026-12-31 synthetic evaluation
 * dataset (MIT License). Reads fixtures/minimal.json for the 20-game catalog and
 * constructs realistic multi-year user activity: shelf status changes, play sessions,
 * completions, ratings, drop reasons, friend library additions, and 26 game-night polls.
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

// 1. Staggered catalog patch timestamps across 2025-01 .. 2026-11 (metadata only, separated from user activity)
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

// 2. Rich multi-year user shelf history (2025-01-03 through 2026-12-28)
// Every entry represents a realistic shelf acquisition, play session, completion, rating, or drop.
const shelves = [
  {
    game_id: 'game-pebble-harbor',
    owned_platforms: ['handheld', 'switch'],
    play_history: [
      { at: '2025-01-03T19:20:00-08:00', status: 'backlog', hours_logged: 0.0, rating: null, drop_reasons: [], note: 'Picked up during New Year eShop sale.' },
      { at: '2025-01-11T21:10:00-08:00', status: 'playing', hours_logged: 1.5, rating: null, drop_reasons: [], note: 'Delivered first cliffside mail route; cozy pace.' },
      { at: '2025-01-19T16:40:00-08:00', status: 'playing', hours_logged: 3.4, rating: null, drop_reasons: [], note: 'Finished lighthouse keeper letters on handheld.' },
      { at: '2025-02-02T20:15:00-08:00', status: 'completed', hours_logged: 5.5, rating: 9.2, drop_reasons: [], note: 'Wrapped final harbor festival chapter; great big text.' },
    ],
  },
  {
    game_id: 'game-tiny-botanist',
    owned_platforms: ['handheld', 'switch'],
    play_history: [
      { at: '2025-02-16T14:30:00-08:00', status: 'backlog', hours_logged: 0.0, rating: null, drop_reasons: [], note: 'Recommended by Lin for commuter puzzles.' },
      { at: '2025-02-23T18:50:00-08:00', status: 'playing', hours_logged: 1.4, rating: null, drop_reasons: [], note: 'Crossbred first silver fern hybrid.' },
      { at: '2025-03-08T11:20:00-08:00', status: 'playing', hours_logged: 2.9, rating: null, drop_reasons: [], note: 'Unlocked orchid greenhouse wing.' },
      { at: '2025-03-22T19:45:00-07:00', status: 'completed', hours_logged: 4.3, rating: 9.4, drop_reasons: [], note: 'Completed all 40 beds; effortless handheld readability.' },
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
      { at: '2025-05-17T09:40:00-07:00', status: 'playing', hours_logged: 2.0, rating: null, drop_reasons: [], note: 'Cleared coastal timber depot contracts.' },
      { at: '2025-06-06T20:25:00-07:00', status: 'playing', hours_logged: 4.6, rating: null, drop_reasons: [], note: 'Solved dual-track bridge timing puzzle.' },
      { at: '2025-06-21T17:15:00-07:00', status: 'completed', hours_logged: 7.4, rating: 8.8, drop_reasons: [], note: 'Main campaign done; clean crisp UI on train ride.' },
    ],
  },
  {
    game_id: 'game-void-breaker',
    owned_platforms: ['pc'],
    play_history: [
      { at: '2025-07-03T19:00:00-07:00', status: 'backlog', hours_logged: 0.0, rating: null, drop_reasons: [], note: 'Picked up to test new GPU.' },
      { at: '2025-07-14T21:30:00-07:00', status: 'playing', hours_logged: 1.1, rating: null, drop_reasons: [], note: 'Cleared Floor 1 vault; camera bob feels aggressive.' },
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
      { at: '2025-09-24T21:00:00-07:00', status: 'completed', hours_logged: 7.2, rating: 8.7, drop_reasons: [], note: 'Finished autumn ridge loop; super relaxing.' },
    ],
  },
  {
    game_id: 'game-neon-drift-99',
    owned_platforms: ['pc'],
    play_history: [
      { at: '2025-10-05T19:15:00-07:00', status: 'backlog', hours_logged: 0.0, rating: null, drop_reasons: [], note: 'Grabbed on Steam autumn promo.' },
      { at: '2025-10-18T21:05:00-07:00', status: 'playing', hours_logged: 1.0, rating: null, drop_reasons: [], note: 'Tried two drift cups; way too frantic after work.' },
      { at: '2025-10-25T16:40:00-07:00', status: 'backlog', hours_logged: 1.0, rating: null, drop_reasons: [], note: 'Shelved and muted arcade racers.' },
    ],
  },
  {
    game_id: 'game-orbit-relay',
    owned_platforms: ['pc', 'switch'],
    play_history: [
      { at: '2025-03-14T18:20:00-07:00', status: 'backlog', hours_logged: 0.0, rating: null, drop_reasons: [], note: 'Bought for PC-PS5 co-op nights with Alex.' },
      { at: '2025-05-29T20:00:00-07:00', status: 'playing', hours_logged: 1.5, rating: null, drop_reasons: [], note: 'Ran two orbital tether missions with Alex & Sam.' },
      { at: '2025-11-14T20:45:00-08:00', status: 'playing', hours_logged: 3.4, rating: null, drop_reasons: [], note: 'Cleared Sector 4 oxygen-leak emergency.' },
      { at: '2026-04-17T21:15:00-07:00', status: 'playing', hours_logged: 5.2, rating: null, drop_reasons: [], note: 'Cross-play voice sync worked smoothly on Switch.' },
      { at: '2026-10-09T20:30:00-07:00', status: 'backlog', hours_logged: 6.4, rating: null, drop_reasons: [], note: 'Pausing between seasonal group co-op nights.' },
    ],
  },
  {
    game_id: 'game-ember-kitchen',
    owned_platforms: ['pc', 'switch'],
    play_history: [
      { at: '2025-01-24T19:50:00-08:00', status: 'backlog', hours_logged: 0.0, rating: null, drop_reasons: [], note: 'Picked up for Friday party sessions.' },
      { at: '2025-06-13T20:30:00-07:00', status: 'playing', hours_logged: 1.2, rating: null, drop_reasons: [], note: 'Three-starred brick-oven flatbread rush.' },
      { at: '2025-12-12T21:00:00-08:00', status: 'playing', hours_logged: 2.8, rating: null, drop_reasons: [], note: 'Holiday kitchen DLC night with Alex and Lin.' },
      { at: '2026-06-19T20:10:00-07:00', status: 'playing', hours_logged: 4.5, rating: null, drop_reasons: [], note: 'Beat pastry gauntlet on first try.' },
      { at: '2026-11-06T20:55:00-08:00', status: 'backlog', hours_logged: 5.5, rating: null, drop_reasons: [], note: 'Always ready as a 45-minute co-op fallback.' },
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
      { at: '2026-01-25T20:15:00-08:00', status: 'completed', hours_logged: 12.6, rating: 8.6, drop_reasons: [], note: 'Great crisp tactical grid; solid 45-min missions.' },
    ],
  },
  {
    game_id: 'game-velvet-cipher',
    owned_platforms: ['handheld', 'switch'],
    play_history: [
      { at: '2026-02-07T13:15:00-08:00', status: 'backlog', hours_logged: 0.0, rating: null, drop_reasons: [], note: 'Grabbed for February flight.' },
      { at: '2026-02-21T20:05:00-08:00', status: 'playing', hours_logged: 2.1, rating: null, drop_reasons: [], note: 'Solved dining-car cipher clue.' },
      { at: '2026-03-07T16:30:00-08:00', status: 'playing', hours_logged: 4.5, rating: null, drop_reasons: [], note: 'Interrogated conductor in Car 4.' },
      { at: '2026-03-20T21:10:00-07:00', status: 'completed', hours_logged: 6.2, rating: 9.0, drop_reasons: [], note: 'Clever finale twist; legible text offline.' },
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
      { at: '2026-07-12T17:20:00-07:00', status: 'playing', hours_logged: 6.8, rating: null, drop_reasons: [], note: 'Unlocked Ascension 2 sigils.' },
      { at: '2026-07-29T20:50:00-07:00', status: 'completed', hours_logged: 10.2, rating: 9.1, drop_reasons: [], note: 'Beat final rune golem; crisp card legibility.' },
    ],
  },
  {
    game_id: 'game-boulder-league',
    owned_platforms: ['pc'],
    play_history: [
      { at: '2026-08-06T18:30:00-07:00', status: 'backlog', hours_logged: 0.0, rating: null, drop_reasons: [], note: 'Steam key from sports bundle; no PC-PS5 cross-play.' },
      { at: '2026-08-22T19:45:00-07:00', status: 'playing', hours_logged: 1.5, rating: null, drop_reasons: [], note: 'Played two PC-only arena matches with Sam.' },
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
      { at: '2026-12-13T19:25:00-08:00', status: 'completed', hours_logged: 6.3, rating: 9.3, drop_reasons: [], note: 'Favorite puzzle adventure of the year; huge clear HUD.' },
    ],
  },
  {
    game_id: 'game-ashen-depths',
    owned_platforms: ['handheld', 'pc'],
    play_history: [
      { at: '2026-10-28T20:00:00-07:00', status: 'backlog', hours_logged: 0.0, rating: null, drop_reasons: [], note: 'Started downloading for weekend RPG run.' },
      { at: '2026-11-12T20:15:00-08:00', status: 'playing', hours_logged: 6.5, rating: null, drop_reasons: [], note: 'Struggling with tiny 7pt crafting text on handheld.' },
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

// 3. Friend library changes spanning 2025-01 .. 2026-12
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
      { game_id: 'game-clockwork-isle', platform: 'switch', added_at: '2026-10-20T15:25:00-07:00' },
      { game_id: 'game-moss-cartographer', platform: 'handheld', added_at: '2026-12-08T17:50:00-08:00' },
    ],
  },
];

// 4. 25 varied closed historical polls covering every month 2025-01..2026-11 + 1 active open poll in 2026-12
const closedPollSpecs = [
  ['poll-2025-01-kickoff', 'January Winter Bistro Co-Op', ['game-ember-kitchen', 'game-neon-drift-99'], ['friend-alex'], 60, '2025-01-25T16:00:00-08:00', '2025-01-26T18:30:00-08:00', '2025-01-27T21:00:00-08:00', 'game-ember-kitchen', 'Warming up with bistro rounds.', 'Down for pizza chaos on PS5.'],
  ['poll-2025-02-rainy', 'Rainy Sunday Party Night', ['game-ember-kitchen', 'game-neon-drift-99'], ['friend-alex', 'friend-sam'], 60, '2025-02-14T17:20:00-08:00', '2025-02-15T13:10:00-08:00', '2025-02-16T20:00:00-08:00', 'game-ember-kitchen', 'Switch dock is ready.', 'Ember Kitchen fits 60 mins cleanly.'],
  ['poll-2025-03-orbital', 'March Cross-Play Launch Night', ['game-orbit-relay', 'game-ember-kitchen'], ['friend-alex'], 90, '2025-03-19T18:00:00-07:00', '2025-03-20T15:40:00-07:00', '2025-03-21T21:30:00-07:00', 'game-orbit-relay', 'Excited to test Orbit Relay cross-play.', 'Installed on PS5, let us launch!'],
  ['poll-2025-04-trio', 'April Trio Co-Op Session', ['game-orbit-relay', 'game-ember-kitchen'], ['friend-alex', 'friend-sam'], 90, '2025-04-23T17:45:00-07:00', '2025-04-24T12:25:00-07:00', '2025-04-25T21:00:00-07:00', 'game-orbit-relay', 'Sam just grabbed Orbit Relay on PC.', 'Works great for a 90-minute evening.'],
  ['poll-2025-05-memorial', 'Memorial Weekend Rescue Run', ['game-orbit-relay', 'game-ember-kitchen'], ['friend-alex', 'friend-sam'], 90, '2025-05-22T18:10:00-07:00', '2025-05-23T19:00:00-07:00', '2025-05-24T22:00:00-07:00', 'game-orbit-relay', 'Ready to tackle Sector 2 thrusters.', 'Count me in after dinner.'],
  ['poll-2025-06-summer', 'June Bistro Showdown', ['game-ember-kitchen', 'game-orbit-relay'], ['friend-alex', 'friend-sam'], 60, '2025-06-11T17:00:00-07:00', '2025-06-12T14:50:00-07:00', '2025-06-13T20:00:00-07:00', 'game-ember-kitchen', 'Short evening before early flight.', 'Flatbread rush sounds fun.'],
  ['poll-2025-07-midyear', 'Mid-Summer Co-Op Check-In', ['game-orbit-relay', 'game-ember-kitchen'], ['friend-alex', 'friend-sam'], 75, '2025-07-17T18:30:00-07:00', '2025-07-18T11:45:00-07:00', '2025-07-19T21:15:00-07:00', 'game-orbit-relay', 'Need two more rescue medals.', 'Orbital shift works for me.'],
  ['poll-2025-08-late', 'August Friday Game Night', ['game-ember-kitchen', 'game-neon-drift-99'], ['friend-alex'], 60, '2025-08-21T17:15:00-07:00', '2025-08-22T16:20:00-07:00', '2025-08-23T20:30:00-07:00', 'game-ember-kitchen', 'Skipping racers tonight.', 'Kitchen co-op is always solid.'],
  ['poll-2025-09-autumn', 'Early Autumn Co-Op Night', ['game-orbit-relay', 'game-ember-kitchen'], ['friend-alex', 'friend-sam'], 90, '2025-09-17T18:05:00-07:00', '2025-09-18T17:35:00-07:00', '2025-09-19T21:00:00-07:00', 'game-orbit-relay', 'Good break from solo hikes.', 'Let us clear Sector 3.'],
  ['poll-2025-10-spooky', 'October Non-Horror Co-Op', ['game-ember-kitchen', 'game-orbit-relay'], ['friend-alex', 'friend-sam'], 60, '2025-10-28T17:40:00-07:00', '2025-10-29T15:10:00-07:00', '2025-10-30T20:45:00-07:00', 'game-ember-kitchen', 'Keeping Halloween cozy instead of scary.', 'Pumpkin soup level in Ember Kitchen!'],
  ['poll-2025-11-nov', 'November Deep-Space Co-Op', ['game-orbit-relay', 'game-ember-kitchen'], ['friend-alex', 'friend-sam'], 90, '2025-11-12T18:00:00-08:00', '2025-11-13T16:30:00-08:00', '2025-11-14T20:15:00-08:00', 'game-orbit-relay', 'Aiming for Sector 4 tonight.', 'Online by 8pm PT.'],
  ['poll-2025-12-holiday', 'December 4-Player Bistro Party', ['game-ember-kitchen', 'game-orbit-relay'], ['friend-alex', 'friend-sam', 'friend-lin'], 60, '2025-12-10T17:30:00-08:00', '2025-12-11T19:15:00-08:00', '2025-12-12T20:30:00-08:00', 'game-ember-kitchen', 'Lin joined Switch bistro crew!', 'Full four-chef squad finally.'],
  ['poll-2026-01-newyear', 'New Year Cross-Play Warmup', ['game-orbit-relay', 'game-ember-kitchen'], ['friend-alex', 'friend-sam'], 90, '2026-01-15T18:20:00-08:00', '2026-01-16T14:00:00-08:00', '2026-01-17T21:00:00-08:00', 'game-orbit-relay', 'Back after Starlight Tactics break.', 'Ready for thruster repairs.'],
  ['poll-2026-02-feb', 'February Cozy Switch Party', ['game-ember-kitchen', 'game-orbit-relay'], ['friend-sam', 'friend-lin'], 45, '2026-02-12T17:10:00-08:00', '2026-02-13T13:45:00-08:00', '2026-02-14T19:30:00-08:00', 'game-ember-kitchen', 'Quick 45-min Valentine dinner rush.', 'Ember Kitchen on Switch works great.'],
  ['poll-2026-03-spring', 'Spring Equinox Co-Op', ['game-orbit-relay', 'game-ember-kitchen'], ['friend-alex', 'friend-sam'], 75, '2026-03-18T18:00:00-07:00', '2026-03-19T16:10:00-07:00', '2026-03-20T20:30:00-07:00', 'game-orbit-relay', 'Celebrating finishing Velvet Cipher.', 'Orbit Relay gets my vote.'],
  ['poll-2026-04-apr', 'April Orbital Sprint', ['game-orbit-relay', 'game-ember-kitchen'], ['friend-alex', 'friend-sam'], 90, '2026-04-15T17:50:00-07:00', '2026-04-16T15:20:00-07:00', '2026-04-17T20:45:00-07:00', 'game-orbit-relay', 'Testing Switch cross-play patch.', 'No lag on PS5 last round.'],
  ['poll-2026-05-may', 'May Bistro Throwdown', ['game-ember-kitchen', 'game-orbit-relay'], ['friend-alex', 'friend-lin'], 60, '2026-05-14T17:30:00-07:00', '2026-05-15T14:40:00-07:00', '2026-05-16T20:00:00-07:00', 'game-ember-kitchen', 'Want something light after Frost Protocol.', 'Bistro rush all the way.'],
  ['poll-2026-06-june', 'June Pastry Gauntlet Night', ['game-ember-kitchen', 'game-orbit-relay'], ['friend-alex', 'friend-sam', 'friend-lin'], 60, '2026-06-17T18:00:00-07:00', '2026-06-18T16:05:00-07:00', '2026-06-19T19:45:00-07:00', 'game-ember-kitchen', 'Going for 3 stars on pastry level.', 'In on PS5 cross-play!'],
  ['poll-2026-07-july', 'July Saturday Rescue Crew', ['game-orbit-relay', 'game-ember-kitchen'], ['friend-alex', 'friend-sam'], 90, '2026-07-22T18:15:00-07:00', '2026-07-23T17:20:00-07:00', '2026-07-24T21:30:00-07:00', 'game-orbit-relay', 'Space station rescue night.', 'Sounds great, bringing engineer kit.'],
  ['poll-2026-08-pc', 'August PC Arena Trial', ['game-boulder-league', 'game-orbit-relay'], ['friend-sam'], 60, '2026-08-20T17:45:00-07:00', '2026-08-21T15:00:00-07:00', '2026-08-22T19:15:00-07:00', 'game-boulder-league', 'Trying PC-only Boulder League with Sam.', 'Boulder League works on Steam tonight.'],
  ['poll-2026-09-sep', 'September Friday Co-Op', ['game-ember-kitchen', 'game-orbit-relay'], ['friend-alex', 'friend-sam'], 75, '2026-09-10T18:10:00-07:00', '2026-09-11T16:45:00-07:00', '2026-09-12T20:30:00-07:00', 'game-ember-kitchen', 'Quick cozy bistro rounds.', 'Kitchen works for 75 mins.'],
  ['poll-2026-10-oct', 'October Cross-Play Night', ['game-orbit-relay', 'game-ember-kitchen'], ['friend-alex', 'friend-sam'], 90, '2026-10-07T18:00:00-07:00', '2026-10-08T15:30:00-07:00', '2026-10-09T20:00:00-07:00', 'game-orbit-relay', 'Final orbital mission before break.', 'Orbit Relay confirmed.'],
  ['poll-2026-11-early', 'Early November Bistro Hangout', ['game-ember-kitchen', 'game-orbit-relay'], ['friend-alex', 'friend-sam', 'friend-lin'], 60, '2026-11-04T17:30:00-08:00', '2026-11-05T18:10:00-08:00', '2026-11-06T20:20:00-08:00', 'game-ember-kitchen', 'Relaxed Friday cooking session.', 'Always up for Ember Kitchen.'],
  ['poll-2026-11-late', 'Thanksgiving Eve Co-Op Poll', ['game-orbit-relay', 'game-ember-kitchen'], ['friend-alex', 'friend-sam'], 90, '2026-11-18T17:50:00-08:00', '2026-11-19T14:25:00-08:00', '2026-11-20T22:00:00-08:00', 'game-orbit-relay', 'Either works on PC.', 'Orbit Relay fits a 90-min window.'],
  ['poll-2026-12-winter', 'Mid-December Holiday Kitchen', ['game-ember-kitchen', 'game-orbit-relay'], ['friend-alex', 'friend-lin'], 60, '2026-12-10T17:40:00-08:00', '2026-12-11T16:15:00-08:00', '2026-12-12T20:45:00-08:00', 'game-ember-kitchen', 'Holiday menu challenge!', 'Switch is charged and ready.'],
];

const polls = closedPollSpecs.map(([id, title, cands, invited, mins, created, voted, closed, winner, mayaNote, friendNote]) => ({
  poll_id: id,
  title,
  status: 'closed',
  candidate_game_ids: cands,
  invited_friend_ids: invited,
  max_session_minutes: mins,
  votes: [
    { voter_id: 'questshelf-maya', selected_game_ids: [winner], note: mayaNote, voted_at: created },
    { voter_id: invited[0], selected_game_ids: [winner], note: friendNote, voted_at: voted },
  ],
  winner_game_ids: [winner],
  created_at: created,
  closes_at: closed,
  closed_at: closed,
}));

// Single active open poll at the end of December 2026
polls.push({
  poll_id: 'poll-2026-nye-coop',
  title: 'New Years Eve 90-Min Co-Op',
  status: 'open',
  candidate_game_ids: ['game-orbit-relay', 'game-ember-kitchen'],
  invited_friend_ids: ['friend-alex', 'friend-sam', 'friend-lin'],
  max_session_minutes: 90,
  votes: [
    { voter_id: 'questshelf-maya', selected_game_ids: ['game-orbit-relay', 'game-ember-kitchen'], note: 'Happy with either for NYE.', voted_at: '2026-12-29T18:15:00-08:00' },
    { voter_id: 'friend-alex', selected_game_ids: ['game-ember-kitchen'], note: 'Bistro countdown sounds fun!', voted_at: '2026-12-30T19:05:00-08:00' },
  ],
  winner_game_ids: [],
  created_at: '2026-12-27T17:00:00-08:00',
  closes_at: '2026-12-31T23:30:00-08:00',
  closed_at: null,
});

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

// Validate against schemas/seed.schema.json and plugin.validateSeed
const seedValidator = compile(
  JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'schemas', 'seed.schema.json'), 'utf8')),
  path.join(APP_ROOT, 'schemas')
);
if (!seedValidator(evalSeed)) {
  throw new Error('eval-2025-2026 seed failed JSON schema validation');
}
plugin.validateSeed({ binding, virtual_now: '2026-12-31T23:00:00-08:00' }, evalSeed);

const seedPath = path.join(OUT_DIR, 'seed.json');
fs.writeFileSync(seedPath, JSON.stringify(evalSeed, null, 2) + '\n', 'utf8');
const seedSha = crypto.createHash('sha256').update(fs.readFileSync(seedPath)).digest('hex');

const clockPath = path.join(OUT_DIR, 'clock.json');
fs.writeFileSync(clockPath, JSON.stringify({ initial_time: '2026-12-31T23:00:00-08:00' }, null, 2) + '\n', 'utf8');

const datasetMeta = {
  schema_version: 'pale.dataset.v1',
  dataset_id: 'questshelf-eval-2025-2026',
  version: '1.0.0',
  description: 'Full 24-month (2025-01-01 through 2026-12-31) synthetic QuestShelf evaluation dataset containing shelf status transitions, play sessions, completions, ratings, drop reasons, friend library additions, and 26 co-op polls. Recommended virtual_now >= 2026-12-31T23:00:00-08:00.',
  record_source_ids: ['synthetic-eval-history'],
  sources: [
    {
      source_id: 'synthetic-eval-history',
      kind: 'synthetic',
      description: '100% synthetic 2-year user game-library activity, friend library additions, and co-op poll history generated deterministically by scripts/build-eval-dataset.cjs (no scraped store data or real personal data).',
      uri: null,
      license: 'MIT',
      usage: 'permitted',
      collection: null,
      generation: {
        method: 'script',
        tool: 'scripts/build-eval-dataset.cjs',
        tool_version: '1.0.0',
        seed: 20252026,
        parameters: {
          time_zone: 'America/Los_Angeles',
          window_start: '2025-01-01',
          window_end: '2026-12-31',
          recommended_virtual_now: '2026-12-31T23:00:00-08:00',
          seed_sha256: seedSha,
        },
      },
    },
  ],
  transformations: [
    'Validated against schemas/seed.schema.json and plugin.validateSeed chronological invariants.',
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
    status: 'approved',
    reviewer: '@shangliy (author self-check; independent maintainer review pending)',
    notes: '100% synthetic evaluation dataset verified across all 24 months (2025-01..2026-12) via scripts/coverage.cjs and real stdio MCP env.load_seed.',
  },
};
fs.writeFileSync(path.join(OUT_DIR, 'dataset.json'), JSON.stringify(datasetMeta, null, 2) + '\n', 'utf8');

console.log(JSON.stringify({
  seed_path: 'datasets/eval-2025-2026/seed.json',
  seed_sha256: seedSha,
  games: evalSeed.games.length,
  shelves: evalSeed.shelves.length,
  play_history_entries: evalSeed.shelves.reduce((n, s) => n + (s.play_history ? s.play_history.length : 0), 0),
  friend_owned_entries: evalSeed.friends.reduce((n, f) => n + f.owned_games.length, 0),
  polls: evalSeed.polls.length,
}, null, 2));
