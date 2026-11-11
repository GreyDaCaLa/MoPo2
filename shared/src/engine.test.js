// Classic mode + shared rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRent, raisableValue, applyAction, GameError, createGame, addPlayer, updateSettings, customizePlayer, startGame } from './engine.js';
import { SPACES } from './board.js';
import { DEFAULT_SETTINGS } from './settings.js';
import { newGame, player, promptOf, ready, answer, noShuffle } from './testkit.js';

test('classic: roll, buy prompt, end turn passes the dice', () => {
  let s = newGame();
  s = ready(s, 'a', 2, 4); // a -> 6, a street
  assert.equal(player(s, 'a').position, 6);
  assert.ok(promptOf(s, 'a', 'buy'));
  assert.throws(() => ready(s, 'a'), /open decisions/);
  s = answer(s, 'a', 'buy', 'buy');
  assert.equal(s.properties[6].owner, 'a');
  assert.equal(player(s, 'a').money, 1500 - SPACES[6].price);
  s = ready(s, 'a'); // end turn
  assert.equal(s.players[s.turn.current].id, 'b');
  assert.equal(s.turn.number, 1);
});

test('classic: only the current player can roll; rounds count turns', () => {
  let s = newGame();
  assert.throws(() => ready(s, 'b', 1, 2), /Not your turn/);
  s = ready(s, 'a', 1, 2); // -> 3 street
  s = answer(s, 'a', 'buy', 'pass');
  s = ready(s, 'a');
  s = ready(s, 'b', 1, 2);
  s = answer(s, 'b', 'buy', 'pass');
  s = ready(s, 'b');
  assert.equal(s.turn.number, 2);
  assert.equal(s.players[s.turn.current].id, 'a');
});

test('rent is charged and doubled for a full group', () => {
  let s = newGame();
  s.properties[1].owner = 'a';
  assert.equal(computeRent(s, 1, 7), SPACES[1].rent[0]);
  s.properties[3].owner = 'a';
  assert.equal(computeRent(s, 1, 7), SPACES[1].rent[0] * 2);
  s = ready(s, 'a', 2, 4);
  s = answer(s, 'a', 'buy', 'pass');
  s = ready(s, 'a');
  s = ready(s, 'b', 1, 2); // b lands on 3
  assert.equal(player(s, 'b').money, 1500 - SPACES[3].rent[0] * 2);
  assert.equal(player(s, 'a').money, 1500 + SPACES[3].rent[0] * 2);
});

test('classic: doubles roll again; three doubles sends you to lockup', () => {
  let s = newGame();
  s = ready(s, 'a', 1, 1); // -> 2 City Hall card (deck order: advance to Start)
  assert.deepEqual(s.turn.rollers, ['a']);
  s = answer(s, 'a', 'card', 'ok');
  s = ready(s, 'a', 2, 2); // -> 4 tax
  s = ready(s, 'a', 3, 3);
  assert.equal(player(s, 'a').inJail, true);
  assert.equal(player(s, 'a').position, 10);
  assert.deepEqual(s.turn.rollers, []);
});

test('classic: lockup prompt — pay bail then roll normally', () => {
  let s = newGame();
  s.players[0].position = 25;
  s = ready(s, 'a', 2, 3); // -> 30 Busted!
  s = ready(s, 'a'); // end turn
  s = ready(s, 'b', 1, 2);
  s = answer(s, 'b', 'buy', 'pass');
  s = ready(s, 'b');
  assert.ok(promptOf(s, 'a', 'jail'));
  s = answer(s, 'a', 'jail', 'bail');
  assert.equal(player(s, 'a').inJail, false);
  s = ready(s, 'a', 1, 2); // 10 -> 13
  assert.equal(player(s, 'a').position, 13);
});

test('building any time requires the whole group and even building', () => {
  let s = newGame();
  s.properties[1].owner = 'b';
  assert.throws(() => applyAction(s, 'b', { type: 'build', index: 1 }), /all of Dockside/);
  s.properties[3].owner = 'b';
  s = applyAction(s, 'b', { type: 'build', index: 1 }); // not b's turn — actions are always allowed
  assert.throws(() => applyAction(s, 'b', { type: 'build', index: 1 }), /evenly/);
  s = applyAction(s, 'b', { type: 'build', index: 3 });
  assert.equal(s.properties[1].houses + s.properties[3].houses, 2);
});

test('a debt that can never be covered bankrupts automatically; assets go to the creditor', () => {
  let s = newGame();
  s.properties[39].owner = 'a';
  s.properties[39].houses = 5;
  s.properties[37].owner = 'b'; // mortgage value 175 — nowhere near enough
  s.players[1].money = 100;
  s.players[1].position = 36;
  s = ready(s, 'a', 2, 4);
  s = answer(s, 'a', 'buy', 'pass');
  s = ready(s, 'a');
  s = ready(s, 'b', 1, 2); // -> 39, hotel rent
  assert.equal(player(s, 'b').bankrupt, true);
  assert.equal(s.phase, 'ended');
  assert.equal(s.winner, 'a');
  assert.equal(s.properties[37].owner, 'a');
  // a received exactly what b had: 100 cash (the property came separately)
  assert.equal(player(s, 'a').money, 1500 + 100);
});

test('a coverable debt waits for the player to raise money', () => {
  let s = newGame();
  s.properties[39].owner = 'a';
  s.properties[39].houses = 1; // rent $140
  s.properties[31].owner = 'b'; // mortgage value 150
  s.properties[34].owner = 'b'; // mortgage value 160
  s.players[1].money = 100;
  s.players[1].position = 36;
  s = ready(s, 'a', 2, 4);
  s = answer(s, 'a', 'buy', 'pass');
  s = ready(s, 'a');
  s = ready(s, 'b', 1, 2); // -> 39
  const b = player(s, 'b');
  assert.ok(b.money < 0 && !b.bankrupt, 'in debt but still playing');
  assert.ok(raisableValue(s, 'b') >= 0);
  assert.throws(() => ready(s, 'b'), /bankruptcy/);
  s = applyAction(s, 'b', { type: 'mortgage', index: 31 });
  assert.ok(player(s, 'b').money >= 0);
  s = ready(s, 'b'); // debt cleared, turn can end
  assert.equal(s.players[s.turn.current].id, 'a');
});

test('declaring bankruptcy voluntarily still works', () => {
  let s = newGame({}, ['a', 'b', 'c']);
  s = applyAction(s, 'b', { type: 'bankrupt' });
  assert.equal(player(s, 'b').bankrupt, true);
  assert.equal(s.phase, 'playing');
});

test('settings: host only, invalid values ignored, locked after start', () => {
  let s = createGame('X');
  s = addPlayer(s, 'a', 'Ana');
  s = addPlayer(s, 'b', 'Ben');
  assert.throws(() => updateSettings(s, 'b', { mode: 'party' }), /host/);
  s = updateSettings(s, 'a', { mode: 'party', startingMoney: 999999, bogus: 1, jackpot: 'yes' });
  assert.equal(s.settings.mode, 'party');
  assert.equal(s.settings.startingMoney, DEFAULT_SETTINGS.startingMoney);
  assert.equal(s.settings.jackpot, false);
  assert.ok(!('bogus' in s.settings));
  s = updateSettings(s, 'a', { startingMoney: 2500 });
  s = startGame(s, 'a', noShuffle);
  assert.equal(s.players[0].money, 2500);
  assert.throws(() => updateSettings(s, 'a', { mode: 'classic' }), /locked/);
});

test('pieces: unique tokens and colors, lobby only', () => {
  let s = createGame('X');
  s = addPlayer(s, 'a', 'Ana');
  s = addPlayer(s, 'b', 'Ben');
  assert.notEqual(s.players[0].token, s.players[1].token);
  assert.notEqual(s.players[0].color, s.players[1].color);
  s = customizePlayer(s, 'a', { token: 'rocket', color: '#7b2cbf' });
  assert.equal(s.players[0].token, 'rocket');
  assert.throws(() => customizePlayer(s, 'b', { token: 'rocket' }), /taken/);
  assert.throws(() => customizePlayer(s, 'b', { color: '#7b2cbf' }), /taken/);
  assert.throws(() => customizePlayer(s, 'b', { token: 'tophat' }), /Unknown/);
  s = startGame(s, 'a', noShuffle);
  assert.throws(() => customizePlayer(s, 'a', { token: 'boat' }), GameError);
});

test('bankruptcy hands over transit/utility without corrupting the creditor\'s money', () => {
  let s = newGame({}, ['a', 'b', 'c']);
  s.properties[5].owner = 'b'; // transit (no houseCost)
  s.properties[12].owner = 'b'; // utility
  s.players[1].debtTo = 'a';
  s = applyAction(s, 'b', { type: 'bankrupt' });
  assert.equal(s.properties[5].owner, 'a');
  assert.ok(Number.isFinite(player(s, 'a').money));
  assert.equal(player(s, 'a').money, 1500 + 1500);
});
