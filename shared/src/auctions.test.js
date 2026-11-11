import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, tickAuctions, nextAuctionDeadline, waitingOn, expireTurn } from './engine.js';
import { newGame, player, promptOf, ready, answer, at } from './testkit.js';

const bid = (s, id, amount, now = 1000) =>
  applyAction(s, id, { type: 'answer', promptId: promptOf(s, id, 'auction').id, choice: { bid: amount } }, at(now));
const pass = (s, id, now = 1000) =>
  applyAction(s, id, { type: 'answer', promptId: promptOf(s, id, 'auction').id, choice: 'pass' }, at(now));

/** Classic game where 'a' lands on Lantern Alley (6, $100) and passes on it. */
function passedStreet(settings = {}, names = ['a', 'b', 'c']) {
  let s = newGame({ auctions: true, ...settings }, names);
  s = ready(s, 'a', 2, 4);
  return answer(s, 'a', 'buy', 'pass');
}

// ---------------------------------------------------------------- live

test('live: a passed street is auctioned to everyone but the passer', () => {
  const s = passedStreet({ auctionFormat: 'live', liveBidTime: 6 });
  assert.equal(s.auctions.length, 1);
  const a = s.auctions[0];
  assert.equal(a.reason, 'passed');
  assert.deepEqual(a.participants, ['b', 'c']);
  assert.equal(promptOf(s, 'a', 'auction'), undefined);
  assert.equal(a.endsAt, 1000 + 6000);
});

test('live: bids must climb; countdown restarts; clock expiry sells to the high bidder', () => {
  let s = passedStreet({ auctionFormat: 'live', liveBidTime: 6 });
  assert.throws(() => bid(s, 'b', 5), /at least \$10/);
  s = bid(s, 'b', 40, 2000);
  assert.equal(s.auctions[0].endsAt, 8000);
  assert.throws(() => bid(s, 'c', 40, 2500), /at least \$41/);
  assert.throws(() => bid(s, 'b', 60, 2500), /already the high bidder/);
  assert.throws(() => pass(s, 'b', 2500), /can't drop out/);
  s = bid(s, 'c', 55, 3000);
  assert.equal(nextAuctionDeadline(s), 9000);
  assert.equal(tickAuctions(s, at(8000)), s, 'not yet');
  s = tickAuctions(s, at(9000));
  assert.equal(s.properties[6].owner, 'c');
  assert.equal(player(s, 'c').money, 1500 - 55);
  assert.equal(s.auctions.length, 0);
});

test('live: ends early once everyone else drops out', () => {
  let s = passedStreet({ auctionFormat: 'live' });
  s = bid(s, 'b', 30);
  s = pass(s, 'c');
  assert.equal(s.properties[6].owner, 'b');
  assert.equal(player(s, 'b').money, 1470);
});

test('live: nobody bids → stays with the bank', () => {
  let s = passedStreet({ auctionFormat: 'live' });
  s = pass(s, 'b');
  s = pass(s, 'c');
  assert.equal(s.properties[6].owner, null);
  assert.equal(s.auctions.length, 0);
});

test('the turn cannot end while an auction is running', () => {
  let s = passedStreet({ auctionFormat: 'live' });
  s = ready(s, 'a'); // a presses End turn
  assert.equal(s.players[s.turn.current].id, 'a', 'still a\'s go');
  assert.deepEqual(waitingOn(s).sort(), ['b', 'c']);
  s = pass(s, 'b');
  s = pass(s, 'c');
  assert.equal(s.players[s.turn.current].id, 'b', 'auction over → turn moves on');
});

// ---------------------------------------------------------------- sealed

const four = ['a', 'b', 'c', 'd', 'e'];

test('sealed: wave 1 keeps the top 3 (ties advance), wave 2 the top 2, wave 3 picks the winner', () => {
  let s = passedStreet({ auctionFormat: 'sealed' }, four); // bidders b, c, d, e
  s = bid(s, 'b', 100);
  s = bid(s, 'c', 90);
  s = bid(s, 'd', 90);
  assert.equal(s.auctions[0].wave, 1, 'waits for everyone');
  s = bid(s, 'e', 50);
  let a = s.auctions[0];
  assert.equal(a.wave, 2);
  assert.deepEqual(a.participants, ['b', 'c', 'd'], 'tie for 3rd: both advance; e is out');
  assert.equal(a.lastTopBid, 100);
  assert.equal(promptOf(s, 'e', 'auction'), undefined);

  s = bid(s, 'b', 120);
  s = bid(s, 'c', 110);
  s = bid(s, 'd', 110);
  a = s.auctions[0];
  assert.equal(a.wave, 3);
  assert.deepEqual(a.participants, ['b', 'c', 'd'], 'tie for 2nd: all three advance');

  s = bid(s, 'd', 130); // d locks in first
  s = bid(s, 'b', 130);
  s = bid(s, 'c', 100);
  assert.equal(s.properties[6].owner, 'd', 'final tie goes to whoever locked in first');
  assert.equal(player(s, 'd').money, 1500 - 130);
});

test('sealed: a single bidder left after a wave wins at their bid', () => {
  let s = passedStreet({ auctionFormat: 'sealed' });
  s = bid(s, 'b', 70);
  s = pass(s, 'c');
  assert.equal(s.properties[6].owner, 'b');
  assert.equal(player(s, 'b').money, 1430);
});

test('sealed: if everyone passes in a later wave, the previous leader wins', () => {
  let s = passedStreet({ auctionFormat: 'sealed' });
  s = bid(s, 'b', 60);
  s = bid(s, 'c', 80);
  assert.equal(s.auctions[0].wave, 2);
  s = pass(s, 'b');
  s = pass(s, 'c');
  assert.equal(s.properties[6].owner, 'c');
  assert.equal(player(s, 'c').money, 1420);
});

test('sealed: one bid per wave, and never more than your cash', () => {
  let s = passedStreet({ auctionFormat: 'sealed' });
  assert.throws(() => bid(s, 'b', 5000), /more than your cash/);
  s = bid(s, 'b', 60);
  assert.equal(promptOf(s, 'b', 'auction'), undefined, 'locked in: decision done for this wave');
});

// ---------------------------------------------------------------- contested + timers

test('contested landings auction even when passed-street auctions are off', () => {
  let s = newGame({ mode: 'party', auctions: false, auctionFormat: 'sealed' });
  s = ready(s, 'a');
  s = ready(s, 'b', 2, 4, 1, 5); // both -> 6
  assert.equal(s.auctions[0].reason, 'contested');
  s = bid(s, 'a', 90);
  s = bid(s, 'b', 120);
  s = bid(s, 'a', 150); // wave 2 (only two bidders: both advance)
  s = bid(s, 'b', 140);
  s = bid(s, 'a', 150); // wave 3
  s = bid(s, 'b', 160);
  assert.equal(s.properties[6].owner, 'b');
});

test('turn timer: live auctions close at the current high bid; sealed bidders pass', () => {
  let s = passedStreet({ auctionFormat: 'live', turnTimer: 30 });
  s = bid(s, 'b', 25);
  s = expireTurn(s, at(60_000));
  assert.equal(s.properties[6].owner, 'b');

  let t = passedStreet({ auctionFormat: 'sealed', turnTimer: 30 });
  t = bid(t, 'b', 40);
  t = expireTurn(t, at(60_000)); // c auto-passes → b wins
  assert.equal(t.properties[6].owner, 'b');
});

test('bankrupt bidders leave the auction', () => {
  let s = passedStreet({ auctionFormat: 'live' });
  s = bid(s, 'b', 40);
  s = applyAction(s, 'b', { type: 'bankrupt' }, at(1500));
  assert.equal(s.auctions[0].highBidder, null);
  assert.deepEqual(s.auctions[0].participants, ['c']);
});
