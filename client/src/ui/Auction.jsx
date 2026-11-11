import { useState } from 'react';
import { SPACES, GROUPS, LIVE_MIN_BID } from '@mopo/shared';
import { useGame, useServerNow } from '../net/store.js';

const nameOf = (state, id) => state.players.find((p) => p.id === id)?.name ?? '?';

// The server never sends sealed bid amounts, so remember our own locally.
const myBids = new Map(); // `${auctionId}:${wave}` -> amount

function Header({ auction }) {
  const space = SPACES[auction.index];
  const group = GROUPS[space.group];
  const label = auction.format === 'live' ? 'Live auction' : `Sealed auction · wave ${auction.wave} of 3`;
  return (
    <>
      <div className="prompt-band" style={{ background: group.color }}>
        {label}{auction.reason === 'contested' && ' · contested'}
      </div>
      <p>
        <b>{space.name}</b> <span className="muted-ink">(list price ${space.price})</span>
      </p>
    </>
  );
}

function Countdown({ endsAt, total }) {
  const now = useServerNow(100);
  const left = Math.max(0, endsAt - now);
  return (
    <div className="countdown">
      <div className="meter"><div style={{ width: `${(left / total) * 100}%` }} /></div>
      <span>{(left / 1000).toFixed(1)}s</span>
    </div>
  );
}

function LiveBidding({ auction, prompt, me, act }) {
  const state = useGame((g) => g.state);
  const [custom, setCustom] = useState('');
  const winning = auction.highBidder === me.id;
  const min = Math.max(LIVE_MIN_BID, auction.highBid + 1);
  const quick = [10, 50, 100].map((inc) => (auction.highBid ? auction.highBid + inc : Math.max(LIVE_MIN_BID, inc)));
  const send = (amount) => act({ type: 'answer', promptId: prompt.id, choice: { bid: amount } });

  return (
    <>
      <p className="high-bid">
        {auction.highBidder
          ? <>High bid <b>${auction.highBid}</b> — {winning ? 'you!' : nameOf(state, auction.highBidder)}</>
          : 'No bids yet'}
      </p>
      <Countdown endsAt={auction.endsAt} total={state.settings.liveBidTime * 1000} />
      {winning ? (
        <p className="muted-ink">You're the high bidder — hold on!</p>
      ) : (
        <>
          <div className="row wrap">
            {quick.map((amount) => (
              <button key={amount} onClick={() => send(amount)} disabled={amount > me.money}>${amount}</button>
            ))}
          </div>
          <form className="row" onSubmit={(e) => { e.preventDefault(); send(Number(custom)); setCustom(''); }}>
            <input type="number" min={min} max={me.money} placeholder={`$${min}+`} value={custom} onChange={(e) => setCustom(e.target.value)} />
            <button type="submit" disabled={!custom}>Bid</button>
            <button type="button" className="secondary" onClick={() => act({ type: 'answer', promptId: prompt.id, choice: 'pass' })}>
              Drop out
            </button>
          </form>
        </>
      )}
    </>
  );
}

function SealedBidding({ auction, prompt, me, act }) {
  const [amount, setAmount] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    const n = Math.floor(Number(amount));
    if (await act({ type: 'answer', promptId: prompt.id, choice: { bid: n } })) myBids.set(`${auction.id}:${auction.wave}`, n);
  };
  return (
    <>
      {auction.lastTopBid != null && <p className="muted-ink">Top bid last wave: <b>${auction.lastTopBid}</b></p>}
      <p className="muted-ink">
        {auction.wave === 1 ? 'Top 3 advance.' : auction.wave === 2 ? 'Top 2 advance.' : 'Highest bid wins (ties: first to lock in).'}
        {' '}Bids are secret.
      </p>
      <form className="row" onSubmit={submit}>
        <input type="number" min={1} max={me.money} placeholder={`$1 – $${me.money}`} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        <button type="submit" disabled={!amount}>Lock in</button>
        <button type="button" className="secondary" onClick={() => act({ type: 'answer', promptId: prompt.id, choice: 'pass' })}>
          Pass
        </button>
      </form>
    </>
  );
}

/** Your open auction decision. */
export function AuctionPrompt({ prompt, me, act }) {
  const auction = useGame((g) => g.state.auctions.find((a) => a.id === prompt.data.auctionId));
  if (!auction) return null;
  return (
    <div className="prompt auction-prompt">
      <Header auction={auction} />
      {auction.format === 'live'
        ? <LiveBidding auction={auction} prompt={prompt} me={me} act={act} />
        : <SealedBidding auction={auction} prompt={prompt} me={me} act={act} />}
    </div>
  );
}

/** Read-only view for auctions you're watching (or have already locked in for). */
export function AuctionWatch({ auction, me }) {
  const state = useGame((g) => g.state);
  const inIt = auction.participants.includes(me?.id);
  const names = (ids) => ids.map((id) => nameOf(state, id)).join(', ');
  let body;
  if (auction.format === 'live') {
    body = (
      <>
        <p className="high-bid">
          {auction.highBidder ? <>High bid <b>${auction.highBid}</b> — {nameOf(state, auction.highBidder)}</> : 'No bids yet'}
        </p>
        <Countdown endsAt={auction.endsAt} total={state.settings.liveBidTime * 1000} />
        <p className="muted-ink">Bidding: {names(auction.participants)}</p>
      </>
    );
  } else {
    const waiting = auction.participants.filter((id) => !auction.lockedIn?.includes(id));
    const mine = myBids.get(`${auction.id}:${auction.wave}`);
    body = (
      <>
        {inIt && mine != null && <p>Your bid: <b>${mine}</b> — locked in ✓</p>}
        {auction.lastTopBid != null && <p className="muted-ink">Top bid last wave: ${auction.lastTopBid}</p>}
        <p className="muted-ink">Waiting on: {names(waiting) || '—'}</p>
      </>
    );
  }
  return (
    <div className="prompt auction-prompt watching">
      <Header auction={auction} />
      {body}
    </div>
  );
}
