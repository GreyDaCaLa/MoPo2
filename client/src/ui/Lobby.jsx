import { useState } from 'react';
import { useGame } from '../net/store.js';

export function Lobby() {
  const { createRoom, joinRoom, connected } = useGame();
  const [name, setName] = useState(() => {
    try { return localStorage.getItem('mopo.name') || ''; } catch { return ''; }
  });
  const [code, setCode] = useState('');

  const remember = () => { try { localStorage.setItem('mopo.name', name); } catch { /* ignore */ } };

  return (
    <div className="center-screen">
      <div className="card lobby">
        <h1>MoPo</h1>
        <p className="muted">Buy streets, collect rent, bankrupt your friends.</p>
        <label>
          Your name
          <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sam" />
        </label>
        <button disabled={!connected || !name.trim()} onClick={() => { remember(); createRoom(name.trim()); }}>
          Create a room
        </button>
        <div className="divider">or join one</div>
        <div className="row">
          <input
            value={code}
            maxLength={4}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="CODE"
            className="code-input"
          />
          <button disabled={!connected || !name.trim() || code.length !== 4} onClick={() => { remember(); joinRoom(code, name.trim()); }}>
            Join
          </button>
        </div>
        {!connected && <p className="muted">Connecting to server…</p>}
      </div>
    </div>
  );
}
