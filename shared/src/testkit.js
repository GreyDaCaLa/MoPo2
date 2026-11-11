// Helpers shared by the engine tests.
import { createGame, addPlayer, startGame, applyAction, updateSettings } from './engine.js';

/** rng yielding the given dice faces in order (face f -> (f - 0.5) / 6). */
export const dice = (...faces) => {
  const q = [...faces];
  return () => (q.length ? (q.shift() - 0.5) / 6 : 0.5);
};
export const at = (now, ...faces) => ({ now, rng: dice(...faces) });
export const noShuffle = () => 0.999; // keeps seat and deck order

export function newGame(settings = {}, names = ['a', 'b']) {
  let s = createGame('TEST');
  for (const n of names) s = addPlayer(s, n, n.toUpperCase());
  s = updateSettings(s, names[0], settings);
  return startGame(s, names[0], { rng: noShuffle, now: 0 });
}

export const player = (s, id) => s.players.find((p) => p.id === id);
export const promptOf = (s, id, kind) => s.prompts.find((p) => p.player === id && p.kind === kind);

export const ready = (s, id, ...faces) => applyAction(s, id, { type: 'ready' }, at(1000, ...faces));
export function answer(s, id, kind, choice, ...faces) {
  const p = promptOf(s, id, kind);
  if (!p) throw new Error(`no ${kind} prompt for ${id}`);
  return applyAction(s, id, { type: 'answer', promptId: p.id, choice }, at(1000, ...faces));
}
