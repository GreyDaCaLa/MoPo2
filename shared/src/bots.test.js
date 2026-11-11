import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, addPlayer, startGame, applyAction } from './engine.js';
import { addBot, removeBot, setBotDifficulty, decideBotAction } from './bots.js';
import { simulateGame } from './simulate.js';
import { SPACES } from './board.js';
import { noShuffle, player } from './testkit.js';

function lobbyWithBots(...difficulties) {
  let s = createGame('BOT');
  s = addPlayer(s, 'h', 'Host');
  for (const d of difficulties) s = addBot(s, 'h', d);
  return s;
}

/** A started game: human host 'h' plus one bot of the given difficulty ('bot-1'). */
function gameVsBot(difficulty, settings = {}) {
  let s = lobbyWithBots(difficulty);
  s.settings = { ...s.settings, ...settings };
  return startGame(s, 'h', noShuffle);
}

test('lobby: host adds, re-tunes and removes bots', () => {
  let s = lobbyWithBots('easy', 'hard');
  assert.equal(s.players.length, 3);
  const [b1, b2] = s.players.filter((p) => p.bot);
  assert.notEqual(b1.name, b2.name);
  assert.notEqual(b1.token, b2.token);
  assert.equal(b2.bot.difficulty, 'hard');
  assert.throws(() => addBot(s, b1.id, 'easy'), /host/);
  assert.throws(() => addBot(s, 'h', 'impossible'), /difficulty/);
  s = setBotDifficulty(s, 'h', b1.id, 'medium');
  assert.equal(player(s, b1.id).bot.difficulty, 'medium');
  s = removeBot(s, 'h', b1.id);
  assert.equal(s.players.length, 2);
  assert.throws(() => removeBot(s, 'h', 'h'), /Not a bot/);
  s = startGame(s, 'h', noShuffle); // one human + one bot is enough to play
  assert.equal(s.phase, 'playing');
  assert.throws(() => addBot(s, 'h', 'easy'), /before the game starts/);
});

test('bot readies when the game is waiting on it, and not otherwise', () => {
  let s = gameVsBot('medium', { mode: 'party' });
  assert.deepEqual(decideBotAction(s, 'bot-1'), { type: 'ready' });
  s = applyAction(s, 'bot-1', { type: 'ready' }, noShuffle);
  assert.equal(decideBotAction(s, 'bot-1'), null);
  assert.equal(decideBotAction(s, 'h'), null, 'humans are never driven');
});

test('medium keeps a cash cushion; easy buys on impulse', () => {
  const offer = (difficulty, money) => {
    const s = gameVsBot(difficulty);
    player(s, 'bot-1').money = money;
    s.prompts.push({ id: 99, player: 'bot-1', kind: 'buy', data: { index: 39 } }); // $400
    return decideBotAction(s, 'bot-1', () => 0).choice;
  };
  assert.equal(offer('medium', 500), 'pass');
  assert.equal(offer('medium', 600), 'buy');
  assert.equal(offer('easy', 410), 'buy');
  assert.equal(offer('hard', 300), 'pass', 'cannot afford');
});

test('hard grabs the street that completes its set even when cash is tight', () => {
  const s = gameVsBot('hard');
  for (const i of [6, 8, 9, 11, 12, 13, 14, 15, 16, 18, 19, 21, 23, 24, 25, 26, 27, 28, 29, 31]) s.properties[i].owner = 'h'; // late game
  s.properties[37].owner = 'bot-1';
  player(s, 'bot-1').money = SPACES[39].price + 40;
  s.prompts.push({ id: 99, player: 'bot-1', kind: 'buy', data: { index: 39 } });
  assert.equal(decideBotAction(s, 'bot-1').choice, 'buy');
});

test('a bot in debt sells buildings before mortgaging', () => {
  const s = gameVsBot('medium');
  s.properties[1].owner = 'bot-1';
  s.properties[3].owner = 'bot-1';
  s.properties[1].houses = 1;
  s.properties[5].owner = 'bot-1';
  player(s, 'bot-1').money = -20;
  assert.deepEqual(decideBotAction(s, 'bot-1'), { type: 'sellHouse', index: 1 });
  s.properties[1].houses = 0;
  const next = decideBotAction(s, 'bot-1');
  assert.equal(next.type, 'mortgage');
  assert.equal(next.index, 5, 'keeps the complete Dockside set; mortgages the lone transit line');
});

test('bot-only games never make an illegal move or stall (classic + party)', () => {
  for (const mode of ['classic', 'party']) {
    for (let seed = 1; seed <= 15; seed++) {
      const r = simulateGame({ mode, seed, maxTurns: 50 });
      assert.ok(r.finished, `${mode} seed ${seed} finished`);
      for (const p of r.state.players) assert.ok(Number.isFinite(p.money), 'money stays a number');
    }
  }
});

test('bot-only games can end by bankruptcy', () => {
  // Without trading, some simulated games stall; at least one of a few seeds should knock a bot out.
  const anyBankrupt = [1, 2, 3, 4, 5].some((seed) => {
    const r = simulateGame({ mode: 'classic', seed, maxSteps: 6000 });
    return r.state.players.some((p) => p.bankrupt);
  });
  assert.ok(anyBankrupt);
});
