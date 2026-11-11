// Room rules. Add a rule by appending to RULES — the server validates against it
// and the client's room-setup page renders it automatically.
//
//   key          property name in state.settings
//   type         'choice' (pick one of `options`) | 'toggle' (boolean)
//   modes        optional: only applies to these game modes (hidden otherwise)
//   when         optional: (settings) => boolean — only shown when this holds
//   group        heading on the setup page

const opt = (value, label, description) => ({ value, label, description });

export const RULES = [
  {
    key: 'mode',
    group: 'Mode',
    label: 'Game mode',
    type: 'choice',
    default: 'classic',
    options: [
      opt('classic', 'Classic', 'One player rolls at a time, in order.'),
      opt('party', 'Party', 'Everyone rolls at the same time each turn. Ready up, roll together, race for streets.'),
    ],
  },
  {
    key: 'startingMoney',
    group: 'Money',
    label: 'Starting money',
    type: 'choice',
    default: 1500,
    options: [1000, 1500, 2000, 2500].map((v) => opt(v, `$${v}`)),
  },
  {
    key: 'startSalary',
    group: 'Money',
    label: 'Start salary',
    description: 'Collected every time you pass Start.',
    type: 'choice',
    default: 200,
    options: [100, 200, 300, 400].map((v) => opt(v, `$${v}`)),
  },
  {
    key: 'doubleOnStart',
    group: 'House rules',
    label: 'Landing on Start pays double',
    type: 'toggle',
    default: false,
  },
  {
    key: 'jackpot',
    group: 'House rules',
    label: 'Harbor Rest jackpot',
    description: 'Taxes, fines and bail go into a pot. Land on Harbor Rest to collect it.',
    type: 'toggle',
    default: false,
  },
  {
    key: 'auctions',
    group: 'Auctions',
    label: 'Auction passed streets',
    description: 'When a player passes on a street, everyone else can bid for it. (Players who land on the same street in Party always settle it with an auction.)',
    type: 'toggle',
    default: true,
  },
  {
    key: 'auctionFormat',
    group: 'Auctions',
    label: 'Auction style',
    type: 'choice',
    default: 'live',
    options: [
      opt('live', 'Live bidding', 'Open, rising bids; a short countdown restarts on every bid.'),
      opt('sealed', 'Sealed (3 waves)', 'Secret bids. Top 3 advance, then top 2, then the highest bid wins.'),
    ],
  },
  {
    key: 'liveBidTime',
    group: 'Auctions',
    when: (s) => s.auctionFormat === 'live',
    label: 'Bid countdown',
    description: 'Seconds without a new bid before the auction closes.',
    type: 'choice',
    default: 6,
    options: [4, 6, 10].map((v) => opt(v, `${v}s`)),
  },
  {
    key: 'maxTurns',
    group: 'Game length',
    label: 'Turn limit',
    description: 'After this many turns, the richest player wins (cash + property + buildings).',
    type: 'choice',
    default: 0,
    options: [opt(0, 'None'), ...[20, 30, 50, 75].map((v) => opt(v, `${v} turns`))],
  },
  {
    key: 'timeLimit',
    group: 'Game length',
    label: 'Time limit',
    description: 'When time runs out, the richest player wins.',
    type: 'choice',
    default: 0,
    options: [opt(0, 'None'), ...[10, 20, 30, 45].map((v) => opt(v, `${v} min`))],
  },
  {
    key: 'turnTimer',
    group: 'Pace',
    label: 'Turn timer',
    description: 'When it runs out, open decisions take their default (pass on buying, roll in Lockup) and players are readied.',
    type: 'choice',
    default: 0,
    options: [opt(0, 'None'), ...[30, 60, 90, 120].map((v) => opt(v, `${v}s`))],
  },
];

export const DEFAULT_SETTINGS = Object.fromEntries(RULES.map((r) => [r.key, r.default]));

/** Merge `patch` into `base`, dropping unknown keys and invalid values. */
export function sanitizeSettings(patch = {}, base = DEFAULT_SETTINGS) {
  const out = { ...DEFAULT_SETTINGS, ...base };
  for (const rule of RULES) {
    if (!(rule.key in patch)) continue;
    const v = patch[rule.key];
    if (rule.type === 'toggle' && typeof v === 'boolean') out[rule.key] = v;
    if (rule.type === 'choice' && rule.options.some((o) => o.value === v)) out[rule.key] = v;
  }
  return out;
}

/** Whether a rule is relevant (and shown) under the current settings. */
export const ruleApplies = (rule, settings) =>
  (!rule.modes || rule.modes.includes(settings.mode)) && (!rule.when || rule.when(settings));
