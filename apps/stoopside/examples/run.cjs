'use strict';
// Applies the example scenario event (a guest drops out of the full Spring
// potluck) to the fixture, then claims the offered place for one person, and
// prints the offer notice, the claim receipt and the resulting RSVPs.
const assert = require('node:assert/strict');
const {fixture} = require('../tests/harness.cjs');
const f = fixture();
const before = f.data;
f.event(require('./scenario.json'));
assert.notDeepEqual(f.data, before);
const offer = f.data.notices.at(-1);
assert.equal(offer.kind, 'waitlist_offer');
f.at('2027-03-06T09:00:00-05:00');
const preview = f.call('rsvps.preview', {event_id: 'e-0117', answer: 'yes', guests: 0, children: 0}).preview;
const confirmed = f.call('rsvps.confirm', {preview_id: preview.id});
assert.equal(confirmed.rsvp.answer, 'yes');
const after = f.data;
console.log(JSON.stringify({
  app: 'stoopside',
  offer_notice: offer.message,
  claim: {outcome: preview.outcome, places: preview.places, rsvp: confirmed.rsvp},
  receipt_notice: after.notices.at(-1).message.data.content,
  waitlist: after.rsvps.filter(r => r.event_id === 'e-0117' && ['waitlist', 'offered'].includes(r.answer))
    .map(r => ({id: r.id, member_id: r.member_id, answer: r.answer, offer_expires_at: r.offer_expires_at})),
}, null, 2));
