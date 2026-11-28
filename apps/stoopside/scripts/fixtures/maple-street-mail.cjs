'use strict';
// The companion Mail seed for the Maple St fixture: 23 threads in Dana's
// mailbox before 2027-03-01 09:00 EST. Senders who are members use their
// Stoopside email; others use @example.org addresses. Five threads give the
// name link for aliased members whose email is not in Dana's member export
// (she is a co-organizer only of the block association).
module.exports = {
  account_id: 'mail-dana',
  threads: [
    {id: 'ms-potluck-waitlist', subject: 'Spring potluck waitlist', messages: [
      {from: 5, at: '2027-02-24T18:00:00-05:00', body: 'The potluck is full, but you and your guest are first on the waitlist. If a place opens you get a day to claim it.\nHarold (Hal B. on Stoopside)'}]},
    {id: 'ms-room-helper', subject: 'Friday room help', messages: [
      {from: 10, at: '2027-02-17T07:30:00-05:00', body: 'Rachel here (Rae K. on Stoopside). Could you cover Friday room help next week? I can swap any day.'},
      {from: 'me', to: [10], at: '2027-02-17T08:05:00-05:00', body: 'Yes, I can do Friday the 26th.'}]},
    {id: 'ms-squash-seeds', subject: 'Squash seeds', messages: [
      {from: 29, at: '2027-02-08T12:00:00-05:00', body: 'Elizabeth (Libby on the garden page) here. I saved squash seeds for you, they are on the shed shelf.'}]},
    {id: 'ms-saturday-run', subject: 'Saturday run?', messages: [
      {from: 33, at: '2027-02-26T19:10:00-05:00', body: 'Catherine here (Kit on Stoopside). Running Saturday? Your run club request should go through soon.'}]},
    {id: 'ms-plot-water', subject: 'Plot 10 watering', messages: [
      {from: 51, at: '2026-07-14T09:00:00-05:00', body: 'Julia (Jules on Stoopside) here. Could you water plot 10 while we are away the 20th to the 27th?'},
      {from: 'me', to: [51], at: '2026-07-14T10:20:00-05:00', body: 'Happy to. Enjoy the trip.'},
      {from: 51, at: '2026-07-28T18:45:00-05:00', body: 'Back home. The tomatoes made it, thank you. Jules'}]},
    {id: 'ms-birdie-moving', subject: 'Birdie is moving', messages: [
      {from: 3, at: '2027-02-27T21:40:00-05:00', body: 'Birdie told me she is moving in May. Can we plan a send-off with the June social crew? Keep it quiet, she would hate a fuss. Sam'},
      {from: 'me', to: [3], at: '2027-02-27T22:00:00-05:00', body: 'Yes. I will tell the planning meeting guests, not the whole block.'}]},
    {id: 'ms-party-weekend', subject: 'Spring fling weekend', messages: [
      {from: 3, at: '2027-02-28T09:15:00-05:00', body: 'We traded weekends: the kids are with me March 20 and 21, at my mother\'s. So the spring fling is just you if you go. Sam'}]},
    {id: 'ms-city-bags', subject: 'Cleanup supplies delivery', messages: [
      {from: 'streets@maple-city.example.org', at: '2027-02-18T10:00:00-05:00', body: 'Bags and grabbers for your March 20 cleanup will be delivered on February 19 between 9:00 and 12:00.'}]},
    {id: 'ms-school-dismissal', subject: 'Early dismissal Wednesday', messages: [
      {from: 'office@maple-st-school.example.org', at: '2027-02-22T07:00:00-05:00', body: 'Maple St School dismisses at 12:30 on Wednesday for conferences.'}]},
    {id: 'ms-winter-notes', subject: 'Winter meeting notes', messages: [
      {from: 6, at: '2027-01-24T11:00:00-05:00', body: 'Notes from the winter meeting: June social planning starts in March; cleanup is March 20. Joan'}]},
    {id: 'ms-coffee-urn', subject: 'Coffee urn for the cleanup', messages: [
      {from: 13, at: '2027-02-28T17:35:00-05:00', body: 'I proposed a swap on the sheet: my snacks for your coffee urn, if that works. Theo'}]},
    {id: 'ms-book-fair', subject: 'Book fair volunteers', messages: [
      {from: 2, at: '2027-02-23T09:30:00-05:00', body: 'Book fair volunteer shifts are up. Two hours each, March 25. Priya'}]},
    {id: 'ms-run-club', subject: 'Run club request', messages: [
      {from: 7, at: '2027-02-26T08:00:00-05:00', body: 'Got your request to join. I approve new runners after the Saturday run. Luis'}]},
    {id: 'ms-seed-jars', subject: 'Seed swap jars', messages: [
      {from: 27, at: '2026-10-04T15:00:00-05:00', body: 'The bean jars are on the shed shelf. Take what you like. Birdie'}]},
    {id: 'ms-bulbs-thanks', subject: 'Bulb planting', messages: [
      {from: 12, at: '2026-10-18T13:00:00-05:00', body: 'Thanks for the trowels. The median looks great. Kemi'}]},
    {id: 'ms-library-room', subject: 'Community room booking', messages: [
      {from: 'rooms@maple-library.example.org', at: '2026-12-10T14:00:00-05:00', body: 'Your booking of the community room on January 23, 18:00 to 21:00, is confirmed.'}]},
    {id: 'ms-fling-helpers', subject: 'Spring fling helpers', messages: [
      {from: 4, at: '2027-02-21T20:00:00-05:00', body: 'Setup crew meets at 15:00 on the 20th if you can help. Gus'}]},
    {id: 'ms-hydrant-flush', subject: 'Hydrant flushing Thursday', messages: [
      {from: 6, at: '2025-07-09T08:30:00-05:00', body: 'The city flushes the Maple St hydrants on Thursday morning. Tap water may run brown for an hour. Joan'},
      {from: 'me', to: [6], at: '2025-07-10T07:50:00-05:00', body: 'Thanks for the warning. I will fill a jug tonight.'}]},
    {id: 'ms-seed-catalog', subject: 'Seed catalog order', messages: [
      {from: 29, at: '2026-01-12T19:00:00-05:00', body: 'The garden seed order goes in on the 20th. Want to split a packet of the striped zucchini? Libby'},
      {from: 'me', to: [29], at: '2026-01-13T08:15:00-05:00', body: 'Yes please, put me down for half.'}]},
    {id: 'ms-summer-reading', subject: 'Summer reading logs', messages: [
      {from: 2, at: '2026-07-06T10:00:00-05:00', body: 'Summer reading logs are due back the first week of school. Spare copies are at the library desk. Priya'},
      {from: 'me', to: [2], at: '2026-07-07T09:10:00-05:00', body: 'Got it, thank you. Both kids have started.'}]},
    {id: 'ms-snow-rota', subject: 'Snow shovel rota', messages: [
      {from: 6, at: '2026-12-02T17:00:00-05:00', body: 'The winter snow shovel rota is on the block page. You have the second week of January. Joan'},
      {from: 'me', to: [6], at: '2026-12-03T07:40:00-05:00', body: 'Works for me.'}]},
    {id: 'ms-winter-concert', subject: 'Winter concert coat check', messages: [
      {from: 4, at: '2026-12-09T20:30:00-05:00', body: 'The winter concert is December 17 at 18:30 in the gym. Could you help with the coat check? Gus'},
      {from: 'me', to: [4], at: '2026-12-11T07:30:00-05:00', body: 'Yes, I can take the first hour.'},
      {from: 4, at: '2026-12-18T09:00:00-05:00', body: 'Thank you for last night. Not one coat went missing. Gus'}]},
    {id: 'ms-plot-renewal', subject: 'Plot renewal', messages: [
      {from: 5, at: '2026-12-21T12:00:00-05:00', body: 'Plot renewals for next season are due January 15. Plot 10 is yours again if you want it. Hal'}]},
  ],
};
