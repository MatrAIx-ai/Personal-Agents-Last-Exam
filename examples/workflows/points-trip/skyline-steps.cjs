'use strict';
// Skyline after the credit: ticket two seats together on the return connection, sell out the rest,
// then a schedule change breaks the connection; the notice reaches Mail and the free next-day
// alternative is taken before its deadline, keeping the pair together.
const SEARCH = {origin:'HND', dest:'ORD', date:'2027-10-21', cabin:'business', pax:2};
const TOGETHER = [
  {flight_id:'PC12-2027-10-21', passenger_id:'pax-daniel', seat:'1D'}, {flight_id:'PC12-2027-10-21', passenger_id:'pax-mei', seat:'1F'},
  {flight_id:'LK480-2027-10-21', passenger_id:'pax-daniel', seat:'1A'}, {flight_id:'LK480-2027-10-21', passenger_id:'pax-mei', seat:'1B'}];
const seatsOf = seats => seats.map(s => s.flight_id + ' ' + s.passenger_id + ' ' + s.seat).sort();

async function run({skyline, skylineInfra, mail, router, write, event, version, equal, ok}) {
  const [option] = (await skyline.call('skyline.search', SEARCH)).options;
  equal('Search finds the HND → SFO → ORD connection with saver seats for two',
    option.segments.map(s => s.flight_id || s.id), ['PC12-2027-10-21', 'LK480-2027-10-21']);
  const before = await skyline.call('skyline.balance', {});
  const booking = await write(skyline, skylineInfra, 'skyline.book', {option_id:option.option_id, passenger_ids:['pax-daniel', 'pax-mei'],
    payment_label:'card-travel', seats:TOGETHER});
  equal('Both travelers are ticketed side by side on both segments', seatsOf(booking.seats), seatsOf(TOGETHER));
  const after = await skyline.call('skyline.balance', {});
  equal('Points are redeemed and the partner fee plus taxes go to the chosen card',
    [before.balance - after.balance, after.charges.at(-1).label, after.charges.at(-1).amount_cents], [option.total.points, 'card-travel', 17040]);

  // The last saver seats on the long-haul leg sell out; the earlier option is stale.
  await event(skylineInfra, {event_id:'sold-pc12-2027-10-21', at:'2027-08-24T21:30:00-05:00', operation:'skyline.inventory.sold',
    payload:{flight_id:'PC12-2027-10-21', cabin:'business', seats:'all'}});
  equal('No saver option remains that day', (await skyline.call('skyline.search', SEARCH)).options.length, 0);
  const stale = await skyline.call('skyline.book', {option_id:option.option_id, passenger_ids:['pax-daniel', 'pax-mei'], payment_label:'card-travel',
    expected_version:await version(skylineInfra), request_id:'stale-book'});
  equal('Booking the old search result is refused', stale.code || stale.status, 'stale_version');

  // A retime makes the SFO connection illegal; the change opens with two free alternatives.
  await event(skylineInfra, {event_id:'chg-pc12-2027-10-21', at:'2027-08-24T22:00:00-05:00', operation:'skyline.schedule.changed',
    payload:{change_id:'chg-pc12-2027-10-21', flight_id:'PC12-2027-10-21', departs_at:'2027-10-21T20:30:00+09:00', arrives_at:'2027-10-21T14:20:00-07:00',
      alternatives:[{id:'alt-same-day', flight_ids:['PC12-2027-10-21', 'LK488-2027-10-21']}, {id:'alt-next-day', flight_ids:['PC12-2027-10-22', 'LK480-2027-10-22']}],
      deadline:'2027-09-01T23:59:00-05:00'}});
  const trip = (await skyline.call('skyline.trips', {id:booking.id})).trip;
  equal('The booking shows an open illegal-connection change', [trip.change.status, trip.change.reason], ['open', 'illegal_connection']);
  const notice = (await skyline.call('skyline.notices.list', {})).notices.find(n => n.kind === 'schedule_change' && JSON.stringify(n.ref || {}).includes(booking.id));
  const bridge = await router('skyline-mail-config.json', 'skyline');
  const message = (await skyline.call('skyline.notices.outbound', {id:notice.id})).message;
  const receipt = await bridge.call('router.publish', {request_id:'skyline-' + notice.id, message});
  equal('Skyline → Mail schedule-change notice commits', [receipt.status, receipt.target], ['committed', {app_id:'mail', account_id:'mail-daniel'}]);
  const inbox = (await mail.call('mail.search', {folder:'inbox'})).messages;
  ok('The notice with its deadline is in Daniel\'s inbox', inbox.some(m => m.id === receipt.event_id && m.body.includes('2027-09-01')));
  const accepted = await write(skyline, skylineInfra, 'skyline.manage', {booking_id:booking.id, action:'accept_alternative', alternative_id:'alt-next-day'});
  equal('The free alternative keeps the pair together on the new flights', seatsOf(accepted.seats),
    seatsOf([{flight_id:'PC12-2027-10-22', passenger_id:'pax-daniel', seat:'1D'}, {flight_id:'PC12-2027-10-22', passenger_id:'pax-mei', seat:'1F'},
      {flight_id:'LK480-2027-10-22', passenger_id:'pax-daniel', seat:'1A'}, {flight_id:'LK480-2027-10-22', passenger_id:'pax-mei', seat:'1B'}]));
  equal('Taking the alternative costs nothing', (await skyline.call('skyline.balance', {})).charges.length, after.charges.length);
  return {booking:booking.id, locator:booking.locator, schedule_notice_receipt:receipt, reassigned:accepted.reassigned};
}
module.exports = {run};
