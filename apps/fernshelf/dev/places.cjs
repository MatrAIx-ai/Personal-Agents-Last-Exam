'use strict';
// The 30 fictional places of the reference fixture (fixtures/minimal.json uses four of them), each
// with the scene kind its stand-in image is drawn from. The names are invented: no real street,
// venue, park or landmark, and no coordinates (lat and lon are null in the fixtures).
const PLACES = [
  ['Wrenfield Grange Hall', 'hall'], ['Tamsin Row garden', 'garden'], ['Gullwhistle Beach', 'beach'], ['Larchcombe Ridge trailhead', 'mountain'],
  ['Fenwick kitchen', 'kitchen'], ['Quillbury Street', 'city'], ['Pellingham Green', 'garden'], ['Hobbleford cabin', 'mountain'],
  ['Glimmerwell Lake', 'mountain'], ['Kettlewhistle cafe', 'kitchen'], ['Thimble Lane community garden', 'garden'], ['Saltwhistle boardwalk', 'beach'],
  ['Thistlecombe orchard', 'garden'], ['Grandpa Walt\'s porch', 'hall'], ['Ferrowby market', 'city'], ['Antlerwick Meadow', 'mountain'],
  ['Lanternby Square', 'night'], ['Junipercombe lookout', 'mountain'], ['Driftwhistle Cove', 'beach'], ['Maplewick school hall', 'hall'],
  ['Granwick Lofts rooftop', 'city'], ['Pinewhistle ski lodge', 'snow'], ['Frostcombe sled hill', 'snow'], ['Heronwick marsh', 'beach'],
  ['Cedarwhistle campsite', 'mountain'], ['Millwhistle bakery', 'kitchen'], ['Tidecombe ferry dock', 'beach'], ['Ashwhistle station', 'city'],
  ['Starwick overlook', 'night'], ['Hawcombe Avenue', 'city']];
module.exports = {PLACES};
