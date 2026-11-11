import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { io } from 'socket.io-client';

// In dev, Vite proxies /socket.io to the server. In prod the server serves the client.
// Set VITE_SERVER_URL when the client is hosted separately (e.g. Netlify + Render).
const socket = io(import.meta.env.VITE_SERVER_URL || undefined, { autoConnect: true });

const TOKEN_KEY = 'mopo.token';
const storage = {
  get: () => { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (v) => { try { v ? sessionStorage.setItem(TOKEN_KEY, v) : sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } },
};

function emit(event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

export const useGame = create((set, get) => ({
  connected: false,
  state: null, // public game state from the server
  playerId: null,
  code: null,
  error: null,
  selected: null, // board space index the user clicked
  clockOffset: 0, // serverNow - Date.now(), for turn/game countdowns

  setSelected: (i) => set({ selected: i }),
  clearError: () => set({ error: null }),

  async createRoom(name) {
    const res = await emit('room:create', { name });
    if (!res.ok) return set({ error: res.error });
    storage.set(res.token);
    set({ code: res.code, playerId: res.playerId, error: null });
  },

  async joinRoom(code, name) {
    const res = await emit('room:join', { code, name });
    if (!res.ok) return set({ error: res.error });
    storage.set(res.token);
    set({ code: res.code, playerId: res.playerId, error: null });
  },

  async leaveRoom() {
    await emit('room:leave');
    storage.set(null);
    set({ code: null, playerId: null, state: null, selected: null });
  },

  async startGame() {
    const res = await emit('game:start');
    if (!res.ok) set({ error: res.error });
  },

  async updateSettings(patch) {
    const res = await emit('room:settings', patch);
    if (!res.ok) set({ error: res.error });
  },

  async addBot(difficulty) {
    const res = await emit('bot:add', { difficulty });
    if (!res.ok) set({ error: res.error });
  },

  async removeBot(id) {
    const res = await emit('bot:remove', { id });
    if (!res.ok) set({ error: res.error });
  },

  async setBotDifficulty(id, difficulty) {
    const res = await emit('bot:difficulty', { id, difficulty });
    if (!res.ok) set({ error: res.error });
  },

  async customize(patch) {
    const res = await emit('player:customize', patch);
    if (!res.ok) set({ error: res.error });
  },

  async act(action) {
    const res = await emit('game:action', action);
    if (!res.ok) set({ error: res.error });
    return res.ok;
  },
}));

socket.on('connect', async () => {
  useGame.setState({ connected: true });
  const token = storage.get();
  if (!token) return;
  const res = await emit('hello', { token });
  if (res.ok && res.resumed) useGame.setState({ code: res.code, playerId: res.playerId });
  else storage.set(null);
});
socket.on('disconnect', () => useGame.setState({ connected: false }));
socket.on('state', (state) => useGame.setState({ state, clockOffset: state.serverNow - Date.now() }));

// Convenience selectors
export const useMe = () => useGame((g) => g.state?.players.find((p) => p.id === g.playerId));
export const useCurrent = () => useGame((g) => g.state?.players[g.state.turn]);

/** Server-synced clock, re-rendering every `ms` while mounted. */
export function useServerNow(ms = 200) {
  const offset = useGame((g) => g.clockOffset);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now + offset;
}
