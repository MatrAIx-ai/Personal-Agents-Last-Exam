'use strict';
// The claim scenarios of the evaluation data. Each scenario defines its loss text, loss time rule, lines, supplements, evidence and the reasons of each decision.
// dev/generate-evaluation-data.cjs picks every part of a claim from inside one scenario. dev/check-evaluation.cjs checks the delivered claims against the same table.

// How the insurer decides a line, and the dispute that answers each decision. `cut` approves less than the line asks.
const DECISIONS = {
  part: {cut: 'Priced as an aftermarket part of like kind and quality.',
    dispute: 'The shop says that no aftermarket part of like kind and quality fits this car. Its note is attached.',
    evidence: c => 'Note from ' + c.shop + ': no aftermarket part of like kind and quality is available for this line on a ' + c.car + '.',
    changed: 'The note from the shop is accepted. The original part is approved in full.',
    upheld: 'Two suppliers list an aftermarket part of like kind and quality for this car. The decision stands.'},
  paint: {cut: 'Paint time is limited to the standard book time.',
    dispute: 'The paint is a three-stage color, which needs more time than the book allows. The paint invoice is attached.',
    evidence: c => 'Paint invoice from ' + c.shop + ' with the three-stage color code of the ' + c.car + '.',
    changed: 'Three-stage paint time is accepted. The line is approved in full.',
    upheld: 'The book time already includes three-stage paint for this color. The decision stands.'},
  labor: {cut: 'Labor is limited to the agreed hourly rate.',
    dispute: 'The shop charges its posted hourly rate, which is the usual rate in this area. Its rate sheet is attached.',
    evidence: c => 'Posted labor rate sheet from ' + c.shop + '.',
    changed: 'The posted rate is accepted for this shop. The line is approved in full.',
    upheld: 'The agreed rate for this area is lower than the posted rate. The decision stands.'},
  materials: {cut: 'Paint materials are limited to the standard rate for the approved paint time.'},
  fixed: {},
  // A line on a part that can show older damage.
  old: {deny: 'The photos show this damage was there before the loss.',
    dispute: 'This damage was not there before the loss. A dated photo from before the loss is attached.',
    evidence: c => 'Photo of the ' + c.car + ' taken before the loss, with no damage on this part.',
    changed: 'The dated photo is accepted. The line is approved in full.',
    upheld: 'The photo does not show this part clearly. The decision stands.'},
  worn: {cut: years => 'Actual cash value after ' + years + ' of use.',
    dispute: 'A new one of the same kind costs the full amount today, so the deduction for wear is too high. A price page is attached.',
    evidence: c => 'Web page with today\'s price for the same ' + c.item + '.',
    changed: 'The price page is accepted. The deduction for wear is lowered to 5 percent for each year of use, at most half the price.',
    // The raised value after a changed dispute: 5 percent less for each year of use, and never below half the price.
    raised: (amount, years) => Math.round(Math.round(amount * 100) * Math.max(0.5, 1 - 0.05 * years)) / 100,
    upheld: 'This policy pays the actual cash value of personal property, not the price of a new one. The decision stands.'},
  unproven: {deny: 'No receipt or photo shows that you owned this item.'}
};

// A repair line: text, low and high amount, decision rule, and whether the part can show older damage.
// A hidden-damage line `needs` a line already in the claim that it sits behind.
const L = (text, lo, hi, rule, old = false, needs = null) => ({text, lo, hi, rule, old, needs});
const H = (text, lo, hi, rule, needs) => L(text, lo, hi, rule, false, needs);
const FRONT = [L('Front bumper cover: replace and paint', 700, 1300, 'paint'), L('Headlamp assembly, {side}: replace', 250, 950, 'part', true), L('Hood: repair and paint', 450, 1100, 'paint'),
  L('Grille: replace', 180, 520, 'part'), L('Radiator support: repair', 300, 700, 'labor'), L('Fender, {side} front: replace and paint', 600, 1300, 'paint'),
  L('Front bumper absorber: replace', 90, 260, 'part'), L('Paint materials', 150, 450, 'materials')];
const FRONT_HIDDEN = [H('A/C condenser: replace', 380, 650, 'part', /^(Front bumper cover|Grille|Radiator support)/), H('Radiator: replace', 320, 720, 'part', /^(Front bumper cover|Radiator support)/),
  H('Front bumper reinforcement bar: replace', 250, 500, 'part', /^Front bumper (cover|absorber)/), H('Headlamp mounting brackets: replace', 60, 180, 'part', /^Headlamp assembly/),
  H('Wheel alignment, four wheels', 110, 180, 'fixed', /^Fender/), H('Front radar sensor: recalibrate', 250, 480, 'fixed', /^(Front bumper cover|Grille)/),
  H('Coolant and refrigerant recharge', 120, 260, 'fixed', /^(A\/C condenser|Radiator): replace/)];
const REAR = [L('Rear bumper cover: replace and paint', 650, 1200, 'paint'), L('Tail lamp, {side}: replace', 180, 650, 'part', true), L('Trunk lid: repair and paint', 400, 1000, 'paint'),
  L('Rear body panel: repair', 300, 800, 'labor'), L('Backup camera: replace', 220, 600, 'part'), L('Rear bumper absorber: replace', 90, 240, 'part'), L('Paint materials', 150, 400, 'materials')];
const REAR_HIDDEN = [H('Rear bumper reinforcement bar: replace', 200, 480, 'part', /^Rear bumper (cover|absorber)/), H('Trunk floor pan: repair', 260, 700, 'labor', /^(Trunk lid|Rear body panel)/),
  H('Rear parking sensors: recalibrate', 120, 260, 'fixed', /^Rear bumper cover/), H('Exhaust hanger, bent in the impact: replace', 60, 160, 'part', /^(Rear body panel|Rear bumper cover)/)];
const SIDE = [L('Door shell, {side} front: repair and paint', 500, 1100, 'paint'), L('Door, {side} rear: replace and paint', 900, 1600, 'paint'), L('Mirror, {side}: replace', 120, 480, 'part', true),
  L('Quarter panel, {side}: repair and paint', 700, 1600, 'paint'), L('Rocker molding, {side}: replace', 90, 260, 'part', true), L('Wheel, {side} rear: replace', 250, 650, 'part', true),
  L('Paint materials', 150, 400, 'materials')];
const SIDE_HIDDEN = [H('Door intrusion beam, {side} front: replace', 280, 560, 'part', /^Door shell, \w+ front/), H('Window regulator, {side} front: replace', 160, 380, 'part', /^Door shell, \w+ front/),
  H('Wheel alignment, four wheels', 110, 180, 'fixed', /^(Wheel|Rocker molding), /), H('Side impact sensor, {side}: replace and calibrate', 180, 420, 'part', /^Door/)];

// Personal property items: [text, low, high, kind]. A `worn` item loses value with use, a `kept` item does not, and a `service` line is cleaning, not a bought item.
const ITEMS = {
  burglary: [['Laptop, 14 inch', 650, 1800, 'worn'], ['Tablet', 300, 900, 'worn'], ['Gold necklace', 250, 1200, 'kept'], ['Television, 55 inch', 420, 1100, 'worn'],
    ['Game console with two controllers', 380, 600, 'worn'], ['Camera with one lens', 500, 1400, 'worn'], ['Noise cancelling headphones', 180, 400, 'worn'], ['Watch', 200, 700, 'kept']],
  bike: [['Bicycle, hybrid frame', 450, 1400, 'worn'], ['Bicycle lock', 40, 110, 'kept'], ['Bicycle helmet', 60, 160, 'worn'], ['Pair of panniers', 60, 180, 'worn']],
  car: [['Backpack', 60, 150, 'worn'], ['Laptop, 13 inch', 650, 1600, 'worn'], ['Sunglasses', 120, 260, 'kept'], ['Toolbox with work tools', 200, 900, 'worn'], ['Winter coat', 120, 380, 'worn']],
  water: [['Sofa, three seats', 700, 1800, 'worn'], ['Area rug', 180, 600, 'worn'], ['Queen mattress', 450, 1300, 'worn'], ['Clothes from the closet: dry cleaning', 90, 320, 'service'],
    ['Books and shelves: dry and clean', 120, 420, 'service'], ['Bed frame', 200, 650, 'worn'], ['Desk chair', 90, 300, 'worn'], ['Soundbar', 150, 400, 'worn']],
  fire: [['Microwave', 120, 320, 'worn'], ['Set of dishes and pots', 200, 700, 'worn'], ['Smoke cleaning of clothes and curtains', 250, 900, 'service'], ['Kitchen table with four chairs', 300, 900, 'worn']],
  mold: [['Dresser', 200, 700, 'worn'], ['Clothes and linens in boxes from the closet', 150, 600, 'worn']],
  surge: [['Desktop computer', 700, 1900, 'worn'], ['Monitor, 27 inch', 150, 450, 'worn'], ['Wireless router', 120, 300, 'worn'], ['Television, 50 inch', 380, 900, 'worn']]
};

// Month weights, January to December.
const M = {
  flat: [8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8], winter: [16, 14, 11, 9, 9, 9, 10, 10, 9, 10, 12, 16], ice: [18, 16, 10, 0, 0, 0, 0, 0, 0, 0, 10, 18],
  deer: [6, 3, 3, 3, 5, 6, 5, 6, 8, 18, 22, 14], hail: [0, 0, 0, 6, 12, 16, 16, 12, 6, 0, 0, 0], storm: [6, 5, 9, 8, 6, 8, 10, 9, 8, 6, 7, 6],
  summer: [6, 6, 7, 8, 9, 10, 11, 10, 9, 8, 7, 6], bike: [0, 2, 4, 8, 12, 14, 15, 14, 12, 8, 4, 0], freeze: [20, 18, 0, 0, 0, 0, 0, 0, 0, 0, 0, 14],
  glass: [14, 14, 11, 9, 8, 7, 7, 7, 7, 8, 9, 12], cooking: [10, 8, 7, 6, 6, 6, 6, 6, 6, 8, 12, 14], surge: [0, 0, 0, 8, 10, 14, 16, 14, 9, 4, 0, 0],
  flood: [0, 0, 4, 8, 10, 10, 12, 12, 10, 6, 0, 0]
};
// Approximate local sunset in upstate New York, mid-month, as [hour, minute].
const SUNSET = [[16, 55], [17, 35], [19, 5], [19, 40], [20, 10], [20, 30], [20, 25], [19, 55], [19, 10], [18, 20], [16, 45], [16, 30]];
const HIGHWAYS = ['Route 590', 'Interstate 90', 'Interstate 81', 'Route 104', 'the Thruway', 'Route 31'];

// The loss time rules. `loss` names one of them, and `found` is when the policyholder learns of the loss.
// day: 8:00 to 19:59. commute: 7:00 to 18:59. dusk: around sunset. overnight: 23:00 to 23:59 or 4:00 to 5:59, found the next morning.
// workday: Monday to Friday, 9:00 to 16:29, found that evening. weekend: Saturday 11:00 to Sunday 15:59, found Sunday evening. evening: 17:00 to 20:59.
const SCENARIOS = {
  rear_light: {story: 'repair', policy: 'auto', coverage: 'collision', weight: 7, months: M.winter, loss: 'commute', driver: true, other: true, police: 0.7, area: REAR, hidden: REAR_HIDDEN,
    texts: [w => 'A driver behind ' + w.who + ' did not stop at the light on ' + w.street + ' and hit the back of the car.',
      w => w.who + ' was stopped in traffic on ' + w.street + ' when a pickup truck hit the back of the car.'],
    photos: ['Rear of the car with the damage.', 'The other car and its plate.']},
  front_ice: {story: 'repair', policy: 'auto', coverage: 'collision', weight: 6, months: M.ice, loss: 'commute', driver: true, other: true, police: 0.6, area: FRONT, hidden: FRONT_HIDDEN,
    texts: [w => w.who + ' slid on ice while braking on ' + w.street + ' and hit the car in front.', w => 'On icy pavement on ' + w.street + ', ' + w.who + ' could not stop in time and hit the car ahead.'],
    photos: ['Front of the car with the damage.', 'The icy road where the cars stopped.']},
  side_lane: {story: 'repair', policy: 'auto', coverage: 'collision', weight: 5, months: M.winter, loss: 'commute', driver: true, other: true, police: 0.5, area: SIDE, hidden: SIDE_HIDDEN,
    texts: [w => 'Another car changed lanes into the ' + w.side + ' side of the car on ' + w.street + ' while ' + w.who + ' was driving.',
      w => 'A van merged into the ' + w.side + ' side of the car on ' + w.highway + ' while ' + w.who + ' was driving.'],
    photos: ['The damaged side of the car.', 'The other car and its plate.']},
  side_pillar: {story: 'repair', policy: 'auto', coverage: 'collision', weight: 4, months: M.flat, loss: 'day', driver: true, other: false, police: 0,
    area: [SIDE[0], SIDE[2], SIDE[3], SIDE[4], SIDE[6]], hidden: [H('Paint blend, next panel', 180, 340, 'paint', /: repair and paint$/)],
    texts: [w => w.who + ' backed out of a parking space at a grocery store and hit a concrete pillar with the ' + w.side + ' side of the car.',
      w => w.who + ' scraped the ' + w.side + ' side of the car on a pillar in a parking garage on ' + w.street + '.'],
    photos: ['The damaged side of the car.', 'The pillar in the parking area.']},
  front_turn: {story: 'repair', policy: 'auto', coverage: 'collision', weight: 6, months: M.winter, loss: 'commute', driver: true, other: true, police: 0.8, area: FRONT, hidden: FRONT_HIDDEN,
    texts: [w => 'At a corner on ' + w.street + ', a car turned left in front of ' + w.who + '. The front of our car hit its side.',
      w => 'A car pulled out of a driveway on ' + w.street + ' in front of ' + w.who + '. The front of our car hit it.',
      w => 'A driver ran a stop sign on ' + w.street + '. ' + w.who + ' braked but the front of our car hit the side of the other car.'],
    photos: ['Front of the car with the damage.', 'The other car and its plate.']},
  rear_parked: {story: 'repair', policy: 'auto', coverage: 'collision', weight: 3, months: M.flat, loss: 'day', driver: false, other: true, police: 0.3, area: REAR, hidden: REAR_HIDDEN,
    texts: [w => 'The car was parked on ' + w.street + '. A delivery truck backed into it, and the driver left a note.',
      w => 'The car was parked in a lot on ' + w.street + '. Another driver backed into the rear of it and left a note with a phone number.'],
    photos: ['Rear of the car with the damage.', 'The note that the other driver left.']},
  deer: {story: 'repair', policy: 'auto', coverage: 'comprehensive', weight: 7, months: M.deer, loss: 'dusk', driver: true, other: false, police: 0.2, area: FRONT, hidden: FRONT_HIDDEN,
    texts: [w => 'A deer ran onto the road near ' + w.city + ' at dusk and hit the front of the car.', w => 'A deer jumped from the trees at dusk on a county road outside ' + w.city + '. The front of the car is damaged.',
      w => w.who + ' was driving home at dusk on ' + w.highway + ' when a deer crossed. The front of the car hit it.',
      w => 'Two deer crossed a back road near ' + w.city + ' at dusk. ' + w.who + ' braked, but the car hit the second one.',
      w => 'At dusk on ' + w.street + ' near the park, a deer stepped out between parked cars and ' + w.who + ' hit it with the front of the car.'],
    photos: ['Front of the car with the damage.', 'The road where the deer crossed.']},
  hail: {story: 'repair', policy: 'auto', coverage: 'comprehensive', weight: 4, months: M.hail, loss: 'afternoon', driver: false, other: false, police: 0, source: 'adjuster', count: [1, 3],
    required: [L('Paintless dent repair, hood', 350, 900, 'labor'), L('Paintless dent repair, roof', 600, 1800, 'labor')], area: [L('Paintless dent repair, trunk lid', 250, 650, 'labor'),
      L('Paintless dent repair, left side', 300, 900, 'labor'), L('Paintless dent repair, right side', 300, 900, 'labor'), L('Roof molding: remove and install', 90, 200, 'fixed')], hidden: [],
    texts: [w => 'A hail storm passed over ' + w.city + ' while the car was parked outside. The hood and the roof have many small dents.',
      w => 'Hail the size of marbles fell on ' + w.street + ' for ten minutes. The car was parked on the street and is covered in dents.'],
    photos: ['Hood and roof with many small dents.', 'Hailstones on the street next to the car.']},
  tree: {story: 'repair', policy: 'auto', coverage: 'comprehensive', weight: 3, months: M.storm, loss: 'storm', driver: false, other: false, police: 0,
    required: [L('Roof panel: repair and paint', 800, 2200, 'paint'), L('Windshield: replace', 380, 1100, 'part')],
    area: [L('Roof rail, {side}: replace', 180, 420, 'part'), L('Hood: repair and paint', 450, 1100, 'paint'), L('Paint materials', 150, 400, 'materials')],
    hidden: [H('Headliner, wet from rain through the cracked windshield: replace', 260, 640, 'part', /^Windshield: replace/), H('Windshield rain sensor: replace', 120, 280, 'part', /^Windshield: replace/),
      H('Roof bow: straighten', 180, 420, 'labor', /^Roof panel/)],
    texts: [w => 'A large branch fell on the car during a wind storm on ' + w.street + '. The roof is dented and the windshield is cracked.',
      w => 'A limb from a maple tree broke off in a storm and landed on the car on ' + w.street + '. It dented the roof and cracked the windshield.'],
    photos: ['The branch on the roof of the car.', 'The cracked windshield.']},
  vandal: {story: 'repair', policy: 'auto', coverage: 'comprehensive', weight: 3, months: M.summer, loss: 'overnight', driver: false, other: false, police: 1, parked: true, rental: false,
    required: [L('Key scratches, {side} side: refinish two doors', 600, 1400, 'paint'), L('Side window glass, {side} rear: replace', 220, 450, 'part')],
    area: [L('Glass cleanup inside the car', 80, 160, 'labor'), L('Paint materials', 150, 300, 'materials')],
    hidden: [H('Door trim panel, {side} rear, cut by the broken glass: replace', 140, 320, 'part', /^Side window glass/)],
    texts: [w => 'Someone scratched the ' + w.side + ' side of the car and broke a rear window overnight on ' + w.street + '. Nothing was taken.',
      w => 'Overnight on ' + w.street + ', someone keyed the ' + w.side + ' doors of the car and smashed the rear side window.',
      w => 'When I came out to the car, the ' + w.side + ' side was scratched and a rear window was broken. It was parked overnight on ' + w.street + '.',
      w => 'The car was vandalized overnight in the lot behind our building on ' + w.street + ': deep scratches on the ' + w.side + ' doors and a broken rear window.'],
    photos: ['Long scratches on two doors.', 'The broken rear side window.']},
  converter: {story: 'repair', policy: 'auto', coverage: 'comprehensive', weight: 3, months: M.flat, loss: 'overnight', driver: false, other: false, police: 1, parked: true,
    required: [L('Catalytic converter: replace', 1300, 3200, 'part')],
    area: [L('Exhaust pipe section: replace', 200, 600, 'part'), L('Oxygen sensor: replace', 120, 320, 'part'), L('Exhaust labor', 250, 600, 'labor')], hidden: [],
    texts: [w => 'The catalytic converter was cut from under the car overnight on ' + w.street + '. The car is very loud when it starts.',
      w => 'Overnight, someone sawed the catalytic converter off the car while it was parked on ' + w.street + '.'],
    photos: ['Cut exhaust pipe under the car.', 'Metal shavings on the ground under the car.']},
  glass: {story: 'glass', policy: 'auto', coverage: 'comprehensive', weight: 9, months: M.glass, loss: 'day', driver: false,
    required: [L('Windshield: replace', 320, 1150, 'part')], area: [L('Front camera calibration after the glass work', 150, 380, 'fixed'), L('Windshield molding: replace', 40, 120, 'part')],
    texts: [w => 'A stone from a truck on ' + w.highway + ' cracked the windshield.', w => 'A chip in the windshield from ' + w.highway + ' spread into a long crack on the driver side.',
      w => 'Gravel thrown up by a dump truck on ' + w.street + ' cracked the windshield.', w => 'A stone thrown by a lawn mower in a parking lot in ' + w.city + ' cracked the windshield.',
      w => 'A rock from a construction site on ' + w.street + ' hit the windshield and cracked it.', w => 'A small chip from a stone on ' + w.street + ' turned into a crack across the windshield.'],
    photos: ['The crack in the windshield.']},
  scrape: {story: 'underDeductible', policy: 'auto', coverage: 'collision', weight: 3, months: M.flat, loss: 'day', driver: true,
    required: [L('Rear bumper cover: repair and paint', 200, 1000, 'paint'), L('Paint materials', 40, 200, 'materials')],
    texts: [w => w.who + ' scraped the ' + w.side + ' rear bumper on a post in a parking garage.', w => w.who + ' backed into a low wall at a store on ' + w.street + ' and scraped the rear bumper.'],
    photos: ['Scrape on the rear bumper.']},
  total_collision: {story: 'total', policy: 'auto', coverage: 'collision', weight: 5, months: M.winter, loss: 'commute', driver: true, police: 1,
    required: [L('Frame and unibody repair', 2500, 6000, 'labor'), L('Airbag modules and seat belts: replace', 1800, 3800, 'part')], area: [...FRONT.slice(0, 6), SIDE[0], SIDE[3]],
    texts: [w => w.who + ' lost control on wet pavement on ' + w.street + ' and hit a guard rail. The car was towed, and the airbags opened.',
      w => 'A truck ran a red light on ' + w.street + ' and hit the ' + w.side + ' side of the car. The car was towed from the scene.'],
    photos: ['The car at the tow yard after the crash.', 'The inside of the car with the airbags open.']},
  total_flood: {story: 'total', policy: 'auto', coverage: 'comprehensive', weight: 2, months: M.flood, loss: 'storm', driver: false, police: 0,
    required: [L('Interior: replace seats, carpet and wiring', 3000, 7000, 'part'), L('Engine: remove and inspect after water entry', 1800, 4200, 'labor')],
    area: [L('Electrical modules: replace', 1500, 4000, 'part'), L('Transmission fluid and filters: flush after water entry', 300, 700, 'labor')],
    texts: [w => 'Heavy rain flooded ' + w.street + ' where the car was parked. Water came up over the seats.', w => 'A flash flood filled the parking lot on ' + w.street + '. The water reached the dashboard of the car.'],
    photos: ['The car in the water on the street.', 'Mud and water on the seats and the floor.']},
  total_tree: {story: 'total', policy: 'auto', coverage: 'comprehensive', weight: 2, months: M.storm, loss: 'storm', driver: false, police: 0,
    required: [L('Roof panel and pillars: replace', 3500, 7500, 'part'), L('Windshield: replace', 380, 1100, 'part')],
    area: [L('Hood: repair and paint', 450, 1100, 'paint'), L('Headliner: replace', 260, 640, 'part'), L('Door frames, both sides: straighten', 900, 2200, 'labor')],
    texts: [w => 'A tree fell on the car during a storm on ' + w.street + '. The roof is crushed.', w => 'A large oak came down in high wind on ' + w.street + ' and crushed the roof of the car.'],
    photos: ['The tree on the crushed roof.', 'The inside of the car under the crushed roof.']},
  total_stolen: {story: 'total', policy: 'auto', coverage: 'comprehensive', weight: 2, months: M.flat, loss: 'overnight', driver: false, police: 1, stolen: true,
    required: [L('Engine compartment fire damage: replace wiring and components', 3000, 6500, 'part'), L('Interior: replace seats and dashboard after fire', 2500, 6000, 'part')],
    area: [L('Front fenders and bumper, burned: replace', 900, 2200, 'part'), L('Wheels and tires, burned: replace', 700, 1600, 'part')],
    texts: [w => 'The car was stolen overnight from ' + w.street + '.'], found: w => ' The police found it ' + w.days + ' later, burned.',
    photos: ['The burned car where the police found it.', 'The burned engine compartment.']},
  delivery: {story: 'denied', policy: 'auto', coverage: 'collision', weight: 1.5, months: M.flat, loss: 'evening', driver: true, area: FRONT,
    texts: [w => w.who + ' hit a pole while turning in a narrow lot behind the restaurants on ' + w.street + '.'], photos: ['The damaged front corner.'],
    ask: {use: 'The lot is a pickup lane for delivery drivers. What was the car used for at the time of the loss?'},
    answer: w => w.who + ' drives for a delivery app, but had ended the shift and stopped to pick up dinner.',
    denial: {deny: 'The loss happened during paid delivery use, which the policy excludes.',
      dispute: w => 'As my answer said, ' + w.who + ' had ended the delivery shift before entering the lot. The app log is attached.',
      evidence: () => 'Delivery app log for the day of the loss.',
      upheld: 'The app log shows that an order was accepted 6 minutes before the loss. The decision stands.'}},
  mold: {story: 'denied', policy: 'renters', weight: 2, months: M.flat, loss: 'day', pool: 'mold',
    texts: [() => 'I found mold on the back of the dresser and on the boxes in the closet. The wall behind them is wet.'], photos: ['Mold on the back of the dresser.'],
    ask: {cause: 'How long has the wall been wet, and what does the building manager say about the cause?'},
    answer: () => 'The building manager says a pipe in the wall has leaked slowly for some months.',
    denial: {deny: 'Mold and damage from a slow leak over months are not covered.',
      dispute: () => 'The leak was hidden in the wall. I could not see it.', evidence: () => 'Statement about when the mold was found.',
      upheld: 'The policy excludes damage from a leak that went on for months, seen or not. The decision stands.'}},
  parked_note: {story: 'withdrawn', policy: 'auto', coverage: 'collision', weight: 2, months: M.flat, loss: 'day', driver: false,
    texts: [w => 'Another car hit our parked car on ' + w.street + ', and the driver gave us a note with her insurance.'], photos: ['The dent in the door.'],
    ask: {other_party: 'The name and the insurer of the other driver.'}},
  cart: {story: 'withdrawn', policy: 'auto', coverage: 'collision', weight: 1, months: M.flat, loss: 'day', driver: false,
    texts: [w => 'A shopping cart rolled into the ' + w.side + ' side of the car in a store lot on ' + w.street + '.'], photos: ['The dent from the cart.']},
  ring: {story: 'withdrawn', policy: 'renters', weight: 1.5, months: M.flat, loss: 'evening',
    texts: [() => 'My ring is missing. I think it was taken during a party at the apartment.'], photos: ['The ring in a photo from last year.'], photoDaysBefore: [330, 400],
    ask: {items: 'A description of the ring and the year you bought it.'}},
  package: {story: 'noResponse', policy: 'renters', weight: 3, months: M.cooking, loss: 'workday',
    texts: [() => 'A package with a new phone was taken from the lobby of the building.', () => 'A delivered package with a new tablet was taken from the front step of the building.']},
  burglary_work: {story: 'renters', policy: 'renters', weight: 4, months: M.summer, loss: 'workday', police: 1, pool: 'burglary', count: [2, 4],
    texts: [w => 'Someone broke the lock of the apartment door while we were at work and took ' + w.items + '.'], photos: ['The broken lock of the door.']},
  burglary_weekend: {story: 'renters', policy: 'renters', weight: 2, months: M.summer, loss: 'weekend', police: 1, pool: 'burglary', count: [2, 4],
    texts: [w => 'While we were away for the weekend, someone forced the back window of the apartment and took ' + w.items + '.'], photos: ['The forced back window.']},
  bike: {story: 'renters', policy: 'renters', weight: 6, months: M.bike, loss: 'overnight', police: 1, pool: 'bike', count: [1, 3], required: ['Bicycle, hybrid frame'], shown: ['Bicycle lock'],
    texts: [() => 'My bicycle was stolen overnight from the locked bike room of the building. The lock was cut.'], photos: ['The cut lock on the floor of the bike room.']},
  car_breakin: {story: 'renters', policy: 'renters', weight: 4, months: M.summer, loss: 'overnight', police: 1, pool: 'car', count: [2, 4],
    texts: [w => 'Someone broke a window of my car overnight and took ' + w.items + '.', w => 'My car was broken into overnight while it was parked on the street. The thief took ' + w.items + '.'],
    photos: ['The broken car window.']},
  water_above: {story: 'renters', policy: 'renters', weight: 4, months: M.flat, loss: 'day', pool: 'water', count: [2, 5], restorer: true,
    texts: [() => 'Water came through the ceiling from the apartment above and soaked the living room.'], photos: ['Water damage in the room.'], report: 'Note from the building manager about the leak in the unit above.'},
  pipe_freeze: {story: 'renters', policy: 'renters', weight: 3, months: M.freeze, loss: 'overnight', pool: 'water', count: [2, 5], restorer: true,
    texts: [() => 'A pipe froze and burst overnight in the wall of the bedroom. Water soaked the floor and the furniture.'], photos: ['Water on the bedroom floor.'], report: 'Note from the building manager about the frozen pipe.'},
  washer: {story: 'renters', policy: 'renters', weight: 2, months: M.flat, loss: 'day', pool: 'water', count: [2, 4], restorer: true,
    texts: [() => 'The washing machine hose split and water covered the floor of two rooms.'], photos: ['Water on the floor of two rooms.'], report: 'Note from the building manager about the split washer hose.'},
  kitchen_fire: {story: 'renters', policy: 'renters', weight: 2, months: M.cooking, loss: 'evening', pool: 'fire', count: [2, 4], restorer: true,
    texts: [() => 'A pan caught fire on the stove. The fire was put out, but smoke filled the kitchen and the living room.'], photos: ['Smoke stains on the kitchen wall.']},
  surge: {story: 'renters', policy: 'renters', weight: 2, months: M.surge, loss: 'storm', pool: 'surge', count: [2, 4],
    texts: [() => 'A power surge during a thunderstorm damaged electronics that were plugged in.', () => 'Lightning hit a pole near the building. The surge damaged the electronics in the apartment.',
      () => 'The power went out and came back with a surge during a storm. Several devices stopped working.'], photos: ['The damaged electronics on the desk.']}
};

// A regular expression for the stored text of a line made from a template.
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const lineRegex = text => new RegExp('^' + escape(text).replace('\\{side\\}', '(left|right)') + '(, bought \\d+ years? ago)?$');
module.exports = {DECISIONS, SCENARIOS, ITEMS, SUNSET, HIGHWAYS, lineRegex};
