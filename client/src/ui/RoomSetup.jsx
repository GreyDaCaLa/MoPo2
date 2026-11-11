import { useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { TOKENS, PLAYER_COLORS, RULES, ruleApplies } from '@mopo/shared';
import { useGame, useMe } from '../net/store.js';
import TokenModel from '../three/TokenModel.jsx';

// ---------------------------------------------------------------- piece picker

const COLS = 4;
const slotPos = (i) => [((i % COLS) - (COLS - 1) / 2) * 0.62, 0, (Math.floor(i / COLS) - 0.5) * 0.75];

function PickerSlot({ token, index, me, owner, onPick }) {
  const ref = useRef();
  const [hover, setHover] = useState(false);
  const mine = me.token === token.id;
  const taken = owner && !mine;
  const color = taken ? owner.color : me.color;

  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    g.rotation.y += dt * (mine ? 1.6 : hover && !taken ? 0.8 : 0);
    const lift = mine ? 0.08 : hover && !taken ? 0.04 : 0;
    g.position.y += (lift - g.position.y) * Math.min(1, dt * 10);
  });

  return (
    <group position={slotPos(index)}>
      <mesh
        position={[0, -0.02, 0]}
        onClick={(e) => { e.stopPropagation(); if (!taken) onPick(token.id); }}
        onPointerOver={(e) => { e.stopPropagation(); setHover(true); document.body.style.cursor = taken ? 'not-allowed' : 'pointer'; }}
        onPointerOut={() => { setHover(false); document.body.style.cursor = ''; }}
      >
        <cylinderGeometry args={[0.24, 0.26, 0.04, 32]} />
        <meshStandardMaterial
          color={mine ? '#ffd166' : '#2b3646'}
          emissive={mine ? '#ffb703' : '#000000'}
          emissiveIntensity={mine ? 0.3 : 0}
        />
      </mesh>
      <group ref={ref} scale={1.5}>
        <TokenModel token={token.id} color={color} />
      </group>
    </group>
  );
}

function PiecePicker() {
  const state = useGame((g) => g.state);
  const customize = useGame((g) => g.customize);
  const me = useMe();
  if (!me) return null;
  const ownerOf = (tokenId) => state.players.find((p) => p.token === tokenId);
  const colorOwner = (c) => state.players.find((p) => p.color === c);

  return (
    <section className="card setup-section">
      <h3>Your piece</h3>
      <div className="picker-canvas">
        <Canvas camera={{ position: [0, 1.5, 2.4], fov: 38 }} dpr={[1, 2]}>
          <hemisphereLight args={['#ffffff', '#334', 1.1]} />
          <directionalLight position={[2, 4, 3]} intensity={1.6} />
          <group position={[0, -0.25, 0]}>
            {TOKENS.map((t, i) => (
              <PickerSlot key={t.id} token={t} index={i} me={me} owner={ownerOf(t.id)} onPick={(token) => customize({ token })} />
            ))}
          </group>
        </Canvas>
      </div>
      <div className="token-names" role="radiogroup" aria-label="Token">
        {TOKENS.map((t) => {
          const owner = ownerOf(t.id);
          const mine = owner?.id === me.id;
          return (
            <button
              key={t.id}
              role="radio"
              aria-checked={mine}
              className={`token-name ${mine ? 'mine' : ''}`}
              disabled={owner && !mine}
              onClick={() => customize({ token: t.id })}
            >
              {t.name}
              {owner && !mine && <small>{owner.name}</small>}
            </button>
          );
        })}
      </div>
      <div className="swatches" role="radiogroup" aria-label="Color">
        {PLAYER_COLORS.map((c) => {
          const owner = colorOwner(c);
          const mine = owner?.id === me.id;
          return (
            <button
              key={c}
              role="radio"
              aria-checked={mine}
              title={owner && !mine ? `Taken by ${owner.name}` : c}
              className={`swatch-btn ${mine ? 'mine' : ''}`}
              style={{ background: c }}
              disabled={owner && !mine}
              onClick={() => customize({ color: c })}
            />
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- rules

function RuleControl({ rule, value, editable, onChange }) {
  if (rule.key === 'mode') {
    return (
      <div className="mode-cards">
        {rule.options.map((o) => (
          <button
            key={o.value}
            className={`mode-card ${value === o.value ? 'on' : ''}`}
            disabled={!editable && value !== o.value}
            onClick={() => editable && onChange(o.value)}
          >
            <b>{o.label}</b>
            <span>{o.description}</span>
          </button>
        ))}
      </div>
    );
  }
  if (rule.type === 'toggle') {
    return (
      <button
        role="switch"
        aria-checked={value}
        className={`switch ${value ? 'on' : ''}`}
        disabled={!editable}
        onClick={() => onChange(!value)}
      >
        <span />
      </button>
    );
  }
  return (
    <div className="segmented">
      {rule.options.map((o) => (
        <button
          key={String(o.value)}
          className={value === o.value ? 'on' : ''}
          disabled={!editable}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function RulesPanel() {
  const state = useGame((g) => g.state);
  const playerId = useGame((g) => g.playerId);
  const updateSettings = useGame((g) => g.updateSettings);
  const editable = state.hostId === playerId;
  const settings = state.settings;

  const visible = RULES.filter((r) => ruleApplies(r, settings));
  const groups = [...new Set(visible.map((r) => r.group))];

  return (
    <section className="card setup-section">
      <h3>Rules {!editable && <span className="tag">set by host</span>}</h3>
      {groups.map((g) => (
        <div key={g} className="rule-group">
          {g !== 'Mode' && <h4>{g}</h4>}
          {visible.filter((r) => r.group === g).map((r) => (
            <div key={r.key} className={`rule ${r.type}`}>
              {r.key !== 'mode' && (
                <div className="rule-text">
                  <div>{r.label}</div>
                  {r.description && <div className="muted small">{r.description}</div>}
                </div>
              )}
              <RuleControl rule={r} value={settings[r.key]} editable={editable} onChange={(v) => updateSettings({ [r.key]: v })} />
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------- page

export default function RoomSetup() {
  const state = useGame((g) => g.state);
  const playerId = useGame((g) => g.playerId);
  const startGame = useGame((g) => g.startGame);
  const leaveRoom = useGame((g) => g.leaveRoom);
  const isHost = state.hostId === playerId;
  const tokenName = (id) => TOKENS.find((t) => t.id === id)?.name;

  return (
    <div className="setup">
      <header className="setup-header">
        <div>
          <h2>Room <span className="code">{state.code}</span></h2>
          <p className="muted">Share this code with your friends.</p>
        </div>
        <div className="row">
          <button className="secondary" onClick={leaveRoom}>Leave</button>
          {isHost ? (
            <button disabled={state.players.length < 2} onClick={startGame}>
              {state.players.length < 2 ? 'Waiting for players…' : 'Start game'}
            </button>
          ) : (
            <span className="muted">Waiting for the host to start…</span>
          )}
        </div>
      </header>

      <div className="setup-grid">
        <div className="setup-col">
          <section className="card setup-section">
            <h3>Players ({state.players.length}/6)</h3>
            <ul className="player-list">
              {state.players.map((p) => (
                <li key={p.id}>
                  <span className="swatch" style={{ background: p.color }} />
                  <span className="grow">{p.name}</span>
                  <span className="muted small">{tokenName(p.token)}</span>
                  {p.id === state.hostId && <span className="tag">host</span>}
                  {p.id === playerId && <span className="tag">you</span>}
                </li>
              ))}
            </ul>
          </section>
          <PiecePicker />
        </div>
        <div className="setup-col">
          <RulesPanel />
        </div>
      </div>
    </div>
  );
}
