import { SPACES, GROUPS, OWNABLE, groupMembers, mortgageTransferFee } from '@mopo/shared';
import { useGame, useMe } from '../net/store.js';

const nameOf = (state, id) => state.players.find((p) => p.id === id)?.name ?? '?';

function sideText(side) {
  const parts = side.properties.map((i) => SPACES[i].name);
  if (side.cash) parts.push(`$${side.cash}`);
  if (side.jailCards) parts.push(`${side.jailCards} Lockup card${side.jailCards > 1 ? 's' : ''}`);
  return parts.join(' + ') || 'nothing';
}

/** Colour sets `receiverId` would complete by receiving `properties`. */
function completedSets(state, receiverId, properties) {
  const groups = new Set(properties.map((i) => SPACES[i].group).filter((g) => SPACES.find((x) => x.group === g)?.type === 'street'));
  return [...groups].filter((g) =>
    groupMembers(g).every((i) => properties.includes(i) || state.properties[i].owner === receiverId)).map((g) => GROUPS[g].name);
}

export function PropChip({ index, state, selected, onClick, disabledReason }) {
  const space = SPACES[index];
  const prop = state.properties[index];
  const group = GROUPS[space.group];
  return (
    <button
      type="button"
      className={`prop-chip ${selected ? 'on' : ''}`}
      style={{ '--band': group.color }}
      onClick={onClick}
      disabled={!!disabledReason}
      title={disabledReason || `${space.name} — $${space.price}${prop.mortgaged ? ' (mortgaged)' : ''}`}
    >
      <span className="chip-name">{space.name}</span>
      <span className="chip-meta">
        ${space.price}
        {prop.mortgaged && <b className="chip-flag">M</b>}
        {prop.houses > 0 && <b className="chip-flag">🏠{prop.houses}</b>}
      </span>
    </button>
  );
}

function SideEditor({ title, owner, side, onChange, state }) {
  const owned = OWNABLE.filter((i) => state.properties[i].owner === owner.id);
  const toggle = (i) =>
    onChange((cur) => ({ ...cur, properties: cur.properties.includes(i) ? cur.properties.filter((x) => x !== i) : [...cur.properties, i] }));
  return (
    <div className="trade-side">
      <h4>{title}</h4>
      <div className="chips">
        {owned.length ? owned.map((i) => (
          <PropChip
            key={i}
            index={i}
            state={state}
            selected={side.properties.includes(i)}
            onClick={() => toggle(i)}
            disabledReason={state.properties[i].houses > 0 ? 'Sell the buildings on it first' : null}
          />
        )) : <p className="muted small">No properties</p>}
      </div>
      <label className="trade-field">
        Cash
        <input
          type="number"
          min={0}
          max={Math.max(0, owner.money)}
          value={side.cash || ''}
          placeholder={`$0 – $${Math.max(0, owner.money)}`}
          onChange={(e) => { const cash = Math.max(0, Math.floor(Number(e.target.value) || 0)); onChange((cur) => ({ ...cur, cash })); }}
        />
      </label>
      {owner.jailCards.length > 0 && (
        <label className="trade-field">
          Lockup cards
          <input
            type="number"
            min={0}
            max={owner.jailCards.length}
            value={side.jailCards || ''}
            placeholder={`0 – ${owner.jailCards.length}`}
            onChange={(e) => { const jailCards = Math.min(owner.jailCards.length, Math.max(0, Math.floor(Number(e.target.value) || 0))); onChange((cur) => ({ ...cur, jailCards })); }}
          />
        </label>
      )}
    </div>
  );
}

/** Modal for building (or countering) an offer. */
export function TradeBuilder() {
  const draft = useGame((g) => g.tradeDraft);
  const state = useGame((g) => g.state);
  const { closeTrade, sendTrade } = useGame();
  const me = useMe();
  if (!draft || !me) return null;
  // Functional update so quick successive clicks don't overwrite each other.
  const set = (patch) => useGame.setState((g) => ({ tradeDraft: { ...g.tradeDraft, ...patch } }));
  const updateSide = (key, fn) => useGame.setState((g) => ({ tradeDraft: { ...g.tradeDraft, [key]: fn(g.tradeDraft[key]) } }));
  const partners = state.players.filter((p) => p.id !== me.id && !p.bankrupt);
  const partner = state.players.find((p) => p.id === draft.to);
  const fees = (props) => props.filter((i) => state.properties[i].mortgaged).reduce((s, i) => s + mortgageTransferFee(i), 0);
  const empty = !draft.give.properties.length && !draft.give.cash && !draft.give.jailCards
    && !draft.get.properties.length && !draft.get.cash && !draft.get.jailCards;
  const theyComplete = partner ? completedSets(state, partner.id, draft.give.properties) : [];

  return (
    <div className="modal-backdrop">
      <div className="card trade-builder" role="dialog" aria-label="Trade offer">
        <h3>{draft.counterTo ? 'Counter-offer' : 'Propose a trade'}</h3>
        {!draft.counterTo && (
          <div className="row wrap partner-pick">
            {partners.map((p) => (
              <button
                key={p.id}
                className={`partner ${draft.to === p.id ? 'on' : ''}`}
                onClick={() => set({ to: p.id, get: { properties: [], cash: 0, jailCards: 0 } })}
              >
                <span className="swatch" style={{ background: p.color }} /> {p.bot && '🤖 '}{p.name}
              </button>
            ))}
          </div>
        )}
        {partner ? (
          <>
            <div className="trade-grid">
              <SideEditor title="You give" owner={me} side={draft.give} onChange={(fn) => updateSide('give', fn)} state={state} />
              <SideEditor title={`You get from ${partner.name}`} owner={partner} side={draft.get} onChange={(fn) => updateSide('get', fn)} state={state} />
            </div>
            <p className="trade-summary">
              <b>{sideText(draft.give)}</b> for <b>{sideText(draft.get)}</b>
            </p>
            {fees(draft.get.properties) > 0 && <p className="muted small">You'll pay ${fees(draft.get.properties)} in 10% fees on mortgaged property.</p>}
            {theyComplete.length > 0 && <p className="warn small">This completes {partner.name}'s {theyComplete.join(', ')} set.</p>}
          </>
        ) : (
          <p className="muted">Pick who to trade with.</p>
        )}
        <div className="row">
          <button className="secondary" onClick={closeTrade}>Cancel</button>
          <button
            disabled={!partner || empty}
            onClick={() => sendTrade({ to: draft.to, give: draft.give, get: draft.get, counterTo: draft.counterTo })}
          >
            Send offer
          </button>
        </div>
      </div>
    </div>
  );
}

/** An offer made to you. */
export function TradePrompt({ prompt, me, act }) {
  const state = useGame((g) => g.state);
  const openTrade = useGame((g) => g.openTrade);
  const trade = state.trades.find((t) => t.id === prompt.data.tradeId);
  if (!trade) return null;
  const from = state.players.find((p) => p.id === trade.from);
  const fee = trade.give.properties.filter((i) => state.properties[i].mortgaged).reduce((s, i) => s + mortgageTransferFee(i), 0);
  const theyComplete = completedSets(state, from.id, trade.get.properties);
  const iComplete = completedSets(state, me.id, trade.give.properties);
  const iAmReady = state.turn.ready.includes(me.id);
  const answer = (choice) => act({ type: 'answer', promptId: prompt.id, choice });
  const counter = () => openTrade({
    to: from.id,
    give: { ...trade.get },
    get: { ...trade.give },
    counterTo: trade.id,
  });
  return (
    <div className="prompt trade-prompt">
      <div className="prompt-band" style={{ background: from.color }}>Trade offer from {from.name}</div>
      <div className="trade-columns">
        <div><span className="muted-ink">You get</span><p><b>{sideText(trade.give)}</b></p></div>
        <div><span className="muted-ink">You give</span><p><b>{sideText(trade.get)}</b></p></div>
      </div>
      {fee > 0 && <p className="muted-ink">Includes a ${fee} fee for mortgaged property.</p>}
      {iComplete.length > 0 && <p className="good small">Completes your {iComplete.join(', ')} set!</p>}
      {theyComplete.length > 0 && <p className="bad small">Completes {from.name}'s {theyComplete.join(', ')} set.</p>}
      <div className="row wrap">
        <button onClick={() => answer('accept')}>Accept</button>
        <button className="secondary" onClick={() => answer('reject')}>Reject</button>
        <button className="secondary" onClick={counter} disabled={iAmReady} title={iAmReady ? 'Un-ready to counter' : undefined}>
          Counter
        </button>
      </div>
    </div>
  );
}

/** Public list of open offers. */
export function OpenTrades() {
  const state = useGame((g) => g.state);
  const playerId = useGame((g) => g.playerId);
  const act = useGame((g) => g.act);
  if (!state.trades.length) return null;
  return (
    <div className="panel open-trades">
      <h4>Open offers</h4>
      {state.trades.map((t) => (
        <div key={t.id} className="open-trade">
          <span>
            <b>{nameOf(state, t.from)}</b> → <b>{nameOf(state, t.to)}</b>: {sideText(t.give)} for {sideText(t.get)}
          </span>
          {t.from === playerId && (
            <button className="icon-btn" title="Withdraw" onClick={() => act({ type: 'withdrawTrade', tradeId: t.id })}>×</button>
          )}
        </div>
      ))}
      <p className="muted small">Trades must be settled before anyone involved can ready up — and before the turn can end.</p>
    </div>
  );
}
