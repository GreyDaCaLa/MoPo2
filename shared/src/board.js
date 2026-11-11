// Board definition for MoPo — "Port Mopo", an original harbor-city theme.
// 40 spaces, laid out clockwise starting at the bottom-right corner.

export const START_SALARY = 200;
export const STARTING_MONEY = 1500;
export const BAIL = 50;
export const JAIL_INDEX = 10;
export const MAX_PLAYERS = 6;

export const GROUPS = {
  dockside: { name: 'Dockside', color: '#8d5a3b' },
  oldquarter: { name: 'Old Quarter', color: '#7fc8e8' },
  arts: { name: 'Arts District', color: '#d9479b' },
  market: { name: 'Market', color: '#f08a24' },
  theatre: { name: 'Theatre Row', color: '#d7263d' },
  garden: { name: 'Garden Ward', color: '#f2c230' },
  university: { name: 'University Hill', color: '#2e9e5b' },
  heights: { name: 'The Heights', color: '#2b4cc4' },
  transit: { name: 'Transit', color: '#333333' },
  utility: { name: 'Utility', color: '#888888' },
};

// Rent for a street: [base, 1 house, 2, 3, 4, hotel]
function streetRent(price) {
  const base = Math.max(2, Math.round((price * 0.07) / 2) * 2);
  const r5 = (n) => Math.round(n / 5) * 5;
  return [base, r5(base * 5), r5(base * 15), r5(base * 40), r5(base * 55), r5(base * 70)];
}

const HOUSE_COST_BY_SIDE = [50, 100, 150, 200];

function street(index, name, group, price) {
  return {
    index,
    type: 'street',
    name,
    group,
    price,
    rent: streetRent(price),
    houseCost: HOUSE_COST_BY_SIDE[Math.floor(index / 10)],
  };
}
const transit = (index, name) => ({ index, type: 'transit', name, group: 'transit', price: 200 });
const utility = (index, name) => ({ index, type: 'utility', name, group: 'utility', price: 150 });
const tax = (index, name, amount) => ({ index, type: 'tax', name, amount });
const card = (index, deck) => ({ index, type: 'card', deck, name: deck === 'fortune' ? 'Fortune' : 'City Hall' });

export const SPACES = [
  { index: 0, type: 'start', name: 'Start' },
  street(1, 'Rope Walk', 'dockside', 60),
  card(2, 'cityhall'),
  street(3, 'Net Mender Row', 'dockside', 60),
  tax(4, 'City Levy', 200),
  transit(5, 'North Ferry'),
  street(6, 'Lantern Alley', 'oldquarter', 100),
  card(7, 'fortune'),
  street(8, 'Cobble Court', 'oldquarter', 100),
  street(9, 'Clocktower Square', 'oldquarter', 120),

  { index: 10, type: 'jail', name: 'Lockup' },
  street(11, 'Mural Mile', 'arts', 140),
  utility(12, 'Tidal Power Co.'),
  street(13, 'Gallery Steps', 'arts', 140),
  street(14, 'Kiln Street', 'arts', 160),
  transit(15, 'Tram Line 2'),
  street(16, 'Spice Bazaar', 'market', 180),
  card(17, 'cityhall'),
  street(18, 'Fishmonger Way', 'market', 180),
  street(19, 'Copper Kettle Lane', 'market', 200),

  { index: 20, type: 'rest', name: 'Harbor Rest' },
  street(21, 'Velvet Curtain Ave', 'theatre', 220),
  card(22, 'fortune'),
  street(23, 'Encore Boulevard', 'theatre', 220),
  street(24, 'Marquee Place', 'theatre', 240),
  transit(25, 'Cable Car'),
  street(26, 'Orchid Terrace', 'garden', 260),
  street(27, 'Hedge Maze Road', 'garden', 260),
  utility(28, 'Rainwater Works'),
  street(29, 'Fountain Plaza', 'garden', 280),

  { index: 30, type: 'gotojail', name: 'Busted!' },
  street(31, "Scholar's Walk", 'university', 300),
  street(32, 'Observatory Rise', 'university', 300),
  card(33, 'cityhall'),
  street(34, 'Archive Hill', 'university', 320),
  transit(35, 'Airport Shuttle'),
  card(36, 'fortune'),
  street(37, 'Skyline Crest', 'heights', 350),
  tax(38, 'Luxury Levy', 100),
  street(39, 'Summit Gardens', 'heights', 400),
];

export const OWNABLE = SPACES.filter((s) => s.price != null).map((s) => s.index);

export function groupMembers(group) {
  return SPACES.filter((s) => s.group === group).map((s) => s.index);
}

// Card decks. Effects are interpreted by the engine.
export const CARDS = {
  fortune: [
    { text: 'Catch the express ferry — advance to Start.', effect: { type: 'moveTo', to: 0 } },
    { text: 'Front-row seats! Advance to Marquee Place.', effect: { type: 'moveTo', to: 24 } },
    { text: 'Gallery opening tonight. Advance to Mural Mile.', effect: { type: 'moveTo', to: 11 } },
    { text: 'Hop on the nearest transit line.', effect: { type: 'moveNearest', kind: 'transit' } },
    { text: 'Your side hustle pays off. Collect $50.', effect: { type: 'money', amount: 50 } },
    { text: 'A friend at the precinct owes you one. Get out of Lockup free.', effect: { type: 'jailCard' } },
    { text: 'Wrong turn — go back 3 spaces.', effect: { type: 'moveBy', amount: -3 } },
    { text: 'Caught jaywalking. Go directly to Lockup.', effect: { type: 'gotoJail' } },
    { text: 'Storm damage: pay $25 per house and $100 per hotel.', effect: { type: 'repairs', house: 25, hotel: 100 } },
    { text: 'Parking ticket. Pay $15.', effect: { type: 'money', amount: -15 } },
    { text: 'Take the North Ferry for a day trip.', effect: { type: 'moveTo', to: 5 } },
    { text: 'Penthouse viewing at Summit Gardens. Advance there.', effect: { type: 'moveTo', to: 39 } },
    { text: 'You were voted harbor captain. Pay each player $50.', effect: { type: 'payEach', amount: 50 } },
    { text: 'Your startup got funded. Collect $150.', effect: { type: 'money', amount: 150 } },
  ],
  cityhall: [
    { text: 'Ribbon-cutting ceremony at Start. Advance to Start.', effect: { type: 'moveTo', to: 0 } },
    { text: 'City clerk error in your favor. Collect $200.', effect: { type: 'money', amount: 200 } },
    { text: 'Permit fees. Pay $50.', effect: { type: 'money', amount: -50 } },
    { text: 'You sold your vintage bike. Collect $50.', effect: { type: 'money', amount: 50 } },
    { text: 'Community service pardon. Get out of Lockup free.', effect: { type: 'jailCard' } },
    { text: 'Unpaid fines caught up with you. Go directly to Lockup.', effect: { type: 'gotoJail' } },
    { text: 'Block party! Collect $10 from every player.', effect: { type: 'collectEach', amount: 10 } },
    { text: 'Tax refund. Collect $100.', effect: { type: 'money', amount: 100 } },
    { text: 'Clinic visit. Pay $100.', effect: { type: 'money', amount: -100 } },
    { text: 'Library late fees refunded. Collect $20.', effect: { type: 'money', amount: 20 } },
    { text: 'Consulting gig at City Hall. Collect $25.', effect: { type: 'money', amount: 25 } },
    { text: 'Street resurfacing: pay $40 per house and $115 per hotel.', effect: { type: 'repairs', house: 40, hotel: 115 } },
    { text: 'You won second prize in the chili cook-off. Collect $10.', effect: { type: 'money', amount: 10 } },
    { text: 'Inheritance from a distant aunt. Collect $100.', effect: { type: 'money', amount: 100 } },
    { text: 'School fundraiser. Pay $50.', effect: { type: 'money', amount: -50 } },
  ],
};

// Players pick a unique color and token in the room lobby.
export const PLAYER_COLORS = [
  '#e63946', // red
  '#f4a261', // orange
  '#f6d32d', // yellow
  '#90be6d', // lime
  '#2a9d8f', // teal
  '#118ab2', // blue
  '#7b2cbf', // purple
  '#ff70a6', // pink
  '#f1faee', // white
  '#3d3d3d', // charcoal
];

// Token ids map to procedural models in client/src/three/TokenModel.jsx.
export const TOKENS = [
  { id: 'lighthouse', name: 'Lighthouse' },
  { id: 'boat', name: 'Sailboat' },
  { id: 'anchor', name: 'Anchor' },
  { id: 'rocket', name: 'Rocket' },
  { id: 'tree', name: 'Pine Tree' },
  { id: 'mug', name: 'Coffee Mug' },
  { id: 'diamond', name: 'Gem' },
  { id: 'pawn', name: 'Pawn' },
];
export const TOKEN_IDS = TOKENS.map((t) => t.id);
