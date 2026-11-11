import { useEffect, useRef } from 'react';
import { SPACES, GROUPS, BAIL, computeRent, waitingOn, raisableValue } from '@mopo/shared';
import { useGame, useMe, useServerNow } from '../net/store.js';

const nameOf = (state, id) => state.players.find((p) => p.id === id)?.name ?? '?';
const isParty = (state) => state.settings.mode === 'party';

// ---------------------------------------------------------------- players

function Players() {
  const state = useGame((g) => g.state);
  const playerId = useGame((g) => g.playerId);
  const party = isParty(state);
  const { turn } = state;
  return (
    <div className="panel players">
      {state.players.map((p, i) => {
        const active = !party && i === turn.current;
        const ready = turn.ready.includes(p.id);
        return (
          <div key={p.id} className={`player ${active ? 'active' : ''} ${p.bankrupt ? 'out' : ''}`}>
            <span className="swatch" style={{ background: p.color }} />
            <span className="name">
              {p.name}{p.id === playerId && ' (you)'}
              {!p.connected && <span className="tag">offline</span>}
              {p.inJail && <span className="tag">lockup</span>}
            </span>
            {party && !p.bankrupt && (
              <span className={`ready-dot ${ready ? 'on' : ''}`} title={ready ? 'Ready' : 'Not ready'}>{ready ? '✓' : '…'}</span>
            )}
            <span className={`money ${p.money < 0 ? 'neg' : ''}`}>${p.money}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- prompts

function BuyPrompt({ prompt, me, act }) {
  const space = SPACES[prompt.data.index];
  const group = GROUPS[space.group];
  return (
    <div className="prompt">
      <div className="prompt-band" style={{ background: group.color }}>{group.name}</div>
      <p>
        Buy <b>{space.name}</b> for ${space.price}?
        {prompt.data.contested && <span className="tag urgent">contested — first to buy wins</span>}
      </p>
      <div className="row">
        <button onClick={() => act({ type: 'answer', promptId: prompt.id, choice: 'buy' })} disabled={me.money < space.price}>
          Buy (B)
        </button>
        <button className="secondary" onClick={() => act({ type: 'answer', promptId: prompt.id, choice: 'pass' })}>
          Pass (P)
        </button>
      </div>
    </div>
  );
}

function JailPrompt({ prompt, me, act }) {
  const choose = (choice) => act({ type: 'answer', promptId: prompt.id, choice });
  return (
    <div className="prompt">
      <div className="prompt-band" style={{ background: '#3d3d3d' }}>Lockup</div>
      <p>
        You're in Lockup{me.jailTurns > 0 && ` (attempt ${me.jailTurns + 1} of 3)`}. How do you want to get out?
      </p>
      <div className="row wrap">
        <button onClick={() => choose('roll')}>Roll for doubles</button>
        <button className="secondary" onClick={() => choose('bail')} disabled={me.money < BAIL}>Pay ${BAIL}</button>
        {me.jailCards.length > 0 && <button className="secondary" onClick={() => choose('card')}>Use card</button>}
      </div>
    </div>
  );
}

function CardPrompt({ prompt, act }) {
  return (
    <div className={`prompt card-prompt ${prompt.data.deck}`}>
      <div className="deck">{prompt.data.deck === 'fortune' ? 'Fortune' : 'City Hall'}</div>
      <p>{prompt.data.text}</p>
      <button onClick={() => act({ type: 'answer', promptId: prompt.id, choice: 'ok' })}>OK (Enter)</button>
    </div>
  );
}

const PROMPTS = { buy: BuyPrompt, jail: JailPrompt, card: CardPrompt };

function PromptDock() {
  const state = useGame((g) => g.state);
  const act = useGame((g) => g.act);
  const me = useMe();
  if (!me) return null;
  const mine = state.prompts.filter((p) => p.player === me.id);
  if (!mine.length) return null;
  return (
    <div className="prompt-dock">
      {mine.map((p) => {
        const C = PROMPTS[p.kind];
        return C ? <C key={p.id} prompt={p} me={me} act={act} /> : null;
      })}
    </div>
  );
}

// ---------------------------------------------------------------- turn panel

function readyLabel(state, me) {
  const t = state.turn;
  const inRollers = t.rollers.includes(me.id);
  if (!isParty(state)) {
    if (inRollers) return t.bonus ? 'Roll again — doubles!' : 'Roll dice';
    return 'End turn';
  }
  if (t.bonus) return inRollers ? 'Ready — bonus roll!' : 'Ready for next turn';
  return 'Ready to roll';
}

function TurnPanel() {
  const state = useGame((g) => g.state);
  const act = useGame((g) => g.act);
  const me = useMe();
  if (!me || me.bankrupt) return <div className="panel actions"><p className="muted">Spectating</p></div>;

  const t = state.turn;
  const party = isParty(state);
  const myPrompts = state.prompts.filter((p) => p.player === me.id);
  const iAmReady = t.ready.includes(me.id);
  const waiting = waitingOn(state).filter((id) => id !== me.id);
  const myGo = party || state.players[t.current].id === me.id;
  const jailPending = myPrompts.some((p) => p.kind === 'jail');
  const canReady = myGo && !iAmReady && !myPrompts.length && me.money >= 0;

  let status;
  if (!party && !myGo) status = `${state.players[t.current].name}'s go`;
  else if (t.bonus && party) status = `Bonus roll: ${t.rollers.map((id) => nameOf(state, id)).join(', ')}`;
  else if (iAmReady && waiting.length) status = `Waiting for ${waiting.map((id) => nameOf(state, id)).join(', ')}`;
  else if (myPrompts.length) status = 'You have a decision to make';
  else status = party ? 'Do your thing, then ready up' : 'Your go';

  return (
    <div className="panel actions">
      <div className="turn-label">Turn {t.number}</div>
      <p className="muted small">{status}</p>
      {myGo && !jailPending && (
        iAmReady ? (
          <button className="secondary" onClick={() => act({ type: 'unready' })}>✓ Ready — click to undo</button>
        ) : (
          <button onClick={() => act({ type: 'ready' })} disabled={!canReady}>{readyLabel(state, me)} (Space)</button>
        )
      )}
      {me.money < 0 && (
        <>
          <p className="warn">
            You owe ${-me.money}. Selling and mortgaging everything would raise $
            {raisableValue(state, me.id) - me.money} — click your tiles to sell or mortgage, or:
          </p>
          <button className="danger" onClick={() => confirm('Declare bankruptcy?') && act({ type: 'bankrupt' })}>
            Declare bankruptcy
          </button>
        </>
      )}
      <p className="muted small">Build, sell and mortgage any time — click a tile.</p>
    </div>
  );
}

/** Space = ready, B/P = buy/pass, Enter = acknowledge card. */
function Hotkeys() {
  const state = useGame((g) => g.state);
  const act = useGame((g) => g.act);
  const me = useMe();
  const latest = useRef();
  latest.current = { state, me, act };
  useEffect(() => {
    const onKey = (e) => {
      const { state, me, act } = latest.current;
      if (!me || e.repeat || e.target instanceof HTMLInputElement) return;
      const mine = state.prompts.filter((p) => p.player === me.id);
      const buy = mine.find((p) => p.kind === 'buy');
      const card = mine.find((p) => p.kind === 'card');
      const myGo = isParty(state) || state.players[state.turn.current].id === me.id;
      if (e.code === 'Space') {
        e.preventDefault();
        if (myGo && !mine.length && !state.turn.ready.includes(me.id)) act({ type: 'ready' });
      }
      else if (e.key === 'b' && buy) act({ type: 'answer', promptId: buy.id, choice: 'buy' });
      else if (e.key === 'p' && buy) act({ type: 'answer', promptId: buy.id, choice: 'pass' });
      else if (e.key === 'Enter' && card) act({ type: 'answer', promptId: card.id, choice: 'ok' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return null;
}

// ---------------------------------------------------------------- info panels

function GameInfo() {
  const state = useGame((g) => g.state);
  const now = useServerNow(250);
  const { settings, endsAt, pot, turn } = state;
  const mmss = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
  const gameLeft = endsAt ? Math.max(0, endsAt - now) : null;
  const turnLeft = turn.deadline ? Math.max(0, turn.deadline - now) : null;
  return (
    <div className="game-info">
      <span className="tag">{isParty(state) ? 'Party' : 'Classic'}</span>
      <span className="tag">Turn {turn.number}{settings.maxTurns ? ` / ${settings.maxTurns}` : ''}</span>
      {turnLeft != null && <span className={`tag ${turnLeft < 10000 ? 'urgent' : ''}`}>Turn ⏱ {Math.ceil(turnLeft / 1000)}s</span>}
      {gameLeft != null && <span className={`tag ${gameLeft < 60000 ? 'urgent' : ''}`}>Game ⏱ {mmss(gameLeft)}</span>}
      {settings.jackpot && <span className="tag">Jackpot ${pot}</span>}
    </div>
  );
}

function SpaceInfo() {
  const selected = useGame((g) => g.selected);
  const state = useGame((g) => g.state);
  const act = useGame((g) => g.act);
  const setSelected = useGame((g) => g.setSelected);
  const me = useMe();
  if (selected == null) return null;
  const space = SPACES[selected];
  const prop = state.properties[selected];
  const owner = prop && state.players.find((p) => p.id === prop.owner);
  const mine = owner && me && owner.id === me.id;

  return (
    <div className="panel space-info">
      <button className="close" onClick={() => setSelected(null)}>×</button>
      {space.group && GROUPS[space.group] && (
        <div className="band" style={{ background: GROUPS[space.group].color }}>{GROUPS[space.group].name}</div>
      )}
      <h3>{space.name}</h3>
      {space.price != null && (
        <>
          <p>Price ${space.price} · Mortgage ${space.price / 2}</p>
          {space.type === 'street' && (
            <table className="rent">
              <tbody>
                {['Rent', '1 house', '2 houses', '3 houses', '4 houses', 'Hotel'].map((l, i) => (
                  <tr key={l} className={prop.owner && prop.houses === i ? 'hl' : ''}>
                    <td>{l}</td><td>${space.rent[i]}</td>
                  </tr>
                ))}
                <tr><td>Building cost</td><td>${space.houseCost}</td></tr>
              </tbody>
            </table>
          )}
          {space.type === 'transit' && <p>Rent: $25 / $50 / $100 / $200 for 1–4 lines owned.</p>}
          {space.type === 'utility' && <p>Rent: 4× dice roll, or 10× if both utilities are owned.</p>}
          <p>
            Owner: {owner ? <b style={{ color: owner.color }}>{owner.name}</b> : 'none'}
            {prop.mortgaged && <span className="tag">mortgaged</span>}
          </p>
          {owner && !prop.mortgaged && space.type !== 'utility' && <p>Current rent: ${computeRent(state, selected, 0)}</p>}
          {mine && (
            <div className="row wrap">
              {space.type === 'street' && <button onClick={() => act({ type: 'build', index: selected })}>Build</button>}
              {space.type === 'street' && prop.houses > 0 && (
                <button className="secondary" onClick={() => act({ type: 'sellHouse', index: selected })}>Sell building</button>
              )}
              {!prop.mortgaged
                ? <button className="secondary" onClick={() => act({ type: 'mortgage', index: selected })}>Mortgage</button>
                : <button onClick={() => act({ type: 'unmortgage', index: selected })}>Unmortgage</button>}
            </div>
          )}
        </>
      )}
      {space.type === 'tax' && <p>Pay ${space.amount} to the city.</p>}
      {space.type === 'card' && <p>Draw a {space.name} card.</p>}
    </div>
  );
}

function Log() {
  const log = useGame((g) => g.state.log);
  const ref = useRef();
  useEffect(() => { ref.current?.scrollTo(0, ref.current.scrollHeight); }, [log]);
  return (
    <div className="panel log" ref={ref}>
      {log.map((l, i) => <div key={i} className={l.startsWith('—') ? 'log-turn' : ''}>{l}</div>)}
    </div>
  );
}

export function Toast() {
  const error = useGame((g) => g.error);
  const clear = useGame((g) => g.clearError);
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(clear, 3000);
    return () => clearTimeout(t);
  }, [error, clear]);
  return error ? <div className="toast" onClick={clear}>{error}</div> : null;
}

function GameOver() {
  const state = useGame((g) => g.state);
  const leave = useGame((g) => g.leaveRoom);
  if (state.phase !== 'ended') return null;
  const w = state.players.find((p) => p.id === state.winner);
  return (
    <div className="center-screen overlay">
      <div className="card lobby">
        <h2>{w?.name} wins!</h2>
        <p className="muted">After {state.turn.number} turns.</p>
        <button onClick={leave}>Back to lobby</button>
      </div>
    </div>
  );
}

export default function Hud() {
  const code = useGame((g) => g.code);
  const connected = useGame((g) => g.connected);
  return (
    <div className="hud">
      <div className="top-left">
        <div className="panel room">
          Room <b>{code}</b>{!connected && <span className="tag">reconnecting…</span>}
          <GameInfo />
        </div>
        <Players />
      </div>
      <div className="top-right"><SpaceInfo /></div>
      <div className="bottom-left"><Log /></div>
      <div className="bottom-right"><TurnPanel /></div>
      <div className="bottom-center"><PromptDock /></div>
      <Hotkeys />
      <Toast />
      <GameOver />
    </div>
  );
}
