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
  });
  if (!s.hostId) s.hostId = id;
  log(s, `${s.players.at(-1).name} joined.`);
  return s;
}

export function removePlayer(state, id) {
  if (state.phase !== 'lobby') return state;
  const s = structuredClone(state);
  s.players = s.players.filter((p) => p.id !== id);
  if (s.hostId === id) s.hostId = s.players[0]?.id ?? null;
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

export const PROMPT_DEFAULTS = { buy: 'pass', jail: 'roll', card: 'ok' };

function addPrompt(s, player, kind, data = {}) {
  const prompt = { id: s.nextPromptId++, player: player.id, kind, data };
  s.prompts.push(prompt);
  return prompt;
}

const promptsOf = (s, playerId) => s.prompts.filter((p) => p.player === playerId);

function resolveLanding(s, p, diceTotal) {
  const space = SPACES[p.position];
  log(s, `${p.name} landed on ${space.name}.`);
  switch (space.type) {
    case 'street':
    case 'transit':
    case 'utility': {
      const prop = s.properties[space.index];
      if (!prop.owner) {
        const rivals = s.prompts.filter((x) => x.kind === 'buy' && x.data.index === space.index);
        const prompt = addPrompt(s, p, 'buy', { index: space.index, contested: rivals.length > 0 });
        for (const r of rivals) r.data.contested = true;
        if (rivals.length) log(s, `${space.name} is contested — first to buy gets it!`);
        return prompt;
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

function applyCard(s, p, { deck, cardIdx, text, diceTotal }) {
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
      resolveLanding(s, p, diceTotal);
      break;
    case 'moveBy':
      p.position = (p.position + e.amount + 40) % 40;
      resolveLanding(s, p, diceTotal);
      break;
    case 'moveNearest': {
      let i = p.position;
      do { i = (i + 1) % 40; } while (SPACES[i].type !== e.kind);
      moveTo(s, p, i);
      resolveLanding(s, p, diceTotal);
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

function answerPrompt(s, me, prompt, choice) {
  // Validate first; only remove the prompt once the choice is legal.
  const done = () => { s.prompts = s.prompts.filter((x) => x.id !== prompt.id); };
  switch (prompt.kind) {
    case 'buy': {
      const space = SPACES[prompt.data.index];
      if (choice === 'pass') {
        done();
        log(s, `${me.name} passed on ${space.name}.`);
        // TODO: auction
        return;
      }
      if (choice !== 'buy') fail('Choose buy or pass');
      if (me.money < space.price) fail('Not enough money');
      done();
      me.money -= space.price;
      s.properties[space.index].owner = me.id;
      log(s, `${me.name} bought ${space.name} for ${fmt(space.price)}.`);
      // Anyone else holding an offer on this street just lost the race.
      for (const r of s.prompts.filter((x) => x.kind === 'buy' && x.data.index === space.index)) {
        log(s, `${me.name} beat ${playerById(s, r.player).name} to ${space.name}.`);
      }
      s.prompts = s.prompts.filter((x) => !(x.kind === 'buy' && x.data.index === space.index));
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
      applyCard(s, me, prompt.data);
      return;
  }
}

// ---------------------------------------------------------------- turn flow

function setDeadline(s, ctx) {
  s.turn.deadline = s.settings.turnTimer ? ctx.now + s.settings.turnTimer * 1000 : null;
}

/** Players who still need to act before the turn can move on. */
export function waitingOn(s) {
  const t = s.turn;
  if (s.phase !== 'playing') return [];
  if (t.rollers.length) return t.rollers.filter((id) => !t.ready.includes(id));
  if (isParty(s)) return alive(s).filter((p) => !t.ready.includes(p.id)).map((p) => p.id);
  const cur = s.players[t.current];
  return t.ready.includes(cur.id) ? [] : [cur.id];
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
  if (promptsOf(s, me.id).length) fail('Answer your open decisions first');
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
  for (const r of movers) resolveLanding(s, r.p, r.total);

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

    if (t.rollers.length && t.rollers.every((id) => t.ready.includes(id))) {
      rollEvent(s, t.rollers, ctx);
      continue;
    }
    if (!t.rollers.length) {
      const done = isParty(s)
        ? alive(s).every((p) => t.ready.includes(p.id))
        : s.players[t.current].bankrupt || t.ready.includes(s.players[t.current].id);
      if (done) {
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
      heir.money += (prop.houses * SPACES[i].houseCost) / 2; // bank buys back buildings
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

    case 'unready':
      if (!s.turn.ready.includes(me.id)) fail('You are not ready');
      s.turn.ready = s.turn.ready.filter((id) => id !== me.id);
      break;

    case 'answer': {
      const prompt = s.prompts.find((x) => x.id === action.promptId && x.player === me.id);
      if (!prompt) fail('That decision is no longer open');
      answerPrompt(s, me, prompt, action.choice);
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
  for (let guard = 0; guard < 50 && s.prompts.length; guard++) {
    const prompt = s.prompts[0];
    const p = playerById(s, prompt.player);
    try {
      answerPrompt(s, p, prompt, PROMPT_DEFAULTS[prompt.kind]);
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
