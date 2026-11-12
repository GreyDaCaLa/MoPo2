// Pure game engine. The server owns the state and calls these functions;
// clients only send intents. Every state-changing function takes an optional
// `opts` = { rng, now } (or just an rng function, for tests).
//
// The game is built from three concepts:
//
//   TURNS   — the board's clock (`state.turn.number`). A turn is a cycle of
//             "everyone who should roll readies up → dice roll → pieces move →
//             landings resolve". Classic: one roller per turn-step, in seat
//             order (the number counts full rounds). Party: everyone rolls
//             together each turn.
//
//   ACTIONS — optional, player-initiated, never block the game: building,
//             selling, mortgaging, bankruptcy (later: trading).
//
//   PROMPTS — the game asking one player for a decision (`state.prompts`):
//             buy or pass, how to leave Lockup, a drawn card (later: auctions,
//             trade responses). A player can't ready up while they have one open.
//
// "Ready" is the button that ends your part of a turn and means "I'm ready to
// roll". In Party the next turn starts — with everyone rolling at once — the
// moment the last player readies. Players who roll doubles ready again and
// roll together for their bonus move before the turn can end.
import {
  SPACES, CARDS, OWNABLE, GROUPS, groupMembers,
  BAIL, JAIL_INDEX, MAX_PLAYERS, PLAYER_COLORS, TOKEN_IDS,
} from './board.js';
import { sanitizeSettings } from './settings.js';

export class GameError extends Error {}
const fail = (msg) => { throw new GameError(msg); };

function ctxOf(opts) {
  if (typeof opts === 'function') return { rng: opts, now: Date.now() };
  return { rng: opts?.rng ?? Math.random, now: opts?.now ?? Date.now() };
}

function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const isParty = (s) => s.settings.mode === 'party';
const alive = (s) => s.players.filter((p) => !p.bankrupt);
const playerById = (s, id) => s.players.find((p) => p.id === id);
const fmt = (n) => `$${n}`;

function log(s, msg) {
  s.log.push(msg);
  if (s.log.length > 100) s.log.shift();
}

// ---------------------------------------------------------------- lobby

export function createGame(code, settings) {
  return {
    code,
    phase: 'lobby', // lobby | playing | ended
    settings: sanitizeSettings(settings),
    hostId: null,
    players: [],
    turn: {
      number: 0,
      current: 0, // classic: seat index of the player whose go it is
      rollers: [], // who rolls at the next roll event
      ready: [], // who has pressed Ready
      bonus: false, // the pending roll is a doubles bonus roll
      deadline: null, // turn timer (ms timestamp)
    },
    prompts: [], // { id, player, kind, data }
    nextPromptId: 1,
    auctions: [], // see "auctions" below
    nextAuctionId: 1,
    nextBidOrder: 1, // sealed bids: who locked in first
    trades: [], // open offers — see "trades" below
    nextTradeId: 1,
    lastRolls: null, // { id, rolls: [{ player, d1, d2 }] } — the latest roll event
    pot: 0, // Harbor Rest jackpot
    properties: Object.fromEntries(OWNABLE.map((i) => [i, { owner: null, houses: 0, mortgaged: false }])),
    decks: { fortune: [], cityhall: [] },
    log: [],
    winner: null,
    startedAt: null,
    endsAt: null, // ms timestamp when a time limit is set
    seq: 0, // increments on every change
  };
}

export function addPlayer(state, id, name) {
  if (state.phase !== 'lobby') fail('Game already started');
  if (state.players.length >= MAX_PLAYERS) fail('Room is full');
  if (state.players.some((p) => p.id === id)) return state;
  const s = structuredClone(state);
  const usedColors = new Set(s.players.map((p) => p.color));
  const usedTokens = new Set(s.players.map((p) => p.token));
  s.players.push({
    id,
    name: (name || 'Player').slice(0, 20),
    // Defaults: first free color/token. Players change them in the lobby.
    color: PLAYER_COLORS.find((c) => !usedColors.has(c)),
    token: TOKEN_IDS.find((t) => !usedTokens.has(t)),
    money: 0, // set at start from settings
    position: 0,
    inJail: false,
    jailTurns: 0, // failed attempts to roll out
    jailCards: [],
    doublesCount: 0,
    bankrupt: false,
    debtTo: null,
    connected: true,
    bot: null, // { difficulty } for computer players
    drafting: false, // has the trade builder open (can't ready up)
    lastProposalTurn: 0,
  });
  if (!s.hostId) s.hostId = id;
  log(s, `${s.players.at(-1).name} joined.`);
  return s;
}

export function removePlayer(state, id) {
  if (state.phase !== 'lobby') return state;
  const s = structuredClone(state);
  s.players = s.players.filter((p) => p.id !== id);
  if (s.hostId === id) s.hostId = s.players.find((p) => !p.bot)?.id ?? null; // never a bot
  return s;
}

/** Change your own token and/or color in the lobby. Both must be unique. */
export function customizePlayer(state, id, { token, color } = {}) {
  if (state.phase !== 'lobby') fail('Pieces are locked once the game starts');
  const s = structuredClone(state);
  const me = playerById(s, id);
  if (!me) fail('You are not in this room');
  const others = s.players.filter((p) => p.id !== id);
  if (token !== undefined) {
    if (!TOKEN_IDS.includes(token)) fail('Unknown token');
    if (others.some((p) => p.token === token)) fail('That token is taken');
    me.token = token;
  }
  if (color !== undefined) {
    if (!PLAYER_COLORS.includes(color)) fail('Unknown color');
    if (others.some((p) => p.color === color)) fail('That color is taken');
    me.color = color;
  }
  s.seq++;
  return s;
}

export function updateSettings(state, byId, patch) {
  if (state.phase !== 'lobby') fail('Rules are locked once the game starts');
  if (byId !== state.hostId) fail('Only the host can change the rules');
  const s = structuredClone(state);
  s.settings = sanitizeSettings(patch, s.settings);
  s.seq++;
  return s;
}

export function startGame(state, byId, opts) {
  const ctx = ctxOf(opts);
  if (state.phase !== 'lobby') fail('Game already started');
  if (byId !== state.hostId) fail('Only the host can start');
  if (state.players.length < 2) fail('Need at least 2 players');
  const s = structuredClone(state);
  s.phase = 'playing';
  s.players = shuffle(s.players, ctx.rng);
  for (const p of s.players) p.money = s.settings.startingMoney;
  s.decks.fortune = shuffle(CARDS.fortune.map((_, i) => i), ctx.rng);
  s.decks.cityhall = shuffle(CARDS.cityhall.map((_, i) => i), ctx.rng);
  s.startedAt = ctx.now;
  s.endsAt = s.settings.timeLimit ? ctx.now + s.settings.timeLimit * 60_000 : null;
  log(s, isParty(s) ? 'Party mode — everyone rolls together. Ready up!' : `Game started! ${s.players[0].name} goes first.`);
  s.turn.number = 1;
  s.turn.current = 0;
  beginTurn(s, ctx);
  settle(s, ctx);
  s.seq++;
  return s;
}

// ---------------------------------------------------------------- helpers

/**
 * Move money. `from`/`to` are players or null for the bank. Debtors may go
 * negative; they must raise money or go bankrupt before they can ready up.
 * `fee: true` marks taxes/fines/bail, which feed the jackpot when enabled.
 */
function pay(s, from, to, amount, reason, { fee = false } = {}) {
  if (amount <= 0) return;
  if (from) {
    from.money -= amount;
    if (from.money < 0) from.debtTo = to ? to.id : null;
  }
  if (to) to.money += amount;
  else if (fee && s.settings.jackpot) s.pot += amount;
  log(s, `${from ? from.name : 'Bank'} paid ${fmt(amount)} to ${to ? to.name : 'the bank'}${reason ? ` (${reason})` : ''}.`);
}

function ownsWholeGroup(s, playerId, group) {
  return groupMembers(group).every((i) => s.properties[i].owner === playerId);
}

export function computeRent(s, index, diceTotal) {
  const space = SPACES[index];
  const prop = s.properties[index];
  if (!prop || !prop.owner || prop.mortgaged) return 0;
  if (space.type === 'street') {
    if (prop.houses > 0) return space.rent[prop.houses];
    return ownsWholeGroup(s, prop.owner, space.group) ? space.rent[0] * 2 : space.rent[0];
  }
  const ownedInGroup = groupMembers(space.group).filter((i) => s.properties[i].owner === prop.owner).length;
  if (space.type === 'transit') return 25 * 2 ** (ownedInGroup - 1);
  if (space.type === 'utility') return (ownedInGroup === 2 ? 10 : 4) * diceTotal;
  return 0;
}

/** Cash + property value (half if mortgaged) + buildings at cost. */
export function netWorth(s, playerId) {
  const p = playerById(s, playerId);
  if (!p || p.bankrupt) return 0;
  let total = p.money;
  for (const i of OWNABLE) {
    const prop = s.properties[i];
    if (prop.owner !== playerId) continue;
    total += prop.mortgaged ? SPACES[i].price / 2 : SPACES[i].price;
    total += prop.houses * (SPACES[i].houseCost || 0);
  }
  return total;
}

/**
 * The most cash a player could raise right now: money + selling every building
 * back to the bank (half cost) + mortgaging every unmortgaged property.
 * Below zero means the player can't cover their debt.
 */
export function raisableValue(s, playerId) {
  const p = playerById(s, playerId);
  if (!p || p.bankrupt) return 0;
  let total = p.money;
  for (const i of OWNABLE) {
    const prop = s.properties[i];
    if (prop.owner !== playerId) continue;
    total += (prop.houses * (SPACES[i].houseCost || 0)) / 2;
    if (!prop.mortgaged) total += SPACES[i].price / 2;
  }
  return total;
}

function sendToJail(s, p) {
  p.position = JAIL_INDEX;
  p.inJail = true;
  p.jailTurns = 0;
  p.doublesCount = 0;
  s.turn.rollers = s.turn.rollers.filter((id) => id !== p.id); // no bonus roll from Lockup
  log(s, `${p.name} was sent to Lockup.`);
}

function leaveJail(p) {
  p.inJail = false;
  p.jailTurns = 0;
}

function moveTo(s, p, to) {
  const salary = s.settings.startSalary;
  if (to < p.position) {
    p.money += salary;
    log(s, `${p.name} passed Start and collected ${fmt(salary)}.`);
    if (to === 0 && s.settings.doubleOnStart) {
      p.money += salary;
      log(s, `${p.name} landed right on Start — another ${fmt(salary)}!`);
    }
  }
  p.position = to;
}

// ---------------------------------------------------------------- prompts

export const PROMPT_DEFAULTS = { buy: 'pass', jail: 'roll', card: 'ok', auction: 'pass', trade: 'reject' };

function addPrompt(s, player, kind, data = {}) {
  const prompt = { id: s.nextPromptId++, player: player.id, kind, data };
  s.prompts.push(prompt);
  return prompt;
}

const promptsOf = (s, playerId) => s.prompts.filter((p) => p.player === playerId);

/** Open decisions caused by landings (not Lockup, which is about the next roll, and not trade offers). */
export const landingPrompts = (s) => s.prompts.filter((p) => p.kind !== 'jail' && p.kind !== 'trade');

/** Prompts that stop a player from readying up. */
const blockingPromptsOf = (s, playerId) => s.prompts.filter((p) => p.player === playerId);

/** Open trades this player is part of (as proposer or recipient). */
export const openTradesOf = (s, playerId) => s.trades.filter((t) => t.from === playerId || t.to === playerId);

function resolveLanding(s, p, diceTotal, ctx) {
  const space = SPACES[p.position];
  log(s, `${p.name} landed on ${space.name}.`);
  switch (space.type) {
    case 'street':
    case 'transit':
    case 'utility': {
      const prop = s.properties[space.index];
      if (!prop.owner) {
        if (s.auctions.some((a) => a.index === space.index)) {
          log(s, `${space.name} is already up for auction.`);
          break;
        }
        // Someone else is still deciding on this street: it's contested, so the
        // players who landed there settle it with an auction.
        const rival = s.prompts.find((x) => x.kind === 'buy' && x.data.index === space.index);
        if (rival) {
          s.prompts = s.prompts.filter((x) => x.id !== rival.id);
          log(s, `${space.name} is contested!`);
          startAuction(s, space.index, [rival.player, p.id], 'contested', ctx);
          break;
        }
        addPrompt(s, p, 'buy', { index: space.index });
        break;
      }
      if (prop.owner !== p.id) {
        const owner = playerById(s, prop.owner);
        if (prop.mortgaged) log(s, `${space.name} is mortgaged — no rent.`);
        else pay(s, p, owner, computeRent(s, space.index, diceTotal), `rent on ${space.name}`);
      }
      break;
    }
    case 'tax':
      pay(s, p, null, space.amount, space.name, { fee: true });
      break;
    case 'card': {
      const cardIdx = s.decks[space.deck].shift(); // returned to the bottom once applied
      const card = CARDS[space.deck][cardIdx];
      log(s, `${p.name} drew a ${space.name} card.`);
      addPrompt(s, p, 'card', { deck: space.deck, cardIdx, text: card.text, diceTotal });
      break;
    }
    case 'gotojail':
      sendToJail(s, p);
      break;
    case 'rest':
      if (s.settings.jackpot && s.pot > 0) {
        log(s, `${p.name} scooped the Harbor Rest jackpot: ${fmt(s.pot)}!`);
        p.money += s.pot;
        s.pot = 0;
      }
      break;
  }
}

function applyCard(s, p, { deck, cardIdx, text, diceTotal }, ctx) {
  const e = CARDS[deck][cardIdx].effect;
  log(s, `${p.name}: "${text}"`);
  if (e.type === 'jailCard') p.jailCards.push(deck); // returned to the deck when used
  else s.decks[deck].push(cardIdx);

  switch (e.type) {
    case 'money':
      if (e.amount > 0) p.money += e.amount;
      else pay(s, p, null, -e.amount, 'card', { fee: true });
      break;
    case 'moveTo':
      moveTo(s, p, e.to);
      resolveLanding(s, p, diceTotal, ctx);
      break;
    case 'moveBy':
      p.position = (p.position + e.amount + 40) % 40;
      resolveLanding(s, p, diceTotal, ctx);
      break;
    case 'moveNearest': {
      let i = p.position;
      do { i = (i + 1) % 40; } while (SPACES[i].type !== e.kind);
      moveTo(s, p, i);
      resolveLanding(s, p, diceTotal, ctx);
      break;
    }
    case 'gotoJail':
      sendToJail(s, p);
      break;
    case 'repairs': {
      let total = 0;
      for (const i of OWNABLE) {
        const pr = s.properties[i];
        if (pr.owner !== p.id) continue;
        total += pr.houses === 5 ? e.hotel : pr.houses * e.house;
      }
      pay(s, p, null, total, 'repairs', { fee: true });
      break;
    }
    case 'payEach':
      for (const o of s.players) if (o !== p && !o.bankrupt) pay(s, p, o, e.amount, 'card');
      break;
    case 'collectEach':
      for (const o of s.players) if (o !== p && !o.bankrupt) pay(s, o, p, e.amount, 'card');
      break;
  }
}

function answerPrompt(s, me, prompt, choice, ctx) {
  // Validate first; only remove the prompt once the choice is legal.
  const done = () => { s.prompts = s.prompts.filter((x) => x.id !== prompt.id); };
  switch (prompt.kind) {
    case 'buy': {
      const space = SPACES[prompt.data.index];
      if (choice === 'pass') {
        done();
        log(s, `${me.name} passed on ${space.name}.`);
        if (s.settings.auctions) {
          const bidders = alive(s).filter((p) => p.id !== me.id).map((p) => p.id);
          startAuction(s, space.index, bidders, 'passed', ctx);
        }
        return;
      }
      if (choice !== 'buy') fail('Choose buy or pass');
      if (me.money < space.price) fail('Not enough money');
      done();
      me.money -= space.price;
      s.properties[space.index].owner = me.id;
      log(s, `${me.name} bought ${space.name} for ${fmt(space.price)}.`);
      return;
    }
    case 'jail': {
      if (choice === 'roll') {
        done();
        markReady(s, me); // rolling for doubles = ready to roll
      } else if (choice === 'bail') {
        if (me.money < BAIL) fail('Not enough money');
        done();
        pay(s, me, null, BAIL, 'bail', { fee: true });
        leaveJail(me);
      } else if (choice === 'card') {
        const deck = me.jailCards.shift();
        if (!deck) fail('You have no Lockup card');
        done();
        s.decks[deck].push(CARDS[deck].findIndex((c) => c.effect.type === 'jailCard'));
        leaveJail(me);
        log(s, `${me.name} used a get-out-of-Lockup card.`);
      } else fail('Choose roll, bail or card');
      return;
    }
    case 'card':
      done();
      applyCard(s, me, prompt.data, ctx);
      return;
    case 'auction':
      auctionAnswer(s, me, prompt, choice, ctx);
      return;
    case 'trade': {
      const trade = s.trades.find((t) => t.id === prompt.data.tradeId);
      if (!trade) {
        done();
        return;
      }
      if (choice === 'accept') acceptTrade(s, trade);
      else if (choice === 'reject') closeTrade(s, trade, `${me.name} rejected ${playerById(s, trade.from).name}'s offer.`);
      else fail('Choose accept or reject');
      return;
    }
  }
}

// ---------------------------------------------------------------- trades
//
// Proposing/withdrawing a trade is an ACTION; the recipient gets a 'trade'
// PROMPT (accept / reject — countering = proposing back with `counterTo`).
//
//   - Neither side of an open trade can ready up until it concludes (accepted,
//     rejected, withdrawn or cancelled). Proposing to a player who is already
//     ready un-readies them. The turn can't end while any trade is open (in
//     Classic too); the turn timer (if on) breaks a stall by auto-rejecting.
//   - Offers are public, capped at MAX_OPEN_TRADES per proposer, and expire
//     at the end of the turn.
//   - Any property can be traded on its own, unless it has buildings on it.
//     Mortgaged property stays mortgaged; the receiver pays a 10% fee.
//   - While a player has the trade builder open (`drafting`) they can't ready
//     up. Once ready, they must un-ready before drafting or proposing again.
//   - Everything is re-checked on accept; a trade that no longer works is
//     cancelled with a reason instead.

export const MAX_OPEN_TRADES = 3;
export const mortgageTransferFee = (index) => Math.ceil((SPACES[index].price / 2) * 0.1);

function normalizeSide(side = {}) {
  const properties = [...new Set((side.properties || []).map(Number))];
  const cash = Math.floor(Number(side.cash) || 0);
  const jailCards = Math.floor(Number(side.jailCards) || 0);
  if (cash < 0 || jailCards < 0) fail('Amounts must be positive');
  return { properties, cash, jailCards };
}

const sideEmpty = (side) => !side.properties.length && !side.cash && !side.jailCards;

/** Mortgage fees `receiver` would owe for the properties in `side`. */
const feesFor = (s, side) => side.properties.reduce((sum, i) => sum + (s.properties[i].mortgaged ? mortgageTransferFee(i) : 0), 0);

function sideProblem(s, giver, side) {
  for (const i of side.properties) {
    const space = SPACES[i];
    if (!space || space.price == null) return 'That is not an ownable space';
    const prop = s.properties[i];
    if (prop.owner !== giver.id) return `${giver.name} doesn't own ${space.name}`;
    if (prop.houses > 0) return `${space.name} has buildings — sell them first`;
  }
  if (side.cash > Math.max(0, giver.money)) return `${giver.name} doesn't have ${fmt(side.cash)}`;
  if (side.jailCards > giver.jailCards.length) return `${giver.name} doesn't have that many Lockup cards`;
  return null;
}

/** Why `trade` can't happen right now, or null. */
export function tradeProblem(s, trade) {
  const from = playerById(s, trade.from);
  const to = playerById(s, trade.to);
  if (!from || !to || from.bankrupt || to.bankrupt) return 'a player in this trade is out of the game';
  const problem = sideProblem(s, from, trade.give) || sideProblem(s, to, trade.get);
  if (problem) return problem;
  // Mortgage fees can't push anyone (further) into debt.
  const fromAfter = from.money - trade.give.cash + trade.get.cash - feesFor(s, trade.get);
  const toAfter = to.money - trade.get.cash + trade.give.cash - feesFor(s, trade.give);
  if (fromAfter < Math.min(0, from.money)) return `${from.name} couldn't cover the mortgage fees`;
  if (toAfter < Math.min(0, to.money)) return `${to.name} couldn't cover the mortgage fees`;
  return null;
}

function sideText(side) {
  const parts = side.properties.map((i) => SPACES[i].name);
  if (side.cash) parts.push(fmt(side.cash));
  if (side.jailCards) parts.push(`${side.jailCards} Lockup card${side.jailCards > 1 ? 's' : ''}`);
  return parts.join(' + ') || 'nothing';
}

function closeTrade(s, trade, reason) {
  s.trades = s.trades.filter((t) => t.id !== trade.id);
  s.prompts = s.prompts.filter((x) => !(x.kind === 'trade' && x.data.tradeId === trade.id));
  if (reason) log(s, reason);
}

function proposeTrade(s, me, { to, give, get, counterTo }) {
  if (s.turn.ready.includes(me.id)) fail('Un-ready to make a trade offer');
  const partner = playerById(s, to);
  if (!partner || partner.bankrupt || partner.id === me.id) fail('Pick another player to trade with');
  if (counterTo != null) {
    const original = s.trades.find((t) => t.id === counterTo && t.to === me.id && t.from === partner.id);
    if (!original) fail('That offer is no longer open');
    closeTrade(s, original, `${me.name} countered ${partner.name}'s offer.`);
  }
  if (s.trades.filter((t) => t.from === me.id).length >= MAX_OPEN_TRADES) fail(`You can have at most ${MAX_OPEN_TRADES} open offers`);
  const trade = { id: s.nextTradeId++, from: me.id, to: partner.id, give: normalizeSide(give), get: normalizeSide(get), turn: s.turn.number };
  if (sideEmpty(trade.give) && sideEmpty(trade.get)) fail('The offer is empty');
  const problem = tradeProblem(s, trade);
  if (problem) fail(problem.charAt(0).toUpperCase() + problem.slice(1));
  s.trades.push(trade);
  addPrompt(s, partner, 'trade', { tradeId: trade.id });
  // The recipient has to decide before they can (re-)ready.
  s.turn.ready = s.turn.ready.filter((id) => id !== partner.id);
  me.drafting = false;
  me.lastProposalTurn = s.turn.number;
  log(s, `${me.name} offers ${partner.name}: ${sideText(trade.give)} for ${sideText(trade.get)}.`);
}

function transfer(s, giver, receiver, side) {
  for (const i of side.properties) {
    s.properties[i].owner = receiver.id;
    if (s.properties[i].mortgaged) pay(s, receiver, null, mortgageTransferFee(i), `10% fee on mortgaged ${SPACES[i].name}`);
  }
  if (side.cash) {
    giver.money -= side.cash;
    receiver.money += side.cash;
  }
  for (let n = 0; n < side.jailCards; n++) receiver.jailCards.push(giver.jailCards.shift());
}

function acceptTrade(s, trade) {
  const problem = tradeProblem(s, trade);
  if (problem) {
    closeTrade(s, trade, `Trade cancelled: ${problem}.`);
    return;
  }
  const from = playerById(s, trade.from);
  const to = playerById(s, trade.to);
  closeTrade(s, trade);
  log(s, `Trade done! ${from.name} gave ${sideText(trade.give)}; ${to.name} gave ${sideText(trade.get)}.`);
  transfer(s, from, to, trade.give);
  transfer(s, to, from, trade.get);
}

function expireTrades(s) {
  if (!s.trades.length) return;
  for (const t of [...s.trades]) closeTrade(s, t);
  log(s, 'Open trade offers expired.');
}

// ---------------------------------------------------------------- auctions
//
// An auction is a shared object in `state.auctions`; each bidder who still
// owes a decision has an 'auction' prompt pointing at it, so auctions hold up
// bonus rolls and the end of the turn like any other landing decision.
//
//   LIVE   — open ascending bids; a countdown (settings.liveBidTime) restarts
//            on every bid. The high bidder can't drop out. Ends when the clock
//            runs out (the server calls `tickAuctions`) or everyone else drops.
//
//   SEALED — up to 3 waves of secret bids. After wave 1 the top 3 advance,
//            after wave 2 the top 2 (ties at the cut-off advance too); wave 3's
//            highest bid wins, ties going to whoever locked in first. Passing
//            drops you out. Between waves only the previous top amount is public.
//            If everyone passes in a later wave, the previous leader wins.
//
// Answers: { bid: amount } or 'pass' (in live auctions 'pass' = drop out).

export const LIVE_MIN_BID = 10;

function auctionById(s, id) {
  const a = s.auctions.find((x) => x.id === id);
  if (!a) fail('That auction is over');
  return a;
}

function startAuction(s, index, participantIds, reason, ctx) {
  const space = SPACES[index];
  const ids = participantIds.filter((id) => !playerById(s, id).bankrupt);
  if (!ids.length) {
    log(s, `Nobody is left to bid on ${space.name}.`);
    return;
  }
  const format = s.settings.auctionFormat;
  const a = {
    id: s.nextAuctionId++,
    index,
    format,
    reason, // 'passed' | 'contested'
    participants: ids, // still in the running
    // live
    highBid: 0,
    highBidder: null,
    endsAt: format === 'live' ? ctx.now + s.settings.liveBidTime * 1000 : null,
    // sealed
    wave: 1,
    bids: {}, // playerId -> { amount, order } for the current wave (hidden from clients)
    lastTopBid: null, // top amount of the previous wave (public)
    prevLeader: null, // fallback winner if everyone passes in a later wave
  };
  s.auctions.push(a);
  for (const id of ids) addPrompt(s, playerById(s, id), 'auction', { auctionId: a.id });
  const who = ids.map((id) => playerById(s, id).name).join(', ');
  log(s, `${space.name} goes to a ${format === 'live' ? 'live' : 'sealed-bid'} auction between ${who}!`);
}

function endAuction(s, a, winnerId, price) {
  const space = SPACES[a.index];
  s.auctions = s.auctions.filter((x) => x.id !== a.id);
  s.prompts = s.prompts.filter((x) => !(x.kind === 'auction' && x.data.auctionId === a.id));
  const winner = winnerId && playerById(s, winnerId);
  if (!winner || winner.bankrupt || s.properties[a.index].owner) {
    log(s, `Nobody won ${space.name} — it stays with the bank.`);
    return;
  }
  pay(s, winner, null, price, `auction for ${space.name}`);
  s.properties[a.index].owner = winner.id;
  log(s, `${winner.name} won ${space.name} at auction for ${fmt(price)}.`);
}

function removeFromAuction(s, a, playerId) {
  a.participants = a.participants.filter((id) => id !== playerId);
  delete a.bids[playerId];
  s.prompts = s.prompts.filter((x) => !(x.kind === 'auction' && x.data.auctionId === a.id && x.player === playerId));
  if (a.highBidder === playerId) {
    a.highBidder = null;
    a.highBid = 0;
  }
}

function checkLiveAuction(s, a) {
  if (!a.participants.length) endAuction(s, a, null, 0);
  else if (a.participants.length === 1 && a.highBidder === a.participants[0]) endAuction(s, a, a.highBidder, a.highBid);
}

function resolveSealedWave(s, a) {
  const entries = a.participants
    .filter((id) => a.bids[id])
    .map((id) => ({ id, ...a.bids[id] }))
    .sort((x, y) => y.amount - x.amount || x.order - y.order);
  if (!entries.length) {
    if (a.prevLeader) endAuction(s, a, a.prevLeader.id, a.prevLeader.amount);
    else endAuction(s, a, null, 0);
    return;
  }
  if (a.wave === 3 || entries.length === 1) {
    endAuction(s, a, entries[0].id, entries[0].amount);
    return;
  }
  const keep = a.wave === 1 ? 3 : 2;
  const cutoff = entries[Math.min(keep, entries.length) - 1].amount;
  const advancing = entries.filter((e) => e.amount >= cutoff);
  if (advancing.length === 1) {
    endAuction(s, a, advancing[0].id, advancing[0].amount);
    return;
  }
  a.prevLeader = { id: entries[0].id, amount: entries[0].amount };
  a.lastTopBid = entries[0].amount;
  a.wave++;
  a.participants = advancing.map((e) => e.id);
  a.bids = {};
  for (const id of a.participants) addPrompt(s, playerById(s, id), 'auction', { auctionId: a.id });
  log(s, `Wave ${a.wave - 1} closed (top bid ${fmt(a.lastTopBid)}). ${a.participants.map((id) => playerById(s, id).name).join(', ')} advance to wave ${a.wave}.`);
}

function parseBid(choice) {
  const amount = Math.floor(Number(choice?.bid));
  if (!Number.isFinite(amount) || amount < 1) fail('Enter a bid of at least $1');
  return amount;
}

function auctionAnswer(s, me, prompt, choice, ctx) {
  const a = auctionById(s, prompt.data.auctionId);
  const space = SPACES[a.index];

  if (a.format === 'live') {
    if (choice === 'pass') {
      if (a.highBidder === me.id) fail("You're the high bidder — you can't drop out");
      removeFromAuction(s, a, me.id);
      log(s, `${me.name} dropped out of the bidding for ${space.name}.`);
      checkLiveAuction(s, a);
      return;
    }
    const amount = parseBid(choice);
    if (a.highBidder === me.id) fail("You're already the high bidder");
    const min = Math.max(LIVE_MIN_BID, a.highBid + 1);
    if (amount < min) fail(`Bid at least ${fmt(min)}`);
    if (amount > me.money) fail("You can't bid more than your cash");
    a.highBid = amount;
    a.highBidder = me.id;
    a.endsAt = ctx.now + s.settings.liveBidTime * 1000;
    log(s, `${me.name} bids ${fmt(amount)} for ${space.name}.`);
    checkLiveAuction(s, a);
    return;
  }

  // sealed
  if (a.bids[me.id]) fail('You already locked in a bid this wave');
  if (choice === 'pass') {
    removeFromAuction(s, a, me.id);
    log(s, `${me.name} passed on the ${space.name} auction.`);
  } else {
    const amount = parseBid(choice);
    if (amount > me.money) fail("You can't bid more than your cash");
    a.bids[me.id] = { amount, order: s.nextBidOrder++ };
    s.prompts = s.prompts.filter((x) => x.id !== prompt.id);
    log(s, `${me.name} locked in a bid.`);
  }
  if (a.participants.every((id) => a.bids[id])) resolveSealedWave(s, a);
}

/** Close live auctions whose countdown has run out (or all of them, when forced). */
function closeLiveAuctions(s, ctx, force = false) {
  for (const a of [...s.auctions]) {
    if (a.format === 'live' && (force || ctx.now >= a.endsAt)) endAuction(s, a, a.highBidder, a.highBid);
  }
}

/** Earliest live-auction deadline, for the server's timer. */
export function nextAuctionDeadline(s) {
  if (s.phase !== 'playing') return null;
  const times = s.auctions.filter((a) => a.format === 'live').map((a) => a.endsAt);
  return times.length ? Math.min(...times) : null;
}

/** Server tick: sell live auctions whose countdown has expired. */
export function tickAuctions(state, opts) {
  const ctx = ctxOf(opts);
  if (state.phase !== 'playing') return state;
  if (!state.auctions.some((a) => a.format === 'live' && ctx.now >= a.endsAt)) return state;
  const s = structuredClone(state);
  closeLiveAuctions(s, ctx);
  settle(s, ctx);
  s.seq++;
  return s;
}


// ---------------------------------------------------------------- turn flow

function setDeadline(s, ctx) {
  s.turn.deadline = s.settings.turnTimer ? ctx.now + s.settings.turnTimer * 1000 : null;
}

/** Players who still need to act before the turn can move on. */
export function waitingOn(s) {
  const t = s.turn;
  if (s.phase !== 'playing') return [];
  if (t.rollers.length) {
    // A roll waits for its rollers to ready AND for every open landing decision
    // to settle, so ownership is decided before anyone moves again.
    const deciding = landingPrompts(s).map((p) => p.player);
    return [...new Set([...t.rollers.filter((id) => !t.ready.includes(id)), ...deciding])];
  }
  const deciding = [
    ...landingPrompts(s).map((p) => p.player),
    ...s.trades.flatMap((t) => [t.from, t.to]), // the turn can't end mid-trade
  ];
  if (isParty(s)) return [...new Set([...alive(s).filter((p) => !t.ready.includes(p.id)).map((p) => p.id), ...deciding])];
  const cur = s.players[t.current];
  return [...new Set([...(t.ready.includes(cur.id) ? [] : [cur.id]), ...deciding])];
}

function beginTurn(s, ctx) {
  const t = s.turn;
  t.bonus = false;
  if (isParty(s)) {
    t.rollers = alive(s).map((p) => p.id);
    log(s, `— Turn ${t.number} —`);
  } else {
    const cur = s.players[t.current];
    t.rollers = [cur.id];
    t.ready = [];
    cur.doublesCount = 0;
    log(s, `${cur.name}'s go (turn ${t.number}).`);
  }
  if (isParty(s)) for (const p of alive(s)) p.doublesCount = 0;
  setDeadline(s, ctx);
}

function nextTurn(s, ctx) {
  const t = s.turn;
  expireTrades(s);
  if (isParty(s)) {
    t.number++;
  } else {
    const n = s.players.length;
    let i = t.current;
    do { i = (i + 1) % n; } while (s.players[i].bankrupt);
    if (i <= t.current) t.number++; // wrapped around: a new round
    t.current = i;
  }
  if (s.settings.maxTurns && t.number > s.settings.maxTurns) {
    finishByWorth(s, `Turn limit reached (${s.settings.maxTurns})!`);
    return;
  }
  beginTurn(s, ctx);
}

function markReady(s, me) {
  const t = s.turn;
  if (!isParty(s) && s.players[t.current].id !== me.id) fail('Not your turn');
  if (t.ready.includes(me.id)) fail('You are already ready');
  if (blockingPromptsOf(s, me.id).length) fail('Answer your open decisions first');
  if (me.drafting) fail('Send or cancel your trade offer first');
  if (openTradesOf(s, me.id).length) fail('Finish your open trade first');
  if (me.money < 0) fail('Raise money or declare bankruptcy first');
  t.ready.push(me.id);
}

/** Everyone in `ids` rolls at once; then all pieces move; then landings resolve in seat order. */
function rollEvent(s, ids, ctx) {
  const t = s.turn;
  const results = [];
  for (const p of s.players) {
    if (!ids.includes(p.id) || p.bankrupt) continue;
    const d1 = 1 + Math.floor(ctx.rng() * 6);
    const d2 = 1 + Math.floor(ctx.rng() * 6);
    results.push({ p, d1, d2, total: d1 + d2, doubles: d1 === d2 });
    log(s, `${p.name} rolled ${d1} + ${d2} = ${d1 + d2}${d1 === d2 ? ' (doubles!)' : ''}.`);
  }
  s.lastRolls = { id: (s.lastRolls?.id ?? 0) + 1, rolls: results.map(({ p, d1, d2 }) => ({ player: p.id, d1, d2 })) };
  t.ready = t.ready.filter((id) => !ids.includes(id));
  t.rollers = [];

  const movers = [];
  for (const r of results) {
    const { p } = r;
    if (p.inJail) {
      if (r.doubles) {
        log(s, `${p.name} rolled out of Lockup.`);
      } else {
        p.jailTurns++;
        if (p.jailTurns < 3) continue;
        pay(s, p, null, BAIL, 'bail', { fee: true });
      }
      leaveJail(p);
      movers.push(r); // leaving Lockup never grants a bonus roll
      continue;
    }
    if (r.doubles) {
      p.doublesCount++;
      if (p.doublesCount === 3) {
        log(s, `${p.name} rolled doubles three times — speeding!`);
        sendToJail(s, p);
        continue;
      }
      t.rollers.push(p.id);
    } else {
      p.doublesCount = 0;
    }
    movers.push(r);
  }

  for (const r of movers) moveTo(s, r.p, (r.p.position + r.total) % 40);
  for (const r of movers) resolveLanding(s, r.p, r.total, ctx);

  t.rollers = t.rollers.filter((id) => { const p = playerById(s, id); return !p.inJail && !p.bankrupt; });
  t.bonus = t.rollers.length > 0;
  if (t.bonus) log(s, `Doubles! Bonus roll for ${t.rollers.map((id) => playerById(s, id).name).join(', ')}.`);
  setDeadline(s, ctx);
}

/** Players in Lockup decide how to get out before they can ready up. */
function ensureJailPrompts(s) {
  const t = s.turn;
  for (const p of alive(s)) {
    if (!p.inJail || t.ready.includes(p.id)) continue;
    if (s.prompts.some((x) => x.player === p.id && x.kind === 'jail')) continue;
    const myGo = isParty(s) || t.rollers.includes(p.id);
    if (myGo) addPrompt(s, p, 'jail');
  }
}

/** Move the game forward as far as it can go without player input. */
function settle(s, ctx) {
  for (let guard = 0; guard < 50 && s.phase === 'playing'; guard++) {
    bankruptInsolvent(s);
    if (s.phase !== 'playing') break;
    const t = s.turn;
    t.rollers = t.rollers.filter((id) => !playerById(s, id).bankrupt);
    t.ready = t.ready.filter((id) => !playerById(s, id).bankrupt);
    ensureJailPrompts(s);

    if (t.rollers.length && t.rollers.every((id) => t.ready.includes(id)) && !landingPrompts(s).length) {
      rollEvent(s, t.rollers, ctx);
      continue;
    }
    if (!t.rollers.length) {
      const done = isParty(s)
        ? alive(s).every((p) => t.ready.includes(p.id))
        : s.players[t.current].bankrupt || t.ready.includes(s.players[t.current].id);
      if (done && !landingPrompts(s).length && !s.trades.length) {
        nextTurn(s, ctx);
        continue;
      }
    }
    break;
  }
}

function checkWinner(s) {
  const left = alive(s);
  if (left.length === 1) {
    s.phase = 'ended';
    s.winner = left[0].id;
    s.prompts = [];
    log(s, `${left[0].name} wins!`);
  }
}

function finishByWorth(s, reason) {
  const ranked = alive(s)
    .map((p) => ({ p, worth: netWorth(s, p.id) }))
    .sort((a, b) => b.worth - a.worth);
  log(s, `${reason} ${ranked.map((r) => `${r.p.name} ${fmt(r.worth)}`).join(', ')}.`);
  s.phase = 'ended';
  s.winner = ranked[0].p.id;
  s.prompts = [];
  s.turn.deadline = null;
  log(s, `${ranked[0].p.name} wins!`);
}

/** Hand everything to the creditor (or the bank) and leave the game. */
function goBankrupt(s, me, reason = '') {
  const creditor = me.debtTo ? playerById(s, me.debtTo) : null;
  const heir = creditor && !creditor.bankrupt ? creditor : null;
  for (const i of OWNABLE) {
    const prop = s.properties[i];
    if (prop.owner !== me.id) continue;
    if (heir) {
      heir.money += (prop.houses * (SPACES[i].houseCost || 0)) / 2; // bank buys back buildings
      s.properties[i] = { owner: heir.id, houses: 0, mortgaged: prop.mortgaged };
    } else {
      s.properties[i] = { owner: null, houses: 0, mortgaged: false };
    }
  }
  // The creditor was credited the full debt up front; settle the shortfall.
  if (heir) heir.money += me.money;
  for (const deck of me.jailCards) {
    s.decks[deck].push(CARDS[deck].findIndex((c) => c.effect.type === 'jailCard'));
  }
  // Return any card this player was still looking at.
  for (const pr of promptsOf(s, me.id)) if (pr.kind === 'card') s.decks[pr.data.deck].push(pr.data.cardIdx);
  for (const t of s.trades.filter((x) => x.from === me.id || x.to === me.id)) closeTrade(s, t);
  me.drafting = false;
  for (const a of s.auctions.filter((x) => x.participants.includes(me.id))) {
    removeFromAuction(s, a, me.id);
    if (a.format === 'live') checkLiveAuction(s, a);
    else if (a.participants.every((id) => a.bids[id])) resolveSealedWave(s, a);
  }
  s.prompts = s.prompts.filter((x) => x.player !== me.id);
  me.jailCards = [];
  me.money = 0;
  me.bankrupt = true;
  leaveJail(me);
  log(s, `${me.name} went bankrupt${reason}${heir ? ` — assets go to ${heir.name}` : ''}.`);
  checkWinner(s);
}

/** Anyone whose debt exceeds everything they could raise is out automatically. */
function bankruptInsolvent(s) {
  for (const p of alive(s)) {
    if (s.phase !== 'playing') return;
    if (p.money < 0 && raisableValue(s, p.id) < 0) goBankrupt(s, p, " (can't cover the debt)");
  }
}

function assertOwnable(index) {
  const space = SPACES[index];
  if (!space || space.price == null) fail('Not an ownable space');
  return space;
}

// ---------------------------------------------------------------- actions

export function applyAction(state, playerId, action, opts) {
  const ctx = ctxOf(opts);
  if (state.phase !== 'playing') fail('Game is not in progress');
  const s = structuredClone(state);
  const me = playerById(s, playerId);
  if (!me) fail('You are not in this game');
  if (me.bankrupt) fail('You are bankrupt');

  switch (action.type) {
    // ---- turn flow
    case 'ready':
      markReady(s, me);
      break;

    case 'tradeDraft':
      if (action.on) {
        if (s.turn.ready.includes(me.id)) fail('Un-ready to set up a trade');
        me.drafting = true;
      } else {
        me.drafting = false;
      }
      break;

    case 'proposeTrade':
      proposeTrade(s, me, action);
      break;

    case 'withdrawTrade': {
      const trade = s.trades.find((t) => t.id === action.tradeId && t.from === me.id);
      if (!trade) fail('That offer is no longer open');
      closeTrade(s, trade, `${me.name} withdrew their offer to ${playerById(s, trade.to).name}.`);
      break;
    }

    case 'unready':
      if (!s.turn.ready.includes(me.id)) fail('You are not ready');
      s.turn.ready = s.turn.ready.filter((id) => id !== me.id);
      break;

    case 'answer': {
      const prompt = s.prompts.find((x) => x.id === action.promptId && x.player === me.id);
      if (!prompt) fail('That decision is no longer open');
      answerPrompt(s, me, prompt, action.choice, ctx);
      break;
    }

    // ---- actions (any time)
    case 'build': {
      const space = assertOwnable(action.index);
      if (space.type !== 'street') fail('You can only build on streets');
      const members = groupMembers(space.group);
      if (!ownsWholeGroup(s, me.id, space.group)) fail(`You need all of ${GROUPS[space.group].name}`);
      if (members.some((i) => s.properties[i].mortgaged)) fail('Unmortgage the group first');
      const prop = s.properties[space.index];
      if (prop.houses >= 5) fail('Already has a hotel');
      const min = Math.min(...members.map((i) => s.properties[i].houses));
      if (prop.houses > min) fail('Build evenly across the group');
      if (me.money < space.houseCost) fail('Not enough money');
      me.money -= space.houseCost;
      prop.houses++;
      log(s, `${me.name} built ${prop.houses === 5 ? 'a hotel' : 'a house'} on ${space.name}.`);
      break;
    }

    case 'sellHouse': {
      const space = assertOwnable(action.index);
      const prop = s.properties[space.index];
      if (prop.owner !== me.id) fail('Not yours');
      if (!prop.houses) fail('No buildings to sell');
      const max = Math.max(...groupMembers(space.group).map((i) => s.properties[i].houses));
      if (prop.houses < max) fail('Sell evenly across the group');
      prop.houses--;
      me.money += space.houseCost / 2;
      log(s, `${me.name} sold a building on ${space.name} for ${fmt(space.houseCost / 2)}.`);
      break;
    }

    case 'mortgage': {
      const space = assertOwnable(action.index);
      const prop = s.properties[space.index];
      if (prop.owner !== me.id) fail('Not yours');
      if (prop.mortgaged) fail('Already mortgaged');
      if (groupMembers(space.group).some((i) => s.properties[i].houses > 0)) fail('Sell buildings in this group first');
      prop.mortgaged = true;
      me.money += space.price / 2;
      log(s, `${me.name} mortgaged ${space.name} for ${fmt(space.price / 2)}.`);
      break;
    }

    case 'unmortgage': {
      const space = assertOwnable(action.index);
      const prop = s.properties[space.index];
      if (prop.owner !== me.id) fail('Not yours');
      if (!prop.mortgaged) fail('Not mortgaged');
      const cost = Math.ceil((space.price / 2) * 1.1);
      if (me.money < cost) fail('Not enough money');
      me.money -= cost;
      prop.mortgaged = false;
      log(s, `${me.name} paid off the mortgage on ${space.name} (${fmt(cost)}).`);
      break;
    }

    case 'bankrupt':
      goBankrupt(s, me);
      break;

    default:
      fail(`Unknown action: ${action.type}`);
  }

  settle(s, ctx);
  s.seq++;
  return s;
}

/**
 * Turn timer ran out: open decisions take their defaults and everyone the
 * turn is waiting on is readied (except players who still owe money).
 */
export function expireTurn(state, opts) {
  const ctx = ctxOf(opts);
  if (state.phase !== 'playing' || !state.turn.deadline || ctx.now < state.turn.deadline) return state;
  const s = structuredClone(state);
  log(s, "Time's up for this turn!");
  closeLiveAuctions(s, ctx, true); // sold to the current high bidder, if any
  for (const p of s.players) p.drafting = false;
  for (let guard = 0; guard < 50 && s.prompts.length; guard++) {
    const prompt = s.prompts.find((x) => x.kind !== 'jail') ?? s.prompts[0]; // Lockup choice last
    const p = playerById(s, prompt.player);
    try {
      answerPrompt(s, p, prompt, PROMPT_DEFAULTS[prompt.kind], ctx);
    } catch {
      s.prompts = s.prompts.filter((x) => x.id !== prompt.id);
    }
  }
  for (const id of waitingOn(s)) {
    const p = playerById(s, id);
    try { markReady(s, p); } catch { /* still in debt — they must resolve it */ }
  }
  settle(s, ctx);
  s.seq++;
  return s;
}

/** Called by the server when the time limit runs out. Richest player wins. */
export function endByTime(state) {
  if (state.phase !== 'playing') return state;
  const s = structuredClone(state);
  finishByWorth(s, "Time's up!");
  s.seq++;
  return s;
}
