'use strict';
// Harbor after the transfer: a free-night certificate for one night, a points stay locked at the
// category in effect when booked, a category change that does not reprice it, and the booking
// notice delivered to Mail through Harbor's own publisher identity.
async function run({harbor, harborInfra, mail, mailInfra, router, write, version, equal, ok, clock}) {
  const kyoto = await harbor.call('harbor.search', {city:'Kyoto', check_in:'2027-10-16', check_out:'2027-10-17'});
  const station = kyoto.hotels.find(h => h.hotel_id === 'hotel-kyoto-station');
  ok('Search offers the certificate for a one-night Category 4 stay', station.eligible_certificate_ids.includes('cert-c4-2027'));
  const gionOnly = await harbor.call('harbor.book', {hotel_id:'hotel-kyoto-gion', check_in:'2027-10-16', check_out:'2027-10-17',
    payment:{method:'certificate', certificate_id:'cert-c4-2027'}, expected_version:await version(harborInfra), request_id:'cert-too-high'});
  equal('A certificate above its category cap is refused', gionOnly.code || gionOnly.status, 'certificate_invalid');
  const night = await write(harbor, harborInfra, 'harbor.book', {hotel_id:'hotel-kyoto-station', check_in:'2027-10-16', check_out:'2027-10-17',
    payment:{method:'certificate', certificate_id:'cert-c4-2027'}});
  equal('The certificate pays for the night', [night.certificate_id, night.points, night.cash_cents], ['cert-c4-2027', 0, 0]);
  const stay = await write(harbor, harborInfra, 'harbor.book', {hotel_id:'hotel-kyoto-gion', check_in:'2027-10-20', check_out:'2027-10-22', payment:{method:'points'}});
  equal('Gion is booked at the Category 6 price before the change', [stay.category_locked, stay.points], [6, 50000]);

  // The booking notice reaches Daniel's mailbox through Messaging.
  const bridge = await router('harbor-mail-config.json', 'harbor');
  const message = (await harbor.call('harbor.notices.outbound', {id:stay.notice_id})).message;
  const receipt = await bridge.call('router.publish', {request_id:'harbor-notice-' + stay.notice_id, message});
  equal('Harbor → Mail notice commits', [receipt.status, receipt.target], ['committed', {app_id:'mail', account_id:'mail-daniel'}]);
  const inbox = (await mail.call('mail.search', {folder:'inbox'})).messages;
  ok('The notice is in Daniel\'s inbox under the delivery event ID', inbox.some(m => m.id === receipt.event_id && m.subject === message.data.content.title));

  // After the change takes effect, new bookings pay Category 7; the existing stay keeps its price.
  await clock([harborInfra, mailInfra], '2027-10-01T09:00:00-05:00');
  const later = await harbor.call('harbor.search', {city:'Kyoto', check_in:'2027-10-23', check_out:'2027-10-24'});
  const gion = later.hotels.find(h => h.hotel_id === 'hotel-kyoto-gion');
  equal('Search now shows Category 7', gion.category, 7);
  const kept = (await harbor.call('harbor.reservations', {id:stay.id})).item;
  equal('The earlier reservation keeps its locked price', [kept.category_locked, kept.points], [6, 50000]);
  return {certificate_reservation:night.id, points_reservation:stay.id, notice_receipt:receipt};
}
module.exports = {run};
