// Bot players. Bots are ordinary seats with `player.bot = { difficulty }`.
// `decideBotAction` is pure: given the state it returns the next action the
// bot wants to take (or null to wait). The server applies it after a short
// "thinking" delay from `botDelay`, so bots obey exactly the same rules as people.
import { SPACES, OWNABLE, groupMembers, BAIL } from './board.js';
import { computeRent, raisableValue, waitingOn, addPlayer, removePlayer, GameError, LIVE_MIN_BID } from './engine.js';

export const BOT_DIFFICULTIES = [
  { id: 'easy', name: 'Easy', description: 'Buys on impulse, rarely builds.' },
  { id: 'medium', name: 'Medium', description: 'Keeps a cash cushion and builds steadily.' },
  { id: 'hard', name: 'Hard', description: 'Values sets, blocks rivals, reacts fast.' },
];
export const BOT_DIFFICULTY_IDS = BOT_DIFFICULTIES.map((d) => d.id);

export const BOT_NAMES = [
  'Captain Brine', 'Madam Ledger', 'Old Tollbooth', 'Dockhand Dot',
  'Professor Quay', 'Baroness Bollard', 'Skipper Coin', 'Inspector Gull',
];

// Best-value groups to develop first (cheap houses, frequently landed on).
const BUILD_PRIORITY = ['market', 'theatre', 'oldquarter', 'arts', 'garden', 'heights', 'university', 'dockside'];

const ownedBy = (s, id) => OWNABLE.filter((i) => s.properties[i].owner === id);
const ownsGroup = (s, id, group) => groupMembers(group).every((i) => s.properties[i].owner === id);
const unownedCount = (s) => OWNABLE.filter((i) => !s.properties[i].owner).length;

/** Highest rent an opponent could charge right now (dice ~7 for utilities). */
function dangerRent(s, me) {
  let max = 0;
  for (const i of OWNABLE) {
    const owner = s.properties[i].owner;
    if (owner && owner !== me.id) max = Math.max(max, computeRent(s, i, 7));
  }
  return max;
}

/** Cash a bot tries to keep on hand. */
function reserve(s, me, diff) {
  if (diff === 'easy') return 0;
  if (diff === 'medium') return 150;
  return Math.min(600, Math.max(100, Math.round(dangerRent(s, me) * 0.8)));
}

// ---------------------------------------------------------------- prompts

function decideBuy(s, me, index, diff, rng) {
  const space = SPACES[index];
  const left = me.money - space.price;
  if (left < 0) return 'pass';
  if (diff === 'easy') return rng() < 0.8 ? 'buy' : 'pass';
  const keep = reserve(s, me, diff);
  if (diff === 'medium') return left >= keep ? 'buy' : 'pass';

  // hard: early on, owning property is everything — buy almost anything.
  if (unownedCount(s) >= 12) return left >= (space.type === 'utility' ? 150 : 60) ? 'buy' : 'pass';
  const others = groupMembers(space.group).filter((i) => i !== index);
  const completes = others.every((i) => s.properties[i].owner === me.id);
  const rivalOwners = new Set(others.map((i) => s.properties[i].owner).filter((o) => o && o !== me.id));
  const blocks = rivalOwners.size === 1 && others.every((i) => s.properties[i].owner && s.properties[i].owner !== me.id);
  if (space.type === 'street' && completes) return left >= keep * 0.3 ? 'buy' : 'pass';
  if (blocks) return left >= keep * 0.5 ? 'buy' : 'pass';
  if (space.type === 'transit') return left >= keep * 0.7 ? 'buy' : 'pass';
  if (space.type === 'utility') return left >= keep * 1.5 ? 'buy' : 'pass';
  return left >= keep ? 'buy' : 'pass';
}

function decideJail(s, me, diff, rng) {
  const hasCard = me.jailCards.length > 0;
  const canBail = me.money >= BAIL;
  if (diff === 'easy') {
    if (rng() < 0.5) return 'roll';
    return hasCard ? 'card' : canBail ? 'bail' : 'roll';
  }
  if (diff === 'medium') {
    if (hasCard) return 'card';
    return me.money >= BAIL + 200 ? 'bail' : 'roll';
  }
  // hard: get out while there's still property to buy; later, Lockup is a safe place to sit.
  const early = unownedCount(s) >= 8;
  if (!early) return 'roll';
  if (hasCard) return 'card';
  return canBail && me.money - BAIL >= reserve(s, me, diff) * 0.5 ? 'bail' : 'roll';
}

// ---------------------------------------------------------------- auctions

/** What a street is worth to this bot. Never peeks at other players' sealed bids. */
function valuation(s, me, index, diff, rng) {
  const space = SPACES[index];
  if (diff === 'easy') return space.price * (0.5 + rng() * 0.6);
  if (diff === 'medium') return space.price * 0.9;
  const others = groupMembers(space.group).filter((i) => i !== index);
  const completes = others.every((i) => s.properties[i].owner === me.id);
  const rivals = new Set(others.map((i) => s.properties[i].owner).filter((o) => o && o !== me.id));
  const blocks = rivals.size === 1 && others.every((i) => s.properties[i].owner && s.properties[i].owner !== me.id);
  if (space.type === 'utility') return space.price * 0.6;
  if (space.type === 'street' && completes) return space.price * 1.5;
  if (blocks) return space.price * 1.25;
  if (space.type === 'transit') return space.price;
  return space.price * (unownedCount(s) >= 12 ? 1 : 0.85);
}

function decideAuction(s, me, auction, diff, rng) {
  const keep = diff === 'easy' ? 0 : diff === 'medium' ? 100 : Math.round(reserve(s, me, diff) * 0.5);
  const cap = Math.floor(Math.min(valuation(s, me, auction.index, diff, rng), me.money - keep));

  if (auction.format === 'live') {
    if (auction.highBidder === me.id) return null; // winning — wait
    const step = Math.max(10, Math.round((SPACES[auction.index].price * 0.05) / 5) * 5);
    const next = Math.max(LIVE_MIN_BID, auction.highBid + (auction.highBid ? step : 0));
    return next <= cap ? { bid: next } : 'pass';
  }

  // sealed: shade early waves, bid closer to true value later
  const shade = { easy: 1, medium: auction.wave === 1 ? 0.8 : 0.9, hard: auction.wave === 1 ? 0.85 : 1 }[diff];
  const amount = Math.floor(cap * shade);
  return amount >= 1 ? { bid: amount } : 'pass';
}

// ---------------------------------------------------------------- actions

/** Next step toward paying off a debt: sell a building, else mortgage something. */
function raiseMoney(s, me, diff) {
  const mine = ownedBy(s, me.id);
  // Sell buildings (must sell evenly: only from the most-built street in a group).
  const sellable = mine.filter((i) => {
    const houses = s.properties[i].houses;
    if (!houses) return false;
    return houses === Math.max(...groupMembers(SPACES[i].group).map((j) => s.properties[j].houses));
  });
  if (sellable.length) {
    if (diff !== 'easy') sellable.sort((a, b) => SPACES[a].houseCost - SPACES[b].houseCost);
    return { type: 'sellHouse', index: sellable[0] };
  }
  const mortgageable = mine.filter((i) => {
    if (s.properties[i].mortgaged) return false;
    return groupMembers(SPACES[i].group).every((j) => !s.properties[j].houses);
  });
  if (!mortgageable.length) return null;
  if (diff !== 'easy') {
    // Keep complete sets as long as possible; give up cheap stragglers first.
    const score = (i) => (ownsGroup(s, me.id, SPACES[i].group) ? 10_000 : 0) + SPACES[i].price;
    mortgageable.sort((a, b) => score(a) - score(b));
  }
  return { type: 'mortgage', index: mortgageable[0] };
}

function maybeBuild(s, me, diff, rng) {
  if (diff === 'easy' && (me.money < 400 || rng() > 0.3)) return null;
  // Houses earn rent; hard bots develop aggressively instead of hoarding cash.
  const keep = diff === 'hard' ? Math.min(reserve(s, me, diff), 150) : reserve(s, me, diff);
  const candidates = ownedBy(s, me.id).filter((i) => {
    const space = SPACES[i];
    if (space.type !== 'street') return false;
    const group = groupMembers(space.group);
    if (!ownsGroup(s, me.id, space.group)) return false;
    if (group.some((j) => s.properties[j].mortgaged)) return false;
    const houses = s.properties[i].houses;
    if (houses >= 5) return false;
    if (houses > Math.min(...group.map((j) => s.properties[j].houses))) return false;
    return me.money - space.houseCost >= keep;
  });
  if (!candidates.length) return null;
  if (diff === 'hard') {
    const rank = (i) => s.properties[i].houses * 100 + BUILD_PRIORITY.indexOf(SPACES[i].group);
    candidates.sort((a, b) => rank(a) - rank(b));
  }
  return { type: 'build', index: candidates[0] };
}

function maybeUnmortgage(s, me, diff) {
  if (diff === 'easy') return null;
  const keep = reserve(s, me, diff);
  const options = ownedBy(s, me.id)
    .filter((i) => s.properties[i].mortgaged)
    .filter((i) => me.money - Math.ceil((SPACES[i].price / 2) * 1.1) >= keep * 2 + 100);
  if (!options.length) return null;
  if (diff === 'hard') options.sort((a, b) => Number(ownsGroup(s, me.id, SPACES[b].group)) - Number(ownsGroup(s, me.id, SPACES[a].group)));
  return { type: 'unmortgage', index: options[0] };
}

// ---------------------------------------------------------------- entry points

/** The next action this bot wants to take, or null to wait. */
export function decideBotAction(s, botId, rng = Math.random) {
  if (s.phase !== 'playing') return null;
  const me = s.players.find((p) => p.id === botId);
  if (!me?.bot || me.bankrupt) return null;
  const diff = me.bot.difficulty;

  // Landing decisions first; the Lockup choice (which also readies) comes last.
  const myPrompts = s.prompts.filter((p) => p.player === me.id).sort((x, y) => (x.kind === 'jail') - (y.kind === 'jail'));
  for (const prompt of myPrompts) {
    if (prompt.kind === 'jail' && myPrompts.length > 1) continue; // settle the rest first
    let choice = 'ok';
    if (prompt.kind === 'buy') choice = decideBuy(s, me, prompt.data.index, diff, rng);
    else if (prompt.kind === 'jail') choice = decideJail(s, me, diff, rng);
    else if (prompt.kind === 'auction') {
      const auction = s.auctions.find((a) => a.id === prompt.data.auctionId);
      choice = auction ? decideAuction(s, me, auction, diff, rng) : null;
    }
    if (choice != null) return { type: 'answer', promptId: prompt.id, choice };
  }
  if (myPrompts.length) return null; // e.g. holding the high bid: just wait

  if (me.money < 0) return raisableValue(s, me.id) >= 0 ? raiseMoney(s, me, diff) : null;

  const build = maybeBuild(s, me, diff, rng);
  if (build) return build;
  const unmortgage = maybeUnmortgage(s, me, diff);
  if (unmortgage) return unmortgage;

  if (waitingOn(s).includes(me.id)) return { type: 'ready' };
  return null;
}

/** "Thinking" time in ms before a bot acts. Hard bots react fastest (matters in Party races). */
export function botDelay(difficulty, action, rng = Math.random) {
  const base = { easy: 1300, medium: 900, hard: 550 }[difficulty] ?? 900;
  const kind = action?.type === 'answer' ? 1 : action?.type === 'ready' ? 0.8 : 0.5;
  return Math.round(base * kind * (0.8 + rng() * 0.5));
}

// ---------------------------------------------------------------- lobby

function assertHostInLobby(state, byId) {
  if (state.phase !== 'lobby') throw new GameError('Bots can only be changed before the game starts');
  if (byId !== state.hostId) throw new GameError('Only the host can manage bots');
}

export function addBot(state, byId, difficulty = 'medium') {
  assertHostInLobby(state, byId);
  if (!BOT_DIFFICULTY_IDS.includes(difficulty)) throw new GameError('Unknown difficulty');
  const usedNames = new Set(state.players.map((p) => p.name));
  const name = BOT_NAMES.find((n) => !usedNames.has(n)) ?? `Bot ${state.players.length + 1}`;
  let n = 1;
  while (state.players.some((p) => p.id === `bot-${n}`)) n++;
  const id = `bot-${n}`;
  const s = addPlayer(state, id, name);
  s.players.find((p) => p.id === id).bot = { difficulty };
  s.seq++;
  return s;
}

export function removeBot(state, byId, botId) {
  assertHostInLobby(state, byId);
  const bot = state.players.find((p) => p.id === botId);
  if (!bot?.bot) throw new GameError('Not a bot');
  const s = removePlayer(state, botId);
  s.seq++;
  return s;
}

export function setBotDifficulty(state, byId, botId, difficulty) {
  assertHostInLobby(state, byId);
  if (!BOT_DIFFICULTY_IDS.includes(difficulty)) throw new GameError('Unknown difficulty');
  const s = structuredClone(state);
  const bot = s.players.find((p) => p.id === botId);
  if (!bot?.bot) throw new GameError('Not a bot');
  bot.bot.difficulty = difficulty;
  s.seq++;
  return s;
}
