import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, expireTurn, waitingOn, MAX_OPEN_TRADES, mortgageTransferFee } from './engine.js';
import { newGame, player, promptOf, ready, at } from './testkit.js';

const act = (s, id, action) => applyAction(s, id, action, at(1000));
const propose = (s, from, to, give, get, extra = {}) => act(s, from, { type: 'proposeTrade', to, give, get, ...extra });
const reply = (s, id, choice) => act(s, id, { type: 'answer', promptId: promptOf(s, id, 'trade').id, choice });

function withProps(settings = {}, names = ['a', 'b', 'c']) {
  const s = newGame(settings, names);
  s.properties[1].owner = 'a'; // Rope Walk
  s.properties[3].owner = 'a'; // Net Mender Row (Dockside set)
  s.properties[11].owner = 'b'; // Mural Mile
  s.properties[13].owner = 'b'; // Gallery Steps
  return s;
}

test('propose → accept swaps properties and cash, and is announced publicly', () => {
  let s = withProps();
  s = propose(s, 'a', 'b', { properties: [3], cash: 50 }, { properties: [11] });
  assert.equal(s.trades.length, 1);
  assert.ok(promptOf(s, 'b', 'trade'));
  assert.match(s.log.at(-1), /A offers B: Net Mender Row \+ \$50 for Mural Mile/);
  s = reply(s, 'b', 'accept');
  assert.equal(s.properties[3].owner, 'b');
  assert.equal(s.properties[11].owner, 'a');
  assert.equal(player(s, 'a').money, 1450);
  assert.equal(player(s, 'b').money, 1550);
  assert.equal(s.trades.length, 0);
  assert.match(s.log.at(-1), /Trade done!/);
});

test('any property can be traded on its own, but not one with buildings', () => {
  let s = withProps();
  s.properties[1].houses = 1; // a has a house on Rope Walk (set split after trade is allowed)
  assert.throws(() => propose(s, 'a', 'b', { properties: [1] }, { cash: 100 }), /buildings/);
  s = propose(s, 'a', 'b', { properties: [3] }, { cash: 100 }); // the other street of the set is fine
  s = reply(s, 'b', 'accept');
  assert.equal(s.properties[3].owner, 'b');
  assert.equal(s.properties[1].houses, 1);
});

test('mortgaged property moves as-is and the receiver pays a 10% fee', () => {
  let s = withProps();
  s.properties[11].mortgaged = true; // Mural Mile, price 140 → fee 7
  s = propose(s, 'a', 'b', { cash: 10 }, { properties: [11] });
  s = reply(s, 'b', 'accept');
  assert.equal(s.properties[11].owner, 'a');
  assert.equal(s.properties[11].mortgaged, true);
  assert.equal(mortgageTransferFee(11), 7);
  assert.equal(player(s, 'a').money, 1500 - 10 - 7);
});

test('trades are re-checked on accept and cancelled if they no longer work', () => {
  let s = withProps();
  s = propose(s, 'a', 'b', { cash: 1000 }, { properties: [11] });
  player(s, 'a').money = 200; // a spent money elsewhere
  s = reply(s, 'b', 'accept');
  assert.equal(s.properties[11].owner, 'b');
  assert.equal(s.trades.length, 0);
  assert.match(s.log.at(-1), /Trade cancelled: A doesn't have \$1000/);
});

test('reject, withdraw, counter', () => {
  let s = withProps();
  s = propose(s, 'a', 'b', {}, { properties: [11] });
  s = reply(s, 'b', 'reject');
  assert.equal(s.trades.length, 0);

  s = propose(s, 'a', 'b', { cash: 20 }, { properties: [11] });
  assert.throws(() => act(s, 'b', { type: 'withdrawTrade', tradeId: s.trades[0].id }), /no longer open/);
  s = act(s, 'a', { type: 'withdrawTrade', tradeId: s.trades[0].id });
  assert.equal(s.trades.length, 0);
  assert.equal(promptOf(s, 'b', 'trade'), undefined);

  s = propose(s, 'a', 'b', { cash: 20 }, { properties: [11] });
  const original = s.trades[0].id;
  s = propose(s, 'b', 'a', { properties: [11] }, { cash: 90 }, { counterTo: original });
  assert.equal(s.trades.length, 1);
  assert.equal(s.trades[0].from, 'b');
  s = reply(s, 'a', 'accept');
  assert.equal(s.properties[11].owner, 'a');
  assert.equal(player(s, 'b').money, 1590);
});

test('at most MAX_OPEN_TRADES open offers per player; repeats are fine', () => {
  let s = withProps();
  for (let n = 0; n < MAX_OPEN_TRADES; n++) s = propose(s, 'a', 'b', { cash: 5 }, { properties: [11] });
  assert.equal(s.trades.length, MAX_OPEN_TRADES);
  assert.throws(() => propose(s, 'a', 'c', { cash: 5 }, {}), /at most/);
});

test('neither side can ready until the trade concludes; proposing un-readies the recipient', () => {
  let s = withProps({ mode: 'party' });
  s = ready(s, 'b');
  s = propose(s, 'a', 'b', { cash: 5 }, { properties: [11] });
  assert.ok(!s.turn.ready.includes('b'), 'b was un-readied');
  assert.throws(() => ready(s, 'a'), /open trade/);
  assert.throws(() => ready(s, 'b'), /open decisions|open trade/);
  s = ready(s, 'c');
  assert.equal(player(s, 'c').position, 0, 'nobody rolls while the trade is open');
  s = reply(s, 'b', 'reject');
  s = ready(s, 'a');
  s = ready(s, 'b', 1, 2, 1, 2, 1, 2); // trade concluded → everyone ready → roll
  assert.equal(player(s, 'b').position, 3);
});

test('counters keep both players blocked until the new offer concludes', () => {
  let s = withProps({ mode: 'party' });
  s = propose(s, 'a', 'b', { cash: 5 }, { properties: [11] });
  s = propose(s, 'b', 'a', { properties: [11] }, { cash: 50 }, { counterTo: s.trades[0].id });
  assert.throws(() => ready(s, 'a'), /open decisions|open trade/);
  assert.throws(() => ready(s, 'b'), /open trade/);
  s = act(s, 'b', { type: 'withdrawTrade', tradeId: s.trades[0].id });
  s = ready(s, 'a');
  s = ready(s, 'b');
  assert.deepEqual(s.turn.ready.sort(), ['a', 'b']);
});

test('the turn timer breaks a trade stall by rejecting open offers', () => {
  let s = withProps({ mode: 'party', turnTimer: 30 });
  s = propose(s, 'a', 'b', { cash: 5 }, { properties: [11] });
  s = expireTurn(s, at(60_000, 1, 2, 1, 2, 1, 2));
  assert.equal(s.trades.length, 0);
  assert.equal(player(s, 'a').position, 3, 'everyone readied and rolled');
});

test('drafting blocks ready; ready players must un-ready to draft or propose', () => {
  let s = withProps({ mode: 'party' });
  s = act(s, 'a', { type: 'tradeDraft', on: true });
  assert.throws(() => ready(s, 'a'), /trade offer first/);
  s = act(s, 'a', { type: 'tradeDraft', on: false }); // cancelling ends drafting
  s = ready(s, 'a');
  assert.throws(() => act(s, 'a', { type: 'tradeDraft', on: true }), /Un-ready/);
  assert.throws(() => propose(s, 'a', 'c', { cash: 5 }, {}), /Un-ready/);
  s = act(s, 'a', { type: 'unready' });
  s = act(s, 'a', { type: 'tradeDraft', on: true });
  s = propose(s, 'a', 'b', { cash: 5 }, { properties: [11] }); // proposing ends drafting
  assert.equal(player(s, 'a').drafting, false);
});

test('classic: a trade between other players holds up the end of the turn', () => {
  let s = withProps({}, ['a', 'b', 'c']);
  s = ready(s, 'a', 1, 2); // a -> 3 (owns it)
  s = propose(s, 'b', 'c', { properties: [11] }, { cash: 100 });
  s = ready(s, 'a'); // a presses End turn
  assert.equal(s.players[s.turn.current].id, 'a', "still a's go");
  assert.deepEqual(waitingOn(s).sort(), ['b', 'c']);
  s = reply(s, 'c', 'accept');
  assert.equal(s.players[s.turn.current].id, 'b', 'trade done → turn moves on');
});

test('Lockup cards can be traded; bankruptcy cancels open offers', () => {
  let s = withProps();
  player(s, 'b').jailCards = ['fortune'];
  s = propose(s, 'a', 'b', { cash: 30 }, { jailCards: 1 });
  s = reply(s, 'b', 'accept');
  assert.deepEqual(player(s, 'a').jailCards, ['fortune']);

  s = propose(s, 'a', 'c', { cash: 30 }, {});
  s = act(s, 'c', { type: 'bankrupt' });
  assert.equal(s.trades.length, 0);
});
