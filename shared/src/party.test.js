// Party mode: everyone readies, rolls and moves together each turn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, expireTurn, endByTime, waitingOn } from './engine.js';
import { SPACES } from './board.js';
import { newGame, player, promptOf, ready, answer, at } from './testkit.js';

const party = (extra = {}) => newGame({ mode: 'party', ...extra });

test('nobody rolls until everyone is ready, then all roll at once', () => {
  let s = party();
  assert.equal(s.turn.number, 1);
  s = ready(s, 'a');
  assert.equal(player(s, 'a').position, 0);
  assert.deepEqual(waitingOn(s), ['b']);
  s = ready(s, 'b', 1, 2, 2, 4); // a -> 3, b -> 6 (seat order)
  assert.equal(player(s, 'a').position, 3);
  assert.equal(player(s, 'b').position, 6);
  assert.equal(s.lastRolls.rolls.length, 2);
  assert.equal(s.turn.number, 1);
});

test('the last ready of a turn starts the next turn with everyone rolling', () => {
  let s = party();
  s = ready(s, 'a');
  s = ready(s, 'b', 1, 2, 2, 4);
  s = answer(s, 'a', 'buy', 'pass');
  s = answer(s, 'b', 'buy', 'pass');
  s = ready(s, 'a');
  s = applyAction(s, 'a', { type: 'unready' }, at(1000));
  s = ready(s, 'a');
  s = ready(s, 'b', 3, 4, 1, 3); // turn 2: a 3 -> 10, b 6 -> 10
  assert.equal(s.turn.number, 2);
  assert.equal(player(s, 'a').position, 10);
  assert.equal(player(s, 'b').position, 10);
});

test('ready is blocked while a prompt is open', () => {
  let s = party();
  s = ready(s, 'a');
  s = ready(s, 'b', 1, 2, 2, 4);
  assert.throws(() => ready(s, 'a'), /open decisions/);
});

test('collision: both land on the same street — they settle it with an auction', () => {
  let s = party(); // auctions for passed streets are off, contested ones still auction
  s = ready(s, 'a');
  s = ready(s, 'b', 2, 4, 1, 5); // both -> 6
  assert.equal(promptOf(s, 'a', 'buy'), undefined);
  assert.equal(s.auctions.length, 1);
  assert.equal(s.auctions[0].reason, 'contested');
  assert.deepEqual(s.auctions[0].participants, ['a', 'b']);
  assert.ok(promptOf(s, 'a', 'auction') && promptOf(s, 'b', 'auction'));
});

test('doubles: bonus rollers ready and roll together before the turn ends', () => {
  let s = newGame({ mode: 'party' }, ['a', 'b', 'c']);
  s = ready(s, 'a');
  s = ready(s, 'b');
  s = ready(s, 'c', 3, 3, 1, 3, 2, 2); // a doubles -> 6, b -> 4 (tax), c doubles -> 4 (tax)
  assert.deepEqual(s.turn.rollers, ['a', 'c']);
  assert.equal(s.turn.bonus, true);
  s = answer(s, 'a', 'buy', 'pass');
  s = ready(s, 'b'); // b is done; nothing happens yet
  s = ready(s, 'a');
  assert.equal(player(s, 'a').position, 6); // waits for c
  s = ready(s, 'c', 1, 2, 2, 3); // a 6 -> 9, c 4 -> 9
  assert.equal(player(s, 'a').position, 9);
  assert.equal(player(s, 'c').position, 9);
  assert.equal(s.turn.number, 1);
  assert.deepEqual(s.turn.rollers, []);
});

test('lockup in party: jail prompt first, "roll" readies you', () => {
  let s = party();
  s.players[0].position = 25;
  s = ready(s, 'a');
  s = ready(s, 'b', 2, 3, 1, 2); // a -> 30 Busted!, b -> 3
  assert.equal(player(s, 'a').inJail, true);
  assert.ok(promptOf(s, 'a', 'jail'));
  assert.throws(() => ready(s, 'a'), /open decisions/);
  s = answer(s, 'a', 'jail', 'roll');
  assert.ok(s.turn.ready.includes('a'));
  s = answer(s, 'b', 'buy', 'pass');
  s = ready(s, 'b', 1, 2, 1, 2); // a fails doubles, stays; b -> 6
  assert.equal(player(s, 'a').position, 10);
  assert.equal(player(s, 'a').jailTurns, 1);
  assert.ok(promptOf(s, 'a', 'jail'));
});

test('turn limit ends the game; richest wins', () => {
  let s = party({ maxTurns: 20 });
  s.turn.number = 20; // fast-forward to the last turn
  s.properties[39].owner = 'b';
  s = ready(s, 'a');
  s = ready(s, 'b', 1, 2, 2, 4); // a -> 3, b -> 6
  s = answer(s, 'a', 'buy', 'pass');
  s = answer(s, 'b', 'buy', 'pass');
  s = ready(s, 'a');
  s = ready(s, 'b');
  assert.equal(s.phase, 'ended');
  assert.equal(s.winner, 'b');
});

test('turn timer: defaults are applied and everyone is readied', () => {
  let s = party({ turnTimer: 30 });
  assert.equal(s.turn.deadline, 30_000);
  s = ready(s, 'a');
  s = ready(s, 'b', 1, 2, 2, 4); // both get buy prompts; deadline now 1000 + 30s
  assert.equal(expireTurn(s, at(5000)), s); // too early: no-op
  s = expireTurn(s, at(31_000, 1, 1, 1, 2)); // passes, readies, starts turn 2 rolling
  assert.equal(s.properties[3].owner, null);
  assert.equal(s.turn.number, 2);
  assert.equal(player(s, 'a').position, 5);
});

test('jackpot collects fees and pays out on Harbor Rest', () => {
  let s = party({ jackpot: true });
  s.players[1].position = 14;
  s = ready(s, 'a');
  s = ready(s, 'b', 1, 3, 2, 4); // a -> 4 City Levy, b -> 20 Harbor Rest
  assert.equal(s.pot, 0);
  assert.equal(player(s, 'b').money, 1500 + SPACES[4].amount);
});

test('double salary when landing exactly on Start', () => {
  let s = party({ doubleOnStart: true, startSalary: 200 });
  s.players[0].position = 36;
  s = ready(s, 'a');
  s = ready(s, 'b', 1, 3, 1, 2); // a -> 0
  assert.equal(player(s, 'a').money, 1900);
});

test('time limit: richest by net worth wins', () => {
  let s = party({ timeLimit: 10 });
  assert.equal(s.endsAt, 10 * 60_000);
  s.properties[39].owner = 'b';
  s = endByTime(s);
  assert.equal(s.phase, 'ended');
  assert.equal(s.winner, 'b');
});

test('a bonus roll waits until every open landing decision is settled', () => {
  let s = newGame({ mode: 'party' });
  s = ready(s, 'a');
  s = ready(s, 'b', 3, 3, 1, 2); // a doubles -> 6, b -> 3
  assert.deepEqual(s.turn.rollers, ['a']);
  s = answer(s, 'a', 'buy', 'pass');
  s = ready(s, 'a');
  assert.equal(player(s, 'a').position, 6, 'bonus roll held while b is still deciding');
  assert.deepEqual(waitingOn(s), ['b']);
  s = answer(s, 'b', 'buy', 'buy', 1, 2); // b settles it -> a's bonus roll fires
  assert.equal(s.properties[3].owner, 'b');
  assert.equal(player(s, 'a').position, 9);
});
